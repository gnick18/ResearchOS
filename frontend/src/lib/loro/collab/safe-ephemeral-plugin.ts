/**
 * safe-ephemeral-plugin.ts
 *
 * Wraps loro-codemirror's LoroEphemeralPlugin with a safe selection layer that
 * clamps out-of-range remote cursor positions before CM6 tries to look them up
 * in the rope tile map. Without this guard, a remote peer's selection that
 * references a position past the current doc end (because the peer typed
 * somewhere that we then deleted, or because of an undo) throws:
 *   RangeError: No tile at position N
 * inside CM6's internal coordsAt / rectanglesForRange path.
 *
 * The fix: replace the selection layer (index [2] of LoroEphemeralPlugin's
 * extension array) with our own safe version that clamps anchor + head to
 * [0, view.state.doc.length] before creating RectangleMarker decorations.
 *
 * The cursor layer (index [1]) already clamps via RemoteCursorMarker's own
 * calculateAbsoluteCursorPosition, so it is kept as-is.
 *
 * No undo plugin. No marks. No text-sync changes. Zero regression for
 * single-user editing (the plugin is only installed while a collab session
 * is live and the LORO_PILOT_ENABLED flag is set).
 *
 * No emojis, no em-dashes, no mid-sentence colons.
 */

import {
  LoroEphemeralPlugin,
  type UserState,
  type EphemeralState,
} from "loro-codemirror";
import {
  EditorView,
  layer,
  RectangleMarker,
  type ViewUpdate,
} from "@codemirror/view";
import {
  EditorSelection,
  type Extension,
  type StateField,
} from "@codemirror/state";
import {
  type EphemeralStore,
  type LoroDoc,
  type LoroText,
} from "loro-crdt";

// ---------------------------------------------------------------------------
// Internal type for the ephemeral state field value.
// Matches the shape declared in loro-codemirror's ephemeral.ts.
// ---------------------------------------------------------------------------
type EphemeralFieldValue = {
  remoteCursors: Map<string, { anchor: number; head?: number }>;
  remoteUsers: Map<string, UserState | undefined>;
  isCheckout: boolean;
};

// ---------------------------------------------------------------------------
// Safe selection layer.
//
// Reads the remote cursor state from `field` (the ephemeralStateField exposed
// as the first element of LoroEphemeralPlugin's extension array) and clamps
// anchor + head to [0, doc.length] before creating RectangleMarker decorations.
// Out-of-range cursors degrade to an empty range (hidden) rather than throwing.
// ---------------------------------------------------------------------------
function createSafeSelectionLayer(
  field: StateField<EphemeralFieldValue>,
): Extension {
  const isRemoteCursorUpdate = (update: ViewUpdate): boolean => {
    return update.docChanged || update.viewportChanged;
  };

  return layer({
    above: false,
    class: "loro-selection-layer",
    update: isRemoteCursorUpdate,
    markers: (view: EditorView) => {
      const { remoteCursors, remoteUsers, isCheckout } =
        view.state.field(field);
      if (isCheckout) return [];

      const docLen = view.state.doc.length;
      const result: ReturnType<typeof RectangleMarker.forRange>[number][] = [];

      for (const [peer, state] of remoteCursors) {
        if (state.head === undefined || state.anchor === state.head) continue;

        // Clamp both ends to [0, doc.length] so CM6 never sees a
        // position past the rope end. An undo or concurrent remote
        // delete can leave a stored cursor at a now-invalid offset.
        const anchor = Math.max(0, Math.min(docLen, state.anchor));
        const head = Math.max(0, Math.min(docLen, state.head));

        // If clamping collapsed the range to a single point, skip
        // the selection marker (nothing visible to render).
        if (anchor === head) continue;

        const user = remoteUsers.get(peer);
        const selectionRange = EditorSelection.range(anchor, head);
        const markers = RectangleMarker.forRange(
          view,
          `loro-selection ${user?.colorClassName ?? ""}`,
          selectionRange,
        );
        for (const m of markers) result.push(m);
      }

      return result;
    },
  });
}

// ---------------------------------------------------------------------------
// safeLoroEphemeralPlugin
//
// Drop-in replacement for LoroEphemeralPlugin that substitutes the safe
// selection layer in place of the default one (which does not clamp positions).
//
// Signature mirrors LoroEphemeralPlugin exactly so callers are interchangeable.
// ---------------------------------------------------------------------------
export function safeLoroEphemeralPlugin(
  doc: LoroDoc,
  ephemeral: EphemeralStore<EphemeralState>,
  user: UserState,
  getTextFromDoc?: (doc: LoroDoc) => LoroText,
): Extension[] {
  // Build the base plugin array: [stateField, cursorLayer, selectionLayer, plugin, theme]
  const base = LoroEphemeralPlugin(
    doc,
    ephemeral as EphemeralStore,
    user,
    getTextFromDoc,
  );

  // The first element is ephemeralStateField -- we need it to build our safe
  // selection layer.
  const stateField = base[0] as StateField<EphemeralFieldValue>;

  // Replace index [2] (selectionLayer) with our safe version.
  // Indices [0] (stateField), [1] (cursorLayer), [3] (EphemeralPlugin plugin),
  // [4] (loroCursorTheme) are kept unchanged.
  return [
    base[0], // ephemeralStateField
    base[1], // cursorLayer (already clamps via RemoteCursorMarker)
    createSafeSelectionLayer(stateField), // safe selection layer
    ...base.slice(3), // EphemeralPlugin ViewPlugin + loroCursorTheme
    // The per-peer COLOR rules. loro-codemirror's own theme only draws the base
    // .loro-cursor shape; the .loro-peer-* color classes have no CSS without
    // this. Bundled into the plugin's return (not left to the caller) so the
    // caret + name label are always colored when cursors are active.
    EditorView.baseTheme(COLLAB_CURSOR_THEME),
  ];
}

// ---------------------------------------------------------------------------
// Peer color palette
//
// Deterministic color class from a peer id string. The palette matches the
// loro-cursor theme classes that loroCursorTheme injects (.loro-cursor-layer
// elements inherit color from the `colorClassName`). We provide a small set of
// visually distinct color classes mapped from a simple hash of the peer id so
// each collaborator gets a stable, distinct color.
//
// NOTE: loro-codemirror's loroCursorTheme does NOT inject per-color styles
// automatically. It only injects the base .loro-cursor shape. We provide our
// own color classes via a separate EditorView.baseTheme (see the component
// where LoroEphemeralPlugin is mounted) so these class names produce visible
// cursors.
// ---------------------------------------------------------------------------

// Six visually distinct color slots. Adding more is additive.
const COLLAB_COLORS: string[] = [
  "loro-peer-teal",
  "loro-peer-amber",
  "loro-peer-violet",
  "loro-peer-rose",
  "loro-peer-cyan",
  "loro-peer-lime",
];

/**
 * Deterministic color class name for a given peer id string.
 *
 * Uses a simple djb2-style hash so the same peer always gets the same color
 * in the same session, and different peers (with different random peer ids)
 * get different colors.
 */
export function peerColorClass(peerId: string): string {
  let hash = 5381;
  for (let i = 0; i < peerId.length; i++) {
    hash = ((hash << 5) + hash + peerId.charCodeAt(i)) >>> 0;
  }
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

/**
 * A CM6 baseTheme snippet that gives color to the .loro-peer-* classes.
 * Mount this alongside safeLoroEphemeralPlugin so cursors are visible.
 */
export const COLLAB_CURSOR_THEME = {
  ".loro-peer-teal.loro-cursor":    { borderLeft: "2px solid #0d9488", backgroundColor: "#0d9488" },
  ".loro-peer-teal::before":        { backgroundColor: "#0d9488", color: "#fff" },
  ".loro-peer-teal.loro-selection": { backgroundColor: "#0d9488" },

  ".loro-peer-amber.loro-cursor":    { borderLeft: "2px solid #d97706", backgroundColor: "#d97706" },
  ".loro-peer-amber::before":        { backgroundColor: "#d97706", color: "#fff" },
  ".loro-peer-amber.loro-selection": { backgroundColor: "#d97706" },

  ".loro-peer-violet.loro-cursor":    { borderLeft: "2px solid #7c3aed", backgroundColor: "#7c3aed" },
  ".loro-peer-violet::before":        { backgroundColor: "#7c3aed", color: "#fff" },
  ".loro-peer-violet.loro-selection": { backgroundColor: "#7c3aed" },

  ".loro-peer-rose.loro-cursor":    { borderLeft: "2px solid #e11d48", backgroundColor: "#e11d48" },
  ".loro-peer-rose::before":        { backgroundColor: "#e11d48", color: "#fff" },
  ".loro-peer-rose.loro-selection": { backgroundColor: "#e11d48" },

  ".loro-peer-cyan.loro-cursor":    { borderLeft: "2px solid #0891b2", backgroundColor: "#0891b2" },
  ".loro-peer-cyan::before":        { backgroundColor: "#0891b2", color: "#fff" },
  ".loro-peer-cyan.loro-selection": { backgroundColor: "#0891b2" },

  ".loro-peer-lime.loro-cursor":    { borderLeft: "2px solid #65a30d", backgroundColor: "#65a30d" },
  ".loro-peer-lime::before":        { backgroundColor: "#65a30d", color: "#fff" },
  ".loro-peer-lime.loro-selection": { backgroundColor: "#65a30d" },
};
