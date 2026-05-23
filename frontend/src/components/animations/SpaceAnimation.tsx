"use client";

import { useEffect, useState, useCallback } from "react";

type SpaceParticleType =
  | "star"
  | "planet"
  | "rocket"
  | "alien"
  | "ufo"
  | "meteor"
  | "satellite"
  | "comet"
  | "astronaut"
  | "sparkle";

interface SpaceParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: SpaceParticleType;
  opacity: number;
  color: string;
  planetVariant: number; // which planet skin (Mars/Saturn/Neptune/etc)
}

interface SpaceAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const PLANET_VARIANTS = [
  { base: "#ff6b6b", accent: "#7f1d1d", ring: false, name: "mars" },
  { base: "#feca57", accent: "#92400e", ring: true, name: "saturn" },
  { base: "#48dbfb", accent: "#1e3a8a", ring: false, name: "neptune" },
  { base: "#ff9ff3", accent: "#9d174d", ring: false, name: "venus" },
  { base: "#a78bfa", accent: "#4c1d95", ring: true, name: "uranus" },
  { base: "#5eead4", accent: "#0f766e", ring: false, name: "teal-world" },
];

const STAR_COLORS = ["#fde047", "#fef3c7", "#a5f3fc", "#f0abfc", "#ffffff"];

export default function SpaceAnimation({ x, y, onComplete }: SpaceAnimationProps) {
  const [particles, setParticles] = useState<SpaceParticle[]>([]);
  const [shockwave, setShockwave] = useState({ scale: 0, opacity: 0.85 });
  const [innerWave, setInnerWave] = useState({ scale: 0, opacity: 1 });
  const [starfield, setStarfield] = useState<
    { id: number; x: number; y: number; size: number; opacity: number; color: string }[]
  >([]);

  const createParticles = useCallback(() => {
    const newParticles: SpaceParticle[] = [];
    let nextId = 0;

    const pushParticle = (
      type: SpaceParticleType,
      count: number,
      opts: {
        spread: number;
        speed: [number, number];
        scale: [number, number];
        upBias?: number;
        rotSpeed?: number;
        rotation?: () => number;
        color?: () => string;
      }
    ) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = opts.speed[0] + Math.random() * (opts.speed[1] - opts.speed[0]);
        const upBias = opts.upBias ?? 4;
        newParticles.push({
          id: nextId++,
          x: x + (Math.random() - 0.5) * opts.spread,
          y: y + (Math.random() - 0.5) * opts.spread,
          rotation: opts.rotation ? opts.rotation() : Math.random() * 360,
          scale: opts.scale[0] + Math.random() * (opts.scale[1] - opts.scale[0]),
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - upBias,
          rotationSpeed: (Math.random() - 0.5) * (opts.rotSpeed ?? 8),
          type,
          opacity: 1,
          color: opts.color ? opts.color() : "#ffffff",
          planetVariant: Math.floor(Math.random() * PLANET_VARIANTS.length),
        });
      }
    };

    // Rockets — blast outward radially, point in direction of travel
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + Math.random() * 0.6;
      const speed = 11 + Math.random() * 8;
      newParticles.push({
        id: nextId++,
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 30,
        // rocket SVG points up — rotate so nose follows velocity
        rotation: (angle * 180) / Math.PI + 90,
        scale: 0.85 + Math.random() * 0.6,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 3,
        type: "rocket",
        opacity: 1,
        color: "#ef4444",
        planetVariant: 0,
      });
    }

    pushParticle("planet", 7, {
      spread: 80,
      speed: [3, 11],
      scale: [0.55, 1.2],
      upBias: 4,
      rotSpeed: 5,
    });

    pushParticle("ufo", 4, {
      spread: 60,
      speed: [5, 11],
      scale: [0.7, 1.1],
      upBias: 3,
      rotSpeed: 6,
      rotation: () => (Math.random() - 0.5) * 30, // UFOs stay mostly upright
    });

    pushParticle("alien", 5, {
      spread: 70,
      speed: [5, 11],
      scale: [0.6, 1.0],
      upBias: 4,
      rotSpeed: 10,
    });

    pushParticle("astronaut", 3, {
      spread: 55,
      speed: [4, 9],
      scale: [0.75, 1.15],
      upBias: 4,
      rotSpeed: 8,
    });

    pushParticle("comet", 5, {
      spread: 90,
      speed: [9, 16],
      scale: [0.6, 1.0],
      upBias: 5,
      rotSpeed: 0, // comets keep orientation matching velocity (set below)
    });
    // Re-orient last 5 comets so trail aligns with velocity
    for (let i = newParticles.length - 5; i < newParticles.length; i++) {
      const p = newParticles[i];
      p.rotation = (Math.atan2(p.velocityY, p.velocityX) * 180) / Math.PI;
    }

    pushParticle("meteor", 6, {
      spread: 85,
      speed: [8, 14],
      scale: [0.4, 0.7],
      upBias: 5,
      rotSpeed: 15,
      color: () => "#fb923c",
    });

    pushParticle("star", 14, {
      spread: 110,
      speed: [3, 9],
      scale: [0.35, 0.7],
      upBias: 2,
      rotSpeed: 18,
      color: () => STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
    });

    pushParticle("sparkle", 12, {
      spread: 120,
      speed: [2, 7],
      scale: [0.25, 0.55],
      upBias: 1,
      rotSpeed: 20,
      color: () => STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
    });

    pushParticle("satellite", 3, {
      spread: 50,
      speed: [4, 8],
      scale: [0.7, 1.0],
      upBias: 3,
      rotSpeed: 6,
    });

    return newParticles;
  }, [x, y]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init of mount-time random particles, then setInterval drives animation
    setParticles(createParticles());

    // Twinkling starfield background — denser, color-varied
    const stars: { id: number; x: number; y: number; size: number; opacity: number; color: string }[] = [];
    for (let i = 0; i < 70; i++) {
      stars.push({
        id: i,
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        size: Math.random() * 2.5 + 0.6,
        opacity: Math.random() * 0.85 + 0.15,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      });
    }
    setStarfield(stars);

    const interval = setInterval(() => {
      setParticles((prev) =>
        prev
          .map((p) => ({
            ...p,
            x: p.x + p.velocityX,
            y: p.y + p.velocityY + 0.5,
            velocityY: p.velocityY + 0.15,
            rotation: p.rotation + p.rotationSpeed,
            opacity: Math.max(0, p.opacity - 0.012),
          }))
          .filter((p) => p.y < window.innerHeight + 100 && p.opacity > 0)
      );

      setShockwave((prev) => ({
        scale: prev.scale + 22,
        opacity: Math.max(0, prev.opacity - 0.028),
      }));

      setInnerWave((prev) => ({
        scale: prev.scale + 14,
        opacity: Math.max(0, prev.opacity - 0.045),
      }));
    }, 25);

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
      {/* Deep-space tint overlay so the wonder reads */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at center, rgba(76,29,149,0.18) 0%, rgba(15,23,42,0.05) 60%, transparent 100%)",
        }}
      />

      {/* Twinkling starfield */}
      {starfield.map((star) => (
        <div
          key={`star-${star.id}`}
          className="absolute rounded-full"
          style={{
            left: star.x,
            top: star.y,
            width: star.size,
            height: star.size,
            opacity: star.opacity,
            background: star.color,
            boxShadow: `0 0 ${star.size * 3}px ${star.color}`,
          }}
        />
      ))}

      {/* Outer purple shockwave */}
      <div
        className="absolute rounded-full border-2"
        style={{
          left: x - shockwave.scale,
          top: y - shockwave.scale,
          width: shockwave.scale * 2,
          height: shockwave.scale * 2,
          opacity: shockwave.opacity,
          borderColor: "#a78bfa",
          boxShadow: "0 0 30px rgba(167,139,250,0.6)",
        }}
      />
      {/* Inner neon shockwave */}
      <div
        className="absolute rounded-full border"
        style={{
          left: x - innerWave.scale,
          top: y - innerWave.scale,
          width: innerWave.scale * 2,
          height: innerWave.scale * 2,
          opacity: innerWave.opacity,
          borderColor: "#22d3ee",
          boxShadow: "0 0 18px rgba(34,211,238,0.7)",
        }}
      />

      {/* Custom SVG Particles */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: p.x,
            top: p.y,
            transform: `rotate(${p.rotation}deg) scale(${p.scale})`,
            opacity: p.opacity,
            width: 48,
            height: 48,
          }}
        >
          {p.type === "rocket" && <RocketSvg id={p.id} />}
          {p.type === "planet" && <PlanetSvg id={p.id} variant={PLANET_VARIANTS[p.planetVariant]} />}
          {p.type === "ufo" && <UfoSvg id={p.id} />}
          {p.type === "alien" && <AlienSvg id={p.id} />}
          {p.type === "astronaut" && <AstronautSvg id={p.id} />}
          {p.type === "comet" && <CometSvg id={p.id} />}
          {p.type === "meteor" && <MeteorSvg id={p.id} />}
          {p.type === "star" && <StarSvg color={p.color} />}
          {p.type === "sparkle" && <SparkleSvg color={p.color} />}
          {p.type === "satellite" && <SatelliteSvg id={p.id} />}
        </div>
      ))}
    </div>
  );
}

/* ---------- Particle SVGs ---------- */

function RocketSvg({ id }: { id: number }) {
  return (
    <svg viewBox="0 0 24 32" fill="none" className="w-full h-full">
      <defs>
        <linearGradient id={`rocket-body-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="50%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
        <linearGradient id={`rocket-flame-${id}`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="40%" stopColor="#fbbf24" />
          <stop offset="80%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      {/* Flame trail (below body) */}
      <path
        d="M9 24 Q10 27 10.5 30 Q12 26 12 24 Q12 26 13.5 30 Q14 27 15 24 Z"
        fill={`url(#rocket-flame-${id})`}
      />
      <path
        d="M10 24 Q11 26.5 11.5 28 Q12 26.5 12 24 Q12 26.5 12.5 28 Q13 26.5 14 24 Z"
        fill="#fef9c3"
        opacity="0.9"
      />
      {/* Body */}
      <path
        d="M12 2 C15 6 17 11 17 16 L17 22 L7 22 L7 16 C7 11 9 6 12 2 Z"
        fill={`url(#rocket-body-${id})`}
        stroke="#475569"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      {/* Red nose accent */}
      <path d="M12 2 C13.5 4 14.5 6.5 15 9 L9 9 C9.5 6.5 10.5 4 12 2 Z" fill="#ef4444" />
      {/* Window */}
      <circle cx="12" cy="13" r="2.4" fill="#0ea5e9" stroke="#0c4a6e" strokeWidth="0.7" />
      <circle cx="12" cy="13" r="1.8" fill="#7dd3fc" />
      <circle cx="11.2" cy="12.2" r="0.6" fill="#ffffff" opacity="0.9" />
      {/* Body stripes */}
      <line x1="7.5" y1="17" x2="16.5" y2="17" stroke="#ef4444" strokeWidth="0.9" />
      <line x1="7.5" y1="19.5" x2="16.5" y2="19.5" stroke="#3b82f6" strokeWidth="0.6" opacity="0.7" />
      {/* Fins */}
      <path d="M7 17 L4 22 L7 22 Z" fill="#dc2626" stroke="#7f1d1d" strokeWidth="0.6" strokeLinejoin="round" />
      <path d="M17 17 L20 22 L17 22 Z" fill="#dc2626" stroke="#7f1d1d" strokeWidth="0.6" strokeLinejoin="round" />
      {/* Booster ring */}
      <ellipse cx="12" cy="22" rx="5" ry="0.8" fill="#64748b" />
    </svg>
  );
}

function PlanetSvg({ id, variant }: { id: number; variant: typeof PLANET_VARIANTS[number] }) {
  return (
    <svg viewBox="0 0 32 32" className="w-full h-full">
      <defs>
        <radialGradient id={`planet-${id}`} cx="35%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="25%" stopColor={variant.base} />
          <stop offset="100%" stopColor={variant.accent} />
        </radialGradient>
      </defs>
      {/* Back-of-ring slice (drawn behind planet) */}
      {variant.ring && (
        <ellipse
          cx="16"
          cy="16"
          rx="14.5"
          ry="3.5"
          fill="none"
          stroke="#fde047"
          strokeWidth="1.2"
          opacity="0.85"
          strokeDasharray="0 0"
        />
      )}
      {/* Planet body */}
      <circle cx="16" cy="16" r="10" fill={`url(#planet-${id})`} />
      {/* Surface details — small craters / bands */}
      <ellipse cx="13" cy="13" rx="2.2" ry="1.1" fill={variant.accent} opacity="0.35" />
      <ellipse cx="19" cy="18" rx="3" ry="1.4" fill={variant.accent} opacity="0.4" />
      <circle cx="20.5" cy="13" r="1" fill={variant.accent} opacity="0.5" />
      {/* Specular highlight */}
      <ellipse cx="12.5" cy="11.5" rx="2.5" ry="1.5" fill="#ffffff" opacity="0.45" />
      {/* Front-of-ring slice */}
      {variant.ring && (
        <path
          d="M1.5 16 Q1.5 19.5 16 19.5 Q30.5 19.5 30.5 16"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="1.4"
          opacity="0.9"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function UfoSvg({ id }: { id: number }) {
  return (
    <svg viewBox="0 0 32 24" fill="none" className="w-full h-full">
      <defs>
        <linearGradient id={`ufo-body-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#cbd5e1" />
          <stop offset="50%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        <radialGradient id={`ufo-dome-${id}`} cx="50%" cy="80%" r="60%">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="60%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </radialGradient>
        <linearGradient id={`ufo-beam-${id}`} x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#fde047" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fde047" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Beam light below saucer */}
      <path d="M11 14 L21 14 L26 24 L6 24 Z" fill={`url(#ufo-beam-${id})`} />
      {/* Saucer body */}
      <ellipse cx="16" cy="14" rx="14" ry="3.5" fill={`url(#ufo-body-${id})`} stroke="#334155" strokeWidth="0.7" />
      {/* Glass dome */}
      <path
        d="M9 13 Q9 5 16 5 Q23 5 23 13 Z"
        fill={`url(#ufo-dome-${id})`}
        stroke="#0c4a6e"
        strokeWidth="0.7"
      />
      {/* Dome highlight */}
      <path d="M11 10 Q12 7 14 6" stroke="#ffffff" strokeWidth="0.8" fill="none" opacity="0.7" />
      {/* Tiny alien silhouette inside */}
      <ellipse cx="16" cy="11" rx="2" ry="1.6" fill="#22c55e" opacity="0.7" />
      <circle cx="15.3" cy="10.5" r="0.4" fill="#000" />
      <circle cx="16.7" cy="10.5" r="0.4" fill="#000" />
      {/* Underside lights */}
      <circle cx="5" cy="15" r="1.1" fill="#fde047" />
      <circle cx="10" cy="16" r="1.1" fill="#22d3ee" />
      <circle cx="16" cy="16.5" r="1.1" fill="#f0abfc" />
      <circle cx="22" cy="16" r="1.1" fill="#22d3ee" />
      <circle cx="27" cy="15" r="1.1" fill="#fde047" />
      {/* Glow halos under lights */}
      <circle cx="16" cy="16.5" r="1.8" fill="#f0abfc" opacity="0.3" />
    </svg>
  );
}

function AlienSvg({ id }: { id: number }) {
  return (
    <svg viewBox="0 0 24 28" fill="none" className="w-full h-full">
      <defs>
        <radialGradient id={`alien-head-${id}`} cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#bbf7d0" />
          <stop offset="60%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#15803d" />
        </radialGradient>
      </defs>
      {/* Antennae */}
      <line x1="8" y1="4" x2="6" y2="1" stroke="#15803d" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="16" y1="4" x2="18" y2="1" stroke="#15803d" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="6" cy="1" r="1.2" fill="#fde047" stroke="#a16207" strokeWidth="0.4" />
      <circle cx="18" cy="1" r="1.2" fill="#fde047" stroke="#a16207" strokeWidth="0.4" />
      {/* Head (big oval) */}
      <ellipse cx="12" cy="11" rx="7.5" ry="8.5" fill={`url(#alien-head-${id})`} stroke="#14532d" strokeWidth="0.7" />
      {/* Cyclops eye — single big eye */}
      <ellipse cx="12" cy="11" rx="4" ry="3" fill="#0f172a" />
      <ellipse cx="12" cy="11" rx="3.4" ry="2.5" fill="#1e293b" />
      <circle cx="13.2" cy="10" r="1.4" fill="#ffffff" />
      <circle cx="13.6" cy="10.3" r="0.5" fill="#fde047" />
      <circle cx="10.7" cy="11.8" r="0.5" fill="#ffffff" opacity="0.7" />
      {/* Smiley mouth */}
      <path d="M9 16.5 Q12 18.6 15 16.5" stroke="#14532d" strokeWidth="1" fill="none" strokeLinecap="round" />
      {/* Tiny tongue */}
      <ellipse cx="12" cy="17.4" rx="0.7" ry="0.4" fill="#f472b6" />
      {/* Body / neck */}
      <ellipse cx="12" cy="22" rx="4" ry="2.5" fill="#16a34a" stroke="#14532d" strokeWidth="0.6" />
      {/* Cheek dots */}
      <circle cx="6" cy="13" r="0.7" fill="#15803d" opacity="0.6" />
      <circle cx="18" cy="13" r="0.7" fill="#15803d" opacity="0.6" />
    </svg>
  );
}

function AstronautSvg({ id }: { id: number }) {
  return (
    <svg viewBox="0 0 24 30" fill="none" className="w-full h-full">
      <defs>
        <radialGradient id={`helmet-${id}`} cx="40%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#7dd3fc" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#0c4a6e" />
        </radialGradient>
      </defs>
      {/* Suit body */}
      <rect x="7" y="13" width="10" height="11" rx="2.5" fill="#f1f5f9" stroke="#475569" strokeWidth="0.8" />
      {/* Chest control panel */}
      <rect x="9" y="15" width="6" height="3.5" rx="0.5" fill="#1e293b" />
      <circle cx="10.5" cy="16.7" r="0.5" fill="#22c55e" />
      <circle cx="12" cy="16.7" r="0.5" fill="#ef4444" />
      <circle cx="13.5" cy="16.7" r="0.5" fill="#fbbf24" />
      {/* Arms */}
      <rect x="3.5" y="14" width="3.5" height="7" rx="1.6" fill="#f1f5f9" stroke="#475569" strokeWidth="0.7" />
      <rect x="17" y="14" width="3.5" height="7" rx="1.6" fill="#f1f5f9" stroke="#475569" strokeWidth="0.7" />
      {/* Gloves */}
      <circle cx="5.25" cy="22" r="1.7" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.5" />
      <circle cx="18.75" cy="22" r="1.7" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.5" />
      {/* Legs */}
      <rect x="8" y="23" width="3" height="6" rx="1" fill="#f1f5f9" stroke="#475569" strokeWidth="0.7" />
      <rect x="13" y="23" width="3" height="6" rx="1" fill="#f1f5f9" stroke="#475569" strokeWidth="0.7" />
      {/* Boots */}
      <ellipse cx="9.5" cy="29.2" rx="1.7" ry="0.8" fill="#1e293b" />
      <ellipse cx="14.5" cy="29.2" rx="1.7" ry="0.8" fill="#1e293b" />
      {/* Helmet bubble (drawn over neck) */}
      <circle cx="12" cy="8" r="6" fill={`url(#helmet-${id})`} stroke="#1e293b" strokeWidth="0.8" />
      {/* Face inside helmet */}
      <ellipse cx="12" cy="9" rx="3" ry="3.2" fill="#fde68a" />
      <circle cx="10.7" cy="8.3" r="0.35" fill="#1e293b" />
      <circle cx="13.3" cy="8.3" r="0.35" fill="#1e293b" />
      <path d="M11 10 Q12 10.8 13 10" stroke="#7f1d1d" strokeWidth="0.5" fill="none" strokeLinecap="round" />
      {/* Helmet highlight */}
      <ellipse cx="9.5" cy="5.5" rx="1.5" ry="2" fill="#ffffff" opacity="0.55" />
      {/* Flag patch on shoulder */}
      <rect x="14" y="13.5" width="2.5" height="1.5" fill="#3b82f6" />
      <rect x="14" y="13.5" width="1" height="0.8" fill="#fbbf24" />
    </svg>
  );
}

function CometSvg({ id }: { id: number }) {
  return (
    <svg viewBox="0 0 40 20" fill="none" className="w-full h-full">
      <defs>
        <linearGradient id={`comet-trail-${id}`} x1="100%" y1="50%" x2="0%" y2="50%">
          <stop offset="0%" stopColor="#fde047" stopOpacity="1" />
          <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`comet-head-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="50%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#f97316" />
        </radialGradient>
      </defs>
      {/* Long trail tapering to nothing (behind head, on the negative-x side) */}
      <path d="M32 10 L4 7 L4 13 Z" fill={`url(#comet-trail-${id})`} />
      <path d="M32 10 L10 9 L10 11 Z" fill="#ffffff" opacity="0.7" />
      {/* Sparkle bits in trail */}
      <circle cx="22" cy="8" r="0.6" fill="#ffffff" />
      <circle cx="16" cy="11" r="0.5" fill="#fde047" />
      <circle cx="28" cy="11" r="0.5" fill="#a5f3fc" />
      {/* Head — bright nucleus on the right (direction of travel) */}
      <circle cx="33" cy="10" r="4.5" fill={`url(#comet-head-${id})`} />
      <circle cx="33" cy="10" r="2.5" fill="#fef9c3" />
      <circle cx="32" cy="9" r="1" fill="#ffffff" />
    </svg>
  );
}

function MeteorSvg({ id }: { id: number }) {
  return (
    <svg viewBox="0 0 28 20" fill="none" className="w-full h-full">
      <defs>
        <radialGradient id={`meteor-rock-${id}`} cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="40%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#7f1d1d" />
        </radialGradient>
        <linearGradient id={`meteor-trail-${id}`} x1="100%" y1="50%" x2="0%" y2="50%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M20 10 L2 7 L2 13 Z" fill={`url(#meteor-trail-${id})`} />
      <circle cx="22" cy="10" r="5" fill={`url(#meteor-rock-${id})`} stroke="#7f1d1d" strokeWidth="0.6" />
      {/* Crater pits */}
      <circle cx="20.5" cy="9" r="1" fill="#7f1d1d" opacity="0.6" />
      <circle cx="23" cy="11.5" r="0.7" fill="#7f1d1d" opacity="0.5" />
      <circle cx="21" cy="11.8" r="0.4" fill="#1e293b" opacity="0.5" />
    </svg>
  );
}

function StarSvg({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <path
        d="M12 2 L14.3 8.5 L21 9.3 L16 14 L17.3 21 L12 17.6 L6.7 21 L8 14 L3 9.3 L9.7 8.5 Z"
        fill={color}
        stroke="#ffffff"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.5" fill="#ffffff" opacity="0.8" />
    </svg>
  );
}

function SparkleSvg({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      {/* 4-point sparkle / shine */}
      <path d="M12 2 L13 11 L22 12 L13 13 L12 22 L11 13 L2 12 L11 11 Z" fill={color} />
      <circle cx="12" cy="12" r="1.2" fill="#ffffff" />
    </svg>
  );
}

function SatelliteSvg({ id }: { id: number }) {
  return (
    <svg viewBox="0 0 32 24" fill="none" className="w-full h-full">
      <defs>
        <linearGradient id={`sat-panel-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e40af" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      {/* Left solar panel */}
      <rect x="1" y="9" width="10" height="6" fill={`url(#sat-panel-${id})`} stroke="#0c4a6e" strokeWidth="0.6" />
      <line x1="6" y1="9" x2="6" y2="15" stroke="#0c4a6e" strokeWidth="0.5" />
      <line x1="1" y1="12" x2="11" y2="12" stroke="#0c4a6e" strokeWidth="0.5" />
      {/* Right solar panel */}
      <rect x="21" y="9" width="10" height="6" fill={`url(#sat-panel-${id})`} stroke="#0c4a6e" strokeWidth="0.6" />
      <line x1="26" y1="9" x2="26" y2="15" stroke="#0c4a6e" strokeWidth="0.5" />
      <line x1="21" y1="12" x2="31" y2="12" stroke="#0c4a6e" strokeWidth="0.5" />
      {/* Core body */}
      <rect x="11" y="8" width="10" height="8" rx="1" fill="#cbd5e1" stroke="#334155" strokeWidth="0.7" />
      <rect x="13" y="10" width="6" height="4" fill="#1e293b" />
      <circle cx="16" cy="12" r="1" fill="#22d3ee" />
      {/* Dish antenna */}
      <ellipse cx="16" cy="4" rx="3.5" ry="1.5" fill="#e2e8f0" stroke="#475569" strokeWidth="0.6" />
      <line x1="16" y1="5.5" x2="16" y2="8" stroke="#475569" strokeWidth="0.8" />
      <circle cx="16" cy="4" r="0.6" fill="#ef4444" />
      {/* Antenna whisker */}
      <line x1="16" y1="16" x2="16" y2="20" stroke="#64748b" strokeWidth="0.6" />
      <circle cx="16" cy="20" r="0.6" fill="#fde047" />
    </svg>
  );
}
