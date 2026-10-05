#!/usr/bin/env python3
"""
BT Monitor Common Protocol, Network, and Parsing Utilities
----------------------------------------------------------
Contains:
1. RFC 6455 Pure-Python WebSocket Server
2. SPA HTTP Server for React Frontend
3. Groot2 Protocol Constants and Header Serializers
4. BehaviorTree.CPP XML Model Parser
"""

import os
import sys
import json
import time
import base64
import struct
import socket
import select
import hashlib
import random
import threading
import xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

# Optional msgpack for Groot2 Blackboard decoding
HAVE_MSGPACK = False
try:
    import msgpack
    HAVE_MSGPACK = True
except ImportError:
    pass


# ==============================================================================
# Groot2 Protocol Constants & Helper Functions
# ==============================================================================
GROOT2_PROTOCOL_ID = 2

class Groot2RequestType:
    FULLTREE = ord('T')
    STATUS = ord('S')
    BLACKBOARD = ord('B')
    HOOK_INSERT = ord('I')
    HOOK_REMOVE = ord('R')
    BREAKPOINT_REACHED = ord('N')
    BREAKPOINT_UNLOCK = ord('U')
    REMOVE_ALL_HOOKS = ord('A')
    HOOKS_DUMP = ord('D')
    DISABLE_ALL_HOOKS = ord('X')
    TOGGLE_RECORDING = ord('r')
    GET_TRANSITIONS = ord('t')


def decode_groot2_blackboard(payload: bytes) -> dict:
    """Decodes MessagePack or JSON payload returned by Groot2 Blackboard query."""
    if not payload or payload == b'\xc0':
        return {}
    if HAVE_MSGPACK:
        try:
            data = msgpack.unpackb(payload, raw=False)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    try:
        text = payload.decode('utf-8', errors='ignore').strip()
        if text.startswith('{'):
            data = json.loads(text)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def flatten_blackboard_dict(data: dict) -> dict:
    """
    Flattens nested/scoped Blackboard JSON returned by BehaviorTree.CPP / Groot2.
    Example:
      {"@root": {"goal": "(1,2,0)", "speed": 1.5}, "UseElevator": {"door": 1}}
    Becomes:
      {"goal": "(1,2,0)", "speed": 1.5, "door": 1, "@root/goal": "(1,2,0)", ...}
    Also unboxes typed entries like {"type": "std::string", "value": "xyz"}.
    """
    flat = {}
    if not isinstance(data, dict):
        return flat

    def unbox(val):
        if isinstance(val, dict) and 'value' in val and len(val) <= 3:
            return val['value']
        return val

    for top_k, top_v in data.items():
        if isinstance(top_v, dict) and not ('value' in top_v and len(top_v) <= 3):
            for sub_k, sub_v in top_v.items():
                unboxed_sub = unbox(sub_v)
                flat[sub_k] = unboxed_sub
                flat[f"{top_k}/{sub_k}"] = unboxed_sub
        else:
            flat[top_k] = unbox(top_v)
    return flat


def serialize_groot2_header(req_type: int, unique_id: int = None) -> bytes:
    if unique_id is None:
        unique_id = random.randint(1, 0xFFFFFFFE)
    # protocol (1 byte), type (1 byte), unique_id (4 bytes, little endian)
    return struct.pack('<BBI', GROOT2_PROTOCOL_ID, req_type, unique_id)


# ==============================================================================
# BehaviorTree.CPP XML Model Parser
# ==============================================================================
def parse_xml_to_bt_model(xml_str: str, tree_name_override: str = "") -> dict:
    """Parses BehaviorTree.CPP XML into BT Monitor JSON BTTreeModel format with recursive SubTree expansion."""
    try:
        root = ET.fromstring(xml_str)
    except Exception as e:
        print(f"[BT Common] XML parse error: {e}", file=sys.stderr)
        return {}

    main_tree_id = root.attrib.get('main_tree_to_execute', '')
    bt_elements = root.findall('.//BehaviorTree')
    if not bt_elements:
        return {}

    bt_fullpath_map = {}
    bt_id_map = {}
    for bt in bt_elements:
        fp = bt.attrib.get('_fullpath')
        bid = bt.attrib.get('ID')
        if fp:
            bt_fullpath_map[fp] = bt
        if bid and bid not in bt_id_map:
            bt_id_map[bid] = bt

    target_bt = bt_elements[0]
    if main_tree_id and main_tree_id in bt_id_map:
        target_bt = bt_id_map[main_tree_id]

    tree_id = target_bt.attrib.get('ID', tree_name_override or 'MainTree')
    tree_name = tree_name_override or tree_id

    nodes = []
    blackboard = {}
    counter = 0
    used_uids = set()

    control_tags = {
        'Sequence', 'Fallback', 'Parallel', 'ReactiveSequence', 'ReactiveFallback',
        'SequenceWithMemory', 'PipelineSequence', 'RecoveryNode', 'RoundRobin',
        'IfThenElse', 'Switch2', 'Switch3', 'WhileDoElse'
    }
    decorator_tags = {
        'Inverter', 'Repeat', 'RetryUntilSuccessful', 'Timeout', 'ForceSuccess',
        'ForceFailure', 'RateController', 'Delay', 'KeepRunningUntilFailure',
        'Precondition', 'ConsumeAsset', 'LoopFast'
    }

    def determine_category(tag: str, is_subtree: bool) -> str:
        if is_subtree or 'SubTree' in tag:
            return 'SubTree'
        if tag in control_tags:
            return 'Control'
        if tag in decorator_tags:
            return 'Decorator'
        if (tag.startswith(('Check', 'Is', 'Verify', 'Would', 'Has')) or
            'Condition' in tag or tag in {'AlwaysFailure', 'AlwaysSuccess', 'GoalReached'}):
            return 'Condition'
        return 'Action'

    def traverse(elem: ET.Element, parent_id: str, ancestors: tuple = ()):
        nonlocal counter
        tag = elem.tag
        is_subtree = (tag == 'SubTree' or tag == 'SubTreePlus' or 'SubTree' in tag)
        name_attr = elem.attrib.get('name', '')
        id_attr = elem.attrib.get('ID', '') or elem.attrib.get('subtree_id', '')
        fullpath_attr = elem.attrib.get('_fullpath', '')
        display_name = name_attr or id_attr or tag

        if '_uid' in elem.attrib:
            try:
                raw_uid = int(elem.attrib['_uid'])
                if raw_uid not in used_uids:
                    uid = raw_uid
                    used_uids.add(uid)
                else:
                    counter += 1
                    while counter in used_uids:
                        counter += 1
                    uid = counter
                    used_uids.add(uid)
            except ValueError:
                counter += 1
                while counter in used_uids:
                    counter += 1
                uid = counter
                used_uids.add(uid)
        else:
            counter += 1
            while counter in used_uids:
                counter += 1
            uid = counter
            used_uids.add(uid)

        node_id = f"{display_name.replace(' ', '_')}_{uid}"
        category = determine_category(tag, is_subtree)

        ports = {}
        attributes = {}
        for k, v in elem.attrib.items():
            if k in {'name', '_uid', '_fullpath'}:
                continue
            if v.startswith('{') and v.endswith('}'):
                ports[k] = v
                raw_key = v[1:-1].strip()
                if raw_key and raw_key not in blackboard:
                    blackboard[raw_key] = 'unset'
            else:
                attributes[k] = v

        children_ids = []

        node_data = {
            'id': node_id,
            'uid': uid,
            'name': display_name,
            'type': tag if not is_subtree else 'SubTree',
            'category': category,
            'parent_id': parent_id,
            'children_ids': children_ids,
            'ports': ports,
            'attributes': attributes,
            'status': 'IDLE'
        }
        nodes.append(node_data)

        # Expand SubTree elements
        if is_subtree:
            sub_bt = None
            if fullpath_attr and fullpath_attr in bt_fullpath_map:
                sub_bt = bt_fullpath_map[fullpath_attr]
            elif id_attr and id_attr in bt_id_map:
                sub_bt = bt_id_map[id_attr]

            if sub_bt is not None:
                sub_key = fullpath_attr or id_attr or display_name
                if sub_key not in ancestors:
                    for child in sub_bt:
                        if isinstance(child.tag, str) and not child.tag.endswith('Port') and not child.tag.endswith('port'):
                            cid = traverse(child, node_id, ancestors + (sub_key,))
                            if cid:
                                children_ids.append(cid)
        else:
            for child in elem:
                if isinstance(child.tag, str) and not child.tag.endswith('Port') and not child.tag.endswith('port'):
                    cid = traverse(child, node_id, ancestors)
                    if cid:
                        children_ids.append(cid)

        return node_id

    # Create root hierarchy
    for child in target_bt:
        if isinstance(child.tag, str) and not child.tag.endswith('Port') and not child.tag.endswith('port'):
            traverse(child, '', (tree_id,))

    root_node_id = nodes[0]['id'] if nodes else ''

    return {
        'type': 'tree_created',
        'tree_id': tree_id,
        'tree_name': tree_name,
        'root_node_id': root_node_id,
        'nodes': nodes,
        'blackboard': blackboard,
        'status': 'IDLE',
        'timestamp': time.time()
    }


# ==============================================================================
# Standalone RFC 6455 Pure-Python WebSocket Server
# ==============================================================================
class StandaloneWebSocketServer:
    def __init__(self, host: str = "0.0.0.0", port: int = 8080, on_client_message=None, on_client_connect=None):
        self.host = host
        self.port = port
        self.on_client_message = on_client_message
        self.on_client_connect = on_client_connect
        self.clients = set()
        self.lock = threading.Lock()
        self.server_socket = None
        self.running = False

    def start(self):
        self.running = True
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_socket.bind((self.host, self.port))
        self.server_socket.listen(128)
        print(f"[WebSocket Server] 🚀 Listening on ws://{self.host}:{self.port}")

        thread = threading.Thread(target=self._accept_loop, daemon=True)
        thread.start()

    def _accept_loop(self):
        while self.running:
            try:
                client_sock, addr = self.server_socket.accept()
                threading.Thread(target=self._handle_client, args=(client_sock,), daemon=True).start()
            except Exception:
                break

    def _handle_client(self, sock: socket.socket):
        try:
            req = b""
            while b"\r\n\r\n" not in req:
                chunk = sock.recv(1024)
                if not chunk:
                    sock.close()
                    return
                req += chunk

            headers = {}
            lines = req.decode('utf-8', errors='ignore').split("\r\n")
            for line in lines[1:]:
                if ": " in line:
                    k, v = line.split(": ", 1)
                    headers[k.lower()] = v

            sec_key = headers.get("sec-websocket-key")
            if not sec_key:
                sock.close()
                return

            guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
            accept_key = base64.b64encode(hashlib.sha1((sec_key + guid).encode()).digest()).decode()

            handshake = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept_key}\r\n\r\n"
            )
            sock.sendall(handshake.encode())

            with self.lock:
                self.clients.add(sock)

            if self.on_client_connect:
                try:
                    self.on_client_connect(sock)
                except Exception as e:
                    print(f"[WebSocket] Error in on_client_connect: {e}", file=sys.stderr)

            while self.running:
                data = sock.recv(2)
                if not data:
                    break
                byte1, byte2 = data[0], data[1]
                opcode = byte1 & 0x0f
                is_masked = (byte2 & 0x80) != 0
                payload_len = byte2 & 0x7f

                if opcode == 8: # Close frame
                    break
                elif opcode == 9: # Ping
                    sock.sendall(bytes([0x8a, 0x00])) # Pong
                    continue

                if payload_len == 126:
                    ext = sock.recv(2)
                    payload_len = struct.unpack("!H", ext)[0]
                elif payload_len == 127:
                    ext = sock.recv(8)
                    payload_len = struct.unpack("!Q", ext)[0]

                mask_key = sock.recv(4) if is_masked else None
                payload = bytearray()
                while len(payload) < payload_len:
                    part = sock.recv(payload_len - len(payload))
                    if not part:
                        break
                    payload.extend(part)

                if is_masked and mask_key:
                    for i in range(len(payload)):
                        payload[i] ^= mask_key[i % 4]

                if opcode == 1: # Text frame
                    msg_str = payload.decode('utf-8', errors='ignore')
                    if self.on_client_message:
                        try:
                            self.on_client_message(msg_str)
                        except Exception as e:
                            print(f"[WebSocket] Message handler error: {e}", file=sys.stderr)

        except Exception:
            pass
        finally:
            with self.lock:
                self.clients.discard(sock)
            try:
                sock.close()
            except Exception:
                pass

    def send_to_sock(self, sock: socket.socket, message: str):
        try:
            payload = message.encode('utf-8')
            length = len(payload)
            frame = bytearray([0x81])
            if length <= 125:
                frame.append(length)
            elif length <= 65535:
                frame.append(126)
                frame.extend(struct.pack("!H", length))
            else:
                frame.append(127)
                frame.extend(struct.pack("!Q", length))
            frame.extend(payload)
            sock.sendall(frame)
        except Exception:
            pass

    def broadcast(self, message: str):
        with self.lock:
            dead_socks = []
            for client in list(self.clients):
                try:
                    self.send_to_sock(client, message)
                except Exception:
                    dead_socks.append(client)
            for d in dead_socks:
                self.clients.discard(d)

    def stop(self):
        self.running = False
        if self.server_socket:
            try:
                self.server_socket.close()
            except Exception:
                pass


# ==============================================================================
# SPA Static File HTTP Server (Handles HTML5 pushState & React router)
# ==============================================================================
class SPAHTTPHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, status_provider=None, **kwargs):
        self.dist_dir = directory or os.getcwd()
        self.status_provider = status_provider
        super().__init__(*args, directory=self.dist_dir, **kwargs)

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        try:
            self.send_response(204)
            self._send_cors_headers()
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_GET(self):
        try:
            parsed_path = urlparse(self.path).path
            file_path = os.path.join(self.dist_dir, parsed_path.lstrip('/'))

            if parsed_path in ('/config.json', '/api/config'):
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self._send_cors_headers()
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.end_headers()
                info = self.status_provider() if self.status_provider else {}
                config_data = {
                    'wsPort': info.get('ws_port', 8080),
                    'httpPort': info.get('http_port', 3000),
                    'zmqPort': info.get('zmq_port', info.get('groot_port', 1667)),
                }
                self.wfile.write(json.dumps(config_data).encode('utf-8'))
                return

            if parsed_path.startswith('/api/status'):
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                info = self.status_provider() if self.status_provider else {'status': 'ok'}
                self.wfile.write(json.dumps(info).encode('utf-8'))
                return

            if not os.path.exists(file_path) or os.path.isdir(file_path):
                index_path = os.path.join(self.dist_dir, 'index.html')
                if os.path.exists(index_path):
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html; charset=utf-8')
                    self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                    self.send_header('Pragma', 'no-cache')
                    self.end_headers()
                    with open(index_path, 'rb') as f:
                        self.wfile.write(f.read())
                    return

            return super().do_GET()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def log_message(self, format, *args):
        # Silence routine static asset HTTP GET logs
        pass
