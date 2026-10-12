#!/usr/bin/env python3
"""
Groot2 Dedicated ZMQ Protocol Bridge
------------------------------------
Handles:
1. Connecting to BehaviorTree.CPP Groot2 TCP Server on port 1667
2. Requesting and parsing FULLTREE XML ('T')
3. Polling live node status ('S') and scoped Blackboards ('B')
4. Listening for asynchronous BREAKPOINT_REACHED notifications ('N')
5. Executing interactive commands: set_breakpoint, clear_breakpoint, resume, force_success, force_failure, inject_fault
6. Standalone CLI execution or import into unified bridge
"""

import os
import sys
import json
import time
import struct
import threading
import argparse

# Optional PyZMQ for Groot2
HAVE_ZMQ = False
try:
    import zmq

    HAVE_ZMQ = True
except ImportError:
    pass

try:
    from common import (
        Groot2RequestType,
        serialize_groot2_header,
        decode_groot2_blackboard,
        flatten_blackboard_dict,
        parse_xml_to_bt_model,
        StandaloneWebSocketServer,
        SPAHTTPHandler,
    )
except ImportError:
    from .common import (
        Groot2RequestType,
        serialize_groot2_header,
        decode_groot2_blackboard,
        flatten_blackboard_dict,
        parse_xml_to_bt_model,
        StandaloneWebSocketServer,
        SPAHTTPHandler,
    )


def decode_groot2_status_byte(st_byte: int) -> str:
    """
    Decodes BehaviorTree.CPP Groot2 status byte.
    Values in Groot2Publisher:
      0: IDLE
      1: RUNNING
      2: SUCCESS
      3: FAILURE
      4: SKIPPED
      11: IDLE_FROM_RUNNING (10 + 1) -> now IDLE
      12: IDLE_FROM_SUCCESS (10 + 2) -> completed with SUCCESS
      13: IDLE_FROM_FAILURE (10 + 3) -> completed with FAILURE
      14: IDLE_FROM_SKIPPED (10 + 4) -> completed with SKIPPED
    """
    if st_byte == 12 or st_byte == 2:
        return "SUCCESS"
    elif st_byte == 13 or st_byte == 3:
        return "FAILURE"
    elif st_byte == 14 or st_byte == 4:
        return "SKIPPED"
    elif st_byte == 1:
        return "RUNNING"
    return "IDLE"


def decode_groot2_transitions(payload: bytes):
    """Decode Groot2's packed 9-byte timestamped transition records."""
    transitions = []
    for offset in range(0, len(payload) - 8, 9):
        timestamp_usec = int.from_bytes(payload[offset : offset + 6], "little")
        node_uid = struct.unpack_from("<H", payload, offset + 6)[0]
        transitions.append((timestamp_usec, node_uid, payload[offset + 8]))
    return transitions


class Groot2ZMQBridge:
    """
    Dedicated Groot2 ZMQ Protocol Client.
    Communicates directly with Groot2Publisher inside BehaviorTree.CPP.
    """

    def __init__(
        self, host: str = "127.0.0.1", port: int = 1667, on_event_callback=None
    ):
        self.host = (host or "127.0.0.1").strip() or "127.0.0.1"
        self.port = int(port or 1667)
        self.on_event_callback = on_event_callback
        self.running = False
        self.thread = None
        self.force_refresh = False

        self.cached_tree = None
        self.current_execution_instance_id = None
        self.current_cycle_id = f"groot_cycle_{int(time.time() * 1000)}"
        self.cycle_count = 0
        self.persistent_bp_uids = set()
        self.active_breakpoint_uids = set()
        self.active_fault_uids = set()
        self.paused_uid = 0
        self.last_unlocked_uid = 0
        self.last_unlocked_time = 0.0
        self.sock = None
        self.sub_sock = None
        self.zmq_context = zmq.Context()

    def start(self):
        if not HAVE_ZMQ:
            print(
                "[GROOT2] pyzmq is not installed; ZMQ client disabled.", file=sys.stderr
            )
            return

        self.running = True
        self.thread = threading.Thread(target=self._groot2_loop, daemon=True)
        self.thread.start()

    def update_target(self, host: str, port: int):
        self.host = (host or "127.0.0.1").strip() or "127.0.0.1"
        self.port = int(port or 1667)
        self.force_refresh = True

    def _groot2_loop(self):
        context = self.zmq_context
        last_tree_fetched = False
        node_status_cache = {}
        last_reported_current_status = {}
        node_execution_start_usec = {}
        node_duration_ms = {}
        node_lookup = {}
        last_endpoint = None
        last_logged_endpoint = None
        last_bb_poll = 0.0
        sock = None
        sub_sock = None

        while self.running:
            raw_host = (self.host or "").strip()
            host = (
                "127.0.0.1"
                if (not raw_host or raw_host.lower() == "localhost")
                else raw_host
            )
            port = self.port or 1667
            endpoint = f"tcp://{host}:{port}"

            if endpoint != last_endpoint or self.force_refresh or sock is None:
                if sock is not None:
                    try:
                        sock.close()
                    except (ValueError, TypeError, IndexError, struct.error):
                        pass
                if sub_sock is not None:
                    try:
                        sub_sock.close()
                    except Exception:
                        pass
                self.sock = None
                self.sub_sock = None
                last_tree_fetched = False
                node_status_cache.clear()
                last_reported_current_status.clear()
                node_execution_start_usec.clear()
                node_duration_ms.clear()
                node_lookup.clear()
                last_endpoint = endpoint
                self.force_refresh = False

                if last_logged_endpoint != endpoint:
                    print(f"[GROOT2] Monitoring TCP server at {host}:{port}...")
                    last_logged_endpoint = endpoint

                try:
                    sock = context.socket(zmq.REQ)
                    sock.setsockopt(zmq.RCVTIMEO, 800)
                    sock.setsockopt(zmq.SNDTIMEO, 800)
                    sock.setsockopt(zmq.LINGER, 0)
                    sock.connect(endpoint)

                    sub_sock = context.socket(zmq.SUB)
                    sub_sock.setsockopt(zmq.RCVTIMEO, 50)
                    sub_sock.setsockopt(zmq.LINGER, 0)
                    sub_sock.setsockopt(zmq.SUBSCRIBE, b"")
                    sub_port = port + 1
                    sub_sock.connect(f"tcp://{host}:{sub_port}")

                    self.sock = sock
                    self.sub_sock = sub_sock
                except Exception as e:
                    print(f"[GROOT2] Socket error: {e}", file=sys.stderr)
                    time.sleep(1.0)
                    continue

            try:
                # 1. Fetch Full Tree XML if not yet cached or refresh forced
                if not last_tree_fetched:
                    req_header = serialize_groot2_header(Groot2RequestType.FULLTREE)
                    sock.send_multipart([req_header])
                    reply_frames = sock.recv_multipart()

                    if len(reply_frames) > 1:
                        xml_payload = reply_frames[1].decode("utf-8", errors="ignore")
                        tree_model = parse_xml_to_bt_model(xml_payload)
                        if tree_model and tree_model.get("nodes"):
                            now = time.time()
                            tree_id = tree_model.get("tree_id", "MainTree")
                            self.current_execution_instance_id = (
                                f"groot_inst_{int(now * 1000)}"
                            )
                            tree_model["source"] = "groot2"
                            tree_model["protocol"] = "groot2"
                            tree_model["is_restart"] = True
                            tree_model["reconnected"] = True
                            tree_model["execution_instance_id"] = (
                                self.current_execution_instance_id
                            )
                            tree_model["session_id"] = (
                                f"groot2_{tree_id}_{self.current_execution_instance_id}"
                            )
                            self.cached_tree = tree_model
                            node_lookup = {
                                int(n["uid"]): n
                                for n in tree_model.get("nodes", [])
                                if "uid" in n
                            }

                            # Fetch initial status snapshot
                            try:
                                status_header = serialize_groot2_header(
                                    Groot2RequestType.STATUS
                                )
                                sock.send_multipart([status_header])
                                st_reply = sock.recv_multipart()
                                if len(st_reply) > 1 and len(st_reply[1]) >= 3:
                                    status_payload = st_reply[1]
                                    for offset in range(0, len(status_payload) - 2, 3):
                                        uid = struct.unpack_from(
                                            "<H", status_payload, offset
                                        )[0]
                                        st_byte = status_payload[offset + 2]
                                        status_str = decode_groot2_status_byte(st_byte)
                                        node_status_cache[uid] = status_str
                                        if uid in node_lookup:
                                            node_lookup[uid]["status"] = status_str
                            except Exception:
                                pass

                            # Fetch initial blackboard data across scopes
                            try:
                                bb_targets = [tree_id.encode("utf-8"), b"@root", b""]
                                combined_flat_bb = {}
                                for target in bb_targets:
                                    bb_header = serialize_groot2_header(
                                        Groot2RequestType.BLACKBOARD
                                    )
                                    sock.send_multipart([bb_header, target])
                                    bb_reply = sock.recv_multipart()
                                    if len(bb_reply) > 1 and bb_reply[1]:
                                        raw_bb = decode_groot2_blackboard(bb_reply[1])
                                        if raw_bb:
                                            flat = flatten_blackboard_dict(raw_bb)
                                            combined_flat_bb.update(flat)

                                if combined_flat_bb:
                                    tree_model["blackboard"] = {
                                        **(tree_model.get("blackboard") or {}),
                                        **combined_flat_bb,
                                    }
                            except Exception:
                                pass

                            # Enable Groot2 transition recording
                            try:
                                rec_header = serialize_groot2_header(
                                    Groot2RequestType.TOGGLE_RECORDING
                                )
                                sock.send_multipart([rec_header, b"start"])
                                sock.recv_multipart()
                            except Exception:
                                pass

                            if self.on_event_callback:
                                self.on_event_callback(tree_model)
                            last_tree_fetched = True

                # 2. In-order Stream of Live Node States (Groot2 STATUS 'S' & GET_TRANSITIONS 't')
                if last_tree_fetched:
                    curr_tree_id = (self.cached_tree or {}).get("tree_id", "Groot2Tree")
                    curr_tree_name = (self.cached_tree or {}).get(
                        "tree_name", curr_tree_id
                    )

                    # Use the timestamps recorded by Groot2Publisher instead of
                    # estimating duration from bridge polling intervals.
                    try:
                        transition_header = serialize_groot2_header(
                            Groot2RequestType.GET_TRANSITIONS
                        )
                        sock.send_multipart([transition_header])
                        transition_reply = sock.recv_multipart()
                        if len(transition_reply) > 1:
                            for (
                                timestamp_usec,
                                transition_uid,
                                transition_status,
                            ) in decode_groot2_transitions(transition_reply[1]):
                                if transition_status == 1:  # RUNNING
                                    node_execution_start_usec[transition_uid] = (
                                        timestamp_usec
                                    )
                                elif transition_status in (2, 3, 4):  # terminal status
                                    start_usec = node_execution_start_usec.pop(
                                        transition_uid, None
                                    )
                                    if (
                                        start_usec is not None
                                        and timestamp_usec >= start_usec
                                    ):
                                        node_duration_ms[transition_uid] = (
                                            timestamp_usec - start_usec
                                        ) / 1000.0
                    except (zmq.Again, zmq.ZMQError):
                        raise
                    except (ValueError, TypeError, IndexError, struct.error):
                        pass

                    # 2a. Live Node Status Snapshot (Groot2 STATUS 'S')
                    try:
                        req_header = serialize_groot2_header(Groot2RequestType.STATUS)
                        sock.send_multipart([req_header])
                        reply_frames = sock.recv_multipart()
                        if len(reply_frames) > 1 and len(reply_frames[1]) >= 3:
                            status_payload = reply_frames[1]
                            for offset in range(0, len(status_payload) - 2, 3):
                                uid = struct.unpack_from("<H", status_payload, offset)[
                                    0
                                ]
                                st_byte = status_payload[offset + 2]
                                status_str = decode_groot2_status_byte(st_byte)

                                is_paused = self.paused_uid == uid
                                current_st = (
                                    "PAUSED_AT_BREAKPOINT" if is_paused else status_str
                                )

                                prev_status = node_status_cache.get(uid)
                                prev_current_st = last_reported_current_status.get(uid)

                                # Don't reset a finished node (SUCCESS/FAILURE) back to IDLE unless it starts RUNNING again
                                if (
                                    status_str == "IDLE"
                                    and prev_status in ("SUCCESS", "FAILURE", "SKIPPED")
                                    and not is_paused
                                ):
                                    continue

                                if (
                                    prev_status != status_str
                                    or prev_current_st != current_st
                                ):
                                    matched_node = node_lookup.get(uid, {})
                                    node_name = (
                                        matched_node.get("name")
                                        or matched_node.get("type")
                                        or f"Node_{uid}"
                                    )
                                    node_id = matched_node.get(
                                        "id", f"{node_name}_{uid}"
                                    )

                                    # Check if a new execution cycle is starting
                                    is_root = (uid == 1) or (
                                        self.cached_tree
                                        and (
                                            self.cached_tree.get("root_node_id")
                                            == node_id
                                            or uid == 1
                                        )
                                    )
                                    was_finished = (
                                        prev_status in ("SUCCESS", "FAILURE")
                                    ) or (
                                        self.cached_tree
                                        and self.cached_tree.get("status")
                                        in ("SUCCESS", "FAILURE")
                                    )
                                    if status_str == "RUNNING" and (
                                        is_root or was_finished
                                    ):
                                        self.current_cycle_id = (
                                            f"groot_cycle_{int(time.time() * 1000)}"
                                        )
                                        self.cycle_count += 1
                                        node_status_cache.clear()
                                        last_reported_current_status.clear()
                                        if self.cached_tree:
                                            self.cached_tree["status"] = "RUNNING"
                                            self.cached_tree["current_cycle_id"] = (
                                                self.current_cycle_id
                                            )
                                            self.cached_tree["cycle_count"] = (
                                                self.cycle_count
                                            )
                                            for n in self.cached_tree.get("nodes", []):
                                                n["status"] = "IDLE"
                                        if self.on_event_callback:
                                            self.on_event_callback(
                                                {
                                                    "type": "execution_cycle_started",
                                                    "source": "groot2",
                                                    "protocol": "groot2",
                                                    "tree_id": curr_tree_id,
                                                    "cycle_id": self.current_cycle_id,
                                                    "timestamp": time.time(),
                                                }
                                            )

                                    node_status_cache[uid] = status_str
                                    last_reported_current_status[uid] = current_st

                                    if self.cached_tree:
                                        for n in self.cached_tree.get("nodes", []):
                                            if n.get("uid") == uid:
                                                if (
                                                    status_str == "IDLE"
                                                    and n.get("status")
                                                    in ("SUCCESS", "FAILURE", "SKIPPED")
                                                    and not is_paused
                                                ):
                                                    pass
                                                else:
                                                    n["status"] = (
                                                        "RUNNING"
                                                        if is_paused
                                                        else status_str
                                                    )
                                                n["is_paused"] = is_paused
                                                break

                                    if (
                                        current_st == "PAUSED_AT_BREAKPOINT"
                                        and prev_current_st != "PAUSED_AT_BREAKPOINT"
                                    ):
                                        pass

                                    event = {
                                        "type": "transition",
                                        "source": "groot2",
                                        "protocol": "groot2",
                                        "cycle_id": self.current_cycle_id,
                                        "tree_id": curr_tree_id,
                                        "tree_name": curr_tree_name,
                                        "node_id": node_id,
                                        "node_name": node_name,
                                        "uid": uid,
                                        "prev_status": prev_status or "IDLE",
                                        "status": "RUNNING"
                                        if is_paused
                                        else status_str,
                                        "current_status": current_st,
                                        "duration": node_duration_ms.get(uid, 0.0),
                                        "tick_count": 1,
                                        "timestamp": time.time(),
                                    }
                                    if self.on_event_callback:
                                        self.on_event_callback(event)
                    except (zmq.Again, zmq.ZMQError):
                        raise
                    except Exception:
                        pass

                    # 2b. Periodically poll Blackboard Data (every 500ms)
                    now_time = time.time()
                    if now_time - last_bb_poll > 0.5:
                        last_bb_poll = now_time
                        try:
                            bb_targets = [curr_tree_id.encode("utf-8"), b"@root", b""]
                            combined_flat_bb = {}
                            for target in bb_targets:
                                req_header = serialize_groot2_header(
                                    Groot2RequestType.BLACKBOARD
                                )
                                sock.send_multipart([req_header, target])
                                reply_frames = sock.recv_multipart()
                                if len(reply_frames) > 1 and reply_frames[1]:
                                    raw_bb = decode_groot2_blackboard(reply_frames[1])
                                    if raw_bb:
                                        flat = flatten_blackboard_dict(raw_bb)
                                        combined_flat_bb.update(flat)

                            if combined_flat_bb:
                                if self.cached_tree:
                                    self.cached_tree["blackboard"] = {
                                        **(self.cached_tree.get("blackboard") or {}),
                                        **combined_flat_bb,
                                    }
                                if self.on_event_callback:
                                    self.on_event_callback(
                                        {
                                            "type": "blackboard_update",
                                            "source": "groot2",
                                            "protocol": "groot2",
                                            "tree_id": curr_tree_id,
                                            "tree_name": curr_tree_name,
                                            "blackboard": combined_flat_bb,
                                            "timestamp": now_time,
                                        }
                                    )
                        except (zmq.Again, zmq.ZMQError):
                            raise
                        except Exception:
                            pass

                    # 2c. Check for authoritative Groot2 publisher notifications (BREAKPOINT_REACHED)
                    try:
                        if sub_sock is not None:
                            while True:
                                sub_frames = sub_sock.recv_multipart(flags=zmq.NOBLOCK)
                                if not sub_frames:
                                    break
                                header_bytes = sub_frames[0]
                                if (
                                    len(header_bytes) >= 2
                                    and header_bytes[1]
                                    == Groot2RequestType.BREAKPOINT_REACHED
                                ):
                                    paused_uid = 0
                                    if len(sub_frames) > 1 and sub_frames[1]:
                                        try:
                                            raw_text = (
                                                sub_frames[1].decode("utf-8").strip()
                                            )
                                            if raw_text.isdigit():
                                                paused_uid = int(raw_text)
                                            else:
                                                info = json.loads(raw_text)
                                                paused_uid = int(
                                                    info.get("uid", info)
                                                    if isinstance(info, dict)
                                                    else info
                                                )
                                        except Exception:
                                            pass
                                    elif len(header_bytes) >= 6:
                                        paused_uid = struct.unpack_from(
                                            "<H", header_bytes, 4
                                        )[0]

                                    if paused_uid > 0:
                                        if (
                                            paused_uid in self.active_fault_uids
                                            and paused_uid
                                            not in self.active_breakpoint_uids
                                        ):
                                            # FAULT INJECTION / REPLACE hook: mode is REPLACE, execution does not pause
                                            continue

                                        self.paused_uid = paused_uid
                                        self.last_unlocked_uid = 0
                                        last_reported_current_status[paused_uid] = (
                                            "PAUSED_AT_BREAKPOINT"
                                        )
                                        matched_node = node_lookup.get(paused_uid, {})
                                        node_name = (
                                            matched_node.get("name")
                                            or matched_node.get("type")
                                            or f"Node_{paused_uid}"
                                        )
                                        node_id = matched_node.get(
                                            "id", f"{node_name}_{paused_uid}"
                                        )

                                        if self.cached_tree:
                                            for n in self.cached_tree.get("nodes", []):
                                                if n.get("uid") == paused_uid:
                                                    n["status"] = "RUNNING"
                                                    n["is_paused"] = True
                                                    break

                                        event = {
                                            "type": "transition",
                                            "source": "groot2",
                                            "protocol": "groot2",
                                            "tree_id": curr_tree_id,
                                            "tree_name": curr_tree_name,
                                            "node_id": node_id,
                                            "node_name": node_name,
                                            "uid": paused_uid,
                                            "prev_status": node_status_cache.get(
                                                paused_uid, "IDLE"
                                            ),
                                            "status": "RUNNING",
                                            "current_status": "PAUSED_AT_BREAKPOINT",
                                            "duration": node_duration_ms.get(
                                                paused_uid, 0.0
                                            ),
                                            "tick_count": 1,
                                            "timestamp": time.time(),
                                        }
                                        if self.on_event_callback:
                                            self.on_event_callback(event)
                    except (zmq.ZMQError, Exception):
                        pass

                # Periodic protocol liveness heartbeat
                if last_tree_fetched:
                    now_hb = time.time()
                    if now_hb - getattr(self, "_last_groot_hb", 0) > 0.4:
                        self._last_groot_hb = now_hb
                        has_running = any(
                            st in ("RUNNING", "PAUSED_AT_BREAKPOINT")
                            for st in node_status_cache.values()
                        )
                        if self.on_event_callback:
                            self.on_event_callback(
                                {
                                    "type": "protocol_heartbeat",
                                    "source": "groot2",
                                    "protocol": "groot2",
                                    "status": "CONNECTED_RUNNING"
                                    if has_running
                                    else "CONNECTED_IDLE",
                                    "execution_instance_id": self.current_execution_instance_id,
                                    "timestamp": now_hb,
                                }
                            )

                time.sleep(0.02)

            except (zmq.Again, zmq.ZMQError):
                if last_tree_fetched:
                    last_tree_fetched = False
                node_status_cache.clear()
                last_reported_current_status.clear()
                self.paused_uid = 0
                if self.cached_tree:
                    self.cached_tree["status"] = "IDLE"
                    for n in self.cached_tree.get("nodes", []):
                        if n.get("status") in ("RUNNING", "PAUSED_AT_BREAKPOINT"):
                            n["status"] = "IDLE"
                    if self.on_event_callback:
                        self.on_event_callback(
                            {
                                "type": "tree_status",
                                "source": "groot2",
                                "protocol": "groot2",
                                "tree_id": self.cached_tree.get("tree_id"),
                                "status": "IDLE",
                                "nodes": self.cached_tree.get("nodes", []),
                            }
                        )
                if self.on_event_callback:
                    self.on_event_callback(
                        {
                            "type": "protocol_heartbeat",
                            "protocol": "groot2",
                            "status": "DISCONNECTED",
                            "execution_instance_id": self.current_execution_instance_id,
                            "timestamp": time.time(),
                        }
                    )
                if sock is not None:
                    try:
                        sock.close()
                    except Exception:
                        pass
                    sock = None
                if sub_sock is not None:
                    try:
                        sub_sock.close()
                    except Exception:
                        pass
                    sub_sock = None
                time.sleep(0.5)

    def send_command(self, cmd: dict):
        """Sends an interactive command to Groot2 (breakpoints, stepping, fault injection)."""
        action = cmd.get("action")
        uid = cmd.get("uid", 0)
        try:
            uid = int(uid)
        except Exception:
            uid = 0

        if uid == 0 and self.paused_uid > 0:
            uid = self.paused_uid

        sock = None
        try:
            raw_host = (self.host or "").strip()
            host = (
                "127.0.0.1"
                if (not raw_host or raw_host.lower() == "localhost")
                else raw_host
            )
            port = self.port or 1667
            ctx = self.zmq_context

            def make_sock():
                s = ctx.socket(zmq.REQ)
                s.setsockopt(zmq.RCVTIMEO, 1000)
                s.setsockopt(zmq.SNDTIMEO, 1000)
                s.setsockopt(zmq.LINGER, 0)
                s.connect(f"tcp://{host}:{port}")
                return s

            def req_rep(s, frames):
                s.send_multipart(frames)
                return s.recv_multipart()

            sock = make_sock()

            if action == "set_breakpoint":
                if cmd.get("enabled") is False:
                    self.active_breakpoint_uids.discard(uid)
                    self.persistent_bp_uids.discard(uid)
                    if self.paused_uid == uid or (uid == 0 and self.paused_uid > 0):
                        p_uid = self.paused_uid if uid == 0 else uid
                        self.paused_uid = 0
                        self.last_unlocked_uid = p_uid
                        self.last_unlocked_time = time.time()
                        try:
                            req_header_unl = serialize_groot2_header(
                                Groot2RequestType.BREAKPOINT_UNLOCK
                            )
                            unlock_json = json.dumps(
                                {
                                    "uid": p_uid,
                                    "desired_status": "IDLE",
                                    "position": 0,
                                    "remove_when_done": True,
                                }
                            )
                            req_rep(sock, [req_header_unl, unlock_json.encode("utf-8")])
                        except Exception:
                            sock.close()
                            sock = make_sock()

                    req_header = serialize_groot2_header(Groot2RequestType.HOOK_REMOVE)
                    remove_json = json.dumps({"uid": uid, "position": 0})
                    req_rep(sock, [req_header, remove_json.encode("utf-8")])
                else:
                    self.active_breakpoint_uids.add(uid)
                    is_once = bool(cmd.get("once", False))
                    if not is_once:
                        self.persistent_bp_uids.add(uid)
                    try:
                        req_header_rem = serialize_groot2_header(
                            Groot2RequestType.HOOK_REMOVE
                        )
                        remove_json = json.dumps({"uid": uid, "position": 0})
                        req_rep(sock, [req_header_rem, remove_json.encode("utf-8")])
                    except Exception:
                        sock.close()
                        sock = make_sock()

                    req_header = serialize_groot2_header(Groot2RequestType.HOOK_INSERT)
                    hook_json = json.dumps(
                        {
                            "enabled": True,
                            "uid": uid,
                            "mode": 0,  # BREAKPOINT
                            "once": is_once,
                            "desired_status": "IDLE",
                            "position": 0,  # PRE
                        }
                    )
                    req_rep(sock, [req_header, hook_json.encode("utf-8")])

            elif action == "clear_breakpoint":
                self.active_breakpoint_uids.discard(uid)
                self.persistent_bp_uids.discard(uid)
                if self.paused_uid == uid or (uid == 0 and self.paused_uid > 0):
                    p_uid = self.paused_uid if uid == 0 else uid
                    self.paused_uid = 0
                    self.last_unlocked_uid = p_uid
                    self.last_unlocked_time = time.time()
                    try:
                        req_header_unl = serialize_groot2_header(
                            Groot2RequestType.BREAKPOINT_UNLOCK
                        )
                        unlock_json = json.dumps(
                            {
                                "uid": p_uid,
                                "desired_status": "IDLE",
                                "position": 0,
                                "remove_when_done": True,
                            }
                        )
                        req_rep(sock, [req_header_unl, unlock_json.encode("utf-8")])
                    except Exception:
                        sock.close()
                        sock = make_sock()

                req_header = serialize_groot2_header(Groot2RequestType.HOOK_REMOVE)
                remove_json = json.dumps({"uid": uid, "position": 0})
                req_rep(sock, [req_header, remove_json.encode("utf-8")])

            elif action == "clear_fault":
                self.active_fault_uids.discard(uid)
                req_header = serialize_groot2_header(Groot2RequestType.HOOK_REMOVE)
                remove_json = json.dumps({"uid": uid, "position": 0})
                req_rep(sock, [req_header, remove_json.encode("utf-8")])

            elif action == "clear_all_breakpoints":
                self.active_breakpoint_uids.clear()
                self.persistent_bp_uids.clear()
                if self.paused_uid > 0:
                    p_uid = self.paused_uid
                    self.paused_uid = 0
                    self.last_unlocked_uid = p_uid
                    self.last_unlocked_time = time.time()
                    try:
                        req_header_unl = serialize_groot2_header(
                            Groot2RequestType.BREAKPOINT_UNLOCK
                        )
                        unlock_json = json.dumps(
                            {
                                "uid": p_uid,
                                "desired_status": "IDLE",
                                "position": 0,
                                "remove_when_done": True,
                            }
                        )
                        req_rep(sock, [req_header_unl, unlock_json.encode("utf-8")])
                    except Exception:
                        sock.close()
                        sock = make_sock()

                req_header = serialize_groot2_header(Groot2RequestType.REMOVE_ALL_HOOKS)
                req_rep(sock, [req_header])

            elif action == "clear_all_faults":
                self.active_fault_uids.clear()
                req_header = serialize_groot2_header(Groot2RequestType.REMOVE_ALL_HOOKS)
                req_rep(sock, [req_header])

            elif action == "step":
                self.paused_uid = 0
                self.last_unlocked_uid = uid
                self.last_unlocked_time = time.time()
                req_header = serialize_groot2_header(
                    Groot2RequestType.BREAKPOINT_UNLOCK
                )
                unlock_json = json.dumps(
                    {
                        "uid": uid,
                        "desired_status": "IDLE",
                        "position": 0,
                        "remove_when_done": True,
                    }
                )
                req_rep(sock, [req_header, unlock_json.encode("utf-8")])
                status_header = serialize_groot2_header(Groot2RequestType.STATUS)
                req_rep(sock, [status_header])

            elif action in ("resume", "force_success", "force_failure"):
                is_once = bool(cmd.get("once", False))
                if action == "force_success":
                    desired_status = "SUCCESS"
                elif action == "force_failure":
                    desired_status = "FAILURE"
                else:  # resume
                    desired_status = cmd.get("desired_status", "IDLE")

                self.paused_uid = 0
                self.last_unlocked_uid = uid
                self.last_unlocked_time = time.time()
                if is_once:
                    self.persistent_bp_uids.discard(uid)

                req_header = serialize_groot2_header(
                    Groot2RequestType.BREAKPOINT_UNLOCK
                )
                unlock_json = json.dumps(
                    {
                        "uid": uid,
                        "desired_status": desired_status,
                        "position": 0,
                        "remove_when_done": is_once,
                    }
                )
                req_rep(sock, [req_header, unlock_json.encode("utf-8")])

                try:
                    status_header = serialize_groot2_header(Groot2RequestType.STATUS)
                    req_rep(sock, [status_header])
                except Exception:
                    pass

                if desired_status in ("SUCCESS", "FAILURE"):
                    if self.cached_tree:
                        for n in self.cached_tree.get("nodes", []):
                            if n.get("uid") == uid:
                                n["status"] = desired_status
                                n["last_result"] = desired_status
                                n["is_paused"] = False
                                break

                    if self.on_event_callback:
                        curr_tree_id = (self.cached_tree or {}).get(
                            "tree_id", "Groot2Tree"
                        )
                        curr_tree_name = (self.cached_tree or {}).get(
                            "tree_name", curr_tree_id
                        )
                        matched_node = {}
                        if self.cached_tree:
                            for n in self.cached_tree.get("nodes", []):
                                if n.get("uid") == uid:
                                    matched_node = n
                                    break
                        node_name = (
                            matched_node.get("name")
                            or matched_node.get("type")
                            or f"Node_{uid}"
                        )
                        node_id = matched_node.get("id", f"{node_name}_{uid}")
                        self.on_event_callback(
                            {
                                "type": "transition",
                                "source": "groot2",
                                "protocol": "groot2",
                                "tree_id": curr_tree_id,
                                "tree_name": curr_tree_name,
                                "node_id": node_id,
                                "node_name": node_name,
                                "uid": uid,
                                "prev_status": "RUNNING",
                                "status": desired_status,
                                "current_status": desired_status,
                                "duration": 0.0,
                                "tick_count": 1,
                                "timestamp": time.time(),
                            }
                        )

                if self.on_event_callback:
                    curr_tree_id = (self.cached_tree or {}).get("tree_id", "Groot2Tree")
                    self.on_event_callback(
                        {
                            "type": "execution_resumed",
                            "source": "groot2",
                            "protocol": "groot2",
                            "tree_id": curr_tree_id,
                            "tree_name": curr_tree_id,
                            "uid": uid,
                            "action": action,
                            "forced_status": desired_status,
                            "current_status": "RESUMED",
                            "timestamp": time.time(),
                        }
                    )

            elif action == "inject_fault":
                self.active_fault_uids.add(uid)
                try:
                    req_header_rem = serialize_groot2_header(
                        Groot2RequestType.HOOK_REMOVE
                    )
                    remove_json = json.dumps({"uid": uid, "position": 0})
                    req_rep(sock, [req_header_rem, remove_json.encode("utf-8")])
                except Exception:
                    sock.close()
                    sock = make_sock()

                req_header = serialize_groot2_header(Groot2RequestType.HOOK_INSERT)
                raw_mode = str(
                    cmd.get("mode") or cmd.get("fault_mode") or "FAILURE"
                ).upper()
                norm_status = "FAILURE"
                if "SUCCESS" in raw_mode:
                    norm_status = "SUCCESS"
                elif "RUNNING" in raw_mode:
                    norm_status = "RUNNING"
                elif "SKIPPED" in raw_mode:
                    norm_status = "SKIPPED"
                elif "IDLE" in raw_mode:
                    norm_status = "IDLE"
                elif "FAILURE" in raw_mode:
                    norm_status = "FAILURE"

                once = bool(cmd.get("once") or cmd.get("fault_once", False))

                hook_json = json.dumps(
                    {
                        "enabled": True,
                        "uid": uid,
                        "mode": 1,  # REPLACE / OVERRIDE
                        "once": once,
                        "desired_status": norm_status,
                        "position": 0,  # PRE
                    }
                )
                req_rep(sock, [req_header, hook_json.encode("utf-8")])

                if self.cached_tree:
                    for n in self.cached_tree.get("nodes", []):
                        if n.get("uid") == uid:
                            n["fault_mode"] = norm_status
                            n["fault_once"] = once
                            n["status"] = norm_status
                            n["last_result"] = norm_status
                            break

                if self.on_event_callback:
                    curr_tree_id = (self.cached_tree or {}).get("tree_id", "Groot2Tree")
                    curr_tree_name = (self.cached_tree or {}).get(
                        "tree_name", curr_tree_id
                    )
                    matched_node = {}
                    if self.cached_tree:
                        for n in self.cached_tree.get("nodes", []):
                            if n.get("uid") == uid:
                                matched_node = n
                                break
                    node_name = (
                        matched_node.get("name")
                        or matched_node.get("type")
                        or f"Node_{uid}"
                    )
                    node_id = matched_node.get("id", f"{node_name}_{uid}")
                    self.on_event_callback(
                        {
                            "type": "transition",
                            "source": "groot2",
                            "protocol": "groot2",
                            "tree_id": curr_tree_id,
                            "tree_name": curr_tree_name,
                            "node_id": node_id,
                            "node_name": node_name,
                            "uid": uid,
                            "prev_status": "RUNNING",
                            "status": norm_status,
                            "current_status": norm_status,
                            "duration": 0.0,
                            "tick_count": 1,
                            "timestamp": time.time(),
                        }
                    )

        except Exception as e:
            print(f"[Groot2 Bridge] ⚠️ Error executing '{action}': {e}", file=sys.stderr)
        finally:
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass

    def stop(self):
        self.running = False
        if self.sock is not None:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None
        if self.sub_sock is not None:
            try:
                self.sub_sock.close()
            except Exception:
                pass
            self.sub_sock = None
        try:
            self.zmq_context.term()
        except Exception:
            pass


# ==============================================================================
# Standalone Server Execution Mode
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Groot2 Dedicated ZMQ Protocol Bridge Server"
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Groot2 server host (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port", type=int, default=1667, help="Groot2 server port (default: 1667)"
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
    args = parser.parse_args()

    dist_dir = args.dist_dir
    if not dist_dir:
        candidate = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist"
        )
        if os.path.exists(candidate):
            dist_dir = candidate

    print("=" * 66)
    print(" 🌲 GROOT2 DEDICATED ZMQ PROTOCOL BRIDGE")
    print("=" * 66)
    print(f" • WebSocket Broadcast : ws://0.0.0.0:{args.ws_port}")
    if args.http_port > 0 and dist_dir:
        print(f" • Web App Browser URL : http://localhost:{args.http_port}")
        print(f" • Static Assets Path  : {dist_dir}")
    print(f" • Groot2 Target       : tcp://{args.host}:{args.port}")
    print("=" * 66)

    bridge_server = None

    def handle_client_message(msg_str: str):
        try:
            msg = json.loads(msg_str)
            msg_type = msg.get("type")
            if msg_type == "send_command" and "data" in msg:
                bridge_server.send_command(msg["data"])
            elif msg_type == "switch_source":
                host = msg.get("host", args.host)
                port = int(msg.get("port", args.port))
                bridge_server.update_target(host, port)
            elif msg_type == "get_trees":
                if bridge_server.cached_tree:
                    ws_server.broadcast(json.dumps(bridge_server.cached_tree))
        except Exception:
            pass

    ws_server = StandaloneWebSocketServer(
        host="0.0.0.0", port=args.ws_port, on_client_message=handle_client_message
    )
    ws_server.start()

    bridge_server = Groot2ZMQBridge(
        host=args.host,
        port=args.port,
        on_event_callback=lambda event: ws_server.broadcast(json.dumps(event)),
    )
    bridge_server.start()

    if args.http_port > 0 and dist_dir and os.path.exists(dist_dir):
        from http.server import ThreadingHTTPServer

        handler = lambda *a, **kw: SPAHTTPHandler(
            *a,
            directory=dist_dir,
            status_provider=lambda: {
                "source": "groot2",
                "connected": bridge_server.running,
                "tree": (bridge_server.cached_tree or {}).get("tree_id"),
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
        print("\n[Groot2 Bridge] Shutting down...")
        bridge_server.stop()
        ws_server.stop()


if __name__ == "__main__":
    main()
