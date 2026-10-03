import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  GitBranch, 
  Repeat, 
  Zap, 
  Layers, 
  Info 
} from 'lucide-react';
import { BTEditorNode, BTEditorNodeCategory, BTNodeModelDefinition } from '../types';
import { BUILTIN_NODE_DEFINITIONS, inferNodeCategory } from '../nodeLibrary';
import { ChangeNodeTypeResolution } from '../documentModel';

interface BTEditorChangeTypeModalProps {
  isOpen: boolean;
  node: BTEditorNode | null;
  treeNodes: Record<string, BTEditorNode>;
  customNodeModels?: Record<string, BTNodeModelDefinition>;
  onClose: () => void;
  onApply: (nodeId: string, newType: string, resolution: ChangeNodeTypeResolution) => void;
}

export const BTEditorChangeTypeModal: React.FC<BTEditorChangeTypeModalProps> = ({
  isOpen,
  node,
  treeNodes,
  customNodeModels = {},
  onClose,
  onApply,
}) => {
  if (!isOpen || !node) return null;

  const [selectedType, setSelectedType] = useState<string>(node.type);
  const [resolution, setResolution] = useState<ChangeNodeTypeResolution>('keep_all');

  // Reset state when node opens
  useEffect(() => {
    if (node) {
      setSelectedType(node.type);
      setResolution('keep_all');
    }
  }, [node]);

  // Group all available node types by category
  const categorizedOptions = useMemo(() => {
    const groups: Record<BTEditorNodeCategory, string[]> = {
      Control: [],
      Decorator: [],
      Action: [],
      Condition: [],
      SubTree: [],
      Unknown: [],
    };

    // Standard builtins
    Object.keys(BUILTIN_NODE_DEFINITIONS).forEach((typeName) => {
      const def = BUILTIN_NODE_DEFINITIONS[typeName];
      if (groups[def.category]) {
        groups[def.category].push(typeName);
      }
    });

    // Custom models
    Object.keys(customNodeModels).forEach((typeName) => {
      const def = customNodeModels[typeName];
      if (groups[def.category] && !groups[def.category].includes(typeName)) {
        groups[def.category].push(typeName);
      }
    });

    return groups;
  }, [customNodeModels]);

  const currentCategory = node.category;
  const targetCategory = inferNodeCategory(selectedType);
  const childrenCount = node.children ? node.children.length : 0;
  const firstChild = childrenCount > 0 && treeNodes[node.children[0]] ? treeNodes[node.children[0]] : null;
  const firstChildName = firstChild ? (firstChild.name || firstChild.type) : 'Child 1';

  // Evaluate compatibility
  const compatibility = useMemo(() => {
    const isSameType = selectedType === node.type;
    let hasConflict = false;
    let conflictType: 'decorator_overflow' | 'leaf_with_children' | 'none' = 'none';

    if (targetCategory === 'Decorator') {
      if (childrenCount > 1) {
        hasConflict = true;
        conflictType = 'decorator_overflow';
      }
    } else if (targetCategory === 'Action' || targetCategory === 'Condition' || targetCategory === 'SubTree') {
      if (childrenCount > 0) {
        hasConflict = true;
        conflictType = 'leaf_with_children';
      }
    }

    return {
      isSameType,
      hasConflict,
      conflictType,
    };
  }, [selectedType, node.type, targetCategory, childrenCount]);

  const handleApply = () => {
    if (compatibility.isSameType) {
      onClose();
      return;
    }

    let chosenResolution: ChangeNodeTypeResolution = 'keep_all';
    if (compatibility.conflictType === 'decorator_overflow') {
      chosenResolution = 'keep_first_detach_rest';
    } else if (compatibility.conflictType === 'leaf_with_children') {
      chosenResolution = 'detach_all';
    }

    onApply(node.id, selectedType, chosenResolution);
    onClose();
  };

  const getCategoryIcon = (cat: BTEditorNodeCategory) => {
    switch (cat) {
      case 'Control': return <GitBranch className="w-4 h-4 text-blue-500" />;
      case 'Decorator': return <Repeat className="w-4 h-4 text-accent-primary" />;
      case 'Action': return <Zap className="w-4 h-4 text-amber-500" />;
      case 'Condition': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'SubTree': return <Layers className="w-4 h-4 text-indigo-500" />;
      default: return <Info className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-text">
      <div className="w-full max-w-lg bg-surface-primary rounded-2xl shadow-2xl border border-border-subtle overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between bg-surface-secondary">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent-primary/10 text-accent-primary">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-text-primary">Change Node Type</h3>
              <p className="text-[11px] text-text-muted">Safely convert node without losing ID or attributes</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs font-sans">
          {/* Current Node Overview */}
          <div className="p-3 rounded-xl bg-surface-secondary border border-border-subtle flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-surface-primary border border-border-subtle">
                {getCategoryIcon(currentCategory)}
              </div>
              <div>
                <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Current Node</div>
                <div className="font-bold text-sm text-text-primary flex items-center gap-2">
                  <span>{node.name || node.type}</span>
                  <span className="text-xs font-mono font-normal text-text-muted">({node.type})</span>
                </div>
              </div>
            </div>
            <div className="text-right text-[11px] text-text-muted">
              <div><b className="text-text-primary">{childrenCount}</b> children</div>
            </div>
          </div>

          {/* New Type Selector */}
          <div>
            <label className="block text-xs font-bold text-text-secondary mb-1.5">
              Select New Node Type:
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full bg-surface-secondary border border-border-medium rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-text-primary outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 cursor-pointer"
            >
              <optgroup label="── Control Nodes (Sequence, Fallback, etc.) ──">
                {categorizedOptions.Control.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
              <optgroup label="── Decorator Nodes (Inverter, Retry, Timeout, etc.) ──">
                {categorizedOptions.Decorator.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
              <optgroup label="── Action Nodes ──">
                {categorizedOptions.Action.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
              <optgroup label="── Condition Nodes ──">
                {categorizedOptions.Condition.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
              <optgroup label="── SubTree Nodes ──">
                {categorizedOptions.SubTree.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Transformation preview banner */}
          <div className="flex items-center justify-center gap-3 p-3 rounded-xl bg-surface-secondary border border-border-subtle font-mono text-xs">
            <span className="font-bold text-text-secondary">{node.type}</span>
            <ArrowRight className="w-4 h-4 text-accent-primary shrink-0" />
            <span className="font-bold text-accent-primary">{selectedType}</span>
            <span className="text-[10px] px-2 py-0.5 rounded border border-border-subtle bg-surface-primary text-text-muted">
              {targetCategory}
            </span>
          </div>

          {/* Compatibility Analysis Box */}
          <div className="p-3.5 rounded-xl border border-border-subtle bg-surface-secondary space-y-2">
            <div className="font-bold text-xs text-text-primary flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent-primary" /> Compatibility & Preservation
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Node label and configuration preserved</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Existing XML attributes preserved</span>
              </div>
              <div className="flex items-center gap-2 text-text-muted">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>Port definitions and bindings will adapt to {selectedType}</span>
              </div>
            </div>
          </div>

          {/* Structural Conflict Warning & Resolution */}
          {compatibility.hasConflict && (
            <div className="p-3.5 rounded-xl border border-amber-400/40 bg-amber-50/70 dark:bg-amber-950/40 space-y-2.5 text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2 font-bold text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Structural Conflict Detected</span>
              </div>

              {compatibility.conflictType === 'decorator_overflow' && (
                <div className="space-y-2 text-[11px]">
                  <p>
                    A <b>Decorator</b> can only have <b>1 child</b>, but this node currently has <b>{childrenCount} children</b>.
                  </p>
                  <p className="font-semibold text-text-primary">
                    Safe Conversion Action:
                  </p>
                  <div className="p-2 rounded-lg bg-surface-primary border border-border-subtle text-text-primary">
                    ✓ Keep first child <b>"{firstChildName}"</b> and detach the remaining <b>{childrenCount - 1} children</b> as independent nodes. (No nodes will be deleted!)
                  </div>
                </div>
              )}

              {compatibility.conflictType === 'leaf_with_children' && (
                <div className="space-y-2 text-[11px]">
                  <p>
                    <b>{targetCategory}</b> nodes are leaf nodes and <b>cannot have children</b>, but this node currently has <b>{childrenCount} child(ren)</b>.
                  </p>
                  <p className="font-semibold text-text-primary">
                    Safe Conversion Action:
                  </p>
                  <div className="p-2 rounded-lg bg-surface-primary border border-border-subtle text-text-primary">
                    ✓ Detach all <b>{childrenCount} children</b> as independent nodes in the tree. (No nodes will be deleted!)
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border-subtle bg-surface-secondary flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-text-secondary hover:text-text-primary hover:bg-surface-hover font-semibold transition-colors cursor-pointer text-xs"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={compatibility.isSameType}
            className="px-4 py-2 rounded-xl bg-accent-primary hover:bg-accent-hover disabled:opacity-40 text-white font-semibold shadow-sm transition-all cursor-pointer text-xs"
          >
            {compatibility.isSameType ? 'Select a different type' : 'Apply Type Change'}
          </button>
        </div>
      </div>
    </div>
  );
};
