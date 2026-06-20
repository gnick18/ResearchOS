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
 * The visual key for one remembered-folder row in the switcher (REFINEMENT 3).
 *
 * One profile can hold ALL folder kinds at once (a solo workspace, a lab they
 * head, a lab they joined, a class they teach, a class they take), so each row
 * needs a short colored text PILL to tell the kinds apart at a glance. This pure
 * helper maps a labRole to a brand-token color and a short badge label. It is a
 * READER, so it does NOT gate on any flag (H7 reader-tolerance) and defaults any
 * unknown or absent role to the neutral solo styling.
 *
 * `token` is a brand color token name. The caller renders the pill as
 * bg-{token}/10 text-{token}, mirroring the existing Active pill (bg-accent/10
 * text-accent). Every token here is AA-legible for small text on white, so the
 * pill text stays readable. The mapping lives in this ONE spot so the
 * provisional palette is trivial to retune after Grant signs it off.
 */
export interface FolderKindBadge {
  /** Brand color token (e.g. "brand-action"). Used as text-{token} +
   *  bg-{token}/10 by the caller. */
  token: string;
  /** Short human label for the pill (e.g. "Lab head"). */
  label: string;
}

/**
 * Map a remembered folder's labRole to its color + badge for the switcher key.
 * solo / absent / any-unknown role -> neutral ink "Solo"; head -> brand-action
 * "Lab head"; member -> brand-purple "Lab member"; class -> teaching amber
 * "Class"; student -> teaching green "Student".
 */
export function folderKindBadge(folder: FolderLabIdentity): FolderKindBadge {
  switch (folder.labRole) {
    case "head":
      return { token: "brand-action", label: "Lab head" };
    case "member":
      return { token: "brand-purple", label: "Lab member" };
    case "class":
      return { token: "brand-teach", label: "Class" };
    case "student":
      return { token: "brand-teach-soft", label: "Student" };
    case "solo":
    default:
      // solo, absent, or any future/unknown role falls back to neutral ink.
      return { token: "brand-ink", label: "Solo" };
  }
}

/**
 * The DISPLAY name for a remembered-folder row (REFINEMENT 3). Resolves to the
 * user's nickname when one is set (and non-blank), else the real folder name.
 * The underlying folder name is always preserved on the meta, so this is a pure
 * presentation choice and clearing the nickname restores the real name. Tolerant
 * of an absent nickname so legacy rows render exactly as before.
 */
export function folderDisplayName(folder: {
  name: string;
  nickname?: string;
}): string {
  const nick = folder.nickname?.trim();
  return nick ? nick : folder.name;
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
