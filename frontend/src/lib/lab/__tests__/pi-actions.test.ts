// Mira-Skeptic P0 fix pass (Mira-Skeptic P0 fix manager, 2026-05-23):
// regression tests for the four P0s landed in this pass.
//   - P0 #1: audit failures propagate as `{ ok: false, reason: "audit",
//            value }` instead of being swallowed.
//   - P0 #2: clearFlagAsOwner emits an audit entry mirroring set-flag.
//   - P0 #4: session-gate fires before any write when the live session
//            doesn't match the actor + sessionId.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock file-system service. The audit writer + the raw API helpers both
// read/write through this; we drive them via a shared in-memory map.
const fakeFiles: Record<string, unknown> = {};
let writeJsonShouldFailFor: string | null = null;

vi.mock("../../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => fakeFiles[path] ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      if (writeJsonShouldFailFor && path === writeJsonShouldFailFor) {
        throw new Error(`[fake-fs] simulated writeJson failure for ${path}`);
      }
      fakeFiles[path] = data;
    }),
    fileExists: vi.fn(async (path: string) => path in fakeFiles),
    deleteFile: vi.fn(async (path: string) => {
      const had = path in fakeFiles;
      delete fakeFiles[path];
      return had;
    }),
    listDirectories: vi.fn(async () => []),
  },
}));

// Mock the raw APIs so we can drive get/update without standing up the
// full local-api stack. The Phase 3 actions only use these four entry
// points.
vi.mock("@/lib/local-api", () => {
  return {
    tasksApi: {
      get: vi.fn(async (id: number, owner: string) => {
        return fakeFiles[`users/${owner}/tasks/${id}.json`] ?? null;
      }),
      update: vi.fn(
        async (
          id: number,
          patch: Record<string, unknown>,
          owner: string,
        ) => {
          const path = `users/${owner}/tasks/${id}.json`;
          const existing = (fakeFiles[path] as Record<string, unknown>) ?? null;
          if (!existing) return null;
          const next = { ...existing, ...patch };
          fakeFiles[path] = next;
          return next;
        },
      ),
    },
    notesApi: {
      get: vi.fn(async (id: number, owner: string) => {
        return fakeFiles[`users/${owner}/notes/${id}.json`] ?? null;
      }),
      update: vi.fn(
        async (
          id: number,
          patch: Record<string, unknown>,
          owner: string,
        ) => {
          const path = `users/${owner}/notes/${id}.json`;
          const existing = (fakeFiles[path] as Record<string, unknown>) ?? null;
          if (!existing) return null;
          const next = { ...existing, ...patch };
          fakeFiles[path] = next;
          return next;
        },
      ),
    },
    purchasesApi: {
      update: vi.fn(
        async (
          id: number,
          patch: Record<string, unknown>,
          owner: string,
        ) => {
          const path = `users/${owner}/purchase_items/${id}.json`;
          const existing = (fakeFiles[path] as Record<string, unknown>) ?? null;
          if (!existing) return null;
          const next = { ...existing, ...patch };
          fakeFiles[path] = next;
          return next;
        },
      ),
    },
  };
});

// Imported AFTER the mocks so the action module picks them up.
import {
  assignTask,
  setPurchaseApproval,
  setFlagForReview,
  clearFlagAsOwner,
  declinePurchase,
} from "../pi-actions";
import { readAuditEntries } from "../pi-audit";
import {
  resetEditSession,
  startEditSession,
} from "../edit-session";

function seedTask(owner: string, id: number, fields: Record<string, unknown>) {
  fakeFiles[`users/${owner}/tasks/${id}.json`] = {
    id,
    name: `Task ${id}`,
    assignee: null,
    flagged: null,
    ...fields,
  };
}

function seedNote(owner: string, id: number, fields: Record<string, unknown>) {
  fakeFiles[`users/${owner}/notes/${id}.json`] = {
    id,
    title: `Note ${id}`,
    flagged: null,
    ...fields,
  };
}

function seedPurchase(owner: string, id: number, fields: Record<string, unknown>) {
  fakeFiles[`users/${owner}/purchase_items/${id}.json`] = {
    id,
    item_name: `Item ${id}`,
    approved: false,
    flagged: null,
    ...fields,
  };
}

describe("pi-actions", () => {
  beforeEach(() => {
    for (const k of Object.keys(fakeFiles)) delete fakeFiles[k];
    writeJsonShouldFailFor = null;
    resetEditSession();
  });

  afterEach(() => {
    resetEditSession();
  });

  // ── P0 #4: session gate ───────────────────────────────────────────────

  describe("session gate (P0 #4)", () => {
    it("assignTask rejects when no session is unlocked", async () => {
      seedTask("alex", 1, {});
      const result = await assignTask({
        actor: "mira",
        sessionId: "stale-id",
        targetOwner: "alex",
        taskId: 1,
        assignee: "bob",
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("data-write");
      const msg =
        result.ok === false && result.error instanceof Error
          ? result.error.message
          : "";
      expect(msg).toMatch(/Edit session expired or sessionId mismatch/);
      // No data write should have occurred.
      const task = fakeFiles["users/alex/tasks/1.json"] as { assignee: string };
      expect(task.assignee).toBeNull();
    });

    it("assignTask rejects when actor doesn't match the live session user", async () => {
      seedTask("alex", 1, {});
      const live = startEditSession("eve");
      const result = await assignTask({
        actor: "mira",
        sessionId: live.id,
        targetOwner: "alex",
        taskId: 1,
        assignee: "bob",
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("data-write");
    });

    it("assignTask rejects when sessionId is stale (live session has a different id)", async () => {
      seedTask("alex", 1, {});
      startEditSession("mira");
      const result = await assignTask({
        actor: "mira",
        sessionId: "stale-from-mount",
        targetOwner: "alex",
        taskId: 1,
        assignee: "bob",
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("data-write");
    });

    it("assignTask succeeds when session matches", async () => {
      seedTask("alex", 1, {});
      const live = startEditSession("mira");
      const result = await assignTask({
        actor: "mira",
        sessionId: live.id,
        targetOwner: "alex",
        taskId: 1,
        assignee: "bob",
        taskName: "Test task",
      });
      expect(result.ok).toBe(true);
      const task = fakeFiles["users/alex/tasks/1.json"] as { assignee: string };
      expect(task.assignee).toBe("bob");
    });

    it("setPurchaseApproval rejects with stale session", async () => {
      seedPurchase("alex", 1, {});
      const result = await setPurchaseApproval({
        actor: "mira",
        sessionId: "no-session",
        targetOwner: "alex",
        purchaseItemId: 1,
        approved: true,
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("data-write");
    });

    it("setFlagForReview rejects with stale session", async () => {
      seedTask("alex", 1, {});
      const result = await setFlagForReview({
        actor: "mira",
        sessionId: "no-session",
        targetOwner: "alex",
        recordType: "task",
        recordId: 1,
        flag: { by: "mira", at: "2026-05-23T00:00:00Z", reason: null },
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("data-write");
    });

    it("clearFlagAsOwner does NOT require a session (owner action)", async () => {
      seedTask("alex", 1, {
        flagged: { by: "mira", at: "2026-05-23T00:00:00Z", reason: null },
      });
      const result = await clearFlagAsOwner({
        owner: "alex",
        recordType: "task",
        recordId: 1,
      });
      expect(result.ok).toBe(true);
      const task = fakeFiles["users/alex/tasks/1.json"] as { flagged: unknown };
      expect(task.flagged).toBeNull();
    });
  });

  // ── P0 #1: audit failure propagation ─────────────────────────────────

  describe("audit failure propagation (P0 #1)", () => {
    it("assignTask returns {ok:false, reason:'audit'} when the audit write fails, but the data still landed", async () => {
      seedTask("alex", 1, {});
      const live = startEditSession("mira");

      writeJsonShouldFailFor = "users/alex/_pi_audit.json";
      const result = await assignTask({
        actor: "mira",
        sessionId: live.id,
        targetOwner: "alex",
        taskId: 1,
        assignee: "bob",
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("audit");
      // Data DID land.
      const task = fakeFiles["users/alex/tasks/1.json"] as { assignee: string };
      expect(task.assignee).toBe("bob");
      // value carries the post-write shape.
      if (result.ok === false && result.reason === "audit") {
        expect(result.value.assignee).toBe("bob");
        expect(result.value.previousAssignee).toBeNull();
      }
    });

    it("setPurchaseApproval surfaces audit failures the same way", async () => {
      seedPurchase("alex", 1, {});
      const live = startEditSession("mira");

      writeJsonShouldFailFor = "users/alex/_pi_audit.json";
      const result = await setPurchaseApproval({
        actor: "mira",
        sessionId: live.id,
        targetOwner: "alex",
        purchaseItemId: 1,
        approved: true,
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("audit");
      const item = fakeFiles["users/alex/purchase_items/1.json"] as {
        approved: boolean;
      };
      expect(item.approved).toBe(true);
    });

    it("setFlagForReview surfaces audit failures the same way", async () => {
      seedTask("alex", 1, {});
      const live = startEditSession("mira");

      writeJsonShouldFailFor = "users/alex/_pi_audit.json";
      const next = { by: "mira", at: "2026-05-23T00:00:00Z", reason: null };
      const result = await setFlagForReview({
        actor: "mira",
        sessionId: live.id,
        targetOwner: "alex",
        recordType: "task",
        recordId: 1,
        flag: next,
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("audit");
      const task = fakeFiles["users/alex/tasks/1.json"] as { flagged: unknown };
      expect(task.flagged).toEqual(next);
    });

    it("success path produces a single audit entry", async () => {
      seedTask("alex", 1, {});
      const live = startEditSession("mira");

      const result = await assignTask({
        actor: "mira",
        sessionId: live.id,
        targetOwner: "alex",
        taskId: 1,
        assignee: "bob",
      });

      expect(result.ok).toBe(true);
      const entries = await readAuditEntries("alex");
      expect(entries).toHaveLength(1);
      expect(entries[0].field_path).toBe("assignee");
      expect(entries[0].old_value).toBeNull();
      expect(entries[0].new_value).toBe("bob");
      expect(entries[0].session_id).toBe(live.id);
      expect(entries[0].actor).toBe("mira");
    });
  });

  // ── P0 #2: clearFlagAsOwner emits an audit entry ─────────────────────

  describe("clearFlagAsOwner emits audit (P0 #2)", () => {
    it("emits an audit entry with actor=owner and session_id='owner-clear'", async () => {
      const setFlag = {
        by: "mira",
        at: "2026-05-23T00:00:00Z",
        reason: "please double-check",
      };
      seedTask("alex", 1, { flagged: setFlag });

      const result = await clearFlagAsOwner({
        owner: "alex",
        recordType: "task",
        recordId: 1,
      });

      expect(result.ok).toBe(true);
      const task = fakeFiles["users/alex/tasks/1.json"] as { flagged: unknown };
      expect(task.flagged).toBeNull();

      const entries = await readAuditEntries("alex");
      expect(entries).toHaveLength(1);
      expect(entries[0].actor).toBe("alex");
      expect(entries[0].session_id).toBe("owner-clear");
      expect(entries[0].record_type).toBe("task");
      expect(entries[0].record_id).toBe(1);
      expect(entries[0].field_path).toBe("flagged");
      expect(entries[0].old_value).toEqual(setFlag);
      expect(entries[0].new_value).toBeNull();
    });

    it("emits the audit entry for note + purchase_item too", async () => {
      const setFlag = { by: "mira", at: "2026-05-23T00:00:00Z", reason: null };
      seedNote("alex", 2, { flagged: setFlag });
      seedPurchase("alex", 3, { flagged: setFlag });

      await clearFlagAsOwner({
        owner: "alex",
        recordType: "note",
        recordId: 2,
      });
      await clearFlagAsOwner({
        owner: "alex",
        recordType: "purchase_item",
        recordId: 3,
      });

      const entries = await readAuditEntries("alex");
      expect(entries).toHaveLength(2);
      expect(entries[0].record_type).toBe("note");
      expect(entries[1].record_type).toBe("purchase_item");
    });

    it("surfaces audit failures via {ok:false, reason:'audit'} but still clears the flag", async () => {
      const setFlag = { by: "mira", at: "2026-05-23T00:00:00Z", reason: null };
      seedTask("alex", 1, { flagged: setFlag });

      writeJsonShouldFailFor = "users/alex/_pi_audit.json";
      const result = await clearFlagAsOwner({
        owner: "alex",
        recordType: "task",
        recordId: 1,
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("audit");
      const task = fakeFiles["users/alex/tasks/1.json"] as { flagged: unknown };
      expect(task.flagged).toBeNull();
    });

    it("data-write failure (missing record) is reported as reason='data-write'", async () => {
      // No task seeded.
      const result = await clearFlagAsOwner({
        owner: "alex",
        recordType: "task",
        recordId: 999,
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("data-write");
    });
  });

  // ── PiActions follow-up Item 3 (2026-05-23): declinePurchase ─────────
  //
  // The decline path persists `declined_at` + `declined_by` so the UI
  // can distinguish "pending" from "PI turned this down." Approve always
  // clears both back to null so a re-approve via setPurchaseApproval is
  // the single path back to approved (no separate re-approve writer).

  describe("declinePurchase (PiActions follow-up Item 3)", () => {
    it("stamps declined_at + declined_by and clears approved fields", async () => {
      seedPurchase("alex", 1, {});
      const live = startEditSession("mira");

      const result = await declinePurchase({
        actor: "mira",
        sessionId: live.id,
        targetOwner: "alex",
        purchaseItemId: 1,
        itemName: "Test item",
      });

      expect(result.ok).toBe(true);
      const item = fakeFiles["users/alex/purchase_items/1.json"] as {
        approved: boolean;
        approved_by: string | null;
        approved_at: string | null;
        declined_at: string | null;
        declined_by: string | null;
      };
      expect(item.approved).toBe(false);
      expect(item.approved_by).toBeNull();
      expect(item.approved_at).toBeNull();
      expect(item.declined_at).toBeTruthy();
      expect(item.declined_by).toBe("mira");
    });

    it("emits an audit entry with field_path='declined'", async () => {
      seedPurchase("alex", 1, {});
      const live = startEditSession("mira");

      await declinePurchase({
        actor: "mira",
        sessionId: live.id,
        targetOwner: "alex",
        purchaseItemId: 1,
      });

      const entries = await readAuditEntries("alex");
      const declineEntry = entries.find((e) => e.field_path === "declined");
      expect(declineEntry).toBeTruthy();
      expect(declineEntry?.actor).toBe("mira");
      expect(declineEntry?.record_type).toBe("purchase_item");
      expect(declineEntry?.old_value).toBeNull();
      expect(declineEntry?.new_value).toBeTruthy();
    });

    it("rejects with stale session", async () => {
      seedPurchase("alex", 1, {});
      const result = await declinePurchase({
        actor: "mira",
        sessionId: "no-session",
        targetOwner: "alex",
        purchaseItemId: 1,
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("data-write");
    });

    it("setPurchaseApproval(approved:true) clears prior decline state", async () => {
      // Seed a declined item — mimics state after a prior decline.
      seedPurchase("alex", 1, {
        approved: false,
        declined_at: "2026-05-22T12:00:00Z",
        declined_by: "mira",
      });
      const live = startEditSession("mira");

      const result = await setPurchaseApproval({
        actor: "mira",
        sessionId: live.id,
        targetOwner: "alex",
        purchaseItemId: 1,
        approved: true,
      });

      expect(result.ok).toBe(true);
      const item = fakeFiles["users/alex/purchase_items/1.json"] as {
        approved: boolean;
        approved_by: string | null;
        declined_at: string | null;
        declined_by: string | null;
      };
      expect(item.approved).toBe(true);
      expect(item.approved_by).toBe("mira");
      expect(item.declined_at).toBeNull();
      expect(item.declined_by).toBeNull();
    });
  });
});
