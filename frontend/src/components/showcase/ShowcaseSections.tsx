"use client";

// frontend/src/components/showcase/ShowcaseSections.tsx
//
// The bookend sections of the showcase scroll (R2.4): the "BeakerBot
// Live" show-bill marquee hero up top and the curtain-call footer at the
// bottom. No emojis (custom inline SVG mascot only); no em-dashes.

import Link from "next/link";
import BeakerBot from "../BeakerBot";
import { Marquee } from "./StageChrome";
import styles from "./showcase.module.css";

export function MarqueeHero({
  tagline = "One beaker. Twenty-one looks. One stage.",
}: {
  tagline?: string;
}) {
  return (
    <section className={styles.hero} data-testid="showcase-hero">
      {/* The bulb marquee title floats in the backdrop band; the hero
          repeats the word large as the show-bill headline. */}
      <Marquee word="BEAKERBOT" />
      <span className={styles.heroLive}>live</span>
      <span className={styles.heroTagline}>{tagline}</span>
      <div className={styles.heroBot}>
        <BeakerBot
          pose="waving"
          className="w-full h-full text-sky-500"
          ariaLabel="BeakerBot waves from the stage"
        />
      </div>
      <span className={styles.heroScrollCue}>The show is about to begin</span>
    </section>
  );
}

export function CurtainCallFooter() {
  return (
    <section className={styles.footer} data-testid="showcase-footer">
      <div className={styles.footerBot}>
        <BeakerBot
          pose="bow-wink"
          className="w-full h-full text-sky-500"
          ariaLabel="BeakerBot takes a bow"
        />
      </div>
      <span className={styles.footerCredits}>
        Give him his flowers. That is the whole show.
      </span>
      <Link href="/" className={styles.footerLink}>
        Back to the lab
      </Link>
    </section>
  );
}
