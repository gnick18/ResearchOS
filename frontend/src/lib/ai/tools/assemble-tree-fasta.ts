// BeakerBot FASTA assembler for tree input (BeakerAI lane, 2026-06-13).
//
// Piece B / Output 3 of the phylo input-binding spec. Given a list of the
// user's library sequence ids, this tool fetches each sequence, serializes
// the whole set as a raw multi-FASTA string via the project's validated FASTA
// helpers (toFasta from lib/sequences/export.ts), and delivers the file as a
// browser download in the chat. It does NOT align, interpret, trim, or infer
// anything; those steps belong to the generate_tree recipe, which the user
// runs on their own machine.
//
// Scope boundary (hard rule): this tool only hands over the user's OWN
// sequences verbatim. It never synthesizes, aligns, or adds any content. The
// FASTA it emits is character-for-character the stored bases from each record.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { sequencesApi } from "@/lib/local-api";
import { toFasta } from "@/lib/sequences/export";
import type { SequenceDetail } from "@/lib/types";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam
// ---------------------------------------------------------------------------

/** The reads and browser-effect the tool needs, injected so unit tests can
 *  stub both without a real folder or a real DOM download. Tests swap the
 *  individual properties on this object directly (same pattern as
 *  sequenceToolsDeps in sequence-tools.ts). */
export type AssembleTreeFastaDeps = {
  /** Fetch one sequence in full (bases + display_name). Returns null when not
   *  found. Read-only. */
  getSequence: (id: number) => Promise<SequenceDetail | null>;
  /** Trigger a browser download of the FASTA text with the given filename.
   *  Defaults to a real DOM download (blob + objectURL + a.click). In tests
   *  the caller can swap this with a no-op or an accumulator. */
  triggerDownload: (text: string, filename: string) => void;
};

/** Real-browser implementation of triggerDownload. Builds a Blob, creates
 *  a short-lived object URL, and fires an <a download> click, matching the
 *  pattern from lib/sequences/export.ts downloadText/downloadBlob. */
function defaultTriggerDownload(text: string, filename: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Module-level deps object. Tests swap individual properties on this object;
 *  production leaves it as-is. */
export const assembleTreeFastaDeps: AssembleTreeFastaDeps = {
  getSequence: (id) => sequencesApi.get(id),
  triggerDownload: defaultTriggerDownload,
};

// ---------------------------------------------------------------------------
// Arg parsing helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

/** Parse and normalize the sequence id list from raw tool args. Accepts a
 *  JSON array of numbers or number-strings, deduplicates, filters invalid
 *  entries, and returns the clean numeric ids plus any that were unparseable.
 *  Pure. */
export function parseSequenceIds(raw: unknown): {
  ids: number[];
  invalid: unknown[];
} {
  if (!Array.isArray(raw)) return { ids: [], invalid: [] };
  const ids: number[] = [];
  const invalid: unknown[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    const n =
      typeof entry === "number"
        ? entry
        : typeof entry === "string"
          ? Number(entry)
          : NaN;
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      invalid.push(entry);
    } else if (!seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  return { ids, invalid };
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type AssembleTreeFastaResult =
  | {
      ok: true;
      filename: string;
      sequence_count: number;
      missing_ids: number[];
      /** The first 500 characters of the assembled FASTA, as a copy-paste
       *  fallback in case the browser blocked the download. */
      fasta_head: string;
      message: string;
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const assembleTreeFastaTool: AiTool = {
  name: "assemble_tree_fasta",
  description:
    "Assemble a raw multi-FASTA file from the user's library sequences and deliver it as a browser download, ready to feed into a generate_tree recipe. Pass the numeric sequence ids (from search_my_work or list_sequences) and an optional output filename. The tool fetches each sequence from the user's own folder, serializes the bases verbatim using the validated FASTA serializer, and triggers a browser download. It does not align, trim, interpret, or add any content. Use this to produce the input FASTA before calling generate_tree. Missing ids are skipped and reported; if zero ids resolve to a sequence the tool returns an error instead of an empty download.",
  parameters: {
    type: "object",
    properties: {
      sequence_ids: {
        type: "array",
        items: { type: "number" },
        description:
          "Numeric ids of the user's library sequences to include in the FASTA, in order. Obtain ids from search_my_work or list_sequences. At least one id is required.",
      },
      filename: {
        type: "string",
        description:
          "Output filename for the downloaded FASTA. Default \"input.fasta\". Should end in .fasta or .fa.",
      },
    },
    required: ["sequence_ids"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const { ids } = parseSequenceIds(args.sequence_ids);
    const n = ids.length;
    // The filename is surfaced in the execute result message. The describeAction
    // summary is intentionally short (shown in the Allow button label area).
    return {
      summary: `Assemble a FASTA of ${n} sequence${n === 1 ? "" : "s"} for tree building.`,
    };
  },
  execute: async (args) => {
    // Parse ids.
    const { ids, invalid: invalidEntries } = parseSequenceIds(args.sequence_ids);
    const rawFilename = typeof args.filename === "string" ? args.filename.trim() : "";
    const filename = rawFilename || "input.fasta";

    if (ids.length === 0) {
      return {
        ok: false,
        error:
          "sequence_ids must be a non-empty array of positive integer ids. " +
          (invalidEntries.length > 0
            ? `The following entries were not valid ids: ${JSON.stringify(invalidEntries)}.`
            : "The list was empty."),
      } satisfies AssembleTreeFastaResult;
    }

    // Fetch each sequence. Collect hits and misses.
    const hits: { detail: SequenceDetail }[] = [];
    const missingIds: number[] = [];

    await Promise.all(
      ids.map(async (id) => {
        const detail = await assembleTreeFastaDeps.getSequence(id);
        if (!detail || !detail.seq || detail.seq.length === 0) {
          missingIds.push(id);
        } else {
          hits.push({ detail });
        }
      }),
    );

    // Preserve the caller-supplied order. Promise.all resolves in input-index
    // order, but hits are appended as each fetch settles; re-sort to restore
    // the id-list order so the multi-FASTA is deterministic regardless of
    // network / cache timing.
    hits.sort((a, b) => ids.indexOf(a.detail.id) - ids.indexOf(b.detail.id));

    if (hits.length === 0) {
      return {
        ok: false,
        error:
          `None of the ${ids.length} requested sequence id${ids.length === 1 ? "" : "s"} resolved to a record with sequence data. ` +
          `Missing ids: ${missingIds.join(", ")}.`,
      } satisfies AssembleTreeFastaResult;
    }

    // Build the multi-FASTA. One record per sequence, verbatim bases.
    const parts: string[] = hits.map(({ detail }) =>
      toFasta(
        {
          name: detail.display_name || detail.locus_name || `seq_${detail.id}`,
          sequence: detail.seq,
        },
        70,
      ),
    );
    const fastaText = parts.join("");

    // Trigger the download. execute runs inside the Allow-gesture window (the
    // gate resolves before execute is called), so the browser permits the
    // programmatic download without a further user gesture.
    assembleTreeFastaDeps.triggerDownload(fastaText, filename);

    const message =
      `Assembled ${filename} with ${hits.length} sequence${hits.length === 1 ? "" : "s"}.` +
      (missingIds.length > 0
        ? ` Skipped ${missingIds.length} id${missingIds.length === 1 ? "" : "s"} that did not resolve: ${missingIds.join(", ")}.`
        : "");

    return {
      ok: true,
      filename,
      sequence_count: hits.length,
      missing_ids: missingIds,
      fasta_head: fastaText.slice(0, 500),
      message,
    } satisfies AssembleTreeFastaResult;
  },
};
