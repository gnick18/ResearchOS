// Lab-tier Phase 7a: migration executor integration tests.
//
// Uses a SYNTHETIC multiuser fixture in an OS temp dir (node:os tmpdir +
// node:fs/promises) to verify the executor's bundle, trash, share-strip,
// and preserve behaviours without touching any real user data.
//
// Fixture layout (mirrors a real LoroTest multiuser folder):
//   users/manny/           <- PRIMARY
//     tasks/1.json         <- shared_with: ["sharron", "manny"]
//     notes/1.json         <- shared_with: []
//     shared_notebooks/nb1.json  <- participants: ["manny","sharron"], owner: "manny"
//     settings.json
//   users/sharron/
//     tasks/1.json
//     shared_notebooks/nb1.json
//     settings.json
//   users/bob/
//     settings.json
//   public/methods/x.json
//   lab/funding_accounts/y.json
//   _global_counters.json
//   _user_metadata.json
//
// No emojis, no em-dashes, no mid-sentence colons.

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import * as nodefs from "node:fs/promises";
import * as nodepath from "node:path";
import * as nodeos from "node:os";

import { createNodeMigrationFs } from "../migration-fs-node";
import {
  executeMigrationToSolo,
  copyDirRecursiveMfs,
} from "../migrate-to-solo-executor";
import type { MigrationPlan } from "../migrate-to-solo";

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------

async function writeJson(
  root: string,
  relPath: string,
  data: unknown,
): Promise<void> {
  const full = nodepath.join(root, relPath);
  await nodefs.mkdir(nodepath.dirname(full), { recursive: true });
  await nodefs.writeFile(full, JSON.stringify(data, null, 2), "utf8");
}

async function readJson(root: string, relPath: string): Promise<unknown> {
  const full = nodepath.join(root, relPath);
  return JSON.parse(await nodefs.readFile(full, "utf8"));
}

async function pathExists(root: string, relPath: string): Promise<boolean> {
  try {
    await nodefs.access(nodepath.join(root, relPath));
    return true;
  } catch {
    return false;
  }
}

async function pathMissing(root: string, relPath: string): Promise<boolean> {
  return !(await pathExists(root, relPath));
}

// ---------------------------------------------------------------------------
// Per-test temp dir setup / teardown.
// ---------------------------------------------------------------------------

let tmp = "";

beforeEach(async () => {
  tmp = await nodefs.mkdtemp(nodepath.join(nodeos.tmpdir(), "lab-migrate-test-"));
  await buildFixture(tmp);
});

afterEach(async () => {
  await nodefs.rm(tmp, { recursive: true, force: true });
});

async function buildFixture(root: string): Promise<void> {
  // users/manny (PRIMARY)
  await writeJson(root, "users/manny/tasks/1.json", {
    id: 1,
    shared_with: ["sharron", "manny"],
  });
  await writeJson(root, "users/manny/notes/1.json", {
    id: 1,
    shared_with: [],
  });
  await writeJson(root, "users/manny/shared_notebooks/nb1.json", {
    id: "nb1",
    participants: ["manny", "sharron"],
    owner: "manny",
  });
  await writeJson(root, "users/manny/settings.json", {
    theme: "light",
  });

  // users/sharron
  await writeJson(root, "users/sharron/tasks/1.json", {
    id: 1,
    title: "sharron's task",
  });
  await writeJson(root, "users/sharron/shared_notebooks/nb1.json", {
    id: "nb1",
    participants: ["manny", "sharron"],
    owner: "manny",
  });
  await writeJson(root, "users/sharron/settings.json", {
    theme: "dark",
  });

  // users/bob (near-empty)
  await writeJson(root, "users/bob/settings.json", {
    theme: "system",
  });

  // Shared workspace data (must be preserved byte-for-byte)
  await writeJson(root, "public/methods/x.json", { method: "pcr" });
  await writeJson(root, "lab/funding_accounts/y.json", { account: "NIH-R01" });
  await writeJson(root, "_global_counters.json", { nextTaskId: 42 });
  await writeJson(root, "_user_metadata.json", {
    users: ["manny", "sharron", "bob"],
  });
}

// ---------------------------------------------------------------------------
// Standard plan used by most tests.
// ---------------------------------------------------------------------------

function makeStandardPlan(): MigrationPlan {
  return {
    primaryUser: "manny",
    usersToMove: [
      { username: "sharron", recordCounts: { task: 1 }, total: 1 },
      { username: "bob", recordCounts: {}, total: 0 },
    ],
    alreadySolo: false,
  };
}

// ---------------------------------------------------------------------------
// Main integration tests.
// ---------------------------------------------------------------------------

describe("executeMigrationToSolo: main integration", () => {
  it("users/ contains ONLY manny after the migration (sharron + bob gone)", async () => {
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    const usersDir = nodepath.join(tmp, "users");
    const remaining = await nodefs.readdir(usersDir);
    expect(remaining.sort()).toEqual(["manny"]);
  });

  it("sharron's bundle contains her tasks/1.json with original content", async () => {
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    expect(
      await pathExists(tmp, "_migration_bundles/sharron/users/sharron/tasks/1.json"),
    ).toBe(true);

    const bundled = await readJson(
      tmp,
      "_migration_bundles/sharron/users/sharron/tasks/1.json",
    );
    expect(bundled).toMatchObject({ id: 1, title: "sharron's task" });
  });

  it("bob's bundle contains his settings.json", async () => {
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    expect(
      await pathExists(tmp, "_migration_bundles/bob/users/bob/settings.json"),
    ).toBe(true);

    const bundled = await readJson(
      tmp,
      "_migration_bundles/bob/users/bob/settings.json",
    );
    expect(bundled).toMatchObject({ theme: "system" });
  });

  it("trash contains recoverable originals for sharron and bob", async () => {
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    expect(
      await pathExists(tmp, "_trash/migrated_users/sharron"),
    ).toBe(true);
    expect(
      await pathExists(tmp, "_trash/migrated_users/bob"),
    ).toBe(true);

    // The trashed sharron dir still has her tasks inside
    expect(
      await pathExists(tmp, "_trash/migrated_users/sharron/tasks/1.json"),
    ).toBe(true);
  });

  it("result.bundlePaths and result.trashPaths are correctly populated", async () => {
    const mfs = createNodeMigrationFs(tmp);
    const result = await executeMigrationToSolo({
      fs: mfs,
      plan: makeStandardPlan(),
    });

    expect(result.bundlePaths["sharron"]).toBe("_migration_bundles/sharron");
    expect(result.bundlePaths["bob"]).toBe("_migration_bundles/bob");
    expect(result.trashPaths["sharron"]).toBe(
      "_trash/migrated_users/sharron",
    );
    expect(result.trashPaths["bob"]).toBe("_trash/migrated_users/bob");
  });

  it("result.movedUsers lists sharron and bob", async () => {
    const mfs = createNodeMigrationFs(tmp);
    const result = await executeMigrationToSolo({
      fs: mfs,
      plan: makeStandardPlan(),
    });
    expect(result.movedUsers.sort()).toEqual(["bob", "sharron"]);
  });
});

// ---------------------------------------------------------------------------
// Share-strip tests.
// ---------------------------------------------------------------------------

describe("executeMigrationToSolo: share stripping on primary (manny)", () => {
  it("removes 'sharron' from manny's tasks/1.json shared_with, keeps 'manny'", async () => {
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    const task = await readJson(tmp, "users/manny/tasks/1.json") as Record<string, unknown>;
    expect((task["shared_with"] as string[]).sort()).toEqual(["manny"]);
    expect(task["shared_with"]).not.toContain("sharron");
  });

  it("removes 'sharron' from manny's shared_notebooks/nb1.json participants", async () => {
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    const nb = await readJson(
      tmp,
      "users/manny/shared_notebooks/nb1.json",
    ) as Record<string, unknown>;
    expect(nb["participants"]).not.toContain("sharron");
    expect(nb["participants"]).toContain("manny");
  });

  it("owner field pointing to manny stays unchanged (not a moved user)", async () => {
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    const nb = await readJson(
      tmp,
      "users/manny/shared_notebooks/nb1.json",
    ) as Record<string, unknown>;
    // owner = "manny" must remain; only moved users get nulled out
    expect(nb["owner"]).toBe("manny");
  });

  it("notes/1.json with empty shared_with is NOT rewritten (no-op)", async () => {
    const mfs = createNodeMigrationFs(tmp);

    // Capture original mtime of notes/1.json
    const notesPath = nodepath.join(tmp, "users/manny/notes/1.json");
    const statBefore = await nodefs.stat(notesPath);

    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    const statAfter = await nodefs.stat(notesPath);
    // File should not have been rewritten (mtime unchanged for a no-op).
    // We check that shared_with is still empty (content intact).
    const notes = await readJson(tmp, "users/manny/notes/1.json") as Record<string, unknown>;
    expect(notes["shared_with"]).toEqual([]);
    // mtimeMs should not have changed (not rewritten).
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it("sharesStripped records the modified files and removed usernames", async () => {
    const mfs = createNodeMigrationFs(tmp);
    const result = await executeMigrationToSolo({
      fs: mfs,
      plan: makeStandardPlan(),
    });

    // We expect at least 2 files to be recorded: tasks/1.json + nb1.json
    const strippedFiles = result.sharesStripped.map((r) => r.file);
    expect(strippedFiles.some((f) => f.includes("tasks/1.json"))).toBe(true);
    expect(strippedFiles.some((f) => f.includes("nb1.json"))).toBe(true);

    // Every record should mention "sharron" as removed
    for (const record of result.sharesStripped) {
      expect(record.removed).toContain("sharron");
    }
  });
});

// ---------------------------------------------------------------------------
// Preservation tests.
// ---------------------------------------------------------------------------

describe("executeMigrationToSolo: preservation of shared workspace data", () => {
  it("public/methods/x.json is byte-unchanged", async () => {
    const before = await nodefs.readFile(
      nodepath.join(tmp, "public/methods/x.json"),
      "utf8",
    );
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });
    const after = await nodefs.readFile(
      nodepath.join(tmp, "public/methods/x.json"),
      "utf8",
    );
    expect(after).toBe(before);
  });

  it("lab/funding_accounts/y.json is byte-unchanged", async () => {
    const before = await nodefs.readFile(
      nodepath.join(tmp, "lab/funding_accounts/y.json"),
      "utf8",
    );
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });
    const after = await nodefs.readFile(
      nodepath.join(tmp, "lab/funding_accounts/y.json"),
      "utf8",
    );
    expect(after).toBe(before);
  });

  it("_global_counters.json is byte-unchanged", async () => {
    const before = await nodefs.readFile(
      nodepath.join(tmp, "_global_counters.json"),
      "utf8",
    );
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });
    const after = await nodefs.readFile(
      nodepath.join(tmp, "_global_counters.json"),
      "utf8",
    );
    expect(after).toBe(before);
  });

  it("_user_metadata.json is byte-unchanged", async () => {
    const before = await nodefs.readFile(
      nodepath.join(tmp, "_user_metadata.json"),
      "utf8",
    );
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });
    const after = await nodefs.readFile(
      nodepath.join(tmp, "_user_metadata.json"),
      "utf8",
    );
    expect(after).toBe(before);
  });

  it("manny's settings.json is byte-unchanged (primary data not touched)", async () => {
    const before = await nodefs.readFile(
      nodepath.join(tmp, "users/manny/settings.json"),
      "utf8",
    );
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });
    const after = await nodefs.readFile(
      nodepath.join(tmp, "users/manny/settings.json"),
      "utf8",
    );
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Idempotency: second run is a no-op.
// ---------------------------------------------------------------------------

describe("executeMigrationToSolo: idempotency", () => {
  it("second run returns movedUsers=[] (users already gone)", async () => {
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    // Rebuild the plan as it would be computed after migration (solo now).
    const soloResult = await executeMigrationToSolo({
      fs: mfs,
      plan: {
        primaryUser: "manny",
        usersToMove: [
          { username: "sharron", recordCounts: {}, total: 0 },
          { username: "bob", recordCounts: {}, total: 0 },
        ],
        alreadySolo: false, // simulate re-calling with the same plan
      },
    });

    // Both users already gone -> skipped gracefully.
    expect(soloResult.movedUsers).toHaveLength(0);
  });

  it("alreadySolo plan returns a no-op result immediately", async () => {
    const mfs = createNodeMigrationFs(tmp);
    const result = await executeMigrationToSolo({
      fs: mfs,
      plan: {
        primaryUser: "manny",
        usersToMove: [],
        alreadySolo: true,
      },
    });
    expect(result.movedUsers).toHaveLength(0);
    expect(result.sharesStripped).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unit test: copyDirRecursiveMfs on a nested directory.
// ---------------------------------------------------------------------------

describe("copyDirRecursiveMfs: nested directory copy", () => {
  it("copies a deeply nested directory tree byte-for-byte", async () => {
    // Build a small nested tree in tmp under "src_nested/"
    await writeJson(tmp, "src_nested/a.json", { key: "top" });
    await writeJson(tmp, "src_nested/sub/b.json", { key: "sub" });
    await writeJson(tmp, "src_nested/sub/deep/c.json", { key: "deep" });

    const mfs = createNodeMigrationFs(tmp);
    await copyDirRecursiveMfs(mfs, "src_nested", "dst_nested");

    expect(await pathExists(tmp, "dst_nested/a.json")).toBe(true);
    expect(await pathExists(tmp, "dst_nested/sub/b.json")).toBe(true);
    expect(await pathExists(tmp, "dst_nested/sub/deep/c.json")).toBe(true);

    const top = await readJson(tmp, "dst_nested/a.json") as Record<string, unknown>;
    expect(top["key"]).toBe("top");
    const deep = await readJson(tmp, "dst_nested/sub/deep/c.json") as Record<string, unknown>;
    expect(deep["key"]).toBe("deep");
  });

  it("does not disturb the source after copy", async () => {
    await writeJson(tmp, "src_copy_src/x.json", { v: 1 });
    const mfs = createNodeMigrationFs(tmp);
    await copyDirRecursiveMfs(mfs, "src_copy_src", "dst_copy_dst");

    const src = await readJson(tmp, "src_copy_src/x.json") as Record<string, unknown>;
    expect(src["v"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Object-form shared_with entries.
// ---------------------------------------------------------------------------

describe("executeMigrationToSolo: object-form shared_with entries", () => {
  it("strips object-form entries (with 'username' field) pointing to moved users", async () => {
    // Write a task where shared_with uses object-form entries
    await writeJson(tmp, "users/manny/tasks/obj-form.json", {
      id: 2,
      shared_with: [
        { username: "sharron", role: "viewer" },
        { username: "manny", role: "editor" },
      ],
    });

    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    const task = await readJson(
      tmp,
      "users/manny/tasks/obj-form.json",
    ) as Record<string, unknown>;
    const sw = task["shared_with"] as Array<Record<string, unknown>>;
    expect(sw).toHaveLength(1);
    expect(sw[0]["username"]).toBe("manny");
  });

  it("strips object-form entries with 'user' field", async () => {
    await writeJson(tmp, "users/manny/tasks/user-field.json", {
      id: 3,
      shared_with: [
        { user: "sharron" },
        { user: "manny" },
      ],
    });

    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    const task = await readJson(
      tmp,
      "users/manny/tasks/user-field.json",
    ) as Record<string, unknown>;
    const sw = task["shared_with"] as Array<Record<string, unknown>>;
    expect(sw).toHaveLength(1);
    expect(sw[0]["user"]).toBe("manny");
  });
});

// ---------------------------------------------------------------------------
// owner/sharedBy nulling.
// ---------------------------------------------------------------------------

describe("executeMigrationToSolo: owner/sharedBy nulling", () => {
  it("nulls out 'sharedBy' if it points to a moved user", async () => {
    await writeJson(tmp, "users/manny/shared_notebooks/nb2.json", {
      id: "nb2",
      participants: ["manny"],
      sharedBy: "sharron",
    });

    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    const nb = await readJson(
      tmp,
      "users/manny/shared_notebooks/nb2.json",
    ) as Record<string, unknown>;
    expect(nb["sharedBy"]).toBeNull();
  });

  it("does NOT null out 'owner' if it points to the primary user", async () => {
    // manny is the owner; sharron is the moved user; owner must stay.
    const nb = await readJson(
      tmp,
      "users/manny/shared_notebooks/nb1.json",
    ) as Record<string, unknown>;
    expect(nb["owner"]).toBe("manny"); // sanity check fixture
    // Run migration and verify owner untouched.
    const mfs = createNodeMigrationFs(tmp);
    await executeMigrationToSolo({ fs: mfs, plan: makeStandardPlan() });

    const nbAfter = await readJson(
      tmp,
      "users/manny/shared_notebooks/nb1.json",
    ) as Record<string, unknown>;
    expect(nbAfter["owner"]).toBe("manny");
  });
});
