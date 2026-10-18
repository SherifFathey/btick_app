import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  CheckSquare,
  Square,
  Layers,
  Grid,
  Search,
  Circle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Zap,
  RotateCcw,
  Trash2,
  FolderTree,
  X,
  Wifi,
  WifiOff,
  Activity,
  FileEdit,
  BookOpen,
} from "lucide-react";
import { OfficialGithubIcon } from "./OfficialGithubIcon";
import treeLogo from "../../assets/tree.png";
import groot2Logo from "../../assets/groot2.png";
import nav2Logo from "../../assets/nav2.png";
import {
  BTTreeModel,
  BTNodeModel,
  ViewMode,
  StatusFilterOptions,
} from "../../monitor/types/bt";
import { ProtocolConnectionStatus } from "../../monitor/protocols/types";
import { BTEditorPalette } from "../../editor/components/BTEditorPalette";
import {
  BTEditorNodeCategory,
  BTNodeModelDefinition,
} from "../../editor/types";
import { AppMode } from "../types";
import { ProtocolSelector } from "./ProtocolSelector";

interface SidebarProps {
  appMode?: AppMode;
  onModeChange?: (mode: AppMode) => void;
  isConnected: boolean;
  connectionStatus?: ProtocolConnectionStatus;
  protocolStatuses?: Record<
    "btick" | "groot2" | "nav2",
    ProtocolConnectionStatus
  >;
  activeProtocol?: "btick" | "groot2" | "nav2";
  trees: BTTreeModel[];
  selectedTreeId: string | null;
  onSelectTree: (treeId: string) => void;
  onToggleTreeVisibility: (treeId: string) => void;
  onCloseTree?: (treeId: string) => void;
  onSelectAllTrees?: (visible: boolean) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  filters: StatusFilterOptions;
  onFiltersChange: (filters: StatusFilterOptions) => void;
  onToggleBreakpoint?: (treeId: string, uid: number) => void;
  onClearFault?: (treeId: string, uid: number) => void;
  onClearAllBreakpoints?: (treeId?: string) => void;
  onClearAllFaults?: (treeId?: string) => void;
  onSelectNode?: (treeId: string, nodeId: string) => void;
  onOpenNav2Prompt?: () => void;
  onSwitchSource?: (
    source: "btick" | "groot2" | "nav2",
    host?: string,
    port?: number,
    topic?: string,
  ) => void;
  onDisconnect?: () => void;
  editorCustomNodeModels?: Record<string, BTNodeModelDefinition>;
  editorAvailableSubtrees?: string[];
  editorSelectedNodeId?: string | null;
  onEditorAddNode?: (
    nodeType: string,
    parentId?: string | null,
    targetTreeId?: string,
  ) => void;
  onEditorRegisterCustomNode?: (
    type: string,
    category: BTEditorNodeCategory,
  ) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  appMode = "monitor",
  onModeChange,
  isConnected = false,
  connectionStatus = "DISCONNECTED",
  protocolStatuses,
  activeProtocol = "btick",
  trees,
  selectedTreeId,
  onSelectTree,
  onToggleTreeVisibility,
  onCloseTree,
  onSelectAllTrees,
  viewMode,
  onViewModeChange,
  filters,
  onFiltersChange,
  onToggleBreakpoint,
  onClearFault,
  onClearAllBreakpoints,
  onClearAllFaults,
  onSelectNode,
  onOpenNav2Prompt,
  onSwitchSource,
  onDisconnect,
  editorCustomNodeModels,
  editorAvailableSubtrees,
  editorSelectedNodeId,
  onEditorAddNode,
  onEditorRegisterCustomNode,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "trees" | "breakpoints" | "faults"
  >("trees");
  const [treeSearchText, setTreeSearchText] = useState("");
  const [breakpointSearchText, setBreakpointSearchText] = useState("");
  const [faultSearchText, setFaultSearchText] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem("bt_sidebar_width");
        return saved ? Math.max(200, Math.min(650, parseInt(saved, 10))) : 288;
      }
    } catch (e) {}
    return 288;
  });
  const [isResizing, setIsResizing] = useState(false);

  const isNav2 = activeProtocol === "nav2";
  // If disconnected or no tree is loaded (except for Nav2 which is topic-based), status is Disconnected
  // RECONNECTING state is suppressed and treated as Disconnected
  const isOnline = Boolean(
    isConnected &&
    (isNav2 || trees.length > 0) &&
    connectionStatus !== "DISCONNECTED" &&
    connectionStatus !== "RECONNECTING",
  );
  const isRunning = isOnline && connectionStatus === "CONNECTED_RUNNING";
  const protocolName =
    activeProtocol === "btick"
      ? "BTick"
      : activeProtocol === "groot2"
        ? "Groot2"
        : "Nav2";

  useEffect(() => {
    if (isNav2 && activeTab !== "trees") {
      setActiveTab("trees");
    }
  }, [isNav2, activeTab]);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientX < 130) {
        setIsCollapsed(true);
      } else {
        setIsCollapsed(false);
        const maxLimit = Math.min(320, Math.floor(window.innerWidth * 0.25));
        const newWidth = Math.max(180, Math.min(maxLimit, e.clientX));
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("bt_sidebar_width", String(sidebarWidth));
        }
      } catch (e) {}
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, sidebarWidth]);

  // Collect all active breakpoints across all trees
  const allBreakpoints = useMemo(() => {
    const list: Array<{ treeId: string; treeName: string; node: BTNodeModel }> =
      [];
    trees.forEach((tree) => {
      tree.nodes.forEach((node) => {
        if (
          node.is_breakpoint &&
          node.type !== "Root" &&
          node.name !== "Root"
        ) {
          list.push({
            treeId: tree.tree_id,
            treeName: tree.display_name ?? tree.tree_name,
            node,
          });
        }
      });
    });
    return list;
  }, [trees]);

  // Collect all active fault injections across all trees
  const allInjections = useMemo(() => {
    const list: Array<{ treeId: string; treeName: string; node: BTNodeModel }> =
      [];
    trees.forEach((tree) => {
      tree.nodes.forEach((node) => {
        if (
          node.fault_mode &&
          node.fault_mode !== "NONE" &&
          node.type !== "Root" &&
          node.name !== "Root"
        ) {
          list.push({
            treeId: tree.tree_id,
            treeName: tree.display_name ?? tree.tree_name,
            node,
          });
        }
      });
    });
    return list;
  }, [trees]);

  // Filtered lists: only show trees connecting with currently selected protocol
  const filteredTrees = trees.filter((t) => {
    const p = (t as any).source || (t as any).protocol;
    if (p) {
      if (activeProtocol === "btick" && p !== "btick") return false;
      if (activeProtocol === "nav2" && p !== "nav2") return false;
      if (activeProtocol === "groot2" && p !== "groot2") return false;
    } else {
      if (activeProtocol !== "btick") return false;
    }
    return (
      (t.display_name || t.tree_name)
        .toLowerCase()
        .includes(treeSearchText.toLowerCase()) ||
      t.tree_name.toLowerCase().includes(treeSearchText.toLowerCase()) ||
      t.tree_id.toLowerCase().includes(treeSearchText.toLowerCase())
    );
  });

  const filteredBreakpoints = allBreakpoints.filter(({ treeName, node }) => {
    return (
      node.name.toLowerCase().includes(breakpointSearchText.toLowerCase()) ||
      treeName.toLowerCase().includes(breakpointSearchText.toLowerCase()) ||
      (node.type &&
        node.type.toLowerCase().includes(breakpointSearchText.toLowerCase()))
    );
  });

  const filteredInjections = allInjections.filter(({ treeName, node }) => {
    return (
      node.name.toLowerCase().includes(faultSearchText.toLowerCase()) ||
      treeName.toLowerCase().includes(faultSearchText.toLowerCase()) ||
      (node.fault_mode &&
        node.fault_mode.toLowerCase().includes(faultSearchText.toLowerCase()))
    );
  });

  const getTreeStatus = (tree: BTTreeModel): string => {
    if (tree.status === "STOPPED" || tree.status === "DESTROYED")
      return tree.status;
    const hasRunningNode = tree.nodes.some(
      (n) => n.type !== "Root" && n.name !== "Root" && n.status === "RUNNING",
    );
    if (hasRunningNode) return "RUNNING";
    const mainNode = tree.nodes.find(
      (n) =>
        n.type !== "Root" &&
        (n.parent_id === "" || n.parent_id.startsWith("Root") || n.uid === 1),
    );
    if (
      mainNode &&
      (mainNode.status === "SUCCESS" || mainNode.status === "FAILURE")
    ) {
      return mainNode.status;
    }
    return tree.status === "RUNNING" ? "IDLE" : tree.status || "IDLE";
  };

  const getTreeStatusDot = (tree: BTTreeModel) => {
    const status = getTreeStatus(tree);
    if (status === "STOPPED" || status === "DESTROYED") {
      return (
        <Circle className="w-2 h-2 text-text-muted fill-text-muted shrink-0" />
      );
    }
    if (status === "RUNNING") {
      return (
        <Circle className="w-2 h-2 text-state-running-border fill-state-running-border animate-pulse shrink-0" />
      );
    }
    if (status === "SUCCESS") {
      return (
        <Circle className="w-2 h-2 text-state-success-border fill-state-success-border shrink-0" />
      );
    }
    if (status === "FAILURE") {
      return (
        <Circle className="w-2 h-2 text-state-failure-border fill-state-failure-border shrink-0" />
      );
    }
    return (
      <Circle className="w-2 h-2 text-accent-primary fill-accent-primary shrink-0" />
    );
  };

  if (isCollapsed) {
    return (
      <aside className="relative w-12 h-full bg-surface-primary border-r border-border-subtle flex flex-col z-20 shrink-0 select-text font-sans">
        {/* Right Edge Drag Handle */}
        <div
          onMouseDown={startResizing}
          className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize hover:bg-accent-primary/60 transition-colors z-30"
          title="Drag right to expand sidebar"
        />

        {/* Top Bar: Expand Sidebar (h-[44px]) */}
        <div className="h-[44px] flex items-center justify-center border-b border-border-subtle bg-surface-primary shrink-0">
          <button
            onClick={() => setIsCollapsed(false)}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border-subtle transition-all cursor-pointer shadow-2xs hover:border-border-strong active:scale-95"
            title="Expand Sidebar"
          >
            <ChevronRight className="w-3.5 h-3.5 text-accent-primary" />
          </button>
        </div>

        {/* Collapsed Mode Switcher */}
        <div className="flex flex-col items-center gap-1.5 py-2 border-b border-border-subtle bg-surface-primary shrink-0">
          <button
            onClick={() => onModeChange?.("monitor")}
            className={`p-1.5 rounded-lg transition-all cursor-pointer shadow-2xs ${
              appMode === "monitor"
                ? "bg-accent-primary text-white font-bold"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            title="Monitor"
          >
            <Activity className="w-4 h-4" />
          </button>
          <button
            onClick={() => onModeChange?.("editor")}
            className={`p-1.5 rounded-lg transition-all cursor-pointer shadow-2xs ${
              appMode === "editor"
                ? "bg-accent-primary text-white font-bold"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            title="Visual BehaviorTree XML Editor"
          >
            <FileEdit className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 py-3">
          {appMode === "monitor" ? (
            <>
              {isRunning ? (
                <span title={`${protocolName}: Running`}>
                  <Wifi className="w-4 h-4 text-accent-primary dark:text-white animate-pulse shrink-0" />
                </span>
              ) : isOnline ? (
                <span title={`${protocolName}: Online`}>
                  <Wifi className="w-4 h-4 text-accent-primary dark:text-white shrink-0" />
                </span>
              ) : (
                <span title={`${protocolName}: Disconnected`}>
                  <WifiOff className="w-4 h-4 text-text-muted shrink-0" />
                </span>
              )}
              {activeProtocol === "btick" ? (
                <img
                  src={treeLogo}
                  alt="BTick"
                  className="w-4 h-4 object-contain opacity-90 shrink-0 dark:brightness-0 dark:invert dark:opacity-100"
                  title="BTick"
                />
              ) : activeProtocol === "groot2" ? (
                <img
                  src={groot2Logo}
                  alt="Groot2"
                  className="w-4 h-4 object-contain shrink-0"
                  title="Groot2"
                />
              ) : (
                <img
                  src={nav2Logo}
                  alt="Nav2"
                  className="w-4 h-4 object-contain shrink-0"
                  title="Nav2"
                />
              )}
              <Layers className="w-4 h-4 text-accent-primary" />
            </>
          ) : (
            <>
              <span title="Node Library (Expand to view)">
                <BookOpen className="w-4 h-4 text-accent-primary" />
              </span>
              <span title="Editor Tools">
                <Layers className="w-4 h-4 text-text-muted" />
              </span>
            </>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside
      style={{ width: `${sidebarWidth}px` }}
      className="relative h-full bg-surface-primary border-r border-border-subtle flex flex-col z-20 select-text shrink-0 text-text-primary font-sans"
    >
      {/* Right Edge Resizer Handle */}
      <div
        onMouseDown={startResizing}
        onDoubleClick={() => setSidebarWidth(288)}
        className={`absolute top-0 right-0 w-1.5 h-full cursor-ew-resize hover:bg-accent-primary/60 transition-colors z-30 ${
          isResizing ? "bg-accent-primary" : "bg-transparent"
        }`}
        title="Drag to resize sidebar width (Double-click to reset)"
      />

      {/* Top Header Row (h-[44px]): Mode Switcher + Collapse Button Icon */}
      <div className="h-[44px] px-2 border-b border-border-subtle bg-surface-primary flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex-1 min-w-0 flex items-center bg-surface-secondary p-0.5 rounded-xl border border-border-medium text-xs font-semibold whitespace-nowrap shadow-2xs">
          <button
            onClick={() => onModeChange?.("monitor")}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
              appMode === "monitor"
                ? "bg-accent-primary text-white font-bold shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            title="Monitor & Debugging"
          >
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Monitor</span>
          </button>
          <button
            onClick={() => onModeChange?.("editor")}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
              appMode === "editor"
                ? "bg-accent-primary text-white font-bold shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            title="Visual BehaviorTree XML Editor"
          >
            <FileEdit className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">XML Editor</span>
          </button>
        </div>

        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-all cursor-pointer shadow-2xs hover:border-border-strong active:scale-95 border border-border-subtle shrink-0"
          title="Collapse Sidebar"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {appMode === "editor" ? (
        /* Editor Sidebar Content */
        <BTEditorPalette
          embedded={true}
          appMode={appMode}
          onModeChange={onModeChange}
          customNodeModels={editorCustomNodeModels}
          availableSubtrees={editorAvailableSubtrees}
          selectedNodeId={editorSelectedNodeId}
          onAddNode={(type, parentId) => onEditorAddNode?.(type, parentId)}
          onRegisterCustomNode={onEditorRegisterCustomNode}
        />
      ) : (
        /* Monitor Sidebar Content */
        <>
          {/* Connection & Protocol Status Strip */}
          <div className="p-2 border-b border-border-subtle bg-surface-primary text-xs shrink-0">
            <ProtocolSelector
              activeProtocol={activeProtocol}
              isConnected={isConnected}
              connectionStatus={connectionStatus}
              protocolStatuses={protocolStatuses}
              treesCount={trees.length}
              onSwitchSource={onSwitchSource}
              onOpenNav2Prompt={onOpenNav2Prompt}
              className="w-full"
            />
          </div>

          {/* View Mode Toggle Strip */}
          <div className="p-2 border-b border-border-subtle bg-surface-primary flex items-center text-xs">
            <div className="w-full min-w-0 flex items-center">
              <button
                onClick={() => onViewModeChange("focused")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === "focused"
                    ? "bg-surface-hover text-text-primary font-bold shadow-xs"
                    : "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                }`}
                title="Single-tree Focused View"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Focused</span>
              </button>
              <button
                onClick={() => onViewModeChange("grid")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === "grid"
                    ? "bg-surface-hover text-text-primary font-bold shadow-xs"
                    : "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover"
                }`}
                title="Multi-Tree View"
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Multi-Tree</span>
              </button>
            </div>
          </div>

          {/* Sidebar Navigation Tabs (Trees, Breakpoints, Fault Injections) */}
          {!isNav2 && (
            <div className="p-2 border-b border-border-subtle bg-surface-primary flex items-center text-[11px] font-medium">
              <div className="w-full flex items-center ">
                <button
                  onClick={() => setActiveTab("trees")}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-1.5 px-1 rounded-lg transition-all cursor-pointer ${
                    activeTab === "trees"
                      ? "bg-surface-hover text-text-primary border border-border-medium font-bold shadow-2xs"
                      : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  }`}
                  title="Behavior Trees List"
                >
                  <FolderTree className="w-3.5 h-3.5" />
                  <span className="truncate">Trees</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded-md font-mono font-bold ${
                      activeTab === "trees"
                        ? "bg-surface-secondary text-text-primary border border-border-subtle"
                        : "bg-surface-secondary text-text-muted border border-border-subtle"
                    }`}
                  >
                    {trees.length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab("breakpoints")}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-1.5 px-1 rounded-lg transition-all cursor-pointer ${
                    activeTab === "breakpoints"
                      ? "bg-surface-hover text-text-primary border border-border-medium font-bold shadow-2xs"
                      : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  }`}
                  title="Active Breakpoints List"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${allBreakpoints.length > 0 ? "bg-rose-500 animate-pulse" : "bg-text-muted"}`}
                  />
                  <span className="truncate">Breaks</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded-md font-mono font-bold ${
                      allBreakpoints.length > 0
                        ? "bg-surface-secondary text-text-primary border border-border-subtle"
                        : "bg-surface-secondary text-text-muted border border-border-subtle"
                    }`}
                  >
                    {allBreakpoints.length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab("faults")}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 py-1.5 px-1 rounded-lg transition-all cursor-pointer ${
                    activeTab === "faults"
                      ? "bg-surface-hover text-text-primary border border-border-medium font-bold shadow-2xs"
                      : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  }`}
                  title="Active Fault Injections List"
                >
                  <Zap className="w-3.5 h-3.5 text-state-fault-text shrink-0" />
                  <span className="truncate">Faults</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded-md font-mono font-bold ${
                      allInjections.length > 0
                        ? "bg-surface-secondary text-text-primary border border-border-subtle"
                        : "bg-surface-secondary text-text-muted border border-border-subtle"
                    }`}
                  >
                    {allInjections.length}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 1: Trees View */}
          {(isNav2 || activeTab === "trees") && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Tree Search Bar */}
              <div className="p-2 border-b border-border-subtle bg-surface-primary">
                <div className="flex items-center bg-surface-secondary px-2.5 py-1.5 rounded-lg border border-border-subtle focus-within:border-border-focus focus-within:ring-2 focus-within:ring-accent-primary/20">
                  <Search className="w-3.5 h-3.5 text-text-muted mr-1.5 shrink-0" />
                  <input
                    type="text"
                    placeholder="Search tree..."
                    value={treeSearchText}
                    onChange={(e) => setTreeSearchText(e.target.value)}
                    className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-full font-sans"
                  />
                </div>
              </div>

              {/* Active Behavior Trees List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                <div className="flex items-center justify-between text-[10px] uppercase font-mono tracking-wider text-text-secondary px-1.5 py-1 font-semibold">
                  <span>
                    {viewMode === "grid" ? "Grid Visible Trees" : "Trees List"}{" "}
                    ({filteredTrees.length})
                  </span>
                  <span className="text-[9px] text-text-muted">
                    {viewMode === "grid" ? "Check to Display" : "Active Tree"}
                  </span>
                </div>

                {filteredTrees.length === 0 ? (
                  activeProtocol === "nav2" ? (
                    <div className="p-3.5 text-center text-xs bg-accent-subtle border border-accent-border rounded-2xl m-1 space-y-2 text-text-primary shadow-xs">
                      <div className="flex items-center justify-center gap-1.5 font-bold text-text-primary">
                        <img
                          src={nav2Logo}
                          alt="Nav2"
                          className="w-4 h-4 object-contain shrink-0"
                        />
                        <span>Nav2 XML Required</span>
                      </div>
                      <p className="text-[11px] text-text-secondary leading-relaxed">
                        Nav2 streams live states on{" "}
                        <code className="font-mono text-[10px] bg-surface-primary px-1.5 py-0.5 rounded-md border border-border-medium text-accent-primary">
                          /behavior_tree_log
                        </code>
                        . Load your Nav2 XML to map and visualize nodes.
                      </p>
                      {onOpenNav2Prompt && (
                        <button
                          onClick={onOpenNav2Prompt}
                          className="w-full py-1.5 px-3 bg-accent-primary hover:bg-accent-hover text-white rounded-lg border border-accent-border text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95"
                        >
                          Load Nav2 XML
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-xs text-text-muted italic">
                      No Behavior Trees detected.
                      <div className="text-[10px] text-text-muted mt-1 not-italic font-mono">
                        Register trees in C++ using{" "}
                        <code>btick::Monitor(node, tree, name);</code>
                      </div>
                    </div>
                  )
                ) : (
                  filteredTrees.map((tree) => {
                    const isSelected = tree.tree_id === selectedTreeId;
                    const isVisible = tree.visible !== false;
                    const origin = tree.origin?.trim();

                    return (
                      <div
                        key={tree.tree_id}
                        onClick={() => onSelectTree(tree.tree_id)}
                        className={`group flex items-center justify-between px-2.5 py-2 rounded-lg cursor-pointer transition-all border ${
                          isSelected
                            ? "bg-accent-subtle border-accent-border text-text-primary font-bold shadow-2xs"
                            : "bg-surface-primary border-transparent hover:bg-surface-hover text-text-primary hover:border-border-subtle"
                        }`}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {/* Visibility Checkbox */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleTreeVisibility(tree.tree_id);
                            }}
                            className="p-1 rounded-md text-text-muted hover:text-accent-primary transition-colors cursor-pointer"
                            title={
                              isVisible
                                ? "Hide from canvas (Tree keeps running in C++)"
                                : "Show on canvas"
                            }
                          >
                            {isVisible ? (
                              <CheckSquare className="w-4 h-4 text-accent-primary" />
                            ) : (
                              <Square className="w-4 h-4 text-text-muted" />
                            )}
                          </button>

                          {/* Status Indicator Dot */}
                          {getTreeStatusDot(tree)}

                          {/* Tree Name & Node Count */}
                          <div className="overflow-hidden">
                            <div
                              className="text-xs font-semibold truncate group-hover:text-text-primary text-text-primary"
                              title={tree.display_name || tree.tree_name}
                            >
                              {tree.display_name || tree.tree_name}
                            </div>
                            {(tree.node_name || origin) && (
                              <div
                                className="text-[9px] leading-tight text-text-muted truncate font-mono"
                                title={
                                  tree.node_name
                                    ? `${tree.node_name}${tree.pid ? ` (PID: ${tree.pid})` : ""}${tree.hostname ? ` @ ${tree.hostname}` : ""}`
                                    : origin
                                }
                              >
                                {tree.node_name
                                  ? `${tree.node_name}${tree.pid ? ` (${tree.pid})` : ""}`
                                  : origin}
                              </div>
                            )}
                            <div className="text-[9px] font-mono text-text-muted truncate">
                              {tree.nodes.length} nodes
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {/* Fixed Status Badge */}
                          {(() => {
                            const statusStr = getTreeStatus(tree);
                            let badgeCls =
                              "bg-surface-secondary text-text-muted border-border-subtle";
                            if (statusStr === "RUNNING")
                              badgeCls =
                                "bg-state-running-bg text-state-running-text border-state-running-border font-bold";
                            else if (statusStr === "SUCCESS")
                              badgeCls =
                                "bg-state-success-bg text-state-success-text border-state-success-border font-bold";
                            else if (statusStr === "FAILURE")
                              badgeCls =
                                "bg-state-failure-bg text-state-failure-text border-state-failure-border font-bold";

                            return (
                              <span
                                className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-md border ${badgeCls}`}
                              >
                                {statusStr}
                              </span>
                            );
                          })()}

                          {/* Close Tree Button */}
                          {onCloseTree && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCloseTree(tree.tree_id);
                              }}
                              className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-rose-100 dark:hover:bg-rose-950 text-text-muted hover:text-rose-600 transition-all cursor-pointer"
                              title="Close tree session (discards cached states)"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Breakpoints List View */}
          {!isNav2 && activeTab === "breakpoints" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Breakpoints Header Toolbar */}
              <div className="p-2.5 border-b border-border-subtle flex items-center justify-between bg-surface-secondary">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary font-mono">
                  Breakpoints ({filteredBreakpoints.length})
                </span>
                {allBreakpoints.length > 0 && onClearAllBreakpoints && (
                  <button
                    onClick={() => onClearAllBreakpoints()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-100 dark:bg-rose-950/80 hover:bg-rose-200 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700 text-[10px] font-bold transition-all cursor-pointer shadow-2xs active:scale-95"
                    title="Remove all breakpoints across all trees"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear All</span>
                  </button>
                )}
              </div>

              {/* Search Filter */}
              <div className="p-2 border-b border-border-subtle bg-surface-primary">
                <div className="flex items-center bg-surface-secondary px-2.5 py-1.5 rounded-lg border border-border-subtle focus-within:border-border-focus focus-within:ring-2 focus-within:ring-accent-primary/20">
                  <Search className="w-3.5 h-3.5 text-text-muted mr-1.5 shrink-0" />
                  <input
                    type="text"
                    placeholder="Filter breakpoints..."
                    value={breakpointSearchText}
                    onChange={(e) => setBreakpointSearchText(e.target.value)}
                    className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-full font-sans"
                  />
                </div>
              </div>

              {/* Breakpoint Items List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {filteredBreakpoints.length === 0 ? (
                  <div className="p-4 text-center text-xs text-text-muted italic">
                    No breakpoints currently set.
                    <div className="text-[10px] text-text-secondary mt-1 not-italic font-sans">
                      Right-click any node in the graph or press{" "}
                      <kbd className="font-mono font-bold bg-surface-secondary text-text-primary px-1.5 py-0.5 rounded-md border border-border-medium">
                        F9
                      </kbd>{" "}
                      to set a breakpoint.
                    </div>
                  </div>
                ) : (
                  filteredBreakpoints.map(({ treeId, treeName, node }) => (
                    <div
                      key={`${treeId}_${node.id}`}
                      onClick={() =>
                        onSelectNode && onSelectNode(treeId, node.id)
                      }
                      className="p-2.5 rounded-lg bg-surface-secondary border border-border-subtle hover:border-rose-400 hover:bg-surface-hover transition-all cursor-pointer space-y-1.5 group shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                          <span
                            className="text-xs font-semibold text-text-primary truncate"
                            title={node.name}
                          >
                            {node.name}
                          </span>
                        </div>
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-surface-primary text-text-secondary border border-border-subtle shrink-0 font-semibold">
                          {treeName}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-border-subtle text-[10px]">
                        <div className="flex items-center gap-1.5">
                          {node.is_paused ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-paused-bg text-state-paused-text border border-state-paused-border">
                              ⏸️ PAUSED
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase border ${
                                node.status === "RUNNING"
                                  ? "bg-state-running-bg text-state-running-text border-state-running-border"
                                  : node.status === "SUCCESS"
                                    ? "bg-state-success-bg text-state-success-text border-state-success-border"
                                    : node.status === "FAILURE"
                                      ? "bg-state-failure-bg text-state-failure-text border-state-failure-border"
                                      : "bg-surface-primary text-text-muted border-border-subtle"
                              }`}
                            >
                              {node.status}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded-md text-[9px] font-medium border ${
                              node.breakpoint_once
                                ? "bg-state-running-bg text-state-running-text border-state-running-border font-bold"
                                : "bg-surface-primary text-text-muted border-border-subtle"
                            }`}
                          >
                            {node.breakpoint_once ? "⚡ 1x Once" : "Permanent"}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          {node.uid && onToggleBreakpoint && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleBreakpoint(treeId, node.uid);
                              }}
                              className="p-1 rounded-lg bg-rose-100 hover:bg-rose-600 text-rose-700 hover:text-white dark:bg-rose-950 dark:hover:bg-rose-600 dark:text-rose-300 border border-rose-300 dark:border-rose-700 transition-all cursor-pointer shadow-2xs active:scale-95"
                              title="Remove Breakpoint"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Fault Injections List View */}
          {!isNav2 && activeTab === "faults" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Faults Header Toolbar */}
              <div className="p-2.5 border-b border-border-subtle flex items-center justify-between bg-surface-secondary">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary font-mono">
                  Injected Faults ({filteredInjections.length})
                </span>
                {allInjections.length > 0 && onClearAllFaults && (
                  <button
                    onClick={() => onClearAllFaults()}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-accent-subtle hover:bg-accent-border dark:bg-purple-950/80 dark:hover:bg-purple-900 text-accent-hover dark:text-purple-300 border border-accent-border dark:border-purple-700 text-[10px] font-bold transition-all cursor-pointer shadow-2xs active:scale-95"
                    title="Reset all injected faults across all trees"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset All</span>
                  </button>
                )}
              </div>

              {/* Search Filter */}
              <div className="p-2 border-b border-border-subtle bg-surface-primary">
                <div className="flex items-center bg-surface-secondary px-2.5 py-1.5 rounded-lg border border-border-subtle focus-within:border-border-focus focus-within:ring-2 focus-within:ring-accent-primary/20">
                  <Search className="w-3.5 h-3.5 text-text-muted mr-1.5 shrink-0" />
                  <input
                    type="text"
                    placeholder="Filter faults..."
                    value={faultSearchText}
                    onChange={(e) => setFaultSearchText(e.target.value)}
                    className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-full font-sans"
                  />
                </div>
              </div>

              {/* Fault Injections List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {filteredInjections.length === 0 ? (
                  <div className="p-4 text-center text-xs text-text-muted italic">
                    No fault injections active.
                    <div className="text-[10px] text-text-secondary mt-1 not-italic font-sans">
                      Right-click a node to force SUCCESS, FAILURE, or SKIPPED,
                      block tree ticking, or inject a delay. BLOCK TICK halts
                      ticking until cleared; it does not make the node return
                      RUNNING.
                    </div>
                  </div>
                ) : (
                  filteredInjections.map(({ treeId, treeName, node }) => (
                    <div
                      key={`${treeId}_${node.id}`}
                      onClick={() =>
                        onSelectNode && onSelectNode(treeId, node.id)
                      }
                      className="p-2.5 rounded-lg bg-surface-secondary border border-border-subtle hover:border-accent-primary hover:bg-surface-hover transition-all cursor-pointer space-y-1.5 group shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <Zap className="w-3.5 h-3.5 text-state-fault-text shrink-0" />
                          <span
                            className="text-xs font-semibold text-text-primary truncate"
                            title={node.name}
                          >
                            {node.name}
                          </span>
                        </div>
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-surface-primary text-text-secondary border border-border-subtle shrink-0 font-semibold">
                          {treeName}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-border-subtle text-[10px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {node.fault_mode === "FORCE_SUCCESS" && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-success-bg text-state-success-text border border-state-success-border font-mono">
                              FORCE SUCCESS
                            </span>
                          )}
                          {node.fault_mode === "FORCE_FAILURE" && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-failure-bg text-state-failure-text border border-state-failure-border font-mono">
                              FORCE FAILURE
                            </span>
                          )}
                          {node.fault_mode === "FORCE_RUNNING" && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-running-bg text-state-running-text border border-state-running-border font-mono">
                              BLOCK TICK
                            </span>
                          )}
                          {node.fault_mode === "FORCE_SKIPPED" && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-surface-secondary text-text-muted border border-border-subtle font-mono">
                              FORCE SKIPPED
                            </span>
                          )}
                          {node.fault_mode === "DELAY" && (
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-state-fault-bg text-state-fault-text border border-state-fault-border font-mono">
                              DELAY ({node.fault_delay_ms || 0}ms)
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded-md text-[9px] font-mono border ${
                              node.fault_once
                                ? "bg-state-running-bg text-state-running-text border-state-running-border font-bold"
                                : "bg-surface-primary text-text-muted border-border-subtle"
                            }`}
                          >
                            {node.fault_once ? "⚡ 1x Once" : "Permanent"}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          {node.uid && onClearFault && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onClearFault(treeId, node.uid);
                              }}
                              className="p-1 rounded-lg bg-accent-subtle hover:bg-accent-primary text-accent-hover hover:text-white dark:bg-purple-950 dark:hover:bg-purple-600 dark:text-purple-300 border border-accent-border dark:border-purple-700 transition-all cursor-pointer shadow-2xs active:scale-95"
                              title="Reset / Clear Fault"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Author & GitHub Footer */}
      <div className="px-3 py-2 border-t border-border-subtle bg-surface-primary flex items-center justify-between text-xs select-text shrink-0">
        <span className="font-semibold text-text-secondary font-mono text-[11px]">
          Sherif Fathey
        </span>
        <a
          href="https://github.com/SherifFathey"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-secondary hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border-medium font-medium text-[11px] transition-all cursor-pointer shadow-2xs hover:border-border-strong active:scale-95"
          title="https://github.com/SherifFathey"
        >
          <OfficialGithubIcon className="w-3.5 h-3.5" />
          <span>GitHub</span>
        </a>
      </div>
    </aside>
  );
};
