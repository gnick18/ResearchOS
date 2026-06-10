// Crash-safety + resume tests for the Phase 7a executor.
//
// These simulate the failure windows the production FSA path can hit (the
// browser tab closing mid-migration, a silently torn write, a non-atomic
// directory delete) and prove the load-bearing guarantee: NO DATA IS EVER LOST,
// and a re-run cleanly resumes to a correct solo folder.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { planMigrationToSolo } from "../migrate-to-solo";
import { executeMigrationToSolo } from "../migrate-to-solo-executor";
import { createNodeMigrationFs } from "../migration-fs-node";
import type { MigrationFs } from "../migration-fs";
import { hashTree, listUsers, wholeFolderHash, diffWholeHash, pathExists } from "./migration-invariants";

async function buildFolder(root: string): Promise<void> {
  const mk = async (rel: string, val: unknown) => {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, JSON.stringify(val), "utf8");
  };
  await mk("users/_user_metadata.json", { alex: { color: "#1" }, bob: { color: "#2" }, cara: { color: "#3" } });
  await mk("users/alex/_counters.json", { tasks: 2 });
  await mk("users/alex/settings.json", { account_type: "member" });
  await mk("users/alex/tasks/1.json", { id: 1, owner: "alex", shared_with: [{ username: "bob", level: "edit" }] });
  await mk("users/bob/_counters.json", { tasks: 3 });
  await mk("users/bob/settings.json", { account_type: "member" });
  await mk("users/bob/tasks/1.json", { id: 1, owner: "bob", title: "bob task" });
  await mk("users/bob/notes/1.json", { id: 1, username: "bob", body: "important" });
  // a binary blob to prove byte-exact survival through the crash paths
  await fs.mkdir(path.join(root, "users/bob/.researchos/notes"), { recursive: true });
  await fs.writeFile(path.join(root, "users/bob/.researchos/notes/1.loro"), Buffer.from([1, 2, 3, 4, 250, 251, 252, 0]));
  await mk("users/cara/_counters.json", { tasks: 1 });
  await mk("users/cara/settings.json", { account_type: "member" });
  await mk("users/cara/tasks/1.json", { id: 1, owner: "cara", title: "cara task" });
}

const countRecords = async (root: string, user: string): Promise<Record<string, number>> => {
  const base = path.join(root, "users", user);
  const counts: Record<string, number> = {};
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return counts;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const inner = await fs.readdir(path.join(base, e.name)).catch(() => [] as string[]);
    const n = inner.filter((f) => f.endsWith(".json")).length;
    if (n) counts[e.name] = n;
  }
  return counts;
};

async function makePlanned(root: string, primary: string) {
  const allUsers = await listUsers(root);
  return planMigrationToSolo({ allUsers, primaryUser: primary, countRecords: (u) => countRecords(root, u) });
}

/** Assert every original file of `user` still exists byte-exact in at least one of the given dirs. */
async function assertNoDataLoss(originalUserDir: string, candidateDirs: string[]): Promise<void> {
  const orig = await hashTree(originalUserDir);
  const found = new Map<string, string>();
  for (const d of candidateDirs) {
    for (const [rel, h] of await hashTree(d)) {
      if (!found.has(rel)) found.set(rel, h.sha);
    }
  }
  const missing: string[] = [];
  for (const [rel, h] of orig) {
    if (found.get(rel) !== h.sha) missing.push(rel);
  }
  expect(missing, `data lost (not byte-exact anywhere): ${missing.join(", ")}`).toEqual([]);
}

describe("Phase 7a executor: crash-safety + resume", () => {
  it("a silently torn bundle write aborts BEFORE any delete (source intact)", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-crash-"));
    const root = path.join(work, "f");
    try {
      await buildFolder(root);
      const bobOrig = await hashTree(path.join(root, "users", "bob"));
      const plan = await makePlanned(root, "alex");
      const base = createNodeMigrationFs(root);
      // Fault injection: silently drop bob's binary blob during the bundle copy
      // (simulates an FSA atomic .tmp that never moved => file absent, no throw).
      const faulty: MigrationFs = {
        ...base,
        async copyFile(from, to) {
          if (to.includes("_migration_bundles") && to.endsWith(".loro")) return; // drop, no error
          return base.copyFile(from, to);
        },
      };
      await expect(executeMigrationToSolo({ fs: faulty, plan })).rejects.toThrow(/incomplete/i);
      // Source MUST be untouched (no delete happened) and trash must not exist.
      expect(await pathExists(path.join(root, "users", "bob")), "source must survive").toBe(true);
      const bobAfter = await hashTree(path.join(root, "users", "bob"));
      expect(diffWholeHash(bobOrig, bobAfter), "source bob altered").toEqual([]);
      expect(await pathExists(path.join(root, "_trash", "migrated_users", "bob")), "trash must not exist").toBe(false);

      // Re-run with a healthy fs resumes cleanly to a correct solo folder.
      const result = await executeMigrationToSolo({ fs: createNodeMigrationFs(root), plan });
      expect(result.movedUsers.sort()).toEqual(["bob", "cara"]);
      expect(await listUsers(root)).toEqual(["alex"]);
      await assertNoDataLoss(path.join(root, "_trash", "migrated_users", "bob"), [
        path.join(root, "_migration_bundles", "bob", "users", "bob"),
      ]);
      // bob's original bytes survived in BOTH bundle and trash.
      await assertNoDataLoss(path.join(root, "_trash", "migrated_users", "bob"), [path.join(root, "_trash", "migrated_users", "bob")]);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("crash mid-trash (source AND trash both present) resumes from the bundle, no data loss", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-crash-"));
    const root = path.join(work, "f");
    try {
      await buildFolder(root);
      const plan = await makePlanned(root, "alex");
      // Run once cleanly.
      await executeMigrationToSolo({ fs: createNodeMigrationFs(root), plan });
      // Simulate a crash mid-trash for bob: recreate a PARTIAL source (only some
      // files) while the complete trash + bundle still exist. Also drop one file
      // from the trash to model a torn trash copy. Bundle stays the truth.
      const bobBundle = path.join(root, "_migration_bundles", "bob", "users", "bob");
      const bobSrc = path.join(root, "users", "bob");
      await fs.mkdir(path.join(bobSrc, "tasks"), { recursive: true });
      await fs.copyFile(path.join(bobBundle, "tasks/1.json"), path.join(bobSrc, "tasks/1.json")); // partial src
      // torn trash: remove bob's note from trash
      await fs.rm(path.join(root, "_trash", "migrated_users", "bob", "notes", "1.json"), { force: true });

      // Re-run: should rebuild trash from the bundle and drop the leftover source.
      const result = await executeMigrationToSolo({ fs: createNodeMigrationFs(root), plan });
      expect(result.movedUsers).toContain("bob");
      expect(await pathExists(bobSrc), "leftover source must be removed").toBe(false);
      expect(await listUsers(root)).toEqual(["alex"]);
      // Trash is rebuilt complete from the bundle; no original bob data lost.
      await assertNoDataLoss(bobBundle, [path.join(root, "_trash", "migrated_users", "bob"), bobBundle]);
      const trashHashes = await hashTree(path.join(root, "_trash", "migrated_users", "bob"));
      const bundleHashes = await hashTree(bobBundle);
      expect(trashHashes.size, "trash should be a complete copy of the bundle").toBe(bundleHashes.size);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("a partial leftover bundle (no trash yet) is recopied + verified before trashing", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-crash-"));
    const root = path.join(work, "f");
    try {
      await buildFolder(root);
      const plan = await makePlanned(root, "alex");
      // Pre-seed an INCOMPLETE bundle for bob (missing the note + blob), no trash.
      const bobBundle = path.join(root, "_migration_bundles", "bob", "users", "bob", "tasks");
      await fs.mkdir(bobBundle, { recursive: true });
      await fs.writeFile(path.join(bobBundle, "1.json"), "stale-partial");
      const result = await executeMigrationToSolo({ fs: createNodeMigrationFs(root), plan });
      expect(result.movedUsers.sort()).toEqual(["bob", "cara"]);
      expect(await listUsers(root)).toEqual(["alex"]);
      // The bundle was recopied to completeness from the real source.
      await assertNoDataLoss(path.join(root, "_trash", "migrated_users", "bob"), [
        path.join(root, "_migration_bundles", "bob", "users", "bob"),
      ]);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("running 3 times is a perfect no-op after the first (idempotent)", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-crash-"));
    const root = path.join(work, "f");
    try {
      await buildFolder(root);
      const plan = await makePlanned(root, "alex");
      await executeMigrationToSolo({ fs: createNodeMigrationFs(root), plan });
      const afterFirst = await wholeFolderHash(root);
      for (let i = 0; i < 2; i++) {
        const r = await executeMigrationToSolo({ fs: createNodeMigrationFs(root), plan });
        expect(r.movedUsers, `run ${i + 2} should move nobody`).toEqual([]);
        const now = await wholeFolderHash(root);
        expect(diffWholeHash(afterFirst, now), `run ${i + 2} drift`).toEqual([]);
      }
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
});
