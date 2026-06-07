// WCAG contrast helpers + the dark/light token contrast report.
//
// The point of this module is a vitest gate (contrast.gate.test.ts) that reads
// the semantic theme tokens straight out of globals.css and fails if any
// text-on-surface pair drops below its WCAG AA threshold in either theme, so a
// future token tweak can't silently make text illegible in dark (or light)
// mode. globals.css stays the single source of truth; we parse it rather than
// duplicate the values here.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse "#rgb" / "#rrggbb" into 0-255 channels. Returns null for non-hex. */
export function parseHex(value: string): Rgb | null {
  let h = value.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Parse a CSS color we use in tokens: "#rgb"/"#rrggbb" or "rgba(r,g,b,a)".
 * An rgba is composited over `backdrop` (the surface it sits on) so the
 * effective on-screen color is what we score. Returns null if unparseable.
 */
export function parseColor(value: string, backdrop?: Rgb): Rgb | null {
  const hex = parseHex(value);
  if (hex) return hex;

  const m = value
    .trim()
    .match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a >= 1 || !backdrop) return { r, g, b };
  // Composite source-over onto the backdrop.
  return {
    r: r * a + backdrop.r * (1 - a),
    g: g * a + backdrop.g * (1 - a),
    b: b * a + backdrop.b * (1 - a),
  };
}

/** WCAG relative luminance of an sRGB color. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors (>= 1, higher is better). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type ThemeName = "light" | "dark";
export type Tokens = Record<string, string>;

/**
 * Extract the semantic tokens from globals.css for both themes. Light tokens
 * come from the `:root {` block; dark from the `[data-theme="dark"] {` block.
 * Only `--name: value;` declarations are captured.
 */
export function parseThemeTokens(css: string): Record<ThemeName, Tokens> {
  const grab = (selector: RegExp): Tokens => {
    const start = css.search(selector);
    if (start === -1) return {};
    // Find the first "{" after the selector, then match to its closing "}".
    const open = css.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = css.slice(open + 1, end);
    const tokens: Tokens = {};
    const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(body)) !== null) {
      // Strip trailing inline comments captured into the value.
      tokens[mm[1].trim()] = mm[2].replace(/\/\*.*$/, "").trim();
    }
    return tokens;
  };

  return {
    light: grab(/:root\s*\{/),
    dark: grab(/\[data-theme="dark"\]\s*\{/),
  };
}

export interface ContrastCheck {
  theme: ThemeName;
  fg: string;
  bg: string;
  label: string;
  /** "text" = AA normal (4.5:1); "ui" = AA large text / UI (3:1). */
  level: "text" | "ui";
  ratio: number;
  min: number;
  pass: boolean;
}

const MIN = { text: 4.5, ui: 3 } as const;

// The pairs we enforce. Body/secondary text must clear AA normal on every
// surface it can sit on; the accent (used for active nav labels + icons, which
// are large/semibold) must clear AA large/UI.
const TEXT_FG = ["--foreground", "--foreground-muted"];
const SURFACES = ["--surface", "--surface-raised", "--surface-sunken"];
const UI_FG = ["--accent"];

// Sequence-editor canvas legibility. The base letters and the translation
// amino-acid letters are read like body text on the editor background, so they
// must clear AA text. This locks the --seq-* palette against a future darkening
// that would make the sequence itself unreadable. The ruler tick numbers are
// intentionally faint decorative elements (SnapGene-style), not gated.
const SEQ_BG = "--seq-bg";
const SEQ_PAIRS: Array<[string, "text" | "ui"]> = [
  ["--seq-letter", "text"],
  ["--seq-translation", "text"],
];

export function buildContrastReport(
  tokensByTheme: Record<ThemeName, Tokens>,
): ContrastCheck[] {
  const checks: ContrastCheck[] = [];
  (Object.keys(tokensByTheme) as ThemeName[]).forEach((theme) => {
    const t = tokensByTheme[theme];
    const pairs: Array<[string, "text" | "ui"]> = [
      ...TEXT_FG.map((fg) => [fg, "text"] as [string, "text"]),
      ...UI_FG.map((fg) => [fg, "ui"] as [string, "ui"]),
    ];
    for (const [fg, level] of pairs) {
      for (const bg of SURFACES) {
        const bgRgb = parseColor(t[bg]);
        const fgRgb = parseColor(t[fg], bgRgb ?? undefined);
        if (!bgRgb || !fgRgb) continue;
        const ratio = contrastRatio(fgRgb, bgRgb);
        const min = MIN[level];
        checks.push({
          theme,
          fg,
          bg,
          label: `${fg} on ${bg}`,
          level,
          ratio: Math.round(ratio * 100) / 100,
          min,
          pass: ratio >= min,
        });
      }
    }
    // Sequence-editor canvas pairs (single background: --seq-bg).
    const seqBgRgb = parseColor(t[SEQ_BG]);
    if (seqBgRgb) {
      for (const [fg, level] of SEQ_PAIRS) {
        const fgRgb = parseColor(t[fg], seqBgRgb);
        if (!fgRgb) continue;
        const ratio = contrastRatio(fgRgb, seqBgRgb);
        const min = MIN[level];
        checks.push({
          theme,
          fg,
          bg: SEQ_BG,
          label: `${fg} on ${SEQ_BG}`,
          level,
          ratio: Math.round(ratio * 100) / 100,
          min,
          pass: ratio >= min,
        });
      }
    }
  });
  return checks;
}
