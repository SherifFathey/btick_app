# syntax=docker/dockerfile:1
# BTick APP image: frontend + unified bridge on top of the base.
#
# Build command:
#   docker build -t btick:latest .

ARG BASE_IMAGE=ghcr.io/sheriffathey/btick-base:base

# ---------- web build (arch-independent output) ----------
FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS web-build
WORKDIR /app

# Prevent Electron from downloading desktop binaries in the web build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
# Avoid ETIMEDOUT on networks with broken IPv6
ENV NODE_OPTIONS=--dns-result-order=ipv4first

# Dependencies layer
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm ci --ignore-scripts --prefer-offline

# Source layer
COPY . ./
RUN npm run build

# ---------- runtime layer ----------
FROM ${BASE_IMAGE} AS runtime

COPY --from=web-build /app/dist /app/dist
COPY bridge /app/bridge

# Configurable runtime ports and options (can be overridden via docker-compose environment)
ENV HTTP_PORT=3000 \
    WS_PORT=8080 \
    ZMQ_PORT=1667 \
    OPEN_BROWSER=false

# Expose ports for documentation (ignored when using network_mode: host)
EXPOSE 3000 8080 1667

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import os, urllib.request; urllib.request.urlopen('http://localhost:%s/' % os.environ.get('HTTP_PORT', '3000'))" || exit 1

# `exec` so SIGTERM from `docker stop` reaches python
ENTRYPOINT ["/bin/bash", "-c", "source /opt/ros/jazzy/setup.bash && exec python3 /app/bridge/bt_bridge.py --http-port \"${HTTP_PORT}\" --ws-port \"${WS_PORT}\" --zmq-port \"${ZMQ_PORT}\" --open-browser \"${OPEN_BROWSER}\" --dist-dir /app/dist \"$@\"", "--"]
