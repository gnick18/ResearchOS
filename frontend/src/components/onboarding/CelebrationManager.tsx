"use client";

import { useCallback, useEffect, useState } from "react";
import BeakerBotEurekaScene from "@/components/BeakerBotEurekaScene";
import BeakerBotLadderScene from "@/components/BeakerBotLadderScene";
import BeakerBotMouseWaveScene from "@/components/BeakerBotMouseWaveScene";
import BeakerBotSkateboardScene from "@/components/BeakerBotSkateboardScene";
import BeakerBotTooManyBeakersScene from "@/components/BeakerBotTooManyBeakersScene";
import BeakerBotTwirlScene from "@/components/BeakerBotTwirlScene";
import {
  evaluatePendingCelebrations,
  markCelebrationSeen,
  type PendingCelebration,
} from "@/lib/streak/milestone-scheduler";
import { onStreakMilestoneCrossed } from "@/lib/streak/streak-activity-tracker";
import { useOptionalTourController } from "@/components/onboarding/v4/TourController";
import { useBeakerBotAnimations } from "@/hooks/useBeakerBotAnimations";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import BeakerBotPoseCelebrationScene from "./BeakerBotPoseCelebrationScene";

/**
 * Onboarding S6: CelebrationManager.
 *
 * Owns the per-session celebration queue: which milestones have been
 * earned but not yet seen, and which scene to render next. Sits as a
 * peer to the TourControllerProvider in `lib/providers.tsx` so a tour
 * and a milestone celebration don't fight for the bottom-right corner.
 *
 * Lifecycle:
 *  1. On mount (or username change), call evaluatePendingCelebrations
 *     and seed the queue with whatever the user has earned offline.
 *  2. Subscribe to onStreakMilestoneCrossed so live tick-driven
 *     milestones (S1 events) append to the queue as they fire.
 *  3. Drain the queue ONE AT A TIME, randomly picking from the
 *     CELEBRATION_POOL (§6.7). The pick is NOT persisted; re-firing
 *     via "Reset celebrations seen" (S3) yields a fresh random pick.
 *  4. On scene onComplete, persist the seen-tag via
 *     markCelebrationSeen and advance the queue.
 *  5. Limit ONE celebration per session. Once the first scene has
 *     completed, the manager refuses to render any more this session;
 *     remaining queued items wait until the next app load (where they
 *     resurface via step 1).
 *  6. Defer when a tour is active. The bottom-right corner is the
 *     tour's primary mascot anchor; we wait for tourMode to flip back
 *     to null before starting a celebration. Subscribe to controller
 *     state by reading the context value each render (React re-renders
 *     the manager whenever the context value changes), so no polling
 *     is needed.
 *
 * Daily hello (beakerbot-joy manager): on top of the rare milestone /
 * anniversary celebrations, the manager greets EVERY real user with a
 * light mouseWave "Hi!" once on their first load of the day. Real
 * milestones take priority; the hello fires only when the milestone
 * queue is empty. dedup is per-user per-day in localStorage (NOT the
 * streak sidecar). The hello respects the same tour / capture deferrals
 * as milestones and is suppressed alongside them by the per-user
 * `beakerBotAnimations` opt-out (Settings → Animation).
 *
 * No props beyond `username`: the active username is the source of
 * truth for which sidecar to read, and the username can change
 * mid-app-lifetime (sign out, switch user).
 *
 * When username is null (no signed-in user yet, demo / wiki-capture
 * mode, picker screen), the manager renders nothing and does nothing.
 * The daily hello is additionally guarded against capture / demo
 * fixture mode (the v4 preview screenshot path mounts the full tree
 * inside demo mode) and never fires during the v4 onboarding tour.
 */

// --------------------------------------------------------------------
// Celebration scene pool (proposal §6.7, RESOLVED 2026-05-21;
// skateboard + tooManyBeakers added per Grant 2026-05-25)
// --------------------------------------------------------------------

/**
 * The eight-scene random pool. Bug-stomp and centrifuge remain
 * EXCLUDED: they fire in their own contexts and don't carry a
 * celebratory tone.
 *
 * Per Grant (2026-05-25), skateboard and too-many-beakers were
 * promoted into the pool alongside the original six. Too-many-beakers
 * leans slapstick rather than triumphant; it ships in the celebration
 * pool per explicit direction and may be revisited later if it reads
 * tonally off.
 *
 * Five multi-stage scenes (ladder, eureka, mouseWave, skateboard,
 * tooManyBeakers) and three pose-only scenes (volcano-eruption,
 * cheering, bouncing). The pose entries are wrapped by
 * BeakerBotPoseCelebrationScene to share the `{ active, onComplete }`
 * interface; the manager doesn't need to special-case scene vs pose
 * at the call site.
 */
export type CelebrationScene =
  | { type: "scene"; component: "ladder" }
  | { type: "scene"; component: "eureka" }
  | { type: "scene"; component: "mouseWave" }
  | { type: "scene"; component: "skateboard" }
  | { type: "scene"; component: "tooManyBeakers" }
  | { type: "pose"; pose: "volcano-eruption" }
  | { type: "pose"; pose: "cheering" }
  | { type: "pose"; pose: "bouncing" };

/**
 * The streak milestone tag whose FIRST-ever celebration is rendered as
 * the BeakerBot twirl (twirl-milestones bot) rather than a random pool
 * scene. The product team wanted the twirl to mark the first 7-day
 * streak, but that milestone already fires a corner celebration through
 * this manager. Routing the twirl HERE (as the scene for the `7d`
 * streak milestone) guarantees exactly ONE celebration plays for the
 * streak (no double-fire), while the existing `celebrations_seen
 * .streak_milestones` sidecar provides the once-ever dedup and the
 * existing opt-out / tour-deferral gates already apply. Higher streak
 * tags (14d, 30d, ...) keep the random pool. The standalone
 * useMilestoneTwirlTrigger hook deliberately does NOT handle the streak
 * for the same reason.
 */
export const TWIRL_STREAK_TAG = "7d";

export const CELEBRATION_POOL: ReadonlyArray<CelebrationScene> = [
  { type: "scene", component: "ladder" },
  { type: "scene", component: "eureka" },
  { type: "scene", component: "mouseWave" },
  { type: "scene", component: "skateboard" },
  { type: "scene", component: "tooManyBeakers" },
  { type: "pose", pose: "volcano-eruption" },
  { type: "pose", pose: "cheering" },
  { type: "pose", pose: "bouncing" },
];

/** Pick a random entry from the pool. Math.random() is fine here:
 *  this is a UI-flavor selector, not a security boundary. Exposed for
 *  tests that want to assert distribution. */
export function pickRandomCelebration(
  pool: ReadonlyArray<CelebrationScene> = CELEBRATION_POOL,
): CelebrationScene {
  if (pool.length === 0) {
    // Defensive: an empty pool would be a programming error (the
    // module-level constant is non-empty). Fall back to the cheering
    // pose so the caller still gets a renderable scene rather than a
    // crash.
    return { type: "pose", pose: "cheering" };
  }
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? pool[0];
}

// --------------------------------------------------------------------
// Daily hello (beakerbot-joy manager)
// --------------------------------------------------------------------
//
// Grant's brief: "BeakerBot saying hi and waving on first load in for a
// day is super cute and should happen for everyone." The pre-existing
// celebration system only fired on rare numeric milestones (3d / 7d
// streaks) or account anniversaries (1w / 1mo / ...). The mouseWave
// "Hi!" scene was just one of eight random pool members, so a typical
// user almost never saw BeakerBot wave. This adds a light once-per-day
// greeting that forces the mouseWave scene for EVERY real user on their
// first load of the day.
//
// Dedup is per-user, per-day in localStorage (NOT the streak sidecar):
// the brief explicitly forbids a new data-shape, and flavor-only
// once-per-X locks already follow the localStorage/sessionStorage
// `researchOS.*` convention (see IdleAnimationManager's
// IDLE_FIRED_SESSION_KEY). localStorage (not session) so a reload later
// the same day does not re-fire, but a fresh calendar day does.

/** localStorage key holding the ISO date (YYYY-MM-DD) of the last day
 *  the daily hello fired for this user. Per-user so a shared browser
 *  with two accounts greets each account once on their respective
 *  first load of the day. */
function helloDateKey(username: string): string {
  return `researchOS.beakerHello.${username}.lastDate`;
}

/** Today's local-time date as ISO YYYY-MM-DD. Matches the streak
 *  system's day-boundary convention (local midnight). */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** True if the daily hello has NOT yet fired for `username` today.
 *  SSR-safe + try/catch for private-mode/quota: on any storage error
 *  we return false (skip the hello) so a broken storage layer can never
 *  spam the wave on every reload. */
function helloPendingToday(username: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(helloDateKey(username)) !== todayIso();
  } catch {
    return false;
  }
}

/** Record that the daily hello fired for `username` today. Best-effort:
 *  a storage failure just means the in-memory session lock still blocks
 *  a repeat fire this mount. */
function markHelloFiredToday(username: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(helloDateKey(username), todayIso());
  } catch {
    // Quota exceeded / private mode: the sessionLocked flag below still
    // prevents a second fire for the lifetime of this mount.
  }
}

// --------------------------------------------------------------------
// Component
// --------------------------------------------------------------------

interface CelebrationManagerProps {
  username: string | null;
}

/**
 * The active slot is a discriminated union: a sidecar-backed milestone /
 * anniversary celebration (which persists a seen-tag on completion via
 * markCelebrationSeen) OR the daily hello (a flavor-only mouseWave whose
 * dedup lives in localStorage, never the streak sidecar — see the
 * daily-hello section above and the "no new data-shape" brief constraint).
 */
type ActiveCelebration =
  | { kind: "milestone"; celebration: PendingCelebration; scene: CelebrationScene }
  | { kind: "hello" };

export default function CelebrationManager({ username }: CelebrationManagerProps) {
  const [queue, setQueue] = useState<PendingCelebration[]>([]);
  const [active, setActive] = useState<ActiveCelebration | null>(null);
  // Whether the once-per-day hello is still pending for this user. Seeded
  // false; the mount effect flips it true when localStorage says the
  // hello has not yet fired today (and the user / context allows it).
  const [helloPending, setHelloPending] = useState(false);
  // One-per-session lock. Flips to true the moment a celebration
  // begins rendering, and stays true for the lifetime of the
  // component mount. Re-mounts (next app load) reset it.
  const [sessionLocked, setSessionLocked] = useState(false);

  // The tour controller may or may not be mounted depending on where
  // the manager renders. useOptionalTourController returns null when
  // no provider is in the tree, in which case we treat the tour as
  // inactive (the manager fires normally).
  const tour = useOptionalTourController();
  const tourActive = tour !== null && tour.tourMode !== null;

  // BeakerBot-animations opt-out (beakerbot-joy manager). `undefined`
  // while the read is in flight, `false` when the user turned it off,
  // `true` (the default) otherwise. We hold off draining ANY celebration
  // until this resolves so a quieter user never sees a stray fire on a
  // slow disk read.
  const beakerBotAnimations = useBeakerBotAnimations(username);

  // Capture-mode guard (wikiCapture / public /demo fixture). The manager
  // is structurally absent from those branches in providers.tsx, but the
  // v4 preview/screenshot path (?wizardSeedStep) mounts the full tree
  // INSIDE demo mode, so guard here too: fixture screenshots must never
  // catch a stray wave. Computed once per render (the value is stable for
  // the tab's lifetime).
  const captureMode = isDemoOrWikiCapture();

  // ------- Step 1: seed the queue on mount / username change ---------
  //
  // Read the streak sidecar + user metadata, compute pending
  // celebrations, and seed the queue. Failures are logged but don't
  // break the app. A missing or corrupt sidecar means no
  // celebrations this session.
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    void (async () => {
      try {
        const pending = await evaluatePendingCelebrations(username);
        if (cancelled) return;
        if (pending.length > 0) {
          setQueue((prev) => mergeUnique(prev, pending));
        }
      } catch (err) {
        console.warn(
          "[CelebrationManager] evaluatePendingCelebrations failed:",
          err,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // ------- Step 2: subscribe to live milestone events ----------------
  //
  // The S1 tracker emits an event each time current_count crosses a
  // threshold for the first time. We translate the event into a
  // PendingCelebration and append to the queue. Only events for the
  // currently-signed-in username are accepted (the tracker emits the
  // username on every event so this filter is straightforward).
  useEffect(() => {
    if (!username) return;
    const unsubscribe = onStreakMilestoneCrossed((event) => {
      if (event.username !== username) return;
      const celebration: PendingCelebration = {
        kind: "streak_milestone",
        tag: event.tag,
        count: event.count,
      };
      setQueue((prev) => mergeUnique(prev, [celebration]));
    });
    return unsubscribe;
  }, [username]);

  // ------- Daily hello seed (beakerbot-joy manager) -----------------
  //
  // On mount / username change, decide whether to greet the user with
  // the once-per-day hello wave. Fires for EVERY real user on their
  // first load of the day, gated only by:
  //   - a real signed-in user (username present),
  //   - NOT capture / demo fixture mode,
  //   - the BeakerBot-animations opt-out being ON (true, not false; we
  //     also wait for the read to resolve, so `undefined` defers),
  //   - localStorage saying the hello has not already fired today.
  // The tour deferral is handled in the drain effect (the hello waits
  // for the corner just like a milestone does). dedup is localStorage,
  // never the sidecar.
  useEffect(() => {
    if (!username) return;
    if (captureMode) return;
    if (beakerBotAnimations !== true) return;
    if (!helloPendingToday(username)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot gate flip from a pure localStorage read; no I/O, mirrors the IdleAnimationManager fired-lock seed pattern.
    setHelloPending(true);
  }, [username, captureMode, beakerBotAnimations]);

  // ------- Steps 3 + 5 + 6: drain the queue (one per session) -------
  //
  // When (a) there is no active celebration, (b) we haven't already
  // burned this session's one celebration, (c) no tour is fighting for
  // the corner, and (d) BeakerBot animations are enabled (resolved to
  // true), fire the next celebration. Real milestones / anniversaries
  // take priority over the daily hello; the hello fires only when the
  // milestone queue is empty.
  useEffect(() => {
    if (active !== null) return;
    if (sessionLocked) return;
    if (tourActive) return;
    if (captureMode) return;
    // Opt-out gate: suppress BOTH the daily hello and the streak
    // celebration scenes when the user turned BeakerBot animations off.
    // `undefined` (read in flight) also defers so we never flash-fire.
    if (beakerBotAnimations !== true) return;

    if (queue.length > 0) {
      const [next, ...rest] = queue;
      const scene = pickRandomCelebration();
      setActive({ kind: "milestone", celebration: next, scene });
      setQueue(rest);
      setSessionLocked(true);
      return;
    }
    if (helloPending && username) {
      // Burn the per-day localStorage lock up front so a fast remount
      // (StrictMode double-invoke, hot reload) can't double-greet.
      markHelloFiredToday(username);
      setActive({ kind: "hello" });
      setHelloPending(false);
      setSessionLocked(true);
    }
  }, [
    active,
    sessionLocked,
    tourActive,
    captureMode,
    beakerBotAnimations,
    queue,
    helloPending,
    username,
  ]);

  // ------- Step 4: scene onComplete persists + clears active --------
  //
  // The scene fires onComplete when its animation finishes. For a
  // milestone we persist the seen tag (best-effort: log and continue on
  // failure). The daily hello persists nothing to the sidecar (its dedup
  // already landed in localStorage when it fired). Because sessionLocked
  // is still true, no further celebrations fire this session.
  const onSceneComplete = useCallback(async () => {
    const cur = active;
    setActive(null);
    if (!cur || cur.kind !== "milestone" || !username) return;
    try {
      await markCelebrationSeen(username, cur.celebration);
    } catch (err) {
      console.warn(
        "[CelebrationManager] markCelebrationSeen failed for tag",
        cur.celebration.tag,
        err,
      );
    }
  }, [active, username]);

  if (!username) return null;
  if (!active) return null;

  // The daily hello forces the mouseWave "Hi!" scene (BeakerBot waves
  // from the corner with its default "Hi!" speech bubble).
  if (active.kind === "hello") {
    return <BeakerBotMouseWaveScene active onComplete={onSceneComplete} />;
  }

  // First-ever 7-day streak: render the celebratory twirl (twirl-
  // milestones bot) instead of a random pool scene. This is the SINGLE
  // owner of the streak twirl (the standalone useMilestoneTwirlTrigger
  // hook deliberately skips the streak), so exactly one celebration
  // plays. onSceneComplete still persists the `7d` seen-tag, so it never
  // re-fires; higher streak tags fall through to the random pool below.
  if (
    active.celebration.kind === "streak_milestone" &&
    active.celebration.tag === TWIRL_STREAK_TAG
  ) {
    return <BeakerBotTwirlScene active onComplete={onSceneComplete} />;
  }

  // Dispatch on scene shape. Each branch renders the appropriate
  // scene component with `active=true` and our onSceneComplete
  // handler. The scenes own their own portals so we don't need to
  // wrap them here.
  if (active.scene.type === "scene") {
    if (active.scene.component === "ladder") {
      return (
        <BeakerBotLadderScene active onComplete={onSceneComplete} />
      );
    }
    if (active.scene.component === "eureka") {
      return (
        <BeakerBotEurekaScene active onComplete={onSceneComplete} />
      );
    }
    if (active.scene.component === "mouseWave") {
      return (
        <BeakerBotMouseWaveScene active onComplete={onSceneComplete} />
      );
    }
    if (active.scene.component === "skateboard") {
      return (
        <BeakerBotSkateboardScene active onComplete={onSceneComplete} />
      );
    }
    if (active.scene.component === "tooManyBeakers") {
      return (
        <BeakerBotTooManyBeakersScene active onComplete={onSceneComplete} />
      );
    }
  }
  // Pose-only celebration (volcano-eruption, cheering, bouncing).
  return (
    <BeakerBotPoseCelebrationScene
      active
      pose={active.scene.pose}
      onComplete={onSceneComplete}
    />
  );
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

/** Append items to `prev` skipping anything already present (same kind
 *  + tag pair). Keeps the queue from double-counting when both the
 *  on-mount evaluator AND the live tick emit the same tag. */
function mergeUnique(
  prev: PendingCelebration[],
  next: ReadonlyArray<PendingCelebration>,
): PendingCelebration[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map(keyOf));
  const out = [...prev];
  for (const item of next) {
    const k = keyOf(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function keyOf(c: PendingCelebration): string {
  return `${c.kind}:${c.tag}`;
}
