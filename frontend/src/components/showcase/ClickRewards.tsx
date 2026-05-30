"use client";

// frontend/src/components/showcase/ClickRewards.tsx
//
// The render layer for the /showcase click rewards (click-rewards sub-bot,
// orchestrator manager). Driven entirely by useClickStreak; owns no click
// logic of its own. Two tiers:
//
//   TIER 1 (<CursorBursts>): for each live burst, a camera-flash pop + a
//     small radiating spray of sparkles / stars + an expanding ring AT the
//     click point. Snappy (~600ms), fades out, capped by the hook.
//   TIER 2 (<CrowdWild>): while `wild` is true, the crowd goes wild: roses
//     (and a cheeky bra or two) fly IN from the side + bottom edges, arc
//     across the stage, bounce near center, then settle/fade; confetti rains
//     from the top; an intense camera-flash flurry fires; clapping hands +
//     sparkles flank the edges; a single gold "BRAVO" reads in the marquee
//     style. Sustained clicking escalates (wildEscalateKey stages extra
//     tributes); it all clears a beat after clicking stops (the hook flips
//     `wild` back off and this unmounts).
//
// Reduced motion: the thrown-tribute + confetti motion is suppressed (the
// CSS @media block parks transforms); Tier 1 shows a static, non-strobing
// pop. Both tiers stay capped for performance; React unmount + the hook's
// timer drain handle cleanup.
//
// This overlay is absolutely positioned to fill its positioned parent (the
// stage section), pointer-events: none so it never eats clicks. No emojis,
// no em-dashes.

import { useMemo } from "react";
import { FlashBurst } from "./StageChrome";
import {
  SparkleSvg,
  StarSvg,
  RoseSvg,
  BraSvg,
  ConfettiSvg,
  ClapHandSvg,
} from "./clickRewardAssets";
import type { ClickBurst } from "./useClickStreak";
import styles from "./showcase.module.css";

/* ── Tier 1: per-click cursor burst ────────────────────────────────────── */

// The radiating spray: fixed unit directions (in deg) so each burst fans out
// evenly; the CSS keyframe pushes each piece outward along its --angle.
const SPRAY_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function CursorBurst({ burst }: { burst: ClickBurst }) {
  // Per-burst distance + size jitter (deterministic from id, so it does not
  // change between renders of the same burst).
  const reach = 30 + (burst.id % 3) * 8;
  return (
    <div
      className={styles.clickBurst}
      style={{ left: `${burst.x}px`, top: `${burst.y}px` }}
    >
      {/* expanding ring */}
      <span className={styles.clickBurstRing} aria-hidden="true" />
      {/* camera-flash pop at the cursor (reuse the stage's burst glyph) */}
      <span className={styles.clickBurstFlash} aria-hidden="true">
        <FlashBurst />
      </span>
      {/* radiating sparkle / star spray */}
      {SPRAY_ANGLES.map((angle, i) => {
        const isStar = (i + burst.variant) % 3 === 0;
        return (
          <span
            key={angle}
            className={styles.clickBurstSpray}
            style={{
              ["--angle" as string]: `${angle}deg`,
              ["--reach" as string]: `${reach}px`,
              ["--spray-delay" as string]: `${(i % 4) * 14}ms`,
            }}
            aria-hidden="true"
          >
            {isStar ? (
              <StarSvg size={13} />
            ) : (
              <SparkleSvg size={15} color={i % 2 === 0 ? "#FFF1A8" : "#FFFFFF"} />
            )}
          </span>
        );
      })}
    </div>
  );
}

export function CursorBursts({ bursts }: { bursts: ClickBurst[] }) {
  if (bursts.length === 0) return null;
  return (
    <div className={styles.clickBurstLayer} aria-hidden="true">
      {bursts.map((b) => (
        <CursorBurst key={b.id} burst={b} />
      ))}
    </div>
  );
}

/* ── Tier 2: crowd-goes-wild celebration ───────────────────────────────── */

interface Tribute {
  id: string;
  kind: "rose" | "bra";
  /** Entry edge as a viewport-relative start, in %. */
  fromX: number;
  fromY: number;
  /** Landing point near center stage, in %. */
  toX: number;
  toY: number;
  /** Spin + timing jitter. */
  rotate: number;
  delayMs: number;
  durationMs: number;
}

interface ConfettiPiece {
  id: string;
  leftPct: number;
  colorIndex: number;
  delayMs: number;
  durationMs: number;
  drift: number;
  spin: number;
}

// Caps so a long sustained clap does not pile up unbounded DOM (the hook
// re-keys waves; each wave renders at most these many).
const TRIBUTES_PER_WAVE = 9;
const CONFETTI_PER_WAVE = 22;

/** Deterministic pseudo-random from an integer seed (so a given wave/escalate
 *  key always lays out the same, avoiding hydration/re-render churn). */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function buildTributes(seed: number, count: number): Tribute[] {
  const out: Tribute[] = [];
  for (let i = 0; i < count; i++) {
    const r = (n: number) => rand(seed * 100 + i * 7 + n);
    // Alternate entry edges: left, right, bottom. A couple are bras.
    const edge = i % 3; // 0 left, 1 right, 2 bottom
    const fromX = edge === 0 ? -12 : edge === 1 ? 112 : 20 + r(1) * 60;
    const fromY = edge === 2 ? 116 : 40 + r(2) * 45;
    // Land in a loose cluster around center-low (near BeakerBot's feet).
    const toX = 32 + r(3) * 36;
    const toY = 52 + r(4) * 26;
    // Make 2 of the items a bra (positions 2 and 6 if present), rest roses.
    const kind: Tribute["kind"] = i === 2 || i === 6 ? "bra" : "rose";
    out.push({
      id: `${seed}-${i}`,
      kind,
      fromX,
      fromY,
      toX,
      toY,
      rotate: -200 + r(5) * 400,
      delayMs: Math.round(r(6) * 360),
      durationMs: 900 + Math.round(r(7) * 500),
    });
  }
  return out;
}

function buildConfetti(seed: number, count: number): ConfettiPiece[] {
  const out: ConfettiPiece[] = [];
  for (let i = 0; i < count; i++) {
    const r = (n: number) => rand(seed * 200 + i * 11 + n);
    out.push({
      id: `c-${seed}-${i}`,
      leftPct: r(1) * 100,
      colorIndex: i,
      delayMs: Math.round(r(2) * 500),
      durationMs: 1400 + Math.round(r(3) * 800),
      drift: -40 + r(4) * 80,
      spin: 180 + Math.round(r(5) * 540),
    });
  }
  return out;
}

export function CrowdWild({
  wild,
  wildWaveKey,
  wildEscalateKey,
}: {
  wild: boolean;
  wildWaveKey: number;
  wildEscalateKey: number;
}) {
  // Tributes + confetti are seeded off the wave key (a fresh wave) AND the
  // escalate key (sustained clapping throws more), but capped per render. We
  // stage TWO seeded batches: the base wave + an escalation batch keyed to the
  // latest escalate tick, so sustained clicking visibly adds to the pile
  // without re-laying-out the whole thing every click.
  const tributes = useMemo(
    () => buildTributes(wildWaveKey, TRIBUTES_PER_WAVE),
    [wildWaveKey],
  );
  const escalation = useMemo(
    () => buildTributes(wildWaveKey * 31 + wildEscalateKey, 3),
    [wildWaveKey, wildEscalateKey],
  );
  const confetti = useMemo(
    () => buildConfetti(wildWaveKey, CONFETTI_PER_WAVE),
    [wildWaveKey],
  );

  if (!wild) return null;

  return (
    <div
      className={styles.crowdWildLayer}
      data-testid="showcase-crowd-wild"
      aria-hidden="true"
    >
      {/* Intense flash flurry: more bursts than the ambient pit, spread wide
          across the lower band, re-keyed per escalate tick so sustained
          clicking keeps the cameras popping. */}
      <div className={styles.wildFlashRow} key={`flash-${wildEscalateKey}`}>
        {[8, 24, 42, 58, 76, 92].map((leftPct, i) => (
          <span
            key={leftPct}
            className={styles.wildFlash}
            style={{ left: `${leftPct}%` }}
          >
            <FlashBurst delayMs={i * 35} />
          </span>
        ))}
      </div>

      {/* Confetti rain from the top. */}
      <div className={styles.confettiLayer}>
        {confetti.map((p) => (
          <span
            key={p.id}
            className={styles.confettiPiece}
            style={{
              left: `${p.leftPct}%`,
              ["--c-delay" as string]: `${p.delayMs}ms`,
              ["--c-dur" as string]: `${p.durationMs}ms`,
              ["--c-drift" as string]: `${p.drift}px`,
              ["--c-spin" as string]: `${p.spin}deg`,
            }}
          >
            <ConfettiSvg colorIndex={p.colorIndex} />
          </span>
        ))}
      </div>

      {/* Thrown tributes (roses + a cheeky bra), arcing in from the edges to
          land near center stage. The base wave + the latest escalation batch. */}
      <div className={styles.tributeLayer}>
        {[...tributes, ...escalation].map((t) => (
          <span
            key={t.id}
            className={styles.tribute}
            style={{
              ["--from-x" as string]: `${t.fromX}%`,
              ["--from-y" as string]: `${t.fromY}%`,
              ["--to-x" as string]: `${t.toX}%`,
              ["--to-y" as string]: `${t.toY}%`,
              ["--t-rotate" as string]: `${t.rotate}deg`,
              ["--t-delay" as string]: `${t.delayMs}ms`,
              ["--t-dur" as string]: `${t.durationMs}ms`,
            }}
          >
            {t.kind === "bra" ? <BraSvg size={44} /> : <RoseSvg size={30} />}
          </span>
        ))}
      </div>

      {/* Edge applause: clapping hands + sparkle twinkles flanking both sides. */}
      <div className={`${styles.applauseColumn} ${styles.applauseLeft}`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={styles.applauseItem}
            style={{ ["--a-delay" as string]: `${i * 120}ms` }}
          >
            <ClapHandSvg size={28} />
          </span>
        ))}
      </div>
      <div className={`${styles.applauseColumn} ${styles.applauseRight}`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`${styles.applauseItem} ${styles.applauseFlip}`}
            style={{ ["--a-delay" as string]: `${i * 120 + 60}ms` }}
          >
            <ClapHandSvg size={28} />
          </span>
        ))}
      </div>

      {/* A single genuine gold marquee word. One word only (brief). */}
      <div className={styles.bravoBanner} key={`bravo-${wildWaveKey}`}>
        <span className={styles.bravoWord}>BRAVO</span>
        <SparkleSvg size={22} className={styles.bravoSparkleLeft} />
        <SparkleSvg size={22} className={styles.bravoSparkleRight} />
      </div>
    </div>
  );
}

/* ── Combined overlay ──────────────────────────────────────────────────── */

export interface ClickRewardsProps {
  bursts: ClickBurst[];
  wild: boolean;
  wildWaveKey: number;
  wildEscalateKey: number;
}

/** Drop this INSIDE a positioned stage section (after the content). Renders
 *  both tiers; pointer-events: none so it never blocks clicks. */
export default function ClickRewards({
  bursts,
  wild,
  wildWaveKey,
  wildEscalateKey,
}: ClickRewardsProps) {
  return (
    <>
      <CursorBursts bursts={bursts} />
      <CrowdWild
        wild={wild}
        wildWaveKey={wildWaveKey}
        wildEscalateKey={wildEscalateKey}
      />
    </>
  );
}
