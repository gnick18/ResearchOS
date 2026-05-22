"use client";

/**
 * tour-goodbye — terminal step of the v4 onboarding tour (replaces the
 * retired Phase 4 cleanup grid 2026-05-22).
 *
 * Flow:
 *   1. BeakerBot says "You're set! Here's to many great experiments ahead..." with a single
 *      "Let's go" button.
 *   2. User clicks "Let's go". The step's `onExit` hook dispatches a
 *      `tour-goodbye:play-outro` window event carrying the active
 *      username + the first-project id (so the outro overlay can run
 *      `runEndOfTourAutoCleanup`).
 *   3. The TourController's advance fires, currentStep flips to null,
 *      the tour overlay unmounts.
 *   4. The `TourGoodbyeOverlay` host (mounted alongside `<TourBootstrap>`
 *      and `<DemoLabModeMount>` in `V4MountForUser`) catches the event,
 *      mounts a full-screen overlay with BeakerBot + confetti, plays the
 *      cheering → waving → fade animation (~3.8 s total), runs the
 *      auto-cleanup in the background, and routes to `/` on completion.
 *
 * Why a window event + sibling host instead of doing everything in the
 * speech bubble:
 *   - The speech bubble lives inside the TourController's overlay tree.
 *     The moment advance() fires (currentStep -> null), that overlay
 *     unmounts, taking any animation state with it. A sibling host
 *     scoped to `V4MountForUser` survives the tour state transition.
 *   - The same pattern is already used by `DemoLabModeMount` for the
 *     §6.16 Lab Mode viewer overlay (window event from a step body,
 *     mount lives at the V4 root). Mirroring it keeps the cleanup
 *     retirement consistent with the rest of v4.
 *
 * Back-step safety: `onExit` fires on BOTH forward advance AND back-step.
 * We guard with `getLastTourTransition() === "advance"` so a user who
 * back-steps off tour-goodbye doesn't see the outro animation prematurely.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BeakerBot from "@/components/BeakerBot";
import { readOnboarding } from "@/lib/onboarding/sidecar";
// IMPORTANT: do NOT import from `../../TourController` at module load —
// step-registry imports this file, and TourController imports step-registry,
// so a top-level dep would close a circular chain and crash with
// "Cannot read properties of undefined" on `tourGoodbyeStep.id`. The
// `getLastTourTransition` getter (the only TourController surface this
// file needs) reads a module-level mutable that survives across the
// dynamic-import boundary; the onExit callback resolves it lazily on
// first invocation.
import type { TourStep } from "../../step-types";
import { manualAdvance, buildWalkthroughStep } from "../walkthrough/lib/step-helpers";
import { runEndOfTourAutoCleanup } from "./auto-cleanup";

// ---------------------------------------------------------------------------
// Window-event contract — sibling host listens for this event.
// ---------------------------------------------------------------------------

export const TOUR_GOODBYE_PLAY_OUTRO_EVENT = "tour-goodbye:play-outro";

export interface TourGoodbyeOutroDetail {
  username: string;
  firstProjectId: string | null;
}

// Animation timing constants. Total ~3.8 s budget per the spec
// (1.5 s cheering + 1.5 s waving + 0.8 s fade).
const CHEER_MS = 1500;
const WAVE_MS = 1500;
const FADE_MS = 800;

// ---------------------------------------------------------------------------
// Step body — the speech rendered inside the BeakerBot bubble.
// ---------------------------------------------------------------------------

function TourGoodbyeSpeech() {
  return (
    <div data-step-id="tour-goodbye" className="space-y-2">
      <p className="leading-relaxed">
        You&apos;re set! Here&apos;s to many great experiments ahead.
      </p>
      <p className="leading-relaxed">
        If you ever get stuck on a page, click the{" "}
        <span aria-label="help" role="img">❓</span> icon in the top right to
        jump to the wiki — every page has its own guide.
      </p>
      <p className="leading-relaxed">Good luck.</p>
    </div>
  );
}

/**
 * Step record for tour-goodbye. Uses the standard `manualAdvance` button
 * so the speech bubble renders the "Let's go" affordance via the
 * controller's normal flow. `onExit` is what kicks off the outro.
 */
export const tourGoodbyeStep: TourStep = buildWalkthroughStep({
  id: "tour-goodbye",
  speech: () => <TourGoodbyeSpeech />,
  pose: "cheering",
  completion: manualAdvance("Let's go"),
  onExit: async () => {
    // Only fire the outro on a forward advance — never on a back-step
    // or a skipStep transition. Resolved via a dynamic import to avoid
    // a circular load chain (step-registry -> this file ->
    // TourController -> step-registry). The import resolves the
    // already-loaded TourController module from the require cache, so
    // there is no cost beyond the first call.
    let transition: string;
    try {
      const controllerMod = await import("../../TourController");
      transition = controllerMod.getLastTourTransition();
    } catch (err) {
      console.warn("[tour-goodbye] lastTourTransition probe failed", err);
      return;
    }
    if (transition !== "advance") return;
    // The username + first-project-id are resolved by the sibling host.
    // Dispatching without payload keeps the step body free of
    // dependencies on the current user identity (which the step doesn't
    // own — V4MountForUser does).
    try {
      window.dispatchEvent(new CustomEvent(TOUR_GOODBYE_PLAY_OUTRO_EVENT));
    } catch (err) {
      console.warn("[tour-goodbye] outro event dispatch failed", err);
    }
  },
});

// ---------------------------------------------------------------------------
// Outro overlay component — mounted as a SIBLING of <TourControllerProvider>
// inside V4MountForUser so it survives the tour's currentStep going null.
// ---------------------------------------------------------------------------

interface TourGoodbyeOverlayProps {
  /** Active user's username — used to thread auto-cleanup. */
  username: string;
  /** Override for `runEndOfTourAutoCleanup`. Tests pass a vi.fn so they
   *  don't try to read the file system. */
  runCleanupFn?: typeof runEndOfTourAutoCleanup;
}

type OverlayPhase = "idle" | "cheering" | "waving" | "fading";

/**
 * Outro animation overlay. Listens for `tour-goodbye:play-outro` and
 * runs the cheer → wave → fade animation; routes to `/` on completion.
 * Renders nothing until the event fires; renders nothing again after
 * the fade-out finishes.
 */
export function TourGoodbyeOverlay({
  username,
  runCleanupFn,
}: TourGoodbyeOverlayProps) {
  const [phase, setPhase] = useState<OverlayPhase>("idle");
  const router = useRouter();
  const cleanupKickedRef = useRef(false);

  // Subscribe to the play-outro event. Resolves the first-project-id
  // from the sidecar, kicks off cleanup, then sequences the animation.
  useEffect(() => {
    const handler = () => {
      if (phase !== "idle") return;
      setPhase("cheering");
    };
    window.addEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, handler);
    return () => {
      window.removeEventListener(TOUR_GOODBYE_PLAY_OUTRO_EVENT, handler);
    };
  }, [phase]);

  // Run cleanup once the overlay enters "cheering". Resolves the
  // first-project-id off the sidecar's artifact list. Pure background;
  // the animation does not wait for it.
  useEffect(() => {
    if (phase !== "cheering") return;
    if (cleanupKickedRef.current) return;
    cleanupKickedRef.current = true;
    const fn = runCleanupFn ?? runEndOfTourAutoCleanup;
    void (async () => {
      try {
        const cur = await readOnboarding(username);
        const firstProject = (cur.wizard_resume_state?.artifacts_created ?? [])
          .find((a) => a.type === "project");
        const firstProjectId = firstProject?.id ?? null;
        await fn({ username, firstProjectId });
      } catch (err) {
        console.warn(
          "[tour-goodbye] auto-cleanup failed (best effort)",
          err,
        );
      }
    })();
  }, [phase, username, runCleanupFn]);

  // Sequence the animation phases: cheering → waving → fading → idle (unmounted).
  useEffect(() => {
    if (phase === "cheering") {
      const t = setTimeout(() => setPhase("waving"), CHEER_MS);
      return () => clearTimeout(t);
    }
    if (phase === "waving") {
      const t = setTimeout(() => setPhase("fading"), WAVE_MS);
      return () => clearTimeout(t);
    }
    if (phase === "fading") {
      const t = setTimeout(() => {
        // Route to home AFTER the fade finishes so the user's first
        // post-tour surface is the home page.
        try {
          router.push("/");
        } catch (err) {
          console.warn("[tour-goodbye] router.push failed", err);
        }
        setPhase("idle");
      }, FADE_MS);
      return () => clearTimeout(t);
    }
    return;
  }, [phase, router]);

  if (phase === "idle") return null;

  const isFading = phase === "fading";
  const pose = phase === "cheering" ? "cheering" : "waving";

  return (
    <div
      data-testid="tour-goodbye-overlay"
      data-tour-goodbye-phase={phase}
      role="status"
      aria-live="polite"
      aria-label="Onboarding tour goodbye"
      className="fixed inset-0 z-[600] flex items-center justify-center bg-white/85 backdrop-blur-sm pointer-events-none"
      style={{
        opacity: isFading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      {phase === "cheering" ? <ConfettiBurst /> : null}
      <div className="flex flex-col items-center gap-4">
        <BeakerBot
          pose={pose}
          className="w-40 h-40 text-sky-500"
          ariaLabel="BeakerBot waving goodbye"
        />
        <p className="text-base font-medium text-gray-900">
          {phase === "cheering" ? "Here's to many great experiments ahead!" : "See you around!"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline canvas confetti — ~20 lines, no dependency. A single burst
// fires on mount; particles fall under gravity and fade out as they
// drop below the viewport.
// ---------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  vr: number;
  color: string;
}

const CONFETTI_COLORS = [
  "#0ea5e9", // sky-500
  "#f472b6", // pink-400
  "#facc15", // yellow-400
  "#34d399", // emerald-400
  "#a78bfa", // violet-400
];

function ConfettiBurst() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Spawn ~80 particles from the top-center of the screen.
    const particles: Particle[] = Array.from({ length: 80 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * 200,
      y: h / 3,
      vx: (Math.random() - 0.5) * 8,
      vy: Math.random() * -8 - 2,
      size: 6 + Math.random() * 4,
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    }));

    let raf = 0;
    let alive = true;
    function tick() {
      if (!alive || !ctx) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.vy += 0.25; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="tour-goodbye-confetti"
      className="absolute inset-0 pointer-events-none"
    />
  );
}

export default TourGoodbyeOverlay;
