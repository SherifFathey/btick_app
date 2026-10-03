import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[BTick ErrorBoundary caught]:', error, errorInfo);
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#0b0f1a] p-8 text-center select-text">
          <div className="p-6 bg-[#111a2e] border border-rose-500/40 rounded-2xl max-w-md w-full shadow-2xl flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 mb-3 shadow-inner">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-[#c8d3e0] mb-1">
              {this.props.fallbackTitle || 'Visualization Error'}
            </h3>
            <p className="text-xs text-rose-300/90 mb-4 font-mono break-all bg-[#0b0f1a] p-2 rounded-lg border border-[#2f3e56] w-full text-left">
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Recover & Reload View</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

