// Tests for GET /api/directory/labs/provision/pending.
//
// Pins:
//   - unauthenticated (no session email) -> 401.
//   - returns pending:null when no staging exists.
//   - returns pending:null when the staging is already consumed.
//   - returns the staged branding (only) for the session's OWN hash.
//   - the lookup is keyed by the SESSION email hash, never a caller-supplied one.
//
// No live Neon; the session, owner-key hash, and staging store are mocked.
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

const ownerKeyMock = vi.fn((email: string) => `hash:${email}`);
vi.mock("@/lib/billing/owner", () => ({
  ownerKeyForEmail: (email: string) => ownerKeyMock(email),
}));

let stagingResult: unknown = null;
const getStagingMock = vi.fn(async (..._args: unknown[]) => stagingResult);
vi.mock("@/lib/lab/provision-staging-db", () => ({
  getProvisionStaging: (...args: unknown[]) => getStagingMock(...args),
}));

function makeGet(): Request {
  return new Request("http://localhost/api/directory/labs/provision/pending");
}

async function loadRoute() {
  vi.resetModules();
  return await import("../route");
}

beforeEach(() => {
  sessionEmail = "pi@university.edu";
  stagingResult = null;
  ownerKeyMock.mockClear();
  getStagingMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/directory/labs/provision/pending", () => {
  it("returns 401 when there is no session email", async () => {
    sessionEmail = null;
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getStagingMock).not.toHaveBeenCalled();
  });

  it("returns pending:null when no staging exists", async () => {
    stagingResult = null;
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { pending: unknown };
    expect(json.pending).toBeNull();
  });

  it("returns pending:null when the staging is already consumed", async () => {
    stagingResult = {
      status: "consumed",
      labName: "Nickles Lab",
      institution: null,
      slug: "nickles-lab",
      piTitle: null,
      piDisplay: null,
    };
    const { GET } = await loadRoute();
    const res = await GET();
    const json = (await res.json()) as { pending: unknown };
    expect(json.pending).toBeNull();
  });

  it("returns the staged branding for the session's own hash, keyed by session email", async () => {
    stagingResult = {
      status: "pending",
      labName: "Nickles Lab",
      institution: "UW-Madison",
      slug: "nickles-lab",
      piTitle: "Dr.",
      piDisplay: "Grant Nickles",
      // fields the route must NOT leak:
      compTier: "lab",
      compMonths: 12,
      piEmailHash: "hash:pi@university.edu",
    };
    const { GET } = await loadRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      pending: Record<string, unknown> | null;
    };
    expect(json.pending).toEqual({
      labName: "Nickles Lab",
      institution: "UW-Madison",
      slug: "nickles-lab",
      piTitle: "Dr.",
      piDisplay: "Grant Nickles",
    });
    // The comp tier / months / hash are never surfaced to the client.
    expect(json.pending).not.toHaveProperty("compTier");
    expect(json.pending).not.toHaveProperty("piEmailHash");

    // The lookup used the SESSION email hash, not anything from the request.
    expect(ownerKeyMock).toHaveBeenCalledWith("pi@university.edu");
    expect(getStagingMock).toHaveBeenCalledWith("hash:pi@university.edu");
  });
});
