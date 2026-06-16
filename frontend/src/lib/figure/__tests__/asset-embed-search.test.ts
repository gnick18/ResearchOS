import { describe, it, expect } from "vitest";
import {
  halfToFloat,
  decodeF16Matrix,
  dotTopK,
  blendResults,
} from "@/lib/figure/asset-embed-search";
import type { ScoredAsset } from "@/lib/figure/asset-search";
import type { LibraryAsset } from "@/lib/figure/asset-library";

// Mirror the ingest writer's float32 -> half so we can round-trip.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | (mant ? 0x7e00 : 0x7c00);
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - exp;
    let half = mant >> shift;
    if ((mant >> (shift - 1)) & 1) half += 1;
    return sign | half;
  }
  let half = (exp << 10) | (mant >> 13);
  if (mant & 0x1000) half += 1;
  return sign | half;
}

describe("asset-embed-search: fp16 round-trip", () => {
  it("halfToFloat inverts toHalf within f16 precision", () => {
    for (const v of [0, 1, -2, 0.5, 0.1, -0.333, 0.04567]) {
      expect(halfToFloat(toHalf(v))).toBeCloseTo(v, 2);
    }
  });

  it("decodeF16Matrix reconstructs a normalized matrix", () => {
    const vals = [0.6, 0.8, -0.6, 0.8]; // two unit rows, dims=2
    const u16 = new Uint16Array(vals.map(toHalf));
    const mat = decodeF16Matrix(u16.buffer, 2, 2);
    expect(mat[0]).toBeCloseTo(0.6, 2);
    expect(mat[3]).toBeCloseTo(0.8, 2);
  });

  it("throws if the buffer is too short for count*dims", () => {
    const u16 = new Uint16Array([toHalf(1), toHalf(0)]);
    expect(() => decodeF16Matrix(u16.buffer, 5, 2)).toThrow(/too short/);
  });
});

describe("asset-embed-search: dotTopK (cosine over unit rows)", () => {
  // 3 unit vectors in 2-d: east, north, north-east.
  const matrix = new Float32Array([1, 0, 0, 1, Math.SQRT1_2, Math.SQRT1_2]);
  it("ranks by cosine and returns the closest first", () => {
    const q = new Float32Array([1, 0]); // east
    const top = dotTopK(matrix, q, 3, 2, 3, -1);
    expect(top[0].row).toBe(0); // east is identical
    expect(top[0].score).toBeCloseTo(1, 5);
    // north-east (row 2) beats north (row 1) for an east query.
    expect(top[1].row).toBe(2);
  });
  it("drops rows below minScore", () => {
    const q = new Float32Array([1, 0]);
    const top = dotTopK(matrix, q, 3, 2, 3, 0.8);
    // only east (1.0) clears 0.8; north-east is ~0.707
    expect(top).toHaveLength(1);
    expect(top[0].row).toBe(0);
  });
});

function asset(uid: string, title: string): LibraryAsset {
  return {
    uid,
    source: "t",
    sourceId: uid,
    title,
    creator: null,
    license: "CC0",
    licenseUrl: null,
    requiresAttribution: false,
    sourceUrl: "",
    credit: "",
    svgPath: "x.svg",
    tags: [],
    category: null,
    fills: 1,
    hasViewBox: true,
  };
}

describe("asset-embed-search: blendResults", () => {
  const a = asset("a", "Alpha");
  const b = asset("b", "Beta");
  const c = asset("c", "Gamma");

  it("a literal keyword hit outranks a strong semantic-only hit", () => {
    const keyword: ScoredAsset[] = [{ asset: a, score: 1.0 }];
    const semantic: ScoredAsset[] = [{ asset: b, score: 1.0 }]; // *0.92 = 0.92
    const out = blendResults(keyword, semantic, 10);
    expect(out[0].asset.uid).toBe("a");
    expect(out[1].asset.uid).toBe("b");
  });

  it("merges by uid taking the higher score, and adds semantic-only recall", () => {
    const keyword: ScoredAsset[] = [{ asset: a, score: 0.5 }];
    const semantic: ScoredAsset[] = [
      { asset: a, score: 0.99 }, // 0.99*0.92 = 0.9108 > 0.5 -> wins for a
      { asset: c, score: 0.8 }, // brand-new recall
    ];
    const out = blendResults(keyword, semantic, 10);
    const byUid = Object.fromEntries(out.map((s) => [s.asset.uid, s.score]));
    expect(byUid["a"]).toBeCloseTo(0.9108, 4);
    expect(byUid["c"]).toBeCloseTo(0.736, 4);
    expect(out.map((s) => s.asset.uid)).toContain("c");
  });

  it("respects the limit", () => {
    const keyword: ScoredAsset[] = [a, b, c].map((x, i) => ({ asset: x, score: 1 - i * 0.1 }));
    expect(blendResults(keyword, [], 2)).toHaveLength(2);
  });
});
