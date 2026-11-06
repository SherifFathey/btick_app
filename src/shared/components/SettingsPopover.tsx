import React, { useState, useEffect, useRef } from "react";
import {
  Settings,
  Sun,
  Moon,
  Palette,
  Activity,
  X,
  Smartphone,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import { LiveStatusDisplayMode } from "../../monitor/protocols/types";
import { ros2Service } from "../../monitor/services/ros2Service";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
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
  onOpenMobileAccess?: () => void;
  isConnected?: boolean;
}

export const SettingsPopover: React.FC<SettingsPopoverProps> = ({
  isOpen,
  onClose,
  liveStatusDisplayMode = "current",
  onLiveStatusDisplayModeChange,
  showLiveMonitoring = true,
  onOpenMobileAccess,
  isConnected = false,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredTheme);
  const resolvedTheme = getResolvedTheme(themeMode);
  const { isMobile } = useResponsiveLayout();
  const [copiedLanUrl, setCopiedLanUrl] = useState(false);

  const mobileUrl = ros2Service.getLanUrl();
  const lanIp = ros2Service.getLanIp();

  const handleCopyLanUrl = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(mobileUrl).then(() => {
        setCopiedLanUrl(true);
        setTimeout(() => setCopiedLanUrl(false), 2000);
      });
    }
  };

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

      {/* Section 2: Mobile Access (Only shown on Desktop/Tablet, hidden on mobile) */}
      {!isMobile && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-text-muted uppercase tracking-wider font-mono">
              <Smartphone className="w-3 h-3 text-accent-primary" />
              <span>Mobile & Network Access</span>
            </div>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${
                isConnected
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}
              />
              <span>{isConnected ? "WS Live" : "Offline"}</span>
            </span>
          </div>

          <div className="bg-surface-secondary/70 border border-border-subtle rounded-xl p-2.5 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-text-primary">LAN Link</span>
              <span className="font-mono text-[10px] text-text-muted">
                {lanIp}
              </span>
            </div>

            <div className="flex items-center gap-1.5 bg-surface-primary border border-border-subtle rounded-lg px-2 py-1">
              <span className="font-mono text-[11px] text-accent-primary font-semibold truncate flex-1 select-all">
                {mobileUrl}
              </span>
              <button
                type="button"
                onClick={handleCopyLanUrl}
                className="p-1 rounded bg-surface-secondary hover:bg-surface-hover border border-border-subtle text-text-muted hover:text-text-primary transition-all cursor-pointer active:scale-95 shrink-0"
                title="Copy Mobile Access URL"
              >
                {copiedLanUrl ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenMobileAccess?.();
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1 px-2.5 rounded-lg border border-border-medium bg-surface-primary hover:bg-surface-hover text-text-primary text-[11px] font-semibold transition-all cursor-pointer shadow-2xs active:scale-95"
            >
              <ExternalLink className="w-3 h-3 text-accent-primary" />
              <span>Full Details & QR Code</span>
            </button>
          </div>
        </div>
      )}

      {/* Section 3: Live Monitoring */}
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
