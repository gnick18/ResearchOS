// End-to-end integration of the hybrid lab mirror, the closest thing to the
// real two-party flow without two browsers. It wires the ACTUAL pipeline with
// REAL lab-key crypto through an in-memory relay double:
//
//   member: enumerate -> size-gate -> sync light content + push index
//   PI:     read back light content (lab-scoped read) + search the index
//
// Only the relay's signature verification and the session/roster fetch are
// stood in (covered by the relay contract audit and the unit tests). Everything
// else is the real code, so this catches composition bugs the mocked unit tests
// cannot: the encrypt/decrypt round-trip, the reserved _index key, the size-gate
// split, the new record types, and the eager flag.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";

// Enable the lab tier for the real client functions, preserving other exports.
vi.mock("../config", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  LAB_TIER_ENABLED: true,
}));

import { LAB_KEY_LENGTH } from "../lab-key";
import { labDataObjectKey } from "../lab-data-protocol";
import { putLabRecord, getLabRecord } from "../lab-data-client";
import {
  enumerateLabWork,
  type LabWorkSource,
  type OwnedRecord,
} from "../lab-work-enumerate";
import { syncLabWorkToMirror, pullMemberLabRecords } from "../lab-sync";
import {
  splitBySize,
  buildLabIndex,
  pushLabIndex,
  readLabIndexAcrossMembers,
} from "../lab-index";
import { readLabMembersWork, type LabScopedReadDeps } from "../lab-scoped-read";
import { searchLabIndex, type LabIndexSearchDeps } from "../lab-index-search";

// ---------------------------------------------------------------------------
// Crypto + relay doubles (mirrors lab-read.test.ts).
// ---------------------------------------------------------------------------

function randomLabKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(LAB_KEY_LENGTH));
}

function randomKeyPair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = ed25519.utils.randomSecretKey();
  return { priv, pub: ed25519.getPublicKey(priv) };
}

function makeInMemoryRelay(): {
  fetchImpl: typeof fetch;
  store: Map<string, Uint8Array>;
} {
  const store = new Map<string, Uint8Array>();
  const keyFromBody = (b: Record<string, unknown>) =>
    labDataObjectKey(
      b.labId as string,
      b.owner as string,
      b.recordType as string,
      b.recordId as string,
    );

  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.endsWith("/lab/data/put")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const ciphertext = Uint8Array.from(atob(body.ciphertext as string), (c) =>
        c.charCodeAt(0),
      );
      store.set(keyFromBody(body), ciphertext);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (urlStr.includes("/lab/data/get")) {
      const key = new URL(urlStr).searchParams.get("key") ?? "";
      const blob = store.get(key);
      if (!blob) return new Response("not found", { status: 404 });
      const copy = new Uint8Array(blob.byteLength);
      copy.set(blob);
      return new Response(copy.buffer, { status: 200 });
    }
    if (urlStr.endsWith("/lab/data/list")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const labId = body.labId as string;
      const prefix = body.prefix as string;
      const full = prefix === "" ? `${labId}/` : `${labId}/${prefix}`;
      const keys = [...store.keys()].filter((k) => k.startsWith(full));
      return new Response(JSON.stringify({ keys }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  return { fetchImpl, store };
}

/** Empty source with every LabWorkSource method present, override as needed. */
function emptySource(): LabWorkSource {
  const none = async (): Promise<OwnedRecord[]> => [];
  return {
    listTasks: none,
    listNotes: none,
    listMethods: none,
    listPurchases: none,
    listInventory: none,
    listInventoryStock: none,
    listSequences: none,
    listPhylo: none,
    listMolecules: none,
    listDatahub: none,
    listResultSheets: none,
    listNotesSheets: none,
  };
}

// ---------------------------------------------------------------------------
// The full round-trip.
// ---------------------------------------------------------------------------

describe("lab mirror end to end (member push -> PI read + search)", () => {
  const labId = "lab-e2e";
  const THRESHOLD = 300; // small, so the padded table is heavy and the rest light

  // Emile's lab work: a note and a task (light) plus a big data table (heavy).
  const source: LabWorkSource = {
    ...emptySource(),
    listNotes: async () => [
      {
        id: 1,
        title: "Gel image",
        description: "ran a qPCR gel, clean bands at 500bp",
        updated_at: "2026-06-17",
      },
    ],
    listTasks: async () => [{ id: 2, name: "PCR setup", task_type: "task" }],
    listDatahub: async () => [
      { id: "dh-1", meta: { name: "Big qPCR table" }, rows: "x".repeat(400) },
    ],
  };

  async function memberPush(relay: ReturnType<typeof makeInMemoryRelay>) {
    const labKey = randomLabKey();
    const emile = randomKeyPair();
    const records = await enumerateLabWork({ owner: "emile", source });
    const { light } = splitBySize(records, THRESHOLD);

    await syncLabWorkToMirror({
      labId,
      owner: "emile",
      records: light,
      labKey,
      signerEd25519Priv: emile.priv,
      signerEd25519Pub: emile.pub,
      manifest: {},
      tombstoneRemoved: true,
      fetchImpl: relay.fetchImpl,
    });

    await pushLabIndex({
      labId,
      owner: "emile",
      index: buildLabIndex("emile", records, THRESHOLD),
      labKey,
      signerEd25519Priv: emile.priv,
      signerEd25519Pub: emile.pub,
      putImpl: (p) => putLabRecord({ ...p, fetchImpl: relay.fetchImpl }),
    });

    return { labKey };
  }

  function piDeps(
    relay: ReturnType<typeof makeInMemoryRelay>,
    labKey: Uint8Array,
  ) {
    const pi = randomKeyPair();
    const identity = {
      keys: {
        signing: { privateKey: pi.priv, publicKey: pi.pub },
        encryption: { privateKey: new Uint8Array(32), publicKey: new Uint8Array(32) },
      },
    };
    const roster = {
      record: {
        members: [
          { username: "pi", role: "head" },
          { username: "emile", role: "member" },
        ],
      },
      envelopes: [{ generation: 1 }],
    };

    const readDeps: Partial<LabScopedReadDeps> = {
      getViewer: async () => ({ username: "pi", account_type: "lab_head" }),
      getLabId: async () => labId,
      getIdentity: () => identity as never,
      fetchLab: async () => roster as never,
      openKey: () => labKey,
      pullRecords: (p) =>
        pullMemberLabRecords({
          labId: p.labId,
          memberOwner: p.memberOwner,
          labKey: p.labKey,
          signerEd25519Priv: pi.priv,
          signerEd25519Pub: pi.pub,
          fetchImpl: relay.fetchImpl,
        }),
      appendAudit: async () => {},
    };

    const searchDeps: Partial<LabIndexSearchDeps> = {
      getViewer: async () => ({ username: "pi", account_type: "lab_head" }),
      getLabId: async () => labId,
      getIdentity: () => identity as never,
      fetchLab: async () => roster as never,
      openKey: () => labKey,
      readIndex: (p) =>
        readLabIndexAcrossMembers({
          labId: p.labId,
          members: p.members,
          labKey: p.labKey,
          getImpl: (gp) => getLabRecord({ ...gp, fetchImpl: relay.fetchImpl }),
        }),
    };

    return { readDeps, searchDeps };
  }

  it("the PI reads back the light content, decrypted, with the heavy table held back", async () => {
    const relay = makeInMemoryRelay();
    const { labKey } = await memberPush(relay);
    const { readDeps } = piDeps(relay, labKey);

    const res = await readLabMembersWork({}, readDeps);
    expect(res.ok).toBe(true);
    const emile = res.members.find((m) => m.owner === "emile");
    expect(emile).toBeTruthy();

    const types = emile!.records.map((r) => r.recordType).sort();
    // Light content round-trips; the heavy datahub table and the reserved
    // _index record are NOT returned as work.
    expect(types).toEqual(["note", "task"]);

    // The decrypted note really is Emile's note.
    const note = emile!.records.find((r) => r.recordType === "note");
    const decoded = JSON.parse(new TextDecoder().decode(note!.plaintext));
    expect(decoded.description).toContain("qPCR gel");
  });

  it("the heavy table never reaches the relay (only light content + index)", async () => {
    const relay = makeInMemoryRelay();
    await memberPush(relay);
    const keys = [...relay.store.keys()].sort();
    expect(keys).toEqual([
      "lab-e2e/emile/_index/manifest",
      "lab-e2e/emile/note/1",
      "lab-e2e/emile/task/2",
    ]);
    expect(keys).not.toContain("lab-e2e/emile/datahub/dh-1");
  });

  it("the PI searches the whole lab through the index, including the heavy table", async () => {
    const relay = makeInMemoryRelay();
    const { labKey } = await memberPush(relay);
    const { searchDeps } = piDeps(relay, labKey);

    // A browse (empty query) sees every record, light and heavy.
    const all = await searchLabIndex("", {}, searchDeps);
    expect(all.ok).toBe(true);
    expect(all.hits.map((h) => h.recordType).sort()).toEqual([
      "datahub",
      "note",
      "task",
    ]);

    // A keyword hits the note (preview) and the table (title), both owned by emile.
    const hits = await searchLabIndex("qpcr", {}, searchDeps);
    const byType = Object.fromEntries(hits.hits.map((h) => [h.recordType, h]));
    expect(byType["note"]).toBeTruthy();
    expect(byType["datahub"]).toBeTruthy();
    expect(byType["note"].owner).toBe("emile");

    // The eager flag splits open vs on-request: note is in the mirror, the big
    // table is on demand.
    expect(byType["note"].eager).toBe(true);
    expect(byType["datahub"].eager).toBe(false);
  });

  it("refuses a non-lab-head viewer at both the read and the search", async () => {
    const relay = makeInMemoryRelay();
    const { labKey } = await memberPush(relay);
    const { readDeps, searchDeps } = piDeps(relay, labKey);

    const notHead = async () => ({ username: "emile", account_type: "member" });
    const read = await readLabMembersWork({}, { ...readDeps, getViewer: notHead as never });
    const search = await searchLabIndex("x", {}, { ...searchDeps, getViewer: notHead as never });
    expect(read.ok).toBe(false);
    expect(search.ok).toBe(false);
  });
});
