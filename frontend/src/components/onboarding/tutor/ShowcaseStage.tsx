"use client";

// Onboarding tutor — the showcase stage (one DEEP demo).
//
// Runs a single surface choreography via the pure showcase player on a timer,
// and renders Beaker's presenter cursor, the coach bubble, and the reveal. In
// THIS phase of the build the stage is a self-contained placeholder (a labeled
// frame standing in for the real page), so the mechanic is walkable and the
// timing is real. The final phase swaps the placeholder for the live surface and
// resolves the cursor target to the real element via guide_to_element, but the
// player + cursor + bubble built here are exactly what drives it.
//
// Pause and skip-this-demo keep the user in control (no soft-lock). onDone fires
// when the demo finishes or is skipped. No emojis, no em-dashes, no mid-sentence
// colons.

import { useEffect, useReducer, useRef } from "react";
import {
  initPlayer,
  playerReducer,
  cursorTarget,
  isClicking,
  isRevealed,
  narration,
  currentStep,
} from "@/lib/onboarding/showcase-player";
import { choreographyFor } from "@/lib/onboarding/showcase-choreography";
import type { Surface } from "@/lib/onboarding/reel-director";
import PresenterCursor from "./PresenterCursor";
import CoachBubble from "./CoachBubble";
import TutorScreen from "./TutorScreen";

export interface ShowcaseStageProps {
  surface: Surface;
  onDone: () => void;
}

// Anchor for the cursor + target marker on the preloaded-page stage: the primary
// control in the page header (the "add" button the cursor heads to). Coordinates
// are within the relative stage frame below.
const TARGET_POS = { x: 486, y: 46 };

// A short, friendly page title per surface so the stage reads as a real ResearchOS
// page (the no-warp redesign: a preloaded page popup, not the live app). Falls back
// to a title-cased surface name. The deeper per-surface page content is a follow-up.
const SURFACE_LABEL: Record<string, string> = {
  workbench: "Workbench",
  sequences: "Sequence editor",
  datahub: "Data Hub",
  phylo: "Phylo Studio",
  methods: "Methods",
  chemistry: "Chemistry",
  inventory: "Inventory",
  people: "People",
};
function surfaceLabel(surface: string): string {
  return SURFACE_LABEL[surface] ?? surface.charAt(0).toUpperCase() + surface.slice(1);
}

/** Humanize a raw [data-tutor-target] id (e.g. "phylo-export-tab",
 *  "datahub-analyze-button") into a short readable control label for the stand-in
 *  marker, so the internal id never shows in the preview. Drops a leading surface
 *  prefix and trailing control-kind word, then title-cases what remains. */
function humanizeTarget(id: string): string {
  const words = id
    .split("-")
    .filter((w) => w && !["button", "tab", "btn", "link", "menu", "item"].includes(w));
  const SURFACES = new Set([
    "datahub",
    "phylo",
    "methods",
    "sequences",
    "chemistry",
    "inventory",
    "people",
  ]);
  const trimmed = words.length > 1 && SURFACES.has(words[0]) ? words.slice(1) : words;
  const label = (trimmed.length ? trimmed : words).join(" ").trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Open";
}

export default function ShowcaseStage({ surface, onDone }: ShowcaseStageProps) {
  const choreography = choreographyFor(surface);
  const [state, dispatch] = useReducer(playerReducer, choreography, initPlayer);
  const doneRef = useRef(false);

  // Drive the player with requestAnimationFrame on real elapsed time. rAF pauses
  // automatically in a background tab, so the demo pauses when the user looks
  // away and resumes cleanly when they return. The delta is clamped so the first
  // frame after a resume cannot jump a whole step.
  useEffect(() => {
    if (state.status !== "playing") return;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (last !== 0 && !document.hidden) {
        const delta = Math.min(now - last, 120);
        if (delta > 0) dispatch({ type: "tick", deltaMs: delta });
      }
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state.status]);

  // Fire onDone exactly once when the demo completes.
  useEffect(() => {
    if (state.status === "done" && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [state.status, onDone]);

  const target = cursorTarget(state);
  const cursorVisible = target !== null;
  const revealed = isRevealed(state);
  const step = currentStep(state);

  return (
    <TutorScreen contentClassName="flex-col">
      <div className="mb-2 flex w-full max-w-xl items-center justify-between text-[10.5px] uppercase tracking-wide text-[var(--faint,#9aa097)]">
        <span>on {choreography.route}</span>
        <span className="rounded border border-[var(--amber,#b9770f)] bg-[var(--amber-soft,#fbf0dc)] px-1.5 py-0.5 font-bold text-[var(--amber-ink,#8a5908)]">
          SAMPLE DATA · nothing saved
        </span>
      </div>

      {/* The preloaded-page stage: a realistic ResearchOS page that pops up in
          place (no warp into the live app). relative so the cursor + bubble + the
          target marker position within it. */}
      <div className="relative h-[330px] w-[560px] max-w-full overflow-hidden rounded-2xl border border-[var(--line,#e3e5e0)] bg-[var(--surface,#fff)] shadow-sm">
        {/* page header: the surface title + the primary control the cursor heads to */}
        <div className="flex items-center justify-between border-b border-[var(--line,#e3e5e0)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand,#1d9e75)]" />
            <span className="text-sm font-semibold text-[var(--fg,#1f2421)]">
              {surfaceLabel(surface)}
            </span>
          </div>
          <span className="rounded-lg border border-[var(--line2,#d2d5cd)] bg-[var(--sunken,#f1f2ef)] px-2.5 py-1 text-xs font-semibold text-[var(--muted,#6b716a)]">
            + New
          </span>
        </div>

        {/* page content: a few sample rows, with the reveal row appearing on click */}
        <div className="flex flex-col gap-2 p-4">
          {[
            { dot: "var(--brand,#1d9e75)", title: "Sample item one", sub: "in progress", meta: "64%" },
            { dot: "var(--info,#2563eb)", title: "Sample item two", sub: "ready to review", meta: "100%" },
            { dot: "var(--amber,#b9770f)", title: "Sample item three", sub: "queued", meta: "20%" },
          ].map((row) => (
            <div
              key={row.title}
              className="flex items-center gap-3 rounded-lg border border-[var(--line,#e3e5e0)] px-3 py-2.5"
            >
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: row.dot }} />
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-[var(--fg,#1f2421)]">{row.title}</div>
                <div className="text-[11.5px] text-[var(--muted,#6b716a)]">{row.sub}</div>
              </div>
              <span className="text-xs text-[var(--muted,#6b716a)]">{row.meta}</span>
            </div>
          ))}
          {/* the reveal: the new object the demo adds, fading + lifting into place */}
          <div
            className="flex items-center gap-3 rounded-lg border-2 border-[var(--brand,#1d9e75)] bg-[var(--brand-soft,#e7f6ef)] px-3 py-2.5 transition-all duration-700"
            style={{
              opacity: revealed ? 1 : 0,
              transform: revealed ? "translateY(0)" : "translateY(8px)",
            }}
          >
            <span className="h-2.5 w-2.5 flex-none rounded-full bg-[var(--brand,#1d9e75)]" />
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-[var(--fg,#1f2421)]">
                {choreography.seedKind.replace(/_/g, " ")}
              </div>
              <div className="text-[11.5px] text-[var(--muted,#6b716a)]">just added</div>
            </div>
          </div>
        </div>

        {/* target marker for the control the cursor heads to */}
        {cursorVisible ? (
          <div
            className="absolute rounded-md border-2 border-[var(--info,#2563eb)] px-2 py-1 text-[9px] font-semibold text-[var(--info-ink,#1b4fa8)]"
            style={{ left: TARGET_POS.x - 8, top: TARGET_POS.y - 26 }}
          >
            {humanizeTarget(target)}
          </div>
        ) : null}

        <PresenterCursor
          x={cursorVisible ? TARGET_POS.x : null}
          y={cursorVisible ? TARGET_POS.y : null}
          clicking={isClicking(state)}
        />
        <CoachBubble line={narration(state)} />
      </div>

      {/* per-demo controls (the tour-level Back/Next/Skip live in the container) */}
      <div className="mt-3 flex w-full max-w-xl items-center justify-between">
        <span className="text-[10px] text-[var(--faint,#9aa097)]">{step?.kind}</span>
        <div className="flex gap-2">
          <button
            onClick={() =>
              dispatch({
                type: state.status === "paused" ? "resume" : "pause",
              })
            }
            className="rounded-md border border-[var(--line2,#d2d5cd)] px-3 py-1 text-xs text-[var(--muted,#6b716a)] hover:bg-[var(--sunken,#f1f2ef)]"
          >
            {state.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => dispatch({ type: "skip" })}
            className="rounded-md bg-[var(--brand,#1d9e75)] px-3 py-1 text-xs font-bold text-white hover:brightness-105"
          >
            Skip demo
          </button>
        </div>
      </div>
    </TutorScreen>
  );
}
