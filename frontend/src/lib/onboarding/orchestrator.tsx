"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import OnboardingTipCard from "@/components/OnboardingTipCard";
import OnboardingTutorialSequencer from "@/components/OnboardingTutorialSequencer";
import OnboardingWizard from "@/components/OnboardingWizard";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import {
  isDemoOrWikiCapture,
  isTutorialMode,
} from "@/lib/file-system/wiki-capture-mock";
import {
  getActiveSeconds,
  initActiveTime,
  stopActiveTime,
} from "./active-time";
import { isFreshUserForWizard } from "./is-fresh-user";
import {
  patchOnboarding,
  readOnboarding,
  setOnboardingMode as persistOnboardingMode,
  type OnboardingMode,
  type OnboardingSidecar,
  type TipOutcome,
} from "./sidecar";
import { patchUserSettings } from "@/lib/settings/user-settings";
import {
  ACTIVE_SECONDS_CAP,
  MIN_GAP_SECONDS,
  ONBOARDING_TIPS,
  ROLL_INTERVAL_MS,
  ROLL_PROBABILITY,
  ROUTE_DWELL_SECONDS,
  TIP_SHOWN_CAP,
  TUTORIAL_MIN_GAP_SECONDS,
  tipsForRoute,
  type OnboardingTip,
} from "./tips";
import { findOnboardingTarget } from "./use-onboarding-target";
import { subscribeTutorialSignal } from "@/lib/telegram/tutorial-signal";
import {
  clearTelegramTutorial,
  startTelegramTutorialStep,
} from "@/lib/telegram/tutorial-store";
import { cleanupTutorialTestPhotos } from "@/lib/telegram/tutorial-cleanup";

/**
 * The orchestrator that owns the tip state machine. It:
 *  - Loads the per-user sidecar on mount.
 *  - Starts the active-time tracker.
 *  - If the sidecar's `mode` is null (user hasn't picked yet), renders
 *    the welcome modal and blocks tip fires until the user picks.
 *  - If `mode === "silenced"`, no tips fire (same effect as `tips_off`).
 *  - If `mode === "tutorial"`, uses TUTORIAL_MIN_GAP_SECONDS (60s)
 *    cooldown and skips the random-roll gate — force-fires the highest-
 *    priority eligible tip each tick.
 *  - If `mode === "suggestions"`, the legacy behavior — 5min cooldown
 *    + 15% per-tick fire probability.
 *  - On every pathname change, records when the user landed on the
 *    route so we can apply the 30s "route dwell" gate before firing a
 *    tip targeting that route.
 *  - On action-cancel (the user does the thing the tip would have
 *    explained before the tip fires), persists `outcome: "action-cancel"`
 *    so the tip never re-fires.
 *  - Renders the active tip via portal through `<OnboardingTipCard>`.
 *
 * Hard guard: when `isDemoOrWikiCapture()` is true, the provider should
 * never have mounted us in the first place. We assert again on mount
 * so a stray render in a demo/wiki-capture branch is a no-op.
 */

interface OrchestratorContextValue {
  /** Mark a tip as cancelled because the user already did the thing.
   *  Persists `outcome: "action-cancel"` in the sidecar so the tip
   *  never fires again for this user. Safe to call before any sidecar
   *  read — the call will queue behind the in-flight read. */
  cancelTip: (tipId: string) => void;
  /** Dev-only: bypass every gate and render the named tip immediately.
   *  Polls for the target element for up to 3 seconds so the caller
   *  can navigate to the right route just before invoking (the route
   *  mount + ref attach can take a few hundred ms). Does NOT persist
   *  to the sidecar — the force-fire is a preview, not a real serve.
   *  No-op in demo/wiki-capture mode and when the tip id is unknown.
   *  Only intended for `<DevForceTipButton>` to call. */
  forceFireTip: (tipId: string) => void;
  /** Read-only snapshot of the sidecar for debug surfaces (settings,
   *  dev tools). May be null while the initial read is in flight. */
  sidecar: OnboardingSidecar | null;
  /** Persist a new welcome-mode pick. Used by the welcome modal's
   *  buttons; also exposed so Settings can let the user change her
   *  mind. */
  setMode: (mode: OnboardingMode) => Promise<void>;
}

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

interface OnboardingOrchestratorProps {
  username: string;
  children: ReactNode;
}

/** Probe the DOM for `WorkbenchExperimentsPanel`'s root data-attribute.
 *  The panel only mounts when the Workbench page's local `activeTab`
 *  state is `"experiments"`, so the presence of the attribute is the
 *  signal. Decoupled from Workbench's routing (no URL or store
 *  coupling) so a future Workbench redesign can change its tab
 *  routing without touching this gate. */
function isWorkbenchExperimentsTabActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[data-current-tab="experiments"]') !== null;
}

/** Extra eligibility predicate beyond `route`. Returns true if the tip
 *  has no gate, or if its gate is satisfied. */
function gatePasses(tip: OnboardingTip): boolean {
  if (!tip.gate) return true;
  if (tip.gate === "workbench-experiments-tab") {
    return isWorkbenchExperimentsTabActive();
  }
  return true;
}

export function OnboardingOrchestrator({
  username,
  children,
}: OnboardingOrchestratorProps) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  // Onboarding v2 Phase 2a (master flag #2 from CDP testing): when the
  // URL carries `?wizard-preview=1`, bypass the fresh-user + wizard-
  // state + active-tip gates so a testing agent (or a dev iterating on
  // the surface) can force-mount the wizard against any folder state.
  // The completion / skip handlers also no-op in preview mode so
  // nothing persists.
  const wizardPreviewMode = searchParams?.get("wizard-preview") === "1";
  // Local "dismissed" flag used only in preview mode. Toggled on by
  // the completion / skip handlers so the wizard visually unmounts
  // without writing anything. Real flow uses the sidecar-state gates
  // for the same purpose.
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const [sidecar, setSidecar] = useState<OnboardingSidecar | null>(null);
  const [activeTip, setActiveTip] = useState<OnboardingTip | null>(null);
  const [activeTarget, setActiveTarget] = useState<HTMLElement | null>(null);
  // Onboarding v2 Phase 1: fresh-user predicate result. null while the
  // probe is in flight; true if the user has no sidecar / settings /
  // metadata footprint (per isFreshUserForWizard), false otherwise.
  // Gates the wizard mount alongside sidecar.wizard_completed_at /
  // wizard_skipped_at. See `is-fresh-user.ts` for the predicate.
  const [isFreshUser, setIsFreshUser] = useState<boolean | null>(null);
  // Onboarding v2 Phase 2a: multi-user-folder detection. Probed once
  // on mount via discoverUsers(). Passed to the wizard so its step-2
  // → step-3 transition can seed `visibleTabs` with the /links
  // override (master lock 2026-05-20, Phase 0 refinement). Defaults to
  // false until the probe resolves — the wizard reads this only at
  // the transition, so the brief window between mount and probe is a
  // no-op for the seeding logic.
  const [isMultiUserFolder, setIsMultiUserFolder] = useState(false);

  // Active-seconds at which the user landed on the current route. Used
  // to enforce the 30s "route dwell" gate before any tip on this route
  // becomes eligible. Reset on every pathname change.
  const routeEnterActiveRef = useRef<number>(0);

  // ── Sidecar load + active-time start ──────────────────────────────
  useEffect(() => {
    // Demo / wiki-capture exemption. We're defensive — the provider
    // should already have refused to mount us, but a logic error there
    // shouldn't fire tips during a screenshot run.
    if (isDemoOrWikiCapture()) return;

    let cancelled = false;
    (async () => {
      await initActiveTime(username);
      // Phase 1: probe the fresh-user predicate in parallel with the
      // sidecar read so the wizard mount decision is settled by the
      // time both finish. The predicate is a pure read (no writes), so
      // running it before the sidecar exists is safe.
      // Phase 2a: also probe discoverUsers() for the multi-user-folder
      // /links default-on override on the wizard's step-3 seed. The
      // call is a directory listing, no writes.
      const [initial, fresh, users] = await Promise.all([
        readOnboarding(username),
        isFreshUserForWizard(username),
        discoverUsers().catch(() => [] as string[]),
      ]);
      if (cancelled) return;
      setSidecar(initial);
      setIsFreshUser(fresh);
      setIsMultiUserFolder(users.length > 1);
      routeEnterActiveRef.current = getActiveSeconds();
    })();

    return () => {
      cancelled = true;
      void stopActiveTime();
    };
  }, [username]);

  // ── Reset route-dwell baseline on every pathname change ───────────
  useEffect(() => {
    routeEnterActiveRef.current = getActiveSeconds();
    // Cancel any scheduled (but not-yet-fired) decisions on page leave.
    // Currently we don't pre-schedule — the roll tick decides on each
    // tick — but if a tip is on-screen and the user navigates, we let
    // it stay; the user can dismiss it. Proposal §"Page-leave cancels
    // scheduled" applies to scheduled-but-not-yet-fired tips, which is
    // a no-op in this orchestrator's "roll-and-fire" model.
  }, [pathname]);

  // ── Action-cancel API ─────────────────────────────────────────────
  const cancelTip = useCallback(
    (tipId: string) => {
      if (isDemoOrWikiCapture()) return;
      if (!ONBOARDING_TIPS.some((t) => t.id === tipId)) return;
      void (async () => {
        const next = await patchOnboarding(username, (cur) => {
          // Already recorded — leave it alone.
          if (cur.tips[tipId]) return cur;
          return {
            ...cur,
            tips: {
              ...cur.tips,
              [tipId]: {
                shown_at: null,
                dismissed_at: new Date().toISOString(),
                outcome: "action-cancel",
              },
            },
          };
        });
        setSidecar(next);
      })();
    },
    [username],
  );

  // ── Persistence: mark a tip as displayed (no dismiss yet) ─────────
  const recordShown = useCallback(
    async (tipId: string) => {
      const nowIso = new Date().toISOString();
      const next = await patchOnboarding(username, (cur) => {
        // Already recorded — leave alone (e.g. cancelTip beat us here).
        if (cur.tips[tipId]) return cur;
        return {
          ...cur,
          tips: {
            ...cur.tips,
            [tipId]: {
              shown_at: nowIso,
              dismissed_at: null,
              outcome: "x", // placeholder; overwritten on dismiss
            },
          },
          last_tip_at: getActiveSeconds(),
          shown_count: cur.shown_count + 1,
        };
      });
      setSidecar(next);
    },
    [username],
  );

  // ── Persistence: finalize the dismiss outcome ────────────────────
  const recordOutcome = useCallback(
    async (tipId: string, outcome: TipOutcome, tipsOffOverride?: boolean) => {
      const nowIso = new Date().toISOString();
      const next = await patchOnboarding(username, (cur) => {
        const existing = cur.tips[tipId];
        const tips = {
          ...cur.tips,
          [tipId]: {
            shown_at: existing?.shown_at ?? nowIso,
            dismissed_at: nowIso,
            outcome,
          },
        };
        return {
          ...cur,
          tips,
          tips_off:
            tipsOffOverride !== undefined ? tipsOffOverride : cur.tips_off,
        };
      });
      setSidecar(next);
    },
    [username],
  );

  // ── Mode setter (welcome modal + Settings + /tutorial) ────────────
  const setMode = useCallback(
    async (mode: OnboardingMode) => {
      if (isDemoOrWikiCapture()) return;
      try {
        const next = await persistOnboardingMode(username, mode);
        setSidecar(next);
        // Reset route-dwell baseline so the first tip after mode pick
        // can fire without waiting another 30s of focused dwell on
        // the current route. The dwell gate is
        //   `now - routeEnterActiveRef.current < ROUTE_DWELL_SECONDS`
        // so we need the ref to be at least ROUTE_DWELL_SECONDS in
        // the past relative to current active_seconds. A brand-new
        // user with active_seconds≈5 and a baseline of 0 still fails
        // (5 - 0 < 30); -999_999 unconditionally satisfies. Cooldown
        // is already bypassed by setOnboardingMode's
        // `last_tip_at = active_seconds - 999_999` sentinel. Combined,
        // the first eligible tip fires within one roll tick (≤5s) of
        // mode pick.
        routeEnterActiveRef.current = -999_999;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[onboarding] setMode failed", err);
      }
    },
    [username],
  );

  // ── Cross-tab tutorial signal subscriber ──────────────────────────
  // Two signals matter to the orchestrator (which runs in the user's
  // REAL ResearchOS tab, not the demo tab):
  //
  //  1. `trigger-tutorial-modal` — fired by the bot's `/tutorial`
  //     command. Flip `mode` back to null so the welcome modal
  //     re-opens; the user can click "Walk me through it" again.
  //  2. `tutorial-state` — fired by the demo tab's sequencer to put
  //     the polling tab's `_telegram_tutorial.json` sidecar into the
  //     right shape so the bot's per-photo reply uses tutorial copy.
  //     The demo tab can't write that sidecar itself (its mock
  //     fileService is in-memory), so this hand-off pattern is the
  //     only way to get state from "tutorial sequencer running" to
  //     "polling loop reading tutorial flag."
  //
  // Demo / wiki-capture mode short-circuits both branches: the demo
  // tab doesn't own the user's mode pick, and its mock fileService
  // can't write the real sidecar.
  useEffect(() => {
    if (isDemoOrWikiCapture()) return;
    if (!sidecar) return;
    const unsubscribe = subscribeTutorialSignal((signal) => {
      if (signal.type === "trigger-tutorial-modal") {
        if (sidecar.mode === null) return; // modal already open
        void setMode(null);
        return;
      }
      if (signal.type === "tutorial-state") {
        if (signal.step === null) {
          void clearTelegramTutorial(username);
          // Tutorial ended (advance past first-photo, skip, End, unmount,
          // 90s timeout). Sweep the inbox for any test photos the user
          // sent during the tour. Inbox-only by design — see
          // lib/telegram/tutorial-cleanup.ts.
          void cleanupTutorialTestPhotos(username);
        } else {
          void startTelegramTutorialStep(username, signal.step);
        }
        return;
      }
      // photo-arrived: orchestrator doesn't react (the demo tab's
      // sequencer is the listener for that one).
    });
    return unsubscribe;
  }, [sidecar, setMode, username]);

  // ── Roll loop ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isDemoOrWikiCapture()) return;
    if (!sidecar) return;
    if (activeTip) return; // one tip at a time, roll is suspended
    // Welcome modal blocks until the user picks a mode.
    if (sidecar.mode === null) return;
    // Silenced behaves like the legacy tips_off — no tips ever.
    if (sidecar.mode === "silenced") return;
    if (sidecar.tips_off) return;
    if (sidecar.shown_count >= TIP_SHOWN_CAP) return;
    if (sidecar.active_seconds >= ACTIVE_SECONDS_CAP) return;

    const isTutorial = sidecar.mode === "tutorial";
    const minGap = isTutorial ? TUTORIAL_MIN_GAP_SECONDS : MIN_GAP_SECONDS;

    const roll = () => {
      const now = getActiveSeconds();
      // Cooldown.
      if (now - sidecar.last_tip_at < minGap) return;
      // Route dwell.
      if (now - routeEnterActiveRef.current < ROUTE_DWELL_SECONDS) return;
      // Eligibility — sorted by priority. Also apply per-tip gates.
      const candidates = tipsForRoute(pathname).filter((tip) => {
        if (!gatePasses(tip)) return false;
        const rec = sidecar.tips[tip.id];
        // Any prior record (shown, dismissed, or action-cancel) disqualifies.
        // Exception: "later" outcome leaves the tip eligible to re-fire
        // next session.
        if (!rec) return true;
        return rec.outcome === "later" && !isSameSession(rec.dismissed_at);
      });
      if (candidates.length === 0) return;
      // Tutorial mode skips the random gate — force-fire the highest-
      // priority candidate. Suggestions mode keeps the 15% roll so the
      // tip lands at a natural pause.
      if (!isTutorial && Math.random() >= ROLL_PROBABILITY) return;
      // Find the first candidate with a present DOM target. Pass
      // `tip.target` (the data-attr value) — NOT `tip.id` — because
      // they're not always the same string (e.g. goals-vs-tasks
      // targets create-goal).
      for (const tip of candidates) {
        const el = findOnboardingTarget(tip.target);
        if (!el) continue;
        setActiveTip(tip);
        setActiveTarget(el);
        // Record shown_at immediately so a refresh mid-display doesn't
        // re-fire the same tip; outcome filled in on dismiss.
        void recordShown(tip.id);
        return;
      }
    };

    const handle = window.setInterval(roll, ROLL_INTERVAL_MS);
    return () => {
      window.clearInterval(handle);
    };
  }, [sidecar, pathname, activeTip, recordShown]);

  // ── Dev-only: force a specific tip to fire, polling for its target ──
  const forceFireTip = useCallback((tipId: string) => {
    if (isDemoOrWikiCapture()) return;
    const tip = ONBOARDING_TIPS.find((t) => t.id === tipId);
    if (!tip) return;

    let cancelled = false;
    let tries = 0;
    const maxTries = 30; // 3 seconds at 100ms intervals
    const tryFire = () => {
      if (cancelled) return;
      // Look up by `tip.target` (the data-attr value), NOT `tipId`
      // — they're not always the same string (e.g. goals-vs-tasks
      // targets create-goal).
      const el = findOnboardingTarget(tip.target);
      if (el) {
        setActiveTip(tip);
        setActiveTarget(el);
        // Deliberately do NOT recordShown — the dev preview should not
        // mark the tip served for this user. Sidecar state is preserved.
        return;
      }
      tries += 1;
      if (tries < maxTries) {
        window.setTimeout(tryFire, 100);
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[onboarding] forceFireTip: target for "${tipId}" never appeared in DOM after 3s`,
        );
      }
    };
    tryFire();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = useCallback(
    (outcome: "x" | "later" | "stop" | "got-it" | "read") => {
      if (!activeTip) return;
      const tipId = activeTip.id;
      setActiveTip(null);
      setActiveTarget(null);
      const mapped: TipOutcome =
        outcome === "stop"
          ? "x"
          : outcome === "got-it"
            ? "got-it"
            : outcome === "read"
              ? "read"
              : outcome;
      void recordOutcome(tipId, mapped, outcome === "stop" ? true : undefined);
    },
    [activeTip, recordOutcome],
  );

  // ── Onboarding v2 Phase 1/2a: wizard completion + skip handlers ──
  // The OnboardingWizard component does NOT write to the sidecar or
  // settings.json itself; it surfaces onComplete / onSkip and the
  // orchestrator owns the persistence. Both handlers also seed
  // `mode: "suggestions"` if mode is still null so tips can fire
  // post-wizard (the roll loop's `mode === null` gate is the same
  // gate the v1 welcome modal blocked tips with, and it's intentionally
  // unchanged for Phase 1).
  //
  // Phase 2a: `result` expands from `string[]` (just useCases) to
  // `{ useCases, visibleTabs, otherUseCase }`. The wizard's step-3
  // tab toggles are now authoritative — we write `result.visibleTabs`
  // verbatim rather than recomputing via `tabsForUseCases()`. The
  // step-3 seed is initialized from `seedVisibleTabsForStep3()` so the
  // no-touch case still lands at the locked default.
  //
  // Phase 2c: `result` further expands with the three integration-step
  // decisions (telegram / calendar / ai_helper). Each is undefined when
  // the user never made a decision (shouldn't happen on step-7
  // completion since steps 4-6 record on every exit path, but defensive
  // — undefined coerces to null on persistence). These land in the
  // sidecar's additive v3 decision fields so future surfaces can read
  // what the user picked.
  const handleWizardComplete = useCallback(
    (result: {
      useCases: string[];
      visibleTabs: string[];
      otherUseCase?: string;
      telegramDecision?: "paired" | "later" | "skipped";
      calendarDecision?: "added" | "later";
      aiHelperDecision?: "copied" | "later";
    }) => {
      // Phase 2a master flag #2: in preview mode, the wizard renders
      // and is fully interactive but nothing persists. Just unmount.
      if (wizardPreviewMode) {
        setPreviewDismissed(true);
        return;
      }
      void (async () => {
        // Settings write first: visibleTabs from the wizard's step-3
        // toggles (authoritative). Wrap in try/catch so a settings-
        // write failure does NOT block wizard completion (the sidecar
        // write below is the source of truth for "wizard done";
        // visibleTabs is a polish).
        try {
          await patchUserSettings(username, {
            visibleTabs: result.visibleTabs,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[onboarding] wizard complete: visibleTabs write failed", err);
        }
        // Sidecar write: use_cases + other_use_case + wizard_completed_at
        // + seed mode + the three Phase 2c integration decisions. The
        // `cur.mode ?? "suggestions"` guard means re-runs (Phase 4) that
        // already have a mode picked don't clobber the user's earlier
        // Settings → Tips choice. Decisions coerce undefined → null so
        // a partial wizard run (defensive — shouldn't happen on a real
        // step-7 completion) still persists cleanly.
        const trimmedOther = result.otherUseCase?.trim() ?? "";
        const next = await patchOnboarding(username, (cur) => ({
          ...cur,
          use_cases: result.useCases,
          other_use_case: trimmedOther.length > 0 ? trimmedOther : null,
          wizard_completed_at: new Date().toISOString(),
          telegram_decision: result.telegramDecision ?? null,
          calendar_decision: result.calendarDecision ?? null,
          ai_helper_decision: result.aiHelperDecision ?? null,
          mode: cur.mode ?? "suggestions",
        }));
        setSidecar(next);
        // Reset route-dwell baseline so the first post-wizard tip can
        // fire without waiting another 30s of dwell on the current
        // route. Mirrors the v1 setMode() pattern for the welcome
        // modal pick. See setMode() above for the rationale.
        routeEnterActiveRef.current = -999_999;
      })();
    },
    [username, wizardPreviewMode],
  );

  // Onboarding v2 Phase 2b: stable no-op consumer for the wizard's
  // `onUseCasesChange` prop. The wizard fires this every time the
  // step-2 chip-toggle handler mutates `wizardData.useCases`. Phase
  // 2b doesn't react to it; analytics + pre-fetch hooks land in
  // Phase 2c. Stable via `useCallback` with an empty deps array so
  // the wizard's `toggleUseCase` callback identity doesn't churn
  // every render.
  const handleUseCasesChange = useCallback((_useCases: string[]) => {
    /* Phase 2b: no-op. Phase 2c may subscribe. */
  }, []);

  const handleWizardSkip = useCallback(() => {
    if (wizardPreviewMode) {
      setPreviewDismissed(true);
      return;
    }
    void (async () => {
      // Skip writes wizard_skipped_at only. By master's lock
      // (2026-05-20), use_cases stays null on skip; the null-vs-empty-
      // array distinction encodes "skipped" vs "submitted with no
      // picks". visibleTabs is left at the user's defaults
      // (DEFAULT_SETTINGS.visibleTabs is all tabs) on skip.
      const next = await patchOnboarding(username, (cur) => ({
        ...cur,
        wizard_skipped_at: new Date().toISOString(),
        mode: cur.mode ?? "suggestions",
      }));
      setSidecar(next);
      // Reset route-dwell baseline (same rationale as the completion
      // handler — skipped users should still see a first tip promptly).
      routeEnterActiveRef.current = -999_999;
    })();
  }, [username, wizardPreviewMode]);

  const value = useMemo<OrchestratorContextValue>(
    () => ({ cancelTip, forceFireTip, sidecar, setMode }),
    [cancelTip, forceFireTip, sidecar, setMode],
  );

  // Onboarding v2 Phase 1: wizard mount gate. Replaces the v1
  // OnboardingWelcomeModal entirely (the v1 component file stays on
  // disk per the Phase 1 brief; only its mount path here retires).
  //
  // The wizard fires for fresh users only: no prior sidecar /
  // settings / metadata footprint (isFreshUserForWizard()), AND the
  // sidecar's wizard_completed_at / wizard_skipped_at are both null.
  // The active-tip gate is belt-and-suspenders (a force-fire shouldn't
  // race the initial wizard mount, but if it does we'd rather show
  // the tip than double-stack the surface).
  //
  // Master locks pinned by this gate:
  //  - "Existing users skip the wizard automatically and load their
  //    profile" (onboarding v2 brief Phase 0).
  //  - The v1 welcome modal retires (onboarding v2 brief Phase 1).
  //  - use_cases stays null on skip vs. an empty array on
  //    submitted-with-no-picks (master lock 2026-05-20).
  //
  // Phase 2a master flag #2: when the URL carries `?wizard-preview=1`,
  // bypass every gate so a testing agent can force-mount the wizard
  // against any folder state. `previewDismissed` lets the wizard's
  // own Complete / Skip handlers visually unmount without persisting
  // anything (the handlers themselves no-op in preview mode).
  const showWizard = wizardPreviewMode
    ? !previewDismissed
    : sidecar !== null &&
      isFreshUser === true &&
      sidecar.wizard_completed_at === null &&
      sidecar.wizard_skipped_at === null &&
      activeTip === null;

  return (
    <OrchestratorContext.Provider value={value}>
      {children}
      {activeTip && (
        <OnboardingTipCard
          tip={activeTip}
          target={activeTarget}
          onClose={handleDismiss}
        />
      )}
      {showWizard && (
        <OnboardingWizard
          username={username}
          isMultiUserFolder={isMultiUserFolder}
          onComplete={handleWizardComplete}
          onSkip={handleWizardSkip}
          previewMode={wizardPreviewMode}
          onUseCasesChange={handleUseCasesChange}
        />
      )}
    </OrchestratorContext.Provider>
  );
}

/** Hook: returns the orchestrator context if a provider is mounted,
 *  otherwise null. Components in demo / wiki-capture mode never see a
 *  provider — they get null and should no-op. */
export function useOnboarding(): OrchestratorContextValue | null {
  return useContext(OrchestratorContext);
}

/**
 * Top-level provider that decides what onboarding surface (if any) to
 * mount. Decision matrix:
 *  - `!currentUser` → pass-through (no signed-in user, no orchestrator).
 *  - demo/wiki-capture mode AND a non-null tutorial mode (`?tutorial=1`
 *    for the full intro tour, `?tutorial=telegram` for the standalone
 *    Telegram walkthrough) → mount the Phase-4
 *    `<OnboardingTutorialSequencer>` so the guided tour can run
 *    against the demo lab's seeded data. Real tabs land at
 *    `/demo?tutorial=1` from the welcome modal or
 *    `/demo?tutorial=telegram` from the Settings "Set up Telegram"
 *    button. The sequencer itself reads `getTutorialMode()` to pick
 *    which steps to walk.
 *  - demo/wiki-capture mode without any tutorial mode → pass-through
 *    (screenshots and the public demo never see real onboarding tips).
 *  - everything else → mount the normal `<OnboardingOrchestrator>`.
 *
 * Mirrors the existing `if (isDemoOrWikiCapture() && currentUser)`
 * short-circuit pattern in `providers.tsx` with the tutorial-tab
 * carve-out wired in.
 */
export function OnboardingProvider({
  currentUser,
  children,
}: {
  currentUser: string | null;
  children: ReactNode;
}) {
  // Re-evaluate on currentUser change. If currentUser flips to null
  // (sign-out), we unmount the orchestrator entirely — which flushes
  // the active-time tracker via its cleanup.
  if (!currentUser) return <>{children}</>;
  if (isDemoOrWikiCapture()) {
    if (isTutorialMode()) {
      return (
        <>
          {children}
          <OnboardingTutorialSequencer />
        </>
      );
    }
    return <>{children}</>;
  }
  return (
    <OnboardingOrchestrator username={currentUser}>
      {children}
    </OnboardingOrchestrator>
  );
}

/** True if `dismissedAtIso` falls in the current page-load session.
 *  Best-effort — we approximate "same session" as <1h ago since we have
 *  no explicit session-id surface. The orchestrator only consults this
 *  for `outcome: "later"` records, so worst-case the user sees a
 *  same-day re-fire of a later-deferred tip, which is consistent with
 *  Grant's "re-fire on next session" framing. */
function isSameSession(dismissedAtIso: string | null): boolean {
  if (!dismissedAtIso) return false;
  const then = Date.parse(dismissedAtIso);
  if (Number.isNaN(then)) return false;
  return Date.now() - then < 60 * 60 * 1000;
}
