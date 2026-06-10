// Always-on CI matrix for the Phase 7a multiuser -> solo migration.
//
// Generates many synthetic folders (varied user counts, varied primary choice,
// lab-head and archived-user variants, several seeds) and runs the REAL planner
// + executor over each, asserting the full universal invariant set. Unlike the
// real-fixture harness this needs no external paths, so it is a permanent
// regression gate that fails the build if any split ever loses or corrupts data.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { planMigrationToSolo } from "../migrate-to-solo";
import { executeMigrationToSolo } from "../migrate-to-solo-executor";
import { createNodeMigrationFs } from "../migration-fs-node";
import { writeSynthFolder } from "./migration-synth-fixtures";
import {
  snapshotFolder,
  checkMigrationInvariants,
  listUsers,
  hashTree,
  wholeFolderHash,
  diffWholeHash,
  pathExists,
} from "./migration-invariants";

// Username pool: distinct case-insensitively (macOS APFS is case-insensitive),
// includes a spaced name, a unicode name, dots and a hyphen+digit to stress
// path + reference handling.
const NAMES = ["alex", "morgan", "mira", "sam", "bob", "adi", "Lab Mate", "José", "quinn-7", "river.io"];

function usersFor(count: number): string[] {
  return NAMES.slice(0, count);
}

async function countRecords(root: string, user: string): Promise<Record<string, number>> {
  const base = path.join(root, "users", user);
  const counts: Record<string, number> = {};
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return counts;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    let inner: string[] = [];
    try {
      inner = await fs.readdir(path.join(base, e.name));
    } catch {
      /* ignore */
    }
    const n = inner.filter((f) => f.endsWith(".json")).length;
    if (n > 0) counts[e.name] = n;
  }
  return counts;
}

interface Case {
  label: string;
  users: string[];
  primary: string;
  seed: number;
  primaryIsLabHead?: boolean;
  archivedUser?: string;
}

function buildMatrix(): Case[] {
  const cases: Case[] = [];
  for (let count = 2; count <= 6; count++) {
    const users = usersFor(count);
    // Every user as primary for small folders; a representative sample for big.
    const primaries = count <= 4 ? users : [users[0], users[Math.floor(count / 2)], users[count - 1]];
    let seed = count * 1000;
    for (const primary of primaries) {
      cases.push({ label: `${count}u primary=${primary}`, users, primary, seed: seed++ });
    }
    // Lab-head primary variant (exercises the account_type reset).
    cases.push({ label: `${count}u primary=${users[0]} (lab_head)`, users, primary: users[0], seed: seed++, primaryIsLabHead: true });
    // Archived-user variant (a tombstoned dir must linger, invisible + untouched).
    cases.push({ label: `${count}u primary=${users[0]} +archived`, users, primary: users[0], seed: seed++, archivedUser: "ghost" });
  }
  return cases;
}

describe("Phase 7a migrate-to-solo: synthetic CI matrix", () => {
  const matrix = buildMatrix();

  for (const c of matrix) {
    it(`${c.label}`, async () => {
      const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-synth-"));
      const root = path.join(work, "folder");
      try {
        await writeSynthFolder(root, {
          users: c.users,
          primary: c.primary,
          seed: c.seed,
          primaryIsLabHead: c.primaryIsLabHead,
          archivedUser: c.archivedUser,
        });

        const allUsers = await listUsers(root); // mirrors discoverUsers (filters archived)
        expect(allUsers).toEqual([...c.users].sort());

        // Capture the archived user's tree to prove it is left untouched.
        const archDir = c.archivedUser ? path.join(root, "users", c.archivedUser) : null;
        const archPre = archDir ? await hashTree(archDir) : null;

        const snap = await snapshotFolder(root, c.primary);
        const plan = await planMigrationToSolo({
          allUsers,
          primaryUser: c.primary,
          countRecords: (u) => countRecords(root, u),
        });
        const mfs = createNodeMigrationFs(root);
        const result = await executeMigrationToSolo({ fs: mfs, plan });

        // Idempotency: a second run is a perfect no-op.
        const before2 = await wholeFolderHash(root);
        const result2 = await executeMigrationToSolo({ fs: mfs, plan });
        const after2 = await wholeFolderHash(root);
        expect(result2.movedUsers, "2nd run moved users").toEqual([]);
        expect(diffWholeHash(before2, after2), "idempotency drift").toEqual([]);

        // Universal invariants.
        const check = await checkMigrationInvariants(root, snap, plan, result, { primary: c.primary });
        expect(check.violations, `violations:\n${check.violations.join("\n")}`).toEqual([]);

        // Archived user: dir still present, byte-identical, never bundled/trashed.
        if (archDir && archPre) {
          expect(await pathExists(archDir), "archived dir should linger").toBe(true);
          const archPost = await hashTree(archDir);
          expect(diffWholeHash(archPre, archPost), "archived user data must be untouched").toEqual([]);
          expect(await pathExists(path.join(root, "_migration_bundles", c.archivedUser!)), "archived user must NOT be bundled").toBe(false);
        }
      } finally {
        await fs.rm(work, { recursive: true, force: true });
      }
    }, 60_000);
  }

  // Trivial folders: already solo, nothing to do.
  it("1-user folder is already solo (no-op)", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-synth-solo-"));
    const root = path.join(work, "folder");
    try {
      await writeSynthFolder(root, { users: ["alex"], primary: "alex", seed: 1 });
      const before = await wholeFolderHash(root);
      const plan = await planMigrationToSolo({ allUsers: ["alex"], primaryUser: "alex", countRecords: (u) => countRecords(root, u) });
      expect(plan.alreadySolo).toBe(true);
      const result = await executeMigrationToSolo({ fs: createNodeMigrationFs(root), plan });
      expect(result.movedUsers).toEqual([]);
      const after = await wholeFolderHash(root);
      expect(diffWholeHash(before, after), "solo folder must be untouched").toEqual([]);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  }, 60_000);
});
