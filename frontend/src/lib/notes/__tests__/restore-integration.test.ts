// frontend/src/lib/notes/__tests__/restore-integration.test.ts
//
// VC Phase 2 (restore-a-version sub-bot of HR, 2026-05-30). The DATA-MUTATING
// backbone: drive a restore + an undo-restore through the REAL notesApi.update
// (FLAG-5 historyMeta plumbing) and assert BOTH the live note file AND the
// history log are written correctly.
//
// We mock the fileService with an in-memory FS that supports json (notes) AND
// text (the jsonl history log), so recordNoteHistory actually appends rows.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@/lib/types";

const memFs = new Map<string, unknown>(); // json store (notes)
const memText = new Map<string, string>(); // text store (history jsonl)

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    readText: vi.fn(async (path: string) => memText.get(path) ?? null),
    writeText: vi.fn(async (path: string, data: string) => {
      memText.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async () => []),
    deleteFile: vi.fn(async () => true),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("@/lib/file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => "alex"),
}));

// This suite verifies the LEGACY jsonl notes-history restore path, which
// notesApi.update skips once LORO_PILOT_ENABLED is on (Loro owns history then).
// The pilot is now on by default in prod, so force the flag off here to exercise
// the legacy engine the test is written for. The Loro history path has its own
// pilot test suite.
vi.mock("@/lib/loro/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/loro/config")>()),
  LORO_PILOT_ENABLED: false,
}));

import { notesApi } from "@/lib/local-api";
import { historyEngine, canonicalize } from "@/lib/history";
import type { DeltaRow } from "@/lib/history";

const HISTORY_PATH = "users/alex/_history/notes/1.jsonl";

function seedNote(): Note {
  const note: Note = {
    id: 1,
    title: "Original title",
    description: "v1",
    is_running_log: false,
    is_shared: false,
    entries: [],
    updated_at: "2026-05-25T00:00:00.000Z",
    username: "alex",
  };
  memFs.set("users/alex/notes/1.json", note);
  return note;
}

function historyRows(): DeltaRow[] {
  const raw = memText.get(HISTORY_PATH) ?? "";
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as DeltaRow);
}

beforeEach(() => {
  memFs.clear();
  memText.clear();
});

describe("restore through notesApi.update (FLAG-5)", () => {
  it("restore: reverse-walk target -> update -> a 'revert' row with revert_target_version; the note reflects the target", async () => {
    seedNote();
    // Two real edits to build a history (v1 -> v2 -> v3).
    await notesApi.update(1, { description: "v2" });
    await notesApi.update(1, { description: "v3" });

    // Now restore back to the v2 state. Read rows, take HEAD from the LIVE note
    // (as the popup does: the note existed before its first tracked edit, so it
    // has a bare genesis that reconstructState cannot resolve unaided), reverse-
    // walk to the v2 row, build the payload.
    const rows = await historyEngine.readHistory("notes", "alex", 1);
    const liveHead = await notesApi.get(1, "alex");
    const headCanonical = canonicalize(liveHead);
    // rows: [genesis, update(v2), update(v3)] -> target index 1 = v2.
    const targetVersion = 1; // [genesis, v2, v3] -> index 1 is the v2 delta row
    const targetCanonical = historyEngine.reverseWalkTo(
      rows,
      targetVersion,
      headCanonical,
    );
    const parsed = JSON.parse(targetCanonical) as Record<string, unknown>;
    expect(parsed.description).toBe("v2");

    const payload = {
      title: parsed.title as string,
      description: parsed.description as string,
      revert_undo_window: {
        from_version: rows.length - 1,
        to_version: targetVersion,
        reverted_at: "2026-05-30T12:00:00.000Z",
        expires_at: "2026-05-31T12:00:00.000Z",
        reverted_by: "alex",
      },
    };
    // NB: the RAW notesApi.update signature is (id, data, owner?, historyMeta?).
    // The popup calls the owner-scoped WRAPPER (3-arg: id, data, historyMeta);
    // here we exercise the raw path, so owner is explicit `undefined`.
    const updated = await notesApi.update(1, payload, undefined, {
      kind: "revert",
      revert_target_version: targetVersion,
    });

    // The live note reflects the target (v2) + carries the undo window.
    expect(updated?.description).toBe("v2");
    expect(updated?.revert_undo_window?.to_version).toBe(targetVersion);

    // The history log got a NEW 'revert' HEAD row carrying revert_target_version.
    const after = historyRows();
    const head = after[after.length - 1];
    expect(head.kind).toBe("revert");
    expect(head.revert_target_version).toBe(targetVersion);
    // FLAG-2: the undo window is denylisted, so it never appears in the delta.
    expect(head.delta).not.toContain("revert_undo_window");
  });

  it("undo: clears the window + writes an 'undo-revert' row; the note returns to pre-restore", async () => {
    seedNote();
    await notesApi.update(1, { description: "v2" });
    await notesApi.update(1, { description: "v3" }); // pre-restore HEAD = v3

    const rowsBefore = await historyEngine.readHistory("notes", "alex", 1);
    const preRestoreVersion = rowsBefore.length - 1; // [genesis, v2, v3] -> 2

    // Restore to v2 (index 1). HEAD = the live note.
    const head1 = canonicalize(await notesApi.get(1, "alex"));
    const v2 = JSON.parse(
      historyEngine.reverseWalkTo(rowsBefore, 1, head1),
    ) as Record<string, unknown>;
    await notesApi.update(
      1,
      {
        title: v2.title as string,
        description: v2.description as string,
        revert_undo_window: {
          from_version: preRestoreVersion,
          to_version: 1,
          reverted_at: "2026-05-30T12:00:00.000Z",
          expires_at: "2026-05-31T12:00:00.000Z",
          reverted_by: "alex",
        },
      },
      undefined,
      { kind: "revert", revert_target_version: 1 },
    );

    // Undo: reverse-walk back to pre-restore (v3 @ preRestoreVersion), clear the
    // window. HEAD = the live (restored) note.
    const rowsAfterRestore = await historyEngine.readHistory("notes", "alex", 1);
    const head2 = canonicalize(await notesApi.get(1, "alex"));
    const preState = JSON.parse(
      historyEngine.reverseWalkTo(rowsAfterRestore, preRestoreVersion, head2),
    ) as Record<string, unknown>;
    const updated = await notesApi.update(
      1,
      {
        title: preState.title as string,
        description: preState.description as string,
        revert_undo_window: null, // CLEAR
      },
      undefined,
      { kind: "undo-revert", revert_target_version: preRestoreVersion },
    );

    // The note is back to v3 AND the window field is gone from the live record.
    expect(updated?.description).toBe("v3");
    expect(updated?.revert_undo_window).toBeUndefined();
    const onDisk = memFs.get("users/alex/notes/1.json") as Record<
      string,
      unknown
    >;
    expect("revert_undo_window" in onDisk).toBe(false);

    // The history log got an 'undo-revert' HEAD row.
    const after = historyRows();
    const head = after[after.length - 1];
    expect(head.kind).toBe("undo-revert");
    expect(head.revert_target_version).toBe(preRestoreVersion);
  });
});
