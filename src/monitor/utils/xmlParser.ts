import {
  BTNodeModel,
  BTTreeModel,
  NodeCategory,
  NodeStatus,
  TreeStatus,
  TransitionEvent,
} from "../types/bt";

export const GENERIC_BT_NODES = new Set([
  "Sequence",
  "ReactiveSequence",
  "SequenceWithMemory",
  "PipelineSequence",
  "Fallback",
  "ReactiveFallback",
  "Parallel",
  "RecoveryNode",
  "RoundRobin",
  "IfThenElse",
  "Switch2",
  "Switch3",
  "RateController",
  "Inverter",
  "RetryUntilSuccessful",
  "Repeat",
  "Timeout",
  "ForceSuccess",
  "ForceFailure",
  "KeepRunningUntilFailure",
  "Precondition",
  "Delay",
  "ScriptCondition",
  "Script",
  "AlwaysFailure",
  "AlwaysSuccess",
]);

export const mergeNodesWithExisting = (
  incomingNodes: BTNodeModel[],
  existingNodes?: BTNodeModel[],
  isRestart: boolean = false,
): BTNodeModel[] => {
  if (!existingNodes || existingNodes.length === 0 || isRestart) {
    return incomingNodes.map((n) => ({
      ...n,
      status: n.status || "IDLE",
      last_result:
        n.last_result ??
        (n.status === "SUCCESS" || n.status === "FAILURE"
          ? n.status
          : undefined),
      is_paused: false,
    }));
  }
  const existingMap = new Map<string, BTNodeModel>();
  for (const n of existingNodes) {
    if (n.uid && n.uid !== 0) existingMap.set(`uid_${n.uid}`, n);
    if (n.id) existingMap.set(n.id, n);
    if (n.name) existingMap.set(`name_${n.name}`, n);
  }
  return incomingNodes.map((n) => {
    const prev =
      (n.uid && n.uid !== 0 ? existingMap.get(`uid_${n.uid}`) : undefined) ||
      existingMap.get(n.id) ||
      (n.name ? existingMap.get(`name_${n.name}`) : undefined);

    if (!prev) {
      return {
        ...n,
        status: n.status || "IDLE",
        last_result:
          n.last_result ??
          (n.status === "SUCCESS" || n.status === "FAILURE"
            ? n.status
            : undefined),
        is_paused: false,
      };
    }

    // Always prioritize existing live execution status over skeleton IDLE status!
    const hasActiveBp = Boolean(prev.is_breakpoint);
    const wasPausedWithBp =
      (prev.status === "PAUSED_AT_BREAKPOINT" || prev.is_paused) && hasActiveBp;
    const effectiveStatus = wasPausedWithBp
      ? ("PAUSED_AT_BREAKPOINT" as NodeStatus)
      : prev.status === "PAUSED_AT_BREAKPOINT"
        ? (prev.last_result as NodeStatus) || "IDLE"
        : prev.status && prev.status !== "IDLE"
          ? prev.status
          : n.status && n.status !== "IDLE"
            ? n.status
            : prev.status || "IDLE";

    const mergedOutputPortsValues = {
      ...(prev.output_ports_values || {}),
      ...(n.output_ports_values || {}),
    };

    const mergedPortDetails =
      n.port_details?.map((pd) => {
        const prevPd = prev.port_details?.find((p) => p.name === pd.name);
        return {
          ...pd,
          runtime_value:
            pd.runtime_value ||
            prevPd?.runtime_value ||
            mergedOutputPortsValues[pd.name] ||
            undefined,
        };
      }) || prev.port_details;

    return {
      ...n,
      status: effectiveStatus,
      last_result: prev.last_result ?? n.last_result,
      is_breakpoint: prev.is_breakpoint ?? n.is_breakpoint,
      breakpoint_once: prev.breakpoint_once ?? n.breakpoint_once,
      is_paused: wasPausedWithBp,
      fault_mode: prev.fault_mode ?? n.fault_mode,
      fault_delay_ms: prev.fault_delay_ms ?? n.fault_delay_ms,
      fault_once: prev.fault_once ?? n.fault_once,
      delay_active: prev.delay_active ?? n.delay_active,
      delay_total_ms: prev.delay_total_ms ?? n.delay_total_ms,
      delay_started_at: prev.delay_started_at ?? n.delay_started_at,
      delay_activation_id: prev.delay_activation_id ?? n.delay_activation_id,
      last_duration: prev.last_duration ?? n.last_duration,
      tick_count: prev.tick_count ?? n.tick_count,
      output_ports_values: mergedOutputPortsValues,
      port_details: mergedPortDetails,
    };
  });
};

export const isMatchNode = (
  n: BTNodeModel,
  event: TransitionEvent,
): boolean => {
  // 1. Direct node_id match
  if (event.node_id && (n.id === event.node_id || n.name === event.node_id)) {
    return true;
  }
  // 2. Strict UID match (verifying compatibility if node_name is present)
  if (
    event.uid !== undefined &&
    event.uid > 0 &&
    n.uid !== undefined &&
    n.uid > 0
  ) {
    if (n.uid === event.uid) {
      if (!event.node_name) return true;
      if (
        n.name === event.node_name ||
        n.type === event.node_name ||
        n.id.startsWith(event.node_name) ||
        n.id.includes(event.node_name) ||
        event.node_name.startsWith(n.name) ||
        event.node_name.startsWith(n.type)
      ) {
        return true;
      }
      return true;
    }
    return false;
  }
  // 3. Match by node_name / type / id when UID is 0 or not available
  if (event.node_name) {
    return (
      n.name === event.node_name ||
      n.type === event.node_name ||
      n.id === event.node_name ||
      n.id.startsWith(event.node_name + "_") ||
      n.id.startsWith(event.node_name)
    );
  }
  return false;
};

// Helper to ensure every Behavior Tree has a prominent 'Root' card at its origin
export const attachRootCard = (tree: BTTreeModel): BTTreeModel => {
  if (!tree || !tree.nodes || tree.nodes.length === 0) return tree;

  // Check if a node named "Root" or typed "Root" already exists as the root
  const hasRootNode = tree.nodes.some(
    (n) =>
      (n.type === "Root" || n.name === "Root") &&
      (n.parent_id === "" || !n.parent_id),
  );
  if (hasRootNode) return tree;

  // Find the top node of the tree (node with parent_id === '' or root_node_id or uid === 1)
  const currentRoot =
    tree.nodes.find(
      (n) =>
        n.id === tree.root_node_id ||
        n.parent_id === "" ||
        !n.parent_id ||
        n.uid === 1,
    ) || tree.nodes[0];
  const rootId = `Root_${tree.tree_id}`;

  const rootCard: BTNodeModel = {
    id: rootId,
    uid: 0,
    name: "Root",
    type: "Root",
    category: "Control",
    parent_id: "",
    children_ids: currentRoot ? [currentRoot.id] : [],
    ports: {},
    attributes: {},
    status: currentRoot ? currentRoot.status : "IDLE",
  };

  const updatedNodes = tree.nodes.map((n) => {
    if (currentRoot && n.id === currentRoot.id) {
      return { ...n, parent_id: rootId };
    }
    return n;
  });

  return {
    ...tree,
    root_node_id: rootId,
    nodes: [rootCard, ...updatedNodes],
  };
};

export const getTreeStatus = (tree: BTTreeModel): string => {
  if (tree.status === "STOPPED" || tree.status === "DESTROYED")
    return tree.status;
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
  const hasRunningNode = tree.nodes.some(
    (n) =>
      n.type !== "Root" &&
      n.name !== "Root" &&
      (n.status === "RUNNING" || n.status === ("PAUSED_AT_BREAKPOINT" as any)),
  );
  if (hasRunningNode) return "RUNNING";
  return tree.status || "IDLE";
};

const getDOMParser = (): {
  parseFromString: (xml: string, mime: DOMParserSupportedType) => Document;
} => {
  if (
    typeof window !== "undefined" &&
    typeof window.DOMParser !== "undefined"
  ) {
    return new window.DOMParser();
  }
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as any).DOMParser !== "undefined"
  ) {
    return new (globalThis as any).DOMParser();
  }
  try {
    const req = typeof require !== "undefined" ? require : null;
    if (req) {
      const { DOMParser: XMLDOMParser } = req("@xmldom/xmldom");
      return new XMLDOMParser();
    }
  } catch {
    // ignore
  }
  throw new Error("DOMParser is not available in current environment");
};

export const parseXmlToBTTreeModel = (
  xmlContent: string,
  fileName: string = "behavior_tree.xml",
): BTTreeModel | null => {
  try {
    const parser = getDOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
    const parseError = xmlDoc.getElementsByTagName("parsererror");
    if (parseError.length > 0) {
      console.warn(
        "[BTick][XMLParser] Parse error:",
        parseError[0].textContent,
      );
      return null;
    }

    const rootElem = xmlDoc.documentElement;
    const mainTreeId = rootElem.getAttribute("main_tree_to_execute");
    const behaviorTrees = Array.from(
      xmlDoc.getElementsByTagName("BehaviorTree"),
    ) as Element[];

    if (behaviorTrees.length === 0) return null;

    const btMap = new Map<string, Element>();
    const btFullpathMap = new Map<string, Element>();
    behaviorTrees.forEach((bt: Element) => {
      const id = bt.getAttribute("ID");
      const fp = bt.getAttribute("_fullpath");
      if (id) btMap.set(id, bt);
      if (fp) btFullpathMap.set(fp, bt);
    });

    let targetBt = behaviorTrees[0];
    if (mainTreeId && btMap.has(mainTreeId)) {
      targetBt = btMap.get(mainTreeId)!;
    }

    const treeId =
      targetBt.getAttribute("ID") ||
      mainTreeId ||
      fileName.replace(/\.[^/.]+$/, "") ||
      "MainTree";
    const nodesList: BTNodeModel[] = [];
    const blackboardVars: Record<string, any> = {};
    const usedUids = new Set<number>();
    let counter = 0;

    const parseElem = (
      elem: Element,
      parentId: string,
      visitedSubtrees: Set<string>,
    ): string | null => {
      const tagName = elem.tagName;
      if (tagName.includes("Port") || tagName.includes("port")) return null;

      const isSubtreeTag =
        tagName === "SubTree" ||
        tagName === "SubTreePlus" ||
        tagName.includes("SubTree");
      const nameAttr = elem.getAttribute("name");
      const idAttr = elem.getAttribute("ID") || elem.getAttribute("subtree_id");
      const fullpathAttr = elem.getAttribute("_fullpath");
      const rawUidAttr = elem.getAttribute("_uid");

      const displayName = nameAttr || idAttr || tagName;

      let uid = 0;
      if (rawUidAttr && !isNaN(Number(rawUidAttr))) {
        uid = parseInt(rawUidAttr, 10);
        usedUids.add(uid);
      } else {
        counter++;
        while (usedUids.has(counter)) {
          counter++;
        }
        uid = counter;
        usedUids.add(uid);
      }

      const nodeId = `${displayName.replace(/\s+/g, "_")}_${uid}`;

      let category: NodeCategory = "Action";
      if (
        [
          "Sequence",
          "Fallback",
          "Parallel",
          "ReactiveSequence",
          "ReactiveFallback",
          "SequenceWithMemory",
          "PipelineSequence",
          "RecoveryNode",
          "RoundRobin",
          "IfThenElse",
          "Switch2",
          "Switch3",
        ].includes(tagName)
      ) {
        category = "Control";
      } else if (
        [
          "Inverter",
          "Repeat",
          "RetryUntilSuccessful",
          "Timeout",
          "ForceSuccess",
          "ForceFailure",
          "RateController",
          "Delay",
          "KeepRunningUntilFailure",
          "Precondition",
        ].includes(tagName)
      ) {
        category = "Decorator";
      } else if (isSubtreeTag) {
        category = "SubTree";
      } else if (
        tagName.includes("Condition") ||
        tagName.startsWith("Check") ||
        tagName.startsWith("Is") ||
        tagName.includes("Verify") ||
        tagName.startsWith("Would") ||
        tagName === "AlwaysFailure" ||
        tagName === "AlwaysSuccess" ||
        tagName === "GoalReached"
      ) {
        category = "Condition";
      } else {
        category = "Action";
      }

      // Extract ports and attributes
      const ports: Record<string, string> = {};
      const attributes: Record<string, string> = {};
      Array.from(elem.attributes).forEach((attr) => {
        if (
          attr.name === "name" ||
          attr.name === "ID" ||
          attr.name.startsWith("_")
        )
          return;
        if (attr.value.startsWith("{") && attr.value.endsWith("}")) {
          ports[attr.name] = attr.value;
          const rawKey = attr.value.slice(1, -1).trim();
          if (rawKey && blackboardVars[rawKey] === undefined) {
            blackboardVars[rawKey] = undefined;
          }
        } else {
          attributes[attr.name] = attr.value;
        }
      });

      const childrenIds: string[] = [];

      // Expand SubTrees
      const targetSubTreeId = idAttr || nameAttr;
      if (isSubtreeTag) {
        let subTreeBt: Element | undefined = undefined;
        if (fullpathAttr && btFullpathMap.has(fullpathAttr)) {
          subTreeBt = btFullpathMap.get(fullpathAttr);
        } else if (targetSubTreeId && btMap.has(targetSubTreeId)) {
          subTreeBt = btMap.get(targetSubTreeId);
        }

        if (subTreeBt) {
          const subKey = fullpathAttr || targetSubTreeId || displayName;
          if (!visitedSubtrees.has(subKey)) {
            const nextVisited = new Set(visitedSubtrees);
            nextVisited.add(subKey);
            Array.from(
              subTreeBt.children || (subTreeBt as any).childNodes || [],
            ).forEach((child: any) => {
              if (
                child &&
                child.nodeType === 1 &&
                child.tagName &&
                !child.tagName.toLowerCase().includes("port")
              ) {
                const childId = parseElem(child, nodeId, nextVisited);
                if (childId) childrenIds.push(childId);
              }
            });
          }
        }
      } else {
        Array.from(elem.children || (elem as any).childNodes || []).forEach(
          (child: any) => {
            if (
              child &&
              child.nodeType === 1 &&
              child.tagName &&
              !child.tagName.toLowerCase().includes("port")
            ) {
              const childId = parseElem(child, nodeId, visitedSubtrees);
              if (childId) childrenIds.push(childId);
            }
          },
        );
      }

      nodesList.push({
        id: nodeId,
        uid,
        name: displayName,
        type: tagName,
        category,
        parent_id: parentId,
        children_ids: childrenIds,
        ports,
        attributes,
        status: "IDLE",
      });

      return nodeId;
    };

    const rootId = `Root_${treeId}`;
    const rootChildrenIds: string[] = [];
    Array.from(
      targetBt.children || (targetBt as unknown as Element).childNodes || [],
    ).forEach((child: any) => {
      if (
        child &&
        child.nodeType === 1 &&
        child.tagName &&
        !child.tagName.toLowerCase().includes("port")
      ) {
        const childId = parseElem(child, rootId, new Set([treeId]));
        if (childId) rootChildrenIds.push(childId);
      }
    });

    // Insert top Root node
    nodesList.unshift({
      id: rootId,
      uid: 0,
      name: "Root",
      type: "Root",
      category: "Control",
      parent_id: "",
      children_ids: rootChildrenIds,
      ports: {},
      attributes: {},
      status: "IDLE",
    });

    const parsedTree: BTTreeModel = {
      type: "tree_created",
      tree_id: treeId,
      tree_name: treeId,
      root_node_id: rootId,
      status: "CREATED",
      xml_path: fileName,
      nodes: nodesList,
      visible: true,
      blackboard: blackboardVars,
    };

    return parsedTree;
  } catch (e) {
    console.warn("[BTick][XMLParser] XML parse warning:", e);
    return null;
  }
};
