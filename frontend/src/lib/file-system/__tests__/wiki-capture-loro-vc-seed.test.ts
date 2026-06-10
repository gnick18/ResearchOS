/**
 * Tests for the wiki version-history Loro seed (wiki-capture-loro-vc-seed.ts).
 *
 * The seed builds a real multi-commit Loro document for note 5 so the wiki
 * version-history page screenshots render a populated, multi-version,
 * multi-editor, multi-day timeline. These tests load the seeded snapshot through
 * the SAME engine the sidebar uses (listVersions, reconstructCanonicalAt,
 * makeLoroHistoryEngine + buildVersionList) and assert:
 *   1. The doc carries nine changes (genesis + eight deltas).
 *   2. listVersions resolves alex and morgan, with peer 0 as "seed" at index 0.
 *   3. The capture indices 3 and 4 are selectable, non-genesis, morgan-authored
 *      version rows in the rendered list.
 *   4. A diff reconstructs (index 3 differs from index 2).
 *   5. HEAD (index 8) equals the on-disk mirror, so openNote's external-edit
 *      classifier returns "none" (no spurious commit ingested over the history).
 *   6. The undo window points from version 6 to version 4.
 *
 * fileService is mocked in-memory (mirroring loro/__tests__/history.test.ts) so
 * loadOrRebuild + readActors run in the vitest node environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// In-memory fileService mock
// ---------------------------------------------------------------------------

const fileStore = new Map<string, unknown>();
let blobStore = new Map<string, Blob>();

vi.mock("@/lib/file-system/file-service", () => {
  return {
    fileService: {
      readFileAsBlob: vi.fn(async (path: string) => blobStore.get(path) ?? null),
      readJson: vi.fn(async (path: string) => fileStore.get(path) ?? null),
      writeJson: vi.fn(async (path: string, data: unknown) => {
        fileStore.set(path, data);
      }),
      writeFileFromBlob: vi.fn(async (path: string, blob: Blob) => {
        blobStore.set(path, blob);
      }),
      ensureDir: vi.fn(async () => {}),
    },
  };
});

// Import after the mock is registered.
import {
  buildSeedLoroSidecarBytes,
  buildSeedUndoWindow,
  VC_SEED_SIDECAR_PATH,
  VC_SEED_ACTORS_PATH,
  VC_SEED_ACTORS,
  VC_SEED_NOTE_ID,
  VC_SEED_NOTE_OWNER,
} from "../wiki-capture-loro-vc-seed";
import {
  listVersions,
  reconstructCanonicalAt,
  reconstructNoteAt,
} from "@/lib/loro/history";
import { makeLoroHistoryEngine } from "@/lib/loro/history-engine";
import { classifyExternalEdit } from "@/lib/loro/external-edit";
import { buildVersionList } from "@/lib/history/entity-viewer";
import { notesAdapter } from "@/lib/history/notes-viewer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The on-disk note 5 mirror (the HEAD state). Tracked fields restate the
 *  fixture so the HEAD-equals-mirror assertion is an independent check. */
function mirrorNote5(): Note {
  return {
    id: VC_SEED_NOTE_ID,
    title: "qPCR optimization log (fakeGFP vs ACT1)",
    description:
      "Optimizing the SYBR-based qPCR for fakeGFP expression. Reference: alex pcr_protocol 1.\n\nDoc tracks Cq values per primer-anneal sweep so we lock in conditions before the full triplicate run.",
    is_running_log: true,
    is_shared: true,
    created_at: "2026-04-22T16:00:00Z",
    updated_at: "2026-05-06T10:30:00Z",
    username: "alex",
    flagged: null,
    comments: [],
    entries: [
      {
        id: "rl-alex-5-e1",
        title: "2026-04-22: anneal temp sweep 56, 58, 60, 62 °C",
        date: "2026-04-22",
        content:
          "fakeGFP-fwd/rev at 200 nM, cDNA 1:5. Cq means (n=2):\n- 56 °C: 22.9\n- 58 °C: 22.4\n- 60 °C: 21.7 (sharp melt peak)\n- 62 °C: 22.1\n\nLocking in 60 °C anneal. Melt curve confirms single product.",
        created_at: "2026-04-22T16:00:00Z",
        updated_at: "2026-04-22T16:00:00Z",
      },
      {
        id: "rl-alex-5-e2",
        title: "2026-04-29: primer concentration check (100 vs 200 nM)",
        date: "2026-04-29",
        content:
          "100 nM: Cq 22.1, lower fluorescence plateau. 200 nM: Cq 21.7, plateau ~2× higher. Sticking with 200 nM for the demo runs.",
        created_at: "2026-04-29T11:00:00Z",
        updated_at: "2026-04-29T11:00:00Z",
      },
      {
        id: "rl-alex-5-e3",
        title: "2026-05-06: reference gene comparison ACT1 vs PDA1",
        date: "2026-05-06",
        content:
          "ACT1 Cq spread across 8 wells: 21.6 to 21.9 (SD 0.10). PDA1 Cq spread: 24.1 to 24.7 (SD 0.22). ACT1 is the tighter reference, using it as the housekeeping baseline.",
        created_at: "2026-05-06T10:30:00Z",
        updated_at: "2026-05-06T10:30:00Z",
      },
    ],
  } as Note;
}

/** Install the seeded sidecar bytes + actors map into the mock stores, exactly
 *  as wiki-capture-mock.ts does at fixture install time. Returns `now`. */
function installSeed(now: Date): void {
  const bytes = buildSeedLoroSidecarBytes(now);
  blobStore.set(
    `users/${VC_SEED_NOTE_OWNER}/.researchos/notes/${VC_SEED_NOTE_ID}.loro`,
    new Blob([bytes.buffer as ArrayBuffer]),
  );
  fileStore.set(
    `users/${VC_SEED_NOTE_OWNER}/.researchos/actors.json`,
    VC_SEED_ACTORS,
  );
}

const NOW = new Date("2026-06-10T18:00:00Z");

beforeEach(() => {
  fileStore.clear();
  blobStore = new Map();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Path + actors sanity
// ---------------------------------------------------------------------------

describe("seed paths and actors", () => {
  it("targets the sidecar + actors paths the engine reads", () => {
    expect(VC_SEED_SIDECAR_PATH).toBe(
      "users/alex/.researchos/notes/5.loro",
    );
    expect(VC_SEED_ACTORS_PATH).toBe("users/alex/.researchos/actors.json");
    expect(Object.values(VC_SEED_ACTORS).map((a) => a.username).sort()).toEqual([
      "alex",
      "morgan",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Change count
// ---------------------------------------------------------------------------

describe("buildSeedLoroSidecarBytes: nine changes", () => {
  it("produces a doc with one genesis plus eight delta commits", () => {
    const doc = new LoroDoc();
    doc.import(buildSeedLoroSidecarBytes(NOW));
    let count = 0;
    for (const changes of (doc.getAllChanges() as Map<string, unknown[]>).values()) {
      count += changes.length;
    }
    expect(count).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// listVersions: ordering, attribution
// ---------------------------------------------------------------------------

describe("listVersions: populated multi-editor timeline", () => {
  it("returns nine versions, seed at index 0, alex + morgan resolved", async () => {
    installSeed(NOW);
    const base = mirrorNote5();
    const versions = await listVersions(VC_SEED_NOTE_OWNER, base);

    expect(versions).toHaveLength(9);

    // Index 0 is the deterministic genesis (peer 0 -> "seed").
    expect(versions[0].index).toBe(0);
    expect(versions[0].peer).toBe("0");
    expect(versions[0].username).toBe("seed");

    // Indices 3 and 4 (the capture-script diff + compare targets) are morgan.
    expect(versions[3].username).toBe("morgan");
    expect(versions[4].username).toBe("morgan");

    // Both distinct actors appear across the non-genesis timeline.
    const actors = new Set(versions.slice(1).map((v) => v.username));
    expect(actors.has("alex")).toBe(true);
    expect(actors.has("morgan")).toBe(true);

    // Timestamps are non-decreasing in lamport order.
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i].timestampMs).toBeGreaterThanOrEqual(
        versions[i - 1].timestampMs,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Rendered list: capture indices 3 and 4 are selectable rows
// ---------------------------------------------------------------------------

describe("makeLoroHistoryEngine + buildVersionList: capture rows", () => {
  it("renders selectable non-genesis rows at versionIndex 3 and 4 (morgan)", async () => {
    installSeed(NOW);
    const base = mirrorNote5();
    const engine = makeLoroHistoryEngine(base);

    const rows = await engine.readHistory("notes", VC_SEED_NOTE_OWNER, base.id);
    expect(rows).toHaveLength(9);
    // Genesis row at index 0 is skipped by buildVersionList.
    expect(rows[0].kind).toBe("genesis");

    const model = buildVersionList(rows, NOW, {}, 99);
    const flat = model.days.flatMap((d) => d.sessions.flatMap((s) => s.versions));
    const byIndex = new Map(flat.map((v) => [v.versionIndex, v]));

    // Genesis (0) is not a selectable row.
    expect(byIndex.has(0)).toBe(false);

    // The capture script selects data-version-index 3 and 4.
    const v3 = byIndex.get(3);
    const v4 = byIndex.get(4);
    expect(v3).toBeDefined();
    expect(v4).toBeDefined();
    expect(v3!.actor).toBe("morgan");
    expect(v4!.actor).toBe("morgan");
    expect(v3!.isHead).toBe(false);
    expect(v4!.isHead).toBe(false);

    // More than one calendar-day group renders (multi-day timeline).
    expect(model.days.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Diff reconstructs
// ---------------------------------------------------------------------------

describe("reconstructCanonicalAt: a diff reconstructs", () => {
  it("index 3 (morgan edit) differs from its predecessor index 2", async () => {
    installSeed(NOW);
    const base = mirrorNote5();

    const at2 = await reconstructCanonicalAt(VC_SEED_NOTE_OWNER, base, 2);
    const at3 = await reconstructCanonicalAt(VC_SEED_NOTE_OWNER, base, 3);

    expect(at2).not.toBe(at3);

    // notesAdapter parses both without throwing.
    const body2 = notesAdapter.projectBody(at2).body;
    const body3 = notesAdapter.projectBody(at3).body;
    // Morgan's edit swaps the clean 60 C number for the noisy re-run note.
    expect(body2).toContain("21.7 (sharp melt peak)");
    expect(body3).toContain("Need to re-run, melt curve was noisy.");
  });
});

// ---------------------------------------------------------------------------
// HEAD equals the mirror (no spurious external-edit ingest)
// ---------------------------------------------------------------------------

describe("HEAD state equals the on-disk mirror", () => {
  it("reconstructs index 8 to every tracked field of note 5", async () => {
    installSeed(NOW);
    const base = mirrorNote5();
    const head = await reconstructNoteAt(VC_SEED_NOTE_OWNER, base, 8);

    expect(head.title).toBe(base.title);
    expect(head.description).toBe(base.description);
    expect(head.is_running_log).toBe(base.is_running_log);
    expect(head.created_at).toBe(base.created_at);
    expect(head.entries).toHaveLength(3);
    for (let i = 0; i < base.entries.length; i++) {
      expect(head.entries[i].id).toBe(base.entries[i].id);
      expect(head.entries[i].title).toBe(base.entries[i].title);
      expect(head.entries[i].date).toBe(base.entries[i].date);
      expect(head.entries[i].content).toBe(base.entries[i].content);
      expect(head.entries[i].created_at).toBe(base.entries[i].created_at);
      expect(head.entries[i].updated_at).toBe(base.entries[i].updated_at);
    }
  });

  it("classifyExternalEdit returns 'none' so openNote ingests no extra commit", () => {
    const doc = new LoroDoc();
    doc.import(buildSeedLoroSidecarBytes(NOW));
    expect(classifyExternalEdit(doc, mirrorNote5())).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Undo window
// ---------------------------------------------------------------------------

describe("buildSeedUndoWindow", () => {
  it("points from version 6 to version 4 and is active at capture time", () => {
    const w = buildSeedUndoWindow(NOW);
    expect(w.from_version).toBe(6);
    expect(w.to_version).toBe(4);
    expect(w.reverted_by).toBe("alex");
    expect(Date.parse(w.expires_at)).toBeGreaterThan(NOW.getTime());
    expect(Date.parse(w.reverted_at)).toBeLessThan(NOW.getTime());
  });
});
