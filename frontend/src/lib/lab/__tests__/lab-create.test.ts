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

const FAKE_GENERATED_KEY = new Uint8Array(32).fill(0x77);

vi.mock("../lab-key", () => ({
  createLab: vi.fn(),
  generateLabKey: vi.fn(() => new Uint8Array(32).fill(0x77)),
}));

// lab-binding is mocked so this orchestration test does not exercise the real
// hash + lab-key encrypt (that is covered in lab-binding.test.ts). We only need
// to assert lab-create seals the head's email under the generated key.
vi.mock("../lab-binding", () => ({
  sealMemberEmailHash: vi.fn(() => "deadbeefdeadbeef"),
}));

vi.mock("../lab-do-client", () => ({
  createLabRemote: vi.fn(),
}));

// Pull the typed mock handles after module registration.
import { createLab } from "../lab-key";
import { sealMemberEmailHash } from "../lab-binding";
import { createLabRemote } from "../lab-do-client";

const mockCreateLab = vi.mocked(createLab);
const mockSealEmail = vi.mocked(sealMemberEmailHash);
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
      oauthEmail: "alice@wisc.edu",
      idImpl: () => "lab-test-id",
    });

    expect(mockCreateLab).toHaveBeenCalledOnce();
    const [calledLabId, calledHead, calledMembers, calledPrivKey, calledOpts] =
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

    // head carries the lab-key-encrypted email binding (Phase 8a)
    expect(calledHead.emailHashEnc).toBe("deadbeefdeadbeef");
    expect(mockSealEmail).toHaveBeenCalledWith(
      "alice@wisc.edu",
      FAKE_GENERATED_KEY,
    );

    // members is [head] (head is the sole member for a brand-new lab)
    expect(calledMembers).toHaveLength(1);
    expect(calledMembers[0]).toEqual(calledHead);

    // private signing key is passed verbatim
    expect(calledPrivKey).toBe(identity.keys.signing.privateKey);

    // the generated key is injected so the binding rides the signed roster
    expect(calledOpts).toEqual({ labKey: FAKE_GENERATED_KEY });
  });

  it("throws when no OAuth email is supplied (cannot bind the head)", async () => {
    const identity = makeFakeIdentity();
    await expect(
      createLabForCurrentUser({
        username: "alice",
        identity,
        oauthEmail: "  ",
        idImpl: () => "lab-test-id",
      }),
    ).rejects.toThrow(/OAuth-verified email is required/);
    expect(mockCreateLab).not.toHaveBeenCalled();
  });

  it("calls createLabRemote with the labId and the CreatedLab from createLab", async () => {
    const identity = makeFakeIdentity();
    const fakeCreated = makeFakeCreatedLab();
    mockCreateLab.mockReturnValueOnce(fakeCreated);
    mockCreateLabRemote.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    await createLabForCurrentUser({
      username: "alice",
      identity,
      oauthEmail: "alice@wisc.edu",
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
      oauthEmail: "alice@wisc.edu",
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
        oauthEmail: "alice@wisc.edu",
        idImpl: () => "lab-test-id",
      }),
    ).rejects.toThrow(
      "publishLabRemote: relay rejected lab create (HTTP 401)",
    );
  });
});
