// BeakerBot cross-page routing hint (ai perception bot, 2026-06-11).
//
// Live perception (read_page) is the primary way BeakerBot finds an element, but
// perception only sees the page the user is ON. When the thing the user wants
// lives on a DIFFERENT page, BeakerBot needs to know WHICH page to navigate to
// before it can read and spotlight there. That is the one job left for the old
// UI-anchor manifest, a routing hint that maps a free-text request to the most
// likely page.
//
// So the manifest is DEMOTED, from "the catalog of every clickable element" to
// "a small map of which page a feature lives on". The element-level selection is
// gone (perception does that now), only the page-level routing knowledge survives,
// which is exactly the part that stays stable as the UI moves buttons around.
//
// The scoring is the same deterministic token overlap the old find_ui_element
// used, reduced to return a page rather than an element id. Pure, so it unit-tests
// against the manifest with no DOM and no network.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { UI_ANCHORS, type UiAnchor } from "./ui-anchors.generated";

// A short synonym map so common user words reach the vocabulary the labels use,
// "make"/"add" find "new", "graph" finds "chart", and so on. Carried over from
// the old element search, it works just as well for page routing.
const SYNONYMS: Record<string, string[]> = {
  make: ["new", "create", "add"],
  create: ["new", "add"],
  add: ["new", "create"],
  new: ["create", "add"],
  experiment: ["experiments", "workbench"],
  graph: ["chart"],
  plot: ["chart"],
  stats: ["data"],
  buy: ["purchases", "purchase", "order"],
  order: ["purchases", "purchase"],
  protocol: ["methods", "method"],
  recipe: ["methods", "method"],
  setting: ["settings"],
  task: ["gantt", "timeline"],
  schedule: ["gantt", "timeline", "calendar"],
  note: ["notes", "workbench"],
};

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function expandToken(token: string): string[] {
  return [token, ...(SYNONYMS[token] ?? [])];
}

// Score one anchor against the tokenized query, same weighting as before. Higher
// is better, 0 means no overlap. Pure.
function scoreAnchor(anchor: UiAnchor, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const labelTokens = new Set(tokenize(anchor.label));
  const idTokens = new Set(tokenize(anchor.id));
  const haystack = `${anchor.label} ${anchor.id}`.toLowerCase();

  let score = 0;
  for (const raw of queryTokens) {
    let best = 0;
    for (const v of expandToken(raw)) {
      if (labelTokens.has(v)) best = Math.max(best, 3);
      else if (idTokens.has(v)) best = Math.max(best, 2);
      else if (v.length >= 3 && haystack.includes(v)) best = Math.max(best, 1);
    }
    score += best;
  }
  return score;
}

// Supplemental page hints for routes that do not yet carry generated
// data-tour-target anchors (the manifest's source). Phylogenetics is the newest
// tab and has none yet, so these synthetic anchors let go_to_page route a
// tree-building request to /phylo until that page grows its own tour anchors.
// Same UiAnchor shape, merged into the default scoring set below.
export const SUPPLEMENTAL_ANCHORS: UiAnchor[] = [
  // Labels carry both the singular and plural forms (phylogenetic / phylogenetics
  // / phylogeny) plus tree, so a query token matches a label token exactly rather
  // than only as a weak substring.
  { id: "phylo-tree-builder", label: "Phylogenetic phylogenetics phylogeny tree builder (Phylogenetics)", page: "/phylo" },
  { id: "phylo-tree-studio", label: "Phylogenetic phylogenetics tree figure studio styling (Phylogenetics)", page: "/phylo" },
  { id: "phylo-tree-newick", label: "Phylogenetic phylogenetics tree from sequences Newick (Phylogenetics)", page: "/phylo" },
];

export type PageHint = {
  // The route to navigate to.
  page: string;
  // A confidence-ish total, summed from the best-matching anchors on that page.
  // Only used for ranking, not surfaced to the model.
  score: number;
};

/** Resolve a free-text request to the page (or pages) most likely to host it.
 *  Aggregates anchor scores by page so a page with several relevant controls
 *  outranks one with a single weak hit. Pure, returns ranked pages best-first,
 *  empty when nothing matches. The model uses the top page as a navigation hint,
 *  then perceives the page to find the actual element. */
export function resolvePageHints(
  query: string,
  anchors: UiAnchor[] = [...UI_ANCHORS, ...SUPPLEMENTAL_ANCHORS],
  limit = 3,
): PageHint[] {
  const seen = new Set<string>();
  const tokens = tokenize(query)
    .flatMap(expandToken)
    .filter((t) => (seen.has(t) ? false : (seen.add(t), true)));

  const byPage = new Map<string, number>();
  for (const anchor of anchors) {
    const score = scoreAnchor(anchor, tokens);
    if (score <= 0) continue;
    byPage.set(anchor.page, (byPage.get(anchor.page) ?? 0) + score);
  }

  return Array.from(byPage.entries())
    .map(([page, score]) => ({ page, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
