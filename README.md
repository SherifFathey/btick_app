# BTick — Web & Desktop Visualizer

Real-time Behavior Tree visualizer, interactive debugger, and execution analyzer for **BehaviorTree.CPP (v3 & v4)**, **ROS 2**, and **Groot2**.

[![ROS 2](https://img.shields.io/badge/ROS_2-Jazzy%20%7C%20Humble%20%7C%20Iron%20%7C%20Rolling-blue)](https://docs.ros.org/)
[![BehaviorTree.CPP](https://img.shields.io/badge/BehaviorTree.CPP-4.x%20%26%203.x-purple)](https://www.behaviortree.dev/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-green)](LICENSE)

---

## Overview

**BTick App** is a modern, high-performance visualization and debugging application for robotic behavior trees. It provides roboticists and software engineers with real-time insight into tree topology, active execution states, blackboard variables, and node transitions.

BTick App operates seamlessly across multiple communication backends (ROS 2 DDS topics, Groot2 ZeroMQ/TCP servers, and Nav2 log topics) as well as offline tree definitions and session recordings. It can be deployed as a zero-install browser application, a containerized service, or a standalone Linux desktop application.

---

## Features

- **Interactive Canvas & Auto-Layout**: Smooth pan/zoom canvas powered by React Flow with automated hierarchical Dagre graph layout, node collapsing, and search filtering.
- **Multi-Protocol Real-Time Streaming**: Connects directly to live ROS 2 trees via the BTick protocol, Groot2 TCP servers (`BT::Groot2Publisher`), and Nav2 log streams.
- **Interactive Breakpoints & Stepping**: Set breakpoints on any node UID, pause live execution, step tick-by-tick, resume, or inject forced success/failure overrides.
- **Dynamic Fault Injection**: Test system resilience by overriding node outcomes (`FORCE_FAILURE`, `FORCE_SUCCESS`, `FORCE_RUNNING`, `FORCE_SKIPPED`) or injecting artificial delays at runtime.
- **Live Blackboard Inspector & Editor**: View all active blackboard variables across root and subtrees with live search, type detection, and in-place variable modification.
- **Dynamic Port Inspector & Remapping**: Inspect node input and output ports, monitor runtime values, and remap input ports between literal values and blackboard keys dynamically.
- **Session Recording & Replay Scrubber**: Record complete live execution sessions to IndexedDB or export JSON files. Scrub backwards and forwards through historical execution timelines with keyframe state reconstruction.
- **Multi-Tree Management**: Monitor multiple concurrent trees or subtrees simultaneously with multi-tab navigation and dedicated tree discovery indicators.
- **Offline Inspection**: Open and visualize standard BehaviorTree.CPP XML files without requiring an active robot connection.
- **Cross-Platform Deployment**: Run in any web browser, deploy via Docker on the robot, or install as a native Linux desktop application (`.deb` / `.AppImage`).

---

## Quick Start

### Option 1: Docker Container (One-Command Deployment)

Deploy BTick using Docker Compose with host network integration for automatic ROS 2 DDS and Groot2 discovery:

```bash
docker compose up -d
```

_Or run with standard Docker commands:_

```bash
docker build -t btick .
docker run -d --net=host -p 3000:3000 -p 8080:8080 --name btick btick:latest
```

Then open **`http://localhost:3000`** (or `http://<robot-ip>:3000`) in any modern web browser (Chrome, Firefox, Safari, Edge, tablets, or phones).

---

### Option 2: Standalone Desktop App (Debian Package)

Download and install the official standalone desktop application package on Ubuntu / Debian:

```bash
wget https://github.com/SherifFathey/btick_app/releases/latest/download/btick_v1.2.3_amd64.deb
sudo apt install ./btick_v1.2.3_amd64.deb
```

Then run it directly from your terminal:

```bash
btick
```

---

## Project Structure

| Path / Directory          | Role                          | Description                                                                                           |
| :------------------------ | :---------------------------- | :---------------------------------------------------------------------------------------------------- |
| `bridge/`                 | Backend Bridge Daemons        | Multi-protocol Python servers bridging ROS 2, Groot2, and Nav2 to WebSockets                          |
| `bridge/bt_bridge.py`     | Unified Multi-Protocol Server | Unified bridge listening on ROS 2 DDS, Groot2 TCP, and Nav2 logging topics                            |
| `bridge/btick_bridge.py`  | Dedicated BTick Bridge        | Dedicated ROS 2 bridge for `/btick/tree_discovery`, `/btick/tree_transitions`, and `/btick/command_*` |
| `bridge/groot2_bridge.py` | Groot2 TCP Client Bridge      | Connects to standard `BT::Groot2Publisher` (ZeroMQ/TCP port 1667) and streams events                  |
| `bridge/nav2_bridge.py`   | Nav2 Logger Bridge            | Subscribes to Nav2 `/behavior_tree_log` topic and maps status changes to graph events                 |
| `bridge/common.py`        | Shared Bridge Utilities       | Common XML tree parsers, data models, and WebSocket client dispatchers                                |
| `src/`                    | Frontend Application Source   | React 18 and TypeScript application codebase                                                          |
| `src/monitor/`            | Tree Monitor Module           | Real-time tree canvas, graph auto-layout, node status rendering, and transition handlers              |
| `src/monitor/components/` | Monitor UI Components         | Canvas viewports, blackboard tables, port editors, breakpoints modal, and replay scrubber             |
| `src/monitor/protocols/`  | Frontend Protocol Clients     | WebSocket adapters for BTick, Groot2, Nav2, and offline file playback                                 |
| `src/editor/`             | Tree Editor Module            | Visual Behavior Tree XML editor, node palette, drag-and-drop hierarchy builder                        |
| `src/shared/`             | Shared UI & Utilities         | Common buttons, modals, icons, theme toggles, and data formatting utilities                           |
| `electron/`               | Desktop Shell                 | Electron configuration, main process runner, preload scripts, and session file store                  |
| `electron/main.cjs`       | Electron Main Entry           | Desktop window lifecycle management, menu configuration, and native IPC handling                      |
| `public/`                 | Static Public Assets          | Web application icons, protocol badges, and favicon assets                                            |
| `release/`                | Packaging Outputs             | Built standalone distribution packages (`.deb`, `.AppImage`, unpacked binaries)                       |
| `Dockerfile`              | Container Definition          | Production multi-stage Docker build recipe for web server and bridge                                  |
| `docker-compose.yml`      | Container Orchestration       | Docker Compose configuration with host network mode for DDS discovery                                 |
| `package.json`            | Project Manifest              | Node.js dependencies, build scripts, desktop packaging metadata, and targets                          |
| `vite.config.ts`          | Frontend Bundler Config       | Vite development server and build configuration with React plugin                                     |
| `tailwind.config.js`      | Styling Configuration         | Tailwind CSS utility theme configuration, colors, and layout tokens                                   |

---

## Supported Protocols & Backends

BTick automatically discovers and bridges multiple Behavior Tree backends:

1. **BTick ROS 2 Protocol (Recommended)**:
   - Native ROS 2 communication over `/btick/tree_discovery`, `/btick/tree_transitions`, `/btick/command_in`, and `/btick/command_out`.
   - Full support for live breakpoints, fault injection, dynamic port edits, and typed blackboard modifications.

2. **Groot2 TCP Server (`BT::Groot2Publisher`)**:
   - Connects to standard BehaviorTree.CPP v4 Groot2 servers (default port `1667`).
   - Supports live topology streaming, node status updates, and interactive stepping.

3. **Nav2 Behavior Tree Logger**:
   - Subscribes to Nav2 `/behavior_tree_log` topics for standard navigation tree observation.

4. **Offline XML File Inspection**:
   - Load and analyze tree definitions by dragging and dropping XML files or clicking **Load Tree (XML)** in the header bar.

---

## Architecture

BTick App is composed of a high-performance React frontend and a lightweight Python bridge daemon:

- **Frontend (UI)**: Built with React 18, TypeScript, Tailwind CSS, and `@xyflow/react`. Manages node state visualization, real-time metrics, blackboard tables, breakpoints, and replay timelines.
- **Bridge (`bridge/bt_bridge.py`)**: Connects to ROS 2 DDS and TCP networks, translates native tree events into WebSocket JSON messages, and routes interactive commands back to target nodes.
- **Desktop Shell (Electron)**: Bundles the frontend and bridge into a self-contained desktop binary.

---

## Build & Package Commands

| Command                  | Description                                               |
| :----------------------- | :-------------------------------------------------------- |
| `docker compose up -d`   | Launches containerized web app and bridge on host network |
| `btick`                  | Launches installed native desktop application             |
| `npm run dev`            | Starts the Vite development server with hot reload        |
| `npm run build`          | Compiles production frontend assets to `dist/`            |
| `npm run build:deb`      | Packages standalone `.deb` installer into `release/`      |
| `npm run build:appimage` | Builds standalone `.AppImage` bundle into `release/`      |
| `npm run bridge`         | Runs the multi-protocol Python bridge directly            |

---

## Configuration & Remote Access

The bridge server accepts command-line arguments and environment variables without needing image rebuilds:

| CLI Flag                      | Env Variable         | Default            | Description                                                                            |
| :---------------------------- | :------------------- | :----------------- | :------------------------------------------------------------------------------------- |
| `--http-port`                 | `HTTP_PORT`          | `3000`             | HTTP port for serving the web visualizer                                               |
| `--ws-port`                   | `WS_PORT`            | `8080`             | WebSocket port for streaming telemetry                                                 |
| `--zmq-port` / `--groot-port` | `ZMQ_PORT`           | `1667`             | Target port for connecting to Groot2 / ZMQ servers                                     |
| `--zmq-host` / `--groot-host` | `ZMQ_HOST`           | `127.0.0.1`        | Target host for connecting to Groot2 / ZMQ servers                                     |
| `--open-browser`              | `OPEN_BROWSER`       | `false`            | Automatically open browser at `http://localhost:<HTTP_PORT>` once HTTP server is ready |
| —                             | `ROS_DOMAIN_ID`      | `0`                | ROS 2 domain identifier (must match the robot)                                         |
| —                             | `RMW_IMPLEMENTATION` | `rmw_fastrtps_cpp` | Underlying ROS 2 middleware implementation                                             |

### Docker Compose Configuration Example

```yaml
environment:
  - HTTP_PORT=${HTTP_PORT:-3000}
  - WS_PORT=${WS_PORT:-8080}
  - ZMQ_PORT=${ZMQ_PORT:-1667}
  - ZMQ_HOST=${ZMQ_HOST:-127.0.0.1}
  - ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-0}
  - RMW_IMPLEMENTATION=${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}
  - OPEN_BROWSER=${OPEN_BROWSER:-false}
```

To enable automatic browser opening when launching with Docker Compose:

```env
OPEN_BROWSER=true
```

```bash
OPEN_BROWSER=true docker compose up -d
```

### Remote Multi-Machine Access

To run the container on one machine (e.g. a Raspberry Pi on the robot) and open the UI from a different computer on the network:

1. **Firewall Setup**: Ensure the robot allows inbound TCP connections on your chosen ports (e.g. `3000`, `8080`, `1667`):
   ```bash
   sudo ufw allow 3000/tcp
   sudo ufw allow 8080/tcp
   sudo ufw allow 1667/tcp
   ```
2. **Launch with Custom Ports**:
   ```bash
   HTTP_PORT=4000 WS_PORT=4001 ZMQ_PORT=4002 docker compose up -d
   ```
3. **Open in Remote Browser**: Navigate to `http://<robot-ip>:4000`. The frontend automatically queries `/config.json`, resolves WebSocket port `4001`, and connects over `ws://<robot-ip>:4001`.

---

## Releasing

Releases are published automatically via GitHub Actions whenever a GitHub Release is published from the `main` branch.

### Release Steps:

1. **Create Semver Tag & Release**:
   - Tag format must follow semantic versioning: `vX.Y.Z` (e.g. `v1.0.0`).
   - Target must be the `main` branch.
   - Publish the Release on GitHub.

2. **Repository Permissions**:
   - Ensure the repository has workflow write access under **Settings > Actions > General > Workflow permissions > Read and write permissions**.

3. **GHCR Image Visibility**:
   - After the first release workflow runs, navigate to GitHub Packages and set the `btick` container package visibility to **Public** so users can pull without authentication.

---

## License

BTick is open-source software licensed under the Apache License 2.0.
