"use client";

import { useEffect, useState, useCallback } from "react";

interface FungiParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: "mushroom" | "spore" | "mycelium" | "toadstool" | "morel" | "truffle";
  opacity: number;
  color: string;
}

interface SporeCloud {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  velocityY: number;
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

interface FungiAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const FUNGI_EMOJIS = ["🍄", "🟤", "🦠", "🌿", "🍂", "🌲", "🌰", "🟫", "🪵", "🌱"];

const MUSHROOM_COLORS = [
  "#ff6b6b", "#feca57", "#8B4513", "#ff9ff3", "#54a0ff",
  "#ff9f43", "#ee5a24", "#9c27b0", "#e91e63", "#795548",
];

export default function FungiAnimation({ x, y, onComplete }: FungiAnimationProps) {
  const [particles, setParticles] = useState<FungiParticle[]>([]);
  const [spores, setSpores] = useState<SporeCloud[]>([]);
  const [emojis, setEmojis] = useState<EmojiParticle[]>([]);

  const createParticles = useCallback(() => {
    const newParticles: FungiParticle[] = [];
    
    // Create mushrooms
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      newParticles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 30 - 15,
        scale: 0.5 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 4,
        type: "mushroom",
        opacity: 1,
        color: MUSHROOM_COLORS[Math.floor(Math.random() * MUSHROOM_COLORS.length)],
      });
    }

    // Create toadstools (red with white spots)
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 8 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 20 - 10,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 3,
        type: "toadstool",
        opacity: 1,
        color: "#ff0000",
      });
    }

    // Create morels
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 13 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 20 - 10,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 4,
        type: "morel",
        opacity: 1,
        color: "#8B4513",
      });
    }

    // Create truffles
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      newParticles.push({
        id: 17 + i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 360,
        scale: 0.4 + Math.random() * 0.3,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "truffle",
        opacity: 1,
        color: "#5D4037",
      });
    }

    // Create spores
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newParticles.push({
        id: 22 + i,
        x: x + (Math.random() - 0.5) * 80,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 360,
        scale: 0.2 + Math.random() * 0.3,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 15,
        type: "spore",
        opacity: 1,
        color: "#c0c0c0",
      });
    }

    // Create mycelium strands
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      newParticles.push({
        id: 37 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 1,
        rotationSpeed: (Math.random() - 0.5) * 5,
        type: "mycelium",
        opacity: 1,
        color: "#f5f5dc",
      });
    }

    return newParticles;
  }, [x, y]);

  useEffect(() => {
    setParticles(createParticles());
    
    // Create spore cloud
    const newSpores: SporeCloud[] = [];
    for (let i = 0; i < 40; i++) {
      newSpores.push({
        id: i,
        x: x + (Math.random() - 0.5) * 100,
        y: y + Math.random() * 30,
        size: 2 + Math.random() * 6,
        opacity: 0.8,
        velocityY: -0.5 - Math.random() * 1.5,
      });
    }
    setSpores(newSpores);

    // Create emoji particles
    const newEmojis: EmojiParticle[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      newEmojis.push({
        id: i,
        emoji: FUNGI_EMOJIS[Math.floor(Math.random() * FUNGI_EMOJIS.length)],
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
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
          y: p.y + p.velocityY + 0.25,
          velocityY: p.velocityY + 0.1,
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.008),
        })).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );

      setSpores(prev =>
        prev.map(s => ({
          ...s,
          y: s.y + s.velocityY,
          x: s.x + (Math.random() - 0.5) * 0.5,
          opacity: Math.max(0, s.opacity - 0.006),
        })).filter(s => s.y > -50 && s.opacity > 0)
      );
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          x: e.x + e.velocityX,
          y: e.y + e.velocityY + 0.25,
          velocityY: e.velocityY + 0.08,
          rotation: e.rotation + 2,
          opacity: Math.max(0, e.opacity - 0.01),
          scale: e.scale * 1.002,
        })).filter(e => e.y < window.innerHeight + 50 && e.opacity > 0)
      );
    }, 30);

    // Clean up after animation
    const timeout = setTimeout(() => {
      clearInterval(interval);
      onComplete();
    }, 3500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [createParticles, onComplete, x, y]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Spore cloud */}
      {spores.map(s => (
        <div
          key={`spore-${s.id}`}
          className="absolute rounded-full"
          style={{
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            backgroundColor: "rgba(200,200,200,0.6)",
            opacity: s.opacity,
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
          {p.type === "mushroom" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="10" rx="8" ry="6" fill={p.color}/>
              <rect x="9" y="14" width="6" height="8" rx="1" fill="#f5f5dc"/>
              <circle cx="9" cy="8" r="1.5" fill="#fff" opacity="0.6"/>
              <circle cx="15" cy="9" r="1" fill="#fff" opacity="0.6"/>
              <circle cx="12" cy="6" r="1.2" fill="#fff" opacity="0.6"/>
            </svg>
          )}
          {p.type === "toadstool" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="10" rx="8" ry="6" fill="#ff0000"/>
              <rect x="10" y="14" width="4" height="8" rx="1" fill="#fff"/>
              <circle cx="8" cy="8" r="1.5" fill="#fff"/>
              <circle cx="14" cy="7" r="1" fill="#fff"/>
              <circle cx="11" cy="5" r="1.2" fill="#fff"/>
              <circle cx="16" cy="10" r="0.8" fill="#fff"/>
            </svg>
          )}
          {p.type === "morel" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="8" rx="5" ry="6" fill={p.color}/>
              <rect x="10" y="12" width="4" height="10" rx="1" fill="#D2691E"/>
              <path d="M8 6C9 5 10 5 11 6" stroke="#5D4037" strokeWidth="0.5"/>
              <path d="M13 6C14 5 15 5 16 6" stroke="#5D4037" strokeWidth="0.5"/>
              <path d="M9 9C10 8 11 8 12 9" stroke="#5D4037" strokeWidth="0.5"/>
              <path d="M12 9C13 8 14 8 15 9" stroke="#5D4037" strokeWidth="0.5"/>
            </svg>
          )}
          {p.type === "truffle" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="12" rx="7" ry="6" fill={p.color}/>
              <ellipse cx="10" cy="10" rx="2" ry="1.5" fill="#3E2723" opacity="0.3"/>
              <ellipse cx="14" cy="12" rx="1.5" ry="1" fill="#3E2723" opacity="0.3"/>
              <ellipse cx="11" cy="14" rx="1.5" ry="1" fill="#3E2723" opacity="0.3"/>
            </svg>
          )}
          {p.type === "spore" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <circle cx="12" cy="12" r="4" fill={p.color} opacity="0.7"/>
              <circle cx="12" cy="12" r="2" fill="#fff" opacity="0.3"/>
            </svg>
          )}
          {p.type === "mycelium" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M4 20Q8 16 12 18Q16 20 20 16" stroke={p.color} strokeWidth="1.5" fill="none"/>
              <path d="M6 16Q10 12 14 14Q18 16 22 12" stroke={p.color} strokeWidth="1" fill="none" opacity="0.7"/>
              <path d="M2 18Q6 14 10 16" stroke={p.color} strokeWidth="1" fill="none" opacity="0.5"/>
              <circle cx="8" cy="17" r="1" fill={p.color} opacity="0.6"/>
              <circle cx="14" cy="15" r="0.8" fill={p.color} opacity="0.6"/>
              <circle cx="18" cy="14" r="0.6" fill={p.color} opacity="0.6"/>
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
          background: "radial-gradient(circle, rgba(139,69,19,0.5) 0%, rgba(93,64,55,0.2) 50%, transparent 70%)",
        }}
      />
    </div>
  );
}
