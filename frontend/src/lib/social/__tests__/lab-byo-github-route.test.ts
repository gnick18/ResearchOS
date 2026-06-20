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
// Phase B: classification IO mocks.
const fetchRepoRootListing = vi.fn();
const fetchPagesEnabled = vi.fn();
// Phase B: tool-db mock (GET route now also checks this table).
const getToolByOwner = vi.fn();
// Phase B: tool-ingest mock.
const ingestToolRepo = vi.fn();

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
vi.mock("@/lib/social/lab-tool-db", () => ({
  getToolByOwner: (k: string) => getToolByOwner(k),
}));
vi.mock("@/lib/social/lab-tool-ingest", () => ({
  ingestToolRepo: (opts: unknown) => ingestToolRepo(opts),
}));
// The network pull, root-listing, and pages-enabled calls are mocked so tests
// never hit the real GitHub API. validateByoEntries + manifest helpers run REAL
// (so a pulled set genuinely runs through validateByoEntries / the zip-slip bar).
vi.mock("@/lib/social/lab-byo-github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/social/lab-byo-github")>();
  return {
    ...actual,
    pullGithubZipball: (c: unknown) => pullGithubZipball(c),
    fetchRepoRootListing: (o: string, r: string) => fetchRepoRootListing(o, r),
    fetchPagesEnabled: (o: string, r: string) => fetchPagesEnabled(o, r),
  };
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
    // Phase B defaults: classify as "site" so ALL existing Slice A tests remain
    // green. The root listing includes index.html (a site marker), which makes
    // classifyRepo() return "site" and keep the BYO zipball path active.
    fetchRepoRootListing.mockResolvedValue(["index.html", "style.css", "README.md"]);
    fetchPagesEnabled.mockResolvedValue(false);
    // getToolByOwner is called by the GET handler when no BYO row exists.
    getToolByOwner.mockResolvedValue(null);
    // ingestToolRepo default: returns a plausible result (overridden in tool tests).
    ingestToolRepo.mockResolvedValue({
      upsertedPaths: [""],
      publishedPaths: [""],
      meta: { name: "starfish", owner: "egluckthaler", description: null, primaryLanguage: "Perl", license: "MIT", htmlUrl: "https://github.com/egluckthaler/starfish", latestRelease: null, logoUrl: null, rootFileNames: [] },
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
    // Default: no connections recorded.
    getByoGithubByOwner.mockResolvedValue(null);
    getToolByOwner.mockResolvedValue(null);
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
  it("returns null connection when none recorded (no BYO row, no tool row)", async () => {
    getByoGithubByOwner.mockResolvedValue(null);
    getToolByOwner.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).connection).toBeNull();
  });
  it("returns the recorded site connection with kind:'site'", async () => {
    getByoGithubByOwner.mockResolvedValue({
      owner: "smithlab",
      repo: "companion",
      ref: "main",
      subdir: "site",
      lastSyncedSha: "abc1234",
      lastSyncedAt: "2026-06-16T00:00:00Z",
    });
    const res = await GET();
    const data = (await res.json()) as { connection: { kind: string; owner: string; repo: string } };
    expect(data.connection.kind).toBe("site");
    expect(data.connection.owner).toBe("smithlab");
    expect(data.connection.repo).toBe("companion");
  });
  it("returns the recorded tool connection with kind:'tool' when no BYO row exists", async () => {
    getByoGithubByOwner.mockResolvedValue(null);
    getToolByOwner.mockResolvedValue({
      labOwnerKey: "owner-1",
      owner: "egluckthaler",
      repo: "starfish",
      repoName: "starfish",
      repoDescription: "A Perl tool",
      primaryLanguage: "Perl",
      license: "MIT",
      htmlUrl: "https://github.com/egluckthaler/starfish",
      latestRelease: null,
      latestReleaseUrl: null,
      logoUrl: null,
      updatedAt: "2026-06-19T00:00:00Z",
    });
    const res = await GET();
    const data = (await res.json()) as { connection: { kind: string; owner: string; repo: string } };
    expect(data.connection.kind).toBe("tool");
    expect(data.connection.owner).toBe("egluckthaler");
    expect(data.connection.repo).toBe("starfish");
  });
});

// ---------------------------------------------------------------------------
// Phase B: classify-and-route decision tests
// ---------------------------------------------------------------------------
//
// These tests verify that the connect action correctly branches based on the
// detected repo type. The classification IO (fetchRepoRootListing +
// fetchPagesEnabled) and the ingest IO (ingestToolRepo) are mocked so the
// tests run without network access or a real DB.
//
// Site path (existing): listing contains index.html -> classifyRepo = "site"
//   -> pullGithubZipball called, ingestToolRepo NOT called.
// Tool path (Phase B): listing is README-only -> classifyRepo = "tool"
//   -> ingestToolRepo called, pullGithubZipball NOT called, R2 NOT required.

describe("Phase B: classify-and-route at connect time", () => {
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
    getByoGithubByOwner.mockResolvedValue(null);
    getToolByOwner.mockResolvedValue(null);
    pullGithubZipball.mockResolvedValue({
      ok: true,
      resolvedRef: "abc1234",
      entries: [{ rawPath: "index.html", bytes: new TextEncoder().encode("<html>") }],
    });
    ingestToolRepo.mockResolvedValue({
      upsertedPaths: ["", "wiki/install"],
      publishedPaths: ["", "wiki/install"],
      meta: {
        name: "starfish",
        owner: "egluckthaler",
        description: "A Perl tool for genome annotation",
        primaryLanguage: "Perl",
        license: "MIT",
        htmlUrl: "https://github.com/egluckthaler/starfish",
        latestRelease: "v1.2.0",
        logoUrl: null,
        rootFileNames: ["README.md", "bin", "lib"],
      },
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("site path: listing with index.html -> pullGithubZipball called, ingestToolRepo not called, kind:'site' in response", async () => {
    fetchRepoRootListing.mockResolvedValue(["index.html", "style.css", "README.md"]);
    fetchPagesEnabled.mockResolvedValue(false);
    const res = await POST(post({ action: "connect", owner: "gnick18", repo: "FungalICS_Website", ref: "main" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { kind: string; fileCount: number };
    expect(data.kind).toBe("site");
    expect(pullGithubZipball).toHaveBeenCalledTimes(1);
    expect(ingestToolRepo).not.toHaveBeenCalled();
    expect(data.fileCount).toBe(1);
  });

  it("site path: pagesEnabled=true -> routes to site even without index.html", async () => {
    fetchRepoRootListing.mockResolvedValue(["README.md", "lib", "src"]);
    fetchPagesEnabled.mockResolvedValue(true);
    const res = await POST(post({ action: "connect", owner: "smithlab", repo: "companion", ref: "main" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { kind: string };
    expect(data.kind).toBe("site");
    expect(pullGithubZipball).toHaveBeenCalledTimes(1);
    expect(ingestToolRepo).not.toHaveBeenCalled();
  });

  it("tool path: README-only listing -> ingestToolRepo called, pullGithubZipball not called, kind:'tool' in response", async () => {
    fetchRepoRootListing.mockResolvedValue(["README.md", "bin", "lib", "Makefile.PL", "LICENSE"]);
    fetchPagesEnabled.mockResolvedValue(false);
    const res = await POST(post({ action: "connect", owner: "egluckthaler", repo: "starfish", ref: "main" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { kind: string; pageCount: number; owner: string; repo: string };
    expect(data.kind).toBe("tool");
    expect(ingestToolRepo).toHaveBeenCalledTimes(1);
    expect(pullGithubZipball).not.toHaveBeenCalled();
    expect(data.pageCount).toBe(2); // "" and "wiki/install"
    expect(data.owner).toBe("egluckthaler");
    expect(data.repo).toBe("starfish");
  });

  it("tool path: R2 not configured -> tool connect still succeeds (no R2 needed for tools)", async () => {
    fetchRepoRootListing.mockResolvedValue(["README.md", "src", "LICENSE"]);
    fetchPagesEnabled.mockResolvedValue(false);
    isAssetStoreConfigured.mockReturnValue(false);
    const res = await POST(post({ action: "connect", owner: "egluckthaler", repo: "chtc", ref: "main" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { kind: string };
    expect(data.kind).toBe("tool");
    expect(ingestToolRepo).toHaveBeenCalledTimes(1);
    expect(pullGithubZipball).not.toHaveBeenCalled();
  });

  it("tool path: ingestToolRepo returns null (repo not found / private) -> 422 repo-not-found", async () => {
    fetchRepoRootListing.mockResolvedValue(["README.md", "src"]);
    fetchPagesEnabled.mockResolvedValue(false);
    ingestToolRepo.mockResolvedValue(null);
    const res = await POST(post({ action: "connect", owner: "egluckthaler", repo: "private-repo", ref: "main" }));
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("repo-not-found");
    expect(pullGithubZipball).not.toHaveBeenCalled();
  });

  it("site path: 503 when R2 not configured for a site repo", async () => {
    fetchRepoRootListing.mockResolvedValue(["index.html", "README.md"]);
    fetchPagesEnabled.mockResolvedValue(false);
    isAssetStoreConfigured.mockReturnValue(false);
    const res = await POST(post({ action: "connect", owner: "smithlab", repo: "companion-site", ref: "main" }));
    expect(res.status).toBe(503);
    expect(pullGithubZipball).not.toHaveBeenCalled();
    expect(ingestToolRepo).not.toHaveBeenCalled();
  });

  it("site path: fetchRepoRootListing failure -> empty listing -> classifies as 'tool' (safe degradation)", async () => {
    // When the listing fetch fails, fetchRepoRootListing returns [] (no crash).
    // An empty listing has no site markers, so classifyRepo returns "tool".
    // This degrades safely: the lab sees the tool page instead of a site page.
    fetchRepoRootListing.mockResolvedValue([]);
    fetchPagesEnabled.mockResolvedValue(false);
    const res = await POST(post({ action: "connect", owner: "smithlab", repo: "companion", ref: "main" }));
    // With empty listing and pagesEnabled=false, classifyRepo returns "tool".
    expect(res.status).toBe(200);
    const data = (await res.json()) as { kind: string };
    expect(data.kind).toBe("tool");
    expect(ingestToolRepo).toHaveBeenCalledTimes(1);
    expect(pullGithubZipball).not.toHaveBeenCalled();
  });
});
