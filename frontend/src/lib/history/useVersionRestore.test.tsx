// VC restore-guard sub-bot of HR (2026-05-30): in-flight guard tests for
// useVersionRestore. The VC persona testing found a double-fire concurrency
// bug: handleRestore + handleUndoRestore were async with NO in-flight guard, so
// a distracted double click could fire two concurrent restores (two "revert"
// history rows + overlapping revert_undo_window state). These tests pin the
// fix: a second invocation while one is in flight is a no-op (api.update fires
// once, not twice), and isBusy reflects the in-flight state for the UI layer.
//
// The history engine is mocked so we can hold readHistory open (a deferred
// promise) to keep a handler in flight while we fire the second click. We mock
// only historyEngine.readHistory / reverseWalkTo; canonicalize +
// HistoryCompactedTargetError are the real exports (importActual).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// A deferred promise we can resolve from the test to release an in-flight
// readHistory call (and thus keep a restore handler suspended mid-flight).
function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Mutable engine handles the mock factory reads at call time (the factory is
// hoisted, so it cannot close over test-scoped consts directly).
const engineMock = {
  readHistory: vi.fn(),
  reverseWalkTo: vi.fn(),
};

vi.mock("@/lib/history", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/history")>();
  return {
    ...actual,
    historyEngine: {
      readHistory: (...args: unknown[]) => engineMock.readHistory(...args),
      reverseWalkTo: (...args: unknown[]) => engineMock.reverseWalkTo(...args),
    },
  };
});

import { useVersionRestore } from "./useVersionRestore";
import type { RestorableRecord } from "./useVersionRestore";

// A minimal seeded history: a genesis-ish HEAD plus enough rows that the target
// version (1) is a valid non-HEAD index. The exact row contents do not matter:
// reverseWalkTo is mocked to return the target canonical directly.
const ROWS = [
  { id: "g0", kind: "genesis" },
  { id: "r1", kind: "update" },
  { id: "r2", kind: "update" },
];

// The canonical the (mocked) reverse-walk resolves to for the restore target.
// canonicalToPayload(JSON.parse(...)) drops immutable keys; whatever survives
// is the update payload. We keep one tracked field so the payload is non-empty.
const TARGET_CANONICAL = JSON.stringify({ id: 47, n: 1, title: "rev" });

interface TestRecord extends RestorableRecord {
  id: number;
  username?: string;
  n?: number;
}

const BASE_RECORD: TestRecord = { id: 47, username: "mira", n: 2 };

function makeApi(updateImpl?: () => Promise<TestRecord>) {
  const get = vi.fn(async () => BASE_RECORD);
  const update = vi.fn(
    updateImpl ?? (async () => ({ ...BASE_RECORD, n: 1 })),
  );
  return { get, update };
}

function renderRestore(
  api: ReturnType<typeof makeApi>,
  record: TestRecord = BASE_RECORD,
) {
  return renderHook(() =>
    useVersionRestore<TestRecord>({
      entityType: "notes",
      record,
      id: record.id,
      owner: "mira",
      api,
      currentUser: "mira",
      onUpdate: () => {},
      immutableKeys: ["id", "created_at", "username"],
    }),
  );
}

beforeEach(() => {
  engineMock.readHistory.mockReset();
  engineMock.reverseWalkTo.mockReset();
  engineMock.reverseWalkTo.mockReturnValue(TARGET_CANONICAL);
});

describe("useVersionRestore double-fire guard (handleRestore)", () => {
  it("a second handleRestore while one is in flight is a no-op: api.update fires exactly once", async () => {
    // Hold readHistory open so the first restore stays suspended mid-flight
    // while we fire the second (distracted double click).
    const gate = defer<typeof ROWS>();
    engineMock.readHistory.mockReturnValueOnce(gate.promise);
    // Any later readHistory (there should be none) resolves immediately so a
    // leaked second call would still reach api.update and fail the assertion.
    engineMock.readHistory.mockResolvedValue(ROWS);

    const api = makeApi();
    const { result } = renderRestore(api);

    // Fire the first restore (do NOT await): it latches busy, then awaits
    // the held readHistory.
    let firstCall!: Promise<void>;
    act(() => {
      firstCall = result.current.handleRestore(1);
    });
    expect(result.current.isBusy).toBe(true);

    // The distracted second click, same tick, while busy: must early-return.
    let secondCall!: Promise<void>;
    act(() => {
      secondCall = result.current.handleRestore(1);
    });
    // The second invocation resolved immediately (early return), having done
    // nothing: readHistory was only consumed once.
    await secondCall;
    expect(engineMock.readHistory).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();

    // Release the first restore and let it finish.
    await act(async () => {
      gate.resolve(ROWS);
      await firstCall;
    });

    // Exactly ONE write: no double revert row, no overlapping window.
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith(
      47,
      expect.objectContaining({ revert_undo_window: expect.any(Object) }),
      expect.objectContaining({ kind: "revert" }),
    );
    expect(result.current.isBusy).toBe(false);
  });

  it("clears isBusy after a normal restore so a later restore can run", async () => {
    engineMock.readHistory.mockResolvedValue(ROWS);
    const api = makeApi();
    const { result } = renderRestore(api);

    await act(async () => {
      await result.current.handleRestore(1);
    });
    expect(result.current.isBusy).toBe(false);
    expect(api.update).toHaveBeenCalledTimes(1);

    // A fresh restore after the first completed is allowed (guard cleared).
    await act(async () => {
      await result.current.handleRestore(1);
    });
    expect(api.update).toHaveBeenCalledTimes(2);
  });
});

describe("useVersionRestore double-fire guard (handleUndoRestore)", () => {
  // A record with a live undo window so handleUndoRestore proceeds past the
  // `if (!undoWindow) return` gate.
  const WINDOWED_RECORD: TestRecord = {
    id: 47,
    username: "mira",
    n: 1,
    revert_undo_window: {
      from_version: 2,
      to_version: 1,
      reverted_at: "2026-05-30T12:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      reverted_by: "mira",
    },
  };

  it("a second handleUndoRestore while one is in flight is a no-op: api.update fires exactly once", async () => {
    const gate = defer<typeof ROWS>();
    engineMock.readHistory.mockReturnValueOnce(gate.promise);
    engineMock.readHistory.mockResolvedValue(ROWS);
    // The undo reverse-walks to from_version (the pre-restore canonical).
    engineMock.reverseWalkTo.mockReturnValue(TARGET_CANONICAL);

    const api = makeApi();
    const { result } = renderRestore(api, WINDOWED_RECORD);

    let firstCall!: Promise<void>;
    act(() => {
      firstCall = result.current.handleUndoRestore();
    });
    expect(result.current.isBusy).toBe(true);

    let secondCall!: Promise<void>;
    act(() => {
      secondCall = result.current.handleUndoRestore();
    });
    await secondCall;
    expect(engineMock.readHistory).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve(ROWS);
      await firstCall;
    });

    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith(
      47,
      expect.objectContaining({ revert_undo_window: null }),
      expect.objectContaining({ kind: "undo-revert" }),
    );
    expect(result.current.isBusy).toBe(false);
  });
});

// vc-persona-fixes sub-bot of HR (2026-05-30): the edits-since guard must count
// ONLY real content edits (kind "update") past the restore row. The restore
// itself appends a "revert" row, and a later undo appends "undo-revert"; none of
// those are the user editing their note, so they must NOT trip the in-app
// confirm. The live testing saw the prompt fire after a clean restore because
// the old math counted every row past the restore row, including the restore's
// own companion / revert rows. The hook NEVER calls native confirm() (that can
// freeze the Electron renderer); it raises `undoConfirmPending` instead.
describe("useVersionRestore edits-since confirm (kind-aware, in-app)", () => {
  // The restore wrote a row at from_version + 1. With from_version = 1, that is
  // index 2. Rows at index > 2 are candidate edits-since.
  const RESTORED_RECORD: TestRecord = {
    id: 47,
    username: "mira",
    n: 1,
    revert_undo_window: {
      from_version: 1,
      to_version: 0,
      reverted_at: "2026-05-30T12:00:00.000Z",
      expires_at: "2099-01-01T00:00:00.000Z",
      reverted_by: "mira",
    },
  };

  it("a clean restore (no real edits since) undoes immediately, no in-app confirm", async () => {
    // rows: [genesis(0), update(1), revert(2)], the restore row is the HEAD.
    // Nothing past it, so editsSince === 0 -> undo proceeds, no confirm.
    engineMock.readHistory.mockResolvedValue([
      { id: "g0", kind: "genesis" },
      { id: "r1", kind: "update" },
      { id: "r2", kind: "revert" },
    ]);
    const api = makeApi();
    const { result } = renderRestore(api, RESTORED_RECORD);

    await act(async () => {
      await result.current.handleUndoRestore();
    });

    expect(result.current.undoConfirmPending).toBe(false);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith(
      47,
      expect.objectContaining({ revert_undo_window: null }),
      expect.objectContaining({ kind: "undo-revert" }),
    );
  });

  it("a 'revert'/'undo-revert' row past the restore does NOT count as an edit-since", async () => {
    // rows past the restore row (index 2) are revert/undo-revert, NOT user
    // edits. editsSince must be 0 -> undo proceeds without a confirm.
    engineMock.readHistory.mockResolvedValue([
      { id: "g0", kind: "genesis" },
      { id: "r1", kind: "update" },
      { id: "r2", kind: "revert" }, // the restore row (from_version + 1)
      { id: "r3", kind: "undo-revert" },
      { id: "r4", kind: "revert" },
    ]);
    const api = makeApi();
    const { result } = renderRestore(api, RESTORED_RECORD);

    await act(async () => {
      await result.current.handleUndoRestore();
    });

    expect(result.current.undoConfirmPending).toBe(false);
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it("a real 'update' edit since the restore raises the in-app confirm (no native confirm, no write yet)", async () => {
    // rows: [genesis, update, revert(restore), update(real edit since)].
    engineMock.readHistory.mockResolvedValue([
      { id: "g0", kind: "genesis" },
      { id: "r1", kind: "update" },
      { id: "r2", kind: "revert" }, // restore row
      { id: "r3", kind: "update" }, // the user actually edited since
    ]);
    const api = makeApi();
    const { result } = renderRestore(api, RESTORED_RECORD);

    await act(async () => {
      await result.current.handleUndoRestore();
    });

    // Raised the in-app confirm; NO write happened yet.
    expect(result.current.undoConfirmPending).toBe(true);
    expect(api.update).not.toHaveBeenCalled();

    // Confirming proceeds with the undo write.
    await act(async () => {
      await result.current.confirmUndoRestore();
    });
    expect(result.current.undoConfirmPending).toBe(false);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith(
      47,
      expect.objectContaining({ revert_undo_window: null }),
      expect.objectContaining({ kind: "undo-revert" }),
    );
  });

  it("dismissing the in-app confirm leaves the note untouched", async () => {
    engineMock.readHistory.mockResolvedValue([
      { id: "g0", kind: "genesis" },
      { id: "r1", kind: "update" },
      { id: "r2", kind: "revert" },
      { id: "r3", kind: "update" },
    ]);
    const api = makeApi();
    const { result } = renderRestore(api, RESTORED_RECORD);

    await act(async () => {
      await result.current.handleUndoRestore();
    });
    expect(result.current.undoConfirmPending).toBe(true);

    act(() => {
      result.current.dismissUndoConfirm();
    });
    expect(result.current.undoConfirmPending).toBe(false);
    expect(api.update).not.toHaveBeenCalled();
  });
});

// Guard the house rule directly: the undo path must not reference native
// confirm() in source (it can wedge the Electron renderer). The old code called
// window.confirm in handleUndoRestore; this pins that it stays gone.
describe("useVersionRestore source: no native confirm()", () => {
  it("the hook source contains no native confirm( call", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "useVersionRestore.ts"),
      "utf8",
    );
    // Strip block comments (/* ... */, incl. JSDoc) and line comments first so
    // the explanatory "no native confirm()" notes do not false-positive; then
    // assert no native confirm() call survives in real code.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bwindow\.confirm\b/);
    // A bare `confirm(` (not preceded by a letter / dot, so not a method name
    // like confirmUndoRestore or setUndoConfirmPending). Word-boundary anchored.
    expect(code).not.toMatch(/(?<![\w.])confirm\s*\(/);
  });
});
