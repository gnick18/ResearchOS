"use client";

import { useEffect, useState, useCallback } from "react";

type ParticleType =
  | "fish"
  | "jellyfish"
  | "octopus"
  | "seahorse"
  | "starfish"
  | "coral"
  | "kelp"
  | "whaletail";

interface WaterParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  swayPhase: number;
  swaySpeed: number;
  type: ParticleType;
  opacity: number;
  color: string;
  accent: string;
  flipped: boolean;
}

interface Bubble {
  id: number;
  x: number;
  y: number;
  size: number;
  velocityY: number;
  wobble: number;
  wobbleSpeed: number;
  opacity: number;
}

interface UnderwaterAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

// Tropical reef palette — aqua, teal, coral, sunset.
const FISH_PALETTES: Array<{ body: string; accent: string }> = [
  { body: "#ff7043", accent: "#ffb199" }, // clownfish orange
  { body: "#26c6da", accent: "#80deea" }, // aqua
  { body: "#ffd54f", accent: "#fff59d" }, // butter yellow
  { body: "#7e57c2", accent: "#b39ddb" }, // royal purple
  { body: "#42a5f5", accent: "#90caf9" }, // sky blue
  { body: "#ef5350", accent: "#ffab91" }, // coral red
  { body: "#66bb6a", accent: "#a5d6a7" }, // reef green
  { body: "#ec407a", accent: "#f48fb1" }, // pink
];

const JELLY_PALETTES: Array<{ body: string; accent: string }> = [
  { body: "#f48fb1", accent: "#fce4ec" },
  { body: "#ce93d8", accent: "#f3e5f5" },
  { body: "#80deea", accent: "#e0f7fa" },
  { body: "#ffcc80", accent: "#fff3e0" },
];

const OCTOPUS_PALETTES: Array<{ body: string; accent: string }> = [
  { body: "#ab47bc", accent: "#ce93d8" },
  { body: "#ff7043", accent: "#ffab91" },
  { body: "#7e57c2", accent: "#b39ddb" },
];

const SEAHORSE_COLORS = ["#ffb74d", "#ffa726", "#fff176", "#ff8a65"];
const STARFISH_COLORS = ["#ff8a65", "#ffb74d", "#f06292", "#ba68c8"];
const CORAL_COLORS = ["#ff6f91", "#ff9aa2", "#fbc4ab", "#f8ad9d"];
const KELP_COLORS = ["#2e7d32", "#388e3c", "#43a047", "#558b2f"];
const WHALE_COLOR = "#37474f";

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function UnderwaterAnimation({ x, y, onComplete }: UnderwaterAnimationProps) {
  const [particles, setParticles] = useState<WaterParticle[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [waveOffset, setWaveOffset] = useState(0);

  const createParticles = useCallback(() => {
    const newParticles: WaterParticle[] = [];
    let nextId = 0;

    const baseParticle = (
      type: ParticleType,
      colors: { body: string; accent: string },
      opts: {
        spread: number;
        speedRange: [number, number];
        lift?: number; // negative = floats up
        rotRange?: number;
        scaleRange?: [number, number];
        rotationSpeedRange?: number;
      },
    ) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = opts.speedRange[0] + Math.random() * (opts.speedRange[1] - opts.speedRange[0]);
      const [smin, smax] = opts.scaleRange ?? [0.6, 1.1];
      newParticles.push({
        id: nextId++,
        x: x + (Math.random() - 0.5) * opts.spread,
        y: y + (Math.random() - 0.5) * opts.spread,
        rotation: (opts.rotRange ?? 0) ? (Math.random() - 0.5) * (opts.rotRange ?? 0) : 0,
        scale: smin + Math.random() * (smax - smin),
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed + (opts.lift ?? 0),
        rotationSpeed: opts.rotationSpeedRange
          ? (Math.random() - 0.5) * opts.rotationSpeedRange
          : 0,
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.05 + Math.random() * 0.08,
        type,
        opacity: 1,
        color: colors.body,
        accent: colors.accent,
        flipped: Math.random() < 0.5,
      });
    };

    // Tropical fish swimming outward — most numerous
    for (let i = 0; i < 10; i++) {
      baseParticle("fish", pick(FISH_PALETTES), {
        spread: 60,
        speedRange: [4, 9],
        lift: -1.5,
        rotRange: 30,
        scaleRange: [0.55, 1.1],
        rotationSpeedRange: 1.5,
      });
    }

    // Jellyfish drifting upward — serene
    for (let i = 0; i < 5; i++) {
      baseParticle("jellyfish", pick(JELLY_PALETTES), {
        spread: 90,
        speedRange: [1.5, 3],
        lift: -3.5,
        rotRange: 10,
        scaleRange: [0.55, 1.0],
        rotationSpeedRange: 0.6,
      });
    }

    // Octopus — bigger, fewer, dramatic
    for (let i = 0; i < 3; i++) {
      baseParticle("octopus", pick(OCTOPUS_PALETTES), {
        spread: 50,
        speedRange: [2.5, 5],
        lift: -1.8,
        rotRange: 20,
        scaleRange: [0.65, 1.1],
        rotationSpeedRange: 1.8,
      });
    }

    // Seahorses — curl, vertical bias
    for (let i = 0; i < 4; i++) {
      const color = pick(SEAHORSE_COLORS);
      baseParticle(
        "seahorse",
        { body: color, accent: "#fff3b0" },
        {
          spread: 75,
          speedRange: [2, 4],
          lift: -2.5,
          rotRange: 15,
          scaleRange: [0.55, 0.95],
          rotationSpeedRange: 1.2,
        },
      );
    }

    // Starfish — slow tumble
    for (let i = 0; i < 5; i++) {
      const color = pick(STARFISH_COLORS);
      baseParticle(
        "starfish",
        { body: color, accent: "#fff3b0" },
        {
          spread: 70,
          speedRange: [2.5, 5],
          lift: -1,
          rotRange: 360,
          scaleRange: [0.5, 0.95],
          rotationSpeedRange: 8,
        },
      );
    }

    // Coral branches — smaller, scatter
    for (let i = 0; i < 4; i++) {
      const color = pick(CORAL_COLORS);
      baseParticle(
        "coral",
        { body: color, accent: "#ffeef0" },
        {
          spread: 95,
          speedRange: [2, 4],
          lift: -0.5,
          rotRange: 60,
          scaleRange: [0.5, 0.9],
          rotationSpeedRange: 3,
        },
      );
    }

    // Kelp blades — long, swaying
    for (let i = 0; i < 4; i++) {
      const color = pick(KELP_COLORS);
      baseParticle(
        "kelp",
        { body: color, accent: "#aed581" },
        {
          spread: 100,
          speedRange: [1.5, 3],
          lift: -2,
          rotRange: 20,
          scaleRange: [0.65, 1.1],
          rotationSpeedRange: 1.5,
        },
      );
    }

    // Whale tail — occasional, big splash element
    for (let i = 0; i < 2; i++) {
      baseParticle(
        "whaletail",
        { body: WHALE_COLOR, accent: "#78909c" },
        {
          spread: 80,
          speedRange: [3, 5],
          lift: -2,
          rotRange: 40,
          scaleRange: [0.7, 1.2],
          rotationSpeedRange: 1.5,
        },
      );
    }

    return newParticles;
  }, [x, y]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init of mount-time random particles, then setInterval drives animation
    setParticles(createParticles());

    // Create bubbles (drift upward, wobble side to side)
    const newBubbles: Bubble[] = [];
    for (let i = 0; i < 40; i++) {
      newBubbles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 170,
        y: y + Math.random() * 60,
        size: 4 + Math.random() * 22,
        velocityY: -1.8 - Math.random() * 4,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.06 + Math.random() * 0.1,
        opacity: 0.55 + Math.random() * 0.4,
      });
    }
    setBubbles(newBubbles);

    // Animate
    const interval = setInterval(() => {
      setParticles((prev) =>
        prev
          .map((p) => {
            // Gentle horizontal sway driven by swayPhase — wavy underwater feel
            const sway = Math.sin(p.swayPhase) * 0.6;
            return {
              ...p,
              x: p.x + p.velocityX + sway,
              y: p.y + p.velocityY + 0.25,
              // Weaker gravity than land animations — buoyant
              velocityY: p.velocityY + 0.05,
              rotation: p.rotation + p.rotationSpeed,
              swayPhase: p.swayPhase + p.swaySpeed,
              opacity: Math.max(0, p.opacity - 0.009),
            };
          })
          .filter((p) => p.y < window.innerHeight + 100 && p.opacity > 0),
      );

      setBubbles((prev) =>
        prev
          .map((b) => ({
            ...b,
            y: b.y + b.velocityY,
            x: b.x + Math.sin(b.wobble) * 0.8,
            wobble: b.wobble + b.wobbleSpeed,
            opacity: Math.max(0, b.opacity - 0.007),
          }))
          .filter((b) => b.y > -60 && b.opacity > 0),
      );

      setWaveOffset((prev) => prev + 0.1);
    }, 30);

    // Clean up after animation
    const timeout = setTimeout(() => {
      clearInterval(interval);
      onComplete();
    }, 2500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [createParticles, onComplete, x, y]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Water overlay — fades out quickly */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,150,180,0.18) 0%, rgba(0,80,140,0.22) 60%, rgba(0,40,90,0.25) 100%)",
          animation: "underwaterFadeOut 1.2s ease-out forwards",
        }}
      />
      <style>{`
        @keyframes underwaterFadeOut {
          0% { opacity: 1; }
          40% { opacity: 0.7; }
          100% { opacity: 0; }
        }
      `}</style>

      {/* Wave effect at top */}
      <svg
        className="absolute top-0 left-0 w-full h-20 opacity-30"
        viewBox="0 0 1200 120"
        preserveAspectRatio="none"
        style={{ animation: "underwaterFadeOut 1.5s ease-out forwards" }}
      >
        <path
          d={`M0,60 C150,${90 + Math.sin(waveOffset) * 20} 350,${30 + Math.cos(waveOffset) * 20} 600,60 C850,${
            90 + Math.sin(waveOffset + 1) * 20
          } 1050,${30 + Math.cos(waveOffset + 1) * 20} 1200,60 L1200,0 L0,0 Z`}
          fill="rgba(100,200,255,0.5)"
        />
      </svg>

      {/* Bubbles */}
      {bubbles.map((b) => (
        <div
          key={`bubble-${b.id}`}
          className="absolute rounded-full"
          style={{
            left: b.x,
            top: b.y,
            width: b.size,
            height: b.size,
            background:
              "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.85), rgba(160,220,255,0.35) 60%, rgba(100,180,230,0.15))",
            boxShadow: "inset 0 0 4px rgba(255,255,255,0.5)",
            opacity: b.opacity,
          }}
        />
      ))}

      {/* SVG particles */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: p.x,
            top: p.y,
            transform: `rotate(${p.rotation}deg) scale(${p.scale}) scaleX(${p.flipped ? -1 : 1})`,
            opacity: p.opacity,
            width: 48,
            height: 48,
          }}
        >
          {p.type === "fish" && <FishSVG body={p.color} accent={p.accent} />}
          {p.type === "jellyfish" && <JellyfishSVG body={p.color} accent={p.accent} />}
          {p.type === "octopus" && <OctopusSVG body={p.color} accent={p.accent} />}
          {p.type === "seahorse" && <SeahorseSVG body={p.color} accent={p.accent} />}
          {p.type === "starfish" && <StarfishSVG body={p.color} />}
          {p.type === "coral" && <CoralSVG body={p.color} accent={p.accent} />}
          {p.type === "kelp" && <KelpSVG body={p.color} accent={p.accent} />}
          {p.type === "whaletail" && <WhaleTailSVG body={p.color} accent={p.accent} />}
        </div>
      ))}
    </div>
  );
}

/* ---------- Custom SVG particle components ---------- */

const FishSVG = ({ body, accent }: { body: string; accent: string }) => (
  <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
    {/* Tail fin */}
    <path d="M36 24 L46 16 L44 24 L46 32 Z" fill={body} opacity="0.85" />
    {/* Body */}
    <ellipse cx="22" cy="24" rx="15" ry="9" fill={body} />
    {/* Belly highlight */}
    <ellipse cx="22" cy="28" rx="11" ry="4" fill={accent} opacity="0.9" />
    {/* Stripes for tropical flavor */}
    <path d="M26 16 Q27 24 26 32" stroke={accent} strokeWidth="1" opacity="0.55" fill="none" />
    <path d="M18 16 Q17 24 18 32" stroke={accent} strokeWidth="1" opacity="0.55" fill="none" />
    {/* Top fin */}
    <path d="M16 16 L22 9 L28 16 Z" fill={body} opacity="0.8" />
    {/* Bottom fin */}
    <path d="M18 32 L22 36 L26 32 Z" fill={body} opacity="0.8" />
    {/* Side fin */}
    <path d="M14 25 Q10 28 14 30 Z" fill={body} opacity="0.7" />
    {/* Gill */}
    <path d="M13 21 Q11 24 13 27" stroke={accent} strokeWidth="0.8" strokeLinecap="round" opacity="0.6" />
    {/* Eye */}
    <circle cx="11" cy="22" r="2.2" fill="#ffffff" />
    <circle cx="10.7" cy="22" r="1.1" fill="#0a2a3a" />
    <circle cx="10.4" cy="21.6" r="0.4" fill="#ffffff" />
    {/* Tiny mouth */}
    <path d="M7 25 Q6 26 7 27" stroke="#0a2a3a" strokeWidth="0.6" strokeLinecap="round" />
  </svg>
);

const JellyfishSVG = ({ body, accent }: { body: string; accent: string }) => (
  <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
    {/* Outer translucent halo */}
    <ellipse cx="24" cy="18" rx="15" ry="11" fill={body} opacity="0.35" />
    {/* Dome */}
    <path
      d="M9 20 Q9 8 24 8 Q39 8 39 20 Q39 22 37 22 L11 22 Q9 22 9 20 Z"
      fill={body}
      opacity="0.85"
    />
    {/* Dome highlight */}
    <ellipse cx="19" cy="13" rx="6" ry="3" fill={accent} opacity="0.7" />
    {/* Inner glow ring */}
    <path d="M12 19 Q24 16 36 19" stroke={accent} strokeWidth="0.8" opacity="0.6" fill="none" />
    {/* Tentacles — wavy, varied length */}
    <path
      d="M13 22 Q11 28 14 33 Q11 38 13 44"
      stroke={body}
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
      opacity="0.7"
    />
    <path
      d="M17 22 Q15 29 18 35 Q15 41 17 46"
      stroke={body}
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
      opacity="0.7"
    />
    <path
      d="M21 22 Q19 28 22 33 Q19 39 21 45"
      stroke={body}
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
      opacity="0.75"
    />
    <path
      d="M27 22 Q29 28 26 33 Q29 39 27 45"
      stroke={body}
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
      opacity="0.75"
    />
    <path
      d="M31 22 Q33 29 30 35 Q33 41 31 46"
      stroke={body}
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
      opacity="0.7"
    />
    <path
      d="M35 22 Q37 28 34 33 Q37 38 35 44"
      stroke={body}
      strokeWidth="1.4"
      strokeLinecap="round"
      fill="none"
      opacity="0.7"
    />
  </svg>
);

const OctopusSVG = ({ body, accent }: { body: string; accent: string }) => (
  <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
    {/* Head */}
    <ellipse cx="24" cy="18" rx="13" ry="11" fill={body} />
    {/* Highlight */}
    <ellipse cx="20" cy="13" rx="5" ry="3" fill={accent} opacity="0.7" />
    {/* 8 tentacles, curling */}
    {[
      "M11 24 Q7 30 11 36 Q7 42 12 46",
      "M14 27 Q11 33 14 38 Q12 44 16 47",
      "M19 28 Q17 34 19 40 Q18 45 22 46",
      "M23 29 Q22 35 24 41 Q23 46 26 46",
      "M27 28 Q29 34 27 40 Q29 45 26 47",
      "M32 27 Q34 33 32 38 Q35 44 31 47",
      "M37 24 Q41 30 37 36 Q41 42 36 46",
      "M34 22 Q39 26 36 32",
    ].map((d, i) => (
      <path
        key={i}
        d={d}
        stroke={body}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
        opacity={0.85 - (i % 3) * 0.1}
      />
    ))}
    {/* Suckers (a couple) */}
    <circle cx="13" cy="34" r="0.7" fill={accent} opacity="0.7" />
    <circle cx="20" cy="36" r="0.7" fill={accent} opacity="0.7" />
    <circle cx="27" cy="36" r="0.7" fill={accent} opacity="0.7" />
    <circle cx="34" cy="34" r="0.7" fill={accent} opacity="0.7" />
    {/* Eyes */}
    <circle cx="19" cy="17" r="2" fill="#ffffff" />
    <circle cx="29" cy="17" r="2" fill="#ffffff" />
    <circle cx="19" cy="17" r="1" fill="#0a2a3a" />
    <circle cx="29" cy="17" r="1" fill="#0a2a3a" />
    {/* Cute mouth */}
    <path d="M22 22 Q24 24 26 22" stroke="#0a2a3a" strokeWidth="0.7" strokeLinecap="round" fill="none" />
  </svg>
);

const SeahorseSVG = ({ body, accent }: { body: string; accent: string }) => (
  <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
    {/* Body — curled S-shape */}
    <path
      d="M20 6 Q30 8 30 18 Q30 26 22 28 Q14 30 16 38 Q18 44 26 44"
      stroke={body}
      strokeWidth="6"
      strokeLinecap="round"
      fill="none"
    />
    {/* Belly highlight on the curl */}
    <path
      d="M22 9 Q28 10 28 18 Q28 24 22 26"
      stroke={accent}
      strokeWidth="2.5"
      strokeLinecap="round"
      fill="none"
      opacity="0.7"
    />
    {/* Head / snout */}
    <path d="M20 6 L15 4 L14 9" stroke={body} strokeWidth="3" strokeLinecap="round" fill="none" />
    {/* Crown spines */}
    <path d="M22 5 L21 2" stroke={body} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M25 6 L25 3" stroke={body} strokeWidth="1.5" strokeLinecap="round" />
    {/* Dorsal fin */}
    <path d="M30 14 Q35 16 33 22 Q31 20 30 18" fill={accent} opacity="0.85" />
    {/* Eye */}
    <circle cx="18" cy="7" r="1" fill="#ffffff" />
    <circle cx="17.8" cy="7" r="0.45" fill="#0a2a3a" />
    {/* Tail curl detail */}
    <path d="M26 44 Q30 44 30 40" stroke={accent} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.7" />
  </svg>
);

const StarfishSVG = ({ body }: { body: string }) => (
  <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
    {/* Star body */}
    <path
      d="M24 3 L29 18 L45 18 L32 27 L37 43 L24 33 L11 43 L16 27 L3 18 L19 18 Z"
      fill={body}
      stroke="#b85c2a"
      strokeWidth="0.8"
      strokeLinejoin="round"
    />
    {/* Texture dots */}
    <circle cx="24" cy="14" r="0.9" fill="#b85c2a" opacity="0.6" />
    <circle cx="24" cy="22" r="1.2" fill="#b85c2a" opacity="0.6" />
    <circle cx="20" cy="26" r="0.7" fill="#b85c2a" opacity="0.6" />
    <circle cx="28" cy="26" r="0.7" fill="#b85c2a" opacity="0.6" />
    <circle cx="24" cy="30" r="0.9" fill="#b85c2a" opacity="0.6" />
    <circle cx="16" cy="22" r="0.6" fill="#b85c2a" opacity="0.5" />
    <circle cx="32" cy="22" r="0.6" fill="#b85c2a" opacity="0.5" />
    {/* Central highlight */}
    <circle cx="24" cy="24" r="2" fill="#ffe7c2" opacity="0.55" />
  </svg>
);

const CoralSVG = ({ body, accent }: { body: string; accent: string }) => (
  <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
    {/* Main trunk */}
    <path
      d="M24 44 Q22 36 24 28 Q26 22 22 16 Q20 10 24 4"
      stroke={body}
      strokeWidth="4"
      strokeLinecap="round"
      fill="none"
    />
    {/* Branches */}
    <path d="M24 30 Q14 28 12 18" stroke={body} strokeWidth="3.2" strokeLinecap="round" fill="none" />
    <path d="M24 26 Q34 24 38 14" stroke={body} strokeWidth="3.2" strokeLinecap="round" fill="none" />
    <path d="M24 38 Q16 38 12 32" stroke={body} strokeWidth="3" strokeLinecap="round" fill="none" />
    <path d="M24 36 Q32 36 36 30" stroke={body} strokeWidth="3" strokeLinecap="round" fill="none" />
    {/* Polyps as highlights */}
    <circle cx="12" cy="18" r="2" fill={accent} />
    <circle cx="38" cy="14" r="2" fill={accent} />
    <circle cx="24" cy="4" r="2" fill={accent} />
    <circle cx="12" cy="32" r="1.5" fill={accent} />
    <circle cx="36" cy="30" r="1.5" fill={accent} />
    <circle cx="22" cy="16" r="1.4" fill={accent} opacity="0.8" />
    <circle cx="26" cy="22" r="1.2" fill={accent} opacity="0.8" />
  </svg>
);

const KelpSVG = ({ body, accent }: { body: string; accent: string }) => (
  <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
    {/* Three swaying blades */}
    <path
      d="M14 46 Q10 38 14 30 Q18 22 14 14 Q12 8 16 2"
      stroke={body}
      strokeWidth="3.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M24 46 Q28 36 24 26 Q20 18 26 10 Q28 6 24 2"
      stroke={accent}
      strokeWidth="3.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M34 46 Q30 38 34 30 Q38 22 34 14 Q32 8 36 2"
      stroke={body}
      strokeWidth="3.5"
      strokeLinecap="round"
      fill="none"
    />
    {/* Frond leaves */}
    <ellipse cx="11" cy="34" rx="2.5" ry="1.2" fill={accent} opacity="0.8" transform="rotate(-30 11 34)" />
    <ellipse cx="17" cy="20" rx="2.5" ry="1.2" fill={accent} opacity="0.8" transform="rotate(30 17 20)" />
    <ellipse cx="27" cy="30" rx="2.5" ry="1.2" fill={body} opacity="0.85" transform="rotate(40 27 30)" />
    <ellipse cx="22" cy="14" rx="2.5" ry="1.2" fill={body} opacity="0.85" transform="rotate(-30 22 14)" />
    <ellipse cx="37" cy="22" rx="2.5" ry="1.2" fill={accent} opacity="0.8" transform="rotate(30 37 22)" />
    <ellipse cx="31" cy="36" rx="2.5" ry="1.2" fill={accent} opacity="0.8" transform="rotate(-30 31 36)" />
  </svg>
);

const WhaleTailSVG = ({ body, accent }: { body: string; accent: string }) => (
  <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
    {/* Tail stalk emerging from "water" */}
    <path d="M22 44 Q24 36 24 28" stroke={body} strokeWidth="6" strokeLinecap="round" fill="none" />
    {/* Two flukes — V shape */}
    <path
      d="M24 28 Q10 18 6 6 Q14 12 22 22 Q26 28 24 28 Z"
      fill={body}
    />
    <path
      d="M24 28 Q38 18 42 6 Q34 12 26 22 Q22 28 24 28 Z"
      fill={body}
    />
    {/* Edge highlight */}
    <path
      d="M8 8 Q14 14 20 22"
      stroke={accent}
      strokeWidth="0.8"
      strokeLinecap="round"
      fill="none"
      opacity="0.55"
    />
    <path
      d="M40 8 Q34 14 28 22"
      stroke={accent}
      strokeWidth="0.8"
      strokeLinecap="round"
      fill="none"
      opacity="0.55"
    />
    {/* Splash dots */}
    <circle cx="14" cy="42" r="1.2" fill={accent} opacity="0.6" />
    <circle cx="34" cy="42" r="1.2" fill={accent} opacity="0.6" />
    <circle cx="20" cy="46" r="0.7" fill={accent} opacity="0.5" />
    <circle cx="28" cy="46" r="0.7" fill={accent} opacity="0.5" />
  </svg>
);
