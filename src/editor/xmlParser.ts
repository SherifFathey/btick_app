import {
  BehaviorTreeDocument,
  BTEditorTree,
  BTEditorNode,
  BTNodeModelDefinition,
  BTEditorPortDefinition,
} from "./types";
import { BUILTIN_NODE_DEFINITIONS, inferNodeCategory } from "./nodeLibrary";
import {
  calculateEditorNodeHeight,
  layoutBehaviorTree,
  autoLayoutTree,
} from "./documentModel";

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

export const parseXmlToDocument = (
  xmlContent: string,
  fileName: string = "behavior_tree.xml",
): BehaviorTreeDocument | null => {
  try {
    const parser = getDOMParser();
    const doc = parser.parseFromString(xmlContent, "text/xml");
    const parserError = doc.getElementsByTagName("parsererror");
    if (parserError.length > 0) {
      console.warn("XML Parser Error in editor:", parserError[0].textContent);
      return null;
    }

    const rootElement = doc.documentElement;
    if (rootElement.tagName.toLowerCase() !== "root") {
      console.warn("Expected <root> element, found:", rootElement.tagName);
      return null;
    }

    const formatVersion =
      rootElement.getAttribute("BTCPP_format") ||
      rootElement.getAttribute("format") ||
      "4";
    let mainTreeId = rootElement.getAttribute("main_tree_to_execute") || "";

    // Collect custom root attributes
    const customRootAttributes: Record<string, string> = {};
    Array.from(rootElement.attributes).forEach((attr: Attr) => {
      if (
        attr.name !== "BTCPP_format" &&
        attr.name !== "format" &&
        attr.name !== "main_tree_to_execute"
      ) {
        customRootAttributes[attr.name] = attr.value;
      }
    });

    // Parse <TreeNodesModel> if present
    const nodeModels: Record<string, BTNodeModelDefinition> = {};
    const treeNodesModelElems = doc.getElementsByTagName("TreeNodesModel");
    if (treeNodesModelElems.length > 0) {
      const modelContainer = treeNodesModelElems[0];
      Array.from(modelContainer.children || modelContainer.childNodes).forEach(
        (nodeElem: any) => {
          if (!nodeElem || nodeElem.nodeType !== 1) return;
          const tag = nodeElem.tagName;
          const id =
            nodeElem.getAttribute("ID") || nodeElem.getAttribute("id") || tag;
          const description = nodeElem.getAttribute("description") || undefined;

          const inputPorts: BTEditorPortDefinition[] = [];
          const outputPorts: BTEditorPortDefinition[] = [];

          Array.from(nodeElem.children || nodeElem.childNodes).forEach(
            (portElem: any) => {
              if (!portElem || portElem.nodeType !== 1) return;
              const portTag = portElem.tagName.toLowerCase();
              const portName = portElem.getAttribute("name");
              if (!portName) return;

              const portDef: BTEditorPortDefinition = {
                name: portName,
                type: portElem.getAttribute("type") || undefined,
                defaultValue: portElem.getAttribute("default") || undefined,
                description: portElem.getAttribute("description") || undefined,
              };

              if (portTag.includes("output")) {
                outputPorts.push(portDef);
              } else {
                inputPorts.push(portDef);
              }
            },
          );

          nodeModels[id] = {
            type: id,
            category: inferNodeCategory(id),
            description,
            inputPorts: inputPorts.length > 0 ? inputPorts : undefined,
            outputPorts: outputPorts.length > 0 ? outputPorts : undefined,
          };
        },
      );
    }

    // Parse <BehaviorTree> elements
    const behaviorTreeElems = Array.from(
      doc.getElementsByTagName("BehaviorTree"),
    ) as Element[];
    if (behaviorTreeElems.length === 0) {
      console.warn("No <BehaviorTree> blocks found in XML");
      return null;
    }

    const trees: Record<string, BTEditorTree> = {};
    const treeOrder: string[] = [];

    behaviorTreeElems.forEach((btElem: Element, treeIdx: number) => {
      const treeId =
        btElem.getAttribute("ID") ||
        btElem.getAttribute("id") ||
        `Tree_${treeIdx + 1}`;
      treeOrder.push(treeId);
      if (!mainTreeId && treeIdx === 0) {
        mainTreeId = treeId;
      }

      // Collect custom attributes on <BehaviorTree>
      const customTreeAttributes: Record<string, string> = {};
      Array.from(btElem.attributes).forEach((attr: Attr) => {
        if (attr.name !== "ID" && attr.name !== "id") {
          customTreeAttributes[attr.name] = attr.value;
        }
      });

      const nodes: Record<string, BTEditorNode> = {};
      let nodeCounter = 0;
      const usedIds = new Set<string>();

      const parseNode = (elem: any, parentId: string | null): string | null => {
        const tagName = elem.tagName;
        if (tagName.toLowerCase().includes("port")) return null;

        const nameAttr = elem.getAttribute("name");
        const idAttr = elem.getAttribute("ID") || elem.getAttribute("id");
        const rawUid = elem.getAttribute("_uid");

        // Generate unique node ID for the editor
        const baseName = nameAttr || idAttr || tagName;
        let generatedId = rawUid ? `${baseName}_${rawUid}` : baseName;
        if (usedIds.has(generatedId) || !rawUid) {
          nodeCounter++;
          generatedId = `${baseName}_${nodeCounter}`;
        }
        while (usedIds.has(generatedId)) {
          nodeCounter++;
          generatedId = `${baseName}_${nodeCounter}`;
        }
        usedIds.add(generatedId);

        const category = inferNodeCategory(tagName);

        const inputPorts: Record<string, string> = {};
        const outputPorts: Record<string, string> = {};
        const attributes: Record<string, string> = {};

        // Parse attributes and ports
        Array.from(elem.attributes).forEach((attr: any) => {
          if (
            attr.name === "name" ||
            attr.name === "_uid" ||
            attr.name === "ID" ||
            attr.name === "id"
          )
            return;
          const val = attr.value;
          const isBlackboard = val.startsWith("{") && val.endsWith("}");

          // Check against known node models for port direction
          const model =
            nodeModels[tagName] || BUILTIN_NODE_DEFINITIONS[tagName];
          const isOutputPort = model?.outputPorts?.some(
            (p) => p.name === attr.name,
          );
          const isInputPort = model?.inputPorts?.some(
            (p) => p.name === attr.name,
          );

          if (isOutputPort) {
            outputPorts[attr.name] = val;
          } else if (isInputPort) {
            inputPorts[attr.name] = val;
          } else if (isBlackboard) {
            inputPorts[attr.name] = val;
          } else {
            attributes[attr.name] = val;
          }
        });

        // Parse children
        const children: string[] = [];
        Array.from(elem.children || elem.childNodes).forEach((child: any) => {
          if (
            child &&
            child.nodeType === 1 &&
            !child.tagName.toLowerCase().includes("port")
          ) {
            const childId = parseNode(child, generatedId);
            if (childId) children.push(childId);
          }
        });

        // If ID attribute is present, preserve it in attributes (essential for SubTree and custom nodes)
        if (idAttr) {
          attributes["ID"] = idAttr;
        }

        const isSubTree =
          category === "SubTree" ||
          tagName === "SubTree" ||
          tagName === "SubTreePlus";

        nodes[generatedId] = {
          id: generatedId,
          type: tagName,
          name: nameAttr || idAttr || undefined,
          category,
          attributes,
          inputPorts,
          outputPorts,
          children,
          parentId,
          position: { x: 0, y: 0 },
          isSubTreeExpanded: isSubTree ? true : undefined,
        };

        return generatedId;
      };

      // Find and parse root node(s) of this tree
      const validChildren = Array.from(
        btElem.children || btElem.childNodes,
      ).filter(
        (c: any) =>
          c && c.nodeType === 1 && !c.tagName.toLowerCase().includes("port"),
      );

      let rootNodeId = "";
      validChildren.forEach((childElem: any, idx: number) => {
        const parsedId = parseNode(childElem, null);
        if (idx === 0 && parsedId) {
          rootNodeId = parsedId;
        }
      });

      // Compute initial positions using clean hierarchical layout
      if (rootNodeId && Object.keys(nodes).length > 0) {
        const positions = layoutBehaviorTree(nodes, [rootNodeId], false, {
          marginx: 40,
          marginy: 40,
          nodesep: 40,
          ranksep: 80,
          getNodeHeight: (id) => calculateEditorNodeHeight(nodes[id]) || 80,
        });

        Object.values(nodes).forEach((n) => {
          const pos = positions[n.id];
          if (pos) {
            n.position = { ...pos };
          }
        });
      }

      trees[treeId] = {
        id: treeId,
        rootNodeId,
        nodes,
        customAttributes: customTreeAttributes,
      };
    });

    if (!mainTreeId && treeOrder.length > 0) {
      mainTreeId = treeOrder[0];
    }

    const parsedDoc: BehaviorTreeDocument = {
      formatVersion,
      mainTreeId,
      trees,
      treeOrder,
      customRootAttributes,
      nodeModels,
      fileName,
    };

    // Run clean hierarchical layout across all trees including inlined SubTrees
    Object.keys(trees).forEach((tId) => {
      const laidOut = autoLayoutTree(parsedDoc, tId, "vertical");
      if (laidOut.trees[tId]) {
        trees[tId] = laidOut.trees[tId];
      }
    });

    return parsedDoc;
  } catch (err) {
    console.error("Failed to parse XML into BehaviorTreeDocument:", err);
    return null;
  }
};
