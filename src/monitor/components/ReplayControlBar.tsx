import React, { useState, useRef, useEffect } from "react";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Film,
  Gauge,
  Download,
} from "lucide-react";
import { useResponsiveLayout } from "../../shared/hooks/useResponsiveLayout";
import { ReplayState } from "../types/bt";

interface ReplayControlBarProps {
  replayState: ReplayState;
  onPlay: () => void;
  onPause: () => void;
  onClearRecording: () => void;
  onStepForward: () => void;
  onStepBack: () => void;
  onSeek: (replayTime: number) => void;
  onSpeedChange: (speed: number) => void;
  onSaveSession?: () => void;
}

export const ReplayControlBar: React.FC<ReplayControlBarProps> = ({
  replayState,
  onPlay,
  onPause,
  onClearRecording,
  onStepForward,
  onStepBack,
  onSeek,
  onSpeedChange,
  onSaveSession,
}) => {
  const { isMobile, isTablet } = useResponsiveLayout();
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const pendingSeekRafRef = useRef<number | null>(null);
  const pendingSeekTimeRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pendingSeekRafRef.current !== null) {
        cancelAnimationFrame(pendingSeekRafRef.current);
        pendingSeekRafRef.current = null;
      }
    };
  }, []);

  const { session, currentIndex, isPlaying, speed } = replayState;
  if (!session) return null;

  const totalEvents = session.events.length;
  const firstTimestamp =
    totalEvents > 0 ? Number(session.events[0].timestamp) : undefined;
  const lastTimestamp =
    totalEvents > 0
      ? Number(session.events[totalEvents - 1].timestamp)
      : undefined;
  const totalDurationMs =
    firstTimestamp !== undefined &&
    lastTimestamp !== undefined &&
    Number.isFinite(firstTimestamp) &&
    Number.isFinite(lastTimestamp)
      ? Math.max(0, (lastTimestamp - firstTimestamp) * 1000)
      : 0;

  const currentReplayTimeMs =
    replayState.replayTime !== undefined
      ? Math.min(totalDurationMs, Math.max(0, replayState.replayTime))
      : currentIndex >= 0 &&
          session.events[currentIndex] &&
          firstTimestamp !== undefined &&
          Number.isFinite(firstTimestamp)
        ? Math.max(
            0,
            (Number(session.events[currentIndex].timestamp) - firstTimestamp) *
              1000,
          )
        : 0;

  const formatDuration = (milliseconds: number) => {
    const totalCentiseconds = Math.max(0, Math.round(milliseconds / 10));
    const centiseconds = totalCentiseconds % 100;
    const totalSeconds = Math.floor(totalCentiseconds / 100);
    const displaySeconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const displayMinutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    const suffix = `${displaySeconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
    return hours > 0
      ? `${hours.toString().padStart(2, "0")}:${displayMinutes.toString().padStart(2, "0")}:${suffix}`
      : totalMinutes > 0
        ? `${displayMinutes.toString().padStart(2, "0")}:${suffix}`
        : suffix;
  };
  const sliderValue =
    totalDurationMs > 0
      ? Math.round((currentReplayTimeMs / totalDurationMs) * 1000)
      : 0;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = parseInt(e.target.value, 10);
    const targetTimeMs = (rawVal / 1000) * totalDurationMs;
    pendingSeekTimeRef.current = targetTimeMs;

    if (pendingSeekRafRef.current === null) {
      pendingSeekRafRef.current = requestAnimationFrame(() => {
        pendingSeekRafRef.current = null;
        if (pendingSeekTimeRef.current !== null) {
          onSeek(pendingSeekTimeRef.current);
          pendingSeekTimeRef.current = null;
        }
      });
    }
  };

  if (isMobile) {
    return (
      <div className="bg-surface-primary border-t border-border-medium px-3 py-2 flex flex-col gap-2 text-xs text-text-primary z-30 font-sans select-text shrink-0 shadow-lg">
        {/* Row 1: Timeline Scrubber & Speed Selector */}
        <div className="flex items-center gap-2 w-full">
          <span className="text-[10px] font-mono font-semibold text-text-muted shrink-0 w-12 text-right">
            {formatDuration(currentReplayTimeMs)}
          </span>
          <div className="flex-1 min-w-0">
            <input
              type="range"
              min="0"
              max="1000"
              value={sliderValue}
              onChange={handleSliderChange}
              className="w-full h-2 bg-surface-secondary border border-border-medium rounded-lg appearance-none accent-accent-primary cursor-pointer touch-none"
            />
          </div>
          <span className="text-[10px] font-mono font-semibold text-text-muted shrink-0 w-12">
            {formatDuration(totalDurationMs)}
          </span>
          <div className="flex items-center gap-1 bg-surface-secondary px-2 py-0.5 rounded-lg border border-border-subtle text-[10px] shrink-0">
            <Gauge className="w-3 h-3 text-text-muted" />
            <select
              value={speed}
              onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
              className="bg-transparent text-accent-primary font-bold outline-none cursor-pointer"
            >
              <option value={0.25}>0.25x</option>
              <option value={0.5}>0.5x</option>
              <option value={1.0}>1x</option>
              <option value={2.0}>2x</option>
              <option value={4.0}>4x</option>
              <option value={8.0}>8x</option>
            </select>
          </div>
        </div>

        {/* Row 2: Info & Playback Controls */}
        <div className="flex items-center justify-between gap-1 w-full">
          {/* Session / Event Counter */}
          <div className="flex items-center gap-1 font-mono text-[11px] truncate min-w-0 max-w-[120px]">
            <Film className="w-3.5 h-3.5 text-accent-primary shrink-0" />
            <span className="text-text-muted truncate">
              {currentIndex + 1}/{totalEvents}
            </span>
          </div>

          {/* Center Playback Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onStepBack}
              disabled={currentIndex <= 0}
              className="p-1.5 rounded-lg bg-surface-secondary hover:bg-surface-hover disabled:opacity-30 text-text-primary border border-border-medium transition-all active:scale-95"
              title="Step backward"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>

            {isPlaying ? (
              <button
                onClick={onPause}
                className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg border border-amber-600 font-bold text-xs shadow-xs active:scale-95"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </button>
            ) : (
              <button
                onClick={onPlay}
                className="flex items-center gap-1.5 bg-accent-primary hover:bg-accent-hover text-white px-3 py-1.5 rounded-lg border border-accent-border font-bold text-xs shadow-xs active:scale-95"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Play</span>
              </button>
            )}

            <button
              onClick={onStepForward}
              disabled={currentIndex >= totalEvents - 1}
              className="p-1.5 rounded-lg bg-surface-secondary hover:bg-surface-hover disabled:opacity-30 text-text-primary border border-border-medium transition-all active:scale-95"
              title="Step forward"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Actions (Save / Remove) */}
          <div className="flex items-center gap-1 shrink-0">
            {replayState.replaySource === "record" && onSaveSession && (
              <button
                onClick={onSaveSession}
                className="p-1.5 rounded-lg bg-accent-primary hover:bg-accent-hover text-white border border-accent-border transition-all active:scale-95"
                title="Save recording"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={() => setIsConfirmingClear(true)}
              className="p-1.5 rounded-lg bg-surface-secondary hover:bg-rose-50 text-rose-600 dark:text-rose-400 border border-border-medium transition-all active:scale-95"
              title="Exit / Remove Record"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          </div>
        </div>

        {/* Clear Confirmation Modal */}
        {isConfirmingClear && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
              role="dialog"
              aria-modal="true"
              className="rounded-2xl border border-border-medium bg-surface-primary p-4 shadow-xl max-w-xs w-full"
            >
              <p className="mb-4 text-xs font-semibold text-text-primary">
                Are you sure you want to stop and remove the current replay
                session?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmingClear(false)}
                  className="rounded-lg border border-border-medium px-3 py-1.5 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onClearRecording}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-[56px] bg-surface-primary border-t border-border-subtle px-3 flex items-center justify-between text-xs text-text-primary z-30 font-sans select-text shrink-0 gap-2">
      {/* Session Title Info Container Box */}
      <div className="flex items-center gap-2 font-mono bg-surface-secondary/70 shrink-0">
        <Film className="w-4 h-4 text-accent-primary shrink-0" />
        <span className="font-bold text-text-primary text-xs">Replay:</span>
        <span className="text-accent-primary font-bold truncate max-w-[170px]">
          {session.name || "session.json"}
        </span>
        <span className="text-text-muted text-[10px]">
          ({currentIndex + 1}/{totalEvents} evts)
        </span>
      </div>

      {/* Center Playback Controls Container Box */}
      <div className="flex items-center gap-1 bg-surface-secondary/70 shrink-0">
        <button
          onClick={onStepBack}
          disabled={currentIndex <= 0}
          className="p-1.5 rounded-lg bg-surface-primary hover:bg-surface-hover disabled:opacity-30 text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
          title="Step backward"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>

        {isPlaying ? (
          <button
            onClick={onPause}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded-lg border border-amber-600 font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>Pause</span>
          </button>
        ) : (
          <button
            onClick={onPlay}
            className="flex items-center gap-1.5 bg-accent-primary hover:bg-accent-hover text-white px-3 py-1 rounded-lg border border-accent-border font-bold text-xs shadow-xs transition-all cursor-pointer active:scale-95"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Play</span>
          </button>
        )}

        <button
          onClick={onStepForward}
          disabled={currentIndex >= totalEvents - 1}
          className="p-1.5 rounded-lg bg-surface-primary hover:bg-surface-hover disabled:opacity-30 text-text-primary border border-border-medium hover:border-border-strong transition-all cursor-pointer shadow-2xs active:scale-95"
          title="Step forward"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-px bg-border-medium mx-0.5" />

        <button
          onClick={() => setIsConfirmingClear(true)}
          className="flex items-center gap-1 bg-surface-primary hover:bg-rose-50 dark:hover:bg-rose-950 text-rose-600 dark:text-rose-400 border border-border-medium hover:border-rose-300 dark:hover:border-rose-800 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs active:scale-95"
          title="Remove record"
        >
          <span>Remove Record</span>
        </button>
      </div>
      {isConfirmingClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            className="rounded-2xl border border-border-medium bg-surface-primary p-4 shadow-xl"
          >
            <p className="mb-4 text-sm text-text-primary">
              Are you sure you want to remove the current record?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmingClear(false)}
                className="rounded-lg border border-border-medium px-3 py-1.5 text-xs"
              >
                No
              </button>
              <button
                type="button"
                onClick={onClearRecording}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrub Bar, Speed Selector & Download Session Container Box */}

      <div className="flex items-center gap-2 bg-surface-secondary/70 shrink-0">
        {/* Current Replay Time */}
        <span className="text-[9px] font-mono text-text-muted whitespace-nowrap">
          {formatDuration(currentReplayTimeMs)}
        </span>

        {/* Scrubber */}
        <div className="w-28 sm:w-32">
          <input
            type="range"
            min="0"
            max="1000"
            value={sliderValue}
            onChange={handleSliderChange}
            className="w-full h-1.5 bg-surface-primary border border-border-medium rounded-lg appearance-none accent-accent-primary cursor-pointer"
          />
        </div>

        {/* Total Replay Time */}
        <span className="text-[9px] font-mono text-text-muted whitespace-nowrap">
          {formatDuration(totalDurationMs)}
        </span>

        {/* Speed Dropdown */}
        <div className="flex items-center gap-1 bg-surface-primary px-2 py-0.5 rounded-lg border border-border-medium text-[10px] shadow-2xs">
          <Gauge className="w-3 h-3 text-text-muted" />

          <select
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="bg-transparent text-accent-primary font-bold outline-none cursor-pointer"
          >
            <option
              value={0.25}
              className="bg-surface-primary text-text-primary"
            >
              0.25x
            </option>
            <option
              value={0.5}
              className="bg-surface-primary text-text-primary"
            >
              0.5x
            </option>
            <option
              value={1.0}
              className="bg-surface-primary text-text-primary"
            >
              1x
            </option>
            <option
              value={2.0}
              className="bg-surface-primary text-text-primary"
            >
              2x
            </option>
            <option
              value={4.0}
              className="bg-surface-primary text-text-primary"
            >
              4x
            </option>
            <option
              value={8.0}
              className="bg-surface-primary text-text-primary"
            >
              8x
            </option>
          </select>
        </div>

        {/* Save Recording */}
        {replayState.replaySource === "record" && onSaveSession && (
          <button
            onClick={onSaveSession}
            className="flex items-center gap-1 bg-accent-primary hover:bg-accent-hover text-white px-2.5 py-1 rounded-lg border border-accent-border text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95"
            title="Download / Save this recorded session JSON file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
        )}
      </div>
    </div>
  );
};
