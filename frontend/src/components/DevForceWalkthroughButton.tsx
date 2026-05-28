"use client";

import { useEffect, useRef, useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { nextTestUserName } from "@/lib/onboarding/dev-sandbox";
import { clearWizardCompletion } from "@/lib/onboarding/sidecar";
import { clearAllStickyDemoFlags, V4_PREVIEW_STICKY_KEY } from "@/lib/file-system/wiki-capture-mock";
import { clearLandingSeen } from "@/lib/landing/landing-gate";
import BeakerBot from "./BeakerBot";
import Tooltip from "./Tooltip";

/**
 * Dev-only "force fire a walkthrough" button.
 *
 * Restored after the V3 onboarding rip (e10d8ae7) which deleted the
 * earlier DevForceTipButton. The v3 deletion removed the only entry point
 * Grant had for previewing the walkthrough without trashing his real
 * account's data — this restores that affordance.
 *
 * The button opens a small menu with two options (dev walkthrough button
 * manager, 2026-05-23):
 *
 *   1. "Folder setup walkthrough" — disconnect the current folder and
 *      land on the pre-onboarding folder picker. Lets Grant re-test the
 *      first-time-connecting-a-folder flow without nuking the connection
 *      durably (he just re-picks the same folder on the picker).
 *      Implementation: `disconnect()` from `useFileSystem`, then
 *      `clearAllStickyDemoFlags()` to drop any wiki-capture / demo-mode
 *      stickiness, then `window.location.href = "/"`. Hard nav (not
 *      router.push) so AppShell + the Onboarding providers unmount
 *      cleanly — soft nav can leave stale state in the FileSystem
 *      context that the picker doesn't expect.
 *
 *   2. "User setup walkthrough" — mint a fresh `Test-N` user via
 *      `nextTestUserName` (counter respects soft-deleted entries so
 *      tombstoned sidecars don't collide), patch its sidecar so
 *      `wizard_force_show = true` and completion flags clear, log in as
 *      the new user. The v4 TourBootstrap auto-fires the tour on its
 *      next mount because the fresh sidecar satisfies the "no completion
 *      + no skip + no resume" fresh-user branch (`controller.start()`).
 *      This was the original flow before the two-mode menu — the user
 *      option preserves it verbatim, including the `onLoggedIn` callback
 *      UserLoginScreen passes through to swap out of the picker view.
 *
 * The button itself never touches the currently signed-in user's
 * `_onboarding.json`. Real-account preservation was the original design
 * lock on the v3 version (see the deleted dev-sandbox.ts module header
 * for the onboarding v2 manager's master-locked design note); the v4
 * restore + two-mode redesign carries that contract forward.
 *
 * Mount sites:
 *   - `AppShell.tsx` floating cluster: pass `inline={true}` so the
 *     button drops its own fixed wrapper and flows inline in the
 *     parent flex row (otherwise it overlaps the donation heart).
 *   - `UserLoginScreen.tsx`: omit `inline` so the button keeps its
 *     `fixed bottom-4 right-4 z-50` wrapper and floats on the login
 *     picker independently of any cluster.
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

type WalkthroughMode = "folder" | "user" | "landing";

interface DevForceWalkthroughButtonProps {
  /** Optional callback fired after the test user is created + signed in.
   *  UserLoginScreen passes its `onLogin` here to transition out of the
   *  picker view. AppShell omits it — `setCurrentUser` already updates
   *  the FileSystem context, which re-renders AppShell automatically. */
  onLoggedIn?: () => void;
  /** When true, the button drops its `fixed bottom-4 right-4 z-50`
   *  wrapper and renders inline so a parent flex cluster can position
   *  it. AppShell's floating cluster passes this; the standalone
   *  UserLoginScreen mount omits it so the button keeps floating on
   *  its own. */
  inline?: boolean;
}

export default function DevForceWalkthroughButton({
  onLoggedIn,
  inline = false,
}: DevForceWalkthroughButtonProps) {
  const { createUser, setCurrentUser, isConnected, disconnect } =
    useFileSystem();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<WalkthroughMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close the menu on outside-click + Escape. Mirrors the lightweight
  // popover pattern used elsewhere in the cluster — no portal, no focus
  // trap (the menu is two buttons, not a form). The confirm dialog has
  // its own modal treatment further down.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (!IS_DEV) return null;
  if (!isConnected) return null;

  const openMode = (next: WalkthroughMode) => {
    setMode(next);
    setMenuOpen(false);
    setError(null);
  };

  const closeDialog = () => {
    if (busy) return;
    setMode(null);
    setError(null);
  };

  const handleConfirmUser = async () => {
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
        return;
      }

      // wizard_force_show: true on the new sidecar so the v4 TourBootstrap
      // mounts the tour on first render. clearWizardCompletion does this
      // along with clearing wizard_completed_at / wizard_skipped_at (the
      // shape the v3 dev sandbox used). The v4 bootstrap's fresh-user gate
      // (no completion + no skip + no resume) already fires the tour for
      // a brand-new user, but force_show is the explicit bypass that
      // protects against any future gate change.
      await clearWizardCompletion(testUserName);

      // wikiCapture vs real-folder split (dev-button fix, 2026-05-28).
      // Under ?wikiCapture, a hard nav would drop the capture param and
      // leave fixture mode, so we keep the soft-swap path: flip the V4
      // preview sticky (so providers.tsx's isDemoOrWikiCapture gate mounts
      // V4MountForUser) and swap the user in place. On a REAL folder (the
      // home-screen / Settings dev button Grant uses), the soft swap did
      // NOT reliably re-fire TourBootstrap: the bootstrap's sidecar probe
      // is one-shot per mount and the in-place user swap did not re-mount
      // it cleanly, so "User setup walkthrough" looked like it did nothing.
      // setCurrentUser persists the chosen user (storeCurrentUser), so a
      // hard nav to "/" reloads as the fresh Test-N user and TourBootstrap
      // probes the just-cleared sidecar on a clean mount and fires. Mirrors
      // the folder flow's hard-nav reliability.
      const isWikiCapture =
        typeof window !== "undefined" &&
        window.location.search.includes("wikiCapture");

      if (isWikiCapture) {
        try {
          window.sessionStorage.setItem(V4_PREVIEW_STICKY_KEY, "1");
        } catch {
          // sessionStorage can throw in private-mode browsers; best-effort.
        }
        await setCurrentUser(testUserName);
        setMode(null);
        onLoggedIn?.();
      } else {
        // Persist the fresh user, then hard-reload so the bootstrap re-probes
        // its sidecar on a clean mount and starts the tour for Test-N.
        await setCurrentUser(testUserName);
        window.location.href = "/";
      }
    } catch (err) {
      console.error("[dev-force-walkthrough] user flow failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create test user. Check the console.",
      );
    } finally {
      // Always clear busy on exit so a thrown error from setCurrentUser
      // (or any later step) doesn't wedge the Cancel button. The early
      // closeDialog guard (`if (busy) return;`) made an error mid-flow
      // leave the dialog stuck open with no way to dismiss it. (panel
      // mechanical fixes, 2026-05-26)
      setBusy(false);
    }
  };

  const handleConfirmFolder = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Drop the current folder connection so AppShell unmounts and the
      // root route falls back to the pre-onboarding folder picker. Then
      // wipe any sticky demo / wiki-capture flags so the picker doesn't
      // silently re-enter fixture mode (mirrors the LeaveDemoModal exit
      // path). Hard nav to "/?connect=1" so React tears down all in-memory
      // context cleanly AND the landing-page gate is bypassed: disconnect
      // clears IndexedDB, which would otherwise read as "truly-new" and show
      // the marketing landing instead of the folder picker this option is
      // meant to test. The connect bypass keeps the destination the folder
      // picker. (landing-page manager, 2026-05-28)
      await disconnect();
      clearAllStickyDemoFlags();
      window.location.href = "/?connect=1";
    } catch (err) {
      console.error("[dev-force-walkthrough] folder flow failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to disconnect folder. Check the console.",
      );
      setBusy(false);
    }
  };

  const handleConfirmLanding = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Re-show the first-time-visitor landing page. Disconnect (clears the
      // IndexedDB handle + current user so the gate reads "truly-new"), wipe
      // sticky demo / wiki-capture flags, and clear the localStorage
      // seen-landing flag so shouldShowLanding returns true again. Hard nav
      // to "/" (NOT /?connect=1) so the gate renders the landing on a clean
      // mount. (landing-page manager, 2026-05-28)
      await disconnect();
      clearAllStickyDemoFlags();
      clearLandingSeen();
      window.location.href = "/";
    } catch (err) {
      console.error("[dev-force-walkthrough] landing flow failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to reset to the landing page. Check the console.",
      );
      setBusy(false);
    }
  };

  const triggerButton = (
    <Tooltip
      label="Force walkthrough (dev only)"
      placement={inline ? "top" : "left"}
    >
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Force walkthrough (dev only)"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="pointer-events-auto w-12 h-12 rounded-full bg-white border-2 border-sky-300 hover:border-sky-500 hover:bg-sky-50 text-sky-600 hover:text-sky-700 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
      >
        <BeakerBot pose="waving" noLiquid className="w-6 h-6" />
      </button>
    </Tooltip>
  );

  // The popover anchors above the trigger in both mount sites; bottom-full
  // + mb-2 keeps it clear of the button on AppShell's cluster (which sits
  // at the very bottom of the viewport) and clear of the login-screen
  // float (which sits at bottom-4). right-0 anchors the menu's right edge
  // to the trigger's right edge so it never spills off-screen.
  const menu = menuOpen && (
    <div
      role="menu"
      aria-label="Walkthrough options"
      className="absolute bottom-full right-0 mb-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-[200]"
    >
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Dev: force walkthrough
        </p>
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => openMode("folder")}
        className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-gray-100"
      >
        <p className="text-sm font-medium text-gray-900">
          Folder setup walkthrough
        </p>
        <p className="mt-0.5 text-xs text-gray-500 leading-snug">
          Tests the folder-connection flow
        </p>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => openMode("user")}
        className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-gray-100"
      >
        <p className="text-sm font-medium text-gray-900">
          User setup walkthrough
        </p>
        <p className="mt-0.5 text-xs text-gray-500 leading-snug">
          Tests the v4 walkthrough on a fresh test user
        </p>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => openMode("landing")}
        className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors"
      >
        <p className="text-sm font-medium text-gray-900">Landing page</p>
        <p className="mt-0.5 text-xs text-gray-500 leading-snug">
          Re-shows the first-time-visitor sell page
        </p>
      </button>
    </div>
  );

  // The button + popover share a relative wrapper so the menu's
  // `absolute bottom-full` anchors off the trigger. Inline mount drops
  // the outer `fixed` positioning (parent cluster handles that);
  // standalone mount keeps the original `fixed bottom-4 right-4 z-50`.
  const triggerCluster = (
    <div className="relative" ref={wrapperRef}>
      {triggerButton}
      {menu}
    </div>
  );

  return (
    <>
      {inline ? (
        triggerCluster
      ) : (
        <div className="fixed bottom-4 right-4 z-50">{triggerCluster}</div>
      )}

      {mode !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            mode === "folder"
              ? "Force the folder-setup walkthrough"
              : mode === "landing"
                ? "Re-show the landing page"
                : "Force the user-setup walkthrough"
          }
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={closeDialog}
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
                    {mode === "folder"
                      ? "Force the folder-setup walkthrough?"
                      : mode === "landing"
                        ? "Re-show the landing page?"
                        : "Force the welcome walkthrough?"}
                  </h2>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 text-sm text-gray-700 leading-relaxed">
              {mode === "folder" ? (
                <>
                  <p>
                    This will disconnect your current folder. Your data is
                    safe but you&apos;ll need to reconnect.
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    After disconnecting, you&apos;ll land on the
                    pre-onboarding folder picker so you can re-test the
                    first-time connection flow.
                  </p>
                </>
              ) : mode === "landing" ? (
                <>
                  <p>
                    This will disconnect your current folder. Your data is
                    safe but you&apos;ll need to reconnect afterward.
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    Clears the &ldquo;seen landing&rdquo; flag and resets to a
                    truly-new state so the first-time-visitor sell page shows
                    again.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Creates a temporary test account. Your existing accounts
                    won&apos;t be touched.
                  </p>
                  <p className="mt-2 text-xs text-gray-500">
                    A new <code className="px-1 bg-gray-100 rounded">Test-N</code>{" "}
                    user will be created in this folder and signed in.
                  </p>
                </>
              )}
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
                onClick={closeDialog}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (mode === "folder") void handleConfirmFolder();
                  else if (mode === "landing") void handleConfirmLanding();
                  else void handleConfirmUser();
                }}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {busy ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    {mode === "folder" || mode === "landing"
                      ? "Disconnecting..."
                      : "Creating..."}
                  </>
                ) : mode === "folder" ? (
                  "Disconnect + go to folder picker"
                ) : mode === "landing" ? (
                  "Disconnect + show landing page"
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
