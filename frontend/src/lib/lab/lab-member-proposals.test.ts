// Tests for the Lab Manager member-change proposal substrate (Phase 1,
// propose-and-ratify). Round-trips a proposal through the relay-backed lab-data
// store via injected in-memory impls (no network, no real crypto), proves the
// head lists what a manager posted, that a dismiss tombstones it out of the list,
// and that the prefix is the HEAD's (the manager writes into the head's prefix).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import {
  postMemberProposal,
  listMemberProposals,
  dismissMemberProposal,
  LAB_MEMBER_PROPOSAL_RECORD_TYPE,
  type LabMemberProposal,
} from "./lab-member-proposals";
import type {
  putLabRecord,
  listLabRecords,
  getLabRecord,
} from "./lab-data-client";

/** In-memory lab-data store. Keys are `<labId>/<owner>/<recordType>/<recordId>`,
 *  the same shape listLabRecords returns, so parseKey works unchanged. The
 *  injected impls bypass real encryption; they just stash the plaintext bytes. */
function makeStore() {
  const store = new Map<string, Uint8Array>();
  const putImpl: typeof putLabRecord = async (p) => {
    store.set(
      `${p.labId}/${p.owner}/${p.recordType}/${p.recordId}`,
      p.plaintext,
    );
  };
  const listImpl: typeof listLabRecords = async (p) => {
    const want = `${p.labId}/${p.prefix}`;
    return [...store.keys()].filter((k) => k.startsWith(want));
  };
  const getImpl: typeof getLabRecord = async (p) => {
    const key = `${p.labId}/${p.owner}/${p.recordType}/${p.recordId}`;
    const v = store.get(key);
    if (!v) throw new Error("not found");
    return v;
  };
  return { store, putImpl, listImpl, getImpl };
}

const KEYS = {
  labKey: new Uint8Array(32),
  signerEd25519Priv: new Uint8Array(64),
  signerEd25519Pub: new Uint8Array(32),
};

function proposal(over: Partial<LabMemberProposal> = {}): LabMemberProposal {
  return {
    id: "p1",
    kind: "remove",
    proposer: "alice",
    subjectUsername: "bob",
    target: "",
    note: "Bob left the lab",
    proposedAt: 1000,
    ...over,
  };
}

describe("lab member-change proposals (propose-and-ratify substrate)", () => {
  it("a manager posts into the HEAD prefix and the head lists it", async () => {
    const { store, putImpl, listImpl, getImpl } = makeStore();
    await postMemberProposal({
      labId: "lab-1",
      head: "pi",
      proposal: proposal(),
      ...KEYS,
      putImpl,
    });
    // Stored under the head's prefix, reserved record type.
    expect(
      [...store.keys()].some((k) =>
        k.startsWith(`lab-1/pi/${LAB_MEMBER_PROPOSAL_RECORD_TYPE}/`),
      ),
    ).toBe(true);

    const listed = await listMemberProposals({
      labId: "lab-1",
      head: "pi",
      ...KEYS,
      listImpl,
      getImpl,
    });
    expect(listed.map((p) => p.id)).toEqual(["p1"]);
    expect(listed[0].kind).toBe("remove");
    expect(listed[0].subjectUsername).toBe("bob");
    expect(listed[0].proposer).toBe("alice");
  });

  it("dismiss tombstones a proposal out of the head list", async () => {
    const { putImpl, listImpl, getImpl } = makeStore();
    await postMemberProposal({
      labId: "lab-1",
      head: "pi",
      proposal: proposal(),
      ...KEYS,
      putImpl,
    });
    await dismissMemberProposal({
      labId: "lab-1",
      head: "pi",
      proposalId: "p1",
      ...KEYS,
      nowMs: 2000,
      putImpl,
    });
    const listed = await listMemberProposals({
      labId: "lab-1",
      head: "pi",
      ...KEYS,
      listImpl,
      getImpl,
    });
    expect(listed).toEqual([]);
  });

  it("lists newest-first and keeps both add and remove kinds", async () => {
    const { putImpl, listImpl, getImpl } = makeStore();
    await postMemberProposal({
      labId: "lab-1",
      head: "pi",
      proposal: proposal({ id: "p1", proposedAt: 1000 }),
      ...KEYS,
      putImpl,
    });
    await postMemberProposal({
      labId: "lab-1",
      head: "pi",
      proposal: proposal({
        id: "p2",
        kind: "add",
        subjectUsername: "",
        target: "newperson@uni.edu",
        proposedAt: 2000,
      }),
      ...KEYS,
      putImpl,
    });
    const listed = await listMemberProposals({
      labId: "lab-1",
      head: "pi",
      ...KEYS,
      listImpl,
      getImpl,
    });
    expect(listed.map((p) => p.id)).toEqual(["p2", "p1"]); // newest first
    expect(listed.find((p) => p.id === "p2")?.kind).toBe("add");
    expect(listed.find((p) => p.id === "p2")?.target).toBe("newperson@uni.edu");
  });
});
