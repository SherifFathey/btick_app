import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

export interface DelayInputControlProps {
  value: number; // Duration in milliseconds
  onChange: (valMs: number) => void;
  onApply?: () => void;
  onCancel?: () => void;
  applyLabel?: string;
  cancelLabel?: string;
}

export const DelayInputControl: React.FC<DelayInputControlProps> = ({
  value,
  onChange,
  onApply,
  onCancel,
  applyLabel,
  cancelLabel,
}) => {
  const [unit, setUnit] = useState<'ms' | 's'>('ms');
  const [textValue, setTextValue] = useState<string>(String(value));

  // Keep local text input in sync when external value changes
  useEffect(() => {
    if (unit === 'ms') {
      setTextValue(String(value));
    } else {
      const sec = value / 1000;
      setTextValue(String(Number(sec.toFixed(3))));
    }
  }, [value, unit]);

  const handleUnitToggle = (newUnit: 'ms' | 's') => {
    if (newUnit === unit) return;
    setUnit(newUnit);
    if (newUnit === 's') {
      const sec = value / 1000;
      setTextValue(String(Number(sec.toFixed(3))));
    } else {
      setTextValue(String(value));
    }
  };

  const handleTextChange = (raw: string) => {
    setTextValue(raw);
    if (raw.trim() === '') return;

    if (unit === 'ms') {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        onChange(parsed);
      }
    } else {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed >= 0) {
        onChange(Math.round(parsed * 1000));
      }
    }
  };

  const handleSliderChange = (newMs: number) => {
    onChange(newMs);
    if (unit === 'ms') {
      setTextValue(String(newMs));
    } else {
      setTextValue(String(Number((newMs / 1000).toFixed(3))));
    }
  };

  const handlePresetSelect = (presetMs: number) => {
    onChange(presetMs);
    if (unit === 'ms') {
      setTextValue(String(presetMs));
    } else {
      setTextValue(String(Number((presetMs / 1000).toFixed(3))));
    }
  };

  const displaySummary = () => {
    if (value >= 1000) {
      const sec = Number((value / 1000).toFixed(3));
      return `${sec}s (${value}ms)`;
    }
    return `${value}ms`;
  };

  return (
    <div className="space-y-2 select-text">
      {/* Header: Label & Formatted Summary */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-text-muted flex items-center gap-1 font-semibold">
          <Clock className="w-3 h-3 text-text-muted shrink-0" />
          <span>Delay Duration</span>
        </span>
        <span className="font-mono text-text-primary font-bold text-[10px]">
          {displaySummary()}
        </span>
      </div>

      {/* Custom Duration Input Field with Unit Toggle (ms / s) */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <input
            type="number"
            min={unit === 's' ? '0.05' : '50'}
            step={unit === 's' ? '0.1' : '100'}
            value={textValue}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onApply) {
                onApply();
              }
            }}
            placeholder={unit === 's' ? 'e.g. 2.5' : 'e.g. 2500'}
            className="w-full bg-surface-secondary border border-border-medium focus:border-border-strong rounded-lg px-2.5 py-1 text-xs font-mono text-text-primary outline-none transition-colors"
          />
        </div>

        {/* Unit Selector: ms / s */}
        <div className="flex rounded-lg bg-surface-secondary border border-border-subtle p-0.5 shrink-0 text-[10px] font-mono">
          <button
            type="button"
            onClick={() => handleUnitToggle('ms')}
            className={`px-2 py-0.5 rounded-md font-semibold transition-all cursor-pointer ${
              unit === 'ms'
                ? 'bg-surface-active text-text-primary border border-border-strong shadow-2xs font-bold'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="Milliseconds (ms)"
          >
            ms
          </button>
          <button
            type="button"
            onClick={() => handleUnitToggle('s')}
            className={`px-2 py-0.5 rounded-md font-semibold transition-all cursor-pointer ${
              unit === 's'
                ? 'bg-surface-active text-text-primary border border-border-strong shadow-2xs font-bold'
                : 'text-text-secondary hover:text-text-primary'
            }`}
            title="Seconds (s)"
          >
            s
          </button>
        </div>
      </div>

      {/* Range Slider (dynamically scales to accommodate large custom values) */}
      <input
        type="range"
        min="100"
        max={Math.max(10000, value)}
        step="100"
        value={value}
        onChange={(e) => handleSliderChange(Number(e.target.value))}
        className="w-full h-1.5 bg-surface-secondary rounded appearance-none cursor-pointer accent-border-strong"
      />

      {/* Quick Preset Buttons */}
      <div className="flex items-center gap-1">
        {[500, 1000, 2000, 5000, 10000].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => handlePresetSelect(preset)}
            className={`flex-1 py-1 text-[9px] font-mono rounded-lg border transition-all cursor-pointer active:scale-95 ${
              value === preset
                ? 'bg-surface-active border-border-strong text-text-primary font-bold shadow-xs'
                : 'bg-surface-secondary border-border-subtle text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            {preset >= 1000 ? `${preset / 1000}s` : `${preset}ms`}
          </button>
        ))}
      </div>

      {/* Action Buttons (Apply / Back) */}
      {(onApply || onCancel) && (
        <div className="flex items-center gap-1.5 pt-1">
          {onApply && (
            <button
              type="button"
              onClick={onApply}
              className="flex-1 py-1.5 rounded-lg bg-surface-active hover:bg-surface-hover text-text-primary font-bold text-[10px] transition-all cursor-pointer shadow-xs active:scale-95 border border-border-strong"
            >
              {applyLabel || `Apply Delay (${displaySummary()})`}
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-2.5 py-1.5 rounded-lg bg-surface-secondary hover:bg-surface-hover text-text-secondary hover:text-text-primary text-[10px] font-medium transition-all cursor-pointer shadow-2xs active:scale-95 border border-border-subtle"
            >
              {cancelLabel || 'Back'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
