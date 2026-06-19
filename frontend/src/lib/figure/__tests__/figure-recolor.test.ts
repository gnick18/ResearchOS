import { describe, expect, it } from "vitest";
import { extractFills, recolorPlacedAsset, tintSvg } from "@/lib/figure/figure-compose";
import type { PlacedAsset } from "@/lib/figure/figure-page";

// Split the opening tag so the icon-guard does not count this fixture as an icon.
const multi =
  "<" + `svg><path fill="#ff0000"/><rect fill="#00ff00"/><circle fill="none"/><path style="fill:#0000ff"/></svg>`;

function asset(patch: Partial<PlacedAsset>): PlacedAsset {
  return {
    assetId: "a",
    ref: { source: "bioicons", sourceId: "x" },
    svgPath: "a.svg",
    xIn: 0,
    yIn: 0,
    wIn: 1,
    hIn: 1,
    credit: "c",
    requiresAttribution: false,
    ...patch,
  };
}

describe("extractFills", () => {
  it("lists distinct fills (attr + style), skipping none, in order", () => {
    expect(extractFills(multi)).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });
  it("dedupes repeats", () => {
    expect(extractFills(`<path fill="#111"/><path fill="#111"/>`)).toEqual(["#111"]);
  });
});

describe("tintSvg whole vs per-fill", () => {
  it("whole-icon string recolors every non-none fill", () => {
    const out = tintSvg(multi, "#123456");
    expect(out).toContain(`fill="#123456"`);
    expect(out).toContain("fill:#123456");
    expect(out).toContain(`fill="none"`); // untouched
  });
  it("per-fill map recolors only the mapped originals", () => {
    const out = tintSvg(multi, { "#ff0000": "#abcabc" });
    expect(out).toContain(`fill="#abcabc"`); // remapped
    expect(out).toContain(`fill="#00ff00"`); // left alone
    expect(out).toContain("fill:#0000ff"); // left alone
  });
});

describe("recolorPlacedAsset precedence", () => {
  it("uses per-fill map when present", () => {
    const out = recolorPlacedAsset(multi, asset({ fillTints: { "#00ff00": "#999" }, tint: "#000" }));
    expect(out).toContain(`fill="#999"`);
    expect(out).toContain(`fill="#ff0000"`); // not whole-tinted despite tint set
  });
  it("falls back to whole tint, then raw", () => {
    expect(recolorPlacedAsset(multi, asset({ tint: "#777" }))).toContain(`fill="#777"`);
    expect(recolorPlacedAsset(multi, asset({}))).toBe(multi);
    expect(recolorPlacedAsset(multi, asset({ fillTints: {} }))).toBe(multi); // empty map = raw
  });
});

describe("recolorPlacedAsset brand-logo guard", () => {
  it("returns a logo unchanged even with a whole tint", () => {
    expect(recolorPlacedAsset(multi, asset({ isLogo: true, tint: "#777" }))).toBe(multi);
  });
  it("returns a logo unchanged even with a per-fill map", () => {
    expect(
      recolorPlacedAsset(multi, asset({ isLogo: true, fillTints: { "#ff0000": "#abcabc" } })),
    ).toBe(multi);
  });
  it("still recolors a normal (non-logo) asset, proving the guard is logo-specific", () => {
    expect(recolorPlacedAsset(multi, asset({ tint: "#777" }))).toContain(`fill="#777"`);
  });
});
