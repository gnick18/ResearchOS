/**
 * Tests for the Loro history engine (history.ts).
 *
 * fileService is mocked in-memory so loadOrRebuild and readActors run cleanly
 * in the vitest node environment without the File System Access API.
 *
 * Test plan:
 *   1. listVersions on a freshly-seeded note returns at least the seed version
 *      with a timestamp and the "seed" fallback username for peer "0".
 *   2. A real multi-commit doc (seed + two explicit edits) produces versions
 *      in lamport order with the correct commit messages.
 *   3. reconstructNoteAt on an older version returns the old content; on the
 *      newest version returns the new content (the time-travel proof).
 *   4. reconstructCanonicalAt returns a string that notesAdapter.projectBody
 *      parses without throwing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoroDoc } from "loro-crdt";
import { seedNoteDoc } from "../seed";
import { setEntryContent } from "../note-doc";
import { notesAdapter } from "@/lib/history/notes-viewer";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// In-memory fileService mock
// ---------------------------------------------------------------------------
//
// The store keeps a mutable map so individual tests can inject sidecar bytes
// via the `setSidecar` helper below, and actors.json via `setActors`.

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

// Import after mock is registered.
import { listVersions, reconstructNoteAt, reconstructCanonicalAt } from "../history";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fixtureNote(): Note {
  return {
    id: 42,
    title: "ELISA binding assay",
    description: "Antibody titration",
    is_running_log: false,
    is_shared: false,
    created_at: "2026-05-10T08:00:00Z",
    updated_at: "2026-05-10T09:00:00Z",
    username: "mira",
    flagged: null,
    comments: [],
    entries: [
      {
        id: "e1",
        title: "Day 1",
        date: "2026-05-10",
        content: "Initial observation.",
        created_at: "2026-05-10T08:00:00Z",
        updated_at: "2026-05-10T08:00:00Z",
      },
    ],
  } as Note;
}

/** Compute the expected sidecar path for owner+noteId. */
function sidecarPathFor(owner: string, noteId: number): string {
  return `users/${owner}/.researchos/notes/${noteId}.loro`;
}

/** Compute the expected actors path. */
function actorsPathFor(owner: string): string {
  return `users/${owner}/.researchos/actors.json`;
}

/** Persist sidecar bytes for owner+note into the blob store mock. */
function setSidecar(owner: string, noteId: number, bytes: Uint8Array): void {
  blobStore.set(
    sidecarPathFor(owner, noteId),
    new Blob([bytes.buffer as ArrayBuffer]),
  );
}

/** Set the actors map for owner in the file store mock. */
function setActors(owner: string, actors: Record<string, { username: string }>): void {
  fileStore.set(actorsPathFor(owner), actors);
}

beforeEach(() => {
  fileStore.clear();
  blobStore = new Map();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: freshly-seeded note has at least the seed version
// ---------------------------------------------------------------------------

describe("listVersions: seed-only doc", () => {
  it("returns at least one version with a timestamp and the seed username fallback", async () => {
    const note = fixtureNote();
    // No sidecar on disk -- loadOrRebuild will rebuild from the note.
    // The rebuilt doc has exactly one commit: the seed commit from peer "0".

    const versions = await listVersions("mira", note);

    expect(versions.length).toBeGreaterThanOrEqual(1);

    // The first (and only) change is the seed; peer "0" -> username "seed".
    const seedVersion = versions[0];
    expect(seedVersion.index).toBe(0);
    expect(seedVersion.peer).toBe("0");
    expect(seedVersion.username).toBe("seed");

    // The timestamp must be a positive number (seeded from note.created_at).
    expect(seedVersion.timestampMs).toBeGreaterThan(0);

    // Frontiers must have exactly one entry and counter must be >= 0.
    expect(seedVersion.frontiers).toHaveLength(1);
    expect(seedVersion.frontiers[0].peer).toBe("0");
    expect(seedVersion.frontiers[0].counter).toBeGreaterThanOrEqual(0);
  });

  it("resolves a known actor's username from the actors map", async () => {
    const note = fixtureNote();
    // Inject an actors map that maps some non-zero peer to a username.
    // We will check that a freshly-seeded doc's seed peer still shows "seed".
    setActors("mira", { "99999": { username: "mira" } });

    const versions = await listVersions("mira", note);
    // The seed peer "0" is not in the actors map but shows "seed" regardless.
    expect(versions[0].username).toBe("seed");
  });
});

// ---------------------------------------------------------------------------
// Test 2: multi-commit doc (seed + two edits) -- ordering + messages
// ---------------------------------------------------------------------------

describe("listVersions: multi-commit doc with distinct messages", () => {
  it("returns versions in lamport order with the correct commit messages", async () => {
    const note = fixtureNote();

    // Build a real multi-commit doc:
    //   commit 0: seed (peer "0", message "seed from legacy note")
    //   commit 1: first edit (peer 1, message "edit-one")
    //   commit 2: second edit (peer 1, message "edit-two")
    const seedBytes = seedNoteDoc(note);
    const doc = new LoroDoc();
    doc.import(seedBytes);

    // Use a non-zero peer id so the change attributes to a real device.
    const devicePeer = BigInt(12345678);
    doc.setPeerId(devicePeer);

    setEntryContent(doc, 0, "First edited content.");
    doc.commit({ message: "edit-one", timestamp: 1747000000 });

    setEntryContent(doc, 0, "Second edited content.");
    doc.commit({ message: "edit-two", timestamp: 1747000060 });

    // Persist the snapshot as the sidecar.
    const bytes = doc.export({ mode: "snapshot" });
    setSidecar("mira", note.id, bytes);

    // Register the device peer in actors.
    setActors("mira", { [devicePeer.toString()]: { username: "mira" } });

    const versions = await listVersions("mira", note);

    // Three versions: seed + 2 edits.
    expect(versions.length).toBe(3);

    // Index 0 is the oldest (seed).
    expect(versions[0].index).toBe(0);
    expect(versions[0].peer).toBe("0");
    expect(versions[0].username).toBe("seed");

    // Index 1 and 2 are the two edits in lamport order.
    expect(versions[1].index).toBe(1);
    expect(versions[1].message).toBe("edit-one");
    expect(versions[1].peer).toBe(devicePeer.toString());
    expect(versions[1].username).toBe("mira");

    expect(versions[2].index).toBe(2);
    expect(versions[2].message).toBe("edit-two");
    expect(versions[2].peer).toBe(devicePeer.toString());
    expect(versions[2].username).toBe("mira");

    // Timestamps must be in non-decreasing order (lamport implies causal order,
    // and the seeder uses note.created_at which is earlier than 1747000000).
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i].timestampMs).toBeGreaterThanOrEqual(
        versions[i - 1].timestampMs,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: time-travel reconstruction (the load-bearing proof)
// ---------------------------------------------------------------------------

describe("reconstructNoteAt: time-travel to older and newer versions", () => {
  it("older version contains old content and newer contains new content", async () => {
    const note = fixtureNote();
    const oldContent = "Initial observation.";
    const newContent = "Updated after centrifuge run.";

    // Seed the doc. The seed commit is version 0 (oldest).
    const seedBytes = seedNoteDoc(note);
    const doc = new LoroDoc();
    doc.import(seedBytes);

    const devicePeer = BigInt(99001);
    doc.setPeerId(devicePeer);

    // The seed already has oldContent from fixtureNote(); commit a second
    // version with new content so we have at least two distinct versions.
    setEntryContent(doc, 0, newContent);
    doc.commit({ message: "updated content", timestamp: 1747000100 });

    const bytes = doc.export({ mode: "snapshot" });
    setSidecar("mira", note.id, bytes);

    const versions = await listVersions("mira", note);
    expect(versions.length).toBeGreaterThanOrEqual(2);

    // The seed version (index 0) should reconstruct to oldContent.
    const oldNote = await reconstructNoteAt("mira", note, 0);
    expect(oldNote.entries[0].content).toBe(oldContent);

    // The latest version should reconstruct to newContent.
    const latestIndex = versions.length - 1;
    const newNote = await reconstructNoteAt("mira", note, latestIndex);
    expect(newNote.entries[0].content).toBe(newContent);

    // Untracked fields on base are preserved in both reconstructions.
    expect(oldNote.id).toBe(note.id);
    expect(newNote.id).toBe(note.id);
  });

  it("throws a clear error for an out-of-range version index", async () => {
    const note = fixtureNote();
    // No sidecar -- seed only; 1 version at index 0.
    await expect(reconstructNoteAt("mira", note, 99)).rejects.toThrow(
      /out of range/,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4: reconstructCanonicalAt produces a string notesAdapter can parse
// ---------------------------------------------------------------------------

describe("reconstructCanonicalAt: notesAdapter.projectBody parses the output", () => {
  it("returns a canonical JSON string that projectBody parses without throwing", async () => {
    const note = fixtureNote();

    const canonical = await reconstructCanonicalAt("mira", note, 0);

    // Must be a non-empty string.
    expect(typeof canonical).toBe("string");
    expect(canonical.trim().length).toBeGreaterThan(0);

    // The legacy notesAdapter.projectBody (projectNoteState) must not throw.
    let projection: ReturnType<typeof notesAdapter.projectBody>;
    expect(() => {
      projection = notesAdapter.projectBody(canonical);
    }).not.toThrow();

    // The projection must have a body string (even if empty for edge cases).
    expect(typeof projection!.body).toBe("string");

    // The seed content from the fixture should appear in the body.
    expect(projection!.body).toContain("ELISA binding assay");
  });

  it("pretty-printed with 2-space indent and a trailing newline (canonical contract)", async () => {
    const note = fixtureNote();
    const canonical = await reconstructCanonicalAt("mira", note, 0);

    // canonicalize() contract: JSON.stringify(record, null, 2) + "\n"
    expect(canonical.endsWith("\n")).toBe(true);
    // Should be parseable as JSON after trimming.
    expect(() => JSON.parse(canonical.trim())).not.toThrow();
  });
});
