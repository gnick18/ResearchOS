"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildSnippet,
  searchWikiIndex,
  type WikiSearchGroup,
  type WikiSearchHit,
  type WikiSearchIndex,
} from "@/lib/wiki/search";

/**
 * Wiki-wide search component. Lives at the top of the WikiSidebar and is
 * the canonical entry point for "find a page by typing." Loads the prebuilt
 * index at `/wiki-search-index.json` on first focus, then runs all queries
 * client-side (no server round-trips, no network beyond the first fetch).
 *
 * Behavior:
 *   - Empty / 1-char input: no dropdown (hint "type 2+ characters").
 *   - 2+ chars: ~180ms debounced query → grouped, ranked results.
 *   - ArrowDown / ArrowUp navigates results (wraps at edges).
 *   - Enter opens the highlighted result.
 *   - Escape clears the query and closes the dropdown.
 *   - Click-outside closes the dropdown without clearing the query.
 *
 * The component is mounted unconditionally on every wiki page (via the
 * sidebar), so the index fetch happens lazily on first focus to keep the
 * initial paint cheap.
 */

const DEBOUNCE_MS = 180;
const MAX_RESULTS = 25;
const INDEX_URL = "/wiki-search-index.json";

interface FlatHit {
  hit: WikiSearchHit;
  categoryLabel: string;
}

export default function WikiSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  const [index, setIndex] = useState<WikiSearchIndex | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // Debounce the query → debounced. We only re-search when `debounced` flips.
  useEffect(() => {
    if (query === debounced) return;
    const id = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query, debounced]);

  // Lazy-load the index on first focus. Idempotent; later focuses are no-ops.
  const ensureIndexLoaded = useCallback(() => {
    if (loadState !== "idle") return;
    setLoadState("loading");
    fetch(INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<WikiSearchIndex>;
      })
      .then((data) => {
        setIndex(data);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, [loadState]);

  const groups = useMemo<WikiSearchGroup[]>(() => {
    if (!index || debounced.trim().length < 2) return [];
    return searchWikiIndex(index, debounced, MAX_RESULTS);
  }, [index, debounced]);

  const flatHits = useMemo<FlatHit[]>(() => {
    const out: FlatHit[] = [];
    for (const group of groups) {
      for (const hit of group.hits) {
        out.push({ hit, categoryLabel: group.category.label });
      }
    }
    return out;
  }, [groups]);

  // Clamp the highlighted index to the current result count without calling
  // setState in an effect. The clamped value is what we render and what
  // keyboard handlers compare against.
  const clampedActiveIndex =
    flatHits.length === 0
      ? 0
      : Math.min(activeIndex, flatHits.length - 1);

  // Click-outside dismiss.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Auto-scroll the highlighted row into view when keyboard nav moves it.
  // jsdom (used by component tests) doesn't implement scrollIntoView, so
  // we feature-check before calling.
  useEffect(() => {
    if (!open || flatHits.length === 0) return;
    const el = listboxRef.current?.querySelector<HTMLAnchorElement>(
      `[data-wiki-search-row="${clampedActiveIndex}"]`,
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [clampedActiveIndex, open, flatHits.length]);

  function navigateTo(href: string) {
    setOpen(false);
    setQuery("");
    setDebounced("");
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query.length > 0) {
        setQuery("");
        setDebounced("");
      } else {
        setOpen(false);
        inputRef.current?.blur();
      }
      return;
    }
    if (!open) return;
    if (flatHits.length === 0) {
      // Enter / arrows are no-ops with no results.
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((clampedActiveIndex + 1) % flatHits.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(
        (clampedActiveIndex - 1 + flatHits.length) % flatHits.length,
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = flatHits[clampedActiveIndex];
      if (hit) navigateTo(hit.hit.entry.href);
    }
  }

  const showDropdown = open && query.trim().length >= 2;
  const showHint = open && query.trim().length > 0 && query.trim().length < 2;
  const showZeroState = showDropdown && flatHits.length === 0 && loadState === "ready";
  const showLoadingState = showDropdown && (loadState === "loading" || loadState === "idle");
  const showErrorState = showDropdown && loadState === "error";

  // Build a quick category-row map so we render category headers inline,
  // tracking which flat-hit row begins each category.
  const categoryRowStarts = useMemo(() => {
    const map = new Map<number, string>();
    let i = 0;
    for (const group of groups) {
      map.set(i, group.category.label);
      i += group.hits.length;
    }
    return map;
  }, [groups]);

  return (
    <div ref={containerRef} className="relative px-3 pt-3 pb-2">
      <label className="sr-only" htmlFor="wiki-search-input">
        Search the wiki
      </label>
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={inputRef}
          id="wiki-search-input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="wiki-search-results"
          aria-activedescendant={
            showDropdown && flatHits.length > 0
              ? `wiki-search-row-${clampedActiveIndex}`
              : undefined
          }
          placeholder="Search the wiki"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            ensureIndexLoaded();
            if (query.length > 0) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="w-full pl-8 pr-3 py-1.5 text-body bg-white border border-gray-200 rounded-md
            placeholder-gray-400 text-gray-900
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
            transition-colors"
        />
      </div>

      {showHint ? (
        <div
          className="absolute left-3 right-3 mt-1 px-3 py-2 text-meta text-gray-500
            bg-white border border-gray-200 rounded-md shadow-sm z-50"
        >
          Type 2 or more characters to search.
        </div>
      ) : null}

      {showLoadingState ? (
        <div
          className="absolute left-3 right-3 mt-1 px-3 py-2 text-meta text-gray-500
            bg-white border border-gray-200 rounded-md shadow-sm z-50"
        >
          Loading wiki index...
        </div>
      ) : null}

      {showErrorState ? (
        <div
          className="absolute left-3 right-3 mt-1 px-3 py-2 text-meta text-rose-600
            bg-white border border-rose-200 rounded-md shadow-sm z-50"
        >
          Couldn&apos;t load the search index. Reload the page to try again.
        </div>
      ) : null}

      {showZeroState ? (
        <div
          className="absolute left-3 right-3 mt-1 px-3 py-2 text-meta text-gray-500
            bg-white border border-gray-200 rounded-md shadow-sm z-50"
        >
          No matches for &ldquo;{query.trim()}&rdquo;.
        </div>
      ) : null}

      {showDropdown && flatHits.length > 0 ? (
        <div
          ref={listboxRef}
          id="wiki-search-results"
          role="listbox"
          aria-label="Wiki search results"
          className="absolute left-3 right-3 mt-1 max-h-[60vh] overflow-y-auto
            bg-white border border-gray-200 rounded-md shadow-lg z-50"
        >
          {flatHits.map((flat, i) => {
            const isActive = i === clampedActiveIndex;
            const categoryHeader = categoryRowStarts.get(i);
            return (
              <div key={`${flat.hit.entry.href}-${i}`}>
                {categoryHeader ? (
                  <div
                    className="px-3 pt-2 pb-1 text-meta uppercase tracking-wide
                      font-semibold text-gray-500 bg-gray-50 border-t border-gray-100
                      first:border-t-0"
                  >
                    {categoryHeader}
                  </div>
                ) : null}
                <a
                  id={`wiki-search-row-${i}`}
                  role="option"
                  aria-selected={isActive}
                  data-wiki-search-row={i}
                  href={flat.hit.entry.href}
                  onClick={(e) => {
                    e.preventDefault();
                    navigateTo(flat.hit.entry.href);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`block px-3 py-2 text-body border-t border-gray-100 first:border-t-0
                    transition-colors cursor-pointer
                    ${
                      isActive
                        ? "bg-blue-50 text-blue-900"
                        : "hover:bg-gray-50 text-gray-900"
                    }`}
                >
                  <div className="font-medium">{flat.hit.entry.title}</div>
                  <SnippetLine hit={flat.hit} query={debounced} />
                  <div className="mt-0.5 text-meta text-gray-500 truncate">
                    {flat.hit.entry.breadcrumbs.join(" / ")}
                  </div>
                </a>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Render the snippet line for one hit, with the matched substring bolded. */
function SnippetLine({ hit, query }: { hit: WikiSearchHit; query: string }) {
  const snippet = useMemo(() => buildSnippet(hit), [hit]);
  // For title matches the title itself is the snippet, and the title is
  // already rendered above as the row's main label — so skip rendering an
  // extra snippet line to avoid visual duplication.
  if (hit.match.kind === "title") {
    return null;
  }
  // Highlight the matched substring. For multi-word queries we highlight
  // the longest matching token to avoid spammy highlighting.
  const matchLen = snippet.matchLength;
  const before = snippet.text.slice(0, snippet.offset);
  const matched = snippet.text.slice(snippet.offset, snippet.offset + matchLen);
  const after = snippet.text.slice(snippet.offset + matchLen);
  // Silence unused-var warning while keeping the prop for future cross-token
  // highlighting if we extend the scoring model.
  void query;
  return (
    <div className="mt-0.5 text-meta text-gray-600 leading-snug line-clamp-2">
      {before}
      <mark className="bg-yellow-100 text-gray-900 px-0.5 rounded-sm">{matched}</mark>
      {after}
    </div>
  );
}
