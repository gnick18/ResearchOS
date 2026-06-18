// Tests for the reload-reconnect hardening in lib/lab/lab-session-effects.ts.
//
// Separate from lab-session-effects.test.ts because these exercise the path with
// NEXT_PUBLIC_LAB_RELOAD_RECONNECT ON, so they mock "../config" to force the flag
// true. The base test file deliberately runs with the flag off (real env), which
// keeps the original throw-to-locked behavior byte-for-byte.
//
// Covers:
//   - getLabRemote THROWS (relay outage) + a cached envelope exists ->
//     openLabKey re-derives the key offline from the cache instead of throwing.
//   - getLabRemote SUCCEEDS -> the public sealed artifacts are cached for next
//     reload (saveLabEnvelopeCache called with record + chosen envelope, never
//     the lab key).
//   - getLabRemote THROWS + NO cache -> still rejects with "lab not found".
//   - getLabRemote returns null + a cached envelope exists -> opens from cache.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config", () => ({
  LAB_TIER_ENABLED: true,
  LAB_RELOAD_RECONNECT_ENABLED: true,
}));

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

vi.mock("@/lib/lab/lab-binding", () => ({
  verifyMemberEmailBinding: vi.fn(() => ({ ok: true, reason: "" })),
}));

vi.mock("../lab-genesis-pending", () => ({
  readPendingGenesis: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lab-envelope-cache", () => ({
  readLabEnvelopeCache: vi.fn(),
  saveLabEnvelopeCache: vi.fn().mockResolvedValue(undefined),
}));

import { createLabSessionEffects } from "../lab-session-effects";
import { getSession } from "next-auth/react";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { getLabRemote } from "@/lib/lab/lab-do-client";
import { openLabKeyCopy } from "@/lib/lab/lab-key";
import type { LabKeyEnvelope } from "@/lib/lab/lab-key";
import {
  readLabEnvelopeCache,
  saveLabEnvelopeCache,
} from "../lab-envelope-cache";

const LAB_ID = "lab-test-xyz";
const USERNAME = "alice";

function makeEffects() {
  return createLabSessionEffects({ labId: LAB_ID, username: USERNAME });
}

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

function makeEnvelope(generation: number): LabKeyEnvelope {
  return { generation, copies: [] };
}

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

function liveSession() {
  vi.mocked(getSession).mockResolvedValue({
    user: { email: "alice@example.com" },
    expires: "2099-01-01",
  } as Awaited<ReturnType<typeof getSession>>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openLabKey reload-reconnect (flag on)", () => {
  it("re-derives the key from the cached envelope when getLabRemote throws", async () => {
    const fakeId = makeFakeIdentity();
    vi.mocked(getSessionIdentity).mockReturnValue(
      fakeId as ReturnType<typeof getSessionIdentity>,
    );
    // Relay is unreachable on this reload.
    vi.mocked(getLabRemote).mockRejectedValueOnce(
      new Error("getLabRemote: relay returned 503"),
    );
    // ...but the member opened this lab before, so the sealed artifacts are cached.
    const cachedEnvelope = makeEnvelope(3);
    vi.mocked(readLabEnvelopeCache).mockResolvedValueOnce({
      labId: LAB_ID,
      record: recordWithHead() as never,
      envelope: cachedEnvelope as never,
    });
    liveSession();
    const fakeLabKey = new Uint8Array(32).fill(0x55);
    vi.mocked(openLabKeyCopy).mockReturnValueOnce(fakeLabKey);

    const effects = makeEffects();
    const result = await effects.openLabKey();

    // The key was opened from the CACHED envelope, not the relay.
    expect(openLabKeyCopy).toHaveBeenCalledWith(
      cachedEnvelope,
      USERNAME,
      fakeId.keys.encryption.privateKey,
    );
    expect(result.labKey).toBe(fakeLabKey);
    expect(result.labId).toBe(LAB_ID);
  });

  it("opens from cache when getLabRemote returns null (lab not yet on relay)", async () => {
    const fakeId = makeFakeIdentity();
    vi.mocked(getSessionIdentity).mockReturnValue(
      fakeId as ReturnType<typeof getSessionIdentity>,
    );
    vi.mocked(getLabRemote).mockResolvedValueOnce(null);
    const cachedEnvelope = makeEnvelope(1);
    vi.mocked(readLabEnvelopeCache).mockResolvedValueOnce({
      labId: LAB_ID,
      record: recordWithHead() as never,
      envelope: cachedEnvelope as never,
    });
    liveSession();
    vi.mocked(openLabKeyCopy).mockReturnValueOnce(new Uint8Array(32).fill(0x55));

    const effects = makeEffects();
    const result = await effects.openLabKey();

    expect(openLabKeyCopy).toHaveBeenCalledWith(
      cachedEnvelope,
      USERNAME,
      fakeId.keys.encryption.privateKey,
    );
    expect(result.labId).toBe(LAB_ID);
  });

  it("caches the public sealed artifacts on a successful relay open (never the lab key)", async () => {
    const fakeId = makeFakeIdentity();
    vi.mocked(getSessionIdentity).mockReturnValue(
      fakeId as ReturnType<typeof getSessionIdentity>,
    );
    const envelopes = [makeEnvelope(0), makeEnvelope(2), makeEnvelope(1)];
    const record = recordWithHead();
    vi.mocked(getLabRemote).mockResolvedValueOnce({
      record: record as never,
      envelopes,
    });
    liveSession();
    vi.mocked(openLabKeyCopy).mockReturnValueOnce(new Uint8Array(32).fill(0x55));

    const effects = makeEffects();
    await effects.openLabKey();

    // Cached the highest-generation envelope (gen 2 = index 1) + the record only.
    expect(saveLabEnvelopeCache).toHaveBeenCalledWith(USERNAME, {
      labId: LAB_ID,
      record,
      envelope: envelopes[1],
    });
    // The persisted payload must not carry the lab key under any field.
    const persisted = vi.mocked(saveLabEnvelopeCache).mock.calls[0][1];
    expect(JSON.stringify(persisted)).not.toContain("labKey");
  });

  it("still rejects when the relay throws and there is no cache", async () => {
    vi.mocked(getSessionIdentity).mockReturnValue(
      makeFakeIdentity() as ReturnType<typeof getSessionIdentity>,
    );
    vi.mocked(getLabRemote).mockRejectedValueOnce(new Error("relay down"));
    vi.mocked(readLabEnvelopeCache).mockResolvedValueOnce(null);

    const effects = makeEffects();
    await expect(effects.openLabKey()).rejects.toThrow(
      "lab session: lab not found on relay",
    );
  });
});
