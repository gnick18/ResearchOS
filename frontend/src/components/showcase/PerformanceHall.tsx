"use client";

// frontend/src/components/showcase/PerformanceHall.tsx
//
// The Performance Hall (R3.8): the 9 existing scenes (plus the 2 new P1
// drag scenes) each in a marquee-lit proscenium, played one-at-a-time
// via the IntersectionObserver sequencer (useCenteredActive). Only the
// in-view scene is `active`; all others rest as curtain-down posters.
// This is the no-overlap mechanism for P1 (only one scene plays at a
// time, so two full-screen-portal scenes never stack).
//
// Special cases (R3.8): MouseWave gets an in-frame FauxCursor, Skateboard
// gets a wide 21:9 letterbox frame, CoffeeRefill gets a ProgressShimmer
// paced to its verified 13s runtime.
//
// No emojis. The act running order follows the proposal's show-bill
// (open on a greeting, build to physical gags, close on interactive
// BlowingBubbles, then the new drag-stage scenes as the encore).

import {
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import BeakerBotLadderScene from "../BeakerBotLadderScene";
import BeakerBotBugStompScene from "../BeakerBotBugStompScene";
import BeakerBotSkateboardScene from "../BeakerBotSkateboardScene";
import BeakerBotTooManyBeakersScene from "../BeakerBotTooManyBeakersScene";
import BeakerBotMouseWaveScene from "../BeakerBotMouseWaveScene";
import BeakerBotCentrifugeScene from "../BeakerBotCentrifugeScene";
import BeakerBotEurekaScene from "../BeakerBotEurekaScene";
import BeakerBotCoffeeRefillScene from "../BeakerBotCoffeeRefillScene";
import BeakerBotBlowingBubblesScene from "../BeakerBotBlowingBubblesScene";
import BeakerBotRunwayStrutScene from "../BeakerBotRunwayStrutScene";
import BeakerBotTwirlScene from "../BeakerBotTwirlScene";
import { TOTAL_DURATION_MS as COFFEE_TOTAL_DURATION_MS } from "../BeakerBotCoffeeRefillScene";
import ProsceniumFrame from "./ProsceniumFrame";
import { FauxCursor, ProgressShimmer } from "./SpecialCaseChrome";
import { useCenteredActive } from "./useCenteredActive";
import styles from "./showcase.module.css";

type SceneEnvelopeProps = { active: boolean; onComplete?: () => void };
type SceneComponent = ComponentType<SceneEnvelopeProps>;

type SpecialCase = "mouse-wave" | "skateboard" | "coffee-refill";

interface ActData {
  id: string;
  /** Marquee placard title. */
  name: string;
  Component: SceneComponent;
  special?: SpecialCase;
}

/** The show bill. Order paces energy: a greeting, the physical gags, the
 *  long lab-life beats, the interactive closer, then the new drag-stage
 *  scenes as the encore. */
const ACTS: readonly ActData[] = [
  {
    id: "mouse-wave",
    name: "The Greeting",
    Component: BeakerBotMouseWaveScene as unknown as SceneComponent,
    special: "mouse-wave",
  },
  {
    id: "ladder",
    name: "The Ladder",
    Component: BeakerBotLadderScene as unknown as SceneComponent,
  },
  {
    id: "bug-stomp",
    name: "The Bug Stomp",
    Component: BeakerBotBugStompScene as unknown as SceneComponent,
  },
  {
    id: "skateboard",
    name: "Intermission",
    Component: BeakerBotSkateboardScene as unknown as SceneComponent,
    special: "skateboard",
  },
  {
    id: "too-many-beakers",
    name: "Too Many Beakers",
    Component: BeakerBotTooManyBeakersScene as unknown as SceneComponent,
  },
  {
    id: "centrifuge",
    name: "The Centrifuge",
    Component: BeakerBotCentrifugeScene as unknown as SceneComponent,
  },
  {
    id: "eureka",
    name: "Eureka",
    Component: BeakerBotEurekaScene as unknown as SceneComponent,
  },
  {
    id: "coffee-refill",
    name: "The Wait Is The Look",
    Component: BeakerBotCoffeeRefillScene as unknown as SceneComponent,
    special: "coffee-refill",
  },
  {
    id: "blowing-bubbles",
    name: "Blowing Bubbles",
    Component: BeakerBotBlowingBubblesScene as unknown as SceneComponent,
  },
  {
    id: "runway-strut",
    name: "The Runway Strut",
    Component: BeakerBotRunwayStrutScene as unknown as SceneComponent,
  },
  {
    id: "twirl",
    name: "The Twirl",
    Component: BeakerBotTwirlScene as unknown as SceneComponent,
  },
];

export const PERFORMANCE_HALL_ACT_COUNT = ACTS.length;

/** One act: a proscenium frame whose scene is mounted+active only when
 *  this act is the centered one. The sequencer guarantees exactly one
 *  active act, so portaled scenes never overlap. */
function HallAct({
  act,
  active,
  frameRef,
}: {
  act: ActData;
  active: boolean;
  frameRef: (el: HTMLElement | null) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const Component = act.Component;

  // The scene's onComplete is a no-op in the Hall: the sequencer (not
  // the scene's own completion) governs lifecycle, and re-activation
  // happens by scrolling away and back. A keyed remount per active flip
  // replays the timeline from frame zero.
  const sceneChildren: ReactNode = active ? (
    <>
      <Component key={`${act.id}-active`} active onComplete={() => {}} />
      {act.special === "mouse-wave" && <FauxCursor />}
      {act.special === "coffee-refill" && (
        <ProgressShimmer durationMs={COFFEE_TOTAL_DURATION_MS} />
      )}
    </>
  ) : null;

  return (
    <div ref={frameRef} data-act-id={act.id} className={styles.hallActWrap}>
      <ProsceniumFrame
        title={act.name}
        active={active}
        stageRef={stageRef}
        wide={act.special === "skateboard"}
      >
        {sceneChildren}
      </ProsceniumFrame>
    </div>
  );
}

export default function PerformanceHall() {
  const { activeIndex, registerRef } = useCenteredActive(ACTS.length);

  return (
    <section className={styles.hall} data-testid="showcase-performance-hall">
      <header className={styles.hallHeader}>
        <span className={styles.hallHeaderTitle}>The Performance Hall</span>
      </header>
      {ACTS.map((act, i) => (
        <HallAct
          key={act.id}
          act={act}
          active={i === activeIndex}
          frameRef={registerRef(i)}
        />
      ))}
    </section>
  );
}
