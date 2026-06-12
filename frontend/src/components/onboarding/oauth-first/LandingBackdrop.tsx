"use client";

// The shared deck-style backdrop from the OAuth-first landing, pulled into its
// own component so other entry surfaces (the account-select / sign-in screen)
// can sit on the exact same stage: a light radial wash, a masked dot grid, the
// drifting rainbow auroras and floating beakers on a cursor-parallax layer, and
// the rainbow bars top and bottom. It reuses OAuthFirstLanding.module.css so the
// two surfaces are guaranteed to match. Fully decorative, pointer-events none,
// and the parallax is disabled under prefers-reduced-motion.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef } from "react";

import BeakerBot from "@/components/BeakerBot";
import styles from "./OAuthFirstLanding.module.css";

// A floating BeakerBot mark, faded, used as deck-style background decoration.
function FloatBot({ className }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none absolute opacity-10 ${className ?? ""}`}
      aria-hidden
    >
      <BeakerBot
        pose="idle"
        animated={false}
        ariaLabel=""
        className="w-full text-brand-sky"
      />
    </div>
  );
}

export default function LandingBackdrop({ className }: { className?: string }) {
  // Cursor parallax for the decorative layer (auroras, beakers).
  const fxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = fxRef.current;
    if (!layer) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const dx = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
        const dy =
          (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2);
        layer.style.transform = `translate(${(-dx * 12).toFixed(1)}px, ${(-dy * 10).toFixed(1)}px)`;
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`}
    >
      {/* Light radial wash base, matching the landing hero. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(620px 420px at 50% 4%, #ffffff 0%, #f6f9ff 55%, #eef4ff 100%)",
        }}
      />

      {/* Masked dot-grid stage. */}
      <div className={styles.dotgrid} />

      {/* Parallax decorative layer: drifting auroras + floating beakers. */}
      <div ref={fxRef} className={styles.parallaxLayer}>
        <div className={`${styles.aurora} ${styles.a1}`} />
        <div className={`${styles.aurora} ${styles.a2}`} />
        <div className={`${styles.aurora} ${styles.a3}`} />
        <div className={`${styles.aurora} ${styles.a4}`} />
        <FloatBot className={`${styles.floaty} top-[12%] left-[7%] w-20`} />
        <FloatBot
          className={`${styles.floaty} ${styles.s2} bottom-[15%] left-[11%] w-14`}
        />
        <FloatBot
          className={`${styles.floaty} ${styles.s3} top-[15%] right-[8%] w-16`}
        />
        <FloatBot
          className={`${styles.floaty} ${styles.s4} bottom-[13%] right-[6%] w-24`}
        />
      </div>

      {/* Rainbow bars, top and bottom. */}
      <div className="absolute inset-x-0 top-0 h-[7px] brand-rainbow-bg" />
      <div className="absolute inset-x-0 bottom-0 h-[7px] brand-rainbow-bg" />
    </div>
  );
}
