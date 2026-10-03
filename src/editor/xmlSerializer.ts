import { BehaviorTreeDocument, BTEditorTree, BTEditorNode } from './types';

const escapeXmlAttr = (str: string): string => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

export const serializeDocumentToXml = (doc: BehaviorTreeDocument): string => {
  const indent = (level: number) => '  '.repeat(level);
  const lines: string[] = [];

  // 1. Root Opening
  let rootAttrs = `BTCPP_format="${escapeXmlAttr(doc.formatVersion || '4')}"`;
  if (doc.mainTreeId) {
    rootAttrs += ` main_tree_to_execute="${escapeXmlAttr(doc.mainTreeId)}"`;
  }
  if (doc.customRootAttributes) {
    Object.entries(doc.customRootAttributes).forEach(([k, v]) => {
      rootAttrs += ` ${k}="${escapeXmlAttr(v)}"`;
    });
  }
  lines.push(`<root ${rootAttrs}>`);

  // 2. BehaviorTree Elements
  const treeOrder = doc.treeOrder && doc.treeOrder.length > 0 
    ? doc.treeOrder 
    : Object.keys(doc.trees);

  treeOrder.forEach((treeId) => {
    const tree = doc.trees[treeId];
    if (!tree) return;

    let treeAttrs = `ID="${escapeXmlAttr(tree.id)}"`;
    if (tree.customAttributes) {
      Object.entries(tree.customAttributes).forEach(([k, v]) => {
        treeAttrs += ` ${k}="${escapeXmlAttr(v)}"`;
      });
    }

    lines.push(`${indent(1)}<BehaviorTree ${treeAttrs}>`);

    if (tree.rootNodeId && tree.nodes[tree.rootNodeId]) {
      const serializeNode = (nodeId: string, level: number) => {
        const node = tree.nodes[nodeId];
        if (!node) return;

        const isSubTree = node.category === 'SubTree' || node.type === 'SubTree' || node.type === 'SubTreePlus';
        const targetTreeId = node.attributes?.ID || (isSubTree ? node.name : undefined);

        let attrStr = '';
        if (targetTreeId) {
          attrStr += ` ID="${escapeXmlAttr(targetTreeId)}"`;
        }
        if (node.name && node.name !== targetTreeId) {
          attrStr += ` name="${escapeXmlAttr(node.name)}"`;
        }

        // Custom XML attributes
        if (node.attributes) {
          Object.entries(node.attributes).forEach(([k, v]) => {
            if (k === 'ID') return;
            attrStr += ` ${k}="${escapeXmlAttr(v)}"`;
          });
        }

        // Input ports
        if (node.inputPorts) {
          Object.entries(node.inputPorts).forEach(([k, v]) => {
            attrStr += ` ${k}="${escapeXmlAttr(v)}"`;
          });
        }

        // Output ports
        if (node.outputPorts) {
          Object.entries(node.outputPorts).forEach(([k, v]) => {
            attrStr += ` ${k}="${escapeXmlAttr(v)}"`;
          });
        }

        const hasChildren = node.children && node.children.length > 0;
        if (hasChildren) {
          lines.push(`${indent(level)}<${node.type}${attrStr}>`);
          node.children.forEach((childId) => {
            serializeNode(childId, level + 1);
          });
          lines.push(`${indent(level)}</${node.type}>`);
        } else {
          lines.push(`${indent(level)}<${node.type}${attrStr}/>`);
        }
      };

      serializeNode(tree.rootNodeId, 2);
    }

    lines.push(`${indent(1)}</BehaviorTree>`);
  });

  // 3. TreeNodesModel (Custom node models/definitions if present)
  if (doc.nodeModels && Object.keys(doc.nodeModels).length > 0) {
    lines.push(`${indent(1)}<TreeNodesModel>`);
    Object.values(doc.nodeModels).forEach((model) => {
      let modelAttrs = `ID="${escapeXmlAttr(model.type)}"`;
      if (model.description) {
        modelAttrs += ` description="${escapeXmlAttr(model.description)}"`;
      }

      const inputPorts = model.inputPorts || [];
      const outputPorts = model.outputPorts || [];
      const hasPorts = inputPorts.length > 0 || outputPorts.length > 0;

      if (hasPorts) {
        lines.push(`${indent(2)}<${model.category} ${modelAttrs}>`);
        inputPorts.forEach((p) => {
          let pAttr = `name="${escapeXmlAttr(p.name)}"`;
          if (p.type) pAttr += ` type="${escapeXmlAttr(p.type)}"`;
          if (p.defaultValue) pAttr += ` default="${escapeXmlAttr(p.defaultValue)}"`;
          if (p.description) pAttr += ` description="${escapeXmlAttr(p.description)}"`;
          lines.push(`${indent(3)}<input_port ${pAttr}/>`);
        });
        outputPorts.forEach((p) => {
          let pAttr = `name="${escapeXmlAttr(p.name)}"`;
          if (p.type) pAttr += ` type="${escapeXmlAttr(p.type)}"`;
          if (p.defaultValue) pAttr += ` default="${escapeXmlAttr(p.defaultValue)}"`;
          if (p.description) pAttr += ` description="${escapeXmlAttr(p.description)}"`;
          lines.push(`${indent(3)}<output_port ${pAttr}/>`);
        });
        lines.push(`${indent(2)}</${model.category}>`);
      } else {
        lines.push(`${indent(2)}<${model.category} ${modelAttrs}/>`);
      }
    });
    lines.push(`${indent(1)}</TreeNodesModel>`);
  }

  // 4. Root Closing
  lines.push('</root>\n');

  return lines.join('\n');
};
