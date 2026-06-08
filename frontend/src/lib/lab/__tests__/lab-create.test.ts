// Tests for lib/lab/lab-create.ts (Phase 5 lab-creation entry point).
//
// Covers:
//   - createLab is called with the correct labId, head (role, pubkeys), members
//     ([head]), and the signing private key.
//   - createLabRemote is called with the labId and the CreatedLab returned by
//     createLab.
//   - The function returns { labId, labKey } where labKey is from the fake
//     CreatedLab.
//   - The function throws when createLabRemote returns a non-ok response (401).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { encodePublicKey } from "@/lib/sharing/identity/keys";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import type { CreatedLab } from "../lab-key";
import { createLabForCurrentUser } from "../lab-create";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../lab-key", () => ({
  createLab: vi.fn(),
}));

vi.mock("../lab-do-client", () => ({
  createLabRemote: vi.fn(),
}));

// Pull the typed mock handles after module registration.
import { createLab } from "../lab-key";
import { createLabRemote } from "../lab-do-client";

const mockCreateLab = vi.mocked(createLab);
const mockCreateLabRemote = vi.mocked(createLabRemote);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A fake StoredIdentity with deterministic key bytes. */
function makeFakeIdentity(): StoredIdentity {
  return {
    keys: {
      encryption: {
        publicKey: new Uint8Array(32).fill(0xaa),
        privateKey: new Uint8Array(32).fill(0xab),
      },
      signing: {
        publicKey: new Uint8Array(32).fill(0xcc),
        privateKey: new Uint8Array(64).fill(0xcd),
      },
    },
    deviceSalt: new Uint8Array(32).fill(0xee),
  };
}

const FAKE_LAB_KEY = new Uint8Array(32).fill(0x42);

/** A minimal fake CreatedLab returned by the mocked createLab. */
function makeFakeCreatedLab(): CreatedLab {
  return {
    record: {
      labId: "lab-test-id",
      head: {
        username: "alice",
        x25519PublicKey: encodePublicKey(new Uint8Array(32).fill(0xaa)),
        ed25519PublicKey: encodePublicKey(new Uint8Array(32).fill(0xcc)),
        role: "head",
      },
      members: [],
      keyGeneration: 0,
      log: [],
    },
    envelope: { generation: 0, copies: [] },
    labKey: FAKE_LAB_KEY,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createLabForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls createLab with the correct labId, head, members, and private signing key", async () => {
    const identity = makeFakeIdentity();
    const fakeCreated = makeFakeCreatedLab();
    mockCreateLab.mockReturnValueOnce(fakeCreated);
    mockCreateLabRemote.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    await createLabForCurrentUser({
      username: "alice",
      identity,
      idImpl: () => "lab-test-id",
    });

    expect(mockCreateLab).toHaveBeenCalledOnce();
    const [calledLabId, calledHead, calledMembers, calledPrivKey] =
      mockCreateLab.mock.calls[0];

    // labId
    expect(calledLabId).toBe("lab-test-id");

    // head shape
    expect(calledHead.username).toBe("alice");
    expect(calledHead.role).toBe("head");
    expect(calledHead.x25519PublicKey).toBe(
      encodePublicKey(identity.keys.encryption.publicKey),
    );
    expect(calledHead.ed25519PublicKey).toBe(
      encodePublicKey(identity.keys.signing.publicKey),
    );

    // members is [head] (head is the sole member for a brand-new lab)
    expect(calledMembers).toHaveLength(1);
    expect(calledMembers[0]).toEqual(calledHead);

    // private signing key is passed verbatim
    expect(calledPrivKey).toBe(identity.keys.signing.privateKey);
  });

  it("calls createLabRemote with the labId and the CreatedLab from createLab", async () => {
    const identity = makeFakeIdentity();
    const fakeCreated = makeFakeCreatedLab();
    mockCreateLab.mockReturnValueOnce(fakeCreated);
    mockCreateLabRemote.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    await createLabForCurrentUser({
      username: "alice",
      identity,
      idImpl: () => "lab-test-id",
    });

    expect(mockCreateLabRemote).toHaveBeenCalledOnce();
    const [calledLabId, calledCreated] = mockCreateLabRemote.mock.calls[0];
    expect(calledLabId).toBe("lab-test-id");
    expect(calledCreated).toBe(fakeCreated);
  });

  it("returns { labId, labKey } where labKey is from the fake CreatedLab", async () => {
    const identity = makeFakeIdentity();
    const fakeCreated = makeFakeCreatedLab();
    mockCreateLab.mockReturnValueOnce(fakeCreated);
    mockCreateLabRemote.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const result = await createLabForCurrentUser({
      username: "alice",
      identity,
      idImpl: () => "lab-test-id",
    });

    expect(result.labId).toBe("lab-test-id");
    expect(result.labKey).toBe(FAKE_LAB_KEY);
  });

  it("throws when createLabRemote returns a non-ok response (401)", async () => {
    const identity = makeFakeIdentity();
    const fakeCreated = makeFakeCreatedLab();
    mockCreateLab.mockReturnValueOnce(fakeCreated);
    mockCreateLabRemote.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    await expect(
      createLabForCurrentUser({
        username: "alice",
        identity,
        idImpl: () => "lab-test-id",
      }),
    ).rejects.toThrow(
      "createLabForCurrentUser: relay rejected lab create (HTTP 401)",
    );
  });
});
