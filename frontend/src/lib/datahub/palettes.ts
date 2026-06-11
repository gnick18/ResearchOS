// palettes.ts
//
// The Data Hub plot palette library + sampling engine. A figure's series colors
// come from an ACTIVE PALETTE sampled to the exact number of series in the plot,
// so picking one palette recolors the whole figure consistently (this replaces
// the old single-color-per-mode scheme where "sky" painted every series the
// same blue). The why: researchers expect Prism / Coolors style palettes, not
// one hue, and a color-blind-safe default keeps figures readable by reviewers.
//
// This module is pure and browser-safe (no DOM): it is the seam between a stored
// palette id and the concrete hex array the SVG builders consume. The studio UI
// (GraphEditor) and the renderer (plot-spec.ts) both read from here so they
// agree on every color.
//
// Flags (cbSafe / printSafe) follow ColorBrewer's published guidance where the
// palette comes from ColorBrewer, the source authors for Paul Tol / Okabe-Ito /
// CARTO / Viridis, and a conservative cbSafe:false where we are unsure. They
// drive the studio's filter toggles, not the rendering.
//
// No em-dashes, no emojis, no mid-sentence colons.

/** A named, categorized color palette the plot studio offers. */
export interface Palette {
  /** Stable id stored on a PlotStyle (style.palette). */
  id: string;
  /** Display name in the studio grid. */
  name: string;
  /**
   * "qualitative" is a fixed set of distinct hues for unordered categories,
   * "sequential" is an ordered ramp sampled to any N, "mono" is a single gray
   * the renderer fills with B and W patterns (no color).
   */
  category: "qualitative" | "sequential" | "mono";
  /** The ordered color stops (hex). */
  colors: string[];
  /** Color-blind safe per the source authors (drives the studio filter). */
  cbSafe: boolean;
  /** Distinguishable in grayscale print per the source authors. */
  printSafe: boolean;
  /** A mono palette the renderer draws as hatch / dot patterns, not flat color. */
  pattern?: boolean;
}

// ---------------------------------------------------------------------------
// The seeded library
// ---------------------------------------------------------------------------
//
// Ported from the approved mockup's LIB and extended with the rest of the
// standard ColorBrewer qualitative + key sequential ramps, the full Paul Tol
// set, CARTOColors, Okabe-Ito, Viridis, and our approved palettes (including the
// brand trio + sky ramp + grey ramp the legacy color modes map onto).

export const PALETTES: Palette[] = [
  // --- qualitative, color-blind safe ---
  {
    id: "okabe",
    name: "Okabe-Ito",
    category: "qualitative",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#000000",
      "#E69F00",
      "#56B4E9",
      "#009E73",
      "#F0E442",
      "#0072B2",
      "#D55E00",
      "#CC79A7",
    ],
  },
  {
    id: "tol-bright",
    name: "Paul Tol bright",
    category: "qualitative",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#4477AA",
      "#EE6677",
      "#228833",
      "#CCBB44",
      "#66CCEE",
      "#AA3377",
      "#BBBBBB",
    ],
  },
  {
    id: "tol-muted",
    name: "Paul Tol muted",
    category: "qualitative",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#CC6677",
      "#DDCC77",
      "#117733",
      "#88CCEE",
      "#882255",
      "#44AA99",
      "#999933",
      "#AA4499",
    ],
  },
  {
    id: "tol-vibrant",
    name: "Paul Tol vibrant",
    category: "qualitative",
    cbSafe: true,
    printSafe: false,
    colors: [
      "#EE7733",
      "#0077BB",
      "#33BBEE",
      "#EE3377",
      "#CC3311",
      "#009988",
      "#BBBBBB",
    ],
  },
  {
    id: "tol-light",
    name: "Paul Tol light",
    category: "qualitative",
    cbSafe: true,
    printSafe: false,
    colors: [
      "#77AADD",
      "#EE8866",
      "#EEDD88",
      "#FFAABB",
      "#99DDFF",
      "#44BB99",
      "#BBCC33",
      "#AAAA00",
    ],
  },
  {
    id: "cb-dark2",
    name: "ColorBrewer Dark2",
    category: "qualitative",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#1B9E77",
      "#D95F02",
      "#7570B3",
      "#E7298A",
      "#66A61E",
      "#E6AB02",
      "#A6761D",
      "#666666",
    ],
  },
  {
    id: "cb-set2",
    name: "ColorBrewer Set2",
    category: "qualitative",
    cbSafe: true,
    printSafe: false,
    colors: [
      "#66C2A5",
      "#FC8D62",
      "#8DA0CB",
      "#E78AC3",
      "#A6D854",
      "#FFD92F",
      "#E5C494",
      "#B3B3B3",
    ],
  },
  // --- qualitative, not cb-safe but lots of colors ---
  {
    id: "cb-set1",
    name: "ColorBrewer Set1",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#E41A1C",
      "#377EB8",
      "#4DAF4A",
      "#984EA3",
      "#FF7F00",
      "#FFFF33",
      "#A65628",
      "#F781BF",
      "#999999",
    ],
  },
  {
    id: "cb-set3",
    name: "ColorBrewer Set3",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#8DD3C7",
      "#FFFFB3",
      "#BEBADA",
      "#FB8072",
      "#80B1D3",
      "#FDB462",
      "#B3DE69",
      "#FCCDE5",
      "#D9D9D9",
      "#BC80BD",
      "#CCEBC5",
      "#FFED6F",
    ],
  },
  {
    id: "cb-paired",
    name: "ColorBrewer Paired",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#A6CEE3",
      "#1F78B4",
      "#B2DF8A",
      "#33A02C",
      "#FB9A99",
      "#E31A1C",
      "#FDBF6F",
      "#FF7F00",
      "#CAB2D6",
      "#6A3D9A",
      "#FFFF99",
      "#B15928",
    ],
  },
  {
    id: "cb-pastel1",
    name: "ColorBrewer Pastel1",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#FBB4AE",
      "#B3CDE3",
      "#CCEBC5",
      "#DECBE4",
      "#FED9A6",
      "#FFFFCC",
      "#E5D8BD",
      "#FDDAEC",
    ],
  },
  {
    id: "cb-pastel2",
    name: "ColorBrewer Pastel2",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#B3E2CD",
      "#FDCDAC",
      "#CBD5E8",
      "#F4CAE4",
      "#E6F5C9",
      "#FFF2AE",
      "#F1E2CC",
      "#CCCCCC",
    ],
  },
  {
    id: "cb-accent",
    name: "ColorBrewer Accent",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#7FC97F",
      "#BEAED4",
      "#FDC086",
      "#FFFF99",
      "#386CB0",
      "#F0027F",
      "#BF5B17",
      "#666666",
    ],
  },
  // --- CARTOColors qualitative ---
  {
    id: "carto-bold",
    name: "CARTO Bold",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#7F3C8D",
      "#11A579",
      "#3969AC",
      "#F2B701",
      "#E73F74",
      "#80BA5A",
      "#E68310",
      "#008695",
      "#CF1C90",
      "#F97B72",
    ],
  },
  {
    id: "carto-pastel",
    name: "CARTO Pastel",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#66C5CC",
      "#F6CF71",
      "#F89C74",
      "#DCB0F2",
      "#87C55F",
      "#9EB9F3",
      "#FE88B1",
      "#C9DB74",
      "#8BE0A4",
      "#B497E7",
    ],
  },
  {
    id: "carto-vivid",
    name: "CARTO Vivid",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#E58606",
      "#5D69B1",
      "#52BCA3",
      "#99C945",
      "#CC61B0",
      "#24796C",
      "#DAA51B",
      "#2F8AC4",
      "#764E9F",
      "#ED645A",
    ],
  },
  {
    id: "carto-safe",
    name: "CARTO Safe",
    category: "qualitative",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#88CCEE",
      "#CC6677",
      "#DDCC77",
      "#117733",
      "#332288",
      "#AA4499",
      "#44AA99",
      "#999933",
      "#882255",
      "#661100",
    ],
  },
  // --- our approved palettes ---
  {
    id: "brand-trio",
    name: "Brand trio",
    category: "qualitative",
    cbSafe: false,
    printSafe: true,
    colors: ["#1AA0E6", "#7C3AED", "#F97316"],
  },
  {
    id: "pastel-fun",
    name: "Pastel (fun)",
    category: "qualitative",
    cbSafe: false,
    printSafe: false,
    colors: [
      "#F8AD9D",
      "#FFD6A5",
      "#FDFFB6",
      "#CAFFBF",
      "#9BF6FF",
      "#A0C4FF",
      "#BDB2FF",
      "#FFC6FF",
    ],
  },
  {
    id: "your-figures",
    name: "Your figures (ICS paper)",
    category: "qualitative",
    cbSafe: false,
    printSafe: true,
    colors: [
      "#BE6C9C",
      "#E0A23C",
      "#3FA468",
      "#2E6CB0",
      "#C0613E",
      "#6FB3DD",
      "#000000",
    ],
  },
  {
    id: "coolors-classic",
    name: "Coolors classic",
    category: "qualitative",
    cbSafe: false,
    printSafe: true,
    colors: ["#264653", "#2A9D8F", "#E9C46A", "#F4A261", "#E76F51"],
  },
  // --- sequential ramps (provide any N) ---
  {
    id: "viridis",
    name: "Viridis",
    category: "sequential",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#440154",
      "#414487",
      "#2A788E",
      "#22A884",
      "#7AD151",
      "#FDE725",
    ],
  },
  {
    id: "sky-ramp",
    name: "Sky (Blues)",
    category: "sequential",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#D6ECFA",
      "#9DD3F2",
      "#5FB6EA",
      "#1AA0E6",
      "#1283C9",
      "#0C5E94",
      "#083E62",
    ],
  },
  {
    id: "cb-blues",
    name: "ColorBrewer Blues",
    category: "sequential",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#EFF3FF",
      "#C6DBEF",
      "#9ECAE1",
      "#6BAED6",
      "#3182BD",
      "#08519C",
    ],
  },
  {
    id: "red-ramp",
    name: "Red",
    category: "sequential",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#FBD5CE",
      "#F6A99D",
      "#F47C6B",
      "#FF6F61",
      "#E23B2A",
      "#B71C0F",
      "#7F1108",
    ],
  },
  {
    id: "cb-reds",
    name: "ColorBrewer Reds",
    category: "sequential",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#FEE5D9",
      "#FCBBA1",
      "#FC9272",
      "#FB6A4A",
      "#DE2D26",
      "#A50F15",
    ],
  },
  {
    id: "cb-greens",
    name: "ColorBrewer Greens",
    category: "sequential",
    cbSafe: true,
    printSafe: true,
    colors: ["#E5F5E0", "#A1D99B", "#41AB5D", "#238B45", "#005A32"],
  },
  {
    id: "cb-oranges",
    name: "ColorBrewer Oranges",
    category: "sequential",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#FEEDDE",
      "#FDBE85",
      "#FD8D3C",
      "#E6550D",
      "#A63603",
    ],
  },
  {
    id: "cb-purples",
    name: "ColorBrewer Purples",
    category: "sequential",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#F2F0F7",
      "#CBC9E2",
      "#9E9AC8",
      "#756BB1",
      "#54278F",
    ],
  },
  {
    id: "cb-greys",
    name: "ColorBrewer Greys",
    category: "sequential",
    cbSafe: true,
    printSafe: true,
    colors: [
      "#F7F7F7",
      "#CCCCCC",
      "#969696",
      "#636363",
      "#252525",
    ],
  },
  // --- mono / pattern ---
  {
    id: "mono-patterns",
    name: "Mono (B and W patterns)",
    category: "mono",
    cbSafe: true,
    printSafe: true,
    pattern: true,
    colors: ["#c2c7cf", "#c2c7cf", "#c2c7cf", "#c2c7cf", "#c2c7cf"],
  },
];

/** The categorical default. Okabe-Ito is color-blind safe and print safe. */
export const DEFAULT_PALETTE_ID = "okabe";

/** The grey ramp a mono palette falls back to for non-bar plot kinds. */
export const GREY_RAMP_ID = "cb-greys";

const BY_ID = new Map(PALETTES.map((p) => [p.id, p]));

/**
 * Look up a palette by id, falling back to the default when an id is unknown (an
 * old spec, a deleted personal palette). Never returns undefined so callers do
 * not have to null-check on the hot render path. A second argument lets the
 * studio fold in the user's personal palettes for lookup.
 */
export function paletteById(id: string | undefined, extra?: Palette[]): Palette {
  if (id) {
    const found = BY_ID.get(id) ?? extra?.find((p) => p.id === id);
    if (found) return found;
  }
  return BY_ID.get(DEFAULT_PALETTE_ID) ?? PALETTES[0];
}

// ---------------------------------------------------------------------------
// hex <-> HSL (for the qualitative overflow lightness shift)
// ---------------------------------------------------------------------------

/** Parse a #rrggbb (or #rgb) hex into 0..255 channels. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Format 0..255 channels into a #rrggbb hex. */
function rgbToHex(r: number, g: number, b: number): string {
  const to = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Convert a hex to {h: 0..360, s: 0..1, l: 0..1}. */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l };
}

/** Convert {h,s,l} back to a hex. */
function hslToHex(h: number, s: number, l: number): string {
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) {
    const v = Math.round(l * 255);
    return rgbToHex(v, v, v);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  const channel = (t: number) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };
  return rgbToHex(
    channel(hk + 1 / 3) * 255,
    channel(hk) * 255,
    channel(hk - 1 / 3) * 255,
  );
}

/** Shift a hex's lightness by a fraction (+lighter / -darker), clamped. */
function shiftLightness(hex: string, deltaL: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0.06, Math.min(0.94, l + deltaL)));
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Sample a palette to exactly n colors for an n-series figure.
 *
 * sequential -> n evenly spaced stops along the ramp (n === 1 takes the middle
 * stop so a single series is the representative mid-tone, not an endpoint).
 *
 * mono(pattern) -> n copies of the base gray; the renderer distinguishes series
 * by hatch / dot PATTERN, not by color, so this returns the flat gray n times.
 *
 * qualitative -> the first n distinct hues when n fits; when n OVERFLOWS the
 * palette length it cycles the hue sequence and shifts lightness each cycle
 * (cycle 2 lighter, cycle 3 darker, cycle 4 lighter still, ...) so no EXACT
 * color repeats until hue x lightness combinations exhaust. This keeps an
 * 8-color palette usable for a 14-series plot without two identical bars.
 */
export function samplePalette(p: Palette, n: number): string[] {
  const count = Math.max(0, Math.floor(n));
  if (count === 0) return [];

  if (p.pattern || p.category === "mono") {
    const base = p.colors[0] ?? "#c2c7cf";
    return Array.from({ length: count }, () => base);
  }

  if (p.category === "sequential") {
    const stops = p.colors;
    if (stops.length === 0) return Array.from({ length: count }, () => "#000000");
    if (count === 1) return [stops[Math.floor(stops.length / 2)]];
    return Array.from({ length: count }, (_, i) =>
      stops[Math.round((i * (stops.length - 1)) / (count - 1))],
    );
  }

  // Qualitative.
  const base = p.colors;
  if (base.length === 0) return Array.from({ length: count }, () => "#000000");
  if (count <= base.length) return base.slice(0, count);

  // Overflow: cycle hues, shifting lightness each lap so cycled colors stay
  // distinct from the originals (and from each other across laps).
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const cycle = Math.floor(i / base.length);
    const hue = base[i % base.length];
    if (cycle === 0) {
      out.push(hue);
      continue;
    }
    // cycle 1 lighter (+14%), cycle 2 darker (-14%), cycle 3 lighter (+28%), ...
    const magnitude = 0.14 * Math.ceil(cycle / 2);
    const sign = cycle % 2 === 1 ? 1 : -1;
    out.push(shiftLightness(hue, sign * magnitude));
  }
  return out;
}

/** True when a palette can supply n distinct-enough colors for the studio filter. */
export function paletteUsableForCount(p: Palette, n: number): boolean {
  // Sequential ramps and the overflow-capable qualitative engine can always
  // produce n; the filter exists to hint, so qualitative palettes with fewer
  // base colors than n are hidden unless they are the ramps.
  if (p.category === "sequential" || p.category === "mono") return true;
  return p.colors.length >= n;
}
