import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  Controls,
  ControlButton,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodesInitialized,
  useViewport,
  useUpdateNodeInternals,
  useStoreApi,
  BackgroundVariant,
  Node,
  Edge,
  Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  BTTreeModel,
  BTNodeModel,
  TreeOrientation,
  EdgePathMode,
} from "../types/bt";
import { BTNodeComponent } from "./BTNodeComponent";
import { BTMonitorEdge } from "./BTMonitorEdge";
import { DelayInputControl } from "./DelayInputControl";
import { generateGraphElements } from "../utils/dagreLayout";
import treeStructureIcon from "../../assets/tree-structure.png";
import {
  Search,
  Target,
  Eye,
  EyeOff,
  AlertTriangle,
  RotateCcw,
  Maximize2,
  LayoutGrid,
  LockKeyhole,
  LockKeyholeOpen,
  Play,
  StepForward,
  CircleSlash,
  Bug,
  Zap,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Clock,
  Sliders,
  Database,
  Copy,
  Info,
  Waypoints,
} from "lucide-react";

interface BTGraphProps {
  tree: BTTreeModel | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  orientation?: TreeOrientation;
  onOrientationChange?: (orientation: TreeOrientation) => void;
  activeProtocol?: "btick" | "groot2" | "nav2";
  isReplaying?: boolean;
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
  onOpenBlackboard?: () => void;
  pausedNodeTreeId?: string | null;
  pausedNodeUid?: number | null;
  pausedNodeName?: string;
  onResume?: (treeId?: string) => void;
  onForceSuccess?: (treeId?: string) => void;
  onForceFailure?: (treeId?: string) => void;
  onClearBreakpoints?: (treeId?: string) => void;
  centerTarget?: { nodeId: string; timestamp: number } | null;
  viewport?: Viewport;
  onViewportChange?: (viewport: Viewport) => void;
  initialNodePositions?: Record<string, { x: number; y: number }>;
  onNodePositionsChange?: (
    positions: Record<string, { x: number; y: number }>,
  ) => void;
  initialCollapsedNodeIds?: string[];
  onCollapsedNodeIdsChange?: (nodeIds: string[]) => void;
  pathMode?: EdgePathMode;
  onPathModeChange?: (mode: EdgePathMode) => void;
  showGrid?: boolean;
  autoCenter?: boolean;
  onAutoCenterChange?: (enabled: boolean) => void;
  onSetNodePort?: (
    treeId: string,
    uid: number,
    portName: string,
    value: string,
    mode: "Literal" | "Blackboard",
  ) => Promise<{ success: boolean; error?: string }>;
}

const nodeTypes = {
  btNode: BTNodeComponent as any,
};

const edgeTypes = {
  btMonitorEdge: BTMonitorEdge as any,
};

const DEFAULT_FIT_VIEW_OPTIONS = {
  padding: 0.2,
  minZoom: 0.05,
  maxZoom: 2,
  duration: 350,
};

// Background dots are clearly visible in normal/fit view and smoothly hide when zooming far out
const AdaptiveBackground: React.FC = () => {
  const { zoom } = useViewport();

  let opacity = 0;
  if (zoom >= 0.5) {
    opacity = 0.65;
  } else if (zoom > 0.3) {
    opacity = ((zoom - 0.3) / 0.2) * 0.65;
  }

  return (
    <Background
      variant={BackgroundVariant.Dots}
      gap={24}
      size={1.8}
      color="var(--canvas-grid-dot)"
      style={{ opacity, transition: "opacity 0.2s ease-out" }}
    />
  );
};

interface ContextMenuState {
  anchorElement: HTMLElement;
  node: BTNodeModel;
  position: { x: number; y: number } | null;
}

export const getContextMenuPosition = (
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  menu: Pick<DOMRect, "width" | "height">,
  viewport: { width: number; height: number },
) => {
  const gap = 8;
  const padding = 8;
  const maxX = Math.max(padding, viewport.width - menu.width - padding);
  const x = Math.min(Math.max(padding, anchor.left), maxX);

  const bottomY = anchor.bottom + gap;
  const maxY = Math.max(padding, viewport.height - menu.height - padding);
  const aboveY = anchor.top - menu.height - gap;
  const y =
    bottomY + menu.height <= viewport.height - padding
      ? bottomY
      : aboveY >= padding
        ? aboveY
        : maxY;

  return { x, y };
};

export const BTGraphContent: React.FC<BTGraphProps> = ({
  tree,
  selectedNodeId,
  onSelectNode,
  orientation: propOrientation,
  onOrientationChange,
  activeProtocol = "btick",
  isReplaying = false,
  onToggleBreakpoint,
  onSetBreakpointOnce,
  onInjectFault,
  onSetFaultOnce,
  onClearFault,
  onOpenBlackboard,
  pausedNodeTreeId,
  pausedNodeUid,
  pausedNodeName,
  onResume,
  onForceSuccess,
  onForceFailure,
  onClearBreakpoints,
  centerTarget,
  viewport,
  onViewportChange,
  initialNodePositions,
  onNodePositionsChange,
  initialCollapsedNodeIds,
  onCollapsedNodeIdsChange,
  pathMode = "orthogonal",
  onPathModeChange,
  showGrid = true,
  autoCenter: propAutoCenter,
  onAutoCenterChange,
  onSetNodePort,
}) => {
  const isNav2 = activeProtocol === "nav2";
  const isReadOnlyDebug = isNav2 || isReplaying;
  const { fitView, setCenter, setViewport, getNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const [internalOrientation, setInternalOrientation] =
    useState<TreeOrientation>("vertical");
  const activeOrientation = propOrientation || internalOrientation;

  // Context Menu State for Interactive Debug & Faults
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuElementRef = useRef<HTMLDivElement>(null);
  const [delayInput, setDelayInput] = useState<number>(1000);
  const [showDelayPicker, setShowDelayPicker] = useState<boolean>(false);
  const [breakpointOnce, setBreakpointOnce] = useState<boolean>(false);
  const [faultOnce, setFaultOnce] = useState<boolean>(false);

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, nodeData: BTNodeModel) => {
      event.preventDefault();
      event.stopPropagation();
      if (!nodeData) return;

      const anchorElement = event.currentTarget as HTMLElement;
      setContextMenu({
        anchorElement,
        node: nodeData,
        position: null,
      });
      setBreakpointOnce(!!nodeData.breakpoint_once);
      setFaultOnce(!!nodeData.fault_once);
      setShowDelayPicker(false);
      setDelayInput(nodeData.fault_delay_ms || 1000);
    },
    [],
  );

  const positionContextMenu = useCallback((anchorElement: HTMLElement) => {
    const menuElement = contextMenuElementRef.current;
    if (!menuElement || !anchorElement.isConnected) return;

    const position = getContextMenuPosition(
      anchorElement.getBoundingClientRect(),
      menuElement.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    );
    setContextMenu((current) => {
      if (
        !current ||
        current.anchorElement !== anchorElement ||
        (current.position?.x === position.x &&
          current.position?.y === position.y)
      ) {
        return current;
      }
      return { ...current, position };
    });
  }, []);

  useLayoutEffect(() => {
    const anchorElement = contextMenu?.anchorElement;
    if (!anchorElement) return;

    const reposition = () => positionContextMenu(anchorElement);
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [contextMenu?.anchorElement, positionContextMenu, showDelayPicker]);

  // Synchronize contextMenu node with live tree updates
  useEffect(() => {
    if (contextMenu && tree) {
      const latestNode = tree.nodes.find(
        (n) =>
          n.id === contextMenu.node.id ||
          (n.uid && n.uid === contextMenu.node.uid),
      );
      if (latestNode && latestNode !== contextMenu.node) {
        setContextMenu((prev) => (prev ? { ...prev, node: latestNode } : null));
      }
    }
  }, [tree, contextMenu]);

  useEffect(() => {
    setContextMenu(null);
    setShowDelayPicker(false);
  }, [tree?.tree_id]);

  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
      setShowDelayPicker(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setShowDelayPicker(false);
      }
    };
    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Lock state: when true, nodes cannot be dragged/moved, but zoom and pan remain active
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const reactFlowWrapperRef = useRef<HTMLDivElement>(null);

  // Focus canvas on startup/initialization so keyboard shortcuts and canvas navigation work immediately
  const focusCanvas = useCallback(() => {
    const container = reactFlowWrapperRef.current;
    if (!container) return;
    const pane =
      container.querySelector<HTMLElement>(".react-flow__pane") ||
      container.querySelector<HTMLElement>(".react-flow") ||
      container;
    if (pane) {
      if (
        !pane.hasAttribute("tabIndex") ||
        Number(pane.getAttribute("tabIndex")) < 0
      ) {
        pane.setAttribute("tabIndex", "0");
      }
      pane.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    focusCanvas();
    const rafId = requestAnimationFrame(focusCanvas);
    const timer = setTimeout(focusCanvas, 80);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
    };
  }, [focusCanvas]);

  // Track user-dragged node positions so moves persist during live updates
  const userPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(Object.entries(initialNodePositions || {})),
  );
  const treeIdRef = useRef<string | null>(tree?.tree_id || null);
  const orientationRef = useRef<TreeOrientation>(activeOrientation);

  // Clear custom positions if active tree or orientation changes
  if (
    tree?.tree_id !== treeIdRef.current ||
    activeOrientation !== orientationRef.current
  ) {
    userPositionsRef.current.clear();
    treeIdRef.current = tree?.tree_id || null;
    orientationRef.current = activeOrientation;
  }

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(initialCollapsedNodeIds || []),
  );
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [internalAutoCenter, setInternalAutoCenter] = useState(false);
  const isAutoCenter =
    propAutoCenter !== undefined ? propAutoCenter : internalAutoCenter;
  const autoCenterRef = useRef<boolean>(isAutoCenter);
  useEffect(() => {
    autoCenterRef.current = isAutoCenter;
  }, [isAutoCenter]);
  const [measuredNodeHeights, setMeasuredNodeHeights] = useState<
    Map<string, number>
  >(new Map());
  const pendingHeightsRef = useRef<Map<string, number>>(new Map());
  const batchTimeoutRef = useRef<any>(null);

  const handleNodeResize = useCallback(
    (nodeId: string, height: number) => {
      updateNodeInternals(nodeId);
      pendingHeightsRef.current.set(nodeId, height);

      if (batchTimeoutRef.current === null) {
        batchTimeoutRef.current = setTimeout(() => {
          batchTimeoutRef.current = null;
          setMeasuredNodeHeights((previous) => {
            let hasChanges = false;
            const next = new Map(previous);
            pendingHeightsRef.current.forEach((h, id) => {
              if (next.get(id) !== h) {
                next.set(id, h);
                hasChanges = true;
              }
            });
            pendingHeightsRef.current.clear();
            return hasChanges ? next : previous;
          });
        }, 16);
      }
    },
    [updateNodeInternals],
  );

  useEffect(() => {
    return () => {
      if (batchTimeoutRef.current !== null) {
        clearTimeout(batchTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setMeasuredNodeHeights(new Map());
  }, [tree?.tree_id, activeOrientation, activeProtocol, layoutRevision]);

  // Global Keyboard Shortcuts (F5 = Continue/Resume, F9 = Toggle Breakpoint) [Disabled]
  /*
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isReadOnlyDebug) return;
      const treeId = tree?.tree_id || "MainTree";
      if (e.key === "F5") {
        e.preventDefault();
        onResume?.(treeId);
      } else if (e.key === "F9") {
        e.preventDefault();
        if (selectedNodeId && tree) {
          const selNode = tree.nodes.find((n) => n.id === selectedNodeId);
          if (selNode && selNode.uid && onToggleBreakpoint) {
            onToggleBreakpoint(tree.tree_id, selNode.uid);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isReadOnlyDebug, onResume, onToggleBreakpoint, selectedNodeId, tree]);
  */

  // Collect failed nodes in current tree
  const failedNodes = useMemo(() => {
    return tree?.nodes.filter((n) => n.status === "FAILURE") || [];
  }, [tree]);

  const withPathMode = useCallback(
    (graphEdges: Edge[]) =>
      graphEdges.map((edge) => ({
        ...edge,
        data: { ...edge.data, pathMode },
      })),
    [pathMode],
  );

  // Compute graph elements using Dagre
  const stableGraph = useMemo(
    () =>
      generateGraphElements(
        tree,
        new Set(),
        activeOrientation,
        isReadOnlyDebug ? undefined : onToggleBreakpoint,
        isLocked,
        handleNodeContextMenu,
        activeProtocol,
        measuredNodeHeights,
        handleNodeResize,
        true,
      ),
    [
      tree,
      activeOrientation,
      isReadOnlyDebug,
      onToggleBreakpoint,
      isLocked,
      handleNodeContextMenu,
      activeProtocol,
      measuredNodeHeights,
      handleNodeResize,
      pathMode,
    ],
  );

  const { initialNodes, initialEdges } = useMemo<{
    initialNodes: Node[];
    initialEdges: Edge[];
  }>(() => {
    const graph = stableGraph;
    const hiddenNodes = new Set<string>();
    const nodeMap = new Map(tree?.nodes.map((node) => [node.id, node]) || []);
    const hideDescendants = (nodeId: string) => {
      nodeMap.get(nodeId)?.children_ids?.forEach((childId) => {
        hiddenNodes.add(childId);
        hideDescendants(childId);
      });
    };
    expandedNodes.forEach((key) => {
      if (key.startsWith("collapsed_")) {
        const nodeId = key.substring("collapsed_".length);
        if (nodeMap.has(nodeId)) hideDescendants(nodeId);
      }
    });
    return {
      initialNodes: graph.initialNodes.map((node) => ({
        ...node,
        hidden: hiddenNodes.has(node.id),
        data: {
          ...node.data,
          isCollapsed: expandedNodes.has(`collapsed_${node.id}`),
          onSetNodePort,
          isReadOnly: isReadOnlyDebug,
        },
      })),
      initialEdges: withPathMode(graph.initialEdges).map((edge) => ({
        ...edge,
        hidden: hiddenNodes.has(edge.source) || hiddenNodes.has(edge.target),
      })),
    };
  }, [
    tree,
    stableGraph,
    expandedNodes,
    activeOrientation,
    isNav2,
    onSetNodePort,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedEdgeId(null);
  }, [tree?.tree_id]);

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation();
    setSelectedEdgeId(edge.id);
  }, []);

  // Live tree/status updates can regenerate Dagre nodes while React Flow is
  // applying pointer movement. Defer those node-list replacements until the
  // drag ends so React Flow remains the source of truth during the gesture.
  const isDraggingNodeRef = useRef(false);
  const pendingGraphNodesRef = useRef<Node[] | null>(null);

  const handleNodeDragStart = useCallback(() => {
    isDraggingNodeRef.current = true;
    pendingGraphNodesRef.current = null;
  }, []);

  // Record node position when user finishes dragging
  const onNodeDragStop = useCallback(
    (_: any, node: Node) => {
      isDraggingNodeRef.current = false;
      userPositionsRef.current.set(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
      onNodePositionsChange?.(Object.fromEntries(userPositionsRef.current));

      // Apply the latest deferred graph shape without allowing Dagre to move
      // any node that React Flow already positioned during the drag.
      if (pendingGraphNodesRef.current) {
        const pendingNodes = pendingGraphNodesRef.current;
        pendingGraphNodesRef.current = null;
        setNodes((currentNodes) => {
          const currentPositions = new Map(
            currentNodes.map((currentNode) => [
              currentNode.id,
              currentNode.position,
            ]),
          );
          return pendingNodes.map((pendingNode) => ({
            ...pendingNode,
            position:
              pendingNode.id === node.id
                ? node.position
                : currentPositions.get(pendingNode.id) || pendingNode.position,
          }));
        });
        pendingNodes.forEach((pendingNode) =>
          updateNodeInternals(pendingNode.id),
        );
      }
    },
    [onNodePositionsChange, setNodes, updateNodeInternals],
  );

  // Toggle collapse / expand for subtree nodes
  const handleToggleCollapse = useCallback(
    (nodeId: string) => {
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        const key = `collapsed_${nodeId}`;
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        updateNodeInternals(nodeId);
        onCollapsedNodeIdsChange?.([...next]);
        return next;
      });
    },
    [onCollapsedNodeIdsChange, updateNodeInternals],
  );

  // Reset all dragged positions back to default Dagre tree layout
  const handleResetLayout = useCallback(() => {
    userPositionsRef.current.clear();
    onNodePositionsChange?.({});
    setLayoutRevision((r) => r + 1);

    const { initialNodes: newNodes, initialEdges: generatedEdges } =
      generateGraphElements(
        tree,
        expandedNodes,
        activeOrientation,
        isReadOnlyDebug ? undefined : onToggleBreakpoint,
        isLocked,
        handleNodeContextMenu,
        activeProtocol,
      );

    const nodesWithCallbacks: Node[] = newNodes.map((node: Node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        blackboard: tree?.blackboard || {},
        orientation: activeOrientation,
        onToggleCollapse: handleToggleCollapse,
        onNodeContextMenu: handleNodeContextMenu,
        onSetNodePort,
        isReadOnly: isReadOnlyDebug,
      },
    }));

    const edgesWithSelection = generatedEdges.map((edge) => ({
      ...edge,
      selected: edge.id === selectedEdgeId,
    }));

    setNodes(nodesWithCallbacks);
    setEdges(withPathMode(edgesWithSelection));
    newNodes.forEach((n: Node) => updateNodeInternals(n.id));
    explicitFitRequestedRef.current = true;
    fitRequestedRef.current = true;
  }, [
    tree,
    expandedNodes,
    activeOrientation,
    isReadOnlyDebug,
    onToggleBreakpoint,
    isLocked,
    handleNodeContextMenu,
    activeProtocol,
    selectedNodeId,
    selectedEdgeId,
    handleToggleCollapse,
    updateNodeInternals,
    setNodes,
    setEdges,
    onNodePositionsChange,
    withPathMode,
    onSetNodePort,
  ]);

  const handleOrientationSwitch = useCallback(
    (nextOrientation: TreeOrientation) => {
      userPositionsRef.current.clear();
      onNodePositionsChange?.({});
      orientationRef.current = nextOrientation;
      explicitFitRequestedRef.current = true;
      fitRequestedRef.current = true;

      if (onOrientationChange) {
        onOrientationChange(nextOrientation);
      } else {
        setInternalOrientation(nextOrientation);
      }
    },
    [onNodePositionsChange, onOrientationChange],
  );

  const nodesInitialized = useNodesInitialized();
  const fitViewRef = useRef(fitView);
  fitViewRef.current = fitView;
  const updateNodeInternalsRef = useRef(updateNodeInternals);
  updateNodeInternalsRef.current = updateNodeInternals;

  const lastLoadedTreeIdRef = useRef<string | null>(null);
  const lastOrientationRef = useRef<TreeOrientation>(activeOrientation);
  const lastProtocolRef = useRef<string>(activeProtocol);
  const lastFittedTokenRef = useRef<string | null>(null);
  const lastExplicitFittedSessionKeyRef = useRef<string | null>(null);
  const fitRequestedRef = useRef<boolean>(true);
  const explicitFitRequestedRef = useRef<boolean>(true);
  const rafId1Ref = useRef<number | null>(null);
  const [isTreeReady, setIsTreeReady] = useState<boolean>(
    () => !tree || !tree.nodes || tree.nodes.length === 0,
  );

  const performExplicitFitView = useCallback(
    (options?: any) => {
      if (nodes.length === 0) return Promise.resolve(false);
      console.log(
        "[BTGraph][Viewport] performExplicitFitView executing (fit-view)",
      );
      const isOptionsObject =
        options && typeof options === "object" && !("nativeEvent" in options);
      const fitOptions = isOptionsObject
        ? { ...DEFAULT_FIT_VIEW_OPTIONS, ...options }
        : DEFAULT_FIT_VIEW_OPTIONS;
      return fitViewRef.current(fitOptions);
    },
    [nodes.length],
  );

  const treeSessionKey = useMemo(() => {
    const treeSig = tree
      ? `${tree.tree_id}:${tree.nodes?.length || 0}:${tree.root_node_id || ""}`
      : "null";
    return `${treeSig}:${activeOrientation}:${activeProtocol}:${layoutRevision}`;
  }, [tree, activeOrientation, activeProtocol, layoutRevision]);

  const layoutToken = useMemo(() => {
    const treeSig = tree
      ? `${tree.tree_id}:${tree.nodes?.length || 0}:${tree.root_node_id || ""}`
      : "null";
    const measuredHeightsSig = Array.from(measuredNodeHeights.entries())
      .map(([k, v]) => `${k}:${v}`)
      .sort()
      .join(",");
    return `${treeSig}:${activeOrientation}:${activeProtocol}:${layoutRevision}:${measuredHeightsSig}`;
  }, [
    tree,
    activeOrientation,
    activeProtocol,
    layoutRevision,
    measuredNodeHeights,
  ]);

  // Request initial fit whenever treeSessionKey changes (initial load, tree change, orientation change, protocol change, or layout reset)
  useEffect(() => {
    if (treeSessionKey !== lastExplicitFittedSessionKeyRef.current) {
      fitRequestedRef.current = true;
      explicitFitRequestedRef.current = true;
    }
  }, [treeSessionKey]);

  // Update nodes and edges when tree, orientation, or protocol changes, auto-resetting layout on orientation switch
  useEffect(() => {
    const isOrientationChanged =
      lastOrientationRef.current !== activeOrientation;
    if (isOrientationChanged) {
      lastOrientationRef.current = activeOrientation;
      userPositionsRef.current.clear(); // Fully reset layout when switching between V and H
      explicitFitRequestedRef.current = true;
      fitRequestedRef.current = true;
    }

    const isProtocolChanged = lastProtocolRef.current !== activeProtocol;
    if (isProtocolChanged) {
      lastProtocolRef.current = activeProtocol;
      lastLoadedTreeIdRef.current = null;
      userPositionsRef.current.clear();
      explicitFitRequestedRef.current = true;
      fitRequestedRef.current = true;
    }

    // Collapse/expand only toggles hidden flags on the stable full-tree layout.
    // Preserve React Flow's current positions for every existing node.
    const nodesWithCallbacks = initialNodes.map((node: Node) => {
      const customPos = !isOrientationChanged
        ? userPositionsRef.current.get(node.id)
        : undefined;
      return {
        ...node,
        position: customPos ? customPos : node.position,
        selected: node.id === selectedNodeId,
        data: {
          ...node.data,
          blackboard: tree?.blackboard || {},
          orientation: activeOrientation,
          isLocked,
          onToggleCollapse: handleToggleCollapse,
          onNodeContextMenu: handleNodeContextMenu,
          onSetNodePort,
          isReadOnly: isReadOnlyDebug,
        },
      };
    });

    const edgesWithSelection = initialEdges.map((edge) => ({
      ...edge,
      selected: edge.id === selectedEdgeId,
    }));

    if (isDraggingNodeRef.current) {
      pendingGraphNodesRef.current = nodesWithCallbacks;
      setEdges(withPathMode(edgesWithSelection));
      return;
    }

    setNodes(nodesWithCallbacks);
    setEdges(withPathMode(edgesWithSelection));
    initialNodes.forEach((n: Node) => updateNodeInternals(n.id));

    const currentTreeId = tree?.tree_id || null;
    const isTreeChanged =
      currentTreeId !== null && currentTreeId !== lastLoadedTreeIdRef.current;
    if (isTreeChanged) {
      lastLoadedTreeIdRef.current = currentTreeId;
      explicitFitRequestedRef.current = true;
      fitRequestedRef.current = true;
    }
  }, [
    initialNodes,
    initialEdges,
    tree,
    activeOrientation,
    activeProtocol,
    isReadOnlyDebug,
    onToggleBreakpoint,
    isLocked,
    handleNodeContextMenu,
    selectedNodeId,
    selectedEdgeId,
    updateNodeInternals,
    setNodes,
    setEdges,
    withPathMode,
    onSetNodePort,
    handleToggleCollapse,
  ]);

  const nodeGeometryKey = useMemo(
    () =>
      nodes
        .map((node) =>
          [
            node.id,
            node.position.x,
            node.position.y,
            node.width,
            node.height,
            node.measured?.width,
            node.measured?.height,
            node.hidden,
          ].join(":"),
        )
        .join("|"),
    [nodes],
  );

  const storeApi = useStoreApi();

  // Helper to expand all ancestor nodes so target node is visible on canvas
  const expandAncestors = useCallback(
    (targetNodeId: string) => {
      if (!tree) return;
      const nodeMap = new Map<string, BTNodeModel>();
      tree.nodes.forEach((n) => nodeMap.set(n.id, n));

      let curr = nodeMap.get(targetNodeId);
      const toExpand: string[] = [];
      while (curr && curr.parent_id) {
        toExpand.push(curr.parent_id);
        curr = nodeMap.get(curr.parent_id);
      }

      if (toExpand.length > 0) {
        setExpandedNodes((prev) => {
          let changed = false;
          const next = new Set(prev);
          toExpand.forEach((pid) => {
            const key = `collapsed_${pid}`;
            if (next.has(key)) {
              next.delete(key);
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
    },
    [tree],
  );

  const lastCenteredNodeIdRef = useRef<string | null>(null);

  // Auto-center camera on the latest executing node, including active delays.
  const centerOnActiveNode = useCallback(
    (force = false) => {
      if (!force && !autoCenterRef.current) return;
      if (isDraggingNodeRef.current) return;
      if (!tree || !tree.nodes) return;

      let latestActiveNode: BTNodeModel | undefined = undefined;

      // Check if there is a paused node (breakpoint hit) first
      if (!isNav2 && pausedNodeUid) {
        latestActiveNode = tree.nodes.find((n) => n.uid === pausedNodeUid);
      }
      if (!latestActiveNode && !isNav2) {
        latestActiveNode = tree.nodes.find(
          (n) =>
            n.is_paused ||
            (n.status as string) === "PAUSED" ||
            (n.status as string) === "PAUSED_AT_BREAKPOINT",
        );
      }

      if (!latestActiveNode && tree.last_active_node_id) {
        latestActiveNode = tree.nodes.find(
          (n) => n.id === tree.last_active_node_id,
        );
      }

      if (
        !latestActiveNode ||
        (latestActiveNode.status !== "RUNNING" &&
          !latestActiveNode.delay_active &&
          !isNav2 &&
          !latestActiveNode.is_paused &&
          (latestActiveNode.status as string) !== "PAUSED" &&
          (latestActiveNode.status as string) !== "PAUSED_AT_BREAKPOINT")
      ) {
        const activeNodes = tree.nodes.filter(
          (n) =>
            n.status === "RUNNING" ||
            (!isNav2 && !!n.delay_active) ||
            (!isNav2 &&
              (n.is_paused ||
                (n.status as string) === "PAUSED" ||
                (n.status as string) === "PAUSED_AT_BREAKPOINT")),
        );
        if (activeNodes.length > 0) {
          latestActiveNode =
            activeNodes
              .slice()
              .reverse()
              .find((n) => n.category === "Action") ||
            activeNodes
              .slice()
              .reverse()
              .find((n) => !n.children_ids || n.children_ids.length === 0) ||
            activeNodes[activeNodes.length - 1];
        }
      }

      // If force is requested and still no active running node found, fallback to selected node or last active node
      if (!latestActiveNode && force) {
        if (selectedNodeId) {
          latestActiveNode = tree.nodes.find((n) => n.id === selectedNodeId);
        }
        if (!latestActiveNode && tree.last_active_node_id) {
          latestActiveNode = tree.nodes.find(
            (n) => n.id === tree.last_active_node_id,
          );
        }
      }

      if (!latestActiveNode) return;

      if (force || latestActiveNode.id !== lastCenteredNodeIdRef.current) {
        lastCenteredNodeIdRef.current = latestActiveNode.id;
        expandAncestors(latestActiveNode.id);

        const target =
          nodes.find((n: Node) => n.id === latestActiveNode!.id) ||
          initialNodes.find((n: Node) => n.id === latestActiveNode!.id);
        if (target) {
          if (isDraggingNodeRef.current) return;
          console.log(
            "[BTGraph][Viewport] centerOnActiveNode -> setCenter called for",
            target.id,
            "pos:",
            target.position,
          );
          setCenter(target.position.x + 120, target.position.y + 40, {
            duration: 350,
          });
        }
      }
    },
    [
      tree,
      isNav2,
      pausedNodeUid,
      selectedNodeId,
      nodes,
      initialNodes,
      setCenter,
      expandAncestors,
    ],
  );

  // Execute fitView deterministically AFTER the new layout is committed, measured, and rendered
  useEffect(() => {
    const isExplicit = explicitFitRequestedRef.current;

    if (!isExplicit || nodes.length === 0) {
      return;
    }

    if (rafId1Ref.current !== null) {
      cancelAnimationFrame(rafId1Ref.current);
      rafId1Ref.current = null;
    }

    const checkAndFit = () => {
      const explicitPending = explicitFitRequestedRef.current;
      if (!explicitPending) return;

      // 1. Verify container has valid non-zero dimensions
      const container = reactFlowWrapperRef.current;
      const domWidth =
        container?.clientWidth || container?.getBoundingClientRect().width || 0;
      const domHeight =
        container?.clientHeight ||
        container?.getBoundingClientRect().height ||
        0;
      const rfState = storeApi.getState();
      const effectiveWidth = rfState.width > 0 ? rfState.width : domWidth;
      const effectiveHeight = rfState.height > 0 ? rfState.height : domHeight;

      if (effectiveWidth <= 0 || effectiveHeight <= 0) {
        rafId1Ref.current = requestAnimationFrame(checkAndFit);
        return;
      }

      // 2. Verify that React Flow's internal nodeLookup contains the nodes
      const nodeLookup = rfState.nodeLookup;
      if (!nodeLookup || nodeLookup.size === 0) {
        rafId1Ref.current = requestAnimationFrame(checkAndFit);
        return;
      }

      if (!nodesInitialized) {
        rafId1Ref.current = requestAnimationFrame(checkAndFit);
        return;
      }

      const visibleNodes = nodes.filter((n) => !n.hidden);
      if (visibleNodes.length === 0) return;

      // 3. Verify positions match Dagre layout AND all visible nodes have valid measured dimensions in store
      const allMeasuredAndPositioned = visibleNodes.every((n) => {
        const internalNode = nodeLookup.get(n.id);
        if (!internalNode) return false;

        const posMatch =
          internalNode.position?.x === n.position.x &&
          internalNode.position?.y === n.position.y;
        if (!posMatch) return false;

        const w = internalNode.measured?.width || 0;
        const h = internalNode.measured?.height || 0;
        return w > 0 && h > 0;
      });

      if (!allMeasuredAndPositioned) {
        rafId1Ref.current = requestAnimationFrame(checkAndFit);
        return;
      }

      // Final geometry & complete node bounds confirmed in React Flow store
      fitRequestedRef.current = false;
      explicitFitRequestedRef.current = false;
      lastExplicitFittedSessionKeyRef.current = treeSessionKey;
      lastFittedTokenRef.current = treeSessionKey;

      console.log(
        "[BTGraph][Viewport] checkAndFit -> calling performExplicitFitView (first priority) for",
        treeSessionKey,
      );
      const fitPromise = performExplicitFitView({ duration: 0 });
      if (fitPromise && typeof fitPromise.then === "function") {
        fitPromise.then((res: boolean) => {
          if (res === false) {
            explicitFitRequestedRef.current = true;
            fitRequestedRef.current = true;
            rafId1Ref.current = requestAnimationFrame(checkAndFit);
          } else {
            setIsTreeReady(true);
          }
        });
      } else {
        setIsTreeReady(true);
      }
    };

    rafId1Ref.current = requestAnimationFrame(checkAndFit);

    return () => {
      if (rafId1Ref.current !== null) {
        cancelAnimationFrame(rafId1Ref.current);
        rafId1Ref.current = null;
      }
    };
  }, [
    treeSessionKey,
    nodesInitialized,
    nodes,
    nodeGeometryKey,
    storeApi,
    getNodes,
    performExplicitFitView,
  ]);

  // When tree updates or active node changes while isAutoCenter is on, smoothly center
  useEffect(() => {
    if (!isAutoCenter || isDraggingNodeRef.current) return;
    centerOnActiveNode(false);
  }, [tree, isAutoCenter, centerOnActiveNode]);

  // When centerTarget is explicitly triggered from the sidebar (timestamp update),
  // automatically expand all parent containers and smoothly center & zoom the canvas on that node!
  const lastCenterTimestampRef = useRef<number>(0);
  useEffect(() => {
    if (!tree || !centerTarget) return;
    if (centerTarget.timestamp === lastCenterTimestampRef.current) return;
    lastCenterTimestampRef.current = centerTarget.timestamp;

    const targetNodeId = centerTarget.nodeId;
    if (!targetNodeId) return;

    // Ensure all parent subtrees are uncollapsed so target node is mounted
    expandAncestors(targetNodeId);

    const tryCenter = () => {
      const target =
        nodes.find((n) => n.id === targetNodeId) ||
        initialNodes.find((n) => n.id === targetNodeId);
      if (target) {
        if (isDraggingNodeRef.current) return;
        setCenter(target.position.x + 120, target.position.y + 40, {
          zoom: 1.25,
          duration: 450,
        });
      }
    };

    tryCenter();
    const timer = setTimeout(tryCenter, 80);
    return () => clearTimeout(timer);
  }, [centerTarget, tree, nodes, initialNodes, setCenter, expandAncestors]);

  // Expand ancestors if selectedNodeId changes without forcing viewport camera jump
  useEffect(() => {
    if (selectedNodeId) {
      expandAncestors(selectedNodeId);
    }
  }, [selectedNodeId, expandAncestors]);

  // Toggle auto-center: when disabling, do NOT move viewport; when enabling, center on active node NOW
  const handleToggleAutoCenter = useCallback(() => {
    const next = !isAutoCenter;
    if (onAutoCenterChange) {
      onAutoCenterChange(next);
    } else {
      setInternalAutoCenter(next);
    }
    if (!next) {
      lastCenteredNodeIdRef.current = null;
    } else {
      lastCenteredNodeIdRef.current = null;
      centerOnActiveNode(true);
      requestAnimationFrame(() => {
        centerOnActiveNode(true);
      });
    }
  }, [isAutoCenter, onAutoCenterChange, centerOnActiveNode]);

  // Jump to and cycle through all failed nodes sequentially
  const handleJumpToFailed = () => {
    if (failedNodes.length === 0) return;

    // Deactivate Auto-Center Active Node so view stays locked on the failed node
    if (onAutoCenterChange) {
      onAutoCenterChange(false);
    } else {
      setInternalAutoCenter(false);
    }

    // Find current index of selected failed node, advance to next index
    const currentIdx = failedNodes.findIndex((n) => n.id === selectedNodeId);
    const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % failedNodes.length : 0;
    const targetNode = failedNodes[nextIdx];

    // Ensure all parent nodes are uncollapsed so target node is rendered
    expandAncestors(targetNode.id);

    // Select the target node
    onSelectNode(targetNode.id);

    // Center and zoom directly on the target node
    setTimeout(() => {
      const target = nodes.find((n) => n.id === targetNode.id);
      if (target) {
        if (isDraggingNodeRef.current) return;
        setCenter(target.position.x + 120, target.position.y + 40, {
          zoom: 1.3,
          duration: 500,
        });
      }
    }, 60);
  };

  // Handle node selection
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (
        (event.target as HTMLElement).closest(
          "[data-port-editor-control='true']",
        )
      ) {
        return;
      }
      setSelectedEdgeId(null);
      onSelectNode(node.id);
      expandAncestors(node.id);
      if (!isDraggingNodeRef.current) {
        setCenter(node.position.x + 120, node.position.y + 40, {
          duration: 350,
        });
      }
    },
    [onSelectNode, expandAncestors, setCenter],
  );

  const onPaneClick = useCallback(() => {
    setSelectedEdgeId(null);
    onSelectNode(null);
  }, [onSelectNode]);

  // Handle Search focus
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !tree) return;

    const matchedNode = tree.nodes.find(
      (n) =>
        n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.id.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    if (matchedNode) {
      expandAncestors(matchedNode.id);
      onSelectNode(matchedNode.id);
      setTimeout(() => {
        const target = nodes.find((n) => n.id === matchedNode.id);
        if (target) {
          setCenter(target.position.x + 120, target.position.y + 40, {
            zoom: 1.2,
            duration: 500,
          });
        }
      }, 60);
    }
  };

  const isPausedAtBreakpoint = Boolean(
    !isReadOnlyDebug &&
    pausedNodeUid &&
    (!pausedNodeTreeId || !tree || tree.tree_id === pausedNodeTreeId),
  );

  return (
    <div
      ref={reactFlowWrapperRef}
      tabIndex={-1}
      className={`relative w-full h-full bg-canvas outline-none [container-type:inline-size] transition-opacity duration-150 ${
        isTreeReady ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Floating Paused at Breakpoint Top Banner & Action Controls */}
      {isPausedAtBreakpoint && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-2xl bg-surface-primary/95 backdrop-blur-md border border-amber-500 shadow-2xl animate-in fade-in slide-in-from-top-4 font-sans select-text max-w-[90%]">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="relative flex h-3 w-3 items-center justify-center shrink-0">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 border border-white dark:border-slate-800 shadow-sm bt-pause-pulse" />
            </span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] font-mono font-bold tracking-wider text-amber-600 dark:text-amber-400 uppercase shrink-0">
                Execution Paused
              </span>
              <span
                className="text-xs font-mono font-semibold text-text-primary truncate max-w-[280px] min-w-0"
                title={`Breakpoint at ${pausedNodeName || "Node"}`}
              >
                Breakpoint at {pausedNodeName || "Node"}
              </span>
            </div>
          </div>

          <div className="h-5 w-px bg-border-subtle shrink-0" />

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onResume?.(tree?.tree_id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer active:scale-95 border border-emerald-700 shrink-0"
              title="Continue Execution from Breakpoint"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Continue </span>
            </button>

            <button
              onClick={() => onForceSuccess?.(tree?.tree_id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-secondary hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950 dark:hover:text-emerald-300 text-text-primary font-semibold text-xs border border-border-medium transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
              title="Force Node SUCCESS (Fault Injection)"
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              <span>Success</span>
            </button>

            <button
              onClick={() => onForceFailure?.(tree?.tree_id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-secondary hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950 dark:hover:text-rose-300 text-text-primary font-semibold text-xs border border-border-medium transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
              title="Force Node FAILURE (Fault Injection)"
            >
              <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
              <span>Failure</span>
            </button>

            <button
              onClick={() => {
                if (pausedNodeUid && tree) {
                  onToggleBreakpoint?.(tree.tree_id, pausedNodeUid);
                  onResume?.(tree.tree_id);
                }
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-secondary hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950 dark:hover:text-rose-300 text-text-secondary text-xs border border-border-medium transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
              title={`Remove Breakpoint from ${pausedNodeName || "this node"} and Continue`}
            >
              <CircleSlash className="w-3 h-3 text-rose-500" />
              <span>Remove Breakpoint</span>
            </button>
          </div>
        </div>
      )}

      {/* Top Search & Controls Overlay */}
      <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5 flex-wrap">
        <form
          onSubmit={handleSearchSubmit}
          className="flex items-center bg-surface-primary/95 backdrop-blur-xs border border-border-medium rounded-lg px-2.5 py-1 shadow-2xs focus-within:border-accent-primary focus-within:ring-2 focus-within:ring-accent-primary/20"
        >
          <Search className="w-3.5 h-3.5 text-text-muted mr-1.5 shrink-0" />
          <input
            type="text"
            placeholder="Search node..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-48 font-sans"
          />
        </form>

        <button
          onClick={handleToggleAutoCenter}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-2xs active:scale-95 ${
            isAutoCenter
              ? "bg-accent-primary border-accent-primary font-bold shadow-xs text-white"
              : "bg-surface-primary/95 border-border-medium hover:bg-surface-hover text-text-primary dark:text-white"
          }`}
          title={
            isAutoCenter
              ? "Auto-Center is ON (Click to disable)"
              : "Auto-Center is OFF (Click to enable auto-centering on running nodes)"
          }
        >
          <Target
            className={`w-3.5 h-3.5 ${isAutoCenter ? "text-white" : "text-accent-primary dark:text-white"}`}
          />
          <span
            className={
              isAutoCenter ? "text-white" : "text-text-primary dark:text-white"
            }
          >
            Auto-Center
          </span>
        </button>

        {failedNodes.length > 0 &&
          (() => {
            const currentIdx = failedNodes.findIndex(
              (n) => n.id === selectedNodeId,
            );
            const displayIdx = currentIdx >= 0 ? currentIdx + 1 : 1;

            return (
              <button
                onClick={handleJumpToFailed}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/80 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 text-xs font-bold shadow-2xs transition-all cursor-pointer active:scale-95"
                title="Click to cycle sequentially through all failed nodes"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                <span>
                  {failedNodes.length === 1
                    ? "1 Failed (Jump)"
                    : `${failedNodes.length} Failed (${displayIdx}/${failedNodes.length})`}
                </span>
              </button>
            );
          })()}
      </div>

      {/* React Flow Graph Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        onInit={() => {
          focusCanvas();
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={!isLocked}
        nodesConnectable={false}
        defaultViewport={viewport}
        fitView={!viewport}
        fitViewOptions={{ ...DEFAULT_FIT_VIEW_OPTIONS, duration: 0 }}
        onMove={(_, nextViewport) => {
          console.log(
            "[BTGraph][Viewport] onMove (viewport changed):",
            nextViewport,
          );
          onViewportChange?.(nextViewport);
          if (contextMenu) {
            positionContextMenu(contextMenu.anchorElement);
          }
        }}
        minZoom={0.01}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        {showGrid && <AdaptiveBackground />}

        {/* Bottom-left Controls */}
        <Controls
          position="bottom-left"
          className="grid-flow-controls !bg-surface-secondary/95 !backdrop-blur-md !border !border-border-strong !rounded-xl !p-1 !shadow-xl overflow-hidden flex flex-col gap-0.5"
          showInteractive={false}
          showFitView={false}
        >
          <ControlButton
            onClick={() => performExplicitFitView()}
            title="Fit View to Screen"
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !text-text-primary hover:!text-accent-primary !flex !items-center !justify-center cursor-pointer !rounded-lg active:scale-95 !shadow-2xs transition-all !w-6 !h-6 !m-0"
          >
            <span className="text-sm font-bold text-text-primary leading-none">
              ⛶
            </span>
          </ControlButton>

          <ControlButton
            onClick={() =>
              handleOrientationSwitch(
                activeOrientation === "horizontal" ? "vertical" : "horizontal",
              )
            }
            title={
              activeOrientation === "horizontal"
                ? "Switch to Vertical Layout"
                : "Switch to Horizontal Layout"
            }
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !flex !items-center !justify-center cursor-pointer !rounded-lg active:scale-95 !shadow-2xs transition-all !w-6 !h-6 !m-0"
          >
            {activeOrientation === "horizontal" ? (
              <img
                src={treeStructureIcon}
                alt="Horizontal Layout"
                className="w-3.5 h-3.5 object-contain transition-transform opacity-90 dark:invert"
              />
            ) : (
              <img
                src={treeStructureIcon}
                alt="Vertical Layout"
                className="w-3.5 h-3.5 object-contain rotate-90 transform transition-transform opacity-90 dark:invert"
              />
            )}
          </ControlButton>

          <ControlButton
            onClick={() =>
              onPathModeChange?.(
                pathMode === "bezier" ? "orthogonal" : "bezier",
              )
            }
            title={
              pathMode === "bezier"
                ? "Switch to Orthogonal Paths"
                : "Switch to Curved Paths"
            }
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !flex !items-center !justify-center cursor-pointer !rounded-lg active:scale-95 !shadow-2xs transition-all !w-6 !h-6 !m-0"
          >
            <Waypoints className="w-3.5 h-3.5 text-text-primary" />
          </ControlButton>

          <ControlButton
            onClick={() => setIsLocked(!isLocked)}
            title={
              isLocked
                ? "Locked: Nodes cannot be moved"
                : "Unlocked: Nodes can be freely dragged"
            }
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !flex !items-center !justify-center cursor-pointer !rounded-lg active:scale-95 !shadow-2xs transition-all !w-6 !h-6 !m-0"
          >
            {isLocked ? (
              <span className="material-icons text-[18px] text-text-primary select-none leading-none">
                lock
              </span>
            ) : (
              <span className="material-icons text-[18px] text-text-primary select-none leading-none">
                lock_open
              </span>
            )}
          </ControlButton>

          <ControlButton
            onClick={handleResetLayout}
            title="Reset Layout — Restore original node positions"
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !flex !items-center !justify-center cursor-pointer !rounded-lg active:scale-95 !shadow-2xs transition-all !w-6 !h-6 !m-0"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-accent-primary" />
          </ControlButton>
        </Controls>
      </ReactFlow>

      {/* Context Menu */}
      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuElementRef}
            style={{
              top: `${contextMenu.position?.y ?? 0}px`,
              left: `${contextMenu.position?.x ?? 0}px`,
              visibility: contextMenu.position ? "visible" : "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-50 w-[270px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto bg-surface-secondary/70 text-text-primary border border-border-medium rounded-2xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 p-3.5 font-sans select-text animate-in fade-in zoom-in-95 text-xs backdrop-blur-md"
          >
            {/* Header Card */}
            <div className="px-2.5 py-2 rounded-xl bg-surface-secondary border border-border-medium shadow-2xs flex items-center justify-between gap-1.5 mb-2.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    contextMenu.node.status === "SUCCESS"
                      ? "bg-state-success-border"
                      : contextMenu.node.status === "FAILURE"
                        ? "bg-state-failure-border"
                        : contextMenu.node.status === "RUNNING"
                          ? "bg-state-running-border"
                          : "bg-text-muted"
                  }`}
                />
                <span
                  className="font-semibold text-xs text-text-primary truncate"
                  title={contextMenu.node.name}
                >
                  {contextMenu.node.name}
                </span>
              </div>
              <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-lg bg-surface-primary text-accent-primary uppercase border border-border-subtle shrink-0">
                {contextMenu.node.type || contextMenu.node.category}
              </span>
            </div>

            {isReadOnlyDebug ? (
              /* Read-Only Node Actions for Nav2 and Replay Mode */
              <div className="space-y-1.5 p-1">
                <button
                  type="button"
                  onClick={() => {
                    onSelectNode(contextMenu.node.id);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-secondary hover:bg-surface-hover border border-border-subtle text-text-primary text-xs font-medium transition-all cursor-pointer shadow-2xs active:scale-95"
                >
                  <Info className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                  <span>View Node Details</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(contextMenu.node.name);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-secondary hover:bg-surface-hover border border-border-subtle text-text-primary text-xs font-medium transition-all cursor-pointer shadow-2xs active:scale-95"
                >
                  <Copy className="w-3.5 h-3.5 text-text-secondary dark:text-text-muted shrink-0" />
                  <span>Copy Node Name</span>
                </button>
              </div>
            ) : (
              <>
                {/* Section 1: Breakpoint Controls */}
                <div className="mb-2.5 p-3 rounded-xl bg-surface-secondary border border-border-medium shadow-2xs">
                  <div className="px-0.5 pb-1.5 text-[10px] font-semibold text-text-primary uppercase tracking-wider flex items-center justify-between font-mono">
                    <span>Breakpoint</span>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        const newOnce = !breakpointOnce;
                        setBreakpointOnce(newOnce);
                        if (
                          contextMenu.node.is_breakpoint &&
                          contextMenu.node.uid &&
                          tree
                        ) {
                          onSetBreakpointOnce?.(
                            tree.tree_id,
                            contextMenu.node.uid,
                            newOnce,
                          );
                        }
                      }}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-xl text-[9px] font-medium cursor-pointer transition-all border select-none ${
                        breakpointOnce
                          ? "bg-state-running-bg border-state-running-border text-state-running-text font-bold shadow-2xs"
                          : "bg-surface-primary border-border-subtle text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      }`}
                      title="Once: Automatically remove breakpoint after it triggers 1 time"
                    >
                      <div
                        className={`w-3 h-3 rounded-full border flex items-center justify-center ${
                          breakpointOnce
                            ? "border-state-running-border bg-state-running-border"
                            : "border-border-medium bg-surface-secondary"
                        }`}
                      >
                        {breakpointOnce && (
                          <span className="w-1 h-1 rounded-full bg-white block" />
                        )}
                      </div>
                      <span>Once</span>
                    </div>
                  </div>

                  {/* Breakpoint Toggle Button */}
                  <button
                    onClick={() => {
                      if (contextMenu.node.uid && onToggleBreakpoint && tree) {
                        onToggleBreakpoint(
                          tree.tree_id,
                          contextMenu.node.uid,
                          breakpointOnce,
                        );
                      }
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-surface-primary hover:bg-surface-hover border border-border-medium text-text-primary text-xs font-semibold transition-all cursor-pointer shadow-2xs active:scale-95"
                  >
                    <div className="flex items-center gap-1.5">
                      {contextMenu.node.is_breakpoint ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-state-bp-border shrink-0" />
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full border border-border-medium bg-surface-secondary shrink-0" />
                      )}
                      <span>
                        {contextMenu.node.is_breakpoint
                          ? "Remove Breakpoint"
                          : "Set Breakpoint"}
                      </span>
                    </div>
                    <kbd className="text-[9px] font-mono px-1.5 py-0.2 rounded-md bg-surface-secondary border border-border-subtle text-accent-primary font-bold">
                      F9
                    </kbd>
                  </button>
                </div>

                {/* Section 2: Fault Injection Suite */}
                <div className="p-3 rounded-xl bg-surface-secondary border border-border-medium shadow-2xs mb-1">
                  <div className="px-0.5 pb-1.5 text-[10px] font-semibold text-text-primary uppercase tracking-wider flex items-center justify-between font-mono">
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3 text-state-fault-text" /> Fault
                      Injection
                    </span>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        const newOnce = !faultOnce;
                        setFaultOnce(newOnce);
                        if (
                          contextMenu.node.fault_mode &&
                          contextMenu.node.fault_mode !== "NONE" &&
                          contextMenu.node.uid &&
                          tree
                        ) {
                          onSetFaultOnce?.(
                            tree.tree_id,
                            contextMenu.node.uid,
                            newOnce,
                          );
                        }
                      }}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-xl text-[9px] font-medium cursor-pointer transition-all border select-none ${
                        faultOnce
                          ? "bg-state-fault-bg border-state-fault-border text-state-fault-text font-bold shadow-2xs"
                          : "bg-surface-primary border-border-subtle text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      }`}
                      title="Override once: Apply fault injection for one tick only"
                    >
                      <div
                        className={`w-3 h-3 rounded-full border flex items-center justify-center ${
                          faultOnce
                            ? "border-state-fault-border bg-state-fault-border"
                            : "border-border-medium bg-surface-secondary"
                        }`}
                      >
                        {faultOnce && (
                          <span className="w-1 h-1 rounded-full bg-white block" />
                        )}
                      </div>
                      <span>Once</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => {
                        if (contextMenu.node.uid && onInjectFault && tree) {
                          onInjectFault(
                            tree.tree_id,
                            contextMenu.node.uid,
                            "FORCE_SUCCESS",
                            undefined,
                            faultOnce,
                          );
                        }
                        setContextMenu(null);
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold transition-all cursor-pointer border shadow-2xs active:scale-95 ${
                        contextMenu.node.fault_mode === "FORCE_SUCCESS"
                          ? "bg-state-success-bg text-state-success-text border-state-success-border font-bold"
                          : "bg-surface-primary hover:bg-surface-hover text-text-primary border-border-subtle"
                      }`}
                      title="Force node to return SUCCESS"
                    >
                      <CheckCircle2 className="w-3 h-3 text-state-success-text shrink-0" />
                      <span className="truncate">Success</span>
                    </button>

                    <button
                      onClick={() => {
                        if (contextMenu.node.uid && onInjectFault && tree) {
                          onInjectFault(
                            tree.tree_id,
                            contextMenu.node.uid,
                            "FORCE_FAILURE",
                            undefined,
                            faultOnce,
                          );
                        }
                        setContextMenu(null);
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold transition-all cursor-pointer border shadow-2xs active:scale-95 ${
                        contextMenu.node.fault_mode === "FORCE_FAILURE"
                          ? "bg-state-failure-bg text-state-failure-text border-state-failure-border font-bold"
                          : "bg-surface-primary hover:bg-surface-hover text-text-primary border-border-subtle"
                      }`}
                      title="Force node to return FAILURE"
                    >
                      <XCircle className="w-3 h-3 text-state-failure-text shrink-0" />
                      <span className="truncate">Failure</span>
                    </button>

                    {activeProtocol !== "groot2" && (
                      <>
                        <button
                          onClick={() => {
                            if (contextMenu.node.uid && onInjectFault && tree) {
                              onInjectFault(
                                tree.tree_id,
                                contextMenu.node.uid,
                                "FORCE_RUNNING",
                                undefined,
                                faultOnce,
                              );
                            }
                            setContextMenu(null);
                          }}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold transition-all cursor-pointer border shadow-2xs active:scale-95 ${
                            contextMenu.node.fault_mode === "FORCE_RUNNING"
                              ? "bg-state-running-bg text-state-running-text border-state-running-border font-bold"
                              : "bg-surface-primary hover:bg-surface-hover text-text-primary border-border-subtle"
                          }`}
                          title="Blocks the tree's ticking thread until cleared; the node does not return RUNNING."
                        >
                          <Play className="w-3 h-3 text-state-running-text shrink-0" />
                          <span className="truncate">Block Tick</span>
                        </button>

                        <button
                          onClick={() => {
                            if (contextMenu.node.uid && onInjectFault && tree) {
                              onInjectFault(
                                tree.tree_id,
                                contextMenu.node.uid,
                                "FORCE_SKIPPED",
                                undefined,
                                faultOnce,
                              );
                            }
                            setContextMenu(null);
                          }}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold transition-all cursor-pointer border shadow-2xs active:scale-95 ${
                            contextMenu.node.fault_mode === "FORCE_SKIPPED"
                              ? "bg-surface-hover text-text-primary border-border-medium font-bold"
                              : "bg-surface-primary hover:bg-surface-hover text-text-primary border-border-subtle"
                          }`}
                          title="Force node to return SKIPPED"
                        >
                          <MinusCircle className="w-3 h-3 text-text-secondary dark:text-text-muted shrink-0" />
                          <span className="truncate">Skipped</span>
                        </button>
                      </>
                    )}
                  </div>

                  {/* Delay Injector */}
                  {activeProtocol !== "groot2" && (
                    <div className="mt-1.5 pt-1.5 border-t border-border-subtle">
                      {!showDelayPicker ? (
                        <button
                          type="button"
                          onClick={() => setShowDelayPicker(true)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-[10px] font-semibold transition-all cursor-pointer border shadow-2xs active:scale-95 ${
                            contextMenu.node.fault_mode === "DELAY"
                              ? "bg-state-fault-bg text-state-fault-text font-bold border-state-fault-border"
                              : "bg-surface-primary hover:bg-surface-hover text-text-primary border-border-subtle"
                          }`}
                          title="Inject artificial delay/sleep before node execution"
                        >
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-state-fault-text shrink-0" />
                            <span>
                              {contextMenu.node.fault_mode === "DELAY"
                                ? `Delay (${contextMenu.node.fault_delay_ms || 0}ms)`
                                : "Inject Delay..."}
                            </span>
                          </div>
                          <span className="text-[9px] text-text-secondary dark:text-text-muted">
                            ▶
                          </span>
                        </button>
                      ) : (
                        <div className="p-2.5 rounded-xl bg-surface-primary border border-border-medium shadow-2xs">
                          <DelayInputControl
                            value={delayInput}
                            onChange={setDelayInput}
                            onApply={() => {
                              if (
                                contextMenu.node.uid &&
                                onInjectFault &&
                                tree
                              ) {
                                onInjectFault(
                                  tree.tree_id,
                                  contextMenu.node.uid,
                                  "DELAY",
                                  delayInput,
                                  faultOnce,
                                );
                              }
                              setContextMenu(null);
                            }}
                            onCancel={() => setShowDelayPicker(false)}
                            applyLabel="Apply"
                            cancelLabel="Back"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Clear Fault Button */}
                  {contextMenu.node.fault_mode &&
                  contextMenu.node.fault_mode !== "NONE" ? (
                    <div className="mt-1.5">
                      <button
                        onClick={() => {
                          if (contextMenu.node.uid && onClearFault && tree) {
                            onClearFault(tree.tree_id, contextMenu.node.uid);
                          }
                          setContextMenu(null);
                        }}
                        className="w-full flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] bg-state-fault-bg hover:opacity-90 border border-state-fault-border text-state-fault-text font-bold transition-all cursor-pointer shadow-2xs active:scale-95"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Clear Fault</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};
