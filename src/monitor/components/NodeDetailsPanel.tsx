import React, { useState, useMemo } from "react";
import {
  X,
  Layers,
  Zap,
  Clock,
  Tag,
  Info,
  CheckCircle2,
  PlayCircle,
  XCircle,
  MinusCircle,
  Database,
  Copy,
  Check,
  Hourglass,
  ArrowUpRight,
  ArrowDownRight,
  Pencil,
  Lock,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { BTNodeModel, BTTreeModel, BTPortDetail } from "../types/bt";
import { resolveNodePorts } from "../utils/ports";
import { BTickDebugPanel } from "../protocols/btick";
import { Groot2DebugPanel } from "../protocols/groot2";

interface NodeDetailsPanelProps {
  node: BTNodeModel | null;
  tree: BTTreeModel | null;
  activeProtocol?: "btick" | "groot2" | "nav2";
  isReplaying?: boolean;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
  onOpenBlackboard?: () => void;
  onToggleBreakpoint?: (treeId: string, uid: number, once?: boolean) => void;
  onSetBreakpointOnce?: (treeId: string, uid: number, once: boolean) => void;
  onInjectFault?: (
    treeId: string,
    uid: number,
    mode: string,
    delayMs?: number,
    once?: boolean,
  ) => void;
  onSetFaultOnce?: (treeId: string, uid: number, once: boolean) => void;
  onClearFault?: (treeId: string, uid: number) => void;
  onResume?: (treeId?: string) => void;
  onForceSuccess?: (treeId?: string) => void;
  onForceFailure?: (treeId?: string) => void;
  onSetNodePort?: (
    treeId: string,
    uid: number,
    portName: string,
    value: string,
    mode: "Literal" | "Blackboard",
  ) => Promise<{ success: boolean; error?: string }>;
}

export const NodeDetailsPanel: React.FC<NodeDetailsPanelProps> = ({
  node,
  tree,
  activeProtocol = "btick",
  isReplaying = false,
  onClose,
  onSelectNode,
  onOpenBlackboard,
  onToggleBreakpoint,
  onSetBreakpointOnce,
  onInjectFault,
  onSetFaultOnce,
  onClearFault,
  onResume,
  onForceSuccess,
  onForceFailure,
  onSetNodePort,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live Node Port Editing state
  const [editingPortName, setEditingPortName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [portFeedback, setPortFeedback] = useState<{
    [portName: string]: { type: "success" | "error"; message: string };
  }>({});

  const isNav2 = activeProtocol === "nav2";
  const isDelayActive = !isNav2 && !!node?.delay_active;
  const hasBreakpoint = !isNav2 && !!node?.is_breakpoint;
  const hasFaultInjection =
    !isNav2 &&
    !!node?.fault_mode &&
    node.fault_mode !== "NONE" &&
    node.fault_mode !== "DELAY";
  const hasDelay =
    !isNav2 &&
    (isDelayActive ||
      node?.fault_mode === "DELAY" ||
      (!!node?.fault_delay_ms && node.fault_delay_ms > 0) ||
      (!!node?.delay_total_ms && isDelayActive));
  const isNodeExecutionPaused = !isNav2 && node?.is_paused === true;
  const hasRuntimeModifications =
    hasBreakpoint || hasFaultInjection || hasDelay || isNodeExecutionPaused;
  const initialDelayMs = node?.delay_total_ms || node?.fault_delay_ms || 1000;
  const [delayRemainingSec, setDelayRemainingSec] = useState<string>(
    (initialDelayMs / 1000).toFixed(1),
  );
  const [delayProgressPercent, setDelayProgressPercent] = useState<number>(100);

  React.useEffect(() => {
    const totalMs = node?.delay_total_ms || node?.fault_delay_ms || 1000;
    const formattedInitial = (totalMs / 1000).toFixed(1);

    if (!isDelayActive || !node) {
      setDelayRemainingSec(formattedInitial);
      setDelayProgressPercent(100);
      return;
    }

    setDelayRemainingSec(formattedInitial);
    setDelayProgressPercent(100);

    const now = Date.now();
    let startedAt = node?.delay_started_at;
    if (!startedAt || Math.abs(now - startedAt) > totalMs) {
      startedAt = now;
    }
    const endAt = startedAt + totalMs;

    const updateCountdown = () => {
      const currentNow = Date.now();
      const remainingMs = Math.max(0, endAt - currentNow);
      const remainingSec = (remainingMs / 1000).toFixed(1);
      const progress = Math.min(
        100,
        Math.max(0, (remainingMs / totalMs) * 100),
      );
      setDelayRemainingSec(remainingSec);
      setDelayProgressPercent(progress);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 50);
    return () => clearInterval(interval);
  }, [
    isDelayActive,
    node?.delay_activation_id,
    node?.delay_started_at,
    node?.delay_total_ms,
    node?.fault_delay_ms,
  ]);

  if (!node) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleStartEdit = (port: BTPortDetail) => {
    setEditingPortName(port.name);
    setEditValue(port.value);
    setPortFeedback((prev) => {
      const next = { ...prev };
      delete next[port.name];
      return next;
    });
  };

  const handleCancelEdit = () => {
    setEditingPortName(null);
    setEditValue("");
  };

  const handleApplyEdit = async (port: BTPortDetail) => {
    if (
      !onSetNodePort ||
      !tree?.tree_id ||
      node.uid === undefined ||
      node.uid === 0
    )
      return;

    const finalVal = editValue.trim();
    const isBB = finalVal.startsWith("{") && finalVal.endsWith("}");
    const mode = isBB ? "Blackboard" : "Literal";

    setIsApplying(true);
    try {
      const res = await onSetNodePort(
        tree.tree_id,
        node.uid,
        port.name,
        finalVal,
        mode,
      );
      if (res.success) {
        setPortFeedback((prev) => ({
          ...prev,
          [port.name]: { type: "success", message: "✓ Updated" },
        }));
        setEditingPortName(null);
        setTimeout(() => {
          setPortFeedback((prev) => {
            const next = { ...prev };
            delete next[port.name];
            return next;
          });
        }, 3000);
      } else {
        setPortFeedback((prev) => ({
          ...prev,
          [port.name]: {
            type: "error",
            message: `✕ Failed to update: ${res.error || "Unknown error"}`,
          },
        }));
      }
    } catch (err: any) {
      setPortFeedback((prev) => ({
        ...prev,
        [port.name]: {
          type: "error",
          message: `✕ Failed to update: ${err?.message || "Request failed"}`,
        },
      }));
    } finally {
      setIsApplying(false);
    }
  };

  // Find parent node
  const parentNode = tree?.nodes.find((n) => n.id === node.parent_id);

  // Find child nodes
  const childNodes =
    tree?.nodes.filter((n) => (node.children_ids || []).includes(n.id)) || [];

  // Resolve runtime ports and parameters
  const resolvedPorts = useMemo<BTPortDetail[]>(
    () => (node ? resolveNodePorts(node) : []),
    [node],
  );

  const inputPorts = useMemo(
    () => resolvedPorts.filter((p) => p.direction === "Input"),
    [resolvedPorts],
  );
  const outputPorts = useMemo(
    () => resolvedPorts.filter((p) => p.direction === "Output"),
    [resolvedPorts],
  );
  const inoutPorts = useMemo(
    () => resolvedPorts.filter((p) => p.direction === "Inout"),
    [resolvedPorts],
  );
  const unknownPorts = useMemo(
    () => resolvedPorts.filter((p) => p.direction === "Unknown"),
    [resolvedPorts],
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "RUNNING":
        return (
          <span className="flex items-center gap-1.5 text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-state-running-bg text-state-running-text border border-state-running-border animate-pulse">
            <PlayCircle className="w-3 h-3 animate-spin" />
            RUNNING
          </span>
        );
      case "SUCCESS":
        return (
          <span className="flex items-center gap-1.5 text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-state-success-bg text-state-success-text border border-state-success-border">
            <CheckCircle2 className="w-3 h-3" />
            SUCCESS
          </span>
        );
      case "FAILURE":
        return (
          <span className="flex items-center gap-1.5 text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-state-failure-bg text-state-failure-text border border-state-failure-border">
            <XCircle className="w-3 h-3" />
            FAILURE
          </span>
        );
      case "SKIPPED":
        return (
          <span className="flex items-center gap-1 text-[9px] font-mono font-medium px-2 py-0.5 rounded-md bg-surface-secondary text-text-muted border border-border-subtle">
            <MinusCircle className="w-2.5 h-2.5" />
            SKIPPED
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[9px] font-mono font-medium px-2 py-0.5 rounded-md bg-surface-secondary text-text-muted border border-border-subtle">
            IDLE
          </span>
        );
    }
  };

  const renderPortRow = (port: BTPortDetail) => {
    const isBB = port.mode === "Blackboard";
    const isOut = port.direction === "Output";
    const nodePortVal =
      port.runtime_value ?? node.output_ports_values?.[port.name];
    const liveVal =
      nodePortVal !== undefined && nodePortVal !== "" ? nodePortVal : undefined;
    const isEditable =
      !isReplaying &&
      (port.direction === "Input" || port.direction === "Inout") &&
      activeProtocol === "btick" &&
      node.uid !== undefined &&
      node.uid !== 0;
    const isEditing = editingPortName === port.name;
    const currentFeedback = portFeedback[port.name];

    return (
      <div key={port.name} className="flex flex-col">
        {/* Compact Port Row */}
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-surface-hover/60 transition-colors text-xs font-mono group select-text">
          {/* Port name */}
          <span
            className="font-semibold text-text-primary truncate min-w-[70px] max-w-[150px]"
            title={port.name}
          >
            {port.name}
          </span>

          {/* Value & subtle live blackboard value */}
          <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
            {isBB ? (
              <div className="flex items-center gap-1 min-w-0 truncate text-[11px]">
                <span
                  className="text-accent-primary font-medium truncate"
                  title={port.value}
                >
                  {port.value}
                </span>
                {liveVal !== undefined && (
                  <span
                    className="text-text-muted text-[10px] flex items-center gap-0.5 shrink-0 font-sans"
                    title={
                      isOut
                        ? `Node Output Value: ${String(liveVal)}`
                        : `Node Runtime Value: ${String(liveVal)}`
                    }
                  >
                    <span className="text-text-tertiary">→</span>
                    <span className="text-state-success-text font-bold truncate max-w-[120px]">
                      {typeof liveVal === "object"
                        ? JSON.stringify(liveVal)
                        : String(liveVal)}
                    </span>
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1 min-w-0 truncate text-[11px]">
                <span
                  className="text-text-secondary truncate text-right text-[11px]"
                  title={port.value}
                >
                  {port.value !== "" ? (
                    port.value
                  ) : (
                    <span className="text-text-muted italic">
                      &lt;empty&gt;
                    </span>
                  )}
                </span>
                {liveVal !== undefined && liveVal !== port.value && (
                  <span
                    className="text-text-muted text-[10px] flex items-center gap-0.5 shrink-0 font-sans"
                    title={
                      isOut
                        ? `Node Output Value: ${String(liveVal)}`
                        : `Node Runtime Value: ${String(liveVal)}`
                    }
                  >
                    <span className="text-text-tertiary">→</span>
                    <span className="text-state-success-text font-bold truncate max-w-[120px]">
                      {typeof liveVal === "object"
                        ? JSON.stringify(liveVal)
                        : String(liveVal)}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Action icon */}
          <div className="flex items-center gap-1 shrink-0 ml-1 select-none">
            {isEditable ? (
              <button
                onClick={() => handleStartEdit(port)}
                className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-accent-primary transition-colors cursor-pointer active:scale-95"
                title={`Edit ${port.name}`}
                aria-label={`Edit ${port.name}`}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span
                className="p-1 text-text-muted/40 flex items-center justify-center cursor-default"
                title={isOut ? "Output Port (Read Only)" : "Read Only"}
                aria-label={isOut ? "Output Port (Read Only)" : "Read Only"}
              >
                <Lock className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        </div>

        {/* Compact Inline Editor */}
        {isEditing && (
          <div className="p-2.5 mx-1 my-1.5 bg-surface-primary rounded-xl border border-accent-primary/40 space-y-2 text-xs font-mono shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Pencil className="w-3 h-3 text-accent-primary" />
                <span className="font-bold text-text-primary text-[11px]">
                  Edit {port.name}
                </span>
              </div>
              <span className="text-[10px] text-text-muted bg-surface-secondary px-1.5 py-0.2 rounded border border-border-subtle">
                Type: {port.type || "string"}
              </span>
            </div>

            {/* Value input */}
            <div>
              <span className="text-text-muted text-[9px] uppercase tracking-wider block mb-0.5">
                Value
              </span>
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleApplyEdit(port);
                  if (e.key === "Escape") handleCancelEdit();
                }}
                placeholder={`Enter new ${port.type || "value"}...`}
                className="w-full bg-surface-secondary border border-border-medium rounded-lg px-2.5 py-1 text-xs font-mono text-text-primary outline-none focus:border-border-focus"
                autoFocus
              />
            </div>

            {/* Error inside editor if any */}
            {currentFeedback && currentFeedback.type === "error" && (
              <div className="p-1.5 rounded text-[10px] flex items-center gap-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/30">
                <AlertCircle className="w-3 h-3 shrink-0 text-rose-400" />
                <span className="truncate">{currentFeedback.message}</span>
              </div>
            )}

            {/* Actions: Cancel / Apply */}
            <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border-subtle">
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={isApplying}
                className="px-2.5 py-0.5 rounded hover:bg-surface-hover text-text-muted text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleApplyEdit(port)}
                disabled={isApplying}
                className="flex items-center gap-1 px-3 py-0.5 rounded bg-accent-primary hover:bg-accent-hover text-white text-xs font-bold cursor-pointer disabled:opacity-50 shadow-2xs active:scale-95"
              >
                {isApplying ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Applying...</span>
                  </>
                ) : (
                  <span>Apply</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Transient feedback toast right below row when not editing */}
        {currentFeedback && !isEditing && (
          <div
            className={`px-2 py-1 mx-2 mb-1 rounded text-[10px] font-medium flex items-center gap-1.5 ${
              currentFeedback.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400"
            }`}
          >
            {currentFeedback.type === "success" ? (
              <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-500" />
            ) : (
              <AlertCircle className="w-3 h-3 shrink-0 text-rose-500" />
            )}
            <span className="truncate">{currentFeedback.message}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-96 h-full bg-surface-primary border-l border-border-subtle flex flex-col z-20 shadow-xl select-text font-sans text-xs overflow-hidden shrink-0">
      {/* Drawer Header */}
      <div className="h-[44px] px-3.5 border-b border-border-subtle bg-surface-primary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-accent-primary" />
          <h2 className="font-bold text-xs text-text-primary uppercase tracking-wide font-mono">
            Node Information
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer shadow-2xs active:scale-95"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Content Scrollable Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-surface-primary">
        {/* Node Information */}
        <div className="bg-surface-secondary p-3 rounded-xl border border-border-medium space-y-2.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase text-accent-primary font-bold px-2 py-0.5 rounded-md bg-surface-primary border border-border-subtle">
              {node.type || node.category}
            </span>
            {getStatusBadge(node.status)}
          </div>

          <div>
            <h3 className="text-sm font-bold text-text-primary">{node.name}</h3>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono pt-1.5 border-t border-border-subtle">
            <span className="text-text-muted">Category</span>
            <span className="text-text-primary font-bold">{node.category}</span>
          </div>
        </div>

        {/* Runtime Modifications */}
        {hasRuntimeModifications && (
          <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
              <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 font-mono uppercase tracking-wider">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span>Runtime Modifications</span>
              </h4>
            </div>

            <div className="space-y-2">
              {isNodeExecutionPaused && (
                <div className="p-2.5 rounded-xl bg-state-paused-bg border border-state-paused-border space-y-2 shadow-2xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-state-paused-border bt-pause-pulse shrink-0" />
                    <span className="text-[10px] font-bold text-state-paused-text uppercase font-mono">
                      Node Execution Paused
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                    <button
                      onClick={() => onResume?.(tree?.tree_id || "MainTree")}
                      className="flex flex-col items-center justify-center p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] cursor-pointer transition-all border border-emerald-700 shadow-xs active:scale-95"
                      title="Continue real node execution"
                    >
                      <PlayCircle className="w-3.5 h-3.5 fill-current mb-0.5" />
                      <span>Continue</span>
                    </button>
                    <button
                      onClick={() =>
                        onForceSuccess?.(tree?.tree_id || "MainTree")
                      }
                      className="flex flex-col items-center justify-center p-2 rounded-lg bg-surface-primary hover:bg-surface-hover text-text-primary font-semibold text-[10px] border border-border-medium cursor-pointer transition-all shadow-2xs active:scale-95"
                      title="Force SUCCESS (Fault Injection)"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mb-0.5" />
                      <span>Success</span>
                    </button>
                    <button
                      onClick={() =>
                        onForceFailure?.(tree?.tree_id || "MainTree")
                      }
                      className="flex flex-col items-center justify-center p-2 rounded-lg bg-surface-primary hover:bg-surface-hover text-text-primary font-semibold text-[10px] border border-border-medium cursor-pointer transition-all shadow-2xs active:scale-95"
                      title="Force FAILURE (Fault Injection)"
                    >
                      <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 mb-0.5" />
                      <span>Failure</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 1. Breakpoint */}
              {hasBreakpoint && (
                <div className="p-2.5 rounded-xl bg-surface-secondary border border-border-medium space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                      <span className="font-mono font-bold text-xs text-text-primary tracking-wide">
                        BREAKPOINT
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {node.is_paused === true && (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-extrabold bg-gradient-to-r from-amber-500 to-yellow-500 text-white border border-amber-600 shadow-2xs">
                          ⏸️ PAUSED
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-md text-[9px] font-mono border ${
                          node.breakpoint_once
                            ? "bg-state-running-bg text-state-running-text border-state-running-border font-bold"
                            : "bg-surface-primary text-text-muted border-border-subtle"
                        }`}
                      >
                        {node.breakpoint_once ? "1x Once" : "Permanent"}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Fault Injection */}
              {hasFaultInjection && (
                <div className="p-2.5 rounded-xl bg-surface-secondary border border-border-medium space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                      <span className="font-mono font-bold text-xs text-text-primary tracking-wide">
                        FAULT INJECTION
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[9px] font-mono border ${
                        node.fault_once
                          ? "bg-accent-subtle text-accent-hover dark:text-purple-300 border-accent-border dark:border-purple-700 font-bold"
                          : "bg-surface-primary text-text-muted border-border-subtle"
                      }`}
                    >
                      {node.fault_once ? "1x Once" : "Permanent"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono pt-1.5 border-t border-border-subtle/60 pl-4">
                    <span className="text-text-muted">Effect:</span>
                    {node.fault_mode === "FORCE_SUCCESS" && (
                      <span className="font-bold text-state-success-text px-2 py-0.5 rounded-md bg-state-success-bg border border-state-success-border text-[10px]">
                        SUCCESS
                      </span>
                    )}
                    {node.fault_mode === "FORCE_FAILURE" && (
                      <span className="font-bold text-state-failure-text px-2 py-0.5 rounded-md bg-state-failure-bg border border-state-failure-border text-[10px]">
                        FAILURE
                      </span>
                    )}
                    {node.fault_mode === "FORCE_RUNNING" && (
                      <span className="font-bold text-state-running-text px-2 py-0.5 rounded-md bg-state-running-bg border border-state-running-border text-[10px]">
                        BLOCK TICK
                      </span>
                    )}
                    {node.fault_mode === "FORCE_SKIPPED" && (
                      <span className="font-bold text-text-muted px-2 py-0.5 rounded-md bg-surface-primary border border-border-subtle text-[10px]">
                        SKIPPED
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 3. Delay */}
              {hasDelay && (
                <div className="p-2.5 rounded-xl bg-surface-secondary border border-border-medium space-y-2 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-accent-primary shrink-0" />
                      <span className="font-mono font-bold text-xs text-text-primary tracking-wide">
                        DELAY
                      </span>
                    </div>
                    {isDelayActive ? (
                      <span className="font-mono font-bold text-[10px] px-2 py-0.5 rounded-md bg-accent-subtle dark:bg-purple-950 text-accent-hover dark:text-purple-300 border border-accent-border dark:border-purple-700">
                        {delayRemainingSec}s left
                      </span>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[9px] font-mono border ${
                          node.fault_once
                            ? "bg-accent-subtle text-accent-hover dark:text-purple-300 border-accent-border dark:border-purple-700 font-bold"
                            : "bg-surface-primary text-text-muted border-border-subtle"
                        }`}
                      >
                        {node.fault_once ? "1x Once" : "Permanent"}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono pt-1.5 border-t border-border-subtle/60 pl-4">
                    <span className="text-text-muted">Duration:</span>
                    <span className="font-bold text-text-primary">
                      {`${node.delay_total_ms || node.fault_delay_ms || 1000} ms`}
                    </span>
                  </div>

                  {/* Live Delay Progress Bar */}
                  {isDelayActive && (
                    <div className="w-full h-1.5 bg-surface-primary rounded-md overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-accent-primary to-blue-400 transition-all duration-100 ease-linear rounded-md"
                        style={{ width: `${delayProgressPercent}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Execution Performance Statistics */}
        {/* Execution Performance Statistics */}
        <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
            <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 font-mono uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5 text-accent-primary" />
              <span>Execution Metrics</span>
            </h4>
          </div>
          <div className="bg-surface-secondary p-3 rounded-xl border border-border-medium grid grid-cols-2 gap-2 text-xs shadow-2xs">
            <div>
              <span className="text-text-muted text-[10px] block font-mono">
                Ticks Count
              </span>
              <span className="text-text-primary font-mono font-bold text-xs">
                {node.tick_count || 0}
              </span>
            </div>
            <div>
              <span className="text-text-muted text-[10px] block font-mono">
                Last Duration
              </span>
              <span className="text-accent-primary font-mono font-bold text-xs">
                {node.last_duration !== undefined
                  ? `${node.last_duration.toFixed(2)} ms`
                  : "N/A"}
              </span>
            </div>
          </div>
        </div>

        {/* Hierarchy Section */}
        <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
            <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 font-mono uppercase tracking-wider">
              <Layers className="w-3.5 h-3.5 text-accent-primary" />
              <span>Tree Hierarchy</span>
            </h4>
            <span className="text-[10px] font-mono text-text-muted px-2 py-0.5 rounded-md bg-surface-primary border border-border-subtle">
              {childNodes.length} Child{childNodes.length !== 1 ? "ren" : ""}
            </span>
          </div>
          <div className="bg-surface-secondary p-3 rounded-xl border border-border-medium space-y-2.5 shadow-2xs">
            <div>
              <span className="text-text-muted text-[12px] block mb-1 font-mono">
                Parent Node
              </span>
              {parentNode ? (
                <button
                  onClick={() => onSelectNode(parentNode.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface-primary hover:bg-surface-hover border border-border-medium text-text-primary font-semibold cursor-pointer transition-all shadow-2xs active:scale-95 w-full text-left"
                >
                  <ArrowUpRight className="w-3 h-3" />
                  <span className="truncate">{parentNode.name}</span>
                </button>
              ) : (
                <span className="text-text-muted italic">None (Root Node)</span>
              )}
            </div>
          </div>
          <div className="bg-surface-secondary p-3 rounded-xl border border-border-medium space-y-2.5 shadow-2xs">
            <div>
              <span className="text-text-muted text-[12px] block mb-1 font-mono">
                Children Nodes ({childNodes.length})
              </span>
              {childNodes.length > 0 ? (
                <div className="space-y-1">
                  {childNodes.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => onSelectNode(child.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-surface-primary hover:bg-surface-hover border border-border-medium text-text-primary font-medium w-full text-left truncate cursor-pointer transition-all shadow-2xs active:scale-95"
                    >
                      <ArrowDownRight className="w-3 h-3 text-text-muted" />
                      <span className="truncate">{child.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-text-muted italic">None (Leaf Node)</span>
              )}
            </div>
          </div>
        </div>

        {/* INPUT PORTS */}
        <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
            <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 uppercase tracking-wider font-mono">
              <Database className="w-3.5 h-3.5 text-accent-primary" />
              <span>Input Ports</span>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-surface-primary text-text-muted border border-border-subtle">
                {inputPorts.length}
              </span>
            </h4>
            {onOpenBlackboard && (
              <button
                onClick={onOpenBlackboard}
                className="text-[10px] text-accent-primary hover:underline font-semibold cursor-pointer"
              >
                Open Watcher →
              </button>
            )}
          </div>

          {inputPorts.length > 0 ? (
            <div className="space-y-1">
              {inputPorts.map((port) => (
                <div
                  key={port.name}
                  className="bg-surface-secondary rounded-xl border border-border-medium shadow-2xs"
                >
                  {renderPortRow(port)}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-2.5 bg-surface-primary rounded-xl border border-border-medium text-text-muted italic text-center text-[11px]">
              No input ports declared
            </div>
          )}
        </div>

        {/* OUTPUT PORTS */}
        {outputPorts.length > 0 && (
          <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
              <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 uppercase tracking-wider font-mono">
                <Database className="w-3.5 h-3.5 text-amber-500" />
                <span>Output Ports</span>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-surface-primary text-text-muted border border-border-subtle">
                  {outputPorts.length}
                </span>
              </h4>
            </div>

            <div className="space-y-1">
              {outputPorts.map((port) => (
                <div
                  key={port.name}
                  className="bg-surface-secondary rounded-xl border border-border-medium shadow-2xs"
                >
                  {renderPortRow(port)}
                </div>
              ))}
            </div>
          </div>
        )}

        {inoutPorts.length > 0 && (
          <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
              <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 uppercase tracking-wider font-mono">
                <Database className="w-3.5 h-3.5 text-violet-500" />
                <span>Inout Ports</span>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-surface-primary text-text-muted border border-border-subtle">
                  {inoutPorts.length}
                </span>
              </h4>
              {onOpenBlackboard && (
                <button
                  onClick={onOpenBlackboard}
                  className="text-[10px] text-accent-primary hover:underline font-semibold cursor-pointer"
                >
                  Open Watcher →
                </button>
              )}
            </div>
            <div className="space-y-1">
              {inoutPorts.map((port) => (
                <div
                  key={port.name}
                  className="bg-surface-secondary rounded-xl border border-border-medium shadow-2xs"
                >
                  {renderPortRow(port)}
                </div>
              ))}
            </div>
          </div>
        )}

        {unknownPorts.length > 0 && (
          <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
              <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 uppercase tracking-wider font-mono">
                <Database className="w-3.5 h-3.5 text-text-muted" />
                <span>Unknown Direction</span>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-surface-primary text-text-muted border border-border-subtle">
                  {unknownPorts.length}
                </span>
              </h4>
            </div>
            <div className="space-y-1">
              {unknownPorts.map((port) => (
                <div
                  key={port.name}
                  className="bg-surface-secondary rounded-xl border border-border-medium shadow-2xs"
                >
                  {renderPortRow(port)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Other XML Attributes */}
        {(() => {
          const portNames = new Set(resolvedPorts.map((p) => p.name));
          const otherAttrs = Object.entries(node.attributes || {}).filter(
            ([k]) => !portNames.has(k) && k !== "name" && k !== "ID",
          );
          if (otherAttrs.length === 0) return null;

          return (
            <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
                <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 uppercase tracking-wider font-mono">
                  <Tag className="w-3.5 h-3.5 text-text-muted" />
                  <span>Other Attributes</span>
                  <span className="text-[10px] font-mono text-text-muted px-2 py-0.5 rounded-md bg-surface-primary border border-border-subtle">
                    {otherAttrs.length}
                  </span>
                </h4>
              </div>
              <div className="bg-surface-primary rounded-xl border border-border-medium overflow-hidden font-mono text-[10px] shadow-2xs">
                {otherAttrs.map(([key, val], idx) => (
                  <div
                    key={key}
                    className={`p-2.5 flex items-center justify-between gap-2 ${idx > 0 ? "border-t border-border-subtle" : ""}`}
                  >
                    <span className="text-cat-control-text font-bold">
                      {key}
                    </span>
                    <span className="text-text-primary font-mono truncate">
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {Object.keys(node.meta || {}).length > 0 && (
          <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
              <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 uppercase tracking-wider font-mono">
                <Tag className="w-3.5 h-3.5 text-accent-primary" />
                <span>BT.CPP Metadata</span>
                <span className="text-[10px] font-mono text-text-muted px-2 py-0.5 rounded-md bg-surface-primary border border-border-subtle">
                  {Object.keys(node.meta || {}).length}
                </span>
              </h4>
            </div>
            <div className="bg-surface-primary rounded-xl border border-border-medium overflow-hidden font-mono text-[10px] shadow-2xs">
              {Object.entries(node.meta || {}).map(([key, value], idx) => (
                <div
                  key={key}
                  className={`p-2.5 flex items-center justify-between gap-2 ${idx > 0 ? "border-t border-border-subtle" : ""}`}
                >
                  <span className="text-accent-primary font-bold">{key}</span>
                  <span className="text-text-primary font-mono truncate">
                    {value === null
                      ? "null"
                      : typeof value === "object"
                        ? (JSON.stringify(value) ?? String(value))
                        : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Protocol-Specific Debug & Fault Injection Panel */}
        {!isReplaying && activeProtocol === "groot2" ? (
          <Groot2DebugPanel
            node={node}
            tree={tree}
            onToggleBreakpoint={isReplaying ? undefined : onToggleBreakpoint}
            onSetBreakpointOnce={isReplaying ? undefined : onSetBreakpointOnce}
            onInjectFault={isReplaying ? undefined : onInjectFault}
            onSetFaultOnce={isReplaying ? undefined : onSetFaultOnce}
            onClearFault={isReplaying ? undefined : onClearFault}
            onResume={isReplaying ? undefined : onResume}
            onForceSuccess={isReplaying ? undefined : onForceSuccess}
            onForceFailure={isReplaying ? undefined : onForceFailure}
          />
        ) : !isReplaying && activeProtocol === "btick" ? (
          <BTickDebugPanel
            node={node}
            tree={tree}
            onToggleBreakpoint={isReplaying ? undefined : onToggleBreakpoint}
            onSetBreakpointOnce={isReplaying ? undefined : onSetBreakpointOnce}
            onInjectFault={isReplaying ? undefined : onInjectFault}
            onSetFaultOnce={isReplaying ? undefined : onSetFaultOnce}
            onClearFault={isReplaying ? undefined : onClearFault}
            onResume={isReplaying ? undefined : onResume}
            onForceSuccess={isReplaying ? undefined : onForceSuccess}
            onForceFailure={isReplaying ? undefined : onForceFailure}
          />
        ) : null}
      </div>
    </aside>
  );
};
