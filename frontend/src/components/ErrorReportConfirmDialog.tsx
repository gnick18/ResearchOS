"use client";

import { type ErrorInfo } from "@/lib/error-reporting";
import LivingPopup from "@/components/ui/LivingPopup";

interface ErrorReportConfirmDialogProps {
  isOpen: boolean;
  error: ErrorInfo | null;
  /** User clicked Send — caller should hand off to the existing
   *  FeedbackModal flow with the error pre-filled. */
  onSend: () => void;
  /** User clicked Dismiss (or close button) — caller should discard
   *  the captured error without filing a report. */
  onDismiss: () => void;
}

/**
 * Confirmation dialog shown AFTER the BugStomp scene plays on an
 * auto-captured error. The splat is the playful acknowledgment; this
 * dialog is the explicit consent step — we don't ship error reports
 * silently, so the user gets a chance to review the captured details
 * and decide whether to file a GitHub issue.
 *
 * Visually mirrors the FeedbackModal header (red triangle icon + same
 * heading typography) so the user reads them as related screens. The
 * "Send" path defers the actual GitHub-issue assembly to the existing
 * FeedbackModal — this dialog just gates the transition.
 */
export default function ErrorReportConfirmDialog({
  isOpen,
  error,
  onSend,
  onDismiss,
}: ErrorReportConfirmDialogProps) {
  return (
    <LivingPopup
      open={isOpen && error !== null}
      onClose={onDismiss}
      label="Caught a bug"
      widthClassName="max-w-md"
      card={false}
    >
      {/* This dialog brings its own white card chrome (card=false above).
          `error` can briefly be null during the close animation, so guard. */}
      <div
        className="relative bg-surface-raised rounded-2xl shadow-2xl w-full overflow-hidden"
        data-testid="error-report-confirm-dialog"
      >
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-500/15 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-red-600 dark:text-red-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-heading font-bold text-foreground">
                  Caught a bug
                </h2>
                <p className="text-meta text-foreground-muted">
                  Want to send this bug report?
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-3">
          <p className="text-body text-foreground-muted">
            We caught an error in the background. Send the details to the
            team so we can fix it, or dismiss to keep working.
          </p>
          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1.5">
              Error
            </label>
            <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg p-3 max-h-32 overflow-y-auto">
              <p className="text-body text-red-800 dark:text-red-300 font-mono break-all">
                {error?.message}
              </p>
              {error?.stack && (
                <pre className="text-meta text-red-600 dark:text-red-300 mt-2 whitespace-pre-wrap">
                  {error.stack.split("\n").slice(0, 4).join("\n")}
                </pre>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border bg-surface-sunken flex gap-3 justify-end">
          <button
            onClick={onDismiss}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={onSend}
            className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors"
          >
            Send Report
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
