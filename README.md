# wheremyip

GNOME Shell extension that shows the country flag of your current public IP in the top panel.

Click the flag for details: IP address, country, city/region, and ISP. Includes
"Refresh now" and "Copy IP to clipboard" actions. Automatically refreshes every
10 minutes and on network changes (e.g. VPN connect/disconnect).

## Requirements

- GNOME Shell 45 – 50
- A font with regional-indicator glyph coverage (e.g. `noto-fonts-emoji` /
  `fonts-noto-color-emoji`) so the flag renders as an actual flag rather than two
  letters.
- Internet access. Geolocation uses free endpoints, tried in turn until one
  answers: [ipapi.co](https://ipapi.co), [ipwho.is](https://ipwho.is),
  [ipinfo.io](https://ipinfo.io) and [geojs.io](https://www.geojs.io). This
  keeps it working behind VPNs whose DNS filtering blocks some of them (e.g.
  NordVPN Threat Protection blocks ipapi.co). Failures are logged to the
  GNOME Shell journal.

## Install

```sh
make install
```

Then reload GNOME Shell:
- **X11:** Alt+F2, type `r`, Enter.
- **Wayland:** log out and back in.

Enable it:

```sh
gnome-extensions enable wheremyip@pierrotws.github.com
```

## Uninstall

```sh
make uninstall
```

## Hack on it

`make reload` reinstalls and toggles the extension. To watch logs while
developing:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

## Package for extensions.gnome.org

```sh
make pack
```

Produces `wheremyip@pierrotws.github.com.shell-extension.zip` in the repo
root, ready to upload at https://extensions.gnome.org/upload/.

## License

See [LICENSE](LICENSE).

