import { describe, expect, it } from "vitest";

import type { BakedEmbed } from "@/lib/export/bake-embeds";
import {
  bundleFromBakedMap,
  emptyBundle,
  isBakedEmbed,
  MAX_SNAPSHOTS_PER_PAGE,
  MAX_SNAPSHOT_BUNDLE_BYTES,
  parseSnapshotBundle,
  resolveSnapshot,
  serializeSnapshotBundle,
} from "../lab-site-snapshots";

const IMAGE: BakedEmbed = {
  kind: "image",
  dataUrl: "data:image/png;base64,AAAA",
  width: 600,
  height: 400,
  caption: "Figure 1",
  label: null,
};
const TABLE: BakedEmbed = {
  kind: "table",
  columns: ["a", "b"],
  rows: [["1", "2"]],
  caption: "Table 1",
  label: null,
};
const MISSING: BakedEmbed = { kind: "missing", name: "Gone", label: null };

describe("isBakedEmbed", () => {
  it("accepts each known kind", () => {
    expect(isBakedEmbed(IMAGE)).toBe(true);
    expect(isBakedEmbed(TABLE)).toBe(true);
    expect(isBakedEmbed({ kind: "text", body: "x", caption: "", label: null })).toBe(true);
    expect(isBakedEmbed({ kind: "card", title: "t", subtitle: "", meta: [], caption: "", label: null })).toBe(true);
    expect(isBakedEmbed(MISSING)).toBe(true);
  });

  it("rejects unknown kinds and malformed shapes", () => {
    expect(isBakedEmbed(null)).toBe(false);
    expect(isBakedEmbed("nope")).toBe(false);
    expect(isBakedEmbed({ kind: "bogus" })).toBe(false);
    // image without a string dataUrl
    expect(isBakedEmbed({ kind: "image", dataUrl: 5, width: 1, height: 1 })).toBe(false);
    // table without arrays
    expect(isBakedEmbed({ kind: "table", columns: "a", rows: [] })).toBe(false);
  });
});

describe("parseSnapshotBundle (defensive boundary)", () => {
  it("returns the empty bundle for absent / non-object / wrong-version input", () => {
    expect(parseSnapshotBundle(undefined)).toEqual(emptyBundle());
    expect(parseSnapshotBundle(null)).toEqual(emptyBundle());
    expect(parseSnapshotBundle(42)).toEqual(emptyBundle());
    expect(parseSnapshotBundle({ version: 2, snapshots: {} })).toEqual(emptyBundle());
    expect(parseSnapshotBundle({ version: 1 })).toEqual(emptyBundle());
  });

  it("parses a raw JSON string column and a parsed object identically", () => {
    const obj = { version: 1, snapshots: { "/sequences?seq=1#ros=map": IMAGE } };
    const fromObj = parseSnapshotBundle(obj);
    const fromStr = parseSnapshotBundle(JSON.stringify(obj));
    expect(fromObj).toEqual(fromStr);
    expect(fromObj.snapshots["/sequences?seq=1#ros=map"]).toEqual(IMAGE);
  });

  it("returns the empty bundle for an unparseable string", () => {
    expect(parseSnapshotBundle("{not json")).toEqual(emptyBundle());
  });

  it("drops entries with a non-string href or a non-BakedEmbed value", () => {
    const parsed = parseSnapshotBundle({
      version: 1,
      snapshots: {
        "/good#ros=table": TABLE,
        "/bad#ros=x": { kind: "bogus" },
        "": IMAGE,
      },
    });
    expect(Object.keys(parsed.snapshots)).toEqual(["/good#ros=table"]);
  });

  it("caps the number of entries", () => {
    const snapshots: Record<string, BakedEmbed> = {};
    for (let i = 0; i < MAX_SNAPSHOTS_PER_PAGE + 25; i++) {
      snapshots[`/h${i}#ros=table`] = TABLE;
    }
    const parsed = parseSnapshotBundle({ version: 1, snapshots });
    expect(Object.keys(parsed.snapshots).length).toBe(MAX_SNAPSHOTS_PER_PAGE);
  });

  it("rejects an over-cap string outright (no parse attempt)", () => {
    const huge = "x".repeat(MAX_SNAPSHOT_BUNDLE_BYTES + 1);
    expect(parseSnapshotBundle(huge)).toEqual(emptyBundle());
  });
});

describe("serializeSnapshotBundle", () => {
  it("round-trips through parse", () => {
    const bundle = bundleFromBakedMap(
      new Map<string, BakedEmbed>([["/seq#ros=map", IMAGE]]),
    );
    const json = serializeSnapshotBundle(bundle);
    expect(json).not.toBeNull();
    expect(parseSnapshotBundle(json as string)).toEqual(bundle);
  });

  it("returns null when serialized form exceeds the byte cap", () => {
    const giant: BakedEmbed = {
      kind: "image",
      dataUrl: "data:image/png;base64," + "A".repeat(MAX_SNAPSHOT_BUNDLE_BYTES),
      width: 1,
      height: 1,
      caption: "",
      label: null,
    };
    const bundle = bundleFromBakedMap(new Map([["/h#ros=map", giant]]));
    expect(serializeSnapshotBundle(bundle)).toBeNull();
  });
});

describe("bundleFromBakedMap", () => {
  it("builds a version-1 bundle keyed by href", () => {
    const bundle = bundleFromBakedMap(
      new Map<string, BakedEmbed>([
        ["/a#ros=map", IMAGE],
        ["/b#ros=table", TABLE],
      ]),
    );
    expect(bundle.version).toBe(1);
    expect(bundle.snapshots["/a#ros=map"]).toEqual(IMAGE);
    expect(bundle.snapshots["/b#ros=table"]).toEqual(TABLE);
  });
});

describe("resolveSnapshot (public render lookup + missing fallback)", () => {
  const bundle = bundleFromBakedMap(new Map([["/seq#ros=map", IMAGE]]));

  it("returns the frozen snapshot for a known href", () => {
    expect(resolveSnapshot(bundle, "/seq#ros=map")).toEqual(IMAGE);
  });

  it("returns null for an unknown href (the missing fallback)", () => {
    expect(resolveSnapshot(bundle, "/other#ros=table")).toBeNull();
  });

  it("returns null for a null bundle", () => {
    expect(resolveSnapshot(null, "/seq#ros=map")).toBeNull();
  });
});
