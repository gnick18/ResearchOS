"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  subscribeToErrors,
  getLastError,
  clearLastError,
  type ErrorInfo,
} from "@/lib/error-reporting";
import { useSceneTriggerStore } from "@/lib/scene-trigger-store";

/**
 * Cooldown between auto-error splats. A noisy error stream (dev hot-
 * reload mid-edit, a render loop catching its own throws) would
 * otherwise queue a chain of 6.3s scenes. 5s is long enough that two
 * truly distinct user actions stay 1-for-1 with their splat, but tight
 * enough that the second of a burst arrives close to the first's tail.
 */
const AUTO_ERROR_COOLDOWN_MS = 5000;

/**
 * Lightweight fingerprint for dedup: message + first line of the stack.
 * Identical to the dedup key React uses when matching error boundaries
 * across re-renders. Length-bounded so a giant stack doesn't blow up
 * the comparison.
 */
function fingerprintError(error: ErrorInfo): string {
  const firstStackLine = error.stack?.split("\n")[0] ?? "";
  return `${error.message}|${firstStackLine}`.slice(0, 500);
}

export function useErrorReporting() {
  const [showBugReport, setShowBugReport] = useState(false);
  const [currentError, setCurrentError] = useState<ErrorInfo | null>(null);
  const [showErrorToast, setShowErrorToast] = useState(false);

  /** Error captured by the auto-detect path that's currently waiting on
   *  user consent. Distinct from `currentError` (which is used both for
   *  the manual flow and the toast) so the confirm dialog stays
   *  scoped — re-clicking the toast doesn't repurpose its state. */
  const [pendingAutoError, setPendingAutoError] = useState<ErrorInfo | null>(
    null,
  );
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);

  /** Last-seen fingerprint, used to drop duplicate auto-errors that
   *  arrive in quick succession (React strict-mode double-invoke,
   *  effect loops, etc.). Lives in a ref so it doesn't trigger
   *  re-renders. */
  const lastFingerprint = useRef<string | null>(null);

  const fireScene = useSceneTriggerStore((s) => s.fireScene);

  useEffect(() => {
    const unsubscribe = subscribeToErrors((error) => {
      setCurrentError(error);
      setShowErrorToast(true);

      // Auto-error splat path: dedup on fingerprint + enforce the
      // cooldown via the store. The splat is fire-and-forget here:
      // if it gets dropped (cooldown not yet elapsed, or a scene
      // already playing), we still show the toast — the user can
      // click Report there to invoke the manual flow.
      const fp = fingerprintError(error);
      if (lastFingerprint.current === fp) return;
      lastFingerprint.current = fp;

      fireScene(
        "bugstomp",
        () => {
          // Scene finished — surface the confirm dialog with the
          // captured error. Re-read into setPendingAutoError because
          // a newer error may have arrived during the 6.3s scene; we
          // want to confirm the one the user actually saw acknowledged.
          setPendingAutoError(error);
          setShowAutoConfirm(true);
        },
        AUTO_ERROR_COOLDOWN_MS,
      );
    });

    return unsubscribe;
  }, [fireScene]);

  const reportCurrentError = useCallback(() => {
    const error = getLastError();
    setCurrentError(error);
    setShowBugReport(true);
    setShowErrorToast(false);
  }, []);

  /** Manual "Report Bug" trigger. Fires the BugStomp scene first, then
   *  opens the bug-report modal on completion. If a scene is already
   *  playing (auto-error landed half a second earlier), skip straight
   *  to the modal — the user explicitly asked to file a report and we
   *  don't want to silently drop the click. */
  const openBugReport = useCallback(() => {
    const accepted = fireScene("bugstomp", () => {
      setCurrentError(getLastError());
      setShowBugReport(true);
      setShowErrorToast(false);
    });
    if (!accepted) {
      // Fall back to the original behavior — open the modal without
      // the splat overture.
      setCurrentError(getLastError());
      setShowBugReport(true);
      setShowErrorToast(false);
    }
  }, [fireScene]);

  const closeBugReport = useCallback(() => {
    setShowBugReport(false);
    clearLastError();
    setCurrentError(null);
  }, []);

  const dismissErrorToast = useCallback(() => {
    setShowErrorToast(false);
  }, []);

  /** Auto-error confirm path: user clicked Send. Hand off to the
   *  bug-report modal with the captured error pre-filled. The confirm
   *  dialog closes; the toast hides because the modal is the more
   *  detailed surface for the same error. */
  const sendAutoErrorReport = useCallback(() => {
    setCurrentError(pendingAutoError);
    setShowAutoConfirm(false);
    setPendingAutoError(null);
    setShowBugReport(true);
    setShowErrorToast(false);
  }, [pendingAutoError]);

  /** Auto-error confirm path: user clicked Dismiss. Drop the captured
   *  error without filing. The toast also goes away since the user has
   *  now explicitly declined; leaving it up would be nagging. */
  const dismissAutoErrorReport = useCallback(() => {
    setShowAutoConfirm(false);
    setPendingAutoError(null);
    setShowErrorToast(false);
    clearLastError();
  }, []);

  return {
    showBugReport,
    currentError,
    showErrorToast,
    reportCurrentError,
    openBugReport,
    closeBugReport,
    dismissErrorToast,

    // Auto-error confirm-dialog surface (consumed by AppShell).
    showAutoErrorConfirm: showAutoConfirm,
    pendingAutoError,
    sendAutoErrorReport,
    dismissAutoErrorReport,
  };
}
