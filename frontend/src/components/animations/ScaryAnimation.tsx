"use client";

import { useEffect, useState, useCallback } from "react";

interface ScaryParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: "skull" | "ghost" | "vampire" | "monster" | "bat" | "spider" | "eye";
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

interface ScaryAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const SCARY_EMOJIS = ["💀", "👻", "🧛", "🦇", "🕷️", "👁️", "🎃", "👹", "☠️", "🧟"];

const SCARY_COLORS = [
  "#1a1a1a", "#4a0000", "#2d0a4a", "#0d3d0d", "#4a1a1a",
  "#333333", "#1c1c1c", "#0a0a0a", "#2a0a2a", "#1a0a0a",
];

export default function ScaryAnimation({ x, y, onComplete }: ScaryAnimationProps) {
  const [particles, setParticles] = useState<ScaryParticle[]>([]);
  const [emojis, setEmojis] = useState<EmojiParticle[]>([]);
  const [fog, setFog] = useState<{ id: number; x: number; y: number; opacity: number; scale: number }[]>([]);
  const [flashOpacity, setFlashOpacity] = useState(0.5);

  const createParticles = useCallback(() => {
    const newParticles: ScaryParticle[] = [];
    
    // Create skulls
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newParticles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 10,
        type: "skull",
        opacity: 1,
        color: "#e0e0e0",
      });
    }

    // Create ghosts
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 6 + i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 20 - 10,
        scale: 0.6 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: -2 - Math.random() * 3,
        rotationSpeed: (Math.random() - 0.5) * 3,
        type: "ghost",
        opacity: 0.9,
        color: "#ffffff",
      });
    }

    // Create vampires
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 5;
      newParticles.push({
        id: 11 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 20 - 10,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 4,
        type: "vampire",
        opacity: 1,
        color: "#4a0000",
      });
    }

    // Create bats
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 7;
      newParticles.push({
        id: 15 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: (angle * 180 / Math.PI),
        scale: 0.4 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "bat",
        opacity: 1,
        color: "#1a1a1a",
      });
    }

    // Create spiders
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 23 + i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 360,
        scale: 0.4 + Math.random() * 0.3,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 12,
        type: "spider",
        opacity: 1,
        color: "#1a1a1a",
      });
    }

    // Create eyes
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      newParticles.push({
        id: 28 + i,
        x: x + (Math.random() - 0.5) * 80,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 360,
        scale: 0.3 + Math.random() * 0.3,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: 0,
        type: "eye",
        opacity: 1,
        color: "#ff0000",
      });
    }

    // Create monsters
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 36 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 15 - 7.5,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 3,
        type: "monster",
        opacity: 1,
        color: "#2d5a2d",
      });
    }

    return newParticles;
  }, [x, y]);

  useEffect(() => {
    setParticles(createParticles());
    
    // Create fog
    const newFog = [];
    for (let i = 0; i < 15; i++) {
      newFog.push({
        id: i,
        x: x + (Math.random() - 0.5) * 200,
        y: y + (Math.random() - 0.5) * 200,
        opacity: 0.4,
        scale: 1 + Math.random() * 2,
      });
    }
    setFog(newFog);

    // Create emoji particles
    const newEmojis: EmojiParticle[] = [];
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newEmojis.push({
        id: i,
        emoji: SCARY_EMOJIS[Math.floor(Math.random() * SCARY_EMOJIS.length)],
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotation: Math.random() * 360,
        scale: 0.8 + Math.random() * 0.6,
        opacity: 1,
      });
    }
    setEmojis(newEmojis);

    // Animate
    const interval = setInterval(() => {
      setParticles(prev => 
        prev.map(p => ({
          ...p,
          x: p.x + p.velocityX,
          y: p.y + p.velocityY + 0.3,
          velocityY: p.velocityY + 0.1,
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.01),
        })).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          x: e.x + e.velocityX,
          y: e.y + e.velocityY + 0.3,
          velocityY: e.velocityY + 0.1,
          rotation: e.rotation + 3,
          opacity: Math.max(0, e.opacity - 0.012),
          scale: e.scale * 1.003,
        })).filter(e => e.y < window.innerHeight + 50 && e.opacity > 0)
      );

      setFog(prev =>
        prev.map(f => ({
          ...f,
          x: f.x + (Math.random() - 0.5) * 2,
          opacity: Math.max(0, f.opacity - 0.005),
        })).filter(f => f.opacity > 0)
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
      {/* Dark flash effect */}
      <div 
        className="fixed inset-0 bg-purple-900"
        style={{ opacity: flashOpacity }}
      />

      {/* Fog */}
      {fog.map(f => (
        <div
          key={`fog-${f.id}`}
          className="absolute rounded-full"
          style={{
            left: f.x,
            top: f.y,
            width: 100 * f.scale,
            height: 60 * f.scale,
            background: "radial-gradient(ellipse, rgba(50,50,50,0.4) 0%, transparent 70%)",
            opacity: f.opacity,
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
            width: 40,
            height: 40,
          }}
        >
          {p.type === "skull" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="10" rx="8" ry="7" fill={p.color}/>
              <ellipse cx="12" cy="15" rx="5" ry="4" fill={p.color}/>
              <circle cx="9" cy="9" r="2" fill="#1a1a1a"/>
              <circle cx="15" cy="9" r="2" fill="#1a1a1a"/>
              <path d="M9 14L10 13L11 14L12 13L13 14L14 13L15 14" stroke="#1a1a1a" strokeWidth="1.5"/>
              <circle cx="12" cy="12" r="1" fill="#1a1a1a"/>
            </svg>
          )}
          {p.type === "ghost" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M4 20L6 18L8 20L10 18L12 20L14 18L16 20L18 18L20 20V10C20 5 16 2 12 2C8 2 4 5 4 10V20Z" fill={p.color} opacity="0.8"/>
              <circle cx="9" cy="9" r="2" fill="#1a1a1a"/>
              <circle cx="15" cy="9" r="2" fill="#1a1a1a"/>
              <ellipse cx="12" cy="14" rx="2" ry="1.5" fill="#1a1a1a"/>
            </svg>
          )}
          {p.type === "vampire" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="10" rx="6" ry="7" fill={p.color}/>
              <ellipse cx="12" cy="8" rx="5" ry="5" fill="#e8d8d8"/>
              <circle cx="9" cy="7" r="1.5" fill="#ff0000"/>
              <circle cx="15" cy="7" r="1.5" fill="#ff0000"/>
              <path d="M9 12L10 11L11 12" fill="#fff"/>
              <path d="M13 12L14 11L15 12" fill="#fff"/>
              <path d="M10 14L12 16L14 14" stroke="#ff0000" strokeWidth="1" fill="none"/>
            </svg>
          )}
          {p.type === "bat" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="12" rx="3" ry="4" fill={p.color}/>
              <path d="M12 8C12 8 8 4 4 6C4 6 6 10 12 10" fill={p.color}/>
              <path d="M12 8C12 8 16 4 20 6C20 6 18 10 12 10" fill={p.color}/>
              <path d="M12 16C12 16 8 20 4 18C4 18 6 14 12 14" fill={p.color}/>
              <path d="M12 16C12 16 16 20 20 18C20 18 18 14 12 14" fill={p.color}/>
              <circle cx="10" cy="10" r="0.8" fill="#ff0000"/>
              <circle cx="14" cy="10" r="0.8" fill="#ff0000"/>
            </svg>
          )}
          {p.type === "spider" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="12" rx="4" ry="3" fill={p.color}/>
              <circle cx="12" cy="9" r="2.5" fill={p.color}/>
              <path d="M8 10L2 6" stroke={p.color} strokeWidth="1.5"/>
              <path d="M8 11L1 11" stroke={p.color} strokeWidth="1.5"/>
              <path d="M8 12L2 16" stroke={p.color} strokeWidth="1.5"/>
              <path d="M16 10L22 6" stroke={p.color} strokeWidth="1.5"/>
              <path d="M16 11L23 11" stroke={p.color} strokeWidth="1.5"/>
              <path d="M16 12L22 16" stroke={p.color} strokeWidth="1.5"/>
              <circle cx="11" cy="8" r="0.5" fill="#ff0000"/>
              <circle cx="13" cy="8" r="0.5" fill="#ff0000"/>
            </svg>
          )}
          {p.type === "eye" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="12" rx="8" ry="5" fill="#fff"/>
              <circle cx="12" cy="12" r="4" fill={p.color}/>
              <circle cx="12" cy="12" r="2" fill="#1a1a1a"/>
              <circle cx="11" cy="11" r="0.8" fill="#fff"/>
            </svg>
          )}
          {p.type === "monster" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="12" rx="7" ry="8" fill={p.color}/>
              <circle cx="9" cy="9" r="2" fill="#ffff00"/>
              <circle cx="15" cy="9" r="2" fill="#ffff00"/>
              <circle cx="9" cy="9" r="1" fill="#1a1a1a"/>
              <circle cx="15" cy="9" r="1" fill="#1a1a1a"/>
              <ellipse cx="12" cy="15" rx="3" ry="2" fill="#1a1a1a"/>
              <rect x="8" y="3" width="2" height="4" fill={p.color}/>
              <rect x="14" y="3" width="2" height="4" fill={p.color}/>
              <polygon points="9,16 10,18 11,16" fill="#fff"/>
              <polygon points="13,16 14,18 15,16" fill="#fff"/>
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
      
      {/* Central dark glow */}
      <div
        className="absolute rounded-full"
        style={{
          left: x - 50,
          top: y - 50,
          width: 100,
          height: 100,
          background: "radial-gradient(circle, rgba(74,0,0,0.6) 0%, rgba(26,26,26,0.3) 50%, transparent 70%)",
        }}
      />
    </div>
  );
}
