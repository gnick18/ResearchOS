// frontend/src/lib/notes/__tests__/revert-window-sweep.test.ts
//
// VC Phase 2 (restore-a-version sub-bot of HR, 2026-05-30). The folder-connect
// expiry sweep strips EXPIRED revert_undo_window fields and leaves UNEXPIRED
// ones untouched. Mirrors the trash-cleanup sweep tests: a mocked fileService
// in-memory filesystem.

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory FS the mock reads/writes against.
const fs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    listFiles: vi.fn(async (dirPath: string) => {
      const prefix = `${dirPath}/`;
      const names: string[] = [];
      for (const path of fs.keys()) {
        if (path.startsWith(prefix)) {
          const rest = path.slice(prefix.length);
          if (!rest.includes("/")) names.push(rest);
        }
      }
      return names;
    }),
    readJson: vi.fn(async (path: string) => fs.get(path) ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fs.set(path, data);
    }),
  },
}));

import { runRevertWindowSweep } from "../revert-window-sweep";

const NOW = Date.parse("2026-05-30T12:00:00.000Z");
const PAST = "2026-05-29T12:00:00.000Z"; // 24h before NOW (expired)
const FUTURE = "2026-05-31T12:00:00.000Z"; // 24h after NOW (unexpired)

function makeNote(id: number, expiresAt: string | null) {
  return {
    id,
    title: `Note ${id}`,
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [],
    updated_at: "2026-05-30T00:00:00.000Z",
    username: "alex",
    ...(expiresAt
      ? {
          revert_undo_window: {
            from_version: 5,
            to_version: 2,
            reverted_at: "2026-05-29T12:00:00.000Z",
            expires_at: expiresAt,
            reverted_by: "alex",
          },
        }
      : {}),
  };
}

describe("runRevertWindowSweep", () => {
  beforeEach(() => {
    fs.clear();
  });

  it("strips an EXPIRED window and leaves an UNEXPIRED one", async () => {
    fs.set("users/alex/notes/1.json", makeNote(1, PAST)); // expired -> strip
    fs.set("users/alex/notes/2.json", makeNote(2, FUTURE)); // active -> keep
    fs.set("users/alex/notes/3.json", makeNote(3, null)); // no window -> noop

    const summary = await runRevertWindowSweep("alex", NOW);

    expect(summary.scanned).toBe(3);
    expect(summary.withWindow).toBe(2);
    expect(summary.stripped).toBe(1);
    expect(summary.kept).toBe(1);
    expect(summary.errors).toBe(0);

    // Note 1: window gone.
    const n1 = fs.get("users/alex/notes/1.json") as Record<string, unknown>;
    expect("revert_undo_window" in n1).toBe(false);
    // Note 2: window preserved untouched.
    const n2 = fs.get("users/alex/notes/2.json") as Record<string, unknown>;
    expect(n2.revert_undo_window).toBeTruthy();
    // Note 3: never had one; unchanged.
    const n3 = fs.get("users/alex/notes/3.json") as Record<string, unknown>;
    expect("revert_undo_window" in n3).toBe(false);
  });

  it("treats the boundary (now === expires_at) as expired", async () => {
    fs.set("users/alex/notes/1.json", makeNote(1, new Date(NOW).toISOString()));
    const summary = await runRevertWindowSweep("alex", NOW);
    expect(summary.stripped).toBe(1);
  });

  it("skips sidecar/index files (underscore-prefixed)", async () => {
    fs.set("users/alex/notes/1.json", makeNote(1, PAST));
    fs.set("users/alex/notes/_index.json", { version: 1, entries: [] });
    const summary = await runRevertWindowSweep("alex", NOW);
    expect(summary.scanned).toBe(1); // only the real note
    expect(summary.stripped).toBe(1);
  });
});
