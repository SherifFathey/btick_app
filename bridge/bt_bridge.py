#!/usr/bin/env python3
"""
BTick Unified Multi-Protocol Bridge Server
------------------------------------------
Master orchestrator integrating:
1. BTick ROS 2 DDS Bridge (btick_bridge.py)
2. BehaviorTree.CPP Groot2 ZMQ Bridge (groot2_bridge.py)
3. ROS 2 Nav2 Behavior Tree Log Bridge (nav2_bridge.py)
4. Built-in WebSocket Server (RFC 6455) on port 8080
5. Built-in HTTP SPA Web Server on port 3000
"""

import os
import sys
import json
import time
import threading
import argparse
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer

try:
    from common import StandaloneWebSocketServer, SPAHTTPHandler
    from btick_bridge import BTickROS2Bridge, HAVE_RCLPY
    from groot2_bridge import Groot2ZMQBridge, HAVE_ZMQ
    from nav2_bridge import Nav2ROS2Bridge
except ImportError:
    from .common import StandaloneWebSocketServer, SPAHTTPHandler
    from .btick_bridge import BTickROS2Bridge, HAVE_RCLPY
    from .groot2_bridge import Groot2ZMQBridge, HAVE_ZMQ
    from .nav2_bridge import Nav2ROS2Bridge


class UnifiedBTBridgeServer:
    def __init__(
        self,
        ws_port: int = 8080,
        http_port: int = 3000,
        dist_dir: str = "",
        groot_host: str = "127.0.0.1",
        groot_port: int = 1667,
        enable_ros: bool = True,
        enable_groot: bool = True,
        enable_nav2: bool = True,
        open_browser: bool = False,
    ):
        self.ws_port = ws_port
        self.http_port = http_port
        self.dist_dir = dist_dir
        self.groot_host = groot_host
        self.groot_port = groot_port
        self.zmq_port = groot_port

        self.enable_ros = enable_ros
        self.enable_groot = enable_groot
        self.enable_nav2 = enable_nav2
        self.open_browser = open_browser

        # 1. Initialize Central WebSocket Server
        self.ws_server = StandaloneWebSocketServer(
            host="0.0.0.0",
            port=ws_port,
            on_client_message=self.handle_client_message,
            on_client_connect=self.handle_client_connect,
        )
        self.http_server = None

        # 2. Instantiate Sub-Bridges
        self.btick_bridge = (
            BTickROS2Bridge(
                on_event_callback=lambda d: self.broadcast_from_source("btick", d)
            )
            if enable_ros
            else None
        )
        self.groot2_bridge = (
            Groot2ZMQBridge(
                host=groot_host,
                port=groot_port,
                on_event_callback=lambda d: self.broadcast_from_source("groot2", d),
            )
            if enable_groot
            else None
        )
        self.nav2_bridge = (
            Nav2ROS2Bridge(
                on_event_callback=lambda d: self.broadcast_from_source("nav2", d)
            )
            if enable_nav2
            else None
        )

        self.current_source = "btick"
        self.connected_tree_keys = set()
        self.connected_tree_names = {}

    @staticmethod
    def _protocol_label(source):
        return {"btick": "BTICK", "groot2": "GROOT2", "nav2": "NAV2"}.get(
            source, str(source).upper()
        )

    @staticmethod
    def _single_line(value):
        return " ".join(str(value).split())

    def _emit_user_log(self, log):
        if not isinstance(log, dict):
            return
        protocol = self._protocol_label(log.get("protocol", "btick"))
        parts = []
        if log.get("nodeName"):
            parts.append(f"Node: {self._single_line(log['nodeName'])}")
        parts.append(f"Action: {self._single_line(log.get('action', 'Unknown'))}")
        if log.get("status"):
            parts.append(f"Status: {self._single_line(log['status'])}")
        if log.get("reason"):
            parts.append(f"Reason: {self._single_line(log['reason'])}")
        if log.get("treeName"):
            parts.append(f"Tree: {self._single_line(log['treeName'])}")
        if log.get("nodeCount") is not None:
            parts.append(f"Nodes: {log['nodeCount']}")
        print(f"[{protocol}] {' | '.join(parts)}", flush=True)

    def _tree_info(self, source, data):
        tree_id = data.get("tree_id") or data.get("tree_name")
        tree_name = data.get("tree_name") or tree_id
        nodes = data.get("nodes", [])
        node_count = (
            len(nodes)
            if isinstance(nodes, list)
            else len(nodes)
            if isinstance(nodes, dict)
            else 0
        )
        return source, tree_id, tree_name, node_count

    def _log_runtime_event(self, source, data):
        event_type = data.get("type")
        if event_type in ("tree_created", "tree", "sync_state") or (
            event_type not in ("transition", "protocol_heartbeat", "tree_status")
            and data.get("tree_id")
            and "nodes" in data
        ):
            source, tree_id, tree_name, node_count = self._tree_info(source, data)
            if not tree_id:
                return
            key = (source, tree_id)
            if key not in self.connected_tree_keys:
                self.connected_tree_keys.add(key)
                self.connected_tree_names[key] = tree_name
                self._emit_user_log(
                    {
                        "protocol": source,
                        "action": "Tree discovered",
                        "status": "Success",
                        "treeName": tree_name,
                        "nodeCount": node_count,
                    }
                )
                self._emit_user_log(
                    {
                        "protocol": source,
                        "action": "Connected",
                        "status": "Running",
                        "treeName": tree_name,
                        "nodeCount": node_count,
                    }
                )
        elif event_type == "tree_destroyed":
            tree_id = data.get("tree_id")
            key = (source, tree_id)
            if key in self.connected_tree_keys:
                self.connected_tree_keys.remove(key)
                connected_tree_name = self.connected_tree_names.pop(key, None)
                self._emit_user_log(
                    {
                        "protocol": source,
                        "action": "Disconnected",
                        "treeName": data.get("tree_name")
                        or connected_tree_name
                        or tree_id,
                    }
                )
        elif (
            event_type == "protocol_heartbeat" and data.get("status") == "DISCONNECTED"
        ):
            keys = [key for key in self.connected_tree_keys if key[0] == source]
            for key in keys:
                self.connected_tree_keys.remove(key)
                connected_tree_name = self.connected_tree_names.pop(key, None)
                tree = self._tree_for_key(source, key[1])
                self._emit_user_log(
                    {
                        "protocol": source,
                        "action": "Disconnected",
                        "treeName": (tree or {}).get("tree_name")
                        or connected_tree_name
                        or key[1],
                    }
                )
        elif (
            event_type == "transition" and data.get("status") == "PAUSED_AT_BREAKPOINT"
        ):
            tree = self._tree_for_key(source, data.get("tree_id"))
            node = self._node_for_event(tree, data)
            if node:
                self._emit_user_log(
                    {
                        "protocol": source,
                        "nodeName": node.get("name") or node.get("display_name"),
                        "action": "Breakpoint triggered",
                        "status": "Paused",
                    }
                )
        elif event_type in ("error", "initialization_error", "connection_error"):
            self._emit_user_log(
                {
                    "protocol": source,
                    "action": "Initialization failed",
                    "status": "Failed",
                    "treeName": data.get("tree_name"),
                    "reason": data.get("error")
                    or data.get("message")
                    or "Unknown error",
                }
            )

    def _tree_for_key(self, source, tree_id):
        if source == "btick" and self.btick_bridge:
            return self.btick_bridge.trees.get(tree_id)
        if source == "groot2" and self.groot2_bridge:
            tree = self.groot2_bridge.cached_tree
            return tree if tree and tree.get("tree_id") == tree_id else None
        if source == "nav2" and self.nav2_bridge:
            return self.nav2_bridge.trees.get(tree_id)
        return None

    @staticmethod
    def _node_for_event(tree, data):
        if not tree:
            return None
        for node in tree.get("nodes", []):
            if data.get("node_id") and node.get("id") == data.get("node_id"):
                return node
            if data.get("uid") is not None and node.get("uid") == data.get("uid"):
                return node
        return None

    def broadcast_from_source(self, source: str, data: dict):
        if not data or not isinstance(data, dict):
            return
        if "source" not in data and "protocol" not in data:
            data["source"] = source
            data["protocol"] = source
        self._log_runtime_event(source, data)
        self.broadcast_data(data)

    def handle_client_connect(self, sock):
        """Immediately push all existing discovered trees across all protocols to new client with explicit protocol isolation tags."""
        try:
            if self.btick_bridge and hasattr(self.btick_bridge, "trees"):
                for t in self.btick_bridge.trees.values():
                    if isinstance(t, dict):
                        t["source"] = "btick"
                        t["protocol"] = "btick"
                    self.ws_server.send_to_sock(sock, json.dumps(t))
            if self.groot2_bridge and getattr(self.groot2_bridge, "cached_tree", None):
                t = self.groot2_bridge.cached_tree
                if isinstance(t, dict):
                    t["source"] = "groot2"
                    t["protocol"] = "groot2"
                self.ws_server.send_to_sock(sock, json.dumps(t))
            if self.nav2_bridge and hasattr(self.nav2_bridge, "trees"):
                for t in self.nav2_bridge.trees.values():
                    if isinstance(t, dict):
                        t["source"] = "nav2"
                        t["protocol"] = "nav2"
                    self.ws_server.send_to_sock(sock, json.dumps(t))

            # Push initial protocol heartbeat statuses on connect
            if self.btick_bridge:
                st = (
                    "CONNECTED_IDLE"
                    if getattr(self.btick_bridge, "is_currently_alive", False)
                    else "DISCONNECTED"
                )
                self.ws_server.send_to_sock(
                    sock,
                    json.dumps(
                        {
                            "type": "protocol_heartbeat",
                            "source": "btick",
                            "protocol": "btick",
                            "status": st,
                        }
                    ),
                )
            if self.groot2_bridge:
                st = (
                    "CONNECTED_IDLE"
                    if bool(getattr(self.groot2_bridge, "cached_tree", None))
                    else "DISCONNECTED"
                )
                self.ws_server.send_to_sock(
                    sock,
                    json.dumps(
                        {
                            "type": "protocol_heartbeat",
                            "source": "groot2",
                            "protocol": "groot2",
                            "status": st,
                        }
                    ),
                )
            if self.nav2_bridge:
                now = time.time()
                is_alive = getattr(self.nav2_bridge, "is_currently_alive", False)
                has_recent_data = getattr(
                    self.nav2_bridge, "last_log_message_time", 0
                ) > 0 and (now - self.nav2_bridge.last_log_message_time) < getattr(
                    self.nav2_bridge, "activity_timeout", 1.0
                )
                st = (
                    ("CONNECTED_RUNNING" if has_recent_data else "CONNECTED_IDLE")
                    if is_alive
                    else "DISCONNECTED"
                )
                self.ws_server.send_to_sock(
                    sock,
                    json.dumps(
                        {
                            "type": "protocol_heartbeat",
                            "source": "nav2",
                            "protocol": "nav2",
                            "status": st,
                        }
                    ),
                )
        except Exception as e:
            print(
                f"[Unified Bridge] Error pushing initial tree to client: {e}",
                file=sys.stderr,
            )

    def broadcast_data(self, data: dict):
        if not data:
            return
        try:
            msg_str = json.dumps(data)
            self.ws_server.broadcast(msg_str)
        except Exception as e:
            print(f"[Unified Bridge] Broadcast error: {e}", file=sys.stderr)

    def _stdin_loop(self):
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                line = line.strip()
                if line:
                    self.handle_client_message(line)
            except Exception:
                break

    def start(self):
        # 1. Start WebSocket Server
        self.ws_server.start()

        # 2. Start stdin command listener thread for Electron IPC / CLI pipes
        stdin_t = threading.Thread(target=self._stdin_loop, daemon=True)
        stdin_t.start()

        # 3. Start HTTP Web App Server if dist folder exists
        if self.http_port > 0 and self.dist_dir and os.path.exists(self.dist_dir):
            try:

                def run_http():
                    handler = lambda *args, **kwargs: SPAHTTPHandler(
                        *args,
                        directory=self.dist_dir,
                        status_provider=self.get_status_info,
                        **kwargs,
                    )
                    self.http_server = ThreadingHTTPServer(
                        ("0.0.0.0", self.http_port), handler
                    )
                    self.http_server.ws_port = self.ws_port
                    self.http_server.http_port = self.http_port
                    self.http_server.zmq_port = self.zmq_port
                    print(
                        f"[Unified Bridge] 🌐 Web App active on http://0.0.0.0:{self.http_port}"
                    )
                    self.http_server.serve_forever()

                http_t = threading.Thread(target=run_http, daemon=True)
                http_t.start()
            except Exception as e:
                print(f"[Unified Bridge] HTTP Server warning: {e}", file=sys.stderr)

        # 4. Start Sub-Bridges
        if self.btick_bridge:
            self.btick_bridge.start()

        if self.groot2_bridge:
            self.groot2_bridge.start()

        if self.nav2_bridge:
            self.nav2_bridge.start()

        # 5. Automatically open browser if requested and HTTP server is active
        if self.open_browser and self.http_port > 0:
            browser_t = threading.Thread(
                target=self._open_browser_when_ready,
                args=(self.http_port,),
                daemon=True,
            )
            browser_t.start()

    @staticmethod
    def _open_browser_when_ready(
        http_port: int, max_retries: int = 50, delay: float = 0.1
    ):
        url = f"http://localhost:{http_port}"
        ready = False
        for _ in range(max_retries):
            try:
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=1.0) as resp:
                    if resp.status in (200, 301, 302, 304):
                        ready = True
                        break
            except Exception:
                pass
            time.sleep(delay)

        if not ready:
            print(
                f"[Unified Bridge] Warning: HTTP server on port {http_port} was not ready in time to open browser.",
                file=sys.stderr,
                flush=True,
            )
            return

        print(
            f"[Unified Bridge] 🚀 Automatically opening browser at {url}...", flush=True
        )
        try:
            import webbrowser

            opened = webbrowser.open(url)
            if not opened:
                import subprocess

                for cmd in (["xdg-open", url], ["open", url]):
                    try:
                        subprocess.Popen(
                            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                        )
                        break
                    except Exception:
                        pass
        except Exception as e:
            print(
                f"[Unified Bridge] Notice: Could not automatically open browser: {e}",
                file=sys.stderr,
                flush=True,
            )

    def get_status_info(self) -> dict:
        return {
            "ws_port": self.ws_port,
            "http_port": self.http_port,
            "zmq_port": self.groot_port,
            "groot_port": self.groot_port,
            "has_ros2": HAVE_RCLPY and bool(self.btick_bridge),
            "has_groot2": HAVE_ZMQ and bool(self.groot2_bridge),
            "groot2_connected": bool(self.groot2_bridge and self.groot2_bridge.running),
            "has_nav2": bool(self.nav2_bridge),
            "current_source": self.current_source,
            "trees": {
                "btick": list(self.btick_bridge.trees.keys())
                if self.btick_bridge
                else [],
                "groot2": [(self.groot2_bridge.cached_tree or {}).get("tree_id")]
                if self.groot2_bridge and self.groot2_bridge.cached_tree
                else [],
                "nav2": list(self.nav2_bridge.trees.keys()) if self.nav2_bridge else [],
            },
        }

    def handle_client_message(self, msg_str: str):
        try:
            msg = json.loads(msg_str)
        except Exception:
            return

        msg_type = msg.get("type")

        # 1. Interactive Debugger Command from Web UI
        if msg_type in ("command", "send_command") and "data" in msg:
            cmd = msg["data"]
            action = cmd.get("action")
            source = cmd.get("source")

            if action == "user_log":
                self._emit_user_log(cmd.get("log"))
                return

            # Client Tree Registration (e.g. Nav2 loaded XML tree from Web UI)
            if action in ("load_tree", "register_tree") or msg_type in (
                "load_tree",
                "register_tree",
            ):
                tree_data = (
                    cmd.get("tree")
                    or cmd.get("data")
                    or msg.get("tree")
                    or msg.get("data")
                )
                if isinstance(tree_data, dict):
                    t_id = tree_data.get("tree_id") or "MainTree"
                    target_source = (
                        source
                        or tree_data.get("source")
                        or tree_data.get("protocol")
                        or self.current_source
                    )
                    tree_data["source"] = target_source
                    tree_data["protocol"] = target_source
                    if target_source == "nav2" and self.nav2_bridge:
                        self.nav2_bridge.trees[t_id] = tree_data
                    elif target_source in ("groot2", "groot") and self.groot2_bridge:
                        self.groot2_bridge.cached_tree = tree_data
                    elif self.btick_bridge:
                        self.btick_bridge.trees[t_id] = tree_data

                    self.broadcast_data(
                        {
                            "type": "tree_created",
                            "data": tree_data,
                            "source": target_source,
                            "protocol": target_source,
                        }
                    )
                    self._log_runtime_event(
                        target_source, {**tree_data, "type": "tree_created"}
                    )
                return

            if action == "disconnect":
                target_source = source or self.current_source
                keys = [
                    key for key in self.connected_tree_keys if key[0] == target_source
                ]
                for key in keys:
                    self.connected_tree_keys.remove(key)
                    connected_tree_name = self.connected_tree_names.pop(key, None)
                    tree = self._tree_for_key(target_source, key[1])
                    self._emit_user_log(
                        {
                            "protocol": target_source,
                            "action": "Disconnected",
                            "treeName": (tree or {}).get("tree_name")
                            or connected_tree_name
                            or key[1],
                        }
                    )
                self.broadcast_data(
                    {
                        "type": "status",
                        "source": target_source,
                        "status": "DISCONNECTED",
                    }
                )
                return

            tree_id = cmd.get("tree_id")
            uid = cmd.get("uid")

            if not tree_id and action not in (
                "clear_all_breakpoints",
                "clear_all_faults",
            ):
                print(
                    f"[{self._protocol_label(source or self.current_source)}] "
                    f"Command '{action}' rejected: Missing required 'tree_id'",
                    file=sys.stderr,
                )
                return

            if uid is not None:
                try:
                    uid = int(uid)
                    cmd["uid"] = uid
                except (ValueError, TypeError):
                    pass

            # Protocol-isolated Blackboard Editing
            if action == "set_blackboard":
                if source in ("groot2", "nav2"):
                    self.broadcast_data(
                        {
                            "type": "blackboard_update_response",
                            "request_id": cmd.get("request_id"),
                            "source": source,
                            "protocol": source,
                            "tree_id": tree_id,
                            "key": cmd.get("key"),
                            "success": False,
                            "error": f"Blackboard writing is not supported for protocol '{source}'. It is read-only.",
                        }
                    )
                    return

                if self.btick_bridge:
                    cmd["source"] = "btick"
                    self.btick_bridge.send_command(cmd)
                return

            # Protocol-isolated Live Node Port Editing
            if action == "set_node_port":
                if source in ("groot2", "nav2"):
                    self.broadcast_data(
                        {
                            "type": "set_node_port_response",
                            "request_id": cmd.get("request_id"),
                            "source": source,
                            "protocol": source,
                            "tree_id": tree_id,
                            "uid": uid,
                            "port_name": cmd.get("port_name"),
                            "success": False,
                            "error": f"Node Port editing is not supported for protocol '{source}'. It is read-only.",
                        }
                    )
                    return

                if self.btick_bridge:
                    cmd["source"] = "btick"
                    self.btick_bridge.send_command(cmd)
                return

            # Route to Groot2 Bridge
            if source in ("groot2", "groot"):
                if self.groot2_bridge:
                    self.groot2_bridge.send_command(cmd)

            # Route to BTick C++ ROS2 Bridge
            elif source == "btick" or source is None:
                if self.btick_bridge:
                    self.btick_bridge.send_command(cmd)

            # Route to Nav2 adapter so unsupported execution is explicit rather
            # than being silently treated as a successful UI-only operation.
            elif source == "nav2":
                if self.nav2_bridge:
                    self.nav2_bridge.send_command(cmd)
                else:
                    print(
                        f"[NAV2] Command '{cmd.get('action')}' rejected: Nav2 monitoring is disabled.",
                        file=sys.stderr,
                    )

        # 2. Instant Tree Discovery Query from Web UI
        elif msg_type in ("get_tree", "get_trees", "request_tree", "discover"):
            if self.btick_bridge and hasattr(self.btick_bridge, "trees"):
                for t in self.btick_bridge.trees.values():
                    self.broadcast_data(t)
                self.btick_bridge.send_command(
                    {"action": "get_tree", "source": "btick"}
                )
            if self.groot2_bridge and getattr(self.groot2_bridge, "cached_tree", None):
                self.broadcast_data(self.groot2_bridge.cached_tree)
            if self.nav2_bridge and hasattr(self.nav2_bridge, "trees"):
                for t in self.nav2_bridge.trees.values():
                    self.broadcast_data(t)

        # 3. Source Switch Request from Web UI
        elif msg_type == "switch_source":
            source = msg.get("source", "btick")
            self.current_source = source

            if source in ("groot2", "groot"):
                host = (msg.get("host") or self.groot_host).strip() or "127.0.0.1"
                try:
                    port = int(msg.get("port") or self.groot_port)
                except Exception:
                    port = self.groot_port
                if self.groot2_bridge:
                    self.groot2_bridge.update_target(host, port)
                    if self.groot2_bridge.cached_tree:
                        self.broadcast_data(self.groot2_bridge.cached_tree)

            elif source == "btick":
                if self.btick_bridge:
                    for t in self.btick_bridge.trees.values():
                        self.broadcast_data(t)

            elif source == "nav2":
                topic = msg.get("topic")
                if self.nav2_bridge:
                    if topic:
                        self.nav2_bridge.update_topic(topic)
                    for t in self.nav2_bridge.trees.values():
                        self.broadcast_data(t)

        # 3. Full Trees Request from Web UI on Connect
        elif msg_type == "get_trees":
            req_source = msg.get("source")
            if (not req_source or req_source in ("btick", "all")) and self.btick_bridge:
                for t in self.btick_bridge.trees.values():
                    t_copy = dict(t)
                    t_copy["source"] = "btick"
                    t_copy["protocol"] = "btick"
                    self.broadcast_data(t_copy)
            if (
                (not req_source or req_source in ("groot2", "groot", "all"))
                and self.groot2_bridge
                and self.groot2_bridge.cached_tree
            ):
                t_copy = dict(self.groot2_bridge.cached_tree)
                t_copy["source"] = "groot2"
                t_copy["protocol"] = "groot2"
                self.broadcast_data(t_copy)
            if (not req_source or req_source in ("nav2", "all")) and self.nav2_bridge:
                for t in self.nav2_bridge.trees.values():
                    t_copy = dict(t)
                    t_copy["source"] = "nav2"
                    t_copy["protocol"] = "nav2"
                    self.broadcast_data(t_copy)

        # 4. Client Tree Registration (e.g. Nav2 loaded XML tree)
        elif msg_type in ("load_tree", "register_tree"):
            tree_data = msg.get("tree") or msg.get("data") or msg
            if isinstance(tree_data, dict):
                tree_id = tree_data.get("tree_id") or "Nav2Navigation"
                target_source = (
                    msg.get("source")
                    or tree_data.get("source")
                    or tree_data.get("protocol")
                    or self.current_source
                )
                tree_data["source"] = target_source
                tree_data["protocol"] = target_source
                if target_source == "nav2" and self.nav2_bridge:
                    self.nav2_bridge.trees[tree_id] = tree_data
                elif target_source in ("groot2", "groot") and self.groot2_bridge:
                    self.groot2_bridge.cached_tree = tree_data
                elif self.btick_bridge:
                    self.btick_bridge.trees[tree_id] = tree_data
                self._log_runtime_event(
                    target_source, {**tree_data, "type": "tree_created"}
                )

        # 5. Explicit Disconnect Request from Web UI
        elif msg_type in ("disconnect", "disconnect_source"):
            target_source = msg.get("source", self.current_source)
            keys = [key for key in self.connected_tree_keys if key[0] == target_source]
            for key in keys:
                self.connected_tree_keys.remove(key)
                connected_tree_name = self.connected_tree_names.pop(key, None)
                tree = self._tree_for_key(target_source, key[1])
                self._emit_user_log(
                    {
                        "protocol": target_source,
                        "action": "Disconnected",
                        "treeName": (tree or {}).get("tree_name")
                        or connected_tree_name
                        or key[1],
                    }
                )
            self.broadcast_data(
                {"type": "status", "source": target_source, "status": "DISCONNECTED"}
            )

    def stop(self):
        if self.btick_bridge:
            self.btick_bridge.stop()
        if self.groot2_bridge:
            self.groot2_bridge.stop()
        if self.nav2_bridge:
            self.nav2_bridge.stop()
        self.ws_server.stop()


def str2bool(v):
    if isinstance(v, bool):
        return v
    if str(v).lower() in ("yes", "true", "t", "y", "1"):
        return True
    elif str(v).lower() in ("no", "false", "f", "n", "0"):
        return False
    raise argparse.ArgumentTypeError("Boolean value expected (true/false).")


def main():
    default_ws_port = int(os.environ.get("WS_PORT", 8080))
    default_http_port = int(os.environ.get("HTTP_PORT", 3000))
    default_zmq_port = int(
        os.environ.get("ZMQ_PORT", os.environ.get("GROOT_PORT", 1667))
    )
    default_zmq_host = os.environ.get(
        "ZMQ_HOST", os.environ.get("GROOT_HOST", "127.0.0.1")
    )
    default_open_browser = str2bool(os.environ.get("OPEN_BROWSER", "false"))

    parser = argparse.ArgumentParser(
        description="BTick Unified Multi-Protocol Bridge Server"
    )
    parser.add_argument(
        "--ws-port",
        type=int,
        default=default_ws_port,
        help=f"WebSocket port (default: {default_ws_port})",
    )
    parser.add_argument(
        "--http-port",
        type=int,
        default=default_http_port,
        help=f"HTTP SPA Web port (default: {default_http_port})",
    )
    parser.add_argument(
        "--dist-dir", type=str, default="", help="Path to built web app dist folder"
    )
    parser.add_argument(
        "--zmq-host",
        "--groot-host",
        dest="zmq_host",
        type=str,
        default=default_zmq_host,
        help=f"ZMQ / Groot2 host (default: {default_zmq_host})",
    )
    parser.add_argument(
        "--zmq-port",
        "--groot-port",
        dest="zmq_port",
        type=int,
        default=default_zmq_port,
        help=f"ZMQ / Groot2 port (default: {default_zmq_port})",
    )
    parser.add_argument(
        "--open-browser",
        type=str2bool,
        nargs="?",
        const=True,
        default=default_open_browser,
        help=f"Automatically open browser at http://localhost:<HTTP_PORT> (default: {default_open_browser})",
    )
    parser.add_argument(
        "--protocol",
        choices=["all", "btick", "groot", "nav2"],
        default="all",
        help="Target protocol mode (default: all)",
    )
    parser.add_argument(
        "--no-ros", action="store_true", help="Disable ROS 2 DDS listeners"
    )
    parser.add_argument(
        "--no-groot", action="store_true", help="Disable Groot2 ZMQ client"
    )
    parser.add_argument(
        "--no-nav2", action="store_true", help="Disable Nav2 BehaviorTreeLog listeners"
    )
    args = parser.parse_args()

    enable_ros = not args.no_ros
    enable_groot = not args.no_groot
    enable_nav2 = not args.no_nav2

    if args.protocol == "btick":
        enable_ros, enable_groot, enable_nav2 = True, False, False
    elif args.protocol == "groot":
        enable_ros, enable_groot, enable_nav2 = False, True, False
    elif args.protocol == "nav2":
        enable_ros, enable_groot, enable_nav2 = False, False, True

    # Find dist directory
    dist_dir = args.dist_dir
    if not dist_dir:
        candidate = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist"
        )
        if os.path.exists(candidate):
            dist_dir = candidate

    print(
        r""" ____ _____ _      _
| __ )_   _(_) ___| | __
|  _ \ | | | |/ __| |/ /
| |_) || | | | (__|   <
|____/ |_| |_|\___|_|\_\
                        """
    )
    print("=" * 66)
    print(" 🌲 BTICK UNIFIED MULTI-PROTOCOL BRIDGE SERVER")
    print("=" * 66)
    print(f" • WebSocket Broadcast : ws://0.0.0.0:{args.ws_port}")
    if args.http_port > 0 and dist_dir:
        print(f" • Web App Browser URL : http://0.0.0.0:{args.http_port}")
        print(f" • Static Assets Path  : {dist_dir}")
        if args.open_browser:
            print(
                f" • Auto Open Browser   : Enabled (http://localhost:{args.http_port})"
            )
    if enable_groot:
        print(f" • Groot2/ZMQ Target   : tcp://{args.zmq_host}:{args.zmq_port}")
    if enable_ros:
        print(" • ROS 2 BTick         : /btick/tree_discovery, /btick/tree_transitions")
    if enable_nav2:
        print(" • Nav2 Behavior Tree  : /behavior_tree_log")
    print("=" * 66)

    server = UnifiedBTBridgeServer(
        ws_port=args.ws_port,
        http_port=args.http_port,
        dist_dir=dist_dir,
        groot_host=args.zmq_host,
        groot_port=args.zmq_port,
        enable_ros=enable_ros,
        enable_groot=enable_groot,
        enable_nav2=enable_nav2,
        open_browser=args.open_browser,
    )
    server.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[Unified Bridge] Shutting down...")
        server.stop()


if __name__ == "__main__":
    main()
