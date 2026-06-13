// Info sheet model for the Data Hub (info documentation slice).
//
// An Info sheet is a DOCUMENTATION page that lives in the Data Hub rail next to
// the tables, so the context of a dataset (what it is, where it came from, the
// instrument, key constants) travels with the data. It is NOT a grid: it has no
// columns, no rows, no analysis, and no figure. Its content is the additive
// `info` field on DataHubDocContent, a free-text markdown BODY plus an optional
// list of named CONSTANTS (name / value / optional note).
//
// v1 is DOCUMENTATION ONLY. A constant is displayed for reference, not yet read
// by any analysis. Follow-up: let an analysis pull a constant by name (e.g. a
// dilution factor feeding a normalize transform).
//
// No em-dashes, no emojis, no mid-sentence colons.

import type {
  DataHubDocContent,
  InfoConstant,
  InfoContent,
} from "@/lib/datahub/model/types";

/**
 * Build the documentation payload for a fresh, empty Info sheet: an empty body
 * and no constants. The grid (columns / rows / analyses / plots) stays empty;
 * an Info sheet lives entirely in this info field.
 */
export function buildEmptyInfoSheet(): InfoContent {
  return { body: "", constants: [] };
}

/** True when the content describes an Info sheet. */
export function isInfoSheet(content: DataHubDocContent): boolean {
  return content.meta.table_type === "info";
}

/**
 * The Info sheet's documentation, or an empty payload when absent. An Info sheet
 * always carries `info`, but reading through a defaulting accessor keeps every
 * caller safe against a doc that has table_type "info" with no info field yet
 * (e.g. mid-migration), so the editor never sees undefined.
 */
export function infoOf(content: DataHubDocContent): InfoContent {
  return content.info ?? { body: "", constants: [] };
}

/** Trim a constant's name / value / note for storage (the note drops when blank). */
function cleanConstant(c: InfoConstant): InfoConstant {
  const out: InfoConstant = {
    name: typeof c.name === "string" ? c.name : "",
    value: typeof c.value === "string" ? c.value : "",
  };
  const note = typeof c.note === "string" ? c.note : "";
  if (note !== "") out.note = note;
  return out;
}

/**
 * Append a blank constant row to the end of the list, returning the NEXT info
 * payload (pure, the caller persists + commits). Used by the editor's Add
 * constant affordance.
 */
export function addConstant(info: InfoContent): InfoContent {
  return {
    body: info.body,
    constants: [...info.constants, { name: "", value: "" }],
  };
}

/**
 * Patch the constant at `index` with a partial (name / value / note), returning
 * the NEXT info payload (pure). Out-of-range index is a no-op (returns the same
 * shape). Used by the editor's per-field edits.
 */
export function updateConstant(
  info: InfoContent,
  index: number,
  patch: Partial<InfoConstant>,
): InfoContent {
  if (index < 0 || index >= info.constants.length) {
    return { body: info.body, constants: [...info.constants] };
  }
  const next = info.constants.map((c, i) =>
    i === index ? cleanConstant({ ...c, ...patch }) : c,
  );
  return { body: info.body, constants: next };
}

/**
 * Remove the constant at `index`, returning the NEXT info payload (pure).
 * Out-of-range index is a no-op. Used by the editor's per-row Delete.
 */
export function removeConstant(info: InfoContent, index: number): InfoContent {
  if (index < 0 || index >= info.constants.length) {
    return { body: info.body, constants: [...info.constants] };
  }
  return {
    body: info.body,
    constants: info.constants.filter((_, i) => i !== index),
  };
}

/** Replace the markdown body, returning the NEXT info payload (pure). */
export function setBody(info: InfoContent, body: string): InfoContent {
  return { body: typeof body === "string" ? body : "", constants: [...info.constants] };
}
