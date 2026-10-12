export type NodeStatus =
  | "IDLE"
  | "RUNNING"
  | "SUCCESS"
  | "FAILURE"
  | "SKIPPED"
  | "PAUSED_AT_BREAKPOINT";

import { NodeCategory } from "../../shared/types/btCategory";
export type { NodeCategory };

export type TreeStatus =
  | "CREATED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILURE"
  | "IDLE"
  | "STOPPED"
  | "DESTROYED";

export interface BTPortDetail {
  name: string;
  type: string;
  direction: "Input" | "Output" | "Inout" | "Unknown";
  mode: "Literal" | "Blackboard";
  value: string;
  default_value?: string;
  runtime_value?: string;
  description?: string;
}

export interface BTNodeModel {
  id: string;
  uid: number;
  name: string;
  type: string;
  category: NodeCategory;
  parent_id: string;
  children_ids: string[];
  ports: Record<string, string>;
  attributes: Record<string, string>;
  meta?: Record<string, unknown>;
  port_details?: BTPortDetail[];
  output_ports_values?: Record<string, string>;
  status: NodeStatus;
  last_result?: NodeStatus;
  last_start_time?: number;
  last_duration?: number;
  tick_count?: number;
  is_breakpoint?: boolean;
  breakpoint_once?: boolean;
  is_paused?: boolean;
  fault_mode?: FaultMode;
  fault_delay_ms?: number;
  fault_once?: boolean;
  delay_active?: boolean;
  delay_total_ms?: number;
  delay_started_at?: number;
  delay_activation_id?: string;
}

export interface BTTreeModel {
  type: "tree" | "tree_created";
  tree_id: string;
  tree_name: string;
  display_name?: string;
  xml_path?: string;
  status: TreeStatus;
  root_node_id: string;
  nodes: BTNodeModel[];
  visible?: boolean;
  blackboard?: Record<string, any>;
  last_active_node_id?: string;
  origin?: string;
  node_name?: string;
  pid?: number;
  hostname?: string;
  source?: string;
  protocol?: string;
  current_cycle_id?: string;
  cycle_count?: number;
}

export interface BTPortUpdate {
  port_name: string;
  blackboard_key?: string;
  value: string;
  mode?: "Literal" | "Blackboard";
}

export interface TransitionEvent {
  id: string;
  type: "transition";
  source?: string;
  protocol?: string;
  tree_id: string;
  tree_name: string;
  cycle_id?: string;
  node_id: string;
  node_name: string;
  uid: number;
  prev_status: NodeStatus;
  status: NodeStatus;
  duration: number;
  tick_count: number;
  timestamp: number;
  blackboard?: Record<string, any>;
  output_ports?: BTPortUpdate[];
  port_updates?: BTPortUpdate[];
}

export interface ExecutionCycleStartedEvent {
  type: "execution_cycle_started";
  source?: string;
  protocol?: string;
  tree_id: string;
  tree_name?: string;
  cycle_id: string;
  goal_id?: string;
  timestamp: number;
}

export interface RecordingSession {
  id: string;
  name: string;
  recorded_at: string;
  trees: BTTreeModel[];
  events: TransitionEvent[];
  snapshots?: RecordingSnapshot[];
  initial_trees?: BTTreeModel[];
  node_executions?: RecordedNodeExecution[];
}

export interface RecordedNodeExecution {
  tree_id: string;
  node_id: string;
  uid: number;
  status: NodeStatus;
  start_timestamp: number;
  end_timestamp?: number;
  duration?: number;
  tick_count: number;
  start_event_index: number;
  end_event_index?: number;
}

export interface RecordingSnapshot {
  eventIndex: number;
  timestamp: number;
  trees: BTTreeModel[];
}

export interface ReplayState {
  isReplaying: boolean;
  isPlaying: boolean;
  currentIndex: number;
  speed: number;
  session: RecordingSession | null;
  replayTime?: number;
  replaySource?: "record" | "loaded";
}

export type ViewMode = "focused" | "grid";

export type TreeOrientation = "vertical" | "horizontal";
export type EdgePathMode = "orthogonal" | "bezier";

export interface StatusFilterOptions {
  showRunning: boolean;
  showSuccess: boolean;
  showFailure: boolean;
  showIdle: boolean;
}

export type FaultMode =
  | "FORCE_FAILURE"
  | "FORCE_SUCCESS"
  | "FORCE_RUNNING"
  | "FORCE_SKIPPED"
  | "DELAY"
  | "NONE";

export interface FaultRule {
  tree_id: string;
  uid: number;
  mode: FaultMode;
  delay_ms?: number;
  once?: boolean;
}

export interface LiveDebugState {
  breakpoints: Set<string>; // canonical format: `${tree_id}::${uid}`
  breakpointOnceSet?: Set<string>; // canonical format: `${tree_id}::${uid}`
  faultRules: Map<string, FaultRule>; // canonical format: `${tree_id}::${uid}`
  pausedNodeUid: number | null;
  pausedNodeTreeId?: string | null;
  pausedNodeName?: string;
  pausedTreeId?: string;
}
