"use client";

import { useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import BetaDonationButton from "@/components/BetaDonationButton";
import FeedbackModal from "@/components/FeedbackModal";
import Tooltip from "@/components/Tooltip";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import { clearAllStickyDemoFlags } from "@/lib/file-system/wiki-capture-mock";

interface DataSetupScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DataSetupScreen({ isOpen, onClose }: DataSetupScreenProps) {
  const { currentUser, directoryName, lastConnectedFolder, disconnect } = useFileSystem();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const { showBugReport, currentError, openBugReport, closeBugReport } = useErrorReporting();

  if (!isOpen) return null;

  const folderLabel = directoryName || lastConnectedFolder || "Not connected";

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnect();
      // Clear sticky demo / wiki-capture sessionStorage flags so the
      // post-reload render doesn't fall back into the demo branch of
      // providers.tsx (`isDemoOrWikiCapture() && currentUser` → demo
      // fixture re-installs). LeaveDemoModal already calls this; the
      // disconnect path was missed, which left a user who had ever
      // visited /demo this tab "trapped" in demo mode after disconnect.
      clearAllStickyDemoFlags();
      // Hard navigate to `/` instead of reloading the current URL —
      // a reload at `/demo/*` would re-trigger the URL-based demo gate
      // even after the sticky flag is cleared. `href = "/"` both
      // navigates AND reloads.
      window.location.href = "/";
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-surface-raised rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-heading font-semibold text-foreground">Settings</h2>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-foreground-muted hover:text-foreground-muted transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </Tooltip>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <p className="text-meta font-medium text-foreground-muted uppercase tracking-wide mb-1.5">
              Current User
            </p>
            <div className="flex items-center justify-between">
              <span className="text-body text-foreground">{currentUser || "—"}</span>
              <p className="text-meta text-foreground-muted">
                Use the user button (bottom-right) to switch
              </p>
            </div>
          </div>

          <div>
            <p className="text-meta font-medium text-foreground-muted uppercase tracking-wide mb-1.5">
              Connected Folder
            </p>
            <code className="block text-body text-foreground bg-surface-sunken rounded-lg px-3 py-2 break-all">
              {folderLabel}
            </code>
          </div>

          <div className="pt-3 border-t border-border">
            {!confirmingDisconnect ? (
              <button
                onClick={() => setConfirmingDisconnect(true)}
                className="ros-btn-neutral w-full py-2.5 text-body"
              >
                Disconnect / Pick Different Folder
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-body text-foreground-muted">
                  Disconnect from <span className="font-medium">{folderLabel}</span>? You&apos;ll need to re-select a folder to continue.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmingDisconnect(false)}
                    disabled={disconnecting}
                    className="flex-1 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="ros-btn-raise flex-1 py-2 text-body text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                  >
                    {disconnecting ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Beta: Support & Bug Report */}
          <div className="pt-3 border-t border-border flex gap-2">
            <button
              onClick={openBugReport}
              className="flex-1 py-2 text-body text-foreground-muted bg-surface-sunken hover:bg-surface-sunken rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Report Bug
            </button>
            <BetaDonationButton variant="link" />
          </div>
        </div>
      </div>

      {/* Bug Report Modal */}
      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />
    </div>
  );
}
