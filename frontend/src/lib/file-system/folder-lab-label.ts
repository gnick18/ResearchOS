// Lab-as-folder (P1): switcher label for a remembered folder's lab identity.
//
// The folder switcher reads each remembered folder's CACHED lab identity (labRole
// + labName, written by the join flow into RememberedFolderMeta) so it can read as
// a LAB switcher without opening every folder. This pure helper turns that cached
// meta into the short label string shown under the folder name.
//
// Labels:
//   solo (or no cached role)        -> "Solo"
//   head  with a name "X"           -> "X - head"
//   member with a name "Y"          -> "Y - member"
//   head/member with no cached name -> "Lab - head" / "Lab - member"
//
// Flag-off safety: a folder remembered before lab-as-folder has NO labRole, so
// this returns "Solo" and nothing about the unlabeled-today behavior changes for
// the rows that matter (single-folder solo users never see the switcher at all).
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { RememberedFolder } from "./indexeddb-store";

/** The cached lab fields this helper reads off a remembered folder. */
export type FolderLabIdentity = Pick<RememberedFolder, "labRole" | "labName">;

/**
 * The short lab label for a remembered folder. Returns "Solo" for a solo folder
 * or a legacy row with no cached role; otherwise "<labName> - head" or
 * "<labName> - member", falling back to "Lab" when the name is unknown.
 */
export function folderLabLabel(folder: FolderLabIdentity): string {
  const role = folder.labRole;
  if (!role || role === "solo") return "Solo";
  const name = folder.labName?.trim() || "Lab";
  return `${name} - ${role}`;
}
