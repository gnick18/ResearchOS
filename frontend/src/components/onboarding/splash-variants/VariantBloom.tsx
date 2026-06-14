// Splash variant C -- "Pour and Bloom".
//
// Concept: the most kinetic of the three, but still premium. The BeakerBot
// mascot is large and centered. As the rainbow liquid rises, the ResearchOS
// wordmark gets "painted" by the same liquid -- its fill sweeps up from a flat
// ink color into the full pastel rainbow, in time with the pour. The greeting
// rises in above. When the beaker is full, the liquid BLOOMS outward as a
// radial rainbow wash that expands from the center of the beaker to fill the
// screen, then dissolves to reveal the app. The exit reads as cause and effect
// (the beaker overflowed into the whole room), not a mechanical wipe.
//
// Choreography:
//   0.00s  greeting rises in
//   0.20s  beaker draws on + fills; wordmark "paint line" rises with the liquid
//   ~fill  radial rainbow bloom expands from the beaker center
//   +0.8s  bloom dissolves, onComplete fires
//
// Reduced motion: static centered logo with the wordmark fully painted, hold,
// onComplete. No bloom.
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
  firstName,
  prefersReducedMotion,
} from "./shared";

const FILL_MS = 1450;

export function VariantBloom({
  onComplete,
  userName,
  replayKey = 0,
}: SplashVariantProps) {
  const name = firstName(userName);
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Read once per mount (the variant is keyed by replayKey at the call site, so
  // a replay remounts fresh). The OS preference does not change mid-splash.
  const [reduced] = useState(prefersReducedMotion);
  const [paint, setPaint] = useState(() => (prefersReducedMotion() ? 1 : 0));
  const [blooming, setBlooming] = useState(false);
  const [bloomFade, setBloomFade] = useState(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  useEffect(() => {
    if (!reduced) return;
    const t = window.setTimeout(finish, 950);
    return () => window.clearTimeout(t);
  }, [reduced, finish]);

  // paint line rises with the liquid
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const delay = 240;
    const step = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - start - delay) / FILL_MS));
      setPaint(1 - Math.pow(1 - k, 2.2));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const handleFill = () => {
    if (reduced) return;
    // Hold for two full pour cycles (CYCLE=600ms in SplashBeaker) before the
    // bloom, so the viewer watches a couple of complete pours and the bloom
    // expands from an upright beaker rather than cutting off a tip.
    const HOLD = 1200;
    window.setTimeout(() => setBlooming(true), HOLD);
    window.setTimeout(() => setBloomFade(true), HOLD + 700);
    window.setTimeout(finish, HOLD + 700 + 520);
  };

  // wordmark paint: a vertical gradient that reveals rainbow from the bottom up
  // as `paint` goes 0 -> 1. Below the line is rainbow, above is flat ink.
  const linePct = Math.round((1 - paint) * 100);
  const wordmarkFill =
    paint >= 1
      ? `linear-gradient(95deg, ${RAINBOW_CSS})`
      : `linear-gradient(0deg,
           #FFD2B0 0%,
           #B7EBB1 ${Math.max(0, 100 - linePct - 8)}%,
           #A6D2F4 ${Math.max(0, 100 - linePct)}%,
           ${INK} ${Math.max(0, 100 - linePct)}%,
           ${INK} 100%)`;

  return (
    <div
      className="fixed inset-0 grid place-items-center overflow-hidden"
      style={{
        zIndex: 9999,
        background:
          "radial-gradient(120% 110% at 50% 40%, #ffffff 0%, #EAF5FE 50%, #d6ecfb 100%)",
      }}
    >
      <style>{`
        @keyframes bloomRise {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .bloom-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      {/* dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.45,
          backgroundImage:
            "radial-gradient(rgba(26,160,230,.12) 1.1px, transparent 1.1px)",
          backgroundSize: "30px 30px",
        }}
      />

      {/* Skip */}
      <button
        type="button"
        onClick={finish}
        className="absolute top-5 right-6 text-sm font-medium"
        style={{ color: MUTED, zIndex: 10001 }}
      >
        Skip
      </button>

      {/* center column */}
      <div className="relative flex flex-col items-center text-center" style={{ zIndex: 2 }}>
        {/* greeting */}
        <div
          className="bloom-anim"
          style={{
            marginBottom: "3.4vmin",
            animation: reduced ? "none" : "bloomRise .7s cubic-bezier(.16,.84,.24,1) both",
          }}
        >
          {name ? (
            <div
              style={{
                fontSize: "min(5.6vmin, 46px)",
                fontWeight: 800,
                letterSpacing: "-0.028em",
                color: INK,
                lineHeight: 1.05,
              }}
            >
              Welcome back,{" "}
              <span style={{ color: "#1283c9" }}>{name}</span>
            </div>
          ) : (
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
          )}
        </div>

        {/* mascot */}
        <SplashBeaker
          playKey={replayKey}
          staticFull={reduced}
          size="min(34vmin, 290px)"
          fillDelayMs={240}
          fillMs={FILL_MS}
          onFillComplete={handleFill}
        />

        {/* wordmark painted by the pour */}
        <div
          className="bloom-anim"
          style={{
            marginTop: "4vmin",
            fontSize: "min(7vmin, 56px)",
            fontWeight: 850,
            letterSpacing: "-0.024em",
            animation: reduced ? "none" : "bloomRise .7s cubic-bezier(.16,.84,.24,1) .15s both",
          }}
        >
          <span
            style={{
              background: wordmarkFill,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            ResearchOS
          </span>
        </div>
      </div>

      {/* radial rainbow bloom -- expands from the beaker center, then dissolves */}
      <div
        className="fixed"
        style={{
          left: "50%",
          top: "50%",
          width: "10px",
          height: "10px",
          marginLeft: "-5px",
          marginTop: "-5px",
          borderRadius: "50%",
          zIndex: 5,
          pointerEvents: "none",
          background: `radial-gradient(circle, ${RAINBOW_CSS})`,
          transform: blooming ? "scale(420)" : "scale(0)",
          opacity: bloomFade ? 0 : 1,
          transition:
            "transform .85s cubic-bezier(.5,0,.2,1), opacity .5s ease",
          willChange: "transform, opacity",
        }}
        aria-hidden
      />
    </div>
  );
}

export default VariantBloom;
