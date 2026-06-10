// A PI who is MOVED OUT (not the primary keeper) must get account_type clamped
// to "member" in their extracted bundle, so their new one-person folder derives
// as solo rather than still reading as a lab. The recoverable trash copy keeps
// the original lab_head value untouched.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { planMigrationToSolo } from "../migrate-to-solo";
import { executeMigrationToSolo } from "../migrate-to-solo-executor";
import { createNodeMigrationFs } from "../migration-fs-node";

async function readAccountType(p: string): Promise<string | undefined> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8")).account_type;
  } catch {
    return undefined;
  }
}

describe("migrate-to-solo: moved-out PI bundle is clamped to member", () => {
  it("resets a moved lab_head's bundle to member, keeps the trash original", async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "ros-movedpi-"));
    const root = path.join(work, "f");
    try {
      const mk = async (rel: string, val: unknown) => {
        const abs = path.join(root, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, JSON.stringify(val), "utf8");
      };
      // alex = primary member; mira = a moved-out lab head.
      await mk("users/_user_metadata.json", { alex: { color: "#1" }, mira: { color: "#2" } });
      await mk("users/alex/settings.json", { account_type: "member" });
      await mk("users/alex/tasks/1.json", { id: 1, owner: "alex" });
      await mk("users/mira/settings.json", { account_type: "lab_head" });
      await mk("users/mira/_lab_head_auth.json", { v: 1 });
      await mk("users/mira/tasks/1.json", { id: 1, owner: "mira" });

      const plan = await planMigrationToSolo({
        allUsers: ["alex", "mira"],
        primaryUser: "alex",
        countRecords: async () => ({ tasks: 1 }),
      });
      await executeMigrationToSolo({ fs: createNodeMigrationFs(root), plan });

      // mira's portable bundle now reads as a solo member folder...
      expect(
        await readAccountType(path.join(root, "_migration_bundles/mira/users/mira/settings.json")),
      ).toBe("member");
      // ...while the recoverable trash copy keeps the original lab_head value.
      expect(
        await readAccountType(path.join(root, "_trash/migrated_users/mira/settings.json")),
      ).toBe("lab_head");
      // alex (already a member) is untouched.
      expect(await readAccountType(path.join(root, "users/alex/settings.json"))).toBe("member");
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
});
