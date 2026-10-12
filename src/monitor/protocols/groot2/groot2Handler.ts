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
import {
  attachRootCard,
  mergeNodesWithExisting,
  isMatchNode,
} from "../../utils/xmlParser";
import {
  initializeCleanSessionState,
  updateProtocolHeartbeat,
  startNewExecutionCycle,
  findMatchingLogicalTreeKey,
} from "../session/sessionManager";

export class Groot2Handler implements IProtocolHandler {
  public protocol = "groot2" as const;
  public displayName = "Groot2 (ZMQ / TCP)";
  public badge = "ZMQ";
  public supportsDebugging = true;
  public supportsFaultInjection = true;
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
      (data.protocol === "groot2" ||
        data.source === "groot2" ||
        (!data.protocol && !data.source))
    ) {
      const connStatus = data.status || "CONNECTED_IDLE";
      return updateProtocolHeartbeat(
        state,
        connStatus,
        data.execution_instance_id,
      );
    }

    // 0b. Explicit Execution Cycle Started Lifecycle Event
    if (data.type === "execution_cycle_started") {
      const targetId = data.tree_id || state.selectedTreeId || "Groot2Tree";
      const cycleId = data.cycle_id || `cycle_${Date.now()}`;
      return startNewExecutionCycle(state, targetId, cycleId, data.timestamp);
    }

    // 0c. Explicit Tree Destroyed / Removed Lifecycle Event
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

    // 1. Groot2 Behavior Tree Structure Discovery Message
    if (data.type === "tree_created" || data.type === "tree") {
      const rawTree = data;
      let nodesList: BTNodeModel[] = [];
      if (Array.isArray(rawTree.nodes)) {
        nodesList = rawTree.nodes;
      } else if (rawTree.nodes && typeof rawTree.nodes === "object") {
        nodesList = Object.values(rawTree.nodes);
      }

      const treeId = rawTree.tree_id || "Groot2Tree";
      if (state.closedTreeIds?.has(treeId)) {
        return state;
      }
      const executionInstanceId =
        rawTree.execution_instance_id || `groot_inst_${Date.now()}`;
      const isNewExecutionInstance = Boolean(
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
          "CONNECTED_IDLE",
        );
      }

      const nextTreesMap = new Map(workingState.treesMap);
      const matchedExistingKey = findMatchingLogicalTreeKey(
        nextTreesMap,
        treeId,
        rawTree.tree_name,
        rawTree.xml_path,
        nodesList,
        "groot2",
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
          rawTree.protocol === "groot2" ||
          (existingTree &&
            (existingTree.status === "DESTROYED" ||
              existingTree.status === "STOPPED" ||
              (matchedExistingKey && matchedExistingKey !== treeId))),
        );

      let nextBreakpoints = workingState.breakpoints;
      let nextBreakpointOnce = workingState.breakpointOnceSet;
      let nextFaultRules = workingState.faultRules;

      if (isRestart) {
        nextBreakpoints = new Set();
        nextBreakpointOnce = new Set();
        nextFaultRules = new Map();
      }

      const mergedNodes = mergeNodesWithExisting(
        nodesList,
        existingTree?.nodes,
        isRestart,
      );

      const hasRunningNode = mergedNodes.some(
        (n) =>
          n.type !== "Root" &&
          n.name !== "Root" &&
          (n.status === "RUNNING" ||
            n.status === ("PAUSED_AT_BREAKPOINT" as any)),
      );
      const rootChildNode =
        mergedNodes.find((n) => n.parent_id === rawTree.root_node_id) ||
        mergedNodes.find(
          (n) =>
            n.type !== "Root" &&
            (n.parent_id === "" ||
              n.parent_id.startsWith("Root") ||
              n.uid === 1),
        );

      let calculatedTreeStatus: TreeStatus = "IDLE";
      if (hasRunningNode) {
        calculatedTreeStatus = "RUNNING";
      } else if (
        rootChildNode &&
        (rootChildNode.status === "SUCCESS" ||
          rootChildNode.status === "FAILURE")
      ) {
        calculatedTreeStatus = rootChildNode.status as TreeStatus;
      } else {
        calculatedTreeStatus = rawTree.status || "IDLE";
      }

      const treeToSave = attachRootCard({
        type: "tree_created",
        tree_id: treeId,
        tree_name: rawTree.tree_name || treeId,
        root_node_id:
          rawTree.root_node_id || (nodesList.length > 0 ? nodesList[0].id : ""),
        status: calculatedTreeStatus,
        xml_path: rawTree.xml_path,
        nodes: mergedNodes,
        visible: existingTree ? existingTree.visible : true,
        blackboard: rawTree.blackboard || existingTree?.blackboard || {},
        source: "groot2",
        protocol: "groot2",
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
        isConnected: true,
        session: {
          ...workingState.session,
          sessionId:
            rawTree.session_id ||
            `${workingState.protocol}_${treeId}_${executionInstanceId}`,
          executionInstanceId,
          connectionStatus: hasRunningNode
            ? "CONNECTED_RUNNING"
            : "CONNECTED_IDLE",
          lastHeartbeatAt: Date.now(),
        },
        treesMap: nextTreesMap,
        liveTreesMap: nextTreesMap,
        selectedTreeId: nextSelectedTreeId,
        breakpoints: nextBreakpoints,
        breakpointOnceSet: nextBreakpointOnce,
        faultRules: nextFaultRules,
        isPaused: isRestart ? false : workingState.isPaused,
        pausedNodeTreeId: isRestart ? null : workingState.pausedNodeTreeId,
        pausedNodeUid: isRestart ? null : workingState.pausedNodeUid,
        pausedNodeName: isRestart ? undefined : workingState.pausedNodeName,
      };
    }

    // 2. Groot2 Scoped Blackboard Update
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

    // 3. Groot2 Execution Resumed Lifecycle Event
    if (data.type === "execution_resumed") {
      const forcedStatus = data.forced_status;
      const targetUid = data.uid;
      const isForced = forcedStatus === "SUCCESS" || forcedStatus === "FAILURE";
      const nextMap = new Map();
      for (const [tId, tree] of state.treesMap.entries()) {
        nextMap.set(tId, {
          ...tree,
          nodes: tree.nodes.map((n) => {
            const isTarget = targetUid ? n.uid === targetUid : n.is_paused;
            return {
              ...n,
              status:
                isTarget && isForced
                  ? (forcedStatus as NodeStatus)
                  : isTarget
                    ? ("RUNNING" as NodeStatus)
                    : n.status,
              last_result:
                isTarget && isForced
                  ? (forcedStatus as NodeStatus)
                  : n.last_result,
              is_paused: false,
            };
          }),
        });
      }

      return {
        ...state,
        isPaused: false,
        pausedNodeTreeId: null,
        pausedNodeUid: null,
        pausedNodeName: undefined,
        treesMap: nextMap,
        liveTreesMap: nextMap,
      };
    }

    // 4. Groot2 Live Status Transition & Breakpoint Reached Event
    if (data.type === "transition") {
      const event = data as TransitionEvent;
      if (!event.source) (event as any).source = "groot2";
      if (!event.protocol) (event as any).protocol = "groot2";
      const prevMap = state.treesMap;

      if (prevMap.size === 0) {
        const nextEvents = [event, ...state.events].slice(
          0,
          MAX_RAM_EVENT_HISTORY,
        );
        const nextTreeEvents = new Map(state.treeEvents || []);
        const treeKey = event.tree_id || "Groot2Tree";
        const prevList = nextTreeEvents.get(treeKey) || [];
        nextTreeEvents.set(
          treeKey,
          [event, ...prevList].slice(0, MAX_RAM_EVENT_HISTORY),
        );
        return {
          ...state,
          events: nextEvents,
          treeEvents: nextTreeEvents,
        };
      }

      let targetTreeId = event.tree_id || state.selectedTreeId || "Groot2Tree";
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
      if (!prevMap.has(targetTreeId)) return state;

      let workingState = state;
      let nextMap = new Map(workingState.treesMap);
      let targetTree = nextMap.get(targetTreeId)!;
      const isNewCycleExplicit = Boolean(
        event.cycle_id &&
        targetTree.current_cycle_id &&
        event.cycle_id !== targetTree.current_cycle_id,
      );
      const isTreeFinished =
        targetTree.status === "SUCCESS" || targetTree.status === "FAILURE";
      const isNewCycle =
        (isNewCycleExplicit || isTreeFinished) &&
        event.status === "RUNNING" &&
        !workingState.isPaused;

      if (isNewCycle) {
        const cycleId = event.cycle_id || `cycle_${Date.now()}`;
        workingState = startNewExecutionCycle(
          workingState,
          targetTreeId,
          cycleId,
          event.timestamp,
        );
        nextMap = new Map(workingState.treesMap);
        targetTree = nextMap.get(targetTreeId)!;
      }

      const canonicalKey = `${targetTreeId}::${event.uid}`;
      const hasActiveBreakpoint = Boolean(
        event.uid &&
        (workingState.breakpoints.has(canonicalKey) ||
          targetTree.nodes.find((n) => n.uid === event.uid)?.is_breakpoint),
      );

      const isPausedEvent = Boolean(
        ((event as any).current_status === "PAUSED_AT_BREAKPOINT" ||
          (event as any).status === "PAUSED_AT_BREAKPOINT") &&
        hasActiveBreakpoint,
      );

      let nextPausedTreeId = workingState.pausedNodeTreeId;
      let nextPausedUid = workingState.pausedNodeUid;
      let nextPausedName = workingState.pausedNodeName;
      let nextSelectedNodeId = workingState.selectedNodeId;
      let nextIsPaused = workingState.isPaused;

      if (isPausedEvent) {
        nextPausedTreeId = event.tree_id || targetTreeId;
        nextPausedUid = event.uid;
        nextPausedName = event.node_name;
        if (
          !workingState.selectedTreeId ||
          workingState.selectedTreeId === (event.tree_id || targetTreeId)
        ) {
          const matchedNode = targetTree.nodes.find((n) =>
            isMatchNode(n, event),
          );
          nextSelectedNodeId = matchedNode
            ? matchedNode.id
            : event.node_id || workingState.selectedNodeId;
        }
        nextIsPaused = true;
      } else if (
        nextPausedTreeId === targetTreeId &&
        nextPausedUid === event.uid &&
        (event.status === "SUCCESS" ||
          event.status === "FAILURE" ||
          event.status === "SKIPPED")
      ) {
        nextPausedTreeId = null;
        nextPausedUid = null;
        nextPausedName = undefined;
        nextIsPaused = false;
      }

      const nextFaultRules = new Map(workingState.faultRules);
      let nextBreakpoints = workingState.breakpoints;
      let nextBreakpointOnce = workingState.breakpointOnceSet;

      const updatedNodes = targetTree.nodes.map((n) => {
        const canonicalKey = `${targetTree.tree_id}::${n.uid}`;
        const isTargetTreePaused = Boolean(
          nextIsPaused &&
          (!nextPausedTreeId || targetTree.tree_id === nextPausedTreeId),
        );
        const isNodePausedCurrently = Boolean(
          isTargetTreePaused &&
          nextPausedUid !== null &&
          nextPausedUid !== undefined &&
          n.uid === nextPausedUid,
        );

        if (isMatchNode(n, event)) {
          let nextStatus = event.status;

          if (isPausedEvent) {
            nextStatus = "PAUSED_AT_BREAKPOINT" as NodeStatus;
          } else if (isNodePausedCurrently && nextIsPaused) {
            if (
              event.status === "SUCCESS" ||
              event.status === "FAILURE" ||
              event.status === "SKIPPED"
            ) {
              nextStatus = event.status;
            } else {
              nextStatus = "PAUSED_AT_BREAKPOINT" as NodeStatus;
            }
          } else if (event.status === "IDLE") {
            if (n.status === "SUCCESS" || n.status === "FAILURE") {
              nextStatus = n.status;
            } else if (
              event.prev_status === "SUCCESS" ||
              event.prev_status === "FAILURE"
            ) {
              nextStatus = event.prev_status as NodeStatus;
            } else if (
              n.last_result === "SUCCESS" ||
              n.last_result === "FAILURE"
            ) {
              nextStatus = n.last_result as NodeStatus;
            }
          }

          const nextLastResult =
            nextStatus === "SUCCESS" || nextStatus === "FAILURE"
              ? nextStatus
              : n.last_result;
          const isFinished =
            nextStatus === "SUCCESS" ||
            nextStatus === "FAILURE" ||
            nextStatus === "SKIPPED";
          const nextIsPausedNode = isPausedEvent
            ? true
            : isFinished
              ? false
              : isNodePausedCurrently && nextIsPaused;
          const shouldClearFault = n.fault_once && isFinished;
          const isOnceBp = Boolean(
            n.breakpoint_once ||
            workingState.breakpointOnceSet.has(canonicalKey),
          );
          const shouldClearBp = isOnceBp && isFinished;

          if (shouldClearFault && n.uid) {
            const canonicalKey = `${targetTreeId}::${n.uid}`;
            nextFaultRules.delete(canonicalKey);
            sendCommand({
              action: "clear_fault",
              tree_id: targetTreeId,
              uid: n.uid,
              source: "groot2",
            });
          }

          if (shouldClearBp && n.uid) {
            if (nextBreakpoints === state.breakpoints) {
              nextBreakpoints = new Set(state.breakpoints);
              nextBreakpointOnce = new Set(state.breakpointOnceSet);
            }
            nextBreakpoints.delete(canonicalKey);
            nextBreakpointOnce.delete(canonicalKey);
            sendCommand({
              action: "clear_breakpoint",
              tree_id: targetTreeId,
              uid: n.uid,
              source: "groot2",
            });
          }

          const nextOutputPortsValues = { ...(n.output_ports_values || {}) };
          if (Array.isArray(event.output_ports)) {
            for (const op of event.output_ports) {
              if (op.port_name && op.value !== undefined) {
                nextOutputPortsValues[op.port_name] = String(op.value);
              }
            }
          } else if (
            !event.output_ports &&
            (event.status === "SUCCESS" || event.status === "FAILURE") &&
            event.blackboard &&
            typeof event.blackboard === "object"
          ) {
            for (const pd of n.port_details || []) {
              const val = pd.value || "";
              if (val.startsWith("{") && val.endsWith("}")) {
                const rawK = val.slice(1, -1);
                if (rawK in event.blackboard) {
                  nextOutputPortsValues[pd.name] = String(
                    event.blackboard[rawK],
                  );
                }
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
            fault_mode: shouldClearFault ? undefined : n.fault_mode,
            fault_delay_ms: shouldClearFault ? undefined : n.fault_delay_ms,
            fault_once: shouldClearFault ? false : n.fault_once,
            is_paused: nextIsPausedNode,
            is_breakpoint: shouldClearBp ? false : n.is_breakpoint,
            breakpoint_once: shouldClearBp ? false : n.breakpoint_once,
            last_duration:
              event.duration !== undefined && event.duration > 0
                ? event.duration
                : n.last_duration,
            tick_count:
              (n.tick_count || 0) + (event.status === "RUNNING" ? 1 : 0),
            output_ports_values: nextOutputPortsValues,
            port_details: nextPortDetails,
          };
        }

        if (isNodePausedCurrently && nextIsPaused) {
          return {
            ...n,
            status:
              n.status === "SUCCESS" ||
              n.status === "FAILURE" ||
              n.status === "SKIPPED"
                ? n.status
                : ("PAUSED_AT_BREAKPOINT" as NodeStatus),
            is_paused: true,
          };
        }

        if (n.is_paused || n.status === "PAUSED_AT_BREAKPOINT") {
          return {
            ...n,
            status:
              n.status === "PAUSED_AT_BREAKPOINT"
                ? (n.last_result as NodeStatus) || "IDLE"
                : n.status,
            is_paused: false,
          };
        }

        return n;
      });

      const rootChildNode =
        updatedNodes.find((n) => n.parent_id === targetTree.root_node_id) ||
        updatedNodes.find(
          (n) =>
            n.type !== "Root" &&
            (n.parent_id === "" ||
              n.parent_id.startsWith("Root") ||
              n.uid === 1),
        );

      const hasRunningNode = updatedNodes.some(
        (n) =>
          n.type !== "Root" &&
          n.name !== "Root" &&
          (n.status === "RUNNING" ||
            n.status === ("PAUSED_AT_BREAKPOINT" as any) ||
            n.is_paused),
      );

      let nextTreeStatus: TreeStatus = "IDLE";
      if (
        rootChildNode &&
        (rootChildNode.status === "FAILURE" ||
          rootChildNode.status === "SUCCESS")
      ) {
        nextTreeStatus = rootChildNode.status as TreeStatus;
      } else if (hasRunningNode) {
        nextTreeStatus = "RUNNING";
      } else {
        nextTreeStatus =
          targetTree.status === "RUNNING" ||
          targetTree.status === "SUCCESS" ||
          targetTree.status === "FAILURE"
            ? targetTree.status
            : "IDLE";
      }

      const finalNodes = updatedNodes.map((n) => {
        if (n.type === "Root" || n.name === "Root") {
          return {
            ...n,
            status: (nextTreeStatus === "RUNNING"
              ? "RUNNING"
              : nextTreeStatus) as NodeStatus,
          };
        }
        if (
          (nextTreeStatus === "FAILURE" || nextTreeStatus === "SUCCESS") &&
          n.status === "RUNNING" &&
          !n.is_paused
        ) {
          return {
            ...n,
            status: "IDLE" as NodeStatus,
          };
        }
        return n;
      });

      nextMap.set(targetTreeId, {
        ...targetTree,
        blackboard: event.blackboard
          ? { ...(targetTree.blackboard || {}), ...event.blackboard }
          : targetTree.blackboard,
        status: nextTreeStatus,
        nodes: finalNodes,
      });

      const nextEvents = [event, ...state.events].slice(
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
        isPaused: nextIsPaused,
        pausedNodeTreeId: nextPausedTreeId,
        pausedNodeUid: nextPausedUid,
        pausedNodeName: nextPausedName,
        selectedNodeId: nextSelectedNodeId,
        breakpoints: nextBreakpoints,
        breakpointOnceSet: nextBreakpointOnce,
        faultRules: nextFaultRules,
        treesMap: nextMap,
        liveTreesMap: nextMap,
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
    sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    if (!uid) return state;

    const targetTreeId =
      treeId ||
      state.selectedTreeId ||
      (state.treesMap.size === 1
        ? state.treesMap.keys().next().value
        : undefined);

    let isCurrentlyEnabled = false;
    if (targetTreeId) {
      const canonicalKey = `${targetTreeId}::${uid}`;
      const foundNode = state.treesMap
        .get(targetTreeId)
        ?.nodes.find((n) => n.uid === uid);
      isCurrentlyEnabled =
        state.breakpoints.has(canonicalKey) ||
        Boolean(foundNode?.is_breakpoint);
    } else {
      for (const [tId, t] of state.treesMap.entries()) {
        const found = t.nodes.find((n) => n.uid === uid);
        if (found && found.is_breakpoint) {
          isCurrentlyEnabled = true;
          break;
        }
        if (state.breakpoints.has(`${tId}::${uid}`)) {
          isCurrentlyEnabled = true;
          break;
        }
      }
    }

    const nextEnabled = !isCurrentlyEnabled;
    const nextBreakpoints = new Set(state.breakpoints);
    const nextBreakpointOnce = new Set(state.breakpointOnceSet);

    for (const [tId, t] of state.treesMap.entries()) {
      if (targetTreeId && tId !== targetTreeId && t.tree_name !== targetTreeId)
        continue;
      const canonicalKey = `${tId}::${uid}`;
      const nameKey = `${t.tree_name}::${uid}`;
      if (nextEnabled) {
        nextBreakpoints.add(canonicalKey);
        if (once) nextBreakpointOnce.add(canonicalKey);
        else nextBreakpointOnce.delete(canonicalKey);
      } else {
        nextBreakpoints.delete(canonicalKey);
        nextBreakpoints.delete(nameKey);
        nextBreakpointOnce.delete(canonicalKey);
        nextBreakpointOnce.delete(nameKey);
      }
    }

    if (targetTreeId) {
      const explicitKey = `${targetTreeId}::${uid}`;
      if (nextEnabled) {
        nextBreakpoints.add(explicitKey);
        if (once) nextBreakpointOnce.add(explicitKey);
      } else {
        nextBreakpoints.delete(explicitKey);
        nextBreakpointOnce.delete(explicitKey);
      }
    }

    let nextIsPaused = state.isPaused;
    let nextPausedTreeId = state.pausedNodeTreeId;
    let nextPausedUid = state.pausedNodeUid;
    let nextPausedName = state.pausedNodeName;

    if (
      !nextEnabled &&
      state.isPaused &&
      (!state.pausedNodeTreeId ||
        !targetTreeId ||
        state.pausedNodeTreeId === targetTreeId) &&
      state.pausedNodeUid === uid
    ) {
      nextIsPaused = false;
      nextPausedTreeId = null;
      nextPausedUid = null;
      nextPausedName = undefined;
    }

    const nextTreesMap = new Map(state.treesMap);
    for (const [tId, tree] of nextTreesMap.entries()) {
      if (
        !targetTreeId ||
        tId === targetTreeId ||
        tree.tree_name === targetTreeId
      ) {
        const updatedNodes = tree.nodes.map((n) => {
          if (n.uid !== uid) return n;
          const wasPausedOnThis =
            !nextEnabled &&
            (n.is_paused || n.status === "PAUSED_AT_BREAKPOINT");
          return {
            ...n,
            is_breakpoint: nextEnabled,
            breakpoint_once: nextEnabled ? !!once : false,
            is_paused: nextEnabled ? n.is_paused : false,
            status: wasPausedOnThis
              ? (n.last_result as NodeStatus) || "IDLE"
              : n.status,
          };
        });
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    if (nextEnabled) {
      sendCommand({
        action: "set_breakpoint",
        tree_id: targetTreeId || "MainTree",
        uid,
        enabled: true,
        once: !!once,
        source: "groot2",
      });
    } else {
      sendCommand({
        action: "clear_breakpoint",
        tree_id: targetTreeId || "MainTree",
        uid,
        source: "groot2",
      });
    }

    return {
      ...state,
      isPaused: nextIsPaused,
      pausedNodeTreeId: nextPausedTreeId,
      pausedNodeUid: nextPausedUid,
      pausedNodeName: nextPausedName,
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
    sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    if (!treeId || !uid) return state;
    const key = `${treeId}::${uid}`;
    if (!state.breakpoints.has(key)) return state;

    const nextBreakpointOnce = new Set(state.breakpointOnceSet);
    if (once) nextBreakpointOnce.add(key);
    else nextBreakpointOnce.delete(key);

    const nextTreesMap = new Map(state.treesMap);
    if (nextTreesMap.has(treeId)) {
      const tree = nextTreesMap.get(treeId)!;
      const updatedNodes = tree.nodes.map((n) =>
        n.uid === uid ? { ...n, breakpoint_once: !!once } : n,
      );
      nextTreesMap.set(treeId, { ...tree, nodes: updatedNodes });
    }

    sendCommand({
      action: "set_breakpoint",
      tree_id: treeId,
      uid,
      enabled: true,
      once: !!once,
      source: "groot2",
    });

    return {
      ...state,
      breakpointOnceSet: nextBreakpointOnce,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleInjectFault(
    treeId: string,
    uid: number,
    mode: string,
    delayMs: number | undefined,
    once: boolean | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    if (!treeId || !uid) return state;
    const key = `${treeId}::${uid}`;

    const targetTree = state.treesMap.get(treeId);
    const targetNode = targetTree?.nodes.find((n) => n.uid === uid);
    const isExactSameActive =
      targetNode?.fault_mode === mode &&
      (mode !== "DELAY" || targetNode?.fault_delay_ms === delayMs) &&
      targetNode?.fault_once === !!once;
    const isClearing = !!isExactSameActive;

    const nextFaultRules = new Map(state.faultRules);
    const nextTreesMap = new Map(state.treesMap);

    if (isClearing) {
      nextFaultRules.delete(key);
      if (targetTree) {
        const updatedNodes = targetTree.nodes.map((n) =>
          n.uid === uid
            ? {
                ...n,
                fault_mode: undefined,
                fault_delay_ms: undefined,
                fault_once: false,
              }
            : n,
        );
        nextTreesMap.set(treeId, { ...targetTree, nodes: updatedNodes });
      }

      sendCommand({
        action: "clear_fault",
        tree_id: treeId,
        uid,
        source: "groot2",
      });
    } else {
      nextFaultRules.set(key, {
        tree_id: treeId,
        uid,
        mode: mode as any,
        delay_ms: delayMs,
        once: !!once,
      });
      if (targetTree) {
        const updatedNodes = targetTree.nodes.map((n) =>
          n.uid === uid
            ? {
                ...n,
                fault_mode: mode as any,
                fault_delay_ms: delayMs,
                fault_once: !!once,
              }
            : n,
        );
        nextTreesMap.set(treeId, { ...targetTree, nodes: updatedNodes });
      }

      sendCommand({
        action: "inject_fault",
        tree_id: treeId,
        uid,
        mode,
        delay_ms: delayMs || 0,
        once: !!once,
        source: "groot2",
      });
    }

    return {
      ...state,
      faultRules: nextFaultRules,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleSetFaultOnce(
    treeId: string,
    uid: number,
    once: boolean,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    if (!treeId || !uid) return state;
    const key = `${treeId}::${uid}`;
    const existingRule = state.faultRules.get(key);
    const targetTree = state.treesMap.get(treeId);
    const targetNode = targetTree?.nodes.find((n) => n.uid === uid);
    const mode = existingRule?.mode || targetNode?.fault_mode;
    if (!mode || mode === "NONE") return state;

    const delayMs = existingRule?.delay_ms ?? targetNode?.fault_delay_ms;

    const nextFaultRules = new Map(state.faultRules);
    nextFaultRules.set(key, {
      tree_id: treeId,
      uid,
      mode: mode as any,
      delay_ms: delayMs,
      once: !!once,
    });

    const nextTreesMap = new Map(state.treesMap);
    if (targetTree) {
      const updatedNodes = targetTree.nodes.map((n) =>
        n.uid === uid ? { ...n, fault_once: !!once } : n,
      );
      nextTreesMap.set(treeId, { ...targetTree, nodes: updatedNodes });
    }

    sendCommand({
      action: "inject_fault",
      tree_id: treeId,
      uid,
      mode,
      delay_ms: delayMs || 0,
      once: !!once,
      source: "groot2",
    });

    return {
      ...state,
      faultRules: nextFaultRules,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleClearFault(
    treeId: string,
    uid: number,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    if (!treeId || !uid) return state;
    const key = `${treeId}::${uid}`;

    const nextFaultRules = new Map(state.faultRules);
    nextFaultRules.delete(key);

    const nextTreesMap = new Map(state.treesMap);
    const targetTree = nextTreesMap.get(treeId);
    if (targetTree) {
      const updatedNodes = targetTree.nodes.map((n) =>
        n.uid === uid
          ? {
              ...n,
              fault_mode: undefined,
              fault_delay_ms: undefined,
              fault_once: false,
            }
          : n,
      );
      nextTreesMap.set(treeId, { ...targetTree, nodes: updatedNodes });
    }

    sendCommand({
      action: "clear_fault",
      tree_id: treeId,
      uid,
      source: "groot2",
    });

    return {
      ...state,
      faultRules: nextFaultRules,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleClearAllBreakpoints(
    targetTreeId: string | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    const activeTreeId = targetTreeId || state.selectedTreeId;
    const nextBreakpoints = new Set(state.breakpoints);
    const nextBreakpointOnce = new Set(state.breakpointOnceSet);
    const nextTreesMap = new Map(state.treesMap);

    let nextIsPaused = state.isPaused;
    let nextPausedTreeId = state.pausedNodeTreeId;
    let nextPausedUid = state.pausedNodeUid;
    let nextPausedName = state.pausedNodeName;

    if (activeTreeId) {
      for (const k of state.breakpoints) {
        if (k.startsWith(`${activeTreeId}::`)) nextBreakpoints.delete(k);
      }
      for (const k of state.breakpointOnceSet) {
        if (k.startsWith(`${activeTreeId}::`)) nextBreakpointOnce.delete(k);
      }
      if (nextTreesMap.has(activeTreeId)) {
        const targetTree = nextTreesMap.get(activeTreeId)!;
        const updatedNodes = targetTree.nodes.map((n) => ({
          ...n,
          is_breakpoint: false,
          breakpoint_once: false,
          is_paused: false,
          status:
            n.status === "PAUSED_AT_BREAKPOINT"
              ? (n.last_result as NodeStatus) || "IDLE"
              : n.status,
        }));
        nextTreesMap.set(activeTreeId, { ...targetTree, nodes: updatedNodes });
      }
      if (
        state.isPaused &&
        (!state.pausedNodeTreeId || state.pausedNodeTreeId === activeTreeId)
      ) {
        nextIsPaused = false;
        nextPausedTreeId = null;
        nextPausedUid = null;
        nextPausedName = undefined;
      }
    } else {
      nextBreakpoints.clear();
      nextBreakpointOnce.clear();
      for (const [tId, tree] of nextTreesMap.entries()) {
        const updatedNodes = tree.nodes.map((n) => ({
          ...n,
          is_breakpoint: false,
          breakpoint_once: false,
          is_paused: false,
          status:
            n.status === "PAUSED_AT_BREAKPOINT"
              ? (n.last_result as NodeStatus) || "IDLE"
              : n.status,
        }));
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
      nextIsPaused = false;
      nextPausedTreeId = null;
      nextPausedUid = null;
      nextPausedName = undefined;
    }

    sendCommand({
      action: "clear_all_breakpoints",
      tree_id: activeTreeId || "ALL",
      source: "groot2",
    });

    return {
      ...state,
      isPaused: nextIsPaused,
      pausedNodeTreeId: nextPausedTreeId,
      pausedNodeUid: nextPausedUid,
      pausedNodeName: nextPausedName,
      breakpoints: nextBreakpoints,
      breakpointOnceSet: nextBreakpointOnce,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleClearAllFaults(
    targetTreeId: string | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    const activeTreeId = targetTreeId || state.selectedTreeId;
    const nextFaultRules = new Map(state.faultRules);
    const nextTreesMap = new Map(state.treesMap);

    if (activeTreeId) {
      for (const k of state.faultRules.keys()) {
        if (k.startsWith(`${activeTreeId}::`)) nextFaultRules.delete(k);
      }
      const targetTree = nextTreesMap.get(activeTreeId);
      if (targetTree) {
        const updatedNodes = targetTree.nodes.map((n) => ({
          ...n,
          fault_mode: undefined,
          fault_delay_ms: undefined,
          fault_once: false,
        }));
        nextTreesMap.set(activeTreeId, { ...targetTree, nodes: updatedNodes });
      }
    } else {
      nextFaultRules.clear();
      for (const [id, t] of nextTreesMap.entries()) {
        const updatedNodes = t.nodes.map((n) => ({
          ...n,
          fault_mode: undefined,
          fault_delay_ms: undefined,
          fault_once: false,
        }));
        nextTreesMap.set(id, { ...t, nodes: updatedNodes });
      }
    }

    sendCommand({
      action: "clear_all_faults",
      tree_id: activeTreeId || "ALL",
      source: "groot2",
    });

    return {
      ...state,
      faultRules: nextFaultRules,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleContinuation(
    action: "resume" | "force_success" | "force_failure",
    targetTreeId: string | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    const activeTreeId =
      targetTreeId ||
      state.pausedNodeTreeId ||
      state.selectedTreeId ||
      (state.treesMap.size === 1
        ? (state.treesMap.keys().next().value as string | undefined)
        : undefined) ||
      "Groot2Tree";
    const currentPausedUid = state.pausedNodeUid;
    if (!currentPausedUid) return state;

    const canonicalKey = `${activeTreeId}::${currentPausedUid}`;
    const targetTree = state.treesMap.get(activeTreeId);
    const targetNode = targetTree?.nodes.find(
      (n) => n.uid === currentPausedUid,
    );
    const isOnce =
      state.breakpointOnceSet.has(canonicalKey) ||
      Boolean(targetNode?.breakpoint_once);

    const nextBreakpoints = new Set(state.breakpoints);
    const nextBreakpointOnce = new Set(state.breakpointOnceSet);

    if (isOnce) {
      nextBreakpoints.delete(canonicalKey);
      nextBreakpointOnce.delete(canonicalKey);
    }

    const nextTreesMap = new Map();
    for (const [tId, tree] of state.treesMap.entries()) {
      if (tId !== activeTreeId) {
        nextTreesMap.set(tId, tree);
        continue;
      }
      const updatedNodes = tree.nodes.map((n) => {
        const isThisPaused = n.uid === currentPausedUid;
        const key = `${tId}::${n.uid}`;
        const shouldClearBp =
          isThisPaused &&
          (state.breakpointOnceSet.has(key) || Boolean(n.breakpoint_once));
        const forcedResult =
          action === "force_success"
            ? "SUCCESS"
            : action === "force_failure"
              ? "FAILURE"
              : n.status;
        return {
          ...n,
          status:
            isThisPaused &&
            (action === "force_success" || action === "force_failure")
              ? forcedResult
              : isThisPaused && n.status === "PAUSED_AT_BREAKPOINT"
                ? "RUNNING"
                : n.status,
          last_result:
            isThisPaused &&
            (action === "force_success" || action === "force_failure")
              ? forcedResult
              : n.last_result,
          is_paused: isThisPaused ? false : n.is_paused,
          is_breakpoint: shouldClearBp ? false : n.is_breakpoint,
          breakpoint_once: shouldClearBp ? false : n.breakpoint_once,
        };
      });
      nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
    }

    if (isOnce) {
      sendCommand({
        action: "clear_breakpoint",
        tree_id: activeTreeId,
        uid: currentPausedUid,
        source: "groot2",
      });
    }

    sendCommand({
      action,
      tree_id: activeTreeId,
      uid: currentPausedUid,
      once: isOnce,
      source: "groot2",
    });

    return {
      ...state,
      isPaused: false,
      pausedNodeTreeId: null,
      pausedNodeUid: null,
      pausedNodeName: undefined,
      breakpoints: nextBreakpoints,
      breakpointOnceSet: nextBreakpointOnce,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleSetBlackboard(
    _treeId: string,
    _key: string,
    _value: any,
    _valueType: "bool" | "int" | "double" | "string",
    state: ProtocolSessionState,
    _sendCommand: (cmd: any) => void,
  ): ProtocolSessionState {
    // Groot2 is read-only for Blackboard writing
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
    // Groot2 is read-only for Node Port editing
    return state;
  }
}

export const groot2Handler = new Groot2Handler();
