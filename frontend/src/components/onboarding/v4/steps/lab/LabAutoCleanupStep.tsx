"use client";

import { useEffect, useState } from "react";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { useTourController } from "../../TourController";
import type { TourStep } from "../../step-types";
import {
  BEAKERBOT_LAB_DISPLAY_NAME,
  cleanupBeakerBotLabUser,
} from "./lib/lab-fake-user";

/**
 * lab-cleanup step body. §6.16c, L21 invariant.
 *
 * Final lab tour step. Fires `cleanupBeakerBotLabUser` (tombstone the
 * BeakerBot user + revoke shares + remove their tasks). The cleanup
 * is idempotent + best-effort: failures log to console and the user
 * keeps moving. We render a brief "wrapping up" beat in the speech
 * bubble so the user doesn't see a blank speech in the half-second
 * before the next step renders.
 *
 * Why a dedicated step (not folded into LabPermissionPracticeStep's
 * onExit):
 *   - onExit fires on BOTH forward advance AND back-step. A user
 *     who back-steps from permission-practice → spawn would tear
 *     down BeakerBot prematurely.
 *   - A dedicated step is the cleanest place to gate cleanup on
 *     "the lab tour FINISHED" (vs "the user was on lab-permission-
 *     practice and clicked Back").
 *   - The lab-prompt Dismiss branch ALSO calls the cleanup helper
 *     directly (it doesn't pass through this step, since Dismiss
 *     jumps to phase4-cleanup). The dual call site is fine because
 *     the helper is idempotent.
 *
 * Completion: auto-advance after a short beat (1200ms: enough for
 * the user to see the wrap-up copy, short enough not to feel like a
 * wait). The cleanup itself fires from the inline component's
 * useEffect on mount, not from the TourStep's `onEnter`, so the
 * speech bubble can surface a status pill the moment cleanup
 * resolves.
 *
 * If the user "I've got it from here"-exits before reaching this
 * step, P8's tour-exit handler should call `cleanupBeakerBotLabUser`
 * directly (the helper is the public surface for that case). P7
 * doesn't own the exitTour wiring beyond what TourController already
 * implements, but the cleanup helper is exported so the exit handler
 * can wire it up.
 */

interface LabAutoCleanupInnerProps {
  /** Override the cleanup helper. Tests pass a mock so they don't
   *  try to read the file system. */
  cleanupFn?: (recipient: string) => Promise<void>;
}

function LabAutoCleanupInner({ cleanupFn }: LabAutoCleanupInnerProps) {
  const [phase, setPhase] = useState<"cleaning" | "done">("cleaning");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const username = await getCurrentUserCached();
        if (username) {
          const fn = cleanupFn ?? cleanupBeakerBotLabUser;
          await fn(username);
        }
      } catch (err) {
        // Cleanup is best-effort. Log + swallow so the tour doesn't
        // wedge on a transient FS hiccup.
        console.warn(
          "[onboarding-v4] lab auto-cleanup failed (best effort)",
          err,
        );
      } finally {
        if (!cancelled) setPhase("done");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cleanupFn]);

  return (
    <div data-step-id="lab-cleanup" className="space-y-2">
      <div className="leading-relaxed">
        Cleaning up the fake teammate. {BEAKERBOT_LAB_DISPLAY_NAME}
        {" "}retires gracefully.
      </div>
      <p
        data-testid="lab-cleanup-status"
        className="text-meta text-gray-500"
      >
        {phase === "cleaning"
          ? "Removing BeakerBot and the demo experiments..."
          : "Done. Your real Workbench is back to just yours."}
      </p>
    </div>
  );
}

/**
 * Build the registry entry for `lab-cleanup`. Auto-advances after
 * 1500ms: enough time for the user to read the wrap-up copy and
 * for the cleanup pass to resolve in most cases (the helper is
 * fast: a couple of unshare calls + one usersApi.delete). If the
 * cleanup is still in flight when auto-advance fires, that's fine:
 * the helper's `void`-bounded background pass keeps running, and
 * the next step renders.
 *
 * Tests can pass a `cleanupFn` override to deterministically resolve
 * the cleanup before the auto-advance window.
 */
export interface BuildLabCleanupStepOptions {
  /** Override the cleanup helper. Tests use this. */
  cleanupFn?: (recipient: string) => Promise<void>;
}

export function buildLabCleanupStep(
  options: BuildLabCleanupStepOptions = {},
): TourStep {
  return {
    id: "lab-cleanup",
    speech: () => <LabAutoCleanupInner cleanupFn={options.cleanupFn} />,
    pose: "thinking",
    completion: {
      type: "auto",
      autoAdvanceAfterMs: 1500,
    },
  };
}

export default LabAutoCleanupInner;
