"use client";

import { useEffect, useState, useCallback } from "react";

interface RockPiece {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: "guitar" | "rockhand" | "plane" | "fire" | "lightning" | "star" | "skull";
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

interface RockExplosionAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const ROCK_EMOJIS = ["🎸", "🤘", "✈️", "🔥", "⚡", "💀", "🦅", "💣", "🚀", "🌟"];

const FIRE_COLORS = [
  "#ff4500", "#ff6600", "#ff8800", "#ffaa00", "#ffcc00",
  "#ff0000", "#ff3300", "#ff5500",
];

export default function RockExplosionAnimation({ x, y, onComplete }: RockExplosionAnimationProps) {
  const [pieces, setPieces] = useState<RockPiece[]>([]);
  const [emojis, setEmojis] = useState<EmojiParticle[]>([]);
  const [shockwave, setShockwave] = useState({ scale: 0, opacity: 1 });
  const [flashOpacity, setFlashOpacity] = useState(0.8);

  const createPieces = useCallback(() => {
    const newPieces: RockPiece[] = [];
    
    // Create guitars - flying outward with style
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

    // Create rock hands 🤘
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

    // Create planes flying off
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
        rotationSpeed: direction * 2,
        type: "plane",
        opacity: 1,
      });
    }

    // Create fire particles
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

    // Create lightning bolts
    for (let i = 0; i < 6; i++) {
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

    // Create skulls
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newPieces.push({
        id: 48 + i,
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

    // Create stars
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newPieces.push({
        id: 51 + i,
        x: x + (Math.random() - 0.5) * 100,
        y: y + (Math.random() - 0.5) * 100,
        rotation: Math.random() * 360,
        scale: 0.4 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 20,
        type: "star",
        opacity: 1,
      });
    }

    return newPieces;
  }, [x, y]);

  useEffect(() => {
    setPieces(createPieces());
    
    // Create emoji particles
    const newEmojis: EmojiParticle[] = [];
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 10;
      newEmojis.push({
        id: i,
        emoji: ROCK_EMOJIS[Math.floor(Math.random() * ROCK_EMOJIS.length)],
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 6,
        rotation: Math.random() * 360,
        scale: 0.8 + Math.random() * 0.8,
        opacity: 1,
      });
    }
    setEmojis(newEmojis);

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
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          x: e.x + e.velocityX,
          y: e.y + e.velocityY + 1,
          velocityY: e.velocityY + 0.2,
          rotation: e.rotation + 5,
          opacity: Math.max(0, e.opacity - 0.02),
          scale: e.scale * 1.01,
        })).filter(e => e.y < window.innerHeight + 50 && e.opacity > 0)
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
      onComplete();
    }, 2500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [createPieces, onComplete, x, y]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Flash effect */}
      <div 
        className="fixed inset-0 bg-orange-400"
        style={{ opacity: flashOpacity }}
      />
      
      {/* Shockwave ring */}
      <div
        className="absolute rounded-full border-4 border-orange-500"
        style={{
          left: x - shockwave.scale,
          top: y - shockwave.scale,
          width: shockwave.scale * 2,
          height: shockwave.scale * 2,
          opacity: shockwave.opacity,
        }}
      />
      
      {/* Second shockwave */}
      <div
        className="absolute rounded-full border-2 border-yellow-400"
        style={{
          left: x - shockwave.scale * 0.7,
          top: y - shockwave.scale * 0.7,
          width: shockwave.scale * 1.4,
          height: shockwave.scale * 1.4,
          opacity: shockwave.opacity * 0.7,
        }}
      />

      {/* SVG Pieces */}
      {pieces.map(piece => (
        <div
          key={piece.id}
          className="absolute"
          style={{
            left: piece.x,
            top: piece.y,
            transform: `rotate(${piece.rotation}deg) scale(${piece.scale})`,
            opacity: piece.opacity,
            width: piece.type === "fire" ? 20 : 40,
            height: piece.type === "fire" ? 20 : 40,
          }}
        >
          {piece.type === "guitar" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M19.59 3.59L20.41 2.77C21 2.17 21 1.21 20.41 0.71C19.82 0.21 18.86 0.21 18.27 0.71L17.45 1.53L19.59 3.59ZM5.41 17.59L4.59 18.41C4 19 4 19.95 4.59 20.54C5.18 21.13 6.14 21.13 6.73 20.54L7.55 19.72L5.41 17.59ZM9.36 16.64L7.22 14.5L15.36 6.36L17.5 8.5L9.36 16.64Z" 
                fill="#8B4513" stroke="#5D2E0C" strokeWidth="1"/>
              <ellipse cx="6" cy="18" rx="3" ry="2.5" fill="#D2691E" stroke="#8B4513"/>
              <circle cx="5" cy="17.5" r="0.5" fill="#1a1a1a"/>
              <circle cx="7" cy="18.5" r="0.5" fill="#1a1a1a"/>
              <circle cx="6" cy="19" r="0.5" fill="#1a1a1a"/>
            </svg>
          )}
          {piece.type === "rockhand" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M7 2V13M7 2L5 4M7 2L9 4M12 2V11M12 2L10 4M12 2L14 4M17 4V13M17 4L15 6M17 4L19 6M7 13C7 13 7 17 9 19C11 21 13 21 14 21C15 21 17 20 18 18C19 16 19 13 19 13" 
                stroke="#FFD700" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M7 2V13M12 2V11M17 4V13" 
                stroke="#FFA500" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          )}
          {piece.type === "plane" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M21 16V14L13 9V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9L2 14V16L10 13.5V19L8 20.5V22L11.5 21L15 22V20.5L13 19V13.5L21 16Z" 
                fill="#4A4A4A" stroke="#2A2A2A" strokeWidth="1"/>
              <path d="M11 4V9" stroke="#FF4500" strokeWidth="2"/>
              <path d="M3 15L10 13" stroke="#FF4500" strokeWidth="1"/>
              <path d="M20 15L13 13" stroke="#FF4500" strokeWidth="1"/>
            </svg>
          )}
          {piece.type === "fire" && (
            <svg viewBox="0 0 24 24" className="w-full h-full">
              <defs>
                <linearGradient id={`fire-${piece.id}`} x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#ff0000" />
                  <stop offset="50%" stopColor="#ff6600" />
                  <stop offset="100%" stopColor="#ffcc00" />
                </linearGradient>
              </defs>
              <path d="M12 2C12 2 8 8 8 12C8 16 10 18 12 22C14 18 16 16 16 12C16 8 12 2 12 2Z" 
                fill={`url(#fire-${piece.id})`} />
              <path d="M12 8C12 8 10 11 10 13C10 15 11 16 12 18C13 16 14 15 14 13C14 11 12 8 12 8Z" 
                fill="#ffff00" opacity="0.8"/>
            </svg>
          )}
          {piece.type === "lightning" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" 
                fill="#FFD700" stroke="#FFA500" strokeWidth="1"/>
              <path d="M12 5L6 13H12L11 18L17 11H12L12 5Z" 
                fill="#FFFF00" opacity="0.7"/>
            </svg>
          )}
          {piece.type === "skull" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="10" rx="8" ry="7" fill="#E0E0E0" stroke="#888" strokeWidth="1"/>
              <ellipse cx="12" cy="15" rx="5" ry="4" fill="#E0E0E0" stroke="#888" strokeWidth="1"/>
              <circle cx="9" cy="9" r="2" fill="#1a1a1a"/>
              <circle cx="15" cy="9" r="2" fill="#1a1a1a"/>
              <path d="M9 14L10 13L11 14L12 13L13 14L14 13L15 14" stroke="#1a1a1a" strokeWidth="1.5"/>
              <circle cx="12" cy="12" r="1" fill="#1a1a1a"/>
            </svg>
          )}
          {piece.type === "star" && (
            <svg viewBox="0 0 24 24" className="w-full h-full">
              <path d="M12 2L14.09 8.26L21 9.27L16 14.14L17.18 21.02L12 17.77L6.82 21.02L8 14.14L3 9.27L9.91 8.26L12 2Z" 
                fill="#FFD700" stroke="#FFA500" strokeWidth="1"/>
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
      
      {/* Central explosion glow */}
      <div
        className="absolute rounded-full"
        style={{
          left: x - 30,
          top: y - 30,
          width: 60,
          height: 60,
          background: "radial-gradient(circle, rgba(255,200,0,0.8) 0%, rgba(255,100,0,0.4) 50%, transparent 70%)",
          animation: "pulse 0.3s ease-out",
        }}
      />
    </div>
  );
}
