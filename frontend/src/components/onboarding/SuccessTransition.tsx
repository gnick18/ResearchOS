// Celebratory hand-off transition shown immediately before landing on Workbench.
//
// Spec: the "success" beat in docs/mockups/account-setup-revamp.html plus the
// Phase C section in docs/proposals/ACCOUNT_SETUP_REVAMP.md.
//
// Sequence (normal motion):
//   0 ms  -- checkmark circle pops in (scale .2 -> 1.1 -> 1)
//   300 ms -- confetti bursts from behind the checkmark
//   700 ms -- BeakerBot sways in with a gentle bounce
//   900 ms -- "You're in." text rises
//  1100 ms -- tagline fades
//  1800 ms -- whole panel fades out
//  2100 ms -- onComplete fires (caller advances to Workbench)
//
// Reduced-motion: static layout, onComplete after 800 ms.
//
// No new dependencies -- pure CSS keyframes + inline SVG.
// House style: no em-dashes, no emojis, no mid-sentence colons.

"use client";

import { useEffect, useRef } from "react";

export interface SuccessTransitionProps {
  /** Called when the celebration finishes and the caller should navigate to
   * Workbench (or the next screen). */
  onComplete: () => void;
}

// ---- brand palette --------------------------------------------------------
const SKY = "#1AA0E6";
const INK = "#111827";
const MUTED = "#6b7280";
const OK_GREEN = "#16a34a";

// Confetti colours matching the mockup's fireConfetti() palette.
const CONFETTI_COLORS = [
  "#f97316",
  "#16a34a",
  "#0284c7",
  "#9333ea",
  "#e8920b",
];

// Generate confetti positions once (deterministic so no hydration mismatch).
const CONFETTI_PIECES = Array.from({ length: 40 }, (_, i) => ({
  left: 20 + ((i * 31) % 60), // pseudo-random spread, 20%..80%
  delay: (i * 17) % 400, // stagger up to 400 ms
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  size: 6 + (i % 3) * 2, // 6-10 px
  rotate: (i * 47) % 360,
}));

export function SuccessTransition({ onComplete }: SuccessTransitionProps) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion) {
      const t = window.setTimeout(() => onCompleteRef.current(), 800);
      return () => clearTimeout(t);
    }

    // Fire onComplete after the panel fades out.
    const t = window.setTimeout(() => onCompleteRef.current(), 2100);

    // Trigger the fade-out on the panel.
    const fadeTimer = window.setTimeout(() => {
      const p = panelRef.current;
      if (p) {
        p.style.transition = "opacity 350ms ease";
        p.style.opacity = "0";
      }
    }, 1750);

    return () => {
      clearTimeout(t);
      clearTimeout(fadeTimer);
    };
  }, []);

  return (
    <>
      <style>{`
        /* Checkmark circle pop */
        .sxt-check {
          animation: sxtPop 0.5s ease forwards;
        }
        @keyframes sxtPop {
          0%   { transform: scale(.2); opacity: 0; }
          60%  { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }

        /* Confetti fall */
        .sxt-confetti-piece {
          position: absolute;
          border-radius: 2px;
          animation: sxtFall 1.4s ease-out forwards;
        }
        @keyframes sxtFall {
          0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(220px) rotate(360deg); opacity: 0; }
        }

        /* BeakerBot bounce-in */
        .sxt-bot {
          opacity: 0;
          transform: translateY(20px) scale(.85);
          animation: sxtBotIn 0.6s cubic-bezier(.2,.8,.2,1) forwards;
          animation-delay: 0.7s;
        }
        @keyframes sxtBotIn {
          to { opacity: 1; transform: none; }
        }

        /* BeakerBot idle sway */
        .sxt-bot-sway {
          animation: sxtBotIn 0.6s cubic-bezier(.2,.8,.2,1) forwards,
                     sxtSway  5s ease-in-out 1.3s infinite;
        }
        @keyframes sxtSway {
          0%, 100% { transform: rotate(-2deg); }
          50%       { transform: rotate(2deg); }
        }

        /* Eye blink */
        .sxt-eye {
          transform-box: fill-box;
          transform-origin: center;
          animation: sxtBlink 5.5s 1.5s infinite;
        }
        @keyframes sxtBlink {
          0%, 93%, 100% { opacity: 1; }
          96%            { opacity: .1; }
        }

        /* Headline rise */
        .sxt-headline {
          opacity: 0;
          transform: translateY(12px);
          animation: sxtRise 0.5s cubic-bezier(.16,.84,.24,1) forwards;
          animation-delay: 0.9s;
        }
        @keyframes sxtRise {
          to { opacity: 1; transform: none; }
        }

        /* Tagline fade-in */
        .sxt-tagline {
          opacity: 0;
          animation: sxtFadeIn 0.5s ease forwards;
          animation-delay: 1.1s;
        }
        @keyframes sxtFadeIn {
          to { opacity: 1; }
        }

        /* Reduced-motion: disable all */
        @media (prefers-reduced-motion: reduce) {
          .sxt-check, .sxt-confetti-piece, .sxt-bot, .sxt-bot-sway,
          .sxt-headline, .sxt-tagline {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>

      {/* Full-screen overlay, sits above everything during the transition */}
      <div
        ref={panelRef}
        className="fixed inset-0 flex flex-col items-center justify-center"
        style={{
          zIndex: 9999,
          background:
            "radial-gradient(120% 110% at 50% 38%, #ffffff 0%, #E6F4FE 60%, #d4ecfb 100%)",
          overflow: "hidden",
        }}
      >
        {/* Dot-grid background (same pattern as the splash canvas) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.4,
            backgroundImage:
              "radial-gradient(rgba(26,160,230,.14) 1.1px, transparent 1.1px)",
            backgroundSize: "30px 30px",
          }}
        />

        {/* Confetti layer -- behind the checkmark (z-index 1) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ zIndex: 1 }}
        >
          {CONFETTI_PIECES.map((p, i) => (
            <span
              key={i}
              className="sxt-confetti-piece"
              style={{
                left: `${p.left}%`,
                top: "35%",
                width: p.size,
                height: p.size,
                background: p.color,
                animationDelay: `${p.delay}ms`,
                transform: `rotate(${p.rotate}deg)`,
              }}
            />
          ))}
        </div>

        {/* Content column */}
        <div
          className="relative flex flex-col items-center"
          style={{ zIndex: 2, gap: "0" }}
        >
          {/* Animated green checkmark circle */}
          <div
            className="sxt-check"
            style={{
              width: 84,
              height: 84,
              borderRadius: "50%",
              background: OK_GREEN,
              display: "grid",
              placeItems: "center",
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12l5 5L20 6" />
            </svg>
          </div>

          {/* Headline */}
          <div
            className="sxt-headline"
            style={{
              marginTop: 18,
              fontSize: "min(6.5vmin, 48px)",
              fontWeight: 800,
              letterSpacing: "-0.022em",
              color: INK,
            }}
          >
            You&rsquo;re in.
          </div>

          {/* Tagline */}
          <div
            className="sxt-tagline"
            style={{
              marginTop: 8,
              fontSize: "min(2.4vmin, 17px)",
              color: MUTED,
            }}
          >
            Taking you to your Workbench...
          </div>

          {/* BeakerBot with idle sway, appears after text */}
          <div style={{ marginTop: 28 }}>
            <svg
              className="sxt-bot sxt-bot-sway"
              viewBox="8 3 24 31"
              fill="none"
              stroke={SKY}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              xmlns="http://www.w3.org/2000/svg"
              style={{ width: 60, height: 78 }}
            >
              <defs>
                <linearGradient id="sxtLiq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FFD2B0" />
                  <stop offset="25%" stopColor="#FFF1A8" />
                  <stop offset="50%" stopColor="#B7EBB1" />
                  <stop offset="75%" stopColor="#A6D2F4" />
                  <stop offset="100%" stopColor="#D6B5F0" />
                </linearGradient>
              </defs>

              {/* Beaker body fill */}
              <path
                d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
                fill="white"
                stroke="none"
              />
              {/* Rainbow liquid fill at mid level */}
              <path
                d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"
                fill="url(#sxtLiq)"
                stroke="none"
              />
              {/* Neck spout */}
              <path d="M22 8 C 22 6, 24 4, 26 6" />
              {/* Body outline */}
              <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
              {/* Lip */}
              <path d="M11 12 L29 12" />
              {/* Eyes */}
              <circle className="sxt-eye" cx="17" cy="18" r="1.2" fill={SKY} stroke="none" />
              <circle className="sxt-eye" cx="23" cy="18" r="1.2" fill={SKY} stroke="none" />
              {/* Smile */}
              <path d="M18 22 Q 20 24, 22 22" />
              {/* Lab coat cuffs / details from the mockup SVG_BOT */}
              <path d="M14 26 L15.5 26" />
              <path d="M24.5 26 L26 26" />
            </svg>
          </div>
        </div>
      </div>
    </>
  );
}

export default SuccessTransition;
