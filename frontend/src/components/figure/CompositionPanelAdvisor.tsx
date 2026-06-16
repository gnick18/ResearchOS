"use client";

// Collision-aware layout advisor — the Figure Composer front door (Phase 5 part
// 2b-3). The SAME engine as the phylo + Data Hub editor advisors, pointed at ONE
// composed panel and rendered in the panel inspector. Surface-agnostic: it asks
// the panel's FigureSource for its layout manifest (getLayoutManifest) + the
// panel-style override each fix maps to (styleForFix), so a new source lights up
// with no change here.
//
// Detection runs at the panel's REAL composed size, where a legend over the data
// (or crowded labels) bites hardest. Fixes apply as composition-local panel-style
// overrides (never mutating the source object). Quiet, dismissable, silenced per
// panel. The inspector's own Style controls are the persistent revert, so the
// banner self-hiding once the collision clears is not a trap. No soft-lock.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useMemo, useState } from "react";

import {
  type FigureSource,
  type PanelStyle,
  type RenderOpts,
} from "@/lib/figure/figure-source";
import {
  detectCollisions,
  suggestFixes,
  type Collision,
  type FixId,
} from "@/lib/figure/layout-collision";

const SCREEN_DPI = 96;

function mergePanelStyle(a: PanelStyle, b: PanelStyle): PanelStyle {
  return {
    targets: { ...(a.targets ?? {}), ...(b.targets ?? {}) },
    options: { ...(a.options ?? {}), ...(b.options ?? {}) },
  };
}

const silKey = (panelId: string) => `ros:figure:advisor-silenced:${panelId}`;

export interface CompositionPanelAdvisorProps {
  panelId: string;
  source: FigureSource;
  refId: string;
  /** The panel's composed size, so detection runs at the size the reader sees. */
  widthIn: number;
  heightIn: number;
  /** The panel's current composition-local style (override state). */
  style: PanelStyle | undefined;
  /** Apply a panel-style override (the composer merges it via setPanelStyle). */
  onApply: (patch: PanelStyle) => void;
}

export function CompositionPanelAdvisor({
  panelId,
  source,
  refId,
  widthIn,
  heightIn,
  style,
  onApply,
}: CompositionPanelAdvisorProps) {
  const [collisions, setCollisions] = useState<Collision[]>([]);
  const [fixIds, setFixIds] = useState<{ id: FixId; title: string; rationale: string }[]>([]);
  const [silenced, setSilenced] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(silKey(panelId)) === "1";
    } catch {
      return false;
    }
  });
  const [snapshot, setSnapshot] = useState<PanelStyle | null>(null);

  const styleSig = useMemo(() => JSON.stringify(style ?? {}), [style]);

  // Detect at the panel's real size. Async (the manifest comes from the source),
  // so guard against a stale result winning a race when the panel changes.
  useEffect(() => {
    if (!source.getLayoutManifest || !source.styleForFix) {
      setCollisions([]);
      setFixIds([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const opts: RenderOpts = {
        widthIn,
        heightIn,
        dpi: SCREEN_DPI,
        theme: "light",
        overrides: { hideTitle: true },
        style,
      };
      try {
        const manifest = await source.getLayoutManifest!(refId, opts);
        if (cancelled || !manifest) {
          if (!cancelled) {
            setCollisions([]);
            setFixIds([]);
          }
          return;
        }
        const cs = detectCollisions(manifest);
        // Only the fixes this source can actually apply as a panel override.
        const fs = suggestFixes(cs)
          .filter((f) => f.available && source.styleForFix!(f.id) != null)
          .map((f) => ({ id: f.id, title: f.title, rationale: f.rationale }));
        setCollisions(cs);
        setFixIds(fs);
      } catch {
        if (!cancelled) {
          setCollisions([]);
          setFixIds([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, refId, widthIn, heightIn, styleSig, style]);

  if (silenced || collisions.length === 0 || fixIds.length === 0) return null;

  const silence = () => {
    setSilenced(true);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(silKey(panelId), "1");
      } catch {
        // best-effort; the runtime dismissal still hides it this session.
      }
    }
  };

  const wand = () => {
    if (snapshot) {
      onApply(snapshot);
      setSnapshot(null);
      return;
    }
    const merged = fixIds
      .map((f) => source.styleForFix!(f.id))
      .filter((p): p is PanelStyle => p != null)
      .reduce(mergePanelStyle, {} as PanelStyle);
    // Snapshot the prior value of every option the wand touches, so undo restores
    // exactly those (an absent prior reverts the override to the source default).
    const touched = Object.keys(merged.options ?? {});
    setSnapshot({
      options: Object.fromEntries(touched.map((k) => [k, style?.options?.[k]])),
    });
    onApply(merged);
  };

  const summary = collisions
    .map((c) => c.message)
    .slice(0, 2)
    .join(" ");

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold">
            {collisions.length} layout issue
            {collisions.length === 1 ? "" : "s"} at this size
          </div>
          <div className="mt-0.5 text-[10.5px] leading-snug text-amber-800">
            {summary}
          </div>
        </div>
        <button
          type="button"
          onClick={silence}
          title="Don't show again on this panel"
          className="shrink-0 rounded px-1 text-amber-500 hover:text-amber-700"
          aria-label="Dismiss for this panel"
        >
          &times;
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={wand}
          className="rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white transition-colors hover:bg-amber-600"
        >
          {snapshot ? "Undo auto-fix" : "Auto-fix"}
        </button>
        {fixIds.map((f) => (
          <button
            key={f.id}
            type="button"
            title={f.rationale}
            onClick={() => {
              const patch = source.styleForFix!(f.id);
              if (patch) onApply(patch);
            }}
            className="rounded-md border border-amber-300 px-2 py-0.5 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100"
          >
            {f.title}
          </button>
        ))}
      </div>
    </div>
  );
}
