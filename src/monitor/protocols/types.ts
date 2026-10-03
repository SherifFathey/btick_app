import { 
  BTTreeModel, 
  TransitionEvent, 
  FaultRule, 
  RecordingSession, 
  RecordingSnapshot,
  ReplayState, 
  ViewMode, 
  TreeOrientation, 
  StatusFilterOptions 
} from '../types/bt';
import { NodeStatus } from '../types/bt';

export type ProtocolSource = 'btick' | 'groot2' | 'nav2';
export type LiveStatusDisplayMode = 'current' | 'parent_retick_reset';

export const MAX_RAM_EVENT_HISTORY = 1000;
export const ENABLE_LIVE_SESSION_RECORDING = false;

export interface ProtocolCapabilities {
  supportsBreakpoints: boolean;
  supportsFaultInjection: boolean;
  supportsDelayInjection: boolean;
  supportsInteractiveDecisions: boolean;
  supportsXmlUpload: boolean;
  isReadOnly: boolean;
  supportsBlackboardWrite: boolean;
  supportsNodePortEdit: boolean;
}

export type ProtocolConnectionStatus = 
  | 'CONNECTED_RUNNING'  // Connected & actively executing tree
  | 'CONNECTED_IDLE'     // Connected & tree is idle / ready
  | 'RECONNECTING'       // Lost heartbeat or process stopped; auto-reconnecting
  | 'DISCONNECTED';      // Offline

export interface SessionInfo {
  sessionId: string;            // e.g. "btick_MainTree_1724345678900"
  executionInstanceId: string;  // e.g. "bt_inst_1724345678900"
  startedAt: number;
  lastHeartbeatAt: number;
  connectionStatus: ProtocolConnectionStatus;
  reconnectAttempts: number;
}

export interface ProtocolSessionState {
  protocol: ProtocolSource;
  name: string;
  isConnected: boolean;
  session: SessionInfo;
  treesMap: Map<string, BTTreeModel>;
  selectedTreeId: string | null;
  selectedNodeId: string | null;
  events: TransitionEvent[];
  breakpoints: Set<string>; // `${tree_id}::${uid}`
  breakpointOnceSet: Set<string>;
  faultRules: Map<string, FaultRule>;
  pausedNodeTreeId: string | null;
  pausedNodeUid: number | null;
  pausedNodeName?: string;
  isPaused: boolean;
  
  // Isolated recording and replay state
  isRecording: boolean;
  recordingTreeIds?: Set<string>;
  recordingInitialTrees: BTTreeModel[];
  lastRecordedSession: RecordingSession | null;
  currentSession?: RecordingSession | null;
  replayState: ReplayState;
  liveTreesMap?: Map<string, BTTreeModel>;
  closedTreeIds?: Set<string>;
  liveEvents?: TransitionEvent[];
  treeReplays?: Map<string, TreeReplayState>;
  treeEvents?: Map<string, TransitionEvent[]>;

  // Execution Cycle Tracking
  currentCycleId?: string;
  cycleCount?: number;
  nav2Observations?: Record<string, Nav2NodeObservation>;

  // View settings isolated per protocol
  viewMode: ViewMode;
  orientation: TreeOrientation;
  filters: StatusFilterOptions;
}

export interface TreeReplayState {
  protocol: ProtocolSource;
  treeId: string;
  session: RecordingSession | null;
  replayState: ReplayState;
  treesMap: Map<string, BTTreeModel>;
  events: TransitionEvent[];
  lastRecordedSession: RecordingSession | null;
  currentSession?: RecordingSession | null;
}

export interface Nav2NodeObservation {
  uid: number;
  previousStatus: NodeStatus;
  currentStatus: NodeStatus;
  lastResult: 'SUCCESS' | 'FAILURE' | null;
  lastTransitionTimestamp: number;
}


export const createInitialProtocolSession = (protocol: ProtocolSource): ProtocolSessionState => {
  const protocolNames: Record<ProtocolSource, string> = {
    btick: 'BTick',
    groot2: 'Groot2 (ZMQ)',
    nav2: 'Nav2 (ROS 2 Log)',
  };

  return {
    protocol,
    name: protocolNames[protocol] || protocol,
    isConnected: false,
    session: {
      sessionId: `${protocol}_default_0`,
      executionInstanceId: 'init_0',
      startedAt: Date.now(),
      lastHeartbeatAt: 0,
      connectionStatus: 'DISCONNECTED',
      reconnectAttempts: 0,
    },
    treesMap: new Map(),
    selectedTreeId: null,
    selectedNodeId: null,
    events: [],
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
    closedTreeIds: new Set(),
    nav2Observations: {},
    viewMode: 'focused',
    orientation: 'vertical',
    filters: {
      showRunning: true,
      showSuccess: true,
      showFailure: true,
      showIdle: true,
    },
  };
};

export interface IProtocolHandler {
  protocol: ProtocolSource;
  displayName: string;
  badge: string;
  supportsDebugging: boolean;
  supportsFaultInjection: boolean;
  supportsXmlLoad: boolean;
  supportsBlackboardWrite: boolean;
  supportsNodePortEdit: boolean;

  handleMessage(
    data: any,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState;

  handleToggleBreakpoint(
    treeId: string,
    uid: number,
    once: boolean | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState;

  handleSetBreakpointOnce(
    treeId: string,
    uid: number,
    once: boolean,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState;

  handleInjectFault(
    treeId: string,
    uid: number,
    mode: string,
    delayMs: number | undefined,
    once: boolean | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState;

  handleSetFaultOnce(
    treeId: string,
    uid: number,
    once: boolean,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState;

  handleClearFault(
    treeId: string,
    uid: number,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState;

  handleClearAllBreakpoints(
    targetTreeId: string | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState;

  handleClearAllFaults(
    targetTreeId: string | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState;

  handleContinuation(
    action: 'resume' | 'force_success' | 'force_failure',
    targetTreeId: string | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState;

  handleSetBlackboard(
    treeId: string,
    key: string,
    value: any,
    valueType: 'bool' | 'int' | 'double' | 'string',
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
    requestId?: string
  ): ProtocolSessionState;

  handleSetNodePort(
    treeId: string,
    uid: number,
    portName: string,
    value: string,
    mode: string,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
    requestId?: string
  ): ProtocolSessionState;
}
