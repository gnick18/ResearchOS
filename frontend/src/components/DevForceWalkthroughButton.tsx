"use client";

import { useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { nextTestUserName } from "@/lib/onboarding/dev-sandbox";
import { clearWizardCompletion } from "@/lib/onboarding/sidecar";
import BeakerBot from "./BeakerBot";
import Tooltip from "./Tooltip";

/**
 * Dev-only "force fire the v4 walkthrough on a fresh test account" button.
 *
 * Restored after the V3 onboarding rip (e10d8ae7) which deleted the
 * earlier DevForceTipButton. The v3 deletion removed the only entry point
 * Grant had for previewing the walkthrough without trashing his real
 * account's data — this restores that affordance, scoped strictly to the
 * v4 tour (v3 step-machine entries are gone).
 *
 * Flow:
 *
 *   1. Click the floating button on the login screen.
 *   2. Confirm dialog: "Create a temporary test account and fire the
 *      walkthrough on it? Your current accounts won't be touched."
 *   3. On confirm: mint a fresh `Test-N` user via `createUser` (counter
 *      via `nextTestUserName` so soft-deleted entries don't collide),
 *      patch its sidecar so `wizard_force_show = true` and completion
 *      flags clear, log in as the new user. The v4 TourBootstrap then
 *      auto-fires the tour on its next mount because the fresh sidecar
 *      satisfies the "no completion + no skip + no resume" fresh-user
 *      branch (`controller.start()`).
 *
 * The button itself never touches the currently signed-in user's
 * `_onboarding.json` — the new Test-N user is the only sidecar mutated.
 * Real-account preservation was the original design lock on the v3
 * version (see the deleted dev-sandbox.ts module header for the
 * onboarding v2 manager's master-locked design note); the v4 restore
 * carries that contract forward.
 *
 * Gated on `process.env.NODE_ENV === "development"`. Next.js replaces
 * that with the literal `"development"` at build time so production
 * builds drop this whole component as dead code — mirrors the
 * DevDemoToggleButton / DevTestNotificationButton / DevBeakerBotGalleryButton
 * pattern.
 *
 * Returns null when no folder is connected (the picker shouldn't render
 * the button on the welcome / pick-a-folder screen; UserLoginScreen only
 * mounts once a folder is connected anyway, but the guard belt-and-
 * suspenders against the file-service singleton being mid-swap).
 */
const IS_DEV = process.env.NODE_ENV === "development";

interface DevForceWalkthroughButtonProps {
  /** Called after the test user is created + signed in, so the parent
   *  login screen can transition out of its picker view the same way a
   *  normal login completes. Mirrors the `onLogin` prop already threaded
   *  through UserLoginScreen. */
  onLoggedIn: () => void;
}

export default function DevForceWalkthroughButton({
  onLoggedIn,
}: DevForceWalkthroughButtonProps) {
  const { createUser, setCurrentUser, isConnected } = useFileSystem();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!IS_DEV) return null;
  if (!isConnected) return null;

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Mint the next available Test-N name. nextTestUserName counts
      // tombstoned entries as taken so we don't collide with their
      // lingering sidecar / settings footprint until cloud-sync GCs them.
      const testUserName = await nextTestUserName();

      const created = await createUser(testUserName);
      if (!created) {
        setError(`Failed to create ${testUserName}. Check folder permissions.`);
        setBusy(false);
        return;
      }

      // wizard_force_show: true on the new sidecar so the v4 TourBootstrap
      // mounts the tour on first render. clearWizardCompletion does this
      // along with clearing wizard_completed_at / wizard_skipped_at — the
      // shape the v3 dev sandbox used. The v4 bootstrap's fresh-user gate
      // (no completion + no skip + no resume) already fires the tour for
      // a brand-new user, but force_show is the explicit bypass that
      // protects against any future gate change.
      await clearWizardCompletion(testUserName);

      // Swap the active user. UserLoginScreen's onLogin callback (passed
      // through onLoggedIn) then unmounts the picker, AppShell mounts,
      // V4MountForUser reads the fresh sidecar, TourBootstrap fires.
      await setCurrentUser(testUserName);
      setConfirming(false);
      onLoggedIn();
    } catch (err) {
      console.error("[dev-force-walkthrough] failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create test user. Check the console.",
      );
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50">
        <Tooltip
          label="Force walkthrough on a fresh test account (dev only)"
          placement="left"
        >
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Force walkthrough on a fresh test account (dev only)"
            className="w-12 h-12 rounded-full bg-white border-2 border-sky-300 hover:border-sky-500 hover:bg-sky-50 text-sky-600 hover:text-sky-700 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
          >
            <BeakerBot pose="waving" noLiquid className="w-6 h-6" />
          </button>
        </Tooltip>
      </div>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Force walkthrough on a fresh test account"
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => !busy && setConfirming(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-[440px] max-w-[calc(100vw-2rem)] mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-5 pb-3 border-b border-gray-100">
              <div className="flex items-start gap-3">
                <div
                  aria-hidden
                  className="flex-shrink-0"
                  style={{ width: 56, height: 56 }}
                >
                  <BeakerBot
                    pose="waving"
                    direction="right"
                    className="w-full h-full text-sky-500"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Dev only
                  </span>
                  <h2 className="mt-1 text-lg font-semibold text-gray-900">
                    Force the welcome walkthrough?
                  </h2>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 text-sm text-gray-700 leading-relaxed">
              <p>
                Create a temporary test account and fire the walkthrough on
                it? Your current accounts won&apos;t be touched.
              </p>
              <p className="mt-2 text-xs text-gray-500">
                A new <code className="px-1 bg-gray-100 rounded">Test-N</code>{" "}
                user will be created in this folder and signed in.
              </p>
            </div>

            {error && (
              <div className="px-6 pb-3">
                <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  {error}
                </div>
              </div>
            )}

            <div className="px-6 pb-4 pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {busy ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Creating...
                  </>
                ) : (
                  "Create test user + start tour"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
