// BeakerSearch v3, the floating-dock geometry + persistence brain.
//
// v3 turns the Cmd-K palette from a full-screen modal into a small floating
// capsule the user drags anywhere, collapses to a pill, or tucks off a side
// into a peek tab. All of that is pure x / y / side / flag math, so it lives
// here as a tested module and the React shell stays thin. Nothing in this file
// reads the clock, the DOM, or randomness; callers pass the viewport size and
// the dock footprint in, and the functions return the next state. That keeps
// the whole state machine deterministic for the Vitest contract.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

/** Which vertical edge the dock tucks against. v3 is left / right only (a
 *  vertical peek tab); top and bottom are intentionally unsupported. */
export type DockSide = "left" | "right";

/** The full persisted + live geometry of the one dock. `x` / `y` are the
 *  fixed-position top-left in viewport pixels. `collapsed` shrinks it to the
 *  header pill. `tucked` slides it fully off `side`, leaving the peek tab. */
export interface DockState {
  open: boolean;
  collapsed: boolean;
  tucked: boolean;
  side: DockSide;
  /** Null until first placed, then resolved to a concrete pixel position. */
  x: number | null;
  y: number | null;
}

/** The subset persisted to localStorage. `open` is deliberately NOT persisted,
 *  so a reload never pops the dock unbidden; Cmd-K (or the pill) reopens it to
 *  wherever it was left. */
export interface PersistedDockState {
  collapsed: boolean;
  tucked: boolean;
  side: DockSide;
  x: number | null;
  y: number | null;
}

/** The viewport box the dock is clamped within (the window, in v3). */
export interface Viewport {
  width: number;
  height: number;
}

/** The fixed dock width in pixels. The dock NEVER resizes; collapse and tuck
 *  change visibility, never the footprint. */
export const DOCK_WIDTH = 340;

/** Distance from a side, in pixels, within which releasing a drag tucks the
 *  dock off that side. */
export const SNAP_THRESHOLD = 70;

/** Inset from a side when the dock rests (tucked resting x, default placement). */
const EDGE_INSET = 16;

/** Top inset for the default placement. */
const TOP_INSET = 24;

/** Right inset for the default placement (near the top-right corner). */
const DEFAULT_RIGHT_INSET = 40;

/** Minimum on-screen y so a dragged dock can never be lost above the viewport;
 *  also the minimum visible header strip kept on screen at the bottom. */
const MIN_VISIBLE = 0;

/** The localStorage key for the persisted geometry. */
export const DOCK_STORAGE_KEY = "beakersearch-dock-v3";

/** The starting state before any placement or persisted value is known. */
export function initialDockState(): DockState {
  return { open: false, collapsed: false, tucked: false, side: "right", x: null, y: null };
}

/** The default floating position, near the top-right corner of the viewport,
 *  clamped so a very narrow window still keeps the dock on screen. */
export function defaultFloatPos(vp: Viewport): { x: number; y: number } {
  return {
    x: Math.max(EDGE_INSET, vp.width - DOCK_WIDTH - DEFAULT_RIGHT_INSET),
    y: TOP_INSET,
  };
}

/** The resting top-left x for a tucked dock on `side`. The capsule still lives
 *  at this x; the tuck is a CSS transform that slides the body off-screen and
 *  leaves the peek tab, so x stays a sane on-screen value for when it untucks. */
export function restingX(side: DockSide, vp: Viewport): number {
  return side === "left"
    ? EDGE_INSET
    : Math.max(EDGE_INSET, vp.width - DOCK_WIDTH - EDGE_INSET);
}

/** Clamp a candidate top-left so the dock stays within the viewport. The x is
 *  bounded so the whole width stays visible; the y keeps at least a header
 *  strip on screen. */
export function clampPosition(
  x: number,
  y: number,
  vp: Viewport,
  headerStrip = 44,
): { x: number; y: number } {
  const maxX = Math.max(MIN_VISIBLE, vp.width - DOCK_WIDTH);
  const maxY = Math.max(MIN_VISIBLE, vp.height - headerStrip);
  return {
    x: Math.min(Math.max(MIN_VISIBLE, x), maxX),
    y: Math.min(Math.max(MIN_VISIBLE, y), maxY),
  };
}

/** Decide whether a release at top-left x tucks the dock, and to which side.
 *  Right wins ties (a dock dragged into the corner tucks right, matching the
 *  default side). Returns null when the dock is not near either edge. */
export function tuckDecision(x: number, vp: Viewport): DockSide | null {
  const nearRight = x + DOCK_WIDTH > vp.width - SNAP_THRESHOLD;
  const nearLeft = x < SNAP_THRESHOLD;
  if (nearRight) return "right";
  if (nearLeft) return "left";
  return null;
}

/** The nearest side to the dock's current x, used by the hide button (which
 *  tucks without a drag). Falls back to the current side when x is unplaced. */
export function nearestSide(state: DockState, vp: Viewport): DockSide {
  if (state.x == null) return state.side;
  const center = state.x + DOCK_WIDTH / 2;
  return center > vp.width / 2 ? "right" : "left";
}

/** Open the dock, untucking it if needed, and ensure it has a placed position. */
export function openDock(state: DockState, vp: Viewport): DockState {
  const placed = ensurePlaced(state, vp);
  return { ...placed, open: true, tucked: false };
}

/** Close the dock fully (X / Escape). Geometry is preserved for the next open. */
export function closeDock(state: DockState): DockState {
  return { ...state, open: false };
}

/** Toggle open / closed, ensuring placement and untucking on open. */
export function toggleDock(state: DockState, vp: Viewport): DockState {
  return state.open ? closeDock(state) : openDock(state, vp);
}

/** Collapse to / expand from the header pill. A tucked dock cannot also be
 *  collapsed (the tab represents it), so expanding is a no-op semantically; we
 *  only flip the collapsed flag. */
export function toggleCollapsed(state: DockState): DockState {
  return { ...state, collapsed: !state.collapsed };
}

/** Tuck the dock off `side`, parking its x at the resting edge x. */
export function tuckDock(state: DockState, side: DockSide, vp: Viewport): DockState {
  return { ...state, tucked: true, side, x: restingX(side, vp), y: state.y ?? defaultFloatPos(vp).y };
}

/** Pull a tucked dock back in at the same size, resting against its side. */
export function untuckDock(state: DockState, vp: Viewport): DockState {
  return { ...state, tucked: false, x: restingX(state.side, vp), y: state.y ?? defaultFloatPos(vp).y };
}

/** Resolve the drag end at top-left (x, y) into the next state, tucking when
 *  the release lands near an edge. The (x, y) is assumed already clamped. */
export function endDragAt(
  state: DockState,
  x: number,
  y: number,
  vp: Viewport,
): DockState {
  const side = tuckDecision(x, vp);
  if (side) return tuckDock({ ...state, x, y }, side, vp);
  return { ...state, x, y, tucked: false };
}

/** Reset to the default floating placement (top-right, expanded, untucked). */
export function resetDock(state: DockState, vp: Viewport): DockState {
  const p = defaultFloatPos(vp);
  return { ...state, collapsed: false, tucked: false, side: "right", x: p.x, y: p.y };
}

/** Ensure the state has a concrete position; if not, place it at the default. */
export function ensurePlaced(state: DockState, vp: Viewport): DockState {
  if (state.x != null && state.y != null) return state;
  const p = defaultFloatPos(vp);
  return { ...state, x: p.x, y: p.y };
}

/** Re-clamp an existing position into a (possibly resized) viewport, keeping a
 *  tucked dock parked at its side's resting x. */
export function reclampForViewport(state: DockState, vp: Viewport): DockState {
  if (state.x == null || state.y == null) return ensurePlaced(state, vp);
  if (state.tucked) return { ...state, x: restingX(state.side, vp) };
  const c = clampPosition(state.x, state.y, vp);
  return { ...state, x: c.x, y: c.y };
}

/** Project the live state to its persisted subset (open is never persisted). */
export function toPersisted(state: DockState): PersistedDockState {
  return {
    collapsed: state.collapsed,
    tucked: state.tucked,
    side: state.side,
    x: state.x,
    y: state.y,
  };
}

/** Parse a persisted JSON string back into a partial state, tolerating any
 *  malformed / absent value (returns null so the caller keeps its defaults).
 *  Never throws. */
export function parsePersisted(raw: string | null): PersistedDockState | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj == null) return null;
  const o = obj as Record<string, unknown>;
  const side: DockSide = o.side === "left" ? "left" : "right";
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    collapsed: o.collapsed === true,
    tucked: o.tucked === true,
    side,
    x: num(o.x),
    y: num(o.y),
  };
}

/** Merge a parsed persisted subset onto the initial state (open stays false). */
export function fromPersisted(persisted: PersistedDockState | null): DockState {
  const base = initialDockState();
  if (!persisted) return base;
  return { ...base, ...persisted };
}
