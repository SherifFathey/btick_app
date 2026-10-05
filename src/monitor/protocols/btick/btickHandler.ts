import { IProtocolHandler, ProtocolSessionState, MAX_RAM_EVENT_HISTORY } from '../types';
import { BTNodeModel, NodeStatus, TreeStatus, TransitionEvent } from '../../types/bt';
import { attachRootCard, mergeNodesWithExisting, isMatchNode } from '../../utils/xmlParser';
import { updateProtocolHeartbeat, startNewExecutionCycle, isFirstRootChildEvent, getParentRetickChildIds, findMatchingLogicalTreeKey } from '../session/sessionManager';
import { BTickSessionState } from './btickState';

export class BTickHandler implements IProtocolHandler {
  public protocol = 'btick' as const;
  public displayName = 'BTick';
  public badge = 'ROS 2';
  public supportsDebugging = true;
  public supportsFaultInjection = true;
  public supportsXmlLoad = true;
  public supportsBlackboardWrite = true;
  public supportsNodePortEdit = true;

  public handleMessage(
    data: any,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState {
    // 0. Protocol Liveness Heartbeat
    if ((data.type === 'protocol_heartbeat' || data.type === 'status') && (data.protocol === 'btick' || data.source === 'btick' || (!data.protocol && !data.source))) {
      const connStatus = data.status || 'CONNECTED_IDLE';
      return updateProtocolHeartbeat(state, connStatus, data.execution_instance_id);
    }

    // 0b. Explicit Execution Cycle Started Lifecycle Event
    if (data.type === 'execution_cycle_started') {
      const targetId = data.tree_id || state.selectedTreeId || 'MainTree';
      const cycleId = data.cycle_id || `cycle_${Date.now()}`;
      return startNewExecutionCycle(state, targetId, cycleId, data.timestamp);
    }

    // 0c. Explicit Tree Destroyed / Removed Lifecycle Event
    if (data.type === 'tree_destroyed' || data.type === 'tree_removed' || data.type === 'tree_closed') {
      const treeId = data.tree_id;
      if (!treeId || !state.treesMap.has(treeId)) {
        return state;
      }
      const nextTreesMap = new Map(state.treesMap);
      nextTreesMap.delete(treeId);

      let nextSelectedId = state.selectedTreeId;
      if (nextSelectedId === treeId) {
        nextSelectedId = nextTreesMap.size > 0 ? nextTreesMap.keys().next().value! : null;
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

    // 1. Behavior Tree Structure Discovery Message
    if (data.type === 'tree_created' || data.type === 'tree') {
      const rawTree = data;
      let nodesList: BTNodeModel[] = [];
      if (Array.isArray(rawTree.nodes)) {
        nodesList = rawTree.nodes;
      } else if (rawTree.nodes && typeof rawTree.nodes === 'object') {
        nodesList = Object.values(rawTree.nodes);
      }

      const treeId = rawTree.tree_id || 'MainTree';
      if (state.closedTreeIds?.has(treeId)) {
        return state;
      }
      const executionInstanceId = rawTree.execution_instance_id || state?.session?.executionInstanceId || `inst_${Date.now()}`;
      const workingState = state;

      const nextTreesMap = new Map(workingState.treesMap);
      const matchedExistingKey = findMatchingLogicalTreeKey(
        nextTreesMap,
        treeId,
        rawTree.tree_name,
        rawTree.xml_path,
        nodesList,
        'btick',
        rawTree.origin,
        rawTree.node_name,
        rawTree.pid,
        rawTree.hostname
      );
      const existingTree = matchedExistingKey ? nextTreesMap.get(matchedExistingKey) : nextTreesMap.get(treeId);
      const isRestart = Boolean(
        rawTree.is_restart ||
        rawTree.reconnected ||
        (existingTree && (existingTree.status === 'DESTROYED' || existingTree.status === 'STOPPED' || (matchedExistingKey && matchedExistingKey !== treeId)))
      );

      let nextBreakpoints = workingState.breakpoints;
      let nextBreakpointOnce = workingState.breakpointOnceSet;
      let nextFaultRules = workingState.faultRules;

      if (isRestart) {
        nextBreakpoints = new Set();
        nextBreakpointOnce = new Set();
        nextFaultRules = new Map();
      }

      const displayMode = (workingState as BTickSessionState).liveStatusDisplayMode;
      const nodesForMerge = displayMode === 'parent_retick_reset' && existingTree
        ? nodesList.map((incoming) => {
            const existing = existingTree.nodes.find((node) =>
              (incoming.uid > 0 && node.uid === incoming.uid) || node.id === incoming.id);
            if (!existing) return incoming;
            return {
              ...incoming,
              status: existing.status,
              last_result: existing.last_result,
              tick_count: existing.tick_count,
            };
          })
        : nodesList;
      const mergedNodes = mergeNodesWithExisting(nodesForMerge, existingTree?.nodes, isRestart);

      const hasRunningNode = mergedNodes.some((n) => n.type !== 'Root' && n.name !== 'Root' && (n.status === 'RUNNING' || n.status === ('PAUSED_AT_BREAKPOINT' as any)));
      const rootChildNode = mergedNodes.find((n) => n.parent_id === rawTree.root_node_id) ||
                            mergedNodes.find((n) => n.type !== 'Root' && (n.parent_id === '' || n.parent_id.startsWith('Root') || n.uid === 1));

      let calculatedTreeStatus: TreeStatus = 'IDLE';
      if (hasRunningNode) {
        calculatedTreeStatus = 'RUNNING';
      } else if (rootChildNode && (rootChildNode.status === 'SUCCESS' || rootChildNode.status === 'FAILURE')) {
        calculatedTreeStatus = rootChildNode.status as TreeStatus;
      } else if (existingTree && existingTree.status && existingTree.status !== 'CREATED' && existingTree.status !== 'STOPPED') {
        calculatedTreeStatus = existingTree.status;
      } else {
        calculatedTreeStatus = rawTree.status || 'IDLE';
      }

      const treeToSave = attachRootCard({
        type: 'tree_created',
        tree_id: treeId,
        tree_name: rawTree.tree_name || treeId,
        display_name: rawTree.display_name || existingTree?.display_name || rawTree.tree_name || treeId,
        node_name: rawTree.node_name || existingTree?.node_name,
        pid: rawTree.pid !== undefined ? rawTree.pid : existingTree?.pid,
        hostname: rawTree.hostname || existingTree?.hostname,
        root_node_id: rawTree.root_node_id || (nodesList.length > 0 ? nodesList[0].id : ''),
        status: calculatedTreeStatus,
        xml_path: rawTree.xml_path,
        nodes: mergedNodes,
        visible: existingTree ? existingTree.visible : true,
        blackboard: rawTree.blackboard || existingTree?.blackboard || {},
        origin: rawTree.origin || existingTree?.origin,
        source: 'btick',
        protocol: 'btick',
      });

      if (matchedExistingKey && matchedExistingKey !== treeId) {
        nextTreesMap.delete(matchedExistingKey);
      }
      nextTreesMap.set(treeId, treeToSave);

      const nextSelectedTreeId = (workingState.selectedTreeId && (workingState.selectedTreeId === matchedExistingKey || nextTreesMap.has(workingState.selectedTreeId)))
        ? (workingState.selectedTreeId === matchedExistingKey ? treeId : workingState.selectedTreeId)
        : treeId;

      return {
        ...workingState,
        isConnected: true,
        session: {
          ...workingState.session,
          sessionId: rawTree.session_id || `${workingState.protocol}_${treeId}_${executionInstanceId}`,
          executionInstanceId,
          connectionStatus: hasRunningNode ? 'CONNECTED_RUNNING' : 'CONNECTED_IDLE',
          lastHeartbeatAt: Date.now(),
        },
        treesMap: nextTreesMap,
        liveTreesMap: nextTreesMap,
        selectedTreeId: nextSelectedTreeId,
        breakpoints: nextBreakpoints,
        breakpointOnceSet: nextBreakpointOnce,
        faultRules: nextFaultRules,
      };
    }

    // 2. Blackboard Scope Update
    if (data.type === 'blackboard_update') {
      const targetId = data.tree_id;
      const bbData = data.blackboard;
      if (bbData && typeof bbData === 'object' && state.treesMap.size > 0) {
        const nextTreesMap = new Map(state.treesMap);
        const matchedKey = targetId && nextTreesMap.has(targetId) ? targetId : null;
        if (matchedKey && nextTreesMap.has(matchedKey)) {
          const target = nextTreesMap.get(matchedKey)!;
          nextTreesMap.set(matchedKey, {
            ...target,
            blackboard: { ...(target.blackboard || {}), ...bbData },
          });
        }
        return {
          ...state,
          treesMap: nextTreesMap,
          liveTreesMap: nextTreesMap,
        };
      }
      return state;
    }

    // 2b. Explicit Blackboard Update Response from Robot
    if (data.type === 'blackboard_update_response') {
      if (data.success && data.key && data.value !== undefined && state.treesMap.size > 0) {
        const nextTreesMap = new Map(state.treesMap);
        let targetId = data.tree_id;
        if (!targetId || !nextTreesMap.has(targetId)) {
          if (nextTreesMap.size > 1 && !state.selectedTreeId) return state;
          targetId = state.selectedTreeId && nextTreesMap.has(state.selectedTreeId)
            ? state.selectedTreeId
            : nextTreesMap.keys().next().value!;
        }
        if (targetId && nextTreesMap.has(targetId)) {
          const target = nextTreesMap.get(targetId)!;
          nextTreesMap.set(targetId, {
            ...target,
            blackboard: { ...(target.blackboard || {}), [data.key]: data.value },
          });
          return {
            ...state,
            treesMap: nextTreesMap,
            liveTreesMap: nextTreesMap,
          };
        }
      }
      return state;
    }

    // 2c. Explicit Live Node Port Update Response from Robot
    if (data.type === 'set_node_port_response') {
      if (data.success && data.port_name && data.value !== undefined && state.treesMap.size > 0) {
        const nextTreesMap = new Map(state.treesMap);
        let targetId = data.tree_id;
        if (!targetId || !nextTreesMap.has(targetId)) {
          if (nextTreesMap.size > 1 && !state.selectedTreeId) return state;
          targetId = state.selectedTreeId && nextTreesMap.has(state.selectedTreeId)
            ? state.selectedTreeId
            : nextTreesMap.keys().next().value!;
        }
        if (targetId && nextTreesMap.has(targetId)) {
          const target = nextTreesMap.get(targetId)!;
          const targetUid = data.uid;
          const isBB = data.mode === 'Blackboard';

          const updatedNodes = target.nodes.map((node) => {
            if (targetUid !== undefined && node.uid !== targetUid) {
              return node;
            }
            const updatedPortDetails = (node.port_details || []).map((pd) => {
              if (pd.name === data.port_name) {
                return {
                  ...pd,
                  value: String(data.value),
                  mode: (isBB ? 'Blackboard' : 'Literal') as 'Literal' | 'Blackboard',
                };
              }
              return pd;
            });

            const nextPorts = { ...(node.ports || {}) };
            const nextAttributes = { ...(node.attributes || {}) };

            if (isBB) {
              nextPorts[data.port_name] = String(data.value);
              delete nextAttributes[data.port_name];
            } else {
              nextAttributes[data.port_name] = String(data.value);
              delete nextPorts[data.port_name];
            }

            return {
              ...node,
              ports: nextPorts,
              attributes: nextAttributes,
              port_details: updatedPortDetails,
            };
          });

          nextTreesMap.set(targetId, {
            ...target,
            nodes: updatedNodes,
          });

          return {
            ...state,
            treesMap: nextTreesMap,
            liveTreesMap: nextTreesMap,
          };
        }
      }
      return state;
    }

    // 3. Execution Resumed Lifecycle Event
    if (data.type === 'execution_resumed') {
      const forcedStatus = data.forced_status;
      const targetUid = data.uid;
      const isForced = forcedStatus === 'SUCCESS' || forcedStatus === 'FAILURE';
      const targetTreeId = data.tree_id || state.pausedNodeTreeId || state.selectedTreeId || (state.treesMap.size === 1 ? state.treesMap.keys().next().value : null);
      if (!targetTreeId) return state;
      const nextMap = new Map();
      for (const [tId, tree] of state.treesMap.entries()) {
        if (tId !== targetTreeId) {
          nextMap.set(tId, tree);
          continue;
        }
        nextMap.set(tId, {
          ...tree,
          nodes: tree.nodes.map((n) => {
            const isTarget = targetUid ? (n.uid === targetUid) : n.is_paused;
            return {
              ...n,
              status: (isTarget && isForced) ? (forcedStatus as NodeStatus) : (isTarget ? ('RUNNING' as NodeStatus) : n.status),
              last_result: (isTarget && isForced) ? (forcedStatus as NodeStatus) : n.last_result,
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

    // 4. Live Status Transition Event
    if (data.type === 'transition') {
      const event = data as TransitionEvent;
      if (!event.source) (event as any).source = 'btick';
      if (!event.protocol) (event as any).protocol = 'btick';
      const prevMap = state.treesMap;
      const isPausedEvent = (event as any).current_status === 'PAUSED_AT_BREAKPOINT' || (event as any).status === 'PAUSED_AT_BREAKPOINT';

      if (prevMap.size === 0) {
        const nextEvents = [event, ...state.events].slice(0, MAX_RAM_EVENT_HISTORY);
        const nextTreeEvents = new Map(state.treeEvents || []);
        const treeKey = event.tree_id || 'MainTree';
        const prevList = nextTreeEvents.get(treeKey) || [];
        nextTreeEvents.set(treeKey, [event, ...prevList].slice(0, MAX_RAM_EVENT_HISTORY));
        sendCommand({ action: 'get_tree', source: 'btick' });
        return {
          ...state,
          events: nextEvents,
          treeEvents: nextTreeEvents,
        };
      }

      const targetTreeId = event.tree_id || (prevMap.size === 1 ? prevMap.keys().next().value! : '');
      if (!prevMap.has(targetTreeId)) return state;

      let workingState = state;
      let nextMap = new Map(workingState.treesMap);
      let targetTree = nextMap.get(targetTreeId)!;

      const isFirstChildEvent = isFirstRootChildEvent(targetTree, event);
      const isNewCycleExplicit = isFirstChildEvent && Boolean(event.cycle_id && targetTree.current_cycle_id && event.cycle_id !== targetTree.current_cycle_id);
      const isTreeFinished = targetTree.status === 'SUCCESS' || targetTree.status === 'FAILURE';
      const isNewCycle = isFirstChildEvent && (isNewCycleExplicit || isTreeFinished) && event.status === 'RUNNING' && !workingState.isPaused;

      if (isNewCycle) {
        const cycleId = event.cycle_id || `cycle_${Date.now()}`;
        workingState = startNewExecutionCycle(workingState, targetTreeId, cycleId, event.timestamp);
        nextMap = new Map(workingState.treesMap);
        targetTree = nextMap.get(targetTreeId)!;
      }

      const parentChildIds = getParentRetickChildIds(
        targetTree,
        event,
        (workingState as BTickSessionState).liveStatusDisplayMode,
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
        if (!workingState.selectedTreeId || workingState.selectedTreeId === (event.tree_id || targetTreeId)) {
          const matchedNode = targetTree.nodes.find((n) => isMatchNode(n, event));
          nextSelectedNodeId = matchedNode ? matchedNode.id : (event.node_id || workingState.selectedNodeId);
        }
        nextIsPaused = true;
      } else if (nextPausedTreeId === targetTreeId && nextPausedUid === event.uid && (event.status === 'SUCCESS' || event.status === 'FAILURE' || event.status === 'SKIPPED')) {
        nextPausedTreeId = null;
        nextPausedUid = null;
        nextPausedName = undefined;
        nextIsPaused = false;
      }

      const nextFaultRules = new Map(workingState.faultRules);
      let nextBreakpoints = workingState.breakpoints;
      let nextBreakpointOnce = workingState.breakpointOnceSet;

      const isDelayWaiting = (event as any).current_status === 'DELAY_WAITING' || (event as any).status === 'DELAY_WAITING';
      const isDelayFinished = (event as any).current_status === 'DELAY_FINISHED' || (event as any).status === 'DELAY_FINISHED';
      const isNodePortUpdate = (event as any).current_status === 'NODE_PORT_UPDATE' || (event as any).status === 'NODE_PORT_UPDATE';
      const isBlackboardUpdate = (event as any).current_status === 'BLACKBOARD_UPDATE' || (event as any).status === 'BLACKBOARD_UPDATE';

      const updatedNodes = targetTree.nodes.map((n) => {
        const canonicalKey = `${targetTree.tree_id}::${n.uid}`;
        const isTargetTreePaused = Boolean(
          nextIsPaused &&
          (!nextPausedTreeId || targetTree.tree_id === nextPausedTreeId)
        );
        const isNodePausedCurrently = Boolean(
          isTargetTreePaused &&
          nextPausedUid !== null &&
          nextPausedUid !== undefined &&
          n.uid === nextPausedUid
        );

        if (parentChildIds.has(n.id)) {
          if (isNodePausedCurrently && nextIsPaused) {
            return {
              ...n,
              status: 'PAUSED_AT_BREAKPOINT' as NodeStatus,
              is_paused: true,
            };
          }
          return {
            ...n,
            status: 'IDLE' as NodeStatus,
            is_paused: false,
          };
        }
        if (isMatchNode(n, event)) {
          if (isDelayWaiting) {
            const delayMs = event.duration && event.duration > 0 ? event.duration : (n.fault_delay_ms || 1000);
            const now = Date.now();
            return {
              ...n,
              delay_active: true,
              delay_total_ms: delayMs,
              delay_started_at: now,
              delay_activation_id: `${now}_${Math.random()}`,
            };
          }

          if (isDelayFinished) {
            return {
              ...n,
              delay_active: false,
              delay_started_at: undefined,
              delay_activation_id: undefined,
            };
          }

          let nextStatus = event.status;

          if (isNodePortUpdate || isBlackboardUpdate) {
            nextStatus = n.status;
          } else if (isPausedEvent) {
            nextStatus = 'PAUSED_AT_BREAKPOINT' as NodeStatus;
          } else if (isNodePausedCurrently && nextIsPaused) {
            if (event.status === 'SUCCESS' || event.status === 'FAILURE' || event.status === 'SKIPPED') {
              nextStatus = event.status;
            } else {
              nextStatus = 'PAUSED_AT_BREAKPOINT' as NodeStatus;
            }
          } else if (event.status === 'IDLE') {
            if (n.status === 'SUCCESS' || n.status === 'FAILURE') {
              nextStatus = n.status;
            } else if (event.prev_status === 'SUCCESS' || event.prev_status === 'FAILURE') {
              nextStatus = event.prev_status as NodeStatus;
            } else if (n.last_result === 'SUCCESS' || n.last_result === 'FAILURE') {
              nextStatus = n.last_result as NodeStatus;
            }
          }

          const nextLastResult = (nextStatus === 'SUCCESS' || nextStatus === 'FAILURE') ? nextStatus : n.last_result;
          const isFinished = nextStatus === 'SUCCESS' || nextStatus === 'FAILURE' || nextStatus === 'SKIPPED';
          const nextIsPausedNode = isPausedEvent ? true : (isFinished ? false : (isNodePausedCurrently && nextIsPaused));
          const shouldClearFault = n.fault_once && isFinished;
          const isOnceBp = Boolean(n.breakpoint_once || workingState.breakpointOnceSet.has(canonicalKey));
          const shouldClearBp = isOnceBp && isFinished;

          if (shouldClearFault && n.uid) {
            const canonicalKey = `${targetTreeId}::${n.uid}`;
            nextFaultRules.delete(canonicalKey);
            sendCommand({
              action: 'clear_fault',
              tree_id: targetTreeId,
              uid: n.uid,
              source: 'btick',
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
              action: 'clear_breakpoint',
              tree_id: targetTreeId,
              uid: n.uid,
              source: 'btick',
            });
          }

          const nextOutputPortsValues = { ...(n.output_ports_values || {}) };
          const nextPorts = { ...(n.ports || {}) };
          const nextAttributes = { ...(n.attributes || {}) };

          if (Array.isArray(event.output_ports)) {
            for (const op of event.output_ports) {
              if (op.port_name && op.value !== undefined) {
                const valStr = String(op.value);
                nextOutputPortsValues[op.port_name] = valStr;
                if ((op as any).change_kind === 'port_config' || isNodePortUpdate) {
                  const isBB = op.mode === 'Blackboard' || (valStr.startsWith('{') && valStr.endsWith('}'));
                  if (isBB) {
                    nextPorts[op.port_name] = valStr;
                    delete nextAttributes[op.port_name];
                  } else {
                    nextAttributes[op.port_name] = valStr;
                    delete nextPorts[op.port_name];
                  }
                }
              }
            }
          }

          const nextPortDetails = n.port_details?.map((pd) => {
            const update = event.output_ports?.find((op: any) => op.port_name === pd.name);
            if (update && ((update as any).change_kind === 'port_config' || isNodePortUpdate)) {
              const valStr = String(update.value);
              const isBB = update.mode === 'Blackboard' || (valStr.startsWith('{') && valStr.endsWith('}'));
              return {
                ...pd,
                value: valStr,
                mode: (isBB ? 'Blackboard' : 'Literal') as 'Literal' | 'Blackboard',
                runtime_value: undefined,
              };
            }
            if (nextOutputPortsValues[pd.name] !== undefined) {
              return { ...pd, runtime_value: nextOutputPortsValues[pd.name] };
            }
            return pd;
          });

          return {
            ...n,
            status: nextStatus,
            last_result: nextLastResult,
            delay_active: false,
            delay_started_at: undefined,
            delay_activation_id: undefined,
            fault_mode: shouldClearFault ? undefined : n.fault_mode,
            fault_delay_ms: shouldClearFault ? undefined : n.fault_delay_ms,
            fault_once: shouldClearFault ? false : n.fault_once,
            is_paused: nextIsPausedNode,
            is_breakpoint: shouldClearBp ? false : n.is_breakpoint,
            breakpoint_once: shouldClearBp ? false : n.breakpoint_once,
            last_duration: event.duration !== undefined && event.duration > 0 ? event.duration : n.last_duration,
            tick_count: event.tick_count ?? n.tick_count,
            ports: nextPorts,
            attributes: nextAttributes,
            output_ports_values: nextOutputPortsValues,
            port_details: nextPortDetails,
          };
        }

        if (isNodePausedCurrently && nextIsPaused) {
          return {
            ...n,
            status: (n.status === 'SUCCESS' || n.status === 'FAILURE' || n.status === 'SKIPPED') ? n.status : ('PAUSED_AT_BREAKPOINT' as NodeStatus),
            is_paused: true,
          };
        }

        if (n.is_paused || n.status === 'PAUSED_AT_BREAKPOINT') {
          return {
            ...n,
            status: n.status === 'PAUSED_AT_BREAKPOINT' ? ((n.last_result as NodeStatus) || 'IDLE') : n.status,
            is_paused: false,
          };
        }

        return n;
      });

      const rootChildNode = updatedNodes.find((n) => n.parent_id === targetTree.root_node_id) ||
                            updatedNodes.find((n) => n.type !== 'Root' && (n.parent_id === '' || n.parent_id.startsWith('Root') || n.uid === 1));

      const hasRunningNode = updatedNodes.some((n) => n.type !== 'Root' && n.name !== 'Root' && (n.status === 'RUNNING' || n.status === ('PAUSED_AT_BREAKPOINT' as any) || n.is_paused));

      let nextTreeStatus: TreeStatus = 'IDLE';
      if (rootChildNode && (rootChildNode.status === 'FAILURE' || rootChildNode.status === 'SUCCESS')) {
        nextTreeStatus = rootChildNode.status as TreeStatus;
      } else if (hasRunningNode) {
        nextTreeStatus = 'RUNNING';
      } else {
        nextTreeStatus = (targetTree.status === 'RUNNING' || targetTree.status === 'SUCCESS' || targetTree.status === 'FAILURE') ? targetTree.status : 'IDLE';
      }

      const finalNodes = updatedNodes.map((n) => {
        if ((workingState as BTickSessionState).liveStatusDisplayMode === 'parent_retick_reset') {
          return n;
        }
        if (n.type === 'Root' || n.name === 'Root') {
          return {
            ...n,
            status: (nextTreeStatus === 'RUNNING' ? 'RUNNING' : nextTreeStatus) as NodeStatus,
          };
        }
        if ((nextTreeStatus === 'FAILURE' || nextTreeStatus === 'SUCCESS') && n.status === 'RUNNING' && !n.is_paused) {
          return {
            ...n,
            status: 'IDLE' as NodeStatus,
          };
        }
        return n;
      });

      nextMap.set(targetTreeId, {
        ...targetTree,
        blackboard: event.blackboard ? { ...(targetTree.blackboard || {}), ...event.blackboard } : targetTree.blackboard,
        status: nextTreeStatus,
        nodes: finalNodes,
      });

      const nextEvents = [event, ...state.events].slice(0, MAX_RAM_EVENT_HISTORY);
      const nextTreeEvents = new Map(workingState.treeEvents || state.treeEvents || []);
      const prevTreeList = nextTreeEvents.get(targetTreeId) || [];
      nextTreeEvents.set(targetTreeId, [event, ...prevTreeList].slice(0, MAX_RAM_EVENT_HISTORY));

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
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState {
    if (!uid) return state;

    const targetTreeId = treeId || state.selectedTreeId || (state.treesMap.size === 1 ? state.treesMap.keys().next().value : undefined);

    let isCurrentlyEnabled = false;
    if (targetTreeId) {
      const canonicalKey = `${targetTreeId}::${uid}`;
      const foundNode = state.treesMap.get(targetTreeId)?.nodes.find((n) => n.uid === uid);
      isCurrentlyEnabled = state.breakpoints.has(canonicalKey) || Boolean(foundNode?.is_breakpoint);
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
      if (targetTreeId && tId !== targetTreeId) continue;
      const canonicalKey = `${tId}::${uid}`;
      if (nextEnabled) {
        nextBreakpoints.add(canonicalKey);
        if (once) nextBreakpointOnce.add(canonicalKey);
        else nextBreakpointOnce.delete(canonicalKey);
      } else {
        nextBreakpoints.delete(canonicalKey);
        nextBreakpointOnce.delete(canonicalKey);
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

    if (!nextEnabled && state.isPaused && (!state.pausedNodeTreeId || !targetTreeId || state.pausedNodeTreeId === targetTreeId) && state.pausedNodeUid === uid) {
      nextIsPaused = false;
      nextPausedTreeId = null;
      nextPausedUid = null;
      nextPausedName = undefined;
    }

    const nextTreesMap = new Map(state.treesMap);
    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        const updatedNodes = tree.nodes.map((n) => {
          if (n.uid !== uid) return n;
          const wasPausedOnThis = !nextEnabled && (n.is_paused || n.status === 'PAUSED_AT_BREAKPOINT');
          return {
            ...n,
            is_breakpoint: nextEnabled,
            breakpoint_once: nextEnabled ? !!once : false,
            is_paused: nextEnabled ? n.is_paused : false,
            status: wasPausedOnThis ? ((n.last_result as NodeStatus) || 'IDLE') : n.status,
          };
        });
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    if (targetTreeId) {
      if (nextEnabled) {
        sendCommand({
          action: 'set_breakpoint',
          tree_id: targetTreeId,
          uid,
          enabled: true,
          once: !!once,
          source: 'btick',
        });
      } else {
        sendCommand({
          action: 'clear_breakpoint',
          tree_id: targetTreeId,
          uid,
          source: 'btick',
        });
      }
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
    sendCommand: (cmd: any) => void
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
        n.uid === uid ? { ...n, breakpoint_once: !!once } : n
      );
      nextTreesMap.set(treeId, { ...tree, nodes: updatedNodes });
    }

    sendCommand({
      action: 'set_breakpoint',
      tree_id: treeId,
      uid,
      enabled: true,
      once: !!once,
      source: 'btick',
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
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState {
    if (!treeId || !uid) return state;
    const key = `${treeId}::${uid}`;

    const targetTree = state.treesMap.get(treeId);
    const targetNode = targetTree?.nodes.find((n) => n.uid === uid);
    const isExactSameActive = targetNode?.fault_mode === mode &&
      (mode !== 'DELAY' || targetNode?.fault_delay_ms === delayMs) &&
      targetNode?.fault_once === !!once;
    const isClearing = !isExactSameActive ? false : true;

    const nextFaultRules = new Map(state.faultRules);
    const nextTreesMap = new Map(state.treesMap);

    if (isClearing) {
      nextFaultRules.delete(key);
      if (targetTree) {
        const updatedNodes = targetTree.nodes.map((n) =>
          n.uid === uid ? { ...n, fault_mode: undefined, fault_delay_ms: undefined, fault_once: false } : n
        );
        nextTreesMap.set(treeId, { ...targetTree, nodes: updatedNodes });
      }

      sendCommand({
        action: 'clear_fault',
        tree_id: treeId,
        uid,
        source: 'btick',
      });
    } else {
      nextFaultRules.set(key, { tree_id: treeId, uid, mode: mode as any, delay_ms: delayMs, once: !!once });
      if (targetTree) {
        const updatedNodes = targetTree.nodes.map((n) =>
          n.uid === uid ? { ...n, fault_mode: mode as any, fault_delay_ms: delayMs, fault_once: !!once } : n
        );
        nextTreesMap.set(treeId, { ...targetTree, nodes: updatedNodes });
      }

      sendCommand({
        action: 'inject_fault',
        tree_id: treeId,
        uid,
        mode,
        delay_ms: delayMs || 0,
        once: !!once,
        source: 'btick',
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
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState {
    if (!treeId || !uid) return state;
    const key = `${treeId}::${uid}`;
    const existingRule = state.faultRules.get(key);
    const targetTree = state.treesMap.get(treeId);
    const targetNode = targetTree?.nodes.find((n) => n.uid === uid);
    const mode = existingRule?.mode || targetNode?.fault_mode;
    if (!mode || mode === 'NONE') return state;

    const delayMs = existingRule?.delay_ms ?? targetNode?.fault_delay_ms;

    const nextFaultRules = new Map(state.faultRules);
    nextFaultRules.set(key, { tree_id: treeId, uid, mode: mode as any, delay_ms: delayMs, once: !!once });

    const nextTreesMap = new Map(state.treesMap);
    if (targetTree) {
      const updatedNodes = targetTree.nodes.map((n) =>
        n.uid === uid ? { ...n, fault_once: !!once } : n
      );
      nextTreesMap.set(treeId, { ...targetTree, nodes: updatedNodes });
    }

    sendCommand({
      action: 'inject_fault',
      tree_id: treeId,
      uid,
      mode,
      delay_ms: delayMs || 0,
      once: !!once,
      source: 'btick',
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
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState {
    if (!treeId || !uid) return state;
    const key = `${treeId}::${uid}`;

    const nextFaultRules = new Map(state.faultRules);
    nextFaultRules.delete(key);

    const nextTreesMap = new Map(state.treesMap);
    const targetTree = nextTreesMap.get(treeId);
    if (targetTree) {
      const updatedNodes = targetTree.nodes.map((n) =>
        n.uid === uid ? { ...n, fault_mode: undefined, fault_delay_ms: undefined, fault_once: false } : n
      );
      nextTreesMap.set(treeId, { ...targetTree, nodes: updatedNodes });
    }

    sendCommand({
      action: 'clear_fault',
      tree_id: treeId,
      uid,
      source: 'btick',
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
    sendCommand: (cmd: any) => void
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
          status: n.status === 'PAUSED_AT_BREAKPOINT' ? ((n.last_result as NodeStatus) || 'IDLE') : n.status,
        }));
        nextTreesMap.set(activeTreeId, { ...targetTree, nodes: updatedNodes });
      }
      if (state.isPaused && (!state.pausedNodeTreeId || state.pausedNodeTreeId === activeTreeId)) {
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
          status: n.status === 'PAUSED_AT_BREAKPOINT' ? ((n.last_result as NodeStatus) || 'IDLE') : n.status,
        }));
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
      nextIsPaused = false;
      nextPausedTreeId = null;
      nextPausedUid = null;
      nextPausedName = undefined;
    }

    sendCommand({
      action: 'clear_all_breakpoints',
      tree_id: activeTreeId || 'ALL',
      source: 'btick',
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
    sendCommand: (cmd: any) => void
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
      action: 'clear_all_faults',
      tree_id: activeTreeId || 'ALL',
      source: 'btick',
    });

    return {
      ...state,
      faultRules: nextFaultRules,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  public handleContinuation(
    action: 'resume' | 'force_success' | 'force_failure',
    targetTreeId: string | undefined,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void
  ): ProtocolSessionState {
    const activeTreeId = targetTreeId || state.pausedNodeTreeId || state.selectedTreeId || (state.treesMap.size === 1 ? state.treesMap.keys().next().value : undefined);
    const currentPausedUid = state.pausedNodeUid;
    if (!currentPausedUid || !activeTreeId) return state;

    const canonicalKey = `${activeTreeId}::${currentPausedUid}`;
    const targetTree = state.treesMap.get(activeTreeId);
    const targetNode = targetTree?.nodes.find((n) => n.uid === currentPausedUid);
    const isOnce = state.breakpointOnceSet.has(canonicalKey) || Boolean(targetNode?.breakpoint_once);

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
        const shouldClearBp = isThisPaused && (state.breakpointOnceSet.has(key) || Boolean(n.breakpoint_once));
        const forcedResult = action === 'force_success' ? 'SUCCESS' : (action === 'force_failure' ? 'FAILURE' : n.status);
        return {
          ...n,
          status: isThisPaused && (action === 'force_success' || action === 'force_failure') ? forcedResult : (isThisPaused && n.status === 'PAUSED_AT_BREAKPOINT' ? 'RUNNING' : n.status),
          last_result: isThisPaused && (action === 'force_success' || action === 'force_failure') ? forcedResult : n.last_result,
          is_paused: isThisPaused ? false : n.is_paused,
          is_breakpoint: shouldClearBp ? false : n.is_breakpoint,
          breakpoint_once: shouldClearBp ? false : n.breakpoint_once,
        };
      });
      nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
    }

    if (isOnce) {
      sendCommand({
        action: 'clear_breakpoint',
        tree_id: activeTreeId,
        uid: currentPausedUid,
        source: 'btick',
      });
    }

    sendCommand({
      action,
      tree_id: activeTreeId,
      uid: currentPausedUid,
      once: isOnce,
      source: 'btick',
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
    treeId: string,
    key: string,
    value: any,
    valueType: 'bool' | 'int' | 'double' | 'string',
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
    requestId?: string
  ): ProtocolSessionState {
    if (!key || !treeId) return state;

    const reqId = requestId || `bb_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    sendCommand({
      action: 'set_blackboard',
      request_id: reqId,
      tree_id: treeId,
      key,
      value,
      value_type: valueType,
      source: 'btick',
    });

    return state;
  }

  public handleSetNodePort(
    treeId: string,
    uid: number,
    portName: string,
    value: string,
    mode: string,
    state: ProtocolSessionState,
    sendCommand: (cmd: any) => void,
    requestId?: string
  ): ProtocolSessionState {
    if (!portName || !treeId) return state;

    const reqId = requestId || `port_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    sendCommand({
      action: 'set_node_port',
      request_id: reqId,
      tree_id: treeId,
      uid,
      port_name: portName,
      value,
      mode,
      source: 'btick',
    });

    return state;
  }
}

export const btickHandler = new BTickHandler();
