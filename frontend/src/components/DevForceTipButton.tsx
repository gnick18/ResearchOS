"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useOnboarding } from "@/lib/onboarding/orchestrator";
import { nextTestUserName } from "@/lib/onboarding/dev-sandbox";
import { clearWizardCompletion } from "@/lib/onboarding/sidecar";
import { ONBOARDING_TIPS } from "@/lib/onboarding/tips";
import { findOnboardingTarget } from "@/lib/onboarding/use-onboarding-target";
import BeakerBot from "./BeakerBot";
import Tooltip from "./Tooltip";

/**
 * Dev-only "force an onboarding tip to fire" button. Renders a small
 * dropdown listing the 10 tips by title; clicking one navigates to the
 * tip's route (if different) and force-fires it once the target element
 * mounts. Bypasses every gate (active-time, cooldown, dwell, roll,
 * shown-history) — it's a preview, not a real serve, and does NOT
 * persist to the sidecar.
 *
 * The dropdown also exposes a "Show welcome wizard (creates Test user)"
 * affordance — a dev-sandbox entry-point for the Onboarding v2 wizard
 * (design lock by onboarding v2 manager 2026-05-20). On click:
 *
 *   1. nextTestUserName() picks the lowest available "Test-N" slot
 *      (tombstoned entries count as used).
 *   2. createUser(testUserName) provisions the user's directory tree
 *      + counters file and refreshes the user list.
 *   3. clearWizardCompletion(testUserName) flips wizard_force_show:
 *      true on the new sidecar so the orchestrator's showWizard gate
 *      fires even though the metadata entry from createUser makes
 *      isFreshUserForWizard() return false.
 *   4. setCurrentUser(testUserName) swaps the active user. The
 *      orchestrator re-mounts against Test-N's sidecar and the wizard
 *      appears.
 *
 * The wizard then runs entirely against Test-N — inline pair / feed /
 * clipboard flows write to Test-N's folder, completion / skip write
 * Test-N's sidecar. The real signed-in user is never touched.
 *
 * The active user stays on Test-N after the wizard finishes so Grant
 * can poke around the chosen settings; he switches back manually via
 * the existing user picker and can delete Test-N via the normal
 * user-delete UI.
 *
 * Conditional on `process.env.NODE_ENV === "development"`. Next.js
 * replaces that with the literal `"development"` string at build time,
 * so in production builds (e.g. on Vercel) the early-return turns the
 * body into dead code that the bundler can drop.
 *
 * Returns null in demo / wiki-capture mode because the orchestrator
 * isn't mounted there — `useOnboarding()` returns null and there's
 * nothing to fire against.
 */
const IS_DEV = process.env.NODE_ENV === "development";

export default function DevForceTipButton() {
  const [open, setOpen] = useState(false);
  const orchestrator = useOnboarding();
  const { createUser, setCurrentUser } = useFileSystem();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!IS_DEV) return null;
  if (!orchestrator) return null;

  const handleFire = (tipId: string, route: string) => {
    setOpen(false);

    // Look up the tip's actual target string — not all tips have
    // `id === target` (e.g. goals-vs-tasks targets create-goal).
    const tip = ONBOARDING_TIPS.find((t) => t.id === tipId);
    const targetId = tip?.target ?? tipId;

    // If the target is ALREADY in the DOM (e.g. user opened the
    // relevant popup before clicking the dev button), fire
    // immediately and skip the route push — navigating away would
    // unmount the popup and kill the target before the tip can
    // attach. Covers popup-gated tips opened from non-default
    // routes (e.g. an experiment popup opened from /workbench when
    // the tip's route is "/").
    if (findOnboardingTarget(targetId)) {
      orchestrator.forceFireTip(tipId);
      return;
    }

    // Use startsWith because the catalog's `route: "/"` matches
    // every pathname, so an exact-equality check would over-trigger
    // a navigation when the user is on, say, `/workbench` and the
    // tip is route "/" (legitimately eligible there too).
    if (!pathname.startsWith(route)) {
      router.push(route);
      // Slight delay so the route mount + ref attach has a chance.
      // The orchestrator's force-fire polls for the target for up
      // to 3s, so a missed first frame is fine — this is just a hint.
      window.setTimeout(() => orchestrator.forceFireTip(tipId), 100);
    } else {
      orchestrator.forceFireTip(tipId);
    }
  };

  const handleShowWizardSandbox = async () => {
    setOpen(false);
    // Dev-sandbox entry-point for the Onboarding v2 wizard. See the
    // file-level comment for the full design lock. Goes entirely
    // through existing primitives (createUser + clearWizardCompletion
    // + setCurrentUser) — the orchestrator's showWizard gate handles
    // the actual mount once currentUser flips.
    try {
      const testUserName = await nextTestUserName();
      const created = await createUser(testUserName);
      if (!created) {
        console.error(
          "[dev-sandbox] createUser failed for",
          testUserName,
        );
        return;
      }
      // wizard_force_show: true on the new sidecar — needed because
      // createUser registers the user in _user_metadata, which
      // satisfies isFreshUserForWizard()'s "no metadata entry" signal
      // and would otherwise skip the wizard. The force-show flag is
      // the explicit bypass; the wizard's onComplete / onSkip clears
      // it back to false (one-shot).
      await clearWizardCompletion(testUserName);
      await setCurrentUser(testUserName);
    } catch (err) {
      console.error("[dev-sandbox] failed to create test user", err);
    }
  };

  const handleOpenTelegramWalkthrough = () => {
    setOpen(false);
    // New tab opens against the demo lab, exactly like the welcome
    // modal's full-tour link. `noopener` matches the same pattern.
    if (typeof window !== "undefined") {
      window.open("/demo?tutorial=telegram", "_blank", "noopener");
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <Tooltip label="Force an onboarding tip to fire (dev only)" placement="top">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Force an onboarding tip to fire (dev only)"
          aria-expanded={open}
          aria-haspopup="menu"
          className="w-12 h-12 rounded-full bg-white border-2 border-sky-300 hover:border-sky-500 hover:bg-sky-50 text-sky-600 hover:text-sky-700 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        >
          {/* Render the actual mascot in wireframe mode (noLiquid)
              so the dev-button icon stays monochrome at small size
              and any future BeakerBot tweaks propagate automatically. */}
          <BeakerBot pose="idle" noLiquid className="w-5 h-5" />
        </button>
      </Tooltip>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 mb-2 w-72 bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-50 max-h-[28rem] overflow-y-auto"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
            Force-fire onboarding tip
          </div>
          {ONBOARDING_TIPS.map((tip) => (
            <button
              key={tip.id}
              role="menuitem"
              onClick={() => handleFire(tip.id, tip.route)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 transition-colors flex items-center justify-between gap-2"
            >
              <span className="truncate">{tip.title}</span>
              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                {tip.route}
              </span>
            </button>
          ))}

          <div className="border-t border-slate-100 mt-1 pt-1">
            <button
              role="menuitem"
              onClick={handleShowWizardSandbox}
              className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 text-amber-700 font-medium transition-colors"
            >
              Show welcome wizard (creates Test user)
            </button>
            <button
              role="menuitem"
              onClick={handleOpenTelegramWalkthrough}
              className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50 text-sky-700 font-medium transition-colors"
            >
              Force Telegram walkthrough
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
