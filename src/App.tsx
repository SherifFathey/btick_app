import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { ReactFlowProvider, Viewport } from "@xyflow/react";
import {
  X,
  Grid,
  Maximize2,
  FileCode,
  EyeOff,
  Compass,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { ros2Service } from "./monitor/services/ros2Service";
import {
  BTTreeModel,
  BTNodeModel,
  NodeStatus,
  TreeStatus,
  TransitionEvent,
  RecordingSession,
  RecordingSnapshot,
  RecordedNodeExecution,
  ReplayState,
  ViewMode,
  TreeOrientation,
  EdgePathMode,
  StatusFilterOptions,
  BTPortDetail,
} from "./monitor/types/bt";
import {
  ProtocolSource,
  ProtocolSessionState,
  ProtocolConnectionStatus,
  LiveStatusDisplayMode,
  createInitialSessions,
  createInitialProtocolSession,
  getProtocolHandler,
  getProtocolCapabilities,
  routeIncomingMessage,
  detectMessageProtocol,
  updateProtocolHeartbeat,
  normalizeRecordingSession,
  IncrementalKeyframeRecorder,
  TreeReplayState,
  ENABLE_LIVE_SESSION_RECORDING,
} from "./monitor/protocols";
import { compactRecordingRecords } from "./monitor/protocols/session/recordingCompactor";
import {
  SessionStore,
  SESSION_STORE_REPLAY_WARNING_THRESHOLD,
} from "./monitor/protocols/session/sessionStore";
import { BTickSessionState } from "./monitor/protocols/btick/btickState";
import {
  isMatchNode,
  getTreeStatus,
  parseXmlToBTTreeModel,
} from "./monitor/utils/xmlParser";
import { ErrorBoundary } from "./shared/components/ErrorBoundary";
import { Sidebar } from "./shared/components/Sidebar";
import { Header } from "./shared/components/Header";
import { BTGraphContent } from "./monitor/components/BTGraph";
import { NodeDetailsPanel } from "./monitor/components/NodeDetailsPanel";
import { BottomPanel } from "./monitor/components/BottomPanel";
import { ReplayControlBar } from "./monitor/components/ReplayControlBar";
import { BlackboardWatcher } from "./monitor/components/BlackboardWatcher";
import { Nav2PromptModal } from "./monitor/components/Nav2PromptModal";
import { NAV2_DEFAULT_SAMPLE_XML } from "./monitor/constants/nav2Sample";
import { BTEditor } from "./editor";
import { useBTEditor } from "./editor/useBTEditor";
import { BTEditorNodeCategory } from "./editor/types";
import { AppMode } from "./shared/types";

const cloneTreeMap = (treesMap: Map<string, BTTreeModel>): BTTreeModel[] =>
  Array.from(treesMap.values()).map((tree) => ({
    ...tree,
    blackboard: tree.blackboard ? { ...tree.blackboard } : tree.blackboard,
    nodes: tree.nodes.map((node) => ({
      ...node,
      children_ids: [...node.children_ids],
      ports: { ...node.ports },
      attributes: { ...node.attributes },
      meta: node.meta ? { ...node.meta } : node.meta,
      port_details: node.port_details
        ? node.port_details.map((port) => ({ ...port }))
        : node.port_details,
      output_ports_values: node.output_ports_values
        ? { ...node.output_ports_values }
        : node.output_ports_values,
    })),
  }));

const cloneRecordingSession = (
  session: RecordingSession,
): RecordingSession => ({
  ...session,
  trees: cloneTreeMap(
    new Map(session.trees.map((tree) => [tree.tree_id, tree])),
  ),
  events: session.events.map((event) => ({ ...event })),
  snapshots: session.snapshots?.map((snapshot) => ({
    ...snapshot,
    trees: cloneTreeMap(
      new Map(snapshot.trees.map((tree) => [tree.tree_id, tree])),
    ),
  })),
  initial_trees: session.initial_trees
    ? cloneTreeMap(
        new Map(session.initial_trees.map((tree) => [tree.tree_id, tree])),
      )
    : undefined,
  node_executions: session.node_executions?.map((execution) => ({
    ...execution,
  })),
});

export const buildCompositeTreesMap = (
  liveTrees: Map<string, BTTreeModel>,
  treeReplays?: Map<string, TreeReplayState>,
): Map<string, BTTreeModel> => {
  const composite = new Map<string, BTTreeModel>(liveTrees);
  if (treeReplays) {
    for (const [treeId, tr] of treeReplays.entries()) {
      if (tr?.replayState?.isReplaying) {
        const replayTree =
          tr.treesMap.get(treeId) ||
          tr.session?.initial_trees?.find((t) => t.tree_id === treeId) ||
          tr.session?.trees?.find((t) => t.tree_id === treeId);
        if (replayTree) {
          composite.set(treeId, replayTree);
        }
      }
    }
  }
  return composite;
};

export const preserveRecordingState = (
  current: ProtocolSessionState | undefined,
  next: ProtocolSessionState,
): ProtocolSessionState => {
  if (!current) {
    return next;
  }
  return {
    ...next,
    isRecording: Boolean(current.isRecording),
    recordingTreeIds: current.recordingTreeIds
      ? new Set(current.recordingTreeIds)
      : undefined,
    treeReplays: current.treeReplays ? new Map(current.treeReplays) : new Map(),
    treeEvents: next.treeEvents || current.treeEvents || new Map(),
  };
};

/**
 * Converts a live blackboard update (BTick 'blackboard_update_response' success,
 * or Groot2/Nav2 'blackboard_update' push) into a blackboard-only TransitionEvent
 * so it can be recorded in the session event stream.
 *
 * It carries no node identity, so replay's node-status paths skip it while the
 * existing `event.blackboard` merge (applySingleReplayEvent,
 * IncrementalKeyframeRecorder.applyEvent) reconstructs the edits incrementally.
 */
export const buildBlackboardEvent = (
  protocol: ProtocolSource,
  treeId: string,
  blackboard: Record<string, any>,
  timestamp: number | undefined,
  index: number,
  treeName: string = treeId,
): TransitionEvent => ({
  id: `bb_${treeId}_${index}`,
  type: "transition",
  source: protocol,
  protocol,
  tree_id: treeId,
  tree_name: treeName,
  node_id: "",
  node_name: "[Blackboard]",
  uid: 0,
  prev_status: "IDLE",
  status: "IDLE",
  duration: 0,
  tick_count: 0,
  timestamp:
    typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : Date.now() / 1000,
  blackboard,
});

/**
 * Extracts the recordable Blackboard payload from a live protocol message.
 * - 'blackboard_update' (Groot2 poll / Nav2 push) carries a `blackboard` dict.
 * - 'blackboard_update_response' (BTick write result) carries `key`/`value`
 *   and is only recordable on success.
 * Returns null for failures and non-blackboard messages.
 */
export const extractRecordableBlackboardPayload = (
  data: any,
): Record<string, any> | null => {
  if (!data || typeof data !== "object") return null;
  if (
    data.type !== "blackboard_update" &&
    data.type !== "blackboard_update_response"
  )
    return null;
  if (data.blackboard && typeof data.blackboard === "object") {
    return data.blackboard as Record<string, any>;
  }
  if (data.success && data.key) {
    return { [data.key as string]: data.value };
  }
  return null;
};

/**
 * Resolves which recorded tree session a blackboard update belongs to,
 * mirroring the protocol handlers' own tree-resolution fallbacks.
 */
export const resolveBlackboardTreeId = (
  data: any,
  session: ProtocolSessionState,
): string | undefined => {
  const explicitTreeId = data?.tree_id as string | undefined;
  if (explicitTreeId && session.treesMap.has(explicitTreeId))
    return explicitTreeId;
  if (session.treesMap.size === 1) return session.treesMap.keys().next().value;
  if (session.selectedTreeId && session.treesMap.has(session.selectedTreeId)) {
    return session.selectedTreeId;
  }
  return undefined;
};

const buildNodeExecutions = (
  events: TransitionEvent[],
): RecordedNodeExecution[] => {
  const active = new Map<string, RecordedNodeExecution>();
  const executions: RecordedNodeExecution[] = [];
  events.forEach((event, eventIndex) => {
    const key = `${event.tree_id}::${event.uid}::${event.node_id}`;
    if (event.status === "RUNNING") {
      if (!active.has(key)) {
        active.set(key, {
          tree_id: event.tree_id,
          node_id: event.node_id,
          uid: event.uid,
          status: event.status,
          start_timestamp: event.timestamp,
          tick_count: event.tick_count,
          start_event_index: eventIndex,
        });
      }
      return;
    }
    if (
      event.status !== "SUCCESS" &&
      event.status !== "FAILURE" &&
      event.status !== "IDLE"
    )
      return;
    const execution = active.get(key);
    if (!execution) return;
    executions.push({
      ...execution,
      status: event.status,
      end_timestamp: event.timestamp,
      duration:
        event.duration > 0
          ? event.duration
          : Math.max(0, event.timestamp - execution.start_timestamp),
      tick_count: event.tick_count,
      end_event_index: eventIndex,
    });
    active.delete(key);
  });
  executions.push(...active.values());
  return executions;
};

const orderSessionEvents = (events: TransitionEvent[]): TransitionEvent[] =>
  events
    .map((event, index) => ({ event: { ...event }, index }))
    .sort((left, right) => {
      const timestampDelta = left.event.timestamp - right.event.timestamp;
      return timestampDelta !== 0 ? timestampDelta : left.index - right.index;
    })
    .map(({ event }) => event);

export const createReplayBaselineTree = (tree: BTTreeModel): BTTreeModel => ({
  ...tree,
  status: "IDLE",
  last_active_node_id: undefined,
  current_cycle_id: undefined,
  cycle_count: undefined,
  nodes: tree.nodes.map((node) => ({
    ...node,
    meta: node.meta ? { ...node.meta } : node.meta,
    status: "IDLE",
    last_result: undefined,
    last_start_time: undefined,
    last_duration: undefined,
    tick_count: 0,
    output_ports_values: undefined,
    port_details: node.port_details?.map((port) => ({
      ...port,
      runtime_value: undefined,
    })),
  })),
});

export const isReplayEventNodeMatch = (
  node: BTNodeModel,
  event: TransitionEvent,
): boolean => {
  if (event.node_id && node.id === event.node_id) return true;
  if (event.uid > 0 && node.uid > 0) return node.uid === event.uid;
  if (event.node_id && node.name === event.node_id) return true;
  if (event.uid === 0 && event.node_name) {
    return node.name === event.node_name || node.type === event.node_name;
  }
  return false;
};

export const getReplayNodeStatus = (
  node: BTNodeModel,
  event: TransitionEvent,
): NodeStatus => {
  if (
    event.status === ("NODE_PORT_UPDATE" as any) ||
    event.status === ("BLACKBOARD_UPDATE" as any)
  ) {
    return node.status;
  }
  if (
    event.status === "IDLE" &&
    (node.status === "SUCCESS" || node.status === "FAILURE")
  ) {
    return node.status;
  }
  return event.status;
};

export const mirrorReplayRootStatus = (tree: BTTreeModel): BTTreeModel => {
  const root =
    tree.nodes.find((node) => node.id === tree.root_node_id) ||
    tree.nodes.find((node) => node.type === "Root" || node.name === "Root");
  const firstChild = root
    ? tree.nodes.find((node) => node.parent_id === root.id)
    : undefined;
  if (!root || !firstChild) return tree;

  return {
    ...tree,
    status: firstChild.status as TreeStatus,
    nodes: tree.nodes.map((node) =>
      node.id === root.id ? { ...node, status: firstChild.status } : node,
    ),
  };
};

const executionMapCache = new WeakMap<
  RecordingSession,
  Map<string, RecordedNodeExecution>
>();

export const getReplayExecutionMap = (
  session: RecordingSession,
): Map<string, RecordedNodeExecution> => {
  let map = executionMapCache.get(session);
  if (map) return map;

  map = new Map<string, RecordedNodeExecution>();
  if (session.node_executions) {
    for (const candidate of session.node_executions) {
      if (candidate.start_event_index !== undefined) {
        map.set(
          `${candidate.tree_id}::${candidate.uid}::start::${candidate.start_event_index}`,
          candidate,
        );
      }
      if (candidate.end_event_index !== undefined) {
        map.set(
          `${candidate.tree_id}::${candidate.uid}::end::${candidate.end_event_index}::${candidate.status}`,
          candidate,
        );
      }
    }
  }
  executionMapCache.set(session, map);
  return map;
};

export const applySingleReplayEvent = (
  treeMap: Map<string, BTTreeModel>,
  event: TransitionEvent,
  eventIndex: number,
  executionMap: Map<string, RecordedNodeExecution>,
): void => {
  const targetTreeId =
    event.tree_id ||
    (treeMap.size === 1 ? treeMap.keys().next().value : undefined);
  const targetTree = targetTreeId ? treeMap.get(targetTreeId) : undefined;
  if (!targetTree) return;

  const execution =
    event.status === "RUNNING"
      ? executionMap.get(`${event.tree_id}::${event.uid}::start::${eventIndex}`)
      : executionMap.get(
          `${event.tree_id}::${event.uid}::end::${eventIndex}::${event.status}`,
        );

  let matchedNodeId: string | undefined = undefined;
  const updatedNodes = targetTree.nodes.map((node) => {
    if (!isReplayEventNodeMatch(node, event)) return node;
    matchedNodeId = node.id;
    const replayStatus = getReplayNodeStatus(node, event);
    const outputPortsValues = event.output_ports?.length
      ? event.output_ports.reduce<Record<string, string>>(
          (values, update) => ({ ...values, [update.port_name]: update.value }),
          { ...(node.output_ports_values || {}) },
        )
      : node.output_ports_values;
    const portUpdates = [
      ...(event.output_ports || []),
      ...(event.port_updates || []),
    ];
    let portDetails = node.port_details;
    if (portUpdates.length) {
      const seen = new Set<string>();
      const nextDetails: BTPortDetail[] = (node.port_details || []).map(
        (port) => {
          seen.add(port.name);
          const update = portUpdates.find(
            (candidate) => candidate.port_name === port.name,
          );
          return update
            ? {
                ...port,
                value: update.value,
                mode:
                  update.mode ||
                  port.mode ||
                  (String(update.value).startsWith("{") &&
                  String(update.value).endsWith("}")
                    ? "Blackboard"
                    : "Literal"),
                runtime_value: undefined,
              }
            : port;
        },
      );
      portUpdates.forEach((update) => {
        if (!seen.has(update.port_name)) {
          seen.add(update.port_name);
          const isBB =
            update.mode === "Blackboard" ||
            (String(update.value).startsWith("{") &&
              String(update.value).endsWith("}"));
          nextDetails.push({
            name: update.port_name,
            direction: "Unknown",
            type: "string",
            mode: isBB ? "Blackboard" : "Literal",
            value: update.value,
          });
        }
      });
      portDetails = nextDetails;
    }
    const updatedPorts = { ...node.ports };
    const updatedAttributes = { ...node.attributes };
    portUpdates.forEach((update) => {
      const isBB =
        update.mode === "Blackboard" ||
        (String(update.value).startsWith("{") &&
          String(update.value).endsWith("}"));
      if (isBB) {
        updatedPorts[update.port_name] = update.value;
        delete updatedAttributes[update.port_name];
      } else {
        updatedAttributes[update.port_name] = update.value;
        delete updatedPorts[update.port_name];
      }
    });
    return {
      ...node,
      status: replayStatus,
      last_result:
        event.status === "SUCCESS" || event.status === "FAILURE"
          ? event.status
          : node.last_result,
      last_start_time: execution?.start_timestamp ?? node.last_start_time,
      last_duration: execution?.duration ?? event.duration,
      tick_count: execution?.tick_count ?? event.tick_count,
      output_ports_values: outputPortsValues,
      port_details: portDetails,
      ports: updatedPorts,
      attributes: updatedAttributes,
    };
  });

  treeMap.set(
    targetTree.tree_id,
    mirrorReplayRootStatus({
      ...targetTree,
      nodes: updatedNodes,
      blackboard: event.blackboard
        ? { ...(targetTree.blackboard || {}), ...event.blackboard }
        : targetTree.blackboard,
      last_active_node_id: matchedNodeId ?? targetTree.last_active_node_id,
    }),
  );
};

export const applyRecordedSnapshot = (
  treeMap: Map<string, BTTreeModel>,
  recordedSnapshot: RecordingSnapshot,
): void => {
  recordedSnapshot.trees.forEach((snapshotTree) => {
    const currentTree = treeMap.get(snapshotTree.tree_id);
    if (!currentTree) return;
    const snapshotNodes = new Map(
      snapshotTree.nodes.map((node) => [node.id, node]),
    );
    // The snapshot may lag behind blackboard events already applied from
    // session.events (keyframes are captured periodically). Keep the newer
    // merged blackboard so an incremental snapshot refresh cannot revert
    // recorded blackboard edits.
    const mergedBlackboard = {
      ...(snapshotTree.blackboard || {}),
      ...(currentTree.blackboard || {}),
    };
    treeMap.set(snapshotTree.tree_id, {
      ...currentTree,
      status: snapshotTree.status,
      current_cycle_id: snapshotTree.current_cycle_id,
      cycle_count: snapshotTree.cycle_count,
      blackboard: mergedBlackboard,
      nodes: currentTree.nodes.map((node) => {
        const snapshotNode = snapshotNodes.get(node.id);
        if (!snapshotNode) return node;
        return {
          ...snapshotNode,
          status: node.status,
          last_result: node.last_result,
          last_start_time: node.last_start_time,
          last_duration: node.last_duration,
          tick_count: node.tick_count,
          output_ports_values:
            snapshotNode.output_ports_values || node.output_ports_values,
          port_details: snapshotNode.port_details || node.port_details,
          ports: snapshotNode.ports || node.ports,
          attributes: snapshotNode.attributes || node.attributes,
        };
      }),
    });
  });
  treeMap.forEach((tree, treeId) => {
    treeMap.set(treeId, mirrorReplayRootStatus(tree));
  });
};

export const REPLAY_INCREMENTAL_FORWARD_THRESHOLD = 50;

export const findEventIndexForTimestamp = (
  events: TransitionEvent[],
  targetTimestamp: number,
): number => {
  if (!events || events.length === 0) return -1;
  const firstTs = Number(events[0]?.timestamp);
  if (!Number.isFinite(firstTs) || targetTimestamp < firstTs) return -1;
  const lastTs = Number(events[events.length - 1]?.timestamp);
  if (Number.isFinite(lastTs) && targetTimestamp >= lastTs)
    return events.length - 1;

  let low = 0;
  let high = events.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const midTs = Number(events[mid]?.timestamp);
    if (midTs <= targetTimestamp) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
};

export const applyFallbackReplayRange = (
  session: RecordingSession,
  eventsToApply: TransitionEvent[],
): Map<string, BTTreeModel> => {
  const nextMap = new Map<string, BTTreeModel>();
  session.trees.forEach((origTree) => {
    const baselineTree = createReplayBaselineTree(origTree);
    let currentNodes: BTNodeModel[] = baselineTree.nodes;

    const treeEvents = eventsToApply.filter(
      (e) =>
        e.tree_id === origTree.tree_id ||
        session.trees.length === 1 ||
        (e.tree_id === "Nav2Navigation" &&
          (origTree.tree_id === "MainTree" ||
            origTree.tree_name === "MainTree")),
    );

    for (const ev of treeEvents) {
      currentNodes = currentNodes.map((n) => {
        if (isReplayEventNodeMatch(n, ev)) {
          return {
            ...n,
            status: getReplayNodeStatus(n, ev),
            last_duration:
              ev.duration !== undefined && ev.duration > 0
                ? ev.duration
                : n.last_duration,
            tick_count: (n.tick_count || 0) + (ev.status === "RUNNING" ? 1 : 0),
          };
        }
        return n;
      });
    }

    const rootChild =
      currentNodes.find((n) => n.parent_id === origTree.root_node_id) ||
      currentNodes.find(
        (n) =>
          n.type !== "Root" &&
          (n.parent_id === "" || n.parent_id.startsWith("Root") || n.uid === 1),
      );
    const hasRunning = currentNodes.some(
      (n) => n.type !== "Root" && n.name !== "Root" && n.status === "RUNNING",
    );

    let nextTreeStatus: TreeStatus = "IDLE";
    if (
      rootChild &&
      (rootChild.status === "FAILURE" || rootChild.status === "SUCCESS")
    ) {
      nextTreeStatus = rootChild.status as TreeStatus;
    } else if (hasRunning) {
      nextTreeStatus = "RUNNING";
    } else {
      nextTreeStatus = "IDLE";
    }

    currentNodes = currentNodes.map((n) => {
      if (
        (n.type === "Root" || n.name === "Root") &&
        (n.parent_id === "" || !n.parent_id)
      ) {
        return {
          ...n,
          status: (nextTreeStatus === "CREATED"
            ? "IDLE"
            : nextTreeStatus) as NodeStatus,
        };
      }
      return n;
    });

    const lastEv = treeEvents[treeEvents.length - 1];
    let lastActiveNodeId: string | undefined = undefined;
    if (lastEv) {
      const matched = currentNodes.find((n) =>
        isReplayEventNodeMatch(n, lastEv),
      );
      if (matched && matched.type !== "Root" && matched.name !== "Root") {
        lastActiveNodeId = matched.id;
      }
    }

    nextMap.set(
      origTree.tree_id,
      mirrorReplayRootStatus({
        ...baselineTree,
        status: nextTreeStatus,
        last_active_node_id: lastActiveNodeId,
        nodes: currentNodes,
      }),
    );
  });
  return nextMap;
};

export const buildRecordingSession = (
  state: ProtocolSessionState,
  source: "recording" | "saved" = "saved",
  liveRecording?: {
    events: TransitionEvent[];
    snapshots: RecordingSnapshot[];
    initialTrees: BTTreeModel[];
  },
): RecordingSession | null => {
  if (source === "recording") {
    const events = (liveRecording?.events || []).map((event) => ({ ...event }));
    const snapshots = liveRecording?.snapshots || [];
    const initialTrees =
      liveRecording?.initialTrees || state.recordingInitialTrees;
    if (events.length === 0 && initialTrees.length === 0) return null;

    return {
      id: `session_${Date.now()}`,
      name: `BT_Session_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "_")}`,
      recorded_at: new Date().toISOString(),
      trees: cloneTreeMap(state.treesMap),
      events,
      snapshots: snapshots.map((snapshot) => ({
        ...snapshot,
        trees: cloneTreeMap(
          new Map(snapshot.trees.map((tree) => [tree.tree_id, tree])),
        ),
      })),
      initial_trees: cloneTreeMap(
        new Map(initialTrees.map((tree) => [tree.tree_id, tree])),
      ),
      node_executions: buildNodeExecutions(events),
    };
  }

  return state.replayState.session || state.lastRecordedSession
    ? cloneRecordingSession(
        state.replayState.session || state.lastRecordedSession!,
      )
    : null;
};

export const getTreeStoreKey = (
  protocol: ProtocolSource,
  treeId: string,
): string => `${protocol}::${treeId}`;

export const getCurrentSessionForSave = (
  state: ProtocolSessionState,
  storeSession?: RecordingSession | null,
  activeTreeId?: string | null,
): RecordingSession | null => {
  const treeReplay = activeTreeId
    ? state.treeReplays?.get(activeTreeId)
    : undefined;
  const isTreeReplaying =
    treeReplay?.replayState?.isReplaying ??
    state.replayState?.isReplaying ??
    false;

  const currentTreesMap = isTreeReplaying
    ? state.liveTreesMap || state.treesMap
    : state.treesMap;

  // Resolve scoped trees for the specific active tree
  let scopedTrees: BTTreeModel[];
  if (activeTreeId && currentTreesMap.has(activeTreeId)) {
    scopedTrees = [
      cloneTreeMap(
        new Map([[activeTreeId, currentTreesMap.get(activeTreeId)!]]),
      )[0],
    ];
  } else {
    scopedTrees = cloneTreeMap(currentTreesMap);
  }

  // If we have the full unbounded session from SessionStore, use it.
  if (storeSession) {
    let scopedEvents: TransitionEvent[];
    if (activeTreeId && currentTreesMap.has(activeTreeId)) {
      scopedEvents = storeSession.events.filter(
        (ev) => !ev.tree_id || ev.tree_id === activeTreeId,
      );
    } else {
      scopedEvents = storeSession.events;
    }
    const events = orderSessionEvents(scopedEvents);
    return {
      ...storeSession,
      trees: scopedTrees,
      events,
      initial_trees:
        storeSession.initial_trees && storeSession.initial_trees.length > 0
          ? activeTreeId
            ? storeSession.initial_trees.filter(
                (t) => t.tree_id === activeTreeId,
              )
            : storeSession.initial_trees
          : scopedTrees,
      node_executions: buildNodeExecutions(events),
    };
  }

  // If in active replay, allow saving the loaded/replaying session
  if (isTreeReplaying) {
    const replaySession =
      treeReplay?.replayState?.session ||
      treeReplay?.session ||
      treeReplay?.currentSession ||
      state.replayState.session ||
      state.currentSession;
    if (replaySession) {
      return cloneRecordingSession(replaySession);
    }
  }

  // Live session without storeSession: fallback to in-memory live tree and events
  const liveEvents =
    activeTreeId && state.treeEvents?.has(activeTreeId)
      ? state.treeEvents.get(activeTreeId)
      : state.liveEvents || state.events;
  if (scopedTrees.length > 0 || (liveEvents && liveEvents.length > 0)) {
    const scopedEvents =
      activeTreeId && liveEvents && !state.treeEvents?.has(activeTreeId)
        ? liveEvents.filter((ev) => !ev.tree_id || ev.tree_id === activeTreeId)
        : liveEvents || [];
    const events = orderSessionEvents(scopedEvents);
    return {
      id: `session_${Date.now()}`,
      name: `BT_Session_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "_")}`,
      recorded_at: new Date(
        state.session?.startedAt || Date.now(),
      ).toISOString(),
      trees: scopedTrees,
      events,
      snapshots: [],
      initial_trees: scopedTrees,
      node_executions: buildNodeExecutions(events),
    };
  }

  return null;
};

export const getRecordedSessionForSave = (
  state: ProtocolSessionState,
  activeTreeId?: string | null,
): RecordingSession | null => {
  if (activeTreeId && state.treeReplays?.has(activeTreeId)) {
    const tr = state.treeReplays.get(activeTreeId)!;
    const sess =
      tr.lastRecordedSession || tr.session || tr.replayState?.session;
    if (sess) return cloneRecordingSession(sess);
  }
  return state.lastRecordedSession
    ? cloneRecordingSession(state.lastRecordedSession)
    : null;
};

export const formatSaveTimestamp = (date: Date): string => {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}_${pad(date.getMinutes())}_${pad(date.getSeconds())}`;
};

export const getSaveFilename = (
  kind: "session" | "record",
  date: Date,
): string =>
  `BT_${kind === "session" ? "Session" : "Record"}_${formatSaveTimestamp(date)}.json`;

export interface TreeSessionPersistenceState {
  protocol: ProtocolSource;
  treeId: string;
  sessionId: string;
  store: SessionStore;
  keyframeRecorder: IncrementalKeyframeRecorder;
  eventCount: number;
  persistedEventKeys: Set<string>;
  /** Last blackboard state observed for this tree; the baseline for delta detection. */
  recordedBlackboard?: Record<string, any>;
  startTimestamp: number;
  initialTrees: BTTreeModel[];
  isRecording: boolean;
  recordingStartTimestamp?: number;
  stopPromise: Promise<void> | null;
}

export type TreeRecordingState = TreeSessionPersistenceState;

/**
 * Persists one session event through the existing always-on recording pipeline:
 * content dedup → SessionStore append → incremental keyframe tracking.
 * Used for both BT transitions and recorded Blackboard edits.
 */
export const recordSessionEvent = (
  sessionState: TreeSessionPersistenceState,
  event: TransitionEvent,
): void => {
  if (!sessionState || sessionState.stopPromise) return;
  const eventKey = JSON.stringify(event);
  if (sessionState.persistedEventKeys.has(eventKey)) return;
  sessionState.persistedEventKeys.add(eventKey);
  const eventIndex = sessionState.eventCount;
  sessionState.eventCount += 1;
  sessionState.store.appendEvent(event);
  sessionState.keyframeRecorder.applyEvent(event, eventIndex);
  if (sessionState.keyframeRecorder.shouldCaptureKeyframe(eventIndex)) {
    const keyframe = sessionState.keyframeRecorder.captureKeyframe(
      eventIndex,
      event.timestamp,
    );
    sessionState.store.appendSnapshot(keyframe);
  }
};

/**
 * Diffs an incoming Blackboard payload against the last recorded state.
 * Returns only the changed key/value pairs (null when nothing changed),
 * then advances the tracked baseline. Groot2 re-broadcasts the full
 * blackboard every 500ms, so unchanged broadcasts must not be recorded.
 */
export const buildRecordableBlackboardDelta = (
  sessionState: TreeSessionPersistenceState,
  incoming: Record<string, any>,
): Record<string, any> | null => {
  const baseline = sessionState.recordedBlackboard || {};
  const delta: Record<string, any> = {};
  let hasChanges = false;
  for (const key of Object.keys(incoming)) {
    const previousValue = baseline[key];
    const incomingValue = incoming[key];
    const valuesMatch =
      Object.is(previousValue, incomingValue) ||
      (typeof previousValue === "object" &&
        previousValue !== null &&
        typeof incomingValue === "object" &&
        incomingValue !== null &&
        JSON.stringify(previousValue) === JSON.stringify(incomingValue));
    if (!valuesMatch) {
      delta[key] = incomingValue;
      hasChanges = true;
    }
  }
  sessionState.recordedBlackboard = { ...baseline, ...incoming };
  return hasChanges ? delta : null;
};

export const getCorrelatedCommandError = (
  data: any,
  action: "set_blackboard" | "set_node_port" | string,
  requestId: string,
  treeId?: string,
): string | null => {
  if (
    data?.type !== "command_error" ||
    (data.action && data.action !== action) ||
    (data.request_id && data.request_id !== requestId) ||
    (!data.request_id && requestId) ||
    (treeId && data.tree_id && data.tree_id !== treeId)
  ) {
    return null;
  }
  return typeof data.error === "string" && data.error
    ? data.error
    : `Failed to execute ${action}`;
};

export const App: React.FC = () => {
  const [appMode, setAppMode] = useState<AppMode>("monitor");
  const treeViewportsRef = useRef<Map<string, Viewport>>(new Map());
  const treeNodePositionsRef = useRef<
    Map<string, Record<string, { x: number; y: number }>>
  >(new Map());
  const treeCollapsedNodesRef = useRef<Map<string, string[]>>(new Map());
  const [treePathModes, setTreePathModes] = useState<Map<string, EdgePathMode>>(
    new Map(),
  );
  const [treeOrientations, setTreeOrientations] = useState<
    Map<string, TreeOrientation>
  >(new Map());
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [editorInitialXml, setEditorInitialXml] = useState<string | undefined>(
    undefined,
  );
  const editorState = useBTEditor(editorInitialXml);

  // Ref that BTEditorCanvas (inside BTEditor) writes its viewport-center callback into.
  // We pass this to BTEditor so that when the user adds a node from the sidebar palette
  // (which lives outside BTEditor), we can still get the correct canvas viewport position.
  const editorPlacementPositionRef = useRef<
    (() => { x: number; y: number }) | null
  >(null);

  const handleEditorPaletteAdd = useCallback(
    (nodeType: string, parentId?: string | null, targetTreeId?: string) => {
      const isSubtreeRef = nodeType.startsWith("SubTree:");
      const actualType = isSubtreeRef ? "SubTree" : nodeType;
      const subtreeId = isSubtreeRef
        ? nodeType.replace("SubTree:", "")
        : undefined;
      const centerPos = editorPlacementPositionRef.current
        ? editorPlacementPositionRef.current()
        : undefined;
      editorState.addNode(
        parentId ?? null,
        actualType,
        undefined,
        undefined,
        targetTreeId,
        centerPos,
      );
    },
    [editorState],
  );

  const handleEditorDeleteNode = useCallback(
    (nodeId: string) => {
      editorState.deleteNode(nodeId);
    },
    [editorState],
  );

  const handleEditorSave = useCallback(() => {
    editorState.saveDocument();
  }, [editorState]);

  const handleEditorRegisterCustomNode = useCallback(
    (type: string, category: BTEditorNodeCategory) => {
      editorState.document.nodeModels[type] = {
        type,
        category,
      };
    },
    [editorState],
  );

  const [isEditorRawXmlModalOpen, setIsEditorRawXmlModalOpen] = useState(false);
  const [isEditorValidationModalOpen, setIsEditorValidationModalOpen] =
    useState(false);

  const editorTreeOrderList = useMemo(() => {
    return editorState.document.treeOrder &&
      editorState.document.treeOrder.length > 0
      ? editorState.document.treeOrder
      : Object.keys(editorState.document.trees);
  }, [editorState.document.treeOrder, editorState.document.trees]);

  const [isConnected, setIsConnected] = useState(false);
  const [activeProtocol, setActiveProtocol] = useState<ProtocolSource>("btick");
  const [sessions, setSessions] = useState<
    Record<ProtocolSource, ProtocolSessionState>
  >(createInitialSessions);

  const [centerTarget, setCenterTarget] = useState<{
    nodeId: string;
    timestamp: number;
  } | null>(null);
  const [isBlackboardOpen, setIsBlackboardOpen] = useState(false);
  const [isNav2PromptOpen, setIsNav2PromptOpen] = useState(false);
  const [actionWarning, setActionWarning] = useState<string | null>(null);

  const treeSessionsRef = useRef<Map<string, TreeSessionPersistenceState>>(
    new Map(),
  );
  const recordingStartTimesRef = useRef<Map<string, number>>(new Map());
  const replayTimerRef = useRef<any>(null);
  const replayClockRef = useRef<
    Map<
      string,
      {
        wallStart: number;
        recordedStart: number;
        speed: number;
        sessionId: string;
        appliedIndex: number;
      }
    >
  >(new Map());
  const lastAppliedReplayRef = useRef<
    Map<string, { sessionId: string; index: number }>
  >(new Map());

  const getOrCreateTreeSession = useCallback(
    (
      protocol: ProtocolSource,
      treeId: string,
      targetTree?: BTTreeModel,
    ): TreeSessionPersistenceState | undefined => {
      if (!ENABLE_LIVE_SESSION_RECORDING) {
        return undefined;
      }
      const storeKey = getTreeStoreKey(protocol, treeId);
      let sessionState = treeSessionsRef.current.get(storeKey);
      if (!sessionState) {
        const startTimestamp = Date.now();
        const sanitizedTreeId = treeId.replace(/[^a-zA-Z0-9_-]/g, "_");
        const sessionId = `${protocol}_${sanitizedTreeId}_${startTimestamp}`;
        const initialTrees = targetTree ? [targetTree] : [];
        const store = new SessionStore();
        const keyframeRecorder = new IncrementalKeyframeRecorder(initialTrees);
        sessionState = {
          protocol,
          treeId,
          sessionId,
          store,
          keyframeRecorder,
          eventCount: 0,
          persistedEventKeys: new Set(),
          recordedBlackboard: targetTree?.blackboard
            ? { ...targetTree.blackboard }
            : {},
          startTimestamp,
          initialTrees,
          isRecording: false,
          stopPromise: null,
        };
        treeSessionsRef.current.set(storeKey, sessionState);
        void store.startSession(
          sessionId,
          targetTree ? cloneTreeMap(new Map([[treeId, targetTree]])) : [],
          {
            name: `${protocol} - ${targetTree?.tree_name || treeId}`,
            recorded_at: new Date(startTimestamp).toISOString(),
          },
        );
      } else if (targetTree && sessionState.initialTrees.length === 0) {
        sessionState.initialTrees = [targetTree];
        sessionState.keyframeRecorder.ensureTree(targetTree);
        // Seed the blackboard baseline so full-scope broadcasts (e.g. Groot2's
        // 500ms poll) don't re-record the tree's already-discovered values.
        sessionState.recordedBlackboard = {
          ...sessionState.recordedBlackboard,
          ...(targetTree.blackboard || {}),
        };
      }
      return sessionState;
    },
    [],
  );

  // Active Session values
  const currentSession =
    sessions[activeProtocol] || createInitialProtocolSession(activeProtocol);
  const treesMap = currentSession.treesMap;
  const selectedTreeId = currentSession.selectedTreeId;
  const selectedNodeId = currentSession.selectedNodeId;
  const pausedNodeTreeId = currentSession.pausedNodeTreeId;
  const pausedNodeUid = currentSession.pausedNodeUid;
  const pausedNodeName = currentSession.pausedNodeName;
  const isPaused = currentSession.isPaused;
  const viewMode = currentSession.viewMode;
  const filters = currentSession.filters;
  const liveStatusDisplayMode = (sessions.btick as BTickSessionState)
    .liveStatusDisplayMode;

  // Protocol-isolated trees list: Only show trees belonging to the currently selected protocol
  const treesList = useMemo(() => {
    return Array.from(treesMap.values()).filter((t) => {
      const p = (t as any).source || (t as any).protocol;
      return !p || p === activeProtocol;
    });
  }, [treesMap, activeProtocol]);
  const visibleTrees = useMemo(
    () => treesList.filter((t) => t.visible),
    [treesList],
  );

  const handleTreeViewportChange = useCallback(
    (treeId: string, viewport: Viewport) => {
      treeViewportsRef.current.set(treeId, viewport);
    },
    [],
  );

  const handleTreeOrientationChange = useCallback(
    (treeId: string, orientation: TreeOrientation) => {
      setTreeOrientations((previous) => {
        const next = new Map(previous);
        next.set(treeId, orientation);
        return next;
      });
    },
    [],
  );

  const handleTreeNodePositionsChange = useCallback(
    (treeId: string, positions: Record<string, { x: number; y: number }>) => {
      treeNodePositionsRef.current.set(treeId, positions);
    },
    [],
  );

  const handleTreeCollapsedNodesChange = useCallback(
    (treeId: string, nodeIds: string[]) => {
      treeCollapsedNodesRef.current.set(treeId, nodeIds);
    },
    [],
  );

  const handleTreePathModeChange = useCallback(
    (treeId: string, mode: EdgePathMode) => {
      setTreePathModes((previous) => {
        const next = new Map(previous);
        next.set(treeId, mode);
        return next;
      });
    },
    [],
  );
  const activeTree = useMemo(() => {
    if (selectedTreeId && treesMap.has(selectedTreeId)) {
      const candidate = treesMap.get(selectedTreeId)!;
      const p = (candidate as any).source || (candidate as any).protocol;
      const matches = !p || p === activeProtocol;
      if (matches) {
        return candidate;
      }
    }
    if (treesList.length > 0) {
      return treesList[0];
    }
    return null;
  }, [treesMap, selectedTreeId, treesList, activeProtocol]);
  const hasActiveTree = Boolean(
    activeTree && (!selectedTreeId || treesMap.has(selectedTreeId)),
  );

  const activeTreeId = activeTree?.tree_id || selectedTreeId || null;
  const activeTreeReplay = activeTreeId
    ? currentSession.treeReplays?.get(activeTreeId)
    : undefined;
  const isRecording = Boolean(
    activeTreeId
      ? currentSession.recordingTreeIds?.has(activeTreeId) ||
          treeSessionsRef.current.get(
            getTreeStoreKey(activeProtocol, activeTreeId),
          )?.isRecording
      : currentSession.recordingTreeIds &&
          currentSession.recordingTreeIds.size > 0,
  );
  const replayState: ReplayState = activeTreeReplay?.replayState || {
    isReplaying: false,
    isPlaying: false,
    currentIndex: -1,
    speed: 1.0,
    replayTime: 0,
    session: null,
  };
  const lastRecordedSession =
    activeTreeReplay?.lastRecordedSession || activeTreeReplay?.session || null;
  const events = activeTreeReplay?.replayState?.isReplaying
    ? activeTreeReplay.events
    : activeTreeId && currentSession.treeEvents?.has(activeTreeId)
      ? currentSession.treeEvents.get(activeTreeId)!
      : activeTreeId && currentSession.liveEvents
        ? currentSession.liveEvents.filter(
            (ev) => !ev.tree_id || ev.tree_id === activeTreeId,
          )
        : currentSession.liveEvents || currentSession.events;

  useEffect(() => {
    if (!actionWarning) return;
    const timer = window.setTimeout(() => setActionWarning(null), 3500);
    return () => window.clearTimeout(timer);
  }, [actionWarning]);

  // 1-second watchdog tick to ensure stale heartbeats (> 3.5s) immediately transition to DISCONNECTED
  const [watchdogTick, setWatchdogTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setWatchdogTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Effective connection status per protocol
  const getProtocolEffectiveStatus = useCallback(
    (protocol: ProtocolSource): ProtocolConnectionStatus => {
      if (!isConnected) return "DISCONNECTED";
      const sess = sessions[protocol];
      if (!sess) return "DISCONNECTED";

      const rawStatus = sess.session?.connectionStatus;
      const lastHb = sess.session?.lastHeartbeatAt || 0;
      const isHeartbeatStale = lastHb === 0 || Date.now() - lastHb > 3000;

      if (
        !rawStatus ||
        rawStatus === "DISCONNECTED" ||
        rawStatus === "RECONNECTING" ||
        isHeartbeatStale
      ) {
        return "DISCONNECTED";
      }

      // For Nav2, connection status is determined directly from the Nav2 bridge heartbeat
      // which reflects /behavior_tree_log existence and message activity:
      // 1. Topic does not exist -> DISCONNECTED
      // 2. Topic exists but idle -> CONNECTED_IDLE
      // 3. Topic exists and data streaming -> CONNECTED_RUNNING
      if (protocol === "nav2") {
        if (rawStatus === "CONNECTED_RUNNING") return "CONNECTED_RUNNING";
        if (rawStatus === "CONNECTED_IDLE") return "CONNECTED_IDLE";
        return "DISCONNECTED";
      }

      // For Groot2, connection status is determined directly from the Groot2 ZMQ bridge heartbeat
      // which reflects BehaviorTree.CPP ZMQ server connection and activity:
      // 1. ZMQ disconnected -> DISCONNECTED
      // 2. ZMQ connected and idle -> CONNECTED_IDLE
      // 3. ZMQ connected and streaming / running -> CONNECTED_RUNNING
      if (protocol === "groot2") {
        if (rawStatus === "CONNECTED_RUNNING") return "CONNECTED_RUNNING";
        if (rawStatus === "CONNECTED_IDLE") return "CONNECTED_IDLE";
        return "DISCONNECTED";
      }

      const protoTrees = Array.from(sess.treesMap.values());
      if (protoTrees.length === 0) {
        return "DISCONNECTED";
      }

      const hasRunningNode = protoTrees.some((t) =>
        t.nodes.some(
          (n) =>
            n.status === "RUNNING" ||
            (n.status as any) === "PAUSED_AT_BREAKPOINT",
        ),
      );
      if (rawStatus === "CONNECTED_RUNNING" || hasRunningNode) {
        return "CONNECTED_RUNNING";
      }

      return "CONNECTED_IDLE";
    },
    [isConnected, sessions, watchdogTick],
  );

  const protocolStatuses = useMemo<
    Record<ProtocolSource, ProtocolConnectionStatus>
  >(
    () => ({
      btick: getProtocolEffectiveStatus("btick"),
      groot2: getProtocolEffectiveStatus("groot2"),
      nav2: getProtocolEffectiveStatus("nav2"),
    }),
    [getProtocolEffectiveStatus],
  );

  const effectiveConnectionStatus = protocolStatuses[activeProtocol];

  // Handler for active protocol
  const activeHandler = useMemo(
    () => getProtocolHandler(activeProtocol),
    [activeProtocol],
  );

  // Command dispatcher scoped to current protocol
  const sendProtocolCommand = useCallback(
    (cmd: any) => {
      ros2Service.sendCommand({
        ...cmd,
        source: cmd.source || activeProtocol,
      });
    },
    [activeProtocol],
  );

  const sendUserLog = useCallback(
    (log: Parameters<typeof ros2Service.sendUserLog>[0]) => {
      ros2Service.sendUserLog(log);
    },
    [],
  );

  const getLogTree = useCallback(
    (treeId: string) => {
      return (
        sessions[activeProtocol].treesMap.get(treeId) ||
        sessions[activeProtocol].liveTreesMap?.get(treeId)
      );
    },
    [activeProtocol, sessions],
  );

  // Multi-Protocol Continuous Live Bridge Listener
  useEffect(() => {
    const unsubStatus = ros2Service.onStatusChange((status) => {
      setIsConnected(status);
    });

    const unsubMsg = ros2Service.onMessage((data) => {
      if (data?.type === "bridge_status") {
        if (data.status === "error" || data.status === "stopped") {
          const lastLine =
            typeof data.stderr === "string" && data.stderr
              ? data.stderr.trim().split("\n").filter(Boolean).pop()
              : "";
          const detail = lastLine ? ` — ${lastLine}` : "";
          setActionWarning(
            `ROS 2 Bridge: ${data.error || "Bridge process stopped"}${detail}`,
          );
        }
        return;
      }

      setSessions((prev) => {
        const protocol = detectMessageProtocol(data);
        const current = prev[protocol];

        const liveInput: ProtocolSessionState = {
          ...current,
          treesMap: current.liveTreesMap || current.treesMap,
          events: current.liveEvents || current.events,
        };
        const routed = routeIncomingMessage(
          data,
          { ...prev, [protocol]: liveInput },
          ros2Service.sendCommand.bind(ros2Service),
        );
        const routedProto = routed[protocol];
        const liveTreesMap = routedProto.treesMap;
        const liveEvents = routedProto.events;
        const liveTreeEvents =
          routedProto.treeEvents || current.treeEvents || new Map();
        const compositeTreesMap = buildCompositeTreesMap(
          liveTreesMap,
          current.treeReplays,
        );

        if (
          data?.type === "tree_destroyed" ||
          data?.type === "tree_removed" ||
          data?.type === "tree_closed"
        ) {
          const treeId = data.tree_id;
          if (treeId) {
            const storeKey = getTreeStoreKey(protocol, treeId);
            const sessionState = treeSessionsRef.current.get(storeKey);
            if (sessionState) {
              void sessionState.store.dispose();
              treeSessionsRef.current.delete(storeKey);
            }
          }
        }

        if (
          ENABLE_LIVE_SESSION_RECORDING &&
          (data?.type === "tree_created" || data?.type === "tree")
        ) {
          const treeId = data.tree_id || "MainTree";
          const targetTree = routedProto.treesMap?.get(treeId);
          if (targetTree) {
            getOrCreateTreeSession(protocol, treeId, targetTree);
          }
        }

        // Record live Blackboard edits so Save/Replay reconstructs them
        // incrementally (same store/keyframe pipeline as transitions).
        if (ENABLE_LIVE_SESSION_RECORDING) {
          const bbPayload = extractRecordableBlackboardPayload(data);
          if (bbPayload) {
            const bbTreeId = resolveBlackboardTreeId(data, routedProto);
            if (bbTreeId) {
              const targetTree =
                liveTreesMap?.get(bbTreeId) ||
                routedProto.treesMap?.get(bbTreeId);
              const sessionState = getOrCreateTreeSession(
                protocol,
                bbTreeId,
                targetTree,
              );
              if (sessionState) {
                const delta = buildRecordableBlackboardDelta(
                  sessionState,
                  bbPayload,
                );
                if (delta) {
                  recordSessionEvent(
                    sessionState,
                    buildBlackboardEvent(
                      protocol,
                      bbTreeId,
                      delta,
                      (data as any).timestamp,
                      sessionState?.eventCount ?? 0,
                      targetTree?.tree_name || bbTreeId,
                    ),
                  );
                }
              }
            }
          }
        }

        if (data?.type === "transition") {
          if (ENABLE_LIVE_SESSION_RECORDING) {
            const transition = {
              ...(data as TransitionEvent),
              source: (data as TransitionEvent).source || protocol,
              protocol: (data as TransitionEvent).protocol || protocol,
            };
            const eventTreeId = transition.tree_id;
            if (eventTreeId) {
              const targetTree =
                liveTreesMap?.get(eventTreeId) ||
                routedProto.treesMap?.get(eventTreeId);
              const sessionState = getOrCreateTreeSession(
                protocol,
                eventTreeId,
                targetTree,
              );
              if (sessionState) {
                // Keep the blackboard baseline in sync with transition-carried
                // blackboard updates so subsequent full-scope broadcasts don't
                // re-record values already captured by the transition event.
                if (
                  transition.blackboard &&
                  typeof transition.blackboard === "object"
                ) {
                  sessionState.recordedBlackboard = {
                    ...(sessionState.recordedBlackboard || {}),
                    ...transition.blackboard,
                  };
                }
                recordSessionEvent(sessionState, transition);
              }
            }
          }
        }

        if (
          ENABLE_LIVE_SESSION_RECORDING &&
          data?.type === "set_node_port_response" &&
          data.success &&
          data.tree_id &&
          data.uid !== undefined &&
          data.port_name &&
          data.value !== undefined
        ) {
          const targetTree =
            liveTreesMap?.get(data.tree_id) ||
            routedProto.treesMap?.get(data.tree_id);
          const targetNode = targetTree?.nodes.find(
            (node) => node.uid === data.uid,
          );
          if (targetTree && targetNode) {
            const sessionState = getOrCreateTreeSession(
              protocol,
              data.tree_id,
              targetTree,
            );
            if (sessionState) {
              recordSessionEvent(sessionState, {
                id: `port_${data.request_id || Date.now()}_${data.uid}_${data.port_name}`,
                type: "transition",
                source: protocol,
                protocol,
                tree_id: data.tree_id,
                tree_name: targetTree.tree_name || data.tree_id,
                node_id: targetNode.id,
                node_name: targetNode.name,
                uid: targetNode.uid,
                prev_status: targetNode.status,
                status: targetNode.status,
                duration: 0,
                tick_count: targetNode.tick_count || 0,
                timestamp: Number(data.timestamp) || Date.now() / 1000,
                port_updates: [
                  {
                    port_name: data.port_name,
                    value: String(data.value),
                    mode: data.mode === "Blackboard" ? "Blackboard" : "Literal",
                  },
                ],
              });
            }
          }
        }

        return {
          ...routed,
          [protocol]: {
            ...preserveRecordingState(current, routedProto),
            treesMap: compositeTreesMap,
            liveTreesMap,
            liveEvents,
            treeEvents: liveTreeEvents,
          },
        };
      });
    });

    return () => {
      unsubStatus();
      unsubMsg();
      for (const rec of treeSessionsRef.current.values()) {
        void rec.store.dispose();
      }
      treeSessionsRef.current.clear();
    };
  }, [getOrCreateTreeSession]);

  // UI state setters scoped to active protocol
  const setSelectedTreeId = useCallback(
    (treeId: string | null) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: {
          ...prev[activeProtocol],
          selectedTreeId: treeId,
          selectedNodeId: null,
        },
      }));
    },
    [activeProtocol],
  );

  const setSelectedNodeId = useCallback(
    (nodeId: string | null) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: {
          ...prev[activeProtocol],
          selectedNodeId: nodeId,
        },
      }));
    },
    [activeProtocol],
  );

  const handleSelectAndCenterNode = useCallback(
    (nodeId: string | null, treeId?: string) => {
      setSessions((prev) => {
        const sess = prev[activeProtocol];
        return {
          ...prev,
          [activeProtocol]: {
            ...sess,
            selectedTreeId: treeId || sess.selectedTreeId,
            selectedNodeId: nodeId,
          },
        };
      });
      if (nodeId) {
        setCenterTarget({ nodeId, timestamp: Date.now() });
      }
    },
    [activeProtocol],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: {
          ...prev[activeProtocol],
          viewMode: mode,
        },
      }));
    },
    [activeProtocol],
  );

  const setFilters = useCallback(
    (newFilters: StatusFilterOptions) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: {
          ...prev[activeProtocol],
          filters: newFilters,
        },
      }));
    },
    [activeProtocol],
  );

  const setLiveStatusDisplayMode = useCallback(
    (mode: LiveStatusDisplayMode) => {
      if (activeProtocol !== "btick") return;
      setSessions((prev) => ({
        ...prev,
        btick: {
          ...prev.btick,
          liveStatusDisplayMode: mode,
        },
      }));
    },
    [activeProtocol],
  );

  const handleToggleBreakpoint = useCallback(
    (treeId: string, uid: number, once?: boolean) => {
      const tree = getLogTree(treeId);
      const node = tree?.nodes.find((candidate) => candidate.uid === uid);
      const enabled = !node?.is_breakpoint;
      if (node) {
        sendUserLog({
          protocol: activeProtocol,
          nodeName: node.name,
          action: enabled ? "Breakpoint added" : "Breakpoint removed",
          status: enabled ? "Active" : "Inactive",
        });
      }
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleToggleBreakpoint(
          treeId,
          uid,
          once,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [
      activeProtocol,
      activeHandler,
      getLogTree,
      sendProtocolCommand,
      sendUserLog,
    ],
  );

  const handleSetBreakpointOnce = useCallback(
    (treeId: string, uid: number, once: boolean) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleSetBreakpointOnce(
          treeId,
          uid,
          once,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [activeProtocol, activeHandler, sendProtocolCommand],
  );

  const handleInjectFault = useCallback(
    (
      treeId: string,
      uid: number,
      mode: string,
      delayMs?: number,
      once?: boolean,
    ) => {
      const tree = getLogTree(treeId);
      const node = tree?.nodes.find((candidate) => candidate.uid === uid);
      const isClearing =
        node?.fault_mode === mode &&
        (mode !== "DELAY" || node.fault_delay_ms === delayMs) &&
        node.fault_once === !!once;
      if (node) {
        sendUserLog({
          protocol: activeProtocol,
          nodeName: node.name,
          action: isClearing
            ? "Fault override cleared"
            : `Fault injection (${mode}${once ? " 1x" : ""})`,
          status: isClearing ? "Success" : "Active",
        });
      }
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleInjectFault(
          treeId,
          uid,
          mode,
          delayMs,
          once,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [
      activeProtocol,
      activeHandler,
      getLogTree,
      sendProtocolCommand,
      sendUserLog,
    ],
  );

  const handleSetFaultOnce = useCallback(
    (treeId: string, uid: number, once: boolean) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleSetFaultOnce(
          treeId,
          uid,
          once,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [activeProtocol, activeHandler, sendProtocolCommand],
  );

  const handleClearFault = useCallback(
    (treeId: string, uid: number) => {
      const tree = getLogTree(treeId);
      const node = tree?.nodes.find((candidate) => candidate.uid === uid);
      if (node) {
        sendUserLog({
          protocol: activeProtocol,
          nodeName: node.name,
          action: "Fault override cleared",
          status: "Success",
        });
      }
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleClearFault(
          treeId,
          uid,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [
      activeProtocol,
      activeHandler,
      getLogTree,
      sendProtocolCommand,
      sendUserLog,
    ],
  );

  const handleClearAllBreakpoints = useCallback(
    (targetTreeId?: string) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleClearAllBreakpoints(
          targetTreeId,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [activeProtocol, activeHandler, sendProtocolCommand],
  );

  const handleClearAllFaults = useCallback(
    (targetTreeId?: string) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleClearAllFaults(
          targetTreeId,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [activeProtocol, activeHandler, sendProtocolCommand],
  );

  const handleResume = useCallback(
    (targetTreeId?: string) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleContinuation(
          "resume",
          targetTreeId,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [activeProtocol, activeHandler, sendProtocolCommand],
  );

  const handleForceSuccess = useCallback(
    (targetTreeId?: string) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleContinuation(
          "force_success",
          targetTreeId,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [activeProtocol, activeHandler, sendProtocolCommand],
  );

  const handleForceFailure = useCallback(
    (targetTreeId?: string) => {
      setSessions((prev) => ({
        ...prev,
        [activeProtocol]: activeHandler.handleContinuation(
          "force_failure",
          targetTreeId,
          prev[activeProtocol],
          sendProtocolCommand,
        ),
      }));
    },
    [activeProtocol, activeHandler, sendProtocolCommand],
  );

  const handleSetBlackboard = useCallback(
    async (
      treeId: string,
      key: string,
      value: any,
      valueType: "bool" | "int" | "double" | "string",
    ): Promise<{ success: boolean; error?: string }> => {
      if (activeProtocol !== "btick") {
        return {
          success: false,
          error: "Blackboard writing is only supported for BTick (ROS 2)",
        };
      }

      if (!activeHandler.supportsBlackboardWrite) {
        return {
          success: false,
          error: `Protocol ${activeProtocol} does not support Blackboard writing`,
        };
      }

      const requestId = `bb_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return new Promise((resolve) => {
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            sendUserLog({
              protocol: "btick",
              action: `Blackboard write (${key} = ${String(value)})`,
              status: "Failed",
              reason: "Request timed out waiting for ROS 2 robot response",
            });
            resolve({
              success: false,
              error: "Request timed out waiting for ROS 2 robot response",
            });
          }
        }, 3000);

        const cleanup = ros2Service.onMessage((data) => {
          const commandError = getCorrelatedCommandError(
            data,
            "set_blackboard",
            requestId,
            treeId,
          );
          const isAck =
            data?.type === "command_ack" &&
            data?.action === "set_blackboard" &&
            (data.request_id === requestId ||
              (!data.request_id && data.tree_id === treeId));
          if (
            data?.type === "blackboard_update_response" ||
            isAck ||
            commandError
          ) {
            const matches = data.request_id
              ? data.request_id === requestId &&
                (!data.tree_id || data.tree_id === treeId)
              : data.key === key && (!data.tree_id || data.tree_id === treeId);

            if (matches && !resolved) {
              resolved = true;
              clearTimeout(timeout);
              cleanup();
              if (!commandError && (data.success || isAck)) {
                sendUserLog({
                  protocol: "btick",
                  action: `Blackboard write (${key} = ${String(value)})`,
                  status: "Success",
                });
                resolve({ success: true });
              } else {
                const error =
                  commandError || data.error || "Failed to update blackboard";
                sendUserLog({
                  protocol: "btick",
                  action: "Blackboard write",
                  status: "Failed",
                  reason: error,
                });
                resolve({ success: false, error });
              }
            }
          }
        });

        setSessions((prev) => ({
          ...prev,
          [activeProtocol]: activeHandler.handleSetBlackboard(
            treeId,
            key,
            value,
            valueType,
            prev[activeProtocol],
            sendProtocolCommand,
            requestId,
          ),
        }));
      });
    },
    [activeProtocol, activeHandler, sendProtocolCommand, sendUserLog],
  );

  const handleSetNodePort = useCallback(
    async (
      treeId: string,
      uid: number,
      portName: string,
      value: string,
      mode: "Literal" | "Blackboard",
    ): Promise<{ success: boolean; error?: string }> => {
      if (activeProtocol !== "btick") {
        return {
          success: false,
          error: "Live Node Port editing is only supported for BTick (ROS 2)",
        };
      }

      if (!activeHandler.supportsNodePortEdit) {
        return {
          success: false,
          error: `Protocol ${activeProtocol} does not support Node Port editing`,
        };
      }

      const requestId = `port_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const targetTree = getLogTree(treeId);
      const targetNode = targetTree?.nodes.find((node) => node.uid === uid);
      const portAction = `Set port (${portName} = ${value})`;

      return new Promise((resolve) => {
        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            sendUserLog({
              protocol: "btick",
              nodeName: targetNode?.name,
              action: portAction,
              status: "Failed",
              reason: "Request timed out waiting for ROS 2 robot response",
            });
            resolve({
              success: false,
              error: "Request timed out waiting for ROS 2 robot response",
            });
          }
        }, 3000);

        const cleanup = ros2Service.onMessage((data) => {
          const commandError = getCorrelatedCommandError(
            data,
            "set_node_port",
            requestId,
            treeId,
          );
          const isAck =
            data?.type === "command_ack" &&
            data?.action === "set_node_port" &&
            (data.request_id === requestId ||
              (!data.request_id && data.tree_id === treeId));
          if (
            data?.type === "set_node_port_response" ||
            isAck ||
            commandError
          ) {
            const matches = data.request_id
              ? data.request_id === requestId &&
                (!data.tree_id || data.tree_id === treeId)
              : data.port_name === portName &&
                (data.uid === undefined || data.uid === uid);

            if (matches && !resolved) {
              resolved = true;
              clearTimeout(timeout);
              cleanup();
              if (!commandError && (data.success || isAck)) {
                sendUserLog({
                  protocol: "btick",
                  nodeName: targetNode?.name,
                  action: portAction,
                  status: "Success",
                });
                resolve({ success: true });
              } else {
                const error =
                  commandError || data.error || "Failed to update node port";
                sendUserLog({
                  protocol: "btick",
                  nodeName: targetNode?.name,
                  action: portAction,
                  status: "Failed",
                  reason: error,
                });
                resolve({ success: false, error });
              }
            }
          }
        });

        setSessions((prev) => ({
          ...prev,
          [activeProtocol]: activeHandler.handleSetNodePort(
            treeId,
            uid,
            portName,
            value,
            mode,
            prev[activeProtocol],
            sendProtocolCommand,
            requestId,
          ),
        }));
      });
    },
    [
      activeProtocol,
      activeHandler,
      getLogTree,
      sendProtocolCommand,
      sendUserLog,
    ],
  );

  // Keyboard Shortcuts: Space or F5 to Resume
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");
      if (isInput) return;

      const sess = sessions[activeProtocol];
      if (sess.isPaused && (e.code === "Space" || e.key === "F5")) {
        e.preventDefault();
        handleResume();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeProtocol, sessions, handleResume]);

  // Tree Visibility and Close Controls
  const handleToggleTreeVisibility = useCallback(
    (treeId: string) => {
      setSessions((prev) => {
        const sess = prev[activeProtocol];
        const nextTreesMap = new Map(sess.treesMap);
        const nextClosedTreeIds = new Set(sess.closedTreeIds || []);
        nextClosedTreeIds.delete(treeId);
        if (nextTreesMap.has(treeId)) {
          const existing = nextTreesMap.get(treeId)!;
          nextTreesMap.set(treeId, { ...existing, visible: !existing.visible });
        }
        const nextLiveTrees = sess.liveTreesMap
          ? new Map(sess.liveTreesMap)
          : undefined;
        if (nextLiveTrees && nextLiveTrees.has(treeId)) {
          const existing = nextLiveTrees.get(treeId)!;
          nextLiveTrees.set(treeId, {
            ...existing,
            visible: !existing.visible,
          });
        }
        return {
          ...prev,
          [activeProtocol]: {
            ...sess,
            treesMap: nextTreesMap,
            liveTreesMap: nextLiveTrees || nextTreesMap,
            closedTreeIds: nextClosedTreeIds,
          },
        };
      });
    },
    [activeProtocol],
  );

  const handleSelectAllTrees = useCallback(
    (visible: boolean) => {
      setSessions((prev) => {
        const sess = prev[activeProtocol];
        const nextTreesMap = new Map(sess.treesMap);
        for (const [id, t] of nextTreesMap.entries()) {
          nextTreesMap.set(id, { ...t, visible });
        }
        const nextLiveTrees = sess.liveTreesMap
          ? new Map(sess.liveTreesMap)
          : undefined;
        if (nextLiveTrees) {
          for (const [id, t] of nextLiveTrees.entries()) {
            nextLiveTrees.set(id, { ...t, visible });
          }
        }
        return {
          ...prev,
          [activeProtocol]: {
            ...sess,
            treesMap: nextTreesMap,
            liveTreesMap: nextLiveTrees || nextTreesMap,
          },
        };
      });
    },
    [activeProtocol],
  );

  const handleCloseTree = useCallback(
    (treeId: string) => {
      const storeKey = getTreeStoreKey(activeProtocol, treeId);
      const sessionState = treeSessionsRef.current.get(storeKey);
      if (sessionState) {
        void sessionState.store.dispose();
        treeSessionsRef.current.delete(storeKey);
      }
      replayClockRef.current.delete(storeKey);
      lastAppliedReplayRef.current.delete(storeKey);
      recordingStartTimesRef.current.delete(storeKey);

      treeViewportsRef.current.delete(treeId);
      treeNodePositionsRef.current.delete(treeId);
      treeCollapsedNodesRef.current.delete(treeId);
      setTreePathModes((prev) => {
        const next = new Map(prev);
        next.delete(treeId);
        return next;
      });
      setTreeOrientations((prev) => {
        const next = new Map(prev);
        next.delete(treeId);
        return next;
      });

      setSessions((prev) => {
        const sess = prev[activeProtocol];
        const nextTreesMap = new Map(sess.treesMap);
        nextTreesMap.delete(treeId);
        const nextClosedTreeIds = new Set(sess.closedTreeIds || []);
        nextClosedTreeIds.add(treeId);

        const nextLiveTreesMap = sess.liveTreesMap
          ? new Map(sess.liveTreesMap)
          : undefined;
        nextLiveTreesMap?.delete(treeId);

        const nextTreeReplays = sess.treeReplays
          ? new Map(sess.treeReplays)
          : undefined;
        nextTreeReplays?.delete(treeId);

        const nextTreeEvents = sess.treeEvents
          ? new Map(sess.treeEvents)
          : undefined;
        nextTreeEvents?.delete(treeId);

        const nextRecordingTreeIds = sess.recordingTreeIds
          ? new Set(sess.recordingTreeIds)
          : undefined;
        nextRecordingTreeIds?.delete(treeId);

        const nextBreakpoints = new Set(sess.breakpoints);
        for (const k of sess.breakpoints) {
          if (k.startsWith(`${treeId}::`)) nextBreakpoints.delete(k);
        }

        const nextBreakpointOnce = new Set(sess.breakpointOnceSet);
        for (const k of sess.breakpointOnceSet) {
          if (k.startsWith(`${treeId}::`)) nextBreakpointOnce.delete(k);
        }

        const nextFaultRules = new Map(sess.faultRules);
        for (const k of sess.faultRules.keys()) {
          if (k.startsWith(`${treeId}::`)) nextFaultRules.delete(k);
        }

        let nextPausedTreeId = sess.pausedNodeTreeId;
        let nextPausedUid = sess.pausedNodeUid;
        let nextPausedName = sess.pausedNodeName;
        let nextIsPaused = sess.isPaused;
        if (nextPausedTreeId === treeId) {
          nextPausedTreeId = null;
          nextPausedUid = null;
          nextPausedName = undefined;
          nextIsPaused = false;
        }

        let nextSelectedId = sess.selectedTreeId;
        if (nextSelectedId === treeId) {
          const remaining = Array.from(nextTreesMap.keys());
          nextSelectedId = remaining.length > 0 ? remaining[0] : null;
        }

        return {
          ...prev,
          [activeProtocol]: {
            ...sess,
            treesMap: nextTreesMap,
            liveTreesMap: nextLiveTreesMap,
            closedTreeIds: nextClosedTreeIds,
            treeReplays: nextTreeReplays,
            treeEvents: nextTreeEvents,
            selectedTreeId: nextSelectedId,
            recordingTreeIds: nextRecordingTreeIds,
            isRecording: Boolean(
              nextRecordingTreeIds && nextRecordingTreeIds.size > 0,
            ),
            breakpoints: nextBreakpoints,
            breakpointOnceSet: nextBreakpointOnce,
            faultRules: nextFaultRules,
            pausedNodeTreeId: nextPausedTreeId,
            pausedNodeUid: nextPausedUid,
            pausedNodeName: nextPausedName,
            isPaused: nextIsPaused,
          },
        };
      });
    },
    [activeProtocol],
  );

  // Protocol-Scoped Recording & Replay Controls
  const handleStartRecording = async (targetTreeIdParam?: string) => {
    if (!hasActiveTree && !targetTreeIdParam) {
      setActionWarning(
        "Cannot start recording: No active Behavior Tree selected.",
      );
      return;
    }
    if (effectiveConnectionStatus === "DISCONNECTED") {
      setActionWarning(
        "Cannot start recording: The current protocol is disconnected.",
      );
      return;
    }

    const session = sessions[activeProtocol];
    const liveTreesMap = session.liveTreesMap || session.treesMap;
    const activeTreeId =
      targetTreeIdParam ||
      session.selectedTreeId ||
      (liveTreesMap.keys().next().value ?? null);
    if (!activeTreeId) {
      setActionWarning(
        "Cannot start recording: No active Behavior Tree selected.",
      );
      return;
    }

    // Guard against duplicate starts for the same tree
    if (session.recordingTreeIds?.has(activeTreeId)) {
      return;
    }

    const recordingStartTimestamp = Date.now();
    recordingStartTimesRef.current.set(
      getTreeStoreKey(activeProtocol, activeTreeId),
      recordingStartTimestamp,
    );

    const targetTree = liveTreesMap.get(activeTreeId);
    let sessionState: TreeSessionPersistenceState | undefined = undefined;
    if (ENABLE_LIVE_SESSION_RECORDING) {
      sessionState = getOrCreateTreeSession(
        activeProtocol,
        activeTreeId,
        targetTree,
      );
      if (sessionState) {
        if (sessionState.isRecording && !sessionState.stopPromise) {
          return;
        }
        sessionState.isRecording = true;
        sessionState.recordingStartTimestamp = recordingStartTimestamp;
      }
    }

    const initialTrees = targetTree
      ? [targetTree]
      : session.treesMap.has(activeTreeId)
        ? [session.treesMap.get(activeTreeId)!]
        : [];

    setSessions((prev) => {
      const sess = prev[activeProtocol];
      const nextRecTreeIds = new Set(sess.recordingTreeIds || []);
      nextRecTreeIds.add(activeTreeId);
      const currentLiveTrees = sess.liveTreesMap || sess.treesMap;
      return {
        ...prev,
        [activeProtocol]: {
          ...sess,
          currentSession: null,
          treesMap: currentLiveTrees,
          isRecording: true,
          recordingTreeIds: nextRecTreeIds,
          recordingInitialTrees: initialTrees,
          replayState: {
            ...sess.replayState,
            isReplaying: false,
            isPlaying: false,
          },
        },
      };
    });
  };

  const handleStopRecording = async (targetTreeIdParam?: string) => {
    const session = sessions[activeProtocol];
    const activeTreeId =
      targetTreeIdParam ||
      session.selectedTreeId ||
      (session.treesMap.keys().next().value ?? null);
    if (!activeTreeId) {
      return;
    }

    const isCurrentlyRecording = Boolean(
      (session.recordingTreeIds &&
        session.recordingTreeIds.has(activeTreeId)) ||
      session.isRecording ||
      treeSessionsRef.current.get(getTreeStoreKey(activeProtocol, activeTreeId))
        ?.isRecording,
    );
    if (!isCurrentlyRecording) {
      return;
    }

    const recKey = getTreeStoreKey(activeProtocol, activeTreeId);
    const sessionState = treeSessionsRef.current.get(recKey);
    if (sessionState?.stopPromise) {
      return sessionState.stopPromise;
    }

    const stopPromise = (async () => {
      const startTimestamp =
        recordingStartTimesRef.current.get(recKey) ||
        sessionState?.recordingStartTimestamp ||
        sessionState?.startTimestamp ||
        Date.now();
      recordingStartTimesRef.current.delete(recKey);
      if (sessionState) {
        sessionState.isRecording = false;
      }

      let exportedSession: RecordingSession | null = null;
      if (ENABLE_LIVE_SESSION_RECORDING && sessionState) {
        const { protocol, treeId, store, initialTrees, sessionId } =
          sessionState;
        try {
          const exported = await store.exportSession();
          if (exported) {
            const isSecondsTimestamp =
              exported.events.length > 0 && exported.events[0].timestamp < 1e11;
            const threshold = isSecondsTimestamp
              ? startTimestamp / 1000
              : startTimestamp;

            const recordingEvents = exported.events
              .filter((ev) => ev.timestamp >= threshold)
              .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
            const recordingSnapshots = (exported.snapshots || []).filter(
              (sn) => sn.timestamp >= threshold,
            );

            const sess = sessions[protocol];
            let scopedTrees: BTTreeModel[];
            if (treeId && sess.treesMap.has(treeId)) {
              scopedTrees = cloneTreeMap(
                new Map([[treeId, sess.treesMap.get(treeId)!]]),
              );
            } else if (initialTrees.length > 0) {
              scopedTrees = cloneTreeMap(
                new Map(initialTrees.map((t) => [t.tree_id, t])),
              );
            } else {
              scopedTrees = cloneTreeMap(sess.treesMap);
            }

            const nodeExecutions =
              exported.node_executions &&
              recordingEvents.length === exported.events.length
                ? exported.node_executions
                : buildNodeExecutions(recordingEvents);

            exportedSession = {
              id: sessionId || `session_${startTimestamp}`,
              name: `BT_Session_${new Date(startTimestamp).toISOString().slice(0, 19).replace(/[:T]/g, "_")}`,
              recorded_at: new Date(startTimestamp).toISOString(),
              trees: scopedTrees,
              events: recordingEvents,
              snapshots: recordingSnapshots,
              initial_trees:
                exported.initial_trees ||
                (initialTrees.length > 0 ? initialTrees : scopedTrees),
              node_executions: nodeExecutions,
            };
          }
        } catch (err) {}
      }

      if (
        !exportedSession ||
        (exportedSession.events.length === 0 &&
          (!exportedSession.initial_trees ||
            exportedSession.initial_trees.length === 0))
      ) {
        const sess = sessions[activeProtocol];
        const treeEventsList = activeTreeId
          ? sess.treeEvents?.get(activeTreeId) || sess.events || []
          : sess.events || [];
        const isSecondsTimestamp =
          treeEventsList.length > 0 && treeEventsList[0].timestamp < 1e11;
        const threshold = isSecondsTimestamp
          ? startTimestamp / 1000
          : startTimestamp;
        const recordingEvents = treeEventsList
          .filter((ev) => ev.timestamp >= threshold)
          .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

        const scopedInitialTrees = sess.recordingInitialTrees?.length
          ? sess.recordingInitialTrees
          : activeTreeId && sess.treesMap.has(activeTreeId)
            ? [sess.treesMap.get(activeTreeId)!]
            : cloneTreeMap(sess.treesMap);

        exportedSession = {
          id: `session_${startTimestamp}`,
          name: `BT_Session_${new Date(startTimestamp).toISOString().slice(0, 19).replace(/[:T]/g, "_")}`,
          recorded_at: new Date(startTimestamp).toISOString(),
          trees: scopedInitialTrees,
          events: recordingEvents.map((e) => ({ ...e })),
          snapshots: [],
          initial_trees: scopedInitialTrees,
          node_executions: buildNodeExecutions(recordingEvents),
        };
      }

      const preparedReplay = exportedSession
        ? prepareReplaySession(exportedSession, "record")
        : null;

      if (
        exportedSession &&
        exportedSession.events.length > SESSION_STORE_REPLAY_WARNING_THRESHOLD
      ) {
        setActionWarning(
          `This recording has ${exportedSession.events.length.toLocaleString()} events. Replay loads the full session in memory — very large recordings may be slow.`,
        );
      }

      setSessions((prev) => {
        const current = prev[activeProtocol];
        const nextRecTreeIds = new Set(current.recordingTreeIds || []);
        nextRecTreeIds.delete(activeTreeId);
        const isStillRecording = nextRecTreeIds.size > 0;

        const nextTreeReplays = new Map(current.treeReplays || []);
        if (exportedSession && preparedReplay) {
          nextTreeReplays.set(activeTreeId, {
            protocol: activeProtocol,
            treeId: activeTreeId,
            session: exportedSession,
            replayState: preparedReplay.replayState,
            treesMap: preparedReplay.treesMap,
            events: [],
            lastRecordedSession: exportedSession,
            currentSession: null,
          });
        }

        const liveTreesMap = current.liveTreesMap || current.treesMap;
        const compositeTreesMap = buildCompositeTreesMap(
          liveTreesMap,
          nextTreeReplays,
        );

        return {
          ...prev,
          [activeProtocol]: {
            ...current,
            isRecording: isStillRecording,
            recordingTreeIds: nextRecTreeIds,
            lastRecordedSession: exportedSession,
            treeReplays: nextTreeReplays,
            treesMap: compositeTreesMap,
            liveTreesMap,
            liveEvents: current.liveEvents || current.events,
            recordingInitialTrees: [],
          },
        };
      });
    })();

    if (sessionState) {
      sessionState.stopPromise = stopPromise;
    }
    try {
      await stopPromise;
    } catch (err) {
    } finally {
      if (sessionState) {
        sessionState.stopPromise = null;
      }
    }
  };

  const handleSaveSection = async () => {
    if (!ENABLE_LIVE_SESSION_RECORDING) {
      return;
    }
    if (!hasActiveTree) {
      setActionWarning(
        "Cannot save session: No active Behavior Tree selected.",
      );
      return;
    }

    const sess = sessions[activeProtocol];
    const activeTreeId =
      sess.selectedTreeId || (sess.treesMap.keys().next().value ?? null);
    let storeSession: RecordingSession | null = null;
    if (activeTreeId) {
      const storeKey = getTreeStoreKey(activeProtocol, activeTreeId);
      const sessionState = treeSessionsRef.current.get(storeKey);
      if (sessionState) {
        try {
          storeSession = await sessionState.store.exportSession();
        } catch (err: any) {
          setActionWarning(
            `Save Session failed: Storage export error or timeout (${err?.message || "unknown error"}). No file was downloaded.`,
          );
          return;
        }
      }
    }

    const sessionData = getCurrentSessionForSave(
      sess,
      storeSession,
      activeTreeId,
    );
    if (!sessionData) {
      setActionWarning(
        "Cannot save session: No session data available for the active tree.",
      );
      return;
    }

    downloadSession(sessionData, "session");
  };

  const handleSaveRecordedReplay = () => {
    const sess = sessions[activeProtocol];
    const sessionData = getRecordedSessionForSave(sess, activeTreeId);
    downloadSession(sessionData, "record");
  };

  const downloadSession = (
    sessionData: RecordingSession | null,
    kind: "session" | "record",
  ) => {
    if (!sessionData) {
      return;
    }

    const jsonString = JSON.stringify(sessionData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getSaveFilename(kind, new Date());
    a.click();

    URL.revokeObjectURL(url);
  };

  const handleSaveSession = handleSaveSection;

  const applyReplayIndex = useCallback(
    (index: number, session: RecordingSession, targetTreeIdParam?: string) => {
      if (!session || index < 0 || index >= session.events.length) return;

      const targetTreeId =
        targetTreeIdParam ||
        session.trees[0]?.tree_id ||
        (session.initial_trees && session.initial_trees[0]?.tree_id) ||
        activeTreeId;
      if (!targetTreeId) return;

      const storeKey = getTreeStoreKey(activeProtocol, targetTreeId);
      const lastApplied = lastAppliedReplayRef.current.get(storeKey);
      if (
        lastApplied &&
        lastApplied.sessionId === session.id &&
        lastApplied.index === index
      ) {
        return;
      }

      lastAppliedReplayRef.current.set(storeKey, {
        sessionId: session.id,
        index,
      });

      const clock = replayClockRef.current.get(storeKey);
      if (clock && clock.sessionId === session.id) {
        clock.appliedIndex = index;
      }

      const eventsToApply = session.events.slice(0, index + 1);

      setSessions((prev) => {
        const sess = prev[activeProtocol];
        const treeReplay = sess.treeReplays?.get(targetTreeId);
        const prevIndex = treeReplay?.replayState.currentIndex ?? -1;
        const prevSessionId = treeReplay?.replayState.session?.id;
        const currentTreeMap = treeReplay?.treesMap || sess.treesMap;
        const isForward =
          prevSessionId === session.id &&
          prevIndex >= 0 &&
          index > prevIndex &&
          currentTreeMap &&
          currentTreeMap.size > 0;

        let nextMap: Map<string, BTTreeModel>;
        if (session.initial_trees) {
          const executionMap = getReplayExecutionMap(session);
          const forwardDelta = isForward ? index - prevIndex : -1;

          if (
            isForward &&
            forwardDelta <= REPLAY_INCREMENTAL_FORWARD_THRESHOLD
          ) {
            // Fast incremental forward update: process only new events since prevIndex
            nextMap = new Map<string, BTTreeModel>(currentTreeMap);
            for (
              let eventIndex = prevIndex + 1;
              eventIndex <= index;
              eventIndex += 1
            ) {
              const event = session.events[eventIndex];
              applySingleReplayEvent(nextMap, event, eventIndex, executionMap);
            }
          } else {
            // Large forward seek, backward seek, restart, or initial session load:
            // Reconstruct from nearest snapshot <= index, or from baseline if none exists
            const nearestSnapshot = session.snapshots?.length
              ? session.snapshots
                  .filter((snapshot) => snapshot.eventIndex <= index)
                  .slice(-1)[0]
              : undefined;

            if (nearestSnapshot) {
              nextMap = new Map<string, BTTreeModel>(
                cloneTreeMap(
                  new Map(
                    nearestSnapshot.trees.map((tree) => [tree.tree_id, tree]),
                  ),
                ).map((tree) => [tree.tree_id, tree]),
              );

              session.initial_trees.forEach((tree) => {
                if (!nextMap.has(tree.tree_id)) {
                  nextMap.set(tree.tree_id, createReplayBaselineTree(tree));
                }
              });

              for (
                let eventIndex = nearestSnapshot.eventIndex + 1;
                eventIndex <= index;
                eventIndex += 1
              ) {
                const event = session.events[eventIndex];
                applySingleReplayEvent(
                  nextMap,
                  event,
                  eventIndex,
                  executionMap,
                );
              }
            } else {
              nextMap = new Map<string, BTTreeModel>(
                session.initial_trees.map((tree) => [
                  tree.tree_id,
                  createReplayBaselineTree(tree),
                ]),
              );

              for (let eventIndex = 0; eventIndex <= index; eventIndex += 1) {
                const event = session.events[eventIndex];
                applySingleReplayEvent(
                  nextMap,
                  event,
                  eventIndex,
                  executionMap,
                );
              }
            }
          }
        } else {
          // Fallback for legacy session without initial_trees
          nextMap = applyFallbackReplayRange(session, eventsToApply);
        }

        const nextTreeReplays = new Map(sess.treeReplays || []);
        const existingTR = nextTreeReplays.get(targetTreeId) || {
          protocol: activeProtocol,
          treeId: targetTreeId,
          session,
          replayState: {
            isReplaying: true,
            isPlaying: false,
            currentIndex: index,
            speed: 1.0,
            replayTime: 0,
            session,
          },
          treesMap: nextMap,
          events: eventsToApply,
          lastRecordedSession: null,
        };

        nextTreeReplays.set(targetTreeId, {
          ...existingTR,
          events: eventsToApply,
          treesMap: nextMap,
          replayState: {
            ...existingTR.replayState,
            currentIndex: index,
          },
        });

        const liveTrees = sess.liveTreesMap || sess.treesMap;
        const compositeTreesMap = buildCompositeTreesMap(
          liveTrees,
          nextTreeReplays,
        );

        return {
          ...prev,
          [activeProtocol]: {
            ...sess,
            treeReplays: nextTreeReplays,
            treesMap: compositeTreesMap,
          },
        };
      });
    },
    [activeProtocol, activeTreeId],
  );

  useEffect(() => {
    if (!activeTreeId || !activeTreeReplay) return;
    const curReplayState = activeTreeReplay.replayState;
    if (!curReplayState) return;
    if (
      !curReplayState.isReplaying ||
      !curReplayState.session ||
      curReplayState.currentIndex < 0
    )
      return;
    const storeKey = getTreeStoreKey(activeProtocol, activeTreeId);
    const lastApplied = lastAppliedReplayRef.current.get(storeKey);
    if (
      lastApplied &&
      lastApplied.sessionId === curReplayState.session.id &&
      lastApplied.index === curReplayState.currentIndex
    ) {
      return;
    }
    applyReplayIndex(
      curReplayState.currentIndex,
      curReplayState.session,
      activeTreeId,
    );
  }, [
    activeProtocol,
    activeTreeId,
    activeTreeReplay?.replayState?.isReplaying,
    activeTreeReplay?.replayState?.currentIndex,
    activeTreeReplay?.replayState?.session,
    applyReplayIndex,
  ]);

  const handleReplayPlay = () => {
    if (!activeTreeId) return;
    const sess = sessions[activeProtocol];
    const treeReplay = sess.treeReplays?.get(activeTreeId);
    const session = treeReplay?.replayState?.session;
    if (!treeReplay || !session) return;
    const replayState = treeReplay.replayState;
    if (!replayState) return;
    const restarting = replayState.currentIndex >= session.events.length - 1;
    const replayTime = restarting ? 0 : replayState.replayTime || 0;
    const recordedStart = Number(session.events[0]?.timestamp || 0);
    const storeKey = getTreeStoreKey(activeProtocol, activeTreeId);
    if (restarting) {
      lastAppliedReplayRef.current.set(storeKey, {
        sessionId: session.id,
        index: -1,
      });
    }
    replayClockRef.current.set(storeKey, {
      wallStart: performance.now() - replayTime / replayState.speed,
      recordedStart,
      speed: replayState.speed,
      sessionId: session.id,
      appliedIndex: restarting ? -1 : replayState.currentIndex,
    });

    setSessions((prev) => {
      const current = prev[activeProtocol];
      const nextTreeReplays = new Map(current.treeReplays || []);
      const tr = nextTreeReplays.get(activeTreeId);
      if (!tr?.replayState) return prev;
      nextTreeReplays.set(activeTreeId, {
        ...tr,
        treesMap: restarting
          ? new Map(
              (session.initial_trees || session.trees).map((tree) => [
                tree.tree_id,
                createReplayBaselineTree(tree),
              ]),
            )
          : tr.treesMap,
        replayState: {
          ...tr.replayState,
          currentIndex: restarting ? -1 : tr.replayState.currentIndex,
          replayTime,
          isPlaying: true,
        },
      });
      const compositeTreesMap = buildCompositeTreesMap(
        current.liveTreesMap || current.treesMap,
        nextTreeReplays,
      );
      return {
        ...prev,
        [activeProtocol]: {
          ...current,
          treeReplays: nextTreeReplays,
          treesMap: compositeTreesMap,
        },
      };
    });
  };

  const initializeReplaySession = (
    session: RecordingSession,
    replaySource: "record" | "loaded",
  ): ReplayState => {
    return {
      isReplaying: true,
      isPlaying: false,
      currentIndex: -1,
      speed: 1.0,
      replayTime: 0,
      session,
      replaySource,
    };
  };

  const prepareReplaySession = (
    session: RecordingSession,
    replaySource: "record" | "loaded",
  ) => ({
    replayState: initializeReplaySession(session, replaySource),
    treesMap: new Map(
      (session.initial_trees || session.trees).map((tree) => [
        tree.tree_id,
        tree,
      ]),
    ),
  });

  const handleReplayPause = () => {
    if (!activeTreeId) return;
    const storeKey = getTreeStoreKey(activeProtocol, activeTreeId);
    const clock = replayClockRef.current.get(storeKey);
    const elapsed = clock
      ? (performance.now() - clock.wallStart) * clock.speed
      : undefined;
    setSessions((prev) => {
      const current = prev[activeProtocol];
      const nextTreeReplays = new Map(current.treeReplays || []);
      const tr = nextTreeReplays.get(activeTreeId);
      if (!tr?.replayState) return prev;
      nextTreeReplays.set(activeTreeId, {
        ...tr,
        replayState: {
          ...tr.replayState,
          replayTime:
            elapsed !== undefined ? elapsed : tr.replayState.replayTime,
          isPlaying: false,
        },
      });
      return {
        ...prev,
        [activeProtocol]: {
          ...current,
          treeReplays: nextTreeReplays,
        },
      };
    });
  };

  const handleReplaySpeedChange = (speed: number) => {
    if (!activeTreeId) return;
    const sess = sessions[activeProtocol];
    const treeReplay = sess.treeReplays?.get(activeTreeId);
    if (!treeReplay?.replayState) return;
    const storeKey = getTreeStoreKey(activeProtocol, activeTreeId);
    const clock = replayClockRef.current.get(storeKey);
    const replayTime =
      treeReplay.replayState.isPlaying && clock
        ? (performance.now() - clock.wallStart) * clock.speed
        : treeReplay.replayState.replayTime || 0;
    if (treeReplay.replayState.isPlaying && clock) {
      replayClockRef.current.set(storeKey, {
        ...clock,
        wallStart: performance.now() - replayTime / speed,
        speed,
        appliedIndex: clock.appliedIndex,
      });
    }
    setSessions((prev) => {
      const current = prev[activeProtocol];
      const nextTreeReplays = new Map(current.treeReplays || []);
      const tr = nextTreeReplays.get(activeTreeId);
      if (!tr) return prev;
      nextTreeReplays.set(activeTreeId, {
        ...tr,
        replayState: { ...tr.replayState, speed, replayTime },
      });
      return {
        ...prev,
        [activeProtocol]: {
          ...current,
          treeReplays: nextTreeReplays,
        },
      };
    });
  };

  const handleReplayStop = () => {
    if (activeTreeId) {
      const storeKey = getTreeStoreKey(activeProtocol, activeTreeId);
      replayClockRef.current.delete(storeKey);
      lastAppliedReplayRef.current.delete(storeKey);
    }
    if (replayTimerRef.current) cancelAnimationFrame(replayTimerRef.current);

    setSessions((prev) => {
      const sess = prev[activeProtocol];
      const nextTreeReplays = new Map(sess.treeReplays || []);
      if (activeTreeId && nextTreeReplays.has(activeTreeId)) {
        const tr = nextTreeReplays.get(activeTreeId)!;
        nextTreeReplays.set(activeTreeId, {
          ...tr,
          replayState: {
            ...tr.replayState,
            isPlaying: false,
            isReplaying: false,
          },
        });
      }
      const compositeTreesMap = buildCompositeTreesMap(
        sess.liveTreesMap || sess.treesMap,
        nextTreeReplays,
      );
      return {
        ...prev,
        [activeProtocol]: {
          ...sess,
          treeReplays: nextTreeReplays,
          treesMap: compositeTreesMap,
        },
      };
    });
  };

  const handleClearRecording = () => {
    if (activeTreeId) {
      const storeKey = getTreeStoreKey(activeProtocol, activeTreeId);
      replayClockRef.current.delete(storeKey);
      lastAppliedReplayRef.current.delete(storeKey);
    }
    if (replayTimerRef.current) cancelAnimationFrame(replayTimerRef.current);

    setSessions((prev) => {
      const sess = prev[activeProtocol];
      const nextTreeReplays = new Map(sess.treeReplays || []);
      if (activeTreeId) {
        nextTreeReplays.delete(activeTreeId);
      }
      const compositeTreesMap = buildCompositeTreesMap(
        sess.liveTreesMap || sess.treesMap,
        nextTreeReplays,
      );
      return {
        ...prev,
        [activeProtocol]: {
          ...sess,
          treeReplays: nextTreeReplays,
          treesMap: compositeTreesMap,
        },
      };
    });
  };

  const handleReplayStepForward = () => {
    if (!activeTreeId || !activeTreeReplay?.replayState?.session) return;
    const session = activeTreeReplay.replayState.session;
    const nextIdx = Math.min(
      session.events.length - 1,
      activeTreeReplay.replayState.currentIndex + 1,
    );
    applyReplayIndex(nextIdx, session, activeTreeId);
  };

  const handleReplayStepBack = () => {
    if (!activeTreeId || !activeTreeReplay?.replayState?.session) return;
    const session = activeTreeReplay.replayState.session;
    const nextIdx = Math.max(0, activeTreeReplay.replayState.currentIndex - 1);
    applyReplayIndex(nextIdx, session, activeTreeId);
  };

  const handleReplaySeek = (replayTime: number) => {
    if (
      !activeTreeId ||
      !activeTreeReplay?.replayState?.session ||
      !activeTreeReplay.replayState.session.events.length
    )
      return;
    const session = activeTreeReplay.replayState.session;
    const recordedStart = Number(session.events[0]?.timestamp);
    const targetTimestamp = recordedStart + replayTime / 1000;
    const index = findEventIndexForTimestamp(session.events, targetTimestamp);
    const storeKey = getTreeStoreKey(activeProtocol, activeTreeId);
    const clock = replayClockRef.current.get(storeKey);
    if (clock) {
      replayClockRef.current.set(storeKey, {
        ...clock,
        wallStart: performance.now() - replayTime / clock.speed,
        appliedIndex: index,
      });
    }
    setSessions((prev) => {
      const current = prev[activeProtocol];
      const nextTreeReplays = new Map(current.treeReplays || []);
      const treeReplay = nextTreeReplays.get(activeTreeId);
      if (!treeReplay) return prev;
      nextTreeReplays.set(activeTreeId, {
        ...treeReplay,
        replayState: {
          ...treeReplay.replayState,
          replayTime,
        },
      });
      return {
        ...prev,
        [activeProtocol]: {
          ...current,
          treeReplays: nextTreeReplays,
        },
      };
    });
    if (index >= 0) applyReplayIndex(index, session, activeTreeId);
  };

  // Recorded event timestamps are seconds since epoch; replayTime is elapsed milliseconds.
  useEffect(() => {
    if (!activeTreeId || !activeTreeReplay) return;
    const trState = activeTreeReplay.replayState;
    if (trState.isReplaying && trState.isPlaying && trState.session) {
      const session = trState.session;
      const recordedStart = Number(session.events[0]?.timestamp || 0);
      const storeKey = getTreeStoreKey(activeProtocol, activeTreeId);
      let clock = replayClockRef.current.get(storeKey);
      if (!clock || clock.sessionId !== session.id) {
        clock = {
          wallStart:
            performance.now() - (trState.replayTime || 0) / trState.speed,
          recordedStart,
          speed: trState.speed,
          sessionId: session.id,
          appliedIndex: trState.currentIndex,
        };
        replayClockRef.current.set(storeKey, clock);
      }

      const updateReplay = () => {
        const currentClock = replayClockRef.current.get(storeKey);
        if (!currentClock) return;
        const replayTime = Math.max(
          0,
          (performance.now() - currentClock.wallStart) * currentClock.speed,
        );
        const targetTimestamp = currentClock.recordedStart + replayTime / 1000;
        let targetIndex = -1;
        let startIndex = Math.max(0, currentClock.appliedIndex ?? 0);
        if (
          startIndex < session.events.length &&
          Number(session.events[startIndex].timestamp) > targetTimestamp
        ) {
          startIndex = 0;
        }
        for (
          let index = startIndex;
          index < session.events.length;
          index += 1
        ) {
          if (Number(session.events[index].timestamp) > targetTimestamp) break;
          targetIndex = index;
        }

        const finished = targetIndex >= session.events.length - 1;

        if (targetIndex >= 0 && targetIndex !== currentClock.appliedIndex) {
          applyReplayIndex(targetIndex, session, activeTreeId);
          currentClock.appliedIndex = targetIndex;
        }

        setSessions((prev) => {
          const current = prev[activeProtocol];
          const nextTreeReplays = new Map(current.treeReplays || []);
          const existingTR = nextTreeReplays.get(activeTreeId);
          if (!existingTR) return prev;
          nextTreeReplays.set(activeTreeId, {
            ...existingTR,
            replayState: {
              ...existingTR.replayState,
              currentIndex:
                targetIndex >= 0
                  ? targetIndex
                  : existingTR.replayState.currentIndex,
              replayTime,
              isPlaying: finished ? false : existingTR.replayState.isPlaying,
            },
          });
          return {
            ...prev,
            [activeProtocol]: {
              ...current,
              treeReplays: nextTreeReplays,
            },
          };
        });

        if (!finished) {
          replayTimerRef.current = requestAnimationFrame(updateReplay);
        }
      };

      replayTimerRef.current = requestAnimationFrame(updateReplay);
    } else if (replayTimerRef.current) {
      cancelAnimationFrame(replayTimerRef.current);
    }
    return () => {
      if (replayTimerRef.current) cancelAnimationFrame(replayTimerRef.current);
    };
  }, [
    activeProtocol,
    activeTreeId,
    activeTreeReplay?.replayState?.isPlaying,
    activeTreeReplay?.replayState?.session,
    applyReplayIndex,
  ]);

  const handleLoadSession = (session: RecordingSession) => {
    const normalizedSession = normalizeRecordingSession(session);
    if (!normalizedSession) {
      return;
    }
    const loadedSession = cloneRecordingSession(normalizedSession);
    const prepared = prepareReplaySession(loadedSession, "loaded");
    const targetTreeId =
      (loadedSession.initial_trees || loadedSession.trees)[0]?.tree_id ||
      activeTreeId ||
      "MainTree";
    const storeKey = getTreeStoreKey(activeProtocol, targetTreeId);
    lastAppliedReplayRef.current.delete(storeKey);
    replayClockRef.current.delete(storeKey);

    setSessions((prev) => {
      const sess = prev[activeProtocol];
      const nextTreeReplays = new Map(sess.treeReplays || []);
      nextTreeReplays.set(targetTreeId, {
        protocol: activeProtocol,
        treeId: targetTreeId,
        session: loadedSession,
        replayState: prepared.replayState,
        treesMap: prepared.treesMap,
        events: loadedSession.events,
        lastRecordedSession: null,
        currentSession: loadedSession,
      });

      const liveTreesMap = sess.liveTreesMap || sess.treesMap;
      const compositeTreesMap = buildCompositeTreesMap(
        liveTreesMap,
        nextTreeReplays,
      );

      return {
        ...prev,
        [activeProtocol]: {
          ...sess,
          treesMap: compositeTreesMap,
          liveTreesMap,
          selectedTreeId: targetTreeId,
          selectedNodeId: null,
          treeReplays: nextTreeReplays,
        },
      };
    });
  };

  const handleSwitchToLive = () => {
    handleReplayStop();
  };

  const handleSwitchToRecorded = () => {
    if (!activeTreeId) return;
    const sess = sessions[activeProtocol];
    const treeReplay = sess.treeReplays?.get(activeTreeId);
    const session =
      treeReplay?.lastRecordedSession ||
      treeReplay?.currentSession ||
      sess.lastRecordedSession;
    if (session) {
      const loadedSession = cloneRecordingSession(session);
      const prepared = prepareReplaySession(
        loadedSession,
        treeReplay?.lastRecordedSession || sess.lastRecordedSession
          ? "record"
          : "loaded",
      );
      setSessions((prev) => {
        const current = prev[activeProtocol];
        const nextTreeReplays = new Map(current.treeReplays || []);
        nextTreeReplays.set(activeTreeId, {
          protocol: activeProtocol,
          treeId: activeTreeId,
          session: loadedSession,
          replayState: prepared.replayState,
          treesMap: prepared.treesMap,
          events: [],
          lastRecordedSession: session,
          currentSession: null,
        });
        const compositeTreesMap = buildCompositeTreesMap(
          current.liveTreesMap || current.treesMap,
          nextTreeReplays,
        );
        return {
          ...prev,
          [activeProtocol]: {
            ...current,
            treeReplays: nextTreeReplays,
            treesMap: compositeTreesMap,
          },
        };
      });
    }
  };

  // Switch Source / Protocol
  const handleSwitchSource = useCallback(
    (
      newSource: "btick" | "groot2" | "nav2",
      host?: string,
      port?: number,
      topic?: string,
    ) => {
      const activeSource: ProtocolSource = newSource;
      setActiveProtocol(activeSource);
      if (newSource === "btick") {
        ros2Service.switchSource("btick");
      } else if (newSource === "groot2") {
        ros2Service.switchSource("groot2", host ?? "127.0.0.1", port ?? 1667);
      } else {
        ros2Service.switchSource("nav2", topic);
      }
      if (newSource === "nav2") {
        const nav2TreeCount = sessions.nav2?.treesMap?.size || 0;
        if (nav2TreeCount === 0) {
          setIsNav2PromptOpen(true);
        }
      }
    },
    [sessions],
  );

  // Disconnect Protocol Handler
  const handleDisconnect = useCallback(() => {
    ros2Service.sendCommand({
      action: "disconnect",
      source: activeProtocol,
    });
    setSessions((prev) => {
      const sess = prev[activeProtocol];
      if (!sess) return prev;
      return {
        ...prev,
        [activeProtocol]: updateProtocolHeartbeat(sess, "DISCONNECTED"),
      };
    });
  }, [activeProtocol]);

  // Load XML File Handler
  const handleLoadTreeXml = useCallback(
    (xmlContent: string, fileName: string) => {
      setEditorInitialXml(xmlContent);
      const parsedTree = parseXmlToBTTreeModel(xmlContent, fileName);
      if (parsedTree) {
        (parsedTree as any).source = activeProtocol;
        (parsedTree as any).protocol = activeProtocol;
        getOrCreateTreeSession(activeProtocol, parsedTree.tree_id, parsedTree);

        setSessions((prev) => {
          const sess = prev[activeProtocol];
          const nextLiveTrees = new Map(sess.liveTreesMap || sess.treesMap);
          const nextClosedTreeIds = new Set(sess.closedTreeIds || []);
          nextClosedTreeIds.delete(parsedTree.tree_id);
          nextLiveTrees.set(parsedTree.tree_id, parsedTree);
          const compositeTreesMap = buildCompositeTreesMap(
            nextLiveTrees,
            sess.treeReplays,
          );

          return {
            ...prev,
            [activeProtocol]: {
              ...sess,
              treesMap: compositeTreesMap,
              liveTreesMap: nextLiveTrees,
              closedTreeIds: nextClosedTreeIds,
              selectedTreeId: parsedTree.tree_id,
            },
          };
        });

        ros2Service.sendCommand({
          action: "load_tree",
          source: activeProtocol,
          tree: parsedTree,
        });

        setIsNav2PromptOpen(false);
      } else {
        setActionWarning(
          `Failed to parse Behavior Tree XML from "${fileName}". Please ensure it is a valid BehaviorTree.CPP XML file.`,
        );
      }
    },
    [activeProtocol, getOrCreateTreeSession],
  );

  return (
    <div className="w-screen h-screen flex bg-app text-text-primary overflow-hidden font-sans select-text">
      {actionWarning && (
        <div
          className="fixed top-4 right-4 z-[100] flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{actionWarning}</span>
        </div>
      )}
      {/* Left Sidebar for Multi-Tree Management (Monitor) and Node Library (Editor) - Full Window Height */}
      <Sidebar
        appMode={appMode}
        onModeChange={setAppMode}
        isConnected={isConnected}
        connectionStatus={effectiveConnectionStatus}
        protocolStatuses={protocolStatuses}
        activeProtocol={activeProtocol}
        trees={treesList}
        selectedTreeId={selectedTreeId}
        onSelectTree={(id) => {
          setSelectedTreeId(id);
          setSelectedNodeId(null);
        }}
        onToggleTreeVisibility={handleToggleTreeVisibility}
        onCloseTree={handleCloseTree}
        onSelectAllTrees={handleSelectAllTrees}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filters={filters}
        onFiltersChange={setFilters}
        onToggleBreakpoint={handleToggleBreakpoint}
        onClearFault={handleClearFault}
        onClearAllBreakpoints={handleClearAllBreakpoints}
        onClearAllFaults={handleClearAllFaults}
        onSelectNode={(treeId, nodeId) =>
          handleSelectAndCenterNode(nodeId, treeId)
        }
        onOpenNav2Prompt={() => setIsNav2PromptOpen(true)}
        onSwitchSource={handleSwitchSource}
        onDisconnect={handleDisconnect}
        editorCustomNodeModels={editorState.document.nodeModels}
        editorAvailableSubtrees={(
          editorState.document.treeOrder ||
          Object.keys(editorState.document.trees)
        ).filter((id) => id !== editorState.activeTreeId)}
        editorSelectedNodeId={editorState.selectedNodeId}
        onEditorAddNode={handleEditorPaletteAdd}
        onEditorRegisterCustomNode={handleEditorRegisterCustomNode}
      />

      {/* Main Right Area: Top Header Bar + Workspace */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header Bar */}
        <Header
          appMode={appMode}
          onModeChange={setAppMode}
          isConnected={isConnected}
          connectionStatus={effectiveConnectionStatus}
          protocolStatuses={protocolStatuses}
          activeProtocol={activeProtocol}
          treesList={treesList}
          selectedTreeId={selectedTreeId}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          isRecording={isRecording}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onSaveSession={handleSaveSession}
          onLoadSession={handleLoadSession}
          onLoadTreeXml={handleLoadTreeXml}
          onSwitchSource={handleSwitchSource}
          onOpenNav2Prompt={() => setIsNav2PromptOpen(true)}
          onDisconnect={handleDisconnect}
          isReplaying={replayState.isReplaying}
          hasRecordedSession={Boolean(
            lastRecordedSession || replayState.session,
          )}
          recordedEventsCount={
            lastRecordedSession?.events.length ||
            replayState.session?.events.length ||
            0
          }
          onSwitchToLive={handleSwitchToLive}
          onSwitchToRecorded={handleSwitchToRecorded}
          liveStatusDisplayMode={liveStatusDisplayMode}
          onLiveStatusDisplayModeChange={
            activeProtocol === "btick" && !replayState.isReplaying
              ? setLiveStatusDisplayMode
              : undefined
          }
          editorTreesList={editorTreeOrderList}
          editorActiveTreeId={editorState.activeTreeId}
          onEditorSelectTree={editorState.setActiveTreeId}
          editorCanUndo={editorState.canUndo}
          editorCanRedo={editorState.canRedo}
          onEditorUndo={editorState.undo}
          onEditorRedo={editorState.redo}
          onEditorNew={editorState.newDocument}
          onEditorOpen={(content, fileName) =>
            editorState.openDocument(content, fileName)
          }
          onEditorSave={() => editorState.saveDocument()}
          editorIsDirty={editorState.isDirty}
          onEditorOpenRawXmlModal={() => setIsEditorRawXmlModalOpen(true)}
          editorValidationIssues={editorState.validationIssues}
          onEditorOpenValidationModal={() =>
            setIsEditorValidationModalOpen(true)
          }
        />

        {/* Workspace Area: XML Editor or Monitor */}
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          {appMode === "editor" ? (
            <div className="flex-1 w-full h-full overflow-hidden relative">
              <BTEditor
                appMode={appMode}
                onModeChange={setAppMode}
                editorState={editorState}
                embedded={true}
                isRawXmlModalOpen={isEditorRawXmlModalOpen}
                onCloseRawXmlModal={() => setIsEditorRawXmlModalOpen(false)}
                isValidationModalOpen={isEditorValidationModalOpen}
                onCloseValidationModal={() =>
                  setIsEditorValidationModalOpen(false)
                }
                getPlacementPositionRef={editorPlacementPositionRef}
              />
            </div>
          ) : (
            <>
              {/* Center Graph Canvas */}
              <div className="flex-1 flex overflow-hidden relative bg-canvas">
                {viewMode === "focused" ? (
                  <ErrorBoundary fallbackTitle="Behavior Tree Graph Error">
                    <ReactFlowProvider>
                      <div className="w-full h-full relative">
                        {activeTree && activeTree.visible !== false ? (
                          <BTGraphContent
                            key={activeTree.tree_id}
                            tree={activeTree}
                            selectedNodeId={selectedNodeId}
                            onSelectNode={setSelectedNodeId}
                            orientation={
                              activeTree
                                ? (treeOrientations.get(activeTree.tree_id) ??
                                  "vertical")
                                : undefined
                            }
                            onOrientationChange={
                              activeTree
                                ? (orientation) =>
                                    handleTreeOrientationChange(
                                      activeTree.tree_id,
                                      orientation,
                                    )
                                : undefined
                            }
                            activeProtocol={activeProtocol}
                            isReplaying={Boolean(
                              activeTreeReplay?.replayState?.isReplaying,
                            )}
                            onToggleBreakpoint={handleToggleBreakpoint}
                            onSetBreakpointOnce={handleSetBreakpointOnce}
                            onInjectFault={handleInjectFault}
                            onSetFaultOnce={handleSetFaultOnce}
                            onClearFault={handleClearFault}
                            onOpenBlackboard={() => setIsBlackboardOpen(true)}
                            pausedNodeTreeId={pausedNodeTreeId}
                            pausedNodeUid={pausedNodeUid}
                            pausedNodeName={pausedNodeName}
                            onResume={handleResume}
                            onForceSuccess={handleForceSuccess}
                            onForceFailure={handleForceFailure}
                            onClearBreakpoints={handleClearAllBreakpoints}
                            centerTarget={centerTarget}
                            viewport={
                              activeTree
                                ? treeViewportsRef.current.get(
                                    activeTree.tree_id,
                                  )
                                : undefined
                            }
                            onViewportChange={
                              activeTree
                                ? (viewport) =>
                                    handleTreeViewportChange(
                                      activeTree.tree_id,
                                      viewport,
                                    )
                                : undefined
                            }
                            initialNodePositions={
                              activeTree
                                ? treeNodePositionsRef.current.get(
                                    activeTree.tree_id,
                                  )
                                : undefined
                            }
                            onNodePositionsChange={
                              activeTree
                                ? (positions) =>
                                    handleTreeNodePositionsChange(
                                      activeTree.tree_id,
                                      positions,
                                    )
                                : undefined
                            }
                            initialCollapsedNodeIds={
                              activeTree
                                ? treeCollapsedNodesRef.current.get(
                                    activeTree.tree_id,
                                  )
                                : undefined
                            }
                            onCollapsedNodeIdsChange={
                              activeTree
                                ? (nodeIds) =>
                                    handleTreeCollapsedNodesChange(
                                      activeTree.tree_id,
                                      nodeIds,
                                    )
                                : undefined
                            }
                            pathMode={
                              activeTree
                                ? treePathModes.get(activeTree.tree_id)
                                : undefined
                            }
                            onPathModeChange={
                              activeTree
                                ? (mode) =>
                                    handleTreePathModeChange(
                                      activeTree.tree_id,
                                      mode,
                                    )
                                : undefined
                            }
                            showGrid={showGrid}
                            onSetNodePort={handleSetNodePort}
                          />
                        ) : activeProtocol === "nav2" ? (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-canvas p-6 text-center animate-in fade-in">
                            <div className="max-w-md w-full bg-surface-primary rounded-2xl border border-border-medium shadow-xl p-5 space-y-3.5">
                              <div className="flex items-center justify-center gap-3">
                                <div className="p-2.5 bg-accent-subtle text-accent-primary rounded-lg border border-accent-border shadow-2xs">
                                  <Compass className="w-6 h-6" />
                                </div>
                                <div className="text-left">
                                  <h3 className="text-xs font-bold text-text-primary uppercase tracking-wide font-mono">
                                    ROS 2 Nav2 Behavior Tree Monitor
                                  </h3>
                                  <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-md bg-state-success-bg text-state-success-text border border-state-success-border inline-block mt-0.5">
                                    Listening on /behavior_tree_log
                                  </span>
                                </div>
                              </div>

                              <div className="bg-surface-secondary border border-border-subtle rounded-lg p-3 text-xs text-text-secondary leading-relaxed text-left space-y-1 shadow-2xs">
                                <p className="font-semibold text-text-primary text-xs">
                                  Load XML to Match Live Transitions:
                                </p>
                                <p className="text-[11px] text-text-muted">
                                  Nav2 streams node status transitions on{" "}
                                  <code className="font-mono text-[10px] bg-surface-primary px-1.5 py-0.5 rounded-md border border-border-medium text-accent-primary font-bold">
                                    /behavior_tree_log
                                  </code>
                                  . Load your Nav2 BehaviorTree XML to match and
                                  visualize active nodes and colors in
                                  real-time.
                                </p>
                              </div>

                              <div className="space-y-1.5 pt-0.5">
                                <label className="w-full py-1.5 px-3 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-xs active:scale-95 border border-accent-border">
                                  <FileCode className="w-4 h-4 text-white" />
                                  <span>Browse & Load Nav2 XML File</span>
                                  <input
                                    type="file"
                                    accept=".xml"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                          const content = ev.target
                                            ?.result as string;
                                          if (content)
                                            handleLoadTreeXml(
                                              content,
                                              file.name,
                                            );
                                        };
                                        reader.readAsText(file);
                                        e.target.value = "";
                                      }
                                    }}
                                  />
                                </label>

                                <button
                                  onClick={() =>
                                    handleLoadTreeXml(
                                      NAV2_DEFAULT_SAMPLE_XML,
                                      "nav2_default_navigation.xml",
                                    )
                                  }
                                  className="w-full py-1.5 px-3 bg-surface-secondary hover:bg-surface-hover text-text-primary border border-border-medium rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 shadow-2xs active:scale-95"
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-accent-primary" />
                                  <span>Load Standard Nav2 Tree (Sample)</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-text-muted italic font-mono text-xs bg-canvas p-6 text-center">
                            <div className="font-semibold text-text-secondary mb-1 not-italic font-sans text-sm">
                              {activeTree && activeTree.visible === false
                                ? `Tree '${activeTree.display_name ?? activeTree.tree_name}' is currently hidden.`
                                : "No active Behavior Tree selected."}
                            </div>
                            {/* <div className="text-xs text-text-muted not-italic mb-3 font-sans">
                        Select or check a tree in the left sidebar, or load an XML file directly:
                      </div>
                      <label className="px-3.5 py-1.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-semibold not-italic transition-all cursor-pointer flex items-center gap-2 shadow-xs active:scale-95 border border-accent-border">
                        <FileCode className="w-3.5 h-3.5" />
                        <span>Load Tree (XML File)</span>
                        <input
                          type="file"
                          accept=".xml"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                const content = ev.target?.result as string;
                                if (content) handleLoadTreeXml(content, file.name);
                              };
                              reader.readAsText(file);
                              e.target.value = '';
                            }
                          }}
                        />
                      </label> */}
                          </div>
                        )}
                      </div>
                    </ReactFlowProvider>
                  </ErrorBoundary>
                ) : (
                  <div className="w-full h-full p-2 bg-canvas overflow-hidden flex flex-col">
                    {visibleTrees.length === 0 ? (
                      <div className="w-full h-full flex flex-col items-center justify-center text-text-muted font-mono text-xs italic gap-2.5 border border-dashed border-border-medium bg-surface-primary rounded-2xl m-1 p-6 text-center shadow-2xs">
                        <Grid className="w-6 h-6 text-accent-primary" />
                        <div>
                          <div className="text-text-primary font-bold text-xs not-italic font-sans">
                            No trees selected for Grid display.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`w-full h-full grid ${visibleTrees.length === 1 ? "grid-cols-1" : visibleTrees.length === 2 ? "grid-cols-2" : visibleTrees.length <= 4 ? "grid-cols-2 grid-rows-2" : "grid-cols-3"} gap-2 overflow-y-auto`}
                      >
                        {visibleTrees.map((t) => (
                          <ReactFlowProvider key={t.tree_id}>
                            <div
                              onClick={() => setSelectedTreeId(t.tree_id)}
                              className={`w-full h-full min-h-[300px] rounded-2xl border flex flex-col overflow-hidden relative transition-all shadow-2xs ${
                                t.tree_id === selectedTreeId
                                  ? "border-accent-primary ring-2 ring-accent-primary/20 bg-canvas"
                                  : "border-border-medium hover:border-border-strong bg-canvas"
                              }`}
                            >
                              <div className="h-8 px-3 bg-surface-primary border-b border-border-subtle flex items-center justify-between z-10 shrink-0">
                                <div className="flex items-center gap-1.5 overflow-hidden">
                                  <span
                                    className="font-bold text-xs text-text-primary truncate font-mono"
                                    title={t.display_name || t.tree_name}
                                  >
                                    {t.display_name || t.tree_name}
                                  </span>
                                  {t.node_name && (
                                    <span
                                      className="text-[10px] text-text-muted truncate font-mono"
                                      title={`${t.node_name}${t.pid ? ` (PID: ${t.pid})` : ""}${t.hostname ? ` @ ${t.hostname}` : ""}`}
                                    >
                                      ({t.node_name}
                                      {t.pid ? `:${t.pid}` : ""})
                                    </span>
                                  )}
                                  <span
                                    className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded-md border ${
                                      t.status === "STOPPED" ||
                                      t.status === "DESTROYED"
                                        ? "bg-surface-secondary text-text-muted border-border-subtle"
                                        : t.status === "RUNNING"
                                          ? "bg-state-running-bg text-state-running-text border-state-running-border font-bold"
                                          : t.status === "FAILURE"
                                            ? "bg-state-failure-bg text-state-failure-text border-state-failure-border font-bold"
                                            : "bg-state-success-bg text-state-success-text border-state-success-border font-bold"
                                    }`}
                                  >
                                    {t.status || "ACTIVE"}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedTreeId(t.tree_id);
                                      setViewMode("focused");
                                    }}
                                    className="flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-semibold bg-surface-secondary hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border-medium transition-all cursor-pointer shadow-2xs active:scale-95"
                                    title="Open this tree in Focused Single-Tree View"
                                  >
                                    <Maximize2 className="w-3 h-3 text-accent-primary" />
                                    <span>Focus</span>
                                  </button>

                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleTreeVisibility(t.tree_id);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer shadow-2xs active:scale-95"
                                    title="Hide from Grid View"
                                  >
                                    <EyeOff className="w-3 h-3" />
                                  </button>

                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCloseTree(t.tree_id);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-state-failure-bg text-text-muted hover:text-state-failure-text transition-all cursor-pointer shadow-2xs active:scale-95"
                                    title="Close from Grid View"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              <div className="flex-1 w-full h-full relative overflow-hidden bg-canvas">
                                <BTGraphContent
                                  tree={t}
                                  selectedNodeId={selectedNodeId}
                                  onSelectNode={setSelectedNodeId}
                                  orientation={
                                    treeOrientations.get(t.tree_id) ??
                                    "vertical"
                                  }
                                  onOrientationChange={(orientation) =>
                                    handleTreeOrientationChange(
                                      t.tree_id,
                                      orientation,
                                    )
                                  }
                                  activeProtocol={activeProtocol}
                                  isReplaying={Boolean(
                                    currentSession.treeReplays?.get(t.tree_id)
                                      ?.replayState?.isReplaying,
                                  )}
                                  onToggleBreakpoint={handleToggleBreakpoint}
                                  onSetBreakpointOnce={handleSetBreakpointOnce}
                                  onInjectFault={handleInjectFault}
                                  onSetFaultOnce={handleSetFaultOnce}
                                  onClearFault={handleClearFault}
                                  onOpenBlackboard={() =>
                                    setIsBlackboardOpen(true)
                                  }
                                  pausedNodeTreeId={pausedNodeTreeId}
                                  pausedNodeUid={pausedNodeUid}
                                  pausedNodeName={pausedNodeName}
                                  onResume={handleResume}
                                  onForceSuccess={handleForceSuccess}
                                  onForceFailure={handleForceFailure}
                                  onClearBreakpoints={handleClearAllBreakpoints}
                                  centerTarget={centerTarget}
                                  viewport={treeViewportsRef.current.get(
                                    t.tree_id,
                                  )}
                                  onViewportChange={(viewport) =>
                                    handleTreeViewportChange(
                                      t.tree_id,
                                      viewport,
                                    )
                                  }
                                  initialNodePositions={treeNodePositionsRef.current.get(
                                    t.tree_id,
                                  )}
                                  onNodePositionsChange={(positions) =>
                                    handleTreeNodePositionsChange(
                                      t.tree_id,
                                      positions,
                                    )
                                  }
                                  initialCollapsedNodeIds={treeCollapsedNodesRef.current.get(
                                    t.tree_id,
                                  )}
                                  onCollapsedNodeIdsChange={(nodeIds) =>
                                    handleTreeCollapsedNodesChange(
                                      t.tree_id,
                                      nodeIds,
                                    )
                                  }
                                  pathMode={treePathModes.get(t.tree_id)}
                                  onPathModeChange={(mode) =>
                                    handleTreePathModeChange(t.tree_id, mode)
                                  }
                                  showGrid={showGrid}
                                  onSetNodePort={handleSetNodePort}
                                />
                              </div>
                            </div>
                          </ReactFlowProvider>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Right Node Details Panel */}
                {selectedNodeId && (
                  <NodeDetailsPanel
                    key={`${activeProtocol}::${activeTree?.tree_id}::${selectedNodeId}`}
                    node={
                      activeTree?.nodes.find((n) => n.id === selectedNodeId) ||
                      null
                    }
                    tree={activeTree}
                    activeProtocol={activeProtocol}
                    isReplaying={replayState.isReplaying}
                    onClose={() => setSelectedNodeId(null)}
                    onSelectNode={(nodeId) => handleSelectAndCenterNode(nodeId)}
                    onOpenBlackboard={() => setIsBlackboardOpen(true)}
                    onToggleBreakpoint={handleToggleBreakpoint}
                    onSetBreakpointOnce={handleSetBreakpointOnce}
                    onInjectFault={handleInjectFault}
                    onSetFaultOnce={handleSetFaultOnce}
                    onClearFault={handleClearFault}
                    onResume={handleResume}
                    onForceSuccess={handleForceSuccess}
                    onForceFailure={handleForceFailure}
                    onSetNodePort={handleSetNodePort}
                  />
                )}

                {/* Right Blackboard Watcher Drawer */}
                {isBlackboardOpen && (
                  <BlackboardWatcher
                    tree={activeTree}
                    isOpen={isBlackboardOpen}
                    activeProtocol={activeProtocol}
                    onClose={() => setIsBlackboardOpen(false)}
                    onSelectNode={(nodeId) => handleSelectAndCenterNode(nodeId)}
                    onSetBlackboard={handleSetBlackboard}
                  />
                )}
              </div>

              {/* Replay Control Bar */}
              {replayState.isReplaying && (
                <ReplayControlBar
                  replayState={replayState}
                  onPlay={handleReplayPlay}
                  onPause={handleReplayPause}
                  onClearRecording={handleClearRecording}
                  onStepForward={handleReplayStepForward}
                  onStepBack={handleReplayStepBack}
                  onSeek={handleReplaySeek}
                  onSpeedChange={handleReplaySpeedChange}
                  onSaveSession={
                    replayState.replaySource === "record"
                      ? handleSaveRecordedReplay
                      : undefined
                  }
                />
              )}

              {/* Collapsible Bottom Panel */}
              <BottomPanel
                events={events}
                tree={activeTree}
                trees={treesList}
                isReplaying={Boolean(
                  activeTreeReplay?.replayState?.isReplaying,
                )}
                activeProtocol={activeProtocol}
                onClearEvents={() => {
                  if (activeTreeId) {
                    const storeKey = getTreeStoreKey(
                      activeProtocol,
                      activeTreeId,
                    );
                    const sessionState = treeSessionsRef.current.get(storeKey);
                    if (sessionState) {
                      void sessionState.store.dispose();
                      treeSessionsRef.current.delete(storeKey);
                      const targetTree =
                        currentSession.treesMap.get(activeTreeId);
                      getOrCreateTreeSession(
                        activeProtocol,
                        activeTreeId,
                        targetTree,
                      );
                    }
                  }
                  setSessions((prev) => {
                    const sess = prev[activeProtocol];
                    const nextTreeEvents = new Map(sess.treeEvents || []);
                    if (activeTreeId) {
                      nextTreeEvents.set(activeTreeId, []);
                    } else {
                      nextTreeEvents.clear();
                    }
                    const nextEvents = activeTreeId
                      ? (sess.events || []).filter(
                          (e) => e.tree_id && e.tree_id !== activeTreeId,
                        )
                      : [];
                    const nextLiveEvents =
                      activeTreeId && sess.liveEvents
                        ? sess.liveEvents.filter(
                            (e) => e.tree_id && e.tree_id !== activeTreeId,
                          )
                        : activeTreeId
                          ? sess.liveEvents
                          : [];

                    let nextTreeReplays = sess.treeReplays;
                    if (activeTreeId && sess.treeReplays?.has(activeTreeId)) {
                      nextTreeReplays = new Map(sess.treeReplays);
                      const tr = nextTreeReplays.get(activeTreeId)!;
                      nextTreeReplays.set(activeTreeId, {
                        ...tr,
                        events: [],
                      });
                    }

                    return {
                      ...prev,
                      [activeProtocol]: {
                        ...sess,
                        events: nextEvents,
                        liveEvents: nextLiveEvents,
                        treeEvents: nextTreeEvents,
                        treeReplays: nextTreeReplays,
                      },
                    };
                  });
                }}
                isPaused={isPaused}
                onTogglePause={() =>
                  setSessions((prev) => ({
                    ...prev,
                    [activeProtocol]: {
                      ...prev[activeProtocol],
                      isPaused: !prev[activeProtocol].isPaused,
                    },
                  }))
                }
                onSelectNode={(nodeId, treeId) =>
                  handleSelectAndCenterNode(nodeId, treeId)
                }
                onToggleBreakpoint={handleToggleBreakpoint}
                onClearFault={handleClearFault}
                onClearAllBreakpoints={handleClearAllBreakpoints}
                onClearAllFaults={handleClearAllFaults}
              />
            </>
          )}
        </div>
      </div>

      {/* Nav2 XML Prompt Modal */}
      {appMode === "monitor" && (
        <Nav2PromptModal
          isOpen={isNav2PromptOpen}
          onClose={() => setIsNav2PromptOpen(false)}
          onLoadTreeXml={handleLoadTreeXml}
        />
      )}
    </div>
  );
};
