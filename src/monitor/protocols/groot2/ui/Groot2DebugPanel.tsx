import React, { useState } from 'react';
import {
  Zap,
  Play,
  CheckCircle2,
  XCircle,
  RotateCcw
} from 'lucide-react';
import { BTNodeModel, BTTreeModel } from '../../../types/bt';

export interface Groot2DebugPanelProps {
  node: BTNodeModel;
  tree: BTTreeModel | null;
  onToggleBreakpoint?: (treeId: string, uid: number, once?: boolean) => void;
  onSetBreakpointOnce?: (treeId: string, uid: number, once: boolean) => void;
  onInjectFault?: (treeId: string, uid: number, mode: string, delayMs?: number, once?: boolean) => void;
  onSetFaultOnce?: (treeId: string, uid: number, once: boolean) => void;
  onClearFault?: (treeId: string, uid: number) => void;
  onResume?: (treeId?: string) => void;
  onForceSuccess?: (treeId?: string) => void;
  onForceFailure?: (treeId?: string) => void;
}

export const Groot2DebugPanel: React.FC<Groot2DebugPanelProps> = ({
  node,
  tree,
  onToggleBreakpoint,
  onSetBreakpointOnce,
  onInjectFault,
  onSetFaultOnce,
  onClearFault,
  onResume,
  onForceSuccess,
  onForceFailure,
}) => {
  const [breakpointOnce, setBreakpointOnce] = useState<boolean>(node.breakpoint_once || false);
  const [faultOnce, setFaultOnce] = useState<boolean>(node.fault_once || false);

  React.useEffect(() => {
    setBreakpointOnce(node.breakpoint_once || false);
  }, [node.breakpoint_once]);

  React.useEffect(() => {
    setFaultOnce(node.fault_once || false);
  }, [node.fault_once]);

  return (
    <div className="bg-surface-secondary/70 p-3.5 rounded-2xl border border-border-medium space-y-2.5 shadow-xs font-sans">
      <div className="flex items-center justify-between pb-1.5 border-b border-border-subtle/80">
        <h4 className="font-semibold text-xs text-text-primary flex items-center gap-1.5 uppercase tracking-wider font-mono">
          <Zap className="w-3.5 h-3.5 text-accent-primary dark:text-purple-400" />
          <span>Breakpoint & Fault Injection</span>
        </h4>
      </div>

      <div className="bg-surface-secondary p-3 rounded-xl border border-border-medium space-y-3 shadow-2xs">
        {/* If currently paused at breakpoint on this node */}
        {node.is_paused === true && (
          <div className="p-3 rounded-lg bg-state-paused-bg border border-state-paused-border space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-state-paused-border bt-pause-pulse inline-block" />
              <span className="text-[10px] font-bold text-state-paused-text uppercase font-mono">Node Execution Paused</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-0.5">
              <button
                onClick={() => {
                  const treeId = tree?.tree_id || 'MainTree';
                  onResume?.(treeId);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] cursor-pointer transition-all border border-emerald-700 shadow-xs active:scale-95"
                title="Continue real node execution"
              >
                <Play className="w-3.5 h-3.5 fill-current mb-0.5" />
                <span>Continue</span>
              </button>
              <button
                onClick={() => {
                  const treeId = tree?.tree_id || 'MainTree';
                  onForceSuccess?.(treeId);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-lg bg-surface-primary hover:bg-surface-hover text-text-primary font-semibold text-[10px] border border-border-medium cursor-pointer transition-all shadow-2xs active:scale-95"
                title="Force SUCCESS (Fault Injection)"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mb-0.5" />
                <span>Success</span>
              </button>
              <button
                onClick={() => {
                  const treeId = tree?.tree_id || 'MainTree';
                  onForceFailure?.(treeId);
                }}
                className="flex flex-col items-center justify-center p-2 rounded-lg bg-surface-primary hover:bg-surface-hover text-text-primary font-semibold text-[10px] border border-border-medium cursor-pointer transition-all shadow-2xs active:scale-95"
                title="Force FAILURE (Fault Injection)"
              >
                <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 mb-0.5" />
                <span>Failure</span>
              </button>
            </div>
          </div>
        )}

        {/* Breakpoint Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-text-primary font-semibold text-[11px] flex items-center gap-1 font-mono">
              Breakpoint
            </span>

            {/* Once toggle */}
            <div
              onClick={() => {
                const newOnce = !breakpointOnce;
                setBreakpointOnce(newOnce);
                const treeId = tree?.tree_id || 'MainTree';
                if (node.is_breakpoint && node.uid) {
                  onSetBreakpointOnce?.(treeId, node.uid, newOnce);
                }
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition-all border select-none ${breakpointOnce
                ? 'bg-state-running-bg border-state-running-border text-state-running-text font-bold shadow-2xs'
                : 'bg-surface-primary border-border-subtle text-text-muted hover:bg-surface-hover hover:text-text-primary'
                }`}
              title="Once: Automatically remove breakpoint after it triggers 1 time"
            >
              <div className={`w-3 h-3 rounded-full border flex items-center justify-center ${breakpointOnce
                ? 'border-state-running-border bg-state-running-border'
                : 'border-border-medium bg-surface-secondary'
                }`}>
                {breakpointOnce && <span className="w-1 h-1 rounded-full bg-white block" />}
              </div>
              <span>Once</span>

            </div>
          </div>

          {/* Set / Remove Breakpoint button */}
          <button
            onClick={() => {
              const treeId = tree?.tree_id || 'MainTree';
              node.uid && onToggleBreakpoint?.(treeId, node.uid, breakpointOnce);
            }}
            className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer border shadow-2xs active:scale-95 ${node.is_breakpoint
              ? 'bg-rose-100 dark:bg-rose-950 hover:bg-rose-200 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700 font-bold'
              : 'bg-surface-primary hover:bg-surface-hover text-text-primary border-border-medium'
              }`}
          >
            {node.is_breakpoint ? (
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 mr-0.5" />
            ) : (
              <span className="w-2.5 h-2.5 rounded-full border border-border-medium bg-surface-secondary mr-0.5" />
            )}
            <span>{node.is_breakpoint ? 'Remove Breakpoint' : 'Set Breakpoint'}</span>
          </button>
        </div>
      </div>

      {/* Interactive Fault Injection Section */}
      <div className="bg-surface-secondary p-3 rounded-xl border border-border-medium space-y-3 shadow-2xs">
        <div className="flex items-center justify-between">
          <span className="text-text-primary font-semibold text-[11px] flex items-center gap-1 font-mono">
            <Zap className="w-3 h-3 text-state-fault-text" /> Fault Injection
          </span>
          {node.fault_mode && node.fault_mode !== 'NONE' && (
            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-md border bg-accent-subtle dark:bg-purple-950 text-accent-hover dark:text-purple-300 border-accent-border dark:border-purple-700">
              {node.fault_mode} {node.fault_once ? '(1x)' : ''}
            </span>
          )}


          {/* Once (1-shot) toggle for Fault Injection */}
          <div
            onClick={() => {
              const newOnce = !faultOnce;
              setFaultOnce(newOnce);
              const treeId = tree?.tree_id || 'MainTree';
              if (node.fault_mode && node.fault_mode !== 'NONE' && node.uid) {
                onSetFaultOnce?.(treeId, node.uid, newOnce);
              }
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium cursor-pointer transition-all border select-none ${faultOnce
              ? 'bg-accent-subtle dark:bg-purple-950 border-accent-border dark:border-purple-700 text-accent-hover dark:text-purple-300 font-bold shadow-2xs'
              : 'bg-surface-primary border-border-subtle text-text-muted hover:bg-surface-hover hover:text-text-primary'
              }`}
            title="Override once: Apply fault injection for one tick only"
          >
            <div
              className={`w-3 h-3 rounded-full border flex items-center justify-center ${faultOnce
                ? 'border-accent-primary bg-accent-primary dark:border-purple-500 dark:bg-purple-500'
                : 'border-border-medium bg-surface-secondary'
                }`}
            >
              {faultOnce && (
                <span className="w-1 h-1 rounded-full bg-white block" />
              )}
            </div>
            <span>Once</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => {
              const treeId = tree?.tree_id || 'MainTree';
              node.uid && onInjectFault?.(treeId, node.uid, 'FORCE_SUCCESS', undefined, faultOnce);
            }}
            className={`py-1.5 px-2.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1 transition-all cursor-pointer border shadow-2xs active:scale-95 ${node.fault_mode === 'FORCE_SUCCESS'
              ? 'bg-state-success-bg text-state-success-text border-state-success-border font-bold'
              : 'bg-surface-primary hover:bg-surface-hover text-text-primary border-border-subtle'
              }`}
            title="Override this node's returned status with SUCCESS"
          >
            <CheckCircle2 className="w-3 h-3 text-state-success-text shrink-0" />
            <span>Success</span>
          </button>

          <button
            onClick={() => {
              const treeId = tree?.tree_id || 'MainTree';
              node.uid && onInjectFault?.(treeId, node.uid, 'FORCE_FAILURE', undefined, faultOnce);
            }}
            className={`py-1.5 px-2.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1 transition-all cursor-pointer border shadow-2xs active:scale-95 ${node.fault_mode === 'FORCE_FAILURE'
              ? 'bg-state-failure-bg text-state-failure-text border-state-failure-border font-bold'
              : 'bg-surface-primary hover:bg-surface-hover text-text-primary border-border-subtle'
              }`}
            title="Override this node's returned status with FAILURE"
          >
            <XCircle className="w-3 h-3 text-state-failure-text shrink-0" />
            <span>Failure</span>
          </button>

        </div>

        {/* Reset / Clear Fault Override button */}
        {node.fault_mode && node.fault_mode !== 'NONE' && (
          <button
            onClick={() => {
              const treeId = tree?.tree_id || 'MainTree';
              node.uid && onClearFault?.(treeId, node.uid);
            }}
            className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg bg-accent-subtle hover:bg-accent-border dark:bg-purple-950/80 dark:hover:bg-purple-900 border border-accent-border dark:border-purple-700 text-accent-hover dark:text-purple-300 font-bold text-[10px] transition-all cursor-pointer shadow-2xs active:scale-95"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Clear Fault Override</span>
          </button>
        )}
      </div>
    </div>
  );
};
