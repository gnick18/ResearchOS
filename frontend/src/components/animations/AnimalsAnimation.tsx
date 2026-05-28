"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type AnimalType =
  | "paw"
  | "bird"
  | "butterfly"
  | "bee"
  | "ladybug"
  | "fox"
  | "owl"
  | "squirrel"
  | "rabbit";

interface AnimalParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: AnimalType;
  opacity: number;
  color: string;
  accent: string;
  wingPhase: number;
}

interface Sparkle {
  id: number;
  x: number;
  y: number;
  opacity: number;
  size: number;
  color: string;
}

interface AnimalsAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const PAW_COLORS = ["#ff9f43", "#8B4513", "#444", "#a0522d", "#d2691e"];
const BUTTERFLY_PALETTE: ReadonlyArray<[string, string]> = [
  ["#ff6b6b", "#feca57"],
  ["#54a0ff", "#48dbfb"],
  ["#ff9ff3", "#a55eea"],
  ["#10ac84", "#feca57"],
  ["#ee5a24", "#ffeaa7"],
];
const BIRD_COLORS = ["#48dbfb", "#54a0ff", "#5f27cd", "#feca57", "#ff6b6b"];
const SPARKLE_COLORS = ["#feca57", "#ff9ff3", "#48dbfb", "#10ac84", "#ff9f43"];

function pick<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface SpawnSpec {
  type: AnimalType;
  count: number;
  speedMin: number;
  speedRange: number;
  liftBoost: number;
  scaleMin: number;
  scaleRange: number;
  rotationSpeedRange: number;
  spread: number;
  pickColor: () => { color: string; accent: string };
}

const SPAWN_SPECS: ReadonlyArray<SpawnSpec> = [
  {
    type: "paw",
    count: 8,
    speedMin: 4,
    speedRange: 5,
    liftBoost: 3,
    scaleMin: 0.55,
    scaleRange: 0.4,
    rotationSpeedRange: 6,
    spread: 70,
    pickColor: () => ({ color: pick(PAW_COLORS), accent: "#fff" }),
  },
  {
    type: "bird",
    count: 6,
    speedMin: 5,
    speedRange: 6,
    liftBoost: 5,
    scaleMin: 0.55,
    scaleRange: 0.4,
    rotationSpeedRange: 3,
    spread: 60,
    pickColor: () => ({ color: pick(BIRD_COLORS), accent: "#ff9f43" }),
  },
  {
    type: "butterfly",
    count: 7,
    speedMin: 3,
    speedRange: 5,
    liftBoost: 4,
    scaleMin: 0.55,
    scaleRange: 0.45,
    rotationSpeedRange: 8,
    spread: 65,
    pickColor: () => {
      const [color, accent] = pick(BUTTERFLY_PALETTE);
      return { color, accent };
    },
  },
  {
    type: "bee",
    count: 5,
    speedMin: 4,
    speedRange: 5,
    liftBoost: 4,
    scaleMin: 0.55,
    scaleRange: 0.35,
    rotationSpeedRange: 4,
    spread: 55,
    pickColor: () => ({ color: "#fcc419", accent: "#222" }),
  },
  {
    type: "ladybug",
    count: 4,
    speedMin: 3,
    speedRange: 4,
    liftBoost: 3,
    scaleMin: 0.6,
    scaleRange: 0.35,
    rotationSpeedRange: 5,
    spread: 50,
    pickColor: () => ({ color: "#e53935", accent: "#222" }),
  },
  {
    type: "fox",
    count: 3,
    speedMin: 3,
    speedRange: 4,
    liftBoost: 3,
    scaleMin: 0.65,
    scaleRange: 0.35,
    rotationSpeedRange: 3,
    spread: 50,
    pickColor: () => ({ color: "#ff7a45", accent: "#fff" }),
  },
  {
    type: "owl",
    count: 3,
    speedMin: 3,
    speedRange: 4,
    liftBoost: 3,
    scaleMin: 0.65,
    scaleRange: 0.35,
    rotationSpeedRange: 3,
    spread: 50,
    pickColor: () => ({ color: "#8d6e63", accent: "#fdd835" }),
  },
  {
    type: "squirrel",
    count: 3,
    speedMin: 3,
    speedRange: 4,
    liftBoost: 3,
    scaleMin: 0.6,
    scaleRange: 0.35,
    rotationSpeedRange: 3,
    spread: 50,
    pickColor: () => ({ color: "#a0522d", accent: "#fff" }),
  },
  {
    type: "rabbit",
    count: 3,
    speedMin: 3,
    speedRange: 4,
    liftBoost: 3,
    scaleMin: 0.6,
    scaleRange: 0.35,
    rotationSpeedRange: 3,
    spread: 50,
    pickColor: () => ({ color: "#e0e0e0", accent: "#ffb3ba" }),
  },
];

export default function AnimalsAnimation({ x, y, onComplete }: AnimalsAnimationProps) {
  const [particles, setParticles] = useState<AnimalParticle[]>([]);
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  const createParticles = useCallback(() => {
    const newParticles: AnimalParticle[] = [];
    let id = 0;
    for (const spec of SPAWN_SPECS) {
      for (let i = 0; i < spec.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = spec.speedMin + Math.random() * spec.speedRange;
        const { color, accent } = spec.pickColor();
        newParticles.push({
          id: id++,
          x: x + (Math.random() - 0.5) * spec.spread,
          y: y + (Math.random() - 0.5) * spec.spread,
          rotation:
            spec.type === "bird" || spec.type === "butterfly" || spec.type === "bee"
              ? (angle * 180) / Math.PI
              : Math.random() * 30 - 15,
          scale: spec.scaleMin + Math.random() * spec.scaleRange,
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - spec.liftBoost,
          rotationSpeed: (Math.random() - 0.5) * spec.rotationSpeedRange,
          type: spec.type,
          opacity: 1,
          color,
          accent,
          wingPhase: Math.random() * Math.PI * 2,
        });
      }
    }
    return newParticles;
  }, [x, y]);

  // Stable handle to the latest onComplete (double-fire fix). Consumers pass
  // an inline onComplete (a fresh reference every render). The handlers do an
  // async tasksApi.update + refetch right after firing; when the refetch lands
  // mid-animation the parent re-renders, onComplete's identity changes, and
  // (when it was an effect dep) the spawn effect re-ran, resetting particles
  // and replaying the burst (the animation "firing twice"). Reading onComplete
  // through a ref keeps the spawn effect mount-only.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init of mount-time random particles, then setInterval drives animation
    setParticles(createParticles());

    const newSparkles: Sparkle[] = [];
    for (let i = 0; i < 18; i++) {
      newSparkles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 160,
        y: y + (Math.random() - 0.5) * 160,
        opacity: 1,
        size: 4 + Math.random() * 5,
        color: pick(SPARKLE_COLORS),
      });
    }
    setSparkles(newSparkles);

    const interval = setInterval(() => {
      setParticles((prev) =>
        prev
          .map((p) => ({
            ...p,
            x: p.x + p.velocityX,
            y: p.y + p.velocityY + 0.35,
            velocityY: p.velocityY + 0.12,
            rotation: p.rotation + p.rotationSpeed,
            opacity: Math.max(0, p.opacity - 0.01),
            wingPhase: p.wingPhase + 0.5,
          }))
          .filter((p) => p.y < window.innerHeight + 100 && p.opacity > 0),
      );

      setSparkles((prev) =>
        prev
          .map((s) => ({
            ...s,
            opacity: Math.max(0, s.opacity - 0.025),
          }))
          .filter((s) => s.opacity > 0),
      );
    }, 30);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      onCompleteRef.current();
    }, 3200);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
    // onComplete is read via the ref above, so it is intentionally NOT a dep
    // here (that re-run was the mid-animation double-fire). Keep createParticles
    // and x/y, which are stable for a given celebration instance.
  }, [createParticles, x, y]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Sparkles */}
      {sparkles.map((s) => (
        <div
          key={`sparkle-${s.id}`}
          className="absolute"
          style={{
            left: s.x,
            top: s.y,
            opacity: s.opacity,
            width: s.size,
            height: s.size,
            background: s.color,
            borderRadius: "50%",
            boxShadow: `0 0 ${s.size * 1.5}px ${s.color}`,
          }}
        />
      ))}

      {/* SVG animal particles */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: p.x,
            top: p.y,
            transform: `rotate(${p.rotation}deg) scale(${p.scale})`,
            opacity: p.opacity,
            width: 44,
            height: 44,
          }}
        >
          {p.type === "paw" && <PawSvg color={p.color} />}
          {p.type === "bird" && <BirdSvg color={p.color} beak={p.accent} wingPhase={p.wingPhase} />}
          {p.type === "butterfly" && (
            <ButterflySvg color={p.color} accent={p.accent} wingPhase={p.wingPhase} />
          )}
          {p.type === "bee" && <BeeSvg wingPhase={p.wingPhase} />}
          {p.type === "ladybug" && <LadybugSvg />}
          {p.type === "fox" && <FoxSvg />}
          {p.type === "owl" && <OwlSvg />}
          {p.type === "squirrel" && <SquirrelSvg />}
          {p.type === "rabbit" && <RabbitSvg color={p.color} accent={p.accent} />}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Animal SVGs. Each piece is a small, self-contained illustration designed
   to read clearly while spinning and shrinking. viewBox 24x24 throughout.
   --------------------------------------------------------------------------- */

function PawSvg({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      <ellipse cx="12" cy="16.5" rx="5" ry="4.2" fill={color} />
      <circle cx="6.2" cy="10.5" r="2.4" fill={color} />
      <circle cx="17.8" cy="10.5" r="2.4" fill={color} />
      <circle cx="9.2" cy="5.8" r="2.1" fill={color} />
      <circle cx="14.8" cy="5.8" r="2.1" fill={color} />
    </svg>
  );
}

function BirdSvg({ color, beak, wingPhase }: { color: string; beak: string; wingPhase: number }) {
  // Flapping V-wings driven by wingPhase
  const flap = Math.sin(wingPhase) * 4; // -4..4
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Body */}
      <ellipse cx="12" cy="13" rx="4.5" ry="3.2" fill={color} />
      {/* Head */}
      <circle cx="16" cy="11" r="2.3" fill={color} />
      {/* Eye */}
      <circle cx="16.6" cy="10.6" r="0.55" fill="#111" />
      {/* Beak */}
      <path d="M18.2 11L21 10.3L18.2 11.8Z" fill={beak} />
      {/* Tail */}
      <path d="M7.5 13L4 11L7 14.5Z" fill={color} opacity="0.85" />
      {/* Wings - V shape, flapping */}
      <path
        d={`M11.5 11 L 7 ${5 - flap} L 12 9 Z`}
        fill={color}
        opacity="0.9"
      />
      <path
        d={`M12.5 11 L 17 ${5 - flap} L 13 9 Z`}
        fill={color}
        opacity="0.9"
      />
    </svg>
  );
}

function ButterflySvg({
  color,
  accent,
  wingPhase,
}: {
  color: string;
  accent: string;
  wingPhase: number;
}) {
  // Wing flutter
  const flutter = 1 + Math.sin(wingPhase) * 0.12;
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Wings (mirrored, fluttering via scaleX) */}
      <g transform={`translate(12 12) scale(${flutter} 1) translate(-12 -12)`}>
        {/* Left upper wing */}
        <ellipse cx="7" cy="9" rx="5" ry="5.5" fill={color} opacity="0.9" />
        {/* Right upper wing */}
        <ellipse cx="17" cy="9" rx="5" ry="5.5" fill={color} opacity="0.9" />
        {/* Left lower wing */}
        <ellipse cx="7.5" cy="16" rx="3.6" ry="4.2" fill={accent} opacity="0.85" />
        {/* Right lower wing */}
        <ellipse cx="16.5" cy="16" rx="3.6" ry="4.2" fill={accent} opacity="0.85" />
        {/* Wing pattern spots */}
        <circle cx="6" cy="9" r="1.1" fill={accent} />
        <circle cx="18" cy="9" r="1.1" fill={accent} />
        <circle cx="7.5" cy="16.5" r="0.7" fill={color} />
        <circle cx="16.5" cy="16.5" r="0.7" fill={color} />
      </g>
      {/* Body */}
      <ellipse cx="12" cy="12" rx="0.9" ry="6" fill="#2c2c2c" />
      {/* Head */}
      <circle cx="12" cy="6" r="1" fill="#2c2c2c" />
      {/* Antennae */}
      <path d="M11.3 5.5 L 10 2" stroke="#2c2c2c" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M12.7 5.5 L 14 2" stroke="#2c2c2c" strokeWidth="0.7" strokeLinecap="round" />
      <circle cx="10" cy="2" r="0.5" fill="#2c2c2c" />
      <circle cx="14" cy="2" r="0.5" fill="#2c2c2c" />
    </svg>
  );
}

function BeeSvg({ wingPhase }: { wingPhase: number }) {
  const wingScale = 1 + Math.sin(wingPhase * 2) * 0.18;
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Wings */}
      <g transform={`translate(12 8) scale(1 ${wingScale}) translate(-12 -8)`}>
        <ellipse cx="9" cy="7" rx="3" ry="2.2" fill="#e3f2fd" opacity="0.85" stroke="#90caf9" strokeWidth="0.4" />
        <ellipse cx="15" cy="7" rx="3" ry="2.2" fill="#e3f2fd" opacity="0.85" stroke="#90caf9" strokeWidth="0.4" />
      </g>
      {/* Body */}
      <ellipse cx="12" cy="14" rx="5" ry="4" fill="#fcc419" />
      {/* Stripes */}
      <path d="M9 12.5 Q 12 11 15 12.5" stroke="#222" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M8.5 15 Q 12 13.6 15.5 15" stroke="#222" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M9 17 Q 12 16 15 17" stroke="#222" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* Head */}
      <circle cx="12" cy="9" r="2.1" fill="#222" />
      {/* Antennae */}
      <path d="M10.8 7.2 L 9.5 4.5" stroke="#222" strokeWidth="0.6" strokeLinecap="round" />
      <path d="M13.2 7.2 L 14.5 4.5" stroke="#222" strokeWidth="0.6" strokeLinecap="round" />
      <circle cx="9.5" cy="4.5" r="0.45" fill="#222" />
      <circle cx="14.5" cy="4.5" r="0.45" fill="#222" />
      {/* Eyes */}
      <circle cx="11.2" cy="9" r="0.4" fill="#fff" />
      <circle cx="12.8" cy="9" r="0.4" fill="#fff" />
    </svg>
  );
}

function LadybugSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Body dome */}
      <ellipse cx="12" cy="13" rx="6.5" ry="5.5" fill="#e53935" />
      {/* Center line */}
      <path d="M12 7.5 L 12 18.5" stroke="#222" strokeWidth="0.9" />
      {/* Head */}
      <ellipse cx="12" cy="7" rx="3" ry="2.2" fill="#222" />
      {/* Spots */}
      <circle cx="8.5" cy="11" r="1.1" fill="#222" />
      <circle cx="15.5" cy="11" r="1.1" fill="#222" />
      <circle cx="9" cy="15" r="1" fill="#222" />
      <circle cx="15" cy="15" r="1" fill="#222" />
      <circle cx="12" cy="13" r="0.7" fill="#222" />
      {/* Antennae */}
      <path d="M10.5 5.5 L 9 3.5" stroke="#222" strokeWidth="0.6" strokeLinecap="round" />
      <path d="M13.5 5.5 L 15 3.5" stroke="#222" strokeWidth="0.6" strokeLinecap="round" />
      <circle cx="9" cy="3.5" r="0.45" fill="#222" />
      <circle cx="15" cy="3.5" r="0.45" fill="#222" />
    </svg>
  );
}

function FoxSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Ears (triangles) */}
      <polygon points="5,4 8,2 9,8" fill="#ff7a45" />
      <polygon points="19,4 16,2 15,8" fill="#ff7a45" />
      {/* Inner ears */}
      <polygon points="6.2,4.6 7.8,3.6 8.2,7" fill="#ffd6cc" />
      <polygon points="17.8,4.6 16.2,3.6 15.8,7" fill="#ffd6cc" />
      {/* Head */}
      <path
        d="M5 11 Q 6 16 12 18 Q 18 16 19 11 Q 17 7 12 7 Q 7 7 5 11 Z"
        fill="#ff7a45"
      />
      {/* White muzzle / cheeks */}
      <path d="M8 14 Q 12 18 16 14 Q 14 16 12 16 Q 10 16 8 14 Z" fill="#fff" />
      {/* Eyes */}
      <circle cx="9.5" cy="11.5" r="0.9" fill="#222" />
      <circle cx="14.5" cy="11.5" r="0.9" fill="#222" />
      <circle cx="9.7" cy="11.3" r="0.3" fill="#fff" />
      <circle cx="14.7" cy="11.3" r="0.3" fill="#fff" />
      {/* Nose */}
      <ellipse cx="12" cy="14" rx="0.9" ry="0.7" fill="#222" />
    </svg>
  );
}

function OwlSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Body */}
      <ellipse cx="12" cy="13.5" rx="6.5" ry="7" fill="#8d6e63" />
      {/* Belly tuft */}
      <ellipse cx="12" cy="15.5" rx="3.5" ry="4" fill="#d7ccc8" />
      {/* Ear tufts */}
      <polygon points="6,6 8,3 9,7" fill="#8d6e63" />
      <polygon points="18,6 16,3 15,7" fill="#8d6e63" />
      {/* Big eyes */}
      <circle cx="9.3" cy="10.5" r="2.2" fill="#fff" />
      <circle cx="14.7" cy="10.5" r="2.2" fill="#fff" />
      <circle cx="9.3" cy="10.5" r="1.2" fill="#fdd835" />
      <circle cx="14.7" cy="10.5" r="1.2" fill="#fdd835" />
      <circle cx="9.3" cy="10.5" r="0.6" fill="#222" />
      <circle cx="14.7" cy="10.5" r="0.6" fill="#222" />
      {/* Beak */}
      <polygon points="12,12 11,14 13,14" fill="#ff9f43" />
      {/* Feet */}
      <path d="M10 19.5 L 10 21 M 9.3 21 L 10.7 21" stroke="#ff9f43" strokeWidth="0.7" strokeLinecap="round" />
      <path d="M14 19.5 L 14 21 M 13.3 21 L 14.7 21" stroke="#ff9f43" strokeWidth="0.7" strokeLinecap="round" />
    </svg>
  );
}

function SquirrelSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Bushy tail (big curl behind) */}
      <path
        d="M18 16 Q 23 12 20 6 Q 17 2 13 6 Q 17 8 17 13 Z"
        fill="#a0522d"
        opacity="0.95"
      />
      <path
        d="M18 14 Q 21 11 19 7 Q 17 5 15 7"
        stroke="#6b3410"
        strokeWidth="0.6"
        fill="none"
        opacity="0.6"
      />
      {/* Body */}
      <ellipse cx="11" cy="15" rx="4.5" ry="5" fill="#a0522d" />
      {/* Belly */}
      <ellipse cx="10" cy="16.5" rx="2.5" ry="3" fill="#f5deb3" />
      {/* Head */}
      <circle cx="8.5" cy="10" r="3.2" fill="#a0522d" />
      {/* Ear */}
      <polygon points="6.5,7 7.5,4.5 9,7" fill="#a0522d" />
      {/* Eye */}
      <circle cx="7.8" cy="9.5" r="0.6" fill="#222" />
      {/* Nose */}
      <circle cx="6" cy="10.7" r="0.45" fill="#222" />
      {/* Acorn paws */}
      <ellipse cx="9" cy="13" rx="0.9" ry="0.6" fill="#6b3410" />
    </svg>
  );
}

function RabbitSvg({ color, accent }: { color: string; accent: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      {/* Long ears */}
      <ellipse cx="9.5" cy="4.5" rx="1.2" ry="3.8" fill={color} transform="rotate(-12 9.5 4.5)" />
      <ellipse cx="14.5" cy="4.5" rx="1.2" ry="3.8" fill={color} transform="rotate(12 14.5 4.5)" />
      {/* Inner ears */}
      <ellipse cx="9.5" cy="5" rx="0.5" ry="2.3" fill={accent} transform="rotate(-12 9.5 5)" />
      <ellipse cx="14.5" cy="5" rx="0.5" ry="2.3" fill={accent} transform="rotate(12 14.5 5)" />
      {/* Body */}
      <ellipse cx="12" cy="16" rx="5" ry="4.5" fill={color} />
      {/* Head */}
      <circle cx="12" cy="11" r="3.6" fill={color} />
      {/* Belly */}
      <ellipse cx="12" cy="17" rx="2.5" ry="2.8" fill="#fff" />
      {/* Eyes */}
      <circle cx="10.5" cy="10.5" r="0.55" fill="#222" />
      <circle cx="13.5" cy="10.5" r="0.55" fill="#222" />
      {/* Nose / mouth */}
      <ellipse cx="12" cy="12.2" rx="0.45" ry="0.35" fill={accent} />
      <path d="M12 12.5 L 12 13.2" stroke="#222" strokeWidth="0.45" strokeLinecap="round" />
      <path d="M12 13.2 Q 11.2 13.7 10.8 13.4" stroke="#222" strokeWidth="0.4" fill="none" strokeLinecap="round" />
      <path d="M12 13.2 Q 12.8 13.7 13.2 13.4" stroke="#222" strokeWidth="0.4" fill="none" strokeLinecap="round" />
      {/* Cotton tail */}
      <circle cx="17" cy="17.5" r="1.4" fill="#fff" />
    </svg>
  );
}
