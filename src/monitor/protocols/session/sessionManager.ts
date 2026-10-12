import {
  ProtocolSessionState,
  ProtocolConnectionStatus,
  SessionInfo,
} from "../types";
import {
  BTNodeModel,
  BTTreeModel,
  TransitionEvent,
  TreeStatus,
  NodeStatus,
  RecordingSession,
  RecordingSnapshot,
  RecordedNodeExecution,
  BTPortDetail,
} from "../../types/bt";
import { isMatchNode } from "../../utils/xmlParser";

/**
 * Normalizes a tree identifier or name by stripping ephemeral instance/PID/timestamp/hex suffixes
 * such as _12345, _inst_12345, _pid1, _newPID, _5eb22776..., #1, etc.
 */
export function normalizeTreeBaseName(nameOrId: string): string {
  if (!nameOrId) return "";
  return nameOrId
    .replace(
      /_(?:inst|cycle|pid|process|newpid|[0-9a-f]{8,}|\d+)[0-9a-f_]*$/i,
      "",
    )
    .replace(/\s*#\d+$/i, "")
    .trim();
}

/**
 * Determines whether an incoming tree discovery matches an existing logical tree model.
 * Criteria:
 * 1. Must belong to the same protocol (if protocol is specified and matched).
 * 2. Exact match on tree_id.
 * 3. Origin check: if both specify different non-empty origins, they are distinct pipelines.
 * 4. XML Path check: if both specify different non-empty xml_paths, they are distinct trees.
 * 5. Base name match (normalized tree_name or tree_id) with compatible node overlap.
 * 6. Multi-tree protection: distinct trees with identical generic names (e.g. 'MainTree')
 *    or different node sets MUST NOT be merged.
 */
export function isSameLogicalTree(
  existing: BTTreeModel,
  incomingTreeId: string,
  _incomingTreeName?: string,
  incomingXmlPath?: string,
  incomingNodes?: BTNodeModel[],
  protocol?: string,
  incomingOrigin?: string,
  incomingNodeName?: string,
  _incomingPid?: number,
  incomingHostname?: string,
): boolean {
  if (protocol && existing.protocol && existing.protocol !== protocol) {
    return false;
  }

  // Exact ID match
  if (existing.tree_id === incomingTreeId) {
    return true;
  }

  // If node_name or hostname are specified and different, they belong to different processes
  if (
    existing.node_name &&
    incomingNodeName &&
    existing.node_name !== incomingNodeName
  ) {
    return false;
  }
  if (
    existing.hostname &&
    incomingHostname &&
    existing.hostname !== incomingHostname
  ) {
    return false;
  }

  // If origins are specified and different, they represent distinct pipelines/trees
  if (existing.origin && incomingOrigin && existing.origin !== incomingOrigin) {
    return false;
  }

  // If both have xml_path specified and they are different, they are different trees
  if (
    existing.xml_path &&
    incomingXmlPath &&
    existing.xml_path !== incomingXmlPath
  ) {
    return false;
  }

  // Match based on normalized tree_id (identity is tree_id, not display name)
  const normExistingId = normalizeTreeBaseName(existing.tree_id);
  const normIncomingId = normalizeTreeBaseName(incomingTreeId);
  const idBaseMatch = Boolean(
    normExistingId && normIncomingId && normExistingId === normIncomingId,
  );

  if (!idBaseMatch) {
    return false;
  }

  // If node lists are available for both, verify compatibility / overlap
  if (
    incomingNodes &&
    incomingNodes.length > 0 &&
    existing.nodes &&
    existing.nodes.length > 0
  ) {
    const existingNodeKeys = new Set<string>();
    for (const n of existing.nodes) {
      if (n.type === "Root" || n.name === "Root") continue;
      if (n.id) existingNodeKeys.add(`id:${n.id}`);
      if (n.name) existingNodeKeys.add(`name:${n.name}`);
      if (n.uid && n.uid > 0) existingNodeKeys.add(`uid:${n.uid}`);
    }

    let matchCount = 0;
    let incomingNonRootCount = 0;
    for (const n of incomingNodes) {
      if (n.type === "Root" || n.name === "Root") continue;
      incomingNonRootCount++;
      if (
        (n.id && existingNodeKeys.has(`id:${n.id}`)) ||
        (n.name && existingNodeKeys.has(`name:${n.name}`)) ||
        (n.uid && n.uid > 0 && existingNodeKeys.has(`uid:${n.uid}`))
      ) {
        matchCount++;
      }
    }

    // If incoming has non-root nodes and zero overlap with existing non-root nodes,
    // they are completely different trees that happen to share a base id.
    if (
      incomingNonRootCount > 0 &&
      existingNodeKeys.size > 0 &&
      matchCount === 0
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Finds the key in treesMap that represents the same logical tree as the incoming tree.
 */
export function findMatchingLogicalTreeKey(
  treesMap: Map<string, BTTreeModel>,
  incomingTreeId: string,
  incomingTreeName?: string,
  incomingXmlPath?: string,
  incomingNodes?: BTNodeModel[],
  protocol?: string,
  incomingOrigin?: string,
  incomingNodeName?: string,
  incomingPid?: number,
  incomingHostname?: string,
): string | null {
  if (treesMap.has(incomingTreeId)) {
    return incomingTreeId;
  }

  for (const [id, tree] of treesMap.entries()) {
    if (
      isSameLogicalTree(
        tree,
        incomingTreeId,
        incomingTreeName,
        incomingXmlPath,
        incomingNodes,
        protocol,
        incomingOrigin,
        incomingNodeName,
        incomingPid,
        incomingHostname,
      )
    ) {
      return id;
    }
  }

  return null;
}

/**
 * Initializes a clean session state when a newly started tree, restarted execution instance,
 * or reconnected protocol session is detected.
 */
export function initializeCleanSessionState(
  prevState: ProtocolSessionState,
  treeId: string,
  executionInstanceId: string,
  connectionStatus: ProtocolConnectionStatus = "CONNECTED_IDLE",
): ProtocolSessionState {
  const sessionId = `${prevState.protocol}_${treeId}_${executionInstanceId}`;

  return {
    ...prevState,
    session: {
      sessionId,
      executionInstanceId,
      connectionStatus,
      startedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      reconnectAttempts: 0,
    },
    isConnected:
      connectionStatus === "CONNECTED_RUNNING" ||
      connectionStatus === "CONNECTED_IDLE",
    isPaused: false,
    pausedNodeTreeId: null,
    pausedNodeUid: null,
    pausedNodeName: undefined,
    // Preserve protocol-isolated event log history across session restarts and switches
    events: prevState.events || [],
    recordingInitialTrees: [],
    // Reset breakpoints and fault rules for the new session
    breakpoints: new Set(),
    breakpointOnceSet: new Set(),
    faultRules: new Map(),
    replayState: {
      isReplaying: false,
      isPlaying: false,
      currentIndex: 0,
      speed: 1.0,
      session: null,
    },
    currentSession: null,
  };
}

/**
 * The root transition is a bookkeeping event, not a useful indication of
 * which nodes executed in the next tick. Use the first direct child as the
 * common tick boundary for every protocol.
 */
export function isFirstRootChildEvent(
  tree: BTTreeModel,
  event: TransitionEvent,
): boolean {
  const firstChild = tree.nodes.find(
    (node) => node.parent_id === tree.root_node_id,
  );
  if (!firstChild) {
    return false;
  }

  return (
    firstChild.id === event.node_id ||
    firstChild.uid === event.uid ||
    firstChild.name === event.node_name
  );
}

/**
 * Shared live-display behavior used by every protocol adapter. A parent
 * re-tick resets only that parent's direct children; unrelated branches remain
 * intact. The event itself identifies the parent execution boundary.
 */
export function getParentRetickChildIds(
  tree: BTTreeModel,
  event: TransitionEvent,
  mode: "current" | "parent_retick_reset",
): Set<string> {
  if (mode !== "parent_retick_reset") return new Set();
  const referenceNode = tree.nodes.find(
    (node) => node.children_ids.length > 0 && isMatchNode(node, event),
  );
  if (
    !referenceNode ||
    !isMatchNode(referenceNode, event) ||
    referenceNode.children_ids.length === 0
  ) {
    return new Set();
  }

  const previousTick = referenceNode.tick_count;
  if (
    event.tick_count === undefined ||
    previousTick === undefined ||
    !Number.isFinite(event.tick_count) ||
    !Number.isFinite(previousTick) ||
    event.tick_count <= previousTick
  ) {
    return new Set();
  }

  return new Set(
    tree.nodes
      .filter((node) => node.parent_id === referenceNode.id)
      .map((node) => node.id),
  );
}

export const REPLAY_KEYFRAME_INTERVAL = 250;
export const REPLAY_KEYFRAME_PROXIMITY = 50;

export const cloneTrees = (trees: BTTreeModel[]): BTTreeModel[] =>
  trees.map((tree) => ({
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

export const createReplayBaselineTree = (tree: BTTreeModel): BTTreeModel => ({
  ...tree,
  status: "IDLE",
  last_active_node_id: undefined,
  current_cycle_id: undefined,
  cycle_count: undefined,
  blackboard: tree.blackboard ? { ...tree.blackboard } : tree.blackboard,
  nodes: tree.nodes.map((node) => ({
    ...node,
    children_ids: [...node.children_ids],
    ports: { ...node.ports },
    attributes: { ...node.attributes },
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

/**
 * Incrementally tracks replay tree state during live recording in O(1) event time,
 * capturing keyframes periodically at REPLAY_KEYFRAME_INTERVAL boundaries.
 */
export class IncrementalKeyframeRecorder {
  public treeMap: Map<string, BTTreeModel>;
  public activeExecutions: Map<
    string,
    { start_timestamp: number; tick_count?: number }
  >;
  public keyframeInterval: number;

  constructor(
    initialTrees: BTTreeModel[] = [],
    keyframeInterval = REPLAY_KEYFRAME_INTERVAL,
  ) {
    this.keyframeInterval = keyframeInterval;
    this.treeMap = new Map();
    this.activeExecutions = new Map();
    this.reset(initialTrees);
  }

  public reset(initialTrees: BTTreeModel[] = []): void {
    this.treeMap = new Map(
      initialTrees.map((tree) => [
        tree.tree_id,
        createReplayBaselineTree(tree),
      ]),
    );
    this.activeExecutions = new Map();
  }

  public ensureTree(tree: BTTreeModel): void {
    if (!this.treeMap.has(tree.tree_id)) {
      this.treeMap.set(tree.tree_id, createReplayBaselineTree(tree));
    }
  }

  public applyEvent(event: TransitionEvent, eventIndex: number): void {
    const targetTreeId =
      event.tree_id ||
      (this.treeMap.size === 1 ? this.treeMap.keys().next().value : undefined);
    let targetTree = targetTreeId ? this.treeMap.get(targetTreeId) : undefined;
    if (!targetTree) return;

    const execKey = `${event.tree_id}::${event.uid}::${event.node_id}`;
    let startTime: number | undefined = undefined;
    let duration: number | undefined = event.duration;
    let tickCount: number | undefined = event.tick_count;

    if (event.status === "RUNNING") {
      startTime = event.timestamp;
      if (!this.activeExecutions.has(execKey)) {
        this.activeExecutions.set(execKey, {
          start_timestamp: event.timestamp,
          tick_count: event.tick_count,
        });
      }
    } else if (
      event.status === "SUCCESS" ||
      event.status === "FAILURE" ||
      event.status === "IDLE"
    ) {
      const active = this.activeExecutions.get(execKey);
      if (active) {
        startTime = active.start_timestamp;
        tickCount = active.tick_count ?? event.tick_count;
        duration =
          event.duration !== undefined && event.duration > 0
            ? event.duration
            : Math.max(0, event.timestamp - active.start_timestamp);
        if (event.status !== "IDLE") {
          this.activeExecutions.delete(execKey);
        }
      }
    }

    let matchedNodeId: string | undefined = undefined;
    const updatedNodes = targetTree.nodes.map((node) => {
      if (!isReplayEventNodeMatch(node, event)) return node;
      matchedNodeId = node.id;
      const replayStatus = getReplayNodeStatus(node, event);
      const outputPortsValues = event.output_ports?.length
        ? event.output_ports.reduce<Record<string, string>>(
            (values, update) => ({
              ...values,
              [update.port_name]: update.value,
            }),
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
        last_start_time: startTime ?? node.last_start_time,
        last_duration: duration ?? event.duration ?? node.last_duration,
        tick_count: tickCount ?? event.tick_count ?? node.tick_count,
        output_ports_values: outputPortsValues,
        port_details: portDetails,
        ports: updatedPorts,
        attributes: updatedAttributes,
      };
    });

    this.treeMap.set(
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
  }

  public shouldCaptureKeyframe(eventIndex: number): boolean {
    return eventIndex > 0 && eventIndex % this.keyframeInterval === 0;
  }

  public captureKeyframe(
    eventIndex: number,
    timestamp: number,
  ): RecordingSnapshot {
    return {
      eventIndex,
      timestamp,
      trees: cloneTrees(Array.from(this.treeMap.values())),
    };
  }
}

export const findEventIndexByTimestamp = (
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

export function normalizeAndKeyframeSnapshots(
  candidateSnapshots: unknown[] | undefined,
  events: TransitionEvent[],
  eventIndexMap: Map<number, number>,
  initialTrees: BTTreeModel[],
  nodeExecutions?: RecordedNodeExecution[],
  keyframeInterval = REPLAY_KEYFRAME_INTERVAL,
  proximityThreshold = REPLAY_KEYFRAME_PROXIMITY,
): RecordingSnapshot[] {
  if (!Array.isArray(candidateSnapshots)) candidateSnapshots = [];

  // 1. Correct existing snapshots by timestamp (authoritative) or fallback to eventIndexMap
  const correctedExisting: RecordingSnapshot[] = [];
  for (const item of candidateSnapshots) {
    if (!item || typeof item !== "object") continue;
    const sn = item as Partial<RecordingSnapshot>;
    if (!Array.isArray(sn.trees) || sn.trees.length === 0) continue;

    let targetIndex = -1;
    if (typeof sn.timestamp === "number" && Number.isFinite(sn.timestamp)) {
      targetIndex = findEventIndexByTimestamp(events, sn.timestamp);
    }
    if (
      targetIndex < 0 &&
      typeof sn.eventIndex === "number" &&
      Number.isFinite(sn.eventIndex)
    ) {
      targetIndex = eventIndexMap.get(sn.eventIndex) ?? sn.eventIndex;
    }

    if (targetIndex >= 0 && targetIndex < events.length) {
      correctedExisting.push({
        eventIndex: targetIndex,
        timestamp:
          typeof sn.timestamp === "number" && Number.isFinite(sn.timestamp)
            ? sn.timestamp
            : events[targetIndex].timestamp,
        trees: cloneTrees(sn.trees),
      });
    }
  }

  correctedExisting.sort((a, b) => a.eventIndex - b.eventIndex);

  // If session is small or has no events/trees, return existing corrected snapshots
  if (events.length < keyframeInterval || initialTrees.length === 0) {
    return correctedExisting;
  }

  // 2. Identify missing keyframe intervals
  const existingIndices = new Set(correctedExisting.map((s) => s.eventIndex));
  const missingKeyframeIndices: number[] = [];

  for (let i = keyframeInterval; i < events.length; i += keyframeInterval) {
    let hasNearby = false;
    for (
      let offset = -proximityThreshold;
      offset <= proximityThreshold;
      offset++
    ) {
      if (existingIndices.has(i + offset)) {
        hasNearby = true;
        break;
      }
    }
    if (!hasNearby) {
      missingKeyframeIndices.push(i);
    }
  }

  // If all keyframe positions already have nearby existing snapshots, return existing
  if (missingKeyframeIndices.length === 0) {
    return correctedExisting;
  }

  // 3. Single O(N) forward reconstruction pass to generate missing keyframes
  const missingIndexSet = new Set(missingKeyframeIndices);
  const executionMap = new Map<string, RecordedNodeExecution>();
  if (nodeExecutions) {
    for (const candidate of nodeExecutions) {
      if (candidate.start_event_index !== undefined) {
        executionMap.set(
          `${candidate.tree_id}::${candidate.uid}::start::${candidate.start_event_index}`,
          candidate,
        );
      }
      if (candidate.end_event_index !== undefined) {
        executionMap.set(
          `${candidate.tree_id}::${candidate.uid}::end::${candidate.end_event_index}::${candidate.status}`,
          candidate,
        );
      }
    }
  }

  const treeMap = new Map<string, BTTreeModel>(
    initialTrees.map((tree) => [tree.tree_id, createReplayBaselineTree(tree)]),
  );
  const generatedSnapshots: RecordingSnapshot[] = [];
  const maxMissingIndex =
    missingKeyframeIndices[missingKeyframeIndices.length - 1];

  for (let i = 0; i <= maxMissingIndex && i < events.length; i++) {
    applySingleReplayEvent(treeMap, events[i], i, executionMap);

    if (missingIndexSet.has(i)) {
      generatedSnapshots.push({
        eventIndex: i,
        timestamp: events[i].timestamp,
        trees: cloneTrees(Array.from(treeMap.values())),
      });
    }
  }

  // 4. Merge, deduplicate by eventIndex (preferring existing), and sort
  const combined = [...correctedExisting];
  const combinedSet = new Set(correctedExisting.map((s) => s.eventIndex));
  for (const gen of generatedSnapshots) {
    if (!combinedSet.has(gen.eventIndex)) {
      combined.push(gen);
      combinedSet.add(gen.eventIndex);
    }
  }

  combined.sort((a, b) => a.eventIndex - b.eventIndex);
  return combined;
}

export function normalizeRecordingSession(
  input: unknown,
): RecordingSession | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<RecordingSession>;
  if (!Array.isArray(candidate.events) || !Array.isArray(candidate.trees))
    return null;
  if (
    !candidate.trees.every(
      (tree) =>
        Boolean(tree) &&
        typeof tree.tree_id === "string" &&
        Array.isArray(tree.nodes) &&
        typeof tree.root_node_id === "string",
    )
  )
    return null;

  const rawEvents = candidate.events.filter(
    (event): event is TransitionEvent =>
      Boolean(event) &&
      typeof event === "object" &&
      Number.isFinite(Number(event.timestamp)) &&
      typeof event.node_id === "string",
  );

  if (rawEvents.length !== candidate.events.length) return null;
  const orderedEvents = rawEvents
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const timestampDelta = left.event.timestamp - right.event.timestamp;
      return timestampDelta !== 0 ? timestampDelta : left.index - right.index;
    });
  const events = orderedEvents.map(({ event }) => event);
  const eventIndexMap = new Map(
    orderedEvents.map(({ index }, newIndex) => [index, newIndex]),
  );

  const nodeExecutions = Array.isArray(candidate.node_executions)
    ? candidate.node_executions.map((execution) => ({
        ...execution,
        start_event_index:
          eventIndexMap.get(execution.start_event_index) ??
          execution.start_event_index,
        end_event_index:
          execution.end_event_index === undefined
            ? undefined
            : (eventIndexMap.get(execution.end_event_index) ??
              execution.end_event_index),
      }))
    : undefined;

  const initialTrees =
    Array.isArray(candidate.initial_trees) && candidate.initial_trees.length > 0
      ? candidate.initial_trees
      : candidate.trees;

  const snapshots = normalizeAndKeyframeSnapshots(
    candidate.snapshots,
    events,
    eventIndexMap,
    initialTrees,
    nodeExecutions,
    REPLAY_KEYFRAME_INTERVAL,
    REPLAY_KEYFRAME_PROXIMITY,
  );

  return {
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : `loaded_${Date.now()}`,
    name:
      typeof candidate.name === "string" && candidate.name
        ? candidate.name
        : "Loaded BT Session",
    recorded_at:
      typeof candidate.recorded_at === "string"
        ? candidate.recorded_at
        : new Date().toISOString(),
    trees: candidate.trees,
    events,
    snapshots,
    initial_trees: Array.isArray(candidate.initial_trees)
      ? candidate.initial_trees
      : undefined,
    node_executions: nodeExecutions,
  };
}

/**
 * Updates heartbeat timestamp and live connection status without resetting state.
 */
export function updateProtocolHeartbeat(
  state: ProtocolSessionState,
  connectionStatus: ProtocolConnectionStatus,
  executionInstanceId?: string,
): ProtocolSessionState {
  const isConnected =
    connectionStatus === "CONNECTED_RUNNING" ||
    connectionStatus === "CONNECTED_IDLE";
  const now = Date.now();

  const prevSession: SessionInfo = state.session || {
    sessionId: `${state.protocol}_default_0`,
    executionInstanceId: "init_0",
    startedAt: now,
    lastHeartbeatAt: 0,
    connectionStatus: "DISCONNECTED",
    reconnectAttempts: 0,
  };

  const nextSession: SessionInfo = {
    ...prevSession,
    connectionStatus,
    lastHeartbeatAt: now,
    executionInstanceId: executionInstanceId || prevSession.executionInstanceId,
    reconnectAttempts:
      connectionStatus === "RECONNECTING"
        ? prevSession.reconnectAttempts + 1
        : 0,
  };

  // If disconnected, clean up old live tree instances from treesMap (preserving manually uploaded offline XML files)
  // If disconnected or reconnecting, reset any RUNNING nodes in treesMap to IDLE
  let nextTreesMap = state.treesMap;
  if (
    connectionStatus === "DISCONNECTED" ||
    connectionStatus === "RECONNECTING"
  ) {
    let hasChanges = false;
    const updatedMap = new Map(state.treesMap);
    for (const [tId, tree] of state.treesMap.entries()) {
      let treeChanged = false;
      const updatedNodes = tree.nodes.map((node) => {
        if (
          node.status === "RUNNING" ||
          node.status === "PAUSED_AT_BREAKPOINT"
        ) {
          hasChanges = true;
          treeChanged = true;
          return { ...node, status: "IDLE" as NodeStatus };
        }
        return node;
      });
      if (treeChanged || tree.status === "RUNNING") {
        hasChanges = true;
        updatedMap.set(tId, {
          ...tree,
          status: "IDLE" as TreeStatus,
          nodes: updatedNodes,
        });
      }
    }
    if (hasChanges) {
      nextTreesMap = updatedMap;
    }
  }

  return {
    ...state,
    isConnected,
    treesMap: nextTreesMap,
    liveTreesMap: nextTreesMap,
    session: nextSession,
    isPaused:
      connectionStatus === "DISCONNECTED" || connectionStatus === "RECONNECTING"
        ? false
        : state.isPaused,
    pausedNodeTreeId:
      connectionStatus === "DISCONNECTED" || connectionStatus === "RECONNECTING"
        ? null
        : state.pausedNodeTreeId,
    pausedNodeUid:
      connectionStatus === "DISCONNECTED" || connectionStatus === "RECONNECTING"
        ? null
        : state.pausedNodeUid,
    pausedNodeName:
      connectionStatus === "DISCONNECTED" || connectionStatus === "RECONNECTING"
        ? undefined
        : state.pausedNodeName,
  };
}

/**
 * Starts a new execution cycle for a tree:
 * - Resets all runtime node statuses to 'IDLE'.
 * - Preserves last_result for historical inspection.
 * - Clears transient delay and pause states.
 * - STRICTLY PRESERVES tree topology, node metadata, ports, attributes,
 *   breakpoints, and fault rules!
 */
export function startNewExecutionCycle(
  state: ProtocolSessionState,
  treeId: string,
  cycleId: string,
  _timestamp: number = Date.now(),
): ProtocolSessionState {
  let targetId = treeId;
  if (!state.treesMap.has(targetId) && state.treesMap.size > 0) {
    targetId = state.treesMap.keys().next().value!;
  }

  const currentTree = state.treesMap.get(targetId);
  if (!currentTree) {
    return {
      ...state,
      currentCycleId: cycleId,
      cycleCount: (state.cycleCount || 0) + 1,
    };
  }

  const resetNodes: BTNodeModel[] = currentTree.nodes.map((node) => {
    const isNodePaused = Boolean(
      state.isPaused &&
      state.pausedNodeTreeId === targetId &&
      node.uid === state.pausedNodeUid &&
      state.breakpoints.has(`${targetId}::${node.uid}`),
    );
    if (isNodePaused) {
      return {
        ...node,
        status: (node.status === "PAUSED_AT_BREAKPOINT"
          ? node.status
          : "PAUSED_AT_BREAKPOINT") as NodeStatus,
        is_paused: true,
      };
    }
    return {
      ...node,
      status: "IDLE" as NodeStatus,
      is_paused: false,
      delay_active: false,
      delay_started_at: undefined,
      delay_activation_id: undefined,
    };
  });

  const nextTree: BTTreeModel = {
    ...currentTree,
    status: "RUNNING",
    current_cycle_id: cycleId,
    cycle_count: (currentTree.cycle_count || 0) + 1,
    nodes: resetNodes,
  };

  const nextTreesMap = new Map(state.treesMap);
  nextTreesMap.set(targetId, nextTree);

  return {
    ...state,
    currentCycleId: cycleId,
    cycleCount: (state.cycleCount || 0) + 1,
    isPaused: state.isPaused,
    pausedNodeTreeId: state.isPaused ? state.pausedNodeTreeId : null,
    pausedNodeUid: state.isPaused ? state.pausedNodeUid : null,
    pausedNodeName: state.isPaused ? state.pausedNodeName : undefined,
    treesMap: nextTreesMap,
    liveTreesMap: nextTreesMap,
  };
}
