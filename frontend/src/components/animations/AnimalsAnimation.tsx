"use client";

import { useEffect, useState, useCallback } from "react";

interface AnimalParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: "paw" | "feather" | "bird" | "butterfly" | "cat" | "dog" | "fish";
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

interface AnimalsAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const ANIMAL_EMOJIS = ["🐱", "🐶", "🐦", "🦋", "🐠", "🦊", "🐰", "🐻", "🦋", "🐾"];

const ANIMAL_COLORS = [
  "#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff",
  "#ff9f43", "#10ac84", "#5f27cd", "#ee5a24", "#00d2d3",
];

export default function AnimalsAnimation({ x, y, onComplete }: AnimalsAnimationProps) {
  const [particles, setParticles] = useState<AnimalParticle[]>([]);
  const [emojis, setEmojis] = useState<EmojiParticle[]>([]);
  const [sparkles, setSparkles] = useState<{ id: number; x: number; y: number; opacity: number }[]>([]);

  const createParticles = useCallback(() => {
    const newParticles: AnimalParticle[] = [];
    
    // Create paw prints
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newParticles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "paw",
        opacity: 1,
        color: ANIMAL_COLORS[Math.floor(Math.random() * ANIMAL_COLORS.length)],
      });
    }

    // Create feathers
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 10 + i,
        x: x + (Math.random() - 0.5) * 80,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 6,
        type: "feather",
        opacity: 1,
        color: ANIMAL_COLORS[Math.floor(Math.random() * ANIMAL_COLORS.length)],
      });
    }

    // Create birds
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 7;
      newParticles.push({
        id: 18 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: (angle * 180 / Math.PI),
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 5,
        type: "bird",
        opacity: 1,
        color: "#48dbfb",
      });
    }

    // Create butterflies
    for (let i = 0; i < 7; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      newParticles.push({
        id: 24 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 10,
        type: "butterfly",
        opacity: 1,
        color: ANIMAL_COLORS[Math.floor(Math.random() * ANIMAL_COLORS.length)],
      });
    }

    // Create cats
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 31 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 20 - 10,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 4,
        type: "cat",
        opacity: 1,
        color: "#ff9f43",
      });
    }

    // Create dogs
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 5;
      newParticles.push({
        id: 35 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 20 - 10,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 4,
        type: "dog",
        opacity: 1,
        color: "#8B4513",
      });
    }

    // Create fish
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newParticles.push({
        id: 39 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: (angle * 180 / Math.PI),
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "fish",
        opacity: 1,
        color: ANIMAL_COLORS[Math.floor(Math.random() * ANIMAL_COLORS.length)],
      });
    }

    return newParticles;
  }, [x, y]);

  useEffect(() => {
    setParticles(createParticles());
    
    // Create sparkles
    const newSparkles = [];
    for (let i = 0; i < 15; i++) {
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
        emoji: ANIMAL_EMOJIS[Math.floor(Math.random() * ANIMAL_EMOJIS.length)],
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
          y: p.y + p.velocityY + 0.35,
          velocityY: p.velocityY + 0.12,
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.01),
        })).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          x: e.x + e.velocityX,
          y: e.y + e.velocityY + 0.35,
          velocityY: e.velocityY + 0.1,
          rotation: e.rotation + 3,
          opacity: Math.max(0, e.opacity - 0.012),
          scale: e.scale * 1.003,
        })).filter(e => e.y < window.innerHeight + 50 && e.opacity > 0)
      );

      setSparkles(prev =>
        prev.map(s => ({
          ...s,
          opacity: Math.max(0, s.opacity - 0.025),
        })).filter(s => s.opacity > 0)
      );
    }, 30);

    // Clean up after animation
    const timeout = setTimeout(() => {
      clearInterval(interval);
      onComplete();
    }, 3200);

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
          className="absolute text-lg"
          style={{
            left: s.x,
            top: s.y,
            opacity: s.opacity,
          }}
        >
          ⭐
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
          {p.type === "paw" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="16" rx="5" ry="4" fill={p.color}/>
              <circle cx="7" cy="9" r="3" fill={p.color}/>
              <circle cx="17" cy="9" r="3" fill={p.color}/>
              <circle cx="10" cy="5" r="2.5" fill={p.color}/>
              <circle cx="14" cy="5" r="2.5" fill={p.color}/>
            </svg>
          )}
          {p.type === "feather" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M12 2C8 6 6 12 6 18C6 20 8 22 12 22C16 22 18 20 18 18C18 12 16 6 12 2Z" fill={p.color} opacity="0.8"/>
              <path d="M12 2V22" stroke="#333" strokeWidth="1"/>
              <path d="M8 8C10 10 14 10 16 8" stroke="#333" strokeWidth="0.5" fill="none"/>
              <path d="M8 12C10 14 14 14 16 12" stroke="#333" strokeWidth="0.5" fill="none"/>
            </svg>
          )}
          {p.type === "bird" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="12" rx="5" ry="4" fill={p.color}/>
              <circle cx="15" cy="11" r="2" fill="#fff"/>
              <circle cx="15.5" cy="11" r="0.8" fill="#000"/>
              <path d="M17 12L20 11L17 13L17 12Z" fill="#ff9f43"/>
              <path d="M7 10L3 6L7 12L3 14L7 10Z" fill={p.color} opacity="0.8"/>
              <path d="M9 14L6 18L10 14L9 14Z" fill={p.color} opacity="0.6"/>
            </svg>
          )}
          {p.type === "butterfly" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="8" cy="10" rx="5" ry="6" fill={p.color} opacity="0.8"/>
              <ellipse cx="16" cy="10" rx="5" ry="6" fill={p.color} opacity="0.8"/>
              <ellipse cx="8" cy="16" rx="3" ry="4" fill={p.color} opacity="0.6"/>
              <ellipse cx="16" cy="16" rx="3" ry="4" fill={p.color} opacity="0.6"/>
              <ellipse cx="12" cy="12" rx="1.5" ry="6" fill="#333"/>
              <path d="M11 6L10 2" stroke="#333" strokeWidth="1"/>
              <path d="M13 6L14 2" stroke="#333" strokeWidth="1"/>
            </svg>
          )}
          {p.type === "cat" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="14" rx="6" ry="5" fill={p.color}/>
              <circle cx="12" cy="8" r="5" fill={p.color}/>
              <polygon points="7,6 5,2 9,5" fill={p.color}/>
              <polygon points="17,6 19,2 15,5" fill={p.color}/>
              <circle cx="10" cy="7" r="1.5" fill="#fff"/>
              <circle cx="14" cy="7" r="1.5" fill="#fff"/>
              <circle cx="10" cy="7" r="0.7" fill="#000"/>
              <circle cx="14" cy="7" r="0.7" fill="#000"/>
              <ellipse cx="12" cy="9" rx="1" ry="0.5" fill="#ff6b6b"/>
            </svg>
          )}
          {p.type === "dog" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="14" rx="6" ry="5" fill={p.color}/>
              <circle cx="12" cy="8" r="5" fill={p.color}/>
              <ellipse cx="7" cy="5" rx="2" ry="4" fill={p.color}/>
              <ellipse cx="17" cy="5" rx="2" ry="4" fill={p.color}/>
              <circle cx="10" cy="7" r="1.5" fill="#fff"/>
              <circle cx="14" cy="7" r="1.5" fill="#fff"/>
              <circle cx="10" cy="7" r="0.7" fill="#000"/>
              <circle cx="14" cy="7" r="0.7" fill="#000"/>
              <ellipse cx="12" cy="10" rx="2" ry="1.5" fill="#333"/>
              <ellipse cx="12" cy="16" rx="1.5" ry="1" fill="#ff9f43" opacity="0.6"/>
            </svg>
          )}
          {p.type === "fish" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="10" cy="12" rx="7" ry="5" fill={p.color}/>
              <path d="M17 12L22 7V17L17 12Z" fill={p.color}/>
              <circle cx="7" cy="11" r="1.5" fill="#fff"/>
              <circle cx="7" cy="11" r="0.7" fill="#000"/>
              <path d="M10 9C11 8 12 8 13 9" stroke="#fff" strokeWidth="0.5" opacity="0.5" fill="none"/>
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
          background: "radial-gradient(circle, rgba(255,159,67,0.5) 0%, rgba(139,69,19,0.2) 50%, transparent 70%)",
        }}
      />
    </div>
  );
}
