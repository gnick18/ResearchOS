"use client";

import { useEffect, useState, useCallback } from "react";

interface WaterParticle {
  id: number;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
  rotationSpeed: number;
  type: "fish" | "jellyfish" | "coral" | "seaweed" | "shell" | "starfish" | "octopus";
  opacity: number;
  color: string;
}

interface Bubble {
  id: number;
  x: number;
  y: number;
  size: number;
  velocityY: number;
  wobble: number;
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

interface UnderwaterAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const UNDERWATER_EMOJIS = ["🐠", "🐟", "🦈", "🐙", "🦑", "🦀", "🦞", "🦐", "🐚", "🌊"];

const FISH_COLORS = [
  "#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff",
  "#5f27cd", "#00d2d3", "#ff9f43", "#10ac84", "#ee5a24",
];

export default function UnderwaterAnimation({ x, y, onComplete }: UnderwaterAnimationProps) {
  const [particles, setParticles] = useState<WaterParticle[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [emojis, setEmojis] = useState<EmojiParticle[]>([]);
  const [waveOffset, setWaveOffset] = useState(0);

  const createParticles = useCallback(() => {
    const newParticles: WaterParticle[] = [];
    
    // Create fish swimming outward
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      newParticles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: (angle * 180 / Math.PI),
        scale: 0.6 + Math.random() * 0.6,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 5,
        type: "fish",
        opacity: 1,
        color: FISH_COLORS[Math.floor(Math.random() * FISH_COLORS.length)],
      });
    }

    // Create jellyfish floating upward
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      newParticles.push({
        id: 8 + i,
        x: x + (Math.random() - 0.5) * 80,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 30 - 15,
        scale: 0.5 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed * 0.5,
        velocityY: -3 - Math.random() * 3,
        rotationSpeed: (Math.random() - 0.5) * 3,
        type: "jellyfish",
        opacity: 1,
        color: "#ff9ff3",
      });
    }

    // Create octopuses
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 13 + i,
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 360,
        scale: 0.6 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 2,
        rotationSpeed: (Math.random() - 0.5) * 8,
        type: "octopus",
        opacity: 1,
        color: "#ff6b6b",
      });
    }

    // Create shells
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5;
      newParticles.push({
        id: 16 + i,
        x: x + (Math.random() - 0.5) * 70,
        y: y + (Math.random() - 0.5) * 70,
        rotation: Math.random() * 360,
        scale: 0.4 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 1,
        rotationSpeed: (Math.random() - 0.5) * 10,
        type: "shell",
        opacity: 1,
        color: "#feca57",
      });
    }

    // Create starfish
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 4;
      newParticles.push({
        id: 22 + i,
        x: x + (Math.random() - 0.5) * 60,
        y: y + (Math.random() - 0.5) * 60,
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.4,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 1.5,
        rotationSpeed: (Math.random() - 0.5) * 12,
        type: "starfish",
        opacity: 1,
        color: "#ff9f43",
      });
    }

    // Create seaweed strands
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      newParticles.push({
        id: 27 + i,
        x: x + (Math.random() - 0.5) * 90,
        y: y + (Math.random() - 0.5) * 90,
        rotation: Math.random() * 20 - 10,
        scale: 0.5 + Math.random() * 0.5,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 1,
        rotationSpeed: (Math.random() - 0.5) * 5,
        type: "seaweed",
        opacity: 1,
        color: "#10ac84",
      });
    }

    return newParticles;
  }, [x, y]);

  useEffect(() => {
    setParticles(createParticles());
    
    // Create bubbles
    const newBubbles: Bubble[] = [];
    for (let i = 0; i < 30; i++) {
      newBubbles.push({
        id: i,
        x: x + (Math.random() - 0.5) * 150,
        y: y + Math.random() * 50,
        size: 5 + Math.random() * 20,
        velocityY: -2 - Math.random() * 4,
        wobble: Math.random() * Math.PI * 2,
        opacity: 0.6 + Math.random() * 0.4,
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
        emoji: UNDERWATER_EMOJIS[Math.floor(Math.random() * UNDERWATER_EMOJIS.length)],
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
          y: p.y + p.velocityY + 0.3,
          velocityY: p.velocityY + 0.08,
          rotation: p.rotation + p.rotationSpeed,
          opacity: Math.max(0, p.opacity - 0.01),
        })).filter(p => p.y < window.innerHeight + 100 && p.opacity > 0)
      );

      setBubbles(prev =>
        prev.map(b => ({
          ...b,
          y: b.y + b.velocityY,
          x: b.x + Math.sin(b.wobble) * 0.5,
          wobble: b.wobble + 0.1,
          opacity: Math.max(0, b.opacity - 0.008),
        })).filter(b => b.y > -50 && b.opacity > 0)
      );
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          x: e.x + e.velocityX,
          y: e.y + e.velocityY + 0.3,
          velocityY: e.velocityY + 0.05,
          rotation: e.rotation + 2,
          opacity: Math.max(0, e.opacity - 0.012),
          scale: e.scale * 1.003,
        })).filter(e => e.y < window.innerHeight + 50 && e.opacity > 0)
      );

      setWaveOffset(prev => prev + 0.1);
    }, 30);

    // Clean up after animation
    const timeout = setTimeout(() => {
      clearInterval(interval);
      onComplete();
    }, 2500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [createParticles, onComplete, x, y]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Water overlay - fades out quickly */}
      <div 
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, rgba(0,100,150,0.15) 0%, rgba(0,50,100,0.2) 100%)",
          animation: "underwaterFadeOut 1.2s ease-out forwards",
        }}
      />
      <style>{`
        @keyframes underwaterFadeOut {
          0% { opacity: 1; }
          40% { opacity: 0.7; }
          100% { opacity: 0; }
        }
      `}</style>
      
      {/* Wave effect at top */}
      <svg className="absolute top-0 left-0 w-full h-20 opacity-30" viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ animation: "underwaterFadeOut 1.5s ease-out forwards" }}>
        <path
          d={`M0,60 C150,${90 + Math.sin(waveOffset) * 20} 350,${30 + Math.cos(waveOffset) * 20} 600,60 C850,${90 + Math.sin(waveOffset + 1) * 20} 1050,${30 + Math.cos(waveOffset + 1) * 20} 1200,60 L1200,0 L0,0 Z`}
          fill="rgba(100,200,255,0.5)"
        />
      </svg>

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
            background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(100,200,255,0.3))",
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
          {p.type === "fish" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="10" cy="12" rx="7" ry="5" fill={p.color}/>
              <path d="M17 12L22 7V17L17 12Z" fill={p.color}/>
              <circle cx="7" cy="11" r="1.5" fill="#fff"/>
              <circle cx="7" cy="11" r="0.7" fill="#000"/>
              <path d="M10 9C11 8 12 8 13 9" stroke="#fff" strokeWidth="0.5" opacity="0.5"/>
            </svg>
          )}
          {p.type === "jellyfish" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="8" rx="6" ry="5" fill="#ff9ff3" opacity="0.7"/>
              <ellipse cx="12" cy="7" rx="5" ry="4" fill="#ffb6c1" opacity="0.8"/>
              <path d="M7 11Q6 15 7 20" stroke="#ff9ff3" strokeWidth="1.5" fill="none" opacity="0.6"/>
              <path d="M10 12Q9 16 10 21" stroke="#ff9ff3" strokeWidth="1.5" fill="none" opacity="0.6"/>
              <path d="M14 12Q15 16 14 21" stroke="#ff9ff3" strokeWidth="1.5" fill="none" opacity="0.6"/>
              <path d="M17 11Q18 15 17 20" stroke="#ff9ff3" strokeWidth="1.5" fill="none" opacity="0.6"/>
            </svg>
          )}
          {p.type === "octopus" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <ellipse cx="12" cy="8" rx="6" ry="5" fill={p.color}/>
              <circle cx="9" cy="7" r="1.5" fill="#fff"/>
              <circle cx="15" cy="7" r="1.5" fill="#fff"/>
              <circle cx="9" cy="7" r="0.7" fill="#000"/>
              <circle cx="15" cy="7" r="0.7" fill="#000"/>
              <path d="M6 12Q5 16 6 20" stroke={p.color} strokeWidth="2" fill="none"/>
              <path d="M9 13Q8 17 9 21" stroke={p.color} strokeWidth="2" fill="none"/>
              <path d="M12 13Q13 17 12 21" stroke={p.color} strokeWidth="2" fill="none"/>
              <path d="M15 13Q14 17 15 21" stroke={p.color} strokeWidth="2" fill="none"/>
              <path d="M18 12Q19 16 18 20" stroke={p.color} strokeWidth="2" fill="none"/>
            </svg>
          )}
          {p.type === "shell" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M12 4C8 4 4 8 4 14C4 18 8 20 12 20C16 20 20 18 20 14C20 8 16 4 12 4Z" fill={p.color}/>
              <path d="M12 4V20" stroke="#d4a574" strokeWidth="0.5"/>
              <path d="M8 6C10 10 10 14 8 18" stroke="#d4a574" strokeWidth="0.5"/>
              <path d="M16 6C14 10 14 14 16 18" stroke="#d4a574" strokeWidth="0.5"/>
              <ellipse cx="12" cy="4" rx="3" ry="2" fill="#ffe4b5"/>
            </svg>
          )}
          {p.type === "starfish" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M12 2L13.5 9L20 9L15 13L17 20L12 16L7 20L9 13L4 9L10.5 9L12 2Z" 
                fill={p.color} stroke="#d4883c" strokeWidth="0.5"/>
              <circle cx="12" cy="11" r="1.5" fill="#d4883c" opacity="0.5"/>
            </svg>
          )}
          {p.type === "seaweed" && (
            <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
              <path d="M8 22Q6 16 8 10Q10 4 8 2" stroke={p.color} strokeWidth="3" fill="none"/>
              <path d="M12 22Q10 15 12 8Q14 1 12 2" stroke="#0d8a5f" strokeWidth="3" fill="none"/>
              <path d="M16 22Q14 17 16 12Q18 7 16 2" stroke={p.color} strokeWidth="3" fill="none"/>
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
      
      {/* Central splash effect */}
      <div
        className="absolute rounded-full"
        style={{
          left: x - 50,
          top: y - 50,
          width: 100,
          height: 100,
          background: "radial-gradient(circle, rgba(100,200,255,0.5) 0%, rgba(0,100,150,0.2) 50%, transparent 70%)",
        }}
      />
    </div>
  );
}
