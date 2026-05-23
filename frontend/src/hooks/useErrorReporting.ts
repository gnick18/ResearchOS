"use client";

import { useEffect, useCallback, useState } from "react";
import { create } from "zustand";
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

/**
 * Global store for the auto-error confirm dialog state.
 *
 * Why a store rather than per-hook React state: `useErrorReporting()`
 * is called from 5+ sites (AppShell, UserLoginScreen, DataSetupScreen,
 * ResearchFolderSetupNew, AutoErrorConfirmHost). Each instance would
 * otherwise hold its own copy of `showAutoErrorConfirm`, and only the
 * instance that wins the listener race would actually flip — every
 * other instance would silently miss the auto-error event. The
 * AutoErrorConfirmHost (which renders the dialog) might not be the
 * winner. Lifting this into a single global store makes the dialog
 * mount and the consent state share one source of truth regardless of
 * which hook instance the event fires from.
 *
 * Also moves the subscribe-to-errors side-effect for the auto-error
 * path into module-scope. The subscription is registered exactly once,
 * not per-hook-instance, so there's no fingerprint-dedup race between
 * 5 sibling refs.
 */
interface AutoErrorConfirmState {
  showAutoErrorConfirm: boolean;
  pendingAutoError: ErrorInfo | null;
  lastFingerprint: string | null;

  /** Auto-error event handler: invoked by the module-level subscriber
   *  on every captured error. Runs the fingerprint dedup + scene fire
   *  inside the store so no hook instance has to. */
  onAutoError: (error: ErrorInfo) => void;

  /** User clicked Send on the confirm dialog. Caller (the hook) reads
   *  pendingAutoError and routes it into the bug-report modal flow. */
  consume: () => ErrorInfo | null;

  /** User clicked Dismiss (or backdrop) on the confirm dialog. */
  dismiss: () => void;
}

const useAutoErrorConfirmStore = create<AutoErrorConfirmState>((set, get) => ({
  showAutoErrorConfirm: false,
  pendingAutoError: null,
  lastFingerprint: null,

  onAutoError: (error) => {
    const fp = fingerprintError(error);
    if (get().lastFingerprint === fp) return;
    set({ lastFingerprint: fp });

    // Fire the splat scene; on completion, surface the confirm dialog
    // with the captured error. If the store rejects (cooldown not yet
    // elapsed, or scene already playing), the dialog stays closed and
    // the toast remains as the fallback Report path.
    const { fireScene } = useSceneTriggerStore.getState();
    fireScene(
      "bugstomp",
      () => {
        set({ showAutoErrorConfirm: true, pendingAutoError: error });
      },
      AUTO_ERROR_COOLDOWN_MS,
    );
  },

  consume: () => {
    const { pendingAutoError } = get();
    set({ showAutoErrorConfirm: false, pendingAutoError: null });
    return pendingAutoError;
  },

  dismiss: () => {
    set({ showAutoErrorConfirm: false, pendingAutoError: null });
    clearLastError();
  },
}));

// Module-level subscription: registered once on first import on the
// client. Hot-reload re-runs this file in dev; the previous
// subscription is replaced by the new one via subscribeToErrors's
// Set-based listener registry (a stale closure would otherwise keep
// pushing to the dead store).
let autoErrorSubscribed = false;
function ensureAutoErrorSubscribed() {
  if (autoErrorSubscribed) return;
  if (typeof window === "undefined") return;
  autoErrorSubscribed = true;
  subscribeToErrors((error) => {
    useAutoErrorConfirmStore.getState().onAutoError(error);
  });
}

export function useErrorReporting() {
  const [showBugReport, setShowBugReport] = useState(false);
  const [currentError, setCurrentError] = useState<ErrorInfo | null>(null);
  const [showErrorToast, setShowErrorToast] = useState(false);

  const fireScene = useSceneTriggerStore((s) => s.fireScene);

  // Auto-error confirm state lives in a global Zustand store so all
  // hook instances see the same dialog state. See store docstring
  // above for why this isn't per-hook React state.
  const showAutoErrorConfirm = useAutoErrorConfirmStore(
    (s) => s.showAutoErrorConfirm,
  );
  const pendingAutoError = useAutoErrorConfirmStore((s) => s.pendingAutoError);

  // Toast path: still per-hook React state because the toast itself
  // is rendered per-callsite (AppShell owns its toast in the bottom-
  // right cluster). Each hook instance subscribes so the toast flips
  // wherever the user happens to be.
  useEffect(() => {
    ensureAutoErrorSubscribed();
    const unsubscribe = subscribeToErrors((error) => {
      setCurrentError(error);
      setShowErrorToast(true);
    });
    return unsubscribe;
  }, []);

  /** Toast "Report" handler: open the bug-report modal with the last-
   *  captured error pre-filled. Does NOT re-fire the splat scene — by
   *  the time the toast is up, the splat has already played (auto-error
   *  path) OR the user is in a non-auto-error context where the splat
   *  wasn't appropriate to begin with. Doubling the scene here would
   *  be redundant noise; the toast Report is purely "open the form".
   *  Manual FeedbackButton click (openBugReport below) still fires the
   *  splat because that's the entry point and no scene has played yet. */
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

  /** Auto-error confirm path: user clicked Send. Pull the captured
   *  error out of the global store and route it into THIS hook's
   *  bug-report modal flow (so the FeedbackModal opens in whichever
   *  tree the host instance lives — AutoErrorConfirmHost in
   *  providers.tsx). The toast also hides because the modal is the
   *  more detailed surface for the same error. */
  const sendAutoErrorReport = useCallback(() => {
    const error = useAutoErrorConfirmStore.getState().consume();
    setCurrentError(error);
    setShowBugReport(true);
    setShowErrorToast(false);
  }, []);

  /** Auto-error confirm path: user clicked Dismiss. Drop the captured
   *  error without filing. The toast also goes away since the user has
   *  now explicitly declined; leaving it up would be nagging. */
  const dismissAutoErrorReport = useCallback(() => {
    useAutoErrorConfirmStore.getState().dismiss();
    setShowErrorToast(false);
  }, []);

  return {
    showBugReport,
    currentError,
    showErrorToast,
    reportCurrentError,
    openBugReport,
    closeBugReport,
    dismissErrorToast,

    // Auto-error confirm-dialog surface (consumed by AutoErrorConfirmHost
    // mounted in lib/providers.tsx).
    showAutoErrorConfirm,
    pendingAutoError,
    sendAutoErrorReport,
    dismissAutoErrorReport,
  };
}

/** Test-only helper to reset the auto-error confirm store between
 *  tests. Not part of the public hook API. */
export function __resetAutoErrorStoreForTests(): void {
  useAutoErrorConfirmStore.setState({
    showAutoErrorConfirm: false,
    pendingAutoError: null,
    lastFingerprint: null,
  });
}
