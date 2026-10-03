#!/bin/bash
set -e

# Update-alternatives links /usr/bin/btick -> /opt/BTick/btick by default.
# We replace /usr/bin/btick with a wrapper that passes required Linux stability flags (--no-sandbox, --disable-gpu).
cat << 'EOF' > /usr/bin/btick
#!/bin/bash
exec /opt/BTick/btick --no-sandbox --disable-gpu "$@"
EOF

chmod 755 /usr/bin/btick
