"use client";

import { useEffect, useState, useCallback } from "react";

interface ScienceParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: "atom" | "dna" | "beaker" | "molecule" | "microscope" | "flask" | "testtube";
  opacity: number;
  color: string;
}

interface Bubble {
  id: number;
  x: number;
  y: number;
  size: number;
  velocityY: number;
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

interface ScienceAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const SCIENCE_EMOJIS = ["🔬", "🧬", "⚗️", "🧪", "🧫", "🔭", "💡", "⚛️", "🦠", "💊"];

const SCIENCE_COLORS = [
  "#00bcd4", "#4caf50", "#2196f3", "#9c27b0", "#ff5722",
  "#009688", "#673ab7", "#3f51b5", "#00e676", "#651fff",
];

export default function ScienceAnimation({ x, y, onComplete }: ScienceAnimationProps) {
  const [particles, setParticles] = useState<ScienceParticle[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [emojis, setEmojis] = useState<EmojiParticle[]>([]);
  const [glowPulse, setGlowPulse] = useState(0);

  const createParticles = useCallback(() => {
    const newParticles: ScienceParticle[] = [];
    
    // Create atoms
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 7;
      newParticles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 10,
        type: "atom",
        opacity: 1,
        color: SCIENCE_COLORS[Math.floor(Math.random() * SCIENCE_COLORS.length)],
      });
    }

    // Create DNA helixes
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 5;
      newParticles.push({
        id: 6 + i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "dna",
        opacity: 1,
        color: "#4caf50",
      });
    }

    // Create beakers
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      newParticles.push({
        id: 11 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 30 - 15,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 5,
        rotationSpeed: (Math.random() - 0.5) * 5,
        type: "beaker",
        opacity: 1,
        color: "#00bcd4",
      });
    }

    // Create molecules
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newParticles.push({
        id: 15 + i,
        x: x + (Math.random() - 0.5) * 80,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 360,
        scale: 0.4 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 12,
        type: "molecule",
        opacity: 1,
        color: SCIENCE_COLORS[Math.floor(Math.random() * SCIENCE_COLORS.length)],
      });
    }

    // Create microscopes
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 23 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 20 - 10,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 5,
        type: "microscope",
        opacity: 1,
        color: "#607d8b",
      });
    }

    // Create flasks
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 5;
      newParticles.push({
        id: 26 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 30 - 15,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 4,
        rotationSpeed: (Math.random() - 0.5) * 6,
        type: "flask",
        opacity: 1,
        color: "#9c27b0",
      });
    }

    // Create test tubes
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 5;
      newParticles.push({
        id: 30 + i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 40 - 20,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 3,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "testtube",
        opacity: 1,
        color: SCIENCE_COLORS[Math.floor(Math.random() * SCIENCE_COLORS.length)],
      });
    }

    return newParticles;
  }, [x, y]);

  useEffect(() => {
    setParticles(createParticles());
    
    // Create bubbles
    const newBubbles: Bubble[] = [];
    for (let i = 0; i < 25; i++) {
      newBubbles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 120,
        y: y + Math.random() * 40,
        size: 4 + Math.random() * 12,
        velocityY: -1.5 - Math.random() * 3,
        opacity: 0.5 + Math.random() * 0.5,
      });
    }
    setBubbles(newBubbles);

    // Create emoji particles
    const newEmojis: EmojiParticle[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newEmojis.push({
        id: i,
        emoji: SCIENCE_EMOJIS[Math.floor(Math.random() * SCIENCE_EMOJIS.length)],
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
          y: p.y + p.velocityY + 0.4,
          velocityY: p.velocityY + 0.15,
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.01),
        })).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );

      setBubbles(prev =>
        prev.map(b => ({
          ...b,
          y: b.y + b.velocityY,
          opacity: Math.max(0, b.opacity - 0.01),
        })).filter(b => b.y > -50 && b.opacity > 0)
      );
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          x: e.x + e.velocityX,
          y: e.y + e.velocityY + 0.4,
          velocityY: e.velocityY + 0.1,
          rotation: e.rotation + 3,
          opacity: Math.max(0, e.opacity - 0.012),
          scale: e.scale * 1.003,
        })).filter(e => e.y < window.innerHeight + 50 && e.opacity > 0)
      );

      setGlowPulse(prev => prev + 0.15);
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
      {/* Bubbles */}
      {bubbles.map(b => (
        <div
          key={`bubble-${b.id}`}
          className="absolute rounded-full"
          style={{
            left: b.x,
            top: b.y,
            width: b.size,
            height: b.size,
            background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6), rgba(0,188,212,0.2))",
            opacity: b.opacity,
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
          {p.type === "atom" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <circle cx="12" cy="12" r="3" fill={p.color}/>
              <ellipse cx="12" cy="12" rx="10" ry="4" stroke={p.color} strokeWidth="1.5" fill="none"/>
              <ellipse cx="12" cy="12" rx="10" ry="4" stroke={p.color} strokeWidth="1.5" fill="none" transform="rotate(60 12 12)"/>
              <ellipse cx="12" cy="12" rx="10" ry="4" stroke={p.color} strokeWidth="1.5" fill="none" transform="rotate(-60 12 12)"/>
            </svg>
          )}
          {p.type === "dna" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M6 4Q12 8 18 4" stroke="#4caf50" strokeWidth="2" fill="none"/>
              <path d="M6 10Q12 6 18 10" stroke="#2196f3" strokeWidth="2" fill="none"/>
              <path d="M6 14Q12 18 18 14" stroke="#4caf50" strokeWidth="2" fill="none"/>
              <path d="M6 20Q12 16 18 20" stroke="#2196f3" strokeWidth="2" fill="none"/>
              <line x1="9" y1="6" x2="15" y2="6" stroke="#9c27b0" strokeWidth="1.5"/>
              <line x1="9" y1="12" x2="15" y2="12" stroke="#9c27b0" strokeWidth="1.5"/>
              <line x1="9" y1="18" x2="15" y2="18" stroke="#9c27b0" strokeWidth="1.5"/>
            </svg>
          )}
          {p.type === "beaker" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M8 2V8L4 20H20L16 8V2H8Z" fill="none" stroke="#607d8b" strokeWidth="1.5"/>
              <rect x="7" y="1" width="10" height="2" rx="0.5" fill="#607d8b"/>
              <path d="M6 16H18L16 10H8L6 16Z" fill={p.color} opacity="0.6"/>
              <circle cx="10" cy="13" r="1" fill="#fff" opacity="0.5"/>
              <circle cx="14" cy="14" r="0.7" fill="#fff" opacity="0.5"/>
            </svg>
          )}
          {p.type === "molecule" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <circle cx="12" cy="8" r="4" fill={p.color}/>
              <circle cx="6" cy="16" r="3" fill={p.color} opacity="0.8"/>
              <circle cx="18" cy="16" r="3" fill={p.color} opacity="0.8"/>
              <line x1="12" y1="12" x2="8" y2="14" stroke={p.color} strokeWidth="2"/>
              <line x1="12" y1="12" x2="16" y2="14" stroke={p.color} strokeWidth="2"/>
            </svg>
          )}
          {p.type === "microscope" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <rect x="10" y="2" width="4" height="10" rx="1" fill="#607d8b"/>
              <circle cx="12" cy="14" r="4" fill="#455a64"/>
              <rect x="8" y="18" width="8" height="2" fill="#607d8b"/>
              <rect x="6" y="20" width="12" height="2" rx="1" fill="#455a64"/>
              <circle cx="12" cy="14" r="2" fill="#00bcd4" opacity="0.5"/>
            </svg>
          )}
          {p.type === "flask" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M9 2V6L5 18H19L15 6V2H9Z" fill="none" stroke="#607d8b" strokeWidth="1.5"/>
              <rect x="8" y="1" width="8" height="2" rx="0.5" fill="#607d8b"/>
              <path d="M7 14H17L15 8H9L7 14Z" fill={p.color} opacity="0.5"/>
              <path d="M10 10Q12 8 14 10" stroke="#fff" strokeWidth="1" opacity="0.5" fill="none"/>
            </svg>
          )}
          {p.type === "testtube" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <rect x="9" y="2" width="6" height="18" rx="3" fill="none" stroke="#607d8b" strokeWidth="1.5"/>
              <rect x="8" y="1" width="8" height="2" rx="0.5" fill="#607d8b"/>
              <rect x="10" y="10" width="4" height="8" rx="2" fill={p.color} opacity="0.6"/>
              <circle cx="12" cy="14" r="1" fill="#fff" opacity="0.4"/>
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
      
      {/* Central glow with pulse */}
      <div
        className="absolute rounded-full"
        style={{
          left: x - 40,
          top: y - 40,
          width: 80,
          height: 80,
          background: `radial-gradient(circle, rgba(0,188,212,${0.5 + Math.sin(glowPulse) * 0.2}) 0%, rgba(156,39,176,0.2) 50%, transparent 70%)`,
        }}
      />
    </div>
  );
}
