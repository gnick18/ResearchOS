// Splash variant B -- "Split Stage".
//
// Concept: an editorial, asymmetric, confident layout. A left-aligned hero
// column carries the personalized greeting at the top of the type hierarchy
// ("Welcome back," small + uppercase, then the name set very large), with the
// ResearchOS wordmark as a tight lockup beneath it. The BeakerBot mascot is a
// large graphic anchor on the right, drawing on + filling as a visual rhyme to
// the loading state. Instead of a giant percent counter, a single brand-sky
// hairline progress meter sweeps along the very bottom edge of the stage as the
// liquid rises -- quiet, premium, on-brand.
//
// Exit is restrained: the whole stage eases up + fades (a confident "lift"),
// not a mechanical flood. A thin rainbow underline flashes once as it leaves.
//
// Choreography:
//   0.00s  greeting words rise in, staggered (label, name, wordmark)
//   0.20s  beaker draws on + begins filling, bottom meter sweeps in sync
//   ~fill  meter completes, brief hold
//   +0.5s  stage lifts + fades, onComplete fires
//
// Reduced motion: static left column + filled beaker, meter shown full, hold,
// onComplete.
//
// No emojis, no em-dashes, no mid-sentence colons.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SplashBeaker } from "@/components/animations/SplashBeaker";
import BeakerSpeech from "@/components/beakerbot/BeakerSpeech";
import { buildReturningLines } from "@/lib/beakerbot/entry-lines";
import { readUserStats } from "@/lib/beakerbot/user-stats-cache";
import {
  INK,
  MUTED,
  RAINBOW_CSS,
  SKY,
  SplashVariantProps,
  WORDMARK_GRADIENT,
  firstName,
  prefersReducedMotion,
} from "./shared";

const FILL_MS = 1500;

export function VariantSplitStage({
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

  // Tier-B returning lines. Seeded empty on server/first render (SSR-safe),
  // populated after mount when localStorage and the current hour are available.
  const [returningLines, setReturningLines] = useState<string[]>([]);
  useEffect(() => {
    const hour = new Date().getHours();
    const stats = userName ? readUserStats(userName) : null;
    const lines = buildReturningLines({
      name: firstName(userName),
      hour,
      stats,
      now: Date.now(),
    });
    setReturningLines(lines);
  }, [userName]);
  const [meter, setMeter] = useState(() => (prefersReducedMotion() ? 1 : 0));
  const [leaving, setLeaving] = useState(false);

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

  // reduced-motion short path
  useEffect(() => {
    if (!reduced) return;
    const t = window.setTimeout(finish, 950);
    return () => window.clearTimeout(t);
  }, [reduced, finish]);

  // drive the bottom meter in step with the beaker fill (own rAF so the bar
  // motion is independent of the SVG internals)
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const delay = 200; // match beaker fillDelay-ish
    const step = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - start - delay) / FILL_MS));
      setMeter(1 - Math.pow(1 - k, 2.2));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const handleFill = () => {
    if (reduced) return;
    // Hold for two full pour cycles (CYCLE=600ms in SplashBeaker) before the
    // lift-and-fade, so the viewer watches a couple of complete pours and the
    // exit always fires when the beaker is back upright, never mid-tip.
    const HOLD = 1200;
    window.setTimeout(() => setLeaving(true), HOLD);
    window.setTimeout(finish, HOLD + 620);
  };

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        zIndex: 9999,
        background:
          "radial-gradient(130% 120% at 78% 30%, #ffffff 0%, #EAF5FE 52%, #d6ecfb 100%)",
        opacity: leaving ? 0 : 1,
        transform: leaving ? "translateY(-3%) scale(1.012)" : "none",
        transition: "opacity .6s ease, transform .6s cubic-bezier(.5,0,.2,1)",
      }}
    >
      <style>{`
        @keyframes splitRise {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .split-anim { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      {/* faint dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          opacity: 0.4,
          backgroundImage:
            "radial-gradient(rgba(26,160,230,.12) 1.1px, transparent 1.1px)",
          backgroundSize: "32px 32px",
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

      {/* asymmetric grid: hero left, mascot right */}
      <div
        className="absolute inset-0 grid items-center"
        style={{
          gridTemplateColumns: "1.1fr 0.9fr",
          paddingInline: "clamp(40px, 9vw, 150px)",
          gap: "clamp(24px, 5vw, 80px)",
          zIndex: 2,
        }}
      >
        {/* hero column */}
        <div className="flex flex-col items-start text-left">
          <div
            className="split-anim"
            style={{
              fontSize: "min(2.4vmin, 18px)",
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: SKY,
              animation: reduced ? "none" : "splitRise .7s cubic-bezier(.16,.84,.24,1) both",
            }}
          >
            {name ? "Welcome back" : "Welcome to"}
          </div>

          <div
            className="split-anim"
            style={{
              marginTop: "1vmin",
              fontSize: name ? "min(11vmin, 104px)" : "min(9vmin, 84px)",
              fontWeight: 850,
              letterSpacing: "-0.035em",
              lineHeight: 0.98,
              color: INK,
              animation: reduced ? "none" : "splitRise .75s cubic-bezier(.16,.84,.24,1) .08s both",
            }}
          >
            {name || (
              <>
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
              </>
            )}
          </div>

          {/* wordmark lockup beneath the name (only when a name was the hero) */}
          {name && (
            <div
              className="split-anim"
              style={{
                marginTop: "2.4vmin",
                fontSize: "min(4vmin, 30px)",
                fontWeight: 800,
                letterSpacing: "-0.02em",
                color: INK,
                opacity: 0.92,
                animation: reduced ? "none" : "splitRise .75s cubic-bezier(.16,.84,.24,1) .18s both",
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
          )}

          {/* Tier-B speech bubble. Only shown after mount (returningLines is
              seeded empty on first render), so it never causes a hydration
              mismatch. The beaker is in the RIGHT column so the bubble sits in
              the left hero column with side="left" -- the notch points RIGHT
              toward the beaker across the grid gap. Width is fit-content so
              short lines make a short bubble. */}
          {returningLines.length > 0 && (
            <BeakerSpeech
              lines={returningLines}
              tinted
              side="left"
              className="mt-6"
            />
          )}
        </div>

        {/* mascot anchor */}
        <div className="flex items-center justify-center">
          <SplashBeaker
            playKey={replayKey}
            staticFull={reduced}
            size="min(40vmin, 340px)"
            fillDelayMs={200}
            fillMs={FILL_MS}
            onFillComplete={handleFill}
          />
        </div>
      </div>

      {/* bottom hairline progress meter (replaces the percent counter) */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{ height: 3, background: "rgba(26,160,230,.10)", zIndex: 3 }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.round(meter * 100)}%`,
            background: `linear-gradient(90deg, ${SKY}, #6cc4f2)`,
            transition: reduced ? "none" : "width .08s linear",
          }}
        />
      </div>

      {/* subtle rainbow hue that washes across the whole stage as it lifts and
          fades away, so the exit carries a soft brand tint rather than a plain
          fade to nothing */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(115deg, ${RAINBOW_CSS})`,
          opacity: leaving ? 0.64 : 0,
          transition: "opacity .6s ease",
          zIndex: 10000,
        }}
        aria-hidden
      />

      {/* a single rainbow underline flash as the stage lifts away */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${RAINBOW_CSS})`,
          opacity: leaving ? 1 : 0,
          transition: "opacity .35s ease",
          zIndex: 4,
        }}
        aria-hidden
      />
    </div>
  );
}

export default VariantSplitStage;
