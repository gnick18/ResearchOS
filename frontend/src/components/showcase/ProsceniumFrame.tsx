"use client";

// frontend/src/components/showcase/ProsceniumFrame.tsx
//
// The marquee-lit proscenium each Performance Hall act performs inside
// (R2.5 + R3.8). Curtains drawn = resting (poster); parted = active
// (scene plays).
//
// Picker redesign (orchestrator manager): the Scenes view is now ONE
// fixed, centered proscenium window (no scroll sequencer). The selected
// scene plays INSIDE this window: it portals into `sceneViewportRef`
// (a viewport-sized element transform-scaled to fit the frame), so the
// scene's own choreography (which uses viewport-relative units) is
// preserved exactly while the whole composition is scaled into the gold
// frame, centered and not clipped. `stageRef` still marks the resting
// poster stage.
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
  sceneViewportRef,
  children,
  onReplay,
  wide = false,
  posterPose = "idle",
}: {
  title: string;
  active: boolean;
  stageRef: React.Ref<HTMLDivElement>;
  /** The viewport-sized, transform-scaled element the active scene
   *  portals INTO so it plays inside this fixed window (picker redesign).
   *  Optional: omitted in any legacy resting-only use. */
  sceneViewportRef?: React.Ref<HTMLDivElement>;
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
      {/* The stage the scene plays inside. The active scene now portals
          INTO the scaled scene viewport below (so it plays inside this
          fixed window, not full-screen on body); the resting poster lives
          here. */}
      <div className={styles.prosceniumStage} ref={stageRef}>
        {/* Change 2 anti-wash backlight rig: brightest glow BEHIND the
            scene content, with a dark contrast pocket on the silhouette so
            the scene bot is rimmed, not washed (only lit while active). */}
        <div className={styles.prosceniumBacklight} aria-hidden="true" />
        <div className={styles.prosceniumPocket} aria-hidden="true" />
        {/* The scaled scene viewport: a real-viewport-sized element
            (100vw x 100svh) transform-scaled DOWN to fit this window and
            centered. The active scene portals into this element. Because
            it carries a transform, it becomes the containing block for the
            portaled scene's `position: fixed`, so the scene fills + scales
            to the window while keeping its own viewport-unit choreography
            intact. Picker redesign. */}
        {sceneViewportRef ? (
          <div className={styles.prosceniumSceneViewportClip} aria-hidden="true">
            <div
              className={styles.prosceniumSceneViewport}
              ref={sceneViewportRef}
              data-testid="showcase-scene-viewport"
            />
          </div>
        ) : null}
        {/* Frame-scoped chrome (special cases) + the resting poster. The
            scene itself lives in the scaled viewport above; this layer
            holds frame-scale overlays (FauxCursor / ProgressShimmer) so
            they read at frame scale, not scaled with the scene. */}
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
