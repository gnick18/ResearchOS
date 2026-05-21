// frontend/src/lib/streak/streak-activity-bootstrap.ts
//
// Wires the S1 streak activity tracker into the global fileService
// write path AND the browser page-unload handler.
//
// Why a separate bootstrap (rather than self-registering inside the
// tracker module): the tracker is a pure data module that can be
// imported and unit-tested cleanly without side effects at import
// time. Side-effectful registration belongs here, behind a single
// idempotent entry point that AppShell can call once on mount.
//
// Wired in S1; the BeakerBot badge + Settings + celebration surface
// (S2 / S3 / S6) come later.

import { getCurrentUserCached } from "@/lib/storage/json-store";
import { registerFileWriteObserver } from "@/lib/file-system/file-write-hooks";
import {
  flushStreakActivity,
  notifyStreakActivity,
} from "./streak-activity-tracker";

let installed = false;
let unsubscribeWriteObserver: (() => void) | null = null;
let unsubscribeBeforeUnload: (() => void) | null = null;

/**
 * Install the streak activity tracker into the global write path
 * and (in a browser environment) the beforeunload handler. Idempotent:
 * repeated calls are no-ops after the first install.
 *
 * Returns an uninstall fn primarily for test cleanup; in production
 * the bootstrap is install-once and lives for the page lifetime.
 */
export function installStreakActivityTracking(): () => void {
  if (installed) {
    return () => {
      /* idempotent: noop until explicitly uninstalled */
    };
  }
  installed = true;

  // Filter out the streak's own sidecar (feedback loop) and the
  // user-metadata file (not a user-data write per the brief).
  const STREAK_SIDECAR_RE = /^users\/[^/]+\/_streak\.json$/;
  const USER_META_RE = /^users\/[^/]+\/_user_metadata\.json$/;

  unsubscribeWriteObserver = registerFileWriteObserver((path) => {
    // Gate 1: skip the streak sidecar itself. Without this guard,
    // patchStreak inside the tick would re-trigger notifyStreakActivity
    // and produce an infinite debounce-restart loop.
    if (STREAK_SIDECAR_RE.test(path)) return;
    // Gate 2: skip user metadata writes (color picker, etc.). These
    // are not user-data activity per the brief's gate-explicit rule.
    if (USER_META_RE.test(path)) return;

    // Fire-and-forget: resolve the active user, then notify. If
    // there's no active user (demo mode, unauthenticated), skip
    // silently. Any error in this chain is swallowed so the write
    // path can never see it.
    void (async () => {
      try {
        const username = await getCurrentUserCached();
        if (
          !username ||
          username === "_no_user_" ||
          username.length === 0
        ) {
          return;
        }
        notifyStreakActivity(username);
      } catch (err) {
        console.warn(
          "[streak-activity-bootstrap] failed to resolve user:",
          err,
        );
      }
    })();
  });

  // Browser-only: drain the debounce queue on page unload. Synchronous
  // file writes during beforeunload are NOT guaranteed to land in all
  // browsers (the FSA writable is async and the browser may kill the
  // task before flush), but the attempt covers the typical "user
  // closes tab right after a write" case. A write at 23:59 followed by
  // an immediate tab close is the worst case: if it drops we lose one
  // tick. Accepted v1 edge case (see proposal §7.1).
  if (typeof window !== "undefined") {
    const handler = (): void => {
      // flushStreakActivity is async but we cannot await in beforeunload.
      // Kick the flush; the browser may or may not let it complete.
      void flushStreakActivity();
    };
    window.addEventListener("beforeunload", handler);
    unsubscribeBeforeUnload = () => {
      window.removeEventListener("beforeunload", handler);
    };
  }

  return uninstallStreakActivityTracking;
}

/** Uninstall the tracker (test-only in production). */
export function uninstallStreakActivityTracking(): void {
  if (!installed) return;
  installed = false;
  if (unsubscribeWriteObserver) {
    unsubscribeWriteObserver();
    unsubscribeWriteObserver = null;
  }
  if (unsubscribeBeforeUnload) {
    unsubscribeBeforeUnload();
    unsubscribeBeforeUnload = null;
  }
}

/** @internal: test-only. Whether the bootstrap is currently installed. */
export function __isStreakActivityTrackingInstalledForTests(): boolean {
  return installed;
}
