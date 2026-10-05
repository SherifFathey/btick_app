#!/usr/bin/env python3
"""
BTick Dedicated ROS 2 DDS Bridge
--------------------------------
Handles:
1. Subscribing to /btick/tree_discovery (TRANSIENT_LOCAL QoS)
2. Subscribing to /btick/tree_transitions (RELIABLE QoS)
3. Publishing commands to /btick/command_in (RELIABLE QoS)
4. Subscribing to command responses on /btick/command_out (RELIABLE QoS)
5. Standalone CLI execution or import into unified bridge
"""

import os
import sys
import json
import time
import threading
import argparse

# Optional ROS 2 Imports
HAVE_RCLPY = False
try:
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy, HistoryPolicy
    from std_msgs.msg import String
    HAVE_RCLPY = True
except ImportError:
    String = object
    pass

try:
    from common import StandaloneWebSocketServer, SPAHTTPHandler
except ImportError:
    from .common import StandaloneWebSocketServer, SPAHTTPHandler


class BTickROS2Bridge:
    """
    Dedicated ROS 2 Bridge for BTick C++ Engine.
    Emits standardized JSON events, protocol heartbeats, and receives interactive debugger commands.
    """
    def __init__(self, on_event_callback=None):
        self.on_event_callback = on_event_callback
        self.node = None
        self.cmd_pub = None
        self.trees = {}  # tree_id -> tree_data
        self.running = False
        self.thread = None
        self.liveness_thread = None
        self.last_heartbeat_time = 0.0
        self.current_execution_instance_id = None
        self.is_currently_alive = False
        self.current_cycle_id = f"btick_cycle_{int(time.time() * 1000)}"
        self.cycle_count = 0

    def start(self):
        if not HAVE_RCLPY:
            print("[BTick] ROS2: rclpy is not installed; ROS 2 DDS listener disabled.", file=sys.stderr)
            return

        self.running = True
        self.thread = threading.Thread(target=self._ros2_loop, daemon=True)
        self.thread.start()

        self.liveness_thread = threading.Thread(target=self._liveness_worker, daemon=True)
        self.liveness_thread.start()

    def _liveness_worker(self):
        """Monitors BTick C++ tree liveness and broadcasts periodic protocol heartbeats."""
        prev_pub_count = 0
        while self.running:
            try:
                time.sleep(0.5)
                now = time.time()

                pub_count = 0
                if self.node and HAVE_RCLPY and rclpy.ok():
                    try:
                        pub_count = (
                            self.node.count_publishers('/btick/tree_discovery') +
                            self.node.count_publishers('/btick/tree_transitions')
                        )
                    except Exception:
                        pass

                # If a new ROS 2 publisher appeared, immediately ask for tree schema
                if prev_pub_count == 0 and pub_count > 0:
                    self.send_command({'action': 'get_tree', 'source': 'btick'})
                prev_pub_count = pub_count

                has_recent_activity = (self.last_heartbeat_time > 0 and (now - self.last_heartbeat_time) < 1.5)
                alive = (pub_count > 0) or has_recent_activity

                if alive:
                    has_running = False
                    for t in self.trees.values():
                        for n in t.get('nodes', []):
                            if n.get('status') in ('RUNNING', 'PAUSED_AT_BREAKPOINT'):
                                has_running = True
                                break
                    conn_status = 'CONNECTED_RUNNING' if has_running else 'CONNECTED_IDLE'
                    self.is_currently_alive = True
                else:
                    conn_status = 'DISCONNECTED'
                    if self.is_currently_alive:
                        self.is_currently_alive = False
                        # Clean up active trees upon disconnect
                        for t_id in list(self.trees.keys()):
                            if self.on_event_callback:
                                self.on_event_callback({
                                    'type': 'tree_destroyed',
                                    'source': 'btick',
                                    'protocol': 'btick',
                                    'tree_id': t_id,
                                    'status': 'DESTROYED'
                                })
                        self.trees.clear()

                if self.on_event_callback:
                    self.on_event_callback({
                        'type': 'protocol_heartbeat',
                        'protocol': 'btick',
                        'status': conn_status,
                        'execution_instance_id': self.current_execution_instance_id,
                        'timestamp': now
                    })
            except Exception:
                pass

    def _ros2_loop(self):
        try:
            if not rclpy.ok():
                rclpy.init(args=None)
            self.node = Node('btick_bridge_subscriber')

            # Transient Local QoS matches C++ publisher for Tree Discovery
            qos_discovery = QoSProfile(
                history=HistoryPolicy.KEEP_LAST,
                depth=20,
                durability=DurabilityPolicy.TRANSIENT_LOCAL,
                reliability=ReliabilityPolicy.RELIABLE
            )

            # Reliable QoS for high-speed transition events
            qos_transitions = QoSProfile(
                history=HistoryPolicy.KEEP_LAST,
                depth=100,
                reliability=ReliabilityPolicy.RELIABLE
            )

            self.node.create_subscription(
                String,
                '/btick/tree_discovery',
                self._discovery_cb,
                qos_discovery
            )

            self.node.create_subscription(
                String,
                '/btick/tree_transitions',
                self._transition_cb,
                qos_transitions
            )

            self.node.create_subscription(
                String,
                '/btick/command_out',
                self._command_out_cb,
                qos_transitions
            )

            self.cmd_pub = self.node.create_publisher(String, '/btick/command_in', 20)
            print("[BTick] ROS2 DDS listeners active (/btick/tree_discovery, /btick/tree_transitions, /btick/command_out)")

            # Proactively request tree schema on startup
            self.send_command({'action': 'get_tree', 'source': 'btick'})

            executor = rclpy.executors.SingleThreadedExecutor()
            executor.add_node(self.node)

            while self.running and rclpy.ok():
                executor.spin_once(timeout_sec=0.002)

        except Exception as e:
            print(f"[BTick] Exception in ROS 2 loop: {e}", file=sys.stderr)
        finally:
            if HAVE_RCLPY and rclpy.ok():
                try:
                    rclpy.shutdown()
                except Exception:
                    pass

    def _discovery_cb(self, msg: String):
        try:
            raw = msg.data.strip()
            if raw:
                data = json.loads(raw)
                if data.get('type') in ('error', 'initialization_error', 'connection_error'):
                    data['source'] = 'btick'
                    data['protocol'] = 'btick'
                    if self.on_event_callback:
                        self.on_event_callback(data)
                    return
                now = time.time()
                tree_id = data.get('tree_id') or data.get('tree_name', 'MainTree')
                tree_name = data.get('tree_name') or tree_id
                nodes_count = len(data.get('nodes', []))

                is_new_session = (not self.is_currently_alive) or (self.current_execution_instance_id is None) or (tree_id not in self.trees)
                if is_new_session:
                    self.current_execution_instance_id = f"btick_inst_{int(now * 1000)}"
                    data['is_restart'] = True
                    data['reconnected'] = True

                self.last_heartbeat_time = now
                self.is_currently_alive = True

                data['source'] = 'btick'
                data['protocol'] = 'btick'
                data['execution_instance_id'] = self.current_execution_instance_id
                data['session_id'] = f"btick_{tree_id}_{self.current_execution_instance_id}"
                self.trees[tree_id] = data

                if self.on_event_callback:
                    self.on_event_callback(data)
        except Exception:
            pass

    def _transition_cb(self, msg: String):
        try:
            raw = msg.data.strip()
            if raw:
                data = json.loads(raw)
                now = time.time()
                self.last_heartbeat_time = now
                self.is_currently_alive = True
                data['source'] = 'btick'
                data['protocol'] = 'btick'
                data['execution_instance_id'] = self.current_execution_instance_id

                # If transitions arrive for an unknown tree, proactively query C++ Monitor node
                tree_id = data.get('tree_id')
                if tree_id and tree_id not in self.trees:
                    now = time.time()
                    if now - getattr(self, '_last_tree_req', 0) > 0.15:
                        self._last_tree_req = now
                        self.send_command({'action': 'get_tree', 'tree_id': tree_id, 'source': 'btick'})

                # Maintain live node status in local cached trees
                uid = data.get('uid')
                node_id = data.get('node_id')
                status = data.get('status')
                if status and tree_id and tree_id in self.trees:
                    tree_data = self.trees[tree_id]
                    current_tree_status = tree_data.get('status')
                    root_node_id = tree_data.get('root_node_id')
                    is_root = (node_id == root_node_id or (uid is not None and uid == 1))

                    # Detect if a new execution cycle starts
                    if status == 'RUNNING' and (is_root or current_tree_status in ('SUCCESS', 'FAILURE')):
                        new_cycle_id = f"cycle_{int(now * 1000)}"
                        self.current_cycle_id = new_cycle_id
                        self.cycle_count += 1
                        for n in tree_data.get('nodes', []):
                            n['status'] = 'IDLE'
                        tree_data['status'] = 'RUNNING'
                        tree_data['current_cycle_id'] = new_cycle_id
                        tree_data['cycle_count'] = self.cycle_count
                        if self.on_event_callback:
                            self.on_event_callback({
                                'type': 'execution_cycle_started',
                                'source': 'btick',
                                'protocol': 'btick',
                                'tree_id': tree_id,
                                'cycle_id': new_cycle_id,
                                'timestamp': now
                            })

                    bb_updates = data.get('blackboard')
                    if isinstance(bb_updates, dict):
                        if 'blackboard' not in tree_data or not isinstance(tree_data['blackboard'], dict):
                            tree_data['blackboard'] = {}
                        tree_data['blackboard'].update(bb_updates)

                    output_ports = data.get('output_ports')
                    for n in tree_data.get('nodes', []):
                        if (uid is not None and uid > 0 and n.get('uid') == uid) or (node_id and n.get('id') == node_id):
                            if status == 'IDLE' and n.get('status') in ('SUCCESS', 'FAILURE'):
                                pass
                            else:
                                n['status'] = status

                            if 'output_ports_values' not in n or not isinstance(n['output_ports_values'], dict):
                                n['output_ports_values'] = {}

                            if isinstance(output_ports, list):
                                for op in output_ports:
                                    pname = op.get('port_name')
                                    pval = op.get('value')
                                    if pname and pval is not None:
                                        n['output_ports_values'][pname] = str(pval)
                            elif output_ports is None and status in ('SUCCESS', 'FAILURE') and isinstance(bb_updates, dict):
                                for pd in n.get('port_details', []):
                                    val = pd.get('value', '')
                                    if val.startswith('{') and val.endswith('}'):
                                        raw_k = val[1:-1]
                                        if raw_k in bb_updates:
                                            n['output_ports_values'][pd['name']] = str(bb_updates[raw_k])

                            for pd in n.get('port_details', []):
                                if pd.get('name') in n['output_ports_values']:
                                    pd['runtime_value'] = n['output_ports_values'][pd['name']]

                            break

                data['cycle_id'] = self.current_cycle_id

                if self.on_event_callback:
                    self.on_event_callback(data)
        except Exception:
            pass

    def _command_out_cb(self, msg: String):
        try:
            raw = msg.data.strip()
            if raw:
                data = json.loads(raw)
                data['source'] = 'btick'
                data['protocol'] = 'btick'
                if self.on_event_callback:
                    self.on_event_callback(data)
        except Exception as e:
            print(f"[BTick] Error parsing command response: {e}", file=sys.stderr)

    def send_command(self, cmd: dict):
        """Publishes a JSON debugger command to /btick/command_in."""
        if self.cmd_pub and HAVE_RCLPY and rclpy.ok():
            try:
                s = String()
                s.data = json.dumps(cmd)
                self.cmd_pub.publish(s)
            except Exception as e:
                print(f"[BTick] Error publishing command: {e}", file=sys.stderr)

    def stop(self):
        self.running = False


# ==============================================================================
# Standalone Server Execution Mode
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="BTick Dedicated ROS 2 DDS Bridge Server")
    parser.add_argument("--ws-port", type=int, default=8080, help="WebSocket port (default: 8080)")
    parser.add_argument("--http-port", type=int, default=3000, help="HTTP SPA Web port (default: 3000)")
    parser.add_argument("--dist-dir", type=str, default="", help="Path to built web app dist folder")
    args = parser.parse_args()

    # Find dist directory
    dist_dir = args.dist_dir
    if not dist_dir:
        candidate = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
        if os.path.exists(candidate):
            dist_dir = candidate

    print("=" * 66)
    print(" 🌲 BTICK DEDICATED ROS 2 DDS BRIDGE")
    print("=" * 66)
    print(f" • WebSocket Broadcast : ws://0.0.0.0:{args.ws_port}")
    if args.http_port > 0 and dist_dir:
        print(f" • Web App Browser URL : http://localhost:{args.http_port}")
        print(f" • Static Assets Path  : {dist_dir}")
    print(f" • ROS 2 Discovery     : /btick/tree_discovery")
    print(f" • ROS 2 Transitions   : /btick/tree_transitions")
    print(f" • ROS 2 Commands      : /btick/command_in")
    print("=" * 66)

    bridge_server = None

    def handle_client_connect(sock):
        if bridge_server:
            for t in bridge_server.trees.values():
                ws_server.send_to_sock(sock, json.dumps(t))
            bridge_server.send_command({'action': 'get_tree', 'source': 'btick'})

    def handle_client_message(msg_str: str):
        try:
            msg = json.loads(msg_str)
            msg_type = msg.get('type')
            if msg_type in ('command', 'send_command') and 'data' in msg:
                bridge_server.send_command(msg['data'])
            elif msg_type in ('get_trees', 'get_tree', 'discover', 'request_tree'):
                for t in bridge_server.trees.values():
                    ws_server.broadcast(json.dumps(t))
                bridge_server.send_command({'action': 'get_tree', 'source': 'btick'})
        except Exception:
            pass

    ws_server = StandaloneWebSocketServer(
        host="0.0.0.0", 
        port=args.ws_port, 
        on_client_message=handle_client_message,
        on_client_connect=handle_client_connect
    )
    ws_server.start()

    bridge_server = BTickROS2Bridge(on_event_callback=lambda event: ws_server.broadcast(json.dumps(event)))
    bridge_server.start()

    if args.http_port > 0 and dist_dir and os.path.exists(dist_dir):
        from http.server import ThreadingHTTPServer
        handler = lambda *a, **kw: SPAHTTPHandler(*a, directory=dist_dir, status_provider=lambda: {'source': 'btick', 'trees': list(bridge_server.trees.keys())}, **kw)
        httpd = ThreadingHTTPServer(("0.0.0.0", args.http_port), handler)
        http_t = threading.Thread(target=httpd.serve_forever, daemon=True)
        http_t.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[BTick ROS2] Shutting down...")
        bridge_server.stop()
        ws_server.stop()


if __name__ == '__main__':
    main()
