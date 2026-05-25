"use client";

/**
 * Lab overview PI tooltips (Chip B, lab overview PI tooltips manager,
 * 2026-05-25): the once-per-Mira-session hint that auto-opens the FIRST
 * widget's help tooltip on /lab-overview.
 *
 * Behavior:
 *   - On mount, look up the current user's onboarding sidecar.
 *   - If `lab_overview_tooltips_seen_at` is null (or absent), AND the
 *     viewer is a lab_head, AND this widget id is the first tile in the
 *     lab_head default canvas layout, then `shouldAutoOpen = true`.
 *   - The first consumer to call `markSeen()` stamps the sidecar with
 *     the current ISO timestamp, which permanently silences future
 *     auto-opens (the tooltip is still reachable on click — the badge
 *     stays put for recoverable discovery).
 *
 * Module-level once-per-session guard: a single auto-open per Mira-
 * session. Once `markSeen()` has been called (or the in-memory flag is
 * already set) the hook returns `shouldAutoOpen = false` for every
 * subsequent caller in the same tab, even before the sidecar write
 * resolves. Without this guard a fast navigation between widgets could
 * trigger the auto-open twice on the SAME render pass.
 *
 * Per the proposal (§B): only fires for `accountType === "lab_head"`.
 * Member surfaces and solo users skip the hint entirely.
 */
import { useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import {
  patchOnboarding,
  readOnboarding,
} from "@/lib/onboarding/sidecar";
import { defaultLayoutFor } from "@/lib/lab-overview/layout-persistence";
import { useOptionalTourController } from "@/components/onboarding/v4/TourController";

/**
 * Mira PI R1 fix manager (Fix 2, 2026-05-25): how long to wait after
 * the wizard completes before letting the auto-open fire. Matches the
 * goodbye overlay's cheer + wave + fade + toast budget (~8.4 s) plus a
 * small safety margin so the tooltip never races the toast.
 */
const WIZARD_COMPLETION_BUFFER_MS = 10_000;

/**
 * Module-level "already fired this session" flag. Protects against
 * race-y double-fires inside a single tab — once any widget's
 * `markSeen()` succeeds (or the sidecar already says we've fired), no
 * other widget on this page can claim `shouldAutoOpen = true`. The
 * sidecar timestamp is the authoritative cross-tab / cross-session
 * record; this flag is purely the in-tab quick guard.
 *
 * Exported as a test-seam so jsdom tests can reset between runs.
 */
let sessionAlreadyAutoOpened = false;

/** Test-only: clear the in-memory once-per-session guard. */
export function _resetFirstPaintHintForTest(): void {
  sessionAlreadyAutoOpened = false;
}

export interface FirstPaintHint {
  /** True iff this widget should auto-open its tooltip on mount. Always
   *  false for non-lab-head viewers, for non-first widgets, and after
   *  the first auto-open in this tab. */
  shouldAutoOpen: boolean;
  /** Stamp the sidecar with the current ISO timestamp. Idempotent — a
   *  second call after a successful first call no-ops at the in-memory
   *  guard layer (the sidecar write is still issued so the timestamp
   *  reflects the latest fire, but the guard means only the first
   *  caller actually observes `shouldAutoOpen = true`). */
  markSeen: () => void;
}

export function useFirstPaintHint(widgetId: string): FirstPaintHint {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const [shouldAutoOpen, setShouldAutoOpen] = useState(false);

  // Mira PI R1 fix manager (Fix 2, 2026-05-25): defer the auto-open
  // while the v4 walkthrough is actively running on /lab-overview.
  // Without this gate, a Mira who lands on /lab-overview mid-tour sees
  // BOTH the BeakerBot speech overlay AND the auto-opened tooltip
  // competing for first-paint attention.
  //
  // Signal: `useOptionalTourController()` returns null OUTSIDE a
  // `<TourControllerProvider>` (so members + non-onboarded users skip
  // this check entirely), and a non-null controller whose `currentStep`
  // is non-null + `paused` is false indicates the tour is mid-flight.
  // Once the tour completes / exits, currentStep flips to null on the
  // NEXT render pass and the gate releases — the hint hook re-runs its
  // effect and fires the auto-open if all other conditions still hold.
  const tourCtl = useOptionalTourController();
  const isTourActive =
    !!tourCtl && tourCtl.currentStep !== null && !tourCtl.paused;

  // The "first widget" id is read from the lab_head default canvas
  // layout — a user's customized order doesn't change which tile gets
  // the auto-open. Per the proposal: the hint should anchor to the
  // canonical first tile, not whichever tile the user happens to have
  // dragged to the top.
  const firstWidgetId = useMemo(() => {
    const layout = defaultLayoutFor("lab_head");
    return layout.widgetOrder.canvas[0] ?? null;
  }, []);

  useEffect(() => {
    // Non-lab-head viewers (members, solo) never see the auto-open.
    if (accountType !== "lab_head") return;
    if (!currentUser) return;
    // Only the canonical first widget gets the auto-open.
    if (widgetId !== firstWidgetId) return;
    // In-tab guard: if any tile already auto-opened this session, every
    // subsequent caller stays silent.
    if (sessionAlreadyAutoOpened) return;
    // Mira PI R1 fix manager (Fix 2): defer while the v4 walkthrough
    // is mid-flight. The effect re-runs when `isTourActive` flips
    // false (tour completed / exited), so the auto-open lands cleanly
    // on the next render pass after the tour overlay tears down.
    if (isTourActive) return;
    // Also defer when the wizard_resume_state is non-null. That field
    // is the canonical "tour is mid-flight or paused" signal in the
    // sidecar (cleared on natural completion via auto-cleanup, or on
    // skip via the wizard exit flow). The optional tour controller
    // check above covers the in-tab walkthrough provider; this
    // sidecar check covers the cross-tab + post-reload case where the
    // controller may have just mounted but hasn't read its initial
    // step yet.

    let cancelled = false;
    (async () => {
      try {
        const sidecar = await readOnboarding(currentUser);
        if (cancelled) return;
        const seen = sidecar.lab_overview_tooltips_seen_at;
        if (typeof seen === "string" && seen.length > 0) {
          // Already fired in a previous session — keep silent and pin
          // the in-tab guard so other tiles also skip.
          sessionAlreadyAutoOpened = true;
          return;
        }
        // Mira PI R1 fix manager (Fix 2): defer if the wizard is
        // mid-flight or in a resumable paused state. Doesn't pin the
        // session guard — the next /lab-overview mount AFTER the
        // wizard finalizes will land the auto-open cleanly.
        if (sidecar.wizard_resume_state !== null) return;
        // Defer if the wizard JUST completed within the last ~10
        // seconds. Gives the goodbye animation + toast time to play
        // out before the auto-open tooltip pops. Without this buffer
        // the tooltip can land while the user is reading the goodbye
        // toast, recreating the "competing for attention" conflict in
        // a different guise.
        if (typeof sidecar.wizard_completed_at === "string") {
          const completedMs = Date.parse(sidecar.wizard_completed_at);
          if (Number.isFinite(completedMs)) {
            const ageMs = Date.now() - completedMs;
            if (ageMs >= 0 && ageMs < WIZARD_COMPLETION_BUFFER_MS) return;
          }
        }
        if (sessionAlreadyAutoOpened) return;
        // Claim the auto-open before yielding to React; if two widgets
        // mount in the same tick, only the first to reach this branch
        // gets `shouldAutoOpen = true`.
        sessionAlreadyAutoOpened = true;
        setShouldAutoOpen(true);
      } catch (err) {
        // A failed sidecar read shouldn't poison the surface. Stay
        // silent and log so the failure is diagnosable.
        console.warn("[useFirstPaintHint] failed to read sidecar", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountType, currentUser, widgetId, firstWidgetId, isTourActive]);

  const markSeen = useMemo(() => {
    return () => {
      if (!currentUser) return;
      // Pin the in-tab guard first so a re-mount during the async
      // sidecar write can't sneak in a duplicate auto-open.
      sessionAlreadyAutoOpened = true;
      setShouldAutoOpen(false);
      void patchOnboarding(currentUser, (cur) => ({
        ...cur,
        lab_overview_tooltips_seen_at: new Date().toISOString(),
      })).catch((err) => {
        console.warn("[useFirstPaintHint] failed to mark seen", err);
      });
    };
  }, [currentUser]);

  return { shouldAutoOpen, markSeen };
}
