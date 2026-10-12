#!/usr/bin/env python3
import sys
import json
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy, HistoryPolicy
from std_msgs.msg import String


class BTROS2Bridge(Node):
    def __init__(self):
        super().__init__("btick_desktop_subscriber")

        # Transient Local QoS matches C++ publisher for Tree Discovery
        qos_discovery = QoSProfile(
            history=HistoryPolicy.KEEP_LAST,
            depth=20,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
            reliability=ReliabilityPolicy.RELIABLE,
        )

        # Reliable QoS for high-speed transition events
        qos_transitions = QoSProfile(
            history=HistoryPolicy.KEEP_LAST,
            depth=100,
            reliability=ReliabilityPolicy.RELIABLE,
        )

        self.create_subscription(
            String, "/btick/tree_discovery", self.discovery_callback, qos_discovery
        )

        self.create_subscription(
            String, "/btick/tree_transitions", self.transition_callback, qos_transitions
        )

        self.create_subscription(
            String, "/btick/command_out", self.command_out_callback, qos_transitions
        )

    def discovery_callback(self, msg: String):
        try:
            # Validate JSON and print clean single line to stdout
            raw = msg.data.strip()
            if raw:
                data = json.loads(raw)
                sys.stdout.write(json.dumps(data) + "\n")
                sys.stdout.flush()
        except Exception:
            pass

    def transition_callback(self, msg: String):
        try:
            raw = msg.data.strip()
            if raw:
                data = json.loads(raw)
                sys.stdout.write(json.dumps(data) + "\n")
                sys.stdout.flush()
        except Exception:
            pass

    def command_out_callback(self, msg: String):
        try:
            raw = msg.data.strip()
            if raw:
                data = json.loads(raw)
                data["source"] = "btick"
                data["protocol"] = "btick"
                sys.stdout.write(json.dumps(data) + "\n")
                sys.stdout.flush()
        except Exception:
            pass


def main():
    try:
        rclpy.init(args=None)
        bridge = BTROS2Bridge()
        rclpy.spin(bridge)
    except KeyboardInterrupt:
        pass
    except Exception:
        pass
    finally:
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
