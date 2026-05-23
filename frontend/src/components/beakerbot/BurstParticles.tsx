"use client";

// frontend/src/components/beakerbot/BurstParticles.tsx
//
// Shared particle-burst primitive for the BeakerBot easter-egg scenes.
//
// Before Scene polish B, three scenes each rolled their own particle
// system:
//   - Eureka: 8 rainbow sparkle-stars radiating from the light bulb,
//     each tweening from origin to (cos(theta)*R, sin(theta)*R).
//   - ScreenBump: 4 yellow "+" sparkles at fixed offsets around the
//     bonk point. Visibility flipped externally (not a one-shot fire).
//   - Centrifuge SplatterField: per-tube droplets at the tubes'
//     landing points (so the splatter visually matches where each
//     tube fell), each with its own delay.
//
// This primitive supports two placement modes so all three call sites
// can share one implementation:
//
//   1. **Radial mode** (`count + radius`): auto-distribute `count`
//      particles evenly around a circle of `radius` px. Eureka +
//      ScreenBump fit this mode.
//
//   2. **Explicit positions** (`positions={[{x, y, ...}, ...]}`):
//      caller supplies per-particle coordinates. Centrifuge
//      SplatterField uses this so each droplet lands near its tube.
//
// Particle shapes:
//   - `"star"`: 4-point sparkle star SVG (Eureka, ScreenBump).
//   - `"circle"`: solid colored dot (Centrifuge splatter).
//   - `"cross"`: simple `+` shape via two crossing line segments
//     (ScreenBump's original "spawn-and-fade" look).
//
// All particle motion is keyframe-driven for compositor-friendliness.
// The component owns NO trigger logic: render it when you want the
// burst to play, unmount it when it ends. The caller is responsible
// for keying / lifetime — re-mount the component to replay.

import type { CSSProperties, FC } from "react";
import { useId, useMemo } from "react";

export type BurstParticleType = "star" | "circle" | "cross";

export interface BurstParticlePosition {
  /** Final x offset from the origin in pixels (or any CSS length the
   *  caller passes through — we don't do unit conversion). */
  x: number | string;
  /** Final y offset from the origin in pixels (or any CSS length). */
  y: number | string;
  /** Optional per-particle color override; falls back to the next
   *  palette entry if absent. */
  color?: string;
  /** Optional per-particle start delay in ms; falls back to a
   *  staggered default (i * 30). */
  delayMs?: number;
  /** Optional per-particle size override in px. Falls back to the
   *  component-level `particleSize`. */
  size?: number;
}

export interface BurstParticlesProps {
  // ----- Placement -----
  /** How many particles in the burst. Required for radial mode;
   *  ignored when `positions` is provided (the positions array's
   *  length wins). */
  count?: number;
  /** Radius in px for radial-mode placement. Particles auto-distribute
   *  evenly around a circle of this radius. Ignored when `positions`
   *  is provided. */
  radius?: number;
  /** Explicit per-particle positions. When supplied, overrides the
   *  radial-mode `count + radius`. */
  positions?: ReadonlyArray<BurstParticlePosition>;

  // ----- Visuals -----
  /** Color cycle. Particles pick `palette[i % palette.length]` unless
   *  the `positions[i].color` overrides per-particle. */
  palette: ReadonlyArray<string>;
  /** Particle shape. Default `"star"`. */
  particleType?: BurstParticleType;
  /** Per-particle render size in px. Default 16. */
  particleSize?: number;

  // ----- Timing -----
  /** Total burst duration in ms (per-particle, not the sum). Default
   *  600. */
  durationMs?: number;
  /** Stagger between successive particle starts in ms. Default 30. */
  staggerMs?: number;

  // ----- Positioning -----
  /** Origin where the burst emanates from. Passed straight to the
   *  wrapper's `left`/`top`. Default 0/0 — the caller is expected to
   *  have already positioned the wrapper. */
  originX?: number | string;
  originY?: number | string;
  /** Additional inline styles merged onto the wrapper. */
  style?: CSSProperties;
  /** Test id forwarded to the wrapper. Optional. */
  "data-testid"?: string;
}

/** Tiny 4-point sparkle-star SVG. Sized to fit a `viewBox 0 0 8 8`
 *  square; the wrapper scales it to `size x size`. */
function StarGlyph({ color, size }: { color: string; size: number }) {
  return (
    <svg
      viewBox="0 0 8 8"
      fill="none"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path
        d="M 4 0 L 4.8 3.2 L 8 4 L 4.8 4.8 L 4 8 L 3.2 4.8 L 0 4 L 3.2 3.2 Z"
        fill={color}
      />
    </svg>
  );
}

/** Simple `+` cross — two stroked line segments. Used by the
 *  ScreenBump impact sparkles. */
function CrossGlyph({ color, size }: { color: string; size: number }) {
  return (
    <svg
      viewBox="-6 -6 12 12"
      fill="none"
      stroke={color}
      strokeWidth={1.4}
      strokeLinecap="round"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M0 -5 L0 5 M-5 0 L5 0" />
    </svg>
  );
}

/** Solid filled circle — used by the Centrifuge splatter droplets. */
function CircleGlyph({ color, size }: { color: string; size: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        boxShadow: "0 0 1px rgba(0,0,0,0.15)",
      }}
    />
  );
}

const BurstParticles: FC<BurstParticlesProps> = ({
  count = 8,
  radius = 60,
  positions,
  palette,
  particleType = "star",
  particleSize = 16,
  durationMs = 600,
  staggerMs = 30,
  originX = 0,
  originY = 0,
  style,
  "data-testid": testId,
}) => {
  // Per-mount keyframe id so multiple bursts on screen at once don't
  // share animation names. Same pattern the scenes already use for
  // their per-instance keyframes.
  const rawId = useId();
  const animSuffix = useMemo(
    () => `bbp-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );

  // Resolve per-particle position + color + delay + size. Either we
  // were given explicit positions, or we synthesize a radial ring.
  const resolved = useMemo(() => {
    if (positions && positions.length > 0) {
      return positions.map((p, i) => ({
        x: p.x,
        y: p.y,
        color: p.color ?? palette[i % palette.length],
        delayMs: p.delayMs ?? i * staggerMs,
        size: p.size ?? particleSize,
      }));
    }
    return Array.from({ length: Math.max(0, count) }, (_, i) => {
      const theta = (i / Math.max(1, count)) * Math.PI * 2;
      return {
        x: Math.cos(theta) * radius,
        y: Math.sin(theta) * radius,
        color: palette[i % palette.length],
        delayMs: i * staggerMs,
        size: particleSize,
      };
    });
  }, [positions, palette, particleSize, count, radius, staggerMs]);

  // Particle glyph picker.
  const renderGlyph = (color: string, size: number) => {
    if (particleType === "circle") return <CircleGlyph color={color} size={size} />;
    if (particleType === "cross") return <CrossGlyph color={color} size={size} />;
    return <StarGlyph color={color} size={size} />;
  };

  return (
    <div
      data-testid={testId ?? "beakerbot-burst-particles"}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: originX,
        top: originY,
        width: 0,
        height: 0,
        pointerEvents: "none",
        ...style,
      }}
    >
      <style>{`
        @keyframes ${animSuffix} {
          0% {
            opacity: 0;
            transform: translate(0, 0) scale(0);
          }
          20% {
            opacity: 1;
            transform: translate(calc(var(--bbp-x) * 0.4), calc(var(--bbp-y) * 0.4)) scale(1.2);
          }
          60% {
            opacity: 1;
            transform: translate(var(--bbp-x), var(--bbp-y)) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(calc(var(--bbp-x) * 1.1), calc(var(--bbp-y) * 1.1)) scale(0);
          }
        }
      `}</style>
      {resolved.map((p, i) => (
        <div
          key={i}
          data-testid="beakerbot-burst-particle"
          style={
            {
              position: "absolute",
              left: 0,
              top: 0,
              "--bbp-x": typeof p.x === "number" ? `${p.x}px` : p.x,
              "--bbp-y": typeof p.y === "number" ? `${p.y}px` : p.y,
              transform: "translate(0, 0) scale(0)",
              animation: `${animSuffix} ${durationMs}ms ease-out ${p.delayMs}ms forwards`,
              // Center the glyph on its origin point so the burst
              // emanates from the center, not the corner.
              marginLeft: -p.size / 2,
              marginTop: -p.size / 2,
            } as CSSProperties
          }
        >
          {renderGlyph(p.color, p.size)}
        </div>
      ))}
    </div>
  );
};

export default BurstParticles;
