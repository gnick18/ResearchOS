// BeakerBot deep note-body search (ai summary-robustness bot, 2026-06-14).
//
// The normal artifact index matches only cheap metadata (titles, headings, tags,
// descriptions), never the full BODY of a note, on purpose (cost). This tool is the
// deliberate, opt-in DEEP search: it reads every note's full text (description +
// every entry's content) and returns the notes whose body contains the query, as a
// plain substring (default) or a regular expression.
//
// THE CONFIRM SAFEGUARD (Grant 2026-06-14). A body scan is broader and slower than a
// normal search, and getting the exact search STRING right matters. So the model is
// told (system-prompt) to CONFIRM the exact query / regex with the user via ask_user
// BEFORE calling this tool, never guess the term and scan silently.
//
// Read-only. NO INTERPRETATION: it locates the user's OWN matching notes and returns
// short snippets of their own text; it never summarizes a finding or draws a
// conclusion. The caller can then read_note / summarize / write a reference.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { notesApi } from "@/lib/local-api";
import { objectDeepLink } from "@/lib/references";
import type { Note } from "@/lib/types";
import type { AiTool } from "./types";

export type SearchNoteBodiesDeps = {
  listNotes: () => Promise<Note[]>;
};

export const searchNoteBodiesDeps: SearchNoteBodiesDeps = {
  listNotes: () => notesApi.list(),
};

/** One body-search hit. */
export interface NoteBodyHit {
  id: number;
  title: string;
  deepLink: string;
  /** A short snippet of the note's own text around the first match. */
  snippet: string;
  /** Which entry the match was in, when it was an entry (vs the description). */
  entryTitle?: string;
}

/** The full searchable body text of a note: its description plus every entry's
 *  title + content, joined. Pure. */
export function noteBodyText(note: Note): string {
  const parts: string[] = [];
  if (note.description) parts.push(note.description);
  for (const e of note.entries ?? []) {
    if (e.title) parts.push(e.title);
    if (e.content) parts.push(e.content);
  }
  return parts.join("\n");
}

/** Build a compact snippet (~120 chars) centered on the match index. Pure. */
export function snippetAround(text: string, matchIndex: number, matchLen: number): string {
  const pad = 60;
  const start = Math.max(0, matchIndex - pad);
  const end = Math.min(text.length, matchIndex + matchLen + pad);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "..." : ""}${core}${end < text.length ? "..." : ""}`;
}

/** Find the first match of a query in a note's body. Returns the match index +
 *  length, or null. A regex query that fails to compile is treated as a literal
 *  substring (the caller already validated; this is belt-and-suspenders). Pure. */
export function findInBody(
  body: string,
  query: string,
  isRegex: boolean,
): { index: number; length: number } | null {
  if (!query) return null;
  if (isRegex) {
    try {
      const re = new RegExp(query, "i");
      const m = re.exec(body);
      if (m) return { index: m.index, length: m[0].length || 1 };
      return null;
    } catch {
      // Fall through to a literal search on a bad pattern.
    }
  }
  const idx = body.toLowerCase().indexOf(query.toLowerCase());
  return idx >= 0 ? { index: idx, length: query.length } : null;
}

const MAX_HITS = 25;

export const searchNoteBodiesTool: AiTool = {
  name: "search_note_bodies",
  description:
    "DEEP-search the full BODY text of the user's notes (description + every entry) for a string or a regular expression, and return the notes that match with a short snippet of each. Use this ONLY when the user wants to find notes by what is written INSIDE them (for example \"notes that mention cyp51A anywhere\", \"which notes talk about the miniprep\"), because the normal search and the summary keyword filter match only titles, headings, tags, and descriptions, NOT the deep body. This scan is broader and slower than a normal search. CONFIRM FIRST, before you call this, confirm the exact search term (or regex) with the user using ask_user, so you scan for the right string, never guess it. Read-only. Returns { count, results } where each result has id, title, deepLink, snippet, and (when the hit was in an entry) entryTitle. NO INTERPRETATION, you locate the matching notes and relay their own snippets, you never summarize a finding.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The exact text (or regex, when regex is true) to search the note bodies for. Confirm this with the user first.",
      },
      regex: {
        type: "boolean",
        description: "When true, query is treated as a case-insensitive regular expression. Default false (a plain case-insensitive substring).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return { ok: false as const, error: "A search term is required (confirm it with the user first)." };
    }
    const isRegex = args.regex === true;
    // Validate a regex up front so a bad pattern is a clean error, not a silent miss.
    if (isRegex) {
      try {
        new RegExp(query, "i");
      } catch (err) {
        return {
          ok: false as const,
          error: `That is not a valid regular expression (${err instanceof Error ? err.message : String(err)}). Confirm the pattern with the user or search as plain text instead.`,
        };
      }
    }

    let notes: Note[];
    try {
      notes = await searchNoteBodiesDeps.listNotes();
    } catch (err) {
      return { ok: false as const, error: `Could not read your notes. ${err instanceof Error ? err.message : String(err)}` };
    }

    const hits: NoteBodyHit[] = [];
    let truncated = false;
    for (const note of notes) {
      const body = noteBodyText(note);
      const found = findInBody(body, query, isRegex);
      if (!found) continue;
      if (hits.length >= MAX_HITS) {
        truncated = true;
        break;
      }
      // Which entry (if any) the match landed in, for a friendlier readout.
      const entryHit = (note.entries ?? []).find(
        (e) => findInBody(`${e.title ?? ""}\n${e.content ?? ""}`, query, isRegex) !== null,
      );
      hits.push({
        id: note.id,
        title: note.title,
        deepLink: objectDeepLink("note", note.id),
        snippet: snippetAround(body, found.index, found.length),
        ...(entryHit?.title ? { entryTitle: entryHit.title } : {}),
      });
    }

    return {
      ok: true as const,
      count: hits.length,
      truncated,
      query,
      regex: isRegex,
      results: hits,
    };
  },
};
