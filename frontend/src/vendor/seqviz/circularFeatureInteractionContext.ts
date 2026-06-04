// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
//
// ResearchOS addition (circular qol bot): a tiny React context that carries the
// CIRCULAR plasmid map's selection quality-of-life callbacks down to the deep
// Circular Annotations render tree WITHOUT threading new props through every
// layer, exactly like annotationDoubleClickContext does for the dblclick. It
// mirrors the LINEAR map's selection model (LinearMap.tsx) on the ring:
//   - onFeatureClick(range, { shiftKey }) -> SINGLE-click a feature arc SELECTS
//     its range; a SHIFT-click extends the span from the anchor through it (the
//     host computes the union via spanFromShiftClick, identical to the
//     linear/overview handlers). The Map never changes the view mode.
//   - onFeatureHover(range | null, clientX, clientY) -> HOVER a feature arc shows
//     the floating info CARD at the cursor and the red PREVIEW arc over the range
//     a click would select; null on mouse-leave clears both.
// The single-click selection + native drag-select / rotation are otherwise
// untouched; this only adds the shift-span + hover affordances.
import * as React from "react";

/** Minimal identity for a clicked / hovered annotation, matched to a host feature. */
export interface CircularFeatureRange {
  name: string;
  start: number;
  end: number;
  direction?: number;
  /** /product or /note qualifier text for the hover info card, when present. */
  note?: string;
  type?: string;
}

export interface CircularFeatureInteraction {
  /** SINGLE-click a feature arc. `mods.shiftKey` carries the span modifier up. */
  onFeatureClick?: (range: CircularFeatureRange, mods: { shiftKey: boolean }) => void;
  /** HOVER a feature arc (range + cursor) or mouse-leave (range === null). */
  onFeatureHover?: (range: CircularFeatureRange | null, clientX: number, clientY: number) => void;
  /**
   * HOVER a primer marker (radial stem + arrowhead) on the ring, or mouse-leave
   * (range === null). The host shows the SAME primer info card the linear Map
   * shows on hover (coords / length / %GC / Tm via buildPrimerCard), so the two
   * maps read identically. Separate from onFeatureHover because primers use the
   * primer card (GC/Tm), not the feature card (aa/kDa/product).
   */
  onPrimerHover?: (
    range: { name: string; start: number; end: number } | null,
    clientX: number,
    clientY: number,
  ) => void;
}

const CircularFeatureInteractionContext = React.createContext<CircularFeatureInteraction | null>(null);
CircularFeatureInteractionContext.displayName = "CircularFeatureInteractionContext";

export default CircularFeatureInteractionContext;
