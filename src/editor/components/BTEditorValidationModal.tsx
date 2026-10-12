import React from "react";
import {
  X,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { ValidationIssue } from "../types";

interface BTEditorValidationModalProps {
  isOpen: boolean;
  issues: ValidationIssue[];
  onClose: () => void;
  onSelectNode: (nodeId: string, treeId?: string) => void;
  onInspectNode?: (nodeId: string, treeId?: string) => void;
  documentTrees?: Record<
    string,
    { rootNodeId?: string; nodes?: Record<string, any> }
  >;
}

export const BTEditorValidationModal: React.FC<
  BTEditorValidationModalProps
> = ({
  isOpen,
  issues,
  onClose,
  onSelectNode,
  onInspectNode,
  documentTrees,
}) => {
  if (!isOpen) return null;

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div
        className="bg-surface-primary rounded-2xl shadow-2xl border border-border-medium max-w-lg w-full overflow-hidden animate-in zoom-in-95 select-text text-text-primary font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-surface-secondary border-b border-border-subtle px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {errors.length > 0 ? (
              <AlertCircle className="w-5 h-5 text-rose-500" />
            ) : warnings.length > 0 ? (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            )}
            <div>
              <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide font-mono">
                Tree Validation Results
              </h2>
              <p className="text-xs text-text-muted">
                {errors.length} Error{errors.length !== 1 ? "s" : ""},{" "}
                {warnings.length} Warning{warnings.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer border border-border-subtle shadow-2xs"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Issue List */}
        <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2 no-scrollbar">
          {issues.length === 0 ? (
            <div className="p-6 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <div className="font-bold text-sm text-text-primary">
                Valid Behavior Tree
              </div>
              <p className="text-xs text-text-muted">
                No structural errors or warnings found. The Behavior Tree is
                ready to save and execute.
              </p>
            </div>
          ) : (
            issues.map((issue) => (
              <div
                key={issue.id}
                className={`p-3 rounded-xl border flex items-start justify-between gap-3 text-xs ${
                  issue.severity === "error"
                    ? "bg-rose-50/70 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200"
                    : "bg-amber-50/70 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200"
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  {issue.severity === "error" ? (
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-bold uppercase text-[10px] font-mono block">
                      {issue.severity}
                    </span>
                    <span className="leading-relaxed">{issue.message}</span>
                  </div>
                </div>

                {(() => {
                  const targetNodeId =
                    issue.nodeId ||
                    (issue.treeId &&
                      documentTrees?.[issue.treeId]?.rootNodeId) ||
                    undefined;
                  if (!targetNodeId) return null;
                  return (
                    <button
                      onClick={() => {
                        if (onInspectNode) {
                          onInspectNode(targetNodeId, issue.treeId);
                        } else {
                          onSelectNode(targetNodeId, issue.treeId);
                        }
                        onClose();
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-primary border border-border-medium hover:border-accent-primary text-text-primary text-[11px] font-semibold cursor-pointer shadow-2xs shrink-0 transition-all active:scale-95"
                      title="Inspect and focus node on canvas"
                    >
                      <span>Inspect</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  );
                })()}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="bg-surface-secondary border-t border-border-subtle px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg text-xs font-semibold cursor-pointer shadow-xs active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
