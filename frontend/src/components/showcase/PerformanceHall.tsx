"use client";

// frontend/src/components/showcase/PerformanceHall.tsx
//
// The Performance Hall (Scenes view), redesigned (orchestrator manager).
//
// THE OLD MODEL (replaced): 11 prosceniums stacked down a long scroll,
// activated one-at-a-time by scroll position (useCenteredActive). Because
// the user scrolled to change scenes, the gold frame scrolled with the
// page while each scene portaled full-screen to document.body, so the
// scene played OUTSIDE / misaligned with its frame. (Grant: "he isnt
// staying in his windows ... we still have the user scroll to change the
// scene which makes the curtain area not a fixed area.")
//
// THE NEW MODEL: ONE fixed, centered proscenium window (no scroll), plus a
// professional scene-picker (one pill per act). Clicking a pill plays THAT
// act inside the fixed window. Exactly one scene is mounted + active at a
// time (the selected one), preserving the no-overlap guarantee. On enter,
// a sensible default plays (the first act, The Greeting). The scene plays
// INSIDE the window by portaling into the frame's scaled scene viewport
// (portalTarget), so it never escapes to full-screen on document.body.
//
// Special cases kept: mouse-wave gets the in-frame FauxCursor, coffee
// gets the ProgressShimmer (paced to COFFEE_TOTAL_DURATION_MS), skateboard
// gets the wide frame (`wide`).
//
// No emojis (custom inline SVG only); no em-dashes.

import {
  useEffect,
  useLayoutEffect,
  useState,
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
import styles from "./showcase.module.css";

// Every scene now accepts an optional portalTarget (defaults to
// document.body everywhere else in the app); the Hall passes the frame's
// scaled scene viewport so the scene plays inside the fixed window.
type SceneEnvelopeProps = {
  active: boolean;
  onComplete?: () => void;
  portalTarget?: HTMLElement | null;
};
type SceneComponent = ComponentType<SceneEnvelopeProps>;

type SpecialCase = "mouse-wave" | "skateboard" | "coffee-refill";

interface ActData {
  id: string;
  /** Marquee placard title + scene-picker label. */
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

/** The scene-picker control: one pill per act, styled like StageNav (gold
 *  active state, plum accents, uppercase letter-spacing, rounded). Laid
 *  out as a centered wrapping grid so 11 acts read as a polished act
 *  selector, not a plain list. The active act shows a clear selected
 *  state. */
function ScenePicker({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className={styles.scenePicker}
      role="tablist"
      aria-label="Choose a scene"
      data-testid="showcase-scene-picker"
    >
      {ACTS.map((act) => {
        const selected = act.id === activeId;
        return (
          <button
            key={act.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`${styles.scenePickerBtn} ${
              selected ? styles.scenePickerBtnActive : ""
            }`}
            onClick={() => onSelect(act.id)}
            data-testid={`showcase-scene-pick-${act.id}`}
            data-selected={selected ? "true" : "false"}
          >
            {act.name}
          </button>
        );
      })}
    </div>
  );
}

export default function PerformanceHall() {
  // The selected act. Default is the first act (The Greeting) so a
  // sensible scene plays the moment the Scenes view mounts.
  const [activeId, setActiveId] = useState<string>(ACTS[0]!.id);

  // The frame's scaled scene viewport: the active scene portals INTO this
  // element (so it plays inside the fixed window). Tracked as state, not a
  // ref, so the portal target is available on the render after first
  // paint (createPortal needs a live element, and the scene short-circuits
  // to null until then via its own SSR guard).
  const [sceneViewport, setSceneViewport] = useState<HTMLDivElement | null>(
    null,
  );

  // Compute the contain-fit scale that maps the real-viewport-sized scene
  // viewport (100vw x 100svh) into the fixed window (its clip parent), so
  // the whole scene fits inside the gold frame, centered and not clipped.
  // A single uniform scale can't match two different aspect ratios, so we
  // take the smaller of the width-fit and height-fit (a "contain").
  //
  // FIX 1a (orchestrator manager): the old effect measured the clip ONCE on
  // mount and bailed (`return`) whenever the rect had no layout yet. On
  // first paint the window often has no dimensions, so the scale stayed
  // stuck at its 0.32 default forever (no resize ever fires to recompute) —
  // BeakerBot rendered tiny. We now (1) run in a layout effect, (2) retry
  // across a couple of animation frames until the clip has real size, and
  // (3) keep a ResizeObserver live so any later layout change (or the
  // skateboard wide-frame swap) re-measures. Re-runs on activeId + resize.
  //
  // FIX 1b (orchestrator manager): even at the true contain-fit, the
  // full-viewport composition leaves BeakerBot small inside a large window.
  // Grant wants him to fill the stage like a real performance, so we
  // multiply the contain-fit by SCENE_ZOOM and anchor transform-origin to
  // the lower-center band (where the bench scenes act, ~88% down), so the
  // performer grows toward the audience and is never pushed off the top of
  // frame. A gentle 1.45x keeps every scene's performer fully visible (an
  // aggressive zoom cropped the wider scenes), while still reading as the
  // star of the stage rather than a dot.
  useLayoutEffect(() => {
    if (!sceneViewport || typeof window === "undefined") return;
    const clip = sceneViewport.parentElement;
    if (!clip) return;

    // Multiply the contain-fit so the performer reads larger than a pure
    // contain. Kept conservative: at 1.45 with a low (88%) origin the zoom
    // pushed off-center performers (Centrifuge bot, BlowingBubbles) clean out
    // of frame. 1.22 with a near-center origin (see .prosceniumSceneViewport)
    // keeps every scene's performer in view while still reading larger.
    const SCENE_ZOOM = 1.22;

    let raf = 0;
    let attempts = 0;
    const applyScale = () => {
      const rect = clip.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        // No layout yet: retry on the next frame (up to a few times) so the
        // real contain-fit is computed once the window has dimensions,
        // instead of leaving the default 0.32 baked in.
        if (attempts < 10) {
          attempts += 1;
          raf = window.requestAnimationFrame(applyScale);
        }
        return;
      }
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const containFit = Math.min(rect.width / vw, rect.height / vh);
      const scale = containFit * SCENE_ZOOM;
      sceneViewport.style.setProperty("--scene-scale", String(scale));
    };

    applyScale();

    // Re-measure on any size change to the clip (covers the wide-frame
    // swap, late layout, font load, devtools, etc.) and on window resize.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => applyScale());
      ro.observe(clip);
    }
    window.addEventListener("resize", applyScale, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", applyScale);
    };
    // activeId is included so the scale re-measures if a wide act swaps in
    // a different frame aspect (skateboard's 21:9 band).
  }, [sceneViewport, activeId]);

  const act = ACTS.find((a) => a.id === activeId) ?? ACTS[0]!;
  const Component = act.Component;

  // The active scene plays inside the window. Keyed by act id so switching
  // acts (or re-picking the same one is a no-op) replays the timeline from
  // frame zero. onComplete is a no-op: the picker, not scene completion,
  // governs which scene is on stage. Special-case chrome (FauxCursor /
  // ProgressShimmer) renders at frame scale via ProsceniumFrame children.
  const sceneChrome: ReactNode = (
    <>
      {act.special === "mouse-wave" && <FauxCursor />}
      {act.special === "coffee-refill" && (
        <ProgressShimmer durationMs={COFFEE_TOTAL_DURATION_MS} />
      )}
    </>
  );

  return (
    <section className={styles.hall} data-testid="showcase-performance-hall">
      {/* The "Performance Hall" header was removed: it overlapped the
          BeakerBot bulb marquee at the top of the stage. The marquee logo is
          the title. */}

      {/* ONE fixed, centered window. Does not scroll. */}
      <div className={styles.hallStageWrap}>
        <ProsceniumFrame
          title={act.name}
          active
          stageRef={null}
          sceneViewportRef={setSceneViewport}
          wide={act.special === "skateboard"}
          revealKey={activeId}
        >
          {sceneChrome}
        </ProsceniumFrame>
        {/* The active scene, portaled into the frame's scaled viewport so
            it plays inside the window. Only ONE scene is mounted at a time
            (the selected one), so two portal scenes never overlap. The
            scene self-guards SSR + waits for portalTarget to be live. */}
        <Component
          key={act.id}
          active
          onComplete={() => {}}
          portalTarget={sceneViewport}
        />
      </div>

      {/* The professional scene-picker. */}
      <ScenePicker activeId={activeId} onSelect={setActiveId} />
    </section>
  );
}
