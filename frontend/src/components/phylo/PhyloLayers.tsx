"use client";

// The Tree Studio LAYERS control (phylo Phase 1, the ggtree-class control model).
//
// Replaces the Phase 0 toggle wall. The figure is a STACK of layers you add,
// reorder, show / hide, and configure in a per-layer inspector, the way ggplot,
// Figma, and Illustrator work. A layer row IS an AlignedPanel; the array order is
// the draw order (inner near the tips, outer last). Matches the approved control
// model (docs/mockups/2026-06-13-phylo-control-model.html).
//
// Pieces: LayerList (pointer-drag reorder + eye + delete + select), Inspector
// (only the selected layer's options, progressive disclosure), AddPanelMenu
// (searchable, categorized), Templates ("start from"). Pointer-based drag so it
// is touch-friendly. Icons via <Icon>, tooltips via <Tooltip>, no inline svg.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import { reorderPanels } from "@/lib/phylo/panels";
import type {
  AlignedPanel,
  AlignedPanelKind,
  CladeAnnotation,
} from "@/lib/phylo/types";

/** The Add-panel catalog, categorized for the searchable menu (mockup parity). */
interface CatalogItem {
  kind: AlignedPanelKind;
  name: string;
  desc: string;
}
interface CatalogGroup {
  cat: string;
  items: CatalogItem[];
}
export const PANEL_CATALOG: CatalogGroup[] = [
  {
    cat: "Tip decorations",
    items: [
      { kind: "labels", name: "Tip labels", desc: "taxon names" },
      { kind: "points", name: "Tip points", desc: "colored dot per tip" },
      { kind: "strip", name: "Color strip", desc: "categorical band" },
    ],
  },
  {
    cat: "Aligned data panels",
    items: [
      { kind: "heat", name: "Heatmap", desc: "value matrix, continuous" },
      { kind: "bars", name: "Bar panel", desc: "numeric, aligned" },
      { kind: "dots", name: "Dot panel", desc: "numeric points" },
      { kind: "box", name: "Boxplot", desc: "per-tip distribution" },
      { kind: "violin", name: "Violin", desc: "per-tip density" },
      { kind: "point", name: "Point + error", desc: "mean with SD / SEM whisker" },
      { kind: "scatter", name: "Jitter scatter", desc: "individual replicates" },
    ],
  },
  {
    cat: "Highlights",
    items: [
      { kind: "clade", name: "Clade highlight", desc: "shade a subtree" },
      { kind: "support", name: "Support values", desc: "bootstrap labels" },
    ],
  },
  {
    cat: "Alignment",
    items: [
      { kind: "msa", name: "Sequence alignment", desc: "aligned residue matrix" },
    ],
  },
];

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  PANEL_CATALOG.flatMap((g) => g.items.map((i) => [i.kind, i.name])),
);

/** Which kinds bind a metadata column (show the column / scale fields). */
const COLORED_KINDS = new Set<AlignedPanelKind>([
  "points",
  "strip",
  "heat",
  "bars",
  "dots",
]);
/** Which kinds carry an aligned numeric / value panel scale + legend. */
const DATA_KINDS = new Set<AlignedPanelKind>(["heat", "bars", "dots", "box"]);

/** Sequential ramps offered in the inspector (Data Hub palette ids). */
const SEQUENTIAL_PALETTES: { id: string; label: string }[] = [
  { id: "viridis", label: "Viridis" },
  { id: "cb-blues", label: "Blues" },
  { id: "cb-greens", label: "Greens" },
  { id: "cb-reds", label: "Reds" },
  { id: "cb-purples", label: "Purples" },
  { id: "sky-ramp", label: "Sky" },
];

let panelSeq = 0;
function newPanelId(kind: string): string {
  return `${kind}-${Date.now().toString(36)}-${panelSeq++}`;
}

/** Build a fresh panel for a kind, with sensible defaults from the columns. */
export function makePanel(
  kind: AlignedPanelKind,
  columns: string[],
): AlignedPanel {
  const firstData = columns[0];
  const base: AlignedPanel = { id: newPanelId(kind), kind, visible: true };
  if (kind === "labels") return { ...base, options: { italic: true } };
  if (COLORED_KINDS.has(kind)) {
    if (kind === "heat") {
      return { ...base, columns: firstData ? [firstData] : [], legend: true };
    }
    return { ...base, column: firstData ?? "", legend: true };
  }
  if (kind === "box" || kind === "violin" || kind === "scatter") {
    return {
      ...base,
      columns: columns.slice(0, 3),
      legend: false,
      options: kind === "scatter" ? { jitter: true, axis: true } : { axis: true },
    };
  }
  if (kind === "point") {
    // Default to replicate columns (mean + sd derived), error kind sd, axis on.
    return {
      ...base,
      columns: columns.slice(0, 3),
      legend: false,
      options: { errorKind: "sd", axis: true },
    };
  }
  return base;
}

// ---------------------------------------------------------------------------
// The full layers control (list + inspector + add menu + templates).
// ---------------------------------------------------------------------------

export function PhyloLayersControl({
  panels,
  selectedId,
  columns,
  tipNames = [],
  treeSummary,
  appliedTemplate,
  onChange,
  onSelect,
  onApplyTemplate,
}: {
  panels: AlignedPanel[];
  selectedId: string | null;
  columns: string[];
  /** Every tip name in the tree, for naming clade members (MRCA picker). */
  tipNames?: string[];
  treeSummary: string;
  /** The template id currently applied (drives the picker so it never snaps back
   *  to the placeholder after an apply, the flicker fix). "" when none / edited. */
  appliedTemplate: string;
  onChange: (next: AlignedPanel[]) => void;
  onSelect: (id: string | null) => void;
  onApplyTemplate: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const update = (id: string, patch: Partial<AlignedPanel>) =>
    onChange(panels.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id: string) => {
    onChange(panels.filter((p) => p.id !== id));
    if (selectedId === id) onSelect(null);
  };
  const add = (kind: AlignedPanelKind) => {
    const panel = makePanel(kind, columns);
    onChange([...panels, panel]);
    onSelect(panel.id);
    setMenuOpen(false);
  };
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    onChange(reorderPanels(panels, from, to));
  };

  return (
    <div className="space-y-3">
      <TemplatePicker applied={appliedTemplate} onApply={onApplyTemplate} />
      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-bold text-sm bg-brand-sky text-white hover:opacity-90"
        >
          <Icon name="plus" className="w-4 h-4" /> Add panel
        </button>
        {menuOpen && (
          <AddPanelMenu onAdd={add} onClose={() => setMenuOpen(false)} />
        )}
      </div>

      <div>
        <h3 className="text-[11px] uppercase tracking-wide text-foreground-muted font-semibold mb-2">
          Layers (draw order, inner to outer)
        </h3>
        <BaseLayerRow summary={treeSummary} />
        <LayerList
          panels={panels}
          selectedId={selectedId}
          columns={columns}
          tipNames={tipNames}
          onSelect={onSelect}
          onUpdate={update}
          onRemove={remove}
          onReorder={reorder}
        />
      </div>
    </div>
  );
}

/** The always-present tree base row (not a removable layer). */
function BaseLayerRow({ summary }: { summary: string }) {
  return (
    <div className="border border-border rounded-lg mb-2 bg-surface px-2.5 py-2 flex items-center gap-2">
      <Icon name="tree" className="w-4 h-4 text-brand-sky" />
      <span className="text-sm text-foreground">
        Tree
        <span className="text-xs text-foreground-muted"> · {summary}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The reorderable layer list. Pointer-drag reorder is touch-friendly, no HTML5
// drag-and-drop (synthetic-event-friendly + works on touch).
// ---------------------------------------------------------------------------

function LayerList({
  panels,
  selectedId,
  columns,
  tipNames,
  onSelect,
  onUpdate,
  onRemove,
  onReorder,
}: {
  panels: AlignedPanel[];
  selectedId: string | null;
  columns: string[];
  tipNames: string[];
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<AlignedPanel>) => void;
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Mirror the drag indices in refs so the pointerup EVENT handler can read the
  // final from/to and commit the reorder directly, never from inside a state
  // updater (a setState during render warning fired when onReorder ran there).
  const dragIndexRef = useRef<number | null>(null);
  const overIndexRef = useRef<number | null>(null);

  if (panels.length === 0) {
    return (
      <p className="text-xs text-foreground-muted px-1 py-2">
        No layers yet. Add a panel above, or start from a template.
      </p>
    );
  }

  const onGripDown = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragIndexRef.current = index;
    overIndexRef.current = index;
    setDragIndex(index);
    setOverIndex(index);
    const move = (ev: PointerEvent) => {
      const y = ev.clientY;
      let target = index;
      rowRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (y > r.top && y < r.bottom) target = i;
      });
      overIndexRef.current = target;
      setOverIndex(target);
    };
    const up = () => {
      // Commit from the EVENT handler, reading the final indices from refs, so
      // the parent onChange (setState) never runs during a state-updater render.
      const from = dragIndexRef.current;
      const to = overIndexRef.current;
      dragIndexRef.current = null;
      overIndexRef.current = null;
      setDragIndex(null);
      setOverIndex(null);
      if (from !== null && to !== null) onReorder(from, to);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div>
      {panels.map((panel, index) => {
        const sel = panel.id === selectedId;
        const dragging = dragIndex === index;
        const over = overIndex === index && dragIndex !== null && !dragging;
        return (
          <div
            key={panel.id}
            ref={(el) => {
              rowRefs.current[index] = el;
            }}
            className={`border rounded-lg mb-1.5 bg-surface-raised overflow-hidden transition-shadow ${
              sel ? "border-brand-sky ring-2 ring-sky-100" : "border-border"
            } ${over ? "border-t-2 border-t-brand-sky" : ""} ${
              dragging ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-center gap-2 px-2 py-2">
              <Tooltip label="Drag to reorder">
                <button
                  onPointerDown={onGripDown(index)}
                  className="text-border cursor-grab touch-none px-0.5"
                  aria-label="Drag to reorder"
                >
                  <Icon name="move" className="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip label={panel.visible ? "Hide layer" : "Show layer"}>
                <button
                  onClick={() =>
                    onUpdate(panel.id, { visible: !panel.visible })
                  }
                  className={`w-6 h-6 grid place-items-center rounded border border-border ${
                    panel.visible ? "text-foreground" : "text-border"
                  }`}
                  aria-label={panel.visible ? "Hide layer" : "Show layer"}
                >
                  <Icon
                    name={panel.visible ? "eye" : "eyeOff"}
                    className="w-3.5 h-3.5"
                  />
                </button>
              </Tooltip>
              <button
                onClick={() => onSelect(sel ? null : panel.id)}
                className="flex-1 text-left min-w-0"
              >
                <span className="text-sm text-foreground">
                  {KIND_LABEL[panel.kind] ?? panel.kind}
                </span>
                {(panel.column || panel.columns?.length) && (
                  <span className="text-xs text-foreground-muted truncate">
                    {" · "}
                    {panel.column ?? panel.columns?.join(", ")}
                  </span>
                )}
              </button>
              <Tooltip label="Delete layer">
                <button
                  onClick={() => onRemove(panel.id)}
                  className="text-border hover:text-red-500 px-0.5"
                  aria-label="Delete layer"
                >
                  <Icon name="trash" className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </div>
            {sel && (
              <Inspector
                panel={panel}
                columns={columns}
                tipNames={tipNames}
                onUpdate={(patch) => onUpdate(panel.id, patch)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-layer inspector. Only the selected layer's options, progressive disclosure.
// ---------------------------------------------------------------------------

function Inspector({
  panel,
  columns,
  tipNames,
  onUpdate,
}: {
  panel: AlignedPanel;
  columns: string[];
  tipNames: string[];
  onUpdate: (patch: Partial<AlignedPanel>) => void;
}) {
  const colored = COLORED_KINDS.has(panel.kind);
  const isData = DATA_KINDS.has(panel.kind);
  const continuous = panel.scale?.kind === "continuous";

  return (
    <div className="px-3 pb-3 pt-1 border-t border-border bg-surface space-y-2">
      {colored && panel.kind !== "heat" && (
        <Field label="Column">
          <SelectInput
            value={panel.column ?? ""}
            options={["", ...columns]}
            onChange={(v) => onUpdate({ column: v })}
          />
        </Field>
      )}

      {panel.kind === "heat" && (
        <MultiColumnField
          columns={columns}
          selected={panel.columns ?? []}
          onChange={(cols) => onUpdate({ columns: cols })}
        />
      )}

      {(panel.kind === "box" ||
        panel.kind === "violin" ||
        panel.kind === "scatter") && (
        <MultiColumnField
          columns={columns}
          selected={panel.columns ?? []}
          label="Replicate columns"
          onChange={(cols) => onUpdate({ columns: cols })}
        />
      )}

      {panel.kind === "point" && (
        <PointInspector panel={panel} columns={columns} onUpdate={onUpdate} />
      )}

      {panel.kind === "scatter" && (
        <Field label="Jitter">
          <ToggleInput
            on={panel.options?.jitter !== false}
            onClick={() =>
              onUpdate({
                options: {
                  ...panel.options,
                  jitter: panel.options?.jitter === false,
                },
              })
            }
          />
        </Field>
      )}

      {(panel.kind === "violin" ||
        panel.kind === "point" ||
        panel.kind === "scatter") && (
        <Field label="Value axis">
          <ToggleInput
            on={panel.options?.axis !== false}
            onClick={() =>
              onUpdate({
                options: {
                  ...panel.options,
                  axis: panel.options?.axis === false,
                },
              })
            }
          />
        </Field>
      )}

      {(colored || panel.kind === "bars" || panel.kind === "dots") && (
        <Field label="Scale">
          <SelectInput
            value={continuous ? "continuous" : "categorical"}
            options={["categorical", "continuous"]}
            onChange={(v) =>
              onUpdate({
                scale:
                  v === "continuous"
                    ? {
                        kind: "continuous",
                        paletteId: panel.scale?.paletteId ?? "viridis",
                      }
                    : { kind: "categorical" },
              })
            }
          />
        </Field>
      )}

      {continuous && (
        <Field label="Palette">
          <SelectInput
            value={panel.scale?.paletteId ?? "viridis"}
            options={SEQUENTIAL_PALETTES.map((p) => p.id)}
            labels={Object.fromEntries(
              SEQUENTIAL_PALETTES.map((p) => [p.id, p.label]),
            )}
            onChange={(v) =>
              onUpdate({ scale: { kind: "continuous", paletteId: v } })
            }
          />
        </Field>
      )}

      {panel.kind === "bars" && (
        <Field label="Bar length">
          <RangeInput
            value={Number(panel.width ?? 70)}
            min={30}
            max={140}
            onChange={(n) => onUpdate({ width: n })}
          />
        </Field>
      )}

      {panel.kind === "labels" && (
        <>
          <Field label="Italic">
            <ToggleInput
              on={(panel.options?.italic ?? true) as boolean}
              onClick={() =>
                onUpdate({
                  options: {
                    ...panel.options,
                    italic: !(panel.options?.italic ?? true),
                  },
                })
              }
            />
          </Field>
          <Field label="Font size">
            <RangeInput
              value={Number(panel.options?.fontSize) || 11}
              min={7}
              max={18}
              onChange={(n) =>
                onUpdate({ options: { ...panel.options, fontSize: n } })
              }
            />
          </Field>
          <Field label="Boxed">
            <ToggleInput
              on={!!panel.options?.boxed}
              onClick={() =>
                onUpdate({
                  options: { ...panel.options, boxed: !panel.options?.boxed },
                })
              }
            />
          </Field>
          <Field label="Color by">
            <SelectInput
              value={(panel.options?.colorColumn as string) ?? ""}
              options={["", ...columns]}
              onChange={(v) =>
                onUpdate({
                  options: { ...panel.options, colorColumn: v || undefined },
                })
              }
            />
          </Field>
        </>
      )}

      {(isData ||
        panel.kind === "points" ||
        panel.kind === "strip" ||
        panel.kind === "msa") && (
        <Field label="Legend">
          <ToggleInput
            on={panel.legend !== false}
            onClick={() => onUpdate({ legend: panel.legend === false })}
          />
        </Field>
      )}

      {panel.kind === "support" && (
        <p className="text-xs text-foreground-muted">
          Shows the bootstrap / support value on each internal branch.
        </p>
      )}
      {panel.kind === "clade" && (
        <CladeInspector panel={panel} tipNames={tipNames} onUpdate={onUpdate} />
      )}
      {panel.kind === "msa" && (
        <>
          <p className="text-xs text-foreground-muted">
            Draws the imported alignment as a residue matrix, joined to tips by
            label. Import an aligned FASTA in the Alignment panel on the left. A
            wide alignment is binned to a drawable width (noted on the figure).
          </p>
          <Field label="Track width">
            <RangeInput
              value={Number(panel.width ?? 120)}
              min={60}
              max={320}
              onChange={(n) => onUpdate({ width: n })}
            />
          </Field>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The clade inspector (ggtree geom_hilight / MRCA). Each clade is named by its
// tip MEMBERS; the MRCA of those tips is the clade root (the large-tree QOL: name
// what you know, never hunt for a node). Multiple clades, each a color + label.
// ---------------------------------------------------------------------------

const CLADE_PALETTE = [
  "#1AA0E6",
  "#D85A30",
  "#1D9E75",
  "#7F77DD",
  "#D4537E",
  "#BA7517",
];

function CladeInspector({
  panel,
  tipNames,
  onUpdate,
}: {
  panel: AlignedPanel;
  tipNames: string[];
  onUpdate: (patch: Partial<AlignedPanel>) => void;
}) {
  const clades = (panel.options?.clades as CladeAnnotation[] | undefined) ?? [];
  const setClades = (next: CladeAnnotation[]) =>
    onUpdate({ options: { ...panel.options, clades: next } });
  const addClade = () =>
    setClades([
      ...clades,
      {
        id: `clade-${clades.length}-${tipNames.length}`,
        tips: [],
        color: CLADE_PALETTE[clades.length % CLADE_PALETTE.length],
        label: "",
      },
    ]);
  const patchClade = (id: string, patch: Partial<CladeAnnotation>) =>
    setClades(clades.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeClade = (id: string) =>
    setClades(clades.filter((c) => c.id !== id));

  return (
    <div className="space-y-2">
      <p className="text-xs text-foreground-muted">
        Name a clade by its tip members; its MRCA is found for you and the clade
        is highlighted (works in both layouts).
      </p>
      {clades.map((c) => (
        <div
          key={c.id}
          className="rounded-lg border border-border p-2 space-y-1.5 bg-surface-raised"
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={c.color}
              onChange={(e) => patchClade(c.id, { color: e.target.value })}
              aria-label="Clade color"
              className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
            />
            <input
              type="text"
              value={c.label}
              placeholder="Label (optional)"
              onChange={(e) => patchClade(c.id, { label: e.target.value })}
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground"
            />
            <button
              type="button"
              onClick={() => removeClade(c.id)}
              aria-label="Remove clade"
              className="shrink-0 rounded p-1 text-foreground-muted hover:text-red-500"
            >
              <Icon name="trash" className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-foreground-muted">Style</span>
            <select
              value={c.style ?? "highlight"}
              onChange={(e) =>
                patchClade(c.id, {
                  style: e.target.value === "label" ? "label" : "highlight",
                })
              }
              className="text-sm border border-border rounded-lg px-2 py-1 bg-surface text-foreground"
            >
              <option value="highlight">Highlight</option>
              <option value="label">Bracket</option>
            </select>
          </div>
          <MultiColumnField
            columns={tipNames}
            selected={c.tips ?? []}
            label="Members (tips)"
            onChange={(tips) => patchClade(c.id, { tips })}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={addClade}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-sm font-semibold text-foreground hover:border-accent"
      >
        <Icon name="plus" className="h-3.5 w-3.5" /> Add clade
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The point (lollipop) inspector. Two binding modes: a single value column plus
// an optional error column (read straight from the table), or the replicate
// columns (the mean + the SD / SEM are derived). Picking a value column switches
// to the value mode; clearing it falls back to the replicate columns.
// ---------------------------------------------------------------------------

const ERROR_KINDS: { id: string; label: string }[] = [
  { id: "sd", label: "Std deviation" },
  { id: "sem", label: "Std error (SEM)" },
  { id: "none", label: "No whisker" },
];

function PointInspector({
  panel,
  columns,
  onUpdate,
}: {
  panel: AlignedPanel;
  columns: string[];
  onUpdate: (patch: Partial<AlignedPanel>) => void;
}) {
  const errorKind =
    (panel.options?.errorKind as string | undefined) ?? "sd";
  const valueMode = !!panel.column;
  return (
    <>
      <Field label="Value column">
        <SelectInput
          value={panel.column ?? ""}
          options={["", ...columns]}
          onChange={(v) =>
            // A value column engages the value+error mode; clearing it (none)
            // hands back to the replicate columns below.
            onUpdate(v ? { column: v } : { column: undefined })
          }
        />
      </Field>
      {valueMode ? (
        errorKind !== "none" && (
          <Field label="Error column">
            <SelectInput
              value={panel.errorColumn ?? ""}
              options={["", ...columns]}
              onChange={(v) => onUpdate({ errorColumn: v || undefined })}
            />
          </Field>
        )
      ) : (
        <MultiColumnField
          columns={columns}
          selected={panel.columns ?? []}
          label="Replicate columns"
          onChange={(cols) => onUpdate({ columns: cols })}
        />
      )}
      <Field label="Error bar">
        <SelectInput
          value={errorKind}
          options={ERROR_KINDS.map((e) => e.id)}
          labels={Object.fromEntries(ERROR_KINDS.map((e) => [e.id, e.label]))}
          onChange={(v) =>
            onUpdate({ options: { ...panel.options, errorKind: v } })
          }
        />
      </Field>
    </>
  );
}

// ---------------------------------------------------------------------------
// The searchable, categorized Add-panel menu.
// ---------------------------------------------------------------------------

function AddPanelMenu({
  onAdd,
  onClose,
}: {
  onAdd: (kind: AlignedPanelKind) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PANEL_CATALOG;
    return PANEL_CATALOG.map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.desc.toLowerCase().includes(q) ||
          i.kind.includes(q),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden />
      <div className="absolute z-20 top-11 left-0 w-[300px] max-w-full bg-surface-raised border border-border rounded-xl shadow-xl p-2">
        <div className="relative mb-2">
          <Icon
            name="search"
            className="w-3.5 h-3.5 text-foreground-muted absolute left-2.5 top-2.5"
          />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search panels..."
            className="w-full pl-8 pr-2 py-2 border border-border rounded-lg text-sm bg-surface text-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.cat}>
              <div className="text-[10px] uppercase tracking-wide text-foreground-muted px-1 pt-2 pb-1">
                {g.cat}
              </div>
              {g.items.map((i) => (
                <button
                  key={i.kind}
                  onClick={() => onAdd(i.kind)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-accent-soft text-left"
                >
                  <span className="text-sm text-foreground">{i.name}</span>
                  <span className="text-xs text-foreground-muted">{i.desc}</span>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="text-xs text-foreground-muted px-1 py-3">
              No panel matches that.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// "Start from" templates.
// ---------------------------------------------------------------------------

export const TEMPLATE_IDS = [
  "basic",
  "ggtreeExtra",
  "gheatmap",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

function TemplatePicker({
  applied,
  onApply,
}: {
  applied: string;
  onApply: (id: string) => void;
}) {
  // The picker reflects the applied template (controlled by `applied`) rather than
  // snapping back to a fixed placeholder, so an apply does not flash the selection
  // back to "(keep current figure)" for a render (the template-apply flicker fix).
  // Editing the layers afterward clears `applied` back to "", and the placeholder
  // returns. Re-picking the same value is a no-op (value unchanged), so we key the
  // apply off the selected id, not a transient reset.
  return (
    <label className="block text-xs">
      <span className="text-foreground-muted">Start from a template</span>
      <select
        value={applied}
        onChange={(e) => e.target.value && onApply(e.target.value)}
        className="mt-1 w-full text-sm border border-border rounded-lg px-2 py-1.5 bg-surface text-foreground"
      >
        <option value="">(keep current figure)</option>
        <option value="basic">Basic phylogram</option>
        <option value="ggtreeExtra">ggtreeExtra multi-ring</option>
        <option value="gheatmap">gheatmap matrix</option>
      </select>
    </label>
  );
}

/**
 * Build a template's layer stack from the available columns. A pure helper the
 * Studio calls; numeric columns hint a continuous scale, the first categorical
 * column drives strip / points. Falls back gracefully when columns are missing.
 */
export function buildTemplate(
  id: string,
  columns: string[],
  numericColumns: string[],
): AlignedPanel[] {
  const cat = columns.find((c) => !numericColumns.includes(c)) ?? columns[0];
  const num = numericColumns[0] ?? columns[0];
  const num2 = numericColumns[1] ?? num;
  const cont = (paletteId = "viridis") =>
    ({ kind: "continuous", paletteId }) as const;

  if (id === "basic") {
    return [
      makeWith("clade"),
      makeWith("support"),
      cat ? makeWith("strip", { column: cat, legend: true }) : null,
      makeWith("labels", { options: { italic: true } }),
    ].filter(Boolean) as AlignedPanel[];
  }
  if (id === "ggtreeExtra") {
    return [
      cat ? makeWith("points", { column: cat, legend: true }) : null,
      cat ? makeWith("strip", { column: cat, legend: true }) : null,
      num
        ? makeWith("heat", { columns: [num], scale: cont(), legend: true })
        : null,
      num2
        ? makeWith("bars", { column: num2, scale: cont(), legend: true })
        : null,
      makeWith("labels", { options: { italic: true } }),
    ].filter(Boolean) as AlignedPanel[];
  }
  // gheatmap
  return [
    makeWith("labels", { options: { italic: true } }),
    numericColumns.length > 0
      ? makeWith("heat", {
          columns: numericColumns.slice(0, 4),
          scale: cont(),
          legend: true,
        })
      : cat
        ? makeWith("heat", { columns: [cat], legend: true })
        : null,
  ].filter(Boolean) as AlignedPanel[];
}

function makeWith(
  kind: AlignedPanelKind,
  extra: Partial<AlignedPanel> = {},
): AlignedPanel {
  return { id: newPanelId(kind), kind, visible: true, ...extra };
}

// ---------------------------------------------------------------------------
// Small inputs (match the Studio style).
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-foreground-muted shrink-0">{label}</span>
      {children}
    </div>
  );
}

function SelectInput({
  value,
  options,
  labels,
  onChange,
}: {
  value: string;
  options: string[];
  labels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm border border-border rounded-lg px-2 py-1 bg-surface text-foreground min-w-0 max-w-[160px] truncate"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o === "" ? "(none)" : (labels?.[o] ?? o)}
        </option>
      ))}
    </select>
  );
}

function RangeInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-32"
    />
  );
}

function ToggleInput({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-9 h-5 rounded-full relative transition-colors ${
        on ? "bg-brand-sky" : "bg-border"
      }`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
          on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function MultiColumnField({
  columns,
  selected,
  label = "Columns",
  onChange,
}: {
  columns: string[];
  selected: string[];
  label?: string;
  onChange: (cols: string[]) => void;
}) {
  const available = columns.filter((c) => !selected.includes(c));
  return (
    <div className="text-sm">
      <span className="text-foreground-muted">{label}</span>
      {selected.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {selected.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs font-semibold"
            >
              {c}
              <Tooltip label={`Remove ${c}`}>
                <button
                  onClick={() => onChange(selected.filter((x) => x !== c))}
                  className="hover:text-foreground"
                  aria-label={`Remove ${c}`}
                >
                  <Icon name="close" className="w-3 h-3" />
                </button>
              </Tooltip>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && onChange([...selected, e.target.value])}
          className="mt-1 w-full text-sm border border-border rounded-lg px-2 py-1 bg-surface text-foreground"
        >
          <option value="">Add a column...</option>
          {available.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
