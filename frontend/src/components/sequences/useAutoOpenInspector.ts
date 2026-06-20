"use client";

// sequence editor master. The AUTO-OPEN rule for the contextual inspector
// (sequences redesign phase 3). When the user makes a NEW selection we pop the
// most relevant rail op open (primer -> Primers), even if the inspector was
// collapsed. A gene of interest (CDS) deliberately does NOT auto-open the
// protein analysis any more (autoOpenOpForKind returns null for it); the rail's
// protein op shimmers to invite the click instead. The rule is RESPECTFUL:
//
//   - It keys on a derived selection IDENTITY (kind + the feature index + the
//     region span), so it only fires when the identity genuinely CHANGES. A
//     same-kind re-render (a parent re-render, an unrelated state change) does
//     NOT re-fire, so it never yanks the user off a panel they are configuring
//     for the SAME selection.
//   - Clearing the selection (identity "none") never closes or moves the
//     inspector; the user keeps whatever they had open.
//   - Organism is whole-sequence scope, not a fresh selection, so it is never an
//     auto-open trigger (autoOpenOpForKind returns null for "none").
//
// Extracted as a hook so the no-thrash behavior is unit-tested directly.

import { useEffect, useRef } from "react";
import { autoOpenOpForKind, type SelectionKind } from "@/lib/sequences/inspector-context";

/** React to a NEW selection by opening its contextual rail op. `setActiveOp` is
 *  the inspector's open-op setter (null = collapsed). `identity` is the stable
 *  key the caller derives from the live selection; pass "none" to mean nothing
 *  is selected. */
export function useAutoOpenInspector(
  identity: string,
  kind: SelectionKind,
  setActiveOp: (id: string) => void,
): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (identity === "none") {
      // Remember that we are cleared, but never close / move the inspector.
      last.current = "none";
      return;
    }
    if (last.current === identity) return;
    last.current = identity;
    const target = autoOpenOpForKind(kind);
    if (target) setActiveOp(target);
  }, [identity, kind, setActiveOp]);
}
