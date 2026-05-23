"use client";

/**
 * Settings search infrastructure (settings search UX manager, 2026-05-23).
 *
 * The Settings page has grown to ~3400 lines across ~15 sections and 30+
 * rows. Finding a specific toggle (e.g. "tint header with my color")
 * required scrolling or remembering which section it lived under. This
 * module backs the inline filter bar at the top of the page: as the user
 * types, sections + rows whose label or description contains the query
 * (case-insensitive substring) stay visible; everything else hides.
 *
 * Design (option A from the role brief):
 *   - One top-level `SettingsSearchProvider` holds the raw + lowercased
 *     query. Every section + row reads from it via `useSettingsSearch`.
 *   - Each section creates its own `SectionMatchProvider` so child rows
 *     can register their searchable label / description. The section
 *     uses the registered set + its own label / desc to decide whether
 *     to hide itself (zero matches with a non-empty query). The
 *     registry lives in `useState` (a new Map on each register / unregister)
 *     so the section re-renders automatically when its row population
 *     changes — no manual force-tick required.
 *   - `<HighlightedText>` wraps the matching substring in a `<mark>`
 *     element so the eye lands on the hit. Empty query is a no-op.
 *
 * V4 tour-target preservation: this module is a pure data layer + a
 * tiny <mark> renderer. The page-level `SectionShell` keeps its
 * `data-tour-target` attribute on the outermost <section> exactly where
 * it lives today; the wrapper passes the prop through untouched. The
 * step-bodies.test.tsx assertions on
 * `[data-tour-target="settings-color-picker"]` etc. stay green.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ── Search query context ────────────────────────────────────────────────────

interface SearchCtx {
  /** Raw query (preserves the user's casing for the empty-state echo). */
  query: string;
  /** Lowercased + trimmed query — what every match check reads. */
  lower: string;
  /** True iff `lower` is non-empty. Cheap fast-path for the no-filter case. */
  active: boolean;
  setQuery: (next: string) => void;
}

const SettingsSearchContext = createContext<SearchCtx>({
  query: "",
  lower: "",
  active: false,
  setQuery: () => {},
});

export function SettingsSearchProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [query, setQueryRaw] = useState("");
  // Debounce the lower-cased query update by ~120ms so a fast typist
  // doesn't trigger a re-render storm across every row.
  const [debouncedLower, setDebouncedLower] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedLower(query.trim().toLowerCase());
    }, 120);
    return () => window.clearTimeout(id);
  }, [query]);

  const setQuery = useCallback((next: string) => {
    setQueryRaw(next);
  }, []);

  const value = useMemo<SearchCtx>(
    () => ({
      query,
      lower: debouncedLower,
      active: debouncedLower.length > 0,
      setQuery,
    }),
    [query, debouncedLower, setQuery],
  );

  return (
    <SettingsSearchContext.Provider value={value}>
      {children}
    </SettingsSearchContext.Provider>
  );
}

export function useSettingsSearch(): SearchCtx {
  return useContext(SettingsSearchContext);
}

// ── Per-section row registration ────────────────────────────────────────────

interface SectionMatchCtx {
  /** Register a row's searchable strings. Returns an unregister callback. */
  register: (id: string, label: string, desc?: string) => () => void;
}

const SectionMatchContext = createContext<SectionMatchCtx | null>(null);

/**
 * Wrap a section's children in this so `<SearchableRow>`s inside it can
 * register their label / description. The provider is a thin shell over
 * the `register` callback supplied by the parent section — the parent
 * holds the actual row registry in `useState` so registrations trigger
 * proper re-renders without a manual bump-tick.
 */
export function SectionMatchProvider({
  register,
  children,
}: {
  register: (id: string, label: string, desc?: string) => () => void;
  children: ReactNode;
}) {
  const ctx = useMemo<SectionMatchCtx>(
    () => ({ register }),
    [register],
  );

  return (
    <SectionMatchContext.Provider value={ctx}>
      {children}
    </SectionMatchContext.Provider>
  );
}

export function useSectionMatch(): SectionMatchCtx | null {
  return useContext(SectionMatchContext);
}

// ── Match predicate ─────────────────────────────────────────────────────────

/**
 * Case-insensitive substring match on `label` OR `desc`. The query is
 * already lowercased and trimmed by the provider; callers pass the raw
 * label / desc strings (the helper lowercases them once per call).
 */
export function matchesText(
  lowerQuery: string,
  label: string,
  desc?: string,
): boolean {
  if (!lowerQuery) return true;
  if (label.toLowerCase().includes(lowerQuery)) return true;
  if (desc && desc.toLowerCase().includes(lowerQuery)) return true;
  return false;
}

// ── Highlight helper ────────────────────────────────────────────────────────

/**
 * Wrap occurrences of `query` (case-insensitive) inside `text` with a
 * `<mark>` element so the matching substring stands out. Empty query
 * passes through unchanged. Preserves whitespace + punctuation from the
 * source. The `<mark>` styling matches the page palette (amber 200).
 */
export function HighlightedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { lower } = useSettingsSearch();
  if (!lower) return <span className={className}>{text}</span>;
  const lc = text.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const hit = lc.indexOf(lower, i);
    if (hit === -1) {
      parts.push(<span key={key++}>{text.slice(i)}</span>);
      break;
    }
    if (hit > i) {
      parts.push(<span key={key++}>{text.slice(i, hit)}</span>);
    }
    parts.push(
      <mark
        key={key++}
        className="bg-yellow-200 text-inherit rounded px-0.5"
      >
        {text.slice(hit, hit + lower.length)}
      </mark>,
    );
    i = hit + lower.length;
  }
  return <span className={className}>{parts}</span>;
}

// ── Searchable row ──────────────────────────────────────────────────────────

/**
 * Wraps a row so the page-level search filter can find it.
 *
 *  - When the query is empty: renders children as-is (no class change).
 *  - When the query is non-empty AND this row matches: renders children
 *    with a subtle highlight (amber-50 ring + yellow tint) so the eye
 *    lands on the hit.
 *  - When the query is non-empty AND this row does NOT match: renders
 *    hidden (HTML `hidden` attribute so screen readers also skip it).
 *
 * `label` is the human-readable row label; `desc` is the optional
 * description / sub-label. Both feed the substring match.
 *
 * Call sites must use a stable `id` per row inside a section (e.g. the
 * label itself works if labels are unique within the section).
 */
export function SearchableRow({
  id,
  label,
  desc,
  children,
  className,
}: {
  id: string;
  label: string;
  desc?: string;
  children: ReactNode;
  className?: string;
}) {
  const { lower, active } = useSettingsSearch();
  const section = useSectionMatch();

  // Register with the parent section so the section knows whether any
  // of its rows match the current query. The `register` callback
  // returns its own unregister handle; pass it straight through as the
  // effect cleanup.
  useEffect(() => {
    if (!section) return undefined;
    return section.register(id, label, desc);
  }, [section, id, label, desc]);

  const matches = matchesText(lower, label, desc);
  const shouldHide = active && !matches;
  const highlight = active && matches;

  // When the row is fully visible AND not highlighted, render the
  // wrapper as `display: contents` so it's transparent to the parent's
  // layout (matters for SelectFields that live inside a CSS grid — an
  // opaque div wrapper would otherwise break the grid track). The
  // `hidden` and highlight paths each need a real flow element so the
  // attribute / styling take effect, so `contents` is gated on
  // !shouldHide && !highlight.
  const wrapperClass = [
    className ?? "",
    highlight
      ? "rounded-md ring-1 ring-yellow-200 bg-yellow-50/60 px-2 -mx-2 py-1 -my-1"
      : !shouldHide
        ? "contents"
        : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div hidden={shouldHide} className={wrapperClass}>
      {children}
    </div>
  );
}

// ── Section-level helpers ───────────────────────────────────────────────────

/**
 * Hook for `SectionShell` (and the inlined Streaks-section shell) to
 * decide whether to hide itself + the `register` callback to thread
 * through `SectionMatchProvider` so child rows can sign in. Returns:
 *
 *   - `lower`: the active lowercased query.
 *   - `active`: whether filtering is on.
 *   - `register`: pass to `SectionMatchProvider`.
 *   - `matchesQuery`: predicate used by callers that need the same
 *     case-insensitive substring test.
 *   - `sectionMatches`: true iff the section's own label / desc matches.
 *   - `anyRowMatches`: true iff any registered row matches.
 *   - `shouldHide`: convenience derived flag.
 *
 * Implementation note: the row registry lives in `useState` (a Map kept
 * by reference but swapped via `setRows(new Map(...))` on each
 * register / unregister). This avoids touching `.current` of a ref
 * during render — the lint rule `react-hooks/refs` complains about that
 * pattern, and using state means the re-render is automatic instead of
 * relying on a separate bump-tick.
 */
export function useSectionSearchState(label: string, desc?: string) {
  const { lower, active } = useSettingsSearch();
  const [rows, setRows] = useState<
    Map<string, { label: string; desc?: string }>
  >(() => new Map());

  const register = useCallback(
    (id: string, rowLabel: string, rowDesc?: string) => {
      setRows((prev) => {
        const next = new Map(prev);
        next.set(id, { label: rowLabel, desc: rowDesc });
        return next;
      });
      return () => {
        setRows((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      };
    },
    [],
  );

  const matchesQuery = useCallback(
    (l: string, d?: string) => matchesText(lower, l, d),
    [lower],
  );

  const sectionMatches = matchesQuery(label, desc);
  let anyRowMatches = false;
  for (const { label: rl, desc: rd } of rows.values()) {
    if (matchesQuery(rl, rd)) {
      anyRowMatches = true;
      break;
    }
  }

  const shouldHide = active && !sectionMatches && !anyRowMatches;

  return {
    lower,
    active,
    register,
    matchesQuery,
    sectionMatches,
    anyRowMatches,
    shouldHide,
  };
}
