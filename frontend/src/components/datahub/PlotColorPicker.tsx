"use client";

// PlotColorPicker (Data Hub graphs slice). A compact inline color picker for the
// single-series case in the graph dock, modeled on Illustrator's Color panel. A
// palette is meaningless when the figure draws only one color, so instead of the
// palette studio we show a direct picker: a 2D saturation / value area, a hue
// slider, a hex field, and a small native color input as a reliable fallback.
//
// The why: with one series there is no palette to sample, so the researcher just
// wants to set that one color the fast, familiar way. This sets a single
// colorOverrides entry, the same field the on-plot double-click editor writes.
//
// HSV is the natural space for a saturation / value square (the white-to-color
// horizontal gradient over a transparent-to-black vertical gradient), so the
// math lives inline here rather than reusing the HSL helpers in lib/colors.
//
// House style: <Icon> only (no inline svg), Tooltip on icon-only buttons, no
// emojis / em-dashes / mid-sentence colons. Colors are div gradients, so no svg.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

const RECENT_KEY = "datahub-recent-colors";
const RECENT_MAX = 8;

interface HSV {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** True for a "#rrggbb" string (the canonical form we store). */
function isFullHex(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

/** Accepts "#rgb" / "#rrggbb" (with or without the hash) and returns "#rrggbb". */
function normalizeHex(input: string): string | null {
  let h = input.trim().replace(/^#/, "");
  if (h.length === 3 && /^[0-9a-fA-F]{3}$/.test(h)) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toLowerCase()}` : null;
}

export function hexToHsv(hex: string): HSV {
  const norm = normalizeHex(hex) ?? "#888888";
  const h = norm.slice(1);
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const s = max === 0 ? 0 : d / max;
  return { h: hue, s, v: max };
}

export function hsvToHex({ h, s, v }: HSV): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const val = clamp(v, 0, 1);

  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** The pure hue (full saturation + value) for the saturation / value backdrop. */
function hueHex(h: number): string {
  return hsvToHex({ h, s: 1, v: 1 });
}

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((c) => typeof c === "string" && isFullHex(c)).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function pushRecent(hex: string): string[] {
  const norm = normalizeHex(hex);
  if (!norm) return loadRecent();
  const next = [norm, ...loadRecent().filter((c) => c !== norm)].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage can throw in private mode; recent colors are a nicety, skip.
  }
  return next;
}

export default function PlotColorPicker({
  value,
  onChange,
}: {
  /** The current series color, "#rrggbb". */
  value: string;
  /** Fires on every drag step and on commit, so the figure recolors live. */
  onChange: (hex: string) => void;
}) {
  // The picker's working HSV. Seeded from the incoming hex and re-seeded when the
  // hex changes from the outside (e.g. the on-plot editor wrote an override).
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  // The hex field is its own text state so a researcher can type a partial value
  // without it being clobbered mid-keystroke. Committed on valid input / blur.
  const [hexText, setHexText] = useState<string>(() => normalizeHex(value) ?? "#888888");
  const [recent, setRecent] = useState<string[]>([]);

  const areaRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);

  // Load recent colors after mount (localStorage is client-only).
  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  // Re-seed from an external value change (on-plot edit, undo, palette swap).
  // Guard against echoing our own change by comparing canonical hex.
  const current = hsvToHex(hsv);
  useEffect(() => {
    const norm = normalizeHex(value);
    if (norm && norm !== current) {
      setHsv(hexToHsv(norm));
      setHexText(norm);
    }
    // current is derived from hsv; we intentionally only react to value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = useCallback(
    (next: HSV, opts?: { persist?: boolean }) => {
      const hex = hsvToHex(next);
      setHsv(next);
      setHexText(hex);
      onChange(hex);
      if (opts?.persist) setRecent(pushRecent(hex));
    },
    [onChange],
  );

  // --- saturation / value area drag ---
  const pointFromArea = useCallback((clientX: number, clientY: number): { s: number; v: number } => {
    const el = areaRef.current;
    if (!el) return { s: hsv.s, v: hsv.v };
    const rect = el.getBoundingClientRect();
    const s = clamp((clientX - rect.left) / rect.width, 0, 1);
    const v = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
    return { s, v };
  }, [hsv.s, hsv.v]);

  const startAreaDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const first = pointFromArea(e.clientX, e.clientY);
      let latest: HSV = { h: hsv.h, s: first.s, v: first.v };
      commit(latest);
      const move = (ev: PointerEvent) => {
        const p = pointFromArea(ev.clientX, ev.clientY);
        latest = { h: hsv.h, s: p.s, v: p.v };
        commit(latest);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        commit(latest, { persist: true });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [commit, hsv.h, pointFromArea],
  );

  // --- hue strip drag ---
  const hueFromStrip = useCallback((clientX: number): number => {
    const el = hueRef.current;
    if (!el) return hsv.h;
    const rect = el.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * 360;
  }, [hsv.h]);

  const startHueDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      let latest: HSV = { h: hueFromStrip(e.clientX), s: hsv.s, v: hsv.v };
      commit(latest);
      const move = (ev: PointerEvent) => {
        latest = { h: hueFromStrip(ev.clientX), s: hsv.s, v: hsv.v };
        commit(latest);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        commit(latest, { persist: true });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [commit, hsv.s, hsv.v, hueFromStrip],
  );

  // --- hex field ---
  const onHexInput = (raw: string) => {
    setHexText(raw);
    const norm = normalizeHex(raw);
    if (norm) commit(hexToHsv(norm));
  };
  const onHexBlur = () => {
    const norm = normalizeHex(hexText);
    if (norm) {
      setHexText(norm);
      setRecent(pushRecent(norm));
    } else {
      // Snap back to the committed color so the field never shows garbage.
      setHexText(hsvToHex(hsv));
    }
  };

  // --- native input fallback / eyedropper ---
  const onNativeColor = (hex: string) => {
    const norm = normalizeHex(hex);
    if (norm) commit(hexToHsv(norm), { persist: true });
  };

  const pickRecent = (hex: string) => commit(hexToHsv(hex));

  const thumbLeft = `${(hsv.s * 100).toFixed(2)}%`;
  const thumbTop = `${((1 - hsv.v) * 100).toFixed(2)}%`;
  const hueLeft = `${((hsv.h / 360) * 100).toFixed(2)}%`;

  return (
    <div data-testid="plot-color-picker" className="space-y-2">
      <p className="text-[10px] text-foreground-muted">
        This figure draws one color, so set it directly. Drag the box for shade,
        the strip for hue, or type a hex.
      </p>

      {/* Saturation / value area. White-to-hue across, transparent-to-black down. */}
      <div
        ref={areaRef}
        onPointerDown={startAreaDrag}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={`saturation ${Math.round(hsv.s * 100)} percent, brightness ${Math.round(
          hsv.v * 100,
        )} percent`}
        tabIndex={0}
        className="relative h-28 w-full cursor-crosshair touch-none overflow-hidden rounded-md border border-border"
        style={{ backgroundColor: hueHex(hsv.h) }}
      >
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to right, #ffffff, rgba(255,255,255,0))" }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to top, #000000, rgba(0,0,0,0))" }}
        />
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: thumbLeft, top: thumbTop }}
        />
      </div>

      {/* Hue strip. */}
      <div
        ref={hueRef}
        onPointerDown={startHueDrag}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        className="relative h-3 w-full cursor-pointer touch-none rounded-full border border-border"
        style={{
          background:
            "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
        }}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: hueLeft, backgroundColor: hueHex(hsv.h) }}
        />
      </div>

      {/* Hex field + native fallback / eyedropper. */}
      <div className="flex items-center gap-1.5">
        <span
          className="h-7 w-7 shrink-0 rounded-md border border-border"
          style={{ backgroundColor: current }}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-surface-overlay px-2 focus-within:border-sky-400">
          <span className="text-[11px] text-foreground-muted">#</span>
          <input
            type="text"
            value={hexText.replace(/^#/, "")}
            onChange={(e) => onHexInput(e.target.value)}
            onBlur={onHexBlur}
            spellCheck={false}
            aria-label="Hex color"
            className="min-w-0 flex-1 bg-transparent py-1 pl-1 font-mono text-[11px] uppercase text-foreground focus:outline-none"
          />
        </div>
        <Tooltip label="Pick from the system color dialog">
          <label
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border text-foreground-muted transition-colors hover:bg-surface-sunken"
            aria-label="Open the system color picker"
          >
            <Icon name="dropletLow" className="h-3.5 w-3.5" />
            <input
              type="color"
              value={isFullHex(current) ? current : "#888888"}
              onChange={(e) => onNativeColor(e.target.value)}
              className="sr-only"
            />
          </label>
        </Tooltip>
      </div>

      {/* Recent colors (optional, localStorage backed). */}
      {recent.length > 0 && (
        <div data-testid="plot-color-recent">
          <p className="mb-1 text-[10px] text-foreground-muted">Recent</p>
          <div className="flex flex-wrap gap-1">
            {recent.map((c) => (
              <Tooltip key={c} label={c.toUpperCase()}>
                <button
                  type="button"
                  onClick={() => pickRecent(c)}
                  aria-label={`Use ${c.toUpperCase()}`}
                  className={`h-5 w-5 rounded border transition-transform hover:scale-110 ${
                    c === current ? "border-accent ring-1 ring-accent/40" : "border-border"
                  }`}
                  style={{ backgroundColor: c }}
                />
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
