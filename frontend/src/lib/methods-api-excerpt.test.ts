// frontend/src/lib/methods-api-excerpt.test.ts
//
// Method Picker FLAG B (excerpt-field sub-bot of HR): the optional `excerpt`
// field threads through `methodsApi.create` and `methodsApi.update` onto the
// on-disk record verbatim (both spread `...data`; JsonStore writes unknown
// fields through). This pins the create + update pass-through for a markdown
// method (a derived body excerpt) and a structured one (the type-registry
// summary), mirroring the memFs-backed harness in methods-api-create.test.ts.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Method } from "./types";
import { deriveExcerptFromMarkdown, excerptForStructuredType } from "./methods/excerpt";

const memFs = new Map<string, unknown>();

vi.mock("./file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

import { methodsApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

beforeEach(() => {
  memFs.clear();
  clearCurrentUserCache();
});

describe("methodsApi excerpt pass-through", () => {
  it("create carries a derived excerpt for a markdown method onto disk", async () => {
    const excerpt = deriveExcerptFromMarkdown(
      "# My Method\nDigest genomic DNA with EcoRI for 1 hour at 37C.",
    );
    expect(excerpt).toContain("Digest genomic DNA");

    const result = await methodsApi.create({
      name: "markdown w/ excerpt",
      source_path: "methods/md/md.md",
      method_type: "markdown",
      shared_with: [],
      excerpt,
    });

    expect(result.excerpt).toBe(excerpt);
    const persisted = memFs.get(`users/alex/methods/${result.id}.json`) as Method;
    expect(persisted.excerpt).toBe(excerpt);
  });

  it("create carries the registry summary for a structured method onto disk", async () => {
    const excerpt = excerptForStructuredType("pcr");
    const result = await methodsApi.create({
      name: "pcr w/ excerpt",
      source_path: "pcr://protocol/9",
      method_type: "pcr",
      shared_with: [],
      excerpt,
    });

    expect(result.excerpt).toBe(excerpt);
    const persisted = memFs.get(`users/alex/methods/${result.id}.json`) as Method;
    expect(persisted.excerpt).toBe(excerpt);
  });

  it("omitting excerpt leaves it unset on the persisted record (PDF / compound)", async () => {
    const result = await methodsApi.create({
      name: "pdf no excerpt",
      source_path: "methods/pdf/proto.pdf",
      method_type: "pdf",
      shared_with: [],
    });

    expect(result.excerpt).toBeUndefined();
    const persisted = memFs.get(`users/alex/methods/${result.id}.json`) as Method;
    expect(persisted.excerpt).toBeUndefined();
  });

  it("update re-stamps a fresh excerpt onto the persisted record", async () => {
    const created = await methodsApi.create({
      name: "editable markdown",
      source_path: "methods/edit/edit.md",
      method_type: "markdown",
      shared_with: [],
      excerpt: deriveExcerptFromMarkdown("# Edit\nOriginal body line."),
    });

    const nextExcerpt = deriveExcerptFromMarkdown(
      "# Edit\nRevised body line after the user edited the source.",
    );
    expect(nextExcerpt).not.toBe(created.excerpt);

    const updated = await methodsApi.update(created.id, { excerpt: nextExcerpt });
    expect(updated?.excerpt).toBe(nextExcerpt);

    const persisted = memFs.get(`users/alex/methods/${created.id}.json`) as Method;
    expect(persisted.excerpt).toBe(nextExcerpt);
  });
});
