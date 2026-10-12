import React, {
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useState,
} from "react";
import {
  ReactFlow,
  Controls,
  ControlButton,
  Background,
  BackgroundVariant,
  Node,
  Edge,
  Connection,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useUpdateNodeInternals,
  useStoreApi,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { LayoutGrid, Waypoints } from "lucide-react";

import {
  BehaviorTreeDocument,
  BTEditorTree,
  BTEditorNode,
  ValidationIssue,
  BTEditorConnection,
} from "../types";
import {
  getSubTreeTargetId,
  canConnectNodes,
  calculateEditorNodeHeight,
  layoutBehaviorTree,
  buildFullLayoutHierarchy,
} from "../documentModel";
import {
  BTEditorNodeComponent,
  BTEditorNodeData,
} from "./BTEditorNodeComponent";
import { BTEditorSubTreeContainerComponent } from "./BTEditorSubTreeContainerComponent";
import { BTEditorEdge } from "./BTEditorEdge";
import treeStructureIcon from "../../assets/tree-structure.png";

export { calculateEditorNodeHeight } from "../documentModel";

export interface BTEditorCanvasProps {
  document: BehaviorTreeDocument;
  activeTreeId: string;
  selectedTreeId: string;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  validationIssues: ValidationIssue[];
  orientation?: "vertical" | "horizontal";
  openTimestamp?: number;
  onOrientationChange?: (orientation: "vertical" | "horizontal") => void;
  onSelectNode: (nodeId: string | null, treeId?: string) => void;
  onSelectEdge: (edge: BTEditorConnection | null) => void;
  onAddChild: (parentId: string, nodeType?: string, treeId?: string) => void;
  onDuplicate: (nodeId: string, treeId?: string) => void;
  onDelete: (nodeId: string, treeId?: string) => void;
  onReparent: (nodeId: string, newParentId: string, treeId?: string) => void;
  onUpdatePosition: (
    nodeId: string,
    pos: { x: number; y: number },
    treeId?: string,
  ) => void;
  onToggleCollapse?: (nodeId: string) => void;
  onToggleSubTreeExpanded?: (nodeId: string, treeId?: string) => void;
  onSelectTreeTab?: (treeId: string) => void;
  onCreateTree?: (treeId: string) => void;
  onDisconnectEdge?: (
    sourceParentId: string,
    targetChildId: string,
    treeId?: string,
  ) => void;
  onReconnectEdge?: (
    oldParentId: string,
    newParentId: string,
    childId: string,
    treeId?: string,
  ) => { success: boolean; error?: string };
  onDropNewNode: (nodeType: string, position: { x: number; y: number }) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: (nodeId: string, treeId?: string) => void;
  onPaste: (parentId?: string | null, treeId?: string) => void;
  onAutoLayout?: () => void;
  layoutEpoch?: number;
  getPlacementPositionRef?: React.MutableRefObject<
    (() => { x: number; y: number }) | null
  >;
  centerTarget?: { nodeId: string; treeId?: string; timestamp: number } | null;
}

const nodeTypes = {
  editorNode: BTEditorNodeComponent as any,
  subTreeContainer: BTEditorSubTreeContainerComponent as any,
};

const edgeTypes = {
  btEdge: BTEditorEdge as any,
  smoothstep: BTEditorEdge as any,
};

// Calculate the exact center of the currently visible canvas viewport based on current zoom and pan.
// Returns the flow-coordinate position where a new node should be placed to appear at the visual
// center of whatever the user is currently viewing — regardless of pan, zoom, or tree position.
export const calculateAvailableVisiblePosition = (
  viewport: { x: number; y: number; zoom: number },
  containerRect?: {
    width: number;
    height: number;
    left?: number;
    top?: number;
  } | null,
): { x: number; y: number } => {
  const zoom = viewport.zoom > 0 ? viewport.zoom : 1;
  const containerWidth =
    containerRect?.width && containerRect.width > 0
      ? containerRect.width
      : 1000;
  const containerHeight =
    containerRect?.height && containerRect.height > 0
      ? containerRect.height
      : 700;

  // Convert screen-space container center to React Flow graph coordinates.
  // viewport.x / viewport.y are the canvas translation (pan). Dividing by zoom converts to flow coords.
  const viewLeft = -viewport.x / zoom;
  const viewTop = -viewport.y / zoom;
  const viewWidth = containerWidth / zoom;
  const viewHeight = containerHeight / zoom;

  const nodeW = 230;
  const nodeH = 80;

  // Place the node so its center aligns with the visual center of the viewport.
  const centerX = Math.round(viewLeft + (viewWidth - nodeW) / 2);
  const centerY = Math.round(viewTop + (viewHeight - nodeH) / 2);

  return { x: centerX, y: centerY };
};

export const getVisibleViewportCenter = calculateAvailableVisiblePosition;

export const generateEditorGraphElements = (
  document: BehaviorTreeDocument,
  activeTreeId: string,
  orientation: "vertical" | "horizontal" = "vertical",
  collapsedNodes: Set<string> = new Set(),
  selectedNodeId: string | null = null,
  selectedTreeId: string = "",
  selectedEdgeId: string | null = null,
  issueMap: Map<string, { hasError: boolean; hasWarning: boolean }> = new Map(),
  userPositions: Map<string, { x: number; y: number }> = new Map(),
  isOrientationChanged: boolean = false,
  onSelectNode?: (nodeId: string, treeId?: string) => void,
  onAddChild?: (parentId: string, nodeType?: string, treeId?: string) => void,
  onDuplicate?: (nodeId: string, treeId?: string) => void,
  onDelete?: (nodeId: string, treeId?: string) => void,
  onToggleCollapse?: (nodeId: string) => void,
  reconnectingEdgeId?: string | null,
  reconnectingChildId?: string | null,
  reconnectingTreeId?: string | null,
  onStartReconnect?: (
    edgeId: string,
    sourceId: string,
    targetId: string,
    treeId: string,
  ) => void,
  onCancelReconnect?: () => void,
  onDisconnect?: (sourceId: string, targetId: string, treeId: string) => void,
  onSelectEdge?: (
    edgeId: string,
    sourceId: string,
    targetId: string,
    treeId: string,
  ) => void,
  onReconnectEdgeDirect?: (
    oldParentId: string,
    newParentId: string,
    childId: string,
    treeId?: string,
  ) => void,
  onStartEdgeDrag?: (
    event: React.MouseEvent,
    edgeInfo: {
      edgeId: string;
      sourceId: string;
      targetId: string;
      treeId: string;
      sourceFlowId: string;
      targetFlowId: string;
    },
  ) => void,
  activeEdgeDragId?: string | null,
  activeCandidateParentId?: string | null,
  measuredNodeHeights: Map<string, number> = new Map(),
  onNodeResize?: (nodeId: string, height: number) => void,
): { flowNodes: Node[]; flowEdges: Edge[] } => {
  const tree = document.trees[activeTreeId] || null;
  if (!tree || !tree.nodes || Object.keys(tree.nodes).length === 0) {
    return { flowNodes: [], flowEdges: [] };
  }

  const isHorizontal = orientation === "horizontal";
  const targetHandleId = isHorizontal ? "target-left" : "target-top";
  const sourceHandleId = isHorizontal ? "source-right" : "source-bottom";

  interface RawFlowNode {
    flowId: string;
    node: BTEditorNode;
    treeId: string;
    isRoot: boolean;
    isSubTree: boolean;
    isCollapsed: boolean;
    hasChildren: boolean;
  }

  interface RawFlowEdge {
    id: string;
    sourceFlowId: string;
    targetFlowId: string;
    sourceNodeId: string;
    targetNodeId: string;
    treeId: string;
    isRoot?: boolean;
  }

  // 1. Find all top roots in the active tree
  const roots: string[] = [];
  if (tree.rootNodeId && tree.nodes[tree.rootNodeId]) {
    let top = tree.rootNodeId;
    const seen = new Set<string>();
    while (tree.nodes[top]?.parentId && tree.nodes[tree.nodes[top].parentId!]) {
      if (seen.has(top)) break;
      seen.add(top);
      top = tree.nodes[top].parentId!;
    }
    roots.push(top);
  }

  const orphanNodeList = Object.values(tree.nodes).filter(
    (n) => (!n.parentId || !tree.nodes[n.parentId]) && !roots.includes(n.id),
  );
  orphanNodeList.sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
  orphanNodeList.forEach((n) => {
    roots.push(n.id);
  });

  // 2. Compute canonical layout positions for the FULL tree hierarchy (all nodes uncollapsed)
  // This mathematically ensures collapsing/expanding a node NEVER recalculates or shifts existing node positions!
  const { layoutNodeMap: fullLayoutNodeMap, canvasRoots: fullCanvasRoots } =
    buildFullLayoutHierarchy(document, activeTreeId);

  const fullComputedPositions = layoutBehaviorTree(
    fullLayoutNodeMap,
    fullCanvasRoots,
    isHorizontal,
    {
      marginx: 40,
      marginy: 40,
      nodesep: 40,
      ranksep: 80,
      getNodeHeight: (id) =>
        measuredNodeHeights.get(id) || fullLayoutNodeMap[id]?.height || 80,
    },
  );

  // 3. Collect all descendant node IDs of collapsed nodes so they and their edges are visually hidden
  const collapsedSubtreeNodeIds = new Set<string>();
  const markCollapsedDescendants = (
    id: string,
    currentTreeId: string,
    prefix: string = "",
  ) => {
    const currentTree = document.trees[currentTreeId];
    if (!currentTree || !currentTree.nodes[id]) return;
    const n = currentTree.nodes[id];
    const isSub =
      n.category === "SubTree" ||
      n.type === "SubTree" ||
      n.type === "SubTreePlus";
    const targetId = isSub ? getSubTreeTargetId(n, document) : "";
    const targetTree = targetId ? document.trees[targetId] : null;

    if (n.children && n.children.length > 0) {
      n.children.forEach((cid) => {
        const cFlowId = prefix ? `${prefix}:::${cid}` : cid;
        if (!collapsedSubtreeNodeIds.has(cFlowId)) {
          collapsedSubtreeNodeIds.add(cFlowId);
          collapsedSubtreeNodeIds.add(cid);
          markCollapsedDescendants(cid, currentTreeId, prefix);
        }
      });
    }

    if (isSub && targetTree) {
      const subRootId =
        targetTree.rootNodeId || Object.keys(targetTree.nodes)[0];
      if (subRootId && targetTree.nodes[subRootId]) {
        const nextPrefix = prefix
          ? `${prefix}:::sub_${n.id}:::${targetId}`
          : `sub_${n.id}:::${targetId}`;
        const subRootFlowId = `${nextPrefix}:::${subRootId}`;
        collapsedSubtreeNodeIds.add(subRootFlowId);
        collapsedSubtreeNodeIds.add(subRootId);
        markCollapsedDescendants(subRootId, targetId, nextPrefix);
      }
    }
  };

  collapsedNodes.forEach((flowId) => {
    const cleanId = flowId.includes(":::")
      ? flowId.split(":::").pop()!
      : flowId;
    const prefix = flowId.includes(":::")
      ? flowId.substring(0, flowId.lastIndexOf(":::"))
      : "";
    const treeIdCandidate = prefix ? prefix.split(":::").pop()! : activeTreeId;
    const treeId = document.trees[treeIdCandidate]
      ? treeIdCandidate
      : activeTreeId;
    markCollapsedDescendants(cleanId, treeId, prefix);
  });
  Object.keys(tree.nodes).forEach((nId) => {
    if (collapsedNodes.has(nId)) {
      markCollapsedDescendants(nId, activeTreeId);
    }
  });

  // 4. Traverse ONLY visible uncollapsed nodes and edges
  const rawNodes: RawFlowNode[] = [];
  const rawEdges: RawFlowEdge[] = [];
  const visitedFlowIds = new Set<string>();

  const traverseNode = (
    nodeId: string,
    currentTreeId: string,
    parentFlowId?: string,
    prefix: string = "",
  ) => {
    const currentTree = document.trees[currentTreeId];
    if (!currentTree || !currentTree.nodes[nodeId]) return;

    const flowId = prefix ? `${prefix}:::${nodeId}` : nodeId;
    if (visitedFlowIds.has(flowId)) return;
    // Descendants of collapsed nodes are strictly hidden visually!
    if (
      collapsedSubtreeNodeIds.has(flowId) ||
      collapsedSubtreeNodeIds.has(nodeId)
    )
      return;

    visitedFlowIds.add(flowId);
    const currNode = currentTree.nodes[nodeId];

    const isSubTree =
      currNode.category === "SubTree" ||
      currNode.type === "SubTree" ||
      currNode.type === "SubTreePlus";
    const targetTreeId = isSubTree
      ? getSubTreeTargetId(currNode, document)
      : "";
    const targetTree = targetTreeId ? document.trees[targetTreeId] : null;
    const hasSubTreeRoot = Boolean(
      targetTree && (targetTree.rootNodeId || Object.keys(targetTree.nodes)[0]),
    );

    const isNodeCollapsed =
      collapsedNodes.has(flowId) || collapsedNodes.has(currNode.id);

    const hasChildren = isSubTree
      ? hasSubTreeRoot
      : Boolean(currNode.children && currNode.children.length > 0);

    rawNodes.push({
      flowId,
      node: currNode,
      treeId: currentTreeId,
      isRoot: currentTree.rootNodeId === currNode.id,
      isSubTree,
      isCollapsed: isNodeCollapsed,
      hasChildren,
    });

    if (parentFlowId) {
      const edgeId = `edge_${parentFlowId}_${flowId}`;
      const sourceNodeId = parentFlowId.includes(":::")
        ? parentFlowId.split(":::").pop()!
        : parentFlowId;

      rawEdges.push({
        id: edgeId,
        sourceFlowId: parentFlowId,
        targetFlowId: flowId,
        sourceNodeId,
        targetNodeId: currNode.id,
        treeId: currentTreeId,
      });
    }

    // If this node is collapsed, stop traversal: its children and subtree are visually hidden!
    if (!isNodeCollapsed) {
      if (isSubTree && targetTree && targetTreeId !== currentTreeId) {
        const subRootId =
          targetTree.rootNodeId || Object.keys(targetTree.nodes)[0];
        if (subRootId && targetTree.nodes[subRootId]) {
          const nextPrefix = prefix
            ? `${prefix}:::sub_${currNode.id}:::${targetTreeId}`
            : `sub_${currNode.id}:::${targetTreeId}`;
          traverseNode(subRootId, targetTreeId, flowId, nextPrefix);
        }
      }
      if (currNode.children) {
        currNode.children.forEach((childId) => {
          traverseNode(childId, currentTreeId, flowId, prefix);
        });
      }
    }
  };

  // Traverse visible tree from top roots down
  roots.forEach((rootId) => {
    traverseNode(rootId, activeTreeId);
  });

  // Only traverse truly disconnected orphan roots (never children of collapsed nodes)
  const remainingNodes = Object.values(tree.nodes).filter(
    (n) =>
      !visitedFlowIds.has(n.id) &&
      !collapsedSubtreeNodeIds.has(n.id) &&
      (!n.parentId || !tree.nodes[n.parentId]),
  );
  remainingNodes.sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
  remainingNodes.forEach((n) => {
    traverseNode(n.id, activeTreeId);
  });

  // 5. Ensure EVERY visible parent-child relationship across visible rawNodes has an edge
  const rawNodeMap = new Map<string, RawFlowNode>();
  rawNodes.forEach((rn) => rawNodeMap.set(rn.flowId, rn));

  const edgeMap = new Map<string, RawFlowEdge>();
  rawEdges.forEach((re) => edgeMap.set(re.id, re));

  rawNodes.forEach((rn) => {
    if (rn.isCollapsed) return;

    if (rn.node.children && rn.node.children.length > 0) {
      rn.node.children.forEach((childId) => {
        const prefix = rn.flowId.includes(":::")
          ? rn.flowId.substring(0, rn.flowId.lastIndexOf(":::"))
          : "";
        const childFlowId = prefix ? `${prefix}:::${childId}` : childId;
        const childRawNode = rawNodeMap.get(childFlowId);

        if (childRawNode) {
          const edgeId = `edge_${rn.flowId}_${childFlowId}`;
          if (!edgeMap.has(edgeId)) {
            const newEdge: RawFlowEdge = {
              id: edgeId,
              sourceFlowId: rn.flowId,
              targetFlowId: childFlowId,
              sourceNodeId: rn.node.id,
              targetNodeId: childRawNode.node.id,
              treeId: rn.treeId,
              isRoot: rn.isRoot,
            };
            edgeMap.set(edgeId, newEdge);
            rawEdges.push(newEdge);
          }
        }
      });
    }
  });

  // Use the canonical full-tree computed positions so existing nodes never move on collapse/expand!
  const computedPositions = fullComputedPositions;

  // 4. Construct React Flow Node models
  const nodesList: Node[] = rawNodes.map((rn) => {
    const compPos = computedPositions[rn.flowId];

    // Priority 1: userPositions — set by drag-stop OR pre-collapse snapshot.
    // Never discard via a mismatch check: for inline SubTree nodes, rn.node.position
    // lives in the subtree document (a different coordinate space), so comparing it
    // against the outer-canvas userPositions always produces a false mismatch.
    const customPos = !isOrientationChanged
      ? userPositions.get(rn.flowId)
      : undefined;

    // Priority 2: document-saved position (for all nodes, including inline subtree
    // nodes whose canvas position was saved by handleNodeDragStop).
    const hasDocPos =
      !isOrientationChanged &&
      !rn.flowId.includes(":::") &&
      rn.node.position &&
      typeof rn.node.position.x === "number" &&
      typeof rn.node.position.y === "number" &&
      (rn.node.position.x !== 0 || rn.node.position.y !== 0);

    // Priority 3: Dagre computed position — only for nodes that have never been
    // positioned (no user/doc position available).
    const x = customPos
      ? customPos.x
      : hasDocPos
        ? rn.node.position.x
        : compPos
          ? compPos.x
          : rn.node.position?.x || 0;

    const y = customPos
      ? customPos.y
      : hasDocPos
        ? rn.node.position.y
        : compPos
          ? compPos.y
          : rn.node.position?.y || 0;

    const issues = issueMap.get(rn.node.id);
    const isSelected =
      selectedNodeId === rn.node.id && selectedTreeId === rn.treeId;

    const isCandidate = Boolean(
      (activeCandidateParentId && activeCandidateParentId === rn.node.id) ||
      (reconnectingChildId &&
        reconnectingChildId !== rn.node.id &&
        (!reconnectingTreeId || rn.treeId === reconnectingTreeId) &&
        canConnectNodes(document, rn.treeId, rn.node.id, reconnectingChildId)
          .allowed),
    );

    const nodeData: BTEditorNodeData = {
      node: {
        ...rn.node,
        isCollapsed: rn.isCollapsed,
      },
      treeId: rn.treeId,
      isSelected,
      hasErrors: issues?.hasError,
      hasWarnings: issues?.hasWarning,
      isReconnectCandidate: isCandidate,
      onSelectNode: (id: string) => onSelectNode?.(id, rn.treeId),
      onAddChild: (pId: string) => onAddChild?.(pId, undefined, rn.treeId),
      onDuplicate: (id: string) => onDuplicate?.(id, rn.treeId),
      onDelete: (id: string) => onDelete?.(id, rn.treeId),
      onToggleCollapse: () => onToggleCollapse?.(rn.flowId),
      orientation,
    };

    const h =
      measuredNodeHeights.get(rn.flowId) || calculateEditorNodeHeight(rn.node);
    const nodeHandles = isHorizontal
      ? [
          {
            id: "target-left",
            type: "target" as const,
            position: Position.Left,
            x: -5,
            y: Math.round(h / 2) - 6,
            width: 12,
            height: 12,
          },
          {
            id: "source-right",
            type: "source" as const,
            position: Position.Right,
            x: 223,
            y: Math.round(h / 2) - 6,
            width: 12,
            height: 12,
          },
        ]
      : [
          {
            id: "target-top",
            type: "target" as const,
            position: Position.Top,
            x: 109,
            y: -5,
            width: 12,
            height: 12,
          },
          {
            id: "source-bottom",
            type: "source" as const,
            position: Position.Bottom,
            x: 109,
            y: h - 5,
            width: 12,
            height: 12,
          },
        ];

    return {
      id: rn.flowId,
      type: "editorNode",
      position: { x, y },
      width: 230,
      height: h,
      initialWidth: 230,
      initialHeight: h,
      style: { width: 230, minHeight: h },
      handles: nodeHandles,
      data: nodeData as any,
    };
  });

  // 5. Construct React Flow Edge models
  const edgesList: Edge[] = rawEdges.map((re) => {
    const isSelected = selectedEdgeId === re.id;
    const isBeingDragged = activeEdgeDragId === re.id;
    const isRelated =
      selectedNodeId === re.sourceNodeId || selectedNodeId === re.targetNodeId;

    return {
      id: re.id,
      source: re.sourceFlowId,
      target: re.targetFlowId,
      sourceHandle: sourceHandleId,
      targetHandle: targetHandleId,
      type: "btEdge",
      reconnectable: true,
      animated: isSelected || isBeingDragged,
      style: {
        stroke: isBeingDragged
          ? "#F59E0B"
          : isSelected
            ? "#0284C7"
            : isRelated
              ? "#0284C7"
              : "#64748B",
        strokeWidth: isBeingDragged
          ? 3.5
          : isSelected
            ? 3.5
            : isRelated
              ? 2.5
              : 2,
        filter:
          isSelected || isBeingDragged
            ? "drop-shadow(0 0 6px rgba(2,132,199,0.7))"
            : undefined,
        opacity: isBeingDragged ? 0.35 : 1,
      },
      data: {
        sourceId: re.sourceNodeId,
        targetId: re.targetNodeId,
        treeId: re.treeId,
        sourceFlowId: re.sourceFlowId,
        targetFlowId: re.targetFlowId,
        isBeingDragged,
        onReconnect: (
          edgeId: string,
          oldParentId: string,
          newParentId: string,
          childId: string,
          treeId: string,
        ) => {
          onReconnectEdgeDirect?.(oldParentId, newParentId, childId, treeId);
        },
        onSelectEdge,
        onStartEdgeDrag,
      },
    };
  });

  return { flowNodes: nodesList, flowEdges: edgesList };
};

const BTEditorCanvasInner: React.FC<BTEditorCanvasProps> = ({
  document,
  activeTreeId,
  selectedTreeId,
  selectedNodeId,
  selectedEdgeId,
  validationIssues,
  orientation,
  openTimestamp,
  onOrientationChange,
  onSelectNode,
  onSelectEdge,
  onAddChild,
  onDuplicate,
  onDelete,
  onReparent,
  onUpdatePosition,
  onToggleCollapse,
  onToggleSubTreeExpanded,
  onDisconnectEdge,
  onReconnectEdge,
  onDropNewNode,
  onUndo,
  onRedo,
  onCopy,
  onPaste,
  onAutoLayout,
  layoutEpoch,
  getPlacementPositionRef,
  centerTarget,
}) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getViewport, fitView, setCenter } =
    useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const storeApi = useStoreApi();
  if (typeof window !== "undefined") {
    (window as any).__RF_STORE__ = storeApi;
  }

  const isHorizontal = orientation === "horizontal";
  const tree = document.trees[activeTreeId] || null;

  // Lock state: when true, nodes cannot be dragged, matching Monitor
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [measuredNodeHeights, setMeasuredNodeHeights] = useState<
    Map<string, number>
  >(new Map());
  const handleNodeResize = useCallback((nodeId: string, height: number) => {
    setMeasuredNodeHeights((previous) => {
      if (previous.get(nodeId) === height) return previous;
      const next = new Map(previous);
      next.set(nodeId, height);
      return next;
    });
  }, []);
  useEffect(() => {
    setMeasuredNodeHeights(new Map());
  }, [activeTreeId, orientation]);

  // Set of collapsed node IDs in visual graph
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  // Reset collapsed nodes when opening a new document or switching trees
  useEffect(() => {
    setCollapsedNodes(new Set());
  }, [openTimestamp, activeTreeId]);

  // Track user-dragged node positions (keyed by flow node ID)
  const userPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const lastActiveTreeIdRef = useRef<string>(activeTreeId);
  const lastOrientationRef = useRef<"vertical" | "horizontal" | undefined>(
    orientation,
  );
  const lastOpenTimestampRef = useRef<number | undefined>(openTimestamp);
  const lastLayoutEpochRef = useRef<number | undefined>(layoutEpoch);

  // Set to true by handleToggleCollapse so the sync effect knows to preserve
  // current canvas positions rather than overwriting them from flowNodes.
  const isCollapseUpdateRef = useRef<boolean>(false);

  // Clear user-dragged positions when switching trees, orientation, opening a file, or triggering auto-layout
  const isOrientationChanged = lastOrientationRef.current !== orientation;
  const isTreeChanged = lastActiveTreeIdRef.current !== activeTreeId;
  const isOpenChanged =
    openTimestamp !== undefined &&
    lastOpenTimestampRef.current !== openTimestamp;
  const isLayoutEpochChanged =
    layoutEpoch !== undefined && lastLayoutEpochRef.current !== layoutEpoch;

  if (
    isOrientationChanged ||
    isTreeChanged ||
    isOpenChanged ||
    isLayoutEpochChanged
  ) {
    userPositionsRef.current.clear();
    lastOrientationRef.current = orientation;
    lastActiveTreeIdRef.current = activeTreeId;
    lastOpenTimestampRef.current = openTimestamp;
    lastLayoutEpochRef.current = layoutEpoch;
  }

  // Map of node validation issues
  const issueMap = useMemo(() => {
    const map = new Map<string, { hasError: boolean; hasWarning: boolean }>();
    validationIssues.forEach((i) => {
      if (!i.nodeId) return;
      const cur = map.get(i.nodeId) || { hasError: false, hasWarning: false };
      if (i.severity === "error") cur.hasError = true;
      if (i.severity === "warning") cur.hasWarning = true;
      map.set(i.nodeId, cur);
    });
    return map;
  }, [validationIssues]);

  // Toggle collapse/expand for nodes (both regular nodes and SubTrees)
  const handleToggleCollapse = useCallback(
    (nodeId: string) => {
      // Snapshot every currently-rendered node's canvas position into userPositionsRef
      // BEFORE the state change triggers a re-render. This makes the live canvas
      // positions the authoritative source of truth for the next generateEditorGraphElements
      // call, preventing any Dagre-computed position from overwriting visible nodes.
      flowNodesRef.current.forEach((n) => {
        userPositionsRef.current.set(n.id, {
          x: n.position.x,
          y: n.position.y,
        });
      });

      // Mark this update as a collapse/expand so the sync effect preserves
      // current canvas positions instead of applying recalculated flowNodes positions.
      isCollapseUpdateRef.current = true;

      setCollapsedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
      if (onToggleCollapse) {
        onToggleCollapse(nodeId);
      }
    },
    [onToggleCollapse],
  );

  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Direct edge reconnect handler
  const handleDirectReconnect = useCallback(
    (
      oldParentId: string,
      newParentId: string,
      childId: string,
      treeId?: string,
    ) => {
      const targetTree = treeId || activeTreeId;
      if (onReconnectEdge) {
        const res = onReconnectEdge(
          oldParentId,
          newParentId,
          childId,
          targetTree,
        );
        if (res.success) {
          const newParentNode = document.trees[targetTree]?.nodes[newParentId];
          const newParentName = newParentNode?.name || newParentId;
          setFeedbackMessage({
            type: "success",
            text: `Connection moved to "${newParentName}"`,
          });
          setTimeout(() => setFeedbackMessage(null), 3000);
        } else if (res.error) {
          setFeedbackMessage({
            type: "error",
            text: res.error || "Cannot connect to this node",
          });
          setTimeout(() => setFeedbackMessage(null), 4000);
        }
      }
    },
    [activeTreeId, document, onReconnectEdge],
  );

  const handleNodeClick = useCallback(
    (nodeId: string, treeId?: string) => {
      onSelectNode(nodeId, treeId);
    },
    [onSelectNode],
  );

  const onAddChildRef = useRef(onAddChild);
  onAddChildRef.current = onAddChild;
  const onDuplicateRef = useRef(onDuplicate);
  onDuplicateRef.current = onDuplicate;
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  const stableOnAddChild = useCallback(
    (pId: string, nodeType?: string, treeId?: string) => {
      onAddChildRef.current?.(pId, nodeType, treeId);
    },
    [],
  );

  const stableOnDuplicate = useCallback((nodeId: string, treeId?: string) => {
    onDuplicateRef.current?.(nodeId, treeId);
  }, []);

  const stableOnDelete = useCallback((nodeId: string, treeId?: string) => {
    onDeleteRef.current?.(nodeId, treeId);
  }, []);

  const handleDisconnectEdge = useCallback(
    (sourceId: string, targetId: string, treeId: string) => {
      onSelectEdge(null);
      if (onDisconnectEdge) {
        onDisconnectEdge(sourceId, targetId, treeId);
      }
    },
    [onDisconnectEdge, onSelectEdge],
  );

  const handleSelectEdge = useCallback(
    (edgeId: string, sourceId: string, targetId: string, treeId: string) => {
      onSelectEdge({
        id: edgeId,
        source: sourceId,
        target: targetId,
        treeId,
      });
      onSelectNode(null);
    },
    [onSelectEdge, onSelectNode],
  );

  // Dynamic Direct Edge Drag & Drop State
  interface ActiveEdgeDrag {
    edgeId: string;
    sourceId: string;
    targetId: string;
    treeId: string;
    sourceFlowId: string;
    targetFlowId: string;
    childHandleFlowPos: { x: number; y: number };
    cursorFlowPos: { x: number; y: number };
    childHandleScreenPos: { x: number; y: number };
    cursorScreenPos: { x: number; y: number };
    candidateParentId: string | null;
    candidateParentName?: string;
    candidateHandleFlowPos?: { x: number; y: number };
    candidateHandleScreenPos?: { x: number; y: number };
    isValidCandidate: boolean;
    validationReason?: string;
  }

  const [activeEdgeDrag, setActiveEdgeDrag] = useState<ActiveEdgeDrag | null>(
    null,
  );
  const activeEdgeDragRef = useRef<ActiveEdgeDrag | null>(null);
  activeEdgeDragRef.current = activeEdgeDrag;
  const flowNodesRef = useRef<Node[]>([]);
  // Track whether a node drag is in progress. While true, the flowNodes→setNodes
  // sync effect must NOT overwrite React Flow's live drag positions.
  const isDraggingNodeRef = useRef<boolean>(false);
  // Holds the latest flowNodes that arrived while a drag was in progress, so they
  // can be applied the moment the drag ends.
  const pendingFlowNodesRef = useRef<Node[] | null>(null);

  // Drag directly from edge/path hit area to connect to another node
  const handleStartEdgeDrag = useCallback(
    (
      event: React.MouseEvent | React.PointerEvent,
      edgeInfo: {
        edgeId: string;
        sourceId: string;
        targetId: string;
        treeId: string;
        sourceFlowId: string;
        targetFlowId: string;
      },
    ) => {
      event.stopPropagation();
      if (isLocked) return;

      const startScreenX = event.clientX;
      const startScreenY = event.clientY;
      let hasDragged = false;

      // Locate child node to anchor the live connection curve
      const childNode = flowNodesRef.current.find(
        (n) => n.id === edgeInfo.targetFlowId || n.id === edgeInfo.targetId,
      );

      const isHoriz = orientation === "horizontal";
      const childFlowPos = childNode
        ? {
            x: isHoriz ? childNode.position.x : childNode.position.x + 115,
            y: isHoriz
              ? childNode.position.y + (childNode.height || 80) / 2
              : childNode.position.y,
          }
        : screenToFlowPosition({ x: startScreenX, y: startScreenY });

      const onPointerMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startScreenX;
        const dy = moveEvent.clientY - startScreenY;
        if (!hasDragged && Math.hypot(dx, dy) < 4) {
          return;
        }
        hasDragged = true;

        const currentCursorFlowPos = screenToFlowPosition({
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });

        const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
        const cursorScreenPos = wrapperRect
          ? {
              x: moveEvent.clientX - wrapperRect.left,
              y: moveEvent.clientY - wrapperRect.top,
            }
          : { x: moveEvent.clientX, y: moveEvent.clientY };

        const { x: vX, y: vY, zoom } = getViewport();
        const childHandleScreenPos = {
          x: childFlowPos.x * zoom + vX,
          y: childFlowPos.y * zoom + vY,
        };

        // Detect if cursor is hovering over a candidate parent node
        let foundCandidateId: string | null = null;
        let foundCandidateName: string | undefined = undefined;
        let candidateHandleFlowPos: { x: number; y: number } | undefined =
          undefined;
        let candidateHandleScreenPos: { x: number; y: number } | undefined =
          undefined;
        let isValid = false;
        let reason = "";

        for (const fn of flowNodesRef.current) {
          const w = fn.width || 230;
          const h = fn.height || 80;
          if (
            currentCursorFlowPos.x >= fn.position.x - 14 &&
            currentCursorFlowPos.x <= fn.position.x + w + 14 &&
            currentCursorFlowPos.y >= fn.position.y - 14 &&
            currentCursorFlowPos.y <= fn.position.y + h + 14
          ) {
            const cleanCandidateId = fn.id.includes(":::")
              ? fn.id.split(":::").pop()!
              : fn.id;
            if (cleanCandidateId === edgeInfo.targetId) {
              isValid = false;
              reason = "Cannot connect a node to itself";
              foundCandidateId = cleanCandidateId;
              break;
            }

            foundCandidateId = cleanCandidateId;
            const nodeData = fn.data as unknown as BTEditorNodeData | undefined;
            foundCandidateName =
              nodeData?.node?.name || nodeData?.node?.type || cleanCandidateId;

            const check = canConnectNodes(
              document,
              edgeInfo.treeId,
              cleanCandidateId,
              edgeInfo.targetId,
            );
            isValid = check.allowed;
            reason = check.reason || "";

            candidateHandleFlowPos = {
              x: isHoriz ? fn.position.x + w : fn.position.x + 115,
              y: isHoriz ? fn.position.y + h / 2 : fn.position.y + h,
            };
            candidateHandleScreenPos = {
              x: candidateHandleFlowPos.x * zoom + vX,
              y: candidateHandleFlowPos.y * zoom + vY,
            };
            break;
          }
        }

        const nextState: ActiveEdgeDrag = {
          edgeId: edgeInfo.edgeId,
          sourceId: edgeInfo.sourceId,
          targetId: edgeInfo.targetId,
          treeId: edgeInfo.treeId,
          sourceFlowId: edgeInfo.sourceFlowId,
          targetFlowId: edgeInfo.targetFlowId,
          childHandleFlowPos: childFlowPos,
          cursorFlowPos: currentCursorFlowPos,
          childHandleScreenPos,
          cursorScreenPos,
          candidateParentId: foundCandidateId,
          candidateParentName: foundCandidateName,
          candidateHandleFlowPos,
          candidateHandleScreenPos,
          isValidCandidate: isValid,
          validationReason: reason,
        };

        setActiveEdgeDrag(nextState);
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);

        const currentDrag = activeEdgeDragRef.current;
        setActiveEdgeDrag(null);

        if (!hasDragged) {
          handleSelectEdge(
            edgeInfo.edgeId,
            edgeInfo.sourceId,
            edgeInfo.targetId,
            edgeInfo.treeId,
          );
          return;
        }

        if (
          currentDrag &&
          currentDrag.candidateParentId &&
          currentDrag.isValidCandidate &&
          currentDrag.candidateParentId !== currentDrag.sourceId
        ) {
          handleDirectReconnect(
            currentDrag.sourceId,
            currentDrag.candidateParentId,
            currentDrag.targetId,
            currentDrag.treeId,
          );
        }
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [
      isLocked,
      orientation,
      screenToFlowPosition,
      getViewport,
      document,
      handleSelectEdge,
      handleDirectReconnect,
    ],
  );

  // Generate hierarchical layout using Dagre with inlined SubTrees like Monitor
  const { flowNodes, flowEdges } = useMemo(() => {
    return generateEditorGraphElements(
      document,
      activeTreeId,
      orientation,
      collapsedNodes,
      selectedNodeId,
      selectedTreeId,
      selectedEdgeId,
      issueMap,
      userPositionsRef.current,
      isOrientationChanged,
      handleNodeClick,
      stableOnAddChild,
      stableOnDuplicate,
      stableOnDelete,
      handleToggleCollapse,
      null,
      null,
      null,
      undefined,
      undefined,
      handleDisconnectEdge,
      handleSelectEdge,
      handleDirectReconnect,
      handleStartEdgeDrag,
      activeEdgeDrag?.edgeId,
      activeEdgeDrag?.isValidCandidate
        ? activeEdgeDrag.candidateParentId
        : null,
      measuredNodeHeights,
      handleNodeResize,
    );
  }, [
    document,
    activeTreeId,
    orientation,
    collapsedNodes,
    selectedNodeId,
    selectedTreeId,
    selectedEdgeId,
    issueMap,
    measuredNodeHeights,
    handleNodeResize,
    isOrientationChanged,
    handleNodeClick,
    stableOnAddChild,
    stableOnDuplicate,
    stableOnDelete,
    handleToggleCollapse,
    handleDisconnectEdge,
    handleSelectEdge,
    handleDirectReconnect,
    handleStartEdgeDrag,
    activeEdgeDrag?.edgeId,
    activeEdgeDrag?.candidateParentId,
    activeEdgeDrag?.isValidCandidate,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [pathMode, setPathMode] = useState<"orthogonal" | "bezier">(
    "orthogonal",
  );
  const editorFlowEdges = useMemo(
    () =>
      flowEdges.map((edge) => ({ ...edge, data: { ...edge.data, pathMode } })),
    [flowEdges, pathMode],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(editorFlowEdges);

  // Expose visible placement position calculation to parent.
  // The returned function reads the live viewport and container dimensions at call-time so that
  // the position always reflects where the user is looking at the moment they add a node.
  useEffect(() => {
    if (getPlacementPositionRef) {
      getPlacementPositionRef.current = () => {
        const viewport = getViewport();
        const rect = reactFlowWrapper.current?.getBoundingClientRect() || null;
        return calculateAvailableVisiblePosition(viewport, rect);
      };
    }
  }, [getViewport, getPlacementPositionRef]);

  // Synchronize when flow nodes or flow edges change.
  // For collapse/expand (isCollapseUpdateRef.current === true), use the functional
  // form of setNodes so we never overwrite the current canvas positions of visible
  // nodes. React Flow's prevNodes is the ground truth: existing nodes keep their
  // current x/y, and only newly-revealed nodes (not in prevNodes) get the position
  // from flowNodes (which already has the pre-collapse snapshot via userPositionsRef).
  //
  // While a node drag is in progress (isDraggingNodeRef.current === true) we must
  // NOT call setNodes at all — doing so would overwrite React Flow's live drag
  // position and cause the jitter/snap-back feedback loop. Instead we stash the
  // latest flowNodes in pendingFlowNodesRef and apply them in handleNodeDragStop
  // once the drag has completed.
  useEffect(() => {
    if (isDraggingNodeRef.current) {
      // Drag in progress — defer the update so we never clobber RF's drag state.
      pendingFlowNodesRef.current = flowNodes;
      // Always sync edges immediately (they don't participate in node dragging).
      setEdges(editorFlowEdges);
      return;
    }

    if (isCollapseUpdateRef.current) {
      isCollapseUpdateRef.current = false;
      setNodes((prevNodes) => {
        const prevPosById = new Map(prevNodes.map((n) => [n.id, n.position]));
        return flowNodes.map((n) => ({
          ...n,
          position: prevPosById.has(n.id) ? prevPosById.get(n.id)! : n.position,
        }));
      });
    } else {
      setNodes(flowNodes);
    }
    setEdges(editorFlowEdges);
    flowNodesRef.current = flowNodes;
  }, [flowNodes, editorFlowEdges, setNodes, setEdges]);

  // Keep flowNodesRef synchronized with latest nodes
  useEffect(() => {
    flowNodesRef.current = nodes;
  }, [nodes]);

  // Stable refs for setCenter / getViewport so the effect below only fires when
  // centerTarget itself changes — not when React Flow recreates these functions.
  const setCenterRef = useRef(setCenter);
  setCenterRef.current = setCenter;
  const getViewportRef = useRef(getViewport);
  getViewportRef.current = getViewport;
  const treeRef = useRef(tree);
  treeRef.current = tree;

  // Focus and center viewport ONLY when the user clicks "Inspect" for a validation issue.
  // This must NOT fire on normal node clicks, inspector opens, edits, or any other interaction.
  useEffect(() => {
    if (!centerTarget) return;

    // If target node is inside a collapsed subtree or parent, un-collapse it so it becomes visible
    setCollapsedNodes((prev) => {
      if (prev.size === 0) return prev;
      let next = prev;
      const targetId = centerTarget.nodeId;
      const currentTree = treeRef.current;
      for (const cid of prev) {
        const cleanCid = cid.includes(":::") ? cid.split(":::").pop()! : cid;
        if (cleanCid === targetId || cid === targetId) {
          if (next === prev) next = new Set(prev);
          next.delete(cid);
        } else if (currentTree?.nodes[cleanCid]) {
          const queue = [cleanCid];
          while (queue.length > 0) {
            const currId = queue.shift()!;
            const currNode = currentTree.nodes[currId];
            if (currNode?.children) {
              if (currNode.children.includes(targetId)) {
                if (next === prev) next = new Set(prev);
                next.delete(cid);
                break;
              }
              queue.push(...currNode.children);
            }
          }
        }
      }
      return next;
    });

    const targetFlowId = centerTarget.nodeId;
    const centerOnTarget = () => {
      const target = flowNodesRef.current.find((n) => {
        const cleanId = n.id.includes(":::") ? n.id.split(":::").pop()! : n.id;
        return cleanId === targetFlowId || n.id === targetFlowId;
      });

      if (target) {
        const w = target.width || 230;
        const h = target.height || 80;
        const targetCenterX = target.position.x + w / 2;
        const targetCenterY = target.position.y + h / 2;
        const currentZoom = getViewportRef.current().zoom || 1;
        setCenterRef.current(targetCenterX, targetCenterY, {
          duration: 400,
          zoom: currentZoom,
        });
      }
    };

    centerOnTarget();
    const timer = setTimeout(centerOnTarget, 60);
    return () => clearTimeout(timer);
    // ONLY depend on centerTarget — using refs for setCenter/getViewport/tree ensures
    // that tree edits, node selections, and other interactions never trigger centering.
  }, [centerTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute Bezier curve for live direct edge drag
  const reconnectPathD = useMemo(() => {
    if (!activeEdgeDrag) return "";
    const isHoriz = orientation === "horizontal";
    const startX = activeEdgeDrag.childHandleScreenPos.x;
    const startY = activeEdgeDrag.childHandleScreenPos.y;
    const endX =
      activeEdgeDrag.candidateHandleScreenPos?.x ??
      activeEdgeDrag.cursorScreenPos.x;
    const endY =
      activeEdgeDrag.candidateHandleScreenPos?.y ??
      activeEdgeDrag.cursorScreenPos.y;

    if (isHoriz) {
      const dx = endX - startX;
      const cx1 = startX - Math.max(30, Math.abs(dx) * 0.4);
      const cx2 = endX + Math.max(30, Math.abs(dx) * 0.4);
      return `M ${startX} ${startY} C ${cx1} ${startY}, ${cx2} ${endY}, ${endX} ${endY}`;
    } else {
      const dy = endY - startY;
      const cy1 = startY - Math.max(30, Math.abs(dy) * 0.4);
      const cy2 = endY + Math.max(30, Math.abs(dy) * 0.4);
      return `M ${startX} ${startY} C ${startX} ${cy1}, ${endX} ${cy2}, ${endX} ${endY}`;
    }
  }, [activeEdgeDrag, orientation]);

  // Ensure node handles are measured whenever nodes update
  useEffect(() => {
    if (nodes.length > 0) {
      updateNodeInternals(nodes.map((n) => n.id));
    }
  }, [nodes, updateNodeInternals]);

  // Auto-fit view ONLY when opening XML, changing tree, or switching orientation.
  // We intentionally exclude fitView and updateNodeInternals from the dependency array
  // and capture them via refs so that unstable references (common in React Flow) cannot
  // cause spurious fitView calls on node selection, inspector open, or other interactions.
  const fitViewRef = useRef(fitView);
  fitViewRef.current = fitView;
  const updateNodeInternalsRef = useRef(updateNodeInternals);
  updateNodeInternalsRef.current = updateNodeInternals;

  // A stable "auto-fit trigger" that only changes on the events that should reset the view.
  // Intentionally exclude fitView / updateNodeInternals to avoid spurious re-runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (flowNodes.length === 0) return;
    updateNodeInternalsRef.current(flowNodes.map((n) => n.id));
    const timer = setTimeout(() => {
      if (isDraggingNodeRef.current) return;
      fitViewRef.current({
        padding: 0.2,
        minZoom: 0.2,
        maxZoom: 1.5,
        duration: 200,
      });
    }, 50);
    return () => clearTimeout(timer);
    // Only re-run when tree identity, orientation, or file actually changes — NOT on selection.
  }, [activeTreeId, orientation, openTimestamp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Drag & Drop from Palette
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData("application/bt-node-type");
      if (!nodeType || !reactFlowWrapper.current) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      onDropNewNode(nodeType, position);
    },
    [screenToFlowPosition, onDropNewNode],
  );

  // Handle Edge Connection (Reparenting child to parent)
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (
        connection.source &&
        connection.target &&
        connection.source !== connection.target
      ) {
        const sourceNode = flowNodesRef.current.find(
          (node) => node.id === connection.source,
        );
        const targetNode = flowNodesRef.current.find(
          (node) => node.id === connection.target,
        );
        const sourceData = sourceNode?.data as BTEditorNodeData | undefined;
        const targetData = targetNode?.data as BTEditorNodeData | undefined;
        const sourceId =
          sourceData?.node.id || connection.source.split(":::").pop()!;
        const childId =
          targetData?.node.id || connection.target.split(":::").pop()!;
        const treeId = sourceData?.node
          ? (sourceNode?.data?.treeId as string)
          : activeTreeId;

        if (
          !treeId ||
          !canConnectNodes(document, treeId, sourceId, childId).allowed
        ) {
          return;
        }

        onReparent(childId, sourceId, treeId);
      }
    },
    [document, onReparent, activeTreeId],
  );

  // Handle Edge Click (select edge to show Disconnect and Reconnect buttons directly on path)
  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();
      const sourceId = (edge.data?.sourceId as string) || edge.source;
      const targetId = (edge.data?.targetId as string) || edge.target;
      const treeId = (edge.data?.treeId as string) || activeTreeId;

      onSelectEdge({
        id: edge.id,
        source: sourceId,
        target: targetId,
        treeId,
      });
      onSelectNode(null);
    },
    [activeTreeId, onSelectEdge, onSelectNode],
  );

  // Mark drag start — suppress flowNodes→setNodes sync while the user is dragging.
  const handleNodeDragStart = useCallback(() => {
    isDraggingNodeRef.current = true;
    pendingFlowNodesRef.current = null;
  }, []);

  // Handle Node Position drag stop
  const handleNodeDragStop = useCallback(
    (_: any, node: Node) => {
      // Clear the drag flag BEFORE persisting — onUpdatePosition triggers a
      // document update which causes flowNodes to recompute. The sync effect
      // will then see isDraggingNodeRef.current === false and apply the update
      // normally (or we flush pendingFlowNodesRef explicitly below).
      isDraggingNodeRef.current = false;

      // Persist the final dragged position into userPositions and the document.
      userPositionsRef.current.set(node.id, {
        x: node.position.x,
        y: node.position.y,
      });
      if (node.id.includes(":::")) {
        const parts = node.id.split(":::");
        const targetTreeId = parts[parts.length - 2];
        const innerNodeId = parts[parts.length - 1];
        onUpdatePosition(innerNodeId, node.position, targetTreeId);
      } else {
        onUpdatePosition(node.id, node.position, activeTreeId);
      }

      // If any flowNodes update was deferred during the drag, apply it now.
      // This keeps non-dragged nodes and edges consistent with the document model.
      if (pendingFlowNodesRef.current) {
        const pending = pendingFlowNodesRef.current;
        pendingFlowNodesRef.current = null;
        setNodes((prevNodes) => {
          // Keep the dragged node's final position from prevNodes (RF ground truth);
          // apply document-computed positions for all other nodes.
          const prevPosById = new Map(prevNodes.map((n) => [n.id, n.position]));
          return pending.map((n) =>
            n.id === node.id
              ? { ...n, position: node.position }
              : { ...n, position: prevPosById.get(n.id) ?? n.position },
          );
        });
        flowNodesRef.current = pending;
      }
    },
    [onUpdatePosition, activeTreeId, setNodes],
  );

  // Orientation switch matching Monitor
  const handleOrientationSwitch = useCallback(
    (nextOrientation: "vertical" | "horizontal") => {
      userPositionsRef.current.clear();
      if (onOrientationChange) {
        onOrientationChange(nextOrientation);
      }
    },
    [onOrientationChange],
  );

  // Reset all dragged positions back to default Dagre tree layout
  const handleResetLayout = useCallback(() => {
    userPositionsRef.current.clear();
    setCollapsedNodes(new Set());
    if (onAutoLayout) {
      onAutoLayout();
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flowNodes.forEach((n) => updateNodeInternals(n.id));
        fitView({ padding: 0.2, minZoom: 0.2, maxZoom: 1.5, duration: 350 });
      });
    });
  }, [onAutoLayout, flowNodes, updateNodeInternals, fitView]);

  // Global Keyboard Shortcuts (Delete, Undo, Redo, Copy, Paste)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEdgeId && onDisconnectEdge) {
          e.preventDefault();
          const edge = flowEdges.find((ed) => ed.id === selectedEdgeId);
          if (edge) {
            const sourceId = (edge.data?.sourceId as string) || edge.source;
            const targetId = (edge.data?.targetId as string) || edge.target;
            const treeId = (edge.data?.treeId as string) || activeTreeId;
            onDisconnectEdge(sourceId, targetId, treeId);
          }
        } else if (selectedNodeId) {
          e.preventDefault();
          onDelete(selectedNodeId, selectedTreeId);
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" || e.key === "Z") {
          e.preventDefault();
          if (e.shiftKey) {
            onRedo();
          } else {
            onUndo();
          }
        } else if (e.key === "y" || e.key === "Y") {
          e.preventDefault();
          onRedo();
        } else if (e.key === "c" || e.key === "C") {
          if (selectedNodeId) {
            e.preventDefault();
            onCopy(selectedNodeId, selectedTreeId);
          }
        } else if (e.key === "v" || e.key === "V") {
          e.preventDefault();
          onPaste(undefined, selectedTreeId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedNodeId,
    selectedTreeId,
    selectedEdgeId,
    flowEdges,
    activeTreeId,
    onDelete,
    onDisconnectEdge,
    onUndo,
    onRedo,
    onCopy,
    onPaste,
  ]);

  // Check whether a prospective connection is allowed
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;

      const sourceNode = flowNodesRef.current.find(
        (node) => node.id === connection.source,
      );
      const targetNode = flowNodesRef.current.find(
        (node) => node.id === connection.target,
      );
      const sourceData = sourceNode?.data as BTEditorNodeData | undefined;
      const targetData = targetNode?.data as BTEditorNodeData | undefined;
      const sourceId =
        sourceData?.node.id || connection.source.split(":::").pop()!;
      const childId =
        targetData?.node.id || connection.target.split(":::").pop()!;
      const treeId = sourceData?.node
        ? (sourceNode?.data?.treeId as string)
        : activeTreeId;

      return treeId
        ? canConnectNodes(document, treeId, sourceId, childId).allowed
        : false;
    },
    [document, activeTreeId],
  );

  // Handle Edge Reconnection (dragging an edge directly to connect to another node)
  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      const sourceId = (oldEdge.data?.sourceId as string) || oldEdge.source;
      const targetId = (oldEdge.data?.targetId as string) || oldEdge.target;
      const treeId = (oldEdge.data?.treeId as string) || activeTreeId;

      const newParentId = newConnection.source
        ? newConnection.source.includes(":::")
          ? newConnection.source.split(":::").pop()!
          : newConnection.source
        : sourceId;
      const newChildId = newConnection.target
        ? newConnection.target.includes(":::")
          ? newConnection.target.split(":::").pop()!
          : newConnection.target
        : targetId;

      if (newParentId !== sourceId) {
        handleDirectReconnect(sourceId, newParentId, targetId, treeId);
      } else if (newChildId !== targetId) {
        handleDirectReconnect(sourceId, newParentId, newChildId, treeId);
      }
    },
    [activeTreeId, handleDirectReconnect],
  );

  return (
    <div
      ref={reactFlowWrapper}
      className="w-full h-full relative bg-canvas select-text"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => {
        onSelectNode(null);
        onSelectEdge(null);
      }}
    >
      {/* Floating Feedback Toast */}
      {feedbackMessage && (
        <div
          className={`absolute top-16 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-xl shadow-xl text-xs font-medium flex items-center gap-2 border transition-all pointer-events-auto ${
            feedbackMessage.type === "success"
              ? "bg-emerald-600 text-white border-emerald-400 backdrop-blur-xs"
              : "bg-rose-600 text-white border-rose-400 backdrop-blur-xs"
          }`}
        >
          <span>{feedbackMessage.type === "success" ? "✓" : "⚠️"}</span>
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onEdgeClick={handleEdgeClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => {
          onSelectNode(null);
          onSelectEdge(null);
        }}
        edgesReconnectable={true}
        reconnectRadius={8}
        connectionRadius={40}
        onReconnect={handleReconnect}
        isValidConnection={isValidConnection}
        deleteKeyCode={null}
        nodesDraggable={!isLocked}
        elementsSelectable={true}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.2, maxZoom: 1.5 }}
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.8}
          color="var(--canvas-grid-dot)"
          style={{ opacity: 0.65 }}
        />

        {/* Bottom-left Controls matching Monitor */}
        <Controls
          position="bottom-left"
          className="!bg-surface-secondary/95 !backdrop-blur-md !border !border-border-strong !rounded-2xl !p-1.5 !shadow-xl overflow-hidden flex flex-col gap-1"
          showInteractive={false}
          showFitView={false}
        >
          {/* Fit View to Screen */}
          <ControlButton
            onClick={() =>
              fitView({
                padding: 0.2,
                minZoom: 0.2,
                maxZoom: 1.5,
                duration: 350,
              })
            }
            title="Fit View to Screen"
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !text-text-primary hover:!text-accent-primary !flex !items-center !justify-center cursor-pointer !rounded-xl active:scale-95 !shadow-2xs transition-all !w-7 !h-7 !m-0"
          >
            <span className="text-sm font-bold text-text-primary leading-none">
              ⛶
            </span>
          </ControlButton>

          {/* Orientation Toggle (Vertical / Horizontal) with treeStructureIcon */}
          <ControlButton
            onClick={() =>
              handleOrientationSwitch(
                orientation === "horizontal" ? "vertical" : "horizontal",
              )
            }
            title={
              orientation === "horizontal"
                ? "Switch to Vertical Layout"
                : "Switch to Horizontal Layout"
            }
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !flex !items-center !justify-center cursor-pointer !rounded-xl active:scale-95 !shadow-2xs transition-all !w-7 !h-7 !m-0"
          >
            {orientation === "horizontal" ? (
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

          {/* Edge Path Toggle */}
          <ControlButton
            onClick={() =>
              setPathMode(pathMode === "bezier" ? "orthogonal" : "bezier")
            }
            title={
              pathMode === "bezier"
                ? "Switch to Orthogonal Paths"
                : "Switch to Curved Paths"
            }
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !flex !items-center !justify-center cursor-pointer !rounded-xl active:scale-95 !shadow-2xs transition-all !w-7 !h-7 !m-0"
          >
            <Waypoints className="w-3.5 h-3.5 text-text-primary" />
          </ControlButton>

          {/* Lock / Unlock Dragging */}
          <ControlButton
            onClick={() => setIsLocked(!isLocked)}
            title={
              isLocked
                ? "Locked: Nodes cannot be moved"
                : "Unlocked: Nodes can be freely dragged"
            }
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !flex !items-center !justify-center cursor-pointer !rounded-xl active:scale-95 !shadow-2xs transition-all !w-7 !h-7 !m-0"
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

          {/* Reset Layout — Restore original Dagre positions */}
          <ControlButton
            onClick={handleResetLayout}
            title="Reset Layout — Restore Dagre tree layout"
            className="!bg-surface-primary hover:!bg-surface-hover !border !border-border-medium hover:!border-border-strong !flex !items-center !justify-center cursor-pointer !rounded-xl active:scale-95 !shadow-2xs transition-all !w-7 !h-7 !m-0"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-accent-primary" />
          </ControlButton>
        </Controls>
      </ReactFlow>

      {/* Dynamic Edge Drag & Reconnection Live Overlay */}
      {activeEdgeDrag && (
        <div
          className="absolute inset-0 pointer-events-none z-40 overflow-hidden"
          data-testid="edge-drag-overlay"
        >
          <svg className="w-full h-full">
            <defs>
              <filter
                id="reconnect-glow"
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
              >
                <feDropShadow
                  dx="0"
                  dy="0"
                  stdDeviation="3"
                  floodColor="rgba(2, 132, 199, 0.6)"
                />
              </filter>
            </defs>
            <path
              d={reconnectPathD}
              fill="none"
              stroke={
                activeEdgeDrag.candidateParentId
                  ? activeEdgeDrag.isValidCandidate
                    ? "#10b981"
                    : "#f43f5e"
                  : "#0284c7"
              }
              strokeWidth={3}
              strokeDasharray="6 4"
              className="animate-pulse"
              filter="url(#reconnect-glow)"
            />
            {/* Child anchor point */}
            <circle
              cx={activeEdgeDrag.childHandleScreenPos.x}
              cy={activeEdgeDrag.childHandleScreenPos.y}
              r={5}
              fill="#0284c7"
              stroke="#ffffff"
              strokeWidth={2}
            />
            {/* Cursor / Candidate target anchor point */}
            <circle
              cx={
                activeEdgeDrag.candidateHandleScreenPos?.x ??
                activeEdgeDrag.cursorScreenPos.x
              }
              cy={
                activeEdgeDrag.candidateHandleScreenPos?.y ??
                activeEdgeDrag.cursorScreenPos.y
              }
              r={activeEdgeDrag.candidateParentId ? 6 : 4}
              fill={
                activeEdgeDrag.candidateParentId
                  ? activeEdgeDrag.isValidCandidate
                    ? "#10b981"
                    : "#f43f5e"
                  : "#0284c7"
              }
              stroke="#ffffff"
              strokeWidth={2}
            />
          </svg>

          {/* Floating Pill at cursor showing candidate target and validation status */}
          <div
            className={`absolute pointer-events-none -translate-x-1/2 -translate-y-full mb-3 px-3 py-1.5 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-1.5 border backdrop-blur-md transition-all ${
              activeEdgeDrag.candidateParentId
                ? activeEdgeDrag.isValidCandidate
                  ? "bg-emerald-600 text-white border-emerald-400"
                  : "bg-rose-600 text-white border-rose-400"
                : "bg-surface-secondary/95 text-text-primary border-border-medium shadow-md"
            }`}
            style={{
              left: activeEdgeDrag.cursorScreenPos.x,
              top: activeEdgeDrag.cursorScreenPos.y - 12,
            }}
          >
            {activeEdgeDrag.candidateParentId ? (
              activeEdgeDrag.isValidCandidate ? (
                <>
                  <span>✓</span>
                  <span>Connect to "{activeEdgeDrag.candidateParentName}"</span>
                </>
              ) : (
                <>
                  <span>⚠️</span>
                  <span>
                    {activeEdgeDrag.validationReason || "Invalid connection"}
                  </span>
                </>
              )
            ) : (
              <span>Drop onto a valid node to connect</span>
            )}
          </div>
        </div>
      )}

      {/* Floating Canvas Hint */}
      <div className="absolute bottom-3 right-4 z-10 px-3.5 py-1.5 rounded-xl bg-surface-secondary/95 backdrop-blur-md border border-border-medium text-[11px] font-sans text-text-secondary shadow-md select-text flex items-center gap-3">
        <span>
          💡 <b>Drag edge:</b> Reconnect to another node
        </span>
        <span>•</span>
        <span>
          <b>Delete/Backspace:</b> Remove node or edge
        </span>
        <span>•</span>
        <span>
          <b>SubTree:</b> Inlined hierarchy with collapse/expand
        </span>
      </div>
    </div>
  );
};

export const BTEditorCanvas: React.FC<BTEditorCanvasProps> = (props) => {
  return (
    <ReactFlowProvider>
      <BTEditorCanvasInner {...props} />
    </ReactFlowProvider>
  );
};
