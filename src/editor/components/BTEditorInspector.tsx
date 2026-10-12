import React, { useState } from "react";
import {
  X,
  Tag,
  Sliders,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Copy,
  Check,
  ArrowRight,
  GitBranch,
  ExternalLink,
} from "lucide-react";
import {
  BTEditorNode,
  BTNodeModelDefinition,
  BTEditorConnection,
} from "../types";
import { ChangeNodeTypeResolution } from "../documentModel";
import { BTEditorChangeTypeModal } from "./BTEditorChangeTypeModal";

interface BTEditorInspectorProps {
  node: BTEditorNode | null;
  isRoot?: boolean;
  treeNodes: Record<string, BTEditorNode>;
  customNodeModels?: Record<string, BTNodeModelDefinition>;
  selectedEdge?: BTEditorConnection | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, updates: Partial<BTEditorNode>) => void;
  onSelectNode: (nodeId: string) => void;
  onReorderChild: (
    parentId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onDuplicate: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onChangeNodeType?: (
    nodeId: string,
    newType: string,
    resolution: ChangeNodeTypeResolution,
  ) => void;
  onDisconnectEdge?: (sourceParentId: string, targetChildId: string) => void;
  onReconnectEdge?: (
    oldParentId: string,
    newParentId: string,
    childId: string,
  ) => { success: boolean; error?: string };
}

export const BTEditorInspector: React.FC<BTEditorInspectorProps> = ({
  node,
  isRoot = false,
  treeNodes,
  customNodeModels = {},
  selectedEdge,
  onClose,
  onUpdateNode,
  onSelectNode,
  onReorderChild,
  onDuplicate,
  onDelete,
  onChangeNodeType,
  onDisconnectEdge,
  onReconnectEdge,
}) => {
  // If neither node nor edge is selected, return null
  if (!node && !selectedEdge) return null;

  // Local state for Change Node Type modal
  const [isChangeTypeModalOpen, setIsChangeTypeModalOpen] = useState(false);
  const [copiedType, setCopiedType] = useState(false);

  // Local state for adding new attribute
  const [newAttrKey, setNewAttrKey] = useState("");
  const [newAttrVal, setNewAttrVal] = useState("");

  // Local state for adding new input port
  const [newInPortName, setNewInPortName] = useState("");
  const [newInPortVal, setNewInPortVal] = useState("");

  // Local state for adding new output port
  const [newOutPortName, setNewOutPortName] = useState("");
  const [newOutPortVal, setNewOutPortVal] = useState("");

  // ================= CONNECTION INSPECTOR MODE =================
  if (selectedEdge && !node) {
    const parentNode = treeNodes[selectedEdge.source];
    const childNode = treeNodes[selectedEdge.target];

    return (
      <aside className="w-80 h-full bg-surface-primary border-l border-border-subtle flex flex-col z-20 shadow-xl select-text font-sans text-xs overflow-hidden shrink-0">
        {/* Header */}
        <div className="h-[44px] px-3.5 border-b border-border-subtle bg-surface-primary flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-accent-primary" />
            <h2 className="font-bold text-xs text-text-primary uppercase tracking-wide font-mono">
              Connection Inspector
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer shadow-2xs active:scale-95"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Connection Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 no-scrollbar">
          {/* Connection Visual Overview */}
          <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-3 shadow-xs">
            <div className="text-[10px] font-mono uppercase text-accent-primary font-bold pb-2 border-b border-border-subtle/80 flex items-center justify-between">
              <span>Parent → Child Link</span>
            </div>

            {/* Parent Card */}
            <div className="p-3 rounded-xl bg-surface-primary border border-border-medium flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[10px] font-semibold text-text-muted block font-mono">
                  Parent Node
                </span>
                <span className="font-bold text-xs text-text-primary font-mono">
                  {parentNode
                    ? parentNode.name || parentNode.type
                    : selectedEdge.source}
                </span>
                {parentNode && (
                  <div className="text-[10px] font-mono text-text-muted">
                    ({parentNode.type})
                  </div>
                )}
              </div>
              <button
                onClick={() => onSelectNode(selectedEdge.source)}
                className="px-2.5 py-1 rounded-lg bg-surface-secondary hover:bg-surface-hover text-accent-primary hover:text-accent-primary font-semibold text-[11px] flex items-center gap-1 cursor-pointer border border-border-subtle hover:border-border-medium transition-all shadow-2xs active:scale-95"
                title="Select parent node"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Select
              </button>
            </div>

            <div className="flex justify-center text-text-muted">
              <ArrowDown className="w-4 h-4 text-accent-primary animate-bounce" />
            </div>

            {/* Child Card */}
            <div className="p-3 rounded-xl bg-surface-primary border border-border-medium flex items-center justify-between shadow-2xs">
              <div>
                <span className="text-[10px] font-semibold text-text-muted block font-mono">
                  Child Node
                </span>
                <span className="font-bold text-xs text-text-primary font-mono">
                  {childNode
                    ? childNode.name || childNode.type
                    : selectedEdge.target}
                </span>
                {childNode && (
                  <div className="text-[10px] font-mono text-text-muted">
                    ({childNode.type})
                  </div>
                )}
              </div>
              <button
                onClick={() => onSelectNode(selectedEdge.target)}
                className="px-2.5 py-1 rounded-lg bg-surface-secondary hover:bg-surface-hover text-accent-primary hover:text-accent-primary font-semibold text-[11px] flex items-center gap-1 cursor-pointer border border-border-subtle hover:border-border-medium transition-all shadow-2xs active:scale-95"
                title="Select child node"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Select
              </button>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  if (!node) return null;

  // ================= NODE INSPECTOR MODE =================
  const handleNameChange = (val: string) => {
    onUpdateNode(node.id, { name: val.trim() || undefined });
  };

  const handleCopyType = () => {
    navigator.clipboard?.writeText(node.type);
    setCopiedType(true);
    setTimeout(() => setCopiedType(false), 1500);
  };

  // Attribute edits
  const handleEditAttribute = (key: string, value: string) => {
    const nextAttrs = { ...(node.attributes || {}), [key]: value };
    onUpdateNode(node.id, { attributes: nextAttrs });
  };

  const handleDeleteAttribute = (key: string) => {
    const nextAttrs = { ...(node.attributes || {}) };
    delete nextAttrs[key];
    onUpdateNode(node.id, { attributes: nextAttrs });
  };

  const handleAddAttribute = () => {
    const k = newAttrKey.trim();
    if (!k) return;
    const nextAttrs = { ...(node.attributes || {}), [k]: newAttrVal };
    onUpdateNode(node.id, { attributes: nextAttrs });
    setNewAttrKey("");
    setNewAttrVal("");
  };

  // Input Port edits
  const handleEditInputPort = (key: string, value: string) => {
    const nextPorts = { ...(node.inputPorts || {}), [key]: value };
    onUpdateNode(node.id, { inputPorts: nextPorts });
  };

  const handleDeleteInputPort = (key: string) => {
    const nextPorts = { ...(node.inputPorts || {}) };
    delete nextPorts[key];
    onUpdateNode(node.id, { inputPorts: nextPorts });
  };

  const handleAddInputPort = () => {
    const k = newInPortName.trim();
    if (!k) return;
    const nextPorts = { ...(node.inputPorts || {}), [k]: newInPortVal };
    onUpdateNode(node.id, { inputPorts: nextPorts });
    setNewInPortName("");
    setNewInPortVal("");
  };

  // Output Port edits
  const handleEditOutputPort = (key: string, value: string) => {
    const nextPorts = { ...(node.outputPorts || {}), [key]: value };
    onUpdateNode(node.id, { outputPorts: nextPorts });
  };

  const handleDeleteOutputPort = (key: string) => {
    const nextPorts = { ...(node.outputPorts || {}) };
    delete nextPorts[key];
    onUpdateNode(node.id, { outputPorts: nextPorts });
  };

  const handleAddOutputPort = () => {
    const k = newOutPortName.trim();
    if (!k) return;
    const nextPorts = { ...(node.outputPorts || {}), [k]: newOutPortVal };
    onUpdateNode(node.id, { outputPorts: nextPorts });
    setNewOutPortName("");
    setNewOutPortVal("");
  };

  const isLeaf =
    node.category === "Action" ||
    node.category === "Condition" ||
    node.category === "SubTree";
  const parent = node.parentId ? treeNodes[node.parentId] : null;

  return (
    <aside className="w-80 h-full bg-surface-primary border-l border-border-subtle flex flex-col z-20 shadow-xl select-text font-sans text-xs overflow-hidden shrink-0">
      {/* Header */}
      <div className="h-[44px] px-3.5 border-b border-border-subtle bg-surface-primary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-accent-primary" />
          <h2 className="font-bold text-xs text-text-primary uppercase tracking-wide font-mono">
            Node Inspector
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer shadow-2xs active:scale-95"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 no-scrollbar">
        {/* Basic Information Card */}
        <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-3 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle/80">
            <span className="text-xs font-bold text-text-primary uppercase tracking-wide font-mono flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-accent-primary" /> Node
              Configuration
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono uppercase text-accent-primary font-bold px-2 py-0.5 rounded-md bg-surface-primary border border-border-medium shadow-2xs">
                {node.category}
              </span>
            </div>
          </div>

          {/* Node Type: READ-ONLY with dedicated "Change Node Type" button */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-semibold text-text-muted font-mono">
                Node Type
              </label>
              <button
                onClick={handleCopyType}
                className="text-[10px] text-text-muted hover:text-text-primary flex items-center gap-1 cursor-pointer transition-colors"
                title="Copy node type"
              >
                {copiedType ? (
                  <>
                    <Check className="w-2.5 h-2.5 text-emerald-500" />
                    <span className="text-emerald-500 font-bold">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-2.5 h-2.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center justify-between bg-surface-primary border border-border-medium rounded-xl px-2.5 py-2 shadow-2xs">
              <span className="text-xs font-mono font-bold text-text-primary truncate mr-2">
                {isRoot ? "Root" : node.type}
              </span>
              <button
                onClick={() => setIsChangeTypeModalOpen(true)}
                className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-accent-primary hover:bg-accent-hover text-white transition-all cursor-pointer border border-accent-border shrink-0 shadow-xs active:scale-95"
              >
                Change Node Type
              </button>
            </div>
          </div>

          {/* Node Name Attribute */}
          <div>
            <label className="text-[10px] font-semibold text-text-muted block mb-1 font-mono">
              Node Name / Label (Optional)
            </label>
            <input
              type="text"
              value={node.name || ""}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full bg-surface-primary border border-border-medium rounded-xl px-2.5 py-1.5 text-xs font-sans text-text-primary outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 shadow-2xs"
              placeholder="e.g. root_sequence, navigate_to_charging"
            />
          </div>
        </div>

        {/* Hierarchy & Sibling Reordering */}
        <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-3 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle/80">
            <span className="text-xs font-bold text-text-primary uppercase tracking-wide font-mono flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-accent-primary" /> Hierarchy &
              Sibling Order
            </span>
            <span className="text-[10px] font-mono text-text-muted px-2 py-0.5 rounded-md bg-surface-primary border border-border-subtle">
              {node.children.length} Child
              {node.children.length !== 1 ? "ren" : ""}
            </span>
          </div>

          {/* Parent Node info */}
          <div className="text-[11px] flex items-center justify-between bg-surface-primary p-2.5 rounded-xl border border-border-medium shadow-2xs">
            <span className="text-text-muted font-mono font-semibold">
              Parent:
            </span>
            {parent ? (
              <button
                onClick={() => onSelectNode(parent.id)}
                className="font-bold text-accent-primary hover:underline truncate max-w-[150px] cursor-pointer"
                title={`Select parent: ${parent.name || parent.type}`}
              >
                {parent.name || parent.type}
              </button>
            ) : (
              <span className="text-text-muted italic">None (Tree Root)</span>
            )}
          </div>

          {/* Children List with Reordering buttons */}
          {node.children && node.children.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-semibold text-text-muted block font-mono">
                Children Execution Order:
              </span>
              <div className="space-y-1.5 max-h-36 overflow-y-auto no-scrollbar">
                {node.children.map((childId, idx) => {
                  const child = treeNodes[childId];
                  let childLabel = childId;
                  if (child) {
                    if (child.name && child.name !== child.type) {
                      childLabel = `${child.type} — ${child.name}`;
                    } else if (
                      child.category &&
                      child.category !== child.type
                    ) {
                      childLabel = `${child.category} — ${child.type}`;
                    } else {
                      childLabel = child.name || child.type || childId;
                    }
                  }
                  return (
                    <div
                      key={childId}
                      className="flex items-center justify-between bg-surface-primary px-2.5 py-1.5 rounded-xl border border-border-medium text-xs shadow-2xs"
                    >
                      <span className="text-[10px] font-mono text-text-muted mr-1.5 font-bold">
                        {idx + 1}.
                      </span>
                      <span
                        onClick={() => onSelectNode(childId)}
                        className="truncate flex-1 font-semibold text-text-primary hover:text-accent-primary cursor-pointer"
                        title={childLabel}
                      >
                        {childLabel}
                      </span>
                      <div className="flex items-center gap-1 ml-1.5 shrink-0">
                        <button
                          onClick={() => onReorderChild(node.id, idx, idx - 1)}
                          disabled={idx === 0}
                          title="Move child up (executes earlier)"
                          className="p-1 rounded-md bg-surface-secondary hover:bg-surface-hover disabled:opacity-25 text-text-primary border border-border-subtle hover:border-border-medium cursor-pointer transition-all active:scale-95 shadow-2xs"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => onReorderChild(node.id, idx, idx + 1)}
                          disabled={idx === node.children.length - 1}
                          title="Move child down (executes later)"
                          className="p-1 rounded-md bg-surface-secondary hover:bg-surface-hover disabled:opacity-25 text-text-primary border border-border-subtle hover:border-border-medium cursor-pointer transition-all active:scale-95 shadow-2xs"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Input Ports Section */}
        <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-3 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle/80">
            <span className="text-xs font-bold text-text-primary uppercase tracking-wide font-mono flex items-center gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-sky-500" /> Input Ports
            </span>
            <span className="text-[10px] font-mono text-text-muted px-2 py-0.5 rounded-md bg-surface-primary border border-border-subtle">
              {Object.keys(node.inputPorts || {}).length}
            </span>
          </div>

          <div className="space-y-2">
            {Object.entries(node.inputPorts || {}).map(
              ([portName, portVal]) => {
                const isBB = portVal.startsWith("{") && portVal.endsWith("}");
                return (
                  <div
                    key={portName}
                    className="p-2.5 rounded-xl bg-surface-primary border border-border-medium space-y-1.5 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-bold text-accent-primary">
                        {portName}
                      </span>
                      <div className="flex items-center gap-1">
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded border ${
                            isBB
                              ? "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200"
                              : "bg-surface-secondary text-text-muted border-border-subtle"
                          }`}
                        >
                          {isBB ? "Blackboard" : "Literal"}
                        </span>
                        <button
                          onClick={() => handleDeleteInputPort(portName)}
                          className="p-1 rounded-md hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                          title={`Remove port ${portName}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={portVal}
                      onChange={(e) =>
                        handleEditInputPort(portName, e.target.value)
                      }
                      placeholder="e.g. 5.0 or {target_x}"
                      className="w-full bg-surface-secondary border border-border-medium rounded-lg px-2.5 py-1 text-xs font-mono text-text-primary outline-none focus:border-accent-primary"
                    />
                  </div>
                );
              },
            )}

            {/* Add Input Port Form */}
            <div className="p-2.5 rounded-xl bg-surface-primary/80 border border-border-medium space-y-2 shadow-2xs">
              <span className="text-[10px] font-mono text-text-muted uppercase font-bold block">
                Add Input Port
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Port name"
                  value={newInPortName}
                  onChange={(e) => setNewInPortName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddInputPort()}
                  className="w-1/2 bg-surface-primary border border-border-medium rounded-lg px-2 py-1 text-[11px] font-mono text-text-primary outline-none focus:border-accent-primary"
                />
                <input
                  type="text"
                  placeholder="Value / {bb}"
                  value={newInPortVal}
                  onChange={(e) => setNewInPortVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddInputPort()}
                  className="w-1/2 bg-surface-primary border border-border-medium rounded-lg px-2 py-1 text-[11px] font-mono text-text-primary outline-none focus:border-accent-primary"
                />
                <button
                  onClick={handleAddInputPort}
                  className="p-1.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg cursor-pointer shadow-xs shrink-0 active:scale-95"
                  title="Add Input Port"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Output Ports Section */}
        <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-3 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle/80">
            <span className="text-xs font-bold text-text-primary uppercase tracking-wide font-mono flex items-center gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-emerald-500" /> Output
              Ports
            </span>
            <span className="text-[10px] font-mono text-text-muted px-2 py-0.5 rounded-md bg-surface-primary border border-border-subtle">
              {Object.keys(node.outputPorts || {}).length}
            </span>
          </div>

          <div className="space-y-2">
            {Object.entries(node.outputPorts || {}).map(
              ([portName, portVal]) => {
                return (
                  <div
                    key={portName}
                    className="p-2.5 rounded-xl bg-surface-primary border border-border-medium space-y-1.5 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        {portName}
                      </span>
                      <button
                        onClick={() => handleDeleteOutputPort(portName)}
                        className="p-1 rounded-md hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                        title={`Remove output port ${portName}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={portVal}
                      onChange={(e) =>
                        handleEditOutputPort(portName, e.target.value)
                      }
                      placeholder="e.g. {result}"
                      className="w-full bg-surface-secondary border border-border-medium rounded-lg px-2.5 py-1 text-xs font-mono text-text-primary outline-none focus:border-accent-primary"
                    />
                  </div>
                );
              },
            )}

            {/* Add Output Port Form */}
            <div className="p-2.5 rounded-xl bg-surface-primary/80 border border-border-medium space-y-2 shadow-2xs">
              <span className="text-[10px] font-mono text-text-muted uppercase font-bold block">
                Add Output Port
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Port name"
                  value={newOutPortName}
                  onChange={(e) => setNewOutPortName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddOutputPort()}
                  className="w-1/2 bg-surface-primary border border-border-medium rounded-lg px-2 py-1 text-[11px] font-mono text-text-primary outline-none focus:border-accent-primary"
                />
                <input
                  type="text"
                  placeholder="Target {key}"
                  value={newOutPortVal}
                  onChange={(e) => setNewOutPortVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddOutputPort()}
                  className="w-1/2 bg-surface-primary border border-border-medium rounded-lg px-2 py-1 text-[11px] font-mono text-text-primary outline-none focus:border-accent-primary"
                />
                <button
                  onClick={handleAddOutputPort}
                  className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer shadow-xs shrink-0 active:scale-95"
                  title="Add Output Port"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Custom XML Attributes Section */}
        <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-3 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle/80">
            <span className="text-xs font-bold text-text-primary uppercase tracking-wide font-mono flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-text-muted" /> XML Attributes
            </span>
            <span className="text-[10px] font-mono text-text-muted px-2 py-0.5 rounded-md bg-surface-primary border border-border-subtle">
              {Object.keys(node.attributes || {}).length}
            </span>
          </div>

          <div className="space-y-2">
            {Object.entries(node.attributes || {}).map(([attrKey, attrVal]) => (
              <div
                key={attrKey}
                className="flex items-center gap-2 bg-surface-primary p-2 rounded-xl border border-border-medium shadow-2xs"
              >
                <span className="font-mono text-[11px] text-text-muted font-bold truncate max-w-[80px]">
                  {attrKey}=
                </span>
                <input
                  type="text"
                  value={attrVal}
                  onChange={(e) => handleEditAttribute(attrKey, e.target.value)}
                  className="flex-1 bg-transparent text-xs font-mono text-text-primary outline-none border-b border-border-subtle focus:border-accent-primary"
                />
                <button
                  onClick={() => handleDeleteAttribute(attrKey)}
                  className="p-1 rounded-md hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-500 hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                  title={`Delete attribute ${attrKey}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* Add Attribute Form */}
            <div className="p-2.5 rounded-xl bg-surface-primary/80 border border-border-medium space-y-2 shadow-2xs">
              <span className="text-[10px] font-mono text-text-muted uppercase font-bold block">
                Add Attribute
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="attr_name"
                  value={newAttrKey}
                  onChange={(e) => setNewAttrKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddAttribute()}
                  className="w-1/2 bg-surface-primary border border-border-medium rounded-lg px-2 py-1 text-[11px] font-mono text-text-primary outline-none focus:border-accent-primary"
                />
                <input
                  type="text"
                  placeholder="value"
                  value={newAttrVal}
                  onChange={(e) => setNewAttrVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddAttribute()}
                  className="w-1/2 bg-surface-primary border border-border-medium rounded-lg px-2 py-1 text-[11px] font-mono text-text-primary outline-none focus:border-accent-primary"
                />
                <button
                  onClick={handleAddAttribute}
                  className="p-1.5 bg-surface-secondary hover:bg-surface-hover border border-border-medium hover:border-border-strong text-text-primary rounded-lg cursor-pointer shadow-2xs shrink-0 active:scale-95"
                  title="Add Custom Attribute"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Subtree Actions */}
        <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs">
          <div className="pb-1.5 border-b border-border-subtle/80">
            <span className="text-xs font-bold text-text-primary uppercase tracking-wide font-mono">
              Node Actions
            </span>
          </div>
          <button
            onClick={() => onDuplicate(node.id)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium hover:border-border-strong text-xs font-bold cursor-pointer transition-all shadow-2xs active:scale-95"
          >
            <Copy className="w-3.5 h-3.5 text-accent-primary" />
            <span>Duplicate Subtree</span>
          </button>

          <button
            onClick={() => onDelete(node.id)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/80 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-xs font-bold cursor-pointer transition-all shadow-2xs active:scale-95"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            <span>Delete Node & Subtree</span>
          </button>
        </div>
      </div>

      {/* Change Node Type Confirmation Modal */}
      {isChangeTypeModalOpen && (
        <BTEditorChangeTypeModal
          isOpen={isChangeTypeModalOpen}
          node={node}
          treeNodes={treeNodes}
          customNodeModels={customNodeModels}
          onClose={() => setIsChangeTypeModalOpen(false)}
          onApply={(nodeId, newType, resolution) => {
            if (onChangeNodeType) {
              onChangeNodeType(nodeId, newType, resolution);
            }
          }}
        />
      )}
    </aside>
  );
};
