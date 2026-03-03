"use client";

import { useEffect, useState, useCallback } from "react";

interface SportsParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: "soccer" | "basketball" | "football" | "tennis" | "trophy" | "medal" | "whistle";
  opacity: number;
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

interface SportsAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const SPORTS_EMOJIS = ["⚽", "🏀", "🏈", "🎾", "🏆", "🥇", "🎖️", "🎯", "🥅", "⛳"];

export default function SportsAnimation({ x, y, onComplete }: SportsAnimationProps) {
  const [particles, setParticles] = useState<SportsParticle[]>([]);
  const [emojis, setEmojis] = useState<EmojiParticle[]>([]);
  const [shockwave, setShockwave] = useState({ scale: 0, opacity: 0.8 });

  const createParticles = useCallback(() => {
    const newParticles: SportsParticle[] = [];
    
    // Create soccer balls
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 8;
      newParticles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 6,
        rotationSpeed: (Math.random() - 0.5) * 15,
        type: "soccer",
        opacity: 1,
      });
    }

    // Create basketballs
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 7;
      newParticles.push({
        id: 6 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 12,
        type: "basketball",
        opacity: 1,
      });
    }

    // Create footballs
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 7 + Math.random() * 8;
      newParticles.push({
        id: 11 + i,
        x: x + (Math.random() - 0.5) * 40,
        y: y + (Math.random() - 0.5) * 40,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 7,
        rotationSpeed: (Math.random() - 0.5) * 20,
        type: "football",
        opacity: 1,
      });
    }

    // Create tennis balls
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 8;
      newParticles.push({
        id: 15 + i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 360,
        scale: 0.4 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 18,
        type: "tennis",
        opacity: 1,
      });
    }

    // Create trophies
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 5;
      newParticles.push({
        id: 23 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 30 - 15,
        scale: 0.7 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 8,
        rotationSpeed: (Math.random() - 0.5) * 5,
        type: "trophy",
        opacity: 1,
      });
    }

    // Create medals
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newParticles.push({
        id: 27 + i,
        x: x + (Math.random() - 0.5) * 80,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 10,
        type: "medal",
        opacity: 1,
      });
    }

    // Create whistles
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 33 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "whistle",
        opacity: 1,
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
        emoji: SPORTS_EMOJIS[Math.floor(Math.random() * SPORTS_EMOJIS.length)],
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 6,
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
          y: p.y + p.velocityY + 0.8,
          velocityY: p.velocityY + 0.4,
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.012),
        })).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          x: e.x + e.velocityX,
          y: e.y + e.velocityY + 0.8,
          velocityY: e.velocityY + 0.3,
          rotation: e.rotation + 4,
          opacity: Math.max(0, e.opacity - 0.015),
          scale: e.scale * 1.004,
        })).filter(e => e.y < window.innerHeight + 50 && e.opacity > 0)
      );

      setShockwave(prev => ({
        scale: prev.scale + 18,
        opacity: Math.max(0, prev.opacity - 0.04),
      }));
    }, 25);

    // Clean up after animation
    const timeout = setTimeout(() => {
      clearInterval(interval);
      onComplete();
    }, 2800);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [createParticles, onComplete, x, y]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Shockwave ring */}
      <div
        className="absolute rounded-full border-4 border-green-500"
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
          {p.type === "soccer" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <circle cx="12" cy="12" r="10" fill="#fff" stroke="#000" strokeWidth="0.5"/>
              <path d="M12 2L14 6L12 8L10 6L12 2Z" fill="#000"/>
              <path d="M20 8L17 11L17 13L20 12L20 8Z" fill="#000"/>
              <path d="M4 8L7 11L7 13L4 12L4 8Z" fill="#000"/>
              <path d="M8 18L10 15L12 16L14 15L16 18L14 20L10 20L8 18Z" fill="#000"/>
              <path d="M12 8L15 10L14 14L12 16L10 14L9 10L12 8Z" fill="#000"/>
            </svg>
          )}
          {p.type === "basketball" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <circle cx="12" cy="12" r="10" fill="#ff6b35"/>
              <path d="M12 2V22" stroke="#000" strokeWidth="1"/>
              <path d="M2 12H22" stroke="#000" strokeWidth="1"/>
              <path d="M4 6Q12 10 20 6" stroke="#000" strokeWidth="1" fill="none"/>
              <path d="M4 18Q12 14 20 18" stroke="#000" strokeWidth="1" fill="none"/>
            </svg>
          )}
          {p.type === "football" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="12" rx="6" ry="10" fill="#8B4513"/>
              <path d="M12 2L10 5L12 6L14 5L12 2Z" stroke="#fff" strokeWidth="0.5"/>
              <path d="M12 18L10 15L12 14L14 15L12 18Z" stroke="#fff" strokeWidth="0.5"/>
              <path d="M6 12L9 10L10 12L9 14L6 12Z" stroke="#fff" strokeWidth="0.5"/>
              <path d="M18 12L15 10L14 12L15 14L18 12Z" stroke="#fff" strokeWidth="0.5"/>
              <line x1="10" y1="8" x2="14" y2="8" stroke="#fff" strokeWidth="0.5"/>
              <line x1="10" y1="16" x2="14" y2="16" stroke="#fff" strokeWidth="0.5"/>
            </svg>
          )}
          {p.type === "tennis" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <circle cx="12" cy="12" r="10" fill="#c8e632"/>
              <path d="M12 2C6 2 2 12 2 12" stroke="#fff" strokeWidth="2" fill="none"/>
              <path d="M12 22C18 22 22 12 22 12" stroke="#fff" strokeWidth="2" fill="none"/>
            </svg>
          )}
          {p.type === "trophy" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M8 4H16V10C16 13 14 15 12 15C10 15 8 13 8 10V4Z" fill="#ffd700" stroke="#b8860b" strokeWidth="0.5"/>
              <path d="M8 6C6 6 4 7 4 9C4 11 6 11 8 10" stroke="#ffd700" strokeWidth="1.5" fill="none"/>
              <path d="M16 6C18 6 20 7 20 9C20 11 18 11 16 10" stroke="#ffd700" strokeWidth="1.5" fill="none"/>
              <rect x="10" y="15" width="4" height="3" fill="#ffd700"/>
              <rect x="7" y="18" width="10" height="3" rx="1" fill="#ffd700" stroke="#b8860b" strokeWidth="0.5"/>
              <path d="M10 7H14L13 11H11L10 7Z" fill="#fff" opacity="0.3"/>
            </svg>
          )}
          {p.type === "medal" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <circle cx="12" cy="14" r="8" fill="#ffd700" stroke="#b8860b" strokeWidth="0.5"/>
              <path d="M8 6L12 4L16 6" stroke="#ff0000" strokeWidth="3" fill="none"/>
              <path d="M12 4V10" stroke="#ff0000" strokeWidth="3"/>
              <circle cx="12" cy="14" r="5" fill="#b8860b"/>
              <text x="12" y="16" textAnchor="middle" fontSize="6" fill="#ffd700">1</text>
            </svg>
          )}
          {p.type === "whistle" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="10" cy="14" rx="6" ry="4" fill="#c0c0c0" stroke="#808080" strokeWidth="0.5"/>
              <rect x="14" y="12" width="6" height="4" rx="1" fill="#c0c0c0" stroke="#808080" strokeWidth="0.5"/>
              <circle cx="6" cy="14" r="2" fill="#000"/>
              <rect x="8" y="8" width="2" height="4" rx="1" fill="#000"/>
              <circle cx="9" cy="7" r="1.5" fill="#ff0000"/>
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
          left: x - 35,
          top: y - 35,
          width: 70,
          height: 70,
          background: "radial-gradient(circle, rgba(34,139,34,0.6) 0%, rgba(0,100,0,0.2) 50%, transparent 70%)",
        }}
      />
    </div>
  );
}
