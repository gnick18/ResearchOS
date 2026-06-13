// BeakerBot note-writing tools (ai write-note bot, 2026-06-11).
//
// The marquee coworker-mode WRITE. BeakerBot can DRAFT note content for the user,
// summarize today's results, flesh out a stub, draft a methods section, and write
// it into one of their notes. But unlike run_datahub_analysis / make_datahub_graph,
// which run straight away, writing the user's actual note prose is sensitive, so
// this write IS gated. The gate's approval is a DRAFT PREVIEW, the proposed note
// text shown to the user with Approve or Reject. Only on Approve does the tool
// write. Version-control undo (the Loro notes store's native history) sits behind
// it, so an approved write is always reversible.
//
// Two tools.
//   - list_notes (READ-only): the user's notes as a compact [{ id, title, snippet }]
//     list, so the model can find the note to append to. Graceful empty list.
//   - write_note (ACTION, GATED): create a new note, or append a drafted section to
//     an existing one. Its describeAction returns a `draft` payload, so the agent
//     loop raises a "draft" approval (the content preview) rather than a one-line
//     confirm. isDestructive is false, create and append are non-destructive and
//     version-controlled. execute (only after Approve) writes through the REAL
//     notes API, notesApi.create for a new note (one entry holds the body), or
//     notesApi.addEntry for an append. We never invent a write path and never touch
//     the notes store itself.
//
// The model NEVER fabricates the user's data. The drafted content must summarize
// only what the tools or the conversation actually provided. That rule lives in the
// system prompt, here we just carry the model's drafted markdown to the preview and,
// on approval, to the note.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { notesApi } from "@/lib/local-api";
import type { Note } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam (so the tools unit-test with no folder and no Loro store).
// ---------------------------------------------------------------------------

/**
 * The notes-layer reads and writes the tools depend on, injected so a test can
 * stub them without a real folder. Production wires the real notesApi. We only
 * ever go through the public notesApi (list / create / addEntry), never the store.
 */
export type WriteNoteDeps = {
  /** List the user's notes (metadata + entries). */
  listNotes: () => Promise<Note[]>;
  /** Create a new note whose single entry carries the drafted body. Returns it. */
  createNote: (data: {
    title: string;
    entryTitle: string;
    date: string;
    content: string;
  }) => Promise<Note>;
  /** Append a new entry (the drafted section) to an existing note. Returns the
   *  updated note, or null when the id does not resolve. */
  appendEntry: (
    noteId: number,
    data: { title: string; date: string; content: string },
  ) => Promise<Note | null>;
};

/** Today as YYYY-MM-DD in the user's local timezone, matching the date strings
 *  note entries store. Injectable for deterministic tests. */
export function localTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const writeNoteDeps: WriteNoteDeps = {
  listNotes: () => notesApi.list(),
  createNote: async ({ title, entryTitle, date, content }) =>
    notesApi.create({
      title,
      entries: [{ title: entryTitle, date, content }],
    }),
  appendEntry: (noteId, data) => notesApi.addEntry(noteId, data),
};

// ---------------------------------------------------------------------------
// list_notes (READ-only)
// ---------------------------------------------------------------------------

/** The compact, model-friendly view of one note, so the model can find the right
 *  one to append to without seeing the full body or the sidecar machinery. */
export type NoteBrief = {
  id: number;
  title: string;
  /** A short preview of the note's most recent content, so the model can tell two
   *  similarly named notes apart. Empty when the note has no content yet. */
  snippet: string;
};

const SNIPPET_MAX = 140;

/** Build a one-line snippet from a note's entries, the most recent entry's content
 *  collapsed to a single line and clipped. Pure, so it unit-tests with mock notes.
 *  Returns "" when there is no content. */
export function noteSnippet(note: Note): string {
  const entries = note.entries ?? [];
  // Walk from the last entry back to the first non-empty content.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const raw = (entries[i]?.content ?? "").trim();
    if (raw.length === 0) continue;
    const oneLine = raw.replace(/\s+/g, " ").trim();
    return oneLine.length > SNIPPET_MAX
      ? `${oneLine.slice(0, SNIPPET_MAX).trimEnd()}...`
      : oneLine;
  }
  return "";
}

/** Shape the raw notes into the model-facing list. Pure. */
export function shapeNotes(notes: Note[]): {
  count: number;
  notes: NoteBrief[];
} {
  const briefs = notes.map((n) => ({
    id: n.id,
    title: n.title,
    snippet: noteSnippet(n),
  }));
  return { count: briefs.length, notes: briefs };
}

export const listNotesTool: AiTool = {
  name: "list_notes",
  description:
    "List the user's notes from their ResearchOS folder. Returns each note's id, title, and a short snippet of its latest content. Call this when the user asks you to add to, append to, or write into an EXISTING note, so you can find the right note id by matching their words (for example \"my qPCR optimization note\") to a real note. Returns an empty list when the user has no notes. Read-only, it does not write anything.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async () => {
    const notes = await writeNoteDeps.listNotes();
    return shapeNotes(notes);
  },
};

// ---------------------------------------------------------------------------
// write_note (ACTION, GATED by a draft preview)
// ---------------------------------------------------------------------------

/** The model-supplied arguments, before parsing. */
export type WriteNoteArgs = {
  /** "new" to create a note, or the numeric id (as a string or number) of an
   *  existing note to append to. */
  target: string;
  /** The note title for a new note, or the heading of the appended section. */
  title?: string;
  /** The drafted markdown content to write. Required. */
  content: string;
  /** Whether this CREATES a new note or APPENDS to an existing one. */
  mode: "create" | "append";
};

export type ParsedWriteNote = {
  target: string;
  title: string;
  content: string;
  mode: "create" | "append";
  /** The resolved numeric note id for an append, or null for a create / bad id. */
  noteId: number | null;
};

/** Parse and normalize the loose tool args. Derives the mode from `target` when it
 *  is not given explicitly ("new" means create, anything else means append), so a
 *  model that omits the redundant flag still does the right thing. Pure. */
export function parseWriteNoteArgs(
  args: Record<string, unknown>,
): ParsedWriteNote {
  const rawTarget =
    typeof args.target === "string"
      ? args.target.trim()
      : typeof args.target === "number"
        ? String(args.target)
        : "";
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const content = typeof args.content === "string" ? args.content : "";

  const isNew = rawTarget === "" || rawTarget.toLowerCase() === "new";
  const explicitMode =
    args.mode === "create" || args.mode === "append" ? args.mode : null;
  const mode: "create" | "append" =
    explicitMode ?? (isNew ? "create" : "append");

  // Resolve the numeric id for an append. "new" / empty / non-numeric -> null.
  const parsedId = isNew ? NaN : Number(rawTarget);
  const noteId =
    !isNew && Number.isFinite(parsedId) && Number.isInteger(parsedId)
      ? parsedId
      : null;

  return { target: rawTarget, title, content, mode, noteId };
}

const DEFAULT_NEW_TITLE = "Untitled note";
const DEFAULT_ENTRY_TITLE = "Summary";

/** The compact, model-friendly result of a write. */
export type WriteNoteResult =
  | {
      ok: true;
      noteId: number;
      title: string;
      mode: "create" | "append";
    }
  | { ok: false; error: string };

export const writeNoteTool: AiTool = {
  name: "write_note",
  description:
    "Write DRAFTED content into one of the user's notes. Use this when the user asks you to summarize results into a note, draft a methods section, flesh out a note, or add a summary to a note. You draft the content yourself first (in markdown), then call this with it. The app shows the user your draft to Approve or Reject BEFORE anything is written, that preview IS the consent, so do NOT ask them in prose first and do NOT call propose_plan for it. Only on Approve does the note get written. Set target to \"new\" with mode \"create\" to make a new note (pass a title), or to an existing note id from list_notes with mode \"append\" to add your drafted section to it. Appending and creating are non-destructive and version-controlled, so the user can undo. Never invent the user's data, only summarize what the tools or the conversation actually gave you. After it writes, say in one short sentence what you added and where.",
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description:
          'Either "new" to create a new note, or the id of an existing note (from list_notes) to append to.',
      },
      title: {
        type: "string",
        description:
          "For a new note, its title (for example \"qPCR summary\"). For an append, a short heading for the section you are adding. Recommended.",
      },
      content: {
        type: "string",
        description:
          "The drafted note content, in markdown. This is exactly what the user reviews and what gets written on Approve. Summarize only real data the tools or the conversation provided, never fabricate.",
      },
      mode: {
        type: "string",
        description:
          'Either "create" (make a new note) or "append" (add to the existing note named by target). Defaults from target ("new" means create).',
      },
    },
    required: ["target", "content"],
    additionalProperties: false,
  },
  action: true,
  // Create and append are non-destructive (nothing is overwritten or deleted) and
  // version-controlled, so this never forces the destructive hard-stop. The draft
  // preview is the gate, that is where the user's consent lives.
  isDestructive: () => false,
  // The gate raises a DRAFT preview (the proposed content) rather than a one-line
  // confirm, because the content itself is what the user must review before it is
  // written. Returning a `draft` payload here is the signal the loop's gate reads.
  describeAction: (args) => {
    const parsed = parseWriteNoteArgs(args);
    const summary =
      parsed.mode === "create"
        ? `create a note "${parsed.title || DEFAULT_NEW_TITLE}"`
        : "add a drafted section to a note";
    return {
      summary,
      draft: {
        content: parsed.content,
        mode: parsed.mode,
        ...(parsed.title ? { title: parsed.title } : {}),
        // Canvas Save writes the user's edited markdown back into the content
        // arg execute() reads, so the saved text is what gets written.
        applyEdit: (a, edited) => {
          a.content = edited;
        },
      },
    };
  },
  execute: async (args) => {
    const parsed = parseWriteNoteArgs(args);

    if (parsed.content.trim().length === 0) {
      return {
        ok: false,
        error:
          "There was no drafted content to write. Draft the note content first, then call write_note with it.",
      } satisfies WriteNoteResult;
    }

    const today = localTodayIso();

    if (parsed.mode === "create") {
      const title = parsed.title || DEFAULT_NEW_TITLE;
      const note = await writeNoteDeps.createNote({
        title,
        entryTitle: parsed.title || DEFAULT_ENTRY_TITLE,
        date: today,
        content: parsed.content,
      });
      return {
        ok: true,
        noteId: note.id,
        title: note.title,
        mode: "create",
      } satisfies WriteNoteResult;
    }

    // Append. We need a real note id.
    if (parsed.noteId === null) {
      return {
        ok: false,
        error:
          "I could not tell which note to append to. Call list_notes to find the note id, then pass that id as target.",
      } satisfies WriteNoteResult;
    }

    const updated = await writeNoteDeps.appendEntry(parsed.noteId, {
      title: parsed.title || DEFAULT_ENTRY_TITLE,
      date: today,
      content: parsed.content,
    });
    if (!updated) {
      return {
        ok: false,
        error:
          "That note could not be found. It may have been deleted, or the id is wrong. List the notes again and try one of those.",
      } satisfies WriteNoteResult;
    }
    return {
      ok: true,
      noteId: updated.id,
      title: updated.title,
      mode: "append",
    } satisfies WriteNoteResult;
  },
};
