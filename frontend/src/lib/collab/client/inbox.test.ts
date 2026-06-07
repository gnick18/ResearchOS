// Round-trip test for the per-recipient inbox client (external-collab chunk 3).
// Each call produces a signed request the relay's RecipientInbox DO verifies
// with ed25519.verify(sig, msg, pubkey) over an exact canonical string. This
// test reconstructs that DO-side verification so a regression in the message
// shape, the encoding, or the inbox address fails here before it reaches the
// relay.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import {
  generateIdentityKeys,
  encodePublicKey,
  type IdentityKeys,
} from "@/lib/sharing/identity/keys";
import { hashEmail } from "@/lib/sharing/directory/email";
import { COLLAB_INBOX_ADDRESS_SALT } from "@/lib/loro/config";

// The inbox client reads the device identity + signer email from module state.
// Mock both so the test drives a known keypair and email.
let mockIdentity: { keys: IdentityKeys } | null = null;
let mockEmail: string | null = null;

vi.mock("@/lib/sharing/identity/session-key", () => ({
  getSessionIdentity: () => mockIdentity,
}));
vi.mock("./current-email", () => ({
  getCollabSignerEmail: () => mockEmail,
}));

import {
  pushInvite,
  listInvites,
  dismissInvite,
  inboxAddress,
} from "./inbox";

function verify(sigHex: string, message: string, pubkeyHex: string): boolean {
  return ed25519.verify(
    hexToBytes(sigHex),
    new TextEncoder().encode(message),
    hexToBytes(pubkeyHex),
  );
}

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

let captured: CapturedRequest | null = null;

function stubFetch(responseBody: unknown, ok = true) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: unknown) => {
    const i = init as { body?: string };
    captured = {
      url: String(url),
      body: i?.body ? JSON.parse(i.body) : {},
    };
    return {
      ok,
      json: async () => responseBody,
    } as Response;
  }) as unknown as typeof fetch;
}

describe("collab inbox client", () => {
  const keys = generateIdentityKeys();
  const myEmail = "Me@Lab.edu";
  const myCanonical = "me@lab.edu";
  const myPubkey = encodePublicKey(keys.signing.publicKey);

  beforeEach(() => {
    mockIdentity = { keys };
    mockEmail = myEmail;
    captured = null;
  });

  it("inboxAddress hashes the canonical email under the public salt", () => {
    expect(inboxAddress(myCanonical)).toBe(
      hashEmail(myCanonical, COLLAB_INBOX_ADDRESS_SALT),
    );
  });

  it("pushInvite signs a body the inbox DO would accept", async () => {
    stubFetch({ ok: true });
    const recipientKeys = generateIdentityKeys();
    const recipientPubkey = encodePublicKey(recipientKeys.signing.publicKey);
    const recipientEmailHash = hashEmail(
      "out@other.org",
      COLLAB_INBOX_ADDRESS_SALT,
    );

    const result = await pushInvite({
      recipientEmail: "Out@Other.org",
      recipientPubkey,
      collabDocId: "doc-123",
      sessionId: "sess-456",
      title: "PCR setup",
      kind: "note",
    });

    expect(result.ok).toBe(true);
    expect(captured).not.toBeNull();
    const b = captured!.body as {
      from: { email: string; pubkey: string };
      recipientEmailHash: string;
      recipientPubkey: string;
      invite: { collabDocId: string; sessionId: string; title?: string; kind?: string };
      issuedAt: number;
      signature: string;
    };
    // Addressed to the recipient inbox.
    expect(captured!.url).toContain(
      `to=${encodeURIComponent(recipientEmailHash)}`,
    );
    expect(b.recipientEmailHash).toBe(recipientEmailHash);
    expect(b.recipientPubkey).toBe(recipientPubkey);
    expect(b.from.email).toBe(myCanonical);
    expect(b.from.pubkey).toBe(myPubkey);

    // Canonical signed message, signed under the SENDER (from) key.
    const message = `inbox-push\n${b.recipientEmailHash}\n${b.recipientPubkey}\n${b.from.email}\n${b.invite.collabDocId}\n${b.invite.sessionId}\n${b.invite.title ?? ""}\n${b.invite.kind ?? ""}\n${b.issuedAt}`;
    expect(verify(b.signature, message, b.from.pubkey)).toBe(true);
  });

  it("listInvites signs a recipient request the DO would accept", async () => {
    stubFetch({ invites: [{ collabDocId: "d1", sessionId: "s1" }] });
    const rows = await listInvites();
    expect(rows).toHaveLength(1);

    const myHash = hashEmail(myCanonical, COLLAB_INBOX_ADDRESS_SALT);
    expect(captured!.url).toContain(`owner=${encodeURIComponent(myHash)}`);
    const b = captured!.body as {
      email: string;
      pubkey: string;
      issuedAt: number;
      signature: string;
    };
    expect(b.email).toBe(myCanonical);
    expect(b.pubkey).toBe(myPubkey);
    const message = `inbox-list\n${myHash}\n${b.issuedAt}`;
    expect(verify(b.signature, message, b.pubkey)).toBe(true);
  });

  it("dismissInvite signs a recipient request the DO would accept", async () => {
    stubFetch({ ok: true });
    const ok = await dismissInvite("doc-789");
    expect(ok).toBe(true);

    const myHash = hashEmail(myCanonical, COLLAB_INBOX_ADDRESS_SALT);
    const b = captured!.body as {
      email: string;
      pubkey: string;
      collabDocId: string;
      issuedAt: number;
      signature: string;
    };
    expect(b.collabDocId).toBe("doc-789");
    const message = `inbox-dismiss\n${myHash}\n${b.collabDocId}\n${b.issuedAt}`;
    expect(verify(b.signature, message, b.pubkey)).toBe(true);
  });

  it("returns an empty list / no-op without a device identity", async () => {
    mockIdentity = null;
    mockEmail = null;
    stubFetch({ invites: [] });
    expect(await listInvites()).toEqual([]);
    expect(await dismissInvite("x")).toBe(false);
    const push = await pushInvite({
      recipientEmail: "a@b.c",
      recipientPubkey: "00",
      collabDocId: "d",
      sessionId: "s",
      title: "t",
      kind: "note",
    });
    expect(push).toEqual({ ok: false, reason: "no-identity" });
  });
});
