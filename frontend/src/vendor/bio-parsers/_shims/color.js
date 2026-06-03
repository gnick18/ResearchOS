// sequence Phase 1 bot — minimal local shim for the `color` npm package, used
// by the vendored `jsonToGenbank` writer. Only the single call shape the
// writer uses is implemented:
//     color.rgb(input).string()
// The writer compares a feature's color against the default feature color to
// decide whether to emit a `/color=` qualifier; both sides go through this
// helper, so the only requirement is a STABLE canonical string for equal
// colors. We parse hex (#rgb / #rrggbb), rgb()/rgba(), and a small set of
// named colors into an [r,g,b] triple and render it as "rgb(r, g, b)".

const NAMED = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
};

function clamp(n) {
  n = Math.round(Number(n) || 0);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function parse(input) {
  if (Array.isArray(input)) {
    return [clamp(input[0]), clamp(input[1]), clamp(input[2])];
  }
  if (input && typeof input === "object") {
    return [clamp(input.r), clamp(input.g), clamp(input.b)];
  }
  const str = String(input || "").trim().toLowerCase();
  if (NAMED[str]) return NAMED[str].slice();
  if (str.startsWith("#")) {
    let hex = str.slice(1);
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return [0, 0, 0];
  }
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((p) => p.trim());
    return [clamp(parts[0]), clamp(parts[1]), clamp(parts[2])];
  }
  // Unknown format: hash it to a deterministic-but-arbitrary triple so unequal
  // unknown strings stay unequal and equal strings stay equal.
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffff;
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}

class ColorValue {
  constructor(rgb) {
    this._rgb = rgb;
  }
  string() {
    const [r, g, b] = this._rgb;
    return `rgb(${r}, ${g}, ${b})`;
  }
}

const color = {
  rgb(input) {
    return new ColorValue(parse(input));
  },
};

export default color;
