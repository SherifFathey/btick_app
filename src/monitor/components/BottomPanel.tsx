import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import {
  Terminal,
  Trash2,
  Search,
  ChevronUp,
  ChevronDown,
  Play,
  Pause,
  Zap,
  Circle,
  RotateCcw,
  XCircle,
} from "lucide-react";
import {
  TransitionEvent,
  BTTreeModel,
  NodeStatus,
  BTNodeModel,
} from "../types/bt";

interface BottomPanelProps {
  events: TransitionEvent[];
  tree: BTTreeModel | null;
  trees?: BTTreeModel[];
  isReplaying?: boolean;
  onSelectNode: (nodeId: string, treeId?: string) => void;
  onClearEvents: () => void;
  isPaused: boolean;
  onTogglePause: () => void;
  activeProtocol?: "btick" | "groot2" | "nav2";
  onToggleBreakpoint?: (treeId: string, uid: number) => void;
  onClearFault?: (treeId: string, uid: number) => void;
  onClearAllBreakpoints?: (treeId?: string) => void;
  onClearAllFaults?: (treeId?: string) => void;
}

export const MAX_RENDERED_LOGS = 1000;
export const EVENT_LOG_ROW_HEIGHT = 28;
export const EVENT_LOG_OVERSCAN = 10;

export interface VirtualLogWindow {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export const calculateVirtualLogWindow = (
  totalCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = EVENT_LOG_ROW_HEIGHT,
  overscan = EVENT_LOG_OVERSCAN,
): VirtualLogWindow => {
  if (totalCount <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  }

  const effectiveViewportHeight = Math.max(viewportHeight, rowHeight);
  const visibleCount = Math.ceil(effectiveViewportHeight / rowHeight);
  const rawStartIndex = Math.floor(scrollTop / rowHeight);
  const startIndex = Math.max(0, rawStartIndex - overscan);
  const endIndex = Math.min(
    totalCount,
    rawStartIndex + visibleCount + overscan,
  );
  const topSpacerHeight = startIndex * rowHeight;
  const bottomSpacerHeight = Math.max(0, (totalCount - endIndex) * rowHeight);

  return {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
  };
};

export const getVirtualWindow = calculateVirtualLogWindow;

export const matchesEventFilter = (
  ev: TransitionEvent,
  activeProtocol: "btick" | "groot2" | "nav2",
  selectedTreeFilter: "ALL" | "ACTIVE",
  tree: BTTreeModel | null,
  statusFilter: string,
  filterQuery: string,
): boolean => {
  // 1. Strict Protocol Isolation: show ONLY logs belonging to the active protocol
  const p = (ev as any).protocol || (ev as any).source;
  if (p) {
    if (activeProtocol === "btick" && p !== "btick") return false;
    if (activeProtocol === "nav2" && p !== "nav2") return false;
    if (activeProtocol === "groot2" && p !== "groot2") return false;
  }
  if (selectedTreeFilter === "ACTIVE" && tree) {
    const matchesId = ev.tree_id && ev.tree_id === tree.tree_id;
    const noTreeSpecified = !ev.tree_id && !ev.tree_name;
    if (!matchesId && !noTreeSpecified) return false;
  }
  if (statusFilter !== "ALL" && ev.status !== statusFilter) {
    return false;
  }
  if (filterQuery) {
    const matchesName = ev.node_name?.toLowerCase().includes(filterQuery);
    const matchesId = ev.node_id?.toLowerCase().includes(filterQuery);
    const matchesTree =
      ev.tree_name?.toLowerCase().includes(filterQuery) ||
      ev.tree_id?.toLowerCase().includes(filterQuery);
    const matchesStatus = ev.status?.toLowerCase().includes(filterQuery);
    return Boolean(matchesName || matchesId || matchesTree || matchesStatus);
  }
  return true;
};

export const getBoundedFilteredEvents = (
  events: TransitionEvent[],
  activeProtocol: "btick" | "groot2" | "nav2",
  selectedTreeFilter: "ALL" | "ACTIVE",
  tree: BTTreeModel | null,
  statusFilter: string,
  filterText: string,
  maxLogs = 1000,
  isReplaying = false,
): { displayedEvents: TransitionEvent[]; totalFilteredCount: number } => {
  if (!events || events.length === 0) {
    return { displayedEvents: [], totalFilteredCount: 0 };
  }

  const query = filterText.trim().toLowerCase();

  // If the total events array is already small, collect all matching events in 1 pass
  if (events.length <= maxLogs) {
    const matching: TransitionEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (
        matchesEventFilter(
          ev,
          activeProtocol,
          selectedTreeFilter,
          tree,
          statusFilter,
          query,
        )
      ) {
        matching.push(ev);
      }
    }
    // In Live Monitoring (events stored newest-first), reverse so table displays chronologically (oldest at top, newest at bottom)
    const displayedEvents = isReplaying ? matching : matching.reverse();
    return {
      displayedEvents,
      totalFilteredCount: matching.length,
    };
  }

  // Large dataset (e.g. 2,500 to 50,000 events):
  const collected: TransitionEvent[] = [];
  let totalFilteredCount = 0;

  if (isReplaying) {
    // Replay: events are oldest-first (0 = oldest, N-1 = newest).
    // Latest events are at the end (scan N-1 down to 0).
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (
        matchesEventFilter(
          ev,
          activeProtocol,
          selectedTreeFilter,
          tree,
          statusFilter,
          query,
        )
      ) {
        totalFilteredCount++;
        if (collected.length < maxLogs) {
          collected.push(ev);
        }
      }
    }
  } else {
    // Live Monitoring: events are newest-first (0 = newest, N-1 = oldest).
    // Latest events are at the beginning (scan 0 to N-1).
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (
        matchesEventFilter(
          ev,
          activeProtocol,
          selectedTreeFilter,
          tree,
          statusFilter,
          query,
        )
      ) {
        totalFilteredCount++;
        if (collected.length < maxLogs) {
          collected.push(ev);
        }
      }
    }
  }

  // In both cases, collected contains the latest maxLogs events (newest first).
  // Reversing places them in chronological order [oldest (e.g. 9001) -> newest (e.g. 10000)]
  // so the newest event is at the bottom where autoscroll is positioned.
  const displayedEvents = collected.reverse();

  return {
    displayedEvents,
    totalFilteredCount,
  };
};

export const BottomPanel: React.FC<BottomPanelProps> = ({
  events,
  tree,
  trees = [],
  isReplaying = false,
  onSelectNode,
  onClearEvents,
  isPaused,
  onTogglePause,
  activeProtocol = "btick",
  onToggleBreakpoint,
  onClearFault,
  onClearAllBreakpoints,
  onClearAllFaults,
}) => {
  const isNav2 = activeProtocol === "nav2";
  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "events" | "breakpoints" | "faults"
  >("events");
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(200);

  useEffect(() => {
    if (isNav2 && activeTab !== "events") {
      setActiveTab("events");
    }
  }, [isNav2, activeTab]);
  const [panelHeight, setPanelHeight] = useState<number>(() => {
    try {
      const saved =
        localStorage.getItem("btick_panel_height") ||
        localStorage.getItem("rtick_panel_height") ||
        localStorage.getItem("bt_monitor_panel_height");
      return saved
        ? Math.max(120, Math.min(window.innerHeight * 0.7, parseInt(saved, 10)))
        : 200;
    } catch {
      return 200;
    }
  });
  const [isResizing, setIsResizing] = useState(false);

  const logContainerRef = useRef<HTMLDivElement>(null);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const windowHeight = window.innerHeight;
      const newHeight = windowHeight - e.clientY;
      if (newHeight < 45) {
        setIsOpen(false);
      } else {
        setIsOpen(true);
        const maxLimit = Math.min(500, Math.floor(window.innerHeight * 0.55));
        const clamped = Math.max(100, Math.min(maxLimit, newHeight));
        setPanelHeight(clamped);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("btick_panel_height", String(panelHeight));
        }
      } catch (e) {}
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, panelHeight]);

  const effectiveTrees = trees.length > 0 ? trees : tree ? [tree] : [];
  const currentTreeName = tree
    ? tree.display_name || tree.tree_name || tree.tree_id
    : "No Tree Selected";

  // Collect active breakpoints (scoped to selected tree)
  const allBreakpoints = useMemo(() => {
    const list: Array<{ treeId: string; treeName: string; node: BTNodeModel }> =
      [];
    const targetTrees = tree ? [tree] : effectiveTrees;
    targetTrees.forEach((t) => {
      t.nodes.forEach((node) => {
        if (
          node.is_breakpoint &&
          node.type !== "Root" &&
          node.name !== "Root"
        ) {
          list.push({
            treeId: t.tree_id,
            treeName: t.display_name ?? t.tree_name,
            node,
          });
        }
      });
    });
    return list;
  }, [effectiveTrees, tree]);

  // Collect active fault injections (scoped to selected tree)
  const allInjections = useMemo(() => {
    const list: Array<{ treeId: string; treeName: string; node: BTNodeModel }> =
      [];
    const targetTrees = tree ? [tree] : effectiveTrees;
    targetTrees.forEach((t) => {
      t.nodes.forEach((node) => {
        if (
          node.fault_mode &&
          node.fault_mode !== "NONE" &&
          node.type !== "Root" &&
          node.name !== "Root"
        ) {
          list.push({
            treeId: t.tree_id,
            treeName: t.display_name ?? t.tree_name,
            node,
          });
        }
      });
    });
    return list;
  }, [effectiveTrees, tree]);

  const { displayedEvents, totalFilteredCount } = useMemo(
    () =>
      getBoundedFilteredEvents(
        events,
        activeProtocol,
        "ACTIVE",
        tree,
        statusFilter,
        filterText,
        MAX_RENDERED_LOGS,
        isReplaying,
      ),
    [events, activeProtocol, tree, statusFilter, filterText, isReplaying],
  );

  const { startIndex, endIndex, topSpacerHeight, bottomSpacerHeight } = useMemo(
    () =>
      getVirtualWindow(
        displayedEvents.length,
        scrollTop,
        viewportHeight,
        EVENT_LOG_ROW_HEIGHT,
        EVENT_LOG_OVERSCAN,
      ),
    [displayedEvents.length, scrollTop, viewportHeight],
  );

  const visibleRows = useMemo(
    () => displayedEvents.slice(startIndex, endIndex),
    [displayedEvents, startIndex, endIndex],
  );

  const filteredBreakpoints = useMemo(() => {
    return allBreakpoints.filter(({ treeName, node }) => {
      if (!filterText.trim()) return true;
      const q = filterText.toLowerCase();
      return (
        node.name.toLowerCase().includes(q) ||
        treeName.toLowerCase().includes(q) ||
        (node.type && node.type.toLowerCase().includes(q))
      );
    });
  }, [allBreakpoints, filterText]);

  const filteredInjections = useMemo(() => {
    return allInjections.filter(({ treeName, node }) => {
      if (!filterText.trim()) return true;
      const q = filterText.toLowerCase();
      return (
        node.name.toLowerCase().includes(q) ||
        treeName.toLowerCase().includes(q) ||
        (node.fault_mode && node.fault_mode.toLowerCase().includes(q))
      );
    });
  }, [allInjections, filterText]);

  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const {
      scrollTop: st,
      scrollHeight,
      clientHeight,
    } = logContainerRef.current;
    setScrollTop(st);
    setViewportHeight(clientHeight);
    const isAtBottom = scrollHeight - st - clientHeight < 20;
    setAutoScroll(isAtBottom);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      setViewportHeight(logContainerRef.current.clientHeight);
    }
  }, [panelHeight, isOpen, activeTab]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current && activeTab === "events") {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      setScrollTop(logContainerRef.current.scrollTop);
    }
  }, [events, autoScroll, activeTab]);

  const getStatusColor = (status?: NodeStatus) => {
    switch (status) {
      case "RUNNING":
        return "text-state-running-text bg-state-running-bg border-state-running-border";
      case "SUCCESS":
        return "text-state-success-text bg-state-success-bg border-state-success-border";
      case "FAILURE":
        return "text-state-failure-text bg-state-failure-bg border-state-failure-border";
      case "SKIPPED":
        return "text-text-muted bg-surface-secondary border-border-subtle";
      default:
        return "text-text-muted bg-surface-secondary border-border-subtle";
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const d = new Date(timestamp);
    return `${d.toLocaleTimeString()}.${d.getMilliseconds().toString().padStart(3, "0")}`;
  };

  return (
    <div
      style={{ height: isOpen ? `${panelHeight}px` : "42px" }}
      className="relative bg-surface-primary border-t border-border-subtle flex flex-col z-30 transition-[height] duration-75 select-text font-sans shrink-0"
    >
      {/* Top Edge Resizer Handle */}
      {isOpen && (
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => setPanelHeight(200)}
          className={`absolute top-0 left-0 w-full h-1 cursor-ns-resize hover:bg-accent-primary/60 transition-colors z-40 ${
            isResizing ? "bg-accent-primary" : "bg-transparent"
          }`}
          title="Drag to resize panel height (Double-click to reset)"
        />
      )}

      {/* Header Bar */}
      <div className="h-[42px] px-3 bg-surface-primary border-b border-border-subtle flex items-center justify-between shrink-0">
        {/* Left Tabs */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setActiveTab("events")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer shadow-2xs ${
              activeTab === "events"
                ? "bg-surface-secondary text-text-primary border border-border-medium font-bold"
                : "text-text-muted hover:text-text-primary hover:bg-surface-hover font-semibold border border-transparent"
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-accent-primary" />
            <span>Event Log</span>
            <span
              className={`text-[9px] px-1.5 py-0.2 rounded-md font-mono font-bold ${
                activeTab === "events"
                  ? "bg-surface-primary border border-border-subtle text-accent-primary"
                  : "bg-surface-secondary text-text-muted"
              }`}
            >
              {totalFilteredCount}
            </span>
          </button>

          {!isNav2 && (
            <>
              <button
                onClick={() => setActiveTab("breakpoints")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer shadow-2xs ${
                  activeTab === "breakpoints"
                    ? "bg-surface-secondary text-text-primary border border-border-medium font-bold"
                    : "text-text-muted hover:text-text-primary hover:bg-surface-hover font-semibold border border-transparent"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${allBreakpoints.length > 0 ? "bg-rose-500 animate-pulse" : "bg-border-strong"}`}
                />
                <span>Breakpoints</span>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded-md font-mono font-bold ${
                    activeTab === "breakpoints"
                      ? "bg-surface-primary border border-border-subtle text-state-bp-text"
                      : allBreakpoints.length > 0
                        ? "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300"
                        : "bg-surface-secondary text-text-muted"
                  }`}
                >
                  {allBreakpoints.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab("faults")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all cursor-pointer shadow-2xs ${
                  activeTab === "faults"
                    ? "bg-surface-secondary text-text-primary border border-border-medium font-bold"
                    : "text-text-muted hover:text-text-primary hover:bg-surface-hover font-semibold border border-transparent"
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-state-fault-text" />
                <span>Fault Injections</span>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded-md font-mono font-bold ${
                    activeTab === "faults"
                      ? "bg-surface-primary border border-border-subtle text-state-fault-text"
                      : allInjections.length > 0
                        ? "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300"
                        : "bg-surface-secondary text-text-muted"
                  }`}
                >
                  {allInjections.length}
                </span>
              </button>
            </>
          )}
        </div>

        {/* Right Tools & Collapse */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* TAB 1 Tools */}
          {activeTab === "events" && (
            <>
              <div
                className="flex items-center gap-1.5  text-text-primary font-semibold  rounded-lg px-2.5 py-1 text-xs shadow-2xs max-w-[200px] truncate select-text"
                title={`Active Behavior Tree: ${currentTreeName}`}
              >
                <span className="text-text-muted font-medium shrink-0">
                  Tree:
                </span>
                <span className="truncate">{currentTreeName}</span>
              </div>

              <div className="flex items-center bg-surface-secondary px-2.5 py-1 rounded-lg border border-border-subtle focus-within:border-border-focus focus-within:ring-2 focus-within:ring-accent-primary/20 shadow-2xs shrink-0">
                <Search className="w-3 h-3 text-text-muted mr-1.5" />
                <input
                  type="text"
                  placeholder="Filter events..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-28 font-sans"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-surface-secondary text-text-secondary font-medium border border-border-medium rounded-lg px-2.5 py-1 text-xs outline-none cursor-pointer shadow-2xs hover:border-border-strong transition-all shrink-0"
              >
                <option value="ALL">All Statuses</option>
                <option value="RUNNING">RUNNING</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="FAILURE">FAILURE</option>
                <option value="SKIPPED">SKIPPED</option>
              </select>

              {/* Autoscroll Toggle */}
              <button
                onClick={() => {
                  const next = !autoScroll;
                  setAutoScroll(next);
                  if (next && logContainerRef.current) {
                    logContainerRef.current.scrollTop =
                      logContainerRef.current.scrollHeight;
                  }
                }}
                className={`px-3 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0 ${
                  autoScroll
                    ? "bg-accent-primary border-accent-primary font-bold shadow-xs text-white"
                    : "bg-surface-secondary text-text-primary dark:text-white border-border-subtle hover:bg-surface-hover"
                }`}
                title={
                  autoScroll
                    ? "AutoScroll is ON (Click to freeze view)"
                    : "AutoScroll is OFF (Click to resume auto-scroll)"
                }
              >
                <span
                  className={
                    autoScroll
                      ? "text-white"
                      : "text-text-primary dark:text-white"
                  }
                >
                  {autoScroll ? "AutoScroll: ON" : "AutoScroll: OFF"}
                </span>
              </button>

              {/* <button
                onClick={onTogglePause}
                className={`flex items-center gap-1 px-3 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0 ${
                  isPaused
                    ? 'bg-state-paused-bg text-state-paused-text border-state-paused-border font-bold animate-pulse'
                    : 'bg-surface-secondary text-text-muted border-border-subtle hover:text-text-primary'
                }`}
                title={isPaused ? 'Resume live updates' : 'Pause live stream'}
              >
                {isPaused ? <Play className="w-3 h-3 text-state-paused-text" /> : <Pause className="w-3 h-3" />}
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button> */}

              <button
                onClick={onClearEvents}
                className="p-1.5 rounded-lg hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950 dark:hover:text-rose-300 text-text-muted transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
                title="Clear log stream"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {/* TAB 2 Tools (Breakpoints) */}
          {!isNav2 && activeTab === "breakpoints" && (
            <>
              <div className="flex items-center bg-surface-secondary px-2.5 py-1 rounded-lg border border-border-subtle focus-within:border-border-focus focus-within:ring-2 focus-within:ring-accent-primary/20 shadow-2xs shrink-0">
                <Search className="w-3 h-3 text-text-muted mr-1.5" />
                <input
                  type="text"
                  placeholder="Filter breakpoints..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-32 font-sans"
                />
              </div>
              {allBreakpoints.length > 0 && onClearAllBreakpoints && (
                <button
                  onClick={() => onClearAllBreakpoints(tree?.tree_id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white dark:bg-rose-950 dark:hover:bg-rose-600 dark:text-rose-300 border border-rose-300 dark:border-rose-700 font-semibold text-xs transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
                  title="Remove all active breakpoints"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear All</span>
                </button>
              )}
            </>
          )}

          {/* TAB 3 Tools (Fault Injections) */}
          {!isNav2 && activeTab === "faults" && (
            <>
              <div className="flex items-center bg-surface-secondary px-2.5 py-1 rounded-lg border border-border-subtle focus-within:border-border-focus focus-within:ring-2 focus-within:ring-accent-primary/20 shadow-2xs shrink-0">
                <Search className="w-3 h-3 text-text-muted mr-1.5" />
                <input
                  type="text"
                  placeholder="Filter faults..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-32 font-sans"
                />
              </div>
              {allInjections.length > 0 && onClearAllFaults && (
                <button
                  onClick={() => onClearAllFaults(tree?.tree_id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white dark:bg-rose-950 dark:hover:bg-rose-600 dark:text-rose-300 border border-rose-300 dark:border-rose-700 font-semibold text-xs transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
                  title="Clear all active fault overrides"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset All</span>
                </button>
              )}
            </>
          )}

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer ml-1 shadow-2xs active:scale-95 shrink-0"
            title={isOpen ? "Collapse Panel" : "Expand Panel"}
          >
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main Panel Content */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto font-mono text-[11px] bg-surface-primary">
          {/* TAB 1: Event Log Table */}
          {(isNav2 || activeTab === "events") && (
            <div
              ref={logContainerRef}
              onScroll={handleScroll}
              className="w-full h-full overflow-y-auto"
            >
              <table className="w-full text-left border-collapse">
                <thead className="bg-surface-secondary text-text-muted sticky top-0 z-10 border-b border-border-subtle text-[9px] font-semibold uppercase tracking-wider font-mono">
                  <tr>
                    <th className="py-2 px-3">Time</th>
                    <th className="py-2 px-3">Tree</th>
                    <th className="py-2 px-3">Node Name</th>
                    <th className="py-2 px-3">Status Transition</th>
                    <th className="py-2 px-3 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle text-xs">
                  {displayedEvents.length > 0 ? (
                    <>
                      {topSpacerHeight > 0 && (
                        <tr
                          style={{ height: `${topSpacerHeight}px` }}
                          aria-hidden="true"
                        >
                          <td colSpan={5} style={{ padding: 0, border: 0 }} />
                        </tr>
                      )}
                      {visibleRows.map((ev, i) => {
                        const actualIndex = startIndex + i;
                        return (
                          <tr
                            key={actualIndex}
                            onClick={() => onSelectNode(ev.node_id, ev.tree_id)}
                            className="hover:bg-surface-hover cursor-pointer transition-colors"
                            style={{ height: `${EVENT_LOG_ROW_HEIGHT}px` }}
                          >
                            <td className="py-1.5 px-3 text-text-muted font-mono text-[10px] shrink-0 whitespace-nowrap">
                              {formatTimestamp(ev.timestamp)}
                            </td>
                            <td
                              className="py-1.5 px-3 font-semibold text-text-primary max-w-[140px] truncate"
                              title={
                                trees.find((t) => t.tree_id === ev.tree_id)
                                  ?.display_name ||
                                ev.tree_name ||
                                ev.tree_id ||
                                "Main"
                              }
                            >
                              {trees.find((t) => t.tree_id === ev.tree_id)
                                ?.display_name ||
                                ev.tree_name ||
                                ev.tree_id ||
                                "Main"}
                            </td>
                            <td
                              className="py-1.5 px-3 font-semibold text-text-primary font-sans max-w-[220px] truncate"
                              title={ev.node_name || ev.node_id}
                            >
                              {ev.node_name || ev.node_id}
                            </td>
                            <td className="py-1.5 px-3 shrink-0 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {ev.prev_status && (
                                  <>
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase border font-mono ${getStatusColor(ev.prev_status)}`}
                                    >
                                      {ev.prev_status}
                                    </span>
                                    <span className="text-text-muted">→</span>
                                  </>
                                )}
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase border font-mono ${getStatusColor(ev.status)}`}
                                >
                                  {ev.status}
                                </span>
                              </div>
                            </td>
                            <td className="py-1.5 px-3 text-right text-text-muted font-mono text-[10px] shrink-0 whitespace-nowrap">
                              {ev.duration !== undefined && ev.duration > 0
                                ? `${ev.duration.toFixed(1)} ms`
                                : "-"}
                            </td>
                          </tr>
                        );
                      })}
                      {bottomSpacerHeight > 0 && (
                        <tr
                          style={{ height: `${bottomSpacerHeight}px` }}
                          aria-hidden="true"
                        >
                          <td colSpan={5} style={{ padding: 0, border: 0 }} />
                        </tr>
                      )}
                    </>
                  ) : (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-8 text-center text-text-muted italic font-sans text-xs"
                      >
                        No events logged yet. Connect to a Behavior Tree to
                        start monitoring.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: Breakpoints List Table */}
          {!isNav2 && activeTab === "breakpoints" && (
            <div className="w-full h-full overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-surface-secondary text-text-muted sticky top-0 z-10 border-b border-border-subtle text-[9px] font-semibold uppercase tracking-wider font-mono">
                  <tr>
                    <th className="py-2 px-3 w-8"></th>
                    <th className="py-2 px-3">Node Name</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Tree</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3 text-right w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle text-xs">
                  {filteredBreakpoints.length > 0 ? (
                    filteredBreakpoints.map(({ treeId, treeName, node }) => (
                      <tr
                        key={`${treeId}_${node.id}`}
                        onClick={() => onSelectNode(node.id, treeId)}
                        className="hover:bg-surface-hover cursor-pointer transition-colors"
                      >
                        <td className="py-1.5 px-3">
                          <Circle
                            className={`w-2.5 h-2.5 text-rose-500 fill-rose-500 ${node.is_paused || node.status === "PAUSED_AT_BREAKPOINT" ? "bt-breakpoint-pulse" : ""}`}
                          />
                        </td>
                        <td
                          className="py-1.5 px-3 font-semibold text-text-primary font-sans max-w-[200px] truncate"
                          title={node.name}
                        >
                          {node.name}
                        </td>
                        <td
                          className="py-1.5 px-3 text-text-muted font-mono text-[10px] max-w-[120px] truncate"
                          title={node.type || node.category}
                        >
                          {node.type || node.category}
                        </td>
                        <td
                          className="py-1.5 px-3 text-text-primary font-semibold max-w-[120px] truncate"
                          title={treeName}
                        >
                          {treeName}
                        </td>
                        <td className="py-1.5 px-3 shrink-0 whitespace-nowrap">
                          {node.is_paused ||
                          node.status === "PAUSED_AT_BREAKPOINT" ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-paused-bg text-state-paused-text border border-state-paused-border font-mono shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-state-paused-border bt-pause-pulse shrink-0" />
                              <span>PAUSED AT BP</span>
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold uppercase border font-mono ${getStatusColor(node.status)}`}
                              >
                                {node.status}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[9px] font-mono border ${
                                  node.breakpoint_once
                                    ? "bg-state-running-bg text-state-running-text border-state-running-border font-bold"
                                    : "bg-surface-secondary text-text-muted border-border-subtle"
                                }`}
                              >
                                {node.breakpoint_once ? "1x Once" : "Permanent"}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right shrink-0 whitespace-nowrap">
                          <div
                            className="flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {node.uid && onToggleBreakpoint && (
                              <button
                                type="button"
                                onClick={() =>
                                  onToggleBreakpoint(treeId, node.uid)
                                }
                                className="p-1.5 rounded-lg bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white dark:bg-rose-950 dark:hover:bg-rose-600 dark:text-rose-300 border border-rose-300 dark:border-rose-700 transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
                                title="Remove Breakpoint"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-8 text-center text-text-muted italic font-sans text-xs"
                      >
                        No active breakpoints. Right-click any node in the graph
                        or press{" "}
                        <kbd className="font-mono font-semibold bg-surface-secondary px-1.5 py-0.5 rounded-md border border-border-subtle text-accent-primary">
                          F9
                        </kbd>{" "}
                        to set a breakpoint.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: Fault Injections List Table */}
          {!isNav2 && activeTab === "faults" && (
            <div className="w-full h-full overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-surface-secondary text-text-muted sticky top-0 z-10 border-b border-border-subtle text-[9px] font-semibold uppercase tracking-wider font-mono">
                  <tr>
                    <th className="py-2 px-3 w-8"></th>
                    <th className="py-2 px-3">Node Name</th>
                    <th className="py-2 px-3">Category / Type</th>
                    <th className="py-2 px-3">Tree</th>
                    <th className="py-2 px-3">Fault Override</th>
                    <th className="py-2 px-3">Delay</th>
                    <th className="py-2 px-3 text-right w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle text-xs">
                  {filteredInjections.length > 0 ? (
                    filteredInjections.map(({ treeId, treeName, node }) => (
                      <tr
                        key={`${treeId}_${node.id}`}
                        onClick={() => onSelectNode(node.id, treeId)}
                        className="hover:bg-surface-hover cursor-pointer transition-colors"
                      >
                        <td className="py-1.5 px-3">
                          <Zap className="w-3.5 h-3.5 text-state-fault-text" />
                        </td>
                        <td
                          className="py-1.5 px-3 font-semibold text-text-primary font-sans max-w-[200px] truncate"
                          title={node.name}
                        >
                          {node.name}
                        </td>
                        <td
                          className="py-1.5 px-3 text-text-muted font-mono text-[10px] max-w-[120px] truncate"
                          title={node.type || node.category}
                        >
                          {node.type || node.category}
                        </td>
                        <td
                          className="py-1.5 px-3 text-text-primary font-semibold max-w-[120px] truncate"
                          title={treeName}
                        >
                          {treeName}
                        </td>
                        <td className="py-1.5 px-3 shrink-0 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                            {node.fault_mode === "FORCE_SUCCESS" && (
                              <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-success-bg text-state-success-text border border-state-success-border font-mono shrink-0">
                                FORCE SUCCESS
                              </span>
                            )}
                            {node.fault_mode === "FORCE_FAILURE" && (
                              <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-failure-bg text-state-failure-text border border-state-failure-border font-mono shrink-0">
                                FORCE FAILURE
                              </span>
                            )}
                            {node.fault_mode === "FORCE_RUNNING" && (
                              <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-running-bg text-state-running-text border border-state-running-border font-mono shrink-0">
                                BLOCK TICK
                              </span>
                            )}
                            {node.fault_mode === "FORCE_SKIPPED" && (
                              <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-surface-secondary text-text-muted border border-border-subtle font-mono shrink-0">
                                FORCE SKIPPED
                              </span>
                            )}
                            {node.fault_mode === "DELAY" && (
                              <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-fault-bg text-state-fault-text border border-state-fault-border font-mono shrink-0">
                                DELAY OVERRIDE
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded-md text-[9px] font-mono border shrink-0 ${
                                node.fault_once
                                  ? "bg-state-running-bg text-state-running-text border-state-running-border font-bold"
                                  : "bg-surface-secondary text-text-muted border-border-subtle"
                              }`}
                            >
                              {node.fault_once ? "1x Once" : "Permanent"}
                            </span>
                          </div>
                        </td>
                        <td className="py-1.5 px-3 font-mono text-text-muted text-[10px] shrink-0 whitespace-nowrap">
                          {node.fault_delay_ms
                            ? `${node.fault_delay_ms} ms`
                            : "-"}
                        </td>
                        <td className="py-1.5 px-3 text-right shrink-0 whitespace-nowrap">
                          <div
                            className="flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {node.uid && onClearFault && (
                              <button
                                type="button"
                                onClick={() => onClearFault(treeId, node.uid)}
                                className="p-1.5 rounded-lg bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white dark:bg-rose-950 dark:hover:bg-rose-600 dark:text-rose-300 border border-rose-300 dark:border-rose-700 transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
                                title="Reset / Clear Fault"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-8 text-center text-text-muted italic font-sans text-xs"
                      >
                        No active fault injections. Right-click any node in the
                        graph to inject a fault.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
