// BeakerBot search_my_work tool (ai artifact-index bot, 2026-06-11).
//
// Layer 1: the one-front-door search BeakerBot uses to locate any artifact in
// the user's work by name. A read-only tool that calls searchMyWork from
// artifact-index.ts and returns a compact list of ArtifactBriefs. Only
// metadata (titles, ids, dates, deep links) reaches the model, never any body.
//
// WHEN the model should call this tool (from the system prompt):
// - The user refers to an artifact that is NOT described in the context line
//   and is NOT one the model just created this turn.
// - Examples: "open my CRISPR cloning note", "what's in the Tm method",
//   "find my growth-curve data", "where is that t-test from last week".
// - After calling this, the model picks the best-matching brief, calls the
//   matching Layer-2 read tool (read_note, read_method, ...) to fetch the body,
//   and uses the brief's deepLink if the user wants to navigate there or write
//   a reference.
//
// WHEN the model should NOT call this tool:
// - The context line already names the artifact (use its id directly).
// - The model just created the artifact this turn (it already has the id).
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { searchMyWork } from "@/lib/ai/artifact-index";
import { attachRecordSetIfBig, briefToRow } from "@/lib/ai/record-set";
import type { AiTool } from "./types";

export const searchMyWorkTool: AiTool = {
  name: "search_my_work",
  description:
    "Search the user's artifacts across all types (notes, experiments, methods, sequences, Data Hub tables, projects, purchases, molecules) and return a ranked list of matching briefs. " +
    "Call this when the user refers to a piece of their work by name or description and it is NOT already identified in the context line and NOT something you just created this turn. " +
    "For example: \"open my CRISPR cloning note\", \"find the Tm method\", \"where is the growth-curve table\". " +
    "Pass a types filter when the user's request clearly names one type (for example \"my notes\" or \"that method\"). " +
    "Pass since and / or until (YYYY-MM-DD) when the user scopes by time (for example \"the t-test from last week\", \"notes I edited in May\", \"experiments since June 1\"); the date window is day-granular and inclusive, and it drops artifacts with no date (most purchases). Resolve relative phrasing like \"last week\" to absolute YYYY-MM-DD dates yourself using the current date in the context line before calling. " +
    "Returns { count, results: ArtifactBrief[] } where each brief has type, id, title, subtitle, date, projectIds, deepLink, and keywords. " +
    "Once you have a brief, call the matching read tool by type and id to get the body, and use its deepLink if the user wants to navigate there or write a reference into a note. " +
    "If several briefs match and it is ambiguous which one the user means, call ask_user with the brief titles as options so the user taps the right one. " +
    "Never invent an artifact that this tool did not return. Read-only.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What the user called the artifact, in their own words. For example: \"CRISPR cloning note\", \"Tm method\", \"growth curve table\", \"fakeGFP qPCR\". An empty query returns the most-recently edited artifacts across all types.",
      },
      types: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional. Filter to one or more artifact types. Valid values: \"note\", \"experiment\", \"method\", \"sequence\", \"datahub\", \"project\", \"purchase\", \"molecule\". Omit to search all types.",
      },
      limit: {
        type: "number",
        description:
          "Maximum number of results to return. Defaults to 12. Increase for a broader scan, decrease for a tighter list.",
      },
      since: {
        type: "string",
        description:
          "Optional inclusive lower date bound as YYYY-MM-DD. Only artifacts edited or created on or after this day are returned. Resolve relative phrasing (\"last week\", \"since June\") to an absolute date yourself first.",
      },
      until: {
        type: "string",
        description:
          "Optional inclusive upper date bound as YYYY-MM-DD. Only artifacts edited or created on or before this day are returned.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const query = typeof args.query === "string" ? args.query : "";
    const types = Array.isArray(args.types)
      ? args.types.filter((t): t is string => typeof t === "string")
      : undefined;
    const limit =
      typeof args.limit === "number" && args.limit > 0
        ? Math.min(args.limit, 50)
        : undefined;
    const since =
      typeof args.since === "string" && args.since.trim() ? args.since.trim() : undefined;
    const until =
      typeof args.until === "string" && args.until.trim() ? args.until.trim() : undefined;
    const results = await searchMyWork(query, { types, limit, since, until });
    // The ranked briefs become widget rows (each keyed by its real type), gated on
    // the ">4" rule by attachRecordSetIfBig. The model-facing { count, results } is
    // unchanged; the rows ride out-of-band under _ui. This is the "find the thing
    // when you do not know it by name" front door, so the browser matters most here.
    const rows = results.map(briefToRow);
    return attachRecordSetIfBig({ count: results.length, results }, rows, {
      kind: "search_my_work",
      title: query.trim() ? `Search for "${query.trim()}"` : "Recent work",
      total: results.length,
      ...(query.trim() ? { query: query.trim() } : {}),
    });
  },
};
