// BeakerBot search_literature tool (BeakerAI lane, 2026-06-12).
//
// Lets BeakerBot find published papers so it can cite them or pull references
// into a note. It calls europePmcPapers from chemistry/literature.ts (a network
// read of Europe PMC, a public bibliographic database) and returns a COMPACT list
// the model can relay, title, first author, year, DOI (or the Europe PMC url when
// no DOI), and whether the paper is a review.
//
// THE LANE RULE: this tool only relays what Europe PMC returns. It never invents
// a paper, a DOI, or an author, and it never writes anything. It is READ-ONLY
// with respect to the user's data (no action flag), so the agent loop runs it
// immediately like the other read tools (search_my_work, search_pubchem), with no
// approval gate. If the model wants to save a found paper into a note, that is a
// separate write_note call the user approves.
//
// Europe PMC has no server-side reviews filter on this endpoint, europePmcPapers
// takes only (query, pageSize). Each returned Paper does carry an isReview flag
// (derived from pubTypeList.pubType), so a reviewsOnly request is honored by
// filtering the returned papers on isReview here, not by a backend option.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { europePmcPapers, type Paper } from "@/lib/chemistry/literature";
import type { AiTool } from "./types";

// The default and the cap on how many papers we relay to the model. Kept small so
// the context window stays manageable, the same spirit as search_my_work's limit.
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

/** One paper in the compact list handed back to the model. Only the fields the
 *  model needs to cite or relay a paper, never the full Europe PMC record. */
export type LiteratureHit = {
  title: string;
  /** First author with "et al" appended when there is more than one author. */
  authors: string;
  year: string;
  /** The DOI when Europe PMC has one, otherwise an empty string. */
  doi: string;
  /** The Europe PMC article page url, always present, used when there is no DOI. */
  url: string;
  isReview: boolean;
};

/** The tool's return shape. `count` is how many hits we relay (after the limit
 *  and any reviews-only filter), `message` is a short human note for the empty or
 *  error path so the model has something to say without a hit list. */
export type SearchLiteratureResult = {
  count: number;
  hits: LiteratureHit[];
  message?: string;
};

/** Shorten Europe PMC's full author string to "First Author et al" when there is
 *  more than one author. authorString is a comma-separated list like
 *  "Smith J, Doe A, Roe B". A single author is returned as-is. */
export function firstAuthorEtAl(authorString: string): string {
  const trimmed = authorString.trim();
  if (!trimmed) return "";
  const first = trimmed.split(",")[0].trim();
  const hasMore = trimmed.includes(",");
  return hasMore ? `${first} et al` : first;
}

/** Map a Europe PMC Paper to the compact LiteratureHit the model relays. */
export function paperToHit(p: Paper): LiteratureHit {
  return {
    title: p.title,
    authors: firstAuthorEtAl(p.authors),
    year: p.year,
    doi: p.doi,
    url: p.url,
    isReview: p.isReview,
  };
}

/** Parse the model's raw args into a typed query / limit / reviewsOnly. Defaults
 *  the limit, caps it, and treats a missing or non-positive limit as the default. */
export function parseSearchLiteratureArgs(args: Record<string, unknown>): {
  query: string;
  limit: number;
  reviewsOnly: boolean;
} {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const rawLimit = typeof args.limit === "number" && args.limit > 0 ? args.limit : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, Math.floor(rawLimit)), MAX_LIMIT);
  const reviewsOnly = args.reviewsOnly === true;
  return { query, limit, reviewsOnly };
}

export const searchLiteratureTool: AiTool = {
  name: "search_literature",
  description:
    "Find published papers in the literature via Europe PMC, a public bibliographic database. " +
    "Call this when the user asks you to find papers, look up the literature, or get references or citations on a topic (for example \"find papers on CRISPR base editing\", \"what's been published on Tm prediction\", \"get me some references for green fluorescent protein\"). " +
    "It returns up to your limit of matching papers, each with a title, the first author, the year, and a DOI (or a Europe PMC link when the paper has no DOI), plus whether the paper is a review. " +
    "Pass reviewsOnly true when the user specifically wants review articles. " +
    "You must only cite what this tool returns. Never invent a paper, a DOI, an author, or a year, and never present a citation this tool did not give you. A made-up reference is worse than no answer. " +
    "After it returns, list the few most relevant papers with their DOIs, and offer to add them to one of the user's notes (you write them with write_note, this tool never writes anything). " +
    "If the search returns nothing or the network fails, say so plainly and offer to try different terms. Read-only.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "The search terms, in the user's own words or a focused topic phrase. For example: \"CRISPR base editing\", \"green fluorescent protein folding\", \"qPCR melting temperature prediction\".",
      },
      limit: {
        type: "number",
        description:
          "Maximum number of papers to return. Defaults to 8, capped at 20. Use a smaller number for a tight list, a larger one for a broader scan.",
      },
      reviewsOnly: {
        type: "boolean",
        description:
          "Set true to return only review articles. Omit or set false to include all article types.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args): Promise<SearchLiteratureResult> => {
    const { query, limit, reviewsOnly } = parseSearchLiteratureArgs(args);
    if (!query) {
      return { count: 0, hits: [], message: "No search terms were given." };
    }
    try {
      // Pull a slightly larger page when filtering to reviews, so a reviews-only
      // request still has a chance to fill the limit after the client-side filter.
      const pageSize = reviewsOnly ? Math.min(limit * 3, MAX_LIMIT * 3) : limit;
      const { papers } = await europePmcPapers(query, pageSize);
      const filtered = reviewsOnly ? papers.filter((p) => p.isReview) : papers;
      const hits = filtered.slice(0, limit).map(paperToHit);
      if (hits.length === 0) {
        return {
          count: 0,
          hits: [],
          message: reviewsOnly
            ? "No review articles matched that search on Europe PMC."
            : "No papers matched that search on Europe PMC.",
        };
      }
      return { count: hits.length, hits };
    } catch {
      // Never throw into the agent loop. Relay a clean empty result the model can
      // explain to the user.
      return {
        count: 0,
        hits: [],
        message: "Could not reach Europe PMC just now. The search may be temporarily unavailable.",
      };
    }
  },
};
