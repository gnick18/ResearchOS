"use client";

// useLabIndexSearch — lab-wide search over the per-member index for a lab head.
//
// Loads the whole-lab index ONCE (the expensive part, one tiny encrypted file
// per member) via a cached query, then filters and ranks client-side as the
// query changes, so typing does not re-read the relay on every keystroke. The
// underlying searchLabIndex is role-gated; for a non-lab-head it returns
// ok:false, so the hook surfaces an empty, not-allowed state and the caller can
// hide the panel.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  searchLabIndex,
  scoreEntry,
  type LabSearchHit,
} from "@/lib/lab/lab-index-search";

export interface UseLabIndexSearchResult {
  /** Ranked hits for the current query (or all entries when the query is empty). */
  hits: LabSearchHit[];
  /** True while the one-time index load is in flight. */
  loading: boolean;
  /** True when the lab-wide index loaded (the viewer is a lab head with a lab). */
  ok: boolean;
  /** Set when the load was refused or failed. */
  error?: string;
  /** Total indexed records across the lab, regardless of the current query. */
  total: number;
}

export function useLabIndexSearch(
  query: string,
  opts: { enabled?: boolean } = {},
): UseLabIndexSearchResult {
  const enabled = opts.enabled ?? true;

  // One cached browse load of the entire lab index. Empty query returns every
  // entry; we rank locally below.
  const { data, isLoading } = useQuery({
    queryKey: ["lab-index", "all"],
    queryFn: () => searchLabIndex(""),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const all = data?.hits ?? [];
  const ok = data?.ok ?? false;

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    const scored: LabSearchHit[] = [];
    for (const e of all) {
      const score = scoreEntry(e, q);
      if (score === 0) continue;
      scored.push({ ...e, score });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
        a.title.localeCompare(b.title),
    );
    return scored;
  }, [all, query]);

  return {
    hits,
    loading: isLoading,
    ok,
    error: data?.error,
    total: all.length,
  };
}
