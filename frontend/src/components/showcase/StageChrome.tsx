"use client";

// frontend/src/components/showcase/StageChrome.tsx
//
// The persistent Drag Main Stage set pieces (R3.2 through R3.7), built
// as the components R3.11 specs. Rendered ONCE behind the scroll column
// via <StageBackdrop> (position: fixed) so the marquee stays continuous
// and only the spotlight + bot + placard change per look.
//
// All visuals are pinned from the proposal R3: bulb-light BEAKERBOT
// marquee over a darkened five-stop rainbow wash, plum side curtains +
// gold valance, the light-up catwalk trapezoid, the tracking spotlight,
// and the photographers' pit with abstract camera silhouettes +
// flashbulb bursts. No emojis (custom inline SVG only).

import { useId } from "react";
import styles from "./showcase.module.css";

/* ── Marquee (R3.3) ────────────────────────────────────────────────── */

/** Generate bulb coordinates tracing the strokes of each letter of a
 *  word, laid out left to right. Kept as a simple block-letter bulb
 *  grid (a build can swap in font-path coords later); the global
 *  left-to-right index drives the chase delay. */
function buildMarqueeBulbs(word: string): { cx: number; cy: number; i: number }[] {
  // Each letter occupies a 5-row x 3-col bulb cell. We trace a chunky
  // block-letter shape per glyph with on/off cells, then emit a bulb at
  // each "on" cell. Coordinates are in a 0..(word.length*80) viewBox.
  const GLYPHS: Record<string, number[][]> = {
    // rows top->bottom, cols left->right; 1 = bulb
    B: [
      [1, 1, 0],
      [1, 0, 1],
      [1, 1, 0],
      [1, 0, 1],
      [1, 1, 0],
    ],
    E: [
      [1, 1, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 0, 0],
      [1, 1, 1],
    ],
    A: [
      [0, 1, 0],
      [1, 0, 1],
      [1, 1, 1],
      [1, 0, 1],
      [1, 0, 1],
    ],
    K: [
      [1, 0, 1],
      [1, 1, 0],
      [1, 0, 0],
      [1, 1, 0],
      [1, 0, 1],
    ],
    R: [
      [1, 1, 0],
      [1, 0, 1],
      [1, 1, 0],
      [1, 0, 1],
      [1, 0, 1],
    ],
    O: [
      [0, 1, 0],
      [1, 0, 1],
      [1, 0, 1],
      [1, 0, 1],
      [0, 1, 0],
    ],
    T: [
      [1, 1, 1],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ],
  };
  const bulbs: { cx: number; cy: number; i: number }[] = [];
  let globalIndex = 0;
  const COL_STEP = 22;
  const ROW_STEP = 22;
  const LETTER_W = 80;
  word.split("").forEach((ch, letterIdx) => {
    const glyph = GLYPHS[ch.toUpperCase()];
    if (!glyph) return;
    const xBase = letterIdx * LETTER_W + 10;
    glyph.forEach((row, r) => {
      row.forEach((on, c) => {
        if (on) {
          bulbs.push({
            cx: xBase + c * COL_STEP,
            cy: 8 + r * ROW_STEP,
            i: globalIndex++,
          });
        }
      });
    });
  });
  return bulbs;
}

export function Marquee({ word = "BEAKERBOT" }: { word?: string }) {
  const rawId = useId();
  const glowId = `bbGlow-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const bulbs = buildMarqueeBulbs(word);
  const viewW = word.length * 80;
  return (
    <div className={styles.marquee} aria-label={word}>
      <svg
        className={styles.marqueeBulbs}
        viewBox={`0 0 ${viewW} 120`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter={`url(#${glowId})`}>
          {bulbs.map((b) => (
            <circle
              key={b.i}
              className={styles.mbulb}
              cx={b.cx}
              cy={b.cy}
              r={5}
              style={{ ["--i" as string]: b.i }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

/* ── Rainbow wash (R3.3) ───────────────────────────────────────────── */

export function RainbowWash() {
  return <div className={styles.rainbowWash} aria-hidden="true" />;
}

/* ── Valance + side curtains (R3.4) ────────────────────────────────── */

export function Valance() {
  return <div className={styles.valance} aria-hidden="true" />;
}

export function SideCurtain({ side }: { side: "left" | "right" }) {
  return (
    <div
      className={`${styles.sideCurtain} ${
        side === "left" ? styles.sideCurtainLeft : styles.sideCurtainRight
      }`}
      aria-hidden="true"
    />
  );
}

/* ── Catwalk (R3.2 + R3.5) ─────────────────────────────────────────── */

export function Catwalk() {
  // 9 rows x 5 columns. --panel-index = row index (0 head, 8 foot) so
  // the highlight sweeps head-to-foot as a horizontal light bar (R3.5).
  const ROWS = 9;
  const COLS = 5;
  const cells: { key: string; rowIndex: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cells.push({ key: `${r}-${c}`, rowIndex: r });
    }
  }
  return (
    <div className={styles.catwalk} aria-hidden="true">
      {cells.map((cell) => (
        <div
          key={cell.key}
          className={styles.catwalkPanel}
          style={{ ["--panel-index" as string]: cell.rowIndex }}
        />
      ))}
    </div>
  );
}

/* ── Spotlight (R3.6) ──────────────────────────────────────────────── */

export function Spotlight({ active }: { active: boolean }) {
  return (
    <div
      className={`${styles.spotlight} ${active ? styles.spotlightActive : ""}`}
      aria-hidden="true"
    />
  );
}

/* ── Flashbulbs (R3.7) ─────────────────────────────────────────────── */

export function FlashBurst({ delayMs = 0 }: { delayMs?: number }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={styles.flashBurst}
      style={{ animationDelay: `${delayMs}ms` }}
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="4" fill="#ffffff" />
      <g stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round">
        <line x1="20" y1="20" x2="20" y2="4" />
        <line x1="20" y1="20" x2="20" y2="36" />
        <line x1="20" y1="20" x2="4" y2="20" />
        <line x1="20" y1="20" x2="36" y2="20" />
        <line x1="20" y1="20" x2="9" y2="9" />
        <line x1="20" y1="20" x2="31" y2="9" />
        <line x1="20" y1="20" x2="9" y2="31" />
        <line x1="20" y1="20" x2="31" y2="31" />
      </g>
    </svg>
  );
}

/** Abstract camera silhouette (R3.7): body + lens, no faces. */
export function PitCamera() {
  return (
    <svg viewBox="0 0 48 32" className={styles.pitCamera} aria-hidden="true">
      <rect x="6" y="10" width="36" height="18" rx="3" fill="#0e0e16" stroke="#23202e" />
      <rect x="16" y="6" width="12" height="6" rx="2" fill="#0e0e16" stroke="#23202e" />
      <circle cx="24" cy="19" r="7" fill="#15131f" stroke="#2c2838" />
      <circle cx="24" cy="19" r="3" fill="#23202e" />
    </svg>
  );
}

/** Fixed per-camera position + flicker tuning (R3.7): 6 cameras evenly
 *  spaced across the pit band with +/- 2vw fixed jitter; flicker
 *  duration 2.6-3.8s and delay 0-2s, assigned once (stable, not
 *  re-randomized per frame). */
export interface PitPosition {
  /** Horizontal center as a % of the viewport width. */
  leftPct: number;
  flickDurMs: number;
  flickDelayMs: number;
}

export const PIT_CAMERA_POSITIONS: readonly PitPosition[] = [
  { leftPct: 10, flickDurMs: 3200, flickDelayMs: 0 },
  { leftPct: 26, flickDurMs: 2800, flickDelayMs: 600 },
  { leftPct: 40, flickDurMs: 3600, flickDelayMs: 1400 },
  { leftPct: 58, flickDurMs: 2600, flickDelayMs: 300 },
  { leftPct: 74, flickDurMs: 3800, flickDelayMs: 1900 },
  { leftPct: 90, flickDurMs: 3000, flickDelayMs: 1000 },
];

export function PhotographersPit({ cameraCount = 6 }: { cameraCount?: number }) {
  const positions = PIT_CAMERA_POSITIONS.slice(0, cameraCount);
  return (
    <div className={styles.pit} aria-hidden="true">
      {positions.map((p, i) => (
        <div
          key={i}
          className={styles.pitCameraWrap}
          style={{ left: `${p.leftPct}vw` }}
        >
          <span
            className={styles.pitCameraBloom}
            style={{
              ["--flick-dur" as string]: `${p.flickDurMs}ms`,
              ["--flick-delay" as string]: `${p.flickDelayMs}ms`,
            }}
          />
          <PitCamera />
        </div>
      ))}
    </div>
  );
}

/** The per-look flash flurry: 3 staggered bursts (0 / 40 / 80ms, the
 *  VOLCANO_PARTICLES stagger) from 3 pit camera positions, fired on look
 *  entry / click. Keyed by `fireKey` so a new value re-mounts the bursts
 *  and replays the pop. */
export function Flashbulbs({
  fireKey,
  cameraPositions = PIT_CAMERA_POSITIONS,
}: {
  fireKey: number;
  cameraPositions?: readonly PitPosition[];
}) {
  if (fireKey <= 0) return null;
  // Pick 3 pseudo-random camera positions per fire (stable for a given
  // fireKey so it does not jitter mid-pop).
  const count = Math.min(3, cameraPositions.length);
  const start = (fireKey * 2) % cameraPositions.length;
  const chosen: PitPosition[] = [];
  for (let k = 0; k < count; k++) {
    chosen.push(cameraPositions[(start + k * 2) % cameraPositions.length]!);
  }
  const stagger = [0, 40, 80];
  return (
    <div className={styles.pit} aria-hidden="true" key={fireKey}>
      {chosen.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${p.leftPct}vw`,
            bottom: "8svh",
          }}
        >
          <FlashBurst delayMs={stagger[i] ?? 0} />
        </div>
      ))}
    </div>
  );
}

/* ── StageBackdrop: the whole persistent set, rendered once ────────── */

export function StageBackdrop({
  spotlightActive = true,
}: {
  spotlightActive?: boolean;
}) {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      <RainbowWash />
      <Catwalk />
      <SideCurtain side="left" />
      <SideCurtain side="right" />
      <Spotlight active={spotlightActive} />
      <PhotographersPit />
      <Valance />
      <Marquee />
    </div>
  );
}
