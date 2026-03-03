"use client";

import { useEffect, useState, useCallback } from "react";

interface ConfettiPiece {
  id: number;
  x: number;
  y: number;
  rotation: number;
  color: string;
  size: number;
  velocityX: number;
  velocityY: number;
  type: "confetti" | "star" | "heart" | "unicorn";
}

interface CelebrationAnimationProps {
  x: number;
  y: number;
  onComplete: () => void;
}

const COLORS = [
  "#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff",
  "#5f27cd", "#00d2d3", "#ff9f43", "#10ac84", "#ee5a24",
];

const EMOJIS = ["🦄", "🌈", "⭐", "💖", "✨", "🎉", "🌟", "💫"];

export default function CelebrationAnimation({ x, y, onComplete }: CelebrationAnimationProps) {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);
  const [emojis, setEmojis] = useState<{ id: number; emoji: string; x: number; y: number; opacity: number }[]>([]);

  const createPieces = useCallback(() => {
    const newPieces: ConfettiPiece[] = [];
    
    // Create confetti pieces
    for (let i = 0; i < 50; i++) {
      newPieces.push({
        id: i,
        x: x + (Math.random() - 0.5) * 100,
        y: y + (Math.random() - 0.5) * 50,
        rotation: Math.random() * 360,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: Math.random() * 10 + 5,
        velocityX: (Math.random() - 0.5) * 15,
        velocityY: Math.random() * -15 - 5,
        type: "confetti",
      });
    }

    // Create stars
    for (let i = 0; i < 10; i++) {
      newPieces.push({
        id: 50 + i,
        x: x + (Math.random() - 0.5) * 150,
        y: y + (Math.random() - 0.5) * 100,
        rotation: Math.random() * 360,
        color: "#ffd700",
        size: Math.random() * 15 + 10,
        velocityX: (Math.random() - 0.5) * 10,
        velocityY: Math.random() * -12 - 3,
        type: "star",
      });
    }

    // Create hearts
    for (let i = 0; i < 8; i++) {
      newPieces.push({
        id: 60 + i,
        x: x + (Math.random() - 0.5) * 120,
        y: y + (Math.random() - 0.5) * 80,
        rotation: Math.random() * 360,
        color: "#ff69b4",
        size: Math.random() * 12 + 8,
        velocityX: (Math.random() - 0.5) * 8,
        velocityY: Math.random() * -10 - 2,
        type: "heart",
      });
    }

    return newPieces;
  }, [x, y]);

  useEffect(() => {
    setPieces(createPieces());
    
    // Create floating emojis
    const newEmojis = EMOJIS.slice(0, 6).map((emoji, i) => ({
      id: i,
      emoji,
      x: x + (Math.random() - 0.5) * 200,
      y: y + (Math.random() - 0.5) * 100,
      opacity: 1,
    }));
    setEmojis(newEmojis);

    // Animate pieces
    const interval = setInterval(() => {
      setPieces(prev => 
        prev.map(piece => ({
          ...piece,
          x: piece.x + piece.velocityX,
          y: piece.y + piece.velocityY + 2, // gravity
          velocityY: piece.velocityY + 0.5,
          rotation: piece.rotation + 5,
        })).filter(piece => piece.y < window.innerHeight + 50)
      );
      
      setEmojis(prev => 
        prev.map(e => ({
          ...e,
          y: e.y - 2,
          opacity: e.opacity - 0.02,
        })).filter(e => e.opacity > 0)
      );
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
  }, [createPieces, onComplete, x, y]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100]">
      {/* Confetti pieces */}
      {pieces.map(piece => (
        <div
          key={piece.id}
          className="absolute"
          style={{
            left: piece.x,
            top: piece.y,
            transform: `rotate(${piece.rotation}deg)`,
            width: piece.size,
            height: piece.type === "confetti" ? piece.size * 0.6 : piece.size,
          }}
        >
          {piece.type === "confetti" && (
            <div
              className="w-full h-full rounded-sm"
              style={{ backgroundColor: piece.color }}
            />
          )}
          {piece.type === "star" && (
            <svg viewBox="0 0 24 24" fill={piece.color} className="w-full h-full">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          )}
          {piece.type === "heart" && (
            <svg viewBox="0 0 24 24" fill={piece.color} className="w-full h-full">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          )}
        </div>
      ))}
      
      {/* Floating emojis */}
      {emojis.map(e => (
        <div
          key={e.id}
          className="absolute text-3xl"
          style={{
            left: e.x,
            top: e.y,
            opacity: e.opacity,
            transform: `scale(${1 + (1 - e.opacity) * 0.5})`,
          }}
        >
          {e.emoji}
        </div>
      ))}
      
      {/* Rainbow arc */}
      <div
        className="absolute"
        style={{
          left: x - 100,
          top: y - 80,
          width: 200,
          height: 100,
        }}
      >
        <svg viewBox="0 0 200 100" className="w-full h-full animate-pulse">
          <defs>
            <linearGradient id="rainbow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ff0000" />
              <stop offset="17%" stopColor="#ff8000" />
              <stop offset="33%" stopColor="#ffff00" />
              <stop offset="50%" stopColor="#00ff00" />
              <stop offset="67%" stopColor="#0080ff" />
              <stop offset="83%" stopColor="#8000ff" />
              <stop offset="100%" stopColor="#ff0080" />
            </linearGradient>
          </defs>
          <path
            d="M 10 100 Q 100 -20 190 100"
            fill="none"
            stroke="url(#rainbow)"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="0.8"
          />
        </svg>
      </div>
    </div>
  );
}
