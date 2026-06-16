import { describe, expect, it } from "vitest";

import {
  buildHostedManifest,
  emptyHostedManifest,
  hostedAssetId,
  hostedAssetKey,
  isHostedAssetEntry,
  isValidAssetId,
  parseHostedManifest,
  resolveDatasetEmbed,
  serializeHostedManifest,
  MAX_HOSTED_ASSETS_PER_PAGE,
  type HostedAssetEntry,
} from "../lab-site-hosted";

const entry = (over: Partial<HostedAssetEntry> = {}): HostedAssetEntry => ({
  assetId: hostedAssetId("owner-1", "", "/datahub?d=1#ros=table"),
  readUrl: "/api/social/lab-site/asset/read?id=x",
  bytes: 1234,
  columns: ["gene", "expr"],
  rowCount: 10,
  ...over,
});

describe("hostedAssetId", () => {
  it("is deterministic for the same (lab, path, href)", () => {
    const a = hostedAssetId("owner-1", "page", "/d#ros=table");
    const b = hostedAssetId("owner-1", "page", "/d#ros=table");
    expect(a).toBe(b);
  });
  it("differs across lab, path, or href", () => {
    const base = hostedAssetId("owner-1", "page", "/d#ros=table");
    expect(hostedAssetId("owner-2", "page", "/d#ros=table")).not.toBe(base);
    expect(hostedAssetId("owner-1", "other", "/d#ros=table")).not.toBe(base);
    expect(hostedAssetId("owner-1", "page", "/e#ros=table")).not.toBe(base);
  });
  it("produces a well-formed, valid id", () => {
    expect(isValidAssetId(hostedAssetId("owner-1", "p", "/d#ros=table"))).toBe(true);
  });
});

describe("hostedAssetKey", () => {
  it("is the prefixed parquet key for an id", () => {
    const id = hostedAssetId("owner-1", "p", "/d#ros=table");
    expect(hostedAssetKey(id)).toMatch(/\/.+\.parquet$/);
    expect(hostedAssetKey(id)).toContain(id);
  });
});

describe("isValidAssetId (probe guard)", () => {
  it("rejects hand-crafted / traversal / wrong-shape keys", () => {
    expect(isValidAssetId("../../etc/passwd")).toBe(false);
    expect(isValidAssetId("lab-site-assets/secret")).toBe(false);
    expect(isValidAssetId("no-hash-suffix")).toBe(false);
    expect(isValidAssetId("")).toBe(false);
    expect(isValidAssetId(42)).toBe(false);
    expect(isValidAssetId(null)).toBe(false);
  });
});

describe("isHostedAssetEntry", () => {
  it("accepts a well-formed entry, rejects malformed", () => {
    expect(isHostedAssetEntry(entry())).toBe(true);
    expect(isHostedAssetEntry({ ...entry(), assetId: "bad" })).toBe(false);
    expect(isHostedAssetEntry({ ...entry(), bytes: -1 })).toBe(false);
    expect(isHostedAssetEntry({ ...entry(), columns: [1, 2] })).toBe(false);
    expect(isHostedAssetEntry(null)).toBe(false);
  });
});

describe("parseHostedManifest (untrusted input)", () => {
  it("parses a valid object and a valid JSON string identically", () => {
    const m = { version: 1, assets: { "/d#ros=table": entry() } };
    expect(parseHostedManifest(m).assets["/d#ros=table"]).toBeTruthy();
    expect(parseHostedManifest(JSON.stringify(m)).assets["/d#ros=table"]).toBeTruthy();
  });
  it("collapses malformed / wrong-version / non-object to empty", () => {
    expect(parseHostedManifest("{not json").assets).toEqual({});
    expect(parseHostedManifest({ version: 2, assets: {} }).assets).toEqual({});
    expect(parseHostedManifest(null).assets).toEqual({});
    expect(parseHostedManifest(42).assets).toEqual({});
  });
  it("drops bad entries but keeps good ones", () => {
    const m = { version: 1, assets: { good: entry(), bad: { assetId: "x" } } };
    const out = parseHostedManifest(m);
    expect(out.assets.good).toBeTruthy();
    expect(out.assets.bad).toBeUndefined();
  });
  it("caps the entry count", () => {
    const assets: Record<string, HostedAssetEntry> = {};
    for (let i = 0; i < MAX_HOSTED_ASSETS_PER_PAGE + 10; i += 1) assets[`h${i}`] = entry();
    expect(Object.keys(parseHostedManifest({ version: 1, assets }).assets).length).toBe(
      MAX_HOSTED_ASSETS_PER_PAGE,
    );
  });
});

describe("serializeHostedManifest", () => {
  it("returns null for an empty manifest (store NULL)", () => {
    expect(serializeHostedManifest(emptyHostedManifest())).toBeNull();
  });
  it("round-trips a non-empty manifest", () => {
    const m = buildHostedManifest({ "/d#ros=table": entry() });
    const json = serializeHostedManifest(m);
    expect(json).not.toBeNull();
    expect(parseHostedManifest(json).assets["/d#ros=table"]).toBeTruthy();
  });
});

describe("resolveDatasetEmbed (live > baked > unavailable)", () => {
  const baked = { kind: "table" } as never;
  it("LIVE when a hosted asset exists (carries baked as fallback)", () => {
    const m = buildHostedManifest({ "/d#ros=table": entry() });
    const r = resolveDatasetEmbed(m, "/d#ros=table", baked);
    expect(r.mode).toBe("live");
  });
  it("BAKED when no asset but a snapshot exists", () => {
    expect(resolveDatasetEmbed(emptyHostedManifest(), "/d#ros=table", baked).mode).toBe(
      "baked",
    );
  });
  it("UNAVAILABLE when neither", () => {
    expect(resolveDatasetEmbed(emptyHostedManifest(), "/d#ros=table", null).mode).toBe(
      "unavailable",
    );
  });
  it("null manifest collapses to baked/unavailable (pre-4a parity)", () => {
    expect(resolveDatasetEmbed(null, "/d#ros=table", baked).mode).toBe("baked");
    expect(resolveDatasetEmbed(null, "/d#ros=table", null).mode).toBe("unavailable");
  });
});
