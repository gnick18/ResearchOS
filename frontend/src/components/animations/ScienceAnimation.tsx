"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type ParticleType =
  | "atom"
  | "dna"
  | "beaker"
  | "molecule"
  | "microscope"
  | "flask"
  | "testtube"
  | "lightbulb"
  | "gear"
  | "atomSymbol";

interface ScienceParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: ParticleType;
  opacity: number;
  color: string;
}

interface Bubble {
  id: number;
  x: number;
  y: number;
  size: number;
  velocityY: number;
  opacity: number;
  hue: string;
}

interface ScienceAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

// Lab greens + electric blues, with accent purples for DNA/molecule pop.
const SCIENCE_COLORS = [
  "#009688", // teal (signature)
  "#00bcd4", // cyan
  "#4caf50", // lab green
  "#2196f3", // electric blue
  "#00e676", // neon green
  "#26c6da", // light cyan
  "#66bb6a", // mid green
  "#03a9f4", // sky blue
];

const ACCENT_COLORS = ["#9c27b0", "#ff5722", "#651fff"];

interface ParticleSpec {
  count: number;
  type: ParticleType;
  spread: number;
  speedBase: number;
  speedJitter: number;
  scaleBase: number;
  scaleJitter: number;
  rotationSpeedJitter: number;
  rotationRange: number;
  pickColor: () => string;
}

const PARTICLE_SPECS: ParticleSpec[] = [
  {
    count: 6,
    type: "atom",
    spread: 60,
    speedBase: 5,
    speedJitter: 7,
    scaleBase: 0.6,
    scaleJitter: 0.5,
    rotationSpeedJitter: 10,
    rotationRange: 360,
    pickColor: () => SCIENCE_COLORS[Math.floor(Math.random() * SCIENCE_COLORS.length)],
  },
  {
    count: 5,
    type: "dna",
    spread: 70,
    speedBase: 4,
    speedJitter: 5,
    scaleBase: 0.5,
    scaleJitter: 0.5,
    rotationSpeedJitter: 8,
    rotationRange: 360,
    pickColor: () => "#4caf50",
  },
  {
    count: 4,
    type: "beaker",
    spread: 50,
    speedBase: 3,
    speedJitter: 5,
    scaleBase: 0.6,
    scaleJitter: 0.4,
    rotationSpeedJitter: 5,
    rotationRange: 30,
    pickColor: () => "#00bcd4",
  },
  {
    count: 8,
    type: "molecule",
    spread: 80,
    speedBase: 4,
    speedJitter: 6,
    scaleBase: 0.4,
    scaleJitter: 0.4,
    rotationSpeedJitter: 12,
    rotationRange: 360,
    pickColor: () => SCIENCE_COLORS[Math.floor(Math.random() * SCIENCE_COLORS.length)],
  },
  {
    count: 3,
    type: "microscope",
    spread: 50,
    speedBase: 3,
    speedJitter: 4,
    scaleBase: 0.6,
    scaleJitter: 0.4,
    rotationSpeedJitter: 5,
    rotationRange: 20,
    pickColor: () => "#607d8b",
  },
  {
    count: 4,
    type: "flask",
    spread: 60,
    speedBase: 4,
    speedJitter: 5,
    scaleBase: 0.5,
    scaleJitter: 0.4,
    rotationSpeedJitter: 6,
    rotationRange: 30,
    pickColor: () => ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)],
  },
  {
    count: 6,
    type: "testtube",
    spread: 70,
    speedBase: 4,
    speedJitter: 5,
    scaleBase: 0.5,
    scaleJitter: 0.4,
    rotationSpeedJitter: 8,
    rotationRange: 40,
    pickColor: () => SCIENCE_COLORS[Math.floor(Math.random() * SCIENCE_COLORS.length)],
  },
  {
    count: 3,
    type: "lightbulb",
    spread: 60,
    speedBase: 4,
    speedJitter: 6,
    scaleBase: 0.6,
    scaleJitter: 0.4,
    rotationSpeedJitter: 6,
    rotationRange: 30,
    pickColor: () => "#ffeb3b",
  },
  {
    count: 3,
    type: "gear",
    spread: 70,
    speedBase: 3,
    speedJitter: 5,
    scaleBase: 0.5,
    scaleJitter: 0.4,
    rotationSpeedJitter: 14,
    rotationRange: 360,
    pickColor: () => "#26c6da",
  },
  {
    count: 5,
    type: "atomSymbol",
    spread: 80,
    speedBase: 5,
    speedJitter: 6,
    scaleBase: 0.5,
    scaleJitter: 0.4,
    rotationSpeedJitter: 12,
    rotationRange: 360,
    pickColor: () => "#2196f3",
  },
];

function ParticleGradients() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <radialGradient id="science-nucleus" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#80cbc4" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#009688" stopOpacity="1" />
        </radialGradient>
        <linearGradient id="science-flask-fill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00e676" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#009688" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="science-bulb" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fff59d" />
          <stop offset="100%" stopColor="#ffc107" />
        </linearGradient>
        <radialGradient id="science-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#80deea" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#009688" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

interface ParticleSvgProps {
  type: ParticleType;
  color: string;
}

function ParticleSvg({ type, color }: ParticleSvgProps) {
  switch (type) {
    case "atom":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* glow halo */}
          <circle cx="12" cy="12" r="11" fill="url(#science-glow)" />
          {/* three orbits */}
          <ellipse cx="12" cy="12" rx="10" ry="4" stroke={color} strokeWidth="1.5" fill="none" />
          <ellipse
            cx="12"
            cy="12"
            rx="10"
            ry="4"
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            transform="rotate(60 12 12)"
          />
          <ellipse
            cx="12"
            cy="12"
            rx="10"
            ry="4"
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            transform="rotate(-60 12 12)"
          />
          {/* electrons */}
          <circle cx="22" cy="12" r="1.3" fill={color} />
          <circle cx="7" cy="3.5" r="1.3" fill={color} />
          <circle cx="7" cy="20.5" r="1.3" fill={color} />
          {/* nucleus */}
          <circle cx="12" cy="12" r="3" fill="url(#science-nucleus)" />
        </svg>
      );
    case "dna":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* twisted ladder backbones */}
          <path d="M7 2Q12 6 17 2" stroke="#4caf50" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M7 8Q12 4 17 8" stroke="#2196f3" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M7 14Q12 18 17 14" stroke="#4caf50" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M7 22Q12 18 17 22" stroke="#2196f3" strokeWidth="2" fill="none" strokeLinecap="round" />
          {/* rungs */}
          <line x1="9" y1="4" x2="15" y2="4" stroke="#9c27b0" strokeWidth="1.5" />
          <line x1="9" y1="10" x2="15" y2="10" stroke="#ff5722" strokeWidth="1.5" />
          <line x1="9" y1="16" x2="15" y2="16" stroke="#9c27b0" strokeWidth="1.5" />
          <line x1="9" y1="20" x2="15" y2="20" stroke="#ff5722" strokeWidth="1.5" />
          {/* base pair dots */}
          <circle cx="9" cy="4" r="1.2" fill="#4caf50" />
          <circle cx="15" cy="4" r="1.2" fill="#2196f3" />
          <circle cx="9" cy="10" r="1.2" fill="#2196f3" />
          <circle cx="15" cy="10" r="1.2" fill="#4caf50" />
        </svg>
      );
    case "beaker":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* glass body */}
          <path d="M8 2V8L4 20H20L16 8V2H8Z" fill="none" stroke="#cfd8dc" strokeWidth="1.5" strokeLinejoin="round" />
          <rect x="7" y="1" width="10" height="2" rx="0.5" fill="#90a4ae" />
          {/* liquid */}
          <path d="M5.5 16H18.5L16 10H8L5.5 16Z" fill={color} opacity="0.75" />
          <path d="M5.5 16H18.5L17.5 18H6.5L5.5 16Z" fill={color} opacity="0.55" />
          {/* bubbles inside */}
          <circle cx="9.5" cy="13" r="1" fill="#ffffff" opacity="0.75" />
          <circle cx="13" cy="14" r="0.8" fill="#ffffff" opacity="0.6" />
          <circle cx="15.5" cy="12" r="0.6" fill="#ffffff" opacity="0.7" />
          {/* glass highlight */}
          <path d="M9 4V8" stroke="#ffffff" strokeWidth="0.8" opacity="0.6" />
        </svg>
      );
    case "molecule":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* bonds */}
          <line x1="12" y1="8" x2="6" y2="16" stroke={color} strokeWidth="1.8" />
          <line x1="12" y1="8" x2="18" y2="16" stroke={color} strokeWidth="1.8" />
          <line x1="6" y1="16" x2="18" y2="16" stroke={color} strokeWidth="1.8" opacity="0.6" />
          {/* atoms */}
          <circle cx="12" cy="8" r="3.5" fill={color} />
          <circle cx="6" cy="16" r="2.8" fill={color} opacity="0.85" />
          <circle cx="18" cy="16" r="2.8" fill={color} opacity="0.85" />
          {/* highlights */}
          <circle cx="11" cy="7" r="1" fill="#ffffff" opacity="0.7" />
          <circle cx="5.2" cy="15.2" r="0.8" fill="#ffffff" opacity="0.6" />
          <circle cx="17.2" cy="15.2" r="0.8" fill="#ffffff" opacity="0.6" />
        </svg>
      );
    case "microscope":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* eyepiece */}
          <rect x="10.5" y="2" width="3" height="3" rx="0.5" fill="#37474f" />
          {/* arm */}
          <path d="M9 5L13 5L14 12L10 12Z" fill="#546e7a" />
          {/* lens */}
          <circle cx="12" cy="14" r="3.2" fill="#37474f" />
          <circle cx="12" cy="14" r="2" fill="#00bcd4" opacity="0.75" />
          <circle cx="11.2" cy="13.2" r="0.7" fill="#ffffff" opacity="0.85" />
          {/* stage */}
          <rect x="6" y="18" width="12" height="1.5" fill="#546e7a" />
          {/* base */}
          <path d="M5 19.5H19L17.5 22H6.5Z" fill="#37474f" />
        </svg>
      );
    case "flask":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* Erlenmeyer outline */}
          <path
            d="M10 2V8L5 19Q5 21 7 21H17Q19 21 19 19L14 8V2H10Z"
            fill="none"
            stroke="#cfd8dc"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <rect x="9.5" y="1" width="5" height="2" rx="0.5" fill="#90a4ae" />
          {/* liquid */}
          <path d="M6.5 15Q12 14 17.5 15L18.5 19Q18.5 20.5 17 20.5H7Q5.5 20.5 5.5 19Z" fill="url(#science-flask-fill)" />
          {/* steam wisps */}
          <path d="M11 -0.5Q12 1 11 2.5" stroke="#b2dfdb" strokeWidth="0.8" fill="none" opacity="0.7" />
          <path d="M13 -0.5Q12 1 13 2.5" stroke="#b2dfdb" strokeWidth="0.8" fill="none" opacity="0.7" />
          {/* bubbles */}
          <circle cx="9" cy="17" r="0.8" fill="#ffffff" opacity="0.6" />
          <circle cx="13" cy="18" r="0.6" fill="#ffffff" opacity="0.7" />
          <circle cx="15" cy="16.5" r="0.5" fill="#ffffff" opacity="0.5" />
        </svg>
      );
    case "testtube":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          <rect x="9" y="2" width="6" height="19" rx="3" fill="none" stroke="#cfd8dc" strokeWidth="1.5" />
          <rect x="8" y="1" width="8" height="2" rx="0.5" fill="#90a4ae" />
          {/* liquid */}
          <rect x="10" y="10" width="4" height="9" rx="1.8" fill={color} opacity="0.75" />
          {/* meniscus */}
          <ellipse cx="12" cy="10" rx="2" ry="0.6" fill={color} />
          {/* highlight */}
          <rect x="10" y="11" width="0.7" height="6" rx="0.35" fill="#ffffff" opacity="0.5" />
          {/* bubble */}
          <circle cx="12" cy="14" r="0.9" fill="#ffffff" opacity="0.55" />
          <circle cx="13" cy="17" r="0.5" fill="#ffffff" opacity="0.4" />
        </svg>
      );
    case "lightbulb":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* halo */}
          <circle cx="12" cy="10" r="10" fill="url(#science-glow)" />
          {/* bulb */}
          <path
            d="M12 2Q6 2 6 9Q6 12 9 14V16H15V14Q18 12 18 9Q18 2 12 2Z"
            fill="url(#science-bulb)"
            stroke="#f57f17"
            strokeWidth="0.8"
          />
          {/* filament */}
          <path d="M10 11Q12 8 14 11" stroke="#f57f17" strokeWidth="0.9" fill="none" />
          {/* base */}
          <rect x="9.5" y="16" width="5" height="1.5" fill="#90a4ae" />
          <rect x="10" y="17.5" width="4" height="1.2" fill="#607d8b" />
          <rect x="10.5" y="18.7" width="3" height="1" fill="#90a4ae" />
          {/* sparkles */}
          <circle cx="3" cy="6" r="0.7" fill="#fff59d" />
          <circle cx="21" cy="7" r="0.6" fill="#fff59d" />
          <circle cx="4" cy="13" r="0.5" fill="#fff59d" />
        </svg>
      );
    case "gear":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* teeth as rectangles around center */}
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i * 360) / 8;
            return (
              <rect
                key={i}
                x="11"
                y="1"
                width="2"
                height="4"
                fill={color}
                transform={`rotate(${angle} 12 12)`}
                rx="0.4"
              />
            );
          })}
          {/* gear body */}
          <circle cx="12" cy="12" r="6.5" fill={color} />
          <circle cx="12" cy="12" r="4.8" fill="#ffffff" opacity="0.18" />
          {/* inner hole */}
          <circle cx="12" cy="12" r="2.2" fill="#1a1a2e" />
          <circle cx="12" cy="12" r="1.2" fill={color} opacity="0.5" />
        </svg>
      );
    case "atomSymbol":
      return (
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
          {/* atomic symbol — single orbit + nucleus chip */}
          <circle cx="12" cy="12" r="9" fill="url(#science-glow)" />
          <ellipse
            cx="12"
            cy="12"
            rx="9"
            ry="3.5"
            stroke={color}
            strokeWidth="1.4"
            fill="none"
            transform="rotate(30 12 12)"
          />
          <ellipse
            cx="12"
            cy="12"
            rx="9"
            ry="3.5"
            stroke={color}
            strokeWidth="1.4"
            fill="none"
            transform="rotate(-30 12 12)"
          />
          {/* symbol chip — periodic table style */}
          <rect x="8" y="8" width="8" height="8" rx="1.2" fill="#0d47a1" />
          <text
            x="12"
            y="14"
            textAnchor="middle"
            fontSize="5"
            fontWeight="700"
            fill="#80d8ff"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            R
          </text>
        </svg>
      );
    default:
      return null;
  }
}

export default function ScienceAnimation({ x, y, onComplete }: ScienceAnimationProps) {
  const [particles, setParticles] = useState<ScienceParticle[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  const createParticles = useCallback(() => {
    const newParticles: ScienceParticle[] = [];
    let nextId = 0;
    for (const spec of PARTICLE_SPECS) {
      for (let i = 0; i < spec.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = spec.speedBase + Math.random() * spec.speedJitter;
        newParticles.push({
          id: nextId++,
          x: x + (Math.random() - 0.5) * spec.spread,
          y: y + (Math.random() - 0.5) * spec.spread,
          rotation: Math.random() * spec.rotationRange - (spec.rotationRange === 360 ? 0 : spec.rotationRange / 2),
          scale: spec.scaleBase + Math.random() * spec.scaleJitter,
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - 4,
          rotationSpeed: (Math.random() - 0.5) * spec.rotationSpeedJitter,
          type: spec.type,
          opacity: 1,
          color: spec.pickColor(),
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

    // Bubbles — laboratory effervescence rising from the origin point.
    const newBubbles: Bubble[] = [];
    const bubbleHues = [
      "rgba(0,188,212,0.25)",
      "rgba(0,150,136,0.25)",
      "rgba(76,175,80,0.25)",
      "rgba(33,150,243,0.25)",
    ];
    for (let i = 0; i < 30; i++) {
      newBubbles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 140,
        y: y + Math.random() * 50,
        size: 4 + Math.random() * 14,
        velocityY: -1.5 - Math.random() * 3,
        opacity: 0.5 + Math.random() * 0.5,
        hue: bubbleHues[Math.floor(Math.random() * bubbleHues.length)],
      });
    }
    setBubbles(newBubbles);

    const interval = setInterval(() => {
      setParticles(prev =>
        prev
          .map(p => ({
            ...p,
            x: p.x + p.velocityX,
            y: p.y + p.velocityY + 0.4,
            velocityY: p.velocityY + 0.15,
            rotation: p.rotation + p.rotationSpeed,
            opacity: Math.max(0, p.opacity - 0.01),
          }))
          .filter(p => p.y < window.innerHeight + 100 && p.opacity > 0),
      );

      setBubbles(prev =>
        prev
          .map(b => ({
            ...b,
            y: b.y + b.velocityY,
            x: b.x + Math.sin(b.y * 0.05) * 0.4,
            opacity: Math.max(0, b.opacity - 0.01),
          }))
          .filter(b => b.y > -50 && b.opacity > 0),
      );
    }, 30);

    // Clean up after animation
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
      <ParticleGradients />

      {/* Bubbles */}
      {bubbles.map(b => (
        <div
          key={`bubble-${b.id}`}
          className="absolute rounded-full"
          style={{
            left: b.x,
            top: b.y,
            width: b.size,
            height: b.size,
            background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.7), ${b.hue})`,
            boxShadow: "0 0 6px rgba(0,188,212,0.3)",
            opacity: b.opacity,
          }}
        />
      ))}

      {/* SVG Particles */}
      {particles.map(p => (
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
            filter:
              p.type === "lightbulb" || p.type === "atom" || p.type === "atomSymbol"
                ? "drop-shadow(0 0 6px rgba(128, 222, 234, 0.7))"
                : "drop-shadow(0 1px 2px rgba(0,0,0,0.2))",
          }}
        >
          <ParticleSvg type={p.type} color={p.color} />
        </div>
      ))}
    </div>
  );
}
