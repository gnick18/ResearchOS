"use client";

import { useEffect, useState, useCallback } from "react";

type ScaryType =
  | "skull"
  | "ghost"
  | "bat"
  | "spider"
  | "pumpkin"
  | "gravestone"
  | "witchHat"
  | "eyeball"
  | "slime";

interface ScaryParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: ScaryType;
  opacity: number;
  // wobble for ghost float and bat flight flap
  phase: number;
}

interface ScaryAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

// Playful-spooky palette
const BONE = "#f4ede0";
const NIGHT = "#0f0f14";
const PURPLE = "#5b2a8a";
const BLOOD = "#8b0a1a";
const SLIME = "#7ad84a";
const PUMPKIN_ORANGE = "#ff7a18";
const STONE = "#9aa0a6";

// ---------- Inline SVG particle renderers ----------

function SkullSvg() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
      {/* Dome */}
      <path
        d="M20 4C11.7 4 6 9.6 6 16.6c0 4 1.9 6.7 4.2 8.4.6.4 1 1.1 1 1.9v2.4c0 1.4 1.2 2.6 2.6 2.6h.7v-3.3h2v3.3h3.2v-3.3h2v3.3h.7c1.4 0 2.6-1.2 2.6-2.6V27c0-.8.4-1.5 1-1.9 2.3-1.7 4.2-4.4 4.2-8.5C34 9.6 28.3 4 20 4Z"
        fill={BONE}
        stroke={NIGHT}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Eye sockets */}
      <ellipse cx="15" cy="17" rx="3.2" ry="3.8" fill={NIGHT} />
      <ellipse cx="25" cy="17" rx="3.2" ry="3.8" fill={NIGHT} />
      <circle cx="16.2" cy="16" r="0.7" fill={BONE} />
      <circle cx="26.2" cy="16" r="0.7" fill={BONE} />
      {/* Nose */}
      <path d="M20 20.5 18.5 23.5h3L20 20.5Z" fill={NIGHT} />
      {/* Teeth */}
      <path d="M14 26h12" stroke={NIGHT} strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M15.5 26v2.2M17.5 26v2.2M19.5 26v2.2M21.5 26v2.2M23.5 26v2.2"
        stroke={NIGHT}
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GhostSvg() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
      {/* Casper-style wavy body */}
      <path
        d="M5 32 8 28 11 32 14 28 17 32 20 28 23 32 26 28 29 32 32 28 35 32V16C35 8.8 28.3 4 20 4S5 8.8 5 16v16Z"
        fill={BONE}
        stroke={NIGHT}
        strokeWidth="1.2"
        strokeLinejoin="round"
        opacity="0.95"
      />
      {/* Dot eyes */}
      <circle cx="15" cy="16" r="2" fill={NIGHT} />
      <circle cx="25" cy="16" r="2" fill={NIGHT} />
      <circle cx="15.7" cy="15.3" r="0.6" fill={BONE} />
      <circle cx="25.7" cy="15.3" r="0.6" fill={BONE} />
      {/* Little O mouth */}
      <ellipse cx="20" cy="22" rx="1.8" ry="2.4" fill={NIGHT} />
      {/* Blush */}
      <circle cx="12" cy="22" r="1.4" fill={BLOOD} opacity="0.35" />
      <circle cx="28" cy="22" r="1.4" fill={BLOOD} opacity="0.35" />
    </svg>
  );
}

function BatSvg() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
      {/* Wings (V shape) */}
      <path
        d="M20 18C20 18 14 8 4 12c2 2 2 6 4 8 1.5 1.4 4 1.5 6 1.5"
        fill={NIGHT}
        stroke={NIGHT}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M20 18C20 18 26 8 36 12c-2 2-2 6-4 8-1.5 1.4-4 1.5-6 1.5"
        fill={NIGHT}
        stroke={NIGHT}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Body */}
      <ellipse cx="20" cy="20" rx="4" ry="5" fill={NIGHT} />
      {/* Ears */}
      <path d="M17 16L16 12L19 15Z" fill={NIGHT} />
      <path d="M23 16L24 12L21 15Z" fill={NIGHT} />
      {/* Eyes (cute red dots) */}
      <circle cx="18.5" cy="20" r="0.9" fill={BLOOD} />
      <circle cx="21.5" cy="20" r="0.9" fill={BLOOD} />
      {/* Fang grin */}
      <path d="M19 23l1 1.5 1-1.5" stroke={BONE} strokeWidth="0.7" fill="none" />
    </svg>
  );
}

function SpiderSvg() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
      {/* 8 legs */}
      <g stroke={NIGHT} strokeWidth="1.6" strokeLinecap="round" fill="none">
        <path d="M16 18L6 12" />
        <path d="M15 21L4 21" />
        <path d="M16 24L6 30" />
        <path d="M17 26L13 34" />
        <path d="M24 18L34 12" />
        <path d="M25 21L36 21" />
        <path d="M24 24L34 30" />
        <path d="M23 26L27 34" />
      </g>
      {/* Body */}
      <ellipse cx="20" cy="22" rx="6" ry="5" fill={NIGHT} />
      {/* Head */}
      <circle cx="20" cy="16" r="4" fill={NIGHT} />
      {/* Big cartoon eyes */}
      <circle cx="18" cy="15" r="1.6" fill={BONE} />
      <circle cx="22" cy="15" r="1.6" fill={BONE} />
      <circle cx="18" cy="15.4" r="0.8" fill={NIGHT} />
      <circle cx="22" cy="15.4" r="0.8" fill={NIGHT} />
      {/* Tiny smile */}
      <path d="M18 18 Q20 19.5 22 18" stroke={BLOOD} strokeWidth="0.7" fill="none" />
    </svg>
  );
}

function PumpkinSvg() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
      {/* Stem */}
      <path d="M19 4 Q21 6 20 9 Q22 8 23 10" stroke="#3a5a1a" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Pumpkin body — three lobes */}
      <ellipse cx="12" cy="22" rx="6" ry="11" fill={PUMPKIN_ORANGE} stroke={NIGHT} strokeWidth="1.2" />
      <ellipse cx="28" cy="22" rx="6" ry="11" fill={PUMPKIN_ORANGE} stroke={NIGHT} strokeWidth="1.2" />
      <ellipse cx="20" cy="22" rx="10" ry="12" fill={PUMPKIN_ORANGE} stroke={NIGHT} strokeWidth="1.4" />
      {/* Ridge highlights */}
      <path d="M15 14C14 18 14 26 15 30" stroke="#c45a10" strokeWidth="0.8" fill="none" />
      <path d="M25 14C26 18 26 26 25 30" stroke="#c45a10" strokeWidth="0.8" fill="none" />
      {/* Triangle eyes */}
      <polygon points="14,19 18,19 16,22.5" fill={NIGHT} />
      <polygon points="22,19 26,19 24,22.5" fill={NIGHT} />
      {/* Zigzag mouth */}
      <path
        d="M13 27 L15 26 L16.5 28 L18 26 L19.5 28 L21 26 L22.5 28 L24 26 L25.5 28 L27 26"
        stroke={NIGHT}
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GravestoneSvg() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
      {/* Ground */}
      <ellipse cx="20" cy="35" rx="14" ry="2" fill="#3a3a1a" opacity="0.6" />
      {/* Stone */}
      <path
        d="M10 34V16C10 10 14 6 20 6s10 4 10 10v18H10Z"
        fill={STONE}
        stroke={NIGHT}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Shadow stripe */}
      <path d="M12 16C12 10.8 15.5 8 20 8" stroke={BONE} strokeWidth="1" fill="none" opacity="0.6" />
      {/* RIP */}
      <text
        x="20"
        y="22"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="8"
        fill={NIGHT}
      >
        RIP
      </text>
      {/* Crack */}
      <path d="M22 24 L24 28 L22 30 L25 33" stroke={NIGHT} strokeWidth="0.8" fill="none" />
    </svg>
  );
}

function WitchHatSvg() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
      {/* Brim */}
      <ellipse cx="20" cy="29" rx="16" ry="3.5" fill={NIGHT} stroke={NIGHT} strokeWidth="1" />
      {/* Cone */}
      <path
        d="M22 4 L13 28 H28 L22 4Z"
        fill={NIGHT}
        stroke={NIGHT}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Hat band */}
      <path d="M14.5 25 H27" stroke={PURPLE} strokeWidth="2.4" strokeLinecap="round" />
      {/* Buckle */}
      <rect x="19" y="23.5" width="3" height="3" fill={BONE} stroke={NIGHT} strokeWidth="0.6" />
      {/* Star sparkle */}
      <path
        d="M8 14 L8.6 15.4 L10 16 L8.6 16.6 L8 18 L7.4 16.6 L6 16 L7.4 15.4 Z"
        fill={SLIME}
      />
    </svg>
  );
}

function EyeballSvg() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
      {/* White */}
      <circle cx="20" cy="20" r="13" fill={BONE} stroke={NIGHT} strokeWidth="1.2" />
      {/* Bloodshot veins */}
      <path d="M9 18 Q14 19 17 17" stroke={BLOOD} strokeWidth="0.6" fill="none" />
      <path d="M31 22 Q26 21 23 23" stroke={BLOOD} strokeWidth="0.6" fill="none" />
      <path d="M11 26 Q15 24 18 25" stroke={BLOOD} strokeWidth="0.6" fill="none" />
      <path d="M28 13 Q24 15 22 14" stroke={BLOOD} strokeWidth="0.6" fill="none" />
      {/* Iris */}
      <circle cx="20" cy="20" r="6" fill={SLIME} />
      {/* Pupil */}
      <circle cx="20" cy="20" r="3" fill={NIGHT} />
      {/* Highlight */}
      <circle cx="18" cy="18" r="1.2" fill={BONE} />
    </svg>
  );
}

function SlimeSvg() {
  return (
    <svg viewBox="0 0 40 40" fill="none" className="w-full h-full">
      {/* Drippy blob */}
      <path
        d="M8 8 H32 V18 Q32 22 28 22 Q28 28 24 28 Q24 34 20 34 Q20 28 16 28 Q12 28 12 22 Q8 22 8 18 Z"
        fill={SLIME}
        stroke={NIGHT}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Highlights */}
      <ellipse cx="14" cy="13" rx="3" ry="1.4" fill={BONE} opacity="0.7" />
      <ellipse cx="26" cy="14" rx="1.6" ry="0.8" fill={BONE} opacity="0.5" />
      {/* Cute face */}
      <circle cx="17" cy="18" r="1.2" fill={NIGHT} />
      <circle cx="23" cy="18" r="1.2" fill={NIGHT} />
      <path d="M17 22 Q20 24.5 23 22" stroke={NIGHT} strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function ParticleSvg({ type }: { type: ScaryType }) {
  switch (type) {
    case "skull":
      return <SkullSvg />;
    case "ghost":
      return <GhostSvg />;
    case "bat":
      return <BatSvg />;
    case "spider":
      return <SpiderSvg />;
    case "pumpkin":
      return <PumpkinSvg />;
    case "gravestone":
      return <GravestoneSvg />;
    case "witchHat":
      return <WitchHatSvg />;
    case "eyeball":
      return <EyeballSvg />;
    case "slime":
      return <SlimeSvg />;
  }
}

// ---------- Particle factory ----------

interface SpawnConfig {
  type: ScaryType;
  count: number;
  minSpeed: number;
  maxSpeed: number;
  minScale: number;
  maxScale: number;
  upwardBias: number; // subtracted from velocityY at spawn (more = floatier)
  spinRange: number;
}

const SPAWN_PLAN: SpawnConfig[] = [
  { type: "skull", count: 5, minSpeed: 4, maxSpeed: 9, minScale: 0.6, maxScale: 1.1, upwardBias: 4, spinRange: 10 },
  { type: "ghost", count: 5, minSpeed: 2, maxSpeed: 4, minScale: 0.7, maxScale: 1.1, upwardBias: 5, spinRange: 1.5 },
  { type: "bat", count: 7, minSpeed: 5, maxSpeed: 9, minScale: 0.5, maxScale: 0.9, upwardBias: 3, spinRange: 6 },
  { type: "spider", count: 4, minSpeed: 3, maxSpeed: 6, minScale: 0.5, maxScale: 0.8, upwardBias: 2, spinRange: 12 },
  { type: "pumpkin", count: 4, minSpeed: 3, maxSpeed: 7, minScale: 0.7, maxScale: 1.2, upwardBias: 4, spinRange: 6 },
  { type: "gravestone", count: 2, minSpeed: 2, maxSpeed: 4, minScale: 0.8, maxScale: 1.2, upwardBias: 3, spinRange: 3 },
  { type: "witchHat", count: 3, minSpeed: 3, maxSpeed: 6, minScale: 0.7, maxScale: 1.1, upwardBias: 4, spinRange: 8 },
  { type: "eyeball", count: 6, minSpeed: 3, maxSpeed: 7, minScale: 0.4, maxScale: 0.8, upwardBias: 2, spinRange: 0 },
  { type: "slime", count: 4, minSpeed: 3, maxSpeed: 5, minScale: 0.6, maxScale: 1.0, upwardBias: 3, spinRange: 4 },
];

export default function ScaryAnimation({ x, y, onComplete }: ScaryAnimationProps) {
  const [particles, setParticles] = useState<ScaryParticle[]>([]);
  const [fog, setFog] = useState<{ id: number; x: number; y: number; opacity: number; scale: number }[]>([]);
  const [flashOpacity, setFlashOpacity] = useState(0.5);

  const createParticles = useCallback(() => {
    const out: ScaryParticle[] = [];
    let nextId = 0;
    for (const plan of SPAWN_PLAN) {
      for (let i = 0; i < plan.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = plan.minSpeed + Math.random() * (plan.maxSpeed - plan.minSpeed);
        const scale = plan.minScale + Math.random() * (plan.maxScale - plan.minScale);
        out.push({
          id: nextId++,
          x: x + (Math.random() - 0.5) * 70,
          y: y + (Math.random() - 0.5) * 70,
          rotation: plan.type === "gravestone" || plan.type === "pumpkin" ? Math.random() * 30 - 15 : Math.random() * 360,
          scale,
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - plan.upwardBias,
          rotationSpeed: (Math.random() - 0.5) * plan.spinRange,
          type: plan.type,
          opacity: 1,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    return out;
  }, [x, y]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init of mount-time random particles, then setInterval drives animation
    setParticles(createParticles());

    // Create creepy fog
    const newFog: { id: number; x: number; y: number; opacity: number; scale: number }[] = [];
    for (let i = 0; i < 18; i++) {
      newFog.push({
        id: i,
        x: x + (Math.random() - 0.5) * 240,
        y: y + (Math.random() - 0.5) * 240,
        opacity: 0.45,
        scale: 1 + Math.random() * 2.2,
      });
    }
    setFog(newFog);

    // Animate
    const interval = setInterval(() => {
      setParticles(prev =>
        prev
          .map(p => {
            // Ghosts float (low gravity, sin sway). Bats wobble (flap). Eyeballs roll slightly.
            const gravity = p.type === "ghost" ? 0.02 : p.type === "bat" ? 0.05 : p.type === "slime" ? 0.18 : 0.12;
            const sway = p.type === "ghost" ? Math.sin(p.phase) * 1.4 : p.type === "bat" ? Math.sin(p.phase * 2) * 0.8 : 0;
            return {
              ...p,
              x: p.x + p.velocityX + sway,
              y: p.y + p.velocityY + 0.3,
              velocityY: p.velocityY + gravity,
              rotation: p.rotation + p.rotationSpeed,
              opacity: Math.max(0, p.opacity - 0.011),
              phase: p.phase + 0.18,
            };
          })
          .filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );

      setFog(prev =>
        prev
          .map(f => ({
            ...f,
            x: f.x + (Math.random() - 0.5) * 2,
            opacity: Math.max(0, f.opacity - 0.005),
          }))
          .filter(f => f.opacity > 0)
      );

      setFlashOpacity(prev => Math.max(0, prev - 0.03));
    }, 30);

    // Clean up after animation
    const timeout = setTimeout(() => {
      clearInterval(interval);
      onComplete();
    }, 3000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [createParticles, onComplete, x, y]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Dark purple flash */}
      <div
        className="fixed inset-0"
        style={{ opacity: flashOpacity, background: `radial-gradient(circle at ${x}px ${y}px, ${PURPLE}, ${NIGHT} 70%)` }}
      />

      {/* Fog */}
      {fog.map(f => (
        <div
          key={`fog-${f.id}`}
          className="absolute rounded-full"
          style={{
            left: f.x,
            top: f.y,
            width: 110 * f.scale,
            height: 70 * f.scale,
            background: "radial-gradient(ellipse, rgba(70,40,90,0.55) 0%, transparent 70%)",
            opacity: f.opacity,
          }}
        />
      ))}

      {/* SVG particles */}
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: p.x,
            top: p.y,
            transform: `rotate(${p.rotation}deg) scale(${p.scale})`,
            opacity: p.opacity,
            width: 40,
            height: 40,
          }}
        >
          <ParticleSvg type={p.type} />
        </div>
      ))}
    </div>
  );
}
