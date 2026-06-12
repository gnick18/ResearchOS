import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Method } from "@/lib/types";

// Capture the payloads handed to the create APIs so each test can assert what
// the fork cloned. forkMethod is pure orchestration over these, so mocking the
// API + file layer is enough to lock the per-type behavior.
const created: Record<string, unknown>[] = [];
const pcrCreated: Record<string, unknown>[] = [];
const writes: { path: string; content: string }[] = [];
const blobWrites: string[] = [];

vi.mock("@/lib/local-api", () => {
  const passthroughCreate = () => vi.fn(async () => ({ id: 999 }));
  return {
    methodsApi: {
      create: vi.fn(async (data: Record<string, unknown>) => {
        created.push(data);
        return { ...data, id: 100, owner: "me" };
      }),
    },
    pcrApi: {
      get: vi.fn(async () => ({
        gradient: { stages: ["G"] },
        ingredients: [{ name: "Taq" }],
        notes: "keep cold",
      })),
      create: vi.fn(async (data: Record<string, unknown>) => {
        pcrCreated.push(data);
        return { id: 42 };
      }),
    },
    lcGradientApi: { get: vi.fn(), create: passthroughCreate() },
    plateApi: { get: vi.fn(), create: passthroughCreate() },
    cellCultureApi: { get: vi.fn(), create: passthroughCreate() },
    massSpecApi: { get: vi.fn(), create: passthroughCreate() },
    codingWorkflowApi: { get: vi.fn(), create: passthroughCreate() },
    qpcrAnalysisApi: { get: vi.fn(), create: passthroughCreate() },
    filesApi: {
      readFile: vi.fn(async (path: string) => ({
        path,
        content: "# Protocol body",
        sha: "x",
        html_url: "",
      })),
      writeFile: vi.fn(async (path: string, content: string) => {
        writes.push({ path, content });
        return { path, sha: "y" };
      }),
    },
  };
});

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    fileExists: vi.fn(async () => false),
    readFileAsBlob: vi.fn(async () => new Blob(["pdf-bytes"])),
    writeFileFromBlob: vi.fn(async (path: string) => {
      blobWrites.push(path);
    }),
  },
}));

import { forkMethod } from "./fork-method";

function method(partial: Partial<Method>): Method {
  return {
    id: 1,
    name: "Base",
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    owner: "",
    shared_with: [],
    created_by: "me",
    ...partial,
  } as Method;
}

beforeEach(() => {
  created.length = 0;
  pcrCreated.length = 0;
  writes.length = 0;
  blobWrites.length = 0;
});

describe("forkMethod", () => {
  it("clones a markdown body into a new unique file and links the fork", async () => {
    const src = method({
      id: 5,
      name: "Phusion PCR",
      method_type: "markdown",
      source_path: "methods/phusion/phusion.md",
      folder_path: "Molecular Biology",
      tags: ["pcr"],
    });
    await forkMethod(src, "Phusion PCR GC-rich");

    // Body copied verbatim to a slugged path derived from the new name.
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("methods/phusion-pcr-gc-rich/phusion-pcr-gc-rich.md");
    expect(writes[0].content).toBe("# Protocol body");

    // The new method points at the cloned file, links back to the source, is
    // private, and inherits the source's folder.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: "Phusion PCR GC-rich",
      source_path: "methods/phusion-pcr-gc-rich/phusion-pcr-gc-rich.md",
      method_type: "markdown",
      folder_path: "Molecular Biology",
      parent_method_id: 5,
      is_public: false,
    });
  });

  it("clones a PCR protocol into a NEW protocol record (no shared edits)", async () => {
    const src = method({
      id: 9,
      name: "qPCR",
      method_type: "pcr",
      source_path: "pcr://protocol/7",
      owner: "alice",
    });
    await forkMethod(src, "qPCR variant");

    // A fresh protocol was created from the source's content.
    expect(pcrCreated).toHaveLength(1);
    expect(pcrCreated[0]).toMatchObject({
      name: "qPCR variant",
      notes: "keep cold",
      is_public: false,
    });
    // The fork points at the NEW protocol id, not the source's.
    expect(created[0]).toMatchObject({
      source_path: "pcr://protocol/42",
      parent_method_id: 9,
    });
  });

  it("copies the component references for a compound and keeps source_path null", async () => {
    const src = method({
      id: 3,
      name: "Cloning kit",
      method_type: "compound",
      source_path: null,
      components: [{ method_id: 1, owner: null, ordering: 0 }],
    });
    await forkMethod(src, "Cloning kit v2");

    expect(created[0]).toMatchObject({
      source_path: null,
      method_type: "compound",
      parent_method_id: 3,
      components: [{ method_id: 1, owner: null, ordering: 0 }],
    });
  });

  it("rejects an empty name", async () => {
    await expect(forkMethod(method({ id: 1 }), "   ")).rejects.toThrow(/name/i);
  });
});
