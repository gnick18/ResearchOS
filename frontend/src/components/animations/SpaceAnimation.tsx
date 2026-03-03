"use client";

import { useEffect, useState, useCallback } from "react";

interface SpaceParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: "star" | "planet" | "rocket" | "alien" | "ufo" | "meteor" | "satellite";
  opacity: number;
  color: string;
}

interface EmojiParticle {
  id: number;
  emoji: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  rotation: number;
  scale: number;
  opacity: number;
}

interface SpaceAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const SPACE_EMOJIS = ["🚀", "🌟", "👽", "🛸", "🌙", "⭐", "☄️", "🪐", "🌌", "👨‍🚀"];

const PLANET_COLORS = [
  "#ff6b6b", // Mars red
  "#feca57", // Saturn yellow
  "#48dbfb", // Neptune blue
  "#ff9ff3", // Venus pink
  "#54a0ff", // Uranus blue
  "#5f27cd", // Purple planet
];

export default function SpaceAnimation({ x, y, onComplete }: SpaceAnimationProps) {
  const [particles, setParticles] = useState<SpaceParticle[]>([]);
  const [emojis, setEmojis] = useState<EmojiParticle[]>([]);
  const [shockwave, setShockwave] = useState({ scale: 0, opacity: 0.8 });
  const [starfield, setStarfield] = useState<{ id: number; x: number; y: number; size: number; opacity: number }[]>([]);

  const createParticles = useCallback(() => {
    const newParticles: SpaceParticle[] = [];
    
    // Create rockets flying outward
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 10 + Math.random() * 8;
      newParticles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 40,
        y: y + (Math.random() - 0.5) * 40,
        rotation: (angle * 180 / Math.PI) + 90,
        scale: 0.8 + Math.random() * 0.6,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 5,
        type: "rocket",
        opacity: 1,
        color: "#ff6b6b",
      });
    }

    // Create planets
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 8;
      newParticles.push({
        id: 4 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.8,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "planet",
        opacity: 1,
        color: PLANET_COLORS[Math.floor(Math.random() * PLANET_COLORS.length)],
      });
    }

    // Create UFOs
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 6;
      newParticles.push({
        id: 10 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 10,
        type: "ufo",
        opacity: 1,
        color: "#c0c0c0",
      });
    }

    // Create aliens
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 7;
      newParticles.push({
        id: 14 + i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.6,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 12,
        type: "alien",
        opacity: 1,
        color: "#00ff88",
      });
    }

    // Create meteors
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 8 + Math.random() * 10;
      newParticles.push({
        id: 19 + i,
        x: x + (Math.random() - 0.5) * 80,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 360,
        scale: 0.3 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 15,
        type: "meteor",
        opacity: 1,
        color: "#ff8800",
      });
    }

    // Create stars
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 6;
      newParticles.push({
        id: 27 + i,
        x: x + (Math.random() - 0.5) * 100,
        y: y + (Math.random() - 0.5) * 100,
        rotation: Math.random() * 360,
        scale: 0.3 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 20,
        type: "star",
        opacity: 1,
        color: "#ffd700",
      });
    }

    // Create satellites
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 5;
      newParticles.push({
        id: 42 + i,
        x: x + (Math.random() - 0.5) * 40,
        y: y + (Math.random() - 0.5) * 40,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "satellite",
        opacity: 1,
        color: "#87ceeb",
      });
    }

    return newParticles;
  }, [x, y]);

  useEffect(() => {
    setParticles(createParticles());
    
    // Create emoji particles
    const newEmojis: EmojiParticle[] = [];
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 8;
      newEmojis.push({
        id: i,
        emoji: SPACE_EMOJIS[Math.floor(Math.random() * SPACE_EMOJIS.length)],
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotation: Math.random() * 360,
        scale: 0.8 + Math.random() * 0.8,
        opacity: 1,
      });
    }
    setEmojis(newEmojis);

    // Create starfield background
    const stars = [];
    for (let i = 0; i < 50; i++) {
      stars.push({
        id: i,
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        size: Math.random() * 3 + 1,
        opacity: Math.random() * 0.8 + 0.2,
      });
    }
    setStarfield(stars);

    // Animate
    const interval = setInterval(() => {
      setParticles(prev => 
        prev.map(p => ({
          ...p,
          x: p.x + p.velocityX,
          y: p.y + p.velocityY + 0.5,
          velocityY: p.velocityY + 0.15,
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.012),
        })).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          x: e.x + e.velocityX,
          y: e.y + e.velocityY + 0.5,
          velocityY: e.velocityY + 0.1,
          rotation: e.rotation + 3,
          opacity: Math.max(0, e.opacity - 0.015),
          scale: e.scale * 1.005,
        })).filter(e => e.y < window.innerHeight + 50 && e.opacity > 0)
      );

      setShockwave(prev => ({
        scale: prev.scale + 20,
        opacity: Math.max(0, prev.opacity - 0.03),
      }));
    }, 25);

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
      {/* Starfield background */}
      {starfield.map(star => (
        <div
          key={`star-${star.id}`}
          className="absolute rounded-full bg-white"
          style={{
            left: star.x,
            top: star.y,
            width: star.size,
            height: star.size,
            opacity: star.opacity,
          }}
        />
      ))}
      
      {/* Shockwave ring */}
      <div
        className="absolute rounded-full border-2 border-purple-400"
        style={{
          left: x - shockwave.scale,
          top: y - shockwave.scale,
          width: shockwave.scale * 2,
          height: shockwave.scale * 2,
          opacity: shockwave.opacity,
        }}
      />

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
            width: 40,
            height: 40,
          }}
        >
          {p.type === "rocket" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M12 2L8 12H16L12 2Z" fill="#ff4444"/>
              <path d="M8 12L6 18H18L16 12H8Z" fill="#c0c0c0"/>
              <path d="M9 18L8 22H10L9 18Z" fill="#ff6600"/>
              <path d="M15 18L14 22H16L15 18Z" fill="#ff6600"/>
              <circle cx="12" cy="10" r="2" fill="#4fc3f7"/>
            </svg>
          )}
          {p.type === "planet" && (
            <svg viewBox="0 0 24 24" className="w-full h-full">
              <circle cx="12" cy="12" r="8" fill={p.color}/>
              <ellipse cx="12" cy="12" rx="11" ry="3" fill="none" stroke="#c0c0c0" strokeWidth="1.5" opacity="0.6"/>
            </svg>
          )}
          {p.type === "ufo" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="14" rx="10" ry="4" fill="#c0c0c0"/>
              <ellipse cx="12" cy="12" rx="6" ry="4" fill="#87ceeb"/>
              <ellipse cx="12" cy="10" rx="4" ry="3" fill="#98fb98" opacity="0.7"/>
              <circle cx="6" cy="14" r="1.5" fill="#ffff00"/>
              <circle cx="12" cy="16" r="1.5" fill="#ffff00"/>
              <circle cx="18" cy="14" r="1.5" fill="#ffff00"/>
            </svg>
          )}
          {p.type === "alien" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="10" rx="6" ry="8" fill="#00ff88"/>
              <ellipse cx="9" cy="8" rx="2.5" ry="3" fill="#000" opacity="0.8"/>
              <ellipse cx="15" cy="8" rx="2.5" ry="3" fill="#000" opacity="0.8"/>
              <circle cx="9" cy="7" r="1" fill="#fff"/>
              <circle cx="15" cy="7" r="1" fill="#fff"/>
              <ellipse cx="12" cy="14" rx="1.5" ry="0.5" fill="#00cc66"/>
            </svg>
          )}
          {p.type === "meteor" && (
            <svg viewBox="0 0 24 24" className="w-full h-full">
              <defs>
                <linearGradient id={`meteor-${p.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ff4400"/>
                  <stop offset="50%" stopColor="#ff8800"/>
                  <stop offset="100%" stopColor="#ffcc00"/>
                </linearGradient>
              </defs>
              <ellipse cx="8" cy="12" rx="5" ry="4" fill={`url(#meteor-${p.id})`}/>
              <path d="M12 10L22 6L18 12L22 18L12 14" fill="#ffcc00" opacity="0.6"/>
            </svg>
          )}
          {p.type === "star" && (
            <svg viewBox="0 0 24 24" className="w-full h-full">
              <path d="M12 2L14.09 8.26L21 9.27L16 14.14L17.18 21.02L12 17.77L6.82 21.02L8 14.14L3 9.27L9.91 8.26L12 2Z" 
                fill={p.color} stroke="#fff" strokeWidth="0.5"/>
            </svg>
          )}
          {p.type === "satellite" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <rect x="10" y="10" width="4" height="4" fill="#87ceeb"/>
              <rect x="2" y="11" width="8" height="2" fill="#4169e1"/>
              <rect x="14" y="11" width="8" height="2" fill="#4169e1"/>
              <circle cx="12" cy="18" r="2" fill="#c0c0c0"/>
              <line x1="12" y1="14" x2="12" y2="16" stroke="#c0c0c0" strokeWidth="1"/>
            </svg>
          )}
        </div>
      ))}
      
      {/* Emoji particles */}
      {emojis.map(e => (
        <div
          key={`emoji-${e.id}`}
          className="absolute text-3xl"
          style={{
            left: e.x,
            top: e.y,
            opacity: e.opacity,
            transform: `rotate(${e.rotation}deg) scale(${e.scale})`,
          }}
        >
          {e.emoji}
        </div>
      ))}
      
      {/* Central glow */}
      <div
        className="absolute rounded-full"
        style={{
          left: x - 40,
          top: y - 40,
          width: 80,
          height: 80,
          background: "radial-gradient(circle, rgba(138,43,226,0.6) 0%, rgba(75,0,130,0.3) 50%, transparent 70%)",
        }}
      />
    </div>
  );
}
