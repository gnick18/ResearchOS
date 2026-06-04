// Cross-boundary sharing, relay mailbox persistence unit tests
// (confirm-after-upload fix).
//
// These pin the SQL-level invariants of the confirm-after-upload model without a
// live Neon connection. The neon driver is mocked with a tagged-template recorder
// that captures the assembled query text and the bound values and hands back a
// programmable result, so each db helper can be exercised for the status filter
// it must apply (pending on insert, ready-only on read, the pending-to-ready
// flip, and the stale-pending sweep). No real DB, no R2.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Recorded {
  text: string;
  values: unknown[];
}

const recorded: Recorded[] = [];
let resultQueue: unknown[][] = [];

// A tagged-template stand-in for the neon sql function. It joins the static
// fragments with a "?" placeholder so a test can assert on the query shape, and
// returns the next programmed result (or an empty array) as a resolved promise.
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

// getSql reads DATABASE_URL lazily at call time, so setting it here is enough.
process.env.DATABASE_URL = "postgres://test";

import {
  getInboxEntry,
  insertInboxEntry,
  listInboxByRecipient,
  markInboxEntryReady,
  sweepStalePending,
} from "../db";

/** The newest recorded query (the helper under test issues exactly one). */
function lastQuery(): Recorded {
  return recorded[recorded.length - 1];
}

beforeEach(() => {
  recorded.length = 0;
  resultQueue = [];
});

describe("insertInboxEntry", () => {
  it("inserts the row as pending", async () => {
    await insertInboxEntry({
      bundleId: "b1",
      recipientEmailHash: "rh",
      senderEmailHash: "sh",
      sizeBytes: 42,
      expiresAt: "2026-07-03T00:00:00.000Z",
    });
    const q = lastQuery();
    expect(q.text).toContain("INSERT INTO relay_inbox");
    expect(q.text).toContain("'pending'");
    expect(q.values).toEqual([
      "b1",
      "rh",
      "sh",
      42,
      "2026-07-03T00:00:00.000Z",
    ]);
  });
});

describe("markInboxEntryReady", () => {
  it("flips a pending row scoped to the sender and reports the flip", async () => {
    resultQueue = [[{ bundle_id: "b1" }]];
    const ok = await markInboxEntryReady("b1", "sh");
    expect(ok).toBe(true);
    const q = lastQuery();
    expect(q.text).toContain("UPDATE relay_inbox");
    expect(q.text).toContain("status = 'ready'");
    expect(q.text).toContain("status = 'pending'");
    expect(q.text).toContain("sender_email_hash = ?");
    expect(q.values).toEqual(["b1", "sh"]);
  });

  it("reports no flip when no matching pending row exists", async () => {
    resultQueue = [[]];
    expect(await markInboxEntryReady("b1", "sh")).toBe(false);
  });
});

describe("listInboxByRecipient", () => {
  it("filters to ready and non-expired rows", async () => {
    resultQueue = [
      [
        {
          bundle_id: "b1",
          recipient_email_hash: "rh",
          sender_email_hash: "sh",
          size_bytes: "42",
          created_at: "2026-06-03T00:00:00.000Z",
          expires_at: "2026-07-03T00:00:00.000Z",
        },
      ],
    ];
    const rows = await listInboxByRecipient("rh");
    const q = lastQuery();
    expect(q.text).toContain("status = 'ready'");
    expect(q.text).toContain("expires_at > now()");
    expect(rows).toEqual([
      {
        bundleId: "b1",
        recipientEmailHash: "rh",
        senderEmailHash: "sh",
        sizeBytes: 42,
        createdAt: "2026-06-03T00:00:00.000Z",
        expiresAt: "2026-07-03T00:00:00.000Z",
      },
    ]);
  });
});

describe("getInboxEntry", () => {
  it("returns a ready row and filters by status", async () => {
    resultQueue = [
      [
        {
          bundle_id: "b1",
          recipient_email_hash: "rh",
          sender_email_hash: "sh",
          size_bytes: null,
          created_at: "2026-06-03T00:00:00.000Z",
          expires_at: "2026-07-03T00:00:00.000Z",
        },
      ],
    ];
    const entry = await getInboxEntry("b1");
    expect(lastQuery().text).toContain("status = 'ready'");
    expect(entry?.bundleId).toBe("b1");
  });

  it("returns null when no ready row matches (a pending row reads as absent)", async () => {
    resultQueue = [[]];
    expect(await getInboxEntry("b1")).toBeNull();
  });
});

describe("sweepStalePending", () => {
  it("deletes only pending rows past the grace window", async () => {
    await sweepStalePending("rh", 900);
    const q = lastQuery();
    expect(q.text).toContain("DELETE FROM relay_inbox");
    expect(q.text).toContain("status = 'pending'");
    expect(q.text).toContain("created_at < now()");
    expect(q.values).toEqual(["rh", 900]);
  });
});
