// method-tools tests (ai method-tools bot, 2026-06-14).
//
// Tests cover:
//   - ownMethods / resolveMethod / parseTags / uniqueMethodSlug: pure helpers,
//     case-insensitivity, the own-methods-only filter, tag parsing (array OR
//     comma string, de-dup), slug collision bumping.
//   - create_method: describeAction preview, execute writes the body file +
//     records the method with the resolved source path / folder / tags, the
//     excerpt stamp, the navigate seam, and the empty-title guard.
//   - update_method: describeAction preview, execute builds the MethodUpdate
//     (rename / replace-tags / folder), the empty-string clears, the
//     nothing-to-update guard, and the not-an-own-method error path.
//
// All tests stub methodToolsDeps (the injectable seam), so no real folder or
// local-api is involved. These tools WRITE real data, so the actual create /
// update needs Grant's :3000 pass; here we pin the wiring + the args each api
// method receives.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  methodToolsDeps,
  ownMethods,
  resolveMethod,
  ownMethodNames,
  parseTags,
  uniqueMethodSlug,
  createMethodTool,
  updateMethodTool,
  editMethodTool,
} from "../tools/method-tools";
import type { Method } from "@/lib/types";

function makeMethod(over: Partial<Method> = {}): Method {
  return {
    id: 5,
    name: "Colony PCR",
    source_path: "methods/colony-pcr/colony-pcr.md",
    method_type: "markdown",
    folder_path: "PCR",
    parent_method_id: null,
    tags: ["pcr"],
    is_public: false,
    created_by: "testuser",
    owner: "testuser",
    shared_with: [],
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("ownMethods / resolveMethod", () => {
  const methods = [
    makeMethod({ id: 5, name: "Colony PCR" }),
    makeMethod({ id: 6, name: "Shared protocol", is_shared_with_me: true }),
  ];
  it("filters out methods shared WITH the user", () => {
    expect(ownMethods(methods).map((m) => m.id)).toEqual([5]);
  });
  it("resolves an own method by id and by name (case-insensitive)", () => {
    expect(resolveMethod(methods, 5)?.name).toBe("Colony PCR");
    expect(resolveMethod(methods, "colony pcr")?.id).toBe(5);
  });
  it("never resolves a shared-with-me method", () => {
    expect(resolveMethod(methods, 6)).toBeNull();
    expect(resolveMethod(methods, "Shared protocol")).toBeNull();
  });
  it("returns null for an empty / missing ref", () => {
    expect(resolveMethod(methods, "")).toBeNull();
    expect(resolveMethod(methods, undefined)).toBeNull();
  });
  it("ownMethodNames lists only owned method names", () => {
    expect(ownMethodNames(methods)).toEqual(["Colony PCR"]);
  });
});

describe("parseTags", () => {
  it("parses a comma string, trimming and dropping empties", () => {
    expect(parseTags("qpcr, cloning , ,fumigatus")).toEqual([
      "qpcr",
      "cloning",
      "fumigatus",
    ]);
  });
  it("parses a real array", () => {
    expect(parseTags(["a", "b"])).toEqual(["a", "b"]);
  });
  it("de-duplicates case-insensitively, keeping first casing", () => {
    expect(parseTags("PCR, pcr, Pcr")).toEqual(["PCR"]);
  });
  it("returns [] for empty / non-string-or-array input", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(42)).toEqual([]);
  });
});

describe("uniqueMethodSlug", () => {
  it("uses the bare title slug when free", () => {
    expect(uniqueMethodSlug("Gibson Assembly", [])).toBe("gibson-assembly");
  });
  it("bumps a numeric suffix on collision with an existing method dir", () => {
    const methods = [makeMethod({ source_path: "methods/colony-pcr/colony-pcr.md" })];
    expect(uniqueMethodSlug("Colony PCR", methods)).toBe("colony-pcr-2");
  });
});

// ---------------------------------------------------------------------------
// create_method
// ---------------------------------------------------------------------------

describe("create_method tool", () => {
  it("is a gated action, not destructive", () => {
    expect(createMethodTool.action).toBe(true);
    expect(createMethodTool.isDestructive?.({})).toBe(false);
    expect(typeof createMethodTool.describeAction).toBe("function");
  });

  it("describeAction summarizes title, folder, and tags", () => {
    const { summary } = createMethodTool.describeAction!({
      title: "Colony PCR",
      folder: "PCR",
      tags: "qpcr, cloning",
    });
    expect(summary).toContain('create method "Colony PCR"');
    expect(summary).toContain('in "PCR"');
    expect(summary).toContain("qpcr, cloning");
  });

  it("writes the body file then records the method with resolved fields", async () => {
    vi.spyOn(methodToolsDeps, "listMethods").mockResolvedValue([]);
    const writeFile = vi
      .spyOn(methodToolsDeps, "writeFile")
      .mockResolvedValue({ path: "x", sha: "y" });
    const createMethod = vi
      .spyOn(methodToolsDeps, "createMethod")
      .mockResolvedValue(makeMethod({ id: 9, name: "Colony PCR", folder_path: "PCR", tags: ["qpcr"] }));
    const navigate = vi.spyOn(methodToolsDeps, "navigate").mockImplementation(() => {});

    const result = (await createMethodTool.execute({
      title: "Colony PCR",
      body: "1. Pick a colony\n2. Add to mix",
      folder: "PCR",
      tags: "qpcr",
    })) as { ok: boolean; id: number };

    expect(result.ok).toBe(true);
    expect(result.id).toBe(9);

    // Body file written under methods/<slug>/<slug>.md with the user's body in it.
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = writeFile.mock.calls[0];
    expect(path).toBe("methods/colony-pcr/colony-pcr.md");
    expect(content).toContain("1. Pick a colony");

    // Record created as a private markdown method with folder + parsed tags + excerpt.
    expect(createMethod).toHaveBeenCalledTimes(1);
    const data = createMethod.mock.calls[0][0];
    expect(data.name).toBe("Colony PCR");
    expect(data.source_path).toBe("methods/colony-pcr/colony-pcr.md");
    expect(data.method_type).toBe("markdown");
    expect(data.folder_path).toBe("PCR");
    expect(data.tags).toEqual(["qpcr"]);
    expect(typeof data.excerpt).toBe("string");

    // Navigates to the new method's deep link.
    expect(navigate).toHaveBeenCalledWith("/methods?openMethod=9");
  });

  it("errors on an empty title without writing anything", async () => {
    const writeFile = vi.spyOn(methodToolsDeps, "writeFile");
    const result = (await createMethodTool.execute({ title: "   " })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/title is required/i);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// update_method
// ---------------------------------------------------------------------------

describe("update_method tool", () => {
  it("is a gated action, not destructive", () => {
    expect(updateMethodTool.action).toBe(true);
    expect(updateMethodTool.isDestructive?.({})).toBe(false);
  });

  it("describeAction summarizes rename, tags, and folder changes", () => {
    const { summary } = updateMethodTool.describeAction!({
      method: "Colony PCR",
      title: "Colony PCR v2",
      tags: "qpcr, fumigatus",
      folder: "Cloning",
    });
    expect(summary).toContain('update method "Colony PCR"');
    expect(summary).toContain('rename to "Colony PCR v2"');
    expect(summary).toContain("set tags qpcr, fumigatus");
    expect(summary).toContain('file under "Cloning"');
  });

  it("builds the MethodUpdate (rename, replace tags, folder) and navigates", async () => {
    vi.spyOn(methodToolsDeps, "listMethods").mockResolvedValue([
      makeMethod({ id: 5, name: "Colony PCR" }),
    ]);
    const updateMethod = vi
      .spyOn(methodToolsDeps, "updateMethod")
      .mockResolvedValue(makeMethod({ id: 5, name: "Colony PCR v2", tags: ["qpcr"], folder_path: "Cloning" }));
    const navigate = vi.spyOn(methodToolsDeps, "navigate").mockImplementation(() => {});

    const result = (await updateMethodTool.execute({
      method: "colony pcr",
      title: "Colony PCR v2",
      tags: "qpcr",
      folder: "Cloning",
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(updateMethod).toHaveBeenCalledTimes(1);
    const [id, data] = updateMethod.mock.calls[0];
    expect(id).toBe(5);
    expect(data).toEqual({ name: "Colony PCR v2", tags: ["qpcr"], folder_path: "Cloning" });
    expect(navigate).toHaveBeenCalledWith("/methods?openMethod=5");
  });

  it("clears tags and folder on an explicit empty string", async () => {
    vi.spyOn(methodToolsDeps, "listMethods").mockResolvedValue([makeMethod({ id: 5 })]);
    const updateMethod = vi
      .spyOn(methodToolsDeps, "updateMethod")
      .mockResolvedValue(makeMethod({ id: 5, tags: [], folder_path: null }));
    vi.spyOn(methodToolsDeps, "navigate").mockImplementation(() => {});

    await updateMethodTool.execute({ method: 5, tags: "", folder: "" });
    expect(updateMethod.mock.calls[0][1]).toEqual({ tags: [], folder_path: null });
  });

  it("guards nothing-to-update", async () => {
    vi.spyOn(methodToolsDeps, "listMethods").mockResolvedValue([makeMethod({ id: 5 })]);
    const updateMethod = vi.spyOn(methodToolsDeps, "updateMethod");
    const result = (await updateMethodTool.execute({ method: 5 })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing to update/i);
    expect(updateMethod).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// edit_method (body)
// ---------------------------------------------------------------------------

describe("edit_method tool", () => {
  it("is a gated action, not destructive", () => {
    expect(editMethodTool.action).toBe(true);
    expect(editMethodTool.isDestructive?.({})).toBe(false);
  });

  it("appends the content to the current body and re-stamps the excerpt", async () => {
    vi.spyOn(methodToolsDeps, "listMethods").mockResolvedValue([
      makeMethod({ id: 5, name: "Colony PCR", source_path: "methods/colony-pcr/colony-pcr.md" }),
    ]);
    vi.spyOn(methodToolsDeps, "readFile").mockResolvedValue("# Colony PCR\n\n1. Pick a colony");
    const writeFile = vi.spyOn(methodToolsDeps, "writeFile").mockResolvedValue({ path: "x", sha: "y" });
    const updateMethod = vi.spyOn(methodToolsDeps, "updateMethod").mockResolvedValue(makeMethod({ id: 5 }));
    vi.spyOn(methodToolsDeps, "navigate").mockImplementation(() => {});

    const result = (await editMethodTool.execute({
      method: "Colony PCR",
      content: "2. Add a wash step",
    })) as { ok: boolean; mode: string };

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("append");
    const [path, body] = writeFile.mock.calls[0];
    expect(path).toBe("methods/colony-pcr/colony-pcr.md");
    expect(body).toContain("1. Pick a colony"); // kept the old body
    expect(body).toContain("2. Add a wash step"); // appended the new
    // Excerpt re-stamped.
    expect(updateMethod).toHaveBeenCalledWith(5, { excerpt: expect.any(String) });
  });

  it("replace mode rewrites the body without the old content", async () => {
    vi.spyOn(methodToolsDeps, "listMethods").mockResolvedValue([
      makeMethod({ id: 5, name: "Colony PCR", source_path: "methods/colony-pcr/colony-pcr.md" }),
    ]);
    vi.spyOn(methodToolsDeps, "readFile").mockResolvedValue("OLD BODY");
    const writeFile = vi.spyOn(methodToolsDeps, "writeFile").mockResolvedValue({ path: "x", sha: "y" });
    vi.spyOn(methodToolsDeps, "updateMethod").mockResolvedValue(makeMethod({ id: 5 }));
    vi.spyOn(methodToolsDeps, "navigate").mockImplementation(() => {});

    await editMethodTool.execute({ method: 5, mode: "replace", content: "FRESH PROTOCOL" });
    const body = writeFile.mock.calls[0][1];
    expect(body).toContain("FRESH PROTOCOL");
    expect(body).not.toContain("OLD BODY");
  });

  it("declines a non-markdown method", async () => {
    vi.spyOn(methodToolsDeps, "listMethods").mockResolvedValue([
      makeMethod({ id: 5, name: "PCR kit", method_type: "pdf", source_path: "methods/pcr/x.pdf" }),
    ]);
    const writeFile = vi.spyOn(methodToolsDeps, "writeFile");
    const result = (await editMethodTool.execute({ method: 5, content: "x" })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pdf method/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("errors with the user's real method names when the ref misses", async () => {
    vi.spyOn(methodToolsDeps, "listMethods").mockResolvedValue([
      makeMethod({ id: 5, name: "Colony PCR" }),
    ]);
    const result = (await updateMethodTool.execute({ method: "Western blot", title: "x" })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Colony PCR");
  });
});
