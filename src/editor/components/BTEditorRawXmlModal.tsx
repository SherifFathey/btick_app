import React, { useState } from "react";
import { X, Code2, Copy, Check, Download } from "lucide-react";

interface BTEditorRawXmlModalProps {
  isOpen: boolean;
  xmlContent: string;
  fileName?: string;
  onClose: () => void;
}

export const BTEditorRawXmlModal: React.FC<BTEditorRawXmlModalProps> = ({
  isOpen,
  xmlContent,
  fileName = "behavior_tree.xml",
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(xmlContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([xmlContent], {
      type: "application/xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div
        className="bg-surface-primary rounded-2xl shadow-2xl border border-border-medium max-w-3xl w-full overflow-hidden animate-in zoom-in-95 select-text text-text-primary font-sans flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-surface-secondary border-b border-border-subtle px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5 text-accent-primary" />
            <div>
              <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide font-mono">
                BehaviorTree.CPP XML Preview
              </h2>
              <p className="text-xs text-text-muted font-mono">{fileName}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-primary hover:bg-surface-hover border border-border-medium text-xs font-semibold text-text-primary transition-all cursor-pointer shadow-2xs active:scale-95"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? "Copied" : "Copy XML"}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-hover text-white text-xs font-semibold transition-all cursor-pointer shadow-xs active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer border border-border-subtle shadow-2xs ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div className="p-4 flex-1 overflow-auto bg-[#0b0f1a] text-slate-100 font-mono text-xs leading-relaxed">
          <pre className="select-text whitespace-pre overflow-x-auto">
            <code>{xmlContent}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
