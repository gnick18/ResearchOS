"use client";

// PaletteStudio (Data Hub graphs slice). The color studio that replaces the old
// single "Color" dropdown in the Graph style panel. Ported from the approved
// mockup (docs/mockups/data-hub-palette-studio.html): filter palettes by how
// many series the plot has, browse a scrollable library with the live figure as
// the preview, switch to custom per-series colors, generate + lock a palette
// (the Coolors move), import from a coolors.co URL, and save your own palettes.
//
// The why: researchers expect Prism / Coolors style palette choice, and one
// palette sampled to the series count recolors the whole figure consistently.
// Picking a palette writes style.palette; custom / generate / direct-edit write
// style.colorOverrides; both round-trip through the versioned PlotSpec.
//
// House style: <Icon> only (no inline svg), Tooltip on icon-only buttons, brand
// + semantic tokens, no emojis / em-dashes / mid-sentence colons.

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import type { PlotStyle } from "@/lib/datahub/plot-spec";
import {
  PALETTES,
  paletteById,
  samplePalette,
  paletteUsableForCount,
  parseColorsFromText,
  generateHarmonious,
  isHexColor,
  type Palette,
} from "@/lib/datahub/palettes";
import {
  loadUserPalettes,
  addUserPalette,
  removeUserPalette,
  newUserPaletteId,
} from "@/lib/datahub/user-palettes";

type Category = "all" | "qualitative" | "sequential" | "mono";
type Mode = "library" | "custom" | "generate";

/** A row of color swatches, used for the library cards and the custom list. */
function SwatchRow({ colors }: { colors: string[] }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border">
      {colors.map((c, i) => (
        <div
          key={i}
          className="h-6 flex-1"
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

/** A small segmented control matched to the GraphEditor styling. */
function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-2 py-1 text-[11px] font-medium transition-colors ${
              i > 0 ? "border-l border-border" : ""
            } ${
              active
                ? "bg-accent-soft text-accent"
                : "bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PaletteStudio({
  style,
  seriesCount,
  seriesNames,
  resolvedColors,
  onStyleChange,
}: {
  style: PlotStyle;
  /** The plot's actual series count, auto-detected from the resolved groups. */
  seriesCount: number;
  /** Per-series display names for the custom list (best-effort). */
  seriesNames: string[];
  /** The colors the figure is currently drawing, for the custom list seed. */
  resolvedColors: string[];
  onStyleChange: (patch: Partial<PlotStyle>) => void;
}) {
  const [userPalettes, setUserPalettes] = useState<Palette[]>(() =>
    loadUserPalettes(),
  );
  const [mode, setMode] = useState<Mode>("library");
  const [category, setCategory] = useState<Category>("all");
  const [cbOnly, setCbOnly] = useState(false);
  const [printOnly, setPrintOnly] = useState(false);
  // The filter count defaults to the plot's real series count but is adjustable
  // so a researcher can browse for a future, larger plot.
  const [filterN, setFilterN] = useState(Math.max(1, seriesCount));

  // Generate + lock working state.
  const [genColors, setGenColors] = useState<string[]>(() =>
    resolvedColors.length ? resolvedColors.slice() : ["#264653", "#2A9D8F", "#E9C46A"],
  );
  const [locks, setLocks] = useState<boolean[]>(() =>
    new Array(Math.max(1, seriesCount)).fill(false),
  );
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  const library = useMemo(() => [...PALETTES, ...userPalettes], [userPalettes]);

  const filtered = useMemo(
    () =>
      library.filter(
        (p) =>
          (category === "all" || p.category === category) &&
          (!cbOnly || p.cbSafe) &&
          (!printOnly || p.printSafe) &&
          paletteUsableForCount(p, filterN),
      ),
    [library, category, cbOnly, printOnly, filterN],
  );

  const activeId = style.palette;

  // --- library actions ---
  const pickPalette = (id: string) => {
    // Clear per-series overrides so the chosen palette shows through cleanly.
    onStyleChange({ palette: id, colorOverrides: {} });
  };

  // --- custom per-series actions ---
  const setOverride = (i: number, hex: string) => {
    const next = { ...(style.colorOverrides ?? {}) };
    next[i] = hex;
    onStyleChange({ colorOverrides: next });
  };
  const resetOverrides = () => onStyleChange({ colorOverrides: {} });

  // --- generate + lock actions ---
  const ensureLen = (arr: string[], n: number, fill: string) => {
    const out = arr.slice(0, n);
    while (out.length < n) out.push(fill);
    return out;
  };
  const genN = Math.max(1, seriesCount);
  const generate = () => {
    const seeded = ensureLen(genColors, genN, "#cccccc");
    const lockArr = ensureLen(
      locks.map((l) => (l ? "1" : "")),
      genN,
      "",
    ).map((s) => s === "1");
    setGenColors(generateHarmonious(seeded, lockArr, genN));
    setLocks(lockArr);
  };
  const toggleLock = (i: number) =>
    setLocks((prev) => {
      const next = ensureLen(
        prev.map((l) => (l ? "1" : "")),
        genN,
        "",
      ).map((s) => s === "1");
      next[i] = !next[i];
      return next;
    });
  const setGenColor = (i: number, hex: string) =>
    setGenColors((prev) => {
      const next = ensureLen(prev, genN, "#cccccc");
      next[i] = hex;
      return next;
    });
  const applyGenerated = () => {
    // Write the generated colors straight into overrides so they apply now.
    const next: Record<number, string> = {};
    ensureLen(genColors, genN, "#cccccc").forEach((c, i) => {
      next[i] = c;
    });
    onStyleChange({ colorOverrides: next });
  };
  const saveGenerated = () => {
    const colors = ensureLen(genColors, genN, "#cccccc");
    const p: Palette = {
      id: newUserPaletteId(),
      name: "My palette",
      category: "qualitative",
      cbSafe: false,
      printSafe: false,
      colors,
    };
    setUserPalettes(addUserPalette(p));
    onStyleChange({ palette: p.id, colorOverrides: {} });
  };

  // --- Coolors import ---
  const importColors = () => {
    const hexes = parseColorsFromText(importText);
    if (hexes.length < 2) {
      setImportError(
        "Paste at least two hex colors or a coolors.co URL like coolors.co/264653-2a9d8f.",
      );
      return;
    }
    const p: Palette = {
      id: newUserPaletteId(),
      name: "Imported palette",
      category: "qualitative",
      cbSafe: false,
      printSafe: false,
      colors: hexes,
    };
    setUserPalettes(addUserPalette(p));
    onStyleChange({ palette: p.id, colorOverrides: {} });
    setImportText("");
    setImportError("");
  };

  const deleteUserPalette = (id: string) => {
    setUserPalettes(removeUserPalette(id));
    if (activeId === id) onStyleChange({ palette: undefined });
  };

  const userIds = new Set(userPalettes.map((p) => p.id));

  return (
    <div className="mt-3 border-t border-border pt-3" data-testid="palette-studio">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-foreground-muted">
          Colors
        </span>
        <Seg<Mode>
          value={mode}
          options={[
            { value: "library", label: "Library" },
            { value: "custom", label: "Custom" },
            { value: "generate", label: "Generate" },
          ]}
          onChange={setMode}
        />
      </div>

      {mode === "library" && (
        <div data-testid="palette-library">
          {/* Filters */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface-raised px-1.5 py-1">
              <span className="text-[10px] font-semibold text-foreground-muted">
                Series
              </span>
              <Tooltip label="Show one fewer series">
                <button
                  type="button"
                  onClick={() => setFilterN((n) => Math.max(1, n - 1))}
                  className="flex h-5 w-5 items-center justify-center rounded bg-surface-sunken text-foreground hover:bg-surface-overlay"
                  aria-label="Fewer series"
                >
                  <Icon name="minus" className="h-3 w-3" />
                </button>
              </Tooltip>
              <span className="min-w-[18px] text-center text-[13px] font-bold tabular-nums">
                {filterN}
              </span>
              <Tooltip label="Show one more series">
                <button
                  type="button"
                  onClick={() => setFilterN((n) => Math.min(20, n + 1))}
                  className="flex h-5 w-5 items-center justify-center rounded bg-surface-sunken text-foreground hover:bg-surface-overlay"
                  aria-label="More series"
                >
                  <Icon name="plus" className="h-3 w-3" />
                </button>
              </Tooltip>
            </div>
            <button
              type="button"
              onClick={() => setCbOnly((v) => !v)}
              className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                cbOnly
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-border bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
              }`}
            >
              Color-blind safe
            </button>
            <button
              type="button"
              onClick={() => setPrintOnly((v) => !v)}
              className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                printOnly
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-surface-raised text-foreground-muted hover:bg-surface-sunken"
              }`}
            >
              Print safe
            </button>
          </div>

          <div className="mb-2">
            <Seg<Category>
              value={category}
              options={[
                { value: "all", label: "All" },
                { value: "qualitative", label: "Qualitative" },
                { value: "sequential", label: "Sequential" },
                { value: "mono", label: "Mono" },
              ]}
              onChange={setCategory}
            />
          </div>

          <p className="mb-1.5 text-[10px] text-foreground-muted">
            {filtered.length} palettes give {filterN} or more distinct colors. The
            figure on the left is the live preview.
          </p>

          {/* Scrollable grid */}
          <div className="max-h-[280px] space-y-1.5 overflow-y-auto pr-1">
            {filtered.map((p) => {
              const cols = samplePalette(p, filterN);
              const active = p.id === activeId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickPalette(p.id)}
                  className={`w-full rounded-md border p-2 text-left transition-colors ${
                    active
                      ? "border-accent ring-2 ring-accent/30"
                      : "border-border hover:border-accent"
                  }`}
                  data-testid={`palette-card-${p.id}`}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-foreground">
                      {p.name}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      {p.cbSafe && (
                        <span className="rounded-full bg-green-600/15 px-1.5 py-0.5 text-[8px] font-bold text-green-700">
                          CB
                        </span>
                      )}
                      {p.printSafe && (
                        <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[8px] font-bold text-accent">
                          print
                        </span>
                      )}
                      {p.category === "sequential" ? (
                        <span className="rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[8px] font-bold text-purple-600">
                          any N
                        </span>
                      ) : (
                        <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[8px] font-bold text-foreground-muted">
                          {p.colors.length}
                        </span>
                      )}
                      {userIds.has(p.id) && (
                        <Tooltip label="Delete this saved palette">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteUserPalette(p.id);
                            }}
                            className="flex h-4 w-4 items-center justify-center rounded text-foreground-muted hover:text-red-600"
                            aria-label="Delete saved palette"
                          >
                            <Icon name="trash" className="h-3 w-3" />
                          </button>
                        </Tooltip>
                      )}
                    </span>
                  </div>
                  <SwatchRow colors={cols} />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="py-3 text-center text-[11px] text-foreground-muted">
                No palette has {filterN} distinct colors with those filters. Lower
                the series count or turn off a filter.
              </p>
            )}
          </div>
        </div>
      )}

      {mode === "custom" && (
        <div data-testid="palette-custom">
          <p className="mb-2 text-[10px] text-foreground-muted">
            Set each series color by hand. A custom color overrides the palette
            for that series only.
          </p>
          <div className="space-y-1.5">
            {Array.from({ length: Math.max(1, seriesCount) }).map((_, i) => {
              const current =
                style.colorOverrides?.[i] ?? resolvedColors[i] ?? "#888888";
              return (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={isHexColor(current) ? current : "#888888"}
                    onChange={(e) => setOverride(i, e.target.value)}
                    className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0"
                    aria-label={`Color for ${seriesNames[i] ?? `series ${i + 1}`}`}
                  />
                  <span className="truncate text-[11px] text-foreground">
                    {seriesNames[i] ?? `Series ${i + 1}`}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-foreground-muted">
                    {(style.colorOverrides?.[i] ?? "").toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={resetOverrides}
            className="mt-2 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-sunken"
          >
            <Icon name="refresh" className="h-3 w-3" />
            Reset to palette
          </button>
        </div>
      )}

      {mode === "generate" && (
        <div data-testid="palette-generate">
          <p className="mb-2 text-[10px] text-foreground-muted">
            Lock the colors you like, then generate the rest. This is the Coolors
            move. Apply writes the colors onto the figure now.
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: genN }).map((_, i) => {
              const c = genColors[i] ?? "#cccccc";
              const locked = locks[i] ?? false;
              return (
                <div key={i} className="text-center">
                  <input
                    type="color"
                    value={isHexColor(c) ? c : "#cccccc"}
                    onChange={(e) => setGenColor(i, e.target.value)}
                    className="h-10 w-10 cursor-pointer rounded-md border border-border bg-transparent p-0"
                    aria-label={`Generated color ${i + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleLock(i)}
                    className={`mt-1 flex w-full items-center justify-center gap-0.5 text-[9px] font-semibold ${
                      locked ? "text-accent" : "text-foreground-muted"
                    }`}
                  >
                    <Icon name="lock" className="h-2.5 w-2.5" />
                    {locked ? "locked" : "lock"}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={generate}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-sunken"
            >
              <Icon name="refresh" className="h-3 w-3" />
              Generate unlocked
            </button>
            <button
              type="button"
              onClick={applyGenerated}
              className="rounded-md border border-accent bg-accent px-2 py-1 text-[11px] font-medium text-white transition-colors hover:opacity-90"
            >
              Apply to figure
            </button>
            <button
              type="button"
              onClick={saveGenerated}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-sunken"
            >
              <Icon name="save" className="h-3 w-3" />
              Save to my palettes
            </button>
          </div>

          <div className="mt-3 border-t border-border pt-2">
            <label className="block text-[10px] font-semibold text-foreground-muted">
              Import from Coolors
            </label>
            <div className="mt-1 flex gap-1.5">
              <input
                type="text"
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setImportError("");
                }}
                placeholder="Paste hexes or a coolors.co URL"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-overlay px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
                data-testid="palette-import-input"
              />
              <button
                type="button"
                onClick={importColors}
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-sunken"
                data-testid="palette-import-button"
              >
                <Icon name="import" className="h-3 w-3" />
                Import
              </button>
            </div>
            {importError && (
              <p className="mt-1 text-[10px] text-red-600">{importError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
