// Tests for the ownerKey-direct path added to POST /api/admin/grants.
//
// Pins:
//   - ownerKey provided directly bypasses email->ownerKey resolution.
//   - giftTier without months is still a 400 (decision 3 holds for both paths).
//   - email + ownerKey together is a 400 (conflict guard).
//   - email path (original flow) still works unchanged.
//   - no-identity (neither email nor ownerKey) is a 400.
//
// No live Neon, no operator-auth check (operator gate is mocked to pass).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Operator gate: always pass in these tests. The gate's behavior on a real
// non-operator email is tested at the /admin/accounts level; here we care only
// about the POST body logic.
vi.mock("@/lib/sharing/operator-access", () => ({
  requireOperator: async () => null,
}));

// json() helper used by the route.
vi.mock("@/lib/sharing/directory/guard", () => ({
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
}));

// ownerKeyForEmail: deterministic, no crypto needed.
vi.mock("@/lib/billing/owner", () => ({
  ownerKeyForEmail: (email: string) => `owner:${email}`,
}));

// issueGrant: capture the params it was called with so we can assert them.
const issueMock = vi.fn(async (..._args: unknown[]) => 42);
vi.mock("@/lib/billing/grants", () => ({
  ensureGrantsSchema: async () => undefined,
  issueGrant: (...args: unknown[]) => issueMock(...args),
  listGrants: async () => [],
  revokeGrant: async () => undefined,
}));

// BYTES_PER_GB: keep the route's arithmetic deterministic.
vi.mock("@/lib/billing/config", () => ({
  BYTES_PER_GB: 1_073_741_824,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePost(body: unknown): Request {
  return new Request("http://localhost/api/admin/grants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("../route");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  issueMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/grants with ownerKey direct path", () => {
  it("accepts ownerKey directly, skips email resolution, issues the grant", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makePost({
        ownerKey: "ok:abc123",
        giftTier: "lab",
        months: 6,
        bonusGb: 0,
        bonusWritesMillions: 0,
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; id: number };
    expect(json.ok).toBe(true);
    expect(issueMock).toHaveBeenCalledOnce();
    const params = issueMock.mock.calls[0]![0] as { ownerKey: string; giftTier: string };
    // Must use the passed ownerKey directly, never run it through ownerKeyForEmail.
    expect(params.ownerKey).toBe("ok:abc123");
    expect(params.giftTier).toBe("lab");
  });

  it("enforces tier-requires-months even on the ownerKey path (decision 3)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makePost({
        ownerKey: "ok:abc123",
        giftTier: "lab",
        // months deliberately omitted
        bonusGb: 0,
        bonusWritesMillions: 0,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/month/i);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("rejects a request that provides both email and ownerKey", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makePost({
        email: "pi@lab.edu",
        ownerKey: "ok:abc123",
        giftTier: "solo",
        months: 3,
        bonusGb: 0,
        bonusWritesMillions: 0,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/not both/i);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("rejects a request with neither email nor ownerKey", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makePost({
        giftTier: "solo",
        months: 3,
        bonusGb: 0,
        bonusWritesMillions: 0,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/required/i);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("original email path still works unchanged", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makePost({
        email: "pi@lab.edu",
        giftTier: "solo",
        months: 12,
        bonusGb: 0,
        bonusWritesMillions: 0,
      }),
    );
    expect(res.status).toBe(200);
    expect(issueMock).toHaveBeenCalledOnce();
    const params = issueMock.mock.calls[0]![0] as { ownerKey: string; label: string };
    // Email path hashes the email to an ownerKey via ownerKeyForEmail mock.
    expect(params.ownerKey).toBe("owner:pi@lab.edu");
    expect(params.label).toBe("pi@lab.edu");
  });
});
