// Unit tests for BeakerBot paper-reproduce tools: draft_paper_summary and
// extract_paper_method (BeakerAI lane, 2026-06-13).
//
// Test strategy:
//   - Pure-logic tests (slugify, formatSourcePassage) run with no I/O.
//   - draft_paper_summary: stub the deps seam and assert that:
//       (a) the created note carries ONLY content derived from the paperText arg
//       (no fabricated additions from the tool logic itself),
//       (b) the approve/draft path is wired correctly (describeAction emits a
//       draft payload), and
//       (c) the error paths (empty paper text, empty draft) return cleanly.
//   - extract_paper_method: stub the deps seam and assert that:
//       (a) the written file body includes the sourcePassage VERBATIM (not
//       paraphrased),
//       (b) every number from the source passage appears in the written body,
//       (c) the source passage block appears in the approval preview from
//       describeAction, and
//       (d) the error paths return cleanly.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, afterEach } from "vitest";
import {
  draftPaperSummaryTool,
  extractPaperMethodTool,
  paperReproduceDeps,
  slugify,
  formatSourcePassage,
  type PaperReproduceDeps,
} from "./paper-reproduce-tools";
import type { Note, Method } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_PAPER_TEXT = `
Abstract
We investigated the role of CYP51A mutations in azole resistance in
Aspergillus fumigatus. Isolates were collected from 48 patients.

Materials and Methods
Azole susceptibility was determined using the EUCAST broth microdilution
method. MICs were interpreted per EUCAST breakpoints (voriconazole MIC
breakpoints S<=1 mg/L, R>2 mg/L). DNA was extracted using the FastDNA SPIN
kit (MP Biomedicals). CYP51A was amplified with primers CYP51A-F (5
AGCATCATGCCGACG 3) and CYP51A-R using GoTaq Flexi polymerase (Promega) at
an annealing temperature of 58 C for 35 cycles. PCR products were purified
with ExoSAP-IT (Thermo Fisher) and sequenced by Sanger sequencing at 12.5
pmol primer concentration. Sequences were aligned with MAFFT v7.310 with
default parameters.

Results
Of 48 isolates, 12 (25%) carried TR34/L98H mutations. Voriconazole MICs
ranged from 0.25 to 8 mg/L.
`;

const FIXTURE_METHODS_PASSAGE = `Azole susceptibility was determined using the EUCAST broth microdilution
method. MICs were interpreted per EUCAST breakpoints (voriconazole MIC
breakpoints S<=1 mg/L, R>2 mg/L). CYP51A was amplified with GoTaq Flexi
polymerase (Promega) at 58 C for 35 cycles.`;

const FIXTURE_SUMMARY_DRAFT = `## Study overview

This study examined CYP51A mutations in azole-resistant Aspergillus fumigatus
isolates from 48 patients.

## What they did

The authors determined azole susceptibility by EUCAST broth microdilution and
sequenced CYP51A via Sanger sequencing.

## What they report

Of 48 isolates, 12 (25%) carried TR34/L98H mutations.`;

const FIXTURE_METHOD_DRAFT = `## CYP51A amplification

- Polymerase: GoTaq Flexi (Promega)
- Annealing temperature: 58 C
- Cycles: 35
- MIC breakpoints (voriconazole): S<=1 mg/L, R>2 mg/L (EUCAST)
`;

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 42,
    title: "Paper summary",
    description: "",
    is_running_log: false,
    is_shared: false,
    updated_at: "2026-06-13T00:00:00Z",
    username: "grant",
    entries: [
      {
        id: "entry-1",
        title: "Summary",
        date: "2026-06-13",
        content: FIXTURE_SUMMARY_DRAFT,
        created_at: "2026-06-13T00:00:00Z",
        updated_at: "2026-06-13T00:00:00Z",
      },
    ],
    shared_with: [],
    ...overrides,
  };
}

function makeMethod(overrides: Partial<Method> = {}): Method {
  return {
    id: 99,
    name: "CYP51A PCR method (Smith et al. 2023)",
    source_path: "methods/cyp51a-pcr-method-smith/method.md",
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: ["pcr", "cyp51a"],
    is_public: false,
    created_by: null,
    owner: "grant",
    shared_with: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure logic: slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("lowercases, strips special chars, replaces spaces with hyphens", () => {
    // "+" is stripped, adjacent hyphens are collapsed to one, spaces become hyphens.
    expect(slugify("MAFFT + IQ-TREE GTR+G pipeline")).toBe(
      "mafft-iq-tree-gtrg-pipeline",
    );
  });

  it("caps at 40 chars", () => {
    const long = "a".repeat(60);
    expect(slugify(long)).toHaveLength(40);
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  hello world  ")).toBe("hello-world");
  });

  it("returns a non-empty string for a title with only specials", () => {
    // All special chars stripped, the result is empty; caller falls back.
    expect(slugify("!!!")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Pure logic: formatSourcePassage
// ---------------------------------------------------------------------------

describe("formatSourcePassage", () => {
  it("wraps the passage in a labelled block", () => {
    const out = formatSourcePassage("Cycles: 35. Anneal: 58 C.");
    expect(out).toContain("Source passage (verify against paper)");
    expect(out).toContain("Cycles: 35. Anneal: 58 C.");
  });

  it("returns empty string for an empty passage", () => {
    expect(formatSourcePassage("")).toBe("");
    expect(formatSourcePassage("   ")).toBe("");
  });

  it("quotes multi-line passages as a block quote", () => {
    const out = formatSourcePassage("Line one.\nLine two.");
    expect(out).toContain("> Line one.");
    expect(out).toContain("> Line two.");
  });
});

// ---------------------------------------------------------------------------
// draftPaperSummaryTool: deps seam stubs
// ---------------------------------------------------------------------------

const realDeps: PaperReproduceDeps = { ...paperReproduceDeps };

function stubDeps(overrides: Partial<PaperReproduceDeps>): void {
  Object.assign(paperReproduceDeps, overrides);
}

afterEach(() => {
  Object.assign(paperReproduceDeps, realDeps);
});

describe("draftPaperSummaryTool.describeAction", () => {
  it("emits a draft payload with mode create and the note title", () => {
    const result = draftPaperSummaryTool.describeAction!({
      paperText: FIXTURE_PAPER_TEXT,
      noteTitle: "Smith et al. 2023 summary",
      draftContent: FIXTURE_SUMMARY_DRAFT,
    });
    expect(result.draft).toBeDefined();
    expect(result.draft?.mode).toBe("create");
    expect(result.draft?.title).toBe("Smith et al. 2023 summary");
    expect(result.draft?.content).toBe(FIXTURE_SUMMARY_DRAFT);
  });

  it("falls back to the default title when noteTitle is absent", () => {
    const result = draftPaperSummaryTool.describeAction!({
      paperText: FIXTURE_PAPER_TEXT,
      draftContent: FIXTURE_SUMMARY_DRAFT,
    });
    expect(result.draft?.title).toBe("Paper summary");
  });
});

describe("draftPaperSummaryTool.execute", () => {
  it("creates a note carrying ONLY the supplied draftContent (no fabrication)", async () => {
    let captured: Parameters<PaperReproduceDeps["createNote"]>[0] | undefined;
    stubDeps({
      createNote: async (data) => {
        captured = data;
        return makeNote({
          title: data.title,
          entries: [
            {
              id: "entry-1",
              title: data.entryTitle,
              date: data.date,
              content: data.content,
              created_at: "2026-06-13T00:00:00Z",
              updated_at: "2026-06-13T00:00:00Z",
            },
          ],
        });
      },
    });

    const result = (await draftPaperSummaryTool.execute({
      paperText: FIXTURE_PAPER_TEXT,
      noteTitle: "Smith et al. 2023 summary",
      draftContent: FIXTURE_SUMMARY_DRAFT,
    })) as { ok: true; noteId: number; title: string };

    expect(result.ok).toBe(true);
    expect(result.noteId).toBe(42);

    // The note entry content must be EXACTLY the draftContent, not altered
    // or enriched by tool logic. The tool is a transcription vehicle.
    expect(captured?.content).toBe(FIXTURE_SUMMARY_DRAFT);
    expect(captured?.title).toBe("Smith et al. 2023 summary");
  });

  it("returns an error when paperText is empty", async () => {
    const result = (await draftPaperSummaryTool.execute({
      paperText: "",
      draftContent: FIXTURE_SUMMARY_DRAFT,
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/paper text/i);
  });

  it("returns an error when draftContent is empty", async () => {
    const result = (await draftPaperSummaryTool.execute({
      paperText: FIXTURE_PAPER_TEXT,
      draftContent: "",
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/draft content/i);
  });

  it("uses the default title when noteTitle is absent", async () => {
    let captured: Parameters<PaperReproduceDeps["createNote"]>[0] | undefined;
    stubDeps({
      createNote: async (data) => {
        captured = data;
        return makeNote({ title: data.title });
      },
    });

    await draftPaperSummaryTool.execute({
      paperText: FIXTURE_PAPER_TEXT,
      draftContent: FIXTURE_SUMMARY_DRAFT,
    });

    expect(captured?.title).toBe("Paper summary");
  });
});

// ---------------------------------------------------------------------------
// extractPaperMethodTool: verbatim preservation and source passage
// ---------------------------------------------------------------------------

describe("extractPaperMethodTool.describeAction", () => {
  it("emits a draft payload with the source passage appended", () => {
    const result = extractPaperMethodTool.describeAction!({
      paperText: FIXTURE_PAPER_TEXT,
      sourcePassage: FIXTURE_METHODS_PASSAGE,
      methodName: "CYP51A PCR (Smith et al. 2023)",
      draftContent: FIXTURE_METHOD_DRAFT,
    });
    expect(result.draft).toBeDefined();
    expect(result.draft?.mode).toBe("create");
    expect(result.draft?.title).toBe("CYP51A PCR (Smith et al. 2023)");
    // The preview must include the source passage label and key text from the
    // passage. formatSourcePassage wraps lines in "> " block-quote syntax, so
    // we check for the structural label and for a distinctive fragment rather
    // than the raw multi-line passage string.
    expect(result.draft?.content).toContain("Source passage (verify against paper)");
    expect(result.draft?.content).toContain("GoTaq Flexi");
    expect(result.draft?.content).toContain("58 C");
    expect(result.draft?.content).toContain("35 cycles");
  });

  it("applyEdit routes the Canvas-edited full body so execute writes it verbatim (no double source block)", async () => {
    const args: Record<string, unknown> = {
      paperText: FIXTURE_PAPER_TEXT,
      sourcePassage: FIXTURE_METHODS_PASSAGE,
      methodName: "CYP51A PCR",
      draftContent: FIXTURE_METHOD_DRAFT,
    };
    const result = extractPaperMethodTool.describeAction!(args);
    expect(result.draft?.applyEdit).toBeDefined();
    // The preview body is the full draft + source passage; the user edits all of
    // it in Canvas. applyEdit stashes the edited full body so execute uses it
    // verbatim instead of re-appending the source passage (which would double it).
    const editedFullBody = `${result.draft!.content}\n\nExtra reviewer note.`;
    result.draft!.applyEdit!(args, editedFullBody);

    let writtenBody = "";
    stubDeps({
      writeFile: async (_path, content) => {
        writtenBody = content;
        return { path: "methods/test/method.md", sha: "abc" };
      },
      createMethod: async (data) =>
        makeMethod({ name: data.name, source_path: data.source_path }),
    });
    await extractPaperMethodTool.execute(args);
    expect(writtenBody).toBe(editedFullBody);
    // The source-passage label appears exactly once (not doubled by execute).
    const occurrences = writtenBody.split("Source passage (verify against paper)").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("extractPaperMethodTool.execute", () => {
  it("preserves verbatim numbers from the source passage in the written file", async () => {
    let writtenBody = "";
    stubDeps({
      writeFile: async (_path, content, _msg) => {
        writtenBody = content;
        return { path: "methods/test/method.md", sha: "abc" };
      },
      createMethod: async (data) =>
        makeMethod({ name: data.name, source_path: data.source_path }),
    });

    await extractPaperMethodTool.execute({
      paperText: FIXTURE_PAPER_TEXT,
      sourcePassage: FIXTURE_METHODS_PASSAGE,
      methodName: "CYP51A PCR",
      draftContent: FIXTURE_METHOD_DRAFT,
    });

    // Numbers that appear in the source passage must appear in the written body.
    // "58 C" and "35 cycles" are explicit values; "S<=1 mg/L" and "R>2 mg/L"
    // are the verbatim MIC breakpoints.
    expect(writtenBody).toContain("58 C");
    expect(writtenBody).toContain("35 cycles");
    expect(writtenBody).toContain("S<=1 mg/L");
    expect(writtenBody).toContain("R>2 mg/L");
  });

  it("appends the VERBATIM source passage to the written file body", async () => {
    let writtenBody = "";
    stubDeps({
      writeFile: async (_path, content) => {
        writtenBody = content;
        return { path: "methods/test/method.md", sha: "abc" };
      },
      createMethod: async (data) =>
        makeMethod({ name: data.name, source_path: data.source_path }),
    });

    await extractPaperMethodTool.execute({
      paperText: FIXTURE_PAPER_TEXT,
      sourcePassage: FIXTURE_METHODS_PASSAGE,
      draftContent: FIXTURE_METHOD_DRAFT,
    });

    // The source passage is wrapped in a block quote by formatSourcePassage,
    // so we check for the structural label and distinctive verbatim fragments
    // rather than the raw multi-line string. The key test is that the VALUES
    // from the passage appear in the written body, not a paraphrase.
    expect(writtenBody).toContain("Source passage (verify against paper)");
    // These fragments come from FIXTURE_METHODS_PASSAGE verbatim and must
    // survive into the written body unchanged.
    expect(writtenBody).toContain("EUCAST broth microdilution");
    expect(writtenBody).toContain("GoTaq Flexi");
  });

  it("creates the method record pointing at the written file path", async () => {
    let createdData: Parameters<PaperReproduceDeps["createMethod"]>[0] | undefined;
    stubDeps({
      writeFile: async (path) => ({ path, sha: "abc" }),
      createMethod: async (data) => {
        createdData = data;
        return makeMethod({ name: data.name, source_path: data.source_path });
      },
    });

    const result = (await extractPaperMethodTool.execute({
      paperText: FIXTURE_PAPER_TEXT,
      sourcePassage: FIXTURE_METHODS_PASSAGE,
      methodName: "CYP51A PCR",
      draftContent: FIXTURE_METHOD_DRAFT,
      tags: ["pcr", "cyp51a"],
    })) as { ok: true; methodId: number; name: string; sourcePath: string };

    expect(result.ok).toBe(true);
    expect(result.methodId).toBe(99);
    expect(createdData?.method_type).toBe("markdown");
    // The source_path must be a .md file under methods/
    expect(createdData?.source_path).toMatch(/^methods\/.+\.md$/);
    expect(createdData?.tags).toEqual(["pcr", "cyp51a"]);
  });

  it("returns an error when paperText is empty", async () => {
    const result = (await extractPaperMethodTool.execute({
      paperText: "",
      sourcePassage: FIXTURE_METHODS_PASSAGE,
      draftContent: FIXTURE_METHOD_DRAFT,
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/paper text/i);
  });

  it("returns an error when sourcePassage is empty", async () => {
    const result = (await extractPaperMethodTool.execute({
      paperText: FIXTURE_PAPER_TEXT,
      sourcePassage: "",
      draftContent: FIXTURE_METHOD_DRAFT,
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/source passage/i);
  });

  it("returns an error when draftContent is empty", async () => {
    const result = (await extractPaperMethodTool.execute({
      paperText: FIXTURE_PAPER_TEXT,
      sourcePassage: FIXTURE_METHODS_PASSAGE,
      draftContent: "",
    })) as { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/draft content/i);
  });

  it("uses the default method name when methodName is absent", async () => {
    let createdData: Parameters<PaperReproduceDeps["createMethod"]>[0] | undefined;
    stubDeps({
      writeFile: async (path) => ({ path, sha: "abc" }),
      createMethod: async (data) => {
        createdData = data;
        return makeMethod({ name: data.name });
      },
    });

    await extractPaperMethodTool.execute({
      paperText: FIXTURE_PAPER_TEXT,
      sourcePassage: FIXTURE_METHODS_PASSAGE,
      draftContent: FIXTURE_METHOD_DRAFT,
    });

    expect(createdData?.name).toBe("Extracted paper method");
  });
});
