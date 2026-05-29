"use client";

// frontend/src/components/showcase/ProsceniumFrame.tsx
//
// The marquee-lit proscenium each Performance Hall act performs inside
// (R2.5 + R3.8). Curtains drawn = resting (poster); parted = active
// (scene plays). In the P1 Option-3 sequencer the active scene still
// portals full-screen, but only ONE is active at a time so they never
// overlap. `stageRef` is the future Option-1 bounds target (P2+).
//
// No emojis; the chrome (bulbs, curtains, valance, footlights) is pure
// CSS + an idle BeakerBot poster behind the closed curtain.
//
// Change 2 (orchestrator manager): each scene now carries the runway's
// stage lighting + camera flashes. When the frame is active, a backlight
// halo + contrast pocket sit BEHIND the scene content (same anti-wash
// principle as Change 1 so the scene bot is rimmed, not washed), and a
// camera-flash flurry fires on activation and on click.

import { useEffect, useState } from "react";
import BeakerBot, { type BeakerBotPose } from "../BeakerBot";
import { ProsceniumFlashes } from "./StageChrome";
import styles from "./showcase.module.css";

const PROSCENIUM_BULB_COUNT = 14;

export default function ProsceniumFrame({
  title,
  active,
  stageRef,
  children,
  onReplay,
  wide = false,
  posterPose = "idle",
}: {
  title: string;
  active: boolean;
  stageRef: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
  /** Tap-to-replay handler when resting. */
  onReplay?: () => void;
  /** Skateboard gets a wide 21:9 letterbox band (R3.8). */
  wide?: boolean;
  /** Resting poster pose shown faintly behind the closed curtain. */
  posterPose?: BeakerBotPose;
}) {
  // Camera-flash flurry (Change 2). Bumps on activation (so a fresh flurry
  // pops as the curtain parts on a scene) and on click of the active frame
  // (so the audience can re-fire the cameras), mirroring the runway.
  const [flashBump, setFlashBump] = useState(0);
  useEffect(() => {
    if (active) setFlashBump((k) => k + 1);
  }, [active]);

  return (
    <figure
      className={`${styles.proscenium} ${wide ? styles.prosceniumWide : ""} ${
        active ? styles.prosceniumActive : ""
      }`}
      data-active={active ? "true" : "false"}
      data-testid="showcase-proscenium"
      onClick={() => {
        if (active) {
          setFlashBump((k) => k + 1);
        } else {
          onReplay?.();
        }
      }}
    >
      <div className={styles.prosceniumBulbs} aria-hidden="true">
        {Array.from({ length: PROSCENIUM_BULB_COUNT }).map((_, i) => (
          <span
            key={i}
            className={styles.bulb}
            style={{ animationDelay: `${i * -0.1}s` }}
          />
        ))}
      </div>
      <div className={styles.prosceniumValance} aria-hidden="true" />
      {/* The stage the scene plays inside (bounds target, P2+). The
          active scene currently still portals to body; the resting
          poster lives here. */}
      <div className={styles.prosceniumStage} ref={stageRef}>
        {/* Change 2 anti-wash backlight rig: brightest glow BEHIND the
            scene content, with a dark contrast pocket on the silhouette so
            the scene bot is rimmed, not washed (only lit while active). */}
        <div className={styles.prosceniumBacklight} aria-hidden="true" />
        <div className={styles.prosceniumPocket} aria-hidden="true" />
        {/* Scene content sits ON TOP of the backlight rig (positioned z2 in
            the stage so it never paints under the glow). */}
        <div className={styles.prosceniumContent}>
          {active ? (
            children
          ) : (
            <BeakerBot
              pose={posterPose}
              animated={false}
              className={`${styles.posterBot} text-sky-500`}
              ariaLabel="Resting act"
            />
          )}
        </div>
      </div>
      {/* Change 2 camera flashes: fire on activation + on click. */}
      <ProsceniumFlashes fireKey={flashBump} />
      <div className={styles.curtain + " " + styles.curtainLeft} aria-hidden="true" />
      <div className={styles.curtain + " " + styles.curtainRight} aria-hidden="true" />
      <div className={styles.prosceniumFootlights} aria-hidden="true" />
      <figcaption className={styles.prosceniumPlacard}>
        {active ? "Now performing" : "Tap to replay"} &middot; {title}
      </figcaption>
    </figure>
  );
}
