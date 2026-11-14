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

export interface RuntimeNetworkConfig {
  wsPort?: number | string;
  httpPort?: number | string;
  zmqPort?: number | string;
  lanIp?: string;
  lanUrl?: string;
  wsUrl?: string;
}

class ROS2Service {
  private messageListeners: Set<MessageHandler> = new Set();
  private statusListeners: Set<StatusHandler> = new Set();
  private configListeners: Set<(config: RuntimeNetworkConfig) => void> =
    new Set();
  private isConnected: boolean = false;

  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;

  constructor() {
    // 1. Electron IPC Bridge (Primary in Electron)
    if (typeof window !== "undefined" && (window as any).electronAPI) {
      (window as any).electronAPI.onROS2Event((data: any) => {
        if (data) {
          this.enqueueMessage(data);
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

    // 2. Browser online/offline event listeners for robust network reconnection
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        if (!this.isConnected) {
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.initRuntimeConfig().then(() => this.connectWS());
        }
      });
      window.addEventListener("offline", () => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        if (wasConnected) {
          this.notifyStatus(false);
        }
      });
    }

    // 3. Fetch runtime config then connect to WebSocket Bridge once
    this.initRuntimeConfig().then(() => {
      this.connectWS();
    });
  }

  private runtimeConfig: RuntimeNetworkConfig | null = null;

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
          this.notifyConfig(data);
        }
      }
    } catch (e) {
      console.warn(
        "[BTick] Could not load /config.json runtime configuration, using default ports:",
        e,
      );
    }
  }

  private notifyConfig(config: RuntimeNetworkConfig) {
    this.configListeners.forEach((handler) => {
      try {
        handler(config);
      } catch (err) {}
    });
  }

  onConfigChange(handler: (config: RuntimeNetworkConfig) => void) {
    this.configListeners.add(handler);
    if (this.runtimeConfig) {
      try {
        handler(this.runtimeConfig);
      } catch (err) {}
    }
    return () => this.configListeners.delete(handler);
  }

  getRuntimeConfig(): RuntimeNetworkConfig | null {
    return this.runtimeConfig;
  }

  getWsUrl(): string {
    if (typeof window === "undefined") return "ws://127.0.0.1:8080";
    const host = window.location.hostname || "127.0.0.1";
    const wsPort = this.getWsPort();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${host}:${wsPort}`;
  }

  getLanUrl(): string {
    if (typeof window === "undefined") return "http://127.0.0.1:3000";
    if (this.runtimeConfig?.lanUrl) {
      return this.runtimeConfig.lanUrl;
    }
    const lanIp = this.runtimeConfig?.lanIp;
    const port = this.runtimeConfig?.httpPort || window.location.port || "3000";
    if (lanIp && lanIp !== "127.0.0.1" && lanIp !== "localhost") {
      return `${window.location.protocol}//${lanIp}:${port}`;
    }
    const host =
      window.location.hostname && window.location.hostname !== "localhost"
        ? window.location.hostname
        : lanIp || "127.0.0.1";
    return `${window.location.protocol}//${host}:${port}`;
  }

  getLanIp(): string {
    if (this.runtimeConfig?.lanIp) {
      return this.runtimeConfig.lanIp;
    }
    if (
      typeof window !== "undefined" &&
      window.location.hostname &&
      window.location.hostname !== "localhost"
    ) {
      return window.location.hostname;
    }
    return "127.0.0.1";
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
            this.enqueueMessage(data);
            if (!this.isConnected) {
              this.isConnected = true;
              this.notifyStatus(true);
            }
          }
        } catch (err) {}
      };

      this.ws.onclose = () => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        if (wasConnected) {
          this.notifyStatus(false);
        }
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            await this.initRuntimeConfig();
            this.connectWS();
          }, 2000);
        }
      };

      this.ws.onerror = () => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        if (wasConnected) {
          this.notifyStatus(false);
        }
      };
    } catch (e) {
      const wasConnected = this.isConnected;
      this.isConnected = false;
      if (wasConnected) {
        this.notifyStatus(false);
      }
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(async () => {
          this.reconnectTimer = null;
          await this.initRuntimeConfig();
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

  // Incoming bridge messages are coalesced and delivered in batches: at most
  // once per animation frame and at most every MIN_FLUSH_INTERVAL_MS. Every
  // delivered message usually ends in a React state update; dispatching them
  // all from one task lets React batch them into a single render instead of
  // re-rendering the whole app per message (reactive trees easily produce
  // 1000+ transitions/s). Hidden tabs (no animation frames) are still
  // drained by the timer so the bridge never has to buffer for them.
  private static readonly MIN_FLUSH_INTERVAL_MS = 100;
  private pendingMessages: any[] = [];
  private flushScheduled = false;
  private lastFlushAt = 0;
  private flushRafId: number | null = null;
  private flushTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private enqueueMessage(data: any) {
    this.pendingMessages.push(data);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const wait = Math.max(
      0,
      this.lastFlushAt + ROS2Service.MIN_FLUSH_INTERVAL_MS - Date.now(),
    );
    this.flushTimeoutId = setTimeout(() => {
      this.flushTimeoutId = null;
      if (
        typeof requestAnimationFrame === "function" &&
        typeof document !== "undefined" &&
        !document.hidden
      ) {
        this.flushRafId = requestAnimationFrame(() => this.flushMessages());
        // In case the tab gets hidden before the frame fires.
        this.flushTimeoutId = setTimeout(() => this.flushMessages(), 250);
      } else {
        this.flushMessages();
      }
    }, wait);
  }

  private flushMessages() {
    if (this.flushRafId !== null) {
      cancelAnimationFrame(this.flushRafId);
      this.flushRafId = null;
    }
    if (this.flushTimeoutId !== null) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }
    this.flushScheduled = false;
    this.lastFlushAt = Date.now();
    const batch = this.pendingMessages;
    this.pendingMessages = [];
    for (const data of batch) {
      this.notifyMessage(data);
    }
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
