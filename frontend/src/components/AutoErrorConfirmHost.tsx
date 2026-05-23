"use client";

import { useErrorReporting } from "@/hooks/useErrorReporting";
import ErrorReportConfirmDialog from "./ErrorReportConfirmDialog";
import FeedbackModal from "./FeedbackModal";

/**
 * Global host for the auto-error confirm dialog (and its hand-off
 * FeedbackModal). Mounted once at the providers level — above AppShell
 * — so the dialog renders on every surface, including pre-login screens
 * (UserLoginScreen, DataSetupScreen, ResearchFolderSetupNew) where
 * AppShell is not yet in the tree.
 *
 * Before this host existed, the dialog was mounted only inside AppShell.
 * Pre-login surfaces still subscribed to error events via their own
 * `useErrorReporting()` instances, so the splat scene fired and state
 * flipped, but the dialog itself was never rendered — the user saw the
 * splat then nothing.
 *
 * The host owns the FeedbackModal for the "Send Report" hand-off too,
 * because the modal needs to live at the same scope as the dialog's
 * `sendAutoErrorReport` call (which flips this hook instance's
 * `showBugReport`). On logged-in surfaces AppShell still renders its
 * own FeedbackModal for the manual FeedbackButton flow; the two
 * instances are independent and only one is ever open at a time
 * (different `showBugReport` state per hook instance).
 *
 * Pattern mirrors SceneTriggerHost — single global mount in
 * lib/providers.tsx, render-only, owns nothing the rest of the app
 * cares about.
 */
export default function AutoErrorConfirmHost() {
  const {
    showAutoErrorConfirm,
    pendingAutoError,
    sendAutoErrorReport,
    dismissAutoErrorReport,
    showBugReport,
    currentError,
    closeBugReport,
  } = useErrorReporting();

  return (
    <>
      <ErrorReportConfirmDialog
        isOpen={showAutoErrorConfirm}
        error={pendingAutoError}
        onSend={sendAutoErrorReport}
        onDismiss={dismissAutoErrorReport}
      />
      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />
    </>
  );
}
