"use client";

// Full-screen literature explorer popup for the chemistry workbench.
//
// Spec: docs/mockups/2026-06-12-literature-explorer.html (all decisions approved).
//
// Left rail: Type checkboxes (Research / Reviews / Patents) with counts, a
// Starred-only toggle, a papers-per-year histogram (bars are plain divs, purple
// where reviews dominate, click a bar to zoom the year range), two editable year
// inputs, and a Clear-filters button.
//
// Main panel: text filter input + sort select, then a results list. Each row has
// a star toggle that writes/removes from MoleculeMeta.starred_papers[] via
// moleculesApi.setStarredPapers, a type badge, and a DOI link or patent id.
//
// chemistry / literature-explorer

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  buildYearBins,
  applyExplorerFilters,
  type ExplorerItem,
  type ExplorerFilters,
  type YearBin,
} from "@/lib/chemistry/literature";
import {
  moleculesApi,
  type MoleculeMeta,
  type StarredPaper,
} from "@/lib/chemistry/api";

const NOW = new Date().getFullYear();

// ---- helpers ----------------------------------------------------------------

function itemKey(item: ExplorerItem): string {
  return item.type === "patent" ? item.id : item.doi || item.id || item.title;
}

function itemToStarredPaper(item: ExplorerItem): StarredPaper {
  if (item.type === "patent") {
    return {
      patent_id: item.id,
      title: item.id,
      year: "",
      type: "patent",
      starred_at: new Date().toISOString(),
    };
  }
  return {
    doi: item.doi || undefined,
    title: item.title,
    year: item.year,
    type: item.type,
    journal: item.journal || undefined,
    source: item.source || undefined,
    id: item.id || undefined,
    starred_at: new Date().toISOString(),
  };
}

// ---- sub-components ---------------------------------------------------------

function TypeBadge({ type }: { type: ExplorerItem["type"] }) {
  if (type === "review") {
    return (
      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
        Review
      </span>
    );
  }
  if (type === "patent") {
    return (
      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
        Patent
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-chip text-foreground-muted">
      Research
    </span>
  );
}

function HistBar({
  bin,
  maxTotal,
  onZoom,
}: {
  bin: YearBin;
  maxTotal: number;
  onZoom: (lo: number, hi: number) => void;
}) {
  const heightPct = Math.max(3, (bin.total / Math.max(1, maxTotal)) * 100);
  const isReviewDominated = bin.reviewCount > bin.total / 2;
  const label = bin.year % 10 === 0 ? `'${String(bin.year).slice(2)}` : "";
  return (
    <Tooltip
      label={`${bin.year}${bin.yearEnd !== bin.year ? `–${bin.yearEnd}` : ""}: ${bin.total} papers, ${bin.reviewCount} reviews`}
    >
      <div
        className="flex-1 relative cursor-pointer group"
        style={{ height: "58px" }}
        onClick={() => onZoom(bin.year, bin.yearEnd)}
      >
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-t-sm transition-opacity group-hover:opacity-100 opacity-85 ${isReviewDominated ? "bg-purple-500" : "bg-brand-action"}`}
          style={{ height: `${heightPct}%` }}
        />
        {label && (
          <span className="absolute -bottom-4 left-0 right-0 text-center text-[9px] text-foreground-muted">
            {label}
          </span>
        )}
      </div>
    </Tooltip>
  );
}

function PaperRow({
  item,
  isStarred,
  starsEnabled,
  onStarChange,
}: {
  item: ExplorerItem;
  isStarred: boolean;
  /** When false (no molecule, e.g. hub free-search), the star toggle is hidden. */
  starsEnabled: boolean;
  onStarChange: (item: ExplorerItem, starred: boolean) => void;
}) {
  if (item.type === "patent") {
    return (
      <div className="flex gap-2.5 px-3 py-2.5 border-b border-border">
        {starsEnabled && (
          <button
            type="button"
            data-testid="lit-explorer-star"
            aria-label={isStarred ? "Unstar patent" : "Star this patent"}
            onClick={() => onStarChange(item, !isStarred)}
            className={`flex-none w-5 h-5 mt-0.5 ${isStarred ? "text-amber-400 fill-current" : "text-border hover:text-amber-400"} transition-colors`}
          >
            <Icon name="star" className="w-full h-full" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-brand-action hover:underline break-all"
          >
            {item.id}
          </a>
          <div className="flex gap-1.5 mt-1 flex-wrap">
            <TypeBadge type="patent" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 px-3 py-2.5 border-b border-border">
      {starsEnabled && (
        <button
          type="button"
          data-testid="lit-explorer-star"
          aria-label={isStarred ? "Unstar paper" : "Star this paper for this molecule"}
          onClick={() => onStarChange(item, !isStarred)}
          className={`flex-none w-5 h-5 mt-0.5 ${isStarred ? "text-amber-400 fill-current" : "text-border hover:text-amber-400"} transition-colors`}
        >
          <Icon name="star" className="w-full h-full" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-semibold text-foreground hover:text-brand-action leading-snug block"
        >
          {item.title}
        </a>
        <div className="text-[11.5px] text-foreground-muted mt-0.5">
          {[item.authors, item.journal, item.year].filter(Boolean).join(" · ")}
        </div>
        <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
          <TypeBadge type={item.type} />
          {item.citedBy > 0 && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-action/10 text-brand-action">
              {item.citedBy.toLocaleString("en-US")} cited
            </span>
          )}
          {item.doi && (
            <a
              href={`https://doi.org/${item.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-brand-action hover:underline font-mono"
            >
              doi:{item.doi}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- main component ---------------------------------------------------------

export interface LiteratureExplorerProps {
  /**
   * The molecule this explorer is opened for. Optional: the hub free-search mode
   * has no molecule to star into, so the explorer opens read-only (star toggles
   * and the starred-only filter are hidden) and reads nothing off molecule.*.
   */
  molecule?: MoleculeMeta;
  /** Heading label when there is no molecule (e.g. the searched compound name). */
  title?: string;
  /** Pre-loaded items to show (papers from Europe PMC + patents from PubChem). */
  items: ExplorerItem[];
  /** True Europe PMC paper hit count (the loaded papers are a top-cited sample of this). */
  paperTotal?: number;
  /** True PubChem-linked patent count (the loaded patents may be a capped sample of this). */
  patentTotal?: number;
  /** Called when the user closes the explorer. */
  onClose: () => void;
  /** Called when starred_papers changes so the parent can refresh the molecule. */
  onStarsChanged?: (updated: MoleculeMeta) => void;
}

export function LiteratureExplorer({
  molecule,
  title,
  items,
  paperTotal,
  patentTotal,
  onClose,
  onStarsChanged,
}: LiteratureExplorerProps) {
  // No molecule (hub free-search) means nothing to star into: open read-only.
  const starsEnabled = !!molecule;
  const heading = molecule?.name ?? title ?? "your search";
  const oldestYear = useMemo(() => {
    const years = items
      .filter((it) => it.type !== "patent")
      .map((it) => parseInt((it as { year: string }).year, 10))
      .filter((y) => !isNaN(y));
    return years.length > 0 ? Math.min(...years) : NOW - 10;
  }, [items]);

  const [filters, setFilters] = useState<ExplorerFilters>({
    showResearch: true,
    showReviews: true,
    showPatents: true,
    starredOnly: false,
    minYear: oldestYear,
    maxYear: NOW,
    query: "",
    sort: "year",
  });

  const [yearMinInput, setYearMinInput] = useState(String(oldestYear));
  const [yearMaxInput, setYearMaxInput] = useState(String(NOW));

  // Starred keys derived from the molecule sidecar (DOIs + patent ids).
  const [starredKeys, setStarredKeys] = useState<Set<string>>(() => {
    const keys = new Set<string>();
    for (const sp of molecule?.starred_papers ?? []) {
      if (sp.doi) keys.add(sp.doi);
      if (sp.patent_id) keys.add(sp.patent_id);
    }
    return keys;
  });

  const [saving, setSaving] = useState(false);

  const filtered = useMemo(
    () => applyExplorerFilters(items, filters, starredKeys),
    [items, filters, starredKeys],
  );

  const researchCount = items.filter((i) => i.type === "research").length;
  const reviewCount = items.filter((i) => i.type === "review").length;
  const patentCount = items.filter((i) => i.type === "patent").length;
  const starredCount = items.filter((i) => starredKeys.has(itemKey(i))).length;

  const bins = useMemo(
    () => buildYearBins(items, filters.minYear, filters.maxYear),
    [items, filters.minYear, filters.maxYear],
  );
  const maxBinTotal = useMemo(() => Math.max(1, ...bins.map((b) => b.total)), [bins]);

  const commitYears = useCallback(() => {
    const lo = parseInt(yearMinInput, 10);
    const hi = parseInt(yearMaxInput, 10);
    const minY = isNaN(lo) ? oldestYear : lo;
    const maxY = isNaN(hi) ? NOW : hi;
    setFilters((f) => ({
      ...f,
      minYear: Math.min(minY, maxY),
      maxYear: Math.max(minY, maxY),
    }));
  }, [yearMinInput, yearMaxInput, oldestYear]);

  const zoomToBar = useCallback((lo: number, hi: number) => {
    setYearMinInput(String(lo));
    setYearMaxInput(String(hi));
    setFilters((f) => ({ ...f, minYear: lo, maxYear: hi }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({
      showResearch: true,
      showReviews: true,
      showPatents: true,
      starredOnly: false,
      minYear: oldestYear,
      maxYear: NOW,
      query: "",
      sort: "year",
    });
    setYearMinInput(String(oldestYear));
    setYearMaxInput(String(NOW));
  }, [oldestYear]);

  // Write star state to the molecule sidecar.
  const handleStarChange = useCallback(
    async (item: ExplorerItem, star: boolean) => {
      if (!molecule) return; // read-only mode: nowhere to persist stars
      const key = itemKey(item);
      const newKeys = new Set(starredKeys);
      if (star) {
        newKeys.add(key);
      } else {
        newKeys.delete(key);
      }
      setStarredKeys(newKeys);

      // Build the new starred_papers array from the current items + new key set.
      const newStarred: StarredPaper[] = items
        .filter((it) => newKeys.has(itemKey(it)))
        .map(itemToStarredPaper);

      setSaving(true);
      try {
        const updated = await moleculesApi.setStarredPapers(molecule.id, newStarred);
        if (updated) onStarsChanged?.(updated);
      } finally {
        setSaving(false);
      }
    },
    [starredKeys, items, molecule, onStarsChanged],
  );

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="fixed inset-0 bg-black/45 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[min(940px,94vw)] h-[min(640px,90vh)] bg-surface border border-border rounded-2xl overflow-hidden flex flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Literature explorer for ${heading}`}
      >
        {/* header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-surface-raised flex-none">
          <span className="font-bold text-foreground">
            Literature for{" "}
            <span className="text-brand-action">{heading}</span>
            <small className="ml-2 font-normal text-foreground-muted text-[12px]">
              ({filtered.length} of {items.length})
            </small>
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-foreground-muted">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Live, Europe PMC + PubChem
          </span>
          {saving && (
            <span className="text-[11px] text-foreground-muted animate-pulse">Saving…</span>
          )}
          <Tooltip label="Close (Esc)">
            <button
              type="button"
              aria-label="Close literature explorer"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-chip text-foreground-muted hover:text-foreground transition-colors"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        {/* body */}
        <div className="flex flex-1 min-h-0">
          {/* left rail */}
          <div className="w-60 flex-none border-r border-border px-3.5 py-3 overflow-y-auto">
            {/* Type */}
            <p className="text-[10px] uppercase tracking-widest text-foreground-muted font-semibold mb-1.5">
              Type
            </p>
            <label className="flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer hover:bg-surface-chip text-[13px]">
              <input
                data-testid="lit-explorer-filter-research"
                type="checkbox"
                checked={filters.showResearch}
                onChange={(e) => setFilters((f) => ({ ...f, showResearch: e.target.checked }))}
                className="accent-brand-action"
              />
              <span
                className="w-2.5 h-2.5 rounded-sm flex-none"
                style={{ background: "var(--color-brand-action, #1283C9)" }}
              />
              Research
              <span className="ml-auto text-[11px] text-foreground-muted bg-surface-chip px-1.5 rounded-full">
                {researchCount}
              </span>
            </label>
            <label className="flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer hover:bg-surface-chip text-[13px]">
              <input
                type="checkbox"
                checked={filters.showReviews}
                onChange={(e) => setFilters((f) => ({ ...f, showReviews: e.target.checked }))}
                className="accent-brand-action"
              />
              <span className="w-2.5 h-2.5 rounded-sm flex-none bg-purple-500" />
              Reviews
              <span className="ml-auto text-[11px] text-foreground-muted bg-surface-chip px-1.5 rounded-full">
                {reviewCount}
              </span>
            </label>
            <label className="flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer hover:bg-surface-chip text-[13px]">
              <input
                type="checkbox"
                checked={filters.showPatents}
                onChange={(e) => setFilters((f) => ({ ...f, showPatents: e.target.checked }))}
                className="accent-brand-action"
              />
              <span className="w-2.5 h-2.5 rounded-sm flex-none bg-amber-500" />
              Patents
              <span className="ml-auto text-[11px] text-foreground-muted bg-surface-chip px-1.5 rounded-full">
                {patentCount}
              </span>
            </label>
            {starsEnabled && (
              <label className="flex items-center gap-2 px-1.5 py-1 rounded-lg cursor-pointer hover:bg-surface-chip text-[13px]">
                <input
                  type="checkbox"
                  checked={filters.starredOnly}
                  onChange={(e) => setFilters((f) => ({ ...f, starredOnly: e.target.checked }))}
                  className="accent-brand-action"
                />
                <span className="w-2.5 h-2.5 rounded-sm flex-none bg-amber-400" />
                Starred only
                <span className="ml-auto text-[11px] text-foreground-muted bg-surface-chip px-1.5 rounded-full">
                  {starredCount}
                </span>
              </label>
            )}

            {/* The badge counts are the loaded sample, not the whole corpus. A
                well-studied compound has thousands of papers and patents; we load
                the most-cited papers + a capped patent slice, so spell out the
                true totals to avoid reading the sample as the full picture. */}
            {(paperTotal != null && paperTotal > researchCount + reviewCount) ||
            (patentTotal != null && patentTotal > patentCount) ? (
              <p className="mt-2 text-[10px] leading-tight text-foreground-muted">
                Showing the top {(researchCount + reviewCount).toLocaleString("en-US")}
                {paperTotal != null ? ` of ${paperTotal.toLocaleString("en-US")}` : ""} papers
                {patentTotal != null
                  ? ` and ${patentCount.toLocaleString("en-US")} of ${patentTotal.toLocaleString("en-US")} patents`
                  : ""}
                . Most-cited first.
              </p>
            ) : null}

            {/* Year histogram */}
            <p className="text-[10px] uppercase tracking-widest text-foreground-muted font-semibold mt-3.5 mb-1">
              Years
              <span className="float-right font-normal text-[10px] normal-case tracking-normal">
                {filtered.length} shown
              </span>
            </p>
            <p className="text-[11px] text-foreground-muted mb-2 leading-tight">
              Papers per year. Click a bar to zoom. Purple bars are review-dominated.
            </p>
            <div className="flex items-end gap-0.5 pb-5 mb-2" style={{ height: "74px" }}>
              {bins.map((bin) => (
                <HistBar
                  key={bin.year}
                  bin={bin}
                  maxTotal={maxBinTotal}
                  onZoom={zoomToBar}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-foreground-muted mb-3">
              <input
                data-testid="lit-explorer-year-min"
                type="number"
                value={yearMinInput}
                onChange={(e) => setYearMinInput(e.target.value)}
                onBlur={commitYears}
                onKeyDown={(e) => { if (e.key === "Enter") commitYears(); }}
                className="w-16 text-center font-inherit text-[12px] px-1.5 py-1 border border-border rounded-lg bg-surface-raised text-foreground outline-none focus:border-brand-action"
                aria-label="Year from"
                inputMode="numeric"
              />
              <span>to</span>
              <input
                data-testid="lit-explorer-year-max"
                type="number"
                value={yearMaxInput}
                onChange={(e) => setYearMaxInput(e.target.value)}
                onBlur={commitYears}
                onKeyDown={(e) => { if (e.key === "Enter") commitYears(); }}
                className="w-16 text-center font-inherit text-[12px] px-1.5 py-1 border border-border rounded-lg bg-surface-raised text-foreground outline-none focus:border-brand-action"
                aria-label="Year to"
                inputMode="numeric"
              />
            </div>

            {/* Reset */}
            <p className="text-[10px] uppercase tracking-widest text-foreground-muted font-semibold mb-1.5">
              Reset
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="w-full text-[12px] font-semibold px-3 py-1.5 border border-border rounded-lg bg-surface hover:border-brand-action text-foreground transition-colors"
            >
              Clear filters
            </button>
          </div>

          {/* main results panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-none">
              <input
                type="text"
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
                placeholder="Filter by title, author, journal"
                className="flex-1 text-[13px] px-2.5 py-1.5 border border-border rounded-lg bg-surface-raised text-foreground outline-none focus:border-brand-action"
              />
              <select
                value={filters.sort}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    sort: e.target.value as ExplorerFilters["sort"],
                  }))
                }
                className="text-[12px] px-2 py-1.5 border border-border rounded-lg bg-surface text-foreground"
              >
                <option value="year">Newest first</option>
                <option value="cited">Most cited</option>
                <option value="title">Title A-Z</option>
              </select>
            </div>

            {/* results */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-foreground-muted text-[13px]">
                  No results with these filters. Clear filters or widen the year range.
                </div>
              ) : (
                filtered.map((item) => (
                  <PaperRow
                    key={itemKey(item)}
                    item={item}
                    isStarred={starredKeys.has(itemKey(item))}
                    starsEnabled={starsEnabled}
                    onStarChange={handleStarChange}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
