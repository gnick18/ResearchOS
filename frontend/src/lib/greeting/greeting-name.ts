// Pure greeting-name resolution.
//
// Two jobs, both pure + deterministic so they are directly unit-testable and can
// be shared by every surface that greets the user (the welcome-back splash,
// BeakerBot entry lines, the operator greeter):
//
//   1. firstName(displayName) -- the user's first real name, with a leading
//      honorific (Dr., Prof., Mr., ...) skipped. Display names in this app follow
//      the "Dr. Jane Researcher" convention, so the raw first word is often the
//      title; greeting someone as "Dr" reads wrong, so we step past it.
//   2. resolveGreetingName({ preferredName, displayName }) -- prefer an explicit
//      preferred / greeting name the user set ("call me Grant") and fall back to
//      the honorific-stripped first name when they have not set one.
//
// No React, no DOM, no storage. House style: no em-dashes, no emojis, no
// mid-sentence colons.

/**
 * Leading honorific tokens we skip before taking the first real name word.
 * Compared case-insensitively, with any trailing period tolerated, so both
 * "Dr" and "Dr." match. Kept deliberately small (the common academic + courtesy
 * titles); an unrecognized first word is treated as the name, never dropped.
 */
const HONORIFICS = new Set([
  "dr",
  "prof",
  "professor",
  "mr",
  "mrs",
  "ms",
  "mx",
  "miss",
]);

/** A token is an honorific if, lowercased and stripped of a trailing dot, it is
 *  in the set above. */
function isHonorific(token: string): boolean {
  const bare = token.toLowerCase().replace(/\.$/, "");
  return HONORIFICS.has(bare);
}

/**
 * The user's first name for a greeting line. Trims, splits on whitespace, and
 * skips a single leading honorific token so "Dr. Jane Researcher" greets as
 * "Jane", not "Dr". Returns an empty string when no name is given, or when the
 * name is ONLY an honorific (nothing real to greet by).
 */
export function firstName(name?: string | null): string {
  if (!name) return "";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  // Skip at most one leading honorific. A name that is only an honorific
  // ("Dr.") leaves nothing to greet by, so we return empty (the caller then
  // greets without a name) rather than echoing the title.
  if (words.length > 1 && isHonorific(words[0])) {
    return words[1];
  }
  if (words.length === 1 && isHonorific(words[0])) {
    return "";
  }
  return words[0];
}

/**
 * The name to greet the user by. An explicit preferred / greeting name wins when
 * the user has set one (trimmed, and only when it is non-empty); otherwise we
 * fall back to the honorific-stripped first name of the display name. Returns an
 * empty string when neither yields a name, so a caller can greet generically.
 *
 * This is the single precedence rule every greeting surface shares, so "Grant"
 * (the preferred name) beats "Dr" (the first word of the display name)
 * everywhere at once.
 */
export function resolveGreetingName(opts: {
  preferredName?: string | null;
  displayName?: string | null;
}): string {
  const preferred = opts.preferredName?.trim();
  if (preferred) return preferred;
  return firstName(opts.displayName);
}
