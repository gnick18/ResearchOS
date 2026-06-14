// Tests for lib/lab/lab-genesis-pending.ts + the createLabLocal / publishLabRemote
// split in lib/lab/lab-create.ts (lab-decouple-account-type).
//
// Covers:
//   - createLabLocal is pure: it returns a labId + a CreatedLab and performs NO
//     fetch (global fetch is spied and asserted never called).
//   - Round-trip: createLabLocal -> build a PendingLabGenesis from its `created`
//     -> the persisted record/envelope survive JSON stringify/parse unchanged,
//     and openLabKeyCopy re-derives a 32-byte lab key from the persisted envelope
//     ALONE (re-derivation works with no stored key).
//   - publishPendingGenesis returns true + clears the pending genesis when the
//     relay POST is ok, and returns false + keeps it when the relay throws / is
//     non-ok.
//
// createLabLocal runs the REAL lab-key crypto so the round-trip exercises real
// sealing + opening. Only the relay (lab-do-client) and the settings store are
// mocked.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks. The relay POST is faked so no network is touched; the settings store
// is an in-memory map so save/read/clear round-trip without a file system.
// ---------------------------------------------------------------------------

vi.mock("../lab-do-client", () => ({
  createLabRemote: vi.fn(),
}));

const settingsStore = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/settings/user-settings", () => ({
  patchUserSettings: vi.fn(async (username: string, patch: Record<string, unknown>) => {
    const current = settingsStore.get(username) ?? {};
    // Mirror the real merge + the JSON-stringify drop of undefined fields: an
    // undefined value clears the key on disk, so readPendingGenesis returns null.
    const next = { ...current, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) {
      if (next[k] === undefined) delete next[k];
    }
    settingsStore.set(username, next);
    return next;
  }),
  readUserSettings: vi.fn(async (username: string) => {
    return settingsStore.get(username) ?? {};
  }),
}));

import { createLab } from "../lab-key";
import { openLabKeyCopy } from "../lab-key";
import { generateIdentityKeys, encodePublicKey } from "@/lib/sharing/identity/keys";
import type { LabMember } from "../lab-membership";
import type { PendingLabGenesis } from "../lab-membership";
import { createLabLocal } from "../lab-create";
import {
  savePendingGenesis,
  readPendingGenesis,
  clearPendingGenesis,
  publishPendingGenesis,
} from "../lab-genesis-pending";
import { createLabRemote } from "../lab-do-client";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";

const mockCreateLabRemote = vi.mocked(createLabRemote);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A real StoredIdentity backed by genuine X25519 + Ed25519 keypairs, so the
 *  seal + open round-trip exercises real crypto. */
function makeRealIdentity(): StoredIdentity {
  return {
    keys: generateIdentityKeys(),
    deviceSalt: new Uint8Array(32).fill(0xee),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsStore.clear();
});

// ---------------------------------------------------------------------------
// createLabLocal
// ---------------------------------------------------------------------------

describe("createLabLocal", () => {
  it("returns a labId + a CreatedLab and performs NO fetch", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const identity = makeRealIdentity();
    const { labId, created } = createLabLocal({
      username: "alice",
      identity,
      oauthEmail: "alice@wisc.edu",
      idImpl: () => "lab-local-id",
    });

    expect(labId).toBe("lab-local-id");
    expect(created.record.labId).toBe("lab-local-id");
    expect(created.record.head.username).toBe("alice");
    expect(created.record.head.role).toBe("head");
    expect(created.labKey).toBeInstanceOf(Uint8Array);
    expect(created.labKey.length).toBe(32);

    // The whole point of the split: no network.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockCreateLabRemote).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("throws when no OAuth email is supplied", () => {
    const identity = makeRealIdentity();
    expect(() =>
      createLabLocal({
        username: "alice",
        identity,
        oauthEmail: "  ",
        idImpl: () => "lab-local-id",
      }),
    ).toThrow(/OAuth-verified email is required/);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: persist genesis, then re-derive the lab key from the envelope
// ---------------------------------------------------------------------------

describe("pending-genesis round-trip", () => {
  it("re-derives a 32-byte lab key from the persisted envelope alone", async () => {
    const identity = makeRealIdentity();
    const { labId, created } = createLabLocal({
      username: "alice",
      identity,
      oauthEmail: "alice@wisc.edu",
      idImpl: () => "lab-roundtrip-id",
    });

    const pending: PendingLabGenesis = {
      labId,
      record: created.record,
      envelope: created.envelope,
    };

    // The persisted artifacts must survive JSON stringify/parse unchanged
    // (this is exactly what settings.json does on disk).
    const reloaded = JSON.parse(JSON.stringify(pending)) as PendingLabGenesis;
    expect(reloaded).toEqual(pending);

    // Re-derive the lab key from the reloaded envelope ALONE, with the head's
    // X25519 private key. No stored labKey is needed.
    const recovered = openLabKeyCopy(
      reloaded.envelope,
      "alice",
      identity.keys.encryption.privateKey,
    );
    expect(recovered).toBeInstanceOf(Uint8Array);
    expect(recovered.length).toBe(32);
    // And it is the same key the local create produced.
    expect(Array.from(recovered)).toEqual(Array.from(created.labKey));
  });

  it("save / read / clear round-trip through the settings store", async () => {
    const identity = makeRealIdentity();
    const { labId, created } = createLabLocal({
      username: "bob",
      identity,
      oauthEmail: "bob@wisc.edu",
      idImpl: () => "lab-store-id",
    });
    const pending: PendingLabGenesis = {
      labId,
      record: created.record,
      envelope: created.envelope,
    };

    expect(await readPendingGenesis("bob")).toBeNull();
    await savePendingGenesis("bob", pending);
    expect(await readPendingGenesis("bob")).toEqual(pending);
    await clearPendingGenesis("bob");
    expect(await readPendingGenesis("bob")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// publishPendingGenesis
// ---------------------------------------------------------------------------

describe("publishPendingGenesis", () => {
  function makePending(username: string): PendingLabGenesis {
    // A minimal but real CreatedLab. The genesis entry is head-signed, so we
    // need a real Ed25519 keypair; the relay POST itself is mocked.
    const id = makeRealIdentity();
    const head: LabMember = {
      username,
      x25519PublicKey: encodePublicKey(id.keys.encryption.publicKey),
      ed25519PublicKey: encodePublicKey(id.keys.signing.publicKey),
      role: "head",
    };
    const created = createLab(
      "lab-pub-id",
      head,
      [head],
      id.keys.signing.privateKey,
    );
    return {
      labId: "lab-pub-id",
      record: created.record,
      envelope: created.envelope,
    };
  }

  it("returns true + clears pending when the relay POST is ok", async () => {
    const pending = makePending("carol");
    await savePendingGenesis("carol", pending);
    mockCreateLabRemote.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const ok = await publishPendingGenesis("carol", pending);

    expect(ok).toBe(true);
    expect(mockCreateLabRemote).toHaveBeenCalledOnce();
    expect(await readPendingGenesis("carol")).toBeNull();
  });

  it("returns false + keeps pending when the relay POST is non-ok", async () => {
    const pending = makePending("dave");
    await savePendingGenesis("dave", pending);
    mockCreateLabRemote.mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    const ok = await publishPendingGenesis("dave", pending);

    expect(ok).toBe(false);
    expect(await readPendingGenesis("dave")).toEqual(pending);
  });

  it("returns false + keeps pending when the relay throws", async () => {
    const pending = makePending("erin");
    await savePendingGenesis("erin", pending);
    mockCreateLabRemote.mockRejectedValueOnce(new Error("network down"));

    const ok = await publishPendingGenesis("erin", pending);

    expect(ok).toBe(false);
    expect(await readPendingGenesis("erin")).toEqual(pending);
  });
});
