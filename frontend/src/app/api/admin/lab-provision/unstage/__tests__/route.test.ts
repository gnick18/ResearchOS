// Tests for POST /api/admin/lab-provision/unstage.
//
// Pins:
//   - operator gate blocks a non-operator.
//   - missing identifier (no email, no piEmailHash) is a 400.
//   - no staging row is a 404.
//   - a CONSUMED staging is a 409 and deletes NOTHING (the core safety rule).
//   - a slug bound to a live lab is a 409 and deletes NOTHING.
//   - the happy path releases the slug, revokes the grant, deletes the staging,
//     and returns the released slug + revoked count.
//
// No live Neon, no operator auth (mocked per test).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

let gateResult: Response | null = null;
vi.mock("@/lib/sharing/operator-access", () => ({
  requireOperator: async () => gateResult,
}));

vi.mock("@/lib/sharing/directory/guard", () => ({
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  isSharingEnabled: () => true,
}));

vi.mock("@/lib/billing/owner", () => ({
  ownerKeyForEmail: (email: string) => `hash:${email}`,
}));

let stagingResult: unknown = null;
const getStagingMock = vi.fn(async (..._a: unknown[]) => stagingResult);
const deleteStagingMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/lab/provision-staging-db", () => ({
  getProvisionStaging: (...a: unknown[]) => getStagingMock(...a),
  deleteProvisionStaging: (...a: unknown[]) => deleteStagingMock(...a),
}));

let releaseResult: unknown = { ok: true };
const releaseMock = vi.fn(async (..._a: unknown[]) => releaseResult);
vi.mock("@/lib/social/slug-registry-db", () => ({
  releaseReservedSlug: (...a: unknown[]) => releaseMock(...a),
}));

const revokeMock = vi.fn(async (..._a: unknown[]) => 1);
vi.mock("@/lib/billing/grants", () => ({
  ensureGrantsSchema: async () => undefined,
  revokeStagedGrant: (...a: unknown[]) => revokeMock(...a),
}));

const { POST } = await import("../route");

function req(body: unknown): Request {
  return new Request("http://t/api/admin/lab-provision/unstage", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  gateResult = null;
  stagingResult = null;
  releaseResult = { ok: true };
  getStagingMock.mockClear();
  deleteStagingMock.mockClear();
  releaseMock.mockClear();
  revokeMock.mockClear();
});

describe("POST /api/admin/lab-provision/unstage", () => {
  it("blocks a non-operator", async () => {
    gateResult = new Response("nope", { status: 404 });
    const res = await POST(req({ piEmailHash: "h" }));
    expect(res.status).toBe(404);
    expect(getStagingMock).not.toHaveBeenCalled();
  });

  it("400 when neither email nor piEmailHash is given", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(getStagingMock).not.toHaveBeenCalled();
  });

  it("404 when there is no staging row", async () => {
    stagingResult = null;
    const res = await POST(req({ piEmailHash: "h" }));
    expect(res.status).toBe(404);
    expect(deleteStagingMock).not.toHaveBeenCalled();
  });

  it("409 and deletes nothing when the staging is already consumed", async () => {
    stagingResult = { status: "consumed", slug: "fungal-interactions" };
    const res = await POST(req({ piEmailHash: "h" }));
    expect(res.status).toBe(409);
    expect(releaseMock).not.toHaveBeenCalled();
    expect(revokeMock).not.toHaveBeenCalled();
    expect(deleteStagingMock).not.toHaveBeenCalled();
  });

  it("409 and deletes nothing when the slug is bound to a live lab", async () => {
    stagingResult = { status: "pending", slug: "fungal-interactions" };
    releaseResult = { ok: false, reason: "bound" };
    const res = await POST(req({ piEmailHash: "h" }));
    expect(res.status).toBe(409);
    expect(deleteStagingMock).not.toHaveBeenCalled();
  });

  it("happy path releases slug, revokes grant, deletes staging", async () => {
    stagingResult = { status: "pending", slug: "ros-provision-dryrun" };
    releaseResult = { ok: true };
    const res = await POST(req({ piEmailHash: "hash-xyz" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      releasedSlug: string | null;
      revokedGrants: number;
    };
    expect(body.ok).toBe(true);
    expect(body.releasedSlug).toBe("ros-provision-dryrun");
    expect(body.revokedGrants).toBe(1);
    expect(releaseMock).toHaveBeenCalledWith("ros-provision-dryrun", "hash-xyz");
    expect(revokeMock).toHaveBeenCalledWith("hash-xyz");
    expect(deleteStagingMock).toHaveBeenCalledWith("hash-xyz");
  });

  it("resolves a typed email to the owner hash", async () => {
    stagingResult = { status: "pending", slug: "s" };
    releaseResult = { ok: true };
    await POST(req({ email: "pi@uni.edu" }));
    expect(getStagingMock).toHaveBeenCalledWith("hash:pi@uni.edu");
  });
});
