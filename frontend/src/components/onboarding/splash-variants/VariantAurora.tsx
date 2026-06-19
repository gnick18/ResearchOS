// Splash variant A -- "Aurora Curtain".
//
// Concept: a calm, premium, CENTERED composition with a strong type hierarchy.
// The personalized greeting is the hero, set large at the top. The BeakerBot
// mascot draws on and fills below it, the ResearchOS wordmark settles in as the
// liquid reaches the lip, then a soft AURORA gradient sweeps DIAGONALLY across
// the stage (not a mechanical vertical flood) and dissolves to reveal the app.
// The utilitarian percent counter and generic tagline are gone; in their place
// a single quiet status word fades in and out.
//
// Choreography (staggered, intentional):
//   0.00s  greeting fades + rises in
//   0.25s  beaker outline draws on, face wakes, liquid begins rising
//   ~fill  wordmark settles in as liquid reaches the lip (onFillComplete)
//   +0.9s  aurora curtain sweeps diagonally across the stage
//   +1.5s  curtain dissolves, onComplete fires
//
// Reduced motion: static centered logo (greeting + filled beaker + wordmark),
// onComplete after a short hold. No sweep.
//
// No emojis, no em-dashes, no mid-sentence colons.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SplashBeaker } from "@/components/animations/SplashBeaker";
import {
  INK,
  MUTED,
  RAINBOW_CSS,
  SplashVariantProps,
  WORDMARK_GRADIENT,
  resolveGreetingName,
  prefersReducedMotion,
} from "./shared";

export function VariantAurora({
  onComplete,
  userName,
  preferredName,
  replayKey = 0,
}: SplashVariantProps) {
  const name = resolveGreetingName({ preferredName, displayName: userName });
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // The variant is keyed by replayKey at the call site, so a replay remounts it
  // fresh. reduced is read once per mount via a lazy initializer (no
  // setState-in-effect), which is correct because the OS preference does not
  // change mid-splash.
  const [reduced] = useState(prefersReducedMotion);
  const [filled, setFilled] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [faded, setFaded] = useState(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCompleteRef.current();
  }, []);

  // Escape to skip
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  // reduced-motion short path
  useEffect(() => {
    if (!reduced) return;
    const t = window.setTimeout(finish, 900);
    return () => window.clearTimeout(t);
  }, [reduced, finish]);

  // when liquid reaches the lip, settle the wordmark then start the sweep
  const handleFill = () => {
    if (reduced) return;
    setFilled(true);
    // Hold for two full pour cycles (CYCLE=600ms in SplashBeaker) before the
    // curtain sweep, so the viewer watches a couple of complete pours and the
    // sweep always begins when the beaker is back upright, never mid-tip.
    const HOLD = 1200;
    window.setTimeout(() => setSweeping(true), HOLD);
    window.setTimeout(() => setFaded(true), HOLD + 950);
    window.setTimeout(finish, HOLD + 1550);
  };

  return (
    <div
      className="fixed inset-0 grid place-items-center overflow-hidden"
      style={{
        zIndex: 9999,
        background:
          "radial-gradient(120% 110% at 50% 32%, #ffffff 0%, #EAF5FE 48%, #d8edfb 100%)",
      }}
    >
      <style>{`
        @keyframes auroraGreetIn {
          from { opacity: 0; transform: translateY(14px); filter: blur(6px); }
          to   { opacity: 1; transform: none; filter: blur(0); }
        }
        @keyframes auroraWmIn {
          from { opacity: 0; transform: translateY(18px); letter-spacing: .02em; }
          to   { opacity: 1; transform: none; letter-spacing: -.022em; }
        }
        @keyframes auroraStatusPulse {
          0%   { opacity: 0; }
          20%  { opacity: .8; }
          80%  { opacity: .8; }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .aurora-anim { animation: none !important; opacity: 1 !important; transform: none !important; filter: none !important; }
        }
      `}</style>

      {/* dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.5,
          backgroundImage:
            "radial-gradient(rgba(26,160,230,.12) 1.1px, transparent 1.1px)",
          backgroundSize: "30px 30px",
        }}
      />

      {/* Skip */}
      <button
        type="button"
        onClick={finish}
        className="absolute top-5 right-6 text-sm font-medium transition-colors"
        style={{ color: MUTED, zIndex: 10001 }}
      >
        Skip
      </button>

      {/* center column */}
      <div className="relative flex flex-col items-center text-center" style={{ zIndex: 2 }}>
        {/* hero greeting */}
        {name ? (
          <div
            className="aurora-anim"
            style={{
              marginBottom: "4.5vmin",
              animation: reduced ? "none" : "auroraGreetIn .8s cubic-bezier(.16,.84,.24,1) both",
            }}
          >
            <div
              style={{
                fontSize: "min(2.4vmin, 17px)",
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: MUTED,
              }}
            >
              Welcome back
            </div>
            <div
              style={{
                marginTop: "0.6vmin",
                fontSize: "min(8.6vmin, 76px)",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: INK,
              }}
            >
              {name}
            </div>
          </div>
        ) : (
          <div
            className="aurora-anim"
            style={{
              marginBottom: "3.6vmin",
              fontSize: "min(2.4vmin, 17px)",
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: MUTED,
              animation: reduced ? "none" : "auroraGreetIn .8s cubic-bezier(.16,.84,.24,1) both",
            }}
          >
            Welcome back
          </div>
        )}

        {/* mascot */}
        <SplashBeaker
          playKey={replayKey}
          staticFull={reduced}
          size="min(30vmin, 250px)"
          fillDelayMs={250}
          onFillComplete={handleFill}
        />

        {/* wordmark */}
        <div
          style={{
            marginTop: "4vmin",
            fontSize: "min(6.4vmin, 50px)",
            fontWeight: 800,
            letterSpacing: "-0.022em",
            color: INK,
            opacity: reduced || filled ? 1 : 0,
            animation:
              reduced || !filled
                ? "none"
                : "auroraWmIn .7s cubic-bezier(.16,.84,.24,1) both",
          }}
        >
          Research
          <span
            style={{
              background: WORDMARK_GRADIENT,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            OS
          </span>
        </div>

        {/* quiet status word (replaces the tagline + counter) */}
        <div
          style={{
            marginTop: "1.6vmin",
            fontSize: "min(2.1vmin, 14px)",
            fontWeight: 500,
            letterSpacing: "0.04em",
            color: MUTED,
            opacity: 0,
            animation: reduced ? "none" : "auroraStatusPulse 2.6s ease .4s both",
          }}
        >
          Opening your workspace
        </div>
      </div>

      {/* Aurora curtain -- a soft diagonal sweep, dissolves to reveal the app.
          Two phases: slide fully across the stage, then fade out to reveal. */}
      <div
        className="fixed inset-0"
        style={{
          zIndex: 5,
          pointerEvents: "none",
          background: `linear-gradient(120deg, ${RAINBOW_CSS})`,
          opacity: faded ? 0 : 1,
          transform: sweeping ? "translateX(0)" : "translateX(-115%)",
          transition:
            "transform 1s cubic-bezier(.72,0,.2,1), opacity .55s ease",
          willChange: "transform, opacity",
        }}
        aria-hidden
      />
    </div>
  );
}

export default VariantAurora;
