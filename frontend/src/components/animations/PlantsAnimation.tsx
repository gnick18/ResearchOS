"use client";

import { useEffect, useState, useCallback } from "react";

interface PlantParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: "flower" | "leaf" | "seed" | "tree" | "sunflower" | "rose" | "tulip";
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

interface PlantsAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const PLANT_EMOJIS = ["🌸", "🌺", "🌻", "🌹", "🌷", "🌱", "🌿", "🍀", "🌼", "💐"];

const FLOWER_COLORS = [
  "#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff",
  "#ff9f43", "#ee5a24", "#00d2d3", "#10ac84", "#5f27cd",
];

export default function PlantsAnimation({ x, y, onComplete }: PlantsAnimationProps) {
  const [particles, setParticles] = useState<PlantParticle[]>([]);
  const [emojis, setEmojis] = useState<EmojiParticle[]>([]);
  const [sparkles, setSparkles] = useState<{ id: number; x: number; y: number; opacity: number }[]>([]);

  const createParticles = useCallback(() => {
    const newParticles: PlantParticle[] = [];
    
    // Create flowers
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newParticles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "flower",
        opacity: 1,
        color: FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)],
      });
    }

    // Create leaves
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      newParticles.push({
        id: 8 + i,
        x: x + (Math.random() - 0.5) * 80,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 360,
        scale: 0.4 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 10,
        type: "leaf",
        opacity: 1,
        color: "#10ac84",
      });
    }

    // Create sunflowers
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 18 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 30 - 15,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 4,
        type: "sunflower",
        opacity: 1,
        color: "#feca57",
      });
    }

    // Create roses
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 22 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 30 - 15,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 5,
        type: "rose",
        opacity: 1,
        color: "#ff6b6b",
      });
    }

    // Create tulips
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 26 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 20 - 10,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 4,
        type: "tulip",
        opacity: 1,
        color: FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)],
      });
    }

    // Create seeds
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newParticles.push({
        id: 31 + i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 360,
        scale: 0.3 + Math.random() * 0.3,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 15,
        type: "seed",
        opacity: 1,
        color: "#8B4513",
      });
    }

    // Create trees
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      newParticles.push({
        id: 39 + i,
        x: x + (Math.random() - 0.5) * 40,
        y: y + (Math.random() - 0.5) * 40,
        rotation: Math.random() * 15 - 7.5,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 3,
        type: "tree",
        opacity: 1,
        color: "#10ac84",
      });
    }

    return newParticles;
  }, [x, y]);

  useEffect(() => {
    setParticles(createParticles());
    
    // Create sparkles
    const newSparkles = [];
    for (let i = 0; i < 20; i++) {
      newSparkles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 150,
        y: y + (Math.random() - 0.5) * 150,
        opacity: 1,
      });
    }
    setSparkles(newSparkles);

    // Create emoji particles
    const newEmojis: EmojiParticle[] = [];
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newEmojis.push({
        id: i,
        emoji: PLANT_EMOJIS[Math.floor(Math.random() * PLANT_EMOJIS.length)],
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
          velocityY: p.velocityY + 0.12,
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.008),
        })).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          x: e.x + e.velocityX,
          y: e.y + e.velocityY + 0.3,
          velocityY: e.velocityY + 0.1,
          rotation: e.rotation + 2,
          opacity: Math.max(0, e.opacity - 0.01),
          scale: e.scale * 1.002,
        })).filter(e => e.y < window.innerHeight + 50 && e.opacity > 0)
      );

      setSparkles(prev =>
        prev.map(s => ({
          ...s,
          opacity: Math.max(0, s.opacity - 0.02),
        })).filter(s => s.opacity > 0)
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
      {/* Sparkles */}
      {sparkles.map(s => (
        <div
          key={`sparkle-${s.id}`}
          className="absolute text-xl"
          style={{
            left: s.x,
            top: s.y,
            opacity: s.opacity,
          }}
        >
          ✨
        </div>
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
          {p.type === "flower" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <circle cx="12" cy="12" r="3" fill={p.color}/>
              {[0, 60, 120, 180, 240, 300].map((angle, i) => (
                <ellipse
                  key={i}
                  cx="12"
                  cy="12"
                  rx="4"
                  ry="7"
                  fill={p.color}
                  opacity="0.8"
                  transform={`rotate(${angle} 12 12) translate(0 -5)`}
                />
              ))}
              <circle cx="12" cy="12" r="2" fill="#ffd700"/>
            </svg>
          )}
          {p.type === "leaf" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M12 2C6 2 2 8 2 14C2 18 6 22 12 22C18 22 22 18 22 14C22 8 18 2 12 2Z" fill={p.color}/>
              <path d="M12 2V22" stroke="#0d8a5f" strokeWidth="1"/>
              <path d="M8 6C10 8 10 12 8 16" stroke="#0d8a5f" strokeWidth="0.5" fill="none"/>
              <path d="M16 6C14 8 14 12 16 16" stroke="#0d8a5f" strokeWidth="0.5" fill="none"/>
            </svg>
          )}
          {p.type === "sunflower" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((angle, i) => (
                <ellipse
                  key={i}
                  cx="12"
                  cy="12"
                  rx="2.5"
                  ry="5"
                  fill="#feca57"
                  transform={`rotate(${angle} 12 12) translate(0 -7)`}
                />
              ))}
              <circle cx="12" cy="12" r="4" fill="#8B4513"/>
              <circle cx="11" cy="11" r="0.5" fill="#000"/>
              <circle cx="13" cy="11" r="0.5" fill="#000"/>
              <circle cx="12" cy="13" r="0.5" fill="#000"/>
            </svg>
          )}
          {p.type === "rose" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M12 4C10 4 8 6 8 8C8 10 10 12 12 12C14 12 16 10 16 8C16 6 14 4 12 4Z" fill={p.color}/>
              <path d="M10 6C9 7 9 9 10 10" stroke="#d32f2f" strokeWidth="0.5" fill="none"/>
              <path d="M14 6C15 7 15 9 14 10" stroke="#d32f2f" strokeWidth="0.5" fill="none"/>
              <path d="M12 8C11 9 11 11 12 12" stroke="#d32f2f" strokeWidth="0.5" fill="none"/>
              <path d="M12 12L12 20" stroke="#10ac84" strokeWidth="2"/>
              <path d="M12 14L8 12" stroke="#10ac84" strokeWidth="1.5"/>
              <path d="M12 16L16 14" stroke="#10ac84" strokeWidth="1.5"/>
            </svg>
          )}
          {p.type === "tulip" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M12 2L8 8L12 10L16 8L12 2Z" fill={p.color}/>
              <path d="M8 8L10 10L8 12L12 10L16 12L14 10L16 8" fill={p.color} opacity="0.8"/>
              <path d="M12 10L12 20" stroke="#10ac84" strokeWidth="2"/>
              <path d="M12 14L8 12" stroke="#10ac84" strokeWidth="1.5"/>
              <path d="M12 16L16 14" stroke="#10ac84" strokeWidth="1.5"/>
            </svg>
          )}
          {p.type === "seed" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="12" rx="4" ry="6" fill={p.color}/>
              <path d="M12 6L12 2" stroke="#10ac84" strokeWidth="1.5"/>
              <path d="M10 4L12 2L14 4" stroke="#10ac84" strokeWidth="1" fill="none"/>
            </svg>
          )}
          {p.type === "tree" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <polygon points="12,2 4,14 20,14" fill={p.color}/>
              <polygon points="12,6 6,16 18,16" fill={p.color} opacity="0.8"/>
              <rect x="10" y="16" width="4" height="6" fill="#8B4513"/>
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
          background: "radial-gradient(circle, rgba(16,172,132,0.5) 0%, rgba(46,125,50,0.2) 50%, transparent 70%)",
        }}
      />
    </div>
  );
}
