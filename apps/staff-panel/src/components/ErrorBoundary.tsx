import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  isolate?: boolean;
  onReset?: () => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (import.meta.env?.DEV) {
      console.error('[ErrorBoundary caught error]:', error, errorInfo);
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  private handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle || 'Ha ocurrido un error inesperado';
      const message =
        this.props.fallbackMessage ||
        'La vista no pudo cargarse correctamente. Puedes reintentar o recargar la página.';

      if (this.props.isolate) {
        return (
          <div
            role="alert"
            className="w-full my-4 p-6 rounded-2xl border border-rose-500/30 bg-rose-950/20 text-slate-200 flex flex-col items-center justify-center text-center space-y-4"
          >
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <AlertTriangle className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="text-base font-bold text-white">{title}</h3>
              <p className="text-xs sm:text-sm text-slate-400">{message}</p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-2 transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                Reintentar sección
              </button>
            </div>
          </div>
        );
      }

      return (
        <div
          role="alert"
          className="min-h-screen w-full bg-slate-950 text-slate-200 flex flex-col items-center justify-center p-6 text-center"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6 shadow-2xl">
            <div className="mx-auto w-16 h-16 rounded-3xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <AlertTriangle className="w-8 h-8" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-black text-white tracking-tight">{title}</h2>
              <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-bold transition-all focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:outline-none"
              >
                Reintentar
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-rose-600/30 transition-all focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
              >
                Recargar página
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
