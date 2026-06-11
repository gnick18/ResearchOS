// palettes.test.ts
//
// Pins the palette library + sampling engine: every seeded palette is well
// formed, sequential ramps interpolate to any N and hit the endpoints,
// qualitative overflow never repeats an exact color until the hue x lightness
// combinations exhaust, and mono returns the flat gray for pattern rendering.

import { describe, it, expect } from "vitest";
import {
  PALETTES,
  DEFAULT_PALETTE_ID,
  paletteById,
  samplePalette,
  paletteUsableForCount,
  type Palette,
} from "@/lib/datahub/palettes";

const HEX = /^#[0-9a-fA-F]{6}$/;

describe("palettes: library integrity", () => {
  it("every palette has a unique id, a name, >=3 colors, and valid hex", () => {
    const seen = new Set<string>();
    for (const p of PALETTES) {
      expect(p.id).toBeTruthy();
      expect(seen.has(p.id)).toBe(false);
      seen.add(p.id);
      expect(p.name).toBeTruthy();
      expect(p.colors.length).toBeGreaterThanOrEqual(3);
      for (const c of p.colors) expect(c).toMatch(HEX);
      expect(["qualitative", "sequential", "mono"]).toContain(p.category);
    }
  });

  it("the default palette resolves and is color-blind safe", () => {
    const d = paletteById(DEFAULT_PALETTE_ID);
    expect(d.id).toBe(DEFAULT_PALETTE_ID);
    expect(d.cbSafe).toBe(true);
  });

  it("paletteById falls back to the default for an unknown id", () => {
    expect(paletteById("does-not-exist").id).toBe(DEFAULT_PALETTE_ID);
    expect(paletteById(undefined).id).toBe(DEFAULT_PALETTE_ID);
  });

  it("paletteById finds a personal palette passed as extra", () => {
    const mine: Palette = {
      id: "mine-1",
      name: "Mine",
      category: "qualitative",
      cbSafe: false,
      printSafe: false,
      colors: ["#111111", "#222222", "#333333"],
    };
    expect(paletteById("mine-1", [mine]).name).toBe("Mine");
  });
});

describe("palettes: sampling counts", () => {
  it("returns exactly n colors for every palette and a range of n", () => {
    for (const p of PALETTES) {
      for (let n = 1; n <= 14; n++) {
        const out = samplePalette(p, n);
        expect(out.length).toBe(n);
        for (const c of out) expect(c).toMatch(HEX);
      }
    }
  });

  it("returns an empty array for n <= 0", () => {
    expect(samplePalette(PALETTES[0], 0)).toEqual([]);
    expect(samplePalette(PALETTES[0], -3)).toEqual([]);
  });
});

describe("palettes: sequential interpolation", () => {
  const ramp = paletteById("viridis");

  it("hits both endpoints for n >= 2", () => {
    const out = samplePalette(ramp, 5);
    expect(out[0]).toBe(ramp.colors[0]);
    expect(out[out.length - 1]).toBe(ramp.colors[ramp.colors.length - 1]);
  });

  it("takes the middle stop for n === 1", () => {
    const out = samplePalette(ramp, 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(ramp.colors[Math.floor(ramp.colors.length / 2)]);
  });

  it("can supply more colors than the ramp has stops", () => {
    const out = samplePalette(ramp, 12);
    expect(out.length).toBe(12);
    expect(out[0]).toBe(ramp.colors[0]);
    expect(out[11]).toBe(ramp.colors[ramp.colors.length - 1]);
  });
});

describe("palettes: qualitative overflow", () => {
  it("first n colors are the palette colors when n fits", () => {
    const okabe = paletteById("okabe");
    const out = samplePalette(okabe, 4);
    expect(out).toEqual(okabe.colors.slice(0, 4));
  });

  it("produces n distinct colors with no exact dupes up to 2x palette length", () => {
    for (const p of PALETTES.filter((x) => x.category === "qualitative")) {
      const n = p.colors.length * 2;
      const out = samplePalette(p, n);
      expect(out.length).toBe(n);
      const unique = new Set(out);
      expect(unique.size).toBe(n);
    }
  });
});

describe("palettes: mono", () => {
  it("returns n copies of the base gray for a pattern palette", () => {
    const mono = paletteById("mono-patterns");
    const out = samplePalette(mono, 4);
    expect(out).toEqual([
      mono.colors[0],
      mono.colors[0],
      mono.colors[0],
      mono.colors[0],
    ]);
  });
});

describe("palettes: usability filter", () => {
  it("hides a short qualitative palette for a large n but keeps ramps", () => {
    const trio = paletteById("brand-trio");
    expect(paletteUsableForCount(trio, 3)).toBe(true);
    expect(paletteUsableForCount(trio, 4)).toBe(false);
    const ramp = paletteById("viridis");
    expect(paletteUsableForCount(ramp, 20)).toBe(true);
    const mono = paletteById("mono-patterns");
    expect(paletteUsableForCount(mono, 20)).toBe(true);
  });
});
