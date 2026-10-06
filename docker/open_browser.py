#!/usr/bin/env python3
"""
Lightweight host browser opener for containerized BTick.
- If Google Chrome / Chromium is already running, sends an IPC message to its
  existing SingletonSocket so the URL opens as a new tab in the existing window.
- If Chrome is not running, falls back to the host's XDG Desktop Portal over D-Bus
  to launch the default browser normally.
"""
import glob
import os
import socket
import struct
import sys


def open_in_existing_chrome(url: str) -> bool:
    """Attempt to open URL in an existing Chrome/Chromium window as a new tab."""
    patterns = [
        "/tmp/com.google.Chrome.*/SingletonSocket",
        "/tmp/com.google.Chromium.*/SingletonSocket",
        "/tmp/com.brave.Browser.*/SingletonSocket",
        "/tmp/com.microsoft.Edge.*/SingletonSocket",
    ]
    candidate_sockets = []
    for pattern in patterns:
        candidate_sockets.extend(glob.glob(pattern))

    # Also check ~/.config/google-chrome/SingletonSocket if accessible
    for config_dir in ["~/.config/google-chrome", "~/.config/chromium"]:
        link = os.path.expanduser(f"{config_dir}/SingletonSocket")
        if os.path.islink(link):
            try:
                target = os.readlink(link)
                if os.path.exists(target) and target not in candidate_sockets:
                    candidate_sockets.append(target)
            except OSError:
                pass

    if not candidate_sockets:
        return False

    # Message format expected by Chrome's process_singleton_posix:
    # START\0<cwd>\0<argv0>\0<url>
    ipc_message = f"START\0/tmp\0google-chrome\0{url}".encode("utf-8")

    for sock_path in candidate_sockets:
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(2.0)
            s.connect(sock_path)
            s.sendall(ipc_message)
            s.close()
            return True
        except Exception:
            continue

    return False


def find_dbus_socket() -> str | None:
    # 1. Explicit DBUS_SESSION_BUS_ADDRESS takes highest priority
    dbus_addr = os.environ.get("DBUS_SESSION_BUS_ADDRESS", "").strip()
    if dbus_addr:
        path = dbus_addr[len("unix:path="):] if dbus_addr.startswith("unix:path=") else dbus_addr
        return path if os.path.exists(path) else None

    # 2. XDG_RUNTIME_DIR takes next priority
    xdg_runtime = os.environ.get("XDG_RUNTIME_DIR", "").strip()
    if xdg_runtime:
        path = os.path.join(xdg_runtime, "bus")
        return path if os.path.exists(path) else None

    # 3. Fallback: search /run/user/<uid>/bus
    run_user = "/run/user"
    if os.path.isdir(run_user):
        current_uid = os.getuid()
        if current_uid != 0:
            uid_path = os.path.join(run_user, str(current_uid), "bus")
            if os.path.exists(uid_path):
                return uid_path

        for entry in sorted(os.listdir(run_user)):
            path = os.path.join(run_user, entry, "bus")
            if os.path.exists(path):
                return path

    return None


def open_via_desktop_portal(url: str) -> bool:
    """Launch default browser via XDG Desktop Portal over host D-Bus session bus."""
    sock_path = find_dbus_socket()
    if not sock_path:
        return False

    try:
        st = os.stat(sock_path)
        if os.getuid() == 0 and st.st_uid != 0:
            try:
                os.setgid(st.st_gid)
                os.setuid(st.st_uid)
            except OSError as e:
                sys.stderr.write(
                    f"[BTick Browser Launcher] Warning: Failed to drop privileges to UID {st.st_uid}: {e}\n"
                )
                sys.stderr.flush()

        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(5.0)
        s.connect(sock_path)

        # SASL Auth (EXTERNAL)
        current_uid = os.getuid()
        uid_hex = str(current_uid).encode("utf-8").hex()
        s.sendall(f"\0AUTH EXTERNAL {uid_hex}\r\nNEGOTIATE_UNIX_FD\r\nBEGIN\r\n".encode("utf-8"))
        while True:
            line = s.recv(1024)
            if not line:
                raise ConnectionError("D-Bus socket closed during authentication")
            if b"OK" in line:
                break
            if b"REJECTED" in line:
                raise PermissionError(f"D-Bus authentication rejected for UID {current_uid}")

        # D-Bus Hello message
        hello_msg = (
            b"l\x01\x00\x01\x00\x00\x00\x00\x01\x00\x00\x00m\x00\x00\x00"
            b"\x01\x01o\x00\x15\x00\x00\x00/org/freedesktop/DBus\x00\x00\x00"
            b"\x03\x01s\x00\x05\x00\x00\x00Hello\x00\x00\x00"
            b"\x02\x01s\x00\x14\x00\x00\x00org.freedesktop.DBus\x00\x00\x00\x00"
            b"\x06\x01s\x00\x14\x00\x00\x00org.freedesktop.DBus\x00\x00\x00\x00"
        )
        s.sendall(hello_msg)
        s.recv(4096)

        # OpenURI method call
        def pad(b: bytes, n: int = 8) -> bytes:
            rem = len(b) % n
            return b + (b"\0" * (n - rem) if rem else b"")

        url_bytes = url.encode("utf-8")
        url_packed = struct.pack("<I", len(url_bytes)) + url_bytes + b"\0"
        body = b"\x00\x00\x00\x00\x00" + pad(b"", 3) + url_packed
        body = pad(body, 4) + b"\x00\x00\x00\x00"

        f_path = b"\x01\x01o\x00\x1f\x00\x00\x00/org/freedesktop/portal/desktop\x00"
        f_member = b"\x03\x01s\x00\x07\x00\x00\x00OpenURI\x00"
        f_iface = b"\x02\x01s\x00\x1e\x00\x00\x00org.freedesktop.portal.OpenURI\x00\x00"
        f_dest = b"\x06\x01s\x00\x1e\x00\x00\x00org.freedesktop.portal.Desktop\x00\x00"
        f_sig = b"\x08\x01g\x00\x07ssa{sv}\x00"
        fields = f_path + f_member + f_iface + f_dest + f_sig

        hdr = (
            struct.pack("<BBBBII", ord("l"), 1, 4, 1, len(body), 2)
            + struct.pack("<I", len(fields))
            + fields
        )
        hdr = pad(hdr, 8)
        s.sendall(hdr + body)
        s.recv(4096)
        s.close()
        return True
    except Exception as e:
        sys.stderr.write(
            f"[BTick Browser Launcher] Warning: Failed to open browser via Desktop Portal: {e}\n"
        )
        sys.stderr.flush()
        return False


def open_browser(url: str) -> bool:
    # 1. If Chrome/Chromium is already running, open as new tab in existing window
    if open_in_existing_chrome(url):
        return True

    # 2. If Chrome is not running, launch default browser via Desktop Portal
    if open_via_desktop_portal(url):
        return True

    sys.stderr.write(
        "[BTick Browser Launcher] Warning: Could not open browser on host machine.\n"
    )
    sys.stderr.flush()
    return False


def main():
    target_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
    success = open_browser(target_url)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
