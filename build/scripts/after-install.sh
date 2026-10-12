#!/bin/bash
set -e

# Remove existing symlink first so we don't overwrite the target binary
rm -f /usr/bin/btick

cat << 'EOF' > /usr/bin/btick
#!/bin/bash
exec /opt/BTick/btick --no-sandbox --disable-gpu "$@"
EOF

chmod 755 /usr/bin/btick

# Copy 512x512 icon to /usr/share/pixmaps as standard fallback
if [ -f /usr/share/icons/hicolor/512x512/apps/btick.png ]; then
  mkdir -p /usr/share/pixmaps
  cp -f /usr/share/icons/hicolor/512x512/apps/btick.png /usr/share/pixmaps/btick.png 2>/dev/null || true
fi

# Refresh GTK icon cache if available
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi

# Update desktop application database
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi
