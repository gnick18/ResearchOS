// Full-screen branded splash animation.
//
// Ported faithfully from docs/mockups/account-splash.html (APPROVED spec).
// Plays once on app open: BeakerBot outline draws on, rainbow pastel liquid
// fills with a percentage counter, wordmark rises, then a rainbow flood reveal
// wipes the stage and onComplete fires. Total duration is approximately 2.5 s
// at normal speed (exitAt 2550 ms + flood settles).
//
// Reduced-motion: skip all animation, show a static centered logo, fire
// onComplete after 600 ms so the caller can advance immediately.
//
// No new dependencies -- pure CSS keyframes + inline SVG + JS timers.
// The draw-on outline REQUIRES inline SVG (stroke-dasharray animation cannot
// work on an <img> element), which is expected for this component.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

"use client";

import { useCallback, useEffect, useRef } from "react";

export interface SplashProps {
  /** Called when the flood-reveal animation finishes and the caller should
   * advance to the next screen. */
  onComplete: () => void;
  /** The signed-in user's name. When set, a big "Welcome back, <name>" greets
   * them in the upper-left of the splash. Omitted for an anonymous launch. */
  userName?: string;
}

// ---- brand palette (verbatim from mockup :root) --------------------------------
const SKY = "#1AA0E6";
const INK = "#0c1830";
const MUTED = "#6b7280";

export function Splash({ onComplete, userName }: SplashProps) {
  const greetName = userName?.trim()
    ? userName.trim().charAt(0).toUpperCase() + userName.trim().slice(1)
    : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Fire onComplete at most once (timer end OR a user skip). Unmount clears the
  // remaining timers via the effect cleanup, so skipping is clean.
  const firedRef = useRef(false);
  const finish = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onCompleteRef.current();
  }, []);

  // Skip on Escape. The Skip button (rendered below) calls finish() too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Respect prefers-reduced-motion: show static logo, fire callback quickly.
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) {
      const t = window.setTimeout(() => finish(), 600);
      return () => window.clearTimeout(t);
    }

    // ---- timer management (mirrors clearAll / T helpers in the mockup) ---------
    const timers: (number | ReturnType<typeof requestAnimationFrame>)[] = [];
    let rafHandle: number | null = null;

    function clearAll() {
      timers.forEach((id) => {
        if (typeof id === "number" && id < 1e8) {
          cancelAnimationFrame(id);
        } else {
          clearTimeout(id as number);
        }
      });
      timers.length = 0;
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    }

    function T(fn: () => void, ms: number) {
      timers.push(window.setTimeout(fn, ms));
    }

    // ---- element refs (picked from container so unmount is clean) --------------
    const waterEl = container.querySelector<SVGGElement>("#splash-water");
    const w1 = container.querySelector<SVGPathElement>("#splash-w1");
    const w2 = container.querySelector<SVGPathElement>("#splash-w2");
    const w3 = container.querySelector<SVGPathElement>("#splash-w3");
    const pctEl = container.querySelector<HTMLDivElement>("#splash-pct");
    const floodEl = container.querySelector<HTMLDivElement>("#splash-flood");
    const revealEl = container.querySelector<HTMLDivElement>("#splash-reveal");

    if (!waterEl || !w1 || !w2 || !w3 || !pctEl || !floodEl || !revealEl)
      return;

    function level(y: number) {
      waterEl!.setAttribute("transform", `translate(0,${y})`);
    }

    // Continuous meniscus drift -- 3 layers, different phase + speed.
    function waveLoop(now: number) {
      const t = now / 380;
      w1!.setAttribute("transform", `translate(${Math.sin(t) * 2.2},0)`);
      w2!.setAttribute(
        "transform",
        `translate(${Math.sin(t + 1.7) * -2.6},0)`,
      );
      w3!.setAttribute(
        "transform",
        `translate(${Math.sin(t + 3.1) * 1.6},0)`,
      );
      rafHandle = requestAnimationFrame(waveLoop);
    }

    // Reset state then run.
    revealEl.style.transition = "none";
    revealEl.style.opacity = "0";
    floodEl.style.transition = "none";
    floodEl.style.height = "0";
    floodEl.style.opacity = "1";
    pctEl.style.opacity = "0.9";
    pctEl.textContent = "0";
    level(22);

    // Restart CSS-driven outline draw + face + wordmark animations.
    container
      .querySelectorAll<HTMLElement | SVGElement>(
        ".splash-draw, .splash-face, .splash-wm, .splash-tag",
      )
      .forEach((el) => {
        (el as HTMLElement).style.animation = "none";
        void (el as HTMLElement).offsetHeight; // force reflow
        (el as HTMLElement).style.animation = "";
      });

    rafHandle = requestAnimationFrame(waveLoop);

    // Fill + percentage counter (overfills to the lip; the tip below spills the
    // excess back down to the natural liquid line).
    const fillStart = 450;
    const fillDur = 1400;
    T(() => {
      const start = performance.now();
      function fill(now: number) {
        const k = Math.min(1, (now - start) / fillDur);
        const e = 1 - Math.pow(1 - k, 2.2); // easeOut
        level(22 - 22 * e);
        if (pctEl) {
          pctEl.textContent = String(Math.round(e * 100));
          (pctEl.querySelector(".splash-pct-unit") as HTMLElement | null)
            ?.setAttribute("data-unit", "%");
        }
        if (k < 1) {
          const id = requestAnimationFrame(fill);
          timers.push(id);
        }
      }
      requestAnimationFrame(fill);
    }, fillStart);

    // Tip + settle: once full, BeakerBot tips to "spill" the excess rainbow
    // down to his natural liquid line (NORMAL), as the wordmark comes in. The
    // whole bot rotates around its base (20,31); a few droplets fall from the
    // lip. NORMAL (water-group translate) puts the surface at the mark's y19.
    const NORMAL = 16;
    T(() => {
      const botEl = container.querySelector<SVGGElement>("#splash-bot");
      const spillEl = container.querySelector<SVGGElement>("#splash-spill");
      const tipStart = performance.now();
      const tipDur = 560;
      const MAX_ANGLE = 13;
      function tip(now: number) {
        const k = Math.min(1, (now - tipStart) / tipDur);
        // Rotate out to MAX_ANGLE by k=0.3, then ease back to level by k=1.
        const angle =
          k < 0.3 ? (k / 0.3) * MAX_ANGLE : MAX_ANGLE * (1 - (k - 0.3) / 0.7);
        botEl?.setAttribute("transform", `rotate(${angle.toFixed(2)}, 20, 31)`);
        // Water settles 0 -> NORMAL (eased) once the tip begins.
        const wk = Math.max(0, Math.min(1, (k - 0.15) / 0.6));
        level(NORMAL * (1 - Math.pow(1 - wk, 2)));
        // Droplets fall from the lip and fade while the bot is tipped.
        if (spillEl) {
          spillEl.setAttribute(
            "transform",
            `translate(${(2 + k * 3).toFixed(2)}, ${(k * 16).toFixed(2)})`,
          );
          spillEl.style.opacity = String(
            k < 0.12 ? k / 0.12 : k > 0.75 ? Math.max(0, (1 - k) / 0.25) : 1,
          );
        }
        if (k < 1) {
          const id = requestAnimationFrame(tip);
          timers.push(id);
        } else {
          botEl?.setAttribute("transform", "rotate(0, 20, 31)");
          level(NORMAL);
          if (spillEl) spillEl.style.opacity = "0";
        }
      }
      requestAnimationFrame(tip);
    }, fillStart + fillDur);

    // Exit. The splash renders ON TOP of the real workbench, so the exit clears
    // its own stage to transparent and lets the rainbow flood recede to reveal
    // the live app underneath (not the BeakerBot again).
    const exitAt = 3100;
    const centerEl = container.querySelector<HTMLElement>("#splash-center");
    const dotsEl = container.querySelector<HTMLElement>("#splash-dots");
    const skipEl = container.querySelector<HTMLElement>("#splash-skip");
    const greetEl = container.querySelector<HTMLElement>("#splash-greet");

    // 1. Hide the counter and raise the rainbow flood to cover the whole stage.
    T(() => {
      pctEl.style.opacity = "0";
      floodEl.style.transition = "height 950ms cubic-bezier(.72,0,.2,1)";
      floodEl.style.height = "135%";
    }, exitAt);

    // 2. Once the flood has covered everything, dissolve the splash's own stage
    //    (its background, the BeakerBot column, the dot grid, the Skip control)
    //    so only the rainbow remains over the live workbench.
    const coveredAt = exitAt + 900;
    T(() => {
      container.style.transition = "background 350ms ease";
      container.style.background = "transparent";
      [centerEl, dotsEl, skipEl, greetEl].forEach((el) => {
        if (!el) return;
        el.style.transition = "opacity 250ms ease";
        el.style.opacity = "0";
      });
    }, coveredAt);

    // 3. Recede the flood to reveal the workbench underneath.
    T(() => {
      floodEl.style.transition = "opacity 500ms ease";
      floodEl.style.opacity = "0";
    }, coveredAt + 200);

    // 4. Unmount the splash overlay once the flood has fully faded.
    T(() => {
      finish();
    }, coveredAt + 200 + 500);

    return () => {
      clearAll();
    };
  }, [finish]);

  // Whether to render in reduced-motion static mode. We detect via CSS so the
  // server render is consistent with the client (the effect handles the timer).
  // The container is always rendered; the animation classes handle the skip.

  return (
    <>
      {/* Keyframes injected as a style tag so they live with the component and
          do not need a global CSS import. Mirrors the mockup <style> block. */}
      <style>{`
        /* BeakerBot outline draw-on */
        .splash-draw {
          stroke-dasharray: 120;
          stroke-dashoffset: 120;
          animation: splashDraw 0.8s cubic-bezier(.65,0,.2,1) forwards;
        }
        @keyframes splashDraw { to { stroke-dashoffset: 0; } }

        /* Face wakes */
        .splash-face {
          opacity: 0;
          animation: splashFaceOn 0.45s cubic-bezier(.2,.8,.2,1) forwards;
          animation-delay: 1.55s;
        }
        @keyframes splashFaceOn {
          from { opacity: 0; transform: translateY(1px) scale(.85); }
          to   { opacity: 1; transform: none; }
        }

        /* Eye blink */
        .splash-eye {
          transform-box: fill-box;
          transform-origin: center;
          animation: splashBlink 4.2s 2.4s infinite;
        }
        @keyframes splashBlink {
          0%, 92%, 100% { transform: scaleY(1); }
          96%            { transform: scaleY(.1); }
        }

        /* Wordmark rise */
        .splash-wm {
          opacity: 0;
          transform: translateY(16px);
          animation: splashRise 0.7s cubic-bezier(.16,.84,.24,1) forwards;
          /* Comes in as BeakerBot tips and settles (fill ends ~1.85s). */
          animation-delay: 2s;
        }
        .splash-tag {
          opacity: 0;
          animation: splashRise 0.7s ease forwards;
          animation-delay: 2.25s;
        }
        /* Upper-left welcome-back greeting, rises in early. */
        .splash-greet {
          opacity: 0;
          transform: translateY(8px);
          animation: splashRise 0.7s cubic-bezier(.16,.84,.24,1) forwards;
          animation-delay: 0.5s;
        }
        @keyframes splashRise {
          to { opacity: 1; transform: none; }
        }

        /* Reduced-motion overrides */
        @media (prefers-reduced-motion: reduce) {
          .splash-draw, .splash-face, .splash-wm, .splash-tag, .splash-greet {
            animation: none !important;
            opacity: 1 !important;
            stroke-dashoffset: 0 !important;
            transform: none !important;
          }
        }
      `}</style>

      {/* ---- Stage: branded light canvas with dot-grid ---- */}
      <div
        ref={containerRef}
        className="fixed inset-0 grid place-items-center overflow-hidden"
        style={{
          zIndex: 9999,
          background:
            "radial-gradient(120% 110% at 50% 38%, #ffffff 0%, #E6F4FE 46%, #d4ecfb 100%)",
        }}
      >
        {/* Dot-grid overlay */}
        <div
          id="splash-dots"
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.5,
            backgroundImage:
              "radial-gradient(rgba(26,160,230,.14) 1.1px, transparent 1.1px)",
            backgroundSize: "30px 30px",
          }}
        />

        {/* Skip affordance (also fires on Escape). Quiet, corner-placed. */}
        <button
          id="splash-skip"
          type="button"
          onClick={finish}
          className="absolute top-5 right-6 text-sm font-medium text-[#6b7280] hover:text-[#1283c9] transition-colors"
          style={{ zIndex: 10001 }}
        >
          Skip
        </button>

        {/* Personalized greeting, big in the upper-left (balances the percentage
            counter in the lower-right). Only when a name is known. */}
        {greetName && (
          <div
            id="splash-greet"
            className="splash-greet absolute"
            style={{ left: "6vmin", top: "5vmin", zIndex: 3, textAlign: "left" }}
          >
            <div
              style={{
                fontSize: "min(2.4vmin, 18px)",
                color: MUTED,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              Welcome back,
            </div>
            <div
              style={{
                fontSize: "min(6.5vmin, 54px)",
                color: INK,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1.05,
                marginTop: "0.3vmin",
              }}
            >
              {greetName}
            </div>
          </div>
        )}

        {/* Center column: bot + wordmark + tagline */}
        <div
          id="splash-center"
          className="relative flex flex-col items-center"
          style={{ zIndex: 2 }}
        >
          {/* BeakerBot SVG -- inline required for stroke-dasharray draw-on */}
          <svg
            viewBox="6 1 28 34"
            xmlns="http://www.w3.org/2000/svg"
            style={{
              width: "min(32vmin, 290px)",
              height: "auto",
              overflow: "visible",
              filter: "drop-shadow(0 10px 24px rgba(26,160,230,.22))",
            }}
          >
            <defs>
              <linearGradient id="splashLiq" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFD2B0" />
                <stop offset="25%" stopColor="#FFF1A8" />
                <stop offset="50%" stopColor="#B7EBB1" />
                <stop offset="75%" stopColor="#A6D2F4" />
                <stop offset="100%" stopColor="#D6B5F0" />
              </linearGradient>
              <clipPath id="splashInside">
                <path d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z" />
              </clipPath>
            </defs>

            {/* All bot geometry in one group so the tip-and-settle can rotate
                body + liquid + clip + face together around the base (20,31). */}
            <g id="splash-bot" transform="rotate(0, 20, 31)">
            {/* White beaker body so it reads on the light canvas */}
            <path
              d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
              fill="#fff"
            />

            {/* Rising rainbow liquid clipped to the beaker interior */}
            <g clipPath="url(#splashInside)">
              <g id="splash-water" transform="translate(0,22)">
                <path
                  id="splash-w1"
                  d="M-12,3 Q -7,0.6 -2,3 T 8,3 T 18,3 T 28,3 T 38,3 T 48,3 L48,34 L-12,34 Z"
                  fill="url(#splashLiq)"
                />
                <path
                  id="splash-w2"
                  d="M-12,3 Q -7,5 -2,3 T 8,3 T 18,3 T 28,3 T 38,3 T 48,3 L48,34 L-12,34 Z"
                  fill="url(#splashLiq)"
                  opacity="0.55"
                />
                <path
                  id="splash-w3"
                  d="M-12,2.6 Q -7,4.4 -2,2.6 T 8,2.6 T 18,2.6 T 28,2.6 T 38,2.6 T 48,2.6 L48,34 L-12,34 Z"
                  fill="url(#splashLiq)"
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
              <path
                className="splash-draw"
                d="M22 8 C 22 6, 24 4, 26 6"
              />
              <path
                className="splash-draw"
                style={{ animationDelay: "0.1s" }}
                d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12"
              />
              <path
                className="splash-draw"
                style={{ animationDelay: "0.24s" }}
                d="M11 12 L29 12"
              />
            </g>

            {/* Face wakes after outline completes */}
            <g className="splash-face">
              <circle
                className="splash-eye"
                cx="17"
                cy="18"
                r="1.25"
                fill={SKY}
                stroke="none"
              />
              <circle
                className="splash-eye"
                cx="23"
                cy="18"
                r="1.25"
                fill={SKY}
                stroke="none"
              />
              <path
                d="M18 22 Q 20 24, 22 22"
                stroke={SKY}
                strokeWidth="1.2"
                fill="none"
                strokeLinecap="round"
              />
            </g>
            </g>
            {/* Spill droplets: fall from the lip during the tip (outside the
                bot group so they fall straight, not with the rotation). */}
            <g id="splash-spill" opacity="0">
              <circle cx="26.5" cy="12.5" r="0.7" fill="url(#splashLiq)" />
              <circle cx="28" cy="12" r="0.5" fill="url(#splashLiq)" />
              <circle cx="27.2" cy="13" r="0.45" fill="url(#splashLiq)" />
            </g>
          </svg>

          {/* Wordmark */}
          <div
            className="splash-wm"
            style={{
              marginTop: "4.5vmin",
              fontSize: "min(7vmin, 54px)",
              fontWeight: 800,
              letterSpacing: "-0.022em",
              color: INK,
            }}
          >
            Research
            <span
              style={{
                background:
                  "linear-gradient(95deg,#FFD2B0,#FFF1A8,#B7EBB1,#A6D2F4,#D6B5F0)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              OS
            </span>
          </div>

          {/* Tagline */}
          <div
            className="splash-tag"
            style={{
              marginTop: "1.4vmin",
              color: MUTED,
              fontSize: "min(2.3vmin, 16px)",
            }}
          >
            Your lab, your data, your machine.
          </div>
        </div>

        {/* Percentage counter -- bottom-right, matches mockup .pct */}
        <div
          id="splash-pct"
          className="fixed"
          style={{
            right: "5vmin",
            bottom: "4.2vmin",
            color: SKY,
            fontSize: "min(8.5vmin, 86px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            zIndex: 2,
            fontVariantNumeric: "tabular-nums",
            opacity: 0.9,
            transition: "opacity 0.35s",
            display: "flex",
            alignItems: "flex-end",
            gap: "0.15em",
          }}
        >
          0
          <span
            className="splash-pct-unit"
            style={{
              fontSize: "0.45em",
              fontWeight: 700,
              color: MUTED,
              marginBottom: "0.25em",
            }}
          >
            %
          </span>
        </div>

        {/* Exit rainbow flood (rises from the bottom, then fades) */}
        <div
          id="splash-flood"
          className="fixed"
          style={{
            left: 0,
            bottom: 0,
            width: "100%",
            height: 0,
            zIndex: 5,
            background:
              "linear-gradient(180deg,#FFD2B0,#FFF1A8,#B7EBB1,#A6D2F4,#D6B5F0)",
            pointerEvents: "none",
          }}
        >
          {/* Wavy crest on top of the flood */}
          <svg
            viewBox="0 0 120 12"
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              top: "calc(-4.2vmin)",
              left: 0,
              width: "100%",
              height: "4.4vmin",
            }}
          >
            <path
              d="M0,12 V6 Q15,0 30,6 T60,6 T90,6 T120,6 V12 Z"
              fill="#FFD2B0"
            />
          </svg>
        </div>

        {/* Reveal layer -- fades in behind the flood to show the next screen */}
        <div
          id="splash-reveal"
          className="fixed inset-0"
          style={{
            zIndex: 1,
            opacity: 0,
            background:
              "radial-gradient(120% 110% at 50% 38%, #fff 0%, #E6F4FE 60%, #d4ecfb 100%)",
          }}
        />
      </div>
    </>
  );
}

export default Splash;
