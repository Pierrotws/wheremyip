import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const REFRESH_INTERVAL_SECONDS = 600;
const REGIONAL_INDICATOR_A = 0x1F1E6;
const ASCII_A = 'A'.charCodeAt(0);

// Tried in turn until one answers: VPN DNS filters (e.g. NordVPN Threat
// Protection) blocklist some of these, and free tiers rate-limit shared VPN IPs.
// Each parse() normalizes the response to {ip, countryCode, countryName, city, region, isp}.
const PROVIDERS = [
    {
        url: 'https://ipapi.co/json/',
        parse: d => {
            if (d.error)
                throw new Error(d.reason || _('API error'));
            return {
                ip: d.ip,
                countryCode: d.country_code || d.country,
                countryName: d.country_name,
                city: d.city,
                region: d.region,
                isp: d.org || d.asn,
            };
        },
    },
    {
        url: 'https://ipwho.is/',
        parse: d => {
            if (!d.success)
                throw new Error(d.message || _('API error'));
            return {
                ip: d.ip,
                countryCode: d.country_code,
                countryName: d.country,
                city: d.city,
                region: d.region,
                isp: d.connection?.isp || d.connection?.org,
            };
        },
    },
    {
        url: 'https://ipinfo.io/json',
        parse: d => {
            if (d.error)
                throw new Error(d.error.message || _('API error'));
            return {
                ip: d.ip,
                countryCode: d.country,
                city: d.city,
                region: d.region,
                isp: d.org?.replace(/^AS\d+\s+/, ''),
            };
        },
    },
    {
        url: 'https://get.geojs.io/v1/ip/geo.json',
        parse: d => ({
            ip: d.ip,
            countryCode: d.country_code,
            countryName: d.country,
            city: d.city,
            region: d.region,
            isp: d.organization_name || d.organization,
        }),
    },
];

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

function countryCodeToName(code) {
    try {
        return new Intl.DisplayNames(['en'], {type: 'region'}).of(code);
    } catch {
        return '';
    }
}

function countryCodeToFlag(code) {
    if (!code || code.length !== 2)
        return '\u{1F310}';
    const cc = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc))
        return '\u{1F310}';
    return String.fromCodePoint(
        REGIONAL_INDICATOR_A + cc.charCodeAt(0) - ASCII_A,
        REGIONAL_INDICATOR_A + cc.charCodeAt(1) - ASCII_A,
    );
}

const WhereMyIpIndicator = GObject.registerClass(
class WhereMyIpIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Where My IP'));

        this._lastIp = '';
        this._providerIndex = 0;
        this._cancellable = null;
        this._timeoutId = 0;
        this._netDebounceId = 0;
        this._networkChangedId = 0;

        this._httpSession = new Soup.Session({
            user_agent: 'wheremyip-gnome-extension/1',
            timeout: 15,
        });

        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._flagLabel = new St.Label({
            text: '\u{1F310}',
            style_class: 'wheremyip-flag',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._flagLabel);
        this.add_child(box);

        this._ipItem = new PopupMenu.PopupMenuItem(_('IP: …'), {reactive: false});
        this._countryItem = new PopupMenu.PopupMenuItem(_('Country: …'), {reactive: false});
        this._cityItem = new PopupMenu.PopupMenuItem(_('City: …'), {reactive: false});
        this._ispItem = new PopupMenu.PopupMenuItem(_('ISP: …'), {reactive: false});

        this.menu.addMenuItem(this._ipItem);
        this.menu.addMenuItem(this._countryItem);
        this.menu.addMenuItem(this._cityItem);
        this.menu.addMenuItem(this._ispItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const copyItem = new PopupMenu.PopupMenuItem(_('Copy IP to clipboard'));
        copyItem.connect('activate', () => this._copyIp());
        this.menu.addMenuItem(copyItem);

        const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh now'));
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);

        this._networkMonitor = Gio.NetworkMonitor.get_default();
        this._networkChangedId = this._networkMonitor.connect(
            'network-changed',
            (_m, available) => this._onNetworkChanged(available),
        );

        this._scheduleRefresh();
        this._refresh();
    }

    _scheduleRefresh() {
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _onNetworkChanged(available) {
        if (!available)
            return;
        if (this._netDebounceId > 0)
            GLib.source_remove(this._netDebounceId);
        this._netDebounceId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            3,
            () => {
                this._netDebounceId = 0;
                this._refresh();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    async _refresh() {
        if (!this._networkMonitor.network_available) {
            this._setOffline();
            return;
        }
        if (this._cancellable)
            this._cancellable.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        // Start from the provider that last worked so a blocked one isn't retried every time.
        let lastError;
        for (let i = 0; i < PROVIDERS.length; i++) {
            const index = (this._providerIndex + i) % PROVIDERS.length;
            try {
                const info = await this._query(PROVIDERS[index], cancellable);
                this._providerIndex = index;
                this._updateUI(info);
                return;
            } catch (e) {
                if (cancellable.is_cancelled())
                    return;
                const detail = e.cause ? `: ${e.cause.message}` : '';
                console.warn(`wheremyip: ${PROVIDERS[index].url}: ${e.message}${detail}`);
                lastError = e;
            }
        }
        this._setError(lastError.message);
    }

    async _query(provider, cancellable) {
        const message = Soup.Message.new('GET', provider.url);
        message.request_headers.append('Accept', 'application/json');

        let bytes;
        try {
            bytes = await this._httpSession.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, cancellable);
        } catch (e) {
            throw new Error(_('Network error'), {cause: e});
        }
        const status = message.get_status();
        if (status !== Soup.Status.OK)
            throw new Error(`HTTP ${status}`);

        let data;
        try {
            data = JSON.parse(new TextDecoder('utf-8').decode(bytes.get_data()));
        } catch {
            throw new Error(_('Parse error'));
        }
        const info = provider.parse(data);
        if (!info.ip)
            throw new Error(_('Parse error'));
        return info;
    }

    _updateUI(info) {
        this._lastIp = info.ip;
        const code = info.countryCode || '';
        this._flagLabel.text = countryCodeToFlag(code);
        this._ipItem.label.text = _('IP: ') + info.ip;
        const countryName = info.countryName || countryCodeToName(code) || code || '—';
        this._countryItem.label.text = _('Country: ') + (code ? `${countryName} (${code})` : countryName);
        const city = info.city || '—';
        const region = info.region ? `, ${info.region}` : '';
        this._cityItem.label.text = _('City: ') + city + region;
        this._ispItem.label.text = _('ISP: ') + (info.isp || '—');
    }

    _setOffline() {
        this._flagLabel.text = '\u{26D4}';
        this._ipItem.label.text = _('IP: offline');
        this._countryItem.label.text = _('Country: —');
        this._cityItem.label.text = _('City: —');
        this._ispItem.label.text = _('ISP: —');
    }

    _setError(msg) {
        this._flagLabel.text = '\u{26A0}';
        this._ipItem.label.text = _('IP: —');
        this._countryItem.label.text = _('Error: ') + msg;
        this._cityItem.label.text = _('City: —');
        this._ispItem.label.text = _('ISP: —');
    }

    _copyIp() {
        if (!this._lastIp) {
            Main.notify(_('Where My IP'), _('No IP to copy yet'));
            return;
        }
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._lastIp);
        Main.notify(_('Where My IP'), _('Copied: ') + this._lastIp);
    }

    destroy() {
        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._netDebounceId > 0) {
            GLib.source_remove(this._netDebounceId);
            this._netDebounceId = 0;
        }
        if (this._networkChangedId > 0) {
            this._networkMonitor.disconnect(this._networkChangedId);
            this._networkChangedId = 0;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
        super.destroy();
    }
});

export default class WhereMyIpExtension extends Extension {
    enable() {
        this._indicator = new WhereMyIpIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
