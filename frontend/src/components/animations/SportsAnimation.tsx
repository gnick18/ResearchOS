"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type SportsParticleType =
  | "soccer"
  | "basketball"
  | "football"
  | "tennis"
  | "baseball"
  | "golf"
  | "trophy"
  | "medalGold"
  | "medalSilver"
  | "medalBronze"
  | "whistle"
  | "stopwatch"
  | "megaphone"
  | "confetti";

interface SportsParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: SportsParticleType;
  opacity: number;
  hue: number;
}

interface SportsAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

// ----------------------------------------------------------------------------
// Custom SVG particle components
// ----------------------------------------------------------------------------
// Each particle renders inside a 40x40 box at viewBox 24x24. Designs use bold
// strokes + a hint of gradient so they stay legible at small sizes. IDs are
// suffixed with the particle id (or a unique seed) only where multiple
// instances coexist; otherwise CSS isolation via per-particle inline gradients
// is fine because gradient defs are scoped to each <svg>.

const SoccerBall = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <circle cx="12" cy="12" r="10.2" fill="#ffffff" stroke="#0a0a0a" strokeWidth="1.1" />
    {/* center pentagon */}
    <path d="M12 7.7l3.6 2.6-1.4 4.2h-4.4l-1.4-4.2L12 7.7z" fill="#0a0a0a" />
    {/* spokes to outer black tips */}
    <path d="M12 7.7L12 3.5" stroke="#0a0a0a" strokeWidth="1.1" strokeLinecap="round" />
    <path d="M15.6 10.3L19.4 8.6" stroke="#0a0a0a" strokeWidth="1.1" strokeLinecap="round" />
    <path d="M14.2 14.5l2.5 3.4" stroke="#0a0a0a" strokeWidth="1.1" strokeLinecap="round" />
    <path d="M9.8 14.5l-2.5 3.4" stroke="#0a0a0a" strokeWidth="1.1" strokeLinecap="round" />
    <path d="M8.4 10.3L4.6 8.6" stroke="#0a0a0a" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
);

const Basketball = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <defs>
      <radialGradient id="bball-grad" cx="35%" cy="32%" r="75%">
        <stop offset="0%" stopColor="#ffb27d" />
        <stop offset="55%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#9a3412" />
      </radialGradient>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#bball-grad)" stroke="#3b0a02" strokeWidth="0.9" />
    {/* seams */}
    <path d="M12 2v20" stroke="#1a0500" strokeWidth="1.1" />
    <path d="M2 12h20" stroke="#1a0500" strokeWidth="1.1" />
    <path d="M4.2 6.4c4.2 3.1 11.4 3.1 15.6 0" stroke="#1a0500" strokeWidth="1.1" fill="none" />
    <path d="M4.2 17.6c4.2-3.1 11.4-3.1 15.6 0" stroke="#1a0500" strokeWidth="1.1" fill="none" />
    {/* highlight */}
    <ellipse cx="8.5" cy="8" rx="2" ry="1.2" fill="#fff" opacity="0.35" />
  </svg>
);

const Football = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <defs>
      <linearGradient id="football-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#a0522d" />
        <stop offset="100%" stopColor="#5b2208" />
      </linearGradient>
    </defs>
    <ellipse cx="12" cy="12" rx="9.5" ry="5.5" fill="url(#football-grad)" stroke="#2a0e02" strokeWidth="0.9" transform="rotate(-25 12 12)" />
    {/* laces panel */}
    <path d="M9 12.7l6-1.4" stroke="#fff8e7" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M10 11.3l4 1.4" stroke="#fff8e7" strokeWidth="0.6" opacity="0.6" />
    {/* lace ticks */}
    <path d="M10.2 12.2v.9M11.4 12v.9M12.6 11.8v.9M13.8 11.6v.9" stroke="#fff8e7" strokeWidth="0.9" strokeLinecap="round" />
    {/* tips */}
    <path d="M3.5 9.4l2.4 1.6M3.5 13.7l2.4-1.6" stroke="#fff8e7" strokeWidth="0.6" />
    <path d="M20.5 14.6l-2.4-1.6M20.5 10.3l-2.4 1.6" stroke="#fff8e7" strokeWidth="0.6" />
  </svg>
);

const TennisBall = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <defs>
      <radialGradient id="tball-grad" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#e9ff7c" />
        <stop offset="100%" stopColor="#8db500" />
      </radialGradient>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#tball-grad)" stroke="#3f5a00" strokeWidth="0.7" />
    <path d="M3 8.5C7.5 11 16.5 11 21 8.5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <path d="M3 15.5C7.5 13 16.5 13 21 15.5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
  </svg>
);

const Baseball = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <circle cx="12" cy="12" r="10" fill="#fff" stroke="#2b2b2b" strokeWidth="0.9" />
    {/* curved stitch arcs */}
    <path d="M5 5.5C8 9 8 15 5 18.5" stroke="#dc2626" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    <path d="M19 5.5c-3 3.5-3 9.5 0 13" stroke="#dc2626" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    {/* stitch ticks */}
    <path d="M6.4 7.2l-1 .5M6 9.5l-1.3.2M6 12l-1.3-.2M6 14.5l-1.3-.2M6.4 16.8l-1-.5" stroke="#dc2626" strokeWidth="0.7" strokeLinecap="round" />
    <path d="M17.6 7.2l1 .5M18 9.5l1.3.2M18 12l1.3-.2M18 14.5l1.3-.2M17.6 16.8l1-.5" stroke="#dc2626" strokeWidth="0.7" strokeLinecap="round" />
  </svg>
);

const GolfBall = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <circle cx="12" cy="12" r="10" fill="#fafafa" stroke="#0a0a0a" strokeWidth="0.6" />
    {/* dimples */}
    {[
      [8, 7], [12, 6], [16, 7],
      [7, 11], [12, 10], [17, 11],
      [8, 15], [12, 14.5], [16, 15],
      [10, 18], [14, 18],
    ].map(([cx, cy], i) => (
      <circle key={i} cx={cx} cy={cy} r="0.85" fill="#cbd5e1" />
    ))}
  </svg>
);

const Trophy = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <defs>
      <linearGradient id="trophy-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fde047" />
        <stop offset="55%" stopColor="#facc15" />
        <stop offset="100%" stopColor="#a16207" />
      </linearGradient>
    </defs>
    {/* handles */}
    <path d="M7 5.5C4.5 5.5 3 7 3 9c0 2 1.5 3.5 4 3.5" stroke="url(#trophy-grad)" strokeWidth="1.7" fill="none" strokeLinecap="round" />
    <path d="M17 5.5c2.5 0 4 1.5 4 3.5 0 2-1.5 3.5-4 3.5" stroke="url(#trophy-grad)" strokeWidth="1.7" fill="none" strokeLinecap="round" />
    {/* cup */}
    <path d="M6.5 3h11v6.5c0 3.04-2.46 5.5-5.5 5.5S6.5 12.54 6.5 9.5V3Z" fill="url(#trophy-grad)" stroke="#7c2d12" strokeWidth="0.8" strokeLinejoin="round" />
    {/* star */}
    <path d="M12 6l1 2 2.2.3-1.6 1.55.38 2.2L12 11l-1.98 1.05.38-2.2L8.8 8.3 11 8l1-2Z" fill="#fff" stroke="#7c2d12" strokeWidth="0.4" />
    {/* stem + base */}
    <rect x="10.6" y="15" width="2.8" height="2.8" fill="url(#trophy-grad)" stroke="#7c2d12" strokeWidth="0.7" />
    <rect x="7" y="17.6" width="10" height="3.1" rx="0.7" fill="url(#trophy-grad)" stroke="#7c2d12" strokeWidth="0.9" />
  </svg>
);

const Medal = ({ tier }: { tier: "gold" | "silver" | "bronze" }) => {
  const palette = {
    gold: { top: "#fde047", mid: "#facc15", bot: "#a16207", stroke: "#7c2d12", label: "1" },
    silver: { top: "#f1f5f9", mid: "#cbd5e1", bot: "#64748b", stroke: "#1e293b", label: "2" },
    bronze: { top: "#fcd9a8", mid: "#d97706", bot: "#7c2d12", stroke: "#451a03", label: "3" },
  }[tier];
  const gradId = `medal-grad-${tier}`;
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.top} />
          <stop offset="55%" stopColor={palette.mid} />
          <stop offset="100%" stopColor={palette.bot} />
        </linearGradient>
      </defs>
      {/* ribbon (left + right triangle pieces) */}
      <path d="M7 2l3 6 2-1V2H7Z" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.4" />
      <path d="M17 2l-3 6-2-1V2h5Z" fill="#1d4ed8" stroke="#1e3a8a" strokeWidth="0.4" />
      {/* disc */}
      <circle cx="12" cy="15.5" r="6.4" fill={`url(#${gradId})`} stroke={palette.stroke} strokeWidth="0.9" />
      <circle cx="12" cy="15.5" r="4.1" fill={palette.mid} stroke={palette.stroke} strokeWidth="0.5" opacity="0.85" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="5.5"
        fontWeight="800"
        fill={palette.stroke}
        fontFamily="system-ui, sans-serif"
      >
        {palette.label}
      </text>
    </svg>
  );
};

const Whistle = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <defs>
      <linearGradient id="whistle-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fb923c" />
        <stop offset="100%" stopColor="#c2410c" />
      </linearGradient>
    </defs>
    {/* lanyard */}
    <path d="M3 4c2 1 5 2 7 4" stroke="#0f172a" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    {/* body */}
    <ellipse cx="13" cy="13" rx="6.5" ry="4.6" fill="url(#whistle-grad)" stroke="#7c2d12" strokeWidth="0.8" />
    {/* mouthpiece */}
    <rect x="18.4" y="11.3" width="3.3" height="3.4" rx="0.6" fill="url(#whistle-grad)" stroke="#7c2d12" strokeWidth="0.8" />
    {/* hole */}
    <circle cx="10.5" cy="13" r="1.6" fill="#0f172a" />
    {/* ring */}
    <circle cx="9" cy="8.7" r="1.1" fill="none" stroke="#0f172a" strokeWidth="0.9" />
  </svg>
);

const Stopwatch = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <defs>
      <radialGradient id="watch-grad" cx="40%" cy="40%" r="65%">
        <stop offset="0%" stopColor="#fff" />
        <stop offset="100%" stopColor="#cbd5e1" />
      </radialGradient>
    </defs>
    {/* top button */}
    <rect x="11" y="2.5" width="2" height="2" fill="#1e293b" />
    {/* lugs / strap tabs */}
    <rect x="9.5" y="4" width="5" height="1.6" rx="0.4" fill="#1e293b" />
    {/* case */}
    <circle cx="12" cy="14" r="8" fill="url(#watch-grad)" stroke="#1e293b" strokeWidth="1.1" />
    {/* tick marks */}
    {Array.from({ length: 12 }).map((_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const x1 = 12 + Math.cos(a) * 7;
      const y1 = 14 + Math.sin(a) * 7;
      const x2 = 12 + Math.cos(a) * 6;
      const y2 = 14 + Math.sin(a) * 6;
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1e293b" strokeWidth="0.8" strokeLinecap="round" />;
    })}
    {/* hands */}
    <line x1="12" y1="14" x2="12" y2="9" stroke="#dc2626" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="12" y1="14" x2="15.5" y2="14" stroke="#0f172a" strokeWidth="1" strokeLinecap="round" />
    <circle cx="12" cy="14" r="0.9" fill="#dc2626" />
  </svg>
);

const Megaphone = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <defs>
      <linearGradient id="mega-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#f87171" />
        <stop offset="100%" stopColor="#b91c1c" />
      </linearGradient>
    </defs>
    {/* horn */}
    <path d="M3 10v4l4 1.4 11 4V4.6L7 8.6 3 10Z" fill="url(#mega-grad)" stroke="#450a0a" strokeWidth="0.9" strokeLinejoin="round" />
    {/* mouthpiece */}
    <rect x="18" y="8.5" width="2.6" height="7" rx="0.6" fill="#1f2937" stroke="#0f172a" strokeWidth="0.6" />
    {/* sound bursts */}
    <path d="M21.5 7.5l1.5-1M21.5 12h1.8M21.5 16.5l1.5 1" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const Confetti = ({ hue }: { hue: number }) => (
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
    <rect
      x="9"
      y="2"
      width="6"
      height="20"
      rx="1.2"
      fill={`hsl(${hue}, 90%, 58%)`}
      stroke={`hsl(${hue}, 70%, 30%)`}
      strokeWidth="0.6"
      transform="rotate(15 12 12)"
    />
  </svg>
);

// ----------------------------------------------------------------------------
// Animation component
// ----------------------------------------------------------------------------

const PARTICLE_PLAN: Array<{ type: SportsParticleType; count: number; speed: [number, number]; lift: number; scale: [number, number]; spread: number; rotSpeed: number }> = [
  { type: "soccer",      count: 5, speed: [6, 14], lift: 6, scale: [0.6, 1.1], spread: 50, rotSpeed: 15 },
  { type: "basketball",  count: 5, speed: [5, 12], lift: 5, scale: [0.6, 1.1], spread: 60, rotSpeed: 14 },
  { type: "football",    count: 4, speed: [7, 15], lift: 7, scale: [0.6, 1.0], spread: 40, rotSpeed: 22 },
  { type: "tennis",      count: 5, speed: [6, 14], lift: 5, scale: [0.45, 0.85], spread: 70, rotSpeed: 18 },
  { type: "baseball",    count: 4, speed: [5, 12], lift: 5, scale: [0.5, 0.95], spread: 55, rotSpeed: 16 },
  { type: "golf",        count: 4, speed: [4, 11], lift: 4, scale: [0.4, 0.75], spread: 80, rotSpeed: 10 },
  { type: "trophy",      count: 4, speed: [4, 9], lift: 9, scale: [0.75, 1.25], spread: 60, rotSpeed: 5 },
  { type: "medalGold",   count: 3, speed: [4, 10], lift: 4, scale: [0.55, 0.95], spread: 80, rotSpeed: 9 },
  { type: "medalSilver", count: 2, speed: [4, 10], lift: 4, scale: [0.5, 0.9], spread: 80, rotSpeed: 9 },
  { type: "medalBronze", count: 2, speed: [4, 10], lift: 4, scale: [0.5, 0.9], spread: 80, rotSpeed: 9 },
  { type: "whistle",     count: 3, speed: [3, 8], lift: 3, scale: [0.65, 1.05], spread: 50, rotSpeed: 8 },
  { type: "stopwatch",   count: 2, speed: [3, 8], lift: 4, scale: [0.65, 1.0], spread: 50, rotSpeed: 6 },
  { type: "megaphone",   count: 2, speed: [4, 10], lift: 5, scale: [0.7, 1.1], spread: 50, rotSpeed: 7 },
  { type: "confetti",    count: 18, speed: [4, 13], lift: 6, scale: [0.45, 0.95], spread: 90, rotSpeed: 26 },
];

const renderParticle = (type: SportsParticleType, hue: number) => {
  switch (type) {
    case "soccer":      return <SoccerBall />;
    case "basketball":  return <Basketball />;
    case "football":    return <Football />;
    case "tennis":      return <TennisBall />;
    case "baseball":    return <Baseball />;
    case "golf":        return <GolfBall />;
    case "trophy":      return <Trophy />;
    case "medalGold":   return <Medal tier="gold" />;
    case "medalSilver": return <Medal tier="silver" />;
    case "medalBronze": return <Medal tier="bronze" />;
    case "whistle":     return <Whistle />;
    case "stopwatch":   return <Stopwatch />;
    case "megaphone":   return <Megaphone />;
    case "confetti":    return <Confetti hue={hue} />;
  }
};

export default function SportsAnimation({ x, y, onComplete }: SportsAnimationProps) {
  const [particles, setParticles] = useState<SportsParticle[]>([]);
  const [shockwave, setShockwave] = useState({ scale: 0, opacity: 0.8 });
  const [shockwave2, setShockwave2] = useState({ scale: 0, opacity: 0.6 });

  const createParticles = useCallback(() => {
    const newParticles: SportsParticle[] = [];
    let nextId = 0;
    for (const plan of PARTICLE_PLAN) {
      for (let i = 0; i < plan.count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = plan.speed[0] + Math.random() * (plan.speed[1] - plan.speed[0]);
        newParticles.push({
          id: nextId++,
          x: x + (Math.random() - 0.5) * plan.spread,
          y: y + (Math.random() - 0.5) * plan.spread,
          rotation: Math.random() * 360,
          scale: plan.scale[0] + Math.random() * (plan.scale[1] - plan.scale[0]),
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed - plan.lift,
          rotationSpeed: (Math.random() - 0.5) * plan.rotSpeed,
          type: plan.type,
          opacity: 1,
          hue: Math.floor(Math.random() * 360),
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

    const interval = setInterval(() => {
      setParticles(prev =>
        prev.map(p => ({
          ...p,
          x: p.x + p.velocityX,
          y: p.y + p.velocityY + 0.8,
          velocityY: p.velocityY + 0.4,
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.012),
        })).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );

      setShockwave(prev => ({
        scale: prev.scale + 18,
        opacity: Math.max(0, prev.opacity - 0.04),
      }));
      setShockwave2(prev => ({
        scale: prev.scale + 12,
        opacity: Math.max(0, prev.opacity - 0.035),
      }));
    }, 25);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      onCompleteRef.current();
    }, 2800);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
    // onComplete is read via the ref above, so it is intentionally NOT a dep
    // here (that re-run was the mid-animation double-fire). Keep createParticles,
    // which is stable for a given celebration instance.
  }, [createParticles]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Primary green shockwave (sports color) */}
      <div
        className="absolute rounded-full border-4 border-green-500"
        style={{
          left: x - shockwave.scale,
          top: y - shockwave.scale,
          width: shockwave.scale * 2,
          height: shockwave.scale * 2,
          opacity: shockwave.opacity,
          boxShadow: "0 0 30px rgba(16, 185, 129, 0.4)",
        }}
      />
      {/* Secondary gold shockwave — victory accent */}
      <div
        className="absolute rounded-full border-[3px] border-yellow-400"
        style={{
          left: x - shockwave2.scale,
          top: y - shockwave2.scale,
          width: shockwave2.scale * 2,
          height: shockwave2.scale * 2,
          opacity: shockwave2.opacity,
        }}
      />

      {/* Custom SVG particles */}
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
            filter: p.type === "trophy" || p.type.startsWith("medal")
              ? "drop-shadow(0 0 6px rgba(250, 204, 21, 0.55))"
              : undefined,
          }}
        >
          {renderParticle(p.type, p.hue)}
        </div>
      ))}
    </div>
  );
}
