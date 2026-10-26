import dagre from "dagre";
import { Node, Edge } from "@xyflow/react";
import {
  BTTreeModel,
  BTNodeModel,
  NodeStatus,
  TreeOrientation,
} from "../types/bt";

/**
 * Calculates the STRICT EXECUTION-AWARE FAILURE PATH in a BehaviorTree.
 *
 * Rules enforced:
 * 1. A node that NEVER EXECUTED (status === 'IDLE' && tick_count === 0) MUST NEVER BE INCLUDED in failurePathNodes.
 * 2. Unexecuted sibling nodes remain completely untouched (IDLE color).
 * 3. Tracing moves upward from the failed leaf strictly along the ACTUAL EXECUTED parent chain.
 * 4. Tracing STOPS at decision points (Fallback / RecoveryNode) when another recovery branch is active (RUNNING or SUCCESS).
 * 5. Dynamic: updates live whenever transition events arrive.
 */
export const computeExecutionAwareFailurePath = (
  tree: BTTreeModel | null,
): Set<string> => {
  const failurePathNodes = new Set<string>();
  if (!tree || !tree.nodes) return failurePathNodes;

  const nodeMap = new Map<string, BTNodeModel>();
  tree.nodes.forEach((n) => nodeMap.set(n.id, n));

  // Identify leaf or action/condition nodes that explicitly returned FAILURE in the current execution
  const failedNodes = tree.nodes.filter((n) => n.status === "FAILURE");

  if (failedNodes.length === 0) {
    return failurePathNodes;
  }

  failedNodes.forEach((failedNode) => {
    failurePathNodes.add(failedNode.id);

    let currId = failedNode.parent_id;
    while (currId && nodeMap.has(currId)) {
      const parent = nodeMap.get(currId)!;

      // Check if parent is a Decision / Recovery Node (Fallback, ReactiveFallback, RecoveryNode)
      const isDecisionNode =
        (parent.category === "Control" &&
          (parent.type.includes("Fallback") ||
            parent.type.includes("Recovery") ||
            parent.name.includes("Fallback") ||
            parent.name.includes("Recovery"))) ||
        parent.type === "Fallback" ||
        parent.type === "ReactiveFallback" ||
        parent.type === "RecoveryNode";

      if (isDecisionNode && parent.children_ids) {
        // Find other children of this decision node (sibling branches)
        const otherChildren = parent.children_ids
          .filter((cid) => cid !== currId)
          .map((cid) => nodeMap.get(cid))
          .filter(Boolean);

        // Check if any other child is currently RUNNING or has completed SUCCESS (active recovery branch)
        const hasActiveRecoveryChild = otherChildren.some(
          (c) => c?.status === "RUNNING" || c?.status === "SUCCESS",
        );

        if (hasActiveRecoveryChild) {
          // STOP! The decision boundary is running or has executed a recovery branch.
          // Do NOT include the decision node itself in the RED failure path.
          break;
        }
      }

      // Include parent only if it actually participated in execution
      if (
        parent.status !== "IDLE" ||
        (parent.tick_count && parent.tick_count > 0)
      ) {
        failurePathNodes.add(parent.id);
      } else {
        // Parent never executed, stop upward trace
        break;
      }

      currId = parent.parent_id;
    }
  });

  return failurePathNodes;
};

export const NODE_WIDTH = 240;

export const calculateNodeHeight = (
  node: BTNodeModel,
  isCardExpanded: boolean = false,
): number => {
  const attrCount =
    (node.attributes ? Object.keys(node.attributes).length : 0) +
    (node.ports ? Object.keys(node.ports).length : 0);
  let height = 75;
  if (attrCount > 0) {
    if (isCardExpanded) {
      height += attrCount * 28 + 38;
    } else if (attrCount > 2) {
      height += 2 * 28 + 38;
    } else {
      height += attrCount * 28 + 12;
    }
  }
  if (node.last_duration !== undefined && node.last_duration > 0) {
    height += 24;
  }
  return height;
};

interface GeoBox {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  isNode: boolean;
}

interface LayoutNode {
  id: string;
  width: number;
  height: number;
  children: LayoutNode[];
  uRelative: number;
  uMin: number;
  uMax: number;
  localU: number;
  localV: number;
  elements: GeoBox[];
  x: number;
  y: number;
}

const CORRIDOR_OFFSET = 40;
const RANK_SEP = 75;
const MIN_NODE_CLEARANCE = 24;
const MIN_EDGE_CLEARANCE = 16;

const computeSubtreeGeometry = (node: LayoutNode, isHorizontal: boolean) => {
  const su = isHorizontal ? node.height : node.width;
  const sv = isHorizontal ? node.width : node.height;
  const halfSu = su / 2;
  const halfSv = sv / 2;

  // Leaf node base case
  if (node.children.length === 0) {
    node.uRelative = 0;
    node.localU = 0;
    node.localV = 0;
    node.uMin = -halfSu;
    node.uMax = halfSu;
    node.elements = [
      {
        uMin: -halfSu,
        uMax: halfSu,
        vMin: -halfSv,
        vMax: halfSv,
        isNode: true,
      },
    ];
    return;
  }

  // 1. Recursively compute geometry for all children subtrees
  node.children.forEach((child) => computeSubtreeGeometry(child, isHorizontal));

  const k = node.children.length;

  // 2. Compute minimum safe separation between adjacent sibling subtrees
  const reqGaps: number[] = [];
  for (let i = 0; i < k - 1; i++) {
    const leftChild = node.children[i];
    const rightChild = node.children[i + 1];

    const leftChildSu = isHorizontal ? leftChild.height : leftChild.width;
    const rightChildSu = isHorizontal ? rightChild.height : rightChild.width;

    // Minimum direct root node separation
    let minSep = leftChildSu / 2 + rightChildSu / 2 + MIN_NODE_CLEARANCE;

    // Compare all 2D geometric elements between leftChild subtree and rightChild subtree
    for (const elemL of leftChild.elements) {
      for (const elemR of rightChild.elements) {
        const requiredClearance =
          elemL.isNode && elemR.isNode
            ? MIN_NODE_CLEARANCE
            : MIN_EDGE_CLEARANCE;
        const neededSep = elemL.uMax - elemR.uMin + requiredClearance;
        if (neededSep > minSep) {
          minSep = neededSep;
        }
      }
    }

    reqGaps.push(minSep);
  }

  // 3. Position children tightly using exact minimum required separations (excessGap = 0)
  const positions: number[] = [0];
  for (let i = 0; i < reqGaps.length; i++) {
    positions.push(positions[i] + reqGaps[i]);
  }

  // 4. Center the complete sibling group around the parent axis
  const groupMid = (positions[0] + positions[positions.length - 1]) / 2;

  node.children.forEach((child, i) => {
    child.uRelative = positions[i] - groupMid;
  });

  // 5. Build combined elements list and subtree bounding envelope for this parent node (relative to parent center 0, 0)
  node.uRelative = 0;
  node.localU = 0;
  node.localV = 0;

  let combinedUMin = -halfSu;
  let combinedUMax = halfSu;

  const combinedElements: GeoBox[] = [
    {
      uMin: -halfSu,
      uMax: halfSu,
      vMin: -halfSv,
      vMax: halfSv,
      isNode: true,
    },
  ];

  const childrenDepthV = halfSv + RANK_SEP;
  const busV = halfSv + CORRIDOR_OFFSET;

  node.children.forEach((child) => {
    const childCenterU = child.uRelative;
    const childCenterV =
      childrenDepthV + (isHorizontal ? child.width : child.height) / 2;

    const childUMin = child.uMin + childCenterU;
    const childUMax = child.uMax + childCenterU;
    if (childUMin < combinedUMin) combinedUMin = childUMin;
    if (childUMax > combinedUMax) combinedUMax = childUMax;

    // Edge geometry: vertical drop 1, horizontal bus, vertical drop 2
    combinedElements.push({
      uMin: Math.min(0, childCenterU) - 2,
      uMax: Math.max(0, childCenterU) + 2,
      vMin: halfSv,
      vMax: busV,
      isNode: false,
    });
    combinedElements.push({
      uMin: Math.min(0, childCenterU) - 2,
      uMax: Math.max(0, childCenterU) + 2,
      vMin: busV - 2,
      vMax: busV + 2,
      isNode: false,
    });
    combinedElements.push({
      uMin: childCenterU - 2,
      uMax: childCenterU + 2,
      vMin: busV,
      vMax: childrenDepthV,
      isNode: false,
    });

    // Translate and include all child subtree elements
    child.elements.forEach((elem) => {
      combinedElements.push({
        uMin: elem.uMin + childCenterU,
        uMax: elem.uMax + childCenterU,
        vMin: elem.vMin + childCenterV,
        vMax: elem.vMax + childCenterV,
        isNode: elem.isNode,
      });
    });
  });

  node.uMin = combinedUMin;
  node.uMax = combinedUMax;
  node.elements = combinedElements;
};

const assignPositions = (
  node: LayoutNode,
  centerX: number,
  centerY: number,
  isHorizontal: boolean,
  allNodes: LayoutNode[],
) => {
  node.x = centerX;
  node.y = centerY;
  allNodes.push(node);

  if (node.children.length === 0) return;

  if (isHorizontal) {
    const childLeftEdge = node.x + node.width / 2 + RANK_SEP;
    node.children.forEach((child) => {
      const childCenterX = childLeftEdge + child.width / 2;
      const childCenterY = node.y + child.uRelative;
      assignPositions(
        child,
        childCenterX,
        childCenterY,
        isHorizontal,
        allNodes,
      );
    });
  } else {
    const childTopEdge = node.y + node.height / 2 + RANK_SEP;
    node.children.forEach((child) => {
      const childCenterX = node.x + child.uRelative;
      const childCenterY = childTopEdge + child.height / 2;
      assignPositions(
        child,
        childCenterX,
        childCenterY,
        isHorizontal,
        allNodes,
      );
    });
  }
};

export const generateGraphElements = (
  tree: BTTreeModel | null,
  expandedNodes: Set<string>,
  orientation: TreeOrientation = "vertical",
  onToggleBreakpoint?: (treeId: string, uid: number) => void,
  isLocked: boolean = false,
  onNodeContextMenu?: (event: React.MouseEvent, node: BTNodeModel) => void,
  activeProtocol: "btick" | "groot2" | "nav2" = "btick",
  measuredNodeHeights: Map<string, number> = new Map(),
  onNodeResize?: (nodeId: string, height: number) => void,
  preserveCollapsedLayout: boolean = false,
  onResetLayout?: () => void,
  expandedCardNodeIds?: Set<string>,
  onToggleCardExpand?: (nodeId: string) => void,
) => {
  if (!tree || !tree.nodes || tree.nodes.length === 0) {
    return { initialNodes: [], initialEdges: [] };
  }

  const isHorizontal = orientation === "horizontal";
  const nodeMap = new Map<string, BTNodeModel>();
  tree.nodes.forEach((n) => nodeMap.set(n.id, n));

  const visibleNodes = new Set<string>();
  const hiddenNodes = new Set<string>();

  // Collect visible nodes according to expanded/collapsed state
  const traverse = (nodeId: string) => {
    visibleNodes.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) return;

    const isExpanded =
      expandedNodes.has(nodeId) || !expandedNodes.has(`collapsed_${nodeId}`);

    if ((isExpanded || preserveCollapsedLayout) && node.children_ids) {
      node.children_ids.forEach((childId) => traverse(childId));
    }
  };

  if (tree.root_node_id && nodeMap.has(tree.root_node_id)) {
    traverse(tree.root_node_id);
  } else if (tree.nodes.length > 0) {
    visibleNodes.add(tree.nodes[0].id);
  }

  if (preserveCollapsedLayout) {
    const hideDescendants = (nodeId: string) => {
      const node = nodeMap.get(nodeId);
      node?.children_ids?.forEach((childId) => {
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
  }

  // Build tree hierarchy for visible nodes
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();
  visibleNodes.forEach((nodeId) => {
    const node = nodeMap.get(nodeId);
    if (!node) return;
    const vChildren = (node.children_ids || []).filter((cid) =>
      visibleNodes.has(cid),
    );
    childrenMap.set(nodeId, vChildren);
    vChildren.forEach((cid) => parentMap.set(cid, nodeId));
  });

  // Identify roots (nodes without a visible parent)
  let rootIds: string[] = [];
  if (tree.root_node_id && visibleNodes.has(tree.root_node_id)) {
    rootIds = [tree.root_node_id];
  } else {
    rootIds = Array.from(visibleNodes).filter((id) => !parentMap.has(id));
  }
  if (rootIds.length === 0 && visibleNodes.size > 0) {
    const fallbackRoot = visibleNodes.values().next().value;
    if (fallbackRoot) {
      rootIds = [fallbackRoot];
    }
  }

  const buildLayoutNode = (
    id: string,
    visited = new Set<string>(),
  ): LayoutNode => {
    visited.add(id);
    const node = nodeMap.get(id);
    const isCardExpanded = expandedCardNodeIds?.has(id) ?? false;
    const measured = measuredNodeHeights.get(id);
    const calculated = node ? calculateNodeHeight(node, isCardExpanded) : 80;
    let height = calculated;
    if (measured !== undefined) {
      if (isCardExpanded) {
        if (measured >= calculated - 40) {
          height = measured;
        }
      } else {
        if (measured <= calculated + 40) {
          height = measured;
        }
      }
    }
    const width = NODE_WIDTH;
    const vChildren = childrenMap.get(id) || [];
    const childrenNodes = vChildren
      .filter((cid) => !visited.has(cid))
      .map((cid) => buildLayoutNode(cid, visited));

    return {
      id,
      width,
      height,
      children: childrenNodes,
      uRelative: 0,
      uMin: 0,
      uMax: 0,
      localU: 0,
      localV: 0,
      elements: [],
      x: 0,
      y: 0,
    };
  };

  const allLayoutNodes: LayoutNode[] = [];
  let currentRootOffset = 0;

  rootIds.forEach((rootId) => {
    const rootLayout = buildLayoutNode(rootId);
    computeSubtreeGeometry(rootLayout, isHorizontal);

    if (isHorizontal) {
      assignPositions(
        rootLayout,
        0,
        currentRootOffset,
        isHorizontal,
        allLayoutNodes,
      );
      const rootSpan =
        Math.max(...rootLayout.elements.map((e) => e.uMax)) -
        Math.min(...rootLayout.elements.map((e) => e.uMin));
      currentRootOffset += rootSpan + 60;
    } else {
      assignPositions(
        rootLayout,
        currentRootOffset,
        0,
        isHorizontal,
        allLayoutNodes,
      );
      const rootSpan =
        Math.max(...rootLayout.elements.map((e) => e.uMax)) -
        Math.min(...rootLayout.elements.map((e) => e.uMin));
      currentRootOffset += rootSpan + 60;
    }
  });

  // Handle any remaining unattached visible nodes
  const laidOutIds = new Set(allLayoutNodes.map((n) => n.id));
  const remainingVisible = Array.from(visibleNodes).filter(
    (id) => !laidOutIds.has(id),
  );
  remainingVisible.forEach((id) => {
    const orphanLayout = buildLayoutNode(id);
    computeSubtreeGeometry(orphanLayout, isHorizontal);
    if (isHorizontal) {
      assignPositions(
        orphanLayout,
        0,
        currentRootOffset,
        isHorizontal,
        allLayoutNodes,
      );
      currentRootOffset += 200;
    } else {
      assignPositions(
        orphanLayout,
        currentRootOffset,
        0,
        isHorizontal,
        allLayoutNodes,
      );
      currentRootOffset += 300;
    }
  });

  // Global shift to ensure padding from origin (margin 40px)
  let minX = Infinity;
  let minY = Infinity;
  allLayoutNodes.forEach((n) => {
    const left = n.x - n.width / 2;
    const top = n.y - n.height / 2;
    if (left < minX) minX = left;
    if (top < minY) minY = top;
  });

  const offsetX = 40 - (minX !== Infinity ? minX : 0);
  const offsetY = 40 - (minY !== Infinity ? minY : 0);

  const positionsMap = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  allLayoutNodes.forEach((n) => {
    positionsMap.set(n.id, {
      x: n.x - n.width / 2 + offsetX,
      y: n.y - n.height / 2 + offsetY,
      width: n.width,
      height: n.height,
    });
  });

  const initialEdges: Edge[] = [];
  const targetHandleId = isHorizontal ? "target-left" : "target-top";
  const sourceHandleId = isHorizontal ? "source-right" : "source-bottom";

  tree.nodes.forEach((node) => {
    if (visibleNodes.has(node.id) && node.children_ids) {
      node.children_ids.forEach((childId) => {
        if (visibleNodes.has(childId)) {
          const childNode = nodeMap.get(childId);
          const childStatus = childNode ? childNode.status : "IDLE";
          const isChildPaused = Boolean(
            childNode &&
            (childNode.is_paused ||
              (childStatus as string) === "PAUSED" ||
              (childStatus as string) === "PAUSED_AT_BREAKPOINT"),
          );

          let strokeColor = "#475569";
          let strokeWidth = 2;
          let animated = false;

          if (childStatus === "FAILURE") {
            strokeColor = "#ef4444";
            strokeWidth = 2.5;
          } else if (childStatus === "SUCCESS") {
            strokeColor = "#22c55e";
            strokeWidth = 2.5;
          } else if (childStatus === "RUNNING" || isChildPaused) {
            strokeColor = "#f59e0b";
            strokeWidth = 2.5;
            animated = true;
          }

          initialEdges.push({
            id: `e-${node.id}-${childId}`,
            source: node.id,
            target: childId,
            sourceHandle: sourceHandleId,
            targetHandle: targetHandleId,
            type: "btMonitorEdge",
            animated: animated,
            hidden: hiddenNodes.has(node.id) || hiddenNodes.has(childId),
            style: {
              stroke: strokeColor,
              strokeWidth: strokeWidth,
            },
          });
        }
      });
    }
  });

  const initialNodes: Node[] = tree.nodes
    .filter((node) => visibleNodes.has(node.id))
    .map((node) => {
      const pos = positionsMap.get(node.id) || {
        x: 0,
        y: 0,
        width: NODE_WIDTH,
        height: calculateNodeHeight(node),
      };

      const displayStatus: NodeStatus = node.status || "IDLE";

      return {
        id: node.id,
        type: "btNode",
        width: pos.width,
        height: pos.height,
        initialWidth: pos.width,
        initialHeight: pos.height,
        style: { width: pos.width },
        data: {
          nodeData: {
            ...node,
            status: displayStatus,
          },
          treeId: tree.tree_id,
          treeName: tree.tree_name,
          orientation,
          hasChildren: node.children_ids && node.children_ids.length > 0,
          isCollapsed: expandedNodes.has(`collapsed_${node.id}`),
          isCardExpanded: expandedCardNodeIds?.has(node.id) ?? false,
          onToggleBreakpoint,
          isLocked,
          onNodeContextMenu,
          blackboard: tree.blackboard || {},
          activeProtocol,
          onNodeResize,
          onResetLayout,
          onToggleCardExpand,
        },
        hidden: hiddenNodes.has(node.id),
        position: {
          x: pos.x,
          y: pos.y,
        },
      };
    });

  return { initialNodes, initialEdges };
};
