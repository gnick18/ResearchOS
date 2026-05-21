// TEMPORARY: BeakerBot gallery for dev verification. Delete this
// file + remove from any nav before shipping. Manager will dispatch
// a cleanup chip once Grant signs off on the 7-pose visual set.

"use client";

import { useState, useSyncExternalStore } from "react";
import BeakerBot, {
  type BeakerBotPose,
} from "@/components/BeakerBot";

/**
 * Dev-only visual check for the 7-pose menu locked at
 * commit 73bb0cee (Onboarding v3 P9) per master's 2026-05-20 lock.
 *
 * No AppShell nav link, accessed via direct URL. The page renders
 * each pose at the wizard's typical 80px mount size and labels it
 * with its firing condition so Grant can confirm the visual cadence
 * matches the spec without running the full onboarding wizard.
 *
 * One-shot poses (bouncing 600ms, cheering 900ms, bow-wink 1400ms,
 * waving wave-arm 700ms loop) get a Replay button that remounts the
 * tile via a per-tile key counter. The .animated CSS uses
 * `1 forwards` for the one-shots, so remount is the cleanest way to
 * re-fire the keyframe without touching BeakerBot's internals.
 *
 * DELETE before ship.
 */

interface PoseTileSpec {
  pose: BeakerBotPose;
  direction?: "left" | "right";
  label: string;
  firingCondition: string;
  loopable: boolean;
}

const TILES: PoseTileSpec[] = [
  {
    pose: "idle",
    label: "Idle",
    firingCondition:
      "Baseline bob. Plays on every mount when no other pose is set.",
    loopable: true,
  },
  {
    pose: "waving",
    label: "Waving",
    firingCondition: "Welcome step + greeting moments.",
    loopable: false,
  },
  {
    pose: "pointing",
    label: "Pointing (right)",
    firingCondition:
      "Tour steps W1-W14 + L1-L11 + glow-anchor moments.",
    loopable: true,
  },
  {
    pose: "pointing-up",
    label: "Pointing up",
    firingCondition:
      "Direction variant of pointing for upper-screen anchors.",
    loopable: true,
  },
  {
    pose: "pointing-down",
    label: "Pointing down",
    firingCondition:
      "Direction variant of pointing for lower-screen anchors.",
    loopable: true,
  },
  {
    pose: "bouncing",
    label: "Bouncing",
    firingCondition:
      "Step completion / Next button click (~650ms one-shot).",
    loopable: false,
  },
  {
    pose: "typing",
    label: "Typing",
    firingCondition:
      "W5 + W7 live-typing demos (190ms hand-pulse, cadence-matched).",
    loopable: true,
  },
  {
    pose: "thinking",
    label: "Thinking",
    firingCondition:
      "Q1-Q6 setup steps + any wait-for-input moment.",
    loopable: true,
  },
  {
    pose: "cheering",
    label: "Cheering",
    firingCondition: "Phase 4 cleanup wrap (multi-bounce + rotation).",
    loopable: false,
  },
  {
    pose: "bow-wink",
    label: "Bow-wink",
    firingCondition:
      "Final exit screen after Phase 4 Finish (wink first, then bow).",
    loopable: false,
  },
];

function subscribeReducedMotion(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getReducedMotionSnapshot() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ReducedMotionBadge() {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    () => false,
  );

  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium " +
        (reduced
          ? "bg-amber-100 text-amber-900"
          : "bg-emerald-100 text-emerald-900")
      }
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (reduced ? "bg-amber-500" : "bg-emerald-500")
        }
      />
      prefers-reduced-motion:{" "}
      {reduced ? "reduce (animations off)" : "no-preference (animations on)"}
    </span>
  );
}

interface PoseTileProps {
  spec: PoseTileSpec;
}

function PoseTile({ spec }: PoseTileProps) {
  const [replayKey, setReplayKey] = useState(0);

  return (
    <div className="flex flex-col items-center rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex h-24 w-24 items-center justify-center">
        <BeakerBot
          key={replayKey}
          pose={spec.pose}
          direction={spec.direction ?? "right"}
          className="h-20 w-20 text-sky-500"
        />
      </div>
      <div className="mt-3 text-center">
        <div className="text-sm font-semibold text-slate-900">
          {spec.label}
        </div>
        <div className="mt-1 text-xs leading-snug text-slate-600">
          {spec.firingCondition}
        </div>
      </div>
      {!spec.loopable && (
        <button
          type="button"
          onClick={() => setReplayKey((k) => k + 1)}
          className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Replay
        </button>
      )}
      {spec.loopable && (
        <div className="mt-3 text-[10px] uppercase tracking-wider text-slate-400">
          loops
        </div>
      )}
    </div>
  );
}

export default function BeakerBotGalleryPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div
        role="alert"
        className="mb-6 rounded-md border-2 border-red-500 bg-red-50 p-4 text-sm"
      >
        <div className="font-bold uppercase tracking-wide text-red-900">
          DEV ONLY: DELETE BEFORE SHIP
        </div>
        <div className="mt-1 text-red-800">
          This route is not production code. Cleanup target:{" "}
          <code className="rounded bg-red-100 px-1 py-0.5 font-mono text-xs">
            frontend/src/app/dev/beakerbot-gallery/page.tsx
          </code>
          . Manager will dispatch the deletion chip after Grant signs off on
          the 7-pose visual set.
        </div>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          BeakerBot pose gallery
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Visual verification of the 7-pose menu landed in P9 (master lock
          2026-05-20). BeakerBot is the ResearchOS mascot; this page renders
          each pose at the wizard mount size (~80px) with firing-condition
          labels so each animation can be eyeballed without running the
          onboarding wizard end-to-end.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ReducedMotionBadge />
          <span className="text-xs text-slate-500">
            Source:{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">
              frontend/src/components/BeakerBot.tsx
            </code>{" "}
            +{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">
              BeakerBot.module.css
            </code>
          </span>
        </div>
      </header>

      <section
        aria-label="Pose tiles"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {TILES.map((spec) => (
          <PoseTile key={spec.pose} spec={spec} />
        ))}
      </section>

      <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
        Reduced-motion users see static silhouettes (per BeakerBot.module.css
        media query). Replay buttons remount the SVG via React key so the
        one-shot keyframes re-fire from frame zero.
      </footer>
    </div>
  );
}
