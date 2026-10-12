import {
  IProtocolHandler,
  ProtocolSessionState,
  MAX_RAM_EVENT_HISTORY,
} from "../types";
import {
  BTNodeModel,
  NodeStatus,
  TreeStatus,
  TransitionEvent,
} from "../../types/bt";
import { attachRootCard, mergeNodesWithExisting } from "../../utils/xmlParser";
import {
  initializeCleanSessionState,
  updateProtocolHeartbeat,
  findMatchingLogicalTreeKey,
} from "../session/sessionManager";

function findNav2EventNodeId(
  nodes: BTNodeModel[],
  event: TransitionEvent,
): string | undefined {
  if (event.uid !== undefined) {
    const uidMatch = nodes.find((node) => node.uid === event.uid);
    if (uidMatch) {
      return uidMatch.id;
    }
  }

  const exactIdMatch = nodes.find((node) => node.id === event.node_id);
  if (exactIdMatch) {
    return exactIdMatch.id;
  }

  const nameMatches = nodes.filter((node) => node.name === event.node_name);
  return nameMatches.length === 1 ? nameMatches[0].id : undefined;
}

export class Nav2Handler implements IProtocolHandler {
  public protocol = "nav2" as const;
  public displayName = "Nav2 (ROS 2 BehaviorTree Log)";
  public badge = "Nav2 Log";
  public supportsDebugging = false;
  public supportsFaultInjection = false;
  public supportsXmlLoad = true;
  public supportsBlackboardWrite = false;
  public supportsNodePortEdit = false;

  public handleMessage(
    data: any,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    if (!data) return state;

    // 0. Protocol Liveness Heartbeat
    if (
      (data.type === "protocol_heartbeat" || data.type === "status") &&
      (data.protocol === "nav2" ||
        data.source === "nav2" ||
        (!data.protocol && !data.source))
    ) {
      const connStatus = data.status || "CONNECTED_IDLE";
      return updateProtocolHeartbeat(
        state,
        connStatus,
        data.execution_instance_id,
      );
    }

    // 0b. Explicit Tree Destroyed / Removed Lifecycle Event
    if (
      data.type === "tree_destroyed" ||
      data.type === "tree_removed" ||
      data.type === "tree_closed"
    ) {
      const treeId = data.tree_id;
      if (!treeId || !state.treesMap.has(treeId)) {
        return state;
      }
      const nextTreesMap = new Map(state.treesMap);
      nextTreesMap.delete(treeId);

      let nextSelectedId = state.selectedTreeId;
      if (nextSelectedId === treeId) {
        nextSelectedId =
          nextTreesMap.size > 0 ? nextTreesMap.keys().next().value! : null;
      }

      const isThisTreePaused = state.pausedNodeTreeId === treeId;

      return {
        ...state,
        treesMap: nextTreesMap,
        liveTreesMap: nextTreesMap,
        selectedTreeId: nextSelectedId,
        isPaused: isThisTreePaused ? false : state.isPaused,
        pausedNodeTreeId: isThisTreePaused ? null : state.pausedNodeTreeId,
        pausedNodeUid: isThisTreePaused ? null : state.pausedNodeUid,
        pausedNodeName: isThisTreePaused ? undefined : state.pausedNodeName,
      };
    }

    // 1. Behavior Tree Structure Discovery / Loaded XML Registration
    if (data.type === "tree_created" || data.type === "tree") {
      const rawTree = data;
      let nodesList: BTNodeModel[] = [];
      if (Array.isArray(rawTree.nodes)) {
        nodesList = rawTree.nodes;
      } else if (rawTree.nodes && typeof rawTree.nodes === "object") {
        nodesList = Object.values(rawTree.nodes);
      }
      if (nodesList.length === 0) {
        return state;
      }

      const treeId = rawTree.tree_id || "Nav2Navigation";
      if (state.closedTreeIds?.has(treeId)) {
        return state;
      }
      const executionInstanceId =
        rawTree.execution_instance_id ||
        state.session?.executionInstanceId ||
        `nav2_inst_${Date.now()}`;
      const isNewExecutionInstance = Boolean(
        rawTree.execution_instance_id &&
        state.session?.executionInstanceId &&
        state.session.executionInstanceId !== "init_0" &&
        state.session.executionInstanceId !== executionInstanceId,
      );

      let workingState = state;
      if (isNewExecutionInstance) {
        workingState = initializeCleanSessionState(
          state,
          treeId,
          executionInstanceId,
          state.session?.connectionStatus || "DISCONNECTED",
        );
      }

      const nextTreesMap = new Map(workingState.treesMap);
      const matchedExistingKey = findMatchingLogicalTreeKey(
        nextTreesMap,
        treeId,
        rawTree.tree_name,
        rawTree.xml_path,
        nodesList,
        "nav2",
        rawTree.origin,
        rawTree.node_name,
        rawTree.pid,
        rawTree.hostname,
      );
      const existingTree = matchedExistingKey
        ? nextTreesMap.get(matchedExistingKey)
        : nextTreesMap.get(treeId);
      const isRestart =
        isNewExecutionInstance ||
        Boolean(
          rawTree.is_restart ||
          rawTree.reconnected ||
          (existingTree &&
            (existingTree.status === "DESTROYED" ||
              existingTree.status === "STOPPED" ||
              (matchedExistingKey && matchedExistingKey !== treeId))),
        );

      const mergedNodes = mergeNodesWithExisting(
        nodesList,
        existingTree?.nodes,
        isRestart,
      );

      const treeToSave = attachRootCard({
        type: "tree_created",
        tree_id: treeId,
        tree_name: rawTree.tree_name || treeId,
        root_node_id:
          rawTree.root_node_id || (nodesList.length > 0 ? nodesList[0].id : ""),
        status: rawTree.status || existingTree?.status || "IDLE",
        xml_path: rawTree.xml_path,
        nodes: mergedNodes,
        visible: existingTree ? existingTree.visible : true,
        blackboard: rawTree.blackboard || existingTree?.blackboard || {},
        source: "nav2",
        protocol: "nav2",
      });

      if (matchedExistingKey && matchedExistingKey !== treeId) {
        nextTreesMap.delete(matchedExistingKey);
      }
      nextTreesMap.set(treeId, treeToSave);

      const nextSelectedTreeId =
        workingState.selectedTreeId &&
        (workingState.selectedTreeId === matchedExistingKey ||
          nextTreesMap.has(workingState.selectedTreeId))
          ? workingState.selectedTreeId === matchedExistingKey
            ? treeId
            : workingState.selectedTreeId
          : treeId;

      return {
        ...workingState,
        isConnected: workingState.session.connectionStatus !== "DISCONNECTED",
        session: {
          ...workingState.session,
          sessionId:
            rawTree.session_id ||
            `${workingState.protocol}_${treeId}_${executionInstanceId}`,
          executionInstanceId,
        },
        treesMap: nextTreesMap,
        liveTreesMap: nextTreesMap,
        selectedTreeId: nextSelectedTreeId,
      };
    }

    // 2. Blackboard Scope Update (e.g. goal pose, plan waypoints)
    if (data.type === "blackboard_update") {
      const targetId = data.tree_id;
      const bbData = data.blackboard;
      if (bbData && typeof bbData === "object" && state.treesMap.size > 0) {
        const nextTreesMap = new Map(state.treesMap);
        let matchedKey =
          targetId && nextTreesMap.has(targetId) ? targetId : null;
        if (!matchedKey && data.tree_name) {
          for (const [id, t] of nextTreesMap.entries()) {
            if (t.tree_name === data.tree_name) {
              matchedKey = id;
              break;
            }
          }
        }
        if (!matchedKey && nextTreesMap.size === 1) {
          matchedKey = nextTreesMap.keys().next().value!;
        }
        if (matchedKey && nextTreesMap.has(matchedKey)) {
          const target = nextTreesMap.get(matchedKey)!;
          nextTreesMap.set(matchedKey, {
            ...target,
            blackboard: { ...(target.blackboard || {}), ...bbData },
          });
        } else {
          for (const [id, target] of nextTreesMap.entries()) {
            nextTreesMap.set(id, {
              ...target,
              blackboard: { ...(target.blackboard || {}), ...bbData },
            });
          }
        }
        return {
          ...state,
          treesMap: nextTreesMap,
          liveTreesMap: nextTreesMap,
        };
      }
      return state;
    }

    // 3. Live Status Transition Event
    if (data.type === "transition") {
      const event = data as TransitionEvent;
      if (!event.source) (event as any).source = "nav2";
      if (!event.protocol) (event as any).protocol = "nav2";
      const prevMap = state.treesMap;

      if (prevMap.size === 0) {
        const targetTreeId =
          event.tree_id || state.selectedTreeId || "Nav2Navigation";
        const nextEvents = [event, ...state.events].slice(
          0,
          MAX_RAM_EVENT_HISTORY,
        );
        const nextTreeEvents = new Map(state.treeEvents || []);
        const prevTreeList = nextTreeEvents.get(targetTreeId) || [];
        nextTreeEvents.set(
          targetTreeId,
          [event, ...prevTreeList].slice(0, MAX_RAM_EVENT_HISTORY),
        );
        return {
          ...state,
          events: nextEvents,
          treeEvents: nextTreeEvents,
        };
      }

      let targetTreeId =
        event.tree_id || state.selectedTreeId || "Nav2Navigation";
      if (!prevMap.has(targetTreeId)) {
        for (const [id, t] of prevMap.entries()) {
          if (event.tree_name && t.tree_name === event.tree_name) {
            targetTreeId = id;
            break;
          }
        }
      }
      if (
        !prevMap.has(targetTreeId) &&
        state.selectedTreeId &&
        prevMap.has(state.selectedTreeId)
      ) {
        targetTreeId = state.selectedTreeId;
      } else if (!prevMap.has(targetTreeId) && prevMap.size > 0) {
        targetTreeId = prevMap.keys().next().value!;
      }
      if (!prevMap.has(targetTreeId)) {
        const nextEvents = [event, ...state.events].slice(
          0,
          MAX_RAM_EVENT_HISTORY,
        );
        const nextTreeEvents = new Map(state.treeEvents || []);
        const previousTreeEvents = nextTreeEvents.get(targetTreeId) || [];
        nextTreeEvents.set(
          targetTreeId,
          [event, ...previousTreeEvents].slice(0, MAX_RAM_EVENT_HISTORY),
        );
        return {
          ...state,
          events: nextEvents,
          treeEvents: nextTreeEvents,
        };
      }

      let workingState = state;
      let nextMap = new Map(workingState.treesMap);
      let targetTree = nextMap.get(targetTreeId)!;
      const matchedNodeId = findNav2EventNodeId(targetTree.nodes, event);
      const matchedNode = targetTree.nodes.find(
        (node) => node.id === matchedNodeId,
      );
      // Nav2 emits IDLE cleanup transitions between rapid execution updates.
      // Keep the last meaningful runtime state instead of briefly regressing
      // an executing node to IDLE.
      const effectiveStatus =
        event.status === "IDLE" && matchedNode
          ? matchedNode.status
          : event.status;
      const observationKey = matchedNode
        ? `${targetTreeId}:${matchedNode.uid}`
        : undefined;
      const previousObservation = observationKey
        ? workingState.nav2Observations?.[observationKey]
        : undefined;
      const nextObservation =
        matchedNode && observationKey
          ? {
              uid: matchedNode.uid,
              previousStatus:
                previousObservation?.currentStatus ?? matchedNode.status,
              currentStatus: effectiveStatus,
              lastResult:
                effectiveStatus === "SUCCESS" || effectiveStatus === "FAILURE"
                  ? effectiveStatus
                  : (previousObservation?.lastResult ?? null),
              lastTransitionTimestamp: event.timestamp,
            }
          : undefined;
      const updatedNodes = targetTree.nodes.map((n) => {
        if (n.id === matchedNodeId) {
          const nextStatus = effectiveStatus;

          const nextLastResult =
            nextStatus === "SUCCESS" || nextStatus === "FAILURE"
              ? nextStatus
              : n.last_result;

          const nextOutputPortsValues = { ...(n.output_ports_values || {}) };
          if (Array.isArray(event.output_ports)) {
            for (const op of event.output_ports) {
              if (op.port_name && op.value !== undefined) {
                nextOutputPortsValues[op.port_name] = String(op.value);
              }
            }
          }

          const nextPortDetails = n.port_details?.map((pd) => {
            if (nextOutputPortsValues[pd.name] !== undefined) {
              return { ...pd, runtime_value: nextOutputPortsValues[pd.name] };
            }
            return pd;
          });

          return {
            ...n,
            status: nextStatus,
            last_result: nextLastResult,
            last_duration:
              event.duration !== undefined && event.duration > 0
                ? event.duration
                : n.last_duration,
            output_ports_values: nextOutputPortsValues,
            port_details: nextPortDetails,
          };
        }
        return n;
      });
      const finalNodes = updatedNodes;
      const nextTreeStatus: TreeStatus =
        matchedNode?.id === targetTree.root_node_id
          ? effectiveStatus === "SKIPPED"
            ? "IDLE"
            : (effectiveStatus as TreeStatus)
          : targetTree.status;

      nextMap.set(targetTreeId, {
        ...targetTree,
        blackboard: event.blackboard
          ? { ...(targetTree.blackboard || {}), ...event.blackboard }
          : targetTree.blackboard,
        status: nextTreeStatus,
        nodes: finalNodes,
      });
      const nextObservations =
        nextObservation && observationKey
          ? {
              ...(workingState.nav2Observations || {}),
              [observationKey]: nextObservation,
            }
          : workingState.nav2Observations;

      const nextEvents = [event, ...workingState.events].slice(
        0,
        MAX_RAM_EVENT_HISTORY,
      );
      const nextTreeEvents = new Map(
        workingState.treeEvents || state.treeEvents || [],
      );
      const prevTreeList = nextTreeEvents.get(targetTreeId) || [];
      nextTreeEvents.set(
        targetTreeId,
        [event, ...prevTreeList].slice(0, MAX_RAM_EVENT_HISTORY),
      );

      return {
        ...workingState,
        treesMap: nextMap,
        liveTreesMap: nextMap,
        nav2Observations: nextObservations,
        events: nextEvents,
        treeEvents: nextTreeEvents,
      };
    }

    return state;
  }

  public handleToggleBreakpoint(
    treeId: string,
    uid: number,
    once: boolean | undefined,
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    if (!uid) return state;

    let isCurrentlyEnabled = false;
    for (const [tId, t] of state.treesMap.entries()) {
      if (!treeId || tId === treeId || t.tree_name === treeId) {
        const found = t.nodes.find((n) => n.uid === uid);
        if (found && found.is_breakpoint) {
          isCurrentlyEnabled = true;
          break;
        }
      }
    }

    const nextEnabled = !isCurrentlyEnabled;
    const nextBreakpoints = new Set(state.breakpoints);
    const nextBreakpointOnce = new Set(state.breakpointOnceSet);
    const key = `${treeId || "Nav2"}::${uid}`;

    if (nextEnabled) {
      nextBreakpoints.add(key);
      if (once) nextBreakpointOnce.add(key);
    } else {
      nextBreakpoints.delete(key);
      nextBreakpointOnce.delete(key);
    }

    const nextTreesMap = new Map(state.treesMap);
    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!treeId || tId === treeId || tree.tree_name === treeId) {
        const updatedNodes = tree.nodes.map((n) =>
          n.uid === uid
            ? {
                ...n,
                is_breakpoint: nextEnabled,
                breakpoint_once: nextEnabled ? !!once : false,
              }
            : n,
        );
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    return {
      ...state,
      breakpoints: nextBreakpoints,
      breakpointOnceSet: nextBreakpointOnce,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleSetBreakpointOnce(
    treeId: string,
    uid: number,
    once: boolean,
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    const key = `${treeId || "Nav2"}::${uid}`;
    const nextBreakpointOnce = new Set(state.breakpointOnceSet);
    if (once) nextBreakpointOnce.add(key);
    else nextBreakpointOnce.delete(key);

    const nextTreesMap = new Map(state.treesMap);
    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!treeId || tId === treeId || tree.tree_name === treeId) {
        const updatedNodes = tree.nodes.map((n) =>
          n.uid === uid ? { ...n, breakpoint_once: !!once } : n,
        );
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    return {
      ...state,
      breakpointOnceSet: nextBreakpointOnce,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleInjectFault(
    _treeId: string,
    _uid: number,
    _mode: string,
    _delayMs: number | undefined,
    _once: boolean | undefined,
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    return state;
  }

  public handleSetFaultOnce(
    _treeId: string,
    _uid: number,
    _once: boolean,
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    return state;
  }

  public handleClearFault(
    _treeId: string,
    _uid: number,
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    return state;
  }

  public handleClearAllBreakpoints(
    _targetTreeId: string | undefined,
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    return state;
  }

  public handleClearAllFaults(
    _targetTreeId: string | undefined,
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    return state;
  }

  public handleContinuation(
    _action: "resume" | "force_success" | "force_failure",
    _targetTreeId: string | undefined,
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    return state;
  }

  public handleSetBlackboard(
    _treeId: string,
    _key: string,
    _value: any,
    _valueType: "bool" | "int" | "double" | "string",
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    // Nav2 is read-only for Blackboard writing
    return state;
  }

  public handleSetNodePort(
    _treeId: string,
    _uid: number,
    _portName: string,
    _value: string,
    _mode: string,
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    // Nav2 is read-only for Node Port editing
    return state;
  }
}

export const nav2Handler = new Nav2Handler();
