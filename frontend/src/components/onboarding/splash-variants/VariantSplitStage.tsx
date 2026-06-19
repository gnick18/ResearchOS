// Splash variant B -- "Split Stage".
//
// Concept: an editorial, asymmetric, confident layout. A left-aligned hero
// column carries the personalized greeting at the top of the type hierarchy (a
// short contextual line small + uppercase in the "Welcome back" slot, varying by
// time of day + how busy the day looks, then the user's preferred name set very
// large, honorific-stripped so it never reads "Dr"), with the ResearchOS wordmark
// as a tight lockup beneath it. There is no speech bubble; the greeting role lives
// entirely in that top line. The BeakerBot mascot is a
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
import { buildSplashHeadline } from "@/lib/beakerbot/entry-lines";
import { readUserStats } from "@/lib/beakerbot/user-stats-cache";
import {
  INK,
  MUTED,
  RAINBOW_CSS,
  SKY,
  SplashVariantProps,
  WORDMARK_GRADIENT,
  resolveGreetingName,
  prefersReducedMotion,
} from "./shared";

const FILL_MS = 1500;

export function VariantSplitStage({
  onComplete,
  userName,
  preferredName,
  replayKey = 0,
}: SplashVariantProps) {
  // An explicit preferred name ("call me Grant") wins; else the honorific-stripped
  // first name of the display name, so "Dr. Grant Nickles" greets as "Grant".
  const name = resolveGreetingName({ preferredName, displayName: userName });
  const doneRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Read once per mount (the variant is keyed by replayKey at the call site, so
  // a replay remounts fresh). The OS preference does not change mid-splash.
  const [reduced] = useState(prefersReducedMotion);

  // The short contextual top-line headline (the "Welcome back" slot for a
  // returning user). Seeded with a deterministic default so the server + first
  // client render match (SSR-safe); the hour + stats are only available post-mount
  // (localStorage + the local clock), so the contextual line fills in via an
  // effect. New users (no name) show "Welcome to" instead, decided at render.
  const [headline, setHeadline] = useState("Welcome back");
  useEffect(() => {
    const hour = new Date().getHours();
    const stats = userName ? readUserStats(userName) : null;
    setHeadline(buildSplashHeadline({ hour, stats }));
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

  // reduced-motion short path. Lingers a couple of seconds so the greeting +
  // name are on screen long enough to read before the exit.
  useEffect(() => {
    if (!reduced) return;
    const t = window.setTimeout(finish, 2600);
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
    // Linger after the beaker fills so the greeting + name are read before the
    // lift-and-fade. The beaker fill completes near 1.7s; this hold carries the
    // stage to roughly 4.7s. The exit still lands when the beaker is upright
    // (never mid-tip).
    const HOLD = 3000;
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
            {name ? headline : "Welcome to"}
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
