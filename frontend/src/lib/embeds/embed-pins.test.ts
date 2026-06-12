// Coverage for the embed-pins sidecar layer + snapshot capture (markdown embed
// hybrid P7-1a).
//
// The sidecar access layer is exercised against an in-memory fileService mock, so
// the put / get / remove round-trip, the missing-file default, and the
// malformed-file default are all proven without touching disk. snapshotEmbed is
// exercised with bakeOne + the per-type loaders mocked, so the assertions cover the
// snapshot + identity wiring, not the bakers themselves (those are tested in
// bake-embeds' own suite).

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { BakedEmbed } from "@/lib/export/bake-embeds";
import type { EmbedDescriptor } from "@/lib/references";

// ── In-memory fileService ──────────────────────────────────────────────────────

const store = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      return store.has(path) ? store.get(path) : null;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      // Round-trip through JSON to mirror the real write/read boundary.
      store.set(path, JSON.parse(JSON.stringify(data)));
    }),
  },
}));

// ── bakeOne + loaders + identity, mocked ───────────────────────────────────────

const fakeBaked: BakedEmbed = {
  kind: "image",
  dataUrl: "data:image/png;base64,AAAA",
  width: 100,
  height: 80,
  caption: "Cap",
  label: null,
};

vi.mock("@/lib/export/bake-embeds", () => ({
  bakeOne: vi.fn(async () => fakeBaked),
}));

vi.mock("@/lib/chemistry/api", () => ({
  moleculesApi: { get: vi.fn(async () => ({ meta: { inchikey: "ABCDEF-INCHI" } })) },
}));

vi.mock("@/lib/local-api", () => ({
  sequencesApi: { get: vi.fn(async () => null) },
  notesApi: { get: vi.fn(async () => null) },
  methodsApi: { get: vi.fn(async () => null) },
  projectsApi: { get: vi.fn(async () => null) },
  tasksApi: { get: vi.fn(async () => null) },
}));

vi.mock("@/lib/sharing/portable-identity", () => ({
  // The real function reads `inchikey` off the molecule meta; mirror that so the
  // wiring assertion is honest.
  portableIdentityFor: vi.fn((type: string, record: unknown) => {
    if (type === "molecule") {
      const m = record as { inchikey?: string };
      return m?.inchikey ?? null;
    }
    return null;
  }),
}));

import {
  readPins,
  getPin,
  putPin,
  removePin,
  updatePin,
  snapshotEmbed,
  buildPin,
  pinsSidecarForBasePath,
  pinsSidecarForNoteJson,
  type EmbedPin,
} from "./embed-pins";

const SIDECAR = "users/alex/notes/3/notes.ros-embeds.json";

function samplePin(overrides: Partial<EmbedPin> = {}): EmbedPin {
  return {
    pinnedAt: "2026-06-12T00:00:00.000Z",
    type: "molecule",
    id: "7",
    view: "card",
    identity: "ABCDEF-INCHI",
    snapshot: fakeBaked,
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
});

describe("sidecar access layer", () => {
  it("returns the empty default for a missing file", async () => {
    const file = await readPins(SIDECAR);
    expect(file).toEqual({ version: 1, pins: {} });
    expect(await getPin(SIDECAR, "s_nope")).toBeNull();
  });

  it("round-trips put / get / remove", async () => {
    const pin = samplePin();
    const id = await putPin(SIDECAR, pin);
    expect(id).toMatch(/^s_[a-z0-9]{6}$/);

    const got = await getPin(SIDECAR, id);
    expect(got).toEqual(pin);

    await removePin(SIDECAR, id);
    expect(await getPin(SIDECAR, id)).toBeNull();
    // The file still exists and is valid, just empty.
    expect(await readPins(SIDECAR)).toEqual({ version: 1, pins: {} });
  });

  it("merges multiple pins without clobbering", async () => {
    const a = await putPin(SIDECAR, samplePin({ id: "1" }));
    const b = await putPin(SIDECAR, samplePin({ id: "2" }));
    expect(a).not.toBe(b);
    const file = await readPins(SIDECAR);
    expect(Object.keys(file.pins).sort()).toEqual([a, b].sort());
    // Removing one leaves the other.
    await removePin(SIDECAR, a);
    expect(await getPin(SIDECAR, a)).toBeNull();
    expect(await getPin(SIDECAR, b)).not.toBeNull();
  });

  it("returns the empty default for a malformed file", async () => {
    store.set(SIDECAR, { not: "a pins file" });
    expect(await readPins(SIDECAR)).toEqual({ version: 1, pins: {} });
    // A wrong version also collapses to the default.
    store.set(SIDECAR, { version: 99, pins: {} });
    expect(await readPins(SIDECAR)).toEqual({ version: 1, pins: {} });
  });

  it("removePin on a missing id is a silent no-op", async () => {
    await expect(removePin(SIDECAR, "s_ghost")).resolves.toBeUndefined();
  });
});

describe("updatePin (P7-1b Re-pin)", () => {
  it("replaces a pin in place, KEEPING the same short id", async () => {
    const id = await putPin(SIDECAR, samplePin({ pinnedAt: "2026-01-01T00:00:00.000Z" }));

    const refreshed = samplePin({
      pinnedAt: "2026-06-12T12:00:00.000Z",
      identity: "NEWKEY-INCHI",
      snapshot: { ...fakeBaked, caption: "Refreshed" },
    });
    await updatePin(SIDECAR, id, refreshed);

    // Same id, refreshed fields.
    const got = await getPin(SIDECAR, id);
    expect(got).toEqual(refreshed);
    expect(got?.pinnedAt).toBe("2026-06-12T12:00:00.000Z");
    expect(got?.identity).toBe("NEWKEY-INCHI");

    // The map still has exactly one pin under exactly that id (no new id minted).
    const file = await readPins(SIDECAR);
    expect(Object.keys(file.pins)).toEqual([id]);
  });

  it("does not clobber sibling pins when updating one", async () => {
    const a = await putPin(SIDECAR, samplePin({ id: "a" }));
    const b = await putPin(SIDECAR, samplePin({ id: "b" }));
    await updatePin(SIDECAR, a, samplePin({ id: "a", identity: "CHANGED" }));
    expect((await getPin(SIDECAR, a))?.identity).toBe("CHANGED");
    // Sibling b is untouched.
    expect((await getPin(SIDECAR, b))?.identity).toBe("ABCDEF-INCHI");
  });

  it("adds the pin under the exact id when the sidecar is missing", async () => {
    // Re-pin against a fragment id whose sidecar entry is gone: write it back under
    // that same id rather than minting a fresh one.
    await updatePin(SIDECAR, "s_keepme", samplePin({ identity: "RESTORED" }));
    const got = await getPin(SIDECAR, "s_keepme");
    expect(got?.identity).toBe("RESTORED");
    expect(Object.keys((await readPins(SIDECAR)).pins)).toEqual(["s_keepme"]);
  });
});

describe("snapshotEmbed + buildPin", () => {
  const molDescriptor: EmbedDescriptor = {
    type: "molecule",
    id: "7",
    view: "card",
    isEmbed: true,
    opts: {},
  };

  it("bakes the snapshot and computes the identity", async () => {
    const { snapshot, identity } = await snapshotEmbed(molDescriptor, "Aspirin");
    expect(snapshot).toEqual(fakeBaked);
    expect(identity).toBe("ABCDEF-INCHI");
  });

  it("buildPin assembles a complete pin with metadata", async () => {
    const pin = await buildPin(molDescriptor, "Aspirin");
    expect(pin.type).toBe("molecule");
    expect(pin.id).toBe("7");
    expect(pin.view).toBe("card");
    expect(pin.identity).toBe("ABCDEF-INCHI");
    expect(pin.snapshot).toEqual(fakeBaked);
    // pinnedAt is a valid ISO timestamp.
    expect(Number.isNaN(new Date(pin.pinnedAt).getTime())).toBe(false);
  });

  it("identity is null when the type carries none (file)", async () => {
    const fileDescriptor: EmbedDescriptor = {
      type: "file",
      id: "x",
      view: "file",
      isEmbed: true,
      opts: {},
    };
    const { identity } = await snapshotEmbed(fileDescriptor, "doc.pdf");
    expect(identity).toBeNull();
  });
});

describe("sidecar path conventions", () => {
  it("derives the basePath form", () => {
    expect(pinsSidecarForBasePath("users/alex/results/task-5", "results")).toBe(
      "users/alex/results/task-5/results.ros-embeds.json",
    );
    // Trailing slash is normalized.
    expect(pinsSidecarForBasePath("users/alex/results/task-5/", "notes")).toBe(
      "users/alex/results/task-5/notes.ros-embeds.json",
    );
  });

  it("derives the note-json form", () => {
    expect(pinsSidecarForNoteJson("users/alex/notes/3.json")).toBe(
      "users/alex/notes/3.ros-embeds.json",
    );
    // A path with no .json gets the suffix appended.
    expect(pinsSidecarForNoteJson("users/alex/notes/3")).toBe(
      "users/alex/notes/3.ros-embeds.json",
    );
  });
});
