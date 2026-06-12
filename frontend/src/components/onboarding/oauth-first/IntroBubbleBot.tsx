"use client";

// The animated bubble BeakerBot used as the hero of the OAuth-first landing and
// every entry / loading surface. Renders the shared IntroBeaker mark and overlays
// the rising bubbles from the marketing-deck title slide.
//
// Easter egg: clicking the beaker pops pink hearts that drift up and fade, the
// same playful reward the SVG <BeakerBot> mark gives on click (matched pink, cap,
// and lifetime), so the uniform bubble beaker is just as alive everywhere it
// appears. The hearts use the approved <Icon name="heart"> glyph (a CSS fill
// turns the outline solid) so no raw inline SVG trips the icon guard.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";

import IntroBeaker from "@/components/animations/IntroBeaker";
import { Icon } from "@/components/icons";
import styles from "./IntroBubbleBot.module.css";

// Mirrors the <BeakerBot> heart easter egg: cap concurrent hearts, match the
// 700ms pop lifetime, and fan rapid clicks out with a small per-spawn drift.
const HEART_LIFETIME_MS = 700;
const HEART_MAX_CONCURRENT = 6;
// Horizontal drift presets (px), cycled per spawn so spam-clicks fan out.
const HEART_DRIFT_X_PX = [0, -8, 6, -4, 10, -10, 4, -6];

interface HeartInstance {
  id: number;
  driftX: number;
}

export function IntroBubbleBot({
  size = "lg",
  className,
}: {
  /** "xl" for the full-screen landing hero, "lg" mid, "sm" for the denser
   *  Welcome-back screen. */
  size?: "xl" | "lg" | "sm";
  className?: string;
}) {
  const wrapWidth =
    size === "sm" ? "w-[70px]" : size === "xl" ? "w-[190px]" : "w-[92px]";
  const sizeClass =
    size === "sm" ? styles.sm : size === "xl" ? styles.xl : "";

  const [hearts, setHearts] = useState<HeartInstance[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Drain any in-flight cleanup timers on unmount so we never setState on an
  // unmounted component (the screen can be dismissed mid-pop).
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const spawnHeart = () => {
    const id = counterRef.current++;
    const driftX = HEART_DRIFT_X_PX[id % HEART_DRIFT_X_PX.length] ?? 0;
    setHearts((prev) => {
      const next = [...prev, { id, driftX }];
      return next.length > HEART_MAX_CONCURRENT
        ? next.slice(next.length - HEART_MAX_CONCURRENT)
        : next;
    });
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setHearts((prev) => prev.filter((h) => h.id !== id));
    }, HEART_LIFETIME_MS);
    timersRef.current.add(timer);
  };

  return (
    <div
      className={`${styles.introbot} ${sizeClass} ${wrapWidth} ${className ?? ""}`.trim()}
      onClick={spawnHeart}
    >
      {/* Rising bubbles overlay (decorative). */}
      <div className={styles.bubbles} aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </div>
      <IntroBeaker className="w-full" />
      {/* Heart easter-egg overlay (decorative). */}
      <div className={styles.heartLayer} aria-hidden>
        {hearts.map((h) => (
          <span
            key={h.id}
            className={styles.heart}
            style={{ "--heart-drift-x": `${h.driftX}px` } as React.CSSProperties}
          >
            <Icon name="heart" className={styles.heartGlyph} />
          </span>
        ))}
      </div>
    </div>
  );
}

export default IntroBubbleBot;
