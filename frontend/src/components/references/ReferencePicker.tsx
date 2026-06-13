"use client";

// Chemistry Phase 3 (2026-06-11), seamlessness pass (2026-06-11). The shared
// "Insert reference" picker, opened by the editor toolbar button or the "/"
// slash trigger.
//
// A modal with a tab strip (Molecules / Sequences / Methods / Data Hub), a
// search box, and a scrollable list. It is fully keyboard-driven: the search
// box auto-focuses, you type to filter, Arrow Up/Down move the highlight, Enter
// inserts the highlighted item, and Tab cycles the type tabs. Clicking a row
// also inserts it. Each tab is gated on its feature flag, so the picker only
// offers the object types this deployment has turned on.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  objectReferenceMarkdown,
  objectEmbedMarkdown,
  methodRefId,
  DEFAULT_EMBED_VIEW,
  type ObjectRefType,
} from "@/lib/references";
import { CHEMISTRY_ENABLED } from "@/lib/chemistry/config";
import { DATAHUB_ENABLED, isBigTableEnabled } from "@/lib/datahub/config";
import { MoleculeThumbnail } from "@/components/chemistry/MoleculeThumbnail";
import type { Molecule } from "@/lib/chemistry/api";
import type { SequenceRecord, Method } from "@/lib/types";
import type { DataHubDocument } from "@/lib/datahub/model/types";
import type { DatasetSidecar } from "@/lib/datahub/bigtable/types";

// Lazy to avoid importing heavy APIs at parse time (the wasm etc.) when the
// picker has never been opened. Each source is best-effort so one failing list
// (e.g. a flag off, or a read error) never blanks the others.
async function loadData(): Promise<{
  molecules: Molecule[];
  sequences: SequenceRecord[];
  methods: Method[];
  datahub: DataHubDocument[];
  datasets: DatasetSidecar[];
}> {
  // The big-table dataset lane is gated separately from the editable lane, so its
  // store + owner resolver only load when both flags are on. listDatasets is
  // owner-scoped, so we resolve the current owner the same way the rest of the lane
  // does (getCurrentUserCached) rather than threading a hook through the picker.
  const [{ moleculesApi }, local, datahubMod, datasetMod] = await Promise.all([
    import("@/lib/chemistry/api"),
    import("@/lib/local-api"),
    DATAHUB_ENABLED
      ? import("@/lib/datahub/api")
      : Promise.resolve(null),
    isBigTableEnabled()
      ? Promise.all([
          import("@/lib/datahub/bigtable/dataset-store"),
          import("@/lib/storage/json-store"),
        ])
      : Promise.resolve(null),
  ]);
  const { sequencesApi, methodsApi } = local;
  const [molecules, sequences, methods, datahub, datasets] = await Promise.all([
    CHEMISTRY_ENABLED ? moleculesApi.list().catch(() => []) : Promise.resolve([] as Molecule[]),
    sequencesApi.list().catch(() => [] as SequenceRecord[]),
    methodsApi.list().catch(() => [] as Method[]),
    datahubMod ? datahubMod.dataHubApi.list().catch(() => [] as DataHubDocument[]) : Promise.resolve([] as DataHubDocument[]),
    datasetMod
      ? datasetMod[1]
          .getCurrentUserCached()
          .then((owner) => datasetMod[0].listDatasets(owner))
          .catch(() => [] as DatasetSidecar[])
      : Promise.resolve([] as DatasetSidecar[]),
  ]);
  return { molecules, sequences, methods, datahub, datasets };
}

type Tab = "molecules" | "sequences" | "methods" | "datahub" | "datasets";

const defaultTab: Tab = CHEMISTRY_ENABLED ? "molecules" : "sequences";

/** A flattened, render-ready item, so the list + keyboard nav are uniform
 *  across every object type. */
interface PickerItem {
  key: string;
  label: string;
  sublabel?: string;
  thumbnail?: React.ReactNode;
  /** The inline mention form, inserted when the mode is "mention". */
  markdown: string;
  /** Identity for building the block-embed form when the mode is "embed". */
  ref: { type: ObjectRefType; id: string; name: string };
}

/** Insert as an inline chip (mention) or a block embed (the rich card). */
type InsertMode = "mention" | "embed";

interface ReferencePickerProps {
  /** Called with the objectReferenceMarkdown(...) string when an item is picked,
   *  then the picker closes automatically via onClose. */
  onPick: (markdown: string) => void;
  onClose: () => void;
}

/** A single item row in the picker list. */
function PickerRow({
  item,
  highlighted,
  onPick,
  onHover,
}: {
  item: PickerItem;
  highlighted: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      data-highlighted={highlighted ? "1" : undefined}
      onClick={onPick}
      onMouseMove={onHover}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
        highlighted ? "bg-accent-soft" : "hover:bg-accent-soft"
      }`}
    >
      {item.thumbnail && (
        <div className="shrink-0 w-10 h-10 rounded overflow-hidden bg-white border border-border flex items-center justify-center">
          {item.thumbnail}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-foreground truncate">{item.label}</p>
        {item.sublabel && (
          <p className="text-meta text-foreground-muted truncate">{item.sublabel}</p>
        )}
      </div>
    </button>
  );
}

export default function ReferencePicker({ onPick, onClose }: ReferencePickerProps) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [mode, setMode] = useState<InsertMode>("embed");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [molecules, setMolecules] = useState<Molecule[]>([]);
  const [sequences, setSequences] = useState<SequenceRecord[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [datahub, setDatahub] = useState<DataHubDocument[]>([]);
  const [datasets, setDatasets] = useState<DatasetSidecar[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load data once on mount.
  useEffect(() => {
    let cancelled = false;
    loadData()
      .then((data) => {
        if (cancelled) return;
        setMolecules(data.molecules);
        setSequences(data.sequences);
        setMethods(data.methods);
        setDatahub(data.datahub);
        setDatasets(data.datasets);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus the search box as soon as the panel mounts.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on Escape (capture so it beats the editor's own handlers).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // Click-outside to close.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const pick = useCallback(
    (item: PickerItem) => {
      const markdown =
        mode === "embed"
          ? objectEmbedMarkdown(item.ref.type, item.ref.id, item.ref.name, {
              view: DEFAULT_EMBED_VIEW[item.ref.type],
            })
          : item.markdown;
      onPick(markdown);
      onClose();
    },
    [mode, onPick, onClose],
  );

  const q = query.trim().toLowerCase();

  const availableTabs = useMemo<Tab[]>(
    () => [
      ...(CHEMISTRY_ENABLED ? (["molecules"] as Tab[]) : []),
      "sequences",
      "methods",
      ...(DATAHUB_ENABLED ? (["datahub"] as Tab[]) : []),
      ...(isBigTableEnabled() ? (["datasets"] as Tab[]) : []),
    ],
    [],
  );

  const moleculeItems = useMemo<PickerItem[]>(
    () =>
      molecules
        .filter(
          (m) =>
            !q ||
            m.name.toLowerCase().includes(q) ||
            (m.formula ?? "").toLowerCase().includes(q) ||
            (m.smiles ?? "").toLowerCase().includes(q),
        )
        .map((m) => ({
          key: `mol-${m.id}`,
          label: m.name,
          sublabel:
            [m.formula, m.smiles ? "SMILES" : undefined].filter(Boolean).join(" · ") ||
            undefined,
          thumbnail: m.smiles ? (
            <MoleculeThumbnail structure={m.smiles} width={40} height={40} />
          ) : undefined,
          markdown: objectReferenceMarkdown("molecule", m.id, m.name),
          ref: { type: "molecule" as const, id: m.id, name: m.name },
        })),
    [molecules, q],
  );

  const sequenceItems = useMemo<PickerItem[]>(
    () =>
      sequences
        .filter(
          (s) =>
            !q ||
            (s.display_name ?? "").toLowerCase().includes(q) ||
            (s.seq_type ?? "").toLowerCase().includes(q),
        )
        .map((s) => ({
          key: `seq-${s.id}`,
          label: s.display_name ?? `Sequence ${s.id}`,
          sublabel: s.seq_type ?? undefined,
          markdown: objectReferenceMarkdown(
            "sequence",
            String(s.id),
            s.display_name ?? `Sequence ${s.id}`,
          ),
          ref: {
            type: "sequence" as const,
            id: String(s.id),
            name: s.display_name ?? `Sequence ${s.id}`,
          },
        })),
    [sequences, q],
  );

  const methodItems = useMemo<PickerItem[]>(
    () =>
      methods
        .filter(
          (m) =>
            !q ||
            (m.name ?? "").toLowerCase().includes(q) ||
            (m.method_type ?? "").toLowerCase().includes(q),
        )
        .map((m) => {
          // Private and public method stores have overlapping id-spaces, so a
          // private method id 1 and a public method id 1 both exist. Key on the
          // public flag too, or the two collide and React throws a duplicate-key
          // error (and can drop/duplicate rows). The same overlap means the
          // INSERTED reference must mark the public scope (methodRefId prefixes
          // "public:"), or it would resolve to the same-id private method.
          const refId = methodRefId(m.id, !!m.is_public);
          return {
            key: `method-${m.is_public ? "pub" : "priv"}-${m.id}`,
            label: m.name,
            sublabel: m.method_type ?? undefined,
            markdown: objectReferenceMarkdown("method", refId, m.name),
            ref: { type: "method" as const, id: refId, name: m.name },
          };
        }),
    [methods, q],
  );

  const datahubItems = useMemo<PickerItem[]>(
    () =>
      datahub
        .filter(
          (d) =>
            !q ||
            (d.name ?? "").toLowerCase().includes(q) ||
            (d.table_type ?? "").toLowerCase().includes(q),
        )
        .map((d) => ({
          key: `dh-${d.id}`,
          label: d.name,
          sublabel: d.table_type ?? undefined,
          markdown: objectReferenceMarkdown("datahub", d.id, d.name),
          ref: { type: "datahub" as const, id: d.id, name: d.name },
        })),
    [datahub, q],
  );

  // Big-table datasets (the DuckDB-backed large-table lane). A picked dataset
  // inserts a `dataset` block embed, which renders the slim preview window via
  // DatasetEmbed (never the full grid). Distinct from the `datahub` editable-lane
  // items above, they read different stores.
  const datasetItems = useMemo<PickerItem[]>(
    () =>
      datasets
        .filter((d) => !q || (d.name ?? "").toLowerCase().includes(q))
        .map((d) => ({
          key: `ds-bt-${d.id}`,
          label: d.name || `Dataset ${d.id}`,
          sublabel: `${d.rowCount.toLocaleString()} rows by ${d.colCount.toLocaleString()} columns`,
          markdown: objectReferenceMarkdown("dataset", d.id, d.name || `Dataset ${d.id}`),
          ref: { type: "dataset" as const, id: d.id, name: d.name || `Dataset ${d.id}` },
        })),
    [datasets, q],
  );

  const itemsByTab: Record<Tab, PickerItem[]> = {
    molecules: moleculeItems,
    sequences: sequenceItems,
    methods: methodItems,
    datahub: datahubItems,
    datasets: datasetItems,
  };
  const items = itemsByTab[tab];

  const tabMeta: Record<Tab, string> = {
    molecules: "Molecules",
    sequences: "Sequences",
    methods: "Methods",
    datahub: "Data Hub",
    datasets: "Datasets",
  };

  // Reset the highlight whenever the visible list changes (tab or query).
  useEffect(() => {
    setHighlighted(0);
  }, [tab, q]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-highlighted="1"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted, items]);

  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      const idx = availableTabs.indexOf(tab);
      const next = (idx + dir + availableTabs.length) % availableTabs.length;
      setTab(availableTabs[next]);
    },
    [availableTabs, tab],
  );

  // The whole flow is keyboard-driven from the search box.
  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, Math.max(0, items.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[highlighted];
        if (item) pick(item);
      } else if (e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
      }
    },
    [items, highlighted, pick, cycleTab],
  );

  return (
    // Backdrop: transparent so the editor stays in view; the panel itself has
    // the background. Fixed overlay to receive outside-click events.
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Insert reference"
        className="w-full max-w-md bg-surface-raised border border-border rounded-xl shadow-2xl flex flex-col max-h-[70vh]"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-border shrink-0">
          <Icon name="reference" className="w-4 h-4 text-foreground-muted" />
          <span className="text-body font-semibold text-foreground flex-1">
            Insert reference
          </span>
          <Tooltip label="Close" placement="left">
            <button
              type="button"
              aria-label="Close reference picker"
              onClick={onClose}
              className="p-1 rounded hover:bg-accent-soft text-foreground-muted hover:text-foreground transition-colors"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        {/* Search */}
        <div className="px-4 py-2 shrink-0">
          <div className="relative">
            <Icon
              name="search"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-muted pointer-events-none"
            />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search, then Arrow keys and Enter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              className="w-full pl-8 pr-3 py-1.5 text-body text-foreground bg-surface border border-border rounded-lg outline-none focus:border-brand-action placeholder:text-foreground-muted"
            />
          </div>
        </div>

        {/* Tab strip */}
        <div className="flex items-center gap-1 px-4 pb-2 shrink-0">
          {availableTabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-meta rounded-md transition-colors font-medium ${
                tab === t
                  ? "bg-brand-action text-white"
                  : "text-foreground-muted hover:bg-accent-soft hover:text-foreground"
              }`}
            >
              {tabMeta[t]}
              {!loading && (
                <span className="ml-1.5 text-[11px] opacity-70">
                  {itemsByTab[t].length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
          {loading ? (
            <p className="text-meta text-foreground-muted py-4 text-center">
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="text-meta text-foreground-muted py-4 text-center">
              {q
                ? `No ${tabMeta[tab].toLowerCase()} match that search.`
                : `Nothing in ${tabMeta[tab]} yet.`}
            </p>
          ) : (
            <div className="space-y-0.5">
              {items.map((item, i) => (
                <PickerRow
                  key={item.key}
                  item={item}
                  highlighted={i === highlighted}
                  onPick={() => pick(item)}
                  onHover={() => setHighlighted(i)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Insert-as toggle + keyboard hint */}
        <div className="px-4 py-2 border-t border-border shrink-0 flex items-center gap-3">
          <div
            role="group"
            aria-label="Insert as"
            className="inline-flex rounded-lg border border-border p-0.5 bg-surface-sunken"
          >
            <button
              type="button"
              aria-pressed={mode === "mention"}
              onClick={() => setMode("mention")}
              className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-md transition-colors ${
                mode === "mention"
                  ? "bg-surface-raised text-foreground shadow-sm"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              Mention
            </button>
            <button
              type="button"
              aria-pressed={mode === "embed"}
              onClick={() => setMode("embed")}
              className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-md transition-colors ${
                mode === "embed"
                  ? "bg-surface-raised text-foreground shadow-sm"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              Embed
            </button>
          </div>
          <span className="text-[11px] text-foreground-muted">
            {mode === "embed" ? "Inserts a live block" : "Inserts an inline chip"}
          </span>
          <span className="flex-1" />
          <span className="text-[11px] text-foreground-muted">Enter to insert</span>
        </div>
      </div>
    </div>
  );
}
