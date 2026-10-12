import React, { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  GitBranch,
  Zap,
  CheckCircle2,
  Layers,
  Repeat,
  AlertCircle,
  Plus,
  ChevronDown,
  Copy,
  Trash2,
  ArrowRight,
  HelpCircle,
  Clock,
  FolderTree,
} from "lucide-react";
import { BTEditorNode, BTEditorNodeCategory } from "../types";

export interface BTEditorNodeData {
  node: BTEditorNode;
  isRoot?: boolean;
  treeId?: string;
  isSelected: boolean;
  hasErrors?: boolean;
  hasWarnings?: boolean;
  isReconnectCandidate?: boolean;
  onSelectNode: (id: string) => void;
  onAddChild?: (parentId: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  onToggleCollapse?: (id: string) => void;
  orientation?: "vertical" | "horizontal";
  onNodeResize?: (nodeId: string, height: number) => void;
}

const getCategoryBadge = (category: BTEditorNodeCategory, type: string) => {
  switch (category) {
    case "Control": {
      let icon = <GitBranch className="w-3.5 h-3.5 shrink-0" />;
      let symbol = "→";
      if (type.includes("Fallback")) symbol = "?";
      else if (type.includes("Parallel")) symbol = "⇉";
      else if (type.includes("Reactive")) symbol = "⚡→";
      else if (type.includes("Memory") || type.includes("Star")) symbol = "★";

      return (
        <span className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border shadow-2xs bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/80 dark:text-sky-300 dark:border-blue-800">
          <span className="font-extrabold text-xs select-text">{symbol}</span>
          <span className="select-text">{type}</span>
        </span>
      );
    }
    case "Decorator":
      return (
        <span className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border shadow-2xs bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-800">
          <Repeat className="w-3 h-3 shrink-0" />
          <span className="select-text">{type}</span>
        </span>
      );
    case "Action":
      return (
        <span className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border shadow-2xs bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800">
          <Zap className="w-3 h-3 shrink-0" />
          <span className="select-text">{type}</span>
        </span>
      );
    case "Condition":
      return (
        <span className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border shadow-2xs bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span className="select-text">{type}</span>
        </span>
      );
    case "SubTree":
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border shadow-2xs bg-purple-100/90 text-purple-900 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-700/60 font-semibold">
          <FolderTree className="w-3 h-3 text-purple-700 dark:text-purple-300 shrink-0" />
          <span className="select-text">{type || "SubTree"}</span>
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border shadow-2xs bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
          <HelpCircle className="w-3 h-3 shrink-0" />
          <span className="select-text">{type}</span>
        </span>
      );
  }
};

export const BTEditorNodeComponent: React.FC<{ data: BTEditorNodeData }> = memo(
  ({ data }) => {
    const {
      node,
      isRoot = false,
      isSelected,
      hasErrors,
      hasWarnings,
      isReconnectCandidate,
      onSelectNode,
      onAddChild,
      onDuplicate,
      onDelete,
      onToggleCollapse,
      orientation = "vertical",
      onNodeResize,
    } = data;

    const isHorizontal = orientation === "horizontal";
    const isLeaf = node.category === "Action" || node.category === "Condition";
    const hasChildren = node.children && node.children.length > 0;

    const inputPortCount = Object.keys(node.inputPorts || {}).length;
    const outputPortCount = Object.keys(node.outputPorts || {}).length;
    const attributeCount = Object.keys(node.attributes || {}).length;

    const handleStyle =
      "!w-4 !h-4 !bg-accent-primary !border-2 !border-white dark:!border-slate-900 shadow-sm";
    const nodeRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      const element = nodeRef.current;
      if (!element || !onNodeResize) return;
      const reportSize = () => onNodeResize(node.id, element.offsetHeight);
      reportSize();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(reportSize);
      observer.observe(element);
      return () => observer.disconnect();
    }, [node.id, onNodeResize]);

    return (
      <div
        ref={nodeRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelectNode(node.id);
        }}
        className={`relative w-[230px] rounded-2xl p-3 border transition-all cursor-pointer font-sans bg-surface-primary text-text-primary shadow-sm hover:shadow-md select-none ${
          isSelected && hasErrors
            ? "ring-3 ring-rose-500 border-rose-500 shadow-xl"
            : isSelected && hasWarnings
              ? "ring-3 ring-amber-500 border-amber-500 shadow-xl"
              : isSelected
                ? "ring-2 ring-accent-primary border-accent-primary shadow-lg"
                : isReconnectCandidate
                  ? "ring-2 ring-emerald-500 border-emerald-500 shadow-md animate-pulse hover:ring-4 hover:scale-[1.02]"
                  : hasErrors
                    ? "border-rose-500 ring-1 ring-rose-400"
                    : hasWarnings
                      ? "border-amber-500 ring-1 ring-amber-400"
                      : "border-border-medium hover:border-border-strong"
        }`}
      >
        {/* Target Handles (Top when Vertical, Left when Horizontal) */}
        <Handle
          type="target"
          position={Position.Top}
          id="target-top"
          className={!isHorizontal ? handleStyle : "!hidden"}
        />
        <Handle
          type="target"
          position={Position.Left}
          id="target-left"
          className={isHorizontal ? handleStyle : "!hidden"}
        />

        {/* Card Header: Category badge + validation flags / reconnect badge */}
        <div className="flex items-center justify-between gap-1 mb-2">
          <div className="truncate min-w-0 flex items-center gap-1.5">
            {getCategoryBadge(node.category, isRoot ? "Root" : node.type)}
            {isReconnectCandidate && (
              <span className="text-[9px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-700 px-1.5 py-0.2 rounded shrink-0">
                Connect
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {hasErrors && (
              <span
                title="Validation Error on this node"
                className="text-rose-500 animate-pulse"
              >
                <AlertCircle className="w-4 h-4" />
              </span>
            )}
            {hasWarnings && !hasErrors && (
              <span
                title="Validation Warning on this node"
                className="text-amber-500"
              >
                <AlertCircle className="w-4 h-4" />
              </span>
            )}
            {(hasChildren || node.category === "SubTree") &&
              onToggleCollapse && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(node.id);
                  }}
                  className={`px-1.5 py-0.5 rounded-md border text-[10px] font-mono font-semibold flex items-center gap-1 cursor-pointer transition-all shadow-2xs ${
                    node.isCollapsed
                      ? "bg-accent-primary/10 border-accent-primary text-accent-primary hover:bg-accent-primary/20"
                      : "bg-surface-secondary hover:bg-surface-hover border-border-medium hover:border-accent-primary text-text-secondary hover:text-accent-primary"
                  }`}
                  title={
                    node.isCollapsed
                      ? node.category === "SubTree"
                        ? "Expand SubTree"
                        : "Expand children"
                      : node.category === "SubTree"
                        ? "Collapse SubTree"
                        : "Collapse children"
                  }
                >
                  {node.isCollapsed ? (
                    <>
                      <Plus className="w-3 h-3 stroke-[2.5]" />
                      <span>+{node.children?.length || ""}</span>
                    </>
                  ) : (
                    <ChevronDown
                      className={`w-3 h-3 stroke-[2.5] transition-transform ${isHorizontal ? "-rotate-90" : ""}`}
                    />
                  )}
                </button>
              )}
          </div>
        </div>

        {/* Node Name & ID */}
        <div className="min-w-0 mb-1.5 nodrag select-none">
          <span
            className="inline-block max-w-full align-bottom font-bold text-xs text-text-primary truncate select-text"
            title={isRoot ? "Root" : node.name || node.type}
          >
            {isRoot ? "Root" : node.name || node.type}
          </span>
          {node.name && node.name !== node.type && (
            <span className="inline-block max-w-full align-bottom text-[10px] font-mono text-text-muted truncate select-text">
              &lt;{isRoot ? "Root" : node.type}&gt;
            </span>
          )}
        </div>

        {/* Ports and Attributes Preview Badges */}
        {(inputPortCount > 0 || outputPortCount > 0 || attributeCount > 0) && (
          <div className="pt-2 mt-1 border-t border-border-subtle flex flex-wrap gap-1 font-mono text-[9px] max-h-20 overflow-y-auto no-scrollbar nodrag select-none">
            {Object.entries(node.inputPorts || {}).map(([k, v]) => {
              const isBB = v.startsWith("{") && v.endsWith("}");
              return (
                <span
                  key={k}
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border max-w-full truncate select-none ${
                    isBB
                      ? "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800"
                      : "bg-surface-secondary text-text-secondary border-border-subtle"
                  }`}
                  title={`Input Port: ${k} = ${v}`}
                >
                  <span className="font-bold text-accent-primary select-text">
                    {k}:
                  </span>
                  <span className="truncate select-text">{v}</span>
                </span>
              );
            })}
            {Object.entries(node.outputPorts || {}).map(([k, v]) => {
              return (
                <span
                  key={k}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border max-w-full truncate bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-200 dark:border-emerald-800 select-none"
                  title={`Output Port: ${k} -> ${v}`}
                >
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 select-text">
                    {k}→
                  </span>
                  <span className="truncate select-text">{v}</span>
                </span>
              );
            })}
            {Object.entries(node.attributes || {}).map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border max-w-full truncate bg-surface-secondary text-text-muted border-border-subtle select-none"
                title={`Attribute: ${k} = ${v}`}
              >
                <span className="text-text-muted select-text">{k}=</span>
                <span className="truncate select-text">"{v}"</span>
              </span>
            ))}
          </div>
        )}

        {/* Visual collapsed indicator banner inside card */}
        {node.isCollapsed && (hasChildren || node.category === "SubTree") && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse?.(node.id);
            }}
            className="mt-2 pt-1.5 border-t border-border-subtle flex items-center justify-between text-[10px] font-mono text-text-muted hover:text-accent-primary cursor-pointer transition-colors select-none"
            title={
              node.category === "SubTree"
                ? "Click to expand SubTree"
                : "Click to expand children"
            }
          >
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-primary"></span>
              <span>
                {node.category === "SubTree"
                  ? "SubTree collapsed"
                  : "Children collapsed"}
              </span>
            </span>
            <span className="px-1.5 py-0.2 rounded bg-surface-secondary border border-border-subtle font-bold text-accent-primary">
              {node.children && node.children.length > 0
                ? `${node.children.length} hidden`
                : node.category === "SubTree"
                  ? "SubTree hidden"
                  : "Children hidden"}
            </span>
          </div>
        )}

        {/* Floating Action Buttons on Hover/Selection */}
        {isSelected && (
          <div className="absolute -top-3.5 right-2 flex items-center gap-1 bg-surface-primary border border-border-medium rounded-lg p-0.5 shadow-md z-30">
            {!isLeaf && onAddChild && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddChild(node.id);
                }}
                title="Add child node"
                className="p-1 rounded hover:bg-surface-hover text-accent-primary cursor-pointer transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
            {onDuplicate && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(node.id);
                }}
                title="Duplicate node / subtree"
                className="p-1 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
              >
                <Copy className="w-3 h-3" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(node.id);
                }}
                title="Delete node"
                className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-500 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Source Handles (Bottom when Vertical, Right when Horizontal) */}
        {(!isLeaf || hasChildren) && (
          <>
            <Handle
              type="source"
              position={Position.Bottom}
              id="source-bottom"
              className={!isHorizontal ? handleStyle : "!hidden"}
            />
            <Handle
              type="source"
              position={Position.Right}
              id="source-right"
              className={isHorizontal ? handleStyle : "!hidden"}
            />
          </>
        )}
      </div>
    );
  },
);

BTEditorNodeComponent.displayName = "BTEditorNodeComponent";
