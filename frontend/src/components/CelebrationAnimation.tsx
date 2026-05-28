"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type ParticleType =
  | "confetti-rect"
  | "confetti-strip"
  | "confetti-circle"
  | "streamer"
  | "star"
  | "sparkle"
  | "heart"
  | "balloon"
  | "partyHorn"
  | "unicornHead"
  | "rainbow";

interface CelebrationParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  rotationSpeed: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  type: ParticleType;
  color: string;
  secondaryColor: string;
  opacity: number;
  size: number;
  wobble: number;
  wobbleSpeed: number;
}

interface CelebrationAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

// Pastel + bright primary party palette
const PARTY_COLORS = [
  "#ff6b9d", // pink
  "#feca57", // sunny yellow
  "#48dbfb", // sky blue
  "#ff9ff3", // bubblegum
  "#54a0ff", // royal blue
  "#a78bfa", // lavender
  "#5eead4", // mint
  "#fb7185", // coral
  "#fbbf24", // amber
  "#34d399", // emerald
];

const RAINBOW_STOPS = [
  "#ff5e7e",
  "#ff9f43",
  "#feca57",
  "#1dd1a1",
  "#48dbfb",
  "#a78bfa",
];

// Helper to render a single particle's SVG given its type + colors.
function ParticleSvg({
  type,
  color,
  secondary,
  id,
}: {
  type: ParticleType;
  color: string;
  secondary: string;
  id: number;
}) {
  switch (type) {
    case "confetti-rect":
      return (
        <svg viewBox="0 0 12 18" className="w-full h-full" preserveAspectRatio="none">
          <rect x="0" y="0" width="12" height="18" rx="1.5" fill={color} />
          <rect x="0" y="0" width="12" height="6" fill={secondary} opacity="0.45" />
        </svg>
      );

    case "confetti-strip":
      // Wavy ribbon-style confetti
      return (
        <svg viewBox="0 0 30 10" className="w-full h-full" preserveAspectRatio="none">
          <path
            d="M0 5 Q 5 0, 10 5 T 20 5 T 30 5 L 30 8 Q 25 13, 20 8 T 10 8 T 0 8 Z"
            fill={color}
          />
          <path
            d="M0 5 Q 5 0, 10 5 T 20 5 T 30 5"
            stroke={secondary}
            strokeWidth="1"
            fill="none"
            opacity="0.6"
          />
        </svg>
      );

    case "confetti-circle":
      return (
        <svg viewBox="0 0 12 12" className="w-full h-full">
          <circle cx="6" cy="6" r="5" fill={color} />
          <circle cx="4" cy="4" r="1.5" fill="#fff" opacity="0.55" />
        </svg>
      );

    case "streamer":
      // Long curling streamer
      return (
        <svg viewBox="0 0 40 12" className="w-full h-full" preserveAspectRatio="none">
          <path
            d="M0 6 C 8 0, 12 12, 20 6 S 32 0, 40 6"
            stroke={color}
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M0 6 C 8 0, 12 12, 20 6 S 32 0, 40 6"
            stroke={secondary}
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            opacity="0.7"
          />
        </svg>
      );

    case "star":
      return (
        <svg viewBox="0 0 24 24" className="w-full h-full">
          <defs>
            <radialGradient id={`star-grad-${id}`} cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#fff8dc" />
              <stop offset="60%" stopColor={color} />
              <stop offset="100%" stopColor={secondary} />
            </radialGradient>
          </defs>
          <path
            d="M12 2 L14.6 8.6 L21.8 9.3 L16.4 14.1 L18 21.2 L12 17.4 L6 21.2 L7.6 14.1 L2.2 9.3 L9.4 8.6 Z"
            fill={`url(#star-grad-${id})`}
            stroke="#fff"
            strokeWidth="0.6"
          />
        </svg>
      );

    case "sparkle":
      // Four-point sparkle / glint
      return (
        <svg viewBox="0 0 24 24" className="w-full h-full">
          <path
            d="M12 1 L13.5 10.5 L23 12 L13.5 13.5 L12 23 L10.5 13.5 L1 12 L10.5 10.5 Z"
            fill={color}
          />
          <circle cx="12" cy="12" r="2" fill="#fff" />
        </svg>
      );

    case "heart":
      return (
        <svg viewBox="0 0 24 24" className="w-full h-full">
          <defs>
            <linearGradient id={`heart-grad-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={secondary} />
            </linearGradient>
          </defs>
          <path
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            fill={`url(#heart-grad-${id})`}
          />
          <ellipse cx="8.5" cy="8" rx="1.5" ry="2" fill="#fff" opacity="0.4" />
        </svg>
      );

    case "balloon":
      return (
        <svg viewBox="0 0 24 32" className="w-full h-full">
          <defs>
            <radialGradient id={`balloon-grad-${id}`} cx="35%" cy="30%" r="60%">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.85" />
              <stop offset="30%" stopColor={color} stopOpacity="0.95" />
              <stop offset="100%" stopColor={secondary} />
            </radialGradient>
          </defs>
          <ellipse cx="12" cy="11" rx="9" ry="11" fill={`url(#balloon-grad-${id})`} />
          <path d="M10 22 L12 24 L14 22 Z" fill={secondary} />
          <path
            d="M12 24 Q 14 27, 11 29 T 13 32"
            stroke="#888"
            strokeWidth="0.7"
            fill="none"
          />
        </svg>
      );

    case "partyHorn":
      // Cone party horn / blower
      return (
        <svg viewBox="0 0 32 24" className="w-full h-full">
          <defs>
            <linearGradient id={`horn-grad-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={secondary} />
            </linearGradient>
          </defs>
          {/* Cone body */}
          <path d="M2 12 L24 4 L24 20 Z" fill={`url(#horn-grad-${id})`} stroke="#fff" strokeWidth="0.6" />
          {/* Stripes */}
          <path d="M8 10 L8.5 14" stroke="#fff" strokeWidth="1" opacity="0.7" />
          <path d="M14 8 L15 16" stroke="#fff" strokeWidth="1" opacity="0.7" />
          <path d="M20 6 L21.5 18" stroke="#fff" strokeWidth="1" opacity="0.7" />
          {/* Toot puff */}
          <circle cx="27" cy="12" r="2.5" fill="#fffbe6" opacity="0.85" />
          <circle cx="30" cy="9" r="1.5" fill="#fffbe6" opacity="0.75" />
          <circle cx="30" cy="15" r="1.5" fill="#fffbe6" opacity="0.75" />
        </svg>
      );

    case "unicornHead":
      // Stylized unicorn silhouette: head + mane + horn
      return (
        <svg viewBox="0 0 32 32" className="w-full h-full">
          <defs>
            <linearGradient id={`mane-grad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ff9ff3" />
              <stop offset="35%" stopColor="#feca57" />
              <stop offset="70%" stopColor="#48dbfb" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
            <linearGradient id={`horn-uni-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fff8dc" />
              <stop offset="100%" stopColor="#feca57" />
            </linearGradient>
          </defs>
          {/* Rainbow mane behind */}
          <path
            d="M8 10 Q 4 14, 6 22 Q 8 18, 10 22 Q 12 16, 14 22"
            fill={`url(#mane-grad-${id})`}
            stroke="none"
          />
          {/* Head */}
          <path
            d="M14 8 Q 22 6, 24 14 Q 26 22, 20 26 Q 14 26, 13 20 Q 12 14, 14 8 Z"
            fill="#fff"
            stroke={color}
            strokeWidth="0.8"
          />
          {/* Snout shade */}
          <ellipse cx="22" cy="22" rx="3.5" ry="2" fill="#fce7f3" opacity="0.7" />
          {/* Ear */}
          <path d="M16 8 L17 4 L19 8 Z" fill="#fff" stroke={color} strokeWidth="0.5" />
          <path d="M17 7 L17.7 5 L18.5 7 Z" fill="#fbcfe8" />
          {/* Horn */}
          <path d="M18 7 L19.5 1 L21 7 Z" fill={`url(#horn-uni-${id})`} stroke={color} strokeWidth="0.4" />
          <path d="M18.7 5.5 L20.4 5" stroke={color} strokeWidth="0.3" opacity="0.7" />
          <path d="M19 3.5 L20.2 3" stroke={color} strokeWidth="0.3" opacity="0.7" />
          {/* Eye */}
          <ellipse cx="18.5" cy="16" rx="0.9" ry="1.2" fill="#1f2937" />
          <circle cx="18.8" cy="15.6" r="0.3" fill="#fff" />
          {/* Cheek blush */}
          <circle cx="21" cy="20" r="1.2" fill="#fbcfe8" opacity="0.85" />
        </svg>
      );

    case "rainbow":
      // Small rainbow arc with cloud
      return (
        <svg viewBox="0 0 40 24" className="w-full h-full">
          <defs>
            <linearGradient id={`rainbow-grad-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
              {RAINBOW_STOPS.map((stop, i) => (
                <stop
                  key={i}
                  offset={`${(i / (RAINBOW_STOPS.length - 1)) * 100}%`}
                  stopColor={stop}
                />
              ))}
            </linearGradient>
          </defs>
          {/* Rainbow bands */}
          <path d="M4 22 A 16 16 0 0 1 36 22" stroke="#ff5e7e" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M6 22 A 14 14 0 0 1 34 22" stroke="#ff9f43" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M8 22 A 12 12 0 0 1 32 22" stroke="#feca57" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M10 22 A 10 10 0 0 1 30 22" stroke="#1dd1a1" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M12 22 A 8 8 0 0 1 28 22" stroke="#48dbfb" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M14 22 A 6 6 0 0 1 26 22" stroke="#a78bfa" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* Fluffy cloud feet */}
          <ellipse cx="5" cy="22" rx="5" ry="2.5" fill="#fff" />
          <ellipse cx="35" cy="22" rx="5" ry="2.5" fill="#fff" />
          <circle cx="3" cy="21" r="1.8" fill="#fff" />
          <circle cx="7" cy="20.5" r="1.8" fill="#fff" />
          <circle cx="33" cy="20.5" r="1.8" fill="#fff" />
          <circle cx="37" cy="21" r="1.8" fill="#fff" />
        </svg>
      );

    default:
      return null;
  }
}

// Per-type particle size baseline (in px before scale applied)
const TYPE_SIZE: Record<ParticleType, { w: number; h: number }> = {
  "confetti-rect": { w: 10, h: 16 },
  "confetti-strip": { w: 28, h: 10 },
  "confetti-circle": { w: 10, h: 10 },
  streamer: { w: 42, h: 14 },
  star: { w: 26, h: 26 },
  sparkle: { w: 22, h: 22 },
  heart: { w: 22, h: 22 },
  balloon: { w: 26, h: 34 },
  partyHorn: { w: 36, h: 26 },
  unicornHead: { w: 40, h: 40 },
  rainbow: { w: 48, h: 30 },
};

export default function CelebrationAnimation({ x, y, onComplete }: CelebrationAnimationProps) {
  const [particles, setParticles] = useState<CelebrationParticle[]>([]);
  const [burst, setBurst] = useState({ scale: 0, opacity: 0.85 });

  const createParticles = useCallback(() => {
    const out: CelebrationParticle[] = [];
    let id = 0;

    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

    const push = (
      count: number,
      type: ParticleType,
      cfg: {
        spread?: number;
        speed?: [number, number];
        upBias?: number;
        scale?: [number, number];
        rotSpeed?: [number, number];
        colorPool?: string[];
      } = {}
    ) => {
      const spread = cfg.spread ?? 80;
      const [smin, smax] = cfg.speed ?? [6, 12];
      const upBias = cfg.upBias ?? 6;
      const [scMin, scMax] = cfg.scale ?? [0.7, 1.2];
      const [rsMin, rsMax] = cfg.rotSpeed ?? [-8, 8];
      const pool = cfg.colorPool ?? PARTY_COLORS;

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = smin + Math.random() * (smax - smin);
        const color = pick(pool);
        let secondary = pick(pool);
        // ensure secondary differs from primary when pool has options
        if (pool.length > 1) {
          while (secondary === color) secondary = pick(pool);
        }
        out.push({
          id: id++,
          x: x + (Math.random() - 0.5) * spread,
          y: y + (Math.random() - 0.5) * (spread * 0.5),
          rotation: Math.random() * 360,
          rotationSpeed: rsMin + Math.random() * (rsMax - rsMin),
          scale: scMin + Math.random() * (scMax - scMin),
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - upBias,
          type,
          color,
          secondaryColor: secondary,
          opacity: 1,
          size: 1,
          wobble: Math.random() * Math.PI * 2,
          wobbleSpeed: 0.1 + Math.random() * 0.15,
        });
      }
    };

    // Confetti rectangles - main shower
    push(40, "confetti-rect", { speed: [7, 14], upBias: 8, spread: 60, scale: [0.7, 1.4] });
    // Round confetti dots
    push(20, "confetti-circle", { speed: [5, 12], upBias: 7, spread: 80, scale: [0.6, 1.3] });
    // Wavy ribbon confetti
    push(14, "confetti-strip", { speed: [4, 9], upBias: 5, spread: 90, scale: [0.7, 1.3], rotSpeed: [-12, 12] });
    // Streamers (long, slow, curling)
    push(8, "streamer", { speed: [3, 7], upBias: 4, spread: 100, scale: [0.8, 1.4], rotSpeed: [-5, 5] });
    // Sparkles
    push(16, "sparkle", { speed: [2, 7], upBias: 3, spread: 130, scale: [0.5, 1.2], rotSpeed: [-3, 3] });
    // Stars
    push(8, "star", { speed: [4, 9], upBias: 5, spread: 110, scale: [0.7, 1.3] });
    // Hearts
    push(6, "heart", { speed: [3, 7], upBias: 4, spread: 100, scale: [0.7, 1.2], colorPool: ["#ff6b9d", "#fb7185", "#ff9ff3", "#feca57"] });
    // Balloons (drift upward)
    for (let i = 0; i < 5; i++) {
      const color = pick(PARTY_COLORS);
      let secondary = pick(PARTY_COLORS);
      while (secondary === color) secondary = pick(PARTY_COLORS);
      out.push({
        id: id++,
        x: x + (Math.random() - 0.5) * 140,
        y: y + (Math.random() - 0.5) * 60,
        rotation: (Math.random() - 0.5) * 20,
        rotationSpeed: (Math.random() - 0.5) * 2,
        scale: 0.9 + Math.random() * 0.6,
        velocityX: (Math.random() - 0.5) * 3,
        velocityY: -4 - Math.random() * 3,
        type: "balloon",
        color,
        secondaryColor: secondary,
        opacity: 1,
        size: 1,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.05 + Math.random() * 0.1,
      });
    }
    // Party horns
    push(4, "partyHorn", { speed: [6, 10], upBias: 6, spread: 70, scale: [0.8, 1.3], rotSpeed: [-15, 15] });
    // Unicorn heads
    push(3, "unicornHead", { speed: [4, 8], upBias: 5, spread: 90, scale: [0.9, 1.4], rotSpeed: [-4, 4] });
    // Mini rainbows
    push(3, "rainbow", { speed: [3, 6], upBias: 4, spread: 120, scale: [0.8, 1.3], rotSpeed: [-3, 3] });

    return out;
  }, [x, y]);

  // Stable handle to the latest onComplete (Grant 2026-05-27 double-fire
  // fix). Consumers pass an inline `onComplete={() => setCelebration(null)}`,
  // a fresh reference every render. The animation handlers do an async
  // tasksApi.update + refetch right after firing; when the refetch lands
  // mid-animation the parent re-renders, onComplete's identity changes,
  // and (when it was in the effect dep array) the spawn effect re-ran,
  // resetting particles + restarting the 3.5s timer. That replayed the
  // burst, which read as the animation "firing twice." Holding
  // onComplete in a ref keeps the spawn effect mount-only so a parent
  // re-render no longer restarts it.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    setParticles(createParticles());

    const interval = setInterval(() => {
      setParticles((prev) =>
        prev
          .map((p) => {
            const isBalloon = p.type === "balloon";
            const isStreamerOrRainbow = p.type === "streamer" || p.type === "rainbow";
            // Lighter gravity for balloons, normal for confetti
            const gravity = isBalloon ? -0.08 : isStreamerOrRainbow ? 0.25 : 0.45;
            // Drag (more for streamer/rainbow for floaty feel)
            const dragX = isStreamerOrRainbow ? 0.97 : 0.99;
            const newWobble = p.wobble + p.wobbleSpeed;
            const wobbleX = isBalloon ? Math.sin(newWobble) * 0.8 : 0;
            return {
              ...p,
              x: p.x + p.velocityX + wobbleX,
              y: p.y + p.velocityY,
              velocityX: p.velocityX * dragX,
              velocityY: p.velocityY + gravity,
              rotation: p.rotation + p.rotationSpeed,
              opacity: Math.max(0, p.opacity - (isBalloon ? 0.008 : 0.012)),
              wobble: newWobble,
            };
          })
          .filter((p) => p.opacity > 0 && p.y < window.innerHeight + 80 && p.y > -200)
      );

      setBurst((prev) => ({
        scale: prev.scale + 14,
        opacity: Math.max(0, prev.opacity - 0.035),
      }));
    }, 25);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      onCompleteRef.current();
    }, 3500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
    // `createParticles` is stable per mount (its only deps are x/y, which
    // are fixed for a given celebration instance, and the component is
    // keyed by nonce so a new burst remounts fresh). onComplete is read
    // through the ref above, so it's intentionally NOT a dep — that's
    // the whole point of the double-fire fix.
  }, [createParticles]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Burst shockwave - pastel pink-yellow gradient ring */}
      <div
        className="absolute rounded-full"
        style={{
          left: x - burst.scale,
          top: y - burst.scale,
          width: burst.scale * 2,
          height: burst.scale * 2,
          opacity: burst.opacity,
          background:
            "radial-gradient(circle, rgba(255,255,255,0) 55%, rgba(255,200,230,0.55) 70%, rgba(254,202,87,0.35) 85%, rgba(255,255,255,0) 100%)",
          border: "2px solid rgba(255, 107, 157, 0.55)",
        }}
      />

      {/* Big rainbow arc behind everything */}
      <div
        className="absolute"
        style={{
          left: x - 130,
          top: y - 110,
          width: 260,
          height: 130,
        }}
      >
        <svg viewBox="0 0 260 130" className="w-full h-full">
          <defs>
            <linearGradient id="big-rainbow" x1="0%" y1="0%" x2="100%" y2="0%">
              {RAINBOW_STOPS.map((stop, i) => (
                <stop
                  key={i}
                  offset={`${(i / (RAINBOW_STOPS.length - 1)) * 100}%`}
                  stopColor={stop}
                />
              ))}
            </linearGradient>
          </defs>
          <path
            d="M 20 130 Q 130 -30 240 130"
            fill="none"
            stroke="url(#big-rainbow)"
            strokeWidth="10"
            strokeLinecap="round"
            opacity="0.75"
          />
          <path
            d="M 20 130 Q 130 -30 240 130"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.4"
          />
        </svg>
      </div>

      {/* Particles */}
      {particles.map((p) => {
        const dims = TYPE_SIZE[p.type];
        return (
          <div
            key={p.id}
            className="absolute"
            style={{
              left: p.x,
              top: p.y,
              width: dims.w,
              height: dims.h,
              opacity: p.opacity,
              transform: `translate(-50%, -50%) rotate(${p.rotation}deg) scale(${p.scale})`,
              willChange: "transform, opacity",
            }}
          >
            <ParticleSvg
              type={p.type}
              color={p.color}
              secondary={p.secondaryColor}
              id={p.id}
            />
          </div>
        );
      })}
    </div>
  );
}
