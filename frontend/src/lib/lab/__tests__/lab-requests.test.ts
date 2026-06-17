import { describe, it, expect, vi } from "vitest";
import { labDataObjectKey } from "../lab-data-protocol";
import {
  postContentRequest,
  listContentRequests,
  dismissContentRequest,
  approveContentRequest,
  LAB_REQUEST_RECORD_TYPE,
  type LabContentRequest,
} from "../lab-requests";
import type {
  ApprovalGrant,
  ApprovalGrantStore,
} from "../lab-approval-grants";
import type {
  putLabRecord,
  listLabRecords,
  getLabRecord,
} from "../lab-data-client";

// In-memory lab-data store at the put/list/get IMPL level (no crypto; the
// encrypt/decrypt round-trip is covered by the e2e test). Stores plaintext.
function makeStore() {
  const map = new Map<string, Uint8Array>();
  const put = (async (p: Parameters<typeof putLabRecord>[0]) => {
    map.set(
      labDataObjectKey(p.labId, p.owner, p.recordType, p.recordId),
      p.plaintext,
    );
  }) as typeof putLabRecord;
  const list = (async (p: Parameters<typeof listLabRecords>[0]) =>
    [...map.keys()].filter((k) =>
      k.startsWith(`${p.labId}/${p.prefix}`),
    )) as typeof listLabRecords;
  const get = (async (p: Parameters<typeof getLabRecord>[0]) => {
    const v = map.get(
      labDataObjectKey(p.labId, p.owner, p.recordType, p.recordId),
    );
    if (!v) throw new Error("404");
    return v;
  }) as typeof getLabRecord;
  return { map, put, list, get };
}

function makeGrantStore(initial: ApprovalGrant[] = []): ApprovalGrantStore & {
  saved: ApprovalGrant[][];
} {
  let grants = [...initial];
  const saved: ApprovalGrant[][] = [];
  return {
    saved,
    async load() {
      return grants;
    },
    async save(_owner, next) {
      grants = next;
      saved.push(next);
    },
  };
}

const KEYS = {
  labId: "lab-1",
  signerEd25519Priv: new Uint8Array([1]),
  signerEd25519Pub: new Uint8Array([2]),
  labKey: new Uint8Array([3]),
};

function req(over: Partial<LabContentRequest> = {}): LabContentRequest {
  return {
    id: "r1",
    requester: "pi",
    recordType: "datahub",
    recordId: "dh-1",
    requestedAt: 1000,
    ...over,
  };
}

describe("content request channel", () => {
  it("posts a request into the member's _request prefix and lists it back", async () => {
    const store = makeStore();
    await postContentRequest({
      ...KEYS,
      member: "emile",
      request: req(),
      putImpl: store.put,
    });
    expect([...store.map.keys()]).toEqual(["lab-1/emile/_request/r1"]);

    const pending = await listContentRequests({
      ...KEYS,
      owner: "emile",
      listImpl: store.list,
      getImpl: store.get,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: "r1", recordType: "datahub", recordId: "dh-1" });
  });

  it("a dismissed (tombstoned) request no longer shows as pending", async () => {
    const store = makeStore();
    await postContentRequest({ ...KEYS, member: "emile", request: req(), putImpl: store.put });
    await dismissContentRequest({
      ...KEYS,
      member: "emile",
      requestId: "r1",
      nowMs: 2000,
      putImpl: store.put,
    });
    const pending = await listContentRequests({
      ...KEYS,
      owner: "emile",
      listImpl: store.list,
      getImpl: store.get,
    });
    expect(pending).toHaveLength(0);
  });

  it("lists multiple pending requests newest-first", async () => {
    const store = makeStore();
    await postContentRequest({ ...KEYS, member: "emile", request: req({ id: "a", requestedAt: 100 }), putImpl: store.put });
    await postContentRequest({ ...KEYS, member: "emile", request: req({ id: "b", requestedAt: 300 }), putImpl: store.put });
    const pending = await listContentRequests({ ...KEYS, owner: "emile", listImpl: store.list, getImpl: store.get });
    expect(pending.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("approve records a TTL grant and dismisses the request", async () => {
    const store = makeStore();
    const grantStore = makeGrantStore();
    await postContentRequest({ ...KEYS, member: "emile", request: req(), putImpl: store.put });

    const grants = await approveContentRequest({
      ...KEYS,
      member: "emile",
      request: req(),
      grantStore,
      nowMs: 1000,
      ttlMs: 5000,
      putImpl: store.put,
    });

    // A grant for the requested record, expiring at now + ttl.
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      recordType: "datahub",
      recordId: "dh-1",
      approvedUntil: 6000,
      requestedBy: "pi",
    });
    expect(grantStore.saved.at(-1)).toEqual(grants);

    // The request is dismissed.
    const pending = await listContentRequests({ ...KEYS, owner: "emile", listImpl: store.list, getImpl: store.get });
    expect(pending).toHaveLength(0);
  });
});
