"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type PlantType =
  | "tulip"
  | "daisy"
  | "sunflower"
  | "cherryBlossom"
  | "oakLeaf"
  | "mapleLeaf"
  | "ovalLeaf"
  | "seedling"
  | "vine"
  | "dandelionPuff"
  | "dandelionSeed"
  | "butterfly"
  | "pollen";

interface PlantParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: PlantType;
  opacity: number;
  color: string;
  accent: string;
  size: number;
  swayPhase: number;
  swayAmplitude: number;
}

interface PlantsAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

// Soft pastel petal palette — daisies, cherry blossom, tulips
const PETAL_COLORS = [
  "#f8a5c2", // soft pink
  "#fbc4d8", // cherry blossom
  "#fde2e4", // pale rose
  "#fff5b1", // pale daisy yellow
  "#e6c8ff", // lavender
  "#fef3c7", // cream
  "#ffd6a5", // peach
  "#ffffff", // white daisy
];

// Multiple greens for leaves and stems
const LEAF_GREENS = [
  "#10ac84", // emerald
  "#0f8a5f", // deep emerald
  "#3ec98a", // sage mint
  "#65d6a4", // soft fern
  "#218c5f", // forest
  "#7ad99f", // light spring green
];

const LEAF_VEIN = "#0d6e4d";

interface SparkleData {
  id: number;
  x: number;
  y: number;
  opacity: number;
  scale: number;
  color: string;
  vx: number;
  vy: number;
}

export default function PlantsAnimation({ x, y, onComplete }: PlantsAnimationProps) {
  const [particles, setParticles] = useState<PlantParticle[]>([]);
  const [sparkles, setSparkles] = useState<SparkleData[]>([]);
  const [tick, setTick] = useState(0);

  const createParticles = useCallback(() => {
    const newParticles: PlantParticle[] = [];
    let nextId = 0;

    const pushBurst = (
      type: PlantType,
      count: number,
      opts: {
        spread?: number;
        speedMin?: number;
        speedMax?: number;
        upBias?: number;
        scaleMin?: number;
        scaleMax?: number;
        rotSpeed?: number;
        color?: () => string;
        accent?: () => string;
        size?: number;
        sway?: number;
      } = {},
    ) => {
      const {
        spread = 60,
        speedMin = 3,
        speedMax = 8,
        upBias = 4,
        scaleMin = 0.5,
        scaleMax = 0.95,
        rotSpeed = 6,
        color = () => PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
        accent = () => LEAF_GREENS[Math.floor(Math.random() * LEAF_GREENS.length)],
        size = 40,
        sway = 0,
      } = opts;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = speedMin + Math.random() * (speedMax - speedMin);
        newParticles.push({
          id: nextId++,
          x: x + (Math.random() - 0.5) * spread,
          y: y + (Math.random() - 0.5) * spread,
          rotation: Math.random() * 360,
          scale: scaleMin + Math.random() * (scaleMax - scaleMin),
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - upBias,
          rotationSpeed: (Math.random() - 0.5) * rotSpeed,
          type,
          opacity: 1,
          color: color(),
          accent: accent(),
          size,
          swayPhase: Math.random() * Math.PI * 2,
          swayAmplitude: sway,
        });
      }
    };

    // Flowers
    pushBurst("tulip", 5, { upBias: 5, size: 42 });
    pushBurst("daisy", 6, { upBias: 4, size: 44, rotSpeed: 4 });
    pushBurst("sunflower", 3, { upBias: 5, size: 50, scaleMin: 0.6, scaleMax: 1.0, color: () => "#fcd34d" });
    pushBurst("cherryBlossom", 7, { upBias: 3, size: 36, scaleMin: 0.45, scaleMax: 0.85, rotSpeed: 8, sway: 0.6, color: () => (Math.random() < 0.5 ? "#fbc4d8" : "#fde2e4") });

    // Leaves
    pushBurst("oakLeaf", 5, { upBias: 3, size: 38, rotSpeed: 7, sway: 0.5, color: () => LEAF_GREENS[Math.floor(Math.random() * LEAF_GREENS.length)] });
    pushBurst("mapleLeaf", 5, { upBias: 3, size: 40, rotSpeed: 8, sway: 0.7, color: () => LEAF_GREENS[Math.floor(Math.random() * LEAF_GREENS.length)] });
    pushBurst("ovalLeaf", 6, { upBias: 2, size: 32, rotSpeed: 6, sway: 0.5, color: () => LEAF_GREENS[Math.floor(Math.random() * LEAF_GREENS.length)] });

    // Seedlings + vines (slower, drift)
    pushBurst("seedling", 3, { upBias: 4, size: 44, scaleMin: 0.7, scaleMax: 1.0, rotSpeed: 2 });
    pushBurst("vine", 3, { upBias: 3, size: 50, scaleMin: 0.6, scaleMax: 1.0, rotSpeed: 4 });

    // Dandelion fluff (light, floaty)
    pushBurst("dandelionPuff", 4, { upBias: 1, size: 36, speedMin: 1, speedMax: 3, rotSpeed: 2, sway: 1.4, color: () => "#ffffff" });
    pushBurst("dandelionSeed", 10, { upBias: 0, size: 22, speedMin: 1, speedMax: 3, rotSpeed: 5, sway: 1.8, color: () => "#f5f5f5" });

    // Butterflies (flutter across)
    pushBurst("butterfly", 3, { upBias: 2, size: 38, speedMin: 2, speedMax: 5, rotSpeed: 3, sway: 1.2, color: () => PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)] });

    // Pollen dots
    pushBurst("pollen", 14, { upBias: 1, size: 12, speedMin: 1, speedMax: 4, rotSpeed: 3, sway: 1.0, color: () => (Math.random() < 0.5 ? "#fcd34d" : "#fef3c7") });

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
    setParticles(createParticles());

    // Sparkle dots (small green/yellow flecks instead of emoji)
    const newSparkles: SparkleData[] = [];
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 1.4;
      newSparkles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 160,
        y: y + (Math.random() - 0.5) * 160,
        opacity: 1,
        scale: 0.5 + Math.random() * 0.8,
        color: Math.random() < 0.5 ? "#fcd34d" : "#7ad99f",
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
      });
    }
    setSparkles(newSparkles);

    const interval = setInterval(() => {
      setTick(t => t + 1);
      setParticles(prev =>
        prev.map(p => {
          // Sway sideways for floaty things (petals, leaves, dandelion fluff)
          const swayDx = p.swayAmplitude
            ? Math.sin(p.swayPhase + p.y * 0.02) * p.swayAmplitude
            : 0;
          return {
            ...p,
            x: p.x + p.velocityX + swayDx,
            y: p.y + p.velocityY + 0.3,
            velocityY: p.velocityY + (p.type === "dandelionSeed" || p.type === "dandelionPuff" || p.type === "pollen" ? 0.04 : 0.11),
            rotation: p.rotation + p.rotationSpeed,
            swayPhase: p.swayPhase + 0.12,
            opacity: Math.max(0, p.opacity - 0.008),
          };
        }).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0),
      );

      setSparkles(prev =>
        prev.map(s => ({
          ...s,
          x: s.x + s.vx,
          y: s.y + s.vy,
          vy: s.vy + 0.04,
          opacity: Math.max(0, s.opacity - 0.02),
        })).filter(s => s.opacity > 0),
      );
    }, 30);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      onCompleteRef.current();
    }, 3500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
    // onComplete is read via the ref above, so it is intentionally NOT a dep
    // here (that re-run was the mid-animation double-fire). Keep createParticles
    // and x/y, which are stable for a given celebration instance.
  }, [createParticles, x, y]);

  // Suppress unused-var lint for tick — re-rendering keeps sway transforms in sync
  void tick;

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Pollen-spark flecks */}
      {sparkles.map(s => (
        <div
          key={`sparkle-${s.id}`}
          className="absolute"
          style={{
            left: s.x,
            top: s.y,
            opacity: s.opacity,
            transform: `scale(${s.scale})`,
            width: 8,
            height: 8,
          }}
        >
          <svg viewBox="0 0 8 8" className="w-full h-full">
            <circle cx="4" cy="4" r="2" fill={s.color} />
            <circle cx="4" cy="4" r="3.5" fill={s.color} opacity="0.25" />
          </svg>
        </div>
      ))}

      {/* SVG plant particles */}
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: p.x,
            top: p.y,
            transform: `rotate(${p.rotation}deg) scale(${p.scale})`,
            opacity: p.opacity,
            width: p.size,
            height: p.size,
          }}
        >
          {renderParticle(p)}
        </div>
      ))}
    </div>
  );
}

function renderParticle(p: PlantParticle) {
  switch (p.type) {
    case "tulip":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* Cup: three curved petals meeting at base */}
          <path
            d="M12 3 C8.5 5 7.5 9 8 12 C9 11 10.5 10.5 12 10.5 C13.5 10.5 15 11 16 12 C16.5 9 15.5 5 12 3 Z"
            fill={p.color}
          />
          <path
            d="M12 3 C11 6 11 9 12 12"
            stroke="#d97aa3"
            strokeWidth="0.6"
            opacity="0.5"
            fill="none"
          />
          {/* Stem */}
          <path d="M12 12 V21" stroke={p.accent} strokeWidth="1.6" strokeLinecap="round" />
          {/* Single leaf along stem */}
          <path
            d="M12 17 C9 16 7.5 17.5 7 19 C8.5 19.2 10.5 18.8 12 17.5 Z"
            fill={p.accent}
          />
        </svg>
      );

    case "daisy":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* 8 white/pastel petals */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => (
            <ellipse
              key={angle}
              cx="12"
              cy="12"
              rx="2.6"
              ry="5"
              fill={p.color}
              transform={`rotate(${angle} 12 12) translate(0 -5)`}
            />
          ))}
          {/* Yellow center */}
          <circle cx="12" cy="12" r="3" fill="#fcd34d" />
          <circle cx="11" cy="11" r="0.5" fill="#b8860b" opacity="0.6" />
          <circle cx="13" cy="12" r="0.4" fill="#b8860b" opacity="0.6" />
          <circle cx="12" cy="13" r="0.4" fill="#b8860b" opacity="0.6" />
        </svg>
      );

    case "sunflower":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* 12 petals, two layers for depth */}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(angle => (
            <ellipse
              key={`o-${angle}`}
              cx="12"
              cy="12"
              rx="2.4"
              ry="5.2"
              fill="#fcd34d"
              transform={`rotate(${angle} 12 12) translate(0 -6)`}
            />
          ))}
          {[15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345].map(angle => (
            <ellipse
              key={`i-${angle}`}
              cx="12"
              cy="12"
              rx="1.8"
              ry="4"
              fill="#f59e0b"
              transform={`rotate(${angle} 12 12) translate(0 -5)`}
            />
          ))}
          {/* Brown seed center with stippled dots */}
          <circle cx="12" cy="12" r="3.8" fill="#6b3410" />
          <circle cx="12" cy="12" r="3.8" fill="#8B4513" opacity="0.6" />
          {[[11, 11], [13, 11], [12, 13], [10.5, 12.5], [13.5, 12.5], [12, 10.5]].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="0.4" fill="#3a1a05" />
          ))}
        </svg>
      );

    case "cherryBlossom":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* 5 heart-notched petals */}
          {[0, 72, 144, 216, 288].map(angle => (
            <g key={angle} transform={`rotate(${angle} 12 12)`}>
              <path
                d="M12 12 C10.5 9 10.5 6.5 12 4.5 C13.5 6.5 13.5 9 12 12 Z"
                fill={p.color}
              />
              <path
                d="M11.4 5.5 C11.7 5 12.3 5 12.6 5.5"
                stroke="#d97aa3"
                strokeWidth="0.4"
                fill="none"
                opacity="0.7"
              />
            </g>
          ))}
          {/* Center stamen */}
          <circle cx="12" cy="12" r="1.5" fill="#fcd34d" />
          {[0, 60, 120, 180, 240, 300].map(angle => (
            <circle
              key={angle}
              cx="12"
              cy="11"
              r="0.4"
              fill="#f59e0b"
              transform={`rotate(${angle} 12 12)`}
            />
          ))}
        </svg>
      );

    case "oakLeaf":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* Lobed oak leaf */}
          <path
            d="M12 2
               C 10 4, 8 4, 7 5
               C 8 6, 8 7, 7 8
               C 8 9, 8 10, 6 11
               C 7 12, 8 13, 7 14
               C 9 14.5, 10 16, 12 17
               C 14 16, 15 14.5, 17 14
               C 16 13, 17 12, 18 11
               C 16 10, 16 9, 17 8
               C 16 7, 16 6, 17 5
               C 16 4, 14 4, 12 2 Z"
            fill={p.color}
          />
          <path d="M12 2 V17" stroke={LEAF_VEIN} strokeWidth="0.6" />
          <path d="M12 6 L9 7 M12 6 L15 7" stroke={LEAF_VEIN} strokeWidth="0.4" fill="none" />
          <path d="M12 10 L8.5 11 M12 10 L15.5 11" stroke={LEAF_VEIN} strokeWidth="0.4" fill="none" />
          <path d="M12 14 L10 14.5 M12 14 L14 14.5" stroke={LEAF_VEIN} strokeWidth="0.4" fill="none" />
          {/* Stem */}
          <path d="M12 17 V21" stroke={LEAF_VEIN} strokeWidth="0.8" strokeLinecap="round" />
        </svg>
      );

    case "mapleLeaf":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* Maple star: 5-point spiky lobed leaf */}
          <path
            d="M12 2
               L13.5 7
               L18 5.5
               L15.5 10
               L20 12
               L15 13.5
               L17 18
               L12.5 16
               L12 21
               L11.5 16
               L7 18
               L9 13.5
               L4 12
               L8.5 10
               L6 5.5
               L10.5 7
               Z"
            fill={p.color}
          />
          <path d="M12 2 V21" stroke={LEAF_VEIN} strokeWidth="0.6" />
          <path d="M12 11 L17 5.5 M12 11 L7 5.5 M12 11 L4 12 M12 11 L20 12" stroke={LEAF_VEIN} strokeWidth="0.4" fill="none" opacity="0.7" />
        </svg>
      );

    case "ovalLeaf":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          <path
            d="M12 3 C7 6 6 11 7 17 C8 20 10 21 12 21 C14 21 16 20 17 17 C18 11 17 6 12 3 Z"
            fill={p.color}
          />
          <path d="M12 4 V21" stroke={LEAF_VEIN} strokeWidth="0.6" />
          <path d="M12 8 C10 9 9 11 9 13" stroke={LEAF_VEIN} strokeWidth="0.4" fill="none" opacity="0.7" />
          <path d="M12 8 C14 9 15 11 15 13" stroke={LEAF_VEIN} strokeWidth="0.4" fill="none" opacity="0.7" />
          <path d="M12 13 C10.5 14 9.5 15.5 9.5 17" stroke={LEAF_VEIN} strokeWidth="0.4" fill="none" opacity="0.7" />
          <path d="M12 13 C13.5 14 14.5 15.5 14.5 17" stroke={LEAF_VEIN} strokeWidth="0.4" fill="none" opacity="0.7" />
        </svg>
      );

    case "seedling":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* Soil mound */}
          <ellipse cx="12" cy="21" rx="7" ry="1.6" fill="#6b3410" />
          <ellipse cx="12" cy="20.7" rx="6" ry="1.2" fill="#8B5A2B" />
          {/* Stem */}
          <path d="M12 20 V12" stroke={p.accent} strokeWidth="1.6" strokeLinecap="round" />
          {/* Left cotyledon leaf */}
          <path
            d="M12 14 C8.5 13.6 6.5 11.5 6.4 8.8 C9.4 8.7 11.6 10.6 12 13.5 Z"
            fill={p.accent}
          />
          {/* Right cotyledon leaf */}
          <path
            d="M12 12 C15.5 11.5 17.6 9.3 17.6 6.6 C14.6 6.5 12.4 8.4 12 11.5 Z"
            fill={LEAF_GREENS[2]}
          />
          {/* Tiny pollen sparkle on top */}
          <circle cx="12" cy="6" r="0.6" fill="#fcd34d" />
        </svg>
      );

    case "vine":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* Curling vine */}
          <path
            d="M3 21 C 6 16, 4 13, 8 10 C 12 7, 10 5, 14 4 C 18 3, 19 6, 21 4"
            stroke={p.accent}
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
          />
          {/* Small leaves along vine */}
          <path d="M6 17 C4 16 3 17 3.5 18.5 C5 18.5 6 18 6.2 17 Z" fill={p.accent} />
          <path d="M9 12 C7.5 11.5 6.5 12.5 7 14 C8.5 14 9.4 13.2 9.2 12 Z" fill={LEAF_GREENS[3]} />
          <path d="M13 7 C14.5 6.5 15.5 7.2 15.2 8.6 C14 8.7 13 8.1 13 7 Z" fill={p.accent} />
          <path d="M17 4.6 C18.5 4 19.5 4.7 19.2 6 C18 6.1 17 5.5 17 4.6 Z" fill={LEAF_GREENS[3]} />
          {/* Curl tip */}
          <circle cx="21" cy="4" r="0.8" fill={p.accent} />
        </svg>
      );

    case "dandelionPuff": {
      // Cluster of seed wisps radiating from center
      const seeds = Array.from({ length: 14 }, (_, i) => (i * 360) / 14);
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          <circle cx="12" cy="12" r="1.4" fill="#9ca3af" opacity="0.7" />
          {seeds.map(angle => (
            <g key={angle} transform={`rotate(${angle} 12 12)`}>
              <line x1="12" y1="11" x2="12" y2="4" stroke="#e5e7eb" strokeWidth="0.5" />
              <g transform="translate(12 4)">
                <line x1="0" y1="0" x2="-1.5" y2="-1.5" stroke="#ffffff" strokeWidth="0.4" />
                <line x1="0" y1="0" x2="1.5" y2="-1.5" stroke="#ffffff" strokeWidth="0.4" />
                <line x1="0" y1="0" x2="0" y2="-2" stroke="#ffffff" strokeWidth="0.4" />
                <line x1="0" y1="0" x2="-1" y2="-2" stroke="#ffffff" strokeWidth="0.3" />
                <line x1="0" y1="0" x2="1" y2="-2" stroke="#ffffff" strokeWidth="0.3" />
              </g>
            </g>
          ))}
        </svg>
      );
    }

    case "dandelionSeed":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* Single seed with fluffy parachute */}
          <ellipse cx="12" cy="20" rx="0.6" ry="1.8" fill="#8B5A2B" />
          <line x1="12" y1="18" x2="12" y2="10" stroke="#cbd5e1" strokeWidth="0.5" />
          <g transform="translate(12 10)">
            <line x1="0" y1="0" x2="-3" y2="-3" stroke="#ffffff" strokeWidth="0.6" strokeLinecap="round" />
            <line x1="0" y1="0" x2="3" y2="-3" stroke="#ffffff" strokeWidth="0.6" strokeLinecap="round" />
            <line x1="0" y1="0" x2="-2" y2="-4" stroke="#ffffff" strokeWidth="0.5" strokeLinecap="round" />
            <line x1="0" y1="0" x2="2" y2="-4" stroke="#ffffff" strokeWidth="0.5" strokeLinecap="round" />
            <line x1="0" y1="0" x2="0" y2="-4.5" stroke="#ffffff" strokeWidth="0.5" strokeLinecap="round" />
            <line x1="0" y1="0" x2="-3.5" y2="-1.5" stroke="#ffffff" strokeWidth="0.4" strokeLinecap="round" />
            <line x1="0" y1="0" x2="3.5" y2="-1.5" stroke="#ffffff" strokeWidth="0.4" strokeLinecap="round" />
          </g>
        </svg>
      );

    case "butterfly":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* Body */}
          <ellipse cx="12" cy="12" rx="0.7" ry="4" fill="#3a1a05" />
          <circle cx="12" cy="8.5" r="0.8" fill="#3a1a05" />
          {/* Antennae */}
          <path d="M11.5 8 C11 6 10 5.5 9.5 5" stroke="#3a1a05" strokeWidth="0.4" fill="none" strokeLinecap="round" />
          <path d="M12.5 8 C13 6 14 5.5 14.5 5" stroke="#3a1a05" strokeWidth="0.4" fill="none" strokeLinecap="round" />
          {/* Left upper wing */}
          <path
            d="M11.5 10 C7 7 3 9 4 13 C6 13 9 12 11.5 11 Z"
            fill={p.color}
            stroke="#3a1a05"
            strokeWidth="0.4"
          />
          {/* Left lower wing */}
          <path
            d="M11.5 13 C8 14 5 15 5 17 C7 18 10 16.5 11.5 14.5 Z"
            fill={p.accent}
            stroke="#3a1a05"
            strokeWidth="0.4"
            opacity="0.85"
          />
          {/* Right upper wing */}
          <path
            d="M12.5 10 C17 7 21 9 20 13 C18 13 15 12 12.5 11 Z"
            fill={p.color}
            stroke="#3a1a05"
            strokeWidth="0.4"
          />
          {/* Right lower wing */}
          <path
            d="M12.5 13 C16 14 19 15 19 17 C17 18 14 16.5 12.5 14.5 Z"
            fill={p.accent}
            stroke="#3a1a05"
            strokeWidth="0.4"
            opacity="0.85"
          />
          {/* Wing spots */}
          <circle cx="7" cy="11" r="0.7" fill="#ffffff" opacity="0.85" />
          <circle cx="17" cy="11" r="0.7" fill="#ffffff" opacity="0.85" />
        </svg>
      );

    case "pollen":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          <circle cx="12" cy="12" r="4" fill={p.color} opacity="0.4" />
          <circle cx="12" cy="12" r="2.5" fill={p.color} />
          <circle cx="11" cy="11" r="0.6" fill="#ffffff" opacity="0.7" />
        </svg>
      );

    default:
      return null;
  }
}
