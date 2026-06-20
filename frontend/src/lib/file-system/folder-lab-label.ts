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
//   class  with a name "C"          -> "C - class"
//   student with a name "C"         -> "C - student"
//   head/member with no cached name -> "Lab - head" / "Lab - member"
//   class/student with no name      -> "Lab - class" / "Lab - student"
//
// Flag-off safety: a folder remembered before lab-as-folder has NO labRole, so
// this returns "Solo" and nothing about the unlabeled-today behavior changes for
// the rows that matter (single-folder solo users never see the switcher at all).
// Class Mode (CM-P1) adds the class / student labels; this helper is a pure
// READER, so per the H7 reader-tolerance invariant it does NOT gate on any flag.
// A class row authored elsewhere with class mode OFF still renders its label, and
// any genuinely unknown future role falls through to the "<name> - <role>" form
// rather than throwing. The solo / head / member / legacy outputs are
// byte-identical to before this change.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { RememberedFolder } from "./indexeddb-store";

/** The cached lab fields this helper reads off a remembered folder. */
export type FolderLabIdentity = Pick<RememberedFolder, "labRole" | "labName">;

/**
 * The short lab label for a remembered folder. Returns "Solo" for a solo folder
 * or a legacy row with no cached role; otherwise "<labName> - <role>" (e.g.
 * "X - head", "Y - member", "C - class", "C - student"), falling back to "Lab"
 * when the name is unknown.
 *
 * The role is interpolated verbatim, so the class / student roles (and any
 * future additive role) render with no per-role branching and no flag gate.
 * Only the solo / absent case short-circuits to "Solo"; every other role,
 * including an unknown one, takes the "<name> - <role>" form, which keeps the
 * reader tolerant per the H7 invariant.
 */
export function folderLabLabel(folder: FolderLabIdentity): string {
  const role = folder.labRole;
  // Solo (or a legacy row with no cached role) short-circuits. This is the only
  // branch; head / member / class / student / any-unknown role all flow through
  // the uniform "<name> - <role>" form below so a class row renders cleanly even
  // with class mode OFF.
  if (!role || role === "solo") return "Solo";
  const name = folder.labName?.trim() || "Lab";
  return `${name} - ${role}`;
}

/**
 * The one-word sublabel for a DISCOVERED lab row in the folder switcher (a lab
 * the relay knows about that has no local folder yet). A class folder reads
 * "Student" (the role a joiner takes in a class); every other case, including an
 * absent role or a research-lab membership, reads "Member". Pure, flag-free
 * reader so a class row renders its true kind even when authored elsewhere.
 *
 * Class Mode (CM-P2A): a class is never directory-published, so today this only
 * diverges from "Member" when a re-discovered folder carried a cached class
 * role. Kept role-driven so it stays correct as discovery widens.
 */
export function discoveredLabSublabel(role?: string): string {
  if (role === "class" || role === "student") return "Student";
  return "Member";
}
