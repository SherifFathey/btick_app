import React, {
  memo,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { Handle, Position, useStore, useReactFlow } from "@xyflow/react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  MinusCircle,
  ChevronDown,
  Plus,
  Cpu,
  GitBranch,
  Zap,
  Repeat,
  FolderTree,
  Check,
  Diamond,
  Pencil,
  AlertCircle,
} from "lucide-react";
import {
  BTNodeModel,
  BTPortDetail,
  NodeCategory,
  NodeStatus,
  TreeOrientation,
} from "../types/bt";
import { resolveNodePorts } from "../utils/ports";

interface BTNodeComponentProps {
  data: {
    nodeData: BTNodeModel;
    blackboard?: Record<string, unknown>;
    orientation?: TreeOrientation;
    isFailurePath?: boolean;
    hasChildren: boolean;
    isCollapsed: boolean;
    onToggleCollapse?: (nodeId: string) => void;
    onNodeResize?: (nodeId: string, height: number) => void;
    onSetNodePort?: (
      treeId: string,
      uid: number,
      portName: string,
      value: string,
      mode: "Literal" | "Blackboard",
    ) => Promise<{ success: boolean; error?: string }>;
    isReadOnly?: boolean;
  };
  selected?: boolean;
}

const getCategoryBadge = (category: NodeCategory, type: string) => {
  const normType = (type || "").toLowerCase();
  let icon: React.ReactNode;
  let bgStyle =
    "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700";
  let label = type || category;

  // 0. Root Node (Groot2 Root entry point)
  if (normType === "root" || (category as string) === "Root") {
    icon = (
      <FolderTree className="w-3 h-3 text-[#3B5B82] dark:text-sky-300 shrink-0" />
    );
    bgStyle =
      "bg-[#EBF3FC] text-[#243850] border-[#6D94C5]/40 dark:bg-[#1E293B] dark:text-sky-200 dark:border-sky-700/60 font-bold";
    return (
      <span
        className={`flex items-center gap-1.5 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border shadow-2xs ${bgStyle}`}
      >
        {icon}
        <span className="truncate max-w-[120px] select-text">Root</span>
      </span>
    );
  }

  // 1. Control Nodes (Groot2: Sequence ->, Fallback ?, Parallel ⇉)
  if (
    category === "Control" ||
    normType.includes("sequence") ||
    normType.includes("fallback") ||
    normType.includes("parallel") ||
    normType.includes("selector")
  ) {
    if (normType.includes("sequence")) {
      icon = (
        <span
          className="font-mono font-black text-xs text-[#3B5B82] dark:text-sky-300 leading-none"
          title="Sequence (→)"
        >
          →
        </span>
      );
      bgStyle =
        "bg-[#EBF3FC] text-[#243850] border-[#6D94C5]/40 dark:bg-[#1E293B] dark:text-sky-200 dark:border-sky-700/60 font-semibold";
    } else if (normType.includes("fallback") || normType.includes("selector")) {
      icon = (
        <span
          className="font-mono font-black text-xs text-amber-700 dark:text-amber-300 leading-none"
          title="Fallback (?)"
        >
          ?
        </span>
      );
      bgStyle =
        "bg-amber-100/90 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700/60 font-semibold";
    } else if (normType.includes("parallel")) {
      icon = (
        <span
          className="font-mono font-black text-xs text-slate-700 dark:text-slate-300 leading-none"
          title="Parallel (⇉)"
        >
          ⇉
        </span>
      );
      bgStyle =
        "bg-slate-100 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 font-semibold";
    } else {
      icon = (
        <GitBranch className="w-3 h-3 text-[#3B5B82] dark:text-sky-300 shrink-0" />
      );
      bgStyle =
        "bg-[#EBF3FC] text-[#243850] border-[#6D94C5]/40 dark:bg-[#1E293B] dark:text-sky-200 dark:border-sky-700/60 font-semibold";
    }
  }
  // 2. Decorator Nodes (Groot2: Inverter !, Repeat, Timeout, Diamond)
  else if (
    category === "Decorator" ||
    normType.includes("inverter") ||
    normType.includes("repeat") ||
    normType.includes("retry") ||
    normType.includes("timeout")
  ) {
    if (normType.includes("inverter")) {
      icon = (
        <span
          className="font-mono font-black text-xs text-rose-700 dark:text-rose-300 leading-none"
          title="Inverter (!)"
        >
          !
        </span>
      );
      bgStyle =
        "bg-rose-100/90 text-rose-900 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700/60 font-semibold";
    } else if (normType.includes("repeat") || normType.includes("retry")) {
      icon = (
        <Repeat className="w-3 h-3 text-teal-700 dark:text-teal-300 shrink-0" />
      );
      bgStyle =
        "bg-teal-100/90 text-teal-900 border-teal-300 dark:bg-teal-950/60 dark:text-teal-200 dark:border-teal-700/60 font-semibold";
    } else if (normType.includes("timeout")) {
      icon = (
        <Clock className="w-3 h-3 text-amber-700 dark:text-amber-300 shrink-0" />
      );
      bgStyle =
        "bg-amber-100/90 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700/60 font-semibold";
    } else {
      icon = (
        <Diamond className="w-3 h-3 text-teal-700 dark:text-teal-300 shrink-0" />
      );
      bgStyle =
        "bg-teal-100/90 text-teal-900 border-teal-300 dark:bg-teal-950/60 dark:text-teal-200 dark:border-teal-700/60 font-semibold";
    }
  }
  // 3. Action Nodes
  else if (category === "Action") {
    icon = (
      <Zap className="w-3 h-3 text-amber-700 dark:text-amber-300 shrink-0" />
    );
    bgStyle =
      "bg-amber-100/90 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700/60 font-semibold";
  }
  // 4. Condition Nodes
  else if (category === "Condition") {
    icon = (
      <Check className="w-3 h-3 text-emerald-700 dark:text-emerald-300 stroke-[2.5] shrink-0" />
    );
    bgStyle =
      "bg-emerald-100/90 text-emerald-900 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700/60 font-semibold";
  }
  // 5. SubTree Nodes
  else if (category === "SubTree") {
    icon = (
      <FolderTree className="w-3 h-3 text-blue-700 dark:text-purple-300 shrink-0" />
    );
    bgStyle =
      "bg-blue-50 text-blue-900 border-blue-200 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-700/60 font-semibold";
  } else {
    icon = (
      <Cpu className="w-3 h-3 text-slate-700 dark:text-slate-300 shrink-0" />
    );
    bgStyle =
      "bg-slate-100 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 font-semibold";
  }

  return (
    <span
      className={`flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border shadow-2xs min-w-0 shrink ${bgStyle}`}
    >
      {icon}
      <span className="truncate max-w-[85px] select-text">{label}</span>
    </span>
  );
};

const getStatusBadge = (status: NodeStatus) => {
  switch (status) {
    case "RUNNING":
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-extrabold px-2.5 py-0.5 rounded-md bg-gradient-to-r from-amber-500 to-yellow-500 text-white border border-amber-600 shadow-md animate-pulse">
          <Loader2 className="w-3 h-3 animate-spin text-white" />
          <span className="select-text">RUNNING</span>
        </span>
      );
    case "SUCCESS":
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-md bg-emerald-600 text-white border border-emerald-700 shadow-md">
          <CheckCircle2 className="w-3 h-3 text-white" />
          <span className="select-text">SUCCESS</span>
        </span>
      );
    case "FAILURE":
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-md bg-rose-600 text-white border border-rose-700 shadow-md">
          <XCircle className="w-3 h-3 text-white" />
          <span className="select-text">FAILURE</span>
        </span>
      );
    case "SKIPPED":
      return (
        <span className="flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 shadow-2xs">
          <MinusCircle className="w-2.5 h-2.5" />
          <span className="select-text">SKIPPED</span>
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 shadow-2xs">
          <span className="select-text">IDLE</span>
        </span>
      );
  }
};

const ZOOM_SCROLL_THRESHOLD = 0.85;

export const BTNodeComponent: React.FC<BTNodeComponentProps> = memo(
  ({ data, selected }) => {
    if (!data || !data.nodeData) {
      return null;
    }
    const {
      nodeData,
      blackboard = {},
      treeId = "MainTree",
      orientation = "vertical",
      hasChildren = false,
      isCollapsed = false,
      onToggleCollapse,
      onNodeResize,
      isLocked = false,
      onNodeContextMenu,
      onToggleBreakpoint,
      activeProtocol,
      onSetNodePort,
      isReadOnly = false,
    } = data as any;

    const isNav2 = activeProtocol === "nav2";

    // Zoom level subscription: only triggers re-render when crossing the threshold
    const isBigEnough = useStore((s) =>
      s?.transform ? s.transform[2] >= ZOOM_SCROLL_THRESHOLD : false,
    );

    // Measure content overflow for ports & attributes
    const portsListRef = useRef<HTMLDivElement>(null);
    const [hasOverflow, setHasOverflow] = useState(false);

    const checkOverflow = useCallback(() => {
      const el = portsListRef.current;
      if (el) {
        setHasOverflow(el.scrollHeight > el.clientHeight);
      }
    }, []);

    useEffect(() => {
      checkOverflow();
      const frameId = requestAnimationFrame(checkOverflow);
      let ro: ResizeObserver | undefined;
      if (typeof ResizeObserver !== "undefined" && portsListRef.current) {
        ro = new ResizeObserver(checkOverflow);
        ro.observe(portsListRef.current);
      }
      return () => {
        cancelAnimationFrame(frameId);
        if (ro) ro.disconnect();
      };
    }, [
      checkOverflow,
      nodeData.attributes,
      nodeData.ports,
      nodeData.port_details,
    ]);

    const handlePortsMouseEnter = () => {
      if (portsListRef.current) {
        setHasOverflow(
          portsListRef.current.scrollHeight > portsListRef.current.clientHeight,
        );
      }
    };

    const allowInternalScroll = isBigEnough && hasOverflow;

    const { getViewport, setViewport } = useReactFlow();
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const [editingPortName, setEditingPortName] = useState<string | null>(null);
    const [portDrafts, setPortDrafts] = useState<Record<string, string>>({});
    const [portApplying, setPortApplying] = useState<string | null>(null);
    const [portFeedback, setPortFeedback] = useState<Record<string, string>>(
      {},
    );

    useEffect(() => {
      if (!editingPortName) return;

      const rafId = requestAnimationFrame(() => {
        const editorEl = editorContainerRef.current;
        if (!editorEl) return;

        const currentViewport = getViewport();
        const editorRect = editorEl.getBoundingClientRect();
        const container =
          editorEl.closest(".react-flow") ||
          editorEl.closest(".react-flow__renderer") ||
          document.querySelector(".react-flow");
        const containerRect = container
          ? container.getBoundingClientRect()
          : {
              left: 0,
              top: 0,
              right: window.innerWidth,
              bottom: window.innerHeight,
              width: window.innerWidth,
              height: window.innerHeight,
            };

        const minReadableZoom = 0.75;
        const isTooSmall = currentViewport.zoom < minReadableZoom;

        if (isTooSmall) {
          // If heavily zoomed out, zoom in to comfortable minimum zoom and center the editor
          const targetZoom = minReadableZoom;
          const editorCenterX = editorRect.left + editorRect.width / 2;
          const editorCenterY = editorRect.top + editorRect.height / 2;
          const flowX =
            (editorCenterX - containerRect.left - currentViewport.x) /
            currentViewport.zoom;
          const flowY =
            (editorCenterY - containerRect.top - currentViewport.y) /
            currentViewport.zoom;

          const targetX = containerRect.width / 2 - flowX * targetZoom;
          const targetY = containerRect.height / 2 - flowY * targetZoom;

          setViewport(
            {
              x: targetX,
              y: targetY,
              zoom: targetZoom,
            },
            { duration: 250 },
          );
        } else {
          // Already at readable zoom: calculate minimal pan needed to ensure editor & buttons are fully visible
          const padding = 28;
          let deltaX = 0;
          let deltaY = 0;

          if (editorRect.left < containerRect.left + padding) {
            deltaX = containerRect.left + padding - editorRect.left;
          } else if (editorRect.right > containerRect.right - padding) {
            deltaX = containerRect.right - padding - editorRect.right;
          }

          if (editorRect.top < containerRect.top + padding) {
            deltaY = containerRect.top + padding - editorRect.top;
          } else if (editorRect.bottom > containerRect.bottom - padding) {
            deltaY = containerRect.bottom - padding - editorRect.bottom;
          }

          if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
            setViewport(
              {
                x: currentViewport.x + deltaX,
                y: currentViewport.y + deltaY,
                zoom: currentViewport.zoom,
              },
              { duration: 250 },
            );
          }
        }
      });

      return () => cancelAnimationFrame(rafId);
    }, [editingPortName, getViewport, setViewport]);

    const handlePortStartEdit = (port: BTPortDetail) => {
      setEditingPortName(port.name);
      setPortDrafts((previous) => ({ ...previous, [port.name]: port.value }));
      setPortFeedback((previous) => ({ ...previous, [port.name]: "" }));
    };

    const handlePortCancel = () => {
      if (portApplying === null) setEditingPortName(null);
    };

    const handlePortApply = async (port: BTPortDetail) => {
      if (
        !onSetNodePort ||
        !treeId ||
        !nodeData.uid ||
        isReadOnly ||
        activeProtocol !== "btick"
      )
        return;
      const value = portDrafts[port.name] ?? port.value;
      const mode =
        value.startsWith("{") && value.endsWith("}") ? "Blackboard" : "Literal";

      setPortApplying(port.name);
      setPortFeedback((previous) => ({ ...previous, [port.name]: "" }));
      try {
        const result = await onSetNodePort(
          treeId,
          nodeData.uid,
          port.name,
          value,
          mode,
        );
        setPortFeedback((previous) => ({
          ...previous,
          [port.name]: result.success
            ? "Applied"
            : result.error || "Failed to update",
        }));
        if (result.success) {
          setEditingPortName(null);
          setPortDrafts((previous) => {
            const next = { ...previous };
            delete next[port.name];
            return next;
          });
        }
      } catch (error: any) {
        setPortFeedback((previous) => ({
          ...previous,
          [port.name]: error?.message || "Request failed",
        }));
      } finally {
        setPortApplying(null);
      }
    };

    const renderCardPortRow = (
      name: string,
      rawValue: unknown,
      labelClass: string,
    ) => {
      const value = String(rawValue ?? "");
      const port = resolvedPorts.find((candidate) => candidate.name === name);
      const isEditing = editingPortName === name;
      const canEdit =
        !!port &&
        (port.direction === "Input" || port.direction === "Inout") &&
        activeProtocol === "btick" &&
        !isReadOnly &&
        !!onSetNodePort &&
        !!nodeData.uid;
      const draft = portDrafts[name] ?? value;
      const feedback = portFeedback[name];
      const { display } = resolvePortValue(value, name);
      const portValueClass =
        port?.mode === "Blackboard"
          ? "text-accent-primary"
          : "text-slate-900 dark:text-slate-100";

      return (
        <div key={name} className="flex flex-col">
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 shadow-2xs select-none"
            title={`Port: ${name} (${port?.mode ?? "Literal"})=${display}`}
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              <span className={`${labelClass} font-bold shrink-0 select-text`}>
                {name}=
              </span>
              <span
                className={`${portValueClass} font-semibold break-all select-text`}
              >
                {display}
              </span>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handlePortStartEdit(port);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                data-port-editor-control="true"
                className="nodrag nopan ml-auto shrink-0 p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-accent-primary transition-colors cursor-pointer active:scale-95"
                title={`Edit ${name}`}
                aria-label={`Edit Input Port ${name}`}
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
          </div>
          {isEditing && canEdit && (
            <div
              ref={editorContainerRef}
              className="nodrag nopan p-2 mx-1 my-1 bg-surface-primary rounded-lg border border-accent-primary/40 space-y-1.5 text-[10px] font-mono shadow-xs"
              data-port-editor-control="true"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="text-text-muted text-[9px] uppercase tracking-wider">
                Edit {name}
              </div>
              <input
                type="text"
                aria-label={`Edit Input Port ${name}`}
                value={draft}
                onChange={(event) =>
                  setPortDrafts((previous) => ({
                    ...previous,
                    [name]: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") handlePortApply(port);
                  if (event.key === "Escape") handlePortCancel();
                }}
                data-port-editor-control="true"
                className="w-full bg-surface-secondary border border-border-medium rounded-lg px-2 py-1 text-[10px] text-text-primary outline-none focus:border-border-focus"
                autoFocus
              />
              {feedback && feedback !== "Applied" && (
                <div className="text-[9px] text-rose-500 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span className="truncate">{feedback}</span>
                </div>
              )}
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={handlePortCancel}
                  disabled={portApplying === name}
                  data-port-editor-control="true"
                  className="px-2 py-0.5 rounded text-text-muted hover:bg-surface-hover cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handlePortApply(port)}
                  disabled={portApplying === name}
                  data-port-editor-control="true"
                  className="px-2.5 py-0.5 rounded bg-accent-primary hover:bg-accent-hover text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {portApplying === name ? "Applying..." : "Apply Change"}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    };

    const nodeRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [nodeSize, setNodeSize] = useState({ width: 240, height: 100 });
    useEffect(() => {
      const element = nodeRef.current;
      if (!element || !onNodeResize) return;
      const reportSize = () => onNodeResize(nodeData.id, element.offsetHeight);
      reportSize();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(reportSize);
      observer.observe(element);
      return () => observer.disconnect();
    }, [nodeData.id, onNodeResize]);
    useEffect(() => {
      const element = cardRef.current;
      if (!element) return;
      const updateSize = () =>
        setNodeSize({
          width: element.offsetWidth,
          height: element.offsetHeight,
        });
      updateSize();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(updateSize);
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    const [isHovered, setIsHovered] = useState(false);
    const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

    const handleMouseEnter = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
      hoverTimerRef.current = setTimeout(() => {
        setIsHovered(true);
      }, 250);
    };

    const handleMouseLeave = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setIsHovered(false);
    };

    useEffect(() => {
      return () => {
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
        }
      };
    }, []);

    const isHorizontal = orientation === "horizontal";
    const nodeStatus = nodeData?.status || "IDLE";
    const isRunning = nodeStatus === "RUNNING";
    const isSuccess = nodeStatus === "SUCCESS";
    const isFailure = nodeStatus === "FAILURE";
    const isPausedAtBreakpoint = !isNav2 && nodeData?.is_paused === true;
    const isBreakpoint = !isNav2 && !!nodeData?.is_breakpoint;
    const hasFault =
      !isNav2 && !!nodeData?.fault_mode && nodeData.fault_mode !== "NONE";
    const faultIndicatorStyle =
      nodeData?.fault_mode === "FORCE_SUCCESS"
        ? {
            banner:
              "bg-state-success-bg border-state-success-border text-state-success-text",
            icon: "text-state-success-text",
          }
        : nodeData?.fault_mode === "FORCE_FAILURE"
          ? {
              banner:
                "bg-state-failure-bg border-state-failure-border text-state-failure-text",
              icon: "text-state-failure-text",
            }
          : nodeData?.fault_mode === "FORCE_RUNNING"
            ? {
                banner:
                  "bg-state-running-bg border-state-running-border text-state-running-text",
                icon: "text-state-running-text",
              }
            : {
                banner:
                  "bg-surface-hover border-border-medium text-text-primary",
                icon: "text-text-muted",
              };

    // Live Delay countdown calculation (disabled for Nav2)
    const isDelayActive = !isNav2 && !!nodeData?.delay_active;
    const initialDelayMs =
      nodeData?.delay_total_ms || nodeData?.fault_delay_ms || 1000;
    const [delayRemainingSec, setDelayRemainingSec] = useState<string>(
      (initialDelayMs / 1000).toFixed(1),
    );
    const [delayProgressPercent, setDelayProgressPercent] =
      useState<number>(100);

    useEffect(() => {
      const totalMs =
        nodeData?.delay_total_ms || nodeData?.fault_delay_ms || 1000;
      const formattedInitial = (totalMs / 1000).toFixed(1);

      if (!isDelayActive) {
        setDelayRemainingSec(formattedInitial);
        setDelayProgressPercent(100);
        return;
      }

      setDelayRemainingSec(formattedInitial);
      setDelayProgressPercent(100);

      const now = Date.now();
      let startedAt = nodeData?.delay_started_at;
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
      nodeData?.delay_activation_id,
      nodeData?.delay_started_at,
      nodeData?.delay_total_ms,
      nodeData?.fault_delay_ms,
    ]);

    const resolvedPorts = useMemo(() => resolveNodePorts(nodeData), [nodeData]);
    const allParams = Object.fromEntries(
      resolvedPorts.map((port) => [port.name, port.value]),
    );
    const hasParams = Object.keys(allParams).length > 0;

    // Node card background styling: distinct elevation from canvas background in both Light & Dark
    let cardStyle =
      "border-[1.5px] border-slate-300 dark:border-[#2f3e56] bg-white dark:bg-[#111a2e] text-slate-900 dark:text-[#c8d3e0] shadow-md hover:bg-slate-50 dark:hover:bg-[#1b2a41] hover:border-slate-500 dark:hover:border-[#2f3e56] hover:shadow-xl transition-all duration-150";
    let accentBarStyle = "bg-slate-300 dark:bg-slate-600";
    let handleStyle =
      "!w-3.5 !h-3.5 !bg-slate-500 dark:!bg-slate-400 !border-2 !border-white dark:!border-[#111a2e] shadow-md transition-all";
    let durationHighlight = "text-slate-700 dark:text-slate-300 font-semibold";

    if (isPausedAtBreakpoint) {
      cardStyle =
        "border-2 border-amber-500 ring-4 ring-amber-400/60 bg-[#FFFBEB] dark:bg-[#422006]/90 text-amber-950 dark:text-amber-100 shadow-[0_0_25px_rgba(245,158,11,0.5)] bt-node-paused-pulse transition-all duration-150";
      accentBarStyle =
        "bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 shadow-sm";
      handleStyle =
        "!w-3.5 !h-3.5 !bg-amber-500 !border-2 !border-white dark:!border-[#111a2e] shadow-md";
      durationHighlight = "text-amber-800 dark:text-amber-300 font-bold";
    } else if (isFailure) {
      cardStyle =
        "border-[1.5px] border-rose-500 ring-2 ring-rose-400/40 bg-[#FDE2E7] dark:bg-[#4C0519]/80 hover:bg-[#FDCFD7] dark:hover:bg-[#4C0519] text-rose-950 dark:text-rose-100 shadow-[0_4px_20px_rgba(244,63,94,0.25)] transition-all duration-150";
      accentBarStyle =
        "bg-gradient-to-r from-rose-500 via-red-500 to-rose-600 shadow-xs";
      handleStyle =
        "!w-3.5 !h-3.5 !bg-rose-600 !border-2 !border-white dark:!border-[#111a2e] shadow-md";
      durationHighlight = "text-rose-700 dark:text-rose-300 font-bold";
    } else if (isRunning) {
      cardStyle =
        "border-[1.5px] border-amber-500 ring-2 ring-yellow-400/50 bg-[#FEF0DA] dark:bg-[#451A03]/80 hover:bg-[#FEE6C2] dark:hover:bg-[#451A03] text-amber-950 dark:text-amber-100 bt-node-running shadow-[0_4px_24px_rgba(245,158,11,0.35)] transition-all duration-150";
      accentBarStyle =
        "bg-gradient-to-r from-amber-500 via-yellow-400 to-orange-500 shadow-xs animate-pulse";
      handleStyle =
        "!w-3.5 !h-3.5 !bg-amber-500 !border-2 !border-white dark:!border-[#111a2e] shadow-md";
      durationHighlight = "text-amber-800 dark:text-amber-300 font-bold";
    } else if (isSuccess) {
      cardStyle =
        "border-[1.5px] border-emerald-500 ring-2 ring-emerald-400/40 bg-[#DBF5EC] dark:bg-[#064E3B]/80 hover:bg-[#C5EFE0] dark:hover:bg-[#064E3B] text-emerald-950 dark:text-emerald-100 shadow-[0_4px_20px_rgba(16,185,129,0.2)] transition-all duration-150";
      accentBarStyle =
        "bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600 shadow-xs";
      handleStyle =
        "!w-3.5 !h-3.5 !bg-emerald-600 !border-2 !border-white dark:!border-[#111a2e] shadow-md";
      durationHighlight = "text-emerald-800 dark:text-emerald-300 font-bold";
    } else if (nodeStatus === "SKIPPED") {
      cardStyle =
        "border-[1.5px] border-slate-300 dark:border-[#2f3e56] bg-slate-100/90 dark:bg-[#111a2e]/80 hover:bg-slate-200 dark:hover:bg-[#1b2a41] text-slate-700 dark:text-[#c8d3e0] shadow-xs transition-all duration-150";
      accentBarStyle = "bg-slate-400 dark:bg-slate-600 shadow-xs";
      handleStyle =
        "!w-3.5 !h-3.5 !bg-slate-500 dark:!bg-slate-400 !border-2 !border-white dark:!border-[#111a2e] shadow-md";
      durationHighlight = "text-slate-600 dark:text-slate-400 font-medium";
    }

    if (selected && !isDelayActive) {
      cardStyle +=
        " ring-4 ring-slate-400 dark:ring-sky-400/70 border-slate-700 dark:border-sky-400 scale-[1.02] shadow-xl";
    }

    const cursorClass = isLocked
      ? "cursor-default"
      : "cursor-grab active:cursor-grabbing";

    const resolvePortValue = (val: string, portName?: string) => {
      if (!val) return { display: "" };
      const trimmed = String(val).trim();
      const port = portName
        ? resolvedPorts.find((candidate) => candidate.name === portName)
        : undefined;

      if (port?.mode === "Blackboard") {
        const blackboardKey = port.value
          .trim()
          .replace(/^\{|\}$/g, "")
          .trim();
        if (Object.prototype.hasOwnProperty.call(blackboard, blackboardKey)) {
          const currentValue = blackboard[blackboardKey];
          return {
            display:
              typeof currentValue === "object" && currentValue !== null
                ? JSON.stringify(currentValue)
                : String(currentValue ?? ""),
          };
        }
      }

      return {
        display: trimmed,
      };
    };

    return (
      <div
        ref={nodeRef}
        className={`relative w-[240px] select-none ${cursorClass}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (onNodeContextMenu) {
            onNodeContextMenu(e, nodeData);
          }
        }}
      >
        {/* Telemetry Popover on Hover (Expands to show all data without scrollbars) */}
        {isHovered && (
          <div className="absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 z-50 pointer-events-none w-[320px] max-w-[400px] rounded-2xl bg-surface-primary text-text-primary border border-border-medium shadow-2xl ring-1 ring-black/5 dark:ring-white/10 p-3 font-sans transition-all duration-150 animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="flex items-center justify-between gap-1.5 pb-2 mb-2 border-b border-border-subtle">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    isSuccess
                      ? "bg-state-success-border"
                      : isFailure
                        ? "bg-state-failure-border"
                        : isRunning
                          ? "bg-state-running-border animate-pulse"
                          : isPausedAtBreakpoint
                            ? "bg-state-running-border animate-pulse"
                            : "bg-text-muted"
                  }`}
                />
                <div className="min-w-0">
                  <span
                    className="font-bold text-xs text-text-primary truncate block"
                    title={nodeData.name}
                  >
                    {nodeData.name}
                  </span>
                  <span className="text-[9px] font-mono text-text-secondary dark:text-text-muted block truncate">
                    {nodeData.category}
                  </span>
                </div>
              </div>
              {getCategoryBadge(nodeData.category, nodeData.type)}
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 mb-2 p-2 rounded-xl bg-surface-secondary border border-border-subtle font-mono text-[10px]">
              <div>
                <span className="text-text-secondary dark:text-text-muted block text-[9px] uppercase tracking-wider font-semibold">
                  Status
                </span>
                <span
                  className={`font-bold ${
                    isSuccess
                      ? "text-state-success-text"
                      : isFailure
                        ? "text-state-failure-text"
                        : isRunning
                          ? "text-state-running-text"
                          : isPausedAtBreakpoint
                            ? "text-state-running-text"
                            : "text-text-secondary"
                  }`}
                >
                  {isPausedAtBreakpoint ? "PAUSED" : nodeStatus}
                </span>
              </div>
              <div>
                <span className="text-text-secondary dark:text-text-muted block text-[9px] uppercase tracking-wider font-semibold">
                  Ticks
                </span>
                <span className="font-bold text-text-primary">
                  {nodeData.tick_count || 0}
                </span>
              </div>
              {nodeData.last_duration !== undefined &&
                nodeData.last_duration > 0 && (
                  <div className="col-span-2 pt-1.5 mt-0.5 border-t border-border-subtle flex items-center justify-between">
                    <span className="text-text-secondary dark:text-text-muted text-[9px] uppercase tracking-wider flex items-center gap-1 font-semibold">
                      <Clock className="w-3 h-3 text-accent-primary" /> Duration
                    </span>
                    <span className="font-bold text-accent-primary">
                      {nodeData.last_duration.toFixed(2)} ms
                    </span>
                  </div>
                )}
            </div>

            {/* Ports & Parameters - Full expanded view without scrollbars */}
            {hasParams && (
              <div className="space-y-1.5 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold tracking-wider text-text-secondary dark:text-text-muted uppercase block">
                    Ports & Blackboard
                  </span>
                  <span className="text-[9px] font-mono text-accent-primary font-semibold">
                    {Object.keys(allParams).length} entries
                  </span>
                </div>
                <div className="space-y-1 font-mono text-[10px]">
                  {Object.entries(allParams).map(([key, val]) => {
                    const { display } = resolvePortValue(String(val), key);

                    return (
                      <div
                        key={key}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-secondary border border-border-subtle text-text-primary min-w-0 shadow-2xs"
                      >
                        <span className="text-accent-primary font-semibold shrink-0">
                          {key}:
                        </span>
                        <span
                          className="text-text-secondary truncate"
                          title={display}
                        >
                          {display}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Debug Flags */}
            {(isBreakpoint || hasFault) && (
              <div className="flex items-center flex-wrap gap-1.5 mt-2 pt-2 border-t border-border-subtle text-[10px] font-mono">
                {isBreakpoint && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-state-bp-bg text-state-bp-text border border-state-bp-border font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-state-bp-border" />
                    <span>Breakpoint Active</span>
                  </span>
                )}
                {hasFault && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-state-fault-bg text-state-fault-text border border-state-fault-border font-medium">
                    ⚡ Fault: {nodeData.fault_mode}
                  </span>
                )}
              </div>
            )}

            {/* Arrow */}
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-surface-primary border-r border-b border-border-medium rotate-45" />
          </div>
        )}

        {/* Target Handles */}
        {/* target-top: always visible above the card in vertical layout */}
        <Handle
          type="target"
          position={Position.Top}
          id="target-top"
          className={
            !isHorizontal ? `${handleStyle} !w-5 !h-5 !z-10` : "!hidden"
          }
        />
        <Handle
          type="target"
          position={Position.Left}
          id="target-left"
          className={isHorizontal ? `${handleStyle} !z-10` : "!hidden"}
        />

        {/* Delay progress follows the selected node ring geometry starting from the parent connection port */}
        {isDelayActive &&
          (() => {
            const x0 = 4;
            const y0 = 4;
            const w = nodeSize.width;
            const h = nodeSize.height;
            const r = Math.min(10, Math.min(w, h) / 2);
            const x1 = x0 + w;
            const y1 = y0 + h;

            const pathD = isHorizontal
              ? `M ${x0} ${y0 + h / 2} L ${x0} ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} L ${x1 - r} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} L ${x0 + r} ${y1} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} Z`
              : `M ${x0 + w / 2} ${y0} L ${x1 - r} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} L ${x0 + r} ${y1} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} L ${x0} ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`;

            return (
              <div className="absolute -inset-1 z-0 pointer-events-none">
                <svg
                  className="absolute inset-0 h-full w-full overflow-visible"
                  viewBox={`0 0 ${nodeSize.width + 8} ${nodeSize.height + 8}`}
                  aria-hidden="true"
                >
                  <path
                    d={pathD}
                    fill="none"
                    stroke="var(--accent-primary)"
                    strokeOpacity="0.95"
                    strokeWidth="10"
                    pathLength="100"
                    strokeDasharray="100"
                    strokeDashoffset={100 - delayProgressPercent}
                    strokeLinecap="round"
                    className="transition-[stroke-dashoffset] duration-75 ease-linear"
                  />
                </svg>
                <span className="absolute -top-5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-black bg-white px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none text-[var(--accent-primary)] shadow-2xs">
                  {delayRemainingSec === "0.0" ? "0" : `${delayRemainingSec}s`}
                </span>
              </div>
            );
          })()}

        {/* Node Box */}
        <div
          ref={cardRef}
          className={`relative w-full rounded-xl overflow-hidden transition-all duration-150 ${cardStyle}`}
        >
          {/* Top Accent Color Bar */}
          <div className={`w-full h-1.5 rounded-t-xl ${accentBarStyle}`} />

          {/* Inner Card Content */}
          <div className="p-3 pt-2">
            {/* Header Bar: Breakpoint indicator, Category Tag & Status Pill */}
            <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0 shrink">
                {/* Breakpoint Indicator (🔴) */}
                {isBreakpoint && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onToggleBreakpoint && nodeData.uid) {
                        onToggleBreakpoint(treeId, nodeData.uid);
                      }
                    }}
                    title={
                      isPausedAtBreakpoint
                        ? "Execution PAUSED at Breakpoint (Click to remove)"
                        : "Breakpoint ACTIVE (Click to remove)"
                    }
                    className="relative flex items-center justify-center p-0.5 -ml-0.5 rounded cursor-pointer group shrink-0"
                  >
                    <span className="bt-breakpoint-ripple absolute inset-0 m-auto h-2.5 w-2.5 rounded-full border border-rose-500 pointer-events-none" />
                    <span className="bt-breakpoint-ripple-delayed absolute inset-0 m-auto h-2.5 w-2.5 rounded-full border border-rose-500 pointer-events-none" />
                    <span className="relative flex h-2.5 w-2.5 rounded-full bg-rose-500 border border-white dark:border-slate-800 shadow-sm z-10" />
                  </button>
                )}

                {/* Category tag */}
                {getCategoryBadge(nodeData.category, nodeData.type)}
              </div>

              {/* Status Badge */}
              <div className="shrink-0 flex items-center justify-end">
                {isPausedAtBreakpoint ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-mono font-extrabold bg-gradient-to-r from-amber-500 to-yellow-500 text-white border border-amber-600 shadow-md shrink-0">
                    ⏸️ PAUSED
                  </span>
                ) : (
                  getStatusBadge(nodeData.status)
                )}
              </div>
            </div>

            {/* Node Name */}
            <div className="nodrag flex items-center justify-between min-w-0 gap-2 select-none">
              <span
                className="font-bold text-sm tracking-tight truncate text-slate-900 dark:text-slate-100 select-text min-w-0 flex-1"
                title={nodeData.name}
              >
                {nodeData.name}
              </span>
            </div>

            {/* Fault Banner */}
            {hasFault && (
              <div
                className={`nodrag mt-1.5 flex items-center justify-between px-2 py-1 rounded-lg border font-mono text-[10px] font-bold shadow-xs select-none ${faultIndicatorStyle.banner}`}
              >
                <div className="flex items-center gap-1.5">
                  <Zap
                    className={`w-3 h-3 shrink-0 ${faultIndicatorStyle.icon}`}
                  />
                  <span className="select-text">
                    {nodeData.fault_mode === "FORCE_RUNNING"
                      ? "BLOCK TICK"
                      : nodeData.fault_mode}
                  </span>
                </div>
                {nodeData.fault_once && (
                  <span className="px-1.5 py-0.2 rounded bg-surface-primary/50 text-current text-[9px] select-none">
                    <span className="select-text">1x</span>
                  </span>
                )}
              </div>
            )}

            {/* Attributes & Ports (Compact scrollable list) */}
            {((nodeData.attributes &&
              Object.keys(nodeData.attributes).length > 0) ||
              (nodeData.ports && Object.keys(nodeData.ports).length > 0)) && (
              <div
                ref={portsListRef}
                onMouseEnter={handlePortsMouseEnter}
                className={`nodrag mt-2 flex flex-col gap-1.5 font-mono text-[10px] select-none pr-1 ${
                  editingPortName
                    ? "overflow-visible"
                    : `max-h-24 bt-node-scrollbar ${
                        allowInternalScroll
                          ? "nowheel overflow-y-auto overscroll-contain"
                          : "overflow-y-hidden"
                      }`
                }`}
                onWheel={(e) => {
                  if (allowInternalScroll) {
                    e.stopPropagation();
                  }
                }}
              >
                {nodeData.attributes &&
                  Object.entries(nodeData.attributes).map(([k, v]) => {
                    return renderCardPortRow(
                      k,
                      v,
                      "text-amber-700 dark:text-amber-400",
                    );
                  })}

                {nodeData.ports &&
                  Object.entries(nodeData.ports).map(([k, v]) => {
                    return renderCardPortRow(
                      k,
                      v,
                      "text-[#24456E] dark:text-sky-300",
                    );
                  })}
              </div>
            )}

            {/* Execution Time */}
            {nodeData.last_duration !== undefined &&
              nodeData.last_duration > 0 && (
                <div className="nodrag mt-2 pt-1.5 border-t border-slate-200 dark:border-slate-700/80 flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400 select-none">
                  <span className="flex items-center gap-1 select-none">
                    <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500" />{" "}
                    <span className="select-text">Duration:</span>
                  </span>
                  <span className={`${durationHighlight} select-none`}>
                    <span className="select-text">
                      {nodeData.last_duration.toFixed(1)} ms
                    </span>
                  </span>
                </div>
              )}
          </div>
        </div>

        {/* Source Handles */}
        {/* source-bottom: kept in DOM for React Flow edge connections, hidden visually */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="source-bottom"
          className={!isHorizontal ? `${handleStyle} !opacity-0` : "!hidden"}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="source-right"
          className={isHorizontal && hasChildren ? handleStyle : "!hidden"}
        />

        {/* Expand/Collapse Handle */}
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onToggleCollapse) onToggleCollapse(nodeData.id);
            }}
            className={`absolute ${
              isHorizontal
                ? "-right-3 top-1/2 -translate-y-1/2"
                : "-bottom-3 left-1/2 -translate-x-1/2"
            } w-5 h-5 rounded-md bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 hover:border-slate-900 dark:hover:border-white shadow-md flex items-center justify-center cursor-pointer group z-30 transition-all hover:scale-110 hover:bg-[#6D94C5] dark:hover:bg-sky-600`}
            title={isCollapsed ? "Expand subtree" : "Collapse subtree"}
          >
            {isCollapsed ? (
              <Plus className="w-3 h-3 text-slate-600 dark:text-slate-300 group-hover:text-white stroke-[2.5]" />
            ) : (
              <ChevronDown
                className={`w-3 h-3 text-slate-600 dark:text-slate-300 group-hover:text-white stroke-[2.5] ${isHorizontal ? "-rotate-90" : ""}`}
              />
            )}
          </button>
        )}
      </div>
    );
  },
);

BTNodeComponent.displayName = "BTNodeComponent";
