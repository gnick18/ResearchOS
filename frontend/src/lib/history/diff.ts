// Version Control Phase 0: thin wrapper over jsdiff for the delta store.
//
// VERSION-LOCK: this module depends on the EXACT on-disk patch format produced
// by diff@9.0.0. The history file format is persistent across app upgrades, so
// a jsdiff bump could break applyPatch on old rows. See
// docs/proposals/VERSION_CONTROL_R4_PREP.md sections 1f / FU6 before bumping.
//
// Do NOT add @types/diff: jsdiff v9 ships its own types upstream (R4-prep 1d).
// Adding the DefinitelyTyped stub would shadow the real types.

import {
  createTwoFilesPatch,
  applyPatch,
  reversePatch,
  parsePatch,
} from "diff";

// Stable filename labels embedded in the unified-diff header. They are
// cosmetic (the patch applies regardless), but fixing them keeps deltas
// byte-stable across runs so post_hash round-trips are deterministic.
const OLD_LABEL = "a";
const NEW_LABEL = "b";

/**
 * Compute the forward delta from `prevCanonical` to `nextCanonical` as a
 * jsdiff unified-diff string. Pure.
 */
export function computeDelta(prevCanonical: string, nextCanonical: string): string {
  return createTwoFilesPatch(
    OLD_LABEL,
    NEW_LABEL,
    prevCanonical,
    nextCanonical,
    "",
    "",
  );
}

/**
 * Apply a forward delta to a canonical state string. Returns the resulting
 * canonical string, or `null` if the patch does not apply (corruption). jsdiff
 * returns `false` on failure; we normalize that to `null` so callers can
 * `if (next === null)` without conflating it with an empty-string result.
 */
export function applyDelta(prevCanonical: string, delta: string): string | null {
  const result = applyPatch(prevCanonical, delta);
  return result === false ? null : result;
}

/**
 * Apply a delta IN REVERSE: given the POST-state canonical string and the
 * forward delta that produced it, return the PRE-state canonical string. The
 * reverse-apply primitive for revert (PROPOSAL.md 3l). Returns `null` on
 * corruption.
 */
export function applyReverseDelta(
  nextCanonical: string,
  delta: string,
): string | null {
  // jsdiff v9 `reversePatch` operates on a STRUCTURED patch, not the raw
  // unified-diff string, so we parse first. `parsePatch` returns an array of
  // structured patches (one per file header); our deltas always contain a
  // single file, so we reverse + apply that one. A malformed delta surfaces
  // as an empty/odd parse, which applyPatch rejects (returns false).
  const parsed = parsePatch(delta);
  if (parsed.length === 0) return null;
  const reversed = reversePatch(parsed[0]);
  const result = applyPatch(nextCanonical, reversed);
  return result === false ? null : result;
}
