// BeakerBot find_ui_element tool (ai spotlight bot, 2026-06-10).
//
// A READ-ONLY, pure-ish keyword search over the generated UI-anchor manifest. It
// answers "where is the thing that does X" by returning the best-matching UI
// anchors, so BeakerBot can then spotlight_ui_element the right one instead of
// only describing it in prose.
//
// The matching is a small, deterministic scorer (no fuzzy-search dependency,
// nothing leaves the device). It tokenizes the query and each anchor's label and
// id, and scores on token overlap plus substring and area hints. The scorer is a
// pure function so it unit-tests against the manifest with no DOM and no network.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { UI_ANCHORS, type UiAnchor } from "../ui-anchors.generated";
import type { AiTool } from "./types";

// The compact, model-facing candidate. Same shape as a manifest entry, kept tiny
// so the tool result stays small and the model can hand an id straight to
// spotlight_ui_element.
export type AnchorCandidate = Pick<UiAnchor, "id" | "label" | "page">;

const DEFAULT_LIMIT = 5;

// Split a string into lowercase word tokens. Used on both the query and each
// anchor's searchable text so scoring compares like with like.
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

// A small set of synonyms mapping common user words to the vocabulary the labels
// use, so "make"/"add" find "new", "graph" finds "chart", and so on. Kept short
// and obvious. Each query token expands to itself plus any synonyms.
const SYNONYMS: Record<string, string[]> = {
  make: ["new", "create", "add"],
  create: ["new", "add"],
  add: ["new", "create"],
  new: ["create", "add"],
  experiment: ["experiments", "workbench"],
  graph: ["chart"],
  buy: ["purchases", "purchase", "order"],
  order: ["purchases", "purchase"],
  protocol: ["methods", "method"],
  setting: ["settings"],
};

function expandToken(token: string): string[] {
  const extra = SYNONYMS[token] ?? [];
  return [token, ...extra];
}

/** Score one anchor against the tokenized query. Pure. Higher is better, 0 means
 *  no overlap. The weighting favors an exact word hit in the label over a loose
 *  substring, so "new task" ranks the Gantt new-task button above an unrelated
 *  anchor that merely contains "task" somewhere. */
export function scoreAnchor(anchor: UiAnchor, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const labelTokens = new Set(tokenize(anchor.label));
  const idTokens = new Set(tokenize(anchor.id));
  const haystack = `${anchor.label} ${anchor.id}`.toLowerCase();

  let score = 0;
  for (const raw of queryTokens) {
    const variants = expandToken(raw);
    let bestForToken = 0;
    for (const v of variants) {
      // Exact word hit in the label is the strongest signal.
      if (labelTokens.has(v)) bestForToken = Math.max(bestForToken, 3);
      // Word hit in the id (the kebab anchor name) is a good signal too.
      else if (idTokens.has(v)) bestForToken = Math.max(bestForToken, 2);
      // Substring hit anywhere is a weak signal (covers partial words).
      else if (v.length >= 3 && haystack.includes(v))
        bestForToken = Math.max(bestForToken, 1);
    }
    score += bestForToken;
  }
  return score;
}

/** Search the manifest for the anchors that best match a free-text query. Pure,
 *  so tests pass a fixed manifest and assert ordering. Returns up to `limit`
 *  candidates sorted best-first, dropping zero-score anchors so an unmatched
 *  query returns an empty list rather than noise. */
export function findAnchors(
  query: string,
  anchors: UiAnchor[] = UI_ANCHORS,
  limit: number = DEFAULT_LIMIT,
): AnchorCandidate[] {
  const queryTokens = tokenize(query).flatMap(expandToken);
  // De-dupe the expanded query tokens so a synonym does not double-count.
  const seen = new Set<string>();
  const uniqueTokens = queryTokens.filter((t) =>
    seen.has(t) ? false : (seen.add(t), true),
  );

  const scored = anchors
    .map((a) => ({ anchor: a, score: scoreAnchor(a, uniqueTokens) }))
    .filter((s) => s.score > 0)
    // Highest score first. Ties keep manifest order (stable sort) so output is
    // deterministic for tests.
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ anchor }) => ({
    id: anchor.id,
    label: anchor.label,
    page: anchor.page,
  }));
}

// find_ui_element, the search half of the navigate-and-spotlight pair. Read-only,
// it only searches the static manifest, touches no user data and no DOM.
export const findUiElementTool: AiTool = {
  name: "find_ui_element",
  description:
    "Search the ResearchOS interface for the UI element that does what the user is asking about, for example where to make a new task or where to add a method. Returns up to five candidate elements, each with an id, a human label, and the page it lives on. Call this when the user asks how or where to do something in the app, then call spotlight_ui_element with the best candidate's id to take them there and highlight it. Read-only.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What the user wants to do or find, in plain words, for example \"make a new task\" or \"add a purchase\".",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const query = typeof args.query === "string" ? args.query : "";
    const candidates = findAnchors(query);
    return { count: candidates.length, candidates };
  },
};
