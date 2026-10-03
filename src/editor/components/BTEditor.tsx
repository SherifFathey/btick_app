import React, { useState, useCallback, useRef } from 'react';
import { useBTEditor, UseBTEditorReturn } from '../useBTEditor';
import { BTEditorToolbar } from './BTEditorToolbar';
import { BTEditorPalette } from './BTEditorPalette';
import { BTEditorCanvas } from './BTEditorCanvas';
import { BTEditorInspector } from './BTEditorInspector';
import { BTEditorValidationModal } from './BTEditorValidationModal';
import { BTEditorRawXmlModal } from './BTEditorRawXmlModal';
import { BTEditorNodeCategory, BehaviorTreeDocument } from '../types';
import { serializeDocumentToXml } from '../xmlSerializer';
import { AppMode } from '../../shared/types';

export interface BTEditorProps {
  initialXml?: string;
  onCloseEditor?: () => void;
  appMode?: AppMode;
  onModeChange?: (mode: AppMode) => void;
  editorState?: UseBTEditorReturn;
  embedded?: boolean;
  isRawXmlModalOpen?: boolean;
  onCloseRawXmlModal?: () => void;
  isValidationModalOpen?: boolean;
  onCloseValidationModal?: () => void;
  /** When provided, the canvas will write a function into this ref that returns the
   *  current viewport-center in flow coordinates. Call it from outside the canvas
   *  (e.g. App.tsx palette handler) to get the correct placement position. */
  getPlacementPositionRef?: React.MutableRefObject<(() => { x: number; y: number }) | null>;
}

export const BTEditor: React.FC<BTEditorProps> = (props) => {
  if (props.editorState) {
    return <BTEditorInner {...props} editor={props.editorState} />;
  }
  return <BTEditorStandalone {...props} />;
};

const BTEditorStandalone: React.FC<BTEditorProps> = (props) => {
  const editorState = useBTEditor(props.initialXml);
  return <BTEditorInner {...props} editor={editorState} />;
};

interface BTEditorInnerProps extends BTEditorProps {
  editor: UseBTEditorReturn;
}

const BTEditorInner: React.FC<BTEditorInnerProps> = ({
  appMode = 'editor',
  onModeChange,
  editor,
  embedded = false,
  isRawXmlModalOpen: externalRawXmlModalOpen,
  onCloseRawXmlModal: externalCloseRawXmlModal,
  isValidationModalOpen: externalValidationModalOpen,
  onCloseValidationModal: externalCloseValidationModal,
  getPlacementPositionRef: externalGetPlacementPositionRef,
}) => {
  const {
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

    setActiveTreeId,
    setSelectedNodeId,
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
  } = editor;

  const [internalValidationModalOpen, setInternalValidationModalOpen] = useState(false);
  const [internalRawXmlModalOpen, setInternalRawXmlModalOpen] = useState(false);

  const showValidationModal = externalValidationModalOpen !== undefined ? externalValidationModalOpen : internalValidationModalOpen;
  const handleCloseValidationModal = externalCloseValidationModal || (() => setInternalValidationModalOpen(false));

  const showRawXmlModal = externalRawXmlModalOpen !== undefined ? externalRawXmlModalOpen : internalRawXmlModalOpen;
  const handleCloseRawXmlModal = externalCloseRawXmlModal || (() => setInternalRawXmlModalOpen(false));

  const [layoutEpoch, setLayoutEpoch] = useState<number>(0);

  const handleAutoLayout = useCallback(() => {
    runAutoLayout(activeTreeId);
    setLayoutEpoch((prev) => prev + 1);
  }, [runAutoLayout, activeTreeId]);

  // Plain ref that stores the canvas's viewport-center callback.
  const _placementCallbackHolder = useRef<(() => { x: number; y: number }) | null>(null);

  // Stable forwarder object: the canvas writes into this via `.current = fn`.
  // The setter also propagates to the optional external ref from App.tsx so that
  // the sidebar palette handler can call the same callback.
  // We create this object once with useRef so it's stable across renders.
  const getPlacementPositionRef = useRef<React.MutableRefObject<(() => { x: number; y: number }) | null>>({
    get current() { return _placementCallbackHolder.current; },
    set current(fn) {
      _placementCallbackHolder.current = fn;
      if (externalGetPlacementPositionRef) {
        externalGetPlacementPositionRef.current = fn;
      }
    },
  } as React.MutableRefObject<(() => { x: number; y: number }) | null>).current;

  const [centerTarget, setCenterTarget] = useState<{ nodeId: string; treeId?: string; timestamp: number } | null>(null);

  // Inspect and center node on canvas from validation modal
  const handleInspectValidationNode = useCallback((nodeId: string, treeId?: string) => {
    const targetTree = treeId || activeTreeId;
    if (targetTree && targetTree !== activeTreeId && document.trees[targetTree]) {
      setActiveTreeId(targetTree);
    }
    setSelectedNodeId(nodeId, targetTree);
    setCenterTarget({ nodeId, treeId: targetTree, timestamp: Date.now() });
  }, [activeTreeId, document.trees, setSelectedNodeId, setActiveTreeId]);

  // Drop New Node on Canvas
  const handleDropNewNode = useCallback((nodeType: string, position: { x: number; y: number }) => {
    const isSubtreeRef = nodeType.startsWith('SubTree:');
    const actualType = isSubtreeRef ? 'SubTree' : nodeType;
    const subtreeId = isSubtreeRef ? nodeType.replace('SubTree:', '') : undefined;

    // Drop places an independent node at the exact drop position without moving other nodes
    const newNodeId = addNode(null, actualType, undefined, undefined, undefined, position);

    if (subtreeId) {
      updateNode(newNodeId, {
        attributes: { ID: subtreeId },
        name: subtreeId,
        isSubTreeExpanded: true,
      });
    }
  }, [addNode, updateNode]);

  // Handle Palette click "+ Add Node"
  const handlePaletteAdd = useCallback((nodeType: string, parentId?: string | null, targetTreeId?: string) => {
    const isSubtreeRef = nodeType.startsWith('SubTree:');
    const actualType = isSubtreeRef ? 'SubTree' : nodeType;
    const subtreeId = isSubtreeRef ? nodeType.replace('SubTree:', '') : undefined;

    const currTreeId = targetTreeId || selectedTreeId || activeTreeId;
    const targetParentId = parentId !== undefined ? parentId : null;

    // Calculate available space in visible viewport only when adding an independent node without parent
    const visiblePos = (!targetParentId && getPlacementPositionRef.current) ? getPlacementPositionRef.current() : undefined;
    const newNodeId = addNode(targetParentId, actualType, undefined, undefined, currTreeId, visiblePos);

    if (subtreeId) {
      updateNode(newNodeId, {
        attributes: { ID: subtreeId },
        name: subtreeId,
        isSubTreeExpanded: true,
      }, currTreeId);
    }
  }, [selectedTreeId, activeTreeId, addNode, updateNode]);

  // Register custom node definition
  const handleRegisterCustomNode = useCallback((type: string, category: BTEditorNodeCategory) => {
    document.nodeModels[type] = {
      type,
      category,
    };
  }, [document]);

  // Create new BehaviorTree if user referenced an uncreated subtree
  const handleCreateTree = useCallback((newTreeId: string) => {
    const rootNodeId = `${newTreeId}_root`;
    const nextDoc = JSON.parse(JSON.stringify(document)) as BehaviorTreeDocument;
    nextDoc.trees[newTreeId] = {
      id: newTreeId,
      rootNodeId,
      customAttributes: {},
      nodes: {
        [rootNodeId]: {
          id: rootNodeId,
          type: 'Sequence',
          name: '',
          category: 'Control',
          attributes: {},
          inputPorts: {},
          outputPorts: {},
          children: [],
          parentId: null,
          position: { x: 250, y: 50 },
        },
      },
    };
    if (!nextDoc.treeOrder.includes(newTreeId)) {
      nextDoc.treeOrder.push(newTreeId);
    }
    openDocument(serializeDocumentToXml(nextDoc), document.fileName);
  }, [document, openDocument]);

  const treeOrderList = document.treeOrder && document.treeOrder.length > 0 
    ? document.treeOrder 
    : Object.keys(document.trees);

  const availableSubtrees = treeOrderList.filter((id) => id !== activeTreeId);

  // Inspector is shown only if a node is selected, NOT for edge selection
  const isInspectorOpen = Boolean(selectedNodeId);
  const inspectorTreeNodes = (selectedTreeId && document.trees[selectedTreeId]?.nodes) || activeTree?.nodes || {};

  return (
    <div className="w-full h-full flex flex-col bg-app text-text-primary overflow-hidden font-sans select-text">
      {/* Editor Top Toolbar (only rendered when standalone, i.e. not embedded in shared shell) */}
      {!embedded && (
        <BTEditorToolbar
          treesList={treeOrderList}
          activeTreeId={activeTreeId}
          onSelectTree={(tId) => {
            setActiveTreeId(tId);
          }}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onNew={newDocument}
          onOpen={(content, fName) => openDocument(content, fName)}
          onSave={() => saveDocument()}
          validationIssues={validationIssues}
          onOpenValidationModal={() => setInternalValidationModalOpen(true)}
          onOpenRawXmlModal={() => setInternalRawXmlModalOpen(true)}
          isDirty={isDirty}
        />
      )}

      {/* Main Center Area: Palette (when standalone) + Canvas + Inspector */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Node Library / Palette (only when not embedded into shared sidebar) */}
        {!embedded && (
          <BTEditorPalette
            appMode={appMode}
            onModeChange={onModeChange}
            customNodeModels={document.nodeModels}
            availableSubtrees={availableSubtrees}
            selectedNodeId={selectedNodeId}
            onAddNode={(type, parentId) => handlePaletteAdd(type, parentId)}
            onRegisterCustomNode={handleRegisterCustomNode}
          />
        )}

        {/* Center: Interactive React Flow Canvas */}
        <div className="flex-1 h-full relative overflow-hidden bg-canvas">
          <BTEditorCanvas
            key={activeTreeId}
            document={document}
            activeTreeId={activeTreeId}
            selectedTreeId={selectedTreeId}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            validationIssues={validationIssues}
            orientation={orientation}
            openTimestamp={openTimestamp}
            onOrientationChange={(newOrientation) => {
              setOrientation(newOrientation);
              runAutoLayout(activeTreeId, newOrientation);
              setLayoutEpoch((e) => e + 1);
            }}
            onSelectNode={(nId, tId) => setSelectedNodeId(nId, tId)}
            onSelectEdge={(edge) => setSelectedEdge(edge)}
            onAddChild={(pId, type, tId) => handlePaletteAdd(type || 'Sequence', pId, tId)}
            onDuplicate={(nId, tId) => duplicateNode(nId, tId)}
            onDelete={(nId, tId) => deleteNode(nId, tId)}
            onReparent={(childId, parentId, tId) => reparentNode(childId, parentId, undefined, tId)}
            onUpdatePosition={(nId, pos, tId) => updateNodePosition(nId, pos, tId)}
            onToggleCollapse={() => {
              // Collapse/expand is purely visual canvas state and must not modify the underlying document structure or push to history
            }}
            onToggleSubTreeExpanded={(nId, tId) => toggleSubTreeExpanded(nId, tId)}
            onSelectTreeTab={(tId) => setActiveTreeId(tId)}
            onCreateTree={handleCreateTree}
            onDisconnectEdge={(sId, tId, treeId) => disconnectEdge(sId, tId, treeId)}
            onReconnectEdge={(oldP, newP, cId, treeId) => reconnectEdge(oldP, newP, cId, treeId)}
            onDropNewNode={handleDropNewNode}
            onUndo={undo}
            onRedo={redo}
            onCopy={(nId, tId) => copyNode(nId, tId)}
            onPaste={(pId, tId) => pasteNode(pId, tId)}
            onAutoLayout={handleAutoLayout}
            layoutEpoch={layoutEpoch}
            getPlacementPositionRef={getPlacementPositionRef}
            centerTarget={centerTarget}
          />
        </div>

        {/* Right: Node / Connection Inspector Drawer */}
        {isInspectorOpen && (
          <BTEditorInspector
            node={selectedNode}
            isRoot={Boolean(selectedTreeId && selectedNodeId === document.trees[selectedTreeId]?.rootNodeId)}
            treeNodes={inspectorTreeNodes}
            customNodeModels={document.nodeModels}
            selectedEdge={selectedEdge}
            onClose={() => {
              setSelectedNodeId(null);
              setSelectedEdge(null);
            }}
            onUpdateNode={(nId, updates) => updateNode(nId, updates, selectedTreeId)}
            onSelectNode={(nId) => setSelectedNodeId(nId, selectedTreeId)}
            onReorderChild={(pId, from, to) => reorderChildren(pId, from, to, selectedTreeId)}
            onDuplicate={(nId) => duplicateNode(nId, selectedTreeId)}
            onDelete={(nId) => deleteNode(nId, selectedTreeId)}
            onChangeNodeType={(nId, newType, resolution) => changeNodeType(nId, newType, resolution, selectedTreeId)}
            onDisconnectEdge={(sId, tId) => disconnectEdge(sId, tId, selectedTreeId)}
            onReconnectEdge={(oldP, newP, cId) => reconnectEdge(oldP, newP, cId, selectedTreeId)}
          />
        )}
      </div>

      {/* Validation Modal */}
      <BTEditorValidationModal
        isOpen={showValidationModal}
        issues={validationIssues}
        onClose={handleCloseValidationModal}
        onSelectNode={(nodeId, treeId) => {
          if (treeId && treeId !== activeTreeId && document.trees[treeId]) {
            setActiveTreeId(treeId);
          }
          setSelectedNodeId(nodeId, treeId);
        }}
        onInspectNode={handleInspectValidationNode}
        documentTrees={document.trees}
      />

      {/* Raw XML Preview Modal */}
      <BTEditorRawXmlModal
        isOpen={showRawXmlModal}
        xmlContent={getSerializedXml()}
        fileName={document.fileName}
        onClose={handleCloseRawXmlModal}
      />
    </div>
  );
};
