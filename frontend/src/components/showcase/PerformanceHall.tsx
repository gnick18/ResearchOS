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
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import BeakerBotLadderScene from "../BeakerBotLadderScene";
import BeakerBotBugStompScene from "../BeakerBotBugStompScene";
import BeakerBotSkateboardScene from "../BeakerBotSkateboardScene";
import BeakerBotTooManyBeakersScene from "../BeakerBotTooManyBeakersScene";
import BeakerBotCentrifugeScene from "../BeakerBotCentrifugeScene";
import BeakerBotEurekaScene from "../BeakerBotEurekaScene";
import BeakerBotCoffeeRefillScene from "../BeakerBotCoffeeRefillScene";
import BeakerBotBlowingBubblesScene from "../BeakerBotBlowingBubblesScene";
import BeakerBotRunwayStrutScene from "../BeakerBotRunwayStrutScene";
import BeakerBotTwirlScene from "../BeakerBotTwirlScene";
import { TOTAL_DURATION_MS as COFFEE_TOTAL_DURATION_MS } from "../BeakerBotCoffeeRefillScene";
import ProsceniumFrame from "./ProsceniumFrame";
import { ProgressShimmer } from "./SpecialCaseChrome";
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

type SpecialCase = "skateboard" | "coffee-refill";

/** Per-act framing region (scene-framing sub-bot, orchestrator manager).
 *  Each scene is authored as a FULL-viewport composition (100vw x 100svh)
 *  but its action (BeakerBot + the key props) usually lives in one region
 *  of that viewport, not the whole thing. `focus` declares WHERE the action
 *  sits so the stage maps THAT region onto the window instead of the whole
 *  viewport, which keeps the performer large + centered instead of a dot in
 *  a mostly-empty stage.
 *
 *  - cx / cy: the action-center as fractions of the viewport (0..1). This
 *    point is mapped to the CENTER of the window.
 *  - zoom: how much to magnify BEYOND the no-clip contain-fit. 1 = today's
 *    pure contain-fit (whole viewport mapped onto the window). The final
 *    scale is containFit * zoom.
 *
 *  Omitted => { cx: 0.5, cy: 0.5, zoom: 1 } (today's centered contain-fit),
 *  so any act with no focus renders exactly as before and never smaller. */
interface ActFocus {
  cx: number;
  cy: number;
  zoom: number;
}

interface ActData {
  id: string;
  /** Marquee placard title + scene-picker label. */
  name: string;
  Component: SceneComponent;
  special?: SpecialCase;
  /** Optional per-scene framing (see ActFocus). */
  focus?: ActFocus;
}

const DEFAULT_FOCUS: ActFocus = { cx: 0.5, cy: 0.5, zoom: 1 };

/** The show bill. Order paces energy: a greeting, the physical gags, the
 *  long lab-life beats, the interactive closer, then the new drag-stage
 *  scenes as the encore. */
const ACTS: readonly ActData[] = [
  {
    id: "ladder",
    name: "The Ladder",
    Component: BeakerBotLadderScene as unknown as SceneComponent,
    // BeakerBot climbs a 50vh-tall ladder whose base sits on the 12vh
    // ground line, so the action is a TALL vertical column spanning roughly
    // 38vh (ladder top) to 88vh (his feet at the base). The ladder hugs one
    // edge but enterFrom can be either side, so keep cx centered. Center of
    // the column is ~0.63 down. Gentle zoom: the column is already tall, so
    // a little magnification fills the window without cropping the climb.
    focus: { cx: 0.5, cy: 0.62, zoom: 1.5 },
  },
  {
    id: "bug-stomp",
    name: "The Bug Stomp",
    Component: BeakerBotBugStompScene as unknown as SceneComponent,
    // Bot is anchored at left:50% and sneaks ~50vw across the floor toward a
    // bug near 32/68vw, so the action is a WIDE lower band. Keep cx centered
    // and frame the lower-floor band (~0.78). Modest zoom so the long sneak
    // traverse stays on stage.
    focus: { cx: 0.5, cy: 0.78, zoom: 1.55 },
  },
  {
    id: "skateboard",
    name: "Intermission",
    Component: BeakerBotSkateboardScene as unknown as SceneComponent,
    special: "skateboard",
    // SPECIAL: wide 21:9 frame. The bot + board cruise the FULL width
    // (left edge to right edge) with a loop arc, so any zoom > ~1 would crop
    // the traverse. Keep focus near contain-fit (the wide frame already
    // crops the empty top/bottom), only nudging the vertical center to the
    // 85% cruise line and a hair of zoom.
    focus: { cx: 0.5, cy: 0.78, zoom: 1.08 },
  },
  {
    id: "too-many-beakers",
    name: "Too Many Beakers",
    Component: BeakerBotTooManyBeakersScene as unknown as SceneComponent,
    // Grant's example ("90% of the stage is empty"). Bot is anchored
    // bottom-center (left:50%, feet at 12vh) carrying a TALL stack of beakers
    // (a 180px wrapper rising well above his head). The live action (bot +
    // stack) is a compact lower-center column; falling shards arc out to
    // ~60vh but are secondary. Frame the bot+stack column: cy biased up to
    // ~0.66 to keep the stack top in frame, healthy zoom to fill the empty
    // margins Grant called out.
    focus: { cx: 0.5, cy: 0.66, zoom: 2.0 },
  },
  {
    id: "centrifuge",
    name: "The Centrifuge",
    Component: BeakerBotCentrifugeScene as unknown as SceneComponent,
    // Bot (scene-local 80px, smaller than the 128px norm) sits bottom-center
    // holding the centrifuge; sample tubes fly out ±28vw and arc up ~45-55vh.
    // Frame the bot + held centrifuge (lower-center, cy ~0.74); a strong zoom
    // grows the small bot, accepting that the wide tube arcs may pass near
    // the frame edges (they are secondary motion, not the performer).
    focus: { cx: 0.5, cy: 0.74, zoom: 1.75 },
  },
  {
    id: "eureka",
    name: "Eureka",
    Component: BeakerBotEurekaScene as unknown as SceneComponent,
    // Bot sits at the bench center (50vw) at the canonical 128px size with
    // the idea-bulb popping above his head (top:-60px). Grant called this
    // scene's scale the baseline. Frame bot + bulb (cy ~0.72 to keep the
    // bulb in frame); modest zoom since he is already full-size and centered.
    focus: { cx: 0.5, cy: 0.72, zoom: 1.4 },
  },
  {
    id: "coffee-refill",
    name: "The Wait Is The Look",
    Component: BeakerBotCoffeeRefillScene as unknown as SceneComponent,
    special: "coffee-refill",
    // Bot walks to the bench center (50vw) beside the coffee machine + pot;
    // the action is a lower-center cluster (bot + machine). cy biased down to
    // ~0.74. The ProgressShimmer chrome renders at FRAME scale (outside this
    // viewport transform), so it is unaffected. Moderate zoom.
    focus: { cx: 0.5, cy: 0.74, zoom: 1.5 },
  },
  {
    id: "blowing-bubbles",
    name: "Blowing Bubbles",
    Component: BeakerBotBlowingBubblesScene as unknown as SceneComponent,
    // Bot settles LEFT (body center at 12vw = cx 0.12) and blows bubbles that
    // drift up and to the right. Frame between the bot and the near bubble
    // field: cx ~0.30 keeps both the off-left bot and his bubbles in view.
    // cy ~0.72 (bot + bubbles rising above). Moderate zoom.
    focus: { cx: 0.3, cy: 0.72, zoom: 1.5 },
  },
  {
    id: "runway-strut",
    name: "The Runway Strut",
    Component: BeakerBotRunwayStrutScene as unknown as SceneComponent,
    // Bot struts in from stage-left and HITS HIS MARK at ~46vw / top 70%
    // (final center ~cx 0.5, cy 0.70), scaling 0.7 -> 1 along the walk. Frame
    // the mark; keep zoom modest so the entry walk from the left edge stays
    // mostly on stage rather than starting off-frame.
    focus: { cx: 0.5, cy: 0.7, zoom: 1.45 },
  },
  {
    id: "twirl",
    name: "The Twirl",
    Component: BeakerBotTwirlScene as unknown as SceneComponent,
    // Bot is planted DEAD CENTER (top:50%, left:50%) at full 128px doing a
    // spin, with a decorative rainbow trail radiating around him. Already
    // centered, so keep cx/cy at 0.5; a moderate zoom grows him while the
    // trail (decorative) is free to reach toward the edges.
    focus: { cx: 0.5, cy: 0.5, zoom: 1.4 },
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

  // Scenes are one-shot timelines: they play once (e.g. The Ladder runs ~8.3s)
  // then call onComplete and rest on their final frame, which for several
  // scenes is EMPTY. In the showcase the stage should always be performing, so
  // we LOOP: on completion, replay the scene after a short beat (a fresh
  // key remount restarts the timeline from frame zero). This is why the old
  // default (The Greeting, which looped on its own) never went blank.
  const [replayKey, setReplayKey] = useState(0);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const act = ACTS.find((a) => a.id === activeId) ?? ACTS[0]!;
  const Component = act.Component;
  const focus = act.focus ?? DEFAULT_FOCUS;

  // PER-SCENE FRAMING (scene-framing sub-bot, orchestrator manager).
  //
  // Background: each scene is authored as a full-viewport composition
  // (100vw x 100svh) but its action usually fills only one region of that
  // viewport, so mapping the WHOLE viewport into the window left BeakerBot
  // tiny with most of the stage empty (Grant: "90% of the stage is empty").
  //
  // The new model maps the act's declared action region onto the window:
  //
  //  1. containFit = min(window.w / vw, window.h / vh) — the no-clip base
  //     that fits the whole viewport into the window. This is the FLOOR: a
  //     scene with focus.zoom 1 renders exactly as before, never smaller.
  //  2. scale S = containFit * focus.zoom. zoom magnifies BEYOND contain-fit
  //     so the performer fills the stage.
  //  3. translate so the action point (focus.cx * vw, focus.cy * vh) lands
  //     at the WINDOW CENTER. The viewport is flex-centered in the clip and
  //     scaled about its own center (transform-origin 50% 50%), so the action
  //     point's offset from the viewport center, ((cx - 0.5) * vw, (cy - 0.5)
  //     * vh), becomes S times that after scaling. We translate by the
  //     negative of that scaled offset to bring the action point back to the
  //     window center: Tx = -S * (cx - 0.5) * vw, Ty = -S * (cy - 0.5) * vh.
  //     (transform: translate(Tx, Ty) scale(S) — translate distances are
  //     literal post-scale px, so this composes correctly with origin 50%.)
  //
  // NO-CLIP GUARANTEE: at zoom 1 + cx/cy 0.5 (the default) the whole viewport
  // maps onto the window 1:1, so the bot is bounded by the stage edges and
  // can never leave the frame (the prior contract). For zoom > 1 the action
  // box (centered on cx/cy, sized so the performer + immediate props fit with
  // margin) maps onto the window; the per-act zooms were tuned conservatively
  // (gentler beats clipped) so the resting performer stays fully inside the
  // window and his motion range stays in frame. Re-measures on resize +
  // activeId (kept the ResizeObserver + rAF retry for first-paint sizing).
  useLayoutEffect(() => {
    if (!sceneViewport || typeof window === "undefined") return;
    const clip = sceneViewport.parentElement;
    if (!clip) return;

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
      const scale = containFit * focus.zoom;
      // Map the action point (cx, cy) to the window center: translate by the
      // negative of the scaled offset from the viewport's own center.
      const tx = -scale * (focus.cx - 0.5) * vw;
      const ty = -scale * (focus.cy - 0.5) * vh;
      sceneViewport.style.setProperty("--scene-scale", String(scale));
      sceneViewport.style.setProperty("--scene-tx", `${tx}px`);
      sceneViewport.style.setProperty("--scene-ty", `${ty}px`);
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
    // activeId/focus are included so the scale + translate re-measure when a
    // new act (with its own focus) swaps in, including the skateboard wide
    // frame's 21:9 aspect.
  }, [sceneViewport, activeId, focus.cx, focus.cy, focus.zoom]);

  // Cancel any pending replay when the act changes (so a finishing scene does
  // not loop on top of the newly picked one) and on unmount.
  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    };
  }, [activeId]);

  // Loop the selected scene: when its one-shot timeline finishes, replay it
  // after a short beat so the stage is never empty. Honor reduced motion: rest
  // on the scene's static glam-freeze frame instead of looping motion.
  const handleSceneComplete = () => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
    replayTimerRef.current = setTimeout(() => {
      setReplayKey((k) => k + 1);
    }, 700);
  };

  // The active scene plays inside the window, keyed by act id + replay count so
  // switching acts (or a completed scene looping) remounts it and replays the
  // timeline from frame zero. Special-case chrome (ProgressShimmer) renders at
  // frame scale via ProsceniumFrame children.
  const sceneChrome: ReactNode = (
    <>
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
          key={`${act.id}-${replayKey}`}
          active
          onComplete={handleSceneComplete}
          portalTarget={sceneViewport}
        />
      </div>

      {/* The professional scene-picker. */}
      <ScenePicker activeId={activeId} onSelect={setActiveId} />
    </section>
  );
}
