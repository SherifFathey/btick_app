type MessageHandler = (data: any) => void;
type StatusHandler = (connected: boolean) => void;

export interface UserLog {
  protocol: "btick" | "groot2" | "nav2";
  nodeName?: string;
  action: string;
  status?: string;
  reason?: string;
  treeName?: string;
  nodeCount?: number;
}

class ROS2Service {
  private messageListeners: Set<MessageHandler> = new Set();
  private statusListeners: Set<StatusHandler> = new Set();
  private isConnected: boolean = false;

  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;

  constructor() {
    // 1. Electron IPC Bridge (Primary in Electron)
    if (typeof window !== "undefined" && (window as any).electronAPI) {
      (window as any).electronAPI.onROS2Event((data: any) => {
        if (data) {
          this.notifyMessage(data);
          if (!this.isConnected) {
            this.isConnected = true;
            this.notifyStatus(true);
          }
        }
      });

      // Notify main process that UI listener is ready and ask for any cached tree
      setTimeout(() => {
        if (typeof window !== "undefined" && (window as any).electronAPI) {
          (window as any).electronAPI.notifyReady?.();
          (window as any).electronAPI.requestTree?.();
        }
      }, 50);
    }

    // 2. Fetch runtime config then connect to WebSocket Bridge once
    this.initRuntimeConfig().then(() => {
      this.connectWS();
    });
  }

  private runtimeConfig: {
    wsPort?: number | string;
    httpPort?: number | string;
    zmqPort?: number | string;
  } | null = null;

  async initRuntimeConfig() {
    if (typeof window === "undefined" || (window as any).electronAPI) return;
    if (typeof fetch !== "function") return;

    try {
      const origin =
        window.location.origin ||
        `${window.location.protocol}//${window.location.host}`;
      const res = await fetch(`${origin}/config.json`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          this.runtimeConfig = data;
          if (data.wsPort && typeof window !== "undefined") {
            (window as any).__BTICK_RUNTIME_CONFIG__ = data;
          }
        }
      }
    } catch (e) {
      console.warn(
        "[BTick] Could not load /config.json runtime configuration, using default ports:",
        e,
      );
    }
  }

  private getWsPort(): string {
    if (typeof window !== "undefined") {
      try {
        const queryParams = new URLSearchParams(window.location.search);
        const queryPort =
          queryParams.get("ws_port") || queryParams.get("wsPort");
        if (queryPort) return queryPort;
      } catch (e) {}
      if ((window as any).__BTICK_WS_PORT__)
        return String((window as any).__BTICK_WS_PORT__);
      if (this.runtimeConfig?.wsPort) return String(this.runtimeConfig.wsPort);
      if ((window as any).__BTICK_RUNTIME_CONFIG__?.wsPort) {
        return String((window as any).__BTICK_RUNTIME_CONFIG__.wsPort);
      }
    }
    return "8080";
  }

  private connectWS() {
    if (typeof window === "undefined") return;

    try {
      const host = window.location.hostname || "127.0.0.1";
      const wsPort = this.getWsPort();
      const protocol =
        typeof window.location !== "undefined" &&
        window.location.protocol === "https:"
          ? "wss:"
          : "ws:";
      const wsUrl = `${protocol}//${host}:${wsPort}`;

      if (this.ws) {
        try {
          this.ws.onopen = null;
          this.ws.onmessage = null;
          this.ws.onclose = null;
          this.ws.onerror = null;
          this.ws.close();
        } catch (e) {}
        this.ws = null;
      }

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.notifyStatus(true);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "get_tree" }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data) {
            this.notifyMessage(data);
            if (!this.isConnected) {
              this.isConnected = true;
              this.notifyStatus(true);
            }
          }
        } catch (err) {}
      };

      this.ws.onclose = () => {
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectWS();
          }, 2000);
        }
      };

      this.ws.onerror = () => {
        // Will reconnect on close
      };
    } catch (e) {
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connectWS();
        }, 2000);
      }
    }
  }

  onMessage(handler: MessageHandler) {
    this.messageListeners.add(handler);
    return () => this.messageListeners.delete(handler);
  }

  onStatusChange(handler: StatusHandler) {
    this.statusListeners.add(handler);
    handler(this.isConnected);
    return () => this.statusListeners.delete(handler);
  }

  notifyMessage(data: any) {
    this.messageListeners.forEach((handler) => {
      try {
        handler(data);
      } catch (err) {}
    });
  }

  sendCommand(command: any) {
    // 1. Send via Electron IPC (Priority when running in Electron)
    if (
      typeof window !== "undefined" &&
      (window as any).electronAPI?.sendCommand
    ) {
      (window as any).electronAPI.sendCommand(command);
      return;
    }

    // 2. Send via WebSocket fallback for standalone browser
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "command",
          data: command,
        }),
      );
    }
  }

  sendUserLog(log: UserLog) {
    this.sendCommand({
      action: "user_log",
      source: log.protocol,
      log,
    });
  }

  switchSource(source: "btick"): void;
  switchSource(source: "groot2", host: string, port: number): void;
  switchSource(source: "nav2", topic?: string): void;
  switchSource(
    source: "btick" | "groot2" | "nav2",
    hostOrTopic?: string,
    port?: number,
    topic?: string,
  ) {
    const nav2Topic = source === "nav2" ? hostOrTopic : topic;
    const host = source === "groot2" ? hostOrTopic : undefined;
    const payload: {
      type: "switch_source";
      source: "btick" | "groot2" | "nav2";
      host?: string;
      port?: number;
      topic?: string;
    } = {
      type: "switch_source",
      source,
    };
    if (source !== "btick") {
      payload.host = host;
      payload.port = port;
      payload.topic = nav2Topic;
    }

    // 1. Forward via Electron IPC (Priority when running in Electron)
    if (
      typeof window !== "undefined" &&
      (window as any).electronAPI?.switchSource
    ) {
      (window as any).electronAPI.switchSource(payload);
      return;
    }

    // 2. Forward via WebSocket fallback for standalone browser
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  notifyStatus(connected: boolean) {
    this.isConnected = connected;
    this.statusListeners.forEach((handler) => {
      try {
        handler(connected);
      } catch (err) {}
    });
  }
}

export { ROS2Service };
export const ros2Service = new ROS2Service();
export const wsService = ros2Service;
