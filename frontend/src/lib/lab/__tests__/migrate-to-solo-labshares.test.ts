// Regression guard: converting to solo must clear LAB-WIDE sharing, which is
// stale once there is no lab. The named-moved-user strip alone left notes still
// flagged "shared with lab" (the "*" wildcard + is_shared:true). This asserts
// both are cleared while the owner's own entry survives.
import { describe, it, expect, afterEach } from "vitest";
import * as nodefs from "node:fs/promises";
import * as nodepath from "node:path";
import * as nodeos from "node:os";
import { createNodeMigrationFs } from "../migration-fs-node";
import {
  executeMigrationToSolo,
  type MigrationExecOptions,
} from "../migrate-to-solo-executor";

let root = "";
afterEach(async () => {
  if (root) await nodefs.rm(root, { recursive: true, force: true });
  root = "";
});

describe("migration: clears lab-wide sharing on solo conversion", () => {
  it("drops the '*' wildcard + is_shared, keeps the owner, strips moved users", async () => {
    root = await nodefs.mkdtemp(nodepath.join(nodeos.tmpdir(), "lab-share-"));
    const j = (p: string) => nodepath.join(root, p);

    await nodefs.mkdir(j("users/manny/notes"), { recursive: true });
    // note shared with all lab members ("*"), a moved user (sharron), the owner,
    // plus the is_shared flag.
    await nodefs.writeFile(
      j("users/manny/notes/1.json"),
      JSON.stringify({
        id: 1,
        title: "First Meeting",
        is_shared: true,
        shared_with: [
          { username: "manny", level: "edit" },
          { username: "sharron", level: "edit" },
          { username: "*", level: "read" },
        ],
      }),
    );
    // a note shared with lab purely via the is_shared flag (no shared_with list).
    await nodefs.writeFile(
      j("users/manny/notes/2.json"),
      JSON.stringify({ id: 2, title: "Fresh Note", is_shared: true }),
    );
    await nodefs.mkdir(j("users/sharron"), { recursive: true });
    await nodefs.writeFile(j("users/sharron/settings.json"), "{}");

    const plan = {
      primaryUser: "manny",
      usersToMove: [{ username: "sharron", recordCounts: {}, total: 0 }],
      alreadySolo: false,
    };
    await executeMigrationToSolo({
      fs: createNodeMigrationFs(root),
      plan,
    } as MigrationExecOptions);

    const n1 = JSON.parse(await nodefs.readFile(j("users/manny/notes/1.json"), "utf8"));
    const names = (n1.shared_with as Array<{ username: string }>).map((e) => e.username);
    expect(names).toEqual(["manny"]); // owner kept, sharron + "*" gone
    expect(n1.is_shared).toBe(false);

    const n2 = JSON.parse(await nodefs.readFile(j("users/manny/notes/2.json"), "utf8"));
    expect(n2.is_shared).toBe(false);
  });
});
