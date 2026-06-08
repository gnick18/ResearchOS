// Cross-boundary sharing, relay confirm route, authoritative size reconcile.
//
// Pins the P1-B backstop the confirm route runs after flipping a row ready, it
// reads the TRUE object size from R2 (headObjectSize), corrects the stored size,
// and re-enforces the per-recipient byte budget against that real figure, rolling
// the share back (object + row) if the real upload still pushed the recipient over
// budget or if no object was ever uploaded. Every dependency is mocked so no Neon,
// no R2, no rate limiter, no crypto runs, the test exercises the route's branching
// only.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FREE_STORAGE_BYTES } from "@/lib/sharing/relay/limits";

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
    binding: {},
    parsed: {
      action: "confirm",
      email: "sender@example.com",
      issuedAt: "2026-06-03T00:00:00.000Z",
      signature: "00",
      bundleId: "b1",
    },
  } as unknown | null,
};
vi.mock("@/lib/sharing/relay/auth", () => ({
  verifyRelayRequest: async () => verifyState.result,
}));

const dbState = {
  flip: true as boolean,
  row: { recipientEmailHash: "rh", sizeBytes: 100 } as Record<
    string,
    unknown
  > | null,
  sum: 0,
};
const markReadySpy = vi.fn(async () => dbState.flip);
const updateSizeSpy = vi.fn(async (_id: string, _n: number) => {});
const deleteRowSpy = vi.fn(async (_id: string) => {});
vi.mock("@/lib/sharing/relay/db", () => ({
  ensureRelaySchema: async () => {},
  markInboxEntryReady: () => markReadySpy(),
  getInboxEntry: async () => dbState.row,
  updateInboxSize: (id: string, n: number) => updateSizeSpy(id, n),
  sumPendingBytesByRecipient: async () => dbState.sum,
  deleteInboxEntry: (id: string) => deleteRowSpy(id),
}));

const storageState = { head: 100 as number | null, headThrows: false };
const deleteObjectSpy = vi.fn(async (_id: string) => {});
vi.mock("@/lib/sharing/relay/storage", () => ({
  headObjectSize: async () => {
    if (storageState.headThrows) throw new Error("R2 unavailable");
    return storageState.head;
  },
  deleteObject: (id: string) => deleteObjectSpy(id),
}));

import { POST } from "../route";

function makeRequest(): Request {
  return new Request("https://app.example/api/relay/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "confirm" }),
  });
}

beforeEach(() => {
  guardState.enabled = true;
  dbState.flip = true;
  dbState.row = { recipientEmailHash: "rh", sizeBytes: 100 };
  dbState.sum = 100;
  storageState.head = 100;
  storageState.headThrows = false;
  markReadySpy.mockClear();
  updateSizeSpy.mockClear();
  deleteRowSpy.mockClear();
  deleteObjectSpy.mockClear();
});

describe("relay confirm route, size reconcile", () => {
  it("corrects the stored size to the true R2 size on the happy path", async () => {
    storageState.head = 4096;
    dbState.sum = 4096; // under budget
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(updateSizeSpy).toHaveBeenCalledWith("b1", 4096);
    expect(deleteObjectSpy).not.toHaveBeenCalled();
    expect(deleteRowSpy).not.toHaveBeenCalled();
  });

  it("rolls back object and row when the true size pushes the recipient over budget", async () => {
    // The size-bound presign should prevent this, but if the real upload still
    // exceeded the budget (presign bypass / race) the confirm must undo it.
    storageState.head = FREE_STORAGE_BYTES;
    dbState.sum = FREE_STORAGE_BYTES + 1;
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);
    expect(deleteObjectSpy).toHaveBeenCalledWith("b1");
    expect(deleteRowSpy).toHaveBeenCalledWith("b1");
  });

  it("drops the row and fails when no object was ever uploaded", async () => {
    storageState.head = null; // HEAD 404
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(deleteRowSpy).toHaveBeenCalledWith("b1");
    expect(updateSizeSpy).not.toHaveBeenCalled();
  });

  it("keeps the confirmed share as-is when the R2 HEAD transiently fails", async () => {
    storageState.headThrows = true;
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(updateSizeSpy).not.toHaveBeenCalled();
    expect(deleteRowSpy).not.toHaveBeenCalled();
    expect(deleteObjectSpy).not.toHaveBeenCalled();
  });

  it("fails generically without reconciling when the flip does not match", async () => {
    dbState.flip = false;
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(updateSizeSpy).not.toHaveBeenCalled();
    expect(deleteRowSpy).not.toHaveBeenCalled();
  });
});
