import {
  ProtocolSessionState,
  ProtocolCapabilities,
  LiveStatusDisplayMode,
} from "../types";

export interface BTickSessionState extends ProtocolSessionState {
  protocol: "btick";
  liveStatusDisplayMode: LiveStatusDisplayMode;
}

export const BTICK_CAPABILITIES: ProtocolCapabilities = {
  supportsBreakpoints: true,
  supportsFaultInjection: true,
  supportsDelayInjection: true,
  supportsInteractiveDecisions: true,
  supportsXmlUpload: false,
  isReadOnly: false,
  supportsBlackboardWrite: true,
  supportsNodePortEdit: true,
};

export const createInitialBTickSession = (): BTickSessionState => ({
  protocol: "btick",
  name: "BTick",
  isConnected: false,
  session: {
    sessionId: "btick_default_0",
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
  liveStatusDisplayMode: "current",
});
