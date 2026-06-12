"use client";

// SureChEMBL substructure-to-patent search (chemistry-workbench Phase 1). The one
// capability PubChem lacks, and the headline answer to the SciFinder feature:
// enter a SMILES/SMARTS fragment, find compounds extracted from 28M patents that
// contain it. Browser-direct, no key. SureChEMBL is async (submit -> poll ->
// results) and sometimes slow or flaky, so the UI streams a status line and fails
// gracefully with a retry, never a dead spinner.

import { useCallback, useState } from "react";

import { Icon } from "@/components/icons";
import {
  surechemblSubstructure,
  surechemblUrl,
  type SureChemblHit,
} from "@/lib/chemistry/literature";
import { MoleculeThumbnail } from "./MoleculeThumbnail";

const nfmt = (n: number) => n.toLocaleString("en-US");
// Aspirin, a recognizable default fragment so the box is one click from a result.
const DEFAULT_FRAGMENT = "O=C(C)Oc1ccccc1C(=O)O";

export function SubstructurePatentSearch() {
  const [query, setQuery] = useState(DEFAULT_FRAGMENT);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<SureChemblHit[] | null>(null);
  const [count, setCount] = useState(0);

  const run = useCallback(async () => {
    const struct = query.trim();
    if (!struct || searching) return;
    setSearching(true);
    setError(null);
    setHits(null);
    setCount(0);
    setStatus("Submitting the fragment to SureChEMBL…");
    try {
      const result = await surechemblSubstructure(struct, {
        onStatus: (_message, c) => {
          if (c) setCount(c);
          setStatus(
            c
              ? `Searching 28M patents… ${nfmt(c)} matches so far`
              : "Searching 28M patents…",
          );
        },
      });
      setHits(result.hits);
      setCount(result.resultCount);
      setStatus("");
    } catch {
      setError(
        "SureChEMBL did not respond. Its public API is sometimes slow or down; try again in a moment.",
      );
      setStatus("");
    } finally {
      setSearching(false);
    }
  }, [query, searching]);

  return (
    <div className="mt-8 max-w-3xl bg-purple-50 dark:bg-purple-500/10 border border-border rounded-xl px-4 py-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-title font-bold text-foreground">
          Search patents by substructure
        </h3>
        <span className="text-meta font-semibold text-purple-600 dark:text-purple-300">
          SureChEMBL · 28M patents
        </span>
      </div>
      <p className="text-meta text-foreground-muted mb-3">
        The capability PubChem does not have. Enter a SMILES or SMARTS fragment;
        SureChEMBL finds compounds extracted from patent text and images that
        contain it.
      </p>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          placeholder="SMILES or SMARTS fragment"
          className="flex-1 text-meta font-mono text-foreground bg-surface-raised border border-border rounded-lg px-3 py-2 outline-none focus:border-brand-action"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={searching || !query.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-brand-action transition-colors hover:bg-brand-action/90 disabled:opacity-60"
        >
          <Icon name="search" className="w-4 h-4" />
          {searching ? "Searching…" : "Search patents"}
        </button>
      </div>

      {status ? (
        <p className="text-meta text-foreground-muted mt-3">{status}</p>
      ) : error ? (
        <p className="text-meta text-red-600 dark:text-red-300 mt-3">{error}</p>
      ) : hits ? (
        hits.length > 0 ? (
          <>
            <p className="text-meta text-foreground mt-3">
              <span className="font-bold text-purple-600 dark:text-purple-300">
                {nfmt(count)}
              </span>{" "}
              patent compounds contain this fragment. Showing {hits.length}; each
              links to its SureChEMBL record.
            </p>
            <div className="grid gap-2.5 mt-3 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
              {hits.map((h) => (
                <a
                  key={h.chemical_id}
                  href={surechemblUrl(h.chemical_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-surface-raised border border-border rounded-lg overflow-hidden hover:border-brand-action transition-colors"
                >
                  <span className="block h-[92px] bg-white grid place-items-center border-b border-border p-1.5">
                    <MoleculeThumbnail
                      structure={h.smiles}
                      width={130}
                      height={78}
                    />
                  </span>
                  <span className="block px-2 py-1.5">
                    <span className="block text-[11.5px] font-semibold text-foreground leading-tight truncate">
                      {h.name || h.chemical_id}
                    </span>
                    <span className="block text-[11px] font-mono text-foreground-muted truncate">
                      {h.mol_formula}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </>
        ) : (
          <p className="text-meta text-foreground-muted mt-3">
            No patent compounds found containing this fragment.
          </p>
        )
      ) : null}
    </div>
  );
}
