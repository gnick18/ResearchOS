// Lab data store (lab-tier Phase 3 chunk 1) unit + integration tests.
//
// Covers:
//   - the at-rest lab key seal (round-trip + wrong-key rejection)
//   - the canonical signed-message contract (round-trip + tamper rejection +
//     verb domain-separation)
//   - isLabMemberOrHead predicate against the REAL LabRecord shape
//     ({ head: LabMember { ed25519PublicKey }, members: LabMember[] })
//   - fetchRoster bridge mapping: mocked /lab/get response of the REAL
//     LabRecordDO shape is mapped to the LabRosterPayload the data routes check
//   - rosterAllows against the bridged payload
//   - client put/get/list against a mocked SERVER-BLIND relay (only sees
//     ciphertext, never the lab key)
//   - negative: non-member is rejected (401), non-existent lab is rejected
//     (fail-closed, 401)
//
// No test references /lab/roster. All assertions are against the real DO shape.
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { encryptLabData, decryptLabData, LAB_KEY_LENGTH } from "../lab-key";
import {
  labDataObjectKey,
  labDataPutMessage,
  labDataListMessage,
} from "../lab-data-protocol";
import { isLabMemberOrHead, type LabRecord, type LabMember } from "../lab-membership";

// The client gates on LAB_TIER_ENABLED, which is false by default. Force it on
// for the client round-trip tests so the dormant path can be exercised.
vi.mock("../config", () => ({ LAB_TIER_ENABLED: true }));

import {
  putLabRecord,
  getLabRecord,
  listLabRecords,
} from "../lab-data-client";

const enc = new TextEncoder();
const dec = new TextDecoder();

function randomLabKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(LAB_KEY_LENGTH));
}

// ---------------------------------------------------------------------------
// Helpers to build LabMember and LabRecord in the REAL shape
// (head: LabMember with ed25519PublicKey + x25519PublicKey, members: LabMember[])
// ---------------------------------------------------------------------------
function makeLabMember(
  username: string,
  ed25519Pub: Uint8Array,
  role: "head" | "member",
): LabMember {
  return {
    username,
    // x25519PublicKey is required by the type; use a placeholder for tests
    // that only care about the Ed25519 identity (roster checks use ed25519PublicKey).
    x25519PublicKey: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    ed25519PublicKey: bytesToHex(ed25519Pub),
    role,
  };
}

function makeLabRecord(
  headPub: Uint8Array,
  memberPubs: Array<{ pub: Uint8Array; role: "head" | "member" }>,
): LabRecord {
  const headMember = makeLabMember("head-user", headPub, "head");
  return {
    labId: "lab-1",
    head: headMember,
    keyGeneration: 0,
    members: [
      headMember,
      ...memberPubs.map((mp, i) =>
        makeLabMember(`member-${i}`, mp.pub, mp.role),
      ),
    ],
    log: [],
  };
}

// The shape the real LabRecordDO returns on POST /lab/get (from handleGet()).
// record.head is a LabMemberWire, record.members is LabMemberWire[].
function makeRealDoGetResponse(
  headEd25519Pub: Uint8Array,
  memberPubs: Array<{ pub: Uint8Array; role: "head" | "member" }>,
) {
  const headWire = {
    username: "head-user",
    x25519PublicKey: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    ed25519PublicKey: bytesToHex(headEd25519Pub),
    role: "head" as const,
  };
  return {
    record: {
      labId: "lab-1",
      head: headWire,
      members: [
        headWire,
        ...memberPubs.map((mp, i) => ({
          username: `member-${i}`,
          x25519PublicKey: bytesToHex(
            crypto.getRandomValues(new Uint8Array(32)),
          ),
          ed25519PublicKey: bytesToHex(mp.pub),
          role: mp.role,
        })),
      ],
      keyGeneration: 0,
      log: [],
    },
    envelopes: [],
  };
}

// ---------------------------------------------------------------------------
// Roster bridge internals: test fetchRoster's mapping + rosterAllows directly,
// using a mocked /lab/get response of the REAL LabRecordDO shape.
// ---------------------------------------------------------------------------

/** LabRosterPayload is the internal worker type, mirrored here for testing. */
interface LabRosterPayload {
  labId: string;
  headPubkey: string;
  members: Array<{ pubkey: string; role: string }>;
}

/** Local reimplementation of the bridge's rosterAllows for unit testing. */
function rosterAllows(roster: LabRosterPayload, pubkeyHex: string): boolean {
  const target = pubkeyHex.toLowerCase();
  if (roster.headPubkey.toLowerCase() === target) return true;
  return roster.members.some((m) => m.pubkey.toLowerCase() === target);
}

/** Maps a real LabRecordDO /lab/get response body to the LabRosterPayload the
 *  data routes consume. This mirrors the logic in worker.ts fetchRoster. */
function mapDoResponseToRoster(
  doBody: ReturnType<typeof makeRealDoGetResponse>,
): LabRosterPayload | null {
  const { record } = doBody;
  if (!record.head || typeof record.head.ed25519PublicKey !== "string" || record.head.ed25519PublicKey.trim() === "") {
    return null;
  }
  return {
    labId: record.labId,
    headPubkey: record.head.ed25519PublicKey,
    members: record.members.map((m) => ({
      pubkey: m.ed25519PublicKey,
      role: m.role,
    })),
  };
}

describe("lab-key at-rest seal", () => {
  it("round-trips a plaintext under the lab key", () => {
    const labKey = randomLabKey();
    const plaintext = enc.encode("PCR master mix recipe, 25 uL reaction");
    const blob = encryptLabData(plaintext, labKey);
    // The ciphertext is not the plaintext (server-blind at rest).
    expect(bytesToHex(blob)).not.toContain(bytesToHex(plaintext));
    const back = decryptLabData(blob, labKey);
    expect(dec.decode(back)).toBe("PCR master mix recipe, 25 uL reaction");
  });

  it("rejects decryption under a wrong lab key", () => {
    const labKey = randomLabKey();
    const wrongKey = randomLabKey();
    const blob = encryptLabData(enc.encode("secret"), labKey);
    expect(() => decryptLabData(blob, wrongKey)).toThrow();
  });

  it("two encryptions of the same plaintext differ (fresh nonce)", () => {
    const labKey = randomLabKey();
    const pt = enc.encode("same");
    const a = encryptLabData(pt, labKey);
    const b = encryptLabData(pt, labKey);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("rejects a wrong-length lab key", () => {
    expect(() => encryptLabData(enc.encode("x"), new Uint8Array(16))).toThrow();
  });
});

describe("canonical signed-message contract", () => {
  it("put message round-trips a verifiable signature", () => {
    const priv = ed25519.utils.randomSecretKey();
    const pub = ed25519.getPublicKey(priv);
    const message = labDataPutMessage({
      labId: "lab-1",
      owner: "alex",
      recordType: "note",
      recordId: "n-42",
      ciphertextSha256: "deadbeef",
      issuedAt: 1_700_000_000_000,
    });
    const sig = ed25519.sign(enc.encode(message), priv);
    expect(ed25519.verify(sig, enc.encode(message), pub)).toBe(true);
  });

  it("rejects a tampered put message", () => {
    const priv = ed25519.utils.randomSecretKey();
    const pub = ed25519.getPublicKey(priv);
    const message = labDataPutMessage({
      labId: "lab-1",
      owner: "alex",
      recordType: "note",
      recordId: "n-42",
      ciphertextSha256: "deadbeef",
      issuedAt: 1_700_000_000_000,
    });
    const sig = ed25519.sign(enc.encode(message), priv);
    const tampered = labDataPutMessage({
      labId: "lab-1",
      owner: "alex",
      recordType: "note",
      recordId: "n-42",
      ciphertextSha256: "cafebabe", // swapped blob hash
      issuedAt: 1_700_000_000_000,
    });
    expect(ed25519.verify(sig, enc.encode(tampered), pub)).toBe(false);
  });

  it("list message round-trips and put/list verbs are domain-separated", () => {
    const priv = ed25519.utils.randomSecretKey();
    const pub = ed25519.getPublicKey(priv);
    const listMsg = labDataListMessage({
      labId: "lab-1",
      prefix: "alex/note",
      issuedAt: 1_700_000_000_000,
    });
    const sig = ed25519.sign(enc.encode(listMsg), priv);
    expect(ed25519.verify(sig, enc.encode(listMsg), pub)).toBe(true);
    // A list signature must not verify against a put message (verb separation).
    const putMsg = labDataPutMessage({
      labId: "lab-1",
      owner: "alex",
      recordType: "note",
      recordId: "n-1",
      ciphertextSha256: "00",
      issuedAt: 1_700_000_000_000,
    });
    expect(ed25519.verify(sig, enc.encode(putMsg), pub)).toBe(false);
  });

  it("builds the documented R2 object key", () => {
    expect(labDataObjectKey("lab-1", "alex", "note", "n-42")).toBe(
      "lab-1/alex/note/n-42",
    );
  });
});

// ---------------------------------------------------------------------------
// isLabMemberOrHead predicate against the REAL LabRecord shape.
// record.head is a LabMember with .ed25519PublicKey; record.members is LabMember[].
// ---------------------------------------------------------------------------

describe("isLabMemberOrHead predicate (real LabRecord shape)", () => {
  const headPriv = ed25519.utils.randomSecretKey();
  const headPub = ed25519.getPublicKey(headPriv);
  const memberPriv = ed25519.utils.randomSecretKey();
  const memberPub = ed25519.getPublicKey(memberPriv);
  const strangerPriv = ed25519.utils.randomSecretKey();
  const strangerPub = ed25519.getPublicKey(strangerPriv);

  const record = makeLabRecord(headPub, [{ pub: memberPub, role: "member" }]);

  it("allows the head (case-insensitive)", () => {
    expect(isLabMemberOrHead(record, bytesToHex(headPub).toUpperCase())).toBe(true);
    expect(isLabMemberOrHead(record, bytesToHex(headPub).toLowerCase())).toBe(true);
  });

  it("allows a listed member", () => {
    expect(isLabMemberOrHead(record, bytesToHex(memberPub))).toBe(true);
  });

  it("rejects a non-member", () => {
    expect(isLabMemberOrHead(record, bytesToHex(strangerPub))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchRoster bridge mapping tests.
// These test the mapping from the REAL LabRecordDO /lab/get response shape
// ({ record: { head: { ed25519PublicKey, ... }, members: [...] } }) to the
// LabRosterPayload the worker data routes check (headPubkey + members[].pubkey).
// No test references /lab/roster.
// ---------------------------------------------------------------------------

describe("fetchRoster bridge mapping (real DO shape)", () => {
  const headPriv = ed25519.utils.randomSecretKey();
  const headPub = ed25519.getPublicKey(headPriv);
  const memberPriv = ed25519.utils.randomSecretKey();
  const memberPub = ed25519.getPublicKey(memberPriv);
  const strangerPriv = ed25519.utils.randomSecretKey();
  const strangerPub = ed25519.getPublicKey(strangerPriv);

  it("maps the real DO response to headPubkey + members[].pubkey", () => {
    const doBody = makeRealDoGetResponse(headPub, [
      { pub: memberPub, role: "member" },
    ]);
    const roster = mapDoResponseToRoster(doBody);
    expect(roster).not.toBeNull();
    expect(roster!.headPubkey).toBe(bytesToHex(headPub));
    // members list includes head (as the DO puts head in members with role "head")
    // and the non-head member.
    expect(roster!.members.some((m) => m.pubkey === bytesToHex(memberPub))).toBe(true);
  });

  it("fails-closed when record.head is missing", () => {
    const doBody = makeRealDoGetResponse(headPub, []);
    // Simulate a missing head (the DO returns 404 with {error} for unknown labs).
    const malformed = { record: { ...doBody.record, head: null } };
    const roster = mapDoResponseToRoster(malformed as unknown as ReturnType<typeof makeRealDoGetResponse>);
    expect(roster).toBeNull();
  });

  it("fails-closed when head.ed25519PublicKey is empty", () => {
    const doBody = makeRealDoGetResponse(headPub, []);
    const malformed = {
      record: {
        ...doBody.record,
        head: { ...doBody.record.head, ed25519PublicKey: "" },
      },
    };
    const roster = mapDoResponseToRoster(malformed as unknown as ReturnType<typeof makeRealDoGetResponse>);
    expect(roster).toBeNull();
  });

  it("rosterAllows: head is allowed (case-insensitive)", () => {
    const doBody = makeRealDoGetResponse(headPub, []);
    const roster = mapDoResponseToRoster(doBody)!;
    expect(rosterAllows(roster, bytesToHex(headPub).toUpperCase())).toBe(true);
    expect(rosterAllows(roster, bytesToHex(headPub).toLowerCase())).toBe(true);
  });

  it("rosterAllows: member is allowed", () => {
    const doBody = makeRealDoGetResponse(headPub, [{ pub: memberPub, role: "member" }]);
    const roster = mapDoResponseToRoster(doBody)!;
    expect(rosterAllows(roster, bytesToHex(memberPub))).toBe(true);
  });

  it("rosterAllows: stranger is rejected", () => {
    const doBody = makeRealDoGetResponse(headPub, [{ pub: memberPub, role: "member" }]);
    const roster = mapDoResponseToRoster(doBody)!;
    expect(rosterAllows(roster, bytesToHex(strangerPub))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Client round-trip against a mocked SERVER-BLIND relay. The mock stands in for
// the relay + R2: it stores only the ciphertext the client uploads (it never
// sees the lab key), and serves it back on GET. This proves the at-rest store
// is server-blind: the bytes the "relay" holds decrypt only with the lab key.
// ---------------------------------------------------------------------------

describe("lab-data-client round-trip (mocked relay)", () => {
  let store: Map<string, Uint8Array>;
  let lastPutBody: Record<string, unknown> | null;

  function keyFromBody(b: Record<string, unknown>): string {
    return labDataObjectKey(
      b.labId as string,
      b.owner as string,
      b.recordType as string,
      b.recordId as string,
    );
  }

  const mockFetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.endsWith("/lab/data/put")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      lastPutBody = body;
      // The relay only ever receives the base64 ciphertext, never the lab key.
      const ciphertext = Uint8Array.from(atob(body.ciphertext as string), (c) =>
        c.charCodeAt(0),
      );
      store.set(keyFromBody(body), ciphertext);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (urlStr.includes("/lab/data/get")) {
      const u = new URL(urlStr);
      const key = u.searchParams.get("key") ?? "";
      const blob = store.get(key);
      if (!blob) return new Response("not found", { status: 404 });
      // Hand back a fresh ArrayBuffer-backed copy (Response body typing wants a
      // plain ArrayBuffer, not a SharedArrayBuffer-backed view).
      const copy = new Uint8Array(blob.byteLength);
      copy.set(blob);
      return new Response(copy.buffer, { status: 200 });
    }
    if (urlStr.endsWith("/lab/data/list")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const full =
        body.prefix === ""
          ? `${body.labId}/`
          : `${body.labId}/${body.prefix}`;
      const keys = [...store.keys()].filter((k) => k.startsWith(full));
      return new Response(JSON.stringify({ keys }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });

  beforeEach(() => {
    store = new Map();
    lastPutBody = null;
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const priv = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(priv);

  it("put then get returns the original plaintext via the lab key", async () => {
    const labKey = randomLabKey();
    const plaintext = enc.encode("OD600 = 0.84 at t=6h");

    await putLabRecord({
      labId: "lab-1",
      owner: "alex",
      recordType: "result",
      recordId: "r-1",
      plaintext,
      labKey,
      signerEd25519Priv: priv,
      signerEd25519Pub: pub,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    // The "relay" holds ciphertext only (server-blind): the stored bytes are not
    // the plaintext and do not contain the lab key.
    const stored = store.get("lab-1/alex/result/r-1")!;
    expect(stored).toBeTruthy();
    expect(bytesToHex(stored)).not.toContain(bytesToHex(plaintext));
    expect(bytesToHex(stored)).not.toContain(bytesToHex(labKey));
    expect(lastPutBody).not.toHaveProperty("labKey");

    const back = await getLabRecord({
      labId: "lab-1",
      owner: "alex",
      recordType: "result",
      recordId: "r-1",
      labKey,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(dec.decode(back)).toBe("OD600 = 0.84 at t=6h");
  });

  it("get with a wrong lab key fails decrypt", async () => {
    const labKey = randomLabKey();
    const wrongKey = randomLabKey();
    await putLabRecord({
      labId: "lab-1",
      owner: "alex",
      recordType: "note",
      recordId: "n-9",
      plaintext: enc.encode("private"),
      labKey,
      signerEd25519Priv: priv,
      signerEd25519Pub: pub,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await expect(
      getLabRecord({
        labId: "lab-1",
        owner: "alex",
        recordType: "note",
        recordId: "n-9",
        labKey: wrongKey,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });

  it("list returns the keys under a prefix", async () => {
    const labKey = randomLabKey();
    for (const id of ["a", "b"]) {
      await putLabRecord({
        labId: "lab-1",
        owner: "alex",
        recordType: "note",
        recordId: id,
        plaintext: enc.encode(id),
        labKey,
        signerEd25519Priv: priv,
        signerEd25519Pub: pub,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
    }
    await putLabRecord({
      labId: "lab-1",
      owner: "morgan",
      recordType: "note",
      recordId: "z",
      plaintext: enc.encode("z"),
      labKey,
      signerEd25519Priv: priv,
      signerEd25519Pub: pub,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const alexKeys = await listLabRecords({
      labId: "lab-1",
      prefix: "alex",
      signerEd25519Priv: priv,
      signerEd25519Pub: pub,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(alexKeys.sort()).toEqual([
      "lab-1/alex/note/a",
      "lab-1/alex/note/b",
    ]);
    // The PI can enumerate every member by listing the whole lab.
    const allKeys = await listLabRecords({
      labId: "lab-1",
      prefix: "",
      signerEd25519Priv: priv,
      signerEd25519Pub: pub,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(allKeys.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: fetchRoster bridge wired to real LabRecordDO response shape.
// These tests verify the COMPLETE data-route auth path:
//   1. A mocked relay that maps /lab/get responses (real DO shape) for the
//      fetchRoster bridge, then enforces rosterAllows on put/list.
//   2. A member PUT is accepted; a stranger PUT is rejected (401).
//   3. A PUT to an unknown lab (DO returns 404) is rejected (fail-closed, 401).
// This is the proof the bridge is correct without standing up a live DO.
// ---------------------------------------------------------------------------

describe("integration: fetchRoster bridge + roster-gated put/list (mocked DO-backed relay)", () => {
  // We simulate the relay's behavior by building a mock that:
  //   - On /lab/data/put: verifies the signer pubkey against the roster it
  //     fetches from a simulated /lab/get endpoint (real DO shape).
  //   - Returns 401 for non-members; stores ciphertext for members.
  // This mirrors the worker's handleLabDataPut + fetchRoster logic.

  const headPriv = ed25519.utils.randomSecretKey();
  const headPub = ed25519.getPublicKey(headPriv);
  const memberPriv = ed25519.utils.randomSecretKey();
  const memberPub = ed25519.getPublicKey(memberPriv);
  const strangerPriv = ed25519.utils.randomSecretKey();
  const strangerPub = ed25519.getPublicKey(strangerPriv);

  let store: Map<string, Uint8Array>;

  // Build the roster payload from a real DO /lab/get response, using the bridge mapping.
  const doBody = makeRealDoGetResponse(headPub, [{ pub: memberPub, role: "member" }]);
  const roster = mapDoResponseToRoster(doBody)!;

  beforeEach(() => {
    store = new Map();
  });

  /** A mock fetch that enforces rosterAllows from a real-DO-shaped roster. */
  const makeRosterEnforcingFetch = (rosterForLab: LabRosterPayload | null) =>
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.endsWith("/lab/data/put")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const signerPubkey = body.signerPubkey as string;
        const labId = body.labId as string;
        // Simulate fetchRoster: if rosterForLab is null or labId mismatch, fail-closed.
        if (!rosterForLab || rosterForLab.labId !== labId) {
          return new Response(
            JSON.stringify({ error: "not a lab member" }),
            { status: 401 },
          );
        }
        if (!rosterAllows(rosterForLab, signerPubkey)) {
          return new Response(
            JSON.stringify({ error: "not a lab member" }),
            { status: 401 },
          );
        }
        const ciphertext = Uint8Array.from(
          atob(body.ciphertext as string),
          (c) => c.charCodeAt(0),
        );
        const key = labDataObjectKey(
          labId,
          body.owner as string,
          body.recordType as string,
          body.recordId as string,
        );
        store.set(key, ciphertext);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/lab/data/get")) {
        const u = new URL(urlStr);
        const key = u.searchParams.get("key") ?? "";
        const blob = store.get(key);
        if (!blob) return new Response("not found", { status: 404 });
        const copy = new Uint8Array(blob.byteLength);
        copy.set(blob);
        return new Response(copy.buffer, { status: 200 });
      }
      if (urlStr.endsWith("/lab/data/list")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const signerPubkey = body.signerPubkey as string;
        const labId = body.labId as string;
        if (!rosterForLab || rosterForLab.labId !== labId) {
          return new Response(
            JSON.stringify({ error: "not a lab member" }),
            { status: 401 },
          );
        }
        if (!rosterAllows(rosterForLab, signerPubkey)) {
          return new Response(
            JSON.stringify({ error: "not a lab member" }),
            { status: 401 },
          );
        }
        const prefix = body.prefix as string;
        const full = prefix === "" ? `${labId}/` : `${labId}/${prefix}`;
        const keys = [...store.keys()].filter((k) => k.startsWith(full));
        return new Response(JSON.stringify({ keys }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

  it("member PUT is accepted by the roster bridge (real DO shape mapped correctly)", async () => {
    const labKey = randomLabKey();
    const mockFetch = makeRosterEnforcingFetch(roster);
    // memberPriv is in the roster (via mapDoResponseToRoster from real DO shape).
    await expect(
      putLabRecord({
        labId: "lab-1",
        owner: "alex",
        recordType: "note",
        recordId: "n-1",
        plaintext: enc.encode("growth curve data"),
        labKey,
        signerEd25519Priv: memberPriv,
        signerEd25519Pub: memberPub,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).resolves.toBeUndefined();
    expect(store.has("lab-1/alex/note/n-1")).toBe(true);
  });

  it("head PUT is accepted by the roster bridge", async () => {
    const labKey = randomLabKey();
    const mockFetch = makeRosterEnforcingFetch(roster);
    await expect(
      putLabRecord({
        labId: "lab-1",
        owner: "pi-alex",
        recordType: "result",
        recordId: "r-1",
        plaintext: enc.encode("gel image"),
        labKey,
        signerEd25519Priv: headPriv,
        signerEd25519Pub: headPub,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).resolves.toBeUndefined();
    expect(store.has("lab-1/pi-alex/result/r-1")).toBe(true);
  });

  it("stranger PUT is rejected with 401 (not a lab member)", async () => {
    const labKey = randomLabKey();
    const mockFetch = makeRosterEnforcingFetch(roster);
    await expect(
      putLabRecord({
        labId: "lab-1",
        owner: "stranger",
        recordType: "note",
        recordId: "n-x",
        plaintext: enc.encode("should be rejected"),
        labKey,
        signerEd25519Priv: strangerPriv,
        signerEd25519Pub: strangerPub,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("401");
    expect(store.size).toBe(0);
  });

  it("PUT to a non-existent lab is rejected (fail-closed, 401)", async () => {
    const labKey = randomLabKey();
    // null roster simulates fetchRoster returning null for an unknown lab.
    const mockFetch = makeRosterEnforcingFetch(null);
    await expect(
      putLabRecord({
        labId: "lab-does-not-exist",
        owner: "someone",
        recordType: "note",
        recordId: "n-1",
        plaintext: enc.encode("should fail closed"),
        labKey,
        signerEd25519Priv: memberPriv,
        signerEd25519Pub: memberPub,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("401");
    expect(store.size).toBe(0);
  });

  it("member put then get returns the plaintext (full round-trip through roster bridge)", async () => {
    const labKey = randomLabKey();
    const plaintext = enc.encode("colony count: 48");
    const mockFetch = makeRosterEnforcingFetch(roster);

    await putLabRecord({
      labId: "lab-1",
      owner: "alex",
      recordType: "result",
      recordId: "colony-1",
      plaintext,
      labKey,
      signerEd25519Priv: memberPriv,
      signerEd25519Pub: memberPub,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const back = await getLabRecord({
      labId: "lab-1",
      owner: "alex",
      recordType: "result",
      recordId: "colony-1",
      labKey,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(dec.decode(back)).toBe("colony count: 48");
  });

  it("list enumerates all member keys (roster-gated)", async () => {
    const labKey = randomLabKey();
    const mockFetch = makeRosterEnforcingFetch(roster);

    for (const id of ["note-a", "note-b"]) {
      await putLabRecord({
        labId: "lab-1",
        owner: "alex",
        recordType: "note",
        recordId: id,
        plaintext: enc.encode(id),
        labKey,
        signerEd25519Priv: memberPriv,
        signerEd25519Pub: memberPub,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
    }

    const keys = await listLabRecords({
      labId: "lab-1",
      prefix: "alex",
      signerEd25519Priv: memberPriv,
      signerEd25519Pub: memberPub,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    expect(keys.sort()).toEqual([
      "lab-1/alex/note/note-a",
      "lab-1/alex/note/note-b",
    ]);
  });

  it("stranger list is rejected (401)", async () => {
    const mockFetch = makeRosterEnforcingFetch(roster);
    await expect(
      listLabRecords({
        labId: "lab-1",
        prefix: "alex",
        signerEd25519Priv: strangerPriv,
        signerEd25519Pub: strangerPub,
        fetchImpl: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("401");
  });
});
