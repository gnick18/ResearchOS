// Regression guard for solo-conversion cleanups beyond share-stripping:
//  - a former "1:1 with X" notebook is renamed (the 1:1 construct is dead solo),
//  - the primary's account_type is clamped to "member" (a solo folder has no
//    lab head, so the folder derives as solo).
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

describe("migration: solo-conversion cleanups", () => {
  it("renames a former 1:1 notebook and clamps the primary to member", async () => {
    root = await nodefs.mkdtemp(nodepath.join(nodeos.tmpdir(), "lab-clean-"));
    const j = (p: string) => nodepath.join(root, p);

    await nodefs.mkdir(j("users/manny/shared_notebooks"), { recursive: true });
    await nodefs.writeFile(
      j("users/manny/shared_notebooks/nb1.json"),
      JSON.stringify({ id: "nb1", title: "1:1 with Sharron", members: ["manny"] }),
    );
    // a normal notebook title must NOT be renamed.
    await nodefs.writeFile(
      j("users/manny/shared_notebooks/nb2.json"),
      JSON.stringify({ id: "nb2", title: "Lab meeting agendas", members: ["manny"] }),
    );
    // primary is a former lab head; solo conversion must clamp to member.
    await nodefs.writeFile(
      j("users/manny/settings.json"),
      JSON.stringify({ account_type: "lab_head", display_name: "Manny" }),
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

    const nb1 = JSON.parse(await nodefs.readFile(j("users/manny/shared_notebooks/nb1.json"), "utf8"));
    expect(nb1.title).toBe("Meeting notes"); // 1:1 framing dropped

    const nb2 = JSON.parse(await nodefs.readFile(j("users/manny/shared_notebooks/nb2.json"), "utf8"));
    expect(nb2.title).toBe("Lab meeting agendas"); // untouched

    const settings = JSON.parse(await nodefs.readFile(j("users/manny/settings.json"), "utf8"));
    expect(settings.account_type).toBe("member"); // clamped
    expect(settings.display_name).toBe("Manny"); // other fields preserved
  });
});
