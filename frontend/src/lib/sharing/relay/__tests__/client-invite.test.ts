// Cross-boundary sharing, relay client INVITE paths (P1-A regression guard).
//
// inviteShare / inviteRawShare mint a one-time key, seal + upload under it, and
// confirm. After P1-A the confirm body must carry NO acceptUrl and NO key, and
// the functions must RETURN the out-of-band material (privateLink + unlockCode)
// so the send-invite UI can show the sender what to deliver. These pin both: the
// confirm body is key-free, and the returned link/code reconstruct the key.
//
// fetch and the heavy crypto/bundle deps are mocked; the one-time key is a fixed
// 32-byte value so the expected hex link/code are deterministic.

import { ed25519 } from "@noble/curves/ed25519.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SIGNING_PRIV = new Uint8Array(32).fill(9);
const SIGNING_PUB = ed25519.getPublicKey(SIGNING_PRIV);

// A fixed one-time key, so the expected hex is deterministic.
const ONE_TIME_KEY = new Uint8Array(32).fill(0xab);
const KEY_HEX = "ab".repeat(32); // 64 hex chars

const loadIdentity = vi.fn();
vi.mock("@/lib/sharing/identity/storage", () => ({
  loadIdentity: () => loadIdentity(),
}));

const buildBundle = vi.fn();
vi.mock("@/lib/sharing/bundle", () => ({
  buildBundle: (...a: unknown[]) => buildBundle(...a),
  readBundle: vi.fn(),
}));

vi.mock("@/lib/sharing/encryption", () => ({
  sealToRecipient: vi.fn(),
  openSealed: vi.fn(),
  // The invite paths seal under a one-time key. Return our fixed key so the
  // returned link / code are deterministic.
  sealUnderOneTimeKey: (_bytes: Uint8Array) => ({
    sealed: new Uint8Array([1, 2, 3, 4]),
    key: ONE_TIME_KEY,
  }),
}));

const trackShareSent = vi.fn();
vi.mock("@/lib/analytics/events", () => ({
  trackShareSent: (...a: unknown[]) => trackShareSent(...a),
}));

import { inviteShare, inviteRawShare } from "../client";

const SENDER_EMAIL = "sender@example.com";
const RECIPIENT_EMAIL = "newperson@example.com";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}
function okEmpty(): Response {
  return { ok: true, status: 200 } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let confirmBody: Record<string, unknown> | null;

beforeEach(() => {
  loadIdentity.mockReset();
  buildBundle.mockReset();
  trackShareSent.mockReset();
  confirmBody = null;

  loadIdentity.mockResolvedValue({
    keys: {
      encryption: { publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) },
      signing: { publicKey: SIGNING_PUB, privateKey: SIGNING_PRIV },
    },
    deviceSalt: new Uint8Array(16),
  });
  buildBundle.mockResolvedValue(new Uint8Array([7, 7, 7]));

  // Pin the link origin so the expected privateLink is deterministic.
  process.env.NEXT_PUBLIC_APP_ORIGIN = "https://research-os.app";

  fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === "/api/relay/invite/send") {
      return jsonResponse(200, {
        inviteId: "invite-1",
        uploadUrl: "https://r2.example/upload",
        expiresAt: "2026-07-08T00:00:00.000Z",
      });
    }
    if (url === "/api/relay/invite/confirm") {
      confirmBody = JSON.parse(init!.body as string);
      return jsonResponse(200, { ok: true });
    }
    return okEmpty(); // the PUT
  });
  vi.stubGlobal("fetch", fetchMock);
});

const EXPECTED_LINK = `https://research-os.app/accept/invite-1#k=${KEY_HEX}`;

describe("inviteShare, key out of the confirm body (P1-A)", () => {
  it("returns privateLink + unlockCode and never sends the key to confirm", async () => {
    const result = await inviteShare({
      email: SENDER_EMAIL,
      recipientEmail: RECIPIENT_EMAIL,
      bundle: {
        shareUuid: "u-1",
        version: 1,
        modifiedAt: "2026-06-08T00:00:00.000Z",
        entityType: "note",
        entity: { title: "x" },
        attachments: [],
      },
      itemTitle: "My note",
      senderLabel: SENDER_EMAIL,
    });

    // Returned out-of-band material reconstructs the key.
    expect(result.privateLink).toBe(EXPECTED_LINK);
    expect(result.unlockCode).toBe(KEY_HEX);
    expect(result.inviteId).toBe("invite-1");

    // The confirm body carries the delivery fields but NO acceptUrl and NO key.
    expect(confirmBody).not.toBeNull();
    expect(confirmBody!.recipientEmail).toBe(RECIPIENT_EMAIL);
    expect(confirmBody!.itemTitle).toBe("My note");
    expect("acceptUrl" in confirmBody!).toBe(false);
    // Defense in depth: no field anywhere in the body contains the key/fragment.
    const serialized = JSON.stringify(confirmBody);
    expect(serialized).not.toContain(KEY_HEX);
    expect(serialized).not.toContain("#k=");
  });
});

describe("inviteRawShare, key out of the confirm body (P1-A)", () => {
  it("returns privateLink + unlockCode and never sends the key to confirm", async () => {
    const result = await inviteRawShare({
      email: SENDER_EMAIL,
      recipientEmail: RECIPIENT_EMAIL,
      payload: new Uint8Array([5, 5, 5]),
      itemTitle: "My experiment",
      senderLabel: SENDER_EMAIL,
      itemKind: "experiment",
    });

    expect(result.privateLink).toBe(EXPECTED_LINK);
    expect(result.unlockCode).toBe(KEY_HEX);

    expect(confirmBody).not.toBeNull();
    expect(confirmBody!.itemKind).toBe("experiment");
    expect("acceptUrl" in confirmBody!).toBe(false);
    const serialized = JSON.stringify(confirmBody);
    expect(serialized).not.toContain(KEY_HEX);
    expect(serialized).not.toContain("#k=");
  });
});
