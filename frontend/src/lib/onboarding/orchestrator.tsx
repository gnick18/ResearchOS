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
import { usePathname } from "next/navigation";
import OnboardingTipCard from "@/components/OnboardingTipCard";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import {
  getActiveSeconds,
  initActiveTime,
  stopActiveTime,
} from "./active-time";
import {
  patchOnboarding,
  readOnboarding,
  type OnboardingSidecar,
  type TipOutcome,
} from "./sidecar";
import {
  ACTIVE_SECONDS_CAP,
  MIN_GAP_SECONDS,
  ONBOARDING_TIPS,
  ROLL_INTERVAL_MS,
  ROLL_PROBABILITY,
  ROUTE_DWELL_SECONDS,
  TIP_SHOWN_CAP,
  tipsForRoute,
  type OnboardingTip,
} from "./tips";
import { findOnboardingTarget } from "./use-onboarding-target";

/**
 * The orchestrator that owns the tip state machine. It:
 *  - Loads the per-user sidecar on mount.
 *  - Starts the active-time tracker.
 *  - On every pathname change, records when the user landed on the
 *    route so we can apply the 30s "route dwell" gate before firing a
 *    tip targeting that route.
 *  - Every 5 seconds, rolls a 15% probability to fire the
 *    highest-priority eligible tip — if the cooldown has elapsed, the
 *    user is on a matching route, and the target element is in the DOM.
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
}

const OrchestratorContext = createContext<OrchestratorContextValue | null>(null);

interface OnboardingOrchestratorProps {
  username: string;
  children: ReactNode;
}

export function OnboardingOrchestrator({
  username,
  children,
}: OnboardingOrchestratorProps) {
  const pathname = usePathname() ?? "/";
  const [sidecar, setSidecar] = useState<OnboardingSidecar | null>(null);
  const [activeTip, setActiveTip] = useState<OnboardingTip | null>(null);
  const [activeTarget, setActiveTarget] = useState<HTMLElement | null>(null);

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
      const initial = await readOnboarding(username);
      if (cancelled) return;
      setSidecar(initial);
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

  // ── Roll loop ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isDemoOrWikiCapture()) return;
    if (!sidecar) return;
    if (activeTip) return; // one tip at a time — roll is suspended
    if (sidecar.tips_off) return;
    if (sidecar.shown_count >= TIP_SHOWN_CAP) return;
    if (sidecar.active_seconds >= ACTIVE_SECONDS_CAP) return;

    const roll = () => {
      const now = getActiveSeconds();
      // Cooldown.
      if (now - sidecar.last_tip_at < MIN_GAP_SECONDS) return;
      // Route dwell.
      if (now - routeEnterActiveRef.current < ROUTE_DWELL_SECONDS) return;
      // Eligibility — sorted by priority.
      const candidates = tipsForRoute(pathname).filter((tip) => {
        const rec = sidecar.tips[tip.id];
        // Any prior record (shown, dismissed, or action-cancel) disqualifies.
        // Exception: "later" outcome leaves the tip eligible to re-fire
        // next session, but we track that by also clearing the record on
        // the "later" path (recordOutcome does NOT delete; instead we
        // skip "later"-tagged tips here unless we want next-session
        // re-fire — see proposal: "later means re-fire eligible next
        // session").
        if (!rec) return true;
        return rec.outcome === "later" && !isSameSession(rec.dismissed_at);
      });
      if (candidates.length === 0) return;
      // Random fire decision.
      if (Math.random() >= ROLL_PROBABILITY) return;
      // Find the first candidate with a present DOM target.
      for (const tip of candidates) {
        const el = findOnboardingTarget(tip.id);
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
      const el = findOnboardingTarget(tipId);
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

  const value = useMemo<OrchestratorContextValue>(
    () => ({ cancelTip, forceFireTip, sidecar }),
    [cancelTip, forceFireTip, sidecar],
  );

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
 * Top-level provider that decides whether to mount the orchestrator at
 * all. Mounts only when:
 *  - `!isDemoOrWikiCapture()` (the system is exempt in demo + wiki-capture)
 *  - `currentUser` is set
 *
 * Pass-through (children-only render) in every other case. This mirrors
 * the existing `if (isDemoOrWikiCapture() && currentUser)` short-circuit
 * pattern in `providers.tsx`.
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
  if (isDemoOrWikiCapture()) return <>{children}</>;
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
