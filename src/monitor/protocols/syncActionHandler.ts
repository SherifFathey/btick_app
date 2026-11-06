import { ProtocolSessionState } from "./types";
import { BTNodeModel, NodeStatus, FaultRule, FaultMode } from "../types/bt";

/**
 * Extracts and populates active breakpoints and fault rules directly from tree nodes.
 * Used whenever a tree is received or synchronized so any client connecting after
 * breakpoints or faults were set immediately sees them.
 */
export const syncBreakpointsAndFaultsFromTree = (
  treeId: string,
  nodes: BTNodeModel[],
  breakpoints: Set<string>,
  breakpointOnceSet: Set<string>,
  faultRules: Map<string, FaultRule>,
) => {
  for (const node of nodes) {
    if (!node || node.uid === undefined) continue;
    const canonicalKey = `${treeId}::${node.uid}`;
    if (node.is_breakpoint) {
      breakpoints.add(canonicalKey);
      if (node.breakpoint_once) {
        breakpointOnceSet.add(canonicalKey);
      }
    }
    if (node.fault_mode && node.fault_mode !== "NONE") {
      faultRules.set(canonicalKey, {
        tree_id: treeId,
        uid: node.uid,
        mode: node.fault_mode,
        delay_ms: node.fault_delay_ms,
        once: !!node.fault_once,
      });
    }
  }
};

/**
 * Applies interactive debugger sync actions (broadcast from peers like Mobile or Desktop)
 * directly into the ProtocolSessionState without re-emitting outbound commands.
 */
export const applySyncActionToSession = (
  data: any,
  state: ProtocolSessionState,
): ProtocolSessionState => {
  if (!data || !data.action) return state;

  const action = data.action;
  const cmd = data.data || data;
  const targetTreeId = cmd.tree_id || state.selectedTreeId;
  const uid = typeof cmd.uid === "number" ? cmd.uid : parseInt(cmd.uid, 10);

  // 1. Set Breakpoint
  if (action === "set_breakpoint") {
    const enabled = cmd.enabled !== false;
    const once = Boolean(cmd.once);
    const nextBreakpoints = new Set(state.breakpoints);
    const nextBreakpointOnce = new Set(state.breakpointOnceSet);
    const nextTreesMap = new Map(state.treesMap);

    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        const canonicalKey = `${tId}::${uid}`;
        if (enabled) {
          nextBreakpoints.add(canonicalKey);
          if (once) nextBreakpointOnce.add(canonicalKey);
          else nextBreakpointOnce.delete(canonicalKey);
        } else {
          nextBreakpoints.delete(canonicalKey);
          nextBreakpointOnce.delete(canonicalKey);
        }

        const updatedNodes = tree.nodes.map((n) => {
          if (n.uid !== uid) return n;
          const wasPaused =
            !enabled && (n.is_paused || n.status === "PAUSED_AT_BREAKPOINT");
          return {
            ...n,
            is_breakpoint: enabled,
            breakpoint_once: enabled ? once : false,
            is_paused: enabled ? n.is_paused : false,
            status: wasPaused
              ? (n.last_result as NodeStatus) || "IDLE"
              : n.status,
          };
        });
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    return {
      ...state,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
      breakpoints: nextBreakpoints,
      breakpointOnceSet: nextBreakpointOnce,
    };
  }

  // 2. Clear Single Breakpoint
  if (action === "clear_breakpoint") {
    const nextBreakpoints = new Set(state.breakpoints);
    const nextBreakpointOnce = new Set(state.breakpointOnceSet);
    const nextTreesMap = new Map(state.treesMap);

    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        const canonicalKey = `${tId}::${uid}`;
        nextBreakpoints.delete(canonicalKey);
        nextBreakpointOnce.delete(canonicalKey);

        const updatedNodes = tree.nodes.map((n) => {
          if (n.uid !== uid) return n;
          const wasPaused = n.is_paused || n.status === "PAUSED_AT_BREAKPOINT";
          return {
            ...n,
            is_breakpoint: false,
            breakpoint_once: false,
            is_paused: false,
            status: wasPaused
              ? (n.last_result as NodeStatus) || "IDLE"
              : n.status,
          };
        });
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    const isCurrentPausedOnThis =
      state.pausedNodeUid === uid &&
      (!targetTreeId || state.pausedNodeTreeId === targetTreeId);

    return {
      ...state,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
      breakpoints: nextBreakpoints,
      breakpointOnceSet: nextBreakpointOnce,
      isPaused: isCurrentPausedOnThis ? false : state.isPaused,
      pausedNodeTreeId: isCurrentPausedOnThis ? null : state.pausedNodeTreeId,
      pausedNodeUid: isCurrentPausedOnThis ? null : state.pausedNodeUid,
      pausedNodeName: isCurrentPausedOnThis ? undefined : state.pausedNodeName,
    };
  }

  // 3. Clear All Breakpoints
  if (action === "clear_all_breakpoints") {
    const nextBreakpoints = new Set(state.breakpoints);
    const nextBreakpointOnce = new Set(state.breakpointOnceSet);
    const nextTreesMap = new Map(state.treesMap);

    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        for (const k of state.breakpoints) {
          if (k.startsWith(`${tId}::`)) nextBreakpoints.delete(k);
        }
        for (const k of state.breakpointOnceSet) {
          if (k.startsWith(`${tId}::`)) nextBreakpointOnce.delete(k);
        }

        const updatedNodes = tree.nodes.map((n) => ({
          ...n,
          is_breakpoint: false,
          breakpoint_once: false,
          is_paused: false,
          status:
            n.is_paused || n.status === "PAUSED_AT_BREAKPOINT"
              ? (n.last_result as NodeStatus) || "IDLE"
              : n.status,
        }));
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    return {
      ...state,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
      breakpoints: nextBreakpoints,
      breakpointOnceSet: nextBreakpointOnce,
      isPaused: false,
      pausedNodeTreeId: null,
      pausedNodeUid: null,
      pausedNodeName: undefined,
    };
  }

  // 4. Inject Fault
  if (action === "inject_fault") {
    const mode = (cmd.mode || cmd.fault_mode || "NONE") as FaultMode;
    const delayMs =
      typeof cmd.delay_ms === "number"
        ? cmd.delay_ms
        : typeof cmd.fault_delay_ms === "number"
          ? cmd.fault_delay_ms
          : undefined;
    const once = Boolean(cmd.once || cmd.fault_once);

    const nextFaultRules = new Map(state.faultRules);
    const nextTreesMap = new Map(state.treesMap);

    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        const canonicalKey = `${tId}::${uid}`;
        if (mode && mode !== "NONE") {
          nextFaultRules.set(canonicalKey, {
            tree_id: tId,
            uid,
            mode,
            delay_ms: delayMs,
            once,
          });
        } else {
          nextFaultRules.delete(canonicalKey);
        }

        const updatedNodes = tree.nodes.map((n) =>
          n.uid === uid
            ? {
                ...n,
                fault_mode: mode === "NONE" ? undefined : mode,
                fault_delay_ms: mode === "DELAY" ? delayMs : undefined,
                fault_once: once,
              }
            : n,
        );
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    return {
      ...state,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
      faultRules: nextFaultRules,
    };
  }

  // 5. Clear Fault
  if (action === "clear_fault") {
    const nextFaultRules = new Map(state.faultRules);
    const nextTreesMap = new Map(state.treesMap);

    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        nextFaultRules.delete(`${tId}::${uid}`);
        const updatedNodes = tree.nodes.map((n) =>
          n.uid === uid
            ? {
                ...n,
                fault_mode: undefined,
                fault_delay_ms: undefined,
                fault_once: false,
              }
            : n,
        );
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    return {
      ...state,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
      faultRules: nextFaultRules,
    };
  }

  // 6. Clear All Faults
  if (action === "clear_all_faults") {
    const nextFaultRules = new Map(state.faultRules);
    const nextTreesMap = new Map(state.treesMap);

    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        for (const k of state.faultRules.keys()) {
          if (k.startsWith(`${tId}::`)) nextFaultRules.delete(k);
        }
        const updatedNodes = tree.nodes.map((n) => ({
          ...n,
          fault_mode: undefined,
          fault_delay_ms: undefined,
          fault_once: false,
        }));
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    return {
      ...state,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
      faultRules: nextFaultRules,
    };
  }

  // 7. Interactive Execution Step / Resume
  if (action === "resume" || action === "continue" || action === "step") {
    const nextTreesMap = new Map(state.treesMap);
    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        const updatedNodes = tree.nodes.map((n) => {
          if (n.is_paused || n.status === "PAUSED_AT_BREAKPOINT") {
            return {
              ...n,
              is_paused: false,
              status: (n.last_result as NodeStatus) || "IDLE",
            };
          }
          return n;
        });
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    return {
      ...state,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
      isPaused: false,
      pausedNodeTreeId: null,
      pausedNodeUid: null,
      pausedNodeName: undefined,
    };
  }

  // 8. Live Blackboard Edit Sync
  if (action === "set_blackboard") {
    const key = cmd.key;
    const value = cmd.value;
    if (!key) return state;

    const nextTreesMap = new Map(state.treesMap);
    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        nextTreesMap.set(tId, {
          ...tree,
          blackboard: {
            ...(tree.blackboard || {}),
            [key]: String(value),
          },
        });
      }
    }

    return {
      ...state,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  // 9. Live Node Port Edit Sync
  if (action === "set_node_port") {
    const portName = cmd.port_name;
    const val = cmd.value;
    if (!portName || uid === undefined || isNaN(uid)) return state;

    const nextTreesMap = new Map(state.treesMap);
    for (const [tId, tree] of nextTreesMap.entries()) {
      if (!targetTreeId || tId === targetTreeId) {
        const updatedNodes = tree.nodes.map((n) => {
          if (n.uid !== uid) return n;
          return {
            ...n,
            ports: {
              ...(n.ports || {}),
              [portName]: String(val),
            },
          };
        });
        nextTreesMap.set(tId, { ...tree, nodes: updatedNodes });
      }
    }

    return {
      ...state,
      treesMap: nextTreesMap,
      liveTreesMap: nextTreesMap,
    };
  }

  return state;
};
