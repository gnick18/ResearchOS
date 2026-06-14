// One canonical type registry for BOTH the AI artifact index
// (src/lib/ai/artifact-index.ts) and the GUI BeakerSearch palette index
// (src/components/beaker-search/global-index.ts). This is the anti-drift seam,
// the single list of the artifact KINDS both indices cover, so adding a new
// kind in the future fails to COMPILE on either side until both handle it.
//
// This module is NEUTRAL: it imports no React, no data layer, nothing but
// types and the one constant array below, so the GUI can pull it without
// dragging in the agent loop and the AI side can pull it without dragging in
// React. Keep it that way.
//
// The naming wrinkle (documented, intentional): the two indices spell ONE of
// the ten kinds differently. The AI brief calls it "experiment" (it indexes
// only experiment-typed tasks); the GUI palette calls it "task" (it indexes
// every task kind under one row type). The registry treats "experiment" as the
// canonical name and maps it to/from the GUI "task" name via
// AI_TO_GUI_TYPE / GUI_TO_AI_TYPE below, so both spellings keep working and
// neither side breaks. Every OTHER kind shares one name across both indices.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

/**
 * The canonical discriminant for an indexed artifact kind, in the AI brief's
 * vocabulary (the ArtifactBrief.type values). Ten kinds. The GUI palette uses
 * the same strings EXCEPT it spells "experiment" as "task" (see GuiIndexType).
 */
export type IndexedType =
  | "note"
  | "experiment"
  | "method"
  | "sequence"
  | "datahub"
  | "project"
  | "purchase"
  | "molecule"
  | "phylo"
  | "inventory";

/**
 * The same ten kinds in the GUI palette's vocabulary (the GlobalIndexEntry.type
 * values). Identical to IndexedType except the experiment kind is spelled
 * "task" (the palette indexes every task type under one row type).
 */
export type GuiIndexType =
  | "task"
  | "project"
  | "method"
  | "sequence"
  | "inventory"
  | "note"
  | "datahub"
  | "molecule"
  | "purchase"
  | "phylo";

/**
 * The canonical list of indexed kinds (AI vocabulary). The ORDER is not
 * load-bearing; the array exists so a test can iterate every kind and assert
 * both index builders cover it. Typed as readonly IndexedType[] AND asserted
 * `as const` so its membership is the single source of truth.
 */
export const INDEXED_TYPES = [
  "note",
  "experiment",
  "method",
  "sequence",
  "datahub",
  "project",
  "purchase",
  "molecule",
  "phylo",
  "inventory",
] as const satisfies readonly IndexedType[];

/**
 * Map an AI/brief type to the GUI palette's spelling. Only "experiment" differs
 * (becomes "task"); every other kind is identical. Pure, total over IndexedType.
 */
export function aiTypeToGuiType(type: IndexedType): GuiIndexType {
  return type === "experiment" ? "task" : type;
}

/**
 * Map a GUI palette type back to the AI/brief spelling. Only "task" differs
 * (becomes "experiment"); every other kind is identical. Pure, total over
 * GuiIndexType.
 */
export function guiTypeToAiType(type: GuiIndexType): IndexedType {
  return type === "task" ? "experiment" : type;
}

/**
 * Compile-time exhaustiveness helper. Reaching this at runtime means a switch or
 * map over IndexedType missed a kind; the `never` parameter makes that a COMPILE
 * error first. Both index builders route their default branch here.
 */
export function assertNeverIndexedType(value: never): never {
  throw new Error(`Unhandled indexed type: ${String(value)}`);
}
