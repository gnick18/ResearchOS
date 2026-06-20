// Class-C1 lane: whole-lab ("*") share read-expansion in the member read path.
//
// The bug these tests pin: a record shared to the WHOLE lab via the "*"
// sentinel was INVISIBLE to members because the read gate did an exact-username
// match with no "*" handling. A "*"-shared record must now be visible to every
// roster member (and only to roster members), the per-record analog of the
// announcement lab-wide-public exception.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  pullLabView,
  recordSharedWith,
  recordIsWholeLabShared,
} from "./lab-read";
import { listLabRecords, getLabRecord } from "./lab-data-client";

// ---------------------------------------------------------------------------
// Test harness. We mock list/get so no real R2 / crypto runs. Each owner has a
// fixed set of records; getLabRecord returns the JSON plaintext we seeded.
// ---------------------------------------------------------------------------

const LAB_ID = "lab-c1";
const LAB_KEY = new Uint8Array([1, 2, 3]);
const SIGN_PRIV = new Uint8Array([9]);
const SIGN_PUB = new Uint8Array([8]);

function enc(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

/**
 * Build list/get impls from a flat map of full keys to JSON record bodies.
 * Key shape: `${LAB_ID}/${owner}/${recordType}/${recordId}`.
 */
function makeStore(records: Record<string, unknown>): {
  listImpl: typeof listLabRecords;
  getImpl: typeof getLabRecord;
} {
  const listImpl = (async (p: { prefix: string }) => {
    const wanted = LAB_ID + "/" + p.prefix; // prefix already ends with "owner/"
    return Object.keys(records).filter((k) => k.startsWith(wanted));
  }) as unknown as typeof listLabRecords;

  const getImpl = (async (p: {
    owner: string;
    recordType: string;
    recordId: string;
  }) => {
    const key = `${LAB_ID}/${p.owner}/${p.recordType}/${p.recordId}`;
    const body = records[key];
    return enc(body);
  }) as unknown as typeof getLabRecord;

  return { listImpl, getImpl };
}

function run(viewer: string, owners: string[], records: Record<string, unknown>) {
  const { listImpl, getImpl } = makeStore(records);
  return pullLabView({
    labId: LAB_ID,
    viewer,
    owners,
    labKey: LAB_KEY,
    signerEd25519Priv: SIGN_PRIV,
    signerEd25519Pub: SIGN_PUB,
    listImpl,
    getImpl,
  });
}

// ---------------------------------------------------------------------------
// recordSharedWith / recordIsWholeLabShared unit checks.
// ---------------------------------------------------------------------------

describe("recordSharedWith whole-lab sentinel", () => {
  it("matches any viewer when shared_with contains the bare '*' string", () => {
    expect(recordSharedWith({ shared_with: ["*"] }, "anyone")).toBe(true);
  });

  it("matches any viewer for the { username: '*' } object shape", () => {
    expect(
      recordSharedWith({ shared_with: [{ username: "*", level: "read" }] }, "anyone"),
    ).toBe(true);
  });

  it("matches the explicitly named viewer", () => {
    expect(recordSharedWith({ shared_with: ["alice"] }, "alice")).toBe(true);
    expect(recordSharedWith({ shared_with: ["alice"] }, "bob")).toBe(false);
  });

  it("with includeWholeLab:false, '*' alone does NOT match", () => {
    expect(
      recordSharedWith({ shared_with: ["*"] }, "bob", { includeWholeLab: false }),
    ).toBe(false);
    // but an explicit name still matches.
    expect(
      recordSharedWith({ shared_with: ["bob"] }, "bob", { includeWholeLab: false }),
    ).toBe(true);
  });

  it("recordIsWholeLabShared detects '*' across entry shapes", () => {
    expect(recordIsWholeLabShared({ shared_with: ["*"] })).toBe(true);
    expect(recordIsWholeLabShared({ shared_with: [{ username: "*" }] })).toBe(true);
    expect(recordIsWholeLabShared({ shared_with: [{ user: "*" }] })).toBe(true);
    expect(recordIsWholeLabShared({ shared_with: ["alice", "bob"] })).toBe(false);
    expect(recordIsWholeLabShared({ shared_with: "nope" })).toBe(false);
    expect(recordIsWholeLabShared(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pullLabView whole-lab read-expansion.
// ---------------------------------------------------------------------------

describe("pullLabView whole-lab share visibility", () => {
  const owners = ["alice", "bob", "carol"];

  it("a member SEES a co-member's record shared to the whole lab via '*'", async () => {
    const records = {
      [`${LAB_ID}/alice/note/n1`]: { shared_with: ["*"], body: "hi all" },
    };
    const view = await run("bob", owners, records);
    const keys = view.map((r) => r.key);
    expect(keys).toContain(`${LAB_ID}/alice/note/n1`);
    const r = view.find((v) => v.key === `${LAB_ID}/alice/note/n1`)!;
    expect(r.isOwn).toBe(false);
    expect(r.sharedWithViewer).toBe(true);
  });

  it("a member does NOT see a co-member's record shared only to a DIFFERENT named user", async () => {
    const records = {
      [`${LAB_ID}/alice/note/n1`]: { shared_with: ["carol"], body: "for carol" },
    };
    const view = await run("bob", owners, records);
    expect(view.map((r) => r.key)).not.toContain(`${LAB_ID}/alice/note/n1`);
  });

  it("the viewer's OWN records are returned unchanged regardless of shared_with", async () => {
    const records = {
      [`${LAB_ID}/bob/note/own1`]: { shared_with: [], body: "mine" },
      [`${LAB_ID}/bob/note/own2`]: { shared_with: ["carol"], body: "mine too" },
    };
    const view = await run("bob", owners, records);
    const own = view.filter((r) => r.isOwn).map((r) => r.recordId).sort();
    expect(own).toEqual(["own1", "own2"]);
  });

  it("a shared_with mixing '*' and named users is visible to every member", async () => {
    const records = {
      [`${LAB_ID}/alice/note/n1`]: {
        shared_with: [{ username: "carol", level: "edit" }, "*"],
        body: "mixed",
      },
    };
    const bobView = await run("bob", owners, records);
    const carolView = await run("carol", owners, records);
    expect(bobView.map((r) => r.key)).toContain(`${LAB_ID}/alice/note/n1`);
    expect(carolView.map((r) => r.key)).toContain(`${LAB_ID}/alice/note/n1`);
  });

  it("a record shared to a specific named user that IS the viewer is still visible (no regression)", async () => {
    const records = {
      [`${LAB_ID}/alice/note/n1`]: { shared_with: ["bob"], body: "for bob" },
    };
    const view = await run("bob", owners, records);
    expect(view.map((r) => r.key)).toContain(`${LAB_ID}/alice/note/n1`);
  });

  it("a '*' record is NOT surfaced to a viewer who is not on the roster", async () => {
    // mallory is the viewer but is not in `owners`, so the whole-lab expansion
    // must not leak the record to her. She also owns nothing here.
    const records = {
      [`${LAB_ID}/alice/note/n1`]: { shared_with: ["*"], body: "lab only" },
    };
    const view = await run("mallory", ["mallory", "alice"], records);
    // mallory IS in owners above, so she sees it. Now make her a non-member:
    const viewNonMember = await run("mallory", ["alice", "bob"], records);
    expect(view.map((r) => r.key)).toContain(`${LAB_ID}/alice/note/n1`);
    expect(viewNonMember.map((r) => r.key)).not.toContain(`${LAB_ID}/alice/note/n1`);
  });

  it("solo / single-owner path is unchanged (own records only, no co-members)", async () => {
    const records = {
      [`${LAB_ID}/solo/note/n1`]: { shared_with: [], body: "private" },
      [`${LAB_ID}/solo/note/n2`]: { shared_with: ["someone"], body: "outbound share" },
    };
    const view = await run("solo", ["solo"], records);
    expect(view.map((r) => r.recordId).sort()).toEqual(["n1", "n2"]);
    expect(view.every((r) => r.isOwn)).toBe(true);
  });

  it("announcements remain lab-wide-public independent of the '*' path", async () => {
    const records = {
      [`${LAB_ID}/alice/announcement/a1`]: { body: "no shared_with field" },
    };
    const view = await run("bob", owners, records);
    expect(view.map((r) => r.key)).toContain(`${LAB_ID}/alice/announcement/a1`);
  });
});
