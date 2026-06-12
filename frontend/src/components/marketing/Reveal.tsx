"use client";

import { createElement, useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./Reveal.module.css";

/**
 * Scroll-triggered entrance shared across the marketing surfaces (the welcome /
 * what-we-offer page, /ai, and /pricing). It ports the login hero's enterUp
 * easing, a rise plus fade on cubic-bezier(.2,.7,.2,1), onto an
 * IntersectionObserver so every marketing page animates as one family.
 *
 * By default the reveal is BIDIRECTIONAL: a section lifts in as it scrolls on
 * screen and settles back out (fade plus a small drop) as it leaves, so going
 * back up un-reveals what you passed and coming back down replays it. This is
 * the deliberate "cooler scroll" feel. Pass `once` to keep the old one-shot
 * behavior (reveal a single time, then stop observing) for any surface where
 * re-animating would feel busy.
 *
 * Fully disabled under prefers-reduced-motion (the CSS resets to no transform),
 * and it shows immediately where IntersectionObserver is missing, so nothing is
 * ever stuck invisible.
 *
 * No emojis, no em-dashes, no mid-sentence colons.
 */
export default function Reveal({
  children,
  as = "div",
  delay = 0,
  className = "",
  once = false,
}: {
  children: ReactNode;
  /** The element to render. Defaults to a div. */
  as?: "div" | "section" | "li" | "span";
  /** Stagger in milliseconds, applied as a transition-delay. */
  delay?: number;
  className?: string;
  /** Reveal a single time and stop, instead of the default bidirectional toggle. */
  once?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (once) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
          return;
        }
        // Bidirectional: track the on-screen state both ways so leaving
        // un-reveals and re-entering replays.
        setShown(entry.isIntersecting);
      },
      // Trigger a touch inside both edges so a section settles out just before
      // it fully leaves and lifts in just before it fully arrives.
      { rootMargin: "-10% 0px -10% 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return createElement(
    as,
    {
      ref,
      className: `${styles.reveal} ${shown ? styles.visible : ""} ${className}`.trim(),
      style: delay ? { transitionDelay: `${delay}ms` } : undefined,
    },
    children,
  );
}
