"use client";

import { Component, type ReactNode, type ErrorInfo as ReactErrorInfo } from "react";
import {
  captureError,
  generateGitHubIssueUrl,
  type ErrorInfo,
} from "@/lib/error-reporting";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ReactErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ReactErrorInfo) {
    captureError(error);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  /** Build an ErrorInfo snapshot from `this.state.error` for the
   *  "Send Bug Report" fallback button. The boundary intentionally
   *  doesn't reuse `getLastError()` from the reporting module — that
   *  global may have been clobbered by a later error during teardown.
   *  The error we want to file is the one that actually tripped this
   *  boundary, so we synthesize the ErrorInfo from local state.
   *  (feedback polish R1) */
  buildErrorInfo = (): ErrorInfo | null => {
    const err = this.state.error;
    if (!err) return null;
    return {
      message: err.message,
      stack: err.stack ? err.stack.slice(0, 2000) : undefined,
      timestamp: new Date().toISOString(),
      url: typeof window !== "undefined" ? window.location.href : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    };
  };

  handleSendBugReport = () => {
    const errorInfo = this.buildErrorInfo();
    if (typeof window === "undefined") return;
    const url = generateGitHubIssueUrl({
      type: "bug",
      description: "",
      errorInfo,
    });
    window.open(url, "_blank");
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-surface-sunken flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-surface-raised rounded-2xl shadow-lg p-6 text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-500/15 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600 dark:text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-heading font-bold text-foreground mb-2">Something went wrong</h2>
            <p className="text-foreground-muted text-body mb-4">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            {this.state.error && (
              <div className="bg-red-50 dark:bg-red-500/15 rounded-lg p-3 mb-4 text-left">
                <p className="text-meta text-red-800 dark:text-red-300 font-mono break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <div className="flex gap-3">
                <button
                  onClick={this.handleRetry}
                  className="flex-1 px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="ros-btn-raise flex-1 px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors"
                >
                  Refresh Page
                </button>
              </div>
              {/* Send Bug Report opens a pre-filled GitHub issue in a
                  new tab with the captured error (message + stack +
                  URL + UA + timestamp). The user reviews and submits
                  on GitHub. We don't gate on "is the user logged in"
                  because the boundary catches errors that may have
                  ripped the whole app down — the report path needs to
                  work from any state. (feedback polish R1) */}
              <button
                onClick={this.handleSendBugReport}
                className="ros-btn-neutral px-4 py-2 text-body text-foreground-muted"
              >
                Send Bug Report
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
