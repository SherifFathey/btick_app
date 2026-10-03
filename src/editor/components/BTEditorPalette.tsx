import React, { useState, useMemo } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Repeat,
  Zap,
  CheckCircle2,
  Layers,
  Plus,
  Sparkles,
  BookOpen,
  Activity,
  FileEdit,
} from "lucide-react";
import { BTEditorNodeCategory, BTNodeModelDefinition } from "../types";
import { AppMode } from "../../shared/types";
import { BUILTIN_NODE_DEFINITIONS } from "../nodeLibrary";

interface BTEditorPaletteProps {
  appMode?: AppMode;
  onModeChange?: (mode: AppMode) => void;
  customNodeModels?: Record<string, BTNodeModelDefinition>;
  availableSubtrees?: string[];
  selectedNodeId?: string | null;
  onAddNode: (nodeType: string, parentId?: string | null) => void;
  onRegisterCustomNode?: (type: string, category: BTEditorNodeCategory) => void;
  embedded?: boolean;
}

export const BTEditorPalette: React.FC<BTEditorPaletteProps> = ({
  appMode = "editor",
  onModeChange,
  customNodeModels = {},
  availableSubtrees = [],
  selectedNodeId,
  onAddNode,
  onRegisterCustomNode,
  embedded = false,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(
    {
      Control: true,
      Decorator: true,
      Action: true,
      Condition: true,
      SubTree: true,
    },
  );

  const [newCustomName, setNewCustomName] = useState("");
  const [newCustomCategory, setNewCustomCategory] =
    useState<BTEditorNodeCategory>("Action");
  const [isAddingCustom, setIsAddingCustom] = useState(false);

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  // Merge built-in and custom node definitions
  const allNodes = useMemo(() => {
    const combined: Record<
      string,
      { type: string; category: BTEditorNodeCategory; description?: string }
    > = {
      ...BUILTIN_NODE_DEFINITIONS,
    };
    Object.values(customNodeModels).forEach((m) => {
      combined[m.type] = {
        type: m.type,
        category: m.category,
        description: m.description,
      };
    });
    return combined;
  }, [customNodeModels]);

  // Filter nodes by search term
  const filteredNodes = useMemo(() => {
    const list = Object.values(allNodes);
    if (!searchTerm.trim()) return list;
    const q = searchTerm.toLowerCase();
    return list.filter(
      (n) =>
        n.type.toLowerCase().includes(q) ||
        (n.description && n.description.toLowerCase().includes(q)),
    );
  }, [allNodes, searchTerm]);

  // Group by category
  const categorized = useMemo(() => {
    const groups: Record<
      BTEditorNodeCategory,
      Array<{
        type: string;
        category: BTEditorNodeCategory;
        description?: string;
      }>
    > = {
      Control: [],
      Decorator: [],
      Action: [],
      Condition: [],
      SubTree: [],
      Unknown: [],
    };

    filteredNodes.forEach((n) => {
      if (groups[n.category]) {
        groups[n.category].push(n);
      } else {
        groups.Action.push(n);
      }
    });

    return groups;
  }, [filteredNodes]);

  const handleDragStart = (e: React.DragEvent, nodeType: string) => {
    e.dataTransfer.setData("application/bt-node-type", nodeType);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleCreateCustom = () => {
    const trimmed = newCustomName.trim();
    if (!trimmed) return;
    if (onRegisterCustomNode) {
      onRegisterCustomNode(trimmed, newCustomCategory);
    }
    onAddNode(trimmed, selectedNodeId);
    setNewCustomName("");
    setIsAddingCustom(false);
  };

  // One uniform background per group — header and body share the exact same bg.
  // Node buttons inside use bg-surface-primary so they pop against the group tint.
  const categoryTheme: Record<
    BTEditorNodeCategory,
    { border: string; bg: string; iconColor: string; badgeText: string }
  > = {
    Control: {
      border: "border-border-medium",
      bg: "bg-surface-secondary",
      iconColor: "text-text-muted",
      badgeText: "text-text-secondary",
    },
    Decorator: {
      border: "border-border-medium",
      bg: "bg-surface-secondary",
      iconColor: "text-text-muted",
      badgeText: "text-text-secondary",
    },
    Action: {
      border: "border-border-medium",
      bg: "bg-surface-secondary",
      iconColor: "text-text-muted",
      badgeText: "text-text-secondary",
    },
    Condition: {
      border: "border-border-medium",
      bg: "bg-surface-secondary",
      iconColor: "text-text-muted",
      badgeText: "text-text-secondary",
    },
    SubTree: {
      border: "border-border-medium",
      bg: "bg-surface-secondary",
      iconColor: "text-text-muted",
      badgeText: "text-text-secondary",
    },
    Unknown: {
      border: "border-border-medium",
      bg: "bg-surface-secondary",
      iconColor: "text-text-muted",
      badgeText: "text-text-secondary",
    },
  };

  const renderCategory = (
    category: BTEditorNodeCategory,
    icon: React.ReactNode,
    count: number,
  ) => {
    const isOpen = openCategories[category];
    const nodes = categorized[category] || [];
    const theme = categoryTheme[category];

    return (
      // Entire group: one uniform background, no split between header and body
      <div
        key={category}
        className={`rounded-xl border ${theme.border} ${theme.bg} overflow-hidden shadow-2xs mb-2`}
      >
        {/* Header: same bg as the container — no separate color */}
        <button
          onClick={() => toggleCategory(category)}
          className="w-full px-3 py-2 flex items-center justify-between text-xs font-bold text-text-primary transition-colors cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            <span className={theme.iconColor}>{icon}</span>
            <span>{category}</span>
            <span
              className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-white/40 dark:bg-black/20 border border-current/20 ${theme.badgeText}`}
            >
              {count}
            </span>
          </div>
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
          )}
        </button>

        {isOpen && (
          // Body: same bg as group — no separate color
          <div className="px-2 pb-2 space-y-1.5">
            {nodes.map((n) => (
              <div
                key={n.type}
                draggable
                onDragStart={(e) => handleDragStart(e, n.type)}
                className="group flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-primary border border-border-medium hover:border-accent-primary hover:bg-surface-hover text-xs transition-all cursor-grab active:cursor-grabbing shadow-2xs"
                title={n.description || n.type}
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="font-semibold text-text-primary truncate">
                    {n.type}
                  </span>
                  {n.description && (
                    <span className="text-[10px] text-text-muted truncate">
                      {n.description}
                    </span>
                  )}
                </div>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddNode(n.type, null);
                  }}
                  className="p-1 rounded-md bg-surface-secondary hover:bg-accent-primary hover:text-white text-accent-primary border border-border-subtle hover:border-accent-primary cursor-pointer transition-all shrink-0 active:scale-95 shadow-2xs"
                  title={`Add ${n.type} to canvas`}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {category === "SubTree" && availableSubtrees.length > 0 && (
              <div className="pt-2 mt-1 border-t border-border-subtle">
                <div className="text-[10px] font-semibold text-text-muted uppercase px-1 mb-1.5 font-mono">
                  Document SubTrees:
                </div>
                <div className="space-y-1">
                  {availableSubtrees.map((subId) => (
                    <div
                      key={subId}
                      draggable
                      onDragStart={(e) =>
                        handleDragStart(e, `SubTree:${subId}`)
                      }
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-200 text-xs transition-all cursor-grab shadow-2xs hover:border-indigo-400"
                    >
                      <span className="truncate font-mono font-bold text-xs">
                        {subId}
                      </span>
                      <button
                        onClick={() => onAddNode(`SubTree:${subId}`, null)}
                        className="p-1 rounded-md bg-white dark:bg-indigo-900/80 text-accent-primary hover:bg-accent-primary hover:text-white border border-indigo-200 dark:border-indigo-700 cursor-pointer shadow-2xs transition-all shrink-0 active:scale-95"
                        title={`Add SubTree reference to "${subId}"`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const paletteBody = (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden select-text font-sans text-xs">
      {/* Palette Header */}
      <div className="h-[38px] px-3.5 border-b border-border-subtle bg-surface-primary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-accent-primary" />
          <h2 className="font-bold text-xs text-text-primary uppercase tracking-wide font-mono">
            Node Library
          </h2>
        </div>
        <button
          onClick={() => setIsAddingCustom(!isAddingCustom)}
          className="px-2 py-1 rounded-lg bg-surface-primary hover:bg-surface-hover text-accent-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95 flex items-center gap-1 font-bold"
          title="Create a custom BehaviorTree node type"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span className="text-[10px] font-semibold">New</span>
        </button>
      </div>

      {/* Quick Search */}
      <div className="p-2 border-b border-border-subtle bg-surface-secondary/40 shrink-0">
        <div className="flex items-center bg-surface-primary px-2.5 py-1.5 rounded-xl border border-border-medium focus-within:border-accent-primary focus-within:ring-2 focus-within:ring-accent-primary/20 shadow-2xs">
          <Search className="w-3.5 h-3.5 text-text-muted mr-1.5 shrink-0" />
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-full font-sans"
          />
        </div>
      </div>

      {/* Custom Node Creator Drawer/Popover if active */}
      {isAddingCustom && (
        <div className="p-3 mx-2 my-2 border border-border-medium bg-surface-secondary/80 rounded-xl space-y-2 animate-in fade-in shrink-0 shadow-2xs">
          <div className="text-[11px] font-bold text-text-primary font-mono uppercase tracking-wider">
            Create Custom Node
          </div>
          <input
            type="text"
            placeholder="e.g. NavigateToPose"
            value={newCustomName}
            onChange={(e) => setNewCustomName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateCustom()}
            className="w-full px-2.5 py-1.5 bg-surface-primary border border-border-medium rounded-lg text-xs font-mono text-text-primary outline-none focus:border-accent-primary"
          />
          <div className="flex items-center gap-2">
            <select
              value={newCustomCategory}
              onChange={(e) =>
                setNewCustomCategory(e.target.value as BTEditorNodeCategory)
              }
              className="flex-1 px-2.5 py-1.5 bg-surface-primary border border-border-medium rounded-lg text-xs text-text-primary outline-none focus:border-accent-primary font-medium"
            >
              <option value="Action">Action</option>
              <option value="Condition">Condition</option>
              <option value="Decorator">Decorator</option>
              <option value="Control">Control</option>
            </select>
            <button
              onClick={handleCreateCustom}
              className="px-3.5 py-1.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-bold cursor-pointer shadow-xs active:scale-95"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Accordion Categories */}
      <div className="flex-1 overflow-y-auto p-2.5 no-scrollbar">
        {renderCategory(
          "Control",
          <GitBranch className="w-3.5 h-3.5 text-blue-500" />,
          categorized.Control.length,
        )}
        {renderCategory(
          "Decorator",
          <Repeat className="w-3.5 h-3.5 text-accent-primary" />,
          categorized.Decorator.length,
        )}
        {renderCategory(
          "Action",
          <Zap className="w-3.5 h-3.5 text-amber-500" />,
          categorized.Action.length,
        )}
        {renderCategory(
          "Condition",
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
          categorized.Condition.length,
        )}
        {renderCategory(
          "SubTree",
          <Layers className="w-3.5 h-3.5 text-indigo-500" />,
          categorized.SubTree.length + availableSubtrees.length,
        )}
      </div>

      {/* Bottom Hint */}
      <div className="p-2 border-t border-border-subtle bg-surface-secondary text-[10px] text-text-muted text-center shrink-0">
        Drag nodes to canvas or click{" "}
        <Plus className="w-2.5 h-2.5 inline text-accent-primary" /> to insert
      </div>
    </div>
  );

  if (embedded) {
    return paletteBody;
  }

  return (
    <aside className="w-64 h-full bg-surface-primary border-r border-border-subtle flex flex-col z-20 shrink-0 font-sans select-text text-xs overflow-hidden">
      {/* Mode Switcher at top (for standalone palette) */}
      <div className="p-2 border-b border-border-subtle bg-surface-primary flex items-center justify-center shrink-0">
        <div className="flex items-center bg-surface-secondary p-0.5 rounded-xl border border-border-medium text-xs font-semibold whitespace-nowrap shrink-0 shadow-2xs mx-1 w-full justify-between">
          <button
            onClick={() => onModeChange?.("monitor")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
              appMode === "monitor"
                ? "bg-accent-primary text-white font-bold shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            title="Monitor & Debugging"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Monitor</span>
          </button>
          <button
            onClick={() => onModeChange?.("editor")}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap active:scale-95 ${
              appMode === "editor"
                ? "bg-accent-primary text-white font-bold shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
            }`}
            title="Visual BehaviorTree XML Editor"
          >
            <FileEdit className="w-3.5 h-3.5" />
            <span>XML Editor</span>
          </button>
        </div>
      </div>

      {paletteBody}
    </aside>
  );
};
