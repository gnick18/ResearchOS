"use client";

// PopupErrorBoundary: a tiny dev-only error boundary for the popup-chrome
// review gallery. Unlike the shared app ErrorBoundary, this one surfaces the
// thrown error message INLINE so Grant can see why a popup failed to mount
// without a connected folder, and a reset button re-mounts the subtree so the
// next "Open" attempt starts clean. Scoped to this dev page only.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { Component, type ReactNode } from "react";

interface Props {
  /** Shown in the inline error card so Grant knows which popup failed. */
  label: string;
  /** Called when the user dismisses the error, so the parent can also flip its
   *  open state back to closed (otherwise the same broken render repeats). */
  onReset?: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class PopupErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Dev harness only, so a console line is enough of a record.
    console.error(`[popup-chrome] ${this.props.label} threw:`, error);
  }

  private handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-6">
          <div className="max-w-lg rounded-xl border border-red-300 bg-surface p-6 text-foreground shadow-xl">
            <p className="text-body font-semibold text-red-600">
              {this.props.label} failed to render
            </p>
            <p className="mt-2 text-meta text-foreground-muted">
              This popup needs context that the folderless dev harness does not
              provide. The chrome of the other variant is still reviewable.
            </p>
            <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-surface-sunken p-3 text-meta text-foreground-muted">
              {this.state.error.message || String(this.state.error)}
            </pre>
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-4 rounded-lg border border-border bg-surface-raised px-4 py-2 text-body font-semibold text-brand-action hover:bg-surface"
            >
              Dismiss
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
