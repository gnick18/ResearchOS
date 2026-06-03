// primer dialog bot — PURE primer-metadata read/write for a primer_bind feature.
//
// Primers persist as standard GenBank primer_bind features. Everything the
// SnapGene-style "Edit Primer" dialog edits lives in the feature's /note
// qualifiers (no new on-disk fields, no sidecar) so the .gb round-trips:
//
//   /note="primer <OLIGO>"      the primer's own 5'->3' sequence (existing flag,
//                               written by addPrimerFeature / the Primers panel)
//   /note="description <TEXT>"  a free-text description
//   /note="5' phosphorylated"   present == the 5' end is phosphorylated
//
// The oligo's binding SITE (start/end/strand) is NOT stored separately; it is
// re-derived from the oligo against the template via findBindingSites (primer.ts),
// the SAME logic the Check view and PrimerDialog use, so the editor never invents
// its own coordinate math. This module is pure (no React, no I/O) and unit-tested.

import type { EditFeature } from "./edit-model";
import type { QualifierRow } from "./feature-edit";
import { findBindingSites, sanitizePrimer, type BindingSite } from "./primer";

/** The note-line markers we own inside the feature's /note qualifier list. */
const OLIGO_PREFIX = "primer";
const DESCRIPTION_PREFIX = "description";
const PHOSPHO_MARKER = "5' phosphorylated";

/** Flatten a feature's /note qualifier (string | string[]) into discrete lines. */
function noteLines(feature: EditFeature): string[] {
  const note = feature.notes?.note;
  if (Array.isArray(note)) return note.map((n) => String(n));
  if (typeof note === "string") return [note];
  if (note === undefined || note === null) return [];
  return [String(note)];
}

/** Pull the primer's own 5'->3' oligo out of its /note "primer <SEQ>" flag.
 *  Mirrors SequencePrimersPanel.primerSeqOf so the two never disagree. */
export function readPrimerSeq(feature: EditFeature): string {
  for (const line of noteLines(feature)) {
    const m = line.match(/primer\s+([ACGTUacgtu]+)/);
    if (m) return m[1].toUpperCase();
  }
  return "";
}

/** Read the free-text description (the /note "description <TEXT>" line), or "". */
export function readPrimerDescription(feature: EditFeature): string {
  for (const line of noteLines(feature)) {
    const m = line.match(/^description\s+([\s\S]+)$/i);
    if (m) return m[1].trim();
  }
  return "";
}

/** True when the primer carries the 5'-phosphorylated marker note. */
export function readPrimerPhosphorylated(feature: EditFeature): boolean {
  return noteLines(feature).some((line) => line.trim().toLowerCase() === PHOSPHO_MARKER);
}

/**
 * Re-derive the binding SITE for an edited oligo against the template, the SAME
 * way the Check view and PrimerDialog do (findBindingSites, full match preferred,
 * then 3'-anchored partial). Returns the best site (sites sort full-before-partial,
 * by start) or null when the oligo does not anneal anywhere.
 */
export function derivePrimerSite(oligo: string, template: string): BindingSite | null {
  const clean = sanitizePrimer(oligo);
  if (clean.length === 0) return null;
  const sites = findBindingSites(clean, template, { allowPartial: true });
  return sites[0] ?? null;
}

/**
 * Build the FULL /note qualifier row set for a primer_bind feature from the
 * editor's fields. Existing NON-primer note lines on the feature are preserved
 * (so a primer that also carries, say, a /gene note keeps it); only the three
 * primer-owned note lines (oligo / description / phosphorylation) are rewritten.
 * Other qualifier keys (anything that is not "note") are carried through verbatim.
 */
export function buildPrimerQualifiers(
  feature: EditFeature,
  fields: { oligo: string; description: string; phosphorylated: boolean },
): QualifierRow[] {
  const rows: QualifierRow[] = [];

  // Carry through every non-`note` qualifier verbatim (e.g. /label written by
  // addPrimerFeature, or any biological qualifier the user added).
  const notes = feature.notes ?? {};
  for (const key of Object.keys(notes)) {
    if (key === "note") continue;
    const v = notes[key];
    const values = Array.isArray(v) ? v.map((x) => String(x)) : [String(v)];
    for (const value of values) rows.push({ key, value });
  }

  // Keep any pre-existing /note lines the primer did NOT own (not our three
  // markers), so unrelated notes survive an edit.
  for (const line of noteLines(feature)) {
    const t = line.trim();
    const lower = t.toLowerCase();
    const isOligo = /^primer\s+[ACGTUacgtu]+/i.test(t);
    const isDesc = /^description\s+/i.test(t);
    const isPhospho = lower === PHOSPHO_MARKER;
    if (!isOligo && !isDesc && !isPhospho) rows.push({ key: "note", value: line });
  }

  // Re-write the three primer-owned note lines from the editor's current fields.
  const clean = sanitizePrimer(fields.oligo);
  if (clean) rows.push({ key: "note", value: `${OLIGO_PREFIX} ${clean}` });
  const desc = fields.description.trim();
  if (desc) rows.push({ key: "note", value: `${DESCRIPTION_PREFIX} ${desc}` });
  if (fields.phosphorylated) rows.push({ key: "note", value: PHOSPHO_MARKER });

  return rows;
}
