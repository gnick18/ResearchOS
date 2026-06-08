// Regression guard for the byte-exact bundle copy. A multiuser folder holds
// binary files (.loro CRDT snapshots, images, attachments). The bundle
// extraction MUST preserve those bytes; a UTF-8 read/write round-trip would
// silently corrupt them. This test fails if copyFile ever regresses to a
// string-based copy.
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

describe("migration executor: binary-safe bundle copy", () => {
  it("copies binary files byte-exact into the bundle and trash", async () => {
    root = await nodefs.mkdtemp(nodepath.join(nodeos.tmpdir(), "lab-bin-"));
    const j = (p: string) => nodepath.join(root, p);

    // primary "alice" (text only) + moved "bob" with a BINARY file whose bytes
    // are invalid UTF-8 (0x00, 0xFF, 0x80, 0xFE) so a string round-trip corrupts.
    await nodefs.mkdir(j("users/alice"), { recursive: true });
    await nodefs.writeFile(j("users/alice/settings.json"), '{"id":"alice"}');
    await nodefs.mkdir(j("users/bob/.researchos/notes"), { recursive: true });
    const binary = Buffer.from([
      0x00, 0xff, 0x80, 0x01, 0xfe, 0x7f, 0x00, 0xab, 0xc3, 0x28,
    ]);
    await nodefs.writeFile(j("users/bob/.researchos/notes/1.loro"), binary);

    const plan = {
      primaryUser: "alice",
      usersToMove: [{ username: "bob", recordCounts: {}, total: 0 }],
      alreadySolo: false,
    };
    await executeMigrationToSolo({
      fs: createNodeMigrationFs(root),
      plan,
    } as MigrationExecOptions);

    // Bundle copy must be byte-identical.
    const bundleBytes = await nodefs.readFile(
      j("_migration_bundles/bob/users/bob/.researchos/notes/1.loro"),
    );
    expect(Buffer.compare(bundleBytes, binary)).toBe(0);

    // Trashed original (a move) must also be byte-identical.
    const trashBytes = await nodefs.readFile(
      j("_trash/migrated_users/bob/.researchos/notes/1.loro"),
    );
    expect(Buffer.compare(trashBytes, binary)).toBe(0);
  });
});
