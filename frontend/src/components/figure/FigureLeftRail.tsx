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
import { buildSearchIndex, rankDocs } from "@/lib/figure/asset-search";
import {
  buildSmartSearchTasks,
  semanticSearch,
  isEmbedIndexReady,
} from "@/lib/figure/asset-embed-search";
import {
  getRecentUids,
  getFavoriteUids,
  recordRecent,
  setFavorite,
} from "@/lib/figure/asset-recents";
import { runBoot, createLocalTimingStore, PAGE_BOOT_WHY_HREF, type BootState } from "@/lib/page-boot/page-boot";
import { BeakerBotLoader } from "@/components/page-boot/BeakerBotLoader";
import type { FigurePage, ShapeKind, TextVariant } from "@/lib/figure/figure-page";
import type { ElementRef } from "@/lib/figure/figure-arrange";
import { FIGURE_TEMPLATES, type FigureTemplate } from "@/lib/figure/figure-templates";

/** One row in the Layers panel (computed by the composer in render/z order). */
export interface LayerItem {
  ref: ElementRef;
  label: string;
  icon: IconName;
  /** Whether this element is currently locked. */
  locked?: boolean;
  /** Whether this element is currently hidden. */
  hidden?: boolean;
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
  onToggleLock,
  onToggleHide,
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
  onToggleLock: (ref: ElementRef) => void;
  onToggleHide: (ref: ElementRef) => void;
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
            onToggleLock={onToggleLock}
            onToggleHide={onToggleHide}
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

// The lazy embedding (semantic) layer is gated until the vector sidecar is live
// on the CDN; the keyword baseline is always on.
const ASSET_SMART_SEARCH_ENABLED =
  process.env.NEXT_PUBLIC_ASSET_SMART_SEARCH === "1" ||
  process.env.NEXT_PUBLIC_ASSET_SMART_SEARCH === "true";

const smartTimingStore = createLocalTimingStore();

// Cap the rendered grid: each tile fetches an SVG from the CDN, so rendering
// hundreds at once is what makes results feel slow to appear. ~90 fills several
// scroll-pages; the rest are reachable by narrowing the search/category.
const RESULT_CAP = 90;

function IconsPanel({ onPick }: { onPick: (a: LibraryAsset) => void }) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  // Which top-level sections are open in the tree. Collapsed by default so a
  // 9-section corpus stays scannable; selecting a leaf keeps its section open.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Debounced query so we don't re-rank 30k assets on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Recently-inserted + starred icons, loaded from localStorage on mount so the
  // most-used few are one click away (a 30k library makes re-searching tedious).
  const [recentUids, setRecentUids] = useState<string[]>([]);
  const [favUids, setFavUids] = useState<string[]>([]);

  useEffect(() => {
    setRecentUids(getRecentUids());
    setFavUids(getFavoriteUids());
  }, []);

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

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  // Tokenize the manifest ONCE; re-searching reuses the cached tokens.
  const searchIndex = useMemo(() => buildSearchIndex(assets), [assets]);

  // The locked taxonomy from the Icon Library lane: sections (display-ordered,
  // empty omitted) each holding the leaf categories actually present.
  const groups = useMemo<CategoryGroup[]>(() => listCategoryGroups(assets), [assets]);
  // With a query, rank by near-miss relevance (typo + synonym tolerant) over the
  // category-filtered set, so "rodent" / "moose" / "cell death" still find icons
  // whose title never says those words. With no query, keep the plain category
  // view (rankAssets returns nothing for an empty query).
  // Smart (semantic) search: lazy index load behind the BeakerBot loader, then
  // async blended ranking. Off by default + flag-gated; keyword is always on.
  const [smart, setSmart] = useState(false);
  const [smartReady, setSmartReady] = useState(false);
  const [boot, setBoot] = useState<BootState | null>(null);
  const [smartResults, setSmartResults] = useState<LibraryAsset[] | null>(null);

  const keywordResults = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return searchAssets(assets, { category }).slice(0, RESULT_CAP);
    }
    const docs = category
      ? searchIndex.filter((d) => d.asset.category === category)
      : searchIndex;
    return rankDocs(docs, debouncedQuery, { limit: RESULT_CAP }).map((s) => s.asset);
  }, [assets, searchIndex, debouncedQuery, category]);

  const enableSmart = () => {
    setSmart(true);
    if (smartReady || isEmbedIndexReady()) {
      setSmartReady(true);
      return;
    }
    setBoot({ pct: 0, label: "Starting up", etaMs: null, phase: "running" });
    void runBoot(buildSmartSearchTasks(), {
      pageId: "figures-smart-search",
      timingStore: smartTimingStore,
      onUpdate: setBoot,
    })
      .then(() => {
        setSmartReady(true);
        setBoot(null);
      })
      .catch(() => {
        // boot holds the error state; the loader shows a retry.
      });
  };

  // Recompute blended semantic results when smart is on + ready (debounced query).
  useEffect(() => {
    if (!smart || !smartReady || !debouncedQuery.trim()) {
      setSmartResults(null);
      return;
    }
    let live = true;
    void semanticSearch(assets, debouncedQuery, { limit: RESULT_CAP }).then((r) => {
      if (live) setSmartResults(r.map((s) => s.asset));
    });
    return () => {
      live = false;
    };
  }, [smart, smartReady, debouncedQuery, assets]);

  // What the grid shows: smart (blended, category-filtered) when active + ready,
  // else the keyword baseline.
  const results = useMemo(() => {
    if (smart && smartReady && debouncedQuery.trim() && smartResults) {
      return category ? smartResults.filter((a) => a.category === category) : smartResults;
    }
    return keywordResults;
  }, [smart, smartReady, debouncedQuery, smartResults, category, keywordResults]);

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

  // uid -> asset, so the recents/favorites tray can resolve stored uids to live
  // assets (a removed/renamed asset simply drops out, no dangling tile).
  const byUid = useMemo(() => {
    const m = new Map<string, LibraryAsset>();
    for (const a of assets) m.set(a.uid, a);
    return m;
  }, [assets]);
  const favSet = useMemo(() => new Set(favUids), [favUids]);

  // The tray shows favorites first, then recents not already starred, resolved
  // to live assets and capped to a couple compact rows.
  const trayAssets = useMemo(() => {
    const seen = new Set<string>();
    const out: LibraryAsset[] = [];
    for (const uid of [...favUids, ...recentUids]) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      const a = byUid.get(uid);
      if (a) out.push(a);
      if (out.length >= 12) break;
    }
    return out;
  }, [favUids, recentUids, byUid]);

  // Inserting an icon records it as recent; clicking the star toggles a favorite.
  const handlePick = (a: LibraryAsset) => {
    setRecentUids(recordRecent(a.uid));
    onPick(a);
  };
  const toggleFav = (uid: string) => setFavUids(setFavorite(uid));

  return (
    <>
      <PanelHead>Icons</PanelHead>
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-border-strong bg-surface-sunken px-2 py-1.5">
        <Icon name="search" className="h-3.5 w-3.5 text-foreground-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={smart ? "Smart search..." : "Search icons..."}
          className="w-full bg-transparent text-meta outline-none placeholder:text-foreground-faint"
        />
        {ASSET_SMART_SEARCH_ENABLED && (
          <button
            type="button"
            onClick={() => (smart ? setSmart(false) : enableSmart())}
            title={
              smart
                ? "Smart search on (finds icons by meaning). Click to turn off."
                : "Smart search: find icons by meaning, not just words. Loads a small model the first time."
            }
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${smart ? "bg-brand-action text-white" : "border border-border-strong text-foreground-muted"}`}
          >
            Smart
          </button>
        )}
      </div>

      {/* Recent + favorite icons: one-click re-insert for the handful people use
          most. Only while browsing (no query), so it never competes with results. */}
      {!debouncedQuery.trim() && trayAssets.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-foreground-faint">
            Recent &amp; favorites
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {trayAssets.map((a) => (
              <button
                key={a.uid}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-ros-asset", JSON.stringify(a));
                  e.dataTransfer.effectAllowed = "copy";
                  setRecentUids(recordRecent(a.uid));
                }}
                onClick={() => handlePick(a)}
                title={`${a.title}. Click or drag onto the page.`}
                className="relative flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-lg border border-border bg-surface-sunken p-1 hover:border-brand-action active:cursor-grabbing"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={assetSvgUrl(a)}
                  alt={a.title}
                  loading="lazy"
                  draggable={false}
                  className="pointer-events-none h-full w-full object-contain"
                />
                {favSet.has(a.uid) && (
                  <Icon
                    name="star"
                    aria-hidden
                    className="absolute right-0.5 top-0.5 h-2 w-2 text-amber-400"
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

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
        {boot ? (
          <BeakerBotLoader
            state={boot}
            blurb="Loading the smart-search model in your browser. It caches after the first time, then searches by meaning instantly, and nothing leaves your device."
            whyHref={PAGE_BOOT_WHY_HREF}
            onRetry={enableSmart}
          />
        ) : loading ? (
          <p className="p-4 text-center text-meta text-foreground-muted">Loading the library...</p>
        ) : assets.length === 0 ? (
          <p className="p-4 text-center text-meta text-foreground-faint">
            No assets available yet.
          </p>
        ) : results.length === 0 ? (
          <div className="space-y-2 p-4 text-center">
            <p className="text-meta text-foreground-faint">
              {debouncedQuery.trim()
                ? `No icons match "${debouncedQuery.trim()}".`
                : "Nothing here yet."}
            </p>
            <div className="flex flex-col items-center gap-1.5">
              {category && (
                <button
                  type="button"
                  onClick={() => selectCategory(null)}
                  className="text-[11px] font-semibold text-brand-action hover:underline"
                >
                  Search all categories
                </button>
              )}
              {ASSET_SMART_SEARCH_ENABLED && !smart && debouncedQuery.trim() && (
                <button
                  type="button"
                  onClick={enableSmart}
                  className="text-[11px] font-semibold text-brand-action hover:underline"
                >
                  Try Smart search (finds icons by meaning)
                </button>
              )}
              <a
                href="/library"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-foreground-muted hover:underline"
              >
                Browse the full library ↗
              </a>
            </div>
          </div>
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
                    setRecentUids(recordRecent(a.uid));
                  }}
                  onClick={() => handlePick(a)}
                  title={`${a.title} (${a.license}${a.requiresAttribution ? ", cited" : ""}${unverified ? ", community, unverified" : ""}). Click or drag onto the page.`}
                  className="group relative flex aspect-square cursor-grab items-center justify-center rounded-lg border border-border bg-surface-sunken p-1.5 hover:border-brand-action active:cursor-grabbing"
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
                  {/* Star toggle: always visible once starred, on hover otherwise.
                      A span (not a nested button) so it stays valid inside the tile. */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={favSet.has(a.uid) ? "Remove from favorites" : "Add to favorites"}
                    title={favSet.has(a.uid) ? "Unstar" : "Star for quick access"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFav(a.uid);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFav(a.uid);
                      }
                    }}
                    className={`absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded transition-opacity ${
                      favSet.has(a.uid)
                        ? "text-amber-400"
                        : "text-foreground-faint opacity-0 hover:text-amber-400 group-hover:opacity-100"
                    }`}
                  >
                    <Icon name="star" className="h-3 w-3" />
                  </span>
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
  onToggleLock,
  onToggleHide,
}: {
  layers: LayerItem[];
  selectedKeys: Set<string>;
  onSelect: (ref: ElementRef) => void;
  onReorder: (ref: ElementRef, dir: "up" | "down") => void;
  onToggleLock: (ref: ElementRef) => void;
  onToggleHide: (ref: ElementRef) => void;
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
                className={`flex items-center gap-0.5 rounded-lg border px-1 py-1 text-meta ${sel ? "border-brand-action bg-brand-action/10" : "border-border hover:border-brand-action"} ${it.hidden ? "opacity-50" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(it.ref)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-0.5 text-left"
                >
                  <Icon name={it.icon} className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                </button>
                {/* Eye toggle: hide / show this element. */}
                <button
                  type="button"
                  title={it.hidden ? "Show" : "Hide"}
                  onClick={() => onToggleHide(it.ref)}
                  className="shrink-0 text-foreground-faint hover:text-foreground"
                >
                  <Icon name={it.hidden ? "eyeOff" : "eye"} className="h-3.5 w-3.5" />
                </button>
                {/* Lock toggle: lock / unlock this element. Locked shows filled. */}
                <button
                  type="button"
                  title={it.locked ? "Unlock" : "Lock"}
                  onClick={() => onToggleLock(it.ref)}
                  className={`shrink-0 hover:text-foreground ${it.locked ? "text-brand-action" : "text-foreground-faint"}`}
                >
                  <Icon name={it.locked ? "lock" : "lockOpen"} className="h-3.5 w-3.5" />
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
