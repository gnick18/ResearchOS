import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks for every IO edge the route touches ----------------------------
const isLabByoSitesEnabled = vi.fn();
const resolveCallerOwnerKey = vi.fn();
const isLabPublishEntitled = vi.fn();
const getSiteByOwner = vi.fn();
const isAssetStoreConfigured = vi.fn();
const deleteByoSite = vi.fn();
const putByoFile = vi.fn();
const upsertByoSite = vi.fn();
const setHostedAssetBytes = vi.fn();
const pullGithubZipball = vi.fn();
const upsertByoGithub = vi.fn();
const getByoGithubByOwner = vi.fn();
const recordByoGithubSync = vi.fn();
const deleteByoGithubRow = vi.fn();

vi.mock("@/lib/social/config", () => ({
  isLabByoSitesEnabled: () => isLabByoSitesEnabled(),
}));
vi.mock("@/lib/social/lab-site-session", () => ({
  resolveCallerOwnerKey: () => resolveCallerOwnerKey(),
}));
vi.mock("@/lib/billing/db", () => ({
  isLabPublishEntitled: (k: string) => isLabPublishEntitled(k),
}));
vi.mock("@/lib/social/lab-site-db", () => ({
  getSiteByOwner: (k: string) => getSiteByOwner(k),
}));
vi.mock("@/lib/social/lab-site-asset-store", () => ({
  isAssetStoreConfigured: () => isAssetStoreConfigured(),
  deleteByoSite: (f: string) => deleteByoSite(f),
  putByoFile: (...a: unknown[]) => putByoFile(...a),
}));
vi.mock("@/lib/collab/server/db", () => ({
  setHostedAssetBytes: (...a: unknown[]) => setHostedAssetBytes(...a),
}));
vi.mock("@/lib/social/lab-byo-db", () => ({
  upsertByoSite: (a: unknown) => upsertByoSite(a),
  upsertByoGithub: (a: unknown) => upsertByoGithub(a),
  getByoGithubByOwner: (k: string) => getByoGithubByOwner(k),
  recordByoGithubSync: (a: unknown) => recordByoGithubSync(a),
  deleteByoGithubRow: (k: string) => deleteByoGithubRow(k),
}));
// Only the network pull is mocked; validateByoEntries + manifest helpers run REAL
// (so a pulled set genuinely runs through validateByoEntries / the zip-slip bar).
vi.mock("@/lib/social/lab-byo-github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/social/lab-byo-github")>();
  return { ...actual, pullGithubZipball: (c: unknown) => pullGithubZipball(c) };
});

import { GET, POST } from "@/app/api/social/lab-site/byo/github/route";

const html = (s: string): Uint8Array => new TextEncoder().encode(s);

function post(body: unknown): Request {
  return new Request("http://x/api/social/lab-site/byo/github", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST byo/github connect + sync (gated, fail-closed)", () => {
  beforeEach(() => {
    isLabByoSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    getSiteByOwner.mockResolvedValue({ labOwnerKey: "owner-1", labSlug: "smithlab" });
    isAssetStoreConfigured.mockReturnValue(true);
    deleteByoSite.mockResolvedValue(true);
    putByoFile.mockResolvedValue(true);
    upsertByoSite.mockResolvedValue({});
    setHostedAssetBytes.mockResolvedValue(undefined);
    upsertByoGithub.mockResolvedValue({});
    recordByoGithubSync.mockResolvedValue(undefined);
    getByoGithubByOwner.mockResolvedValue({
      owner: "smithlab",
      repo: "companion",
      ref: "main",
      subdir: "",
    });
    pullGithubZipball.mockResolvedValue({
      ok: true,
      resolvedRef: "abc1234",
      entries: [{ rawPath: "index.html", bytes: html("<html>") }],
    });
  });
  afterEach(() => vi.clearAllMocks());

  // --- authz gating ---
  it("404 when the BYO flag is off (inert)", async () => {
    isLabByoSitesEnabled.mockReturnValue(false);
    const res = await POST(post({ action: "sync" }));
    expect(res.status).toBe(404);
    expect(pullGithubZipball).not.toHaveBeenCalled();
  });

  it("401 when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect((await POST(post({ action: "sync" }))).status).toBe(401);
  });

  it("403 when not entitled (no paid lab plan)", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    expect((await POST(post({ action: "sync" }))).status).toBe(403);
  });

  it("409 when the lab has no claimed site yet", async () => {
    getSiteByOwner.mockResolvedValue(null);
    expect((await POST(post({ action: "connect", owner: "o", repo: "r", ref: "main" }))).status).toBe(409);
  });

  it("503 when R2 is not configured (no silent stub)", async () => {
    isAssetStoreConfigured.mockReturnValue(false);
    expect((await POST(post({ action: "connect", owner: "o", repo: "r", ref: "main" }))).status).toBe(503);
  });

  // --- connect happy path runs through validateByoEntries + stores ---
  it("connect: records connection, pulls, validates, stores, reports bytes", async () => {
    const res = await POST(post({ action: "connect", owner: "smithlab", repo: "companion", ref: "main" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; fileCount: number; resolvedRef: string };
    expect(data.ok).toBe(true);
    expect(data.fileCount).toBe(1);
    expect(upsertByoGithub).toHaveBeenCalledTimes(1);
    expect(putByoFile).toHaveBeenCalledTimes(1);
    expect(upsertByoSite).toHaveBeenCalledTimes(1);
    expect(setHostedAssetBytes).toHaveBeenCalledTimes(1);
    expect(recordByoGithubSync).toHaveBeenCalledWith({ labOwnerKey: "owner-1", resolvedSha: "abc1234" });
  });

  it("connect: 422 bad-connection on an unsafe owner (SSRF guard) and no pull", async () => {
    const res = await POST(post({ action: "connect", owner: "../evil", repo: "r", ref: "main" }));
    expect(res.status).toBe(422);
    expect(pullGithubZipball).not.toHaveBeenCalled();
    expect(putByoFile).not.toHaveBeenCalled();
  });

  // --- the pulled set is genuinely held to validateByoEntries ---
  it("422 no-index when the pulled set has no root index.html (nothing stored)", async () => {
    pullGithubZipball.mockResolvedValue({
      ok: true,
      resolvedRef: "abc",
      entries: [{ rawPath: "about.html", bytes: html("x") }],
    });
    const res = await POST(post({ action: "connect", owner: "o", repo: "r", ref: "main" }));
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("no-index");
    expect(putByoFile).not.toHaveBeenCalled();
    expect(upsertByoSite).not.toHaveBeenCalled();
  });

  it("422 bad-entry when a pulled entry is a traversal (held to zip-slip bar)", async () => {
    pullGithubZipball.mockResolvedValue({
      ok: true,
      resolvedRef: "abc",
      entries: [
        { rawPath: "index.html", bytes: html("<html>") },
        { rawPath: "../../etc/passwd", bytes: html("evil") },
      ],
    });
    const res = await POST(post({ action: "connect", owner: "o", repo: "r", ref: "main" }));
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("bad-entry");
    expect(putByoFile).not.toHaveBeenCalled();
  });

  it("502 when the pull fetch fails", async () => {
    pullGithubZipball.mockResolvedValue({ ok: false, error: "fetch-failed" });
    expect((await POST(post({ action: "connect", owner: "o", repo: "r", ref: "main" }))).status).toBe(502);
  });

  it("422 repo-not-found when the repo is missing / private", async () => {
    pullGithubZipball.mockResolvedValue({ ok: false, error: "not-found" });
    const res = await POST(post({ action: "connect", owner: "o", repo: "r", ref: "main" }));
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("repo-not-found");
  });

  // --- sync ---
  it("sync: 409 not connected when no recorded connection", async () => {
    getByoGithubByOwner.mockResolvedValue(null);
    expect((await POST(post({ action: "sync" }))).status).toBe(409);
  });

  it("sync: re-pulls the recorded connection and stores", async () => {
    const res = await POST(post({ action: "sync" }));
    expect(res.status).toBe(200);
    expect(getByoGithubByOwner).toHaveBeenCalledWith("owner-1");
    expect(pullGithubZipball).toHaveBeenCalledTimes(1);
    expect(putByoFile).toHaveBeenCalledTimes(1);
  });

  // --- disconnect ---
  it("disconnect: forgets the connection, no pull, no R2 requirement", async () => {
    isAssetStoreConfigured.mockReturnValue(false); // disconnect must not need R2
    deleteByoGithubRow.mockResolvedValue(undefined);
    const res = await POST(post({ action: "disconnect" }));
    expect(res.status).toBe(200);
    expect(deleteByoGithubRow).toHaveBeenCalledWith("owner-1");
    expect(pullGithubZipball).not.toHaveBeenCalled();
  });

  it("400 on an unknown action", async () => {
    expect((await POST(post({ action: "frobnicate" }))).status).toBe(400);
  });
});

describe("GET byo/github (recorded connection, fail-closed)", () => {
  beforeEach(() => {
    isLabByoSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
  });
  afterEach(() => vi.clearAllMocks());

  it("404 when the flag is off", async () => {
    isLabByoSitesEnabled.mockReturnValue(false);
    expect((await GET()).status).toBe(404);
  });
  it("401 when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it("returns null connection when none recorded", async () => {
    getByoGithubByOwner.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).connection).toBeNull();
  });
  it("returns the recorded connection (no secrets)", async () => {
    getByoGithubByOwner.mockResolvedValue({
      owner: "smithlab",
      repo: "companion",
      ref: "main",
      subdir: "site",
      lastSyncedSha: "abc1234",
      lastSyncedAt: "2026-06-16T00:00:00Z",
    });
    const res = await GET();
    const data = (await res.json()) as { connection: { owner: string; repo: string } };
    expect(data.connection.owner).toBe("smithlab");
    expect(data.connection.repo).toBe("companion");
  });
});
