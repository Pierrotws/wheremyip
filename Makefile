UUID    := wheremyip@pierrotws.github.com
DEST    := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
FILES   := metadata.json extension.js stylesheet.css

.PHONY: install uninstall enable disable reload pack clean

install:
	@mkdir -p $(DEST)
	@cp -f $(FILES) $(DEST)/
	@echo "Installed to $(DEST)"
	@echo "On X11: press Alt+F2, type 'r', press Enter."
	@echo "On Wayland: log out and log back in."
	@echo "Then enable with: gnome-extensions enable $(UUID)"

uninstall:
	@gnome-extensions disable $(UUID) 2>/dev/null || true
	@rm -rf $(DEST)
	@echo "Removed $(DEST)"

enable:
	@gnome-extensions enable $(UUID)

disable:
	@gnome-extensions disable $(UUID)

reload: install
	@gnome-extensions disable $(UUID) 2>/dev/null || true
	@gnome-extensions enable $(UUID)

pack:
	@rm -f $(UUID).shell-extension.zip
	@zip -qX $(UUID).shell-extension.zip $(FILES)
	@echo "Built $(UUID).shell-extension.zip"
	@echo "Upload at https://extensions.gnome.org/upload/"

clean:
	@rm -f $(UUID).shell-extension.zip
