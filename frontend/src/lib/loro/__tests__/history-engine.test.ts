/**
 * Tests for the Loro VersionHistorySource adapter (history-engine.ts).
 *
 * Validates that makeLoroHistoryEngine:
 *   1. maps the seed change to a genesis row (buildVersionList skips it) and
 *      maps each user edit to a delta row with the correct ts / actor / kind.
 *   2. feeds those rows into the REAL buildVersionList and produces a renderable
 *      version count matching the number of edits (genesis is excluded).
 *   3. reconstructState for an older index returns a canonical string that
 *      notesAdapter.projectBody parses and contains the OLD content.
 *
 * fileService is mocked in-memory (same pattern as history.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { seedNoteDoc } from "../seed";
import { setEntryContent } from "../note-doc";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// In-memory fileService mock (must be hoisted before module imports below)
// ---------------------------------------------------------------------------

const fileStore = new Map<string, unknown>();
let blobStore = new Map<string, Blob>();

vi.mock("@/lib/file-system/file-service", () => ({
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
}));

// Import after the mock is registered so the modules pick up the mock.
import { makeLoroHistoryEngine } from "../history-engine";
import { buildVersionList } from "@/lib/history/entity-viewer";
import { notesAdapter } from "@/lib/history/notes-viewer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fixtureNote(): Note {
  return {
    id: 99,
    title: "PCR amplification protocol",
    description: "Taq polymerase run",
    is_running_log: false,
    is_shared: false,
    created_at: "2026-05-20T10:00:00Z",
    updated_at: "2026-05-20T11:00:00Z",
    username: "alex",
    flagged: null,
    comments: [],
    entries: [
      {
        id: "e1",
        title: "Run 1",
        date: "2026-05-20",
        content: "Initial PCR setup.",
        created_at: "2026-05-20T10:00:00Z",
        updated_at: "2026-05-20T10:00:00Z",
      },
    ],
  } as Note;
}

function sidecarPathFor(owner: string, noteId: number): string {
  return `users/${owner}/.researchos/notes/${noteId}.loro`;
}

function actorsPathFor(owner: string): string {
  return `users/${owner}/.researchos/actors.json`;
}

function setSidecar(owner: string, noteId: number, bytes: Uint8Array): void {
  blobStore.set(
    sidecarPathFor(owner, noteId),
    new Blob([bytes.buffer as ArrayBuffer]),
  );
}

function setActors(
  owner: string,
  actors: Record<string, { username: string }>,
): void {
  fileStore.set(actorsPathFor(owner), actors);
}

beforeEach(() => {
  fileStore.clear();
  blobStore = new Map();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Build a real multi-version doc (seed + two edits) and persist the sidecar.
// Returns the note fixture plus the two content strings used for the edits.
// ---------------------------------------------------------------------------

function buildMultiVersionDoc(owner: string): {
  note: Note;
  firstContent: string;
  secondContent: string;
  devicePeer: bigint;
} {
  const note = fixtureNote();
  const firstContent = "Annealing temp 58 C, 30 cycles.";
  const secondContent = "Annealing temp 60 C, 35 cycles (revised).";

  const seedBytes = seedNoteDoc(note);
  const doc = new LoroDoc();
  doc.import(seedBytes);

  const devicePeer = BigInt(77777777);
  doc.setPeerId(devicePeer);

  setEntryContent(doc, 0, firstContent);
  doc.commit({ message: "edit-one", timestamp: 1748000000 });

  setEntryContent(doc, 0, secondContent);
  doc.commit({ message: "edit-two", timestamp: 1748000060 });

  const bytes = doc.export({ mode: "snapshot" });
  setSidecar(owner, note.id, bytes);
  setActors(owner, { [devicePeer.toString()]: { username: "alex" } });

  return { note, firstContent, secondContent, devicePeer };
}

// ---------------------------------------------------------------------------
// Test 1: row shape -- seed -> genesis, edits -> delta rows
// ---------------------------------------------------------------------------

describe("makeLoroHistoryEngine.readHistory: row shape", () => {
  it("maps the seed change to a genesis row and edits to delta rows", async () => {
    const owner = "alex";
    const { note } = buildMultiVersionDoc(owner);

    const engine = makeLoroHistoryEngine(note);
    const rows = await engine.readHistory("notes", owner, note.id);

    // seed + 2 edits = 3 rows total.
    expect(rows.length).toBe(3);

    // Index 0 maps to a genesis row. buildVersionList skips this -- the seed
    // is the baseline, not a restorable user version.
    expect(rows[0].kind).toBe("genesis");
    expect(rows[0].actor).toBe("seed");
    expect(rows[0].owner).toBe(owner);
    // Must be a valid ISO string.
    expect(() => new Date(rows[0].ts)).not.toThrow();
    expect(new Date(rows[0].ts).getTime()).toBeGreaterThan(0);

    // Index 1: first edit -- delta row, actor "alex".
    expect(rows[1].kind).toBe("update");
    expect(rows[1].actor).toBe("alex");
    expect(rows[1].owner).toBe(owner);
    expect(rows[1].id).toBe(`loro-v1-${note.id}`);

    // Index 2: second edit -- delta row, actor "alex".
    expect(rows[2].kind).toBe("update");
    expect(rows[2].actor).toBe("alex");
    expect(rows[2].id).toBe(`loro-v2-${note.id}`);

    // Timestamps increase (or are equal, but not backwards).
    const ts = rows.map((r) => new Date(r.ts).getTime());
    expect(ts[1]).toBeGreaterThanOrEqual(ts[0]);
    expect(ts[2]).toBeGreaterThanOrEqual(ts[1]);
  });

  it("maps a restore-prefixed message to the revert kind", async () => {
    const owner = "alex";
    const note = fixtureNote();

    const seedBytes = seedNoteDoc(note);
    const doc = new LoroDoc();
    doc.import(seedBytes);

    const devicePeer = BigInt(11111);
    doc.setPeerId(devicePeer);

    setEntryContent(doc, 0, "restored state");
    // A message starting with "restore" should produce kind "revert".
    doc.commit({ message: "restore to version 1", timestamp: 1748001000 });

    const bytes = doc.export({ mode: "snapshot" });
    setSidecar(owner, note.id, bytes);
    setActors(owner, { [devicePeer.toString()]: { username: "alex" } });

    const engine = makeLoroHistoryEngine(note);
    const rows = await engine.readHistory("notes", owner, note.id);

    expect(rows.length).toBe(2);
    expect(rows[0].kind).toBe("genesis");
    expect(rows[1].kind).toBe("revert");
  });
});

// ---------------------------------------------------------------------------
// Test 2: feed rows into the REAL buildVersionList and check render count
// ---------------------------------------------------------------------------

describe("makeLoroHistoryEngine + buildVersionList integration", () => {
  it("renderable version count equals the number of edits (genesis is excluded)", async () => {
    const owner = "alex";
    const { note } = buildMultiVersionDoc(owner);

    const engine = makeLoroHistoryEngine(note);
    const rows = await engine.readHistory("notes", owner, note.id);

    // buildVersionList is the real implementation from entity-viewer.ts.
    const now = new Date("2026-05-20T12:00:00Z");
    const model = buildVersionList(rows, now, {}, 1);

    // 2 edits are renderable (genesis is skipped). totalVersions is the
    // non-genesis, non-boundary count.
    expect(model.totalVersions).toBe(2);

    // No compaction in a fresh Loro doc.
    expect(model.summarized).toBeNull();

    // Flatten entries from the nested day/session structure.
    const allEntries = model.days.flatMap((d) =>
      d.sessions.flatMap((s) => s.versions),
    );
    expect(allEntries.length).toBe(2);

    // Both entries attribute to "alex".
    expect(allEntries.every((e) => e.actor === "alex")).toBe(true);

    // The newest entry is marked isHead.
    expect(allEntries[0].isHead).toBe(true);
    expect(allEntries[1].isHead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 3: reconstructState time-travel
// ---------------------------------------------------------------------------

describe("makeLoroHistoryEngine.reconstructState: time-travel proof", () => {
  it("older index returns old content, newest index returns new content", async () => {
    const owner = "alex";
    const { note, firstContent, secondContent } = buildMultiVersionDoc(owner);

    const engine = makeLoroHistoryEngine(note);

    // Index 1 is the first edit (firstContent).
    const canonicalV1 = await engine.reconstructState("notes", owner, note.id, 1);
    expect(typeof canonicalV1).toBe("string");
    expect(canonicalV1.trim().length).toBeGreaterThan(0);

    const projV1 = notesAdapter.projectBody(canonicalV1);
    expect(projV1.body).toContain(firstContent);
    // Should NOT contain second edit content.
    expect(projV1.body).not.toContain(secondContent);

    // Index 2 is the second edit (secondContent).
    const canonicalV2 = await engine.reconstructState("notes", owner, note.id, 2);
    const projV2 = notesAdapter.projectBody(canonicalV2);
    expect(projV2.body).toContain(secondContent);
  });

  it("ignores the headCanonical argument (Loro does not need anchor resolution)", async () => {
    const owner = "alex";
    const { note, firstContent } = buildMultiVersionDoc(owner);

    const engine = makeLoroHistoryEngine(note);

    // Passing a headCanonical must not change the output or throw.
    const withHead = await engine.reconstructState(
      "notes",
      owner,
      note.id,
      1,
      "some-head-canonical",
    );
    const withoutHead = await engine.reconstructState(
      "notes",
      owner,
      note.id,
      1,
    );

    expect(withHead).toBe(withoutHead);
    expect(notesAdapter.projectBody(withHead).body).toContain(firstContent);
  });
});
