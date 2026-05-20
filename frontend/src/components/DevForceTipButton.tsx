"use client";

import { useEffect, useRef, useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useOnboarding } from "@/lib/onboarding/orchestrator";
import { nextTestUserName } from "@/lib/onboarding/dev-sandbox";
import {
  clearWizardCompletion,
  patchOnboarding,
} from "@/lib/onboarding/sidecar";
import {
  ALL_STEP_IDS,
  type WizardStep,
} from "@/components/onboarding/v3/WizardStepMachine";
import BeakerBot from "./BeakerBot";
import Tooltip from "./Tooltip";

/**
 * Dev-only "force the v3 wizard to mount at a chosen step" button.
 *
 * The Onboarding v3 walkthrough replaces v1/v2's tip catalog (P0 +
 * §2 of ONBOARDING_V3_PROPOSAL.md). The dev affordance pivots
 * accordingly: instead of force-firing a single popup tip on a
 * specific route, the dropdown now lets Grant force-mount the
 * wizard at any step in the W1-W14 / L1-L11 / phase4-cleanup graph.
 *
 * Two flows:
 *
 *   1. **Mount wizard at <step>** — Picks a step from the dropdown,
 *      calls `orchestrator.jumpToStep(step)` (which flips
 *      `wizard_force_show=true` and writes a resume_state pointing at
 *      the chosen step), then reloads. The wizard auto-mounts on the
 *      next render because the gate sees wizard_force_show.
 *
 *   2. **Show welcome wizard (creates Test user)** — Spawns a fresh
 *      "Test-N" sandbox user via `createUser`, force-shows the
 *      wizard on that user's sidecar via `clearWizardCompletion`,
 *      then swaps the active user. Identical to the v2 sandbox path;
 *      the only difference is the wizard that mounts is the v3 shell.
 *
 *   3. **Reset wizard state** — Clears wizard_completed_at,
 *      wizard_skipped_at, wizard_resume_state, wizard_force_show, and
 *      feature_picks so the user can re-run the wizard from scratch.
 *      Useful when iterating on the step bodies during P2a/b/c.
 *
 * Conditional on `process.env.NODE_ENV === "development"`. Next.js
 * replaces that with the literal `"development"` at build time so
 * production builds drop this whole component as dead code.
 *
 * Returns null in demo / wiki-capture mode because the orchestrator
 * isn't mounted there — `useOnboarding()` returns null and there's
 * nothing to fire against.
 */
const IS_DEV = process.env.NODE_ENV === "development";

export default function DevForceTipButton() {
  const [open, setOpen] = useState(false);
  const [pendingStep, setPendingStep] = useState<WizardStep>("intro");
  const orchestrator = useOnboarding();
  const { currentUser, createUser, setCurrentUser } = useFileSystem();
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  const handleMountAtStep = async () => {
    setOpen(false);
    try {
      await orchestrator.jumpToStep(pendingStep);
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (err) {
      console.error("[dev-force-wizard] jumpToStep failed", err);
    }
  };

  const handleResetWizardState = async () => {
    setOpen(false);
    if (!currentUser) {
      console.warn("[dev-force-wizard] no current user; nothing to reset");
      return;
    }
    try {
      await patchOnboarding(currentUser, (cur) => ({
        ...cur,
        feature_picks: null,
        wizard_completed_at: null,
        wizard_skipped_at: null,
        wizard_resume_state: null,
        wizard_force_show: false,
      }));
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch (err) {
      console.error("[dev-force-wizard] reset failed", err);
    }
  };

  const handleShowWizardSandbox = async () => {
    setOpen(false);
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
      // createUser registers the user in _user_metadata, which would
      // otherwise satisfy isFreshUserForWizard's "no metadata entry"
      // signal as false. The force-show flag is the explicit bypass;
      // the wizard's onComplete / onSkip handlers clear it back.
      await clearWizardCompletion(testUserName);
      await setCurrentUser(testUserName);
    } catch (err) {
      console.error("[dev-sandbox] failed to create test user", err);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <Tooltip label="Force the v3 wizard to mount (dev only)" placement="top">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Force the v3 wizard to mount (dev only)"
          aria-expanded={open}
          aria-haspopup="menu"
          className="w-12 h-12 rounded-full bg-white border-2 border-sky-300 hover:border-sky-500 hover:bg-sky-50 text-sky-600 hover:text-sky-700 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
        >
          <BeakerBot pose="idle" noLiquid className="w-5 h-5" />
        </button>
      </Tooltip>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 mb-2 w-80 bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-50 max-h-[28rem] overflow-y-auto"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
            Onboarding v3 wizard (dev)
          </div>

          <div className="px-3 py-2 space-y-2">
            <label
              htmlFor="dev-wizard-step-picker"
              className="block text-[11px] font-medium text-slate-500"
            >
              Mount at step
            </label>
            <select
              id="dev-wizard-step-picker"
              value={pendingStep}
              onChange={(e) => setPendingStep(e.target.value as WizardStep)}
              className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {ALL_STEP_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button
              role="menuitem"
              onClick={() => void handleMountAtStep()}
              className="w-full px-3 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded transition-colors"
            >
              Mount wizard at this step
            </button>
          </div>

          <div className="border-t border-slate-100 pt-1">
            <button
              role="menuitem"
              onClick={() => void handleResetWizardState()}
              className="w-full text-left px-3 py-2 text-sm hover:bg-rose-50 text-rose-700 font-medium transition-colors"
            >
              Reset wizard state (current user)
            </button>
            <button
              role="menuitem"
              onClick={() => void handleShowWizardSandbox()}
              className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 text-amber-700 font-medium transition-colors"
            >
              Show welcome wizard (creates Test user)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
