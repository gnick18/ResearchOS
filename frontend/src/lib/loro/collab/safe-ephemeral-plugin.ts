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

// Number of distinct hue buckets a peer can map to. With N buckets, two
// independent peers collide on the same color only about 1/N of the time, so a
// larger N keeps collaborators visually distinct. 24 hues (every 15 degrees)
// are all easily distinguishable and make a 2-person collision rare (~4%).
// loro-codemirror applies colorClassName as a plain CSS class (no inline
// style), so we cannot inject an arbitrary per-peer hue; instead we pre-generate
// one bucket class per hue in COLLAB_CURSOR_THEME below.
const COLLAB_HUE_BUCKETS = 24;

/**
 * Deterministic color class name for a given peer id string.
 *
 * A djb2-style hash maps the peer id into one of COLLAB_HUE_BUCKETS hue
 * buckets, so the same peer always gets the same color in a session and
 * different peers almost always differ. Returns e.g. "loro-peer-h7".
 */
export function peerColorClass(peerId: string): string {
  let hash = 5381;
  for (let i = 0; i < peerId.length; i++) {
    hash = ((hash << 5) + hash + peerId.charCodeAt(i)) >>> 0;
  }
  return `loro-peer-h${hash % COLLAB_HUE_BUCKETS}`;
}

/**
 * A CM6 baseTheme that colors each hue bucket's caret, name label, and
 * selection. Generated from COLLAB_HUE_BUCKETS rather than hand-listed so the
 * bucket count is a one-line tune. Bundled into safeLoroEphemeralPlugin's
 * return so it always loads with cursors. The selection wash is translucent so
 * the text underneath stays readable.
 */
export const COLLAB_CURSOR_THEME: Record<string, Record<string, string>> = (() => {
  const theme: Record<string, Record<string, string>> = {};
  for (let b = 0; b < COLLAB_HUE_BUCKETS; b++) {
    const hue = Math.round((b * 360) / COLLAB_HUE_BUCKETS);
    const solid = `hsl(${hue}, 65%, 45%)`;
    const wash = `hsla(${hue}, 65%, 45%, 0.3)`;
    theme[`.loro-peer-h${b}.loro-cursor`] = {
      borderLeft: `2px solid ${solid}`,
      backgroundColor: solid,
    };
    theme[`.loro-peer-h${b}::before`] = { backgroundColor: solid, color: "#fff" };
    theme[`.loro-peer-h${b}.loro-selection`] = { backgroundColor: wash };
  }
  return theme;
})();
