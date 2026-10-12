#!/usr/bin/env python3
"""
Nav2 Dedicated Behavior Tree Log ROS 2 Bridge
---------------------------------------------
Handles:
1. Subscribing to /behavior_tree_log (nav2_msgs.msg.BehaviorTreeLog)
2. Subscribing to /behavior_tree_status_change and /bt_status_change
3. Matching Nav2 log events with BehaviorTree XML structure
4. Emitting standardized transition and tree status events for the web app
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
HAVE_NAV2_MSGS = False
try:
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import (
        QoSProfile,
        ReliabilityPolicy,
        HistoryPolicy,
        qos_profile_action_status_default,
    )

    HAVE_RCLPY = True
    try:
        from nav2_msgs.msg import BehaviorTreeLog, BehaviorTreeStatusChange

        HAVE_NAV2_MSGS = True
    except ImportError:
        pass
    try:
        from action_msgs.msg import GoalStatusArray

        HAVE_ACTION_MSGS = True
    except ImportError:
        HAVE_ACTION_MSGS = False
except ImportError:
    HAVE_ACTION_MSGS = False

try:
    from common import StandaloneWebSocketServer, SPAHTTPHandler
except ImportError:
    from .common import StandaloneWebSocketServer, SPAHTTPHandler


def normalize_nav2_status(raw_status):
    if raw_status is None:
        return "IDLE"
    s = str(raw_status).strip().upper()
    if s in ("1", "IDLE"):
        return "IDLE"
    if s in ("2", "RUNNING"):
        return "RUNNING"
    if s in ("3", "SUCCESS"):
        return "SUCCESS"
    if s in ("4", "FAILURE"):
        return "FAILURE"
    if s in ("5", "SKIPPED", "HALTED"):
        return "IDLE"
    return s if s in ("IDLE", "RUNNING", "SUCCESS", "FAILURE", "SKIPPED") else "IDLE"


class Nav2ROS2Bridge:
    """
    Dedicated Nav2 Behavior Tree ROS 2 Bridge.
    Listens for /behavior_tree_log and status changes emitted by Nav2 NavigateToPose BT navigator.
    """

    def __init__(
        self,
        on_event_callback=None,
        topic="/behavior_tree_log",
        activity_timeout: float = 2.0,
    ):
        self.on_event_callback = on_event_callback
        self.log_topic = (topic or "/behavior_tree_log").strip()
        if not self.log_topic.startswith("/"):
            self.log_topic = "/" + self.log_topic
        self.activity_timeout = float(activity_timeout)
        self.node = None
        self.sub_log = None
        self.trees = {}  # tree_id -> tree_data
        self.running = False
        self.thread = None
        self.liveness_thread = None
        self.active_goal_id = None
        self.completed_goal_ids = set()
        self.last_heartbeat_time = 0.0
        self.last_log_message_time = 0.0
        self.current_execution_instance_id = None
        self.is_currently_alive = False
        self.current_cycle_id = None
        self.cycle_count = 0

    def start_new_execution_cycle(self, cycle_id: str, tree_id: str = "Nav2Navigation"):
        self.current_cycle_id = cycle_id
        self.cycle_count += 1
        for tid, tdata in self.trees.items():
            tdata["current_cycle_id"] = cycle_id
            tdata["cycle_count"] = self.cycle_count

    def update_topic(self, new_topic: str):
        if not new_topic:
            return
        topic = str(new_topic).strip()
        if not topic.startswith("/"):
            topic = "/" + topic
        if topic == self.log_topic and self.sub_log is not None:
            return
        self.log_topic = topic
        print(f"[NAV2] Log subscription topic updated: '{self.log_topic}'")
        if self.node and HAVE_RCLPY and rclpy.ok():
            try:
                if self.sub_log:
                    self.node.destroy_subscription(self.sub_log)
                    self.sub_log = None
                qos_transitions = QoSProfile(
                    history=HistoryPolicy.KEEP_LAST,
                    depth=100,
                    reliability=ReliabilityPolicy.RELIABLE,
                )
                if HAVE_NAV2_MSGS:
                    self.sub_log = self.node.create_subscription(
                        BehaviorTreeLog,
                        self.log_topic,
                        self._nav2_log_cb,
                        qos_transitions,
                    )
                else:
                    raise RuntimeError(
                        "nav2_msgs/msg/BehaviorTreeLog is required for /behavior_tree_log"
                    )
                print(f"[NAV2] Subscribed to topic: '{self.log_topic}'")
            except Exception as e:
                print(
                    f"[NAV2] Error updating topic subscription to '{self.log_topic}': {e}",
                    file=sys.stderr,
                )

    def send_command(self, cmd: dict) -> bool:
        """Reject execution commands explicitly: Nav2's standard log APIs are passive."""
        action = (cmd or {}).get("action", "unknown")
        print(
            f"[NAV2] Cannot execute '{action}': no BT command transport.",
            file=sys.stderr,
        )
        return False

    def start(self):
        if not HAVE_RCLPY:
            print(
                "[NAV2] rclpy is not installed; ROS 2 DDS listener disabled.",
                file=sys.stderr,
            )
            return

        self.running = True
        self.thread = threading.Thread(target=self._nav2_loop, daemon=True)
        self.thread.start()

        self.liveness_thread = threading.Thread(
            target=self._liveness_worker, daemon=True
        )
        self.liveness_thread.start()

    def _liveness_worker(self):
        """
        Monitors Nav2 navigation liveness and emits protocol heartbeats.
        Strictly determined from the existence and activity of the Nav2 BT log topic (/behavior_tree_log):
        1. Topic does not exist (no publisher) -> DISCONNECTED
        2. Topic exists but no data currently received -> CONNECTED_IDLE
        3. Topic exists and data is being received -> CONNECTED_RUNNING
        """
        while self.running:
            try:
                time.sleep(0.5)
                now = time.time()

                pub_count = 0
                if self.node and HAVE_RCLPY and rclpy.ok():
                    try:
                        if hasattr(self.node, "get_publishers_info_by_topic"):
                            pubs = self.node.get_publishers_info_by_topic(
                                self.log_topic
                            )
                            # Filter out bridge self node and non-Nav2 nodes
                            filtered_pubs = [
                                p
                                for p in pubs
                                if p.node_name != self.node.get_name()
                                and not p.node_name.startswith("btick")
                                and not p.node_name.startswith("rtick")
                                and not p.node_name.startswith("bt_monitor")
                                and not p.node_name.startswith("bt_bridge")
                                and "bt_runner" not in p.node_name
                            ]
                            pub_count = len(filtered_pubs)
                        else:
                            pub_count = self.node.count_publishers(self.log_topic)
                    except Exception:
                        pass

                topic_exists = pub_count > 0

                # State 1: Topic does not exist -> DISCONNECTED
                if not topic_exists:
                    conn_status = "DISCONNECTED"
                    if self.is_currently_alive:
                        self.is_currently_alive = False
                        for t in self.trees.values():
                            t["status"] = "IDLE"
                        if self.on_event_callback:
                            for t in self.trees.values():
                                self.on_event_callback(
                                    {
                                        "type": "tree_status",
                                        "source": "nav2",
                                        "protocol": "nav2",
                                        "tree_id": t.get("tree_id"),
                                        "status": "IDLE",
                                        "nodes": t.get("nodes", []),
                                    }
                                )
                else:
                    self.is_currently_alive = True
                    # States 2 & 3: Topic exists -> check if recent /behavior_tree_log messages exist
                    has_recent_data = (
                        self.last_log_message_time > 0
                        and (now - self.last_log_message_time) < self.activity_timeout
                    )
                    if has_recent_data:
                        conn_status = "CONNECTED_RUNNING"
                    else:
                        conn_status = "CONNECTED_IDLE"

                if self.on_event_callback:
                    self.on_event_callback(
                        {
                            "type": "protocol_heartbeat",
                            "source": "nav2",
                            "protocol": "nav2",
                            "status": conn_status,
                            "execution_instance_id": self.current_execution_instance_id,
                            "timestamp": now,
                        }
                    )
            except Exception:
                pass

    def _nav2_loop(self):
        try:
            if not rclpy.ok():
                rclpy.init(args=None)
            self.node = Node("nav2_bt_bridge_subscriber")

            qos_transitions = QoSProfile(
                history=HistoryPolicy.KEEP_LAST,
                depth=100,
                reliability=ReliabilityPolicy.RELIABLE,
            )

            if not HAVE_NAV2_MSGS:
                raise RuntimeError(
                    "nav2_msgs/msg/BehaviorTreeLog is required for /behavior_tree_log"
                )
            self.sub_log = self.node.create_subscription(
                BehaviorTreeLog, self.log_topic, self._nav2_log_cb, qos_transitions
            )

            # Nav2 Action Status Listeners (Detect Goal Succeeded, Aborted, Canceled)
            if HAVE_ACTION_MSGS:
                qos_action = (
                    qos_profile_action_status_default
                    if "qos_profile_action_status_default" in globals()
                    else qos_transitions
                )
                for action_status_topic in (
                    "/navigate_to_pose/_action/status",
                    "/navigate_through_poses/_action/status",
                    "/follow_path/_action/status",
                ):
                    try:
                        self.node.create_subscription(
                            GoalStatusArray,
                            action_status_topic,
                            self._nav2_action_status_cb,
                            qos_action,
                        )
                    except Exception:
                        pass

            print(f"[NAV2] ROS 2 listeners active ({self.log_topic})")

            executor = rclpy.executors.SingleThreadedExecutor()
            executor.add_node(self.node)

            while self.running and rclpy.ok():
                executor.spin_once(timeout_sec=0.005)

        except rclpy.executors.ExternalShutdownException:
            pass
        finally:
            if HAVE_RCLPY and rclpy.ok():
                try:
                    rclpy.shutdown()
                except Exception:
                    pass

    def find_tree_for_node(
        self, node_name: str, uid: int = 0, default_tree_id: str = "Nav2Navigation"
    ) -> tuple:
        """Finds which loaded Behavior Tree contains a node with the given name, UID, or type."""
        if not self.trees:
            return default_tree_id, default_tree_id

        # If exactly one tree is loaded, default to it
        if len(self.trees) == 1:
            first_id = next(iter(self.trees))
            return first_id, self.trees[first_id].get("tree_name", first_id)

        for tid, tdata in self.trees.items():
            for n in tdata.get("nodes", []):
                if uid > 0 and n.get("uid") == uid:
                    return tid, tdata.get("tree_name", tid)
                if (
                    n.get("name") == node_name
                    or n.get("type") == node_name
                    or n.get("id", "").startswith(node_name)
                ):
                    return tid, tdata.get("tree_name", tid)

        first_id = next(iter(self.trees))
        return first_id, self.trees[first_id].get("tree_name", first_id)

    def _nav2_log_cb(self, msg):
        """Processes standard Nav2 behavior tree log messages and matches with loaded XML tree."""
        try:
            if not self.is_currently_alive:
                return
            now_time = time.time()
            self.last_log_message_time = now_time
            self.last_heartbeat_time = now_time
            if not self.current_execution_instance_id:
                self.current_execution_instance_id = (
                    f"nav2_inst_{int(self.last_heartbeat_time * 1000)}"
                )
            event_list = getattr(msg, "event_log", [])
            if not event_list:
                return

            for event in event_list:
                node_name = str(getattr(event, "node_name", "Node"))
                raw_uid = getattr(event, "uid", 0)
                uid = int(raw_uid) if raw_uid is not None else 0
                status_str = normalize_nav2_status(
                    getattr(event, "current_status", "IDLE")
                )
                prev_status_str = normalize_nav2_status(
                    getattr(event, "previous_status", "IDLE")
                )

                tree_id, tree_name = self.find_tree_for_node(
                    node_name, uid=uid, default_tree_id="Nav2Navigation"
                )

                matched_node_id = f"{node_name}_{uid}" if uid > 0 else node_name
                matched_uid = uid
                if tree_id in self.trees:
                    for n in self.trees[tree_id].get("nodes", []):
                        if (
                            (uid > 0 and n.get("uid") == uid)
                            or n.get("name") == node_name
                            or n.get("type") == node_name
                            or n.get("id", "").startswith(node_name)
                        ):
                            matched_node_id = n.get("id", matched_node_id)
                            if matched_uid == 0 and "uid" in n:
                                matched_uid = int(n["uid"])
                            break

                ts = getattr(event, "timestamp", None)
                ts_sec = getattr(ts, "sec", 0) if ts else 0
                ts_nanosec = getattr(ts, "nanosec", 0) if ts else 0
                event_time = (ts_sec + ts_nanosec * 1e-9) if ts_sec > 0 else time.time()

                trans = {
                    "type": "transition",
                    "source": "nav2",
                    "protocol": "nav2",
                    "cycle_id": self.current_cycle_id,
                    "tree_id": tree_id,
                    "tree_name": tree_name,
                    "node_id": matched_node_id,
                    "node_name": node_name,
                    "uid": matched_uid,
                    "prev_status": prev_status_str,
                    "status": status_str,
                    "duration": 0.0,
                    "tick_count": 1,
                    "timestamp": event_time,
                }
                if self.on_event_callback:
                    self.on_event_callback(trans)
        except Exception:
            pass

    def _nav2_status_change_cb(self, msg):
        """Processes individual nav2_msgs.msg.BehaviorTreeStatusChange messages."""
        try:
            node_name = str(getattr(msg, "node_name", "Node"))
            raw_uid = getattr(msg, "uid", 0)
            uid = int(raw_uid) if raw_uid is not None else 0
            prev_status = normalize_nav2_status(getattr(msg, "previous_status", "IDLE"))
            status = normalize_nav2_status(getattr(msg, "current_status", "IDLE"))

            tree_id, tree_name = self.find_tree_for_node(
                node_name, uid=uid, default_tree_id="Nav2Navigation"
            )

            matched_node_id = f"{node_name}_{uid}" if uid > 0 else node_name
            matched_uid = uid
            if tree_id in self.trees:
                for n in self.trees[tree_id].get("nodes", []):
                    if (
                        (uid > 0 and n.get("uid") == uid)
                        or n.get("name") == node_name
                        or n.get("type") == node_name
                        or n.get("id", "").startswith(node_name)
                    ):
                        matched_node_id = n.get("id", matched_node_id)
                        if matched_uid == 0 and "uid" in n:
                            matched_uid = int(n["uid"])
                        break

            ts = getattr(msg, "timestamp", None)
            ts_sec = getattr(ts, "sec", 0) if ts else 0
            ts_nanosec = getattr(ts, "nanosec", 0) if ts else 0
            event_time = (ts_sec + ts_nanosec * 1e-9) if ts_sec > 0 else time.time()

            trans = {
                "type": "transition",
                "source": "nav2",
                "protocol": "nav2",
                "cycle_id": self.current_cycle_id,
                "tree_id": tree_id,
                "tree_name": tree_name,
                "node_id": matched_node_id,
                "node_name": node_name,
                "uid": matched_uid,
                "prev_status": prev_status,
                "status": status,
                "duration": 0.0,
                "tick_count": 1,
                "timestamp": event_time,
            }
            if self.on_event_callback:
                self.on_event_callback(trans)
        except Exception:
            pass

    def _nav2_action_status_cb(self, msg):
        """
        Monitors Nav2 ROS 2 Action Server status lifecycle as the authoritative finalization signal.
        Separates live BT transitions (/behavior_tree_log) from action lifecycle finalization.
        """
        try:
            status_list = getattr(msg, "status_list", [])
            if not status_list:
                return

            for item in status_list:
                st = getattr(item, "status", None)
                if st is None:
                    continue

                goal_info = getattr(item, "goal_info", None)
                goal_id = getattr(goal_info, "goal_id", None)
                raw_uuid = getattr(goal_id, "uuid", None)
                uuid_hex = bytes(raw_uuid).hex() if raw_uuid is not None else None

                # STATUS_ACCEPTED (1) or STATUS_EXECUTING (2):
                # Mark as active goal. Trigger new execution cycle if new goal UUID detected.
                if st in (1, 2):
                    if uuid_hex and uuid_hex not in self.completed_goal_ids:
                        if self.current_cycle_id != uuid_hex:
                            self.start_new_execution_cycle(uuid_hex)
                        self.active_goal_id = uuid_hex
                    continue

                # Finalization: STATUS_SUCCEEDED (4), STATUS_CANCELED (5), STATUS_ABORTED (6)
                if st in (4, 5, 6):
                    # Prevent stale TRANSIENT_LOCAL replay from finalizing previous completed goals
                    if uuid_hex:
                        if uuid_hex in self.completed_goal_ids:
                            continue
                        if self.active_goal_id and self.active_goal_id != uuid_hex:
                            continue
                        self.completed_goal_ids.add(uuid_hex)
                        if self.active_goal_id == uuid_hex:
                            self.active_goal_id = None

                    # Navigation action completion is not a behavior-tree
                    # transition. The actual Nav2 behavior-tree topics remain
                    # the sole source of node status updates.
        except Exception:
            pass

    def stop(self):
        self.running = False
        if self.node and HAVE_RCLPY and rclpy.ok():
            try:
                if self.sub_log:
                    self.node.destroy_subscription(self.sub_log)
                    self.sub_log = None
            except Exception:
                pass


# ==============================================================================
# Standalone Server Execution Mode
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Nav2 Dedicated BehaviorTreeLog ROS 2 Bridge Server"
    )
    parser.add_argument(
        "--ws-port", type=int, default=8080, help="WebSocket port (default: 8080)"
    )
    parser.add_argument(
        "--http-port", type=int, default=3000, help="HTTP SPA Web port (default: 3000)"
    )
    parser.add_argument(
        "--dist-dir", type=str, default="", help="Path to built web app dist folder"
    )
    parser.add_argument(
        "--topic",
        type=str,
        default="/behavior_tree_log",
        help="Nav2 BehaviorTreeLog topic (default: /behavior_tree_log)",
    )
    args = parser.parse_args()

    dist_dir = args.dist_dir
    if not dist_dir:
        candidate = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist"
        )
        if os.path.exists(candidate):
            dist_dir = candidate

    print("=" * 66)
    print(" 🌲 NAV2 DEDICATED BEHAVIOR TREE LOG ROS 2 BRIDGE")
    print("=" * 66)
    print(f" • WebSocket Broadcast : ws://0.0.0.0:{args.ws_port}")
    if args.http_port > 0 and dist_dir:
        print(f" • Web App Browser URL : http://localhost:{args.http_port}")
        print(f" • Static Assets Path  : {dist_dir}")
    print(f" • Nav2 Topic Log      : {args.topic}")
    print(" • Nav2 Status Change  : /behavior_tree_status_change")
    print("=" * 66)

    bridge_server = None

    def handle_client_message(msg_str: str):
        try:
            msg = json.loads(msg_str)
            msg_type = msg.get("type")
            if msg_type == "get_trees":
                for t in bridge_server.trees.values():
                    ws_server.broadcast(json.dumps(t))
            elif msg_type == "switch_source" and msg.get("topic"):
                bridge_server.update_topic(msg.get("topic"))
            elif msg_type in ("load_tree", "register_tree", "command", "send_command"):
                cmd = msg.get("data") if isinstance(msg.get("data"), dict) else msg
                action = cmd.get("action") or msg_type
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
                        tree_data["source"] = "nav2"
                        tree_data["protocol"] = "nav2"
                        bridge_server.trees[t_id] = tree_data
                        ws_server.broadcast(
                            json.dumps(
                                {
                                    "type": "tree_created",
                                    "data": tree_data,
                                    "source": "nav2",
                                    "protocol": "nav2",
                                }
                            )
                        )
        except Exception:
            pass

    ws_server = StandaloneWebSocketServer(
        host="0.0.0.0", port=args.ws_port, on_client_message=handle_client_message
    )
    ws_server.start()

    bridge_server = Nav2ROS2Bridge(
        on_event_callback=lambda event: ws_server.broadcast(json.dumps(event)),
        topic=args.topic,
    )
    bridge_server.start()

    if args.http_port > 0 and dist_dir and os.path.exists(dist_dir):
        from http.server import ThreadingHTTPServer

        handler = lambda *a, **kw: SPAHTTPHandler(
            *a,
            directory=dist_dir,
            status_provider=lambda: {
                "source": "nav2",
                "trees": list(bridge_server.trees.keys()),
            },
            **kw,
        )
        httpd = ThreadingHTTPServer(("0.0.0.0", args.http_port), handler)
        http_t = threading.Thread(target=httpd.serve_forever, daemon=True)
        http_t.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[Nav2 Bridge] Shutting down...")
        bridge_server.stop()
        ws_server.stop()


if __name__ == "__main__":
    main()
