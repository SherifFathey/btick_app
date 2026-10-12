import React, { useState, useEffect, useRef } from "react";
import { Settings, Sun, Moon, Palette, Activity, X } from "lucide-react";
import { LiveStatusDisplayMode } from "../../monitor/protocols/types";
import {
  getStoredTheme,
  setStoredTheme,
  getResolvedTheme,
  ThemeMode,
} from "../utils/theme";

export interface SettingsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  liveStatusDisplayMode?: LiveStatusDisplayMode;
  onLiveStatusDisplayModeChange?: (mode: LiveStatusDisplayMode) => void;
  showLiveMonitoring?: boolean;
}

export const SettingsPopover: React.FC<SettingsPopoverProps> = ({
  isOpen,
  onClose,
  liveStatusDisplayMode = "current",
  onLiveStatusDisplayModeChange,
  showLiveMonitoring = true,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredTheme);
  const resolvedTheme = getResolvedTheme(themeMode);

  useEffect(() => {
    if (isOpen) {
      setThemeMode(getStoredTheme());
    }
  }, [isOpen]);

  const handleSelectTheme = (mode: ThemeMode) => {
    setStoredTheme(mode);
    setThemeMode(mode);
  };

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | PointerEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handleClickOutside, true);
    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("touchstart", handleClickOutside, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handleClickOutside, true);
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("touchstart", handleClickOutside, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-1.5 w-80 bg-surface-primary border border-border-medium rounded-2xl shadow-xl p-4 space-y-4 font-sans text-xs text-text-primary z-50 animate-in fade-in slide-in-from-top-2 select-text whitespace-normal"
      role="dialog"
      aria-label="Settings"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-accent-primary shrink-0" />
          <span className="font-bold text-xs uppercase tracking-wide font-mono text-text-primary">
            Settings
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded-lg transition-all cursor-pointer"
          title="Close Settings"
          aria-label="Close Settings"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Section 1: Appearance */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-text-muted uppercase tracking-wider font-mono">
          <Palette className="w-3 h-3 text-accent-primary" />
          <span>Appearance</span>
        </div>
        <div className="bg-surface-secondary/70 border border-border-subtle rounded-xl p-2.5 space-y-2">
          <div>
            <div className="font-semibold text-xs text-text-primary">Theme</div>
            <div className="text-[10px] text-text-muted">
              Choose between light and dark mode
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() => handleSelectTheme("dark")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                resolvedTheme === "dark"
                  ? "bg-accent-primary text-white border-accent-border shadow-xs"
                  : "bg-surface-primary hover:bg-surface-hover text-text-secondary hover:text-text-primary border-border-subtle"
              }`}
            >
              <Moon className="w-3.5 h-3.5 shrink-0" />
              <span>Dark</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectTheme("light")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                resolvedTheme === "light"
                  ? "bg-accent-primary text-white border-accent-border shadow-xs"
                  : "bg-surface-primary hover:bg-surface-hover text-text-secondary hover:text-text-primary border-border-subtle"
              }`}
            >
              <Sun className="w-3.5 h-3.5 shrink-0" />
              <span>Light</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 2: Live Monitoring */}
      {showLiveMonitoring && (
        <div className="space-y-2">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-text-muted uppercase tracking-wider font-mono">
              <Activity className="w-3 h-3 text-accent-primary" />
              <span>LIVE MONITORING</span>
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              Only available with the BTick protocol.
            </div>
          </div>
          <div className="bg-surface-secondary/70 border border-border-subtle rounded-xl p-2.5 space-y-2.5">
            <div>
              <div className="font-semibold text-xs text-text-primary">
                Live Status
              </div>
              <div className="text-[10px] text-text-muted leading-tight">
                Choose how execution status is reset during live monitoring.
              </div>
            </div>
            <div className="flex flex-col gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => onLiveStatusDisplayModeChange?.("current")}
                disabled={!onLiveStatusDisplayModeChange}
                className={`w-full flex flex-col items-start p-2.5 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-50 min-w-0 ${
                  liveStatusDisplayMode === "current"
                    ? "bg-accent-primary text-white border-accent-border shadow-xs"
                    : "bg-surface-primary hover:bg-surface-hover text-text-secondary hover:text-text-primary border-border-subtle"
                }`}
              >
                <span className="text-xs font-semibold leading-snug">
                  Current Tick
                </span>
                <span
                  className={`text-[10.5px] mt-0.5 leading-normal break-words whitespace-normal ${
                    liveStatusDisplayMode === "current"
                      ? "text-white/80"
                      : "text-text-muted"
                  }`}
                >
                  Reset status at the start of each new tick.
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onLiveStatusDisplayModeChange?.("parent_retick_reset")
                }
                disabled={!onLiveStatusDisplayModeChange}
                className={`w-full flex flex-col items-start p-2.5 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-50 min-w-0 ${
                  liveStatusDisplayMode === "parent_retick_reset"
                    ? "bg-accent-primary text-white border-accent-border shadow-xs"
                    : "bg-surface-primary hover:bg-surface-hover text-text-secondary hover:text-text-primary border-border-subtle"
                }`}
              >
                <span className="text-xs font-semibold leading-snug">
                  Parent Re-tick
                </span>
                <span
                  className={`text-[10.5px] mt-0.5 leading-normal break-words whitespace-normal ${
                    liveStatusDisplayMode === "parent_retick_reset"
                      ? "text-white/80"
                      : "text-text-muted"
                  }`}
                >
                  Reset status when a parent node is re-ticked.
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
