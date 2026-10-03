import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Layers,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Plus,
  AlertCircle,
  FolderOpen
} from 'lucide-react';
import { BTEditorNode, BTEditorTree } from '../types';

export interface BTEditorSubTreeContainerData {
  node: BTEditorNode;
  targetTreeId: string;
  targetTree: BTEditorTree | null;
  isExpanded: boolean;
  onToggleExpand: (nodeId: string) => void;
  onSelectTreeTab?: (treeId: string) => void;
  onCreateTree?: (treeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  isSelected: boolean;
  orientation?: 'vertical' | 'horizontal';
}

export const BTEditorSubTreeContainerComponent: React.FC<{ data: BTEditorSubTreeContainerData }> = memo(({ data }) => {
  const {
    node,
    targetTreeId,
    targetTree,
    isExpanded,
    onToggleExpand,
    onSelectTreeTab,
    onCreateTree,
    onSelectNode,
    isSelected,
    orientation = 'vertical',
  } = data;

  const isHorizontal = orientation === 'horizontal';
  const nodeCount = targetTree ? Object.keys(targetTree.nodes).length : 0;
  const isMissingTree = !targetTree && targetTreeId;

  // Render Collapsed SubTree Card
  if (!isExpanded) {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          onSelectNode(node.id);
        }}
        className={`relative w-[230px] rounded-2xl p-3 border transition-all cursor-pointer font-sans bg-surface-primary text-text-primary shadow-sm hover:shadow-md select-none ${isSelected
            ? 'ring-2 ring-indigo-500 border-indigo-500 shadow-lg'
            : 'border-border-medium hover:border-indigo-400'
          }`}
      >
        {/* Target Handle */}
        <Handle
          type="target"
          position={isHorizontal ? Position.Left : Position.Top}
          id={isHorizontal ? 'target-left' : 'target-top'}
          className="!w-4 !h-4 !bg-indigo-500 !border-2 !border-white dark:!border-slate-900 shadow-sm"
        />
        <Handle
          type="source"
          position={isHorizontal ? Position.Right : Position.Bottom}
          id={isHorizontal ? 'source-right' : 'source-bottom'}
          className="!w-4 !h-4 !bg-indigo-500 !border-2 !border-white dark:!border-slate-900 shadow-sm"
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-1 mb-2">
          <span className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border shadow-2xs bg-indigo-50 text-indigo-900 border-indigo-200 dark:bg-indigo-950/80 dark:text-indigo-300 dark:border-indigo-800">
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>SubTree</span>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold border border-indigo-200 dark:border-indigo-800 cursor-pointer transition-colors shadow-2xs"
            title="Expand SubTree contents"
          >
            <span>Expand</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>

        {/* SubTree Name / Target */}
        <div className="min-w-0 mb-1.5 nodrag select-none">
          <span className="inline-block max-w-full align-bottom font-bold text-xs text-text-primary truncate select-text" title={node.name || targetTreeId}>
            {node.name || targetTreeId || 'Unnamed SubTree'}
          </span>
          <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 truncate flex items-center gap-1 mt-0.5 select-none">
            <FolderOpen className="w-3 h-3 shrink-0" />
            <span className="select-text">Tree: {targetTreeId}</span>
          </span>
        </div>

        {/* Tree status */}
        {isMissingTree ? (
          <div className="mt-2 pt-1.5 border-t border-border-subtle flex items-center gap-1 text-rose-500 text-[10px] select-none">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span className="select-text">Tree "{targetTreeId}" not defined</span>
          </div>
        ) : (
          <div className="mt-2 pt-1.5 border-t border-border-subtle flex items-center justify-between text-[10px] text-text-muted select-none">
            <span className="select-text">{nodeCount} inner nodes</span>
            {onSelectTreeTab && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTreeTab(targetTreeId);
                }}
                className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                <span>View tab</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Render Expanded SubTree Container
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelectNode(node.id);
      }}
      className={`relative w-full h-full rounded-2xl border-2 border-dashed transition-all select-none font-sans bg-indigo-50/20 dark:bg-indigo-950/20 backdrop-blur-2xs ${isSelected
          ? 'border-indigo-500 ring-2 ring-indigo-400/50 shadow-xl'
          : 'border-indigo-400/60 dark:border-indigo-600/60 shadow-md'
        }`}
    >
      {/* Target Handle from Outer Tree */}
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        id={isHorizontal ? 'target-left' : 'target-top'}
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-white dark:!border-slate-900 shadow-sm"
      />
      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        id={isHorizontal ? 'source-right' : 'source-bottom'}
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-white dark:!border-slate-900 shadow-sm"
      />

      {/* Container Header Bar */}
      <div className="h-10 px-3.5 bg-indigo-100/80 dark:bg-indigo-900/60 border-b border-indigo-200/80 dark:border-indigo-800/80 rounded-t-2xl flex items-center justify-between select-none">
        <div className="flex items-center gap-2 truncate">
          <div className="p-1 rounded-md bg-indigo-200 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-200">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-xs text-indigo-900 dark:text-indigo-100 font-mono truncate select-text">
            SubTree: {targetTreeId}
          </span>
          {targetTree && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-200/70 dark:bg-indigo-800/70 text-indigo-800 dark:text-indigo-200 shrink-0 select-none">
              {nodeCount} nodes
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onSelectTreeTab && targetTree && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectTreeTab(targetTreeId);
              }}
              className="px-2 py-1 rounded-lg bg-surface-primary hover:bg-surface-hover text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
              title="Open this tree in its own tab"
            >
              <span>Open Tab</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="px-2 py-1 rounded-lg bg-surface-primary hover:bg-surface-hover text-text-secondary hover:text-text-primary text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
            title="Collapse SubTree"
          >
            <span>Collapse</span>
            <ChevronUp className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Missing Tree Warning */}
      {isMissingTree && (
        <div className="p-4 flex flex-col items-center justify-center h-36 gap-2 text-center text-xs select-none">
          <div className="text-rose-500 flex items-center gap-1.5 font-bold">
            <AlertCircle className="w-4 h-4" />
            <span className="select-text">Referenced Tree "{targetTreeId}" does not exist</span>
          </div>
          {onCreateTree && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateTree(targetTreeId);
              }}
              className="mt-1 px-3 py-1.5 rounded-xl bg-accent-primary hover:bg-accent-hover text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create BehaviorTree "{targetTreeId}"</span>
            </button>
          )}
        </div>
      )}

      {/* Subtle Container Watermark / Label */}
      {!isMissingTree && (
        <div className="absolute bottom-2 right-3 pointer-events-none text-[10px] font-mono uppercase tracking-widest text-indigo-400/40 dark:text-indigo-500/30">
          CONTAINER: {targetTreeId}
        </div>
      )}
    </div>
  );
});

BTEditorSubTreeContainerComponent.displayName = 'BTEditorSubTreeContainerComponent';
