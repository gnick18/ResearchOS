/**
 * Freeze-investigation (round 2) benchmark.
 *
 * Goal: measure the REAL note persist/commit path (snapshot export + mirror
 * projection + Loro text.update) on a degenerate markdown doc WITHOUT a real
 * folder, so we can decide whether the 90s Lab Notes freeze lives in the
 * persist/VC-on-commit path (the remaining untested suspect from the round-1
 * write-up) rather than in CM measure/render (already ruled out).
 *
 * This is a MEASUREMENT harness, not a regression assertion. It logs timings.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fileService stand-in so persistNote does no real disk I/O.
const mem = new Map<string, unknown>();
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    ensureDir: vi.fn(async () => {}),
    writeFileFromBlob: vi.fn(async (p: string, b: Blob) => {
      mem.set(p, b);
    }),
    writeJson: vi.fn(async (p: string, v: unknown) => {
      // Mirror the real cost: writeJson serializes to a string on the main thread.
      mem.set(p, JSON.stringify(v));
    }),
    readFileAsBlob: vi.fn(async () => null),
  },
}));

import { LoroDoc, LoroText } from "loro-crdt";
import { seedNoteDoc } from "../seed";
import { persistNote, persistSidecar } from "../sidecar-store";
import { projectToNote } from "../mirror";
import { getEntryContentText, setEntryContent } from "../note-doc";
import type { Note } from "@/lib/types";

beforeEach(() => mem.clear());

// --- degenerate content builders -------------------------------------------

/**
 * The reported degenerate structure: an ordered list whose auto-continuation
 * absorbed a `## heading` and a GFM table as items, with doubled markers and
 * growing indentation. `rows` controls table size, `depth` the list nesting so
 * we can probe super-linear scaling.
 */
function degenerateMarkdown(depth: number, rows: number): string {
  const lines: string[] = ["## Steps"];
  let indent = "";
  for (let i = 1; i <= depth; i++) {
    indent = " ".repeat(i);
    lines.push(`${indent}${i}. ${i}. step number ${i} with some inline text`);
  }
  lines.push(`${indent} ${depth + 1}. ## Results`);
  lines.push(`${indent} ${depth + 2}. | Cluster | Type | Closest known |`);
  lines.push(`${indent} ${depth + 3}. | --- | --- | --- |`);
  for (let r = 0; r < rows; r++) {
    lines.push(`${indent} | C${r} | NRPS | known-${r} |`);
  }
  return lines.join("\n");
}

function makeNote(content: string): Note {
  return {
    id: 1,
    title: "Degenerate note",
    description: "",
    is_running_log: false,
    created_at: "2026-06-18T00:00:00.000Z",
    updated_at: "2026-06-18T00:00:00.000Z",
    entries: [
      {
        id: "e1",
        title: "Entry 1",
        date: "2026-06-18",
        created_at: "2026-06-18T00:00:00.000Z",
        updated_at: "2026-06-18T00:00:00.000Z",
        content,
      },
    ],
  } as unknown as Note;
}

function ms(label: string, fn: () => void): number {
  const t0 = performance.now();
  fn();
  const dt = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`[bench] ${label}: ${dt.toFixed(2)} ms`);
  return dt;
}

async function msAsync(label: string, fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  const dt = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`[bench] ${label}: ${dt.toFixed(2)} ms`);
  return dt;
}

describe("note persist on degenerate markdown (round-2 freeze bench)", () => {
  it("single persist of a degenerate doc", async () => {
    const content = degenerateMarkdown(80, 60);
    console.log(`[bench] degenerate content length: ${content.length} chars`);
    const note = makeNote(content);

    const doc = new LoroDoc();
    doc.import(seedNoteDoc(note));

    await msAsync("single persistNote (snapshot export + mirror)", async () => {
      await persistNote("owner", doc, note);
    });
    // sanity: round-trip the content unchanged
    const projected = projectToNote(doc, note);
    expect(projected.entries[0].content).toBe(content);
  });

  it("snapshot-export scaling vs accumulated commit history (the loop theory)", async () => {
    // Simulate what an editing session / feedback loop does: many commits, each
    // applying one tiny incremental text op, then exporting a FULL snapshot
    // (exactly persistSidecar's mode:"snapshot"). If export cost grows with the
    // accumulated op log, N commits cost O(N^2) overall -> the escalation that
    // matches the reported 90s.
    const note = makeNote(degenerateMarkdown(80, 60));
    const doc = new LoroDoc();
    doc.import(seedNoteDoc(note));
    doc.setPeerId(BigInt(123)); // live-edit peer, not the seed peer

    const checkpoints = [1, 50, 100, 200, 400, 800];
    const exportAt: Record<number, number> = {};
    let commits = 0;
    for (const target of checkpoints) {
      while (commits < target) {
        const text = getEntryContentText(doc, 0)!;
        // one-char append, the cheapest possible live edit
        text.insert(text.length, "x");
        doc.commit({ message: "edit" });
        commits++;
      }
      exportAt[target] = ms(`export snapshot @ ${target} commits`, () => {
        doc.export({ mode: "snapshot" });
      });
    }
    console.log("[bench] export-time-by-commit-count:", JSON.stringify(exportAt));
  });

  it("text.update (Myers diff) cost on degenerate content at scale", () => {
    // setEntryContent / external-edit ingest / syncEntrySet seeding all funnel
    // through LoroText.update(), which diffs old vs new. Probe whether the diff
    // is super-linear on the degenerate string as it grows.
    for (const depth of [40, 80, 160, 320]) {
      const content = degenerateMarkdown(depth, depth);
      const doc = new LoroDoc();
      const text = doc.getText("t");
      text.insert(0, content);
      doc.commit();
      // a single char changed near the end -> minimal real diff, worst case for
      // a naive full re-diff
      const edited = content.slice(0, -3) + "Z" + content.slice(-2);
      ms(`text.update depth=${depth} (len=${content.length})`, () => {
        text.update(edited);
        doc.commit();
      });
    }
  });

  it("repeated full persist (debounce defeated) escalation", async () => {
    // If the commit debounce is defeated by a feedback loop, persistNote runs
    // back-to-back. Measure whether back-to-back persists escalate as history
    // accumulates (snapshot grows every round).
    const note = makeNote(degenerateMarkdown(80, 60));
    const doc = new LoroDoc();
    doc.import(seedNoteDoc(note));
    doc.setPeerId(BigInt(7));

    const samples: number[] = [];
    for (let round = 0; round < 300; round++) {
      const text = getEntryContentText(doc, 0)!;
      text.insert(text.length, "y");
      doc.commit({ message: "edit" });
      const dt = await (async () => {
        const t0 = performance.now();
        await persistSidecar("owner", note.id, doc);
        return performance.now() - t0;
      })();
      if (round % 50 === 0) samples.push(Math.round(dt * 100) / 100);
    }
    console.log("[bench] persistSidecar ms @ rounds [0,50,100,150,200,250]:", JSON.stringify(samples));
  });
});
