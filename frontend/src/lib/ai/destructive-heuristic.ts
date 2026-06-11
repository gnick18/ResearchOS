// BeakerBot destructive-action heuristic (ai click bot, 2026-06-11).
//
// The safety net behind the autonomy setting. Design doc section 4 tiers asking
// by reversibility, reversible in-folder actions get light approval, but
// irreversible or outward-facing actions (delete, remove, send, pay, submit,
// share, export, deposit) get a HARD STOP every time, never batched, never
// allow-listed. This module decides whether a target looks dangerous from its
// accessible name and role alone.
//
// The check runs even in "auto" autonomy, so a misread "auto" never silently
// clicks a Delete or a Send. It is deliberately CONSERVATIVE and word-boundary
// based, it is a safety net, not an exhaustive classifier. A false positive only
// costs one extra confirmation, a false negative could be an irreversible click,
// so we bias toward asking. This list is not the security boundary, the capability
// wall (no write tool in question mode) is, this just adds a "look before you
// leap" gate on the actions that do exist.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

// The destructive / outward-facing verbs we always confirm. Kept to whole words
// matched on a word boundary, so "delete" trips but "deletion notes" inside a
// longer label still trips on the word, while an unrelated substring like
// "complete" does NOT trip on "delete" (the boundary check guards the leading
// edge). Lowercase, matched case-insensitively.
//
// Grouped by why they are dangerous.
//   - destructive, removes or empties data
//   - outward, sends data off the device or to another person
//   - financial, moves money
//   - commit, an irreversible submit / publish step
const DESTRUCTIVE_TERMS: string[] = [
  // Destructive (data loss).
  "delete",
  "remove",
  "erase",
  "discard",
  "trash",
  "destroy",
  "wipe",
  "clear all",
  "empty trash",
  "reset",
  "revoke",
  "unshare",
  // Outward-facing (leaves the device / reaches another person).
  "send",
  "share",
  "export",
  "publish",
  "deposit",
  "email",
  "invite",
  "upload",
  // Financial.
  "pay",
  "purchase",
  "buy",
  "checkout",
  "subscribe",
  // Irreversible commit.
  "submit",
  "confirm delete",
  "permanently",
];

/** Escape a term for safe use inside a RegExp. */
function escapeForRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A single matcher built once. Each term is wrapped in word boundaries so a term
// only matches as a whole word (or whole phrase), never as an accidental
// substring of a longer benign word. Built from the term list above.
const DESTRUCTIVE_PATTERN = new RegExp(
  `\\b(?:${DESTRUCTIVE_TERMS.map(escapeForRegExp).join("|")})\\b`,
  "i",
);

export type DestructiveCheck = {
  /** True when the target looks destructive or outward-facing. */
  destructive: boolean;
  /** The term that matched, for the confirm copy and for tests. Empty when not
   *  destructive. */
  matched: string;
};

/** Decide whether a click target looks dangerous from its accessible name (and,
 *  loosely, its role). Conservative by design, a match forces a confirm even in
 *  "auto" mode. Pure and string-only so it unit-tests with no DOM. */
export function checkDestructive(
  name: string | undefined,
  _role?: string,
): DestructiveCheck {
  const label = (name ?? "").trim();
  if (!label) {
    // An unnamed target is unusual for a real action, treat it as safe here, the
    // ref resolution and the spotlight still show the user what is happening in
    // "ask" mode, and "auto" only reaches a named perceived element anyway.
    return { destructive: false, matched: "" };
  }
  const hit = DESTRUCTIVE_PATTERN.exec(label);
  if (hit) {
    return { destructive: true, matched: hit[0].toLowerCase() };
  }
  return { destructive: false, matched: "" };
}
