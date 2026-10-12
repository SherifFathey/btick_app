import dagre from "dagre";
import {
  BehaviorTreeDocument,
  BTEditorTree,
  BTEditorNode,
  ValidationIssue,
} from "./types";
import { inferNodeCategory } from "./nodeLibrary";

// Deep clone utility
export const cloneDocument = (
  doc: BehaviorTreeDocument,
): BehaviorTreeDocument => {
  return JSON.parse(JSON.stringify(doc));
};

// Generate unique ID for a new node
export const generateUniqueNodeId = (
  tree: BTEditorTree,
  baseName: string,
): string => {
  const cleanBase = baseName.replace(/[^a-zA-Z0-9_]/g, "_");
  let candidate = cleanBase;
  let counter = 1;
  while (tree.nodes[candidate]) {
    candidate = `${cleanBase}_${counter}`;
    counter++;
  }
  return candidate;
};

// Calculate node height based on attributes, ports, and name
export const calculateEditorNodeHeight = (node: BTEditorNode): number => {
  const portCount =
    Object.keys(node.inputPorts || {}).length +
    Object.keys(node.outputPorts || {}).length;
  const attrCount = Object.keys(node.attributes || {}).length;
  const totalBadges = portCount + attrCount;
  let height = 75;
  if (node.name && node.name !== node.type) {
    height += 16;
  }
  if (totalBadges > 0) {
    height += Math.min(totalBadges * 18, 55);
  }
  return height;
};

// Add a node to a tree
export const addNodeToTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  parentId: string | null,
  nodeType: string,
  nodeName?: string,
  targetIndex?: number,
  initialPosition?: { x: number; y: number },
): { nextDoc: BehaviorTreeDocument; newNodeId: string } => {
  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree) return { nextDoc: doc, newNodeId: "" };

  const category = inferNodeCategory(nodeType);
  const baseName = nodeName || nodeType;
  const newNodeId = generateUniqueNodeId(tree, baseName);

  let actualParentId = parentId;
  let calculatedIndex = targetIndex;

  // If a parent was requested, verify if it can accept children or if we should add to its parent
  if (actualParentId && tree.nodes[actualParentId]) {
    const parentNode = tree.nodes[actualParentId];
    const canAcceptChildren =
      parentNode.category === "Control" ||
      (parentNode.category === "Decorator" && parentNode.children.length === 0);

    if (canAcceptChildren) {
      if (
        calculatedIndex === undefined ||
        calculatedIndex < 0 ||
        calculatedIndex > parentNode.children.length
      ) {
        calculatedIndex = parentNode.children.length;
      }
    } else {
      // Leaf nodes (Action/Condition) or full Decorators cannot accept children; safely detach
      actualParentId = null;
    }
  }

  // Determine initial position according to actual position in children[]
  let posX = 0;
  let posY = 0;

  if (actualParentId && tree.nodes[actualParentId]) {
    const parentNode = tree.nodes[actualParentId];
    if (initialPosition) {
      posX = initialPosition.x;
      posY = initialPosition.y;
    } else {
      posY = parentNode.position.y + 130;
      if (parentNode.children.length === 0) {
        posX = parentNode.position.x;
      } else if (
        calculatedIndex !== undefined &&
        calculatedIndex >= parentNode.children.length
      ) {
        const lastChild =
          tree.nodes[parentNode.children[parentNode.children.length - 1]];
        posX = (lastChild?.position?.x ?? parentNode.position.x) + 230 + 85;
      } else if (calculatedIndex === 0) {
        const firstChild = tree.nodes[parentNode.children[0]];
        posX = (firstChild?.position?.x ?? parentNode.position.x) - 230 - 85;
      } else if (calculatedIndex !== undefined && calculatedIndex > 0) {
        const prevChild = tree.nodes[parentNode.children[calculatedIndex - 1]];
        const nextChild = tree.nodes[parentNode.children[calculatedIndex]];
        posX = Math.round(
          ((prevChild?.position?.x ?? parentNode.position.x) +
            (nextChild?.position?.x ?? parentNode.position.x)) /
            2,
        );
      } else {
        const lastChild =
          tree.nodes[parentNode.children[parentNode.children.length - 1]];
        posX = (lastChild?.position?.x ?? parentNode.position.x) + 230 + 85;
      }
    }
  } else {
    // Independent / canvas root node: place relative to existing top roots, never fixed on far left
    if (initialPosition) {
      posX = initialPosition.x;
      posY = initialPosition.y;
    } else {
      const topRoots = Object.values(tree.nodes).filter((n) => !n.parentId);
      if (topRoots.length > 0) {
        const maxRight = Math.max(
          ...topRoots.map((n) => (n.position?.x ?? 0) + 230),
        );
        posX = maxRight + 100;
        posY = topRoots[0].position?.y ?? 60;
      } else {
        posX = 100;
        posY = 60;
      }
    }
  }

  const newNode: BTEditorNode = {
    id: newNodeId,
    type: nodeType,
    name: nodeName,
    category,
    attributes: {},
    inputPorts: {},
    outputPorts: {},
    children: [],
    parentId: actualParentId || null,
    position: { x: posX, y: posY },
  };

  tree.nodes[newNodeId] = newNode;

  if (actualParentId && tree.nodes[actualParentId]) {
    const parentNode = tree.nodes[actualParentId];
    if (
      calculatedIndex !== undefined &&
      calculatedIndex >= 0 &&
      calculatedIndex <= parentNode.children.length
    ) {
      parentNode.children.splice(calculatedIndex, 0, newNodeId);
    } else {
      parentNode.children.push(newNodeId);
    }
  } else if (!tree.rootNodeId || !tree.nodes[tree.rootNodeId]) {
    tree.rootNodeId = newNodeId;
  }

  return { nextDoc, newNodeId };
};

// Remove a node and its entire subtree recursively
export const removeNodeFromTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  nodeId: string,
): BehaviorTreeDocument => {
  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree || !tree.nodes[nodeId]) return doc;

  const nodeToRemove = tree.nodes[nodeId];

  // 1. Remove from parent's children array
  if (nodeToRemove.parentId && tree.nodes[nodeToRemove.parentId]) {
    const parent = tree.nodes[nodeToRemove.parentId];
    parent.children = parent.children.filter((cid) => cid !== nodeId);
  }

  // 2. Recursively delete node and all descendants
  const deleteRecursive = (id: string) => {
    const n = tree.nodes[id];
    if (!n) return;
    n.children.forEach(deleteRecursive);
    delete tree.nodes[id];
  };

  deleteRecursive(nodeId);

  // 3. If deleted node was root, pick surviving top-level root
  if (tree.rootNodeId === nodeId) {
    const surviving = Object.values(tree.nodes);
    const candidate = surviving.find((n) => !n.parentId);
    tree.rootNodeId = candidate ? candidate.id : "";
  }

  return nextDoc;
};

// Reparent a node
export const reparentNodeInTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  nodeId: string,
  newParentId: string | null,
  targetIndex?: number,
): BehaviorTreeDocument => {
  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree || !tree.nodes[nodeId]) return doc;
  if (nodeId === newParentId) return doc; // Cannot be own parent

  // Check if newParent is a descendant of nodeId (cycle check!)
  const isDescendant = (ancestorId: string, targetId: string): boolean => {
    const ancestor = tree.nodes[ancestorId];
    if (!ancestor) return false;
    if (ancestor.children.includes(targetId)) return true;
    return ancestor.children.some((cid) => isDescendant(cid, targetId));
  };

  if (newParentId && isDescendant(nodeId, newParentId)) {
    console.warn("Cannot reparent node to its own descendant");
    return doc;
  }

  const node = tree.nodes[nodeId];

  // 1. Remove from old parent
  if (node.parentId && tree.nodes[node.parentId]) {
    const oldParent = tree.nodes[node.parentId];
    oldParent.children = oldParent.children.filter((cid) => cid !== nodeId);
  } else if (tree.rootNodeId === nodeId && newParentId) {
    // If it was the root and now has a parent, it's no longer the tree root
  }

  // 2. Add to new parent
  node.parentId = newParentId;
  if (newParentId && tree.nodes[newParentId]) {
    const newParent = tree.nodes[newParentId];
    newParent.children = newParent.children.filter((cid) => cid !== nodeId);

    let insertIdx = targetIndex;
    if (
      insertIdx === undefined ||
      insertIdx < 0 ||
      insertIdx > newParent.children.length
    ) {
      if (node.position && newParent.children.length > 0) {
        const siblingXList = newParent.children.map(
          (cid) => tree.nodes[cid]?.position?.x ?? 0,
        );
        let idx = 0;
        while (
          idx < siblingXList.length &&
          node.position.x > siblingXList[idx]
        ) {
          idx++;
        }
        insertIdx = idx;
      } else {
        insertIdx = newParent.children.length;
      }
    }
    newParent.children.splice(insertIdx, 0, nodeId);
  }

  // 3. Keep tree.rootNodeId pointing to the true top-level root
  const getTopRoot = (startId: string): string => {
    let curr = startId;
    const seen = new Set<string>();
    while (
      tree.nodes[curr]?.parentId &&
      tree.nodes[tree.nodes[curr].parentId!]
    ) {
      if (seen.has(curr)) break;
      seen.add(curr);
      curr = tree.nodes[curr].parentId!;
    }
    return curr;
  };

  if (newParentId) {
    if (
      tree.rootNodeId === nodeId ||
      isDescendant(newParentId, tree.rootNodeId)
    ) {
      tree.rootNodeId = getTopRoot(newParentId);
    }
  } else {
    // Becoming top-level root
    if (!tree.rootNodeId || !tree.nodes[tree.rootNodeId]) {
      tree.rootNodeId = nodeId;
    }
  }

  return nextDoc;
};

// Check if connecting parentId to childId is allowed (validates cycles, decorator limit, leaf rules)
export const canConnectNodes = (
  doc: BehaviorTreeDocument,
  treeId: string,
  parentId: string,
  childId: string,
): { allowed: boolean; reason?: string } => {
  const tree = doc.trees[treeId];
  if (!tree) return { allowed: false, reason: "Tree not found" };
  const parent = tree.nodes[parentId];
  const child = tree.nodes[childId];
  if (!parent || !child) return { allowed: false, reason: "Node not found" };
  if (parentId === childId)
    return { allowed: false, reason: "A node cannot be connected to itself" };

  // Cycle check: parent cannot be child or descendant of child
  const isDescendant = (ancestorId: string, targetId: string): boolean => {
    const anc = tree.nodes[ancestorId];
    if (!anc) return false;
    if (anc.children.includes(targetId)) return true;
    return anc.children.some((cid) => isDescendant(cid, targetId));
  };

  if (isDescendant(childId, parentId)) {
    return {
      allowed: false,
      reason:
        "Cannot connect: would create a cycle (node cannot become its own ancestor)",
    };
  }

  // Leaf check: leaf nodes cannot be parents
  if (parent.category === "Action" || parent.category === "Condition") {
    return {
      allowed: false,
      reason: `Cannot connect: ${parent.category} node "${parent.name || parent.type}" is a leaf and cannot have children`,
    };
  }

  // Decorator check: can have only 1 child
  if (parent.category === "Decorator") {
    const hasOtherChild =
      parent.children.length > 0 && !parent.children.includes(childId);
    if (hasOtherChild) {
      return {
        allowed: false,
        reason: `Cannot connect: Decorator "${parent.name || parent.type}" can have only 1 child`,
      };
    }
  }

  return { allowed: true };
};

// Disconnect edge (remove child from parent without deleting child node)
export const disconnectChildInTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  parentId: string,
  childId: string,
): BehaviorTreeDocument => {
  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree) return doc;

  const parent = tree.nodes[parentId];
  const child = tree.nodes[childId];
  if (parent) {
    parent.children = parent.children.filter((cid) => cid !== childId);
  }
  if (child && child.parentId === parentId) {
    child.parentId = null;
  }

  return nextDoc;
};

// Reconnect edge (move child to a new parent)
export const reconnectEdgeInTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  oldParentId: string,
  newParentId: string,
  childId: string,
  targetIndex?: number,
): { nextDoc: BehaviorTreeDocument; success: boolean; error?: string } => {
  const check = canConnectNodes(doc, treeId, newParentId, childId);
  if (!check.allowed) {
    return { nextDoc: doc, success: false, error: check.reason };
  }

  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree) return { nextDoc: doc, success: false, error: "Tree not found" };

  const oldParent = tree.nodes[oldParentId];
  const newParent = tree.nodes[newParentId];
  const child = tree.nodes[childId];

  if (oldParent) {
    oldParent.children = oldParent.children.filter((cid) => cid !== childId);
  }
  if (newParent) {
    newParent.children = newParent.children.filter((cid) => cid !== childId);

    let insertIdx = targetIndex;
    if (
      insertIdx === undefined ||
      insertIdx < 0 ||
      insertIdx > newParent.children.length
    ) {
      if (child && child.position && newParent.children.length > 0) {
        const siblingXList = newParent.children.map(
          (cid) => tree.nodes[cid]?.position?.x ?? 0,
        );
        let idx = 0;
        while (
          idx < siblingXList.length &&
          child.position.x > siblingXList[idx]
        ) {
          idx++;
        }
        insertIdx = idx;
      } else {
        insertIdx = newParent.children.length;
      }
    }
    newParent.children.splice(insertIdx, 0, childId);
  }
  if (child) {
    child.parentId = newParentId;
  }

  return { nextDoc, success: true };
};

export type ChangeNodeTypeResolution =
  "keep_first_detach_rest" | "detach_all" | "keep_all";

// Safely change node type preserving ID, name, position, compatible attributes and ports
export const changeNodeTypeInTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  nodeId: string,
  newType: string,
  resolution: ChangeNodeTypeResolution = "keep_all",
): BehaviorTreeDocument => {
  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree || !tree.nodes[nodeId]) return doc;

  const node = tree.nodes[nodeId];
  const newCategory = inferNodeCategory(newType);

  // Handle children conflicts safely without deleting nodes
  if (newCategory === "Decorator" && node.children.length > 1) {
    if (resolution === "keep_first_detach_rest") {
      const detached = node.children.slice(1);
      node.children = [node.children[0]];
      detached.forEach((cid) => {
        if (tree.nodes[cid]) {
          tree.nodes[cid].parentId = null;
        }
      });
    }
  } else if (
    (newCategory === "Action" ||
      newCategory === "Condition" ||
      newCategory === "SubTree") &&
    node.children.length > 0
  ) {
    if (resolution === "detach_all") {
      const detached = [...node.children];
      node.children = [];
      detached.forEach((cid) => {
        if (tree.nodes[cid]) {
          tree.nodes[cid].parentId = null;
        }
      });
    }
  }

  node.type = newType;
  node.category = newCategory;

  return nextDoc;
};

// Helper to determine target tree ID for a SubTree node
export const getSubTreeTargetId = (
  node: BTEditorNode,
  doc: BehaviorTreeDocument,
): string => {
  if (node.attributes?.ID) return node.attributes.ID;
  if (node.name && doc.trees[node.name]) return node.name;
  if (doc.trees[node.type]) return node.type;
  return node.attributes?.target || node.name || "";
};

// Update node properties (name, type, attributes, ports, position)
export const updateNodeInTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  nodeId: string,
  updates: Partial<BTEditorNode>,
): BehaviorTreeDocument => {
  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree || !tree.nodes[nodeId]) return doc;

  const existing = tree.nodes[nodeId];
  const nextType = updates.type || existing.type;
  const nextCategory =
    updates.category ||
    (updates.type ? inferNodeCategory(updates.type) : existing.category);

  tree.nodes[nodeId] = {
    ...existing,
    ...updates,
    type: nextType,
    category: nextCategory,
  };

  return nextDoc;
};

// Duplicate a node and its entire subtree
export const duplicateSubtreeInTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  nodeId: string,
): { nextDoc: BehaviorTreeDocument; clonedRootId: string } => {
  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree || !tree.nodes[nodeId]) return { nextDoc: doc, clonedRootId: "" };

  const originalRoot = tree.nodes[nodeId];
  const idMap = new Map<string, string>();

  // Helper to clone nodes recursively
  const cloneRecursive = (id: string, newParentId: string | null): string => {
    const orig = tree.nodes[id];
    if (!orig) return "";

    const newId = generateUniqueNodeId(tree, `${orig.name || orig.type}_copy`);
    idMap.set(id, newId);

    const clonedChildren: string[] = [];

    const clonedNode: BTEditorNode = {
      ...JSON.parse(JSON.stringify(orig)),
      id: newId,
      name: orig.name ? `${orig.name}_copy` : undefined,
      parentId: newParentId,
      position: { x: orig.position.x + 40, y: orig.position.y + 40 },
      children: clonedChildren,
    };

    tree.nodes[newId] = clonedNode;

    orig.children.forEach((cid) => {
      const clonedChildId = cloneRecursive(cid, newId);
      if (clonedChildId) clonedChildren.push(clonedChildId);
    });

    return newId;
  };

  const clonedRootId = cloneRecursive(nodeId, originalRoot.parentId || null);

  // If original had a parent, insert the clone right after original in siblings
  if (originalRoot.parentId && tree.nodes[originalRoot.parentId]) {
    const parent = tree.nodes[originalRoot.parentId];
    const origIdx = parent.children.indexOf(nodeId);
    if (origIdx !== -1) {
      parent.children.splice(origIdx + 1, 0, clonedRootId);
    } else {
      parent.children.push(clonedRootId);
    }
  }

  return { nextDoc, clonedRootId };
};

export interface TreeLayoutOptions {
  nodesep?: number;
  ranksep?: number;
  marginx?: number;
  marginy?: number;
  getNodeHeight?: (id: string) => number;
  getNodeWidth?: (id: string) => number;
}

// Hierarchical Behavior Tree layout engine
// Mathematically guarantees:
// 1. Strict sibling execution order preservation: left-to-right (TB) or top-to-bottom (LR) matching children[]
// 2. Symmetric parent centering over children without shifting or collapsing branches
// 3. Complete subtree collision avoidance with contour tracking at every depth
// 4. Uniform depth-based rank alignment
// 5. Zero mutation of tree structure, execution order, or parent/child relationships
export const layoutBehaviorTree = (
  nodes: Record<string, { id: string; children?: string[]; height?: number }>,
  rootIds: string[],
  isHorizontal: boolean = false,
  options: TreeLayoutOptions = {},
): Record<string, { x: number; y: number }> => {
  const nodeWidth = 230;
  const nodesep = options.nodesep ?? (isHorizontal ? 60 : 70);
  const ranksep = options.ranksep ?? (isHorizontal ? 120 : 100);
  const marginx = options.marginx ?? 40;
  const marginy = options.marginy ?? 40;
  const getNodeHeight =
    options.getNodeHeight || ((id: string) => nodes[id]?.height || 80);

  const positions: Record<string, { x: number; y: number }> = {};
  if (
    !nodes ||
    Object.keys(nodes).length === 0 ||
    !rootIds ||
    rootIds.length === 0
  ) {
    return positions;
  }

  // Span is along X in vertical (nodeWidth), along Y in horizontal (nodeHeight)
  const spanSize = isHorizontal
    ? (id: string) => getNodeHeight(id)
    : () => nodeWidth;

  let currentStartX = marginx;
  let currentStartY = marginy;

  const globalVisited = new Set<string>();

  rootIds.forEach((compRootId) => {
    if (!nodes[compRootId] || globalVisited.has(compRootId)) return;

    // 1. Calculate depths and max node dimensions per rank in this component
    const depthMap = new Map<string, number>();
    const rankMaxHeights = new Map<number, number>();

    const computeDepths = (id: string, d: number) => {
      if (globalVisited.has(id)) return;
      globalVisited.add(id);
      depthMap.set(id, d);
      const h = getNodeHeight(id);
      rankMaxHeights.set(d, Math.max(rankMaxHeights.get(d) || 0, h));

      const n = nodes[id];
      if (n && n.children) {
        n.children.forEach((cid) => {
          if (nodes[cid] && !globalVisited.has(cid)) {
            computeDepths(cid, d + 1);
          }
        });
      }
    };
    computeDepths(compRootId, 0);

    // Compute rank base offsets
    const rankOffsets = new Map<number, number>();
    let currentRankOffset = isHorizontal ? currentStartX : currentStartY;
    const maxDepth = Math.max(...Array.from(depthMap.values()));
    for (let d = 0; d <= maxDepth; d++) {
      rankOffsets.set(d, currentRankOffset);
      const h = rankMaxHeights.get(d) || 80;
      currentRankOffset += (isHorizontal ? nodeWidth : h) + ranksep;
    }

    // 2. Post-order bottom-up pass: calculate relative subtree placement and contours
    interface ChildLayoutInfo {
      childOffsets: number[];
      validChildren: string[];
    }
    const childLayoutsMap = new Map<string, ChildLayoutInfo>();
    const visitedInLayout = new Set<string>();

    const layoutSubtree = (
      id: string,
    ): { leftContour: number[]; rightContour: number[] } => {
      visitedInLayout.add(id);
      const n = nodes[id];
      const mySize = spanSize(id);
      const validChildren = (n?.children || []).filter(
        (cid) => Boolean(nodes[cid]) && !visitedInLayout.has(cid),
      );

      if (validChildren.length === 0) {
        return {
          leftContour: [0],
          rightContour: [mySize],
        };
      }

      const childLayouts = validChildren.map((cid) => layoutSubtree(cid));
      const childShifts = new Array<number>(validChildren.length).fill(0);

      const accRightContour = [...childLayouts[0].rightContour];

      for (let i = 1; i < validChildren.length; i++) {
        const cLayout = childLayouts[i];
        const prevShift = childShifts[i - 1];
        const prevSize = spanSize(validChildren[i - 1]);

        // Minimum shift for sibling node separation
        let shift = prevShift + prevSize + nodesep;

        // Contour collision avoidance across all depths of both subtrees
        const overlapDepth = Math.min(
          accRightContour.length,
          cLayout.leftContour.length,
        );
        for (let d = 0; d < overlapDepth; d++) {
          const needed = accRightContour[d] + nodesep - cLayout.leftContour[d];
          if (needed > shift) {
            shift = needed;
          }
        }

        // Subtree bounding-box separation guarantee:
        // No descendant of child i may extend into or to the left of any previous sibling's subtree
        const minLeftAcrossDepths = Math.min(...cLayout.leftContour);
        const maxRightAcrossDepths = Math.max(...accRightContour);
        const minNonOverlapShift =
          maxRightAcrossDepths + nodesep - minLeftAcrossDepths;
        if (minNonOverlapShift > shift) {
          shift = minNonOverlapShift;
        }

        childShifts[i] = shift;

        // Merge right contour
        for (let d = 0; d < cLayout.rightContour.length; d++) {
          const r = cLayout.rightContour[d] + shift;
          if (d < accRightContour.length) {
            accRightContour[d] = Math.max(accRightContour[d], r);
          } else {
            accRightContour.push(r);
          }
        }
      }

      // Center parent symmetrically over first and last child
      const firstChildCenter = childShifts[0] + spanSize(validChildren[0]) / 2;
      const lastChildCenter =
        childShifts[validChildren.length - 1] +
        spanSize(validChildren[validChildren.length - 1]) / 2;
      const idealCenter = (firstChildCenter + lastChildCenter) / 2;
      const parentCoord = idealCenter - mySize / 2;

      // Child offsets relative to parent at 0
      const childOffsets = childShifts.map((s) => s - parentCoord);

      // Build contours relative to parent at 0
      const leftContour = [0];
      const rightContour = [mySize];

      let maxD = 0;
      for (const cl of childLayouts) {
        maxD = Math.max(maxD, cl.leftContour.length);
      }

      for (let d = 0; d < maxD; d++) {
        let minL = Infinity;
        let maxR = -Infinity;
        for (let i = 0; i < validChildren.length; i++) {
          const cl = childLayouts[i];
          const offset = childOffsets[i];
          if (d < cl.leftContour.length) {
            minL = Math.min(minL, cl.leftContour[d] + offset);
            maxR = Math.max(maxR, cl.rightContour[d] + offset);
          }
        }
        leftContour.push(minL);
        rightContour.push(maxR);
      }

      childLayoutsMap.set(id, { childOffsets, validChildren });

      return {
        leftContour,
        rightContour,
      };
    };

    layoutSubtree(compRootId);

    // 3. Top-down pre-order pass: compute unnormalized relative coordinates
    const tempCoords = new Map<string, number>();
    const assignRelativeCoords = (id: string, currentRelCoord: number) => {
      tempCoords.set(id, currentRelCoord);
      const info = childLayoutsMap.get(id);
      if (info) {
        const { childOffsets, validChildren } = info;
        validChildren.forEach((cid, i) => {
          const childRelCoord = currentRelCoord + childOffsets[i];
          assignRelativeCoords(cid, childRelCoord);
        });
      }
    };
    assignRelativeCoords(compRootId, 0);

    // Normalize so minimum coordinate matches currentStart
    let minCoord = Infinity;
    let maxCoord = -Infinity;
    depthMap.forEach((_, id) => {
      const c = tempCoords.get(id) || 0;
      const sz = spanSize(id);
      minCoord = Math.min(minCoord, c);
      maxCoord = Math.max(maxCoord, c + sz);
    });

    const baseSpanOffset =
      (isHorizontal ? currentStartY : currentStartX) - minCoord;

    depthMap.forEach((d, id) => {
      const rankOffset = rankOffsets.get(d) || 0;
      const finalSpanCoord = (tempCoords.get(id) || 0) + baseSpanOffset;

      if (isHorizontal) {
        positions[id] = {
          x: Math.round(rankOffset),
          y: Math.round(finalSpanCoord),
        };
      } else {
        positions[id] = {
          x: Math.round(finalSpanCoord),
          y: Math.round(rankOffset),
        };
      }
    });

    // Advance start coordinate for next disconnected tree or orphan component
    const compSpanTotal = maxCoord - minCoord;
    if (isHorizontal) {
      currentStartY += compSpanTotal + 100;
    } else {
      currentStartX += compSpanTotal + 100;
    }
  });

  return positions;
};

export interface FullLayoutHierarchy {
  layoutNodeMap: Record<
    string,
    { id: string; children?: string[]; height?: number }
  >;
  canvasRoots: string[];
}

// Build complete hierarchical node map including inlined SubTrees and nested SubTrees
export const buildFullLayoutHierarchy = (
  document: BehaviorTreeDocument,
  activeTreeId: string,
): FullLayoutHierarchy => {
  const tree = document.trees[activeTreeId];
  if (!tree || !tree.nodes || Object.keys(tree.nodes).length === 0) {
    return { layoutNodeMap: {}, canvasRoots: [] };
  }

  const layoutNodeMap: Record<
    string,
    { id: string; children?: string[]; height?: number }
  > = {};
  const hasIncoming = new Set<string>();

  // Determine top roots
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

  // Include any orphan/unconnected nodes in the active tree (sorted by existing position to preserve order)
  const orphanNodes = Object.values(tree.nodes).filter(
    (n) => (!n.parentId || !tree.nodes[n.parentId]) && !roots.includes(n.id),
  );
  orphanNodes.sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0));
  orphanNodes.forEach((n) => roots.push(n.id));

  const traverseHierarchy = (
    nodeId: string,
    currentTreeId: string,
    prefix: string = "",
  ) => {
    const currentTree = document.trees[currentTreeId];
    if (!currentTree || !currentTree.nodes[nodeId]) return;
    const currNode = currentTree.nodes[nodeId];
    const flowId = prefix ? `${prefix}:::${nodeId}` : nodeId;
    if (layoutNodeMap[flowId]) return;

    layoutNodeMap[flowId] = {
      id: flowId,
      children: [],
      height: calculateEditorNodeHeight(currNode),
    };

    const isSubTree =
      currNode.category === "SubTree" ||
      currNode.type === "SubTree" ||
      currNode.type === "SubTreePlus";
    const targetTreeId = isSubTree
      ? getSubTreeTargetId(currNode, document)
      : "";
    const targetTree = targetTreeId ? document.trees[targetTreeId] : null;

    if (isSubTree && targetTree && targetTreeId !== currentTreeId) {
      const subRootId =
        targetTree.rootNodeId || Object.keys(targetTree.nodes)[0];
      if (subRootId && targetTree.nodes[subRootId]) {
        const nextPrefix = prefix
          ? `${prefix}:::sub_${currNode.id}:::${targetTreeId}`
          : `sub_${currNode.id}:::${targetTreeId}`;
        const subRootFlowId = `${nextPrefix}:::${subRootId}`;
        layoutNodeMap[flowId].children!.push(subRootFlowId);
        hasIncoming.add(subRootFlowId);
        traverseHierarchy(subRootId, targetTreeId, nextPrefix);
      }
    } else if (currNode.children) {
      currNode.children.forEach((childId) => {
        const childFlowId = prefix ? `${prefix}:::${childId}` : childId;
        layoutNodeMap[flowId].children!.push(childFlowId);
        hasIncoming.add(childFlowId);
        traverseHierarchy(childId, currentTreeId, prefix);
      });
    }
  };

  roots.forEach((rId) => traverseHierarchy(rId, activeTreeId));
  Object.keys(tree.nodes).forEach((nId) => {
    if (!layoutNodeMap[nId]) {
      traverseHierarchy(nId, activeTreeId);
    }
  });

  const canvasRoots: string[] = [];
  Object.keys(layoutNodeMap).forEach((fId) => {
    if (!hasIncoming.has(fId)) {
      canvasRoots.push(fId);
    }
  });
  canvasRoots.sort((a, b) => {
    const na =
      tree.nodes[a] ||
      Object.values(tree.nodes).find((n) => a.endsWith(`:::${n.id}`));
    const nb =
      tree.nodes[b] ||
      Object.values(tree.nodes).find((n) => b.endsWith(`:::${n.id}`));
    if (na?.id === tree.rootNodeId) return -1;
    if (nb?.id === tree.rootNodeId) return 1;
    return (na?.position?.x ?? 0) - (nb?.position?.x ?? 0);
  });

  return { layoutNodeMap, canvasRoots };
};

// Auto-layout nodes with clean hierarchical alignment, centering, and strict sibling preservation
export const autoLayoutTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  orientation: "vertical" | "horizontal" = "vertical",
): BehaviorTreeDocument => {
  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree || Object.keys(tree.nodes).length === 0) return doc;

  const isHorizontal = orientation === "horizontal";
  const { layoutNodeMap, canvasRoots } = buildFullLayoutHierarchy(
    nextDoc,
    treeId,
  );

  const positions = layoutBehaviorTree(
    layoutNodeMap,
    canvasRoots,
    isHorizontal,
    {
      marginx: 40,
      marginy: 40,
      nodesep: 40,
      ranksep: 80,
      getNodeHeight: (id) => layoutNodeMap[id]?.height || 80,
    },
  );

  // Apply clean centered positions to all nodes without altering document hierarchy
  Object.values(tree.nodes).forEach((n) => {
    const pos = positions[n.id];
    if (pos) {
      n.position = { ...pos };
    }
  });

  return nextDoc;
};

// Reorder child among its siblings and immediately update canvas coordinate slots
export const reorderChildInTree = (
  doc: BehaviorTreeDocument,
  treeId: string,
  parentId: string,
  fromIndex: number,
  toIndex: number,
): BehaviorTreeDocument => {
  const nextDoc = cloneDocument(doc);
  const tree = nextDoc.trees[treeId];
  if (!tree || !tree.nodes[parentId]) return doc;

  const parent = tree.nodes[parentId];
  if (
    fromIndex < 0 ||
    fromIndex >= parent.children.length ||
    toIndex < 0 ||
    toIndex >= parent.children.length ||
    fromIndex === toIndex
  ) {
    return doc;
  }

  // Check if children have initialized non-zero positions. If not, compute initial layout positions first
  const needsPositions = parent.children.some((cid) => {
    const p = tree.nodes[cid]?.position;
    return !p || (p.x === 0 && p.y === 0);
  });

  if (needsPositions) {
    const { layoutNodeMap, canvasRoots } = buildFullLayoutHierarchy(
      nextDoc,
      treeId,
    );
    const compPos = layoutBehaviorTree(layoutNodeMap, canvasRoots, false, {
      marginx: 40,
      marginy: 40,
      nodesep: 40,
      ranksep: 80,
      getNodeHeight: (id) => layoutNodeMap[id]?.height || 80,
    });
    for (const [nid, pos] of Object.entries(compPos)) {
      if (tree.nodes[nid]) {
        const existing = tree.nodes[nid].position;
        if (!existing || (existing.x === 0 && existing.y === 0)) {
          tree.nodes[nid].position = { ...pos };
        }
      }
    }
  }

  // Record original children array and their root coordinates before reordering
  const origChildren = [...parent.children];
  const origPositions = origChildren.map((cid) => {
    const node = tree.nodes[cid];
    return {
      id: cid,
      pos: node?.position
        ? { x: node.position.x, y: node.position.y }
        : { x: 0, y: 0 },
    };
  });

  // Reorder parent.children array
  const [moved] = parent.children.splice(fromIndex, 1);
  parent.children.splice(toIndex, 0, moved);

  // Helper to collect all descendant IDs of a node in this tree
  const getSubtreeNodeIds = (rootId: string): string[] => {
    const result: string[] = [rootId];
    const queue = [rootId];
    while (queue.length > 0) {
      const currId = queue.shift()!;
      const curr = tree.nodes[currId];
      if (curr?.children) {
        for (const childId of curr.children) {
          result.push(childId);
          queue.push(childId);
        }
      }
    }
    return result;
  };

  // For each child slot in the reordered parent.children:
  // Shift the moved child and its entire subtree by (targetSlotPos - origChildPos)
  for (let i = 0; i < parent.children.length; i++) {
    const cid = parent.children[i];
    const oldIdx = origChildren.indexOf(cid);
    if (oldIdx !== -1 && oldIdx !== i) {
      const targetPos = origPositions[i].pos;
      const oldPos = origPositions[oldIdx].pos;
      const deltaX = targetPos.x - oldPos.x;
      const deltaY = targetPos.y - oldPos.y;

      if (deltaX !== 0 || deltaY !== 0) {
        const subtreeIds = getSubtreeNodeIds(cid);
        for (const sid of subtreeIds) {
          const sNode = tree.nodes[sid];
          if (sNode && sNode.position) {
            sNode.position = {
              x: sNode.position.x + deltaX,
              y: sNode.position.y + deltaY,
            };
          }
        }
      }
    }
  }

  return nextDoc;
};

// Validate document according to Behavior Tree rules
export const validateDocument = (
  doc: BehaviorTreeDocument,
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  if (!doc.trees || Object.keys(doc.trees).length === 0) {
    issues.push({
      id: "doc_empty",
      severity: "error",
      message: "Document contains no Behavior Trees.",
    });
    return issues;
  }

  if (doc.mainTreeId && !doc.trees[doc.mainTreeId]) {
    issues.push({
      id: "main_tree_missing",
      severity: "error",
      message: `Main tree "${doc.mainTreeId}" is not defined in the document.`,
    });
  }

  Object.values(doc.trees).forEach((tree) => {
    if (!tree.id) {
      issues.push({
        id: `tree_no_id_${Math.random()}`,
        severity: "error",
        treeId: tree.id,
        message: "BehaviorTree element is missing an ID attribute.",
      });
    }

    if (!tree.rootNodeId || !tree.nodes[tree.rootNodeId]) {
      issues.push({
        id: `tree_no_root_${tree.id}`,
        severity: "error",
        treeId: tree.id,
        message: `Tree "${tree.id}" has no root node.`,
      });
      return;
    }

    // Check each node in tree
    Object.values(tree.nodes).forEach((node) => {
      // 1. Leaf node rules
      if (node.category === "Action" || node.category === "Condition") {
        if (node.children.length > 0) {
          issues.push({
            id: `leaf_has_children_${node.id}`,
            severity: "error",
            treeId: tree.id,
            nodeId: node.id,
            message: `${node.category} node "${node.name || node.type}" (${node.type}) is a leaf and cannot have children.`,
          });
        }
      }

      // 2. Decorator rules: exactly 1 child
      if (node.category === "Decorator") {
        if (node.children.length === 0) {
          issues.push({
            id: `decorator_no_children_${node.id}`,
            severity: "warning",
            treeId: tree.id,
            nodeId: node.id,
            message: `Decorator "${node.name || node.type}" (${node.type}) has no child node.`,
          });
        } else if (node.children.length > 1) {
          issues.push({
            id: `decorator_multiple_children_${node.id}`,
            severity: "error",
            treeId: tree.id,
            nodeId: node.id,
            message: `Decorator "${node.name || node.type}" (${node.type}) must have exactly 1 child, but has ${node.children.length}.`,
          });
        }
      }

      // 4. Control rules: should have children
      if (node.category === "Control") {
        if (node.children.length === 0) {
          issues.push({
            id: `control_no_children_${node.id}`,
            severity: "warning",
            treeId: tree.id,
            nodeId: node.id,
            message: `Control node "${node.name || node.type}" (${node.type}) has no children.`,
          });
        }
      }

      // 5. Check if children exist in tree.nodes
      node.children.forEach((childId) => {
        if (!tree.nodes[childId]) {
          issues.push({
            id: `missing_child_${node.id}_${childId}`,
            severity: "error",
            treeId: tree.id,
            nodeId: node.id,
            message: `Node "${node.name || node.type}" references non-existent child "${childId}".`,
          });
        }
      });
    });
  });

  return issues;
};
