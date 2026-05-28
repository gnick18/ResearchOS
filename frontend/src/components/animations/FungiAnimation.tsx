"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type FungiParticleType =
  | "amanita"
  | "oyster"
  | "chanterelle"
  | "shelf"
  | "mycelium"
  | "spore"
  | "moss"
  | "fairyRing";

interface FungiParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: FungiParticleType;
  opacity: number;
  /** Primary tint, sampled per particle so each one feels unique. */
  color: string;
  /** Secondary tint, used by particles that need a contrasting stem/edge. */
  accent: string;
  /** Per-particle pulse phase, used by glowing spores. */
  pulse: number;
}

interface SporeCloud {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  velocityY: number;
  hue: string;
}

interface FungiAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

// Earthy palettes, plus glowing spore-blue for the magical accent.
const AMANITA_REDS = ["#D7322B", "#B81E1E", "#E84B3C", "#A41818"];
const OYSTER_CREAMS = ["#E8DFC8", "#D5C8A5", "#F0E6CC", "#C9B98E"];
const CHANTERELLE_GOLDS = ["#E8A53A", "#D08826", "#F2B958", "#B26F1A"];
const SHELF_BROWNS = ["#7A4A2A", "#5D3318", "#8E5A33", "#4A2A14"];
const MYCELIUM_WHITES = ["#F5EFE0", "#E6DCC2", "#FFF8E7", "#D9CBA3"];
const MOSS_GREENS = ["#3F6B2E", "#5A8C3F", "#2E5022", "#7BA552"];
const SPORE_GLOWS = ["#7DD3FC", "#A5E3FF", "#5EC0F0", "#B8EBFF"];

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

export default function FungiAnimation({ x, y, onComplete }: FungiAnimationProps) {
  const [particles, setParticles] = useState<FungiParticle[]>([]);
  const [spores, setSpores] = useState<SporeCloud[]>([]);

  const createParticles = useCallback(() => {
    const newParticles: FungiParticle[] = [];
    let nextId = 0;

    const burst = (
      count: number,
      type: FungiParticleType,
      opts: {
        spread: number;
        minSpeed: number;
        maxSpeed: number;
        upBoost: number;
        minScale: number;
        maxScale: number;
        rotMax: number;
        rotSpeed: number;
        color: () => string;
        accent: () => string;
      },
    ) => {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = opts.minSpeed + Math.random() * (opts.maxSpeed - opts.minSpeed);
        newParticles.push({
          id: nextId++,
          x: x + (Math.random() - 0.5) * opts.spread,
          y: y + (Math.random() - 0.5) * opts.spread,
          rotation: (Math.random() - 0.5) * opts.rotMax,
          scale: opts.minScale + Math.random() * (opts.maxScale - opts.minScale),
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - opts.upBoost,
          rotationSpeed: (Math.random() - 0.5) * opts.rotSpeed,
          type,
          opacity: 1,
          color: opts.color(),
          accent: opts.accent(),
          pulse: Math.random() * Math.PI * 2,
        });
      }
    };

    // Classic red-cap amanitas — the hero particle.
    burst(7, "amanita", {
      spread: 60,
      minSpeed: 3,
      maxSpeed: 7,
      upBoost: 4,
      minScale: 0.55,
      maxScale: 1.05,
      rotMax: 30,
      rotSpeed: 3,
      color: () => pick(AMANITA_REDS),
      accent: () => "#F5E9D0",
    });

    // Oyster fans.
    burst(5, "oyster", {
      spread: 55,
      minSpeed: 2.5,
      maxSpeed: 5.5,
      upBoost: 3,
      minScale: 0.55,
      maxScale: 0.95,
      rotMax: 50,
      rotSpeed: 4,
      color: () => pick(OYSTER_CREAMS),
      accent: () => "#8B6F47",
    });

    // Chanterelle funnels.
    burst(5, "chanterelle", {
      spread: 55,
      minSpeed: 2.8,
      maxSpeed: 6,
      upBoost: 3.5,
      minScale: 0.55,
      maxScale: 1,
      rotMax: 40,
      rotSpeed: 4,
      color: () => pick(CHANTERELLE_GOLDS),
      accent: () => "#7A4A14",
    });

    // Shelf mushrooms on bark.
    burst(4, "shelf", {
      spread: 60,
      minSpeed: 2.2,
      maxSpeed: 5,
      upBoost: 2.5,
      minScale: 0.6,
      maxScale: 1.05,
      rotMax: 35,
      rotSpeed: 3,
      color: () => pick(SHELF_BROWNS),
      accent: () => "#F0E0BA",
    });

    // Mycelium thread tufts.
    burst(6, "mycelium", {
      spread: 70,
      minSpeed: 2,
      maxSpeed: 4.5,
      upBoost: 1.5,
      minScale: 0.6,
      maxScale: 1.1,
      rotMax: 360,
      rotSpeed: 2,
      color: () => pick(MYCELIUM_WHITES),
      accent: () => pick(SPORE_GLOWS),
    });

    // Moss tufts (forest floor).
    burst(4, "moss", {
      spread: 65,
      minSpeed: 1.8,
      maxSpeed: 4,
      upBoost: 1.5,
      minScale: 0.55,
      maxScale: 1,
      rotMax: 25,
      rotSpeed: 2,
      color: () => pick(MOSS_GREENS),
      accent: () => "#1F3A14",
    });

    // Fairy ring — a circle of tiny mushrooms.
    burst(3, "fairyRing", {
      spread: 50,
      minSpeed: 1.6,
      maxSpeed: 3.8,
      upBoost: 2,
      minScale: 0.55,
      maxScale: 0.95,
      rotMax: 25,
      rotSpeed: 1.5,
      color: () => pick(AMANITA_REDS),
      accent: () => "#F5E9D0",
    });

    // Glowing magical spores — the sparkle layer.
    burst(14, "spore", {
      spread: 90,
      minSpeed: 4,
      maxSpeed: 8,
      upBoost: 2,
      minScale: 0.35,
      maxScale: 0.9,
      rotMax: 360,
      rotSpeed: 10,
      color: () => pick(SPORE_GLOWS),
      accent: () => "#FFFFFF",
    });

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

    // Drifting spore cloud rising from the burst point.
    const newSpores: SporeCloud[] = [];
    for (let i = 0; i < 45; i += 1) {
      newSpores.push({
        id: i,
        x: x + (Math.random() - 0.5) * 110,
        y: y + Math.random() * 30,
        size: 2 + Math.random() * 6,
        opacity: 0.75,
        velocityY: -0.4 - Math.random() * 1.6,
        hue: Math.random() < 0.55 ? pick(SPORE_GLOWS) : pick(MYCELIUM_WHITES),
      });
    }
    setSpores(newSpores);

    const interval = setInterval(() => {
      setParticles(prev =>
        prev
          .map(p => ({
            ...p,
            x: p.x + p.velocityX,
            y: p.y + p.velocityY + 0.25,
            velocityY: p.velocityY + 0.1,
            rotation: p.rotation + p.rotationSpeed,
            opacity: Math.max(0, p.opacity - 0.008),
            pulse: p.pulse + 0.18,
          }))
          .filter(p => p.y < window.innerHeight + 100 && p.opacity > 0),
      );

      setSpores(prev =>
        prev
          .map(s => ({
            ...s,
            y: s.y + s.velocityY,
            x: s.x + (Math.random() - 0.5) * 0.6,
            opacity: Math.max(0, s.opacity - 0.006),
          }))
          .filter(s => s.y > -50 && s.opacity > 0),
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

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Rising spore cloud */}
      {spores.map(s => (
        <div
          key={`spore-${s.id}`}
          className="absolute rounded-full"
          style={{
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            backgroundColor: s.hue,
            opacity: s.opacity,
            boxShadow: `0 0 ${s.size * 2}px ${s.hue}`,
          }}
        />
      ))}

      {/* SVG particles */}
      {particles.map(p => {
        const glow = 0.6 + 0.4 * Math.sin(p.pulse);
        return (
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
            {p.type === "amanita" && (
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                {/* stem */}
                <path
                  d="M9.5 13 C9.3 16.2 9.5 18.6 10.1 20 C10.4 20.7 11.1 20.9 12 20.9 C12.9 20.9 13.6 20.7 13.9 20 C14.5 18.6 14.7 16.2 14.5 13 Z"
                  fill={p.accent}
                  stroke="#8B6F47"
                  strokeWidth="0.5"
                />
                {/* ring */}
                <path
                  d="M9.2 13.8 C10.4 14.3 13.6 14.3 14.8 13.8 L14.6 14.9 C13.4 15.4 10.6 15.4 9.4 14.9 Z"
                  fill="#E8D7B3"
                  stroke="#8B6F47"
                  strokeWidth="0.4"
                />
                {/* cap */}
                <path
                  d="M3.3 12.8 C3.3 7.7 7.1 4.5 12 4.5 C16.9 4.5 20.7 7.7 20.7 12.8 C20.7 13.5 20.2 13.9 19.4 13.9 L4.6 13.9 C3.8 13.9 3.3 13.5 3.3 12.8 Z"
                  fill={p.color}
                  stroke="#7A1F1A"
                  strokeWidth="0.6"
                />
                {/* white spots */}
                <circle cx="7.4" cy="10.6" r="1.1" fill="#FFFDF5" />
                <circle cx="11.8" cy="7.8" r="1.3" fill="#FFFDF5" />
                <circle cx="15.7" cy="11" r="1" fill="#FFFDF5" />
                <circle cx="13.4" cy="11.7" r="0.55" fill="#FFFDF5" />
                <circle cx="9.4" cy="8.4" r="0.5" fill="#FFFDF5" />
              </svg>
            )}

            {p.type === "oyster" && (
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                {/* fan-shaped clusters */}
                <path
                  d="M4 14 C4 9 8 5.5 13 6 C18 6.5 20 9 20 12 C20 14 18 14.6 14 14.4 C10 14.2 7 15 5 15.4 C4.3 15.5 4 14.8 4 14 Z"
                  fill={p.color}
                  stroke={p.accent}
                  strokeWidth="0.5"
                />
                <path
                  d="M5 17 C5 14 8 12 12 12 C16 12 18 13.5 18 15.5 C18 17 16 17.5 13 17.4 C10 17.3 7 17.8 6 18 C5.4 18.1 5 17.6 5 17 Z"
                  fill={p.color}
                  stroke={p.accent}
                  strokeWidth="0.5"
                  opacity="0.85"
                />
                {/* gill lines */}
                <path d="M7 9 L9 14" stroke={p.accent} strokeWidth="0.4" opacity="0.6" />
                <path d="M10 8 L11 14" stroke={p.accent} strokeWidth="0.4" opacity="0.6" />
                <path d="M13 8 L13.5 14" stroke={p.accent} strokeWidth="0.4" opacity="0.6" />
                <path d="M16 9 L15.5 14" stroke={p.accent} strokeWidth="0.4" opacity="0.6" />
              </svg>
            )}

            {p.type === "chanterelle" && (
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                {/* funnel cap with wavy edge */}
                <path
                  d="M4 9 Q6 6 8 8 Q10 5 12 7 Q14 5 16 8 Q18 6 20 9 L17 18 Q12 21 7 18 Z"
                  fill={p.color}
                  stroke={p.accent}
                  strokeWidth="0.6"
                  strokeLinejoin="round"
                />
                {/* ridge highlights */}
                <path d="M8 9 L10 17" stroke={p.accent} strokeWidth="0.5" opacity="0.55" />
                <path d="M12 8.5 L12 18" stroke={p.accent} strokeWidth="0.5" opacity="0.55" />
                <path d="M16 9 L14 17" stroke={p.accent} strokeWidth="0.5" opacity="0.55" />
                {/* warm sheen */}
                <path
                  d="M7 9 Q11 7 16 9"
                  stroke="#FFE3A0"
                  strokeWidth="0.7"
                  opacity="0.6"
                  fill="none"
                />
              </svg>
            )}

            {p.type === "shelf" && (
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                {/* bark slab */}
                <path
                  d="M3 16 Q4 14 5 15 Q7 13 9 14 L20 14 L20 19 L3 19 Z"
                  fill="#3E2618"
                  stroke="#1F1208"
                  strokeWidth="0.5"
                />
                <path d="M5 15.5 L19 15.5" stroke="#5A3820" strokeWidth="0.3" opacity="0.7" />
                <path d="M5 17 L19 17" stroke="#5A3820" strokeWidth="0.3" opacity="0.5" />
                {/* shelf brackets growing on bark */}
                <path
                  d="M5 14 Q7 9 11 10 Q14 10.5 12 14 Z"
                  fill={p.color}
                  stroke="#2A1808"
                  strokeWidth="0.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 14 Q14 8 18 9.5 Q20 10 18 14 Z"
                  fill={p.color}
                  stroke="#2A1808"
                  strokeWidth="0.5"
                  strokeLinejoin="round"
                  opacity="0.92"
                />
                {/* growth rings on shelves */}
                <path d="M6.5 13 Q9 11 11.5 13" stroke={p.accent} strokeWidth="0.35" fill="none" opacity="0.7" />
                <path d="M13 13 Q15.5 10.8 17.8 13" stroke={p.accent} strokeWidth="0.35" fill="none" opacity="0.7" />
              </svg>
            )}

            {p.type === "mycelium" && (
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                {/* wispy hyphal web */}
                <path
                  d="M2 18 Q6 13 10 15 Q14 17 18 13 Q20 11 22 12"
                  stroke={p.color}
                  strokeWidth="1.1"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M3 14 Q7 9 12 11 Q16 13 21 9"
                  stroke={p.color}
                  strokeWidth="0.8"
                  fill="none"
                  opacity="0.8"
                  strokeLinecap="round"
                />
                <path
                  d="M5 21 Q8 17 12 18 Q15 19 19 17"
                  stroke={p.color}
                  strokeWidth="0.7"
                  fill="none"
                  opacity="0.7"
                  strokeLinecap="round"
                />
                <path
                  d="M8 6 Q10 9 9 14"
                  stroke={p.color}
                  strokeWidth="0.6"
                  fill="none"
                  opacity="0.6"
                  strokeLinecap="round"
                />
                <path
                  d="M16 5 Q14 9 16 14"
                  stroke={p.color}
                  strokeWidth="0.6"
                  fill="none"
                  opacity="0.6"
                  strokeLinecap="round"
                />
                {/* nodes glowing along the threads */}
                <circle cx="10" cy="15" r="1" fill={p.accent} opacity={glow} />
                <circle cx="18" cy="13" r="0.85" fill={p.accent} opacity={glow} />
                <circle cx="6" cy="13.5" r="0.7" fill={p.accent} opacity={glow * 0.8} />
                <circle cx="14" cy="11.5" r="0.6" fill={p.accent} opacity={glow * 0.8} />
              </svg>
            )}

            {p.type === "moss" && (
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                {/* moss tuft mound */}
                <ellipse cx="12" cy="17" rx="9" ry="3" fill={p.accent} opacity="0.5" />
                <path
                  d="M3 18 Q5 12 8 14 Q10 9 12 13 Q14 8 16 13 Q19 10 21 17 Z"
                  fill={p.color}
                  stroke={p.accent}
                  strokeWidth="0.5"
                  strokeLinejoin="round"
                />
                {/* tiny moss fronds */}
                <path d="M6 15 L6 12" stroke={p.accent} strokeWidth="0.5" strokeLinecap="round" />
                <path d="M9 13 L9 9" stroke={p.accent} strokeWidth="0.5" strokeLinecap="round" />
                <path d="M12 12 L12 7.5" stroke={p.accent} strokeWidth="0.5" strokeLinecap="round" />
                <path d="M15 12.5 L15 8.5" stroke={p.accent} strokeWidth="0.5" strokeLinecap="round" />
                <path d="M18 14 L18 11" stroke={p.accent} strokeWidth="0.5" strokeLinecap="round" />
                {/* dew highlights */}
                <circle cx="9" cy="14" r="0.5" fill="#B8EBFF" opacity="0.8" />
                <circle cx="15" cy="13.5" r="0.45" fill="#B8EBFF" opacity="0.8" />
              </svg>
            )}

            {p.type === "fairyRing" && (
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                {/* ring of grass */}
                <ellipse
                  cx="12"
                  cy="13"
                  rx="9"
                  ry="3"
                  fill="none"
                  stroke="#3F6B2E"
                  strokeWidth="0.6"
                  opacity="0.55"
                  strokeDasharray="1 1.5"
                />
                {/* eight tiny mushrooms around the ring */}
                {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
                  const a = (i / 8) * Math.PI * 2;
                  const cx = 12 + Math.cos(a) * 8.2;
                  const cy = 13 + Math.sin(a) * 2.8;
                  return (
                    <g key={i} transform={`translate(${cx} ${cy})`}>
                      <rect x="-0.5" y="0" width="1" height="2.2" fill={p.accent} />
                      <ellipse cx="0" cy="0" rx="1.7" ry="1.2" fill={p.color} />
                      <circle cx="-0.4" cy="-0.2" r="0.25" fill="#FFFDF5" />
                      <circle cx="0.5" cy="-0.4" r="0.25" fill="#FFFDF5" />
                    </g>
                  );
                })}
                {/* faint spore halo at center */}
                <circle cx="12" cy="13" r="3" fill="#7DD3FC" opacity={0.1 + 0.1 * glow} />
              </svg>
            )}

            {p.type === "spore" && (
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                {/* outer glow halo */}
                <circle cx="12" cy="12" r="9" fill={p.color} opacity={0.18 * glow} />
                <circle cx="12" cy="12" r="6" fill={p.color} opacity={0.3 * glow} />
                {/* inner luminous body */}
                <circle cx="12" cy="12" r="3" fill={p.color} opacity="0.95" />
                <circle cx="11.2" cy="11.2" r="1.4" fill="#FFFFFF" opacity="0.75" />
                {/* twinkle cross */}
                <path
                  d="M12 4 L12 7 M12 17 L12 20 M4 12 L7 12 M17 12 L20 12"
                  stroke="#FFFFFF"
                  strokeWidth="0.55"
                  opacity={0.6 * glow}
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
