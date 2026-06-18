"use client";

import { useEffect, useRef, useState } from "react";
import { POPUP_ANIMATIONS_ENABLED } from "@/lib/animations/popup-gate";
import BeakerBotCentrifugeScene from "@/components/BeakerBotCentrifugeScene";
import BeakerBotCoffeeRefillScene from "@/components/BeakerBotCoffeeRefillScene";
import BeakerBotBlowingBubblesScene from "@/components/BeakerBotBlowingBubblesScene";
import BeakerBotTooManyBeakersScene from "@/components/BeakerBotTooManyBeakersScene";
import BeakerBotBugStompScene from "@/components/BeakerBotBugStompScene";

/** The pool of BeakerBot "entertainer" scenes the overlay rotates
 *  through while a long operation runs. Every scene shares the same
 *  { active, onComplete } contract and the shared ground-line / size
 *  constants, so they compose interchangeably. The overlay advances to
 *  the next scene on every loop (and on each re-open), so a long
 *  export cycles through the whole set instead of replaying one
 *  animation. These are all bench-style scenes that plant BeakerBot on
 *  the same ground line, which keeps the composition steady as scenes
 *  swap. Reorder or extend the list to change the rotation. */
const ENTERTAINER_SCENES = [
  BeakerBotCentrifugeScene,
  BeakerBotCoffeeRefillScene,
  BeakerBotBlowingBubblesScene,
  BeakerBotTooManyBeakersScene,
  BeakerBotBugStompScene,
] as const;

/**
 * Reusable progress overlay that pairs a determinate / indeterminate
 * progress bar with a rotating set of BeakerBot animations as an
 * "entertainer" — long async operations get visual feedback PLUS a
 * little slapstick to lighten the wait. Grant's brief on the
 * Centrifuge scene was the source: "this could be good for big saves
 * or exports but in that case we should have a progress bar to show
 * the user please wait while we prepare your file and then have the
 * beakerbot animation run to entertain them." Grant later asked for
 * the wait to rotate through several scenes rather than only the
 * centrifuge, hence the ENTERTAINER_SCENES pool above.
 *
 * Composition:
 *   - Full-viewport backdrop (z-[850]) with a dimming layer so the
 *     scene's burst trajectories read against a calmer page.
 *   - The centrifuge scene runs as its own portal at z-800 (its own
 *     fixed inset: 0 layer) so its full viewport-relative trajectory
 *     is preserved; the backdrop sits BEHIND it (z-850 on the modal
 *     panel side, but the scene's portal is mounted to document.body
 *     separately so it composites above the backdrop visually).
 *   - The modal panel itself sits at z-[900] above both, so the
 *     progress bar + title + cancel button always stay legible and
 *     clickable.
 *   - The scene loops while `open` is true (its onComplete bumps a
 *     key + re-activates) so the entertainment lasts the full
 *     operation, however long it takes.
 *
 * Reduced-motion: if `prefers-reduced-motion: reduce` is set, the
 * centrifuge scene already renders its static aftermath tableau
 * (see the scene's own reduced-motion gate) so we don't double-handle
 * it here. The progress bar is purely opacity-based, no jitter.
 *
 * Controlled component — parent owns `open` and toggles it false
 * when the underlying async work resolves. No internal dismiss
 * timer.
 */

export interface ProgressEntertainerProps {
  /** When false, nothing renders. When true, the overlay mounts and
   *  the scene starts. */
  open: boolean;
  /** Primary line. Caller supplies, e.g. "Preparing your export…". */
  title: string;
  /** Optional secondary line beneath the title. E.g. the current step
   *  name ("Packaging archive… 42%"). */
  subtitle?: string;
  /** 0..1 if known → determinate bar; undefined → indeterminate bar
   *  (animated stripes / pulsing fill). Values outside [0, 1] are
   *  clamped. */
  progress?: number;
  /** When provided, a Cancel button renders at the bottom of the
   *  panel and calls this when clicked. Omit to hide the button
   *  entirely (e.g. for exports that can't be safely interrupted). */
  onCancel?: () => void;
}

export default function ProgressEntertainer({
  open,
  title,
  subtitle,
  progress,
  onCancel,
}: ProgressEntertainerProps) {
  // Decorative pop-up gate. Flip POPUP_ANIMATIONS_ENABLED in
  // lib/animations/popup-gate.ts to restore the entertainer scenes.
  if (!POPUP_ANIMATIONS_ENABLED) return null;
  // Drive the centrifuge scene as a looping entertainer. Each time
  // the scene's onComplete fires, bump iterationKey + flip active off
  // and back on so the scene restarts. iterationKey is keyed onto the
  // scene so React fully unmounts/remounts the portal — the cleanest
  // way to reset its internal stage machine without exposing a
  // restart prop on the scene itself.
  const [iterationKey, setIterationKey] = useState(0);
  const [sceneActive, setSceneActive] = useState(true);
  // Which entertainer scene is showing. Advances on every loop
  // completion AND on each re-open so the wait cycles through the pool
  // instead of replaying one animation.
  const [sceneIndex, setSceneIndex] = useState(0);
  const restartTimer = useRef<number | null>(null);

  // Re-arm the scene each time `open` toggles from false → true so a
  // re-opened entertainer starts fresh. Tracked via a derived
  // `prevOpen` rather than an effect so React's set-state-in-effect
  // lint rule stays clean. Same pattern ExportFormatDialog uses for
  // resetting `warningAcknowledged` across opens.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setIterationKey((k) => k + 1);
      setSceneActive(true);
      setSceneIndex((i) => (i + 1) % ENTERTAINER_SCENES.length);
    }
  }

  // Cancel any pending restart timer on close (or unmount) so we
  // don't remount the scene right after the parent closed the
  // overlay. Pure cleanup — no state writes.
  useEffect(() => {
    if (open) return;
    if (restartTimer.current !== null) {
      window.clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
  }, [open]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (restartTimer.current !== null) {
        window.clearTimeout(restartTimer.current);
        restartTimer.current = null;
      }
    };
  }, []);

  const handleSceneComplete = () => {
    // Brief breath between loops so the explosion + reaction don't
    // cycle back-to-back. Matches the gallery's useSceneLoop cadence.
    setSceneActive(false);
    restartTimer.current = window.setTimeout(() => {
      setIterationKey((k) => k + 1);
      setSceneIndex((i) => (i + 1) % ENTERTAINER_SCENES.length);
      setSceneActive(true);
    }, 500);
  };

  if (!open) return null;

  // Determinate progress: clamp + render as a percent width.
  // Indeterminate: render the striped/pulsing pattern via a CSS
  // animation defined in the inline <style> block below.
  const isDeterminate = typeof progress === "number";
  const percent = isDeterminate
    ? Math.round(Math.min(1, Math.max(0, progress!)) * 100)
    : 0;

  // The entertainer scene to render this iteration; rotates via
  // sceneIndex (bounded by the modulo on every update, so always valid).
  const ActiveScene = ENTERTAINER_SCENES[sceneIndex];

  return (
    <>
      {/* Active entertainer scene (rotates through ENTERTAINER_SCENES).
          Renders its own portal to document.body at z-800 with
          viewport-relative trajectories, so it visually composites
          above the backdrop but below the modal panel (z-[900]). The
          key forces a clean remount per loop iteration, and the scene
          component type also changes as sceneIndex advances. */}
      <ActiveScene
        key={iterationKey}
        active={sceneActive}
        onComplete={handleSceneComplete}
      />

      {/* Dimming backdrop. Sits at z-[850] — above the scene's z-800
          would obscure the bot, so we keep the backdrop subtle (only
          ~30% black + a faint blur) and let the scene composite on
          top. Pointer-events captured so clicks behind the modal
          don't leak through to the page. */}
      <div
        className="fixed inset-0 z-[850] bg-black/30 backdrop-blur-[2px]"
        aria-hidden="true"
        data-testid="progress-entertainer-backdrop"
      />

      {/* Modal panel — anchored to the upper-middle of the viewport
          so the centrifuge scene (which plays near the bottom 12vh
          ground line) stays unobscured. */}
      <div
        className="fixed inset-x-0 top-0 z-[900] flex items-start justify-center p-4 pt-[12vh] pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="progress-entertainer"
      >
        <div className="bg-surface-raised rounded-xl ros-popup-card-shadow w-full max-w-md p-6 pointer-events-auto">
          <h2
            className="text-title font-semibold text-foreground"
            data-testid="progress-entertainer-title"
          >
            {title}
          </h2>
          {subtitle ? (
            <p
              className="text-meta text-foreground-muted mt-1 leading-relaxed"
              data-testid="progress-entertainer-subtitle"
            >
              {subtitle}
            </p>
          ) : null}

          <div className="mt-4">
            <div
              className="h-2 w-full rounded-full bg-surface-sunken overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={isDeterminate ? percent : undefined}
              aria-label={title}
              data-testid="progress-entertainer-bar"
              data-determinate={isDeterminate ? "true" : "false"}
            >
              {isDeterminate ? (
                <div
                  className="h-full bg-sky-500 transition-all duration-200"
                  style={{ width: `${percent}%` }}
                  data-testid="progress-entertainer-fill"
                />
              ) : (
                <div
                  className="h-full w-full"
                  style={{
                    background:
                      "repeating-linear-gradient(90deg, #38bdf8 0 12px, #7dd3fc 12px 24px)",
                    backgroundSize: "200% 100%",
                    animation:
                      "progress-entertainer-indeterminate 1.4s linear infinite",
                  }}
                  data-testid="progress-entertainer-fill"
                />
              )}
            </div>
            {isDeterminate ? (
              <div className="text-meta text-foreground-muted mt-1 text-right tabular-nums">
                {percent}%
              </div>
            ) : null}
          </div>

          {onCancel ? (
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-1.5 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
                data-testid="progress-entertainer-cancel"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Scoped keyframes for the indeterminate bar. Kept inline so
          the component stays self-contained (no Tailwind config or
          global CSS edits). */}
      <style>{`
        @keyframes progress-entertainer-indeterminate {
          0%   { background-position: 200% 0; }
          100% { background-position: 0% 0; }
        }
      `}</style>
    </>
  );
}
