// The animated BeakerBot mascot used by the app-launch Splash redesigns.
//
// This is the SAME sky-blue character as BeakerBotMark / IntroBeaker (identical
// viewBox + paths + face), but it ANIMATES: the glass outline draws on, the
// face wakes, and a pastel-rainbow liquid rises inside the glass with a live
// meniscus drift. It is the shared, choreographed centerpiece every Splash
// variant composes around, so the actual SVG geometry lives in exactly one
// place.
//
// Lives under components/animations/ on purpose: that directory is exempt from
// the icon-guard ratchet (see frontend/scripts/update-icon-baseline.mjs), which
// is the correct home for a decorative animated mascot rather than a registry
// icon. Keeping every inline <svg> for the Splash here means the variant
// components and the dev page stay raw-SVG-free and never trip the guard.
//
// Motion is imperative (rAF) so a parent variant can choreograph precisely:
//   - pass a `playKey` that changes to (re)start the whole sequence
//   - `drawMs` / `fillDelayMs` / `fillMs` tune the timing
//   - `onFillComplete` fires when the liquid reaches the lip, so the variant
//     can stagger its own reveals off the real fill end
//   - reduced motion: the liquid is shown already full and static, the outline
//     is fully drawn, the face is awake, and onFillComplete fires next tick.
//
// No emojis, no em-dashes, no mid-sentence colons.

"use client";

import { useEffect, useRef } from "react";

const SKY = "#1AA0E6";

// Pastel rainbow ramp (brand-verbatim).
const RAMP = ["#FFD2B0", "#FFF1A8", "#B7EBB1", "#A6D2F4", "#D6B5F0"] as const;

export interface SplashBeakerProps {
  /** Change this value to (re)start the full draw + fill sequence. */
  playKey: number;
  /** Pixel width of the mark (height auto). */
  size?: number | string;
  /** Outline draw-on duration. */
  drawMs?: number;
  /** Delay before the liquid starts rising (lets the outline land first). */
  fillDelayMs?: number;
  /** Liquid rise duration. */
  fillMs?: number;
  /** Fires once the liquid reaches the lip (real fill end). */
  onFillComplete?: () => void;
  /** Force the static, fully-filled, fully-drawn frame (reduced motion). */
  staticFull?: boolean;
  /** Drop-shadow under the glass. Pass false for a flat mark. */
  shadow?: boolean;
  className?: string;
}

// Water-group translate: 22 = empty (surface below the body), 1 = brim/lip.
// The fill OVERFILLS to the brim, then the "splish" spills the excess back
// down to REST_Y — BeakerBot's natural liquid line (ported from the original
// Splash.tsx tip-and-settle: empty 22 / lip 0 / normal 16).
const EMPTY_Y = 22;
const LIP_Y = 1;
const REST_Y = 16;

export function SplashBeaker({
  playKey,
  size = 260,
  drawMs = 780,
  fillDelayMs = 360,
  fillMs = 1300,
  onFillComplete,
  staticFull = false,
  shadow = true,
  className,
}: SplashBeakerProps) {
  const rootRef = useRef<SVGSVGElement>(null);
  const onFillRef = useRef(onFillComplete);
  useEffect(() => {
    onFillRef.current = onFillComplete;
  }, [onFillComplete]);

  useEffect(() => {
    const svg = rootRef.current;
    if (!svg) return;

    const water = svg.querySelector<SVGGElement>("[data-water]");
    const w1 = svg.querySelector<SVGPathElement>("[data-w1]");
    const w2 = svg.querySelector<SVGPathElement>("[data-w2]");
    const w3 = svg.querySelector<SVGPathElement>("[data-w3]");
    const draws = svg.querySelectorAll<SVGPathElement>("[data-draw]");
    const face = svg.querySelector<SVGGElement>("[data-face]");
    const spill = svg.querySelector<SVGGElement>("[data-spill]");
    const bot = svg.querySelector<SVGGElement>("[data-bot]");
    if (!water || !w1 || !w2 || !w3 || !face) return;

    const setLevel = (y: number) =>
      water.setAttribute("transform", `translate(0,${y})`);

    // ---- static / reduced-motion frame -----------------------------------
    if (staticFull) {
      setLevel(REST_Y);
      draws.forEach((p) => {
        p.style.transition = "none";
        p.style.strokeDashoffset = "0";
      });
      face.style.opacity = "1";
      face.style.transform = "none";
      const t = window.setTimeout(() => onFillRef.current?.(), 0);
      return () => window.clearTimeout(t);
    }

    // ---- choreographed frame ---------------------------------------------
    const timers: number[] = [];
    let raf = 0;
    let waveRaf = 0;
    let loopRaf = 0;
    let fired = false;

    // reset
    setLevel(EMPTY_Y);
    face.style.opacity = "0";
    face.style.transform = "translateY(1px) scale(0.85)";
    draws.forEach((p, i) => {
      const len = p.getTotalLength?.() ?? 120;
      p.style.transition = "none";
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
      // force reflow then animate
      void p.getBoundingClientRect();
      p.style.transition = `stroke-dashoffset ${drawMs}ms cubic-bezier(.65,0,.2,1) ${i * 90}ms`;
      p.style.strokeDashoffset = "0";
    });

    // face wakes shortly after the outline lands
    timers.push(
      window.setTimeout(() => {
        face.style.transition =
          "opacity .42s cubic-bezier(.2,.8,.2,1), transform .42s cubic-bezier(.2,.8,.2,1)";
        face.style.opacity = "1";
        face.style.transform = "none";
      }, drawMs + 120),
    );

    // continuous meniscus drift
    const wave = (now: number) => {
      const t = now / 380;
      w1.setAttribute("transform", `translate(${Math.sin(t) * 2.2},0)`);
      w2.setAttribute("transform", `translate(${Math.sin(t + 1.7) * -2.6},0)`);
      w3.setAttribute("transform", `translate(${Math.sin(t + 3.1) * 1.6},0)`);
      waveRaf = requestAnimationFrame(wave);
    };
    waveRaf = requestAnimationFrame(wave);

    // liquid rise — OVERFILLS to the brim, then the splish spills the excess
    // back down to the natural line (REST_Y) with a few droplets off the lip.
    timers.push(
      window.setTimeout(() => {
        const start = performance.now();
        const step = (now: number) => {
          const k = Math.min(1, (now - start) / fillMs);
          const e = 1 - Math.pow(1 - k, 2.2); // easeOut
          setLevel(EMPTY_Y - (EMPTY_Y - LIP_Y) * e);
          if (k < 1) {
            raf = requestAnimationFrame(step);
            return;
          }
          // reached the brim: fire the flourish, then spill + settle to REST_Y.
          if (!fired) {
            fired = true;
            onFillRef.current?.();
          }
          // perpetual "pouring" loop: he tips around his base (20,31) and a
          // droplet spills off the lip each cycle; the water settles to the
          // natural line on the first pass, then holds. Loops until unmount.
          const loopStart = performance.now();
          const CYCLE = 600;
          const pour = (t2: number) => {
            const elapsed = t2 - loopStart;
            const phase = (elapsed % CYCLE) / CYCLE;
            const settleK = Math.min(1, elapsed / 600);
            setLevel(LIP_Y + (REST_Y - LIP_Y) * (1 - Math.pow(1 - settleK, 2)));
            const angle = 12 * Math.sin(phase * Math.PI);
            bot?.setAttribute("transform", `rotate(${angle.toFixed(2)}, 20, 31)`);
            if (spill) {
              spill.setAttribute(
                "transform",
                `translate(${(phase * 3).toFixed(2)}, ${(phase * 15).toFixed(2)})`,
              );
              spill.style.opacity = String(
                phase < 0.12 ? phase / 0.12 : phase > 0.6 ? Math.max(0, (1 - phase) / 0.4) : 1,
              );
            }
            loopRaf = requestAnimationFrame(pour);
          };
          loopRaf = requestAnimationFrame(pour);
        };
        raf = requestAnimationFrame(step);
      }, fillDelayMs),
    );

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(raf);
      cancelAnimationFrame(waveRaf);
      cancelAnimationFrame(loopRaf);
    };
  }, [playKey, staticFull, drawMs, fillDelayMs, fillMs]);

  const gradId = "splashBeakerLiq";
  const clipId = "splashBeakerClip";

  return (
    <svg
      ref={rootRef}
      viewBox="6 1 28 34"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        width: typeof size === "number" ? `${size}px` : size,
        height: "auto",
        overflow: "visible",
        filter: shadow ? "drop-shadow(0 14px 30px rgba(26,160,230,.24))" : undefined,
      }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={RAMP[0]} />
          <stop offset="25%" stopColor={RAMP[1]} />
          <stop offset="50%" stopColor={RAMP[2]} />
          <stop offset="75%" stopColor={RAMP[3]} />
          <stop offset="100%" stopColor={RAMP[4]} />
        </linearGradient>
        <clipPath id={clipId}>
          <path d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z" />
        </clipPath>
      </defs>

      {/* Everything that tips together pivots around the base (20,31). The
          spill droplets live OUTSIDE this group so they fall straight. */}
      <g data-bot>
      {/* White glass body so liquid + face read on a light canvas */}
      <path
        d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
        fill="#fff"
      />

      {/* Rising rainbow liquid clipped to the beaker interior */}
      <g clipPath={`url(#${clipId})`}>
        <g data-water transform={`translate(0,${EMPTY_Y})`}>
          <path
            data-w1
            d="M-12,3 Q -7,0.6 -2,3 T 8,3 T 18,3 T 28,3 T 38,3 T 48,3 L48,34 L-12,34 Z"
            fill={`url(#${gradId})`}
          />
          <path
            data-w2
            d="M-12,3 Q -7,5 -2,3 T 8,3 T 18,3 T 28,3 T 38,3 T 48,3 L48,34 L-12,34 Z"
            fill={`url(#${gradId})`}
            opacity="0.55"
          />
          <path
            data-w3
            d="M-12,2.6 Q -7,4.4 -2,2.6 T 8,2.6 T 18,2.6 T 28,2.6 T 38,2.6 T 48,2.6 L48,34 L-12,34 Z"
            fill={`url(#${gradId})`}
            opacity="0.35"
          />
        </g>
      </g>

      {/* Outline draws on: neck spout + body + lip */}
      <g
        stroke={SKY}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path data-draw d="M22 8 C 22 6, 24 4, 26 6" />
        <path data-draw d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
        <path data-draw d="M11 12 L29 12" />
        {/* BeakerBot's little arms (left + right side stubs) — part of the
            canonical mascot (IntroBeaker.tsx:63-64); the redesign dropped
            them, draw them on with the rest of the outline. */}
        <path data-draw d="M14 26 L15.5 26" />
        <path data-draw d="M24.5 26 L26 26" />
      </g>

      {/* Face wakes after the outline lands */}
      <g data-face style={{ opacity: 0, transformBox: "fill-box", transformOrigin: "center" }}>
        <circle cx="17" cy="18" r="1.25" fill={SKY} />
        <circle cx="23" cy="18" r="1.25" fill={SKY} />
        <path
          d="M18 22 Q 20 24, 22 22"
          stroke={SKY}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
      </g>
      </g>

      {/* Spill droplets — fall straight from the lip as he tips, on a loop. */}
      <g data-spill opacity="0">
        <ellipse cx="26.5" cy="10" rx="0.7" ry="1" fill={RAMP[3]} />
        <ellipse cx="28" cy="9" rx="0.5" ry="0.8" fill={RAMP[0]} />
        <ellipse cx="25" cy="11" rx="0.5" ry="0.7" fill={RAMP[2]} />
      </g>
    </svg>
  );
}

export default SplashBeaker;
