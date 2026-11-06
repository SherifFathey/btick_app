import React, { useState, useEffect } from "react";
import QRCode from "qrcode";
import {
  Smartphone,
  Copy,
  Check,
  ExternalLink,
  Wifi,
  WifiOff,
  HelpCircle,
  QrCode,
  X,
} from "lucide-react";
import {
  ros2Service,
  RuntimeNetworkConfig,
} from "../../monitor/services/ros2Service";

export interface MobileAccessCardProps {
  className?: string;
  compact?: boolean;
  isConnected?: boolean;
  onClose?: () => void;
}

export const MobileAccessCard: React.FC<MobileAccessCardProps> = ({
  className = "",
  compact = false,
  isConnected: propIsConnected,
  onClose,
}) => {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<RuntimeNetworkConfig | null>(() =>
    ros2Service.getRuntimeConfig(),
  );
  const [serviceConnected, setServiceConnected] = useState<boolean>(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);

  useEffect(() => {
    const unsubConfig = ros2Service.onConfigChange((cfg) => {
      setConfig(cfg);
    });
    const unsubStatus = ros2Service.onStatusChange((status) => {
      setServiceConnected(status);
    });
    return () => {
      unsubConfig();
      unsubStatus();
    };
  }, []);

  const isConnected =
    typeof propIsConnected === "boolean" ? propIsConnected : serviceConnected;

  const mobileUrl = ros2Service.getLanUrl();
  const wsUrl = ros2Service.getWsUrl();
  const lanIp = ros2Service.getLanIp();
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");

  useEffect(() => {
    if (mobileUrl) {
      QRCode.toDataURL(mobileUrl, {
        width: 180,
        margin: 1.5,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      })
        .then((url) => setQrCodeDataUrl(url))
        .catch((err) => console.error("Error generating QR code:", err));
    }
  }, [mobileUrl]);

  const handleCopy = (text: string, type: "http" | "ws") => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedUrl(type);
        setTimeout(() => setCopiedUrl(null), 2000);
      });
    }
  };

  if (compact) {
    return (
      <div
        className={`bg-surface-secondary border border-border-medium rounded-xl p-3 space-y-2.5 font-sans ${className}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-text-primary">
            <Smartphone className="w-4 h-4 text-accent-primary shrink-0" />
            <span>Mobile Access (LAN)</span>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
              isConnected
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
            }`}
          >
            {isConnected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Connected</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>Reconnecting...</span>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-surface-primary border border-border-subtle rounded-lg px-2.5 py-1.5">
          <span className="font-mono text-xs text-accent-primary font-semibold truncate flex-1 select-all">
            {mobileUrl}
          </span>
          <button
            type="button"
            onClick={() => handleCopy(mobileUrl, "http")}
            className="flex items-center gap-1 px-2 py-1 bg-surface-secondary hover:bg-surface-hover border border-border-medium rounded-md text-[11px] font-medium text-text-primary transition-all cursor-pointer active:scale-95"
            title="Copy Mobile Access URL"
          >
            {copiedUrl === "http" ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500 font-bold">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-text-muted" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-surface-primary border border-border-medium rounded-2xl shadow-lg p-5 space-y-4 font-sans text-left max-w-lg w-full whitespace-normal select-text break-words ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-accent-subtle text-accent-primary rounded-xl border border-accent-border">
            <Smartphone className="w-5 h-5 text-accent-primary" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wide font-mono">
              Mobile & Network Access
            </h3>
            <p className="text-[11px] text-text-muted">
              Connect from any phone or tablet on the same Wi-Fi
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* WebSocket Connection Badge */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border shrink-0 ${
              isConnected
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
            }`}
            title={
              isConnected
                ? "WebSocket Bridge is connected"
                : "WebSocket Bridge is disconnected. Waiting to reconnect..."
            }
          >
            {isConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>WS Live</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>WS Offline</span>
              </>
            )}
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded-lg transition-all cursor-pointer"
              title="Close"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* QR Code Section */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-surface-secondary/70 border border-border-subtle rounded-2xl p-3.5">
        <div className="p-2 bg-white rounded-xl shadow-xs border border-slate-200 shrink-0 flex items-center justify-center">
          {qrCodeDataUrl ? (
            <img
              src={qrCodeDataUrl}
              alt="Scan QR code to connect"
              className="w-28 h-28 object-contain"
            />
          ) : (
            <div className="w-28 h-28 flex items-center justify-center">
              <QrCode className="w-8 h-8 text-slate-400 animate-pulse" />
            </div>
          )}
        </div>
        <div className="flex-1 text-center sm:text-left space-y-1.5 min-w-0">
          <div className="flex items-center justify-center sm:justify-start gap-1.5 font-bold text-xs text-text-primary font-mono uppercase tracking-wide">
            <QrCode className="w-4 h-4 text-accent-primary shrink-0" />
            <span>Scan With Phone Camera</span>
          </div>
          <p className="text-[11px] text-text-muted leading-relaxed whitespace-normal break-words">
            Aim your smartphone camera at the QR code to open BTick directly
            without typing the IP address.
          </p>
          <div className="pt-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] text-accent-primary font-semibold font-mono bg-accent-subtle px-2 py-0.5 rounded-md border border-accent-border">
              Wi-Fi: Same Network Required
            </span>
          </div>
        </div>
      </div>

      {/* Mobile URL Box */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-text-secondary flex items-center justify-between">
          <span>Mobile Access URL (Browser)</span>
          <span className="text-[10px] text-text-muted font-mono">
            LAN Host: {lanIp}
          </span>
        </label>
        <div className="flex items-center gap-2 bg-surface-secondary border border-border-subtle rounded-xl p-1.5 px-2.5 focus-within:border-accent-primary transition-all">
          <span className="font-mono text-xs text-text-primary font-semibold flex-1 select-all truncate">
            {mobileUrl}
          </span>
          <button
            type="button"
            onClick={() => handleCopy(mobileUrl, "http")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-primary hover:bg-surface-hover border border-border-medium rounded-lg text-xs font-semibold text-text-primary transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
            title="Copy URL to clipboard"
          >
            {copiedUrl === "http" ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500 font-bold">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-text-muted" />
                <span>Copy URL</span>
              </>
            )}
          </button>
          <a
            href={mobileUrl}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded-lg transition-all"
            title="Open link in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Instructions list */}
      <div className="bg-surface-secondary/70 border border-border-subtle rounded-xl p-3 text-xs text-text-secondary space-y-1.5">
        <div className="font-bold text-text-primary text-[11px] flex items-center gap-1">
          <span>Quick Connection Steps:</span>
        </div>
        <ol className="list-decimal list-inside space-y-1 text-[11px] text-text-muted">
          <li>
            Connect your phone to the <strong>same Wi-Fi network</strong> as
            this computer.
          </li>
          <li>
            Open Chrome, Safari, or your mobile browser and enter the URL above.
          </li>
          <li>
            The mobile interface will connect to the live Behavior Tree stream
            automatically.
          </li>
        </ol>
      </div>

      {/* Troubleshooting toggle */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowTroubleshooting((prev) => !prev)}
          className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <span>
            {showTroubleshooting
              ? "Hide troubleshooting hints"
              : "Cannot connect from mobile? View tips"}
          </span>
        </button>

        {showTroubleshooting && (
          <div className="mt-2 p-3 bg-surface-tertiary border border-border-subtle rounded-xl text-[11px] text-text-secondary space-y-2 animate-in fade-in">
            <p>
              <strong>1. Linux Firewall (UFW):</strong> If connection times out,
              allow the ports on this host:
            </p>
            <pre className="bg-surface-primary border border-border-medium rounded-lg p-2 font-mono text-[10px] text-accent-primary select-all overflow-x-auto">
              sudo ufw allow 3000/tcp && sudo ufw allow 8080/tcp
            </pre>
            <p>
              <strong>2. Router AP Isolation:</strong> Ensure guest network or
              client isolation is disabled on your Wi-Fi router.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
