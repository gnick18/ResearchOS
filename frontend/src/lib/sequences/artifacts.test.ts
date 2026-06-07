// sequence editor master (redesign phase 5). round-trip + cap + delete + stale
// coverage for the per-sequence result-artifacts store. Mocks the same
// `fileService` JSON seam the production store reads/writes (a memFs map keyed
// by path), mirroring enzyme-sets.test.ts.

import { describe, expect, it, beforeEach, vi } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      // simulate a JSON round-trip so we catch anything non-serializable
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

import {
  listArtifacts,
  saveArtifact,
  deleteArtifact,
  isArtifactStale,
  newArtifactId,
  artifactsPath,
  artifactsApi,
  MAX_ARTIFACTS,
  type Artifact,
  type ArtifactsFile,
} from "./artifacts";

const USER = "alex";
const SEQ = 7;
const PATH = `users/${USER}/sequences/${SEQ}.artifacts.json`;

beforeEach(() => {
  memFs.clear();
});

/** Build a minimal valid artifact, overridable per field. */
function makeArtifact(over: Partial<Artifact> = {}): Artifact {
  return {
    id: over.id ?? newArtifactId(),
    type: over.type ?? "alignment",
    title: over.title ?? "Align to pEGFP-N1",
    summary: over.summary ?? "92% identity, 4 gaps",
    createdAt: over.createdAt ?? new Date().toISOString(),
    lineage: over.lineage ?? {
      sequenceId: SEQ,
      sequenceVersion: "v1",
      inputs: { referenceId: 9, algorithm: "global" },
    },
    result: over.result ?? { ok: true },
  };
}

describe("artifacts store", () => {
  it("derives the per-sequence sidecar path", () => {
    expect(artifactsPath(USER, SEQ)).toBe(PATH);
  });

  it("starts empty for a sequence with no sidecar", async () => {
    await expect(listArtifacts(USER, SEQ)).resolves.toEqual([]);
  });

  it("saves an artifact and lists it back (round-trip through disk)", async () => {
    const saved = await saveArtifact(USER, SEQ, makeArtifact({ id: "" }));
    expect(saved.id).toMatch(/^art_/);

    const persisted = memFs.get(PATH) as ArtifactsFile;
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.artifacts).toHaveLength(1);

    const listed = await listArtifacts(USER, SEQ);
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("Align to pEGFP-N1");
    expect(listed[0].result).toEqual({ ok: true });
  });

  it("lists newest first", async () => {
    await saveArtifact(
      USER,
      SEQ,
      makeArtifact({ id: "a", title: "Old", createdAt: "2026-06-01T00:00:00.000Z" }),
    );
    await saveArtifact(
      USER,
      SEQ,
      makeArtifact({ id: "b", title: "New", createdAt: "2026-06-05T00:00:00.000Z" }),
    );
    const listed = await listArtifacts(USER, SEQ);
    expect(listed.map((a) => a.title)).toEqual(["New", "Old"]);
  });

  it("caps the sidecar to MAX_ARTIFACTS, dropping the oldest", async () => {
    for (let i = 0; i < MAX_ARTIFACTS + 5; i++) {
      await saveArtifact(
        USER,
        SEQ,
        makeArtifact({
          id: `a${i}`,
          title: `R${i}`,
          // strictly increasing timestamps so order is deterministic
          createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
        }),
      );
    }
    const listed = await listArtifacts(USER, SEQ);
    expect(listed).toHaveLength(MAX_ARTIFACTS);
    // newest survives, the 5 oldest were dropped
    expect(listed[0].title).toBe(`R${MAX_ARTIFACTS + 4}`);
    expect(listed.some((a) => a.title === "R0")).toBe(false);
    expect(listed.some((a) => a.title === "R4")).toBe(false);
    expect(listed.some((a) => a.title === "R5")).toBe(true);
  });

  it("re-saving the same id updates in place (no duplicate)", async () => {
    await saveArtifact(USER, SEQ, makeArtifact({ id: "x", summary: "first" }));
    await saveArtifact(USER, SEQ, makeArtifact({ id: "x", summary: "second" }));
    const listed = await listArtifacts(USER, SEQ);
    expect(listed).toHaveLength(1);
    expect(listed[0].summary).toBe("second");
  });

  it("deletes an artifact and reports whether one was removed", async () => {
    await saveArtifact(USER, SEQ, makeArtifact({ id: "a" }));
    await saveArtifact(USER, SEQ, makeArtifact({ id: "b" }));
    await expect(deleteArtifact(USER, SEQ, "a")).resolves.toBe(true);
    await expect(deleteArtifact(USER, SEQ, "ghost")).resolves.toBe(false);
    const listed = await listArtifacts(USER, SEQ);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe("b");
  });

  it("artifacts are per-sequence: a different sequence has its own list", async () => {
    await saveArtifact(USER, SEQ, makeArtifact({ id: "a" }));
    await expect(listArtifacts(USER, 99)).resolves.toEqual([]);
    await saveArtifact(USER, 99, makeArtifact({ id: "b", title: "Other" }));
    expect(await listArtifacts(USER, SEQ)).toHaveLength(1);
    expect(await listArtifacts(USER, 99)).toHaveLength(1);
  });

  it("flags an artifact stale only when the live fingerprint differs", () => {
    const art = makeArtifact({
      lineage: { sequenceId: SEQ, sequenceVersion: "abc", inputs: {} },
    });
    expect(isArtifactStale(art, "abc")).toBe(false);
    expect(isArtifactStale(art, "xyz")).toBe(true);
  });

  it("never flags stale when the recorded version is blank", () => {
    const art = makeArtifact({
      lineage: { sequenceId: SEQ, sequenceVersion: "", inputs: {} },
    });
    expect(isArtifactStale(art, "anything")).toBe(false);
  });

  it("drops malformed entries when reading a hand-edited file", async () => {
    memFs.set(PATH, {
      schemaVersion: 1,
      artifacts: [
        { id: "ok", type: "domains", title: "Good", summary: "1 hit", lineage: {} },
        { id: "bad", type: "alignment" }, // no title -> dropped
        { id: "wrongtype", type: "nonsense", title: "X" }, // bad type -> dropped
        null,
        "garbage",
      ],
    });
    const listed = await listArtifacts(USER, SEQ);
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("Good");
  });

  it("concurrent saves in one tick all survive (write serialization)", async () => {
    await Promise.all([
      saveArtifact(USER, SEQ, makeArtifact({ id: "a", title: "A" })),
      saveArtifact(USER, SEQ, makeArtifact({ id: "b", title: "B" })),
      saveArtifact(USER, SEQ, makeArtifact({ id: "c", title: "C" })),
    ]);
    const listed = await listArtifacts(USER, SEQ);
    expect(listed).toHaveLength(3);
    expect(listed.map((a) => a.title).sort()).toEqual(["A", "B", "C"]);
  });

  it("exposes the same operations through artifactsApi", async () => {
    const saved = await artifactsApi.save(USER, SEQ, makeArtifact({ id: "" }));
    expect(await artifactsApi.list(USER, SEQ)).toHaveLength(1);
    await artifactsApi.delete(USER, SEQ, saved.id);
    expect(await artifactsApi.list(USER, SEQ)).toEqual([]);
  });
});
