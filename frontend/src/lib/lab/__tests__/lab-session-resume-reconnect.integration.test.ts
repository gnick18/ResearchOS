// Integration test: the lab-session CONTROLLER resume path with reload-reconnect.
//
// The unit tests in lab-session-effects-reload-reconnect.test.ts prove openLabKey
// re-derives the key from cache when the relay throws. This file goes one level up
// and wires the REAL effects (createLabSessionEffects) into a REAL controller
// (createLabSessionController), then drives resume() the way the gate does on a
// page reload. It asserts the full state machine actually reaches "live" (not just
// that openLabKey resolves), which is the behavior a user sees instead of the
// "Sign in to your lab" gate. Runs with NEXT_PUBLIC_LAB_RELOAD_RECONNECT forced on.
//
// The flag-off contrast (openLabKey re-throws, controller stays locked) is covered
// by lab-session-effects.test.ts, which runs with the real config (flag off).
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
  isSessionUnlocked: vi.fn(() => true),
  getSessionIdentity: vi.fn(),
}));

vi.mock("@/lib/sharing/identity/storage", () => ({
  restoreSessionFromStore: vi.fn().mockResolvedValue(undefined),
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
  clearLabEnvelopeCache: vi.fn().mockResolvedValue(undefined),
}));

import { createLabSessionEffects } from "../lab-session-effects";
import { createLabSessionController } from "../lab-session";
import { getSession } from "next-auth/react";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { getLabRemote } from "@/lib/lab/lab-do-client";
import { openLabKeyCopy } from "@/lib/lab/lab-key";
import type { LabKeyEnvelope } from "@/lib/lab/lab-key";
import {
  readLabEnvelopeCache,
  clearLabEnvelopeCache,
} from "../lab-envelope-cache";

const LAB_ID = "lab-test-xyz";
const USERNAME = "alice";

function makeController() {
  const effects = createLabSessionEffects({ labId: LAB_ID, username: USERNAME });
  return createLabSessionController(effects);
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

/** Flush queued microtasks so best-effort fire-and-forget effects settle. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionIdentity).mockReturnValue(
    makeFakeIdentity() as ReturnType<typeof getSessionIdentity>,
  );
});

describe("controller.resume() with reload-reconnect (flag on)", () => {
  it("reaches 'live' from the cached envelope when the relay is unreachable", async () => {
    liveSession();
    // The relay throws on this reload (DO outage), exactly the failure that today
    // bounces a member to the sign-in gate.
    vi.mocked(getLabRemote).mockRejectedValue(
      new Error("getLabRemote: relay returned 503"),
    );
    // The member opened this lab before, so the sealed artifacts are cached.
    vi.mocked(readLabEnvelopeCache).mockResolvedValue({
      labId: LAB_ID,
      record: recordWithHead() as never,
      envelope: { generation: 4, copies: [] } as LabKeyEnvelope as never,
    });
    vi.mocked(openLabKeyCopy).mockReturnValue(new Uint8Array(32).fill(0x55));

    const controller = makeController();
    controller.start("lab");
    expect(controller.getState().kind).toBe("locked");

    await controller.resume();

    // The whole resume state machine landed on live, not the sign-in gate.
    expect(controller.getState().kind).toBe("live");
  });

  it("stays 'locked' when the relay is unreachable and there is no cache", async () => {
    liveSession();
    vi.mocked(getLabRemote).mockRejectedValue(new Error("relay down"));
    vi.mocked(readLabEnvelopeCache).mockResolvedValue(null);

    const controller = makeController();
    controller.start("lab");
    await controller.resume();

    // No cache to fall back to, so resume cannot open the lab and stays locked
    // (the gate shows the sign-in buttons, which is the correct outcome here).
    expect(controller.getState().kind).toBe("locked");
  });

  it("clears the envelope cache on logout", async () => {
    liveSession();
    vi.mocked(getLabRemote).mockResolvedValue({
      record: recordWithHead() as never,
      envelopes: [{ generation: 0, copies: [] } as LabKeyEnvelope],
    });
    vi.mocked(openLabKeyCopy).mockReturnValue(new Uint8Array(32).fill(0x55));

    const controller = makeController();
    controller.start("lab");
    await controller.resume();
    expect(controller.getState().kind).toBe("live");

    controller.logout();
    await flush();

    expect(controller.getState().kind).toBe("locked");
    expect(clearLabEnvelopeCache).toHaveBeenCalledWith(USERNAME);
  });
});
