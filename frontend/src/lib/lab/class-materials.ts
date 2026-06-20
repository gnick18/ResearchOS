// Class Mode (CT-1): pure filter for the Class Materials surface. The
// instructor's OWN records that are shared to the whole class carry the
// WHOLE_LAB_SENTINEL ("*") in their shared_with (relabeled "whole class" in the
// share dialog, same underlying grant). This module is the record-type-agnostic
// filter the Class Materials panel runs over the instructor's notes (and, later,
// datahub records) to materialize that view. Pure, no I/O, no React, so the
// flag-off parity and the filter semantics are unit-provable.
//
// This is a FILTERED VIEW over existing data, not a new store. The "*" grant is
// the source of truth; this module only reads it. The share / unshare toggle in
// the panel flips the "*" entry through the existing whole-lab grant write
// (sharingApi.shareNote), it does NOT write a new "is class material" flag.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { SharedUser } from "@/lib/types";
import { isWholeLabShared } from "@/lib/sharing/unified";

/**
 * The minimal shape the Class Materials filter needs from any shareable record.
 * Notes, datahub deposits, methods, links all satisfy this implicitly (each
 * carries an owner stamp + a shared_with array). Kept structural so a single
 * filter covers every carrier type without a per-type branch.
 */
export interface ClassMaterialCandidate {
  /** The record's owner username. Notes stamp this as `username`; other stores
   *  use `owner`. The caller maps its native field onto `owner` before calling. */
  owner: string;
  shared_with?: SharedUser[] | null;
}

/**
 * True iff `record` is one of this instructor's OWN records that is currently
 * shared to the whole class (the "*" sentinel). Both conditions must hold: a
 * record owned by someone else, or a private own record, is NOT a class
 * material.
 *
 * @param record      the candidate record (owner + shared_with)
 * @param instructor  the active instructor's username
 */
export function isOwnClassMaterial(
  record: ClassMaterialCandidate,
  instructor: string,
): boolean {
  if (!record) return false;
  if (record.owner !== instructor) return false;
  return isWholeLabShared(record.shared_with ?? []);
}

/**
 * Filter a list of candidate records down to this instructor's own
 * whole-class-shared materials. Order is preserved from the input.
 *
 * @param records     candidate records (own + others, shared + private)
 * @param instructor  the active instructor's username
 */
export function filterOwnClassMaterials<T extends ClassMaterialCandidate>(
  records: T[],
  instructor: string,
): T[] {
  return records.filter((r) => isOwnClassMaterial(r, instructor));
}
