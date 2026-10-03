#!/bin/bash
set -e

# Remove existing symlink first so we don't overwrite the target binary
rm -f /usr/bin/btick

cat << 'EOF' > /usr/bin/btick
#!/bin/bash
exec /opt/BTick/btick --no-sandbox --disable-gpu "$@"
EOF

chmod 755 /usr/bin/btick
