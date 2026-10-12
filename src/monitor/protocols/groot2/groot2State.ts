import { ProtocolSessionState, ProtocolCapabilities } from "../types";

export interface Groot2SessionState extends ProtocolSessionState {
  protocol: "groot2";
  host?: string;
  port?: number;
}

export const GROOT2_CAPABILITIES: ProtocolCapabilities = {
  supportsBreakpoints: true,
  supportsFaultInjection: true,
  supportsDelayInjection: false,
  supportsInteractiveDecisions: true,
  supportsXmlUpload: false,
  isReadOnly: false,
  supportsBlackboardWrite: false,
  supportsNodePortEdit: false,
};

export const createInitialGroot2Session = (): Groot2SessionState => ({
  protocol: "groot2",
  name: "Groot2 (ZMQ)",
  isConnected: false,
  session: {
    sessionId: "groot2_default_0",
    executionInstanceId: "init_0",
    startedAt: Date.now(),
    lastHeartbeatAt: 0,
    connectionStatus: "DISCONNECTED",
    reconnectAttempts: 0,
  },
  treesMap: new Map(),
  liveTreesMap: new Map(),
  selectedTreeId: null,
  selectedNodeId: null,
  events: [],
  liveEvents: [],
  breakpoints: new Set(),
  breakpointOnceSet: new Set(),
  faultRules: new Map(),
  pausedNodeTreeId: null,
  pausedNodeUid: null,
  pausedNodeName: undefined,
  isPaused: false,
  isRecording: false,
  recordingInitialTrees: [],
  lastRecordedSession: null,
  replayState: {
    isReplaying: false,
    isPlaying: false,
    currentIndex: 0,
    speed: 1.0,
    session: null,
  },
  treeReplays: new Map(),
  treeEvents: new Map(),
  viewMode: "focused",
  orientation: "vertical",
  filters: {
    showRunning: true,
    showSuccess: true,
    showFailure: true,
    showIdle: true,
  },
  host: "127.0.0.1",
  port: 1667,
});
