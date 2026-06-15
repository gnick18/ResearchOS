"use client";

// The signature left insert/file rail for the Figure composer (the three-zone
// BioRender layout). A 52px icon nav strip + a contextual panel: Figures (your
// pages), Icons (the open-asset library, inline), Text, Shapes, Connect,
// Templates, Layers. Insert lives on the LEFT; the contextual inspector stays on
// the right. House style: <Icon> only, no inline svg, no em-dashes, no
// mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  loadAssetManifest,
  searchAssets,
  listCategoryGroups,
  verificationStatus,
  countReviewable,
  assetSvgUrl,
  type LibraryAsset,
  type CategoryGroup,
} from "@/lib/figure/asset-library";
import type { FigurePage, ShapeKind, TextVariant } from "@/lib/figure/figure-page";
import type { ElementRef } from "@/lib/figure/figure-arrange";
import { FIGURE_TEMPLATES, type FigureTemplate } from "@/lib/figure/figure-templates";

/** One row in the Layers panel (computed by the composer in render/z order). */
export interface LayerItem {
  ref: ElementRef;
  label: string;
  icon: IconName;
}

export type RailSection =
  | "figures"
  | "icons"
  | "text"
  | "shapes"
  | "connect"
  | "templates"
  | "layers";

const NAV: { key: RailSection; label: string; icon: IconName }[] = [
  { key: "figures", label: "Figures", icon: "figure" },
  { key: "icons", label: "Icons", icon: "library" },
  { key: "text", label: "Text", icon: "text" },
  { key: "shapes", label: "Shapes", icon: "pencil" },
  { key: "connect", label: "Connect", icon: "lineage" },
  { key: "templates", label: "Templates", icon: "table" },
  { key: "layers", label: "Layers", icon: "layer" },
];

export default function FigureLeftRail({
  tool,
  setTool,
  textVariant,
  setTextVariant,
  onPickIcon,
  pages,
  currentPageId,
  onOpenPage,
  onNewPage,
  onAddFigure,
  layers,
  selectedKeys,
  onSelectLayer,
  onReorderLayer,
  onAddShape,
  onUseTemplate,
}: {
  tool: null | "text" | "arrow" | "bracket" | "connect";
  setTool: (t: null | "text" | "arrow" | "bracket" | "connect") => void;
  textVariant: TextVariant;
  setTextVariant: (v: TextVariant) => void;
  onPickIcon: (asset: LibraryAsset) => void;
  pages: FigurePage[];
  currentPageId: string;
  onOpenPage: (id: string) => void;
  onNewPage: () => void;
  onAddFigure: () => void;
  layers: LayerItem[];
  selectedKeys: Set<string>;
  onSelectLayer: (ref: ElementRef) => void;
  onReorderLayer: (ref: ElementRef, dir: "up" | "down") => void;
  onAddShape: (kind: ShapeKind) => void;
  onUseTemplate: (t: FigureTemplate) => void;
}) {
  // Default to Icons (the library is the headline of this rail).
  const [section, setSection] = useState<RailSection>("icons");

  return (
    <div className="flex shrink-0 overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex w-[52px] flex-col items-center gap-1 border-r border-border bg-surface-sunken py-2">
        {NAV.map((n) => (
          <button
            key={n.key}
            type="button"
            title={n.label}
            onClick={() => setSection(n.key)}
            className={`flex h-11 w-[42px] flex-col items-center justify-center gap-0.5 rounded-lg border text-[9px] ${
              section === n.key
                ? "border-border-strong bg-surface font-semibold text-brand-action"
                : "border-transparent text-foreground-muted hover:bg-surface"
            }`}
          >
            <Icon name={n.icon} className="h-[18px] w-[18px]" />
            {n.label}
          </button>
        ))}
      </div>

      <div className="flex w-60 min-w-0 flex-col p-3">
        {section === "icons" && <IconsPanel onPick={onPickIcon} />}
        {section === "figures" && (
          <FiguresPanel
            pages={pages}
            currentPageId={currentPageId}
            onOpenPage={onOpenPage}
            onNewPage={onNewPage}
            onAddFigure={onAddFigure}
          />
        )}
        {section === "text" && (
          <ToolPanel
            title="Text"
            active={tool === "text"}
            activate={() => setTool(tool === "text" ? null : "text")}
            activateLabel="Place text"
            hint="Click the page to place the selected text style."
          >
            <div className="mt-2 flex gap-1">
              {(["heading", "label", "body"] as TextVariant[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setTextVariant(v);
                    setTool("text");
                  }}
                  className={`flex-1 rounded border px-1.5 py-1 text-meta capitalize ${textVariant === v ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong hover:border-brand-action"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </ToolPanel>
        )}
        {section === "connect" && (
          <ToolPanel
            title="Connect"
            active={tool === "connect"}
            activate={() => setTool(tool === "connect" ? null : "connect")}
            activateLabel="Smart connector"
            hint="Drag from a blue node on one element onto another to connect them."
          />
        )}
        {section === "shapes" && (
          <>
            <PanelHead>Shapes</PanelHead>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => onAddShape("rect")}
                className="flex w-full items-center gap-2 rounded-lg border border-border-strong px-2 py-1.5 text-meta font-medium hover:border-brand-action"
              >
                <span className="h-3.5 w-3.5 rounded-sm border-2 border-brand-action bg-brand-soft" />
                Rectangle
              </button>
              <button
                type="button"
                onClick={() => onAddShape("ellipse")}
                className="flex w-full items-center gap-2 rounded-lg border border-border-strong px-2 py-1.5 text-meta font-medium hover:border-brand-action"
              >
                <span className="h-3.5 w-3.5 rounded-full border-2 border-brand-action bg-brand-soft" />
                Ellipse
              </button>
              <p className="pt-1 text-meta text-foreground-faint">
                Drop a shape on the page, then recolor and resize it in the inspector.
              </p>
            </div>
          </>
        )}
        {section === "templates" && (
          <>
            <PanelHead>Templates</PanelHead>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-auto">
              {FIGURE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onUseTemplate(t)}
                  className="w-full rounded-lg border border-border px-2 py-1.5 text-left hover:border-brand-action"
                >
                  <div className="text-meta font-semibold text-foreground">{t.name}</div>
                  <div className="text-[10.5px] leading-snug text-foreground-muted">
                    {t.description}
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-foreground-faint">
              Adds the layout to the current page. Drop your own figures and icons in.
            </p>
          </>
        )}
        {section === "layers" && (
          <LayersPanel
            layers={layers}
            selectedKeys={selectedKeys}
            onSelect={onSelectLayer}
            onReorder={onReorderLayer}
          />
        )}
      </div>
    </div>
  );
}

function PanelHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center justify-between text-meta font-bold uppercase tracking-wide text-foreground-faint">
      {children}
    </h3>
  );
}

// The contribution / review flow is dark until go-live, so the verification
// badges + "Help review" entry only surface when the lane's flag is on.
const ASSET_CONTRIBUTE_ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

function IconsPanel({ onPick }: { onPick: (a: LibraryAsset) => void }) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  // Which top-level sections are open in the tree. Collapsed by default so a
  // 9-section corpus stays scannable; selecting a leaf keeps its section open.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    void loadAssetManifest().then((a) => {
      if (!live) return;
      setAssets(a);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, []);

  // The locked taxonomy from the Icon Library lane: sections (display-ordered,
  // empty omitted) each holding the leaf categories actually present.
  const groups = useMemo<CategoryGroup[]>(() => listCategoryGroups(assets), [assets]);
  const results = useMemo(
    () => searchAssets(assets, { query, category }).slice(0, 240),
    [assets, query, category],
  );
  const reviewable = useMemo(
    () => (ASSET_CONTRIBUTE_ENABLED ? countReviewable(assets) : 0),
    [assets],
  );

  const toggleSection = (section: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const selectCategory = (cat: string | null, section?: string) => {
    setCategory(cat);
    // Keep the chosen leaf's section open so the selection stays visible.
    if (section) setExpanded((prev) => new Set(prev).add(section));
  };

  return (
    <>
      <PanelHead>Icons</PanelHead>
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border-strong bg-surface-sunken px-2 py-1.5">
        <Icon name="search" className="h-3.5 w-3.5 text-foreground-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons..."
          className="w-full bg-transparent text-meta outline-none placeholder:text-foreground-faint"
        />
      </div>

      {/* Collapsible grouped category tree (BioRender-style), bounded so the
          results grid below always keeps room. */}
      {!loading && assets.length > 0 && (
        <div className="mb-2 max-h-44 overflow-auto rounded-lg border border-border-strong bg-surface-sunken p-1">
          <button
            type="button"
            onClick={() => selectCategory(null)}
            className={`block w-full rounded-md px-2 py-1 text-left text-meta font-semibold ${category === null ? "bg-brand-action text-white" : "text-foreground hover:bg-surface-raised"}`}
          >
            All icons
          </button>
          {groups.map((g) => {
            const open = expanded.has(g.section);
            return (
              <div key={g.section}>
                <button
                  type="button"
                  onClick={() => toggleSection(g.section)}
                  className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-meta font-semibold text-foreground-muted hover:bg-surface-raised"
                  aria-expanded={open}
                >
                  <Icon
                    name={open ? "chevronDown" : "chevronRight"}
                    className="h-3 w-3 shrink-0 opacity-70"
                  />
                  <span className="truncate">{g.section}</span>
                  <span className="ml-auto text-[10px] text-foreground-faint">
                    {g.categories.length}
                  </span>
                </button>
                {open && (
                  <div className="ml-3 border-l border-border pl-1">
                    {g.categories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => selectCategory(c, g.section)}
                        className={`block w-full truncate rounded-md px-2 py-0.5 text-left text-[11px] ${category === c ? "bg-brand-action text-white" : "text-foreground-muted hover:bg-surface-raised"}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="p-4 text-center text-meta text-foreground-muted">Loading the library...</p>
        ) : assets.length === 0 ? (
          <p className="p-4 text-center text-meta text-foreground-faint">
            No assets available yet.
          </p>
        ) : results.length === 0 ? (
          <p className="p-4 text-center text-meta text-foreground-faint">
            Nothing here. Try another category or search.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {results.map((a) => {
              const unverified = ASSET_CONTRIBUTE_ENABLED && verificationStatus(a) === "unverified";
              return (
                <button
                  key={a.uid}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    // Carry the whole asset so the canvas drop can place it without
                    // re-resolving the manifest. text/plain keeps it broadly droppable.
                    e.dataTransfer.setData("application/x-ros-asset", JSON.stringify(a));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onPick(a)}
                  title={`${a.title} (${a.license}${a.requiresAttribution ? ", cited" : ""}${unverified ? ", community, unverified" : ""}). Click or drag onto the page.`}
                  className="relative flex aspect-square cursor-grab items-center justify-center rounded-lg border border-border bg-surface-sunken p-1.5 hover:border-brand-action active:cursor-grabbing"
                  data-testid="figure-icon-option"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={assetSvgUrl(a)}
                    alt={a.title}
                    loading="lazy"
                    draggable={false}
                    className="pointer-events-none h-full w-full object-contain"
                  />
                  {unverified && (
                    <span
                      aria-hidden
                      className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400 ring-1 ring-surface-sunken"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Hub links out to the full Icon Library. Open in a new tab so the
          composer's canvas state survives. "Browse all" is always available;
          contribute + review appear once the contribution feature is live. */}
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-foreground-faint">
            {loading ? "" : `${results.length} of ${assets.length}. Credits auto-added.`}
          </p>
          <a
            href="/library"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[10px] font-semibold text-brand-action hover:underline"
          >
            Browse all ↗
          </a>
        </div>
        {ASSET_CONTRIBUTE_ENABLED && (
          <div className="flex items-center gap-3">
            <a
              href="/library/contribute"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-semibold text-brand-action hover:underline"
            >
              + Add an icon
            </a>
            <a
              href="/library/review"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-semibold text-foreground-muted hover:underline"
            >
              {reviewable > 0 ? `Help review (${reviewable})` : "Review queue"}
            </a>
          </div>
        )}
      </div>
    </>
  );
}

function FiguresPanel({
  pages,
  currentPageId,
  onOpenPage,
  onNewPage,
  onAddFigure,
}: {
  pages: FigurePage[];
  currentPageId: string;
  onOpenPage: (id: string) => void;
  onNewPage: () => void;
  onAddFigure: () => void;
}) {
  return (
    <>
      <PanelHead>
        Figures
        <button
          type="button"
          onClick={onNewPage}
          title="New figure page"
          className="text-foreground-muted hover:text-brand-action"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
        </button>
      </PanelHead>
      <button
        type="button"
        onClick={onAddFigure}
        className="mb-2 flex items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2 py-1.5 text-meta font-semibold hover:border-brand-action"
      >
        <Icon name="plus" className="h-3.5 w-3.5" /> Add a figure to this page
      </button>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto">
        {pages.length === 0 && (
          <p className="p-2 text-meta text-foreground-faint">No figure pages yet.</p>
        )}
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpenPage(p.id)}
            className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-meta ${
              p.id === currentPageId
                ? "border-brand-action bg-brand-action/10 text-brand-action"
                : "border-border hover:border-brand-action"
            }`}
          >
            <Icon name="figure" className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-[10px] text-foreground-faint">{p.panels.length}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function LayersPanel({
  layers,
  selectedKeys,
  onSelect,
  onReorder,
}: {
  layers: LayerItem[];
  selectedKeys: Set<string>;
  onSelect: (ref: ElementRef) => void;
  onReorder: (ref: ElementRef, dir: "up" | "down") => void;
}) {
  return (
    <>
      <PanelHead>Layers</PanelHead>
      {layers.length === 0 ? (
        <p className="text-meta text-foreground-faint">
          Nothing on the page yet. Add a figure or an icon.
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-auto">
          {layers.map((it, i) => {
            const key = `${it.ref.kind}:${it.ref.id}`;
            const sel = selectedKeys.has(key);
            return (
              <div
                key={key}
                className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 text-meta ${sel ? "border-brand-action bg-brand-action/10" : "border-border hover:border-brand-action"}`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(it.ref)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <Icon name={it.icon} className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                </button>
                <button
                  type="button"
                  title="Bring forward"
                  disabled={i === 0}
                  onClick={() => onReorder(it.ref, "up")}
                  className="shrink-0 text-foreground-faint hover:text-foreground disabled:opacity-30"
                >
                  <Icon name="chevronDown" className="h-3.5 w-3.5 rotate-180" />
                </button>
                <button
                  type="button"
                  title="Send backward"
                  disabled={i === layers.length - 1}
                  onClick={() => onReorder(it.ref, "down")}
                  className="shrink-0 text-foreground-faint hover:text-foreground disabled:opacity-30"
                >
                  <Icon name="chevronDown" className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function ToolPanel({
  title,
  active,
  activate,
  activateLabel,
  hint,
  children,
}: {
  title: string;
  active: boolean;
  activate: () => void;
  activateLabel: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <PanelHead>{title}</PanelHead>
      <button
        type="button"
        onClick={activate}
        className={`w-full rounded-lg border px-2 py-1.5 text-meta font-medium ${active ? "border-brand-action bg-brand-action/10 text-brand-action" : "border-border-strong hover:border-brand-action"}`}
      >
        {active ? `${activateLabel} (active)` : activateLabel}
      </button>
      {children}
      {active && <p className="mt-2 text-meta text-foreground-faint">{hint}</p>}
    </>
  );
}
