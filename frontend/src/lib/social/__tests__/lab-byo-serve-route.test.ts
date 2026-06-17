import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isLabByoSitesEnabled = vi.fn();
const getSiteBySlug = vi.fn();
const getByoSiteByOwner = vi.fn();
const readByoFile = vi.fn();

vi.mock("@/lib/social/config", () => ({
  isLabByoSitesEnabled: () => isLabByoSitesEnabled(),
}));
vi.mock("@/lib/social/lab-site-db", () => ({ getSiteBySlug: (s: string) => getSiteBySlug(s) }));
vi.mock("@/lib/social/lab-byo-db", () => ({
  getByoSiteByOwner: (k: string) => getByoSiteByOwner(k),
}));
vi.mock("@/lib/social/lab-site-asset-store", () => ({
  readByoFile: (frag: string, p: string) => readByoFile(frag, p),
}));

import { GET } from "@/app/api/social/lab-site/byo/serve/route";

function req(qs: string, host = "x"): Request {
  return new Request(`http://${host}/api/social/lab-site/byo/serve${qs}`, {
    headers: { host },
  });
}

describe("GET byo/serve (public, isolated)", () => {
  beforeEach(() => {
    isLabByoSitesEnabled.mockReturnValue(true);
    getSiteBySlug.mockResolvedValue({ labOwnerKey: "owner-1", labSlug: "smithlab" });
    getByoSiteByOwner.mockResolvedValue({
      manifest: { version: 1, indexPath: "index.html", files: [{ path: "index.html", bytes: 10 }], totalBytes: 10 },
    });
    readByoFile.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: "text/html; charset=utf-8" });
  });
  afterEach(() => vi.clearAllMocks());

  it("404 when the BYO flag is off (inert)", async () => {
    isLabByoSitesEnabled.mockReturnValue(false);
    expect((await GET(req("?slug=smithlab"))).status).toBe(404);
  });
  it("404 when no slug (host not a byo subdomain, no ?slug)", async () => {
    expect((await GET(req("")))?.status).toBe(404);
  });
  it("404 on a traversal request path", async () => {
    expect((await GET(req("?slug=smithlab&path=../secret"))).status).toBe(404);
  });
  it("404 when the lab has no BYO site", async () => {
    getByoSiteByOwner.mockResolvedValue(null);
    expect((await GET(req("?slug=smithlab"))).status).toBe(404);
  });
  it("404 when the resolved file is NOT in the manifest (probe guard)", async () => {
    expect((await GET(req("?slug=smithlab&path=not-listed.js"))).status).toBe(404);
  });
  it("200 with nosniff + no Set-Cookie for an in-manifest file", async () => {
    const res = await GET(req("?slug=smithlab"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("resolves the slug from a <slug>.research-os.com Host header", async () => {
    const res = await GET(req("", "smithlab.research-os.com"));
    expect(res.status).toBe(200);
    expect(getSiteBySlug).toHaveBeenCalledWith("smithlab");
  });
});
