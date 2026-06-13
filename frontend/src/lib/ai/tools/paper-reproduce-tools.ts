// BeakerBot PDF-reproduce tools: Outputs 1 and 2 (BeakerAI lane, 2026-06-13).
//
// spec: docs/proposals/beakerbot-pdf-reproduce-analysis.md
//
// Two gated write tools that operate on already-extracted paper text. PDF
// ingestion and the chat attachment UI are handled by a separate sequential
// task; these tools receive the paper text as a plain string argument.
//
//   draft_paper_summary  (Output 1)
//     Produces a faithful STRUCTURAL summary of the paper (what was studied,
//     what was done, what they report) and drafts it into a note via the same
//     draft/approval path as write_note. The summary states what the paper
//     SAYS, never what it means. No findings, no judgment, no interpretation.
//
//   extract_paper_method  (Output 2)
//     Pulls the methods section text VERBATIM into a method-catalog draft
//     (method_type: "markdown"). Numbers are quoted verbatim from the source.
//     Every drafted value is accompanied by the exact source passage it was
//     pulled from so the user can verify against the paper before approving.
//
// HARD RULE (scope wall from the spec, the no-interpretation rule):
// BeakerBot may TRANSCRIBE and OPERATE only. It may NOT judge, rank,
// conclude, recommend, or hypothesize about the paper's content. The factual
// side-by-side comparison carve-out (Output 3 / compare step) is NOT part
// of these tools. Do not add any comparison, evaluation, or recommendation
// here.
//
// Both tools are gated writes: action: true, isDestructive: false, with a
// describeAction draft preview (same consent pattern as write_note). The gate
// raises a "draft" approval so the user reviews the proposed text before
// anything is written.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { notesApi, methodsApi, filesApi } from "@/lib/local-api";
import type { Note, Method } from "@/lib/types";
import { localTodayIso } from "./write-note";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable deps seam (so these tools unit-test with no folder).
// ---------------------------------------------------------------------------

/**
 * The reads and writes both tools depend on, injected so a test can stub them
 * without a real folder or a real FSA store. Production wires the real APIs.
 */
export type PaperReproduceDeps = {
  /** Create a new note whose first entry carries the summary draft. Returns it. */
  createNote: (data: {
    title: string;
    entryTitle: string;
    date: string;
    content: string;
  }) => Promise<Note>;
  /**
   * Write a file (the method markdown body) to the user's folder.
   * Returns the written path and a sha.
   */
  writeFile: (
    path: string,
    content: string,
    message?: string,
  ) => Promise<{ path: string; sha: string }>;
  /** Create a new method record pointing at the already-written file path. */
  createMethod: (data: {
    name: string;
    source_path: string;
    method_type: "markdown";
    tags?: string[];
  }) => Promise<Method>;
};

export const paperReproduceDeps: PaperReproduceDeps = {
  createNote: async ({ title, entryTitle, date, content }) =>
    notesApi.create({
      title,
      entries: [{ title: entryTitle, date, content }],
    }),
  writeFile: (path, content, message) =>
    filesApi.writeFile(path, content, message),
  createMethod: async ({ name, source_path, method_type, tags }) =>
    methodsApi.create({ name, source_path, method_type, tags }),
};

// ---------------------------------------------------------------------------
// Helpers: source-passage attachment and slug generation.
// ---------------------------------------------------------------------------

/**
 * Produce a URL-safe slug from a title string (lowercase, no special chars,
 * hyphens for spaces, capped at 40 chars). Used to build the method file path.
 * Pure, so tests can call it directly.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40)
    .replace(/^-|-$/g, "");
}

/**
 * Wrap a source passage in a clearly-labelled block that the user can scan
 * against the paper. Included in the method draft so every claimed value has
 * an in-document citation. Pure, deterministic.
 */
export function formatSourcePassage(passage: string): string {
  const trimmed = passage.trim();
  if (!trimmed) return "";
  return `\n\n---\n**Source passage (verify against paper):**\n\n> ${trimmed.replace(/\n/g, "\n> ")}\n---`;
}

// ---------------------------------------------------------------------------
// draft_paper_summary (Output 1)
// ---------------------------------------------------------------------------

export type DraftPaperSummaryArgs = {
  /** The full extracted text of the paper, as returned by the PDF ingestion step. */
  paperText: string;
  /** The title for the new note (for example "Smith et al. 2023 summary"). */
  noteTitle?: string;
  /**
   * The summary content the model drafted (structural: what was studied, what
   * they did, what they report). Required. Must state only what the paper says,
   * never evaluate or interpret it.
   */
  draftContent: string;
};

export type DraftPaperSummaryResult =
  | { ok: true; noteId: number; title: string }
  | { ok: false; error: string };

const DEFAULT_SUMMARY_NOTE_TITLE = "Paper summary";
const DEFAULT_SUMMARY_ENTRY_TITLE = "Summary";

export const draftPaperSummaryTool: AiTool = {
  name: "draft_paper_summary",
  description:
    "Draft a faithful STRUCTURAL summary of a published paper into a new note. Call this after the paper text has been extracted from a PDF. " +
    "Your draftContent must state ONLY what the paper says (what was studied, what they did, what they report). " +
    "NEVER include your own interpretation, judgment, recommendation, or hypothesis about the paper's findings. " +
    "NEVER invent content that is not in the paperText. You are a transcriber, not an analyst. " +
    "The draft is shown to the user with Approve or Reject BEFORE anything is written, that preview IS the consent. " +
    "Do NOT ask the user for confirmation in prose before calling this. " +
    "On Approve the summary is saved as a new note. After it writes, say in one short sentence what was saved.",
  parameters: {
    type: "object",
    properties: {
      paperText: {
        type: "string",
        description:
          "The full extracted text of the paper. Provide the full text so the draft can be grounded in it.",
      },
      noteTitle: {
        type: "string",
        description:
          'The title for the new note (for example "Smith et al. 2023: CYP51A in azole resistance"). Recommended.',
      },
      draftContent: {
        type: "string",
        description:
          "Your drafted structural summary of the paper, in markdown. State only what the paper says: what was studied, what the authors did, what they report. No interpretation, no judgment, no recommendations. Everything here must be grounded in the paperText argument.",
      },
    },
    required: ["paperText", "draftContent"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const rawTitle =
      typeof args.noteTitle === "string" ? args.noteTitle.trim() : "";
    const title = rawTitle || DEFAULT_SUMMARY_NOTE_TITLE;
    const content =
      typeof args.draftContent === "string" ? args.draftContent : "";
    return {
      summary: `create a summary note "${title}"`,
      draft: {
        content,
        mode: "create",
        title,
      },
    };
  },
  execute: async (args) => {
    const paperText =
      typeof args.paperText === "string" ? args.paperText : "";
    const rawTitle =
      typeof args.noteTitle === "string" ? args.noteTitle.trim() : "";
    const content =
      typeof args.draftContent === "string" ? args.draftContent.trim() : "";

    if (!paperText.trim()) {
      return {
        ok: false,
        error:
          "No paper text was provided. Extract the paper text first, then call draft_paper_summary with it.",
      } satisfies DraftPaperSummaryResult;
    }

    if (!content) {
      return {
        ok: false,
        error:
          "No draft content was provided. Draft the structural summary first, then call this with it.",
      } satisfies DraftPaperSummaryResult;
    }

    const title = rawTitle || DEFAULT_SUMMARY_NOTE_TITLE;
    const today = localTodayIso();

    const note = await paperReproduceDeps.createNote({
      title,
      entryTitle: rawTitle || DEFAULT_SUMMARY_ENTRY_TITLE,
      date: today,
      content,
    });

    return {
      ok: true,
      noteId: note.id,
      title: note.title,
    } satisfies DraftPaperSummaryResult;
  },
};

// ---------------------------------------------------------------------------
// extract_paper_method (Output 2)
// ---------------------------------------------------------------------------

export type ExtractPaperMethodArgs = {
  /** The full extracted text of the paper. */
  paperText: string;
  /**
   * The VERBATIM methods section text extracted from the paper. Required.
   * This is placed in the method draft alongside the model-structured version
   * so the user can verify every value against the paper.
   */
  sourcePassage: string;
  /**
   * The method name for the catalog entry (for example
   * "MAFFT + IQ-TREE GTR+G pipeline (Smith et al. 2023)").
   */
  methodName?: string;
  /**
   * The drafted method body, in markdown, with every parameter and number
   * quoted VERBATIM from the source. Required. Do not paraphrase any number
   * or flag. Include the source passage block at the end via formatSourcePassage.
   */
  draftContent: string;
  /**
   * Optional tags (for example ["alignment", "iq-tree", "phylogenetics"]).
   */
  tags?: string[];
};

export type ExtractPaperMethodResult =
  | { ok: true; methodId: number; name: string; sourcePath: string }
  | { ok: false; error: string };

const DEFAULT_METHOD_NAME = "Extracted paper method";

export const extractPaperMethodTool: AiTool = {
  name: "extract_paper_method",
  description:
    "Extract the methods section of a published paper VERBATIM into a new method-catalog entry. Call this after the paper text has been extracted from a PDF. " +
    "Your draftContent must quote ALL numbers, flags, tool names, and parameters VERBATIM from the paper. NEVER paraphrase a number or a flag. " +
    "Pass the EXACT sourcePassage the values were pulled from alongside every drafted value so the user can verify against the paper. " +
    "NEVER invent content that is not in the paperText. NEVER interpret, judge, rank, or recommend the method. You are a transcriber. " +
    "The draft is shown to the user with Approve or Reject BEFORE anything is written, that preview IS the consent. " +
    "Do NOT ask the user for confirmation in prose before calling this. " +
    "On Approve the method is created in the user's method catalog (method_type markdown). After it writes, say in one short sentence what was saved.",
  parameters: {
    type: "object",
    properties: {
      paperText: {
        type: "string",
        description:
          "The full extracted text of the paper. Provide the full text so the draft can be grounded in it.",
      },
      sourcePassage: {
        type: "string",
        description:
          "The EXACT verbatim methods section text from the paper that the extracted values were pulled from. This is shown in the draft alongside the structured content so the user can verify values against the paper. Required.",
      },
      methodName: {
        type: "string",
        description:
          'The name for the method catalog entry (for example "MAFFT + IQ-TREE GTR+G pipeline (Smith et al. 2023)"). Recommended.',
      },
      draftContent: {
        type: "string",
        description:
          "The drafted method body, in markdown. Quote every parameter, number, flag, and tool version VERBATIM from the paper. Never paraphrase a number. Append the source passage block at the end using formatSourcePassage so the user can verify. Everything here must be grounded in the paperText.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional list of tags for the method catalog entry (for example [\"alignment\", \"iq-tree\", \"phylogenetics\"]).",
      },
    },
    required: ["paperText", "sourcePassage", "draftContent"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const rawName =
      typeof args.methodName === "string" ? args.methodName.trim() : "";
    const name = rawName || DEFAULT_METHOD_NAME;
    const sourcePassage =
      typeof args.sourcePassage === "string" ? args.sourcePassage : "";
    const rawContent =
      typeof args.draftContent === "string" ? args.draftContent : "";
    // Append the source passage block to the draft preview so the user sees
    // both the structured method AND the verbatim source when they approve.
    const previewContent = rawContent + formatSourcePassage(sourcePassage);
    return {
      summary: `create method catalog entry "${name}"`,
      draft: {
        content: previewContent,
        mode: "create",
        title: name,
      },
    };
  },
  execute: async (args) => {
    const paperText =
      typeof args.paperText === "string" ? args.paperText : "";
    const sourcePassage =
      typeof args.sourcePassage === "string" ? args.sourcePassage.trim() : "";
    const rawName =
      typeof args.methodName === "string" ? args.methodName.trim() : "";
    const rawContent =
      typeof args.draftContent === "string" ? args.draftContent.trim() : "";
    const tags = Array.isArray(args.tags)
      ? (args.tags as unknown[]).filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        )
      : [];

    if (!paperText.trim()) {
      return {
        ok: false,
        error:
          "No paper text was provided. Extract the paper text first, then call extract_paper_method with it.",
      } satisfies ExtractPaperMethodResult;
    }

    if (!sourcePassage) {
      return {
        ok: false,
        error:
          "No source passage was provided. Pass the VERBATIM methods section text the values were pulled from so the user can verify.",
      } satisfies ExtractPaperMethodResult;
    }

    if (!rawContent) {
      return {
        ok: false,
        error:
          "No draft content was provided. Draft the verbatim method content first, then call this with it.",
      } satisfies ExtractPaperMethodResult;
    }

    const name = rawName || DEFAULT_METHOD_NAME;
    const slug = slugify(name) || "paper-method";
    // Use a timestamp suffix to avoid collisions when the same paper is
    // imported more than once or when slugify produces a collision.
    const timestamp = Date.now();
    const sourcePath = `methods/${slug}-${timestamp}/method.md`;

    // The persisted file includes the verbatim source passage at the end so
    // the approved artifact always carries its grounding text.
    const fullBody = rawContent + formatSourcePassage(sourcePassage);

    await paperReproduceDeps.writeFile(
      sourcePath,
      fullBody,
      `Create method from paper: ${name}`,
    );

    const method = await paperReproduceDeps.createMethod({
      name,
      source_path: sourcePath,
      method_type: "markdown",
      ...(tags.length > 0 ? { tags } : {}),
    });

    return {
      ok: true,
      methodId: method.id,
      name: method.name,
      sourcePath,
    } satisfies ExtractPaperMethodResult;
  },
};
