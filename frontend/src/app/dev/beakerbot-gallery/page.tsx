"use client";

// Dev-only BeakerBot animation gallery. Browse every pose AND every
// scene component in one place with a loop toggle, so we can eyeball
// the whole BeakerBot animation surface without triggering each one
// via its real product flow.
//
// Catalog covers:
//   - 18 poses from the BeakerBotPose union (idle, pointing,
//     pointing-up, pointing-down, cheering, waving, bouncing,
//     thinking, typing, typing-on-laptop, bow-wink, giggle,
//     rolling-laughing, volcano-eruption, sleeping, hiccup, yawn,
//     reading)
//   - 8 multi-stage scene components (Ladder, BugStomp, Skateboard,
//     ScreenBump, TooManyBeakers, MouseWave, Centrifuge, Eureka)
//   - 3 pose-celebration variants (cheering, bouncing, volcano-eruption)
//   = 29 entries total
//
// Loop mechanic:
//   - Scenes: on onComplete, flip active=false, wait 500ms, bump a
//     React key, flip active=true. Re-mount runs the whole timeline
//     from frame zero.
//   - Looping poses (sleeping, reading, idle, thinking, typing,
//     typing-on-laptop, waving, pointing*, giggle, rolling-laughing):
//     just render <BeakerBot pose=... /> and let the CSS keyframes loop.
//   - One-shot poses (bouncing, cheering, bow-wink, volcano-eruption,
//     hiccup, yawn): interval-bump a React key every N ms (N derived
//     from the pose's animation duration).
//
// Entry point: a small "BeakerBot Gallery (dev)" link is rendered in
// Settings (TipsSection footer) gated by process.env.NODE_ENV ===
// "development". The route itself is reachable in production but
// undiscoverable from the UI.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";
import BeakerBotLadderScene from "@/components/BeakerBotLadderScene";
import BeakerBotBugStompScene from "@/components/BeakerBotBugStompScene";
import BeakerBotSkateboardScene from "@/components/BeakerBotSkateboardScene";
import BeakerBotScreenBumpScene from "@/components/BeakerBotScreenBumpScene";
import BeakerBotTooManyBeakersScene from "@/components/BeakerBotTooManyBeakersScene";
import BeakerBotMouseWaveScene from "@/components/BeakerBotMouseWaveScene";
import BeakerBotCentrifugeScene from "@/components/BeakerBotCentrifugeScene";
import BeakerBotEurekaScene from "@/components/BeakerBotEurekaScene";
import BeakerBotPoseCelebrationScene from "@/components/onboarding/BeakerBotPoseCelebrationScene";

// ── Catalog types ──────────────────────────────────────────────────────────

/** Common envelope every scene component in the gallery accepts. We
 *  cast each component reference to this shape so the gallery can
 *  drive any of them through one code path. Per-scene extras (side,
 *  direction, enterFrom, outcome) are not exposed in the gallery UI;
 *  each scene picks a sensible default. */
type SceneEnvelopeProps = {
  active: boolean;
  onComplete?: () => void;
};
type SceneComponent = ComponentType<SceneEnvelopeProps>;

interface PoseEntry {
  kind: "pose";
  id: string;
  label: string;
  pose: BeakerBotPose;
  /** Looping poses just sit there and loop forever via CSS keyframes.
   *  One-shot poses (bouncing, hiccup, etc.) finish their animation
   *  once; the gallery re-mounts them on an interval so they keep
   *  playing under a "loop" toggle. */
  loopType: "looping" | "one-shot";
  /** For one-shot poses, how many ms to wait between remounts. Lets
   *  the keyframe finish + give the eye a beat before the next play.
   *  Picked per-pose based on the keyframe duration documented in
   *  BeakerBot.tsx + BeakerBot.module.css. */
  oneShotIntervalMs?: number;
  description: string;
  timingNote: string;
}

interface SceneEntry {
  kind: "scene";
  id: string;
  label: string;
  Component: SceneComponent;
  description: string;
  timingNote: string;
}

interface PoseCelebrationEntry {
  kind: "pose-celebration";
  id: string;
  label: string;
  pose: BeakerBotPose;
  description: string;
  timingNote: string;
}

type CatalogEntry = PoseEntry | SceneEntry | PoseCelebrationEntry;

// ── Catalog data ───────────────────────────────────────────────────────────

/** All 18 poses from the BeakerBotPose union, in the order they appear
 *  in BeakerBot.tsx. Tests rely on this length so adding/removing a
 *  pose here requires an explicit test update. */
const POSES: PoseEntry[] = [
  {
    kind: "pose",
    id: "pose:idle",
    label: "idle",
    pose: "idle",
    loopType: "looping",
    description:
      "Neutral resting pose. Idle-bob keyframe loops while no other pose is set.",
    timingNote: "Looping (idle-bob keyframe)",
  },
  {
    kind: "pose",
    id: "pose:pointing",
    label: "pointing",
    pose: "pointing",
    loopType: "looping",
    description: "Right-side arm out, triangle finger. Used for tour anchors.",
    timingNote: "Looping",
  },
  {
    kind: "pose",
    id: "pose:pointing-up",
    label: "pointing-up",
    pose: "pointing-up",
    loopType: "looping",
    description: "Right-side arm raised, triangle pointing up. Upper anchors.",
    timingNote: "Looping",
  },
  {
    kind: "pose",
    id: "pose:pointing-down",
    label: "pointing-down",
    pose: "pointing-down",
    loopType: "looping",
    description: "Right-side arm lowered, triangle pointing down. Lower anchors.",
    timingNote: "Looping",
  },
  {
    kind: "pose",
    id: "pose:cheering",
    label: "cheering",
    pose: "cheering",
    loopType: "one-shot",
    oneShotIntervalMs: 1400,
    description:
      "Both arms up in a V, hand dots, multi-bounce keyframe. Phase 4 celebrate.",
    timingNote: "~900ms one-shot",
  },
  {
    kind: "pose",
    id: "pose:waving",
    label: "waving",
    pose: "waving",
    loopType: "looping",
    description:
      "Single hand raised. Greeting moments. Wave arm loops at ~700ms.",
    timingNote: "Looping (wave arm)",
  },
  {
    kind: "pose",
    id: "pose:bouncing",
    label: "bouncing",
    pose: "bouncing",
    loopType: "one-shot",
    oneShotIntervalMs: 1100,
    description: "Momentary vertical bounce. Plays on step-transition events.",
    timingNote: "~600ms one-shot",
  },
  {
    kind: "pose",
    id: "pose:thinking",
    label: "thinking",
    pose: "thinking",
    loopType: "looping",
    description: "Subtle head-tilt loop. Used while parked on Q1-Q6 setup steps.",
    timingNote: "Looping",
  },
  {
    kind: "pose",
    id: "pose:typing",
    label: "typing",
    pose: "typing",
    loopType: "looping",
    description:
      "Extended arm with hand pulse (~190ms cadence-matched to typewriter).",
    timingNote: "Looping (190ms hand-pulse)",
  },
  {
    kind: "pose",
    id: "pose:typing-on-laptop",
    label: "typing-on-laptop",
    pose: "typing-on-laptop",
    loopType: "looping",
    description:
      "One-hand variant of typing: reuses the regular typing arm + hand (190ms pulse) with a small side-profile laptop tucked under the hand. Other arm at rest.",
    timingNote: "Looping (190ms hand-pulse, same as regular typing)",
  },
  {
    kind: "pose",
    id: "pose:bow-wink",
    label: "bow-wink",
    pose: "bow-wink",
    loopType: "one-shot",
    oneShotIntervalMs: 2000,
    description: "Combo: right eye winks, then the whole body bows forward.",
    timingNote: "~1400ms one-shot",
  },
  {
    kind: "pose",
    id: "pose:giggle",
    label: "giggle",
    pose: "giggle",
    loopType: "looping",
    description: "Light shoulder-shake giggle loop. Playful interlude pose.",
    timingNote: "Looping",
  },
  {
    kind: "pose",
    id: "pose:rolling-laughing",
    label: "rolling-laughing",
    pose: "rolling-laughing",
    loopType: "looping",
    description: "Full ROFL shake loop. Stronger reaction than giggle.",
    timingNote: "Looping",
  },
  {
    kind: "pose",
    id: "pose:volcano-eruption",
    label: "volcano-eruption",
    pose: "volcano-eruption",
    loopType: "one-shot",
    oneShotIntervalMs: 3700,
    description:
      "Test tube pours purple liquid, his beaker reacts, particles erupt, settles.",
    timingNote: "~3200ms one-shot",
  },
  {
    kind: "pose",
    id: "pose:sleeping",
    label: "sleeping",
    pose: "sleeping",
    loopType: "looping",
    description: "Eyes closed, blanket drapes, ZZZ letters drift up.",
    timingNote: "Looping (long-idle)",
  },
  {
    kind: "pose",
    id: "pose:hiccup",
    label: "hiccup",
    pose: "hiccup",
    loopType: "one-shot",
    oneShotIntervalMs: 2500,
    description:
      "Body jolts, rainbow bubble forms, rises, pops into a particle ring.",
    timingNote: "~2000ms one-shot",
  },
  {
    kind: "pose",
    id: "pose:yawn",
    label: "yawn",
    pose: "yawn",
    loopType: "one-shot",
    oneShotIntervalMs: 2000,
    description:
      "Mouth opens wide, body stretches up, mouth closes, settles with overshoot.",
    timingNote: "~1500ms one-shot",
  },
  {
    kind: "pose",
    id: "pose:reading",
    label: "reading",
    pose: "reading",
    loopType: "looping",
    description:
      "Small book appears, eyes scan left/right, right page flips every ~6s.",
    timingNote: "Looping",
  },
];

/** 8 multi-stage scene components. All share the {active, onComplete}
 *  envelope so the gallery can drive them through one code path. */
const SCENES: SceneEntry[] = [
  {
    kind: "scene",
    id: "scene:ladder",
    label: "BeakerBotLadderScene",
    Component: BeakerBotLadderScene as unknown as SceneComponent,
    description:
      "Ladder rises, BeakerBot climbs, cleans the screen, then slips and tumbles off alongside the ladder.",
    timingNote: "~10800ms total",
  },
  {
    kind: "scene",
    id: "scene:bug-stomp",
    label: "BeakerBotBugStompScene",
    Component: BeakerBotBugStompScene as unknown as SceneComponent,
    description:
      "A swarm of bugs scatters across the screen. BeakerBot sneaks up with a fly swatter, whacks the target, and the splat residue stays on screen.",
    timingNote: "Multi-stage one-shot",
  },
  {
    kind: "scene",
    id: "scene:skateboard",
    label: "BeakerBotSkateboardScene",
    Component: BeakerBotSkateboardScene as unknown as SceneComponent,
    description:
      "BeakerBot cruises across the viewport on a skateboard, then exits the opposite side.",
    timingNote: "Multi-stage one-shot",
  },
  {
    kind: "scene",
    id: "scene:screen-bump",
    label: "BeakerBotScreenBumpScene",
    Component: BeakerBotScreenBumpScene as unknown as SceneComponent,
    description:
      "BeakerBot bonks into a viewport edge with a comic-style impact star.",
    timingNote: "Multi-stage one-shot",
  },
  {
    kind: "scene",
    id: "scene:too-many-beakers",
    label: "BeakerBotTooManyBeakersScene",
    Component: BeakerBotTooManyBeakersScene as unknown as SceneComponent,
    description:
      "BeakerBot carries a tall stack of beakers, stumbles, recovers, then drops them on the second stumble.",
    timingNote: "Multi-stage one-shot",
  },
  {
    kind: "scene",
    id: "scene:mouse-wave",
    label: "BeakerBotMouseWaveScene",
    Component: BeakerBotMouseWaveScene as unknown as SceneComponent,
    description:
      "BeakerBot appears near the cursor and waves a greeting before fading out.",
    timingNote: "Multi-stage one-shot",
  },
  {
    kind: "scene",
    id: "scene:centrifuge",
    label: "BeakerBotCentrifugeScene",
    Component: BeakerBotCentrifugeScene as unknown as SceneComponent,
    description:
      "BeakerBot carries in a centrifuge, sets it down, it spins out of control, a small explosion, sheepish shrug.",
    timingNote: "~5800ms total",
  },
  {
    kind: "scene",
    id: "scene:eureka",
    label: "BeakerBotEurekaScene",
    Component: BeakerBotEurekaScene as unknown as SceneComponent,
    description:
      "BeakerBot peeks through a microscope, pulls back amazed, a light bulb pops on, rainbow sparkles, cheers, walks off.",
    timingNote: "~5700ms total",
  },
];

/** 3 pose-celebration variants. The wrapper component portals a single
 *  BeakerBot pose at the bottom-right corner under the same
 *  {active, onComplete} envelope the multi-stage scenes use. */
const POSE_CELEBRATIONS: PoseCelebrationEntry[] = [
  {
    kind: "pose-celebration",
    id: "pose-celebration:cheering",
    label: "Pose Celebration Scene (cheering)",
    pose: "cheering",
    description:
      "BeakerBotPoseCelebrationScene wrapper around the cheering pose. Bottom-right corner, 2s hold.",
    timingNote: "2000ms hold",
  },
  {
    kind: "pose-celebration",
    id: "pose-celebration:bouncing",
    label: "Pose Celebration Scene (bouncing)",
    pose: "bouncing",
    description:
      "BeakerBotPoseCelebrationScene wrapper around the bouncing pose. Bottom-right corner, 2s hold.",
    timingNote: "2000ms hold",
  },
  {
    kind: "pose-celebration",
    id: "pose-celebration:volcano-eruption",
    label: "Pose Celebration Scene (volcano-eruption)",
    pose: "volcano-eruption",
    description:
      "BeakerBotPoseCelebrationScene wrapper around the volcano-eruption pose. Bottom-right corner, 2s hold.",
    timingNote: "2000ms hold",
  },
];

/** Single flat catalog. Order: poses, then scenes, then
 *  pose-celebrations. Tests assert counts (17 + 8 + 3 = 28). */
export const BEAKERBOT_ANIMATION_CATALOG: readonly CatalogEntry[] = [
  ...POSES,
  ...SCENES,
  ...POSE_CELEBRATIONS,
];

// ── Loop hooks ─────────────────────────────────────────────────────────────

/** Drives the scene-style loop: scene fires onComplete -> wait 500ms ->
 *  bump key + reset active. Returns the iteration key and a stable
 *  onComplete handler that respects the loop toggle. */
function useSceneLoop(shouldLoop: boolean) {
  const [iterationKey, setIterationKey] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // When the user flips loop off mid-pause, cancel the queued restart.
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleComplete = useCallback(() => {
    if (!shouldLoop) return;
    setIsActive(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setIterationKey((k) => k + 1);
      setIsActive(true);
      timerRef.current = null;
    }, 500);
  }, [shouldLoop]);

  /** Reset on entry change. */
  const reset = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIterationKey((k) => k + 1);
    setIsActive(true);
  }, []);

  return { iterationKey, isActive, handleComplete, reset };
}

/** Drives the one-shot pose loop via setInterval: every intervalMs
 *  bump the iteration key so <BeakerBot> re-mounts and the keyframe
 *  re-fires from frame zero. Looping poses don't need this. */
function useOneShotPoseLoop(shouldLoop: boolean, intervalMs: number) {
  const [iterationKey, setIterationKey] = useState(0);

  useEffect(() => {
    if (!shouldLoop) return;
    const handle = window.setInterval(() => {
      setIterationKey((k) => k + 1);
    }, intervalMs);
    return () => window.clearInterval(handle);
  }, [shouldLoop, intervalMs]);

  const reset = useCallback(() => {
    setIterationKey((k) => k + 1);
  }, []);

  return { iterationKey, reset };
}

// ── Preview renderers ──────────────────────────────────────────────────────

function PosePreview({
  entry,
  shouldLoop,
}: {
  entry: PoseEntry;
  shouldLoop: boolean;
}) {
  const isLooping = entry.loopType === "looping";
  // We instantiate the one-shot loop unconditionally to keep hook order
  // stable across the two branches; for looping poses the hook becomes
  // a no-op because shouldLoop is forced false on that branch.
  const intervalMs = entry.oneShotIntervalMs ?? 2000;
  const { iterationKey } = useOneShotPoseLoop(
    !isLooping && shouldLoop,
    intervalMs,
  );

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <div
        data-testid="gallery-pose-preview"
        data-pose={entry.pose}
        className="flex h-64 w-64 items-center justify-center"
      >
        <BeakerBot
          key={iterationKey}
          pose={entry.pose}
          className="h-56 w-56 text-sky-500"
        />
      </div>
      {isLooping && (
        <div className="rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-700">
          Note: looping pose. CSS keyframe loops forever; loop toggle has no effect.
        </div>
      )}
      {!isLooping && (
        <div className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800">
          One-shot pose. Re-mounts every {intervalMs}ms while loop is on.
        </div>
      )}
    </div>
  );
}

function ScenePreview({
  entry,
  shouldLoop,
}: {
  entry: SceneEntry;
  shouldLoop: boolean;
}) {
  const { iterationKey, isActive, handleComplete } = useSceneLoop(shouldLoop);
  const Component = entry.Component;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Scene components portal to document.body and overlay the whole viewport.
        Watch the screen for the animation; the preview panel itself stays blank.
      </div>
      <Component
        key={`${entry.id}-${iterationKey}`}
        active={isActive}
        onComplete={handleComplete}
      />
    </div>
  );
}

function PoseCelebrationPreview({
  entry,
  shouldLoop,
}: {
  entry: PoseCelebrationEntry;
  shouldLoop: boolean;
}) {
  const { iterationKey, isActive, handleComplete } = useSceneLoop(shouldLoop);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Pose celebration portals to bottom-right of viewport. Watch the corner.
      </div>
      <BeakerBotPoseCelebrationScene
        key={`${entry.id}-${iterationKey}`}
        active={isActive}
        pose={entry.pose}
        onComplete={handleComplete}
      />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

const DEFAULT_ENTRY_ID = POSES[0]!.id; // idle

export default function BeakerBotGalleryPage() {
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_ENTRY_ID);
  const [shouldLoop, setShouldLoop] = useState(true);

  const selected = useMemo<CatalogEntry>(() => {
    return (
      BEAKERBOT_ANIMATION_CATALOG.find((e) => e.id === selectedId) ??
      BEAKERBOT_ANIMATION_CATALOG[0]!
    );
  }, [selectedId]);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            BeakerBot Animation Gallery
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Dev only. Browse every BeakerBot pose and every scene component
            on one page. The loop toggle re-plays scenes after onComplete
            (and re-mounts one-shot poses on an interval).
          </p>
        </div>
        {/* "Back to app" routes via router.back() so the user lands
            exactly where they were before clicking the dev FAB. If
            they arrived here directly (no history entry), fall back
            to the home route. */}
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) {
              window.history.back();
            } else if (typeof window !== "undefined") {
              window.location.href = "/";
            }
          }}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400"
          data-testid="gallery-back-to-app"
        >
          <span aria-hidden="true">&larr;</span> Back to app
        </button>
      </header>

      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Animation
          </span>
          <select
            data-testid="gallery-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="min-w-[280px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <optgroup label={`Poses (${POSES.length})`}>
              {POSES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            <optgroup label={`Scenes (${SCENES.length})`}>
              {SCENES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </optgroup>
            <optgroup
              label={`Pose Celebration Scenes (${POSE_CELEBRATIONS.length})`}
            >
              {POSE_CELEBRATIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Loop
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={shouldLoop}
            data-testid="gallery-loop-toggle"
            onClick={() => setShouldLoop((v) => !v)}
            className={
              "relative inline-flex h-7 w-12 items-center rounded-full transition-colors " +
              (shouldLoop ? "bg-sky-500" : "bg-slate-300")
            }
          >
            <span
              className={
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform " +
                (shouldLoop ? "translate-x-6" : "translate-x-1")
              }
            />
            <span className="sr-only">{shouldLoop ? "On" : "Off"}</span>
          </button>
        </label>

        <div className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
          Catalog: {POSES.length} poses + {SCENES.length} scenes +{" "}
          {POSE_CELEBRATIONS.length} pose-celebrations ={" "}
          {BEAKERBOT_ANIMATION_CATALOG.length} entries
        </div>
      </div>

      <section
        aria-label="Animation preview"
        data-testid="gallery-preview"
        className="mb-4 flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50"
        style={{ width: "100%", height: 500, minHeight: 500 }}
      >
        {selected.kind === "pose" && (
          <PosePreview
            key={selected.id}
            entry={selected}
            shouldLoop={shouldLoop}
          />
        )}
        {selected.kind === "scene" && (
          <ScenePreview
            key={selected.id}
            entry={selected}
            shouldLoop={shouldLoop}
          />
        )}
        {selected.kind === "pose-celebration" && (
          <PoseCelebrationPreview
            key={selected.id}
            entry={selected}
            shouldLoop={shouldLoop}
          />
        )}
      </section>

      <section
        aria-label="Animation details"
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <div className="flex items-center gap-2">
          <span
            className={
              "rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide " +
              (selected.kind === "pose"
                ? "bg-emerald-100 text-emerald-800"
                : selected.kind === "scene"
                  ? "bg-violet-100 text-violet-800"
                  : "bg-sky-100 text-sky-800")
            }
          >
            {selected.kind === "pose"
              ? "Pose"
              : selected.kind === "scene"
                ? "Scene"
                : "Pose celebration"}
          </span>
          <h2 className="text-base font-semibold text-slate-900">
            {selected.label}
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-700">{selected.description}</p>
        <p className="mt-1 text-xs text-slate-500">
          Timing: {selected.timingNote}
        </p>
      </section>
    </div>
  );
}
