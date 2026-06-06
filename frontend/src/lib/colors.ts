// Color helpers for user avatars and other per-user color UI.
// No React, safe to import anywhere. Imports only the rainbow sentinels from
// user-metadata (a leaf module), so no import cycle.

import { RAINBOW_COLOR, RAINBOW_VIVID_COLOR } from "@/lib/file-system/user-metadata";

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
 * The "rainbow" user theme: BeakerBot's exact 5-stop pastel body liquid. Used
 * for the rainbow user's avatar, the app header tint, and anywhere the rainbow
 * identity renders, so they all match. Diagonal for square avatar chips,
 * horizontal for the wide app header. The stops are pastel (high lightness), so
 * the readable foreground is a dark ink, not white.
 */
// Circular contexts (avatars, swatches) use a CONIC sweep so the ramp reads as
// a smooth rainbow ring — a linear diagonal puts the end colors in solid corner
// wedges, which on a small circle looks like a faceted "square in a circle"
// (very visible with the saturated vivid stops). The last stop repeats the
// first so the wheel closes seamlessly. The wide HEADER stays linear (a conic
// sweep on a long bar would look like a pinwheel).
export const RAINBOW_AVATAR_GRADIENT =
  "conic-gradient(from 135deg, #FFD2B0, #FFF1A8, #B7EBB1, #A6D2F4, #D6B5F0, #FFD2B0)";
export const RAINBOW_HEADER_GRADIENT =
  "linear-gradient(to right, #FFD2B0, #FFF1A8, #B7EBB1, #A6D2F4, #D6B5F0)";
export const RAINBOW_FOREGROUND = "#0f1b2e";

/**
 * The VIVID rainbow theme: the saturated 5-stop ramp (the same one dark mode
 * uses, --brand-rainbow-vivid). A bolder alternative to the pastel rainbow.
 * White foreground since the stops are saturated, not pastel.
 */
export const RAINBOW_VIVID_AVATAR_GRADIENT =
  "conic-gradient(from 135deg, #F97316, #E8920B, #16A34A, #0284C7, #9333EA, #F97316)";
export const RAINBOW_VIVID_HEADER_GRADIENT =
  "linear-gradient(to right, #F97316, #E8920B, #16A34A, #0284C7, #9333EA)";
export const RAINBOW_VIVID_FOREGROUND = "#ffffff";

/**
 * Single source for resolving a user color to its rainbow treatment. Returns
 * null for ordinary hex colors. Used by the header tint, the avatar chips, and
 * the menu so both rainbow options render identically everywhere.
 */
export function rainbowTheme(
  color: string,
): { avatar: string; header: string; fg: string } | null {
  if (color === RAINBOW_COLOR) {
    return {
      avatar: RAINBOW_AVATAR_GRADIENT,
      header: RAINBOW_HEADER_GRADIENT,
      fg: RAINBOW_FOREGROUND,
    };
  }
  if (color === RAINBOW_VIVID_COLOR) {
    return {
      avatar: RAINBOW_VIVID_AVATAR_GRADIENT,
      header: RAINBOW_VIVID_HEADER_GRADIENT,
      fg: RAINBOW_VIVID_FOREGROUND,
    };
  }
  return null;
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

/**
 * Returns the better-contrasting text color for a given background.
 * Uses the YIQ perceptual-brightness formula (the same heuristic Google
 * Calendar / Outlook use for filled event chips) — slightly less precise
 * than WCAG relative luminance but simpler and visually pleasant.
 *
 * Light backgrounds get a soft slate (`#1f2937`) rather than pure black,
 * which prevents the harsh "ink on highlighter" look on pastel fills.
 * Dark backgrounds get white.
 *
 * Accepts `#rgb`, `#rrggbb`, and `rgb(...)` / `rgba(...)` strings. Any
 * invalid input falls back to white (safest default — assumes a colorful
 * fill was intended).
 */
export function getReadableTextColor(bg: string | null | undefined): string {
  if (!bg) return "#ffffff";
  const trimmed = bg.trim();

  let r = NaN;
  let g = NaN;
  let b = NaN;

  if (trimmed.startsWith("rgb")) {
    // rgb(r, g, b) / rgba(r, g, b, a) — strip alpha if present
    const inside = trimmed.replace(/^rgba?\s*\(/i, "").replace(/\)\s*$/, "");
    const parts = inside.split(",").map((s) => s.trim());
    if (parts.length >= 3) {
      r = parseInt(parts[0], 10);
      g = parseInt(parts[1], 10);
      b = parseInt(parts[2], 10);
    }
  } else {
    let h = trimmed.replace(/^#/, "");
    if (h.length === 3) {
      h = h.split("").map((c) => c + c).join("");
    }
    if (h.length === 6 && /^[0-9a-f]{6}$/i.test(h)) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
  }

  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return "#ffffff";
  }

  // YIQ brightness — weights tuned for human perception.
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#1f2937" : "#ffffff";
}
