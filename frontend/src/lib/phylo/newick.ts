// Minimal Newick helpers (phylo Phase 0).
//
// Phase 0 only needs a robust TIP COUNT for the library list. The full
// Newick / Nexus parser that produces a tree object for layout is the Tree
// Studio's job (Phase 2) and will live alongside this file. Keeping the counter
// standalone and SSR-safe means phyloApi can compute tip_count on import without
// pulling in the renderer.

/** Extract the first Newick expression (from the first "(" to its ";" or end). */
function extractNewick(text: string): string {
  const start = text.indexOf("(");
  if (start === -1) return "";
  const end = text.indexOf(";", start);
  return end === -1 ? text.slice(start) : text.slice(start, end + 1);
}

/**
 * Count the tips (leaves) in a Newick string. A leaf is a child position (the
 * char right after "(" or ",") whose next non-space char is not "(". This holds
 * for bifurcating and multifurcating trees and for unnamed leaves. Returns 0 for
 * input with no parsed tree.
 */
export function countNewickTips(text: string): number {
  const nwk = extractNewick(text);
  if (!nwk) return 0;
  let count = 0;
  for (let i = 0; i < nwk.length; i++) {
    const c = nwk[i];
    if (c === "(" || c === ",") {
      // First non-space char after the child opener.
      let j = i + 1;
      while (j < nwk.length && /\s/.test(nwk[j])) j++;
      if (j < nwk.length && nwk[j] !== "(") count++;
    }
  }
  return count;
}
