import { NodeCategory } from '../shared/types/btCategory';

export type BTEditorNodeCategory = NodeCategory;

export interface BTEditorPortDefinition {
  name: string;
  type?: string;
  defaultValue?: string;
  description?: string;
}

export interface BTNodeModelDefinition {
  type: string;
  category: BTEditorNodeCategory;
  description?: string;
  inputPorts?: BTEditorPortDefinition[];
  outputPorts?: BTEditorPortDefinition[];
}

export interface BTEditorNode {
  id: string; // Unique identifier within document (e.g. "Sequence_1")
  type: string; // XML tag name: "Sequence", "Fallback", "MoveTo", etc.
  name?: string; // Optional "name" attribute
  category: BTEditorNodeCategory;
  attributes: Record<string, string>; // Custom/unknown XML attributes
  inputPorts: Record<string, string>; // Port name -> value (literal or {bb})
  outputPorts: Record<string, string>; // Port name -> value
  children: string[]; // Ordered list of child node IDs (defines XML hierarchy!)
  parentId?: string | null;
  position: { x: number; y: number }; // Visual canvas position metadata only
  isCollapsed?: boolean;
  isSubTreeExpanded?: boolean; // When true, SubTree contents are rendered as nested container
}

export interface BTEditorConnection {
  id: string;
  source: string; // parent ID
  target: string; // child ID
  treeId: string;
}

export interface BTEditorTree {
  id: string; // BehaviorTree ID, e.g. "MainTree"
  rootNodeId: string; // ID of the root node inside this tree
  nodes: Record<string, BTEditorNode>; // id -> BTEditorNode map
  customAttributes: Record<string, string>; // Custom attributes on <BehaviorTree> tag
}

export interface BehaviorTreeDocument {
  formatVersion: string; // e.g. "4" or "3"
  mainTreeId: string; // main_tree_to_execute
  trees: Record<string, BTEditorTree>; // tree ID -> BTEditorTree
  treeOrder: string[]; // Order of <BehaviorTree> elements
  customRootAttributes: Record<string, string>; // Extra attributes on <root>
  nodeModels: Record<string, BTNodeModelDefinition>; // Custom node types from <TreeNodesModel>
  fileName?: string;
}

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  treeId?: string;
  nodeId?: string;
  message: string;
}

export interface EditorClipboard {
  node: BTEditorNode;
  descendantNodes: BTEditorNode[];
}
