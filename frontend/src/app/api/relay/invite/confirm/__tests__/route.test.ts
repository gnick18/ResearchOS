// Cross-boundary sharing, relay INVITE confirm route (P1-A regression guard).
//
// Pins the security-bearing behavior of the keyless-email change: the route no
// longer accepts an acceptUrl from the body (and never the one-time key), it
// BUILDS a keyless `${origin}/accept/<inviteId>` link from the verified inviteId
// and hands only that to the mailer. So no path exists where the one-time key
// reaches the server or Resend. Every dependency is mocked, the test exercises
// the route's branching and the link it composes, not Neon / R2 / Resend.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks. Defined before the route import so the route binds the mocks. -----

const guardState = { enabled: true };
vi.mock("@/lib/sharing/directory/guard", () => ({
  isSharingEnabled: () => guardState.enabled,
  extractClientIp: () => "1.2.3.4",
  getPepper: () => "pepper",
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
}));

vi.mock("@/lib/sharing/directory/ratelimit", () => ({
  getRelayIpBackstopLimiter: () => ({ limit: async () => ({ success: true }) }),
  getRelayIdentityLimiter: () => ({ limit: async () => ({ success: true }) }),
}));

const verifyState = {
  result: {
    emailHash: "sender-hash",
    parsed: { inviteId: "invite-xyz" },
  } as unknown | null,
};
vi.mock("@/lib/sharing/relay/auth", () => ({
  verifyRelayRequest: async () => verifyState.result,
}));

const dbState = {
  flipped: {
    inviteId: "invite-xyz",
    recipientEmailHash: "recip-hash",
    senderEmailHash: "sender-hash",
    sizeBytes: 1024,
    createdAt: "2026-06-08T00:00:00.000Z",
    expiresAt: "2026-07-08T00:00:00.000Z",
  } as unknown | null,
  pendingBytes: 1024,
};
const deleteInviteEntrySpy = vi.fn(async (_id: string) => {});
const updateInviteSizeSpy = vi.fn(async (_id: string, _size: number) => {});
vi.mock("@/lib/sharing/relay/db", () => ({
  ensureInviteSchema: async () => {},
  markInviteReady: async () => dbState.flipped,
  deleteInviteEntry: (id: string) => deleteInviteEntrySpy(id),
  updateInviteSize: (id: string, size: number) => updateInviteSizeSpy(id, size),
  sumPendingInviteBytesByRecipient: async () => dbState.pendingBytes,
}));

const storageState = { headSize: 1024 as number | null };
const deleteObjectSpy = vi.fn(async (_id: string) => {});
vi.mock("@/lib/sharing/relay/storage", () => ({
  headObjectSize: async () => storageState.headSize,
  deleteObject: (id: string) => deleteObjectSpy(id),
}));

const sendInviteEmailSpy = vi.fn(async (_params: Record<string, unknown>) => {});
vi.mock("@/lib/sharing/relay/mailer", () => ({
  sendInviteEmail: (params: Record<string, unknown>) =>
    sendInviteEmailSpy(params),
}));

import { POST } from "../route";

/** A confirm request body. The delivery fields are present, acceptUrl is NOT (the
 *  client no longer sends it). Override to simulate a malicious/legacy client. */
function makeRequest(extra: Record<string, unknown> = {}): Request {
  return new Request("https://app.example/api/relay/invite/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "invite-confirm",
      recipientEmail: "newperson@example.com",
      senderLabel: "alice@lab.edu",
      itemTitle: "PCR optimization run 7",
      ...extra,
    }),
  });
}

beforeEach(() => {
  guardState.enabled = true;
  verifyState.result = {
    emailHash: "sender-hash",
    parsed: { inviteId: "invite-xyz" },
  };
  dbState.flipped = {
    inviteId: "invite-xyz",
    recipientEmailHash: "recip-hash",
    senderEmailHash: "sender-hash",
    sizeBytes: 1024,
    createdAt: "2026-06-08T00:00:00.000Z",
    expiresAt: "2026-07-08T00:00:00.000Z",
  };
  dbState.pendingBytes = 1024;
  storageState.headSize = 1024;
  deleteInviteEntrySpy.mockClear();
  updateInviteSizeSpy.mockClear();
  deleteObjectSpy.mockClear();
  sendInviteEmailSpy.mockClear();
  delete process.env.NEXT_PUBLIC_APP_ORIGIN;
});

describe("relay invite confirm route, keyless email link (P1-A)", () => {
  it("confirms WITHOUT an acceptUrl in the body and emails a keyless link", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(sendInviteEmailSpy).toHaveBeenCalledTimes(1);
    const params = sendInviteEmailSpy.mock.calls[0][0];
    // The link is built from the inviteId, points at the keyless landing, and
    // carries NO one-time key / fragment.
    expect(params.acceptUrl).toBe(
      "https://research-os.app/accept/invite-xyz",
    );
    expect(String(params.acceptUrl)).not.toContain("#k=");
    expect(String(params.acceptUrl)).not.toContain("#");
  });

  it("IGNORES an acceptUrl a malicious client tries to inject", async () => {
    // A legacy or hostile client posts a key-bearing acceptUrl. The route must
    // not use it, it always builds its own keyless link from the inviteId.
    const res = await POST(
      makeRequest({
        acceptUrl:
          "https://evil.example/accept/invite-xyz#k=" + "a".repeat(64),
      }),
    );
    expect(res.status).toBe(200);
    const params = sendInviteEmailSpy.mock.calls[0][0];
    expect(params.acceptUrl).toBe(
      "https://research-os.app/accept/invite-xyz",
    );
    expect(String(params.acceptUrl)).not.toContain("evil.example");
    expect(String(params.acceptUrl)).not.toContain("#k=");
  });

  it("honors NEXT_PUBLIC_APP_ORIGIN for the keyless link origin", async () => {
    process.env.NEXT_PUBLIC_APP_ORIGIN = "https://staging.research-os.app/";
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const params = sendInviteEmailSpy.mock.calls[0][0];
    expect(params.acceptUrl).toBe(
      "https://staging.research-os.app/accept/invite-xyz",
    );
  });

  it("still requires the delivery fields (recipient, sender, title)", async () => {
    const res = await POST(
      new Request("https://app.example/api/relay/invite/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "invite-confirm" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(sendInviteEmailSpy).not.toHaveBeenCalled();
  });

  it("does not email when no object was uploaded for the invite", async () => {
    storageState.headSize = null; // R2 HEAD found nothing
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(deleteInviteEntrySpy).toHaveBeenCalledTimes(1);
    expect(sendInviteEmailSpy).not.toHaveBeenCalled();
  });
});
