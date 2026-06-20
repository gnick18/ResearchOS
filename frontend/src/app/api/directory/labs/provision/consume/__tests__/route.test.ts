// Tests for POST /api/directory/labs/provision/consume.
//
// Pins:
//   - unauthenticated (no session email) -> 401.
//   - the directory_labs row's pi_email_hash must match the session hash, else 403.
//   - no pending staging -> 409.
//   - happy path binds the slug (createSite), flips listed=true, marks consumed,
//     and returns the slug.
//
// No live Neon; the session, owner-key hash, directory db, lab-site db, and the
// staging store are all mocked.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sessionEmail: string | null = "pi@university.edu";
vi.mock("@/lib/sharing/auth", () => ({
  auth: async () =>
    sessionEmail ? { user: { email: sessionEmail } } : null,
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

// Directory db: the listing lookup + the listed flip.
let listingResult: unknown = { piEmailHash: "hash:pi@university.edu" };
const setListedMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/sharing/directory/db", () => ({
  ensureSchema: async () => undefined,
  ensureLabsSchema: async () => undefined,
  getLabListing: async () => listingResult,
  setLabListed: (...args: unknown[]) => setListedMock(...args),
}));

// Lab-site db: the slug bind.
const createSiteMock = vi.fn(async (..._args: unknown[]) => ({
  labSlug: "nickles-lab",
}));
vi.mock("@/lib/social/lab-site-db", () => ({
  createSite: (...args: unknown[]) => createSiteMock(...args),
}));

// Staging store: the pending lookup + the consume mark.
let stagingResult: unknown = {
  status: "pending",
  slug: "nickles-lab",
};
const markConsumedMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/lab/provision-staging-db", () => ({
  getProvisionStaging: async () => stagingResult,
  markProvisionConsumed: (...args: unknown[]) => markConsumedMock(...args),
}));

function makePost(body: unknown): Request {
  return new Request("http://localhost/api/directory/labs/provision/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("../route");
}

beforeEach(() => {
  sessionEmail = "pi@university.edu";
  listingResult = { piEmailHash: "hash:pi@university.edu" };
  stagingResult = { status: "pending", slug: "nickles-lab" };
  setListedMock.mockClear();
  createSiteMock.mockClear();
  markConsumedMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/directory/labs/provision/consume", () => {
  it("returns 401 when there is no session email", async () => {
    sessionEmail = null;
    const { POST } = await loadRoute();
    const res = await POST(makePost({ labId: "lab-1" }));
    expect(res.status).toBe(401);
    expect(createSiteMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the lab's pi_email_hash does not match the session hash", async () => {
    listingResult = { piEmailHash: "hash:someone-else" };
    const { POST } = await loadRoute();
    const res = await POST(makePost({ labId: "lab-1" }));
    expect(res.status).toBe(403);
    expect(createSiteMock).not.toHaveBeenCalled();
    expect(markConsumedMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the directory row is missing", async () => {
    listingResult = null;
    const { POST } = await loadRoute();
    const res = await POST(makePost({ labId: "lab-1" }));
    expect(res.status).toBe(404);
  });

  it("returns 409 when there is no pending staging", async () => {
    stagingResult = null;
    const { POST } = await loadRoute();
    const res = await POST(makePost({ labId: "lab-1" }));
    expect(res.status).toBe(409);
    expect(createSiteMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the staging is already consumed", async () => {
    stagingResult = { status: "consumed", slug: "nickles-lab" };
    const { POST } = await loadRoute();
    const res = await POST(makePost({ labId: "lab-1" }));
    expect(res.status).toBe(409);
  });

  it("happy path: binds the slug, flips listed, marks consumed, returns slug", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({ labId: "lab-1" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; slug: string };
    expect(json.ok).toBe(true);
    expect(json.slug).toBe("nickles-lab");

    // Slug bound to the PI hash (lab_sites keyed by owner key).
    expect(createSiteMock).toHaveBeenCalledOnce();
    expect(createSiteMock.mock.calls[0]).toEqual([
      "hash:pi@university.edu",
      "nickles-lab",
    ]);
    // Listing flipped visible.
    expect(setListedMock).toHaveBeenCalledWith("lab-1", true);
    // Staging consumed so a second sign-in is a no-op.
    expect(markConsumedMock).toHaveBeenCalledWith("hash:pi@university.edu");
  });

  it("returns 400 on a missing labId", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePost({}));
    expect(res.status).toBe(400);
  });
});
