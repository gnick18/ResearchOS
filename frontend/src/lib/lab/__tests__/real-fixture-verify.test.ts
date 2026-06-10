// Iron-clad REAL-DATA verification harness for the Phase 7a multiuser -> solo
// migration (users -> separate accounts).
//
// Drives the ACTUAL planner + executor over the real Node-fs adapter against
// COPIES of real multiuser test folders on disk (1, 2, 3, 4, and 8 users),
// running EACH fixture with EVERY possible primary (the connecting user could
// be anyone), and asserting the full universal invariant set (see
// migration-invariants.ts). It never touches the originals.
//
// GUARDED behind MIGRATION_FIXTURE_VERIFY=1 so normal CI skips it (the fixtures
// are absolute paths on Grant's machine, not in the repo). Run it explicitly:
//   MIGRATION_FIXTURE_VERIFY=1 node_modules/.bin/vitest run \
//     src/lib/lab/__tests__/real-fixture-verify.test.ts
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { planMigrationToSolo } from "../migrate-to-solo";
import { executeMigrationToSolo } from "../migrate-to-solo-executor";
import { createNodeMigrationFs } from "../migration-fs-node";
import {
  snapshotFolder,
  checkMigrationInvariants,
  listUsers,
  wholeFolderHash,
  diffWholeHash,
  pathExists,
} from "./migration-invariants";

interface Fixture {
  label: string;
  path: string;
  expectedUsers: number;
}

const FIXTURES: Fixture[] = [
  { label: "1-user (McQueenLab)", path: "/Users/gnickles/Desktop/McQueenLab", expectedUsers: 1 },
  { label: "2-user (badussie)", path: "/Users/gnickles/Desktop/badussie", expectedUsers: 2 },
  { label: "3-user (ArchiveKiller)", path: "/Users/gnickles/Documents/ArchiveKiller", expectedUsers: 3 },
  { label: "4-user (Lab Notebook)", path: "/Users/gnickles/Desktop/Lab Notebook", expectedUsers: 4 },
  { label: "8-user (LoroTest)", path: "/Users/gnickles/Documents/LoroTest", expectedUsers: 8 },
];

const RUN = process.env.MIGRATION_FIXTURE_VERIFY === "1";

const reportLines: string[] = [];
const report = (s = "") => reportLines.push(s);

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

/** Run one (fixture copy, chosen primary) through plan + execute + full audit. */
async function runOne(fixturePath: string, primary: string): Promise<string[]> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-migverify-"));
  const root = path.join(work, "folder");
  try {
    await fs.cp(fixturePath, root, { recursive: true });
    const allUsers = await listUsers(root);
    const snap = await snapshotFolder(root, primary);
    const plan = await planMigrationToSolo({
      allUsers,
      primaryUser: primary,
      countRecords: (u) => countRecords(root, u),
    });
    const mfs = createNodeMigrationFs(root);
    const result = await executeMigrationToSolo({ fs: mfs, plan });

    // Idempotency.
    const before2 = await wholeFolderHash(root);
    const result2 = await executeMigrationToSolo({ fs: mfs, plan });
    const after2 = await wholeFolderHash(root);
    const idemViol: string[] = [];
    if (result2.movedUsers.length) idemViol.push(`idempotency: 2nd run moved ${result2.movedUsers.join(",")}`);
    const drift = diffWholeHash(before2, after2);
    if (drift.length) idemViol.push(`idempotency drift: ${drift.slice(0, 5).join(", ")}`);

    const check = await checkMigrationInvariants(root, snap, plan, result, { primary });
    return [...check.violations, ...idemViol];
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

describe.skipIf(!RUN)("Phase 7a migrate-to-solo: real-fixture iron-clad verification", () => {
  for (const fx of FIXTURES) {
    it(`${fx.label} (every primary)`, async () => {
      expect(await pathExists(fx.path), `fixture missing: ${fx.path}`).toBe(true);
      // List users from one copy to drive the every-primary loop.
      const probe = await fs.mkdtemp(path.join(os.tmpdir(), "ros-probe-"));
      const probeRoot = path.join(probe, "f");
      await fs.cp(fx.path, probeRoot, { recursive: true });
      const users = await listUsers(probeRoot);
      await fs.rm(probe, { recursive: true, force: true });

      report(`\n================ ${fx.label} ================`);
      report(`users: [${users.join(", ")}] (expected ${fx.expectedUsers})`);
      expect(users.length, "user count").toBe(fx.expectedUsers);

      let allClean = true;
      for (const primary of users) {
        const violations = await runOne(fx.path, primary);
        if (violations.length) {
          allClean = false;
          report(`  primary=${primary}: ${violations.length} VIOLATION(S)`);
          for (const vi of violations) report(`     - ${vi}`);
        } else {
          report(`  primary=${primary}: PASS (all invariants)`);
        }
        expect(violations, `${fx.label} primary=${primary}:\n${violations.join("\n")}`).toEqual([]);
      }
      report(`RESULT: ${allClean ? "PASS" : "FAIL"} across ${users.length} primary choice(s)`);
    }, 240_000);
  }

  it("writes the report", async () => {
    const out = path.join(os.tmpdir(), "ros-migration-verify-report.md");
    await fs.writeFile(out, `# Migration real-fixture verification (every primary)\n${reportLines.join("\n")}\n`, "utf8");
    process.stdout.write(reportLines.join("\n") + "\n");
  });
});
