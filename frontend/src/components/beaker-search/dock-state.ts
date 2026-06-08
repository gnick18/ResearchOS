// BeakerSearch v3, the floating-dock geometry + persistence brain.
//
// v3 turns the Cmd-K palette from a full-screen modal into a small floating
// capsule the user drags anywhere, collapses to a pill, or hides off any of the
// four screen edges into a peek tab. All of that is pure x / y / side / flag
// math, so it lives here as a tested module and the React shell stays thin.
// Nothing in this file reads the clock, the DOM, or randomness; callers pass the
// viewport size and the dock footprint in, and the functions return the next
// state. That keeps the whole state machine deterministic for the Vitest
// contract.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

/** Which screen edge the dock hides against. v3 supports all four; left / right
 *  leave a vertical peek tab, top / bottom leave a horizontal one. */
export type DockSide = "left" | "right" | "top" | "bottom";

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

/** A safe fallback dock height for callers that have no measured element yet
 *  (the real height is measured from the DOM and passed in). */
export const DOCK_HEIGHT_FALLBACK = 420;

/** How far PAST a wall the dock's desired (unclamped) drag position must reach
 *  before that wall arms for a hide. The dock is clamped on screen, so the user
 *  has to keep pushing into the wall (fully place it on the edge) to arm it.
 *  Mere proximity never arms; this is the deliberate-gesture guarantee. */
export const ARM_OVERSHOOT = 4;

/** Inset from a side when the dock rests (tucked resting position, default). */
const EDGE_INSET = 16;

/** Top inset for the default placement. */
const TOP_INSET = 24;

/** Right inset for the default placement (near the top-right corner). */
const DEFAULT_RIGHT_INSET = 40;

/** Minimum on-screen coordinate so a dragged dock can never be lost off the top
 *  or left of the viewport. */
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

/** Clamp a value into [lo, hi], tolerating an inverted range (tiny viewports). */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(lo, v), Math.max(lo, hi));
}

/** Clamp a candidate top-left so the whole dock footprint stays within the
 *  viewport. `headerStrip` keeps at least that much on screen when the height is
 *  unknown; when `dockH` is given the full height is kept visible. */
export function clampPosition(
  x: number,
  y: number,
  vp: Viewport,
  headerStrip = 44,
  dockH?: number,
): { x: number; y: number } {
  const maxX = Math.max(MIN_VISIBLE, vp.width - DOCK_WIDTH);
  const keep = dockH ?? headerStrip;
  const maxY = Math.max(MIN_VISIBLE, vp.height - keep);
  return {
    x: clamp(x, MIN_VISIBLE, maxX),
    y: clamp(y, MIN_VISIBLE, maxY),
  };
}

/** Decide whether a DESIRED (unclamped) drag position is being pushed past a
 *  wall, and which one. Returns the wall with the largest overshoot beyond
 *  ARM_OVERSHOOT, or null when the dock is merely on screen. Ties resolve
 *  left, right, top, bottom. This is the only thing that arms a hide. */
export function armedWall(
  desiredX: number,
  desiredY: number,
  vp: Viewport,
  dockH: number = DOCK_HEIGHT_FALLBACK,
): DockSide | null {
  const over: Array<[DockSide, number]> = [
    ["left", MIN_VISIBLE - desiredX],
    ["right", desiredX - (vp.width - DOCK_WIDTH)],
    ["top", MIN_VISIBLE - desiredY],
    ["bottom", desiredY - (vp.height - dockH)],
  ];
  let best: DockSide | null = null;
  let bestOver = ARM_OVERSHOOT;
  for (const [side, amount] of over) {
    if (amount > bestOver) {
      bestOver = amount;
      best = side;
    }
  }
  return best;
}

/** The opposite wall, used to decide which arrow key pulls a tucked dock back. */
export function oppositeSide(side: DockSide): DockSide {
  switch (side) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "top":
      return "bottom";
    case "bottom":
      return "top";
  }
}

/** Map an arrow key to the wall it points at, or null for any other key. */
export function arrowToSide(key: string): DockSide | null {
  switch (key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "top";
    case "ArrowDown":
      return "bottom";
    default:
      return null;
  }
}

/** The resting top-left for a dock tucked (or about to tuck) against `side`.
 *  The capsule still lives at this position; the tuck is a CSS transform that
 *  slides the body off-screen and leaves the peek tab, so the position stays a
 *  sane on-screen value for when it untucks. Left / right pin x and keep y where
 *  it was; top / bottom pin y and keep x. */
export function restingPos(
  side: DockSide,
  state: DockState,
  vp: Viewport,
  dockH: number = DOCK_HEIGHT_FALLBACK,
): { x: number; y: number } {
  const fallback = defaultFloatPos(vp);
  const curX = state.x ?? fallback.x;
  const curY = state.y ?? fallback.y;
  const keepX = clamp(curX, EDGE_INSET, vp.width - DOCK_WIDTH - EDGE_INSET);
  const keepY = clamp(curY, EDGE_INSET, vp.height - dockH - EDGE_INSET);
  switch (side) {
    case "left":
      return { x: EDGE_INSET, y: keepY };
    case "right":
      return { x: Math.max(EDGE_INSET, vp.width - DOCK_WIDTH - EDGE_INSET), y: keepY };
    case "top":
      return { x: keepX, y: EDGE_INSET };
    case "bottom":
      return { x: keepX, y: Math.max(EDGE_INSET, vp.height - dockH - EDGE_INSET) };
  }
}

/** The nearest wall to the dock's current footprint, used by the hide button
 *  (which tucks without a drag). Falls back to the current side when unplaced. */
export function nearestSide(
  state: DockState,
  vp: Viewport,
  dockH: number = DOCK_HEIGHT_FALLBACK,
): DockSide {
  if (state.x == null || state.y == null) return state.side;
  const dist: Array<[DockSide, number]> = [
    ["left", state.x],
    ["right", vp.width - (state.x + DOCK_WIDTH)],
    ["top", state.y],
    ["bottom", vp.height - (state.y + dockH)],
  ];
  let best = dist[0];
  for (const d of dist) if (d[1] < best[1]) best = d;
  return best[0];
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

/** Collapse to / expand from the header pill. */
export function toggleCollapsed(state: DockState): DockState {
  return { ...state, collapsed: !state.collapsed };
}

/** Hide the dock off `side`, parking it at the resting edge position. */
export function tuckDock(
  state: DockState,
  side: DockSide,
  vp: Viewport,
  dockH: number = DOCK_HEIGHT_FALLBACK,
): DockState {
  const rest = restingPos(side, state, vp, dockH);
  return { ...state, tucked: true, side, x: rest.x, y: rest.y };
}

/** Pull a tucked dock back in at the same size, resting against its side. */
export function untuckDock(
  state: DockState,
  vp: Viewport,
  dockH: number = DOCK_HEIGHT_FALLBACK,
): DockState {
  const rest = restingPos(state.side, state, vp, dockH);
  return { ...state, tucked: false, x: rest.x, y: rest.y };
}

/** Resolve a drag end at the DESIRED (unclamped) position into the next state.
 *  If the user pushed past a wall (armed), the dock hides off that wall; else it
 *  rests at the clamped on-screen position. */
export function endDrag(
  state: DockState,
  desiredX: number,
  desiredY: number,
  vp: Viewport,
  dockH: number = DOCK_HEIGHT_FALLBACK,
): DockState {
  const wall = armedWall(desiredX, desiredY, vp, dockH);
  if (wall) return tuckDock(state, wall, vp, dockH);
  const c = clampPosition(desiredX, desiredY, vp, 44, dockH);
  return { ...state, x: c.x, y: c.y, tucked: false };
}

/** Apply an arrow key to the dock when the user is NOT in a text box (the caller
 *  enforces that guard). A floating dock hides toward the arrow's wall; a tucked
 *  dock comes back only when the arrow points away from the wall it sits on.
 *  Returns null when the key does nothing so the caller can skip preventDefault. */
export function applyArrowKey(
  state: DockState,
  key: string,
  vp: Viewport,
  dockH: number = DOCK_HEIGHT_FALLBACK,
): DockState | null {
  const dir = arrowToSide(key);
  if (!dir) return null;
  if (state.tucked) {
    return dir === oppositeSide(state.side) ? untuckDock(state, vp, dockH) : null;
  }
  return tuckDock(state, dir, vp, dockH);
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
 *  tucked dock parked at its side's resting position. */
export function reclampForViewport(
  state: DockState,
  vp: Viewport,
  dockH: number = DOCK_HEIGHT_FALLBACK,
): DockState {
  if (state.x == null || state.y == null) return ensurePlaced(state, vp);
  if (state.tucked) {
    const rest = restingPos(state.side, state, vp, dockH);
    return { ...state, x: rest.x, y: rest.y };
  }
  const c = clampPosition(state.x, state.y, vp, 44, dockH);
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
  const side: DockSide =
    o.side === "left" || o.side === "top" || o.side === "bottom"
      ? o.side
      : "right";
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
