import React, { useRef } from 'react';
import { 
  FileCode, 
  FolderOpen, 
  Download, 
  Undo2, 
  Redo2, 
  FilePlus,
  Code2,
  GitBranch,
  Plus,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { ValidationIssue } from '../types';

interface BTEditorToolbarProps {
  treesList: string[];
  activeTreeId: string;
  onSelectTree: (treeId: string) => void;
  onAddTree?: (treeId: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onNew: () => void;
  onOpen: (xmlContent: string, fileName?: string) => void;
  onSave: () => void;
  validationIssues: ValidationIssue[];
  onOpenValidationModal: () => void;
  onOpenRawXmlModal: () => void;
  isDirty: boolean;
}

export const BTEditorToolbar: React.FC<BTEditorToolbarProps> = ({
  treesList,
  activeTreeId,
  onSelectTree,
  onAddTree,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onNew,
  onOpen,
  onSave,
  validationIssues,
  onOpenValidationModal,
  onOpenRawXmlModal,
  isDirty,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          onOpen(content, file.name);
        }
      };
      reader.readAsText(file);
    }
    // reset input
    e.target.value = '';
  };

  return (
    <div className="h-[44px] bg-surface-primary border-b border-border-subtle px-3 flex items-center justify-between gap-2.5 select-text whitespace-nowrap overflow-visible relative font-sans shrink-0 z-30">
      {/* Left: Tree Selector Tabs */}
      <div className="flex items-center gap-1.5 min-w-0 max-w-[45%] overflow-x-auto no-scrollbar py-0.5 px-1.5 rounded-xl bg-surface-secondary/60 border border-border-medium shadow-2xs">
        <span className="text-[10px] font-mono uppercase font-bold text-text-muted mr-1 shrink-0">
          Trees:
        </span>
        {treesList.map((tId) => {
          const isActive = tId === activeTreeId;
          return (
            <button
              key={tId}
              onClick={() => onSelectTree(tId)}
              className={`h-7 flex items-center gap-1.5 px-3 rounded-lg text-xs font-mono transition-all cursor-pointer whitespace-nowrap shrink-0 active:scale-95 shadow-2xs ${
                isActive
                  ? 'bg-accent-primary text-white font-bold shadow-xs'
                  : 'bg-surface-primary hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border-medium hover:border-border-strong font-medium'
              }`}
            >
              <GitBranch className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-accent-primary'}`} />
              <span className="truncate max-w-[130px]">{tId}</span>
            </button>
          );
        })}
      </div>

      {/* Center: File Operations & Undo/Redo Groups */}
      <div className="flex items-center gap-2 shrink-0">
        {/* File Operations Container Box */}
        <div className="flex items-center gap-1 bg-surface-secondary/70 border border-border-medium rounded-xl p-0.5 px-1 shadow-2xs">
          <button
            onClick={onNew}
            className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
            title="Create New Behavior Tree Document"
          >
            <FilePlus className="w-3.5 h-3.5 text-accent-primary shrink-0" />
            <span>New</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".xml"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
            title="Open Behavior Tree XML File"
          >
            <FolderOpen className="w-3.5 h-3.5 text-accent-primary shrink-0" />
            <span>Open</span>
          </button>

          <button
            onClick={onSave}
            className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
            title="Download XML File"
          >
            <Download className="w-3.5 h-3.5 text-accent-primary shrink-0" />
            <span>Download</span>
            {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />}
          </button>
        </div>

        {/* Undo / Redo Container Box */}
        <div className="flex items-center gap-1 bg-surface-secondary/70 border border-border-medium rounded-xl p-0.5 px-1 shadow-2xs">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="h-7 p-1.5 rounded-lg text-xs bg-surface-primary hover:bg-surface-hover disabled:opacity-30 text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="h-7 p-1.5 rounded-lg text-xs bg-surface-primary hover:bg-surface-hover disabled:opacity-30 text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Right: Validation & Layout Operations Group */}
      <div className="flex items-center gap-1.5 shrink-0 bg-surface-secondary/70 border border-border-medium rounded-xl p-0.5 px-1 shadow-2xs">
        {/* Tree Validation Status Button */}
        {(() => {
          const activeTreeIssues = (validationIssues || []).filter(
            (issue) => !issue.treeId || issue.treeId === activeTreeId
          );
          const errorCount = activeTreeIssues.filter((i) => i.severity === 'error').length;
          const warningCount = activeTreeIssues.filter((i) => i.severity === 'warning').length;

          if (errorCount > 0) {
            return (
              <button
                onClick={onOpenValidationModal}
                className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-400 border border-rose-500/40 transition-all cursor-pointer shadow-2xs active:scale-95 animate-pulse"
                title={`Tree has ${errorCount} error(s) and ${warningCount} warning(s). Click to view issues.`}
              >
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>{`${errorCount} ${errorCount === 1 ? 'Error' : 'Errors'}`}</span>
                {warningCount > 0 && <span className="opacity-80">({warningCount}w)</span>}
              </button>
            );
          }

          if (warningCount > 0) {
            return (
              <button
                onClick={onOpenValidationModal}
                className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 border border-amber-500/40 transition-all cursor-pointer shadow-2xs active:scale-95"
                title={`Tree has ${warningCount} warning(s). Click to view issues.`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>{`${warningCount} ${warningCount === 1 ? 'Warning' : 'Warnings'}`}</span>
              </button>
            );
          }

          return (
            <button
              onClick={onOpenValidationModal}
              className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40 transition-all cursor-pointer shadow-2xs active:scale-95"
              title="Tree is valid. No errors or warnings detected. Click to view rules."
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Tree Valid</span>
            </button>
          );
        })()}

        {/* View Raw XML */}
        <button
          onClick={onOpenRawXmlModal}
          className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
          title="View and copy generated BehaviorTree.CPP XML"
        >
          <Code2 className="w-3.5 h-3.5 text-accent-primary shrink-0" />
          <span>XML</span>
        </button>
      </div>
    </div>
  );
};
