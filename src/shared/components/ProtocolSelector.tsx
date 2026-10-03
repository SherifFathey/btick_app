import React, { useState, useEffect, useRef } from 'react';
import {
  Sliders,
  Check,
  X,
  ChevronDown,
  Wifi,
  WifiOff,
} from 'lucide-react';
import treeLogo from '../../assets/tree.png';
import groot2Logo from '../../assets/groot2.png';
import nav2Logo from '../../assets/nav2.png';
import { ProtocolConnectionStatus } from '../../monitor/protocols/types';
import { ros2Service } from '../../monitor/services/ros2Service';

export interface ProtocolSelectorProps {
  activeProtocol?: 'btick' | 'groot2' | 'nav2';
  isConnected?: boolean;
  connectionStatus?: ProtocolConnectionStatus;
  protocolStatuses?: Record<'btick' | 'groot2' | 'nav2', ProtocolConnectionStatus>;
  treesCount?: number;
  onSwitchSource?: (source: 'btick' | 'groot2' | 'nav2', host?: string, port?: number, topic?: string) => void;
  onOpenNav2Prompt?: () => void;
  className?: string;
  compact?: boolean;
}

export const ProtocolSelector: React.FC<ProtocolSelectorProps> = ({
  activeProtocol = 'btick',
  isConnected = false,
  connectionStatus = 'DISCONNECTED',
  protocolStatuses,
  treesCount = 0,
  onSwitchSource,
  onOpenNav2Prompt,
  className = '',
  compact = false,
}) => {
  const protocolDropdownRef = useRef<HTMLDivElement>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<'btick' | 'groot2' | 'nav2'>(activeProtocol);
  const [grootHost, setGrootHost] = useState('127.0.0.1');
  const [grootPort, setGrootPort] = useState(1667);
  const [nav2Topic, setNav2Topic] = useState<string>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('bt_nav2_topic') || '/behavior_tree_log';
      }
    } catch {
      // ignore
    }
    return '/behavior_tree_log';
  });

  useEffect(() => {
    if (!isSourceModalOpen) {
      setSelectedSource(activeProtocol);
    }
  }, [activeProtocol, isSourceModalOpen]);

  // Handle clicking outside protocol dropdown
  useEffect(() => {
    if (!isSourceModalOpen) return;

    const handleClickOutside = (e: MouseEvent | PointerEvent | TouchEvent) => {
      if (protocolDropdownRef.current && !protocolDropdownRef.current.contains(e.target as Node)) {
        setIsSourceModalOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSourceModalOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleClickOutside, true);
    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('touchstart', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handleClickOutside, true);
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('touchstart', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSourceModalOpen]);

  const handleConnectNav2 = (closeModal: boolean = true) => {
    const rawTopic = (nav2Topic || '').trim() || '/behavior_tree_log';
    const formattedTopic = rawTopic.startsWith('/') ? rawTopic : `/${rawTopic}`;
    setNav2Topic(formattedTopic);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('bt_nav2_topic', formattedTopic);
      }
    } catch {
      // ignore
    }
    if (onSwitchSource) {
      onSwitchSource('nav2', undefined, undefined, formattedTopic);
    } else {
      ros2Service.switchSource('nav2', formattedTopic);
    }
    if (closeModal) {
      setIsSourceModalOpen(false);
    }
    if (treesCount === 0 && onOpenNav2Prompt) {
      onOpenNav2Prompt();
    }
  };

  const handleConnectGroot2 = (closeModal: boolean = true) => {
    const targetHost = (grootHost || '').trim() || '127.0.0.1';
    const targetPort = grootPort || 1667;
    if (onSwitchSource) {
      onSwitchSource('groot2', targetHost, targetPort);
    } else {
      ros2Service.switchSource('groot2', targetHost, targetPort);
    }
    if (closeModal) {
      setIsSourceModalOpen(false);
    }
  };

  const handleSelectGroot2Row = () => {
    setSelectedSource('groot2');
  };

  const handleSelectNav2Row = () => {
    setSelectedSource('nav2');
  };

  const getProtoStatus = (proto: 'btick' | 'groot2' | 'nav2'): ProtocolConnectionStatus => {
    if (protocolStatuses && protocolStatuses[proto]) {
      return protocolStatuses[proto];
    }
    if (activeProtocol === proto) {
      return connectionStatus;
    }
    return 'DISCONNECTED';
  };

  const renderProtocolStatusBadge = (status: ProtocolConnectionStatus) => {
    const isProtoConnected = Boolean(isConnected && (status === 'CONNECTED_RUNNING' || status === 'CONNECTED_IDLE'));
    if (isProtoConnected) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-md bg-accent-primary text-white border border-accent-primary">
          <Wifi className="w-3 h-3 text-white shrink-0" />
          <span className="text-white">Connected</span>
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-[10px] font-mono text-text-muted">
        <WifiOff className="w-3 h-3 text-text-muted shrink-0" />
        <span>Disconnected</span>
      </span>
    );
  };

  const activeProtoStatus = getProtoStatus(activeProtocol);
  const isOnline = Boolean(isConnected && (activeProtoStatus === 'CONNECTED_RUNNING' || activeProtoStatus === 'CONNECTED_IDLE'));
  const statusLabel = isOnline ? 'Connected' : 'Disconnected';
  const protocolDisplayName = activeProtocol === 'btick' ? 'BTick' : activeProtocol === 'groot2' ? 'Groot2' : 'Nav2';

  return (
    <div className={`relative shrink-0 ${className}`} ref={protocolDropdownRef}>
      <button
        type="button"
        onClick={() => {
          if (!isSourceModalOpen) {
            setSelectedSource(activeProtocol);
          }
          setIsSourceModalOpen(!isSourceModalOpen);
        }}
        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg border text-xs font-mono cursor-pointer transition-all whitespace-nowrap text-text-primary shadow-2xs hover:border-border-strong active:scale-95 ${
          isSourceModalOpen
            ? 'border-accent-primary bg-surface-hover ring-2 ring-accent-primary/20 relative z-50'
            : 'border-border-medium bg-surface-secondary hover:bg-surface-hover'
        } ${compact ? 'h-6 text-[11px] px-1.5' : 'h-7.5'}`}
        title={`Click to switch Active Protocol Engine (${protocolDisplayName}: ${statusLabel})`}
      >
        {/* Left Side: Protocol Logo + Name */}
        <div className="flex items-center gap-1.5 min-w-0">
          {activeProtocol === 'btick' ? (
            <img src={treeLogo} alt="BTick" className="w-3.5 h-3.5 object-contain shrink-0 opacity-90 dark:brightness-0 dark:invert dark:opacity-100" />
          ) : activeProtocol === 'groot2' ? (
            <img src={groot2Logo} alt="Groot2" className="w-3.5 h-3.5 object-contain shrink-0" />
          ) : (
            <img src={nav2Logo} alt="Nav2" className="w-3.5 h-3.5 object-contain shrink-0" />
          )}
          <span className="font-bold text-accent-primary dark:text-white truncate">
            {protocolDisplayName}
          </span>
        </div>

        {/* Right Side: Wi-Fi Icon + Status Label + Chevron */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="flex items-center gap-1 shrink-0">
            {isOnline ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-text-muted shrink-0" />
            )}
            <span
              className={`text-[11px] font-bold font-mono tracking-tight shrink-0 ${
                isOnline
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-text-muted'
              }`}
            >
              {statusLabel}
            </span>
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-text-secondary transition-transform shrink-0 ${isSourceModalOpen ? 'rotate-180 text-accent-primary dark:text-white' : ''}`} />
        </div>
      </button>

      {isSourceModalOpen && (
        <>
          {/* Full-screen transparent backdrop */}
          <div
            className="fixed inset-0 z-40 bg-transparent cursor-default"
            aria-hidden="true"
            onClick={(e) => {
              e.stopPropagation();
              setIsSourceModalOpen(false);
            }}
          />
          <div className="absolute left-0 top-full mt-1.5 w-76 sm:w-80 bg-surface-primary rounded-2xl shadow-2xl border border-border-medium p-3 z-50 font-sans text-text-primary animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-border-subtle px-1">
              <div className="flex items-center gap-1.5 font-bold text-xs text-text-primary font-mono">
                <Sliders className="w-4 h-4 text-accent-primary" />
                <span>Select Protocol Engine</span>
              </div>
              <button
                type="button"
                onClick={() => setIsSourceModalOpen(false)}
                className="p-1 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {/* Option 1: BTick */}
              <button
                type="button"
                onClick={() => {
                  setSelectedSource('btick');
                  if (onSwitchSource) {
                    onSwitchSource('btick');
                  } else {
                    ros2Service.switchSource('btick');
                  }
                  setIsSourceModalOpen(false);
                }}
                className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between cursor-pointer ${
                  activeProtocol === 'btick'
                    ? 'bg-accent-subtle border-accent-border text-text-primary font-bold shadow-2xs'
                    : 'bg-surface-secondary border-border-subtle hover:bg-surface-hover text-text-secondary font-medium'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-primary border border-border-subtle flex items-center justify-center p-1 shrink-0 shadow-2xs">
                    <img src={treeLogo} alt="BTick" className="w-5 h-5 object-contain opacity-90 dark:brightness-0 dark:invert dark:opacity-100" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-bold leading-tight">BTick</span>
                    <div className="mt-0.5">
                      {renderProtocolStatusBadge(getProtoStatus('btick'))}
                    </div>
                  </div>
                </div>
                {activeProtocol === 'btick' ? (
                  <span className="flex items-center gap-1 text-[11px] text-accent-primary dark:text-white font-bold font-mono px-2 py-0.5 rounded-md bg-accent-subtle border border-accent-border">
                    Active
                    <Check className="w-3.5 h-3.5 text-accent-primary dark:text-white shrink-0" />
                  </span>
                ) : (
                  <span className="text-[11px] text-accent-primary dark:text-white font-mono font-medium hover:underline">
                    Switch
                  </span>
                )}
              </button>

              {/* Option 2: Groot2 */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                selectedSource === 'groot2'
                  ? 'bg-accent-subtle border-accent-border text-text-primary font-bold shadow-2xs'
                  : 'bg-surface-secondary border-border-subtle hover:bg-surface-hover text-text-secondary font-medium'
              }`}>
                <button
                  type="button"
                  onClick={handleSelectGroot2Row}
                  className="w-full text-left flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-surface-primary border border-border-subtle flex items-center justify-center p-1 shrink-0 overflow-hidden shadow-2xs">
                      <img src={groot2Logo} alt="Groot2" className="w-6 h-6 object-contain" />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-[13px] leading-tight ${selectedSource === 'groot2' ? 'font-bold text-text-primary' : 'font-medium text-text-secondary'}`}>
                        Groot2
                      </span>
                      <div className="mt-0.5">
                        {renderProtocolStatusBadge(getProtoStatus('groot2'))}
                      </div>
                    </div>
                  </div>
                  {activeProtocol === 'groot2' ? (
                    <span className="flex items-center gap-1 text-[11px] text-accent-primary dark:text-white font-bold font-mono px-2 py-0.5 rounded-md bg-accent-subtle border border-accent-border">
                      Active
                      <Check className="w-3.5 h-3.5 text-accent-primary dark:text-white shrink-0" />
                    </span>
                  ) : selectedSource === 'groot2' ? (
                    <span className="text-[11px] text-accent-primary dark:text-white font-mono font-bold">
                      Selected
                    </span>
                  ) : (
                    <span className="text-[11px] text-accent-primary dark:text-white font-mono font-medium hover:underline">
                      Switch
                    </span>
                  )}
                </button>

                {/* If Groot2 is selected, show host/port config inputs and Connect button */}
                {selectedSource === 'groot2' && (
                  <div className="mt-2 pt-1 space-y-2 text-xs">
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="col-span-2">
                        <label className="text-[9px] font-semibold text-text-muted block mb-0.5 font-mono">Host IP:</label>
                        <input
                          type="text"
                          value={grootHost}
                          onChange={(e) => setGrootHost(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleConnectGroot2(true);
                            }
                          }}
                          className="w-full bg-surface-primary border border-border-medium rounded-lg px-2 py-1 text-xs font-mono text-text-primary outline-none focus:border-border-focus"
                          placeholder="127.0.0.1"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-semibold text-text-muted block mb-0.5 font-mono">Port:</label>
                        <input
                          type="number"
                          value={grootPort}
                          onChange={(e) => setGrootPort(parseInt(e.target.value, 10) || 1667)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleConnectGroot2(true);
                            }
                          }}
                          className="w-full bg-surface-primary border border-border-medium rounded-lg px-2 py-1 text-xs font-mono text-text-primary outline-none focus:border-border-focus"
                          placeholder="1667"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleConnectGroot2(true)}
                      className="w-full py-1.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg border border-accent-border text-xs font-bold transition-all cursor-pointer text-center shadow-xs active:scale-95"
                    >
                      {activeProtocol === 'groot2' ? 'Reconnect' : 'Connect'}
                    </button>
                  </div>
                )}
              </div>

              {/* Option 3: Nav2 */}
              <div className={`p-2.5 rounded-xl border transition-all ${
                selectedSource === 'nav2'
                  ? 'bg-accent-subtle border-accent-border text-text-primary font-bold shadow-2xs'
                  : 'bg-surface-secondary border-border-subtle hover:bg-surface-hover text-text-secondary font-medium'
              }`}>
                <button
                  type="button"
                  onClick={handleSelectNav2Row}
                  className="w-full text-left flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-surface-primary border border-border-subtle flex items-center justify-center p-1 shrink-0 overflow-hidden shadow-2xs">
                      <img src={nav2Logo} alt="Nav2" className="w-6 h-6 object-contain" />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-[13px] leading-tight ${selectedSource === 'nav2' ? 'font-bold text-text-primary' : 'font-medium text-text-secondary'}`}>
                        Nav2
                      </span>
                      <div className="mt-0.5">
                        {renderProtocolStatusBadge(getProtoStatus('nav2'))}
                      </div>
                    </div>
                  </div>
                  {activeProtocol === 'nav2' ? (
                    <span className="flex items-center gap-1 text-[11px] text-accent-primary dark:text-white font-bold font-mono px-2 py-0.5 rounded-md bg-accent-subtle border border-accent-border">
                      Active
                      <Check className="w-3.5 h-3.5 text-accent-primary dark:text-white shrink-0" />
                    </span>
                  ) : selectedSource === 'nav2' ? (
                    <span className="text-[11px] text-accent-primary dark:text-white font-mono font-bold">
                      Selected
                    </span>
                  ) : (
                    <span className="text-[11px] text-accent-primary dark:text-white font-mono font-medium hover:underline">
                      Switch
                    </span>
                  )}
                </button>

                {/* If Nav2 is selected, show editable topic name and Connect button */}
                {selectedSource === 'nav2' && (
                  <div className="mt-2 pt-1 space-y-2 text-xs">
                    <div>
                      <label className="text-[9px] font-semibold text-text-muted block mb-0.5 font-mono">Topic Name:</label>
                      <input
                        type="text"
                        value={nav2Topic}
                        onChange={(e) => setNav2Topic(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleConnectNav2(true);
                          }
                        }}
                        className="w-full bg-surface-primary border border-border-medium rounded-lg px-2 py-1 text-xs font-mono text-text-primary outline-none focus:border-border-focus"
                        placeholder="/behavior_tree_log"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleConnectNav2(true)}
                      className="w-full py-1.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg border border-accent-border text-xs font-bold transition-all cursor-pointer text-center shadow-xs active:scale-95"
                    >
                      {activeProtocol === 'nav2' ? 'Apply Topic' : 'Connect'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
