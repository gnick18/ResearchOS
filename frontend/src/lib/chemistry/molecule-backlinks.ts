// Chemistry molecule backlinks. Thin wrapper over the system-wide scanner
// (lib/object-backlinks.ts) kept for the MoleculeDetail "Used in" section, which
// imports scanMoleculeBacklinks + BacklinkEntry from here.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { scanBacklinks, type BacklinkEntry } from "@/lib/object-backlinks";

export type { BacklinkEntry };

/** Scan the current user's notes, experiments, and methods for references to a
 *  molecule by id. Delegates to the generalized object-backlinks scanner. */
export function scanMoleculeBacklinks(moleculeId: string): Promise<BacklinkEntry[]> {
  return scanBacklinks("molecule", moleculeId);
}
