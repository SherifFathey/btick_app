import { ProtocolSessionState, ProtocolCapabilities } from "../types";

export interface Nav2SessionState extends ProtocolSessionState {
  protocol: "nav2";
  hasSampleLoaded?: boolean;
}

export const NAV2_CAPABILITIES: ProtocolCapabilities = {
  supportsBreakpoints: false,
  supportsFaultInjection: false,
  supportsDelayInjection: false,
  supportsInteractiveDecisions: false,
  supportsXmlUpload: true,
  isReadOnly: true,
  supportsBlackboardWrite: false,
  supportsNodePortEdit: false,
};

export const createInitialNav2Session = (): Nav2SessionState => ({
  protocol: "nav2",
  name: "Nav2 (ROS 2 Log)",
  isConnected: false,
  session: {
    sessionId: "nav2_default_0",
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
  hasSampleLoaded: false,
});
