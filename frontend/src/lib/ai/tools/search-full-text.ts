// BeakerBot deep full-text search across object types (ai summary-robustness bot,
// 2026-06-14). Supersedes the notes-only search_note_bodies.
//
// The normal artifact index matches only cheap metadata (titles, headings, tags,
// descriptions), never the full BODY, on purpose (cost). This is the deliberate,
// opt-in DEEP search: it scans the full text of notes (description + every entry)
// AND method protocol bodies for a string or a regex, and returns the records that
// match with a short snippet of each, plus an ACCURATE total match count. Methods
// are file-backed, so their bodies are read on demand (the "stream and grep" path).
//
// THE CONFIRM SAFEGUARD (Grant 2026-06-14). A body scan is broader and slower than a
// normal search, and the exact search STRING matters. The model is told
// (system-prompt) to CONFIRM the exact query / regex with the user via ask_user
// BEFORE calling this, never guess the term and scan silently.
//
// Read-only. NO INTERPRETATION: it locates the user's OWN matching records and
// returns short snippets of their own text; it never summarizes a finding.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  fetchAllNotesIncludingShared,
  fetchAllMethodsIncludingShared,
  fetchAllTasksIncludingShared,
  fetchAllInventoryItemsIncludingShared,
  purchasesApi,
  filesApi,
} from "@/lib/local-api";
import { taskResultsBase } from "@/lib/tasks/results-paths";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { objectDeepLink, methodRefId, type ObjectRefType } from "@/lib/references";
import { countMatches, findFirst, snippetAround } from "@/lib/ai/deep-text";
import {
  attachRecordSetIfBig,
  RECORD_SET_UI_CAP,
  type RecordSetRow,
  type RecordSetRowType,
} from "@/lib/ai/record-set";
import type { Note, Method, Task, PurchaseItem, InventoryItem } from "@/lib/types";
import type { AiTool } from "./types";

export type SearchableType = "note" | "method" | "experiment" | "purchase" | "inventory";

export type SearchFullTextDeps = {
  listNotes: () => Promise<Array<Note & { owner?: string }>>;
  listMethods: () => Promise<Method[]>;
  /** Experiments to deep-search (all tasks; the tool filters to task_type
   *  "experiment"). */
  listTasks: () => Promise<Task[]>;
  listPurchases: () => Promise<PurchaseItem[]>;
  listInventoryItems: () => Promise<InventoryItem[]>;
  /** Read a method's markdown body file. Returns "" when missing/unreadable, so a
   *  single bad file never aborts the whole scan. */
  readMethodBody: (path: string) => Promise<string>;
  /** Read an experiment's results.md writeup body. "" when missing/unreadable. */
  readExperimentResults: (task: Pick<Task, "id" | "owner">) => Promise<string>;
};

export const searchFullTextDeps: SearchFullTextDeps = {
  listNotes: () => fetchAllNotesIncludingShared(),
  listMethods: () => fetchAllMethodsIncludingShared(),
  listTasks: () => fetchAllTasksIncludingShared(),
  listPurchases: async () => purchasesApi.listAllIncludingShared(await getCurrentUserCached()),
  listInventoryItems: () => fetchAllInventoryItemsIncludingShared(),
  readMethodBody: async (path) => {
    try {
      return (await filesApi.readFile(path)).content ?? "";
    } catch {
      return "";
    }
  },
  readExperimentResults: async (task) => {
    try {
      return (await filesApi.readFile(`${taskResultsBase(task)}/results.md`)).content ?? "";
    } catch {
      return "";
    }
  },
};

export interface FullTextHit {
  type: SearchableType;
  id: number;
  title: string;
  deepLink: string;
  /** A short snippet of the record's own text around the first match. */
  snippet: string;
  /** Which entry the match was in, for notes (omitted for methods). */
  entryTitle?: string;
  /** How many times the term appears in this record's body. */
  matches: number;
}

/** The full searchable body text of a note: description + every entry title +
 *  content, joined. Pure. */
export function noteBodyText(note: Note): string {
  const parts: string[] = [];
  if (note.description) parts.push(note.description);
  for (const e of note.entries ?? []) {
    if (e.title) parts.push(e.title);
    if (e.content) parts.push(e.content);
  }
  return parts.join("\n");
}

/** The full searchable body text of an experiment: name + deviation log + the
 *  results.md writeup, joined. The results body is read on demand and passed in. */
export function experimentBodyText(task: Task, resultsBody: string): string {
  const parts: string[] = [];
  if (task.name) parts.push(task.name);
  if (task.deviation_log) parts.push(task.deviation_log);
  if (resultsBody) parts.push(resultsBody);
  return parts.join("\n");
}

/** The searchable body text of a purchase: item name + the free-text notes. Pure. */
export function purchaseBodyText(item: PurchaseItem): string {
  const parts: string[] = [];
  if (item.item_name) parts.push(item.item_name);
  if (item.notes) parts.push(item.notes);
  return parts.join("\n");
}

/** The searchable body text of an inventory item: name + notes + the hazard note.
 *  Stocks carry no free text, so the item is the searchable surface. Pure. */
export function inventoryBodyText(item: InventoryItem): string {
  const parts: string[] = [];
  if (item.name) parts.push(item.name);
  if (item.notes) parts.push(item.notes);
  if (item.hazard_note) parts.push(item.hazard_note);
  return parts.join("\n");
}

const MAX_HITS = 25;
const ALL_TYPES: SearchableType[] = ["note", "method", "experiment", "purchase", "inventory"];

export const searchFullTextTool: AiTool = {
  name: "search_full_text",
  description:
    "DEEP-search the full BODY text of the user's notes, method protocols, experiment writeups (the results.md content plus the deviation log), purchase notes, AND inventory notes for a string or a regular expression, and return the records that match with a short snippet and a per-record match count, plus an accurate TOTAL count across everything searched. Use this when the user wants to find records by what is written INSIDE them (for example \"which PCR experiments mention no band\", \"notes that mention cyp51A anywhere\", \"which protocol talks about the miniprep\", \"which orders mention backordered\", \"how many records mention Sigma\"), because the normal search and the summary keyword filter match only titles, headings, tags, and descriptions, NOT the deep body. This scan is broader and slower than a normal search (method bodies are read from disk). CONFIRM FIRST, before you call this, confirm the exact search term (or regex) with the user using ask_user, so you scan for the right string, never guess it. Read-only. Returns { count, totalMatches, results } where each result has type, id, title, deepLink, snippet, matches, and (for notes) entryTitle. NO INTERPRETATION, you locate the matching records and relay their own snippets, you never summarize a finding.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The exact text (or regex, when regex is true) to search the bodies for. Confirm this with the user first.",
      },
      regex: {
        type: "boolean",
        description: "When true, query is treated as a case-insensitive regular expression. Default false (a plain case-insensitive substring).",
      },
      types: {
        type: "array",
        items: { type: "string", enum: ["note", "method", "experiment", "purchase", "inventory"] },
        description: "Which object bodies to search. Default all five. An experiment body is its results.md writeup plus its deviation log; a purchase or inventory body is its notes. Narrow to a subset when the user names a type.",
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

    const requested = Array.isArray(args.types)
      ? args.types.filter((t): t is SearchableType =>
          (["note", "method", "experiment", "purchase", "inventory"] as const).includes(t as SearchableType),
        )
      : ALL_TYPES;
    const types = requested.length > 0 ? requested : ALL_TYPES;

    const hits: FullTextHit[] = [];
    // The UI full set: EVERY matching record up to the widget cap, independent of
    // the model's MAX_HITS. The model still sees only `hits` (capped at MAX_HITS);
    // the inline record-set widget shows every match so the user can browse them.
    const uiHits: FullTextHit[] = [];
    let totalMatches = 0;
    let truncated = false;

    const pushHit = (hit: FullTextHit) => {
      totalMatches += hit.matches;
      if (hits.length < MAX_HITS) hits.push(hit);
      else truncated = true;
      if (uiHits.length < RECORD_SET_UI_CAP) uiHits.push(hit);
    };

    // Notes: bodies are already in memory.
    if (types.includes("note")) {
      let notes: Array<Note & { owner?: string }> = [];
      try {
        notes = await searchFullTextDeps.listNotes();
      } catch {
        notes = [];
      }
      for (const note of notes) {
        const body = noteBodyText(note);
        const found = findFirst(body, query, isRegex);
        if (!found) continue;
        const entryHit = (note.entries ?? []).find(
          (e) => findFirst(`${e.title ?? ""}\n${e.content ?? ""}`, query, isRegex) !== null,
        );
        pushHit({
          type: "note",
          id: note.id,
          title: note.title,
          deepLink: objectDeepLink("note", note.id),
          snippet: snippetAround(body, found.index, found.length),
          matches: countMatches(body, query, isRegex),
          ...(entryHit?.title ? { entryTitle: entryHit.title } : {}),
        });
      }
    }

    // Methods: file-backed markdown bodies, read on demand.
    if (types.includes("method")) {
      let methods: Method[] = [];
      try {
        methods = await searchFullTextDeps.listMethods();
      } catch {
        methods = [];
      }
      for (const method of methods) {
        // Only markdown-bodied methods have a searchable protocol file.
        if (!method.source_path || method.method_type === "pdf") continue;
        const body = await searchFullTextDeps.readMethodBody(method.source_path);
        if (!body) continue;
        const found = findFirst(body, query, isRegex);
        if (!found) continue;
        pushHit({
          type: "method",
          id: method.id,
          title: method.name,
          deepLink: objectDeepLink("method" as ObjectRefType, methodRefId(method.id, !!method.is_public)),
          snippet: snippetAround(body, found.index, found.length),
          matches: countMatches(body, query, isRegex),
        });
      }
    }

    // Experiments: the results.md writeup is file-backed (read on demand), the
    // deviation log is in memory. Together they are the experiment's written
    // content, the body the AI page promises Beaker can read.
    if (types.includes("experiment")) {
      let tasks: Task[] = [];
      try {
        tasks = await searchFullTextDeps.listTasks();
      } catch {
        tasks = [];
      }
      for (const task of tasks) {
        if (task.task_type !== "experiment") continue;
        const resultsBody = await searchFullTextDeps.readExperimentResults(task);
        const body = experimentBodyText(task, resultsBody);
        if (!body) continue;
        const found = findFirst(body, query, isRegex);
        if (!found) continue;
        pushHit({
          type: "experiment",
          id: task.id,
          title: task.name || "Untitled experiment",
          deepLink: objectDeepLink("experiment" as ObjectRefType, task.id),
          snippet: snippetAround(body, found.index, found.length),
          matches: countMatches(body, query, isRegex),
        });
      }
    }

    // Purchases: the free-text notes (item name + notes) are in memory.
    if (types.includes("purchase")) {
      let purchases: PurchaseItem[] = [];
      try {
        purchases = await searchFullTextDeps.listPurchases();
      } catch {
        purchases = [];
      }
      for (const item of purchases) {
        const body = purchaseBodyText(item);
        if (!body) continue;
        const found = findFirst(body, query, isRegex);
        if (!found) continue;
        pushHit({
          type: "purchase",
          id: item.id,
          title: item.item_name || "Untitled purchase",
          deepLink: "/purchases",
          snippet: snippetAround(body, found.index, found.length),
          matches: countMatches(body, query, isRegex),
        });
      }
    }

    // Inventory items: the name + notes + hazard note are in memory.
    if (types.includes("inventory")) {
      let items: InventoryItem[] = [];
      try {
        items = await searchFullTextDeps.listInventoryItems();
      } catch {
        items = [];
      }
      for (const item of items) {
        const body = inventoryBodyText(item);
        if (!body) continue;
        const found = findFirst(body, query, isRegex);
        if (!found) continue;
        pushHit({
          type: "inventory",
          id: item.id,
          title: item.name || "Untitled item",
          deepLink: "/inventory",
          snippet: snippetAround(body, found.index, found.length),
          matches: countMatches(body, query, isRegex),
        });
      }
    }

    // One widget row per matching RECORD (not per occurrence). attachRecordSetIfBig
    // gates the widget on the ">4" rule: 4 or fewer matching records stay as inline
    // chips, 5 or more render the master-detail browser.
    const rows = uiHits.map(
      (hit): RecordSetRow => ({
        type: hit.type as RecordSetRowType,
        id: String(hit.id),
        title: hit.title,
        ...(hit.entryTitle ? { subtitle: hit.entryTitle } : {}),
        snippet: hit.snippet,
        meta: `${hit.matches} ${hit.matches === 1 ? "match" : "matches"}`,
      }),
    );

    return attachRecordSetIfBig(
      {
        ok: true as const,
        count: hits.length,
        totalMatches,
        truncated,
        query,
        regex: isRegex,
        types,
        results: hits,
      },
      rows,
      {
        kind: "search_full_text",
        // total is the number of matching RECORDS the widget can show (rows length),
        // not the totalMatches occurrence count.
        title: `Matches for "${query}"`,
        total: rows.length,
        query,
      },
    );
  },
};
