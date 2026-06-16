import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BakedEmbed } from "@/lib/export/bake-embeds";

const isLabSitesEnabled = vi.fn();
const resolveCallerOwnerKey = vi.fn();
const isLabPublishEntitled = vi.fn();
const getSiteByOwner = vi.fn();
const publishPage = vi.fn();
const upsertPage = vi.fn();

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
}));

import { POST, PUT } from "@/app/api/social/lab-site/page/route";

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
