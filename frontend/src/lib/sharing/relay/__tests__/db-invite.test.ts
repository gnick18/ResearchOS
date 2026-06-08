// Cross-boundary sharing, the pending-invite db helpers (invite-a-non-user).
//
// Pins the SQL-level invariants of the pending-invite table without a live Neon
// connection, using the same tagged-template recorder pattern as db.test.ts. The
// invite table mirrors relay_inbox's confirm-after-upload shape, pending on
// insert, ready-only on read, the pending-to-ready flip scoped to the sender, and
// delete-on-pickup. No real DB, no R2.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Recorded {
  text: string;
  values: unknown[];
}

const recorded: Recorded[] = [];
let resultQueue: unknown[][] = [];

function sqlTag(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<unknown[]> {
  recorded.push({ text: strings.join("?"), values });
  const result = resultQueue.length ? resultQueue.shift()! : [];
  return Promise.resolve(result);
}

vi.mock("@neondatabase/serverless", () => ({
  neon: () => sqlTag,
}));

process.env.DATABASE_URL = "postgres://test";

import {
  countInvitesBySender,
  deleteInviteEntry,
  getInviteEntry,
  insertInviteEntry,
  markInviteReady,
  sumPendingInviteBytesByRecipient,
} from "../db";

function lastQuery(): Recorded {
  return recorded[recorded.length - 1];
}

beforeEach(() => {
  recorded.length = 0;
  resultQueue = [];
});

describe("insertInviteEntry", () => {
  it("inserts the invite row as pending", async () => {
    await insertInviteEntry({
      inviteId: "i1",
      recipientEmailHash: "rh",
      senderEmailHash: "sh",
      sizeBytes: 99,
      expiresAt: "2026-07-04T00:00:00.000Z",
    });
    const q = lastQuery();
    expect(q.text).toContain("INSERT INTO relay_invite");
    expect(q.text).toContain("'pending'");
    expect(q.values).toEqual([
      "i1",
      "rh",
      "sh",
      99,
      "2026-07-04T00:00:00.000Z",
    ]);
  });
});

describe("markInviteReady", () => {
  it("flips a pending invite scoped to the sender and returns the row", async () => {
    resultQueue = [
      [
        {
          invite_id: "i1",
          recipient_email_hash: "rh",
          sender_email_hash: "sh",
          size_bytes: "99",
          created_at: "2026-06-04T00:00:00.000Z",
          expires_at: "2026-07-04T00:00:00.000Z",
        },
      ],
    ];
    const row = await markInviteReady("i1", "sh");
    const q = lastQuery();
    expect(q.text).toContain("UPDATE relay_invite");
    expect(q.text).toContain("status = 'ready'");
    expect(q.text).toContain("status = 'pending'");
    expect(q.text).toContain("sender_email_hash = ?");
    expect(q.values).toEqual(["i1", "sh"]);
    expect(row?.inviteId).toBe("i1");
    expect(row?.sizeBytes).toBe(99);
  });

  it("returns null when no matching pending invite exists", async () => {
    resultQueue = [[]];
    expect(await markInviteReady("i1", "sh")).toBeNull();
  });
});

describe("getInviteEntry", () => {
  it("returns a ready invite and filters by status", async () => {
    resultQueue = [
      [
        {
          invite_id: "i1",
          recipient_email_hash: "rh",
          sender_email_hash: "sh",
          size_bytes: null,
          created_at: "2026-06-04T00:00:00.000Z",
          expires_at: "2026-07-04T00:00:00.000Z",
        },
      ],
    ];
    const entry = await getInviteEntry("i1");
    expect(lastQuery().text).toContain("status = 'ready'");
    expect(entry?.inviteId).toBe("i1");
    expect(entry?.sizeBytes).toBeNull();
  });

  it("returns null when no ready invite matches (pending reads as absent)", async () => {
    resultQueue = [[]];
    expect(await getInviteEntry("i1")).toBeNull();
  });
});

describe("countInvitesBySender", () => {
  it("counts non-expired invites for a sender", async () => {
    resultQueue = [[{ n: 3 }]];
    const n = await countInvitesBySender("sh");
    const q = lastQuery();
    expect(q.text).toContain("count(*)");
    expect(q.text).toContain("sender_email_hash = ?");
    expect(q.text).toContain("expires_at > now()");
    expect(q.values).toEqual(["sh"]);
    expect(n).toBe(3);
  });

  it("returns 0 when no row comes back", async () => {
    resultQueue = [[]];
    expect(await countInvitesBySender("sh")).toBe(0);
  });
});

describe("sumPendingInviteBytesByRecipient", () => {
  it("sums non-expired invite bytes keyed by the RECIPIENT hash", async () => {
    resultQueue = [[{ total: "1234" }]];
    const n = await sumPendingInviteBytesByRecipient("rh");
    const q = lastQuery();
    expect(q.text).toContain("sum(size_bytes)");
    expect(q.text).toContain("FROM relay_invite");
    // Keyed by recipient, not sender, to match the send path's abuse model.
    expect(q.text).toContain("recipient_email_hash = ?");
    expect(q.text).not.toContain("sender_email_hash");
    expect(q.text).toContain("expires_at > now()");
    expect(q.values).toEqual(["rh"]);
    // The bigint sum may arrive as a string from the Neon driver, coerced here.
    expect(n).toBe(1234);
  });

  it("returns 0 when the recipient has no invite bytes", async () => {
    resultQueue = [[{ total: 0 }]];
    expect(await sumPendingInviteBytesByRecipient("rh")).toBe(0);
  });

  it("returns 0 when no row comes back", async () => {
    resultQueue = [[]];
    expect(await sumPendingInviteBytesByRecipient("rh")).toBe(0);
  });
});

describe("deleteInviteEntry", () => {
  it("deletes the invite row by id", async () => {
    await deleteInviteEntry("i1");
    const q = lastQuery();
    expect(q.text).toContain("DELETE FROM relay_invite");
    expect(q.values).toEqual(["i1"]);
  });
});
