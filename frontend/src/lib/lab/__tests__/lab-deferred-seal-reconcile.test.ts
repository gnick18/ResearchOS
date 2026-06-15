import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 4A reconciliation: the decision (buildSealFacts) and the orchestration
// (reconcileDeferredSeals). We inject the candidate loader + pubkey resolver and
// mock the relay client so no network is touched. The SECURITY assertion is that
// the lab key never appears in anything sent to the relay.

const appendCalls: Array<{ labId: string; entry: unknown; copy: unknown }> = [];
let remoteResult: unknown = null;

vi.mock("@/lib/lab/lab-do-client", () => ({
  getLabRemote: vi.fn(async () => remoteResult),
  appendAddMemberRemote: vi.fn(async (labId: string, entry: unknown, copy: unknown) => {
    appendCalls.push({ labId, entry, copy });
    return { ok: true, status: 200 } as Response;
  }),
}));

import {
  buildSealFacts,
  reconcileDeferredSeals,
  type ResolvedPubkeys,
} from "@/lib/lab/lab-deferred-seal-reconcile";
import { createLab, openLabKeyCopy, generateLabKey } from "@/lib/lab/lab-key";
import { generateIdentityKeys, encodePublicKey } from "@/lib/sharing/identity/keys";
import type { LabMember } from "@/lib/lab/lab-membership";

function memberFromKeys(username: string): {
  member: LabMember;
  x25519Priv: Uint8Array;
} {
  const k = generateIdentityKeys();
  return {
    member: {
      username,
      x25519PublicKey: encodePublicKey(k.encryption.publicKey),
      ed25519PublicKey: encodePublicKey(k.signing.publicKey),
      role: "member",
    },
    x25519Priv: k.encryption.privateKey,
  };
}

beforeEach(() => {
  appendCalls.length = 0;
  remoteResult = null;
});

describe("buildSealFacts", () => {
  it("marks a candidate with a directory pubkey and no copy as seal-pending", async () => {
    const head = memberFromKeys("head@x.com");
    // A minimal record is enough; buildSealFacts only reads public roster fields.
    const record = {
      labId: "lab-1",
      head: head.member,
      members: [] as LabMember[],
      keyGeneration: 0,
      log: [],
    };
    const resolve = async (email: string): Promise<ResolvedPubkeys> =>
      email === "new@x.com"
        ? { found: true, x25519PublicKey: "ab".repeat(32), ed25519PublicKey: "cd".repeat(32) }
        : { found: false };

    const facts = await buildSealFacts({
      record,
      sealedUsernames: new Set(["head@x.com"]),
      candidateEmails: ["new@x.com"],
      resolve,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].username).toBe("new@x.com");
    expect(facts[0].hasSealedCopy).toBe(false);
    expect(facts[0].publishedX25519Pub).toBe("ab".repeat(32));
  });

  it("a candidate who already has a sealed copy is not re-resolved (active)", async () => {
    const record = {
      labId: "lab-1",
      head: { username: "head@x.com", x25519PublicKey: "", ed25519PublicKey: "", role: "head" as const },
      members: [] as LabMember[],
      keyGeneration: 0,
      log: [],
    };
    const resolve = vi.fn(async (): Promise<ResolvedPubkeys> => ({ found: false }));
    const facts = await buildSealFacts({
      record,
      sealedUsernames: new Set(["sealed@x.com"]),
      candidateEmails: ["sealed@x.com"],
      resolve,
    });
    expect(facts[0].hasSealedCopy).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("a candidate with no directory binding is key-pending (null pubkey)", async () => {
    const record = {
      labId: "lab-1",
      head: { username: "head@x.com", x25519PublicKey: "", ed25519PublicKey: "", role: "head" as const },
      members: [] as LabMember[],
      keyGeneration: 0,
      log: [],
    };
    const facts = await buildSealFacts({
      record,
      sealedUsernames: new Set(),
      candidateEmails: ["nokey@x.com"],
      resolve: async () => ({ found: false }),
    });
    expect(facts[0].publishedX25519Pub).toBeNull();
  });
});

describe("reconcileDeferredSeals", () => {
  it("seals to a keyed candidate, the member can open it, and the lab key is NEVER sent to the relay", async () => {
    const head = memberFromKeys("head@x.com");
    const headKeys = generateIdentityKeys();
    head.member.x25519PublicKey = encodePublicKey(headKeys.encryption.publicKey);
    head.member.ed25519PublicKey = encodePublicKey(headKeys.signing.publicKey);
    head.member.role = "head";

    const labKey = generateLabKey();
    const created = createLab("lab-1", head.member, [], headKeys.signing.privateKey, {
      labKey,
    });

    remoteResult = { record: created.record, envelopes: [created.envelope] };

    const newMember = memberFromKeys("new@x.com");
    const resolve = async (email: string): Promise<ResolvedPubkeys> =>
      email === "new@x.com"
        ? {
            found: true,
            x25519PublicKey: newMember.member.x25519PublicKey,
            ed25519PublicKey: newMember.member.ed25519PublicKey,
          }
        : { found: false };

    const outcomes = await reconcileDeferredSeals({
      ctx: {
        labId: "lab-1",
        labKey,
        headEd25519Priv: headKeys.signing.privateKey,
      },
      loadCandidates: async () => ["new@x.com"],
      resolve,
    });

    expect(outcomes).toEqual([{ email: "new@x.com", status: "sealed", reason: "" }]);
    expect(appendCalls).toHaveLength(1);

    // The new member can open the sealed copy with THEIR private key -> the lab
    // key reached them end-to-end.
    const sentCopy = appendCalls[0].copy as { username: string; sealed: string };
    expect(sentCopy.username).toBe("new@x.com");
    const opened = openLabKeyCopy(
      { generation: 0, copies: [sentCopy] },
      "new@x.com",
      newMember.x25519Priv,
    );
    expect(Array.from(opened)).toEqual(Array.from(labKey));

    // SECURITY: the raw lab key bytes must never appear in anything sent to the
    // relay (entry or copy). The sealed copy is a sealed box, not the key.
    const labKeyHex = Buffer.from(labKey).toString("hex");
    const wire = JSON.stringify(appendCalls);
    expect(wire.includes(labKeyHex)).toBe(false);
  });

  it("a candidate with no published key is reported key-pending and never sealed", async () => {
    const headKeys = generateIdentityKeys();
    const head: LabMember = {
      username: "head@x.com",
      x25519PublicKey: encodePublicKey(headKeys.encryption.publicKey),
      ed25519PublicKey: encodePublicKey(headKeys.signing.publicKey),
      role: "head",
    };
    const labKey = generateLabKey();
    const created = createLab("lab-1", head, [], headKeys.signing.privateKey, { labKey });
    remoteResult = { record: created.record, envelopes: [created.envelope] };

    const outcomes = await reconcileDeferredSeals({
      ctx: { labId: "lab-1", labKey, headEd25519Priv: headKeys.signing.privateKey },
      loadCandidates: async () => ["nokey@x.com"],
      resolve: async () => ({ found: false }),
    });
    expect(outcomes).toEqual([
      { email: "nokey@x.com", status: "key-pending", reason: "member has no published device key yet" },
    ]);
    expect(appendCalls).toHaveLength(0);
  });

  it("returns no work when there are no candidates", async () => {
    const outcomes = await reconcileDeferredSeals({
      ctx: { labId: "lab-1", labKey: generateLabKey(), headEd25519Priv: new Uint8Array(64) },
      loadCandidates: async () => [],
      resolve: async () => ({ found: false }),
    });
    expect(outcomes).toEqual([]);
  });
});
