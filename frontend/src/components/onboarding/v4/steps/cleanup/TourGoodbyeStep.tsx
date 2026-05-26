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
import { usersApi } from "@/lib/local-api";
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

// Animation timing constants. Total ~4.4 s budget
// (1.8 s cheering + 1.8 s waving + 0.8 s fade).
// Cleanup fix manager R1 bumped cheer + wave from 1500 ms each so the
// confetti has time to land and the wave caption sits long enough to
// register as a deliberate goodbye instead of an instant evaporation.
const CHEER_MS = 1800;
const WAVE_MS = 1800;
const FADE_MS = 800;

// Toast lifespan after the route lands on `/`. 4 s matches the brief
// and gives the user enough time to read + find the Settings pointer.
const TOAST_MS = 4000;

// ---------------------------------------------------------------------------
// Step body — the speech rendered inside the BeakerBot bubble.
// ---------------------------------------------------------------------------

function TourGoodbyeSpeech() {
  // Copy-alignment manager 2026-05-26: tour-goodbye copy was promising
  // "I'll tidy up the demo stuff we built together and leave you with
  // your first project" unconditionally — including for users who hit
  // Skip walkthrough at the welcome step before any project / category /
  // artifact got created. Reading `artifacts_created` off the live
  // sidecar lets us tell the two paths apart: when nothing was built,
  // drop the cleanup-and-first-project line; otherwise keep it. The
  // sibling outro overlay reads the same field to decide whether to run
  // cleanup, so a stale value here only affects which sentence renders,
  // never which files get touched.
  //
  // We resolve the active user via `usersApi.list()` (not `useFileSystem`)
  // so the speech bubble survives test environments that render this
  // step body outside <FileSystemProvider>. `usersApi.list` is the
  // same accessor several other tour step bodies use for the same
  // reason. Any failure degrades to the populated-branch copy, matching
  // the pre-fix behavior.
  const [builtSomething, setBuiltSomething] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const users = await usersApi.list();
        const active = users.current_user;
        if (!active) return;
        const cur = await readOnboarding(active);
        const count = cur.wizard_resume_state?.artifacts_created?.length ?? 0;
        if (!cancelled) setBuiltSomething(count > 0);
      } catch {
        // Best-effort: leave `builtSomething` null so the populated
        // branch (the prior unconditional copy) renders.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Render the populated-state copy while the read is pending so the
  // happy path (the user built artifacts during the tour, which is by
  // far the common case the existing test fixtures exercise) stays
  // unchanged. The branch only flips to the early-skip copy after the
  // sidecar resolves AND artifacts_created is empty.
  const showBuiltLine = builtSomething !== false;
  return (
    <div data-step-id="tour-goodbye" className="space-y-2">
      <p className="leading-relaxed">
        You&apos;re set! Here&apos;s to many great experiments ahead.
      </p>
      {showBuiltLine ? (
        <p className="leading-relaxed">
          I&apos;ll tidy up the demo stuff we built together and leave you
          with your first project.
        </p>
      ) : (
        <p className="leading-relaxed">
          You skipped ahead, so there&apos;s nothing for me to clean up.
          Your account is ready to go whenever you are.
        </p>
      )}
      <p className="leading-relaxed">
        If you ever need a refresher, every page has its own wiki guide.
        Look for the help icon up top, next to the gear icon.
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

type OverlayPhase = "idle" | "cheering" | "waving" | "fading" | "toast";

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

  // Sequence the animation phases: cheering → waving → fading → toast →
  // idle (unmounted). Cleanup fix manager R1: route push moved to the
  // START of fade (was end) so the route swap happens INSIDE the fade
  // overlay; otherwise the user briefly sees the underlying page bleed
  // through the fading translucent backdrop.
  useEffect(() => {
    if (phase === "cheering") {
      const t = setTimeout(() => setPhase("waving"), CHEER_MS);
      return () => clearTimeout(t);
    }
    if (phase === "waving") {
      const t = setTimeout(() => {
        // Push BEFORE flipping to "fading" so the route swap is hidden
        // behind the fully-opaque overlay; the fade then reveals "/"
        // already in place.
        try {
          router.push("/");
        } catch (err) {
          console.warn("[tour-goodbye] router.push failed", err);
        }
        setPhase("fading");
      }, WAVE_MS);
      return () => clearTimeout(t);
    }
    if (phase === "fading") {
      const t = setTimeout(() => setPhase("toast"), FADE_MS);
      return () => clearTimeout(t);
    }
    if (phase === "toast") {
      const t = setTimeout(() => setPhase("idle"), TOAST_MS);
      return () => clearTimeout(t);
    }
    return;
  }, [phase, router]);

  if (phase === "idle") return null;

  // The "toast" phase renders ONLY a small bottom-right toast, no
  // backdrop, so the user can interact with the home page while it sits.
  if (phase === "toast") {
    return (
      <div
        data-testid="tour-goodbye-toast"
        role="status"
        aria-live="polite"
        className="fixed bottom-6 right-6 z-[600] max-w-sm rounded-lg bg-gray-900 text-white shadow-lg px-4 py-3 text-sm pointer-events-auto"
      >
        Tour complete. Find BeakerBot again in Settings → Onboarding.
      </div>
    );
  }

  const isFading = phase === "fading";
  const isWaving = phase === "waving";
  const pose = phase === "cheering" ? "cheering" : "waving";

  // During the wave phase, animate BeakerBot translating slightly RIGHT
  // + scaling down. Combined with the fade, this reads as "BeakerBot
  // walked off-screen" instead of "BeakerBot evaporated." The transform
  // and fade both ride the same CSS transition.
  const beakerTransform = isWaving || isFading
    ? "translateX(80px) scale(0.8)"
    : "translateX(0) scale(1)";
  const beakerOpacity = isFading ? 0 : 1;

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
        <div
          style={{
            transform: beakerTransform,
            opacity: beakerOpacity,
            transition: `transform ${WAVE_MS}ms ease-in, opacity ${FADE_MS}ms ease-out`,
          }}
        >
          <BeakerBot
            pose={pose}
            className="w-40 h-40 text-sky-500"
            ariaLabel="BeakerBot waving goodbye"
          />
        </div>
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

// Confetti emission constants. Cleanup fix manager R1: emit two waves
// (80 at mount, 60 at +500ms) so the confetti fills the now-1.8s
// cheering phase visually instead of going stale by ~700ms.
const CONFETTI_WAVE_1_COUNT = 80;
const CONFETTI_WAVE_2_COUNT = 60;
const CONFETTI_WAVE_2_DELAY_MS = 500;

function spawnParticles(count: number, w: number, h: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: w / 2 + (Math.random() - 0.5) * 200,
    y: h / 3,
    vx: (Math.random() - 0.5) * 8,
    vy: Math.random() * -8 - 2,
    size: 6 + Math.random() * 4,
    rotation: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.3,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  }));
}

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

    // Wave 1: spawn immediately on mount.
    const particles: Particle[] = spawnParticles(CONFETTI_WAVE_1_COUNT, w, h);

    // Wave 2: spawn at +500ms so the cheering phase looks visually full
    // for its entire 1.8s duration, not just the first ~700ms.
    const wave2Timer = window.setTimeout(() => {
      particles.push(...spawnParticles(CONFETTI_WAVE_2_COUNT, w, h));
    }, CONFETTI_WAVE_2_DELAY_MS);

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
      window.clearTimeout(wave2Timer);
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
