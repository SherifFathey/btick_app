import React, { useRef } from 'react';
import { Compass, FileCode, X, Sparkles, HelpCircle, CheckCircle2 } from 'lucide-react';
import { NAV2_DEFAULT_SAMPLE_XML } from '../constants/nav2Sample';

interface Nav2PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadTreeXml: (xmlContent: string, fileName: string) => void;
}

export const Nav2PromptModal: React.FC<Nav2PromptModalProps> = ({
  isOpen,
  onClose,
  onLoadTreeXml,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          onLoadTreeXml(content, file.name);
          onClose();
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    }
  };

  const handleLoadSample = () => {
    onLoadTreeXml(NAV2_DEFAULT_SAMPLE_XML, 'nav2_default_navigation.xml');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
      <div 
        className="bg-surface-primary rounded-2xl shadow-2xl border border-border-medium max-w-lg w-full overflow-hidden animate-in zoom-in-95 select-text text-text-primary"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header */}
        <div className="bg-surface-secondary border-b border-border-subtle px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-accent-subtle rounded-lg border border-accent-border shadow-2xs">
              <Compass className="w-6 h-6 text-accent-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-wide text-text-primary">Nav2 Protocol Selected</h2>
              <p className="text-xs text-text-secondary font-mono">ROS 2 /behavior_tree_log Live Bridge</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all cursor-pointer border border-border-subtle shadow-2xs active:scale-95"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-4">
          <div className="bg-accent-subtle/50 border border-accent-border rounded-lg p-4 text-xs text-text-secondary space-y-2 shadow-2xs">
            <div className="flex items-center gap-2 font-bold text-accent-primary">
              <HelpCircle className="w-4 h-4" />
              <span>Why Load   an XML Behavior Tree?</span>
            </div>
            <p className="leading-relaxed">
              ROS 2 Nav2 publishes real-time node execution status changes over the <code className="bg-surface-primary px-1.5 py-0.5 rounded-md border border-border-medium font-mono text-[11px] text-accent-primary font-bold">/behavior_tree_log</code> topic, but does not transmit the full Behavior Tree structure.
            </p>
            <p className="leading-relaxed">
              Loading your robot's Nav2 XML tree enables BTick to <strong>match incoming live status transitions</strong> directly to tree nodes and render live color indicators (<span className="text-state-running-text font-bold">RUNNING</span>, <span className="text-state-success-text font-bold">SUCCESS</span>, <span className="text-state-failure-text font-bold">FAILURE</span>) in real time!
            </p>
          </div>

          {/* Action Choice 1: Browse User XML */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".xml"
            className="hidden"
          />

          <div className="space-y-2.5 pt-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-between p-3.5 rounded-lg bg-accent-primary hover:bg-accent-hover text-white border border-accent-border transition-all shadow-md hover:shadow-lg cursor-pointer group active:scale-95"
            >
              <div className="flex items-center gap-3 text-left">
                <div className="p-2 bg-white/20 rounded-lg">
                  <FileCode className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Browse & Load Nav2 XML File</div>
                  <div className="text-[11px] text-white/80">Select your robot's custom navigation .xml tree</div>
                </div>
              </div>
              <span className="text-xs font-bold px-3 py-1 bg-white/20 rounded-lg">Load File</span>
            </button>

            {/* Action Choice 2: Load Standard Sample Tree */}
            <button
              onClick={handleLoadSample}
              className="w-full flex items-center justify-between p-3.5 rounded-lg bg-surface-secondary hover:bg-surface-hover text-text-primary border border-border-medium transition-all cursor-pointer group shadow-2xs active:scale-95"
            >
              <div className="flex items-center gap-3 text-left">
                <div className="p-2 bg-surface-primary rounded-lg border border-border-subtle shadow-2xs">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <div className="text-xs font-bold text-text-primary">Load Standard Nav2 Tree (Sample)</div>
                  <div className="text-[11px] text-text-muted">Instant setup with NavigateToPose with Replanning & Recovery</div>
                </div>
              </div>
              <span className="text-xs font-semibold px-3 py-1 bg-surface-primary text-text-secondary rounded-lg border border-border-subtle shadow-2xs">Load Sample</span>
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-surface-secondary px-6 py-3 border-t border-border-subtle flex items-center justify-between text-xs">
          <span className="text-text-muted text-[11px] flex items-center gap-1 font-sans font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-state-success-border" />
            Automatic Node ID & Name Matching
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-text-secondary hover:text-text-primary bg-surface-secondary hover:bg-surface-hover font-semibold transition-all cursor-pointer border border-border-medium shadow-2xs active:scale-95"
          >
            I'll Load Later
          </button>
        </div>
      </div>
    </div>
  );
};

