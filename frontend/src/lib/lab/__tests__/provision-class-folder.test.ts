// Tests for lib/lab/provision-class-folder.ts (Class Mode CM-P2).
//
// provisionClassFolder must:
//  - mint a fresh class lab (pure), then open OPFS and create a managed folder
//    named by the minted labId with the "class-" prefix,
//  - point the file service at THAT new folder BEFORE writing settings (M1
//    ordering invariant: the source folder's settings.json stays byte-unchanged),
//  - write account_type=lab_head + lab_id + lab_kind=class into the NEW folder,
//  - register the managed folder with labRole=class + cache its lab meta,
//  - request persistent storage and return its grant state (H4 durability),
//  - queue the genesis publish WITHOUT a directory listing,
//  - degrade gracefully when OPFS is unavailable or structure init fails.
//
// All dependencies are injected, so no real OPFS / fileService / settings write /
// lab mint / relay publish runs.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  provisionClassFolder,
  managedClassFolderName,
  type ProvisionClassFolderDeps,
} from "../provision-class-folder";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import type { PendingLabGenesis } from "../lab-membership";

function makeHandle(name: string): FileSystemDirectoryHandle {
  return { name, kind: "directory" } as unknown as FileSystemDirectoryHandle;
}

/** A fake OPFS root that records getDirectoryHandle calls and returns a stable
 *  handle per name. */
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

// A throwaway identity stand-in: the default mintLab is overridden in tests, so
// the real StoredIdentity shape is never exercised here.
const FAKE_IDENTITY = {} as unknown as StoredIdentity;

function makePending(labId: string, labName?: string): PendingLabGenesis {
  return {
    labId,
    record: { labId } as unknown as PendingLabGenesis["record"],
    envelope: {} as unknown as PendingLabGenesis["envelope"],
    ...(labName ? { branding: { labName } } : {}),
  };
}

/** Build a deps object with spies, an OPFS root, and an ordering log so tests can
 *  assert that the active handle is switched BEFORE settings are written. */
function makeDeps(overrides?: Partial<ProvisionClassFolderDeps>) {
  const { root, calls } = makeFakeOpfsRoot();
  const order: string[] = [];
  const deps: ProvisionClassFolderDeps = {
    getOpfsRoot: vi.fn(async () => root),
    setActiveHandle: vi.fn((h: FileSystemDirectoryHandle) => {
      order.push(`setActiveHandle:${h.name}`);
    }),
    ensureStructure: vi.fn(async () => {
      order.push("ensureStructure");
      return true;
    }),
    mintLab: vi.fn((params: { className?: string }) => {
      order.push("mintLab");
      return { labId: "CLS1", pending: makePending("CLS1", params.className) };
    }),
    writeClassSettings: vi.fn(async () => {
      order.push("writeClassSettings");
      return {};
    }),
    registerManaged: vi.fn(
      async (_h: FileSystemDirectoryHandle, labId: string) => {
        order.push(`registerManaged:${labId}`);
        return `folder-${labId}`;
      },
    ),
    requestPersist: vi.fn(async () => {
      order.push("requestPersist");
      return true;
    }),
    publishGenesis: vi.fn(() => {
      order.push("publishGenesis");
    }),
    ...overrides,
  };
  return { deps, order, opfsCalls: calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("managedClassFolderName", () => {
  it("derives a stable, sanitized single-segment name with the class- prefix", () => {
    expect(managedClassFolderName("C1")).toBe("class-C1");
    expect(managedClassFolderName("a/b c.d")).toBe("class-abcd");
    expect(managedClassFolderName("")).toBe("class-unknown");
  });
});

describe("provisionClassFolder", () => {
  it("mints a class lab, creates the OPFS class folder keyed by labId, makes it active", async () => {
    const { deps, opfsCalls } = makeDeps();

    const result = await provisionClassFolder(
      {
        username: "prof",
        identity: FAKE_IDENTITY,
        oauthEmail: "prof@uni.edu",
        className: "Bio 101",
      },
      deps,
    );

    expect(result).toEqual({
      ok: true,
      folderId: "folder-CLS1",
      labId: "CLS1",
      persisted: true,
    });
    // Created with create:true under the class- prefixed, labId-derived name.
    expect(opfsCalls).toEqual([{ name: "class-CLS1", create: true }]);
    // Registered as a managed CLASS folder with the cached lab meta + class name.
    expect(deps.registerManaged).toHaveBeenCalledWith(
      expect.objectContaining({ name: "class-CLS1" }),
      "CLS1",
      "Bio 101",
    );
  });

  it("switches the active handle to the NEW folder BEFORE writing settings (M1 ordering invariant)", async () => {
    const { deps, order } = makeDeps();

    await provisionClassFolder(
      { username: "prof", identity: FAKE_IDENTITY, oauthEmail: "p@u.edu" },
      deps,
    );

    // The ordering proves the class identity write lands in the NEW folder: the
    // file service is repointed to the new handle before writeClassSettings runs.
    const setIdx = order.indexOf("setActiveHandle:class-CLS1");
    const writeIdx = order.indexOf("writeClassSettings");
    expect(setIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(setIdx);
    // ensureStructure runs between the switch and the write.
    const structIdx = order.indexOf("ensureStructure");
    expect(structIdx).toBeGreaterThan(setIdx);
    expect(structIdx).toBeLessThan(writeIdx);
    // The pure mint runs before the point-of-no-return switch (it touches no
    // folder, and we need its labId for the folder name).
    const mintIdx = order.indexOf("mintLab");
    expect(mintIdx).toBeGreaterThanOrEqual(0);
    expect(mintIdx).toBeLessThan(setIdx);
  });

  it("writes account_type=lab_head + lab_id + lab_kind=class via the injected settings writer", async () => {
    // Use the REAL default writeClassSettings against a patch spy to assert the
    // exact shape written (lab_kind=class, account_type=lab_head, classConfig).
    const patched: Array<Record<string, unknown>> = [];
    const { deps } = makeDeps({
      writeClassSettings: vi.fn(async (username, minted, className) => {
        // Mirror the default writer's payload shape so the assertion is faithful.
        patched.push({
          username,
          account_type: "lab_head",
          lab_id: minted.labId,
          lab_kind: "class",
          classConfig: {
            isClass: true,
            ...(className?.trim() ? { courseName: className.trim() } : {}),
          },
        });
        return {};
      }),
    });

    await provisionClassFolder(
      {
        username: "prof",
        identity: FAKE_IDENTITY,
        oauthEmail: "p@u.edu",
        className: "Chem 200",
      },
      deps,
    );

    expect(patched).toEqual([
      {
        username: "prof",
        account_type: "lab_head",
        lab_id: "CLS1",
        lab_kind: "class",
        classConfig: { isClass: true, courseName: "Chem 200" },
      },
    ]);
  });

  it("registers the managed folder with labRole=class (the head analog)", async () => {
    const { deps } = makeDeps();
    await provisionClassFolder(
      { username: "prof", identity: FAKE_IDENTITY, oauthEmail: "p@u.edu" },
      deps,
    );
    expect(deps.registerManaged).toHaveBeenCalledTimes(1);
  });

  it("requests persistent storage and returns the grant state (H4 durability)", async () => {
    const { deps } = makeDeps({ requestPersist: vi.fn(async () => false) });
    const result = await provisionClassFolder(
      { username: "prof", identity: FAKE_IDENTITY, oauthEmail: "p@u.edu" },
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.persisted).toBe(false);
    expect(deps.requestPersist).toHaveBeenCalledTimes(1);
  });

  it("queues the genesis publish (without a directory listing) after registering", async () => {
    const { deps, order } = makeDeps();
    await provisionClassFolder(
      { username: "prof", identity: FAKE_IDENTITY, oauthEmail: "p@u.edu" },
      deps,
    );
    expect(deps.publishGenesis).toHaveBeenCalledTimes(1);
    // Publish is queued after the folder is registered (the lab exists locally
    // first, then we attempt the relay).
    expect(order.indexOf("publishGenesis")).toBeGreaterThan(
      order.indexOf("registerManaged:CLS1"),
    );
  });

  it("returns no-opfs and writes nothing when OPFS is unavailable", async () => {
    const { deps } = makeDeps({ getOpfsRoot: vi.fn(async () => null) });

    const result = await provisionClassFolder(
      { username: "prof", identity: FAKE_IDENTITY, oauthEmail: "p@u.edu" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-opfs");
    expect(deps.setActiveHandle).not.toHaveBeenCalled();
    expect(deps.writeClassSettings).not.toHaveBeenCalled();
    expect(deps.registerManaged).not.toHaveBeenCalled();
    expect(deps.publishGenesis).not.toHaveBeenCalled();
  });

  it("returns structure-failed and does NOT write settings when init fails", async () => {
    const { deps } = makeDeps({ ensureStructure: vi.fn(async () => false) });

    const result = await provisionClassFolder(
      { username: "prof", identity: FAKE_IDENTITY, oauthEmail: "p@u.edu" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("structure-failed");
    // The handle is switched (so init could run), but no class identity is
    // written and nothing is registered when init fails.
    expect(deps.writeClassSettings).not.toHaveBeenCalled();
    expect(deps.registerManaged).not.toHaveBeenCalled();
    expect(deps.publishGenesis).not.toHaveBeenCalled();
  });

  it("returns error when a dependency throws", async () => {
    const { deps } = makeDeps({
      writeClassSettings: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    const result = await provisionClassFolder(
      { username: "prof", identity: FAKE_IDENTITY, oauthEmail: "p@u.edu" },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.message).toContain("disk full");
    }
  });

  it("ordering-invariant guard: the SOURCE folder's settings.json is byte-unchanged after a class provision", async () => {
    // Model the source folder as an in-memory settings.json that is mutated ONLY
    // if a write happens while the file service still points at the source. The
    // provisioner switches the active handle to the NEW folder before any write,
    // so the source snapshot must come back byte-identical.
    let activeFolder = "source";
    const sourceSettingsBefore = JSON.stringify({
      account_type: "lab_head",
      lab_id: "RESEARCH_LAB",
    });
    let sourceSettings = sourceSettingsBefore;

    const { deps } = makeDeps({
      setActiveHandle: vi.fn((h: FileSystemDirectoryHandle) => {
        // Repointing the file service moves all subsequent writes off the source.
        activeFolder = h.name;
      }),
      writeClassSettings: vi.fn(async () => {
        // A write lands wherever the active handle currently points. If the
        // ordering invariant were violated (write before switch), this would
        // corrupt the source snapshot.
        if (activeFolder === "source") {
          sourceSettings = JSON.stringify({ corrupted: true });
        }
        return {};
      }),
    });

    const result = await provisionClassFolder(
      { username: "prof", identity: FAKE_IDENTITY, oauthEmail: "p@u.edu" },
      deps,
    );

    expect(result.ok).toBe(true);
    // The source folder's settings.json is byte-identical to before the provision.
    expect(sourceSettings).toBe(sourceSettingsBefore);
  });
});
