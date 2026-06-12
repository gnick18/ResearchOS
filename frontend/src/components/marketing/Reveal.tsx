"use client";

import { createElement, useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./Reveal.module.css";

/**
 * Scroll-triggered entrance shared across the marketing surfaces (the welcome /
 * what-we-offer page and /pricing). It ports the login hero's enterUp easing, a
 * 16px rise plus fade on cubic-bezier(.2,.7,.2,1) over 0.6s, onto an
 * IntersectionObserver, so each section lifts in once as it scrolls on screen
 * and every marketing page animates as one family. The observer disconnects
 * after the first reveal, so a section never re-animates or flickers on the way
 * back up. Fully disabled under prefers-reduced-motion (the CSS resets to no
 * transform), and it shows immediately where IntersectionObserver is missing, so
 * nothing is ever stuck invisible.
 *
 * No emojis, no em-dashes, no mid-sentence colons.
 */
export default function Reveal({
  children,
  as = "div",
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  /** The element to render. Defaults to a div. */
  as?: "div" | "section" | "li" | "span";
  /** Stagger in milliseconds, applied as a transition-delay. */
  delay?: number;
  className?: string;
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
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      // Fire a touch before the element is fully on screen.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
