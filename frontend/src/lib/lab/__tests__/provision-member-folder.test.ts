// Tests for lib/lab/provision-member-folder.ts
//
// provisionMemberFolder must:
//  - open OPFS and create (or reuse) a managed folder named by labId,
//  - point the file service at THAT new folder before writing settings,
//  - write account_type=member + lab_id into the NEW folder (never the current),
//  - register the managed folder + cache its lab meta + make it active,
//  - degrade gracefully when OPFS is unavailable or structure init fails.
//
// All dependencies are injected, so no real OPFS / fileService / settings write
// runs. The "without overwriting current" guarantee is asserted by ordering: the
// active handle is switched to the new folder BEFORE writeMemberSettings fires.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  provisionMemberFolder,
  managedMemberFolderName,
  type ProvisionMemberFolderDeps,
} from "../provision-member-folder";

function makeHandle(name: string): FileSystemDirectoryHandle {
  return { name, kind: "directory" } as unknown as FileSystemDirectoryHandle;
}

/** A fake OPFS root that records getDirectoryHandle calls and returns a stable
 *  handle per name (so a re-join resolves the same handle). */
function makeFakeOpfsRoot() {
  const calls: Array<{ name: string; create?: boolean }> = [];
  const handles = new Map<string, FileSystemDirectoryHandle>();
  return {
    calls,
    root: {
      getDirectoryHandle: vi.fn(
        async (name: string, opts?: { create?: boolean }) => {
          calls.push({ name, create: opts?.create });
          if (!handles.has(name)) handles.set(name, makeHandle(name));
          return handles.get(name)!;
        },
      ),
    },
  };
}

/** Build a deps object with spies, an OPFS root, and an ordering log so tests can
 *  assert that the active handle is switched BEFORE settings are written. */
function makeDeps(overrides?: Partial<ProvisionMemberFolderDeps>) {
  const { root, calls } = makeFakeOpfsRoot();
  const order: string[] = [];
  const deps: ProvisionMemberFolderDeps = {
    getOpfsRoot: vi.fn(async () => root),
    setActiveHandle: vi.fn((h: FileSystemDirectoryHandle) => {
      order.push(`setActiveHandle:${h.name}`);
    }),
    ensureStructure: vi.fn(async () => {
      order.push("ensureStructure");
      return true;
    }),
    writeMemberSettings: vi.fn(async (username: string, labId: string) => {
      order.push(`writeMemberSettings:${username}:${labId}`);
      return {};
    }),
    registerManaged: vi.fn(
      async (_h: FileSystemDirectoryHandle, labId: string) => {
        order.push(`registerManaged:${labId}`);
        return `folder-${labId}`;
      },
    ),
    ...overrides,
  };
  return { deps, order, opfsCalls: calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("managedMemberFolderName", () => {
  it("derives a stable, sanitized single-segment name from labId", () => {
    expect(managedMemberFolderName("L1")).toBe("lab-member-L1");
    expect(managedMemberFolderName("a/b c.d")).toBe("lab-member-abcd");
    expect(managedMemberFolderName("")).toBe("lab-member-unknown");
  });
});

describe("provisionMemberFolder", () => {
  it("creates the managed OPFS folder keyed by labId and makes it active", async () => {
    const { deps, opfsCalls } = makeDeps();

    const result = await provisionMemberFolder(
      { labId: "LAB1", username: "dana", labName: "Fungal Lab" },
      deps,
    );

    expect(result).toEqual({ ok: true, folderId: "folder-LAB1" });
    // Created with create:true under the labId-derived name.
    expect(opfsCalls).toEqual([{ name: "lab-member-LAB1", create: true }]);
    // Registered as a managed folder with the cached lab meta + name.
    expect(deps.registerManaged).toHaveBeenCalledWith(
      expect.objectContaining({ name: "lab-member-LAB1" }),
      "LAB1",
      "Fungal Lab",
    );
  });

  it("switches the active handle to the NEW folder BEFORE writing settings (does not touch the current folder)", async () => {
    const { deps, order } = makeDeps();

    await provisionMemberFolder({ labId: "LAB2", username: "dana" }, deps);

    // The ordering proves the member identity write lands in the NEW folder: the
    // file service is repointed to the new handle before writeMemberSettings runs.
    const setIdx = order.indexOf("setActiveHandle:lab-member-LAB2");
    const writeIdx = order.indexOf("writeMemberSettings:dana:LAB2");
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(setIdx);
    // ensureStructure runs between the switch and the write.
    const structIdx = order.indexOf("ensureStructure");
    expect(structIdx).toBeGreaterThan(setIdx);
    expect(structIdx).toBeLessThan(writeIdx);
  });

  it("writes account_type=member + lab_id via the injected settings writer", async () => {
    const { deps } = makeDeps();
    await provisionMemberFolder({ labId: "LAB3", username: "dana" }, deps);
    expect(deps.writeMemberSettings).toHaveBeenCalledWith("dana", "LAB3");
  });

  it("returns no-opfs and writes nothing when OPFS is unavailable", async () => {
    const { deps } = makeDeps({ getOpfsRoot: vi.fn(async () => null) });

    const result = await provisionMemberFolder(
      { labId: "LAB4", username: "dana" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-opfs");
    expect(deps.setActiveHandle).not.toHaveBeenCalled();
    expect(deps.writeMemberSettings).not.toHaveBeenCalled();
    expect(deps.registerManaged).not.toHaveBeenCalled();
  });

  it("returns structure-failed and does NOT write settings when init fails", async () => {
    const { deps } = makeDeps({ ensureStructure: vi.fn(async () => false) });

    const result = await provisionMemberFolder(
      { labId: "LAB5", username: "dana" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("structure-failed");
    // The handle is switched (so init could run), but no member identity is
    // written and nothing is registered when init fails.
    expect(deps.writeMemberSettings).not.toHaveBeenCalled();
    expect(deps.registerManaged).not.toHaveBeenCalled();
  });

  it("returns error when a dependency throws", async () => {
    const { deps } = makeDeps({
      writeMemberSettings: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    const result = await provisionMemberFolder(
      { labId: "LAB6", username: "dana" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.message).toContain("disk full");
    }
  });
});
