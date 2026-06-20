// Tests for POST /api/admin/lab-provision/stage.
//
// Pins:
//   - operator gate blocks a non-operator (the gate Response short-circuits).
//   - a slug already taken by SOMEONE ELSE returns 409 and issues NO grant.
//   - the happy path computes the email hash, reserves the slug, issues the
//     comped-tier grant on that hash, and upserts the staging.
//   - validation rejects a missing email / labName / slug / tier / months.
//
// No live Neon, no operator-auth check (the gate is mocked per test).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Operator gate: a function we can flip per test (null = pass, Response = block).
let gateResult: Response | null = null;
vi.mock("@/lib/sharing/operator-access", () => ({
  requireOperator: async () => gateResult,
}));

// json() + isSharingEnabled() from the directory guard.
vi.mock("@/lib/sharing/directory/guard", () => ({
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  isSharingEnabled: () => true,
}));

// ownerKeyForEmail: deterministic, no crypto.
vi.mock("@/lib/billing/owner", () => ({
  ownerKeyForEmail: (email: string) => `hash:${email}`,
}));

// issueGrant: capture the call args.
const issueMock = vi.fn(async (..._args: unknown[]) => 7);
vi.mock("@/lib/billing/grants", () => ({
  ensureGrantsSchema: async () => undefined,
  issueGrant: (...args: unknown[]) => issueMock(...args),
}));

// reserveSlug + getSlug from the registry. reserveSlug result is flipped per test;
// getSlug feeds the "taken but mine" re-stage branch.
let reserveResult: unknown = { ok: true, row: {} };
let getSlugResult: unknown = null;
const reserveMock = vi.fn(async (..._args: unknown[]) => reserveResult);
const getSlugMock = vi.fn(async (..._args: unknown[]) => getSlugResult);
vi.mock("@/lib/social/slug-registry-db", () => ({
  reserveSlug: (...args: unknown[]) => reserveMock(...args),
  getSlug: (...args: unknown[]) => getSlugMock(...args),
}));

// The staging upsert: capture the row.
const upsertMock = vi.fn(async (..._args: unknown[]) => null);
vi.mock("@/lib/lab/provision-staging-db", () => ({
  upsertProvisionStaging: (...args: unknown[]) => upsertMock(...args),
}));

function makePost(body: unknown): Request {
  return new Request("http://localhost/api/admin/lab-provision/stage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("../route");
}

const VALID = {
  email: "pi@university.edu",
  labName: "Nickles Lab",
  institution: "UW-Madison",
  slug: "nickles-lab",
  compTier: "lab",
  compMonths: 12,
};

beforeEach(() => {
  gateResult = null;
  reserveResult = { ok: true, row: {} };
  getSlugResult = null;
  issueMock.mockClear();
  reserveMock.mockClear();
  getSlugMock.mockClear();
  upsertMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/lab-provision/stage", () => {
  it("blocks a non-operator via the gate Response", async () => {
    gateResult = new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
    });
    const { POST } = await loadRoute();
    const res = await POST(makePost(VALID));
    expect(res.status).toBe(404);
    expect(reserveMock).not.toHaveBeenCalled();
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("happy path: reserves the slug, issues the comped grant, upserts staging", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost(VALID));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);

    // Slug reserved to the email hash.
    expect(reserveMock).toHaveBeenCalledOnce();
    expect(reserveMock.mock.calls[0]).toEqual([
      "nickles-lab",
      "lab",
      "hash:pi@university.edu",
      "hash:pi@university.edu",
    ]);

    // Grant issued on the hash with the comped tier + an expiry (no permanent comp).
    expect(issueMock).toHaveBeenCalledOnce();
    const grant = issueMock.mock.calls[0]![0] as {
      ownerKey: string;
      giftTier: string;
      expiresAt: string | null;
      label: string;
    };
    expect(grant.ownerKey).toBe("hash:pi@university.edu");
    expect(grant.giftTier).toBe("lab");
    expect(grant.label).toBe("pi@university.edu");
    expect(grant.expiresAt).toBeTruthy();

    // Staging upserted with the same hash + metadata.
    expect(upsertMock).toHaveBeenCalledOnce();
    const staged = upsertMock.mock.calls[0]![0] as {
      piEmailHash: string;
      slug: string;
      compTier: string;
      compMonths: number;
    };
    expect(staged.piEmailHash).toBe("hash:pi@university.edu");
    expect(staged.slug).toBe("nickles-lab");
    expect(staged.compTier).toBe("lab");
    expect(staged.compMonths).toBe(12);
  });

  it("returns 409 and issues NO grant when the slug is taken by someone else", async () => {
    reserveResult = { ok: false, reason: "taken" };
    getSlugResult = { ownerKey: "hash:someone-else" }; // a different owner
    const { POST } = await loadRoute();
    const res = await POST(makePost(VALID));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/taken/i);
    // Critical: no grant is issued when the slug reserve loses to another owner.
    expect(issueMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("allows a re-stage when the slug is already reserved to the SAME PI", async () => {
    reserveResult = { ok: false, reason: "taken" };
    getSlugResult = { ownerKey: "hash:pi@university.edu" }; // already ours
    const { POST } = await loadRoute();
    const res = await POST(makePost(VALID));
    expect(res.status).toBe(200);
    // The grant + staging still run on a re-stage of the PI's own slug.
    expect(issueMock).toHaveBeenCalledOnce();
    expect(upsertMock).toHaveBeenCalledOnce();
  });

  it("rejects a missing email / labName / slug / tier / months", async () => {
    const { POST } = await loadRoute();

    const noEmail = await POST(makePost({ ...VALID, email: "" }));
    expect(noEmail.status).toBe(400);

    const noName = await POST(makePost({ ...VALID, labName: "" }));
    expect(noName.status).toBe(400);

    const noSlug = await POST(makePost({ ...VALID, slug: "" }));
    expect(noSlug.status).toBe(400);

    const badTier = await POST(makePost({ ...VALID, compTier: "enterprise" }));
    expect(badTier.status).toBe(400);

    const noMonths = await POST(makePost({ ...VALID, compMonths: 0 }));
    expect(noMonths.status).toBe(400);

    // None of the rejected requests issued a grant.
    expect(issueMock).not.toHaveBeenCalled();
  });
});
