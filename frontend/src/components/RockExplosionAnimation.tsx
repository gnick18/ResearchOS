"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface RockPiece {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type:
    | "guitar"
    | "rockhand"
    | "amp"
    | "fire"
    | "lightning"
    | "vinyl"
    | "skull"
    | "shatter"
    | "string";
  opacity: number;
}

// Custom-SVG particle layer (replaces the old emoji particles). Keeps
// independent physics so we don't disturb the main pieces array.
interface SvgParticle {
  id: number;
  kind:
    | "boltSmall"
    | "skullFire"
    | "horns"
    | "vinyl"
    | "ampMini"
    | "shard"
    | "guitarPick"
    | "flame";
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  rotation: number;
  scale: number;
  opacity: number;
}

interface RockExplosionAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const SVG_KINDS: SvgParticle["kind"][] = [
  "boltSmall",
  "skullFire",
  "horns",
  "vinyl",
  "ampMini",
  "shard",
  "guitarPick",
  "flame",
];

// ---------- Reusable inline SVG particle components ----------

interface PieceSvgProps {
  uid: number; // unique gradient id namespace
}

function GuitarSvg({ uid }: PieceSvgProps) {
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full">
      <defs>
        <linearGradient id={`gbody-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#3a0a0a" />
        </linearGradient>
      </defs>
      {/* Neck */}
      <rect
        x="22"
        y="6"
        width="4"
        height="16"
        fill="#2a1a0a"
        stroke="#000"
        strokeWidth="1"
        transform="rotate(35 24 14)"
      />
      {/* Frets */}
      <g stroke="#c0c0c0" strokeWidth="0.6">
        <line x1="22" y1="10" x2="26" y2="10" transform="rotate(35 24 14)" />
        <line x1="22" y1="13" x2="26" y2="13" transform="rotate(35 24 14)" />
        <line x1="22" y1="16" x2="26" y2="16" transform="rotate(35 24 14)" />
      </g>
      {/* Flying-V body */}
      <path
        d="M8 22 L14 30 L18 24 L22 30 L28 22 L20 16 Z"
        fill={`url(#gbody-${uid})`}
        stroke="#ff1a00"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* Pickup */}
      <rect x="16" y="20" width="6" height="1.6" fill="#c0c0c0" />
      {/* Strings */}
      <line x1="11" y1="26" x2="28" y2="9" stroke="#ffe600" strokeWidth="0.4" />
      <line x1="13" y1="27" x2="30" y2="10" stroke="#ffe600" strokeWidth="0.4" />
    </svg>
  );
}

function RockHandSvg() {
  // Devil-horns / \m/ silhouette
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full">
      <path
        d="M12 6 L12 22 M28 6 L28 22 M18 12 L18 22 M22 12 L22 22 M14 22 Q14 32 20 34 Q26 32 26 22 L14 22 Z"
        fill="#1a1a1a"
        stroke="#ffe600"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Wristband */}
      <rect x="13" y="30" width="14" height="3" fill="#ff1a00" stroke="#000" strokeWidth="0.6" />
      <rect x="15" y="30.5" width="1" height="2" fill="#ffe600" />
      <rect x="19" y="30.5" width="1" height="2" fill="#ffe600" />
      <rect x="23" y="30.5" width="1" height="2" fill="#ffe600" />
    </svg>
  );
}

function AmpSvg({ uid }: PieceSvgProps) {
  // Exploding stack amp
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full">
      <defs>
        <radialGradient id={`amp-${uid}`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffe600" />
          <stop offset="40%" stopColor="#ff6a00" />
          <stop offset="100%" stopColor="#1a0000" />
        </radialGradient>
      </defs>
      {/* Body */}
      <rect x="8" y="14" width="24" height="20" fill="#1a1a1a" stroke="#000" strokeWidth="1" />
      {/* Speaker cones */}
      <circle cx="15" cy="24" r="4" fill={`url(#amp-${uid})`} stroke="#000" strokeWidth="0.6" />
      <circle cx="25" cy="24" r="4" fill={`url(#amp-${uid})`} stroke="#000" strokeWidth="0.6" />
      <circle cx="15" cy="24" r="1" fill="#000" />
      <circle cx="25" cy="24" r="1" fill="#000" />
      {/* Top panel with knobs */}
      <rect x="8" y="10" width="24" height="5" fill="#2a2a2a" stroke="#000" strokeWidth="0.6" />
      <circle cx="13" cy="12.5" r="0.9" fill="#ff1a00" />
      <circle cx="17" cy="12.5" r="0.9" fill="#ffe600" />
      <circle cx="21" cy="12.5" r="0.9" fill="#ff1a00" />
      <circle cx="25" cy="12.5" r="0.9" fill="#ffe600" />
      <circle cx="29" cy="12.5" r="0.9" fill="#ff1a00" />
      {/* Lightning crack */}
      <path d="M20 6 L17 14 L21 14 L18 22" stroke="#ffe600" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function FireSvg({ uid }: PieceSvgProps) {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <defs>
        <linearGradient id={`fire-${uid}`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#ff0000" />
          <stop offset="50%" stopColor="#ff6600" />
          <stop offset="100%" stopColor="#ffcc00" />
        </linearGradient>
      </defs>
      <path
        d="M12 2C12 2 8 8 8 12C8 16 10 18 12 22C14 18 16 16 16 12C16 8 12 2 12 2Z"
        fill={`url(#fire-${uid})`}
      />
      <path
        d="M12 8C12 8 10 11 10 13C10 15 11 16 12 18C13 16 14 15 14 13C14 11 12 8 12 8Z"
        fill="#ffff66"
        opacity="0.9"
      />
    </svg>
  );
}

function LightningSvg({ uid }: PieceSvgProps) {
  // Jagged bold bolt with halo
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full">
      <defs>
        <linearGradient id={`bolt-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#ffe600" />
          <stop offset="100%" stopColor="#ff8a00" />
        </linearGradient>
      </defs>
      {/* Glow */}
      <path
        d="M22 2 L8 22 L17 22 L14 38 L32 16 L22 16 L26 2 Z"
        fill="#ffe600"
        opacity="0.25"
        transform="scale(1.15) translate(-3 -3)"
      />
      {/* Bolt */}
      <path
        d="M22 2 L8 22 L17 22 L14 38 L32 16 L22 16 L26 2 Z"
        fill={`url(#bolt-${uid})`}
        stroke="#ff1a00"
        strokeWidth="1"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function VinylSvg() {
  // Shattered vinyl record
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full">
      <circle cx="20" cy="20" r="16" fill="#0a0a0a" stroke="#1a1a1a" strokeWidth="0.6" />
      <circle cx="20" cy="20" r="13" fill="none" stroke="#222" strokeWidth="0.5" />
      <circle cx="20" cy="20" r="10" fill="none" stroke="#222" strokeWidth="0.5" />
      <circle cx="20" cy="20" r="7" fill="none" stroke="#222" strokeWidth="0.5" />
      <circle cx="20" cy="20" r="5" fill="#ff1a00" stroke="#000" strokeWidth="0.5" />
      <circle cx="20" cy="20" r="1.2" fill="#000" />
      {/* Shine highlight */}
      <path
        d="M10 12 Q14 8 22 8"
        stroke="#ffffff"
        strokeWidth="0.6"
        fill="none"
        opacity="0.5"
      />
    </svg>
  );
}

function SkullSvg({ uid }: PieceSvgProps) {
  // Flaming skull
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full">
      <defs>
        <linearGradient id={`skullflame-${uid}`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#ff1a00" />
          <stop offset="100%" stopColor="#ffe600" />
        </linearGradient>
      </defs>
      {/* Flames above */}
      <path
        d="M10 14 Q12 6 16 10 Q18 4 20 10 Q22 4 24 10 Q28 6 30 14 Z"
        fill={`url(#skullflame-${uid})`}
      />
      {/* Cranium */}
      <ellipse cx="20" cy="20" rx="11" ry="10" fill="#f0f0f0" stroke="#000" strokeWidth="1" />
      {/* Jaw */}
      <path
        d="M12 24 Q12 32 20 33 Q28 32 28 24 Z"
        fill="#f0f0f0"
        stroke="#000"
        strokeWidth="1"
      />
      {/* Eye sockets (burning) */}
      <ellipse cx="15.5" cy="20" rx="2.6" ry="2.8" fill="#000" />
      <ellipse cx="24.5" cy="20" rx="2.6" ry="2.8" fill="#000" />
      <circle cx="15.5" cy="20.5" r="1" fill="#ff6a00" />
      <circle cx="24.5" cy="20.5" r="1" fill="#ff6a00" />
      {/* Nasal */}
      <path d="M20 22 L18.6 25 L21.4 25 Z" fill="#000" />
      {/* Teeth */}
      <path d="M14 28 L14 31 M17 28 L17 31 M20 28 L20 31 M23 28 L23 31 M26 28 L26 31"
        stroke="#000" strokeWidth="0.9" />
    </svg>
  );
}

function ShatterSvg() {
  // Shattered glass shard
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full">
      <polygon
        points="6,30 18,8 26,18 22,32"
        fill="#e0f7ff"
        stroke="#ffffff"
        strokeWidth="1"
        opacity="0.9"
      />
      <polyline
        points="6,30 18,8 26,18"
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.7"
        opacity="0.9"
      />
    </svg>
  );
}

function BrokenStringSvg() {
  // Snapped guitar string with curl
  return (
    <svg viewBox="0 0 40 40" className="w-full h-full">
      <path
        d="M2 20 Q12 12 20 20 T38 20"
        fill="none"
        stroke="#ffe600"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M30 20 Q34 16 36 24"
        fill="none"
        stroke="#ffe600"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Smaller particle SVGs for the secondary layer

function SmallBolt() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <path
        d="M13 2 L4 14 L11 14 L9 22 L20 10 L13 10 L15 2 Z"
        fill="#ffe600"
        stroke="#ff1a00"
        strokeWidth="1"
      />
    </svg>
  );
}

function SmallSkullFire({ uid }: PieceSvgProps) {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <defs>
        <linearGradient id={`smskull-${uid}`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#ff1a00" />
          <stop offset="100%" stopColor="#ffe600" />
        </linearGradient>
      </defs>
      <path d="M6 8 Q8 2 12 6 Q16 2 18 8 Z" fill={`url(#smskull-${uid})`} />
      <ellipse cx="12" cy="14" rx="6" ry="5.5" fill="#f0f0f0" stroke="#000" strokeWidth="0.7" />
      <circle cx="10" cy="14" r="1.3" fill="#000" />
      <circle cx="14" cy="14" r="1.3" fill="#000" />
      <path d="M9 19 L9 21 M12 19 L12 21 M15 19 L15 21" stroke="#000" strokeWidth="0.7" />
    </svg>
  );
}

function SmallHorns() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <path
        d="M7 4 L7 14 M17 4 L17 14 M11 8 L11 14 M13 8 L13 14 M8 14 Q8 19 12 20 Q16 19 16 14 Z"
        fill="#1a1a1a"
        stroke="#ffe600"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SmallVinyl() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <circle cx="12" cy="12" r="10" fill="#0a0a0a" />
      <circle cx="12" cy="12" r="7" fill="none" stroke="#333" strokeWidth="0.4" />
      <circle cx="12" cy="12" r="3" fill="#ff1a00" />
      <circle cx="12" cy="12" r="0.8" fill="#000" />
    </svg>
  );
}

function SmallAmp() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <rect x="4" y="6" width="16" height="14" fill="#1a1a1a" stroke="#000" strokeWidth="0.7" />
      <circle cx="9" cy="14" r="2.5" fill="#ff6a00" stroke="#000" strokeWidth="0.5" />
      <circle cx="15" cy="14" r="2.5" fill="#ff6a00" stroke="#000" strokeWidth="0.5" />
      <circle cx="9" cy="14" r="0.6" fill="#000" />
      <circle cx="15" cy="14" r="0.6" fill="#000" />
      <rect x="4" y="6" width="16" height="2.5" fill="#2a2a2a" />
    </svg>
  );
}

function SmallShard() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <polygon
        points="3,20 12,4 18,12 14,22"
        fill="#fff7d6"
        stroke="#ffffff"
        strokeWidth="0.6"
      />
    </svg>
  );
}

function SmallPick() {
  // Guitar pick
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <path
        d="M12 3 Q19 6 17 14 Q14 22 12 22 Q10 22 7 14 Q5 6 12 3 Z"
        fill="#ff1a00"
        stroke="#1a1a1a"
        strokeWidth="1"
      />
      <path d="M12 6 Q14 7 14 10" stroke="#ffe600" strokeWidth="0.7" fill="none" />
    </svg>
  );
}

function SmallFlame({ uid }: PieceSvgProps) {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <defs>
        <linearGradient id={`smflame-${uid}`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#ff0000" />
          <stop offset="60%" stopColor="#ff8a00" />
          <stop offset="100%" stopColor="#ffe600" />
        </linearGradient>
      </defs>
      <path
        d="M12 2 Q14 6 12 9 Q9 7 8 12 Q7 17 12 22 Q17 17 16 12 Q15 7 12 9 Q10 6 12 2 Z"
        fill={`url(#smflame-${uid})`}
      />
    </svg>
  );
}

// ---------- Main component ----------

export default function RockExplosionAnimation({ x, y, onComplete }: RockExplosionAnimationProps) {
  const [pieces, setPieces] = useState<RockPiece[]>([]);
  const [svgParticles, setSvgParticles] = useState<SvgParticle[]>([]);
  const [shockwave, setShockwave] = useState({ scale: 0, opacity: 1 });
  const [flashOpacity, setFlashOpacity] = useState(0.8);

  const createPieces = useCallback(() => {
    const newPieces: RockPiece[] = [];

    // Flying-V guitars
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 8 + Math.random() * 8;
      newPieces.push({
        id: i,
        x: x + (Math.random() - 0.5) * 40,
        y: y + (Math.random() - 0.5) * 40,
        rotation: Math.random() * 360,
        scale: 0.8 + Math.random() * 0.6,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 20,
        type: "guitar",
        opacity: 1,
      });
    }

    // Devil-horns hands
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 10;
      newPieces.push({
        id: 5 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.8,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 8,
        rotationSpeed: (Math.random() - 0.5) * 15,
        type: "rockhand",
        opacity: 1,
      });
    }

    // Exploding amps (replaces planes)
    for (let i = 0; i < 4; i++) {
      const direction = i % 2 === 0 ? 1 : -1;
      newPieces.push({
        id: 13 + i,
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 30,
        rotation: direction === 1 ? -30 : 30,
        scale: 0.7 + Math.random() * 0.5,
        velocityX: direction * (12 + Math.random() * 8),
        velocityY: -6 - Math.random() * 6,
        rotationSpeed: direction * 4,
        type: "amp",
        opacity: 1,
      });
    }

    // Fire particles
    for (let i = 0; i < 25; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 8;
      newPieces.push({
        id: 17 + i,
        x: x + (Math.random() - 0.5) * 80,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 360,
        scale: 0.3 + Math.random() * 0.7,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 10,
        type: "fire",
        opacity: 1,
      });
    }

    // Lightning bolts (jagged + bolder)
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 7;
      newPieces.push({
        id: 42 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.6,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 25,
        type: "lightning",
        opacity: 1,
      });
    }

    // Flaming skulls
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newPieces.push({
        id: 50 + i,
        x: x + (Math.random() - 0.5) * 40,
        y: y + (Math.random() - 0.5) * 40,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 12,
        type: "skull",
        opacity: 1,
      });
    }

    // Vinyl records (replaces stars — same count + spread)
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newPieces.push({
        id: 54 + i,
        x: x + (Math.random() - 0.5) * 100,
        y: y + (Math.random() - 0.5) * 100,
        rotation: Math.random() * 360,
        scale: 0.4 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 20,
        type: "vinyl",
        opacity: 1,
      });
    }

    // Shattered glass shards
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 7 + Math.random() * 9;
      newPieces.push({
        id: 60 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 360,
        scale: 0.4 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 30,
        type: "shatter",
        opacity: 1,
      });
    }

    // Broken strings flying off
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 8;
      newPieces.push({
        id: 66 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 18,
        type: "string",
        opacity: 1,
      });
    }

    return newPieces;
  }, [x, y]);

  // Stable handle to the latest onComplete (double-fire fix). Consumers pass
  // an inline onComplete (a fresh reference every render). The handlers do an
  // async tasksApi.update + refetch right after firing; when the refetch lands
  // mid-animation the parent re-renders, onComplete's identity changes, and
  // (when it was an effect dep) the spawn effect re-ran, resetting pieces
  // and replaying the burst (the animation "firing twice"). Reading onComplete
  // through a ref keeps the spawn effect mount-only.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init of mount-time random particles, then setInterval drives animation
    setPieces(createPieces());

    // Custom-SVG particle layer (replaces old emoji particles)
    const newSvgParticles: SvgParticle[] = [];
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 10;
      newSvgParticles.push({
        id: i,
        kind: SVG_KINDS[Math.floor(Math.random() * SVG_KINDS.length)],
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 6,
        rotation: Math.random() * 360,
        scale: 0.8 + Math.random() * 0.8,
        opacity: 1,
      });
    }
    setSvgParticles(newSvgParticles);

    // Flash effect
    setFlashOpacity(0.8);

    // Animate
    const interval = setInterval(() => {
      setPieces(prev =>
        prev.map(piece => ({
          ...piece,
          x: piece.x + piece.velocityX,
          y: piece.y + piece.velocityY + 1.5, // gravity
          velocityY: piece.velocityY + 0.3,
          rotation: piece.rotation + piece.rotationSpeed,
          opacity: Math.max(0, piece.opacity - 0.015),
        })).filter(piece => piece.y < window.innerHeight + 100 && piece.opacity > 0)
      );

      setSvgParticles(prev =>
        prev.map(p => ({
          ...p,
          x: p.x + p.velocityX,
          y: p.y + p.velocityY + 1,
          velocityY: p.velocityY + 0.2,
          rotation: p.rotation + 5,
          opacity: Math.max(0, p.opacity - 0.02),
          scale: p.scale * 1.01,
        })).filter(p => p.y < window.innerHeight + 50 && p.opacity > 0)
      );

      setShockwave(prev => ({
        scale: prev.scale + 15,
        opacity: Math.max(0, prev.opacity - 0.05),
      }));

      setFlashOpacity(prev => Math.max(0, prev - 0.08));
    }, 25);

    // Clean up after animation
    const timeout = setTimeout(() => {
      clearInterval(interval);
      onCompleteRef.current();
    }, 2500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
    // onComplete is read via the ref above, so it is intentionally NOT a dep
    // here (that re-run was the mid-animation double-fire). Keep createPieces
    // and x/y, which are stable for a given celebration instance.
  }, [createPieces, x, y]);

  // Size dispatch — fire is small, rest are standard
  const sizeFor = (type: RockPiece["type"]) => (type === "fire" ? 22 : 44);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Flash effect — pure red→orange burst */}
      <div
        className="fixed inset-0"
        style={{
          opacity: flashOpacity,
          background:
            "radial-gradient(circle at " +
            x +
            "px " +
            y +
            "px, #ffe600 0%, #ff6a00 25%, #ff1a00 55%, transparent 80%)",
        }}
      />

      {/* Shockwave ring — red */}
      <div
        className="absolute rounded-full border-4"
        style={{
          left: x - shockwave.scale,
          top: y - shockwave.scale,
          width: shockwave.scale * 2,
          height: shockwave.scale * 2,
          opacity: shockwave.opacity,
          borderColor: "#ff1a00",
          boxShadow: "0 0 20px #ff1a00",
        }}
      />

      {/* Second shockwave — electric yellow */}
      <div
        className="absolute rounded-full border-2"
        style={{
          left: x - shockwave.scale * 0.7,
          top: y - shockwave.scale * 0.7,
          width: shockwave.scale * 1.4,
          height: shockwave.scale * 1.4,
          opacity: shockwave.opacity * 0.7,
          borderColor: "#ffe600",
          boxShadow: "0 0 15px #ffe600",
        }}
      />

      {/* SVG Pieces */}
      {pieces.map(piece => {
        const size = sizeFor(piece.type);
        return (
          <div
            key={piece.id}
            className="absolute"
            style={{
              left: piece.x,
              top: piece.y,
              transform: `rotate(${piece.rotation}deg) scale(${piece.scale})`,
              opacity: piece.opacity,
              width: size,
              height: size,
            }}
          >
            {piece.type === "guitar" && <GuitarSvg uid={piece.id} />}
            {piece.type === "rockhand" && <RockHandSvg />}
            {piece.type === "amp" && <AmpSvg uid={piece.id} />}
            {piece.type === "fire" && <FireSvg uid={piece.id} />}
            {piece.type === "lightning" && <LightningSvg uid={piece.id} />}
            {piece.type === "vinyl" && <VinylSvg />}
            {piece.type === "skull" && <SkullSvg uid={piece.id} />}
            {piece.type === "shatter" && <ShatterSvg />}
            {piece.type === "string" && <BrokenStringSvg />}
          </div>
        );
      })}

      {/* Custom SVG particles (replaces old emoji layer) */}
      {svgParticles.map(p => (
        <div
          key={`svgp-${p.id}`}
          className="absolute"
          style={{
            left: p.x,
            top: p.y,
            opacity: p.opacity,
            transform: `rotate(${p.rotation}deg) scale(${p.scale})`,
            width: 28,
            height: 28,
          }}
        >
          {p.kind === "boltSmall" && <SmallBolt />}
          {p.kind === "skullFire" && <SmallSkullFire uid={p.id} />}
          {p.kind === "horns" && <SmallHorns />}
          {p.kind === "vinyl" && <SmallVinyl />}
          {p.kind === "ampMini" && <SmallAmp />}
          {p.kind === "shard" && <SmallShard />}
          {p.kind === "guitarPick" && <SmallPick />}
          {p.kind === "flame" && <SmallFlame uid={p.id} />}
        </div>
      ))}
    </div>
  );
}
