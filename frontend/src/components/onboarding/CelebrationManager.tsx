"use client";

import { useCallback, useEffect, useState } from "react";
import BeakerBotEurekaScene from "@/components/BeakerBotEurekaScene";
import BeakerBotLadderScene from "@/components/BeakerBotLadderScene";
import BeakerBotMouseWaveScene from "@/components/BeakerBotMouseWaveScene";
import {
  evaluatePendingCelebrations,
  markCelebrationSeen,
  type PendingCelebration,
} from "@/lib/streak/milestone-scheduler";
import { onStreakMilestoneCrossed } from "@/lib/streak/streak-activity-tracker";
import { useOptionalTourController } from "@/components/onboarding/v4/TourController";
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
 * No props: the active username is the source of truth for which
 * sidecar to read, and the username can change mid-app-lifetime (sign
 * out, switch user). We use the prop rather than a hook so this
 * component can be unit-tested without mounting a FileSystemProvider.
 *
 * When username is null (no signed-in user yet, demo / wiki-capture
 * mode, picker screen), the manager renders nothing and does nothing.
 */

// --------------------------------------------------------------------
// Celebration scene pool (proposal §6.7, RESOLVED 2026-05-21)
// --------------------------------------------------------------------

/**
 * The six-scene random pool. Slapstick scenes (bug-stomp,
 * too-many-beakers, screen-bump, skateboard, centrifuge) are
 * explicitly EXCLUDED per §6.7. They fire in their own contexts and
 * don't carry a celebratory tone.
 *
 * Three multi-stage scenes (ladder, eureka, mouseWave) and three
 * pose-only scenes (volcano-eruption, cheering, bouncing). The pose
 * entries are wrapped by BeakerBotPoseCelebrationScene to share the
 * `{ active, onComplete }` interface; the manager doesn't need to
 * special-case scene vs pose at the call site.
 */
export type CelebrationScene =
  | { type: "scene"; component: "ladder" }
  | { type: "scene"; component: "eureka" }
  | { type: "scene"; component: "mouseWave" }
  | { type: "pose"; pose: "volcano-eruption" }
  | { type: "pose"; pose: "cheering" }
  | { type: "pose"; pose: "bouncing" };

export const CELEBRATION_POOL: ReadonlyArray<CelebrationScene> = [
  { type: "scene", component: "ladder" },
  { type: "scene", component: "eureka" },
  { type: "scene", component: "mouseWave" },
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
// Component
// --------------------------------------------------------------------

interface CelebrationManagerProps {
  username: string | null;
}

export default function CelebrationManager({ username }: CelebrationManagerProps) {
  const [queue, setQueue] = useState<PendingCelebration[]>([]);
  const [active, setActive] = useState<{
    celebration: PendingCelebration;
    scene: CelebrationScene;
  } | null>(null);
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

  // ------- Steps 3 + 5 + 6: drain the queue (one per session) -------
  //
  // When (a) there is no active celebration, (b) the queue is
  // non-empty, (c) we haven't already burned this session's one
  // celebration, and (d) no tour is fighting for the corner, take
  // the next queued celebration + pick a random scene + render it.
  useEffect(() => {
    if (active !== null) return;
    if (sessionLocked) return;
    if (tourActive) return;
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    const scene = pickRandomCelebration();
    setActive({ celebration: next, scene });
    setQueue(rest);
    setSessionLocked(true);
  }, [active, sessionLocked, tourActive, queue]);

  // ------- Step 4: scene onComplete persists + clears active --------
  //
  // The scene fires onComplete when its animation finishes. We
  // persist the seen tag (best-effort: log and continue on
  // failure) and clear the active slot. Because sessionLocked is
  // still true, no further celebrations fire this session.
  const onSceneComplete = useCallback(async () => {
    const cur = active;
    if (!cur || !username) {
      setActive(null);
      return;
    }
    setActive(null);
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
