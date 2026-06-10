// Tests for executeSelfExport: a labmate takes their own data out of a shared
// folder, leaving every other user untouched (the folder stays multi-user).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { executeSelfExport } from "../migrate-to-solo-executor";
import { createNodeMigrationFs } from "../migration-fs-node";
import { writeSynthFolder } from "./migration-synth-fixtures";
import { hashTree, listUsers, wholeFolderHash, diffWholeHash, pathExists } from "./migration-invariants";

async function build(root: string, seed: number): Promise<void> {
  await writeSynthFolder(root, { users: ["alex", "morgan", "mira", "sam"], primary: "alex", seed });
}

describe("executeSelfExport: labmate takes their data out", () => {
  it("extracts only the departing user; everyone else is byte-for-byte untouched", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-selfexport-"));
    const root = path.join(work, "f");
    try {
      await build(root, 11);
      const departing = "morgan";
      const stayers = ["alex", "mira", "sam"];

      // Snapshot the departing user (to verify byte-exact bundle/trash) and the
      // stayers (to verify they are untouched).
      const morganPre = await hashTree(path.join(root, "users", departing));
      const stayerPre = new Map<string, Map<string, { sha: string; size: number }>>();
      for (const u of stayers) stayerPre.set(u, await hashTree(path.join(root, "users", u)));

      const result = await executeSelfExport({ fs: createNodeMigrationFs(root), username: departing });
      expect(result.moved).toBe(true);

      // The folder is STILL multi-user: the three stayers remain, morgan is gone.
      expect(await listUsers(root)).toEqual([...stayers].sort());
      expect(await pathExists(path.join(root, "users", departing))).toBe(false);

      // Departing user's data is byte-exact in BOTH bundle and trash.
      const bundle = await hashTree(path.join(root, "_migration_bundles", departing, "users", departing));
      const trash = await hashTree(path.join(root, "_trash", "migrated_users", departing));
      for (const [rel, h] of morganPre) {
        expect(bundle.get(rel)?.sha, `bundle missing/corrupt: ${rel}`).toBe(h.sha);
        expect(trash.get(rel)?.sha, `trash missing/corrupt: ${rel}`).toBe(h.sha);
      }
      expect(bundle.size).toBe(morganPre.size);

      // Every stayer is byte-for-byte untouched (self-export rewrites nobody).
      for (const u of stayers) {
        const post = await hashTree(path.join(root, "users", u));
        expect(diffWholeHash(stayerPre.get(u)!, post), `${u} was modified`).toEqual([]);
      }
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("is idempotent (second run is a no-op)", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-selfexport-"));
    const root = path.join(work, "f");
    try {
      await build(root, 12);
      const mfs = createNodeMigrationFs(root);
      const first = await executeSelfExport({ fs: mfs, username: "sam" });
      expect(first.moved).toBe(true);
      const afterFirst = await wholeFolderHash(root);
      const second = await executeSelfExport({ fs: mfs, username: "sam" });
      expect(second.moved).toBe(false);
      expect(diffWholeHash(afterFirst, await wholeFolderHash(root))).toEqual([]);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it("the exported bundle is a valid connectable single-user folder", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-selfexport-"));
    const root = path.join(work, "f");
    try {
      await build(root, 13);
      await executeSelfExport({ fs: createNodeMigrationFs(root), username: "mira" });
      // The bundle root has users/<mira>/ with the user's files, so connecting
      // it would discover exactly one user.
      const bundleRoot = path.join(root, "_migration_bundles", "mira");
      expect(await listUsers(bundleRoot)).toEqual(["mira"]);
      expect(await pathExists(path.join(bundleRoot, "users", "mira", "settings.json"))).toBe(true);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
});
