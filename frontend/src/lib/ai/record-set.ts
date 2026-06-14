// BeakerBot record-set widget seam (ai record-widget bot, 2026-06-14).
//
// When a record-returning tool RESOLVES a set of matches (notes in May, the
// experiments in a project, full-text hits for a term), the chat should render an
// inline, searchable master-detail browser under the assistant reply, not just the
// narrated count. This module is the SEAM that carries that full set from the tool
// to the UI WITHOUT inflating the model's context.
//
// The contract (locked design):
// - A tool keeps returning its existing capped arrays to the model (for narration
//   and context), exactly as before. It ALSO attaches a UI-only full set (capped at
//   RECORD_SET_UI_CAP) under the _ui key via withRecordSetUi.
// - The agent loop strips _ui (stripRecordSetUi) before serializing the tool result
//   into the message it pushes back for the model, so the full set never reaches the
//   inference model and never costs a token.
// - The loop's onToolResult callback hands the raw (unstripped) result to the
//   conversation store, which lifts result._ui onto the in-flight assistant message
//   so the widget can render it.
//
// Deterministic by construction: the widget appears because a record-returning tool
// RAN, never because the model emitted a special link.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import type { ObjectRefType } from "@/lib/references";
import type { ArtifactBrief } from "@/lib/ai/artifact-index";

/** The field a tool attaches its UI-only full set under, and the loop strips before
 *  the result reaches the model. A leading underscore marks it as out-of-band. */
export const RECORD_SET_UI_KEY = "_ui" as const;

/** The hard cap on the UI full set. The widget is built to display many items
 *  cleanly, but an unbounded set would bloat the persisted chat and the in-memory
 *  message, so 500 is the ceiling. total may exceed this; the widget shows the
 *  "showing N of total" note when it does. */
export const RECORD_SET_UI_CAP = 500;

/** The row type discriminant. Every ObjectRefType the embed pipeline knows, PLUS
 *  "purchase", which has no embed route or deep link (purchase items open the
 *  /purchases page as a whole). The widget renders a purchase as the calm fallback
 *  card and routes its Open full to /purchases. */
export type RecordSetRowType = ObjectRefType | "purchase";

/** One row in the record-set browser. A small, display-only envelope, never a body.
 *  type routes the preview to the right embed renderer; id is always a string so a
 *  numeric record id and a string id both work. */
export type RecordSetRow = {
  type: RecordSetRowType;
  id: string;
  title: string;
  subtitle?: string;
  /** ISO date string when the source carries one. */
  date?: string;
  /** A short snippet of the record's own text, for full-text search hits. */
  snippet?: string;
  /** A small extra label, e.g. "3 matches", a status, a price. */
  meta?: string;
};

/** The full match set handed to the widget. kind is the originating tool name;
 *  title is a short human label; total is the full match count (may exceed
 *  items.length when more than RECORD_SET_UI_CAP matched). */
export type RecordSet = {
  kind: string;
  title: string;
  total: number;
  items: RecordSetRow[];
  /** The search term, when one drove the set. Shown in the header. */
  query?: string;
};

/** Attach a RecordSet to a tool result under the _ui key WITHOUT touching the rest
 *  of the result the model reads. The loop strips this key before the result is
 *  serialized for the model, so the full set is UI-only. Returns the SAME object
 *  reference widened with the key, so the tool's existing return shape is preserved
 *  byte-for-byte for the model (only the extra out-of-band key is added). */
export function withRecordSetUi<T extends object>(
  result: T,
  set: RecordSet,
): T & { _ui: RecordSet } {
  return { ...result, [RECORD_SET_UI_KEY]: set } as T & { _ui: RecordSet };
}

/** Return a shallow clone of a tool result with the _ui key removed, so the full
 *  UI set never reaches the model. A non-object (or a result with no _ui) is passed
 *  through unchanged, so this is safe to run over every tool result. */
export function stripRecordSetUi(result: unknown): unknown {
  if (result === null || typeof result !== "object") return result;
  if (!(RECORD_SET_UI_KEY in (result as Record<string, unknown>))) return result;
  const clone = { ...(result as Record<string, unknown>) };
  delete clone[RECORD_SET_UI_KEY];
  return clone;
}

/** Read a RecordSet off a (possibly unstripped) tool result, or null when absent.
 *  Defensive: tolerates a non-object and a malformed _ui value. Used by the store's
 *  onToolResult to decide whether a tool produced a widget set. */
export function recordSetFromResult(result: unknown): RecordSet | null {
  if (result === null || typeof result !== "object") return null;
  const value = (result as Record<string, unknown>)[RECORD_SET_UI_KEY];
  if (value === null || typeof value !== "object") return null;
  const set = value as Partial<RecordSet>;
  if (!Array.isArray(set.items) || typeof set.kind !== "string") return null;
  return value as RecordSet;
}

/** Build a short widget title from a base noun plus an optional date window, e.g.
 *  "Experiments since 2026-05-01" or "Notes 2026-05-01 to 2026-05-31". When the
 *  filter carries no date bound the bare base is returned. Kept short on purpose
 *  (the widget header is narrow). Pure. */
export function periodLabel(
  base: string,
  filter: { since?: string; until?: string } | undefined,
): string {
  const since = filter?.since?.trim();
  const until = filter?.until?.trim();
  if (since && until) return `${base} ${since} to ${until}`;
  if (since) return `${base} since ${since}`;
  if (until) return `${base} through ${until}`;
  return base;
}

/** Map an ArtifactBrief (the cross-type index envelope) to a RecordSetRow. The
 *  brief.type is already one of the ObjectRefType discriminants. Pure. */
export function briefToRow(brief: ArtifactBrief): RecordSetRow {
  return {
    type: brief.type as RecordSetRowType,
    id: String(brief.id),
    title: brief.title,
    ...(brief.subtitle ? { subtitle: brief.subtitle } : {}),
    ...(brief.date ? { date: brief.date } : {}),
  };
}
