// Color helpers for user avatars and other per-user color UI.
// Self-contained — no React, safe to import anywhere.

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function normalizeHex(hex: string): string {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  return h.length === 6 ? `#${h.toLowerCase()}` : "#3b82f6";
}

export function hexToHsl(hex: string): HSL {
  const h = normalizeHex(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let s = 0;
  let hue = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: hue = ((b - r) / d + 2); break;
      case b: hue = ((r - g) / d + 4); break;
    }
    hue *= 60;
  }

  return { h: hue, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: HSL): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const lit = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lit - c / 2;

  let r = 0, g = 0, b = 0;
  if (hue < 60)       { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else                { r = c; g = 0; b = x; }

  const toHex = (n: number) =>
    Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Deeper, full-opacity two-stop gradient sized for the app header
 * background. Same hue family as the avatar gradient (stop 2 hue shifted
 * -40°) but the lightness range is clamped lower so the colors stay
 * saturated and "modern" rather than pastel. Designed to sit under
 * floating white pill nav items.
 */
export function headerGradient(baseHex: string): [string, string] {
  const hsl = hexToHsl(baseHex);
  const stop1 = hslToHex({
    h: hsl.h,
    s: clamp(hsl.s * 0.95, 45, 90),
    l: clamp(hsl.l - 4, 30, 46),
  });
  const stop2 = hslToHex({
    h: hsl.h - 40,
    s: clamp(hsl.s * 0.9, 40, 85),
    l: clamp(hsl.l + 6, 36, 54),
  });
  return [stop1, stop2];
}

/**
 * Picks a pleasing two-stop gradient anchored on `baseHex`. Stop 2 is the
 * same hue shifted -40° on the color wheel (toward yellow when starting
 * from any cool color, toward pink/magenta from warm ones) and lightened
 * by ~16%. Reads as a single "color family" — green pulls toward yellow,
 * blue pulls toward cyan, red pulls toward orange — instead of looking
 * like two random colors stitched together.
 */
export function avatarGradient(baseHex: string): [string, string] {
  const hsl = hexToHsl(baseHex);
  const stop1 = hslToHex({
    h: hsl.h,
    s: clamp(hsl.s * 1.05, 0, 95),
    l: clamp(hsl.l, 30, 60),
  });
  const stop2 = hslToHex({
    h: hsl.h - 40,
    s: clamp(hsl.s * 0.95, 35, 95),
    l: clamp(hsl.l + 16, 45, 80),
  });
  return [stop1, stop2];
}

/**
 * Deterministic fallback color when no user metadata is loaded yet (e.g.
 * the pre-folder picker screen). Hashes username → palette index.
 */
const FALLBACK_PALETTE = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

export function fallbackColorForUsername(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}

/** Convert "#rrggbb" → "rgba(r, g, b, a)" for translucent overlays. */
export function hexToRgba(hex: string, alpha: number): string {
  const h = normalizeHex(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}
