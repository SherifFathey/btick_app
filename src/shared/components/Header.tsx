import React, { useState, useRef } from "react";
import {
  Square,
  Download,
  FolderOpen,
  FileCode,
  Film,
  Settings,
  FileEdit,
  FilePlus,
  Undo2,
  Redo2,
  Code2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import treeLogo from "../../assets/tree.png";
import { RecordingSession, ViewMode } from "../../monitor/types/bt";
import {
  LiveStatusDisplayMode,
  ProtocolConnectionStatus,
  ENABLE_LIVE_SESSION_RECORDING,
} from "../../monitor/protocols/types";
import { normalizeRecordingSession } from "../../monitor/protocols/session/sessionManager";
import { ValidationIssue } from "../../editor/types";
import { AppMode } from "../types";
import { SettingsPopover } from "./SettingsPopover";

interface HeaderProps {
  appMode?: AppMode;
  onModeChange?: (mode: AppMode) => void;
  isConnected: boolean;
  connectionStatus?: ProtocolConnectionStatus;
  protocolStatuses?: Record<
    "btick" | "groot2" | "nav2",
    ProtocolConnectionStatus
  >;
  activeProtocol?: "btick" | "groot2" | "nav2";
  treesList?: Array<{ tree_id: string }>;
  selectedTreeId?: string | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isRecording: boolean;
  onStartRecording: (treeId?: string) => void;
  onStopRecording: (treeId?: string) => void;
  onSaveSession: () => void;
  onLoadSession: (session: RecordingSession) => void;
  onLoadTreeXml?: (xmlContent: string, fileName: string) => void;
  onSwitchSource?: (
    source: "btick" | "groot2" | "nav2",
    host?: string,
    port?: number,
    topic?: string,
  ) => void;
  onOpenNav2Prompt?: () => void;
  onDisconnect?: () => void;
  isReplaying?: boolean;
  hasRecordedSession?: boolean;
  recordedEventsCount?: number;
  onSwitchToLive?: () => void;
  onSwitchToRecorded?: () => void;
  liveStatusDisplayMode?: LiveStatusDisplayMode;
  onLiveStatusDisplayModeChange?: (mode: LiveStatusDisplayMode) => void;

  // Editor toolbar props
  editorTreesList?: string[];
  editorActiveTreeId?: string;
  onEditorSelectTree?: (treeId: string) => void;
  editorCanUndo?: boolean;
  editorCanRedo?: boolean;
  onEditorUndo?: () => void;
  onEditorRedo?: () => void;
  onEditorNew?: () => void;
  onEditorOpen?: (xmlContent: string, fileName?: string) => void;
  onEditorSave?: () => void;
  editorIsDirty?: boolean;
  onEditorOpenRawXmlModal?: () => void;
  editorValidationIssues?: ValidationIssue[];
  onEditorOpenValidationModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  appMode = "monitor",
  onModeChange,
  isConnected = false,
  connectionStatus = "DISCONNECTED",
  protocolStatuses,
  activeProtocol = "btick",
  treesList = [],
  selectedTreeId,
  viewMode,
  onViewModeChange,
  isRecording,
  onStartRecording,
  onStopRecording,
  onSaveSession,
  onLoadSession,
  onLoadTreeXml,
  onSwitchSource,
  onOpenNav2Prompt,
  onDisconnect,
  isReplaying = false,
  hasRecordedSession = false,
  recordedEventsCount = 0,
  onSwitchToLive,
  onSwitchToRecorded,
  liveStatusDisplayMode = "current",
  onLiveStatusDisplayModeChange,

  // Editor toolbar props
  editorTreesList = [],
  editorActiveTreeId,
  onEditorSelectTree,
  editorCanUndo = false,
  editorCanRedo = false,
  onEditorUndo,
  onEditorRedo,
  onEditorNew,
  onEditorOpen,
  onEditorSave,
  editorIsDirty = false,
  onEditorOpenRawXmlModal,
  editorValidationIssues = [],
  onEditorOpenValidationModal,
}) => {
  const sessionInputRef = useRef<HTMLInputElement>(null);
  const xmlFileInputRef = useRef<HTMLInputElement>(null);
  const editorFileInputRef = useRef<HTMLInputElement>(null);

  const handleEditorFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content && onEditorOpen) {
          onEditorOpen(content, file.name);
        }
      };
      reader.readAsText(file);
    }
    e.target.value = "";
  };

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleSessionFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const sessionData = JSON.parse(event.target?.result as string);
          const session = normalizeRecordingSession(sessionData);
          if (!session) {
            throw new Error("Invalid session recording format");
          }
          onLoadSession(session);
        } catch (err) {
          console.error("Error loading session file:", err);
          alert("Failed to parse session recording file.");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    }
  };

  const handleXmlFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content && onLoadTreeXml) {
          onLoadTreeXml(content, file.name);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    }
  };

  return (
    <header className="h-[44px] bg-surface-primary border-b border-border-subtle px-3 flex items-center justify-between gap-2.5 select-text whitespace-nowrap overflow-visible relative font-sans z-40">
      {/* Left: App Branding */}
      <div className="flex items-center gap-2 justify-start min-w-0 shrink-0">
        <div className="flex items-center gap-2 shrink-0 pr-1">
          <img
            src={treeLogo}
            alt="BTick"
            className="w-5 h-5 object-contain opacity-90 shrink-0 dark:brightness-0 dark:invert dark:opacity-100"
          />
          <h1 className="text-xs font-bold text-text-primary tracking-wide font-mono uppercase whitespace-nowrap shrink-0">
            BTICK
          </h1>
          {appMode === "editor" && editorTreesList.length > 0 && (
            <label className="flex items-center gap-1 text-[10px] text-text-muted">
              <span>Trees:</span>
              <select
                value={editorActiveTreeId || editorTreesList[0]}
                onChange={(event) => onEditorSelectTree?.(event.target.value)}
                className="max-w-[150px] rounded-md border border-border-medium bg-surface-primary px-1.5 py-1 text-[10px] text-text-primary"
                aria-label="Select behavior tree"
              >
                {editorTreesList.map((treeId) => (
                  <option key={treeId} value={treeId}>
                    {treeId}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Center: LIVE vs RECORDED (REPLAY) Mode Switcher in Monitor OR File Ops / Undo / Redo in Editor */}
      <div className="flex items-center justify-center shrink-0">
        {appMode === "monitor" && hasRecordedSession && (
          <div className="flex items-center bg-surface-tertiary p-0.5 rounded-lg border border-border-subtle text-xs font-semibold whitespace-nowrap shrink-0 shadow-2xs">
            <button
              onClick={onSwitchToLive}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                !isReplaying
                  ? "bg-rose-600 text-white font-bold shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              }`}
              title="Switch to Live Monitoring Mode"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${!isReplaying ? "bg-white animate-pulse" : "bg-rose-500"}`}
              />
              <span className="whitespace-nowrap">LIVE</span>
            </button>

            <button
              onClick={onSwitchToRecorded}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                isReplaying
                  ? "bg-accent-primary text-white font-bold shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover font-bold"
              }`}
              title="Switch to Recorded Replay Mode"
            >
              <Film className="w-3 h-3 shrink-0" />
              <span className="whitespace-nowrap">REPLAY</span>
              {recordedEventsCount > 0 && (
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.2 rounded-md ${
                    isReplaying
                      ? "bg-white/20 text-white"
                      : "bg-surface-secondary text-text-muted border border-border-subtle"
                  }`}
                >
                  {recordedEventsCount}
                </span>
              )}
            </button>
          </div>
        )}

        {appMode === "editor" && (
          <div className="flex items-center gap-2 shrink-0">
            {/* File Operations Container Box */}
          </div>
        )}
      </div>

      {/* Right Actions: Load Tree, Record, Save, Load Session, Theme Toggle Switch */}
      <div className="flex items-center justify-end gap-1.5 shrink-0 whitespace-nowrap">
        {appMode === "monitor" && (
          <>
            {/* Load Tree XML, Record, Save, Load Session in a distinct container box */}
            <div className="flex items-center gap-1 bg-surface-secondary/70 rounded-xl p-0.5 px-1">
              {!isRecording ? (
                <button
                  onClick={() => onStartRecording(selectedTreeId || undefined)}
                  className="h-7 flex items-center gap-1.5 bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-2xs hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400 active:scale-95"
                  title="Start recording execution events"
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                  <span className="whitespace-nowrap">Record</span>
                </button>
              ) : (
                <button
                  onClick={() => onStopRecording(selectedTreeId || undefined)}
                  className="h-7 flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-2.5 rounded-lg text-xs font-bold animate-pulse transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-md active:scale-95"
                  title="Stop recording and save session"
                >
                  <Square className="w-3 h-3 fill-current shrink-0" />
                  <span className="whitespace-nowrap">Stop</span>
                </button>
              )}

              {ENABLE_LIVE_SESSION_RECORDING && (
                <button
                  onClick={onSaveSession}
                  className="h-7 flex items-center gap-1.5 bg-surface-primary hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border-medium px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-2xs hover:border-border-strong active:scale-95"
                  title="Save Session"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span className="whitespace-nowrap">Save</span>
                </button>
              )}

              <input
                type="file"
                ref={sessionInputRef}
                onChange={handleSessionFile}
                accept=".json"
                className="hidden"
              />
              <button
                onClick={() => sessionInputRef.current?.click()}
                className="h-7 flex items-center gap-1.5 bg-surface-primary hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border-medium px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 shadow-2xs hover:border-border-strong active:scale-95"
                title="Load session recording"
              >
                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">Load</span>
              </button>
            </div>
          </>
        )}

        {appMode === "editor" && (
          <div className="flex items-center gap-1.5 ">
            {/* Tree Validation Status Button */}

            <button
              onClick={onEditorNew}
              className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
              title="Create New Behavior Tree Document"
            >
              <FilePlus className="w-3.5 h-3.5 text-accent-primary shrink-0" />
              <span>New</span>
            </button>

            <input
              type="file"
              ref={editorFileInputRef}
              onChange={handleEditorFileChange}
              accept=".xml"
              className="hidden"
            />
            <button
              onClick={() => editorFileInputRef.current?.click()}
              className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
              title="Open Behavior Tree XML File"
            >
              <FolderOpen className="w-3.5 h-3.5 text-accent-primary shrink-0" />
              <span>Open</span>
            </button>
            {(() => {
              const activeTreeIssues = (editorValidationIssues || []).filter(
                (issue) => !issue.treeId || issue.treeId === editorActiveTreeId,
              );
              const errorCount = activeTreeIssues.filter(
                (i) => i.severity === "error",
              ).length;
              const warningCount = activeTreeIssues.filter(
                (i) => i.severity === "warning",
              ).length;

              if (errorCount > 0) {
                return (
                  <button
                    onClick={onEditorOpenValidationModal}
                    className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-400 border border-rose-500/40 transition-all cursor-pointer shadow-2xs active:scale-95 animate-pulse"
                    title={`Tree has ${errorCount} error(s) and ${warningCount} warning(s). Click to view issues.`}
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                    <span>{`${errorCount} ${errorCount === 1 ? "Error" : "Errors"}`}</span>
                    {warningCount > 0 && (
                      <span className="opacity-80">({warningCount}w)</span>
                    )}
                  </button>
                );
              }

              if (warningCount > 0) {
                return (
                  <button
                    onClick={onEditorOpenValidationModal}
                    className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 border border-amber-500/40 transition-all cursor-pointer shadow-2xs active:scale-95"
                    title={`Tree has ${warningCount} warning(s). Click to view issues.`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>{`${warningCount} ${warningCount === 1 ? "Warning" : "Warnings"}`}</span>
                  </button>
                );
              }

              return (
                <button
                  onClick={onEditorOpenValidationModal}
                  className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40 transition-all cursor-pointer shadow-2xs active:scale-95"
                  title="Tree is valid. No errors or warnings detected. Click to view rules."
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Tree Valid</span>
                </button>
              );
            })()}

            <button
              onClick={onEditorSave}
              className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
              title="Download XML File"
            >
              <Download className="w-3.5 h-3.5 text-accent-primary shrink-0" />
              <span>Download</span>
              {editorIsDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent-primary shrink-0" />
              )}
            </button>

            {/* View Raw XML */}
            <button
              onClick={onEditorOpenRawXmlModal}
              className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-xs font-semibold bg-surface-primary hover:bg-surface-hover text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
              title="View and copy generated BehaviorTree.CPP XML"
            >
              <Code2 className="w-3.5 h-3.5 text-accent-primary shrink-0" />
              <span>XML</span>
            </button>
            {/* Undo / Redo Container Box */}
            <div className="flex items-center gap-1 ">
              <button
                onClick={onEditorUndo}
                disabled={!editorCanUndo}
                className="h-7 p-1.5 rounded-lg text-xs bg-surface-primary hover:bg-surface-hover disabled:opacity-30 text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onEditorRedo}
                disabled={!editorCanRedo}
                className="h-7 p-1.5 rounded-lg text-xs bg-surface-primary hover:bg-surface-hover disabled:opacity-30 text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Settings Button & Popover */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => setIsSettingsOpen((prev) => !prev)}
            className={`h-7 w-7 flex items-center justify-center rounded-lg border transition-all cursor-pointer shadow-2xs active:scale-95 ${
              isSettingsOpen
                ? "bg-accent-primary text-white border-accent-border shadow-sm"
                : "bg-surface-primary hover:bg-surface-hover text-text-secondary hover:text-text-primary border-border-medium hover:border-border-strong"
            }`}
            title="Settings"
            aria-label="Settings"
            aria-expanded={isSettingsOpen}
          >
            <Settings
              className={`w-3.5 h-3.5 ${isSettingsOpen ? "text-white" : "text-text-secondary"} shrink-0`}
            />
          </button>

          <SettingsPopover
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            liveStatusDisplayMode={liveStatusDisplayMode}
            onLiveStatusDisplayModeChange={onLiveStatusDisplayModeChange}
            showLiveMonitoring={
              appMode === "monitor" &&
              Boolean(onLiveStatusDisplayModeChange || liveStatusDisplayMode)
            }
          />
        </div>
      </div>
    </header>
  );
};
