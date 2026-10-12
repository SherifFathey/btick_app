import React, { useState, useMemo } from "react";
import {
  Database,
  Search,
  Check,
  X,
  Copy,
  Download,
  ArrowRight,
  Edit2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Info,
  CheckCircle2,
} from "lucide-react";
import { BTTreeModel } from "../types/bt";
import {
  formatBlackboardValue,
  inferBlackboardValueType,
} from "../utils/blackboard";
import { resolveNodePorts } from "../utils/ports";

export interface BlackboardEntry {
  key: string;
  value: string;
  type: "string" | "number" | "boolean" | "json" | "unknown";
  readers: { id: string; name: string; portName: string }[];
  writers: { id: string; name: string; portName: string }[];
}

export interface BlackboardWatcherProps {
  tree: BTTreeModel | null;
  isOpen: boolean;
  activeProtocol?: "btick" | "groot2" | "nav2";
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
  onSetBlackboard?: (
    treeId: string,
    key: string,
    value: any,
    valueType: "bool" | "int" | "double" | "string",
  ) => Promise<{ success: boolean; error?: string }>;
}

export const BlackboardWatcher: React.FC<BlackboardWatcherProps> = ({
  tree,
  isOpen,
  activeProtocol = "btick",
  onClose,
  onSelectNode,
  onSetBlackboard,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [pendingValues, setPendingValues] = useState<
    Record<string, { value: any; type: "bool" | "int" | "double" | "string" }>
  >({});
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    Record<string, { type: "success" | "error"; message: string }>
  >({});

  const isWritableProtocol = activeProtocol === "btick";

  // Extract all Blackboard references from nodes in the active tree + live values
  const blackboardEntries = useMemo<BlackboardEntry[]>(() => {
    const map = new Map<string, BlackboardEntry>();

    // 1. Populate all live key-value pairs from tree.blackboard
    if (tree && tree.blackboard) {
      Object.entries(tree.blackboard).forEach(([rawKey, val]) => {
        const stringVal = formatBlackboardValue(val);
        let inferredType: BlackboardEntry["type"] = "string";
        if (typeof val === "number") inferredType = "number";
        else if (typeof val === "boolean") inferredType = "boolean";
        else if (typeof val === "object") inferredType = "json";
        else if (stringVal === "true" || stringVal === "false")
          inferredType = "boolean";
        else if (!isNaN(Number(stringVal)) && stringVal !== "")
          inferredType = "number";

        map.set(rawKey, {
          key: rawKey,
          value: stringVal,
          type: inferredType,
          readers: [],
          writers: [],
        });
      });
    }

    // 2. Cross-reference reader and writer nodes from tree.nodes
    if (tree && tree.nodes) {
      tree.nodes.forEach((node) => {
        resolveNodePorts(node).forEach((port) => {
          if (
            port.mode !== "Blackboard" ||
            !port.value.startsWith("{") ||
            !port.value.endsWith("}")
          ) {
            return;
          }
          const rawKey = port.value.slice(1, -1).trim();
          if (!rawKey) return;

          if (!map.has(rawKey)) {
            map.set(rawKey, {
              key: rawKey,
              value: "unset",
              type: "unknown",
              readers: [],
              writers: [],
            });
          }

          const entry = map.get(rawKey)!;
          const isReader =
            port.direction === "Input" || port.direction === "Inout";
          const isWriter =
            port.direction === "Output" || port.direction === "Inout";
          if (
            isReader &&
            !entry.readers.some(
              (reader) =>
                reader.id === node.id && reader.portName === port.name,
            )
          ) {
            entry.readers.push({
              id: node.id,
              name: node.name,
              portName: port.name,
            });
          }
          if (
            isWriter &&
            !entry.writers.some(
              (writer) =>
                writer.id === node.id && writer.portName === port.name,
            )
          ) {
            entry.writers.push({
              id: node.id,
              name: node.name,
              portName: port.name,
            });
          }
        });
      });
    }

    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [tree]);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return blackboardEntries;
    const q = searchQuery.toLowerCase();
    return blackboardEntries.filter(
      (e) =>
        e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q),
    );
  }, [blackboardEntries, searchQuery]);

  const handleStartEdit = (entry: BlackboardEntry) => {
    let initialType: "bool" | "int" | "double" | "string" = "string";
    let initialVal: any = entry.value;

    if (entry.type === "boolean") {
      initialType = inferBlackboardValueType(entry.value);
      initialVal = entry.value === "true" || entry.value === "1";
    } else if (entry.type === "number") {
      initialType = inferBlackboardValueType(entry.value);
      initialVal = entry.value !== "unset" ? entry.value : "0";
    } else {
      initialType = "string";
      initialVal = entry.value !== "unset" ? entry.value : "";
    }

    setPendingValues((prev) => ({
      ...prev,
      [entry.key]: { value: initialVal, type: initialType },
    }));
    setEditingKey(entry.key);
    setFeedback((prev) => {
      const next = { ...prev };
      delete next[entry.key];
      return next;
    });
  };

  const handleCancelEdit = (key: string) => {
    setEditingKey((current) => (current === key ? null : current));
    setFeedback((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleApplyEdit = async (entry: BlackboardEntry) => {
    if (!tree?.tree_id || !onSetBlackboard) return;
    const pending = pendingValues[entry.key];
    if (!pending) return;

    setSubmittingKey(entry.key);
    try {
      const res = await onSetBlackboard(
        tree.tree_id,
        entry.key,
        pending.value,
        pending.type,
      );
      if (res.success) {
        setFeedback((prev) => ({
          ...prev,
          [entry.key]: {
            type: "success",
            message: "Applied to live Blackboard",
          },
        }));
        setEditingKey(null);
        setTimeout(() => {
          setFeedback((prev) => {
            const next = { ...prev };
            delete next[entry.key];
            return next;
          });
        }, 3000);
      } else {
        setFeedback((prev) => ({
          ...prev,
          [entry.key]: {
            type: "error",
            message: res.error || "Failed to update Blackboard",
          },
        }));
      }
    } catch (err: any) {
      setFeedback((prev) => ({
        ...prev,
        [entry.key]: {
          type: "error",
          message: err?.message || "Communication failure",
        },
      }));
    } finally {
      setSubmittingKey(null);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleExportBlackboard = () => {
    const exportData: Record<string, any> = {};
    blackboardEntries.forEach((entry) => {
      exportData[entry.key] = {
        value: entry.value,
        type: entry.type,
        readers: entry.readers.map((r) => r.name),
        writers: entry.writers.map((w) => w.name),
      };
    });

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blackboard_${tree?.tree_name || "tree"}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <aside className="w-96 h-full bg-surface-primary border-l border-border-subtle flex flex-col z-20 shadow-xl shrink-0 font-sans select-text text-xs">
      {/* Drawer Header */}
      <div className="h-[44px] px-3.5 border-b border-border-subtle bg-surface-primary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-accent-primary" />
          <div>
            <h2 className="font-bold text-xs text-text-primary uppercase tracking-wide font-mono">
              Live Blackboard Watcher
            </h2>
            <p className="text-[9px] font-mono text-text-muted">
              {blackboardEntries.length} Variable
              {blackboardEntries.length !== 1 ? "s" : ""} in Scope (
              {isWritableProtocol ? "Live Editable" : "View Only"})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExportBlackboard}
            className="p-1.5 rounded-lg bg-surface-secondary hover:bg-surface-hover text-text-secondary border border-border-subtle transition-all cursor-pointer shadow-2xs active:scale-95"
            title="Export Blackboard Snapshot to JSON"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer shadow-2xs active:scale-95"
            title="Close Blackboard Watcher"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Safety & Protocol Notification Banner */}
      {isWritableProtocol ? (
        <div className="mx-3 mt-2.5 p-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-[10px] flex items-start gap-2 shadow-2xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
          <div>
            <span className="font-bold">Live Blackboard Editing: </span>
            Modifying values directly alters the runtime state of the active
            BehaviorTree process. Values are only written upon clicking{" "}
            <strong>Apply</strong>.
          </div>
        </div>
      ) : (
        <div className="mx-3 mt-2.5 p-2 rounded-xl bg-surface-secondary border border-border-medium text-text-muted text-[10px] flex items-start gap-2 shadow-2xs">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-text-muted" />
          <div>
            <span className="font-bold">Read-Only Mode: </span>
            Blackboard modification is disabled for{" "}
            {activeProtocol === "groot2" ? "Groot2" : "Nav2"}. Switch to{" "}
            <strong>BT Monitor</strong> to edit.
          </div>
        </div>
      )}

      {/* Search Toolbar */}
      <div className="p-3 border-b border-border-subtle bg-surface-primary">
        <div className="flex items-center bg-surface-secondary px-3 py-1.5 rounded-lg border border-border-subtle focus-within:ring-2 focus-within:ring-accent-primary/20">
          <Search className="w-3.5 h-3.5 text-text-muted mr-1.5 shrink-0" />
          <input
            type="text"
            placeholder="Filter blackboard keys..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-full font-sans"
          />
        </div>
      </div>

      {/* Variable List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-surface-primary">
        {filteredEntries.length === 0 ? (
          <div className="p-6 text-center text-xs text-text-muted italic font-mono space-y-2">
            <Database className="w-8 h-8 text-text-muted mx-auto opacity-40" />
            <div>No Blackboard variables detected in active tree.</div>
            <div className="text-[10px] text-text-muted not-italic">
              Ports mapped to{" "}
              <code className="bg-surface-secondary text-accent-primary px-1.5 py-0.5 rounded-md border border-border-subtle">
                {"{key_name}"}
              </code>{" "}
              will automatically display here.
            </div>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isEditing = editingKey === entry.key;
            const isSupportedType =
              entry.type === "boolean" ||
              entry.type === "number" ||
              entry.type === "string";
            const isEditable = isWritableProtocol && isSupportedType;
            const pending = pendingValues[entry.key];
            const isSubmitting = submittingKey === entry.key;
            const entryFeedback = feedback[entry.key];

            return (
              <div
                key={entry.key}
                className={`bg-surface-secondary rounded-2xl border p-3 transition-all space-y-2.5 shadow-2xs ${
                  isEditing
                    ? "border-accent-primary ring-1 ring-accent-primary/20"
                    : "border-border-subtle hover:border-border-medium"
                }`}
              >
                {/* Key Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="text-accent-primary font-mono font-bold text-xs truncate">
                      {`{${entry.key}}`}
                    </span>
                    <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded-md bg-surface-primary text-text-muted border border-border-subtle font-bold">
                      {entry.type}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isEditable && !isEditing && (
                      <button
                        onClick={() => handleStartEdit(entry)}
                        className="p-1.5 rounded-lg hover:bg-surface-hover text-accent-primary hover:text-accent-hover transition-all cursor-pointer shadow-2xs active:scale-95"
                        title="Edit live blackboard value"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}

                    {!isWritableProtocol ? (
                      <span className="text-[9px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-surface-primary border border-border-subtle">
                        Read-Only
                      </span>
                    ) : !isSupportedType ? (
                      <span
                        className="text-[9px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-surface-primary border border-border-subtle"
                        title="Complex / opaque type cannot be modified safely"
                      >
                        Complex Type
                      </span>
                    ) : null}

                    <button
                      onClick={() => handleCopy(entry.key, entry.key)}
                      className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer shadow-2xs active:scale-95"
                      title="Copy key name"
                    >
                      {copiedKey === entry.key ? (
                        <Check className="w-3 h-3 text-state-success-text" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Current Live Value */}
                <div className="bg-surface-primary rounded-lg p-2.5 border border-border-subtle">
                  <div className="text-[9px] text-text-muted font-mono mb-1 flex items-center justify-between font-semibold">
                    <span>CURRENT LIVE VALUE</span>
                    {entry.value !== "unset" &&
                    entry.value !== undefined &&
                    entry.value !== "" ? (
                      <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold">
                        ● Active Runtime
                      </span>
                    ) : (
                      <span className="text-[9px] text-text-muted">
                        Unassigned
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-text-primary break-all p-1.5 rounded-lg bg-surface-secondary border border-border-subtle select-text">
                    {entry.value !== "unset" &&
                    entry.value !== undefined &&
                    entry.value !== "" ? (
                      <span className="text-emerald-700 dark:text-emerald-300 font-bold">
                        {entry.value}
                      </span>
                    ) : (
                      <span className="text-text-muted italic font-sans text-[10px]">
                        Waiting for live data...
                      </span>
                    )}
                  </div>
                </div>

                {/* Edit Pending Value Section */}
                {isEditing && (
                  <div className="bg-surface-primary rounded-xl p-2.5 border border-accent-border shadow-xs space-y-2">
                    <div className="text-[9px] font-mono text-accent-primary font-bold flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Edit2 className="w-2.5 h-2.5" />
                        <span>EDIT PENDING VALUE</span>
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/30">
                        Pending Apply
                      </span>
                    </div>

                    {/* Boolean Control */}
                    {entry.type === "boolean" && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setPendingValues((prev) => ({
                              ...prev,
                              [entry.key]: { ...prev[entry.key], value: true },
                            }))
                          }
                          className={`flex-1 py-1 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer border ${
                            pending?.value === true
                              ? "bg-emerald-600 border-emerald-500 text-white shadow-xs"
                              : "bg-surface-secondary border-border-subtle text-text-muted hover:text-text-primary"
                          }`}
                        >
                          true
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingValues((prev) => ({
                              ...prev,
                              [entry.key]: { ...prev[entry.key], value: false },
                            }))
                          }
                          className={`flex-1 py-1 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer border ${
                            pending?.value === false
                              ? "bg-rose-600 border-rose-500 text-white shadow-xs"
                              : "bg-surface-secondary border-border-subtle text-text-muted hover:text-text-primary"
                          }`}
                        >
                          false
                        </button>
                      </div>
                    )}

                    {/* Number Control */}
                    {entry.type === "number" && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step={pending?.type === "double" ? "any" : "1"}
                            value={pending?.value ?? ""}
                            onChange={(e) =>
                              setPendingValues((prev) => ({
                                ...prev,
                                [entry.key]: {
                                  ...prev[entry.key],
                                  value: e.target.value,
                                },
                              }))
                            }
                            className="w-full bg-surface-secondary border border-border-medium rounded-lg px-2.5 py-1 text-xs font-mono text-text-primary outline-none focus:border-border-focus"
                            placeholder="Enter number..."
                          />
                          <div className="flex items-center rounded-lg border border-border-subtle p-0.5 bg-surface-secondary text-[10px] font-mono shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setPendingValues((prev) => ({
                                  ...prev,
                                  [entry.key]: {
                                    ...prev[entry.key],
                                    type: "int",
                                  },
                                }))
                              }
                              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                                pending?.type === "int"
                                  ? "bg-surface-primary text-accent-primary font-bold shadow-2xs"
                                  : "text-text-muted"
                              }`}
                            >
                              int
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingValues((prev) => ({
                                  ...prev,
                                  [entry.key]: {
                                    ...prev[entry.key],
                                    type: "double",
                                  },
                                }))
                              }
                              className={`px-1.5 py-0.5 rounded cursor-pointer ${
                                pending?.type === "double"
                                  ? "bg-surface-primary text-accent-primary font-bold shadow-2xs"
                                  : "text-text-muted"
                              }`}
                            >
                              float
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* String Control */}
                    {entry.type === "string" && (
                      <input
                        type="text"
                        value={pending?.value ?? ""}
                        onChange={(e) =>
                          setPendingValues((prev) => ({
                            ...prev,
                            [entry.key]: {
                              ...prev[entry.key],
                              value: e.target.value,
                            },
                          }))
                        }
                        className="w-full bg-surface-secondary border border-border-medium rounded-lg px-2.5 py-1 text-xs font-mono text-text-primary outline-none focus:border-border-focus"
                        placeholder="Enter string value..."
                      />
                    )}

                    {/* Edit Actions: Apply / Cancel */}
                    <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border-subtle">
                      <button
                        type="button"
                        onClick={() => handleCancelEdit(entry.key)}
                        disabled={isSubmitting}
                        className="px-2 py-1 rounded-lg hover:bg-surface-hover text-text-muted text-xs font-medium transition-all cursor-pointer active:scale-95"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyEdit(entry)}
                        disabled={isSubmitting}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg bg-accent-primary hover:bg-accent-hover text-white text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95 disabled:opacity-50"
                      >
                        {isSubmitting ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Applying...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3 h-3" />
                            <span>Apply</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Feedback Banner */}
                {entryFeedback && (
                  <div
                    className={`p-2 rounded-lg text-[10px] font-medium flex items-center gap-1.5 ${
                      entryFeedback.type === "success"
                        ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                        : "bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {entryFeedback.type === "success" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                    )}
                    <span className="break-all">{entryFeedback.message}</span>
                  </div>
                )}

                {/* Linked Nodes (Readers & Writers) */}
                {(entry.readers.length > 0 || entry.writers.length > 0) && (
                  <div className="pt-2 border-t border-border-subtle space-y-1.5 text-[10px] font-mono">
                    {/* Writers */}
                    {entry.writers.length > 0 && (
                      <div className="flex items-start gap-1.5 flex-wrap">
                        <span className="text-cat-action-text font-bold shrink-0">
                          Writers:
                        </span>
                        {entry.writers.map((w, idx) => (
                          <button
                            key={idx}
                            onClick={() => onSelectNode(w.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cat-action-bg text-cat-action-text border border-cat-action-border hover:bg-surface-hover transition-all cursor-pointer shadow-2xs active:scale-95"
                            title={`Jump to writer node: ${w.name} (port: ${w.portName})`}
                          >
                            <ArrowRight className="w-2.5 h-2.5" />
                            <span className="truncate max-w-[120px]">
                              {w.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Readers */}
                    {entry.readers.length > 0 && (
                      <div className="flex items-start gap-1.5 flex-wrap">
                        <span className="text-accent-primary font-bold shrink-0">
                          Readers:
                        </span>
                        {entry.readers.map((r, idx) => (
                          <button
                            key={idx}
                            onClick={() => onSelectNode(r.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent-subtle text-accent-primary border border-accent-border hover:bg-surface-hover transition-all cursor-pointer shadow-2xs active:scale-95"
                            title={`Jump to reader node: ${r.name} (port: ${r.portName})`}
                          >
                            <ArrowRight className="w-2.5 h-2.5" />
                            <span className="truncate max-w-[120px]">
                              {r.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
