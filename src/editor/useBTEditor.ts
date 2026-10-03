import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  BehaviorTreeDocument, 
  BTEditorNode, 
  ValidationIssue, 
  EditorClipboard,
  BTEditorConnection
} from './types';
import { createDefaultDocument } from './defaultTemplate';
import { parseXmlToDocument } from './xmlParser';
import { serializeDocumentToXml } from './xmlSerializer';
import { 
  cloneDocument, 
  addNodeToTree, 
  removeNodeFromTree, 
  reparentNodeInTree, 
  reorderChildInTree, 
  updateNodeInTree, 
  duplicateSubtreeInTree, 
  autoLayoutTree, 
  validateDocument,
  disconnectChildInTree,
  reconnectEdgeInTree,
  changeNodeTypeInTree,
  ChangeNodeTypeResolution,
  getSubTreeTargetId
} from './documentModel';

const MAX_HISTORY = 50;

export interface UseBTEditorReturn {
  document: BehaviorTreeDocument;
  activeTreeId: string;
  activeTree: BehaviorTreeDocument['trees'][string] | null;
  selectedTreeId: string;
  selectedNodeId: string | null;
  selectedNode: BTEditorNode | null;
  selectedEdgeId: string | null;
  selectedEdge: BTEditorConnection | null;
  orientation: 'vertical' | 'horizontal';
  openTimestamp: number;
  isDirty: boolean;
  validationIssues: ValidationIssue[];
  canUndo: boolean;
  canRedo: boolean;
  clipboard: EditorClipboard | null;
  
  // Navigation & View
  setActiveTreeId: (treeId: string) => void;
  setSelectedNodeId: (nodeId: string | null, treeId?: string) => void;
  setSelectedTreeId: (treeId: string) => void;
  setSelectedEdgeId: (edgeId: string | null) => void;
  setSelectedEdge: (edge: BTEditorConnection | null) => void;
  setOrientation: (orientation: 'vertical' | 'horizontal') => void;
  
  // History
  undo: () => void;
  redo: () => void;
  
  // File operations
  newDocument: () => void;
  openDocument: (xmlContent: string, fileName?: string) => boolean;
  getSerializedXml: () => string;
  saveDocument: (customFileName?: string) => void;
  
  // Node operations
  addNode: (parentId: string | null, nodeType: string, nodeName?: string, targetIndex?: number, treeId?: string, initialPosition?: { x: number; y: number }) => string;
  deleteNode: (nodeId: string, treeId?: string) => void;
  reparentNode: (nodeId: string, newParentId: string | null, targetIndex?: number, treeId?: string) => void;
  reorderChildren: (parentId: string, fromIndex: number, toIndex: number, treeId?: string) => void;
  updateNode: (nodeId: string, updates: Partial<BTEditorNode>, treeId?: string) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }, treeId?: string) => void;
  duplicateNode: (nodeId: string, treeId?: string) => string;
  runAutoLayout: (treeId?: string, overrideOrientation?: 'vertical' | 'horizontal') => void;
  changeNodeType: (nodeId: string, newType: string, resolution?: ChangeNodeTypeResolution, treeId?: string) => void;
  toggleSubTreeExpanded: (nodeId: string, treeId?: string) => void;

  // Edge operations
  disconnectEdge: (sourceParentId: string, targetChildId: string, treeId?: string) => void;
  reconnectEdge: (oldParentId: string, newParentId: string, childId: string, treeId?: string) => { success: boolean; error?: string };
  
  // Clipboard
  copyNode: (nodeId: string, treeId?: string) => void;
  pasteNode: (targetParentId?: string | null, treeId?: string) => void;
}

export const useBTEditor = (initialXml?: string): UseBTEditorReturn => {
  // Initialize document
  const initialDoc = useMemo(() => {
    if (initialXml) {
      const parsed = parseXmlToDocument(initialXml);
      if (parsed) return parsed;
    }
    return createDefaultDocument();
  }, [initialXml]);

  const [document, setDocument] = useState<BehaviorTreeDocument>(initialDoc);
  const [activeTreeId, setActiveTreeIdState] = useState<string>(initialDoc.mainTreeId || Object.keys(initialDoc.trees)[0] || 'MainTree');
  const [selectedTreeId, setSelectedTreeId] = useState<string>(activeTreeId);
  const [selectedNodeId, setSelectedNodeIdState] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeIdState] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdgeState] = useState<BTEditorConnection | null>(null);
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('vertical');
  const [openTimestamp, setOpenTimestamp] = useState<number>(Date.now());
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);

  // Synchronize selectedTreeId when activeTreeId changes
  const setActiveTreeId = useCallback((treeId: string) => {
    setActiveTreeIdState(treeId);
    setSelectedTreeId(treeId);
    setSelectedNodeIdState(null);
    setSelectedEdgeIdState(null);
    setSelectedEdgeState(null);
  }, []);

  const setSelectedNodeId = useCallback((nodeId: string | null, treeId?: string) => {
    setSelectedNodeIdState(nodeId);
    if (treeId) {
      setSelectedTreeId(treeId);
    } else if (!nodeId) {
      setSelectedTreeId(activeTreeId);
    }
    if (nodeId) {
      setSelectedEdgeIdState(null);
      setSelectedEdgeState(null);
    }
  }, [activeTreeId]);

  const setSelectedEdgeId = useCallback((edgeId: string | null) => {
    setSelectedEdgeIdState(edgeId);
    if (edgeId) {
      setSelectedNodeIdState(null);
    }
  }, []);

  const setSelectedEdge = useCallback((edge: BTEditorConnection | null) => {
    setSelectedEdgeState(edge);
    setSelectedEdgeIdState(edge ? edge.id : null);
    if (edge) {
      setSelectedNodeIdState(null);
      setSelectedTreeId(edge.treeId);
    }
  }, []);

  // History stack
  const historyRef = useRef<BehaviorTreeDocument[]>([cloneDocument(initialDoc)]);
  const historyIndexRef = useRef<number>(0);
  const [, setHistoryTick] = useState<number>(0); // force re-render on history change

  const pushHistory = useCallback((nextDoc: BehaviorTreeDocument) => {
    const curIdx = historyIndexRef.current;
    const nextHistory = historyRef.current.slice(0, curIdx + 1);
    nextHistory.push(cloneDocument(nextDoc));

    if (nextHistory.length > MAX_HISTORY) {
      nextHistory.shift();
    }

    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    setDocument(nextDoc);
    setIsDirty(true);
    setHistoryTick((t) => t + 1);
  }, []);

  // Undo / Redo
  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const prev = historyRef.current[historyIndexRef.current];
      setDocument(cloneDocument(prev));
      setIsDirty(true);
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const next = historyRef.current[historyIndexRef.current];
      setDocument(cloneDocument(next));
      setIsDirty(true);
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  // Validation
  const validationIssues = useMemo(() => {
    return validateDocument(document);
  }, [document]);

  const activeTree = document.trees[activeTreeId] || null;
  const currentSelectedTree = document.trees[selectedTreeId] || activeTree;
  const selectedNode = currentSelectedTree && selectedNodeId ? currentSelectedTree.nodes[selectedNodeId] || null : null;

  // New Document
  const newDocument = useCallback(() => {
    const fresh = createDefaultDocument();
    historyRef.current = [cloneDocument(fresh)];
    historyIndexRef.current = 0;
    setDocument(fresh);
    setActiveTreeId(fresh.mainTreeId);
    setSelectedNodeId(null);
    setSelectedEdge(null);
    setIsDirty(false);
    setOpenTimestamp(Date.now());
    setHistoryTick((t) => t + 1);
  }, [setActiveTreeId, setSelectedNodeId, setSelectedEdge]);

  // Open Document
  const openDocument = useCallback((xmlContent: string, fileName?: string): boolean => {
    const parsed = parseXmlToDocument(xmlContent, fileName);
    if (!parsed) return false;

    historyRef.current = [cloneDocument(parsed)];
    historyIndexRef.current = 0;
    setDocument(parsed);
    const targetTreeId = parsed.mainTreeId || Object.keys(parsed.trees)[0] || 'MainTree';
    setActiveTreeId(targetTreeId);
    setSelectedTreeId(targetTreeId);
    setSelectedNodeId(null);
    setSelectedEdge(null);
    setIsDirty(false);
    setOpenTimestamp(Date.now());
    setHistoryTick((t) => t + 1);
    return true;
  }, [setActiveTreeId, setSelectedTreeId, setSelectedNodeId, setSelectedEdge]);

  const lastInitialXmlRef = useRef<string | undefined>(initialXml);
  useEffect(() => {
    if (initialXml && initialXml !== lastInitialXmlRef.current) {
      lastInitialXmlRef.current = initialXml;
      openDocument(initialXml);
    }
  }, [initialXml, openDocument]);

  // Get Serialized XML
  const getSerializedXml = useCallback(() => {
    return serializeDocumentToXml(document);
  }, [document]);

  // Save / Download Document
  const saveDocument = useCallback((customFileName?: string) => {
    const xml = serializeDocumentToXml(document);
    const fileName = customFileName || document.fileName || 'behavior_tree.xml';
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setIsDirty(false);
  }, [document]);

  // Node operations
  const addNode = useCallback((
    parentId: string | null, 
    nodeType: string, 
    nodeName?: string, 
    targetIndex?: number,
    treeId?: string,
    initialPosition?: { x: number; y: number }
  ): string => {
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const { nextDoc, newNodeId } = addNodeToTree(document, targetTree, parentId, nodeType, nodeName, targetIndex, initialPosition);
    pushHistory(nextDoc);
    setSelectedNodeId(newNodeId, targetTree);
    return newNodeId;
  }, [document, selectedTreeId, activeTreeId, pushHistory, setSelectedNodeId]);

  const deleteNode = useCallback((nodeId: string, treeId?: string) => {
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const nextDoc = removeNodeFromTree(document, targetTree, nodeId);
    pushHistory(nextDoc);
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
  }, [document, selectedTreeId, activeTreeId, selectedNodeId, pushHistory, setSelectedNodeId]);

  const reparentNode = useCallback((
    nodeId: string, 
    newParentId: string | null, 
    targetIndex?: number,
    treeId?: string
  ) => {
    const targetTree = treeId || activeTreeId;
    const nextDoc = reparentNodeInTree(document, targetTree, nodeId, newParentId, targetIndex);
    pushHistory(nextDoc);
  }, [document, activeTreeId, pushHistory]);

  const reorderChildren = useCallback((
    parentId: string, 
    fromIndex: number, 
    toIndex: number,
    treeId?: string
  ) => {
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const nextDoc = reorderChildInTree(document, targetTree, parentId, fromIndex, toIndex);
    pushHistory(nextDoc);
  }, [document, selectedTreeId, activeTreeId, pushHistory]);

  const updateNode = useCallback((nodeId: string, updates: Partial<BTEditorNode>, treeId?: string) => {
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const nextDoc = updateNodeInTree(document, targetTree, nodeId, updates);
    pushHistory(nextDoc);
  }, [document, selectedTreeId, activeTreeId, pushHistory]);

  // Position change without full history push on every pixel drag (or push smoothly)
  const updateNodePosition = useCallback((nodeId: string, position: { x: number; y: number }, treeId?: string) => {
    const targetTree = treeId || activeTreeId;
    setDocument((prev) => {
      const tree = prev.trees[targetTree];
      if (!tree || !tree.nodes[nodeId]) return prev;
      const nextDoc = cloneDocument(prev);
      nextDoc.trees[targetTree].nodes[nodeId].position = position;
      return nextDoc;
    });
    setIsDirty(true);
  }, [activeTreeId]);

  const duplicateNode = useCallback((nodeId: string, treeId?: string): string => {
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const { nextDoc, clonedRootId } = duplicateSubtreeInTree(document, targetTree, nodeId);
    pushHistory(nextDoc);
    setSelectedNodeId(clonedRootId, targetTree);
    return clonedRootId;
  }, [document, selectedTreeId, activeTreeId, pushHistory, setSelectedNodeId]);

  const runAutoLayout = useCallback((treeId?: string, overrideOrientation?: 'vertical' | 'horizontal') => {
    const targetTree = treeId || activeTreeId;
    const targetOrient = overrideOrientation || orientation;
    const nextDoc = autoLayoutTree(document, targetTree, targetOrient);
    pushHistory(nextDoc);
  }, [document, activeTreeId, orientation, pushHistory]);

  // Safe Node Type Change
  const changeNodeType = useCallback((
    nodeId: string, 
    newType: string, 
    resolution: ChangeNodeTypeResolution = 'keep_all',
    treeId?: string
  ) => {
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const nextDoc = changeNodeTypeInTree(document, targetTree, nodeId, newType, resolution);
    pushHistory(nextDoc);
  }, [document, selectedTreeId, activeTreeId, pushHistory]);

  // SubTree expand / collapse
  const toggleSubTreeExpanded = useCallback((nodeId: string, treeId?: string) => {
    const targetTree = treeId || activeTreeId;
    const tree = document.trees[targetTree];
    if (!tree || !tree.nodes[nodeId]) return;
    const currentVal = tree.nodes[nodeId].isSubTreeExpanded !== false;
    const nextDoc = updateNodeInTree(document, targetTree, nodeId, { isSubTreeExpanded: !currentVal });
    pushHistory(nextDoc);
  }, [document, activeTreeId, pushHistory]);

  // Edge Disconnection (preserves the child node!)
  const disconnectEdge = useCallback((sourceParentId: string, targetChildId: string, treeId?: string) => {
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const nextDoc = disconnectChildInTree(document, targetTree, sourceParentId, targetChildId);
    pushHistory(nextDoc);
    setSelectedEdgeId(null);
    setSelectedEdge(null);
  }, [document, selectedTreeId, activeTreeId, pushHistory, setSelectedEdgeId, setSelectedEdge]);

  // Edge Reconnection
  const reconnectEdge = useCallback((
    oldParentId: string, 
    newParentId: string, 
    childId: string, 
    treeId?: string
  ): { success: boolean; error?: string } => {
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const { nextDoc, success, error } = reconnectEdgeInTree(document, targetTree, oldParentId, newParentId, childId);
    if (success) {
      pushHistory(nextDoc);
      setSelectedEdgeId(null);
      setSelectedEdge(null);
    }
    return { success, error };
  }, [document, selectedTreeId, activeTreeId, pushHistory, setSelectedEdgeId, setSelectedEdge]);

  // Clipboard operations
  const copyNode = useCallback((nodeId: string, treeId?: string) => {
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const tree = document.trees[targetTree];
    if (!tree || !tree.nodes[nodeId]) return;

    const root = tree.nodes[nodeId];
    const descendants: BTEditorNode[] = [];
    const collectDescendants = (id: string) => {
      const n = tree.nodes[id];
      if (!n) return;
      n.children.forEach((cid) => {
        const child = tree.nodes[cid];
        if (child) {
          descendants.push(JSON.parse(JSON.stringify(child)));
          collectDescendants(cid);
        }
      });
    };
    collectDescendants(nodeId);

    setClipboard({
      node: JSON.parse(JSON.stringify(root)),
      descendantNodes: descendants,
    });
  }, [document, selectedTreeId, activeTreeId]);

  const pasteNode = useCallback((targetParentId?: string | null, treeId?: string) => {
    if (!clipboard) return;
    const targetTree = treeId || selectedTreeId || activeTreeId;
    const tree = document.trees[targetTree];
    const parentId = targetParentId || selectedNodeId || tree?.rootNodeId || null;
    const { nextDoc, clonedRootId } = duplicateSubtreeInTree(
      {
        ...document,
        trees: {
          ...document.trees,
          [targetTree]: {
            ...tree!,
            nodes: {
              ...tree!.nodes,
              [clipboard.node.id]: clipboard.node,
              ...Object.fromEntries(clipboard.descendantNodes.map((n) => [n.id, n])),
            },
          },
        },
      },
      targetTree,
      clipboard.node.id
    );

    // Now reparent the clone under parentId
    const reparented = reparentNodeInTree(nextDoc, targetTree, clonedRootId, parentId);
    pushHistory(reparented);
    setSelectedNodeId(clonedRootId, targetTree);
  }, [clipboard, selectedNodeId, selectedTreeId, activeTreeId, document, pushHistory, setSelectedNodeId]);

  return {
    document,
    activeTreeId,
    activeTree,
    selectedTreeId,
    selectedNodeId,
    selectedNode,
    selectedEdgeId,
    selectedEdge,
    orientation,
    openTimestamp,
    isDirty,
    validationIssues,
    canUndo,
    canRedo,
    clipboard,

    setActiveTreeId,
    setSelectedNodeId,
    setSelectedTreeId,
    setSelectedEdgeId,
    setSelectedEdge,
    setOrientation,

    undo,
    redo,

    newDocument,
    openDocument,
    getSerializedXml,
    saveDocument,

    addNode,
    deleteNode,
    reparentNode,
    reorderChildren,
    updateNode,
    updateNodePosition,
    duplicateNode,
    runAutoLayout,
    changeNodeType,
    toggleSubTreeExpanded,

    disconnectEdge,
    reconnectEdge,

    copyNode,
    pasteNode,
  };
};
