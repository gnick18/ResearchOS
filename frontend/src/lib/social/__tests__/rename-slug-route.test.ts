// Tests for POST /api/social/lab-site/rename-slug (Phase PI-slug-rename).
//
// Mirrors the pattern in lab-site-route.test.ts: mock all IO before importing
// the route handler, then call POST() directly. .test.ts (not .test.tsx) per
// the worktree preamble.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (registered before any dynamic import of the route)
// ---------------------------------------------------------------------------

const isLabSitesEnabled = vi.fn();
const resolveCallerOwnerKey = vi.fn();
const isLabPublishEntitled = vi.fn();
const rebindLabSlug = vi.fn();
const loadTakenSlugsWithPrefix = vi.fn();

vi.mock("@/lib/social/config", () => ({
  isLabSitesEnabled: () => isLabSitesEnabled(),
}));
vi.mock("@/lib/social/lab-site-session", () => ({
  resolveCallerOwnerKey: () => resolveCallerOwnerKey(),
}));
vi.mock("@/lib/billing/db", () => ({
  isLabPublishEntitled: (k: string) => isLabPublishEntitled(k),
}));
vi.mock("@/lib/social/lab-site-db", () => ({
  rebindLabSlug: (args: unknown) => rebindLabSlug(args),
}));
vi.mock("@/lib/social/slug-registry-db", () => ({
  loadTakenSlugsWithPrefix: (s: string) => loadTakenSlugsWithPrefix(s),
}));

// ---------------------------------------------------------------------------
// Import the route handler after mocks are in place
// ---------------------------------------------------------------------------

import { POST } from "@/app/api/social/lab-site/rename-slug/route";

// ---------------------------------------------------------------------------
// Helper: build a minimal Request with a JSON body
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/social/lab-site/rename-slug", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/social/lab-site/rename-slug", () => {
  beforeEach(() => {
    isLabSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    // Default: new slug is available and rebind succeeds.
    loadTakenSlugsWithPrefix.mockResolvedValue(new Set<string>());
    rebindLabSlug.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("404s when the flag is off", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(404);
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(401);
  });

  it("403s when the caller is not entitled", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(403);
  });

  it("400s when newSlug is missing", async () => {
    const res = await POST(makeRequest({ oldSlug: "oldslug" }));
    expect(res.status).toBe(400);
  });

  it("400s when oldSlug is missing", async () => {
    const res = await POST(makeRequest({ newSlug: "newslug" }));
    expect(res.status).toBe(400);
  });

  it("409s when the new slug is already taken (pre-flight check)", async () => {
    loadTakenSlugsWithPrefix.mockResolvedValue(new Set(["newslug"]));
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("slug taken");
  });

  it("409s when rebindLabSlug returns taken (lost race after pre-flight)", async () => {
    rebindLabSlug.mockResolvedValue({ ok: false, reason: "taken" });
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(409);
  });

  it("403s when rebindLabSlug returns not-owner", async () => {
    rebindLabSlug.mockResolvedValue({ ok: false, reason: "not-owner" });
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(403);
  });

  it("404s when rebindLabSlug returns not-found", async () => {
    rebindLabSlug.mockResolvedValue({ ok: false, reason: "not-found" });
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(404);
  });

  it("400s when rebindLabSlug returns invalid", async () => {
    rebindLabSlug.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(400);
  });

  it("200s with {ok:true, slug} on a successful rename", async () => {
    rebindLabSlug.mockResolvedValue({ ok: true });
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; slug: string };
    expect(data.ok).toBe(true);
    expect(data.slug).toBe("newslug");
  });

  it("503s when the store throws", async () => {
    rebindLabSlug.mockRejectedValue(new Error("neon down"));
    const res = await POST(makeRequest({ oldSlug: "oldslug", newSlug: "newslug" }));
    expect(res.status).toBe(503);
  });
});
