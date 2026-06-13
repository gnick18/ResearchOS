// Tests for lib/lab/lab-session-effects.ts
//
// All external I/O is mocked via vi.mock so the effects are fully unit-testable
// without a browser, a DO relay, or an IndexedDB store.
//
// Covers:
//   authenticate:
//     - returns email when getSession already has one (no signIn call).
//     - with no session + provider "devmock", calls signIn("devmock", {redirect:false})
//       and returns the email from the second getSession call.
//   unlockKeypair:
//     - resolves when isSessionUnlocked() returns true.
//     - rejects when isSessionUnlocked() returns false.
//   openLabKey:
//     - picks the highest-generation envelope when envelopes are [0,2,1].
//     - calls openLabKeyCopy with the correct (envelope, username, x25519Priv) args.
//     - returns { labId, labKey, signingKeyPair(ed25519Priv, ed25519Pub), member(username, labId) }.
//     - rejects when getSessionIdentity() is null.
//     - rejects when getLabRemote() returns null.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLabSessionEffects } from "../lab-session-effects";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next-auth/react", () => ({
  getSession: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@/lib/sharing/identity/session-key", () => ({
  isSessionUnlocked: vi.fn(),
  getSessionIdentity: vi.fn(),
}));

vi.mock("@/lib/lab/lab-do-client", () => ({
  getLabRemote: vi.fn(),
  resyncLabRemote: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/lab/lab-key", () => ({
  openLabKeyCopy: vi.fn(),
}));

// The OAuth-email binding (Phase 8a) has its own unit tests (lab-binding.test.ts);
// here it is mocked so openLabKey's envelope/payload logic is tested in isolation
// and the binding's accept/reject can be driven per case.
vi.mock("@/lib/lab/lab-binding", () => ({
  verifyMemberEmailBinding: vi.fn(() => ({ ok: true, reason: "" })),
}));

// ---------------------------------------------------------------------------
// Typed imports of mocked modules so vi can control their return values.
// ---------------------------------------------------------------------------

import { getSession, signIn } from "next-auth/react";
import {
  isSessionUnlocked,
  getSessionIdentity,
} from "@/lib/sharing/identity/session-key";
import { getLabRemote, resyncLabRemote } from "@/lib/lab/lab-do-client";
import { openLabKeyCopy } from "@/lib/lab/lab-key";
import type { LabKeyEnvelope } from "@/lib/lab/lab-key";
import { verifyMemberEmailBinding } from "@/lib/lab/lab-binding";

/** A record whose head is USERNAME, so the binding step finds a roster entry. */
function recordWithHead() {
  return {
    labId: LAB_ID,
    head: {
      username: USERNAME,
      x25519PublicKey: "ab".repeat(32),
      ed25519PublicKey: "cd".repeat(32),
      role: "head" as const,
      emailHashEnc: "deadbeef",
    },
    members: [],
    keyGeneration: 0,
    log: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LAB_ID = "lab-test-xyz";
const USERNAME = "alice";

function makeEffects() {
  return createLabSessionEffects({ labId: LAB_ID, username: USERNAME });
}

/** A minimal fake StoredIdentity shape. */
function makeFakeIdentity() {
  return {
    keys: {
      encryption: {
        privateKey: new Uint8Array(32).fill(0xaa),
        publicKey: new Uint8Array(32).fill(0xab),
      },
      signing: {
        privateKey: new Uint8Array(64).fill(0xcc),
        publicKey: new Uint8Array(32).fill(0xcd),
      },
    },
    deviceSalt: new Uint8Array(16).fill(0xff),
  };
}

/** Builds an envelope with the given generation number. */
function makeEnvelope(generation: number): LabKeyEnvelope {
  return { generation, copies: [] };
}

// ---------------------------------------------------------------------------
// Reset all mocks before each test.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// authenticate
// ---------------------------------------------------------------------------

describe("authenticate", () => {
  it("returns email when getSession already has one (no signIn called)", async () => {
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { email: "alice@example.com" },
      expires: "2099-01-01",
    } as Awaited<ReturnType<typeof getSession>>);

    const effects = makeEffects();
    const result = await effects.authenticate("google");

    expect(result).toEqual({ email: "alice@example.com" });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("calls signIn(devmock, {redirect:false}) and returns email from second getSession", async () => {
    // First call returns null (not signed in yet).
    vi.mocked(getSession)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        user: { email: "dev@localhost" },
        expires: "2099-01-01",
      } as Awaited<ReturnType<typeof getSession>>);

    vi.mocked(signIn).mockResolvedValueOnce(undefined as never);

    const effects = makeEffects();
    const result = await effects.authenticate("devmock");

    expect(signIn).toHaveBeenCalledWith("devmock", { redirect: false });
    expect(result).toEqual({ email: "dev@localhost" });
  });

  it("throws if dev-mock signIn does not establish a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(signIn).mockResolvedValueOnce(undefined as never);

    const effects = makeEffects();
    await expect(effects.authenticate("devmock")).rejects.toThrow(
      "lab session: dev-mock sign-in did not establish a session",
    );
  });
});

// ---------------------------------------------------------------------------
// unlockKeypair
// ---------------------------------------------------------------------------

describe("unlockKeypair", () => {
  it("resolves when isSessionUnlocked() returns true", async () => {
    vi.mocked(isSessionUnlocked).mockReturnValueOnce(true);

    const effects = makeEffects();
    await expect(effects.unlockKeypair()).resolves.toBeUndefined();
  });

  it("throws when isSessionUnlocked() returns false", async () => {
    vi.mocked(isSessionUnlocked).mockReturnValueOnce(false);

    const effects = makeEffects();
    await expect(effects.unlockKeypair()).rejects.toThrow(
      "lab session: identity is locked",
    );
  });
});

// ---------------------------------------------------------------------------
// openLabKey
// ---------------------------------------------------------------------------

describe("openLabKey", () => {
  it("throws when getSessionIdentity() is null", async () => {
    vi.mocked(getSessionIdentity).mockReturnValueOnce(null);

    const effects = makeEffects();
    await expect(effects.openLabKey()).rejects.toThrow(
      "lab session: identity not unlocked",
    );
  });

  it("throws when getLabRemote() returns null", async () => {
    vi.mocked(getSessionIdentity).mockReturnValueOnce(
      makeFakeIdentity() as ReturnType<typeof getSessionIdentity>,
    );
    vi.mocked(getLabRemote).mockResolvedValueOnce(null);

    const effects = makeEffects();
    await expect(effects.openLabKey()).rejects.toThrow(
      "lab session: lab not found on relay",
    );
  });

  it("throws when envelopes array is empty", async () => {
    vi.mocked(getSessionIdentity).mockReturnValueOnce(
      makeFakeIdentity() as ReturnType<typeof getSessionIdentity>,
    );
    vi.mocked(getLabRemote).mockResolvedValueOnce({
      record: {} as never,
      envelopes: [],
    });

    const effects = makeEffects();
    await expect(effects.openLabKey()).rejects.toThrow(
      "lab session: lab has no key envelopes",
    );
  });

  it("picks the highest-generation envelope and returns the expected payload", async () => {
    const fakeId = makeFakeIdentity();
    vi.mocked(getSessionIdentity).mockReturnValueOnce(
      fakeId as ReturnType<typeof getSessionIdentity>,
    );

    const envelopes = [makeEnvelope(0), makeEnvelope(2), makeEnvelope(1)];
    vi.mocked(getLabRemote).mockResolvedValueOnce({
      record: recordWithHead() as never,
      envelopes,
    });
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { email: "alice@example.com" },
      expires: "2099-01-01",
    } as Awaited<ReturnType<typeof getSession>>);

    const fakeLabKey = new Uint8Array(32).fill(0x55);
    vi.mocked(openLabKeyCopy).mockReturnValueOnce(fakeLabKey);

    const effects = makeEffects();
    const result = await effects.openLabKey();

    // Assert openLabKeyCopy was called with the generation-2 envelope.
    expect(openLabKeyCopy).toHaveBeenCalledWith(
      envelopes[1], // generation 2 is index 1 in the array
      USERNAME,
      fakeId.keys.encryption.privateKey,
    );

    // Assert the returned shape.
    expect(result.labId).toBe(LAB_ID);
    expect(result.labKey).toBe(fakeLabKey);
    expect(result.signingKeyPair.ed25519Priv).toBe(
      fakeId.keys.signing.privateKey,
    );
    expect(result.signingKeyPair.ed25519Pub).toBe(
      fakeId.keys.signing.publicKey,
    );
    expect(result.member.username).toBe(USERNAME);
    expect(result.member.labId).toBe(LAB_ID);

    // A successful login triggers a best-effort billing resync for this lab, so
    // a member whose directory binding only just landed gets reconciled into the
    // shared pool (closing the head-added-before-bind timing race).
    expect(resyncLabRemote).toHaveBeenCalledWith(LAB_ID);
  });

  it("hard-rejects the login when the OAuth-email binding fails (Phase 8a)", async () => {
    const fakeId = makeFakeIdentity();
    vi.mocked(getSessionIdentity).mockReturnValueOnce(
      fakeId as ReturnType<typeof getSessionIdentity>,
    );
    vi.mocked(getLabRemote).mockResolvedValueOnce({
      record: recordWithHead() as never,
      envelopes: [makeEnvelope(0)],
    });
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { email: "imposter@evil.com" },
      expires: "2099-01-01",
    } as Awaited<ReturnType<typeof getSession>>);
    vi.mocked(openLabKeyCopy).mockReturnValueOnce(new Uint8Array(32).fill(0x55));
    vi.mocked(verifyMemberEmailBinding).mockReturnValueOnce({
      ok: false,
      reason: "OAuth email does not match this membership",
    });

    const effects = makeEffects();
    await expect(effects.openLabKey()).rejects.toThrow(
      /OAuth email does not match this lab membership/,
    );
  });

  it("rejects when the user has no roster entry in this lab", async () => {
    const fakeId = makeFakeIdentity();
    vi.mocked(getSessionIdentity).mockReturnValueOnce(
      fakeId as ReturnType<typeof getSessionIdentity>,
    );
    // head is someone else and members is empty -> no entry for USERNAME.
    const foreign = recordWithHead();
    foreign.head.username = "someone-else";
    vi.mocked(getLabRemote).mockResolvedValueOnce({
      record: foreign as never,
      envelopes: [makeEnvelope(0)],
    });
    vi.mocked(openLabKeyCopy).mockReturnValueOnce(new Uint8Array(32).fill(0x55));

    const effects = makeEffects();
    await expect(effects.openLabKey()).rejects.toThrow(
      /no roster entry for this user/,
    );
  });
});
