import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BakedEmbed } from "@/lib/export/bake-embeds";

const isLabSitesEnabled = vi.fn();
const resolveCallerOwnerKey = vi.fn();
const isLabPublishEntitled = vi.fn();
const getSiteByOwner = vi.fn();
const publishPage = vi.fn();
const upsertPage = vi.fn();
const deletePage = vi.fn();
const isSiteEditor = vi.fn();

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
  getSiteByOwner: (k: string) => getSiteByOwner(k),
  publishPage: (k: string, p: string, s: string | null) => publishPage(k, p, s),
  upsertPage: (input: unknown) => upsertPage(input),
  deletePage: (k: string, p: string) => deletePage(k, p),
}));
vi.mock("@/lib/social/lab-site-editors-db", () => ({
  isSiteEditor: (owner: string, slug: string, caller: string) =>
    isSiteEditor(owner, slug, caller),
}));

import { DELETE, POST, PUT } from "@/app/api/social/lab-site/page/route";

const IMAGE: BakedEmbed = {
  kind: "image",
  dataUrl: "data:image/png;base64,AAAA",
  width: 600,
  height: 400,
  caption: "Figure 1",
  label: null,
};

function putRequest(body: unknown): Request {
  return new Request("https://x/api/social/lab-site/page", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/social/lab-site/page (publish + bake-on-publish storage)", () => {
  beforeEach(() => {
    isLabSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    getSiteByOwner.mockResolvedValue({
      labOwnerKey: "owner-1",
      labSlug: "smithlab",
      createdAt: "now",
    });
    publishPage.mockResolvedValue({
      labOwnerKey: "owner-1",
      path: "",
      title: "Home",
      bodyMd: "x",
      status: "published",
      version: 2,
      updatedAt: "now",
      snapshotsJson: null,
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("404s when the flag is off (inert), never touching the store", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    const res = await PUT(putRequest({ path: "", snapshots: { version: 1, snapshots: {} } }));
    expect(res.status).toBe(404);
    expect(publishPage).not.toHaveBeenCalled();
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect((await PUT(putRequest({ path: "" }))).status).toBe(401);
  });

  it("403s a not-entitled caller", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    expect((await PUT(putRequest({ path: "" }))).status).toBe(403);
  });

  it("stores the validated, serialized snapshot bundle on publish", async () => {
    const res = await PUT(
      putRequest({
        path: "",
        snapshots: {
          version: 1,
          snapshots: { "/sequences?seq=1#ros=map": IMAGE },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(publishPage).toHaveBeenCalledTimes(1);
    const [ownerKey, path, snapshotsJson] = publishPage.mock.calls[0];
    expect(ownerKey).toBe("owner-1");
    expect(path).toBe("");
    expect(typeof snapshotsJson).toBe("string");
    const parsed = JSON.parse(snapshotsJson as string);
    expect(parsed.version).toBe(1);
    expect(parsed.snapshots["/sequences?seq=1#ros=map"]).toEqual(IMAGE);
  });

  it("drops malformed snapshot entries before storing (defensive boundary)", async () => {
    await PUT(
      putRequest({
        path: "",
        snapshots: {
          version: 1,
          snapshots: {
            "/good#ros=map": IMAGE,
            "/bad#ros=x": { kind: "bogus" },
          },
        },
      }),
    );
    const snapshotsJson = publishPage.mock.calls[0][2] as string;
    const parsed = JSON.parse(snapshotsJson);
    expect(Object.keys(parsed.snapshots)).toEqual(["/good#ros=map"]);
  });

  it("stores NULL when no snapshots are supplied (text-only page)", async () => {
    await PUT(putRequest({ path: "" }));
    expect(publishPage.mock.calls[0][2]).toBeNull();
  });

  it("stores NULL when an empty snapshot bundle is supplied", async () => {
    await PUT(putRequest({ path: "", snapshots: { version: 1, snapshots: {} } }));
    expect(publishPage.mock.calls[0][2]).toBeNull();
  });

  it("404s when the page does not exist (publish acts on a draft)", async () => {
    publishPage.mockResolvedValue(null);
    expect((await PUT(putRequest({ path: "" }))).status).toBe(404);
  });

  it("400s an invalid body (non-string path)", async () => {
    expect((await PUT(putRequest({ path: 5 }))).status).toBe(400);
  });
});

function deleteRequest(body: unknown): Request {
  return new Request("https://x/api/social/lab-site/page", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/social/lab-site/page (delete a page)", () => {
  beforeEach(() => {
    isLabSitesEnabled.mockReturnValue(true);
    resolveCallerOwnerKey.mockResolvedValue("owner-1");
    isLabPublishEntitled.mockResolvedValue(true);
    getSiteByOwner.mockResolvedValue({
      labOwnerKey: "owner-1",
      labSlug: "smithlab",
      createdAt: "now",
    });
    deletePage.mockResolvedValue(true);
    isSiteEditor.mockResolvedValue(false);
  });
  afterEach(() => vi.clearAllMocks());

  it("404s when the flag is off (inert), never touching the store", async () => {
    isLabSitesEnabled.mockReturnValue(false);
    const res = await DELETE(deleteRequest({ path: "methods" }));
    expect(res.status).toBe(404);
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("401s when not signed in", async () => {
    resolveCallerOwnerKey.mockResolvedValue(null);
    expect((await DELETE(deleteRequest({ path: "methods" }))).status).toBe(401);
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("403s a not-entitled owner", async () => {
    isLabPublishEntitled.mockResolvedValue(false);
    expect((await DELETE(deleteRequest({ path: "methods" }))).status).toBe(403);
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("deletes a page for the owner and returns 200 { ok, path }", async () => {
    const res = await DELETE(deleteRequest({ path: "methods" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, path: "methods" });
    expect(deletePage).toHaveBeenCalledWith("owner-1", "methods");
  });

  it("allows deleting the home page (path \"\")", async () => {
    const res = await DELETE(deleteRequest({ path: "" }));
    expect(res.status).toBe(200);
    expect(deletePage).toHaveBeenCalledWith("owner-1", "");
  });

  it("400s an invalid body (non-string path)", async () => {
    expect((await DELETE(deleteRequest({ path: 5 }))).status).toBe(400);
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("404s when no live page existed (idempotent no-op)", async () => {
    deletePage.mockResolvedValue(false);
    expect((await DELETE(deleteRequest({ path: "gone" }))).status).toBe(404);
  });

  it("409s when the caller has no site yet", async () => {
    getSiteByOwner.mockResolvedValue(null);
    expect((await DELETE(deleteRequest({ path: "methods" }))).status).toBe(409);
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("503s when the store throws", async () => {
    deletePage.mockRejectedValue(new Error("db down"));
    expect((await DELETE(deleteRequest({ path: "methods" }))).status).toBe(503);
  });

  it("lets a granted editor delete on the PI's site (siteOwnerKey path)", async () => {
    resolveCallerOwnerKey.mockResolvedValue("editor-9");
    isSiteEditor.mockResolvedValue(true);
    const res = await DELETE(
      deleteRequest({ path: "methods", siteOwnerKey: "owner-1" }),
    );
    expect(res.status).toBe(200);
    // The delete targets the PI's rows, not the editor's own.
    expect(deletePage).toHaveBeenCalledWith("owner-1", "methods");
  });

  it("403s a non-owner with no editor grant", async () => {
    resolveCallerOwnerKey.mockResolvedValue("editor-9");
    isSiteEditor.mockResolvedValue(false);
    const res = await DELETE(
      deleteRequest({ path: "methods", siteOwnerKey: "owner-1" }),
    );
    expect(res.status).toBe(403);
    expect(deletePage).not.toHaveBeenCalled();
  });
});
