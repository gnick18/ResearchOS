"use client";

// Literature companion for a single structure (chemistry-workbench Phase 1). The
// free answer to the SciFinder feature: the papers and patents that mention this
// compound, fetched browser-direct from Europe PMC (full-text mentions) and
// PubChem xrefs (curated linked papers + patents). No backend, no key.
//
// Used in the editor's companion rail ("Papers & patents" tab) and reusable by the
// hub "Find in literature" mode. It fetches once when mounted with a query, so the
// parent should only mount it when the tab is open (lazy, not on every editor open).
//
// Updated (literature-explorer, 2026-06-12): adds an "Open explorer" button that
// opens LiteratureExplorer for the current molecule + query, and a starred-papers
// strip showing the molecule's saved DOIs/patents as one-click chips.

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  europePmcPapers,
  pubchemLinks,
  patentGoogleUrl,
  makePatentItem,
  paperToExplorerItem,
  type ExplorerItem,
  type Paper,
} from "@/lib/chemistry/literature";
import { resolveNameToCid } from "@/lib/chemistry/pubchem";
import { type MoleculeMeta, type StarredPaper } from "@/lib/chemistry/api";
import { LiteratureExplorer } from "./LiteratureExplorer";

interface LitData {
  hitCount: number;
  papers: Paper[];
  patentCount: number;
  patents: string[];
  /** All items combined for the explorer (papers as ExplorerItem + patent items). */
  explorerItems: ExplorerItem[];
}

const nfmt = (n: number) => n.toLocaleString("en-US");

// The explorer mixes papers and patents into one histogram + list. PubChem can
// link thousands of patents to a well-studied compound (gliotoxin returns ~9k),
// which would swamp the papers 1000:1 and make the view read as patent-only.
// Cap the patents fed to the explorer to roughly the paper sample size so both
// types are represented; the true total is still surfaced as "of N".
const EXPLORER_PATENT_CAP = 200;

export function MoleculeLiterature({
  query,
  cid,
  molecule,
  maxPapers = 200,
  maxPatents = 12,
  onStarsChanged,
}: {
  /** Compound name (or any text) to search Europe PMC + resolve a CID from. */
  query: string;
  /** Known PubChem CID (e.g. for an imported compound); resolved from name if absent. */
  cid?: number;
  /**
   * The molecule this literature block belongs to. When provided, enables the
   * "Open explorer" button and the starred-papers strip. When absent (e.g. the
   * hub free-search mode with no molecule context), those features are hidden.
   */
  molecule?: MoleculeMeta;
  maxPapers?: number;
  maxPatents?: number;
  /** Called after a star/unstar write so the parent can refresh the molecule. */
  onStarsChanged?: (updated: MoleculeMeta) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LitData | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);
  // Local copy of molecule so star updates reflect immediately.
  const [liveMolecule, setLiveMolecule] = useState<MoleculeMeta | undefined>(molecule);

  // Keep liveMolecule in sync if the parent refreshes the prop.
  useEffect(() => { setLiveMolecule(molecule); }, [molecule]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setLoading(false);
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        // Resolve a CID for the PubChem xref links (skip if we already have one).
        const resolvedCid =
          cid ?? (await resolveNameToCid(q).catch(() => null));
        // Track whether Europe PMC actually FAILED (network) vs returned 0 hits,
        // so a real outage reads as an error and a genuinely-unstudied compound
        // reads as "no results". PubChem links failing is non-fatal (no patents).
        let epmcFailed = false;
        const [epmc, links] = await Promise.all([
          europePmcPapers(q, maxPapers).catch(() => {
            epmcFailed = true;
            return { hitCount: 0, papers: [] };
          }),
          resolvedCid != null
            ? pubchemLinks(resolvedCid).catch(() => ({
                papers: null,
                patents: [] as string[],
              }))
            : Promise.resolve({ papers: null, patents: [] as string[] }),
        ]);
        if (cancelled) return;
        if (epmcFailed) {
          setError(
            "Could not reach the literature sources. Try again in a moment.",
          );
          return;
        }
        const explorerItems: ExplorerItem[] = [
          ...epmc.papers.map(paperToExplorerItem),
          ...links.patents.slice(0, EXPLORER_PATENT_CAP).map(makePatentItem),
        ];
        setData({
          hitCount: epmc.hitCount,
          papers: epmc.papers,
          patentCount: links.patents.length,
          patents: links.patents.slice(0, maxPatents),
          explorerItems,
        });
      } catch {
        if (!cancelled) setError("Could not reach the literature sources.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, cid, maxPapers, maxPatents]);

  const handleStarsChanged = useCallback((updated: MoleculeMeta) => {
    setLiveMolecule(updated);
    onStarsChanged?.(updated);
  }, [onStarsChanged]);

  // ---- render ----

  const starredStrip = liveMolecule?.starred_papers?.length ? (
    <StarredStrip papers={liveMolecule.starred_papers} />
  ) : null;

  if (loading) {
    return (
      <div>
        {starredStrip}
        <p className="text-meta text-foreground-muted py-2">
          Fetching live from PubChem and Europe PMC…
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        {starredStrip}
        <p className="text-meta text-red-600 dark:text-red-300 py-2">{error}</p>
      </div>
    );
  }
  if (!data || (!data.papers.length && !data.patents.length)) {
    return (
      <div>
        {starredStrip}
        <p className="text-meta text-foreground-muted py-2">
          No papers or patents found for this structure.
        </p>
      </div>
    );
  }

  return (
    <div>
      {starredStrip}

      <div className="flex items-center gap-2 mb-3">
        <div className="flex gap-2 flex-1">
          <Stat n={data.hitCount} label="papers" />
          <Stat n={data.patentCount} label="patents" />
        </div>
        {data.explorerItems.length > 0 && (
          <button
            type="button"
            data-testid="lit-explorer-open"
            onClick={() => setExplorerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-border rounded-lg bg-surface hover:border-brand-action hover:text-brand-action text-foreground transition-colors flex-none"
          >
            <Icon name="search" className="w-3.5 h-3.5" />
            View all
          </button>
        )}
      </div>

      {data.papers.length > 0 && (
        <div className="mb-3">
          {data.papers.map((p) => (
            <div key={`${p.source}-${p.id}`} className="py-1.5 border-b border-border">
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-meta font-semibold text-foreground hover:text-brand-action leading-snug block"
              >
                {p.title}
              </a>
              <div className="text-[11px] text-foreground-muted mt-0.5">
                {[p.journal, p.year].filter(Boolean).join(" · ")}
                {p.isReview && (
                  <span className="ml-1 text-[10px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-300">
                    Review
                  </span>
                )}
                {p.citedBy > 0 ? ` · ${nfmt(p.citedBy)} cited` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.patents.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.patents.map((id) => (
            <a
              key={id}
              href={patentGoogleUrl(id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono px-2 py-1 rounded-md bg-surface-raised border border-border text-foreground hover:border-brand-action hover:text-brand-action"
            >
              {id}
            </a>
          ))}
        </div>
      )}

      <p className="text-[11px] text-foreground-muted mt-3">
        Live from Europe PMC (full-text mentions) + PubChem (curated links). The
        free 90 percent, not CAS curation.
        {data.explorerItems.length > 0 && (
          <>
            {" "}
            <button
              type="button"
              data-testid="lit-explorer-open"
              onClick={() => setExplorerOpen(true)}
              className="text-brand-action hover:underline font-semibold"
            >
              Open full explorer
            </button>{" "}
            to filter by year, type{liveMolecule ? ", and star papers" : ""}.
          </>
        )}
      </p>

      {explorerOpen && data.explorerItems.length > 0 && (
        <LiteratureExplorer
          molecule={liveMolecule}
          title={query}
          items={data.explorerItems}
          paperTotal={data.hitCount}
          patentTotal={data.patentCount}
          onClose={() => setExplorerOpen(false)}
          onStarsChanged={handleStarsChanged}
        />
      )}
    </div>
  );
}

/** Compact strip of starred papers/patents shown above the quick-peek results. */
function StarredStrip({ papers }: { papers: StarredPaper[] }) {
  if (!papers.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {papers.map((sp) => {
        const key = sp.doi ?? sp.patent_id ?? sp.title;
        const href = sp.doi
          ? `https://doi.org/${sp.doi}`
          : sp.patent_id
            ? `https://patents.google.com/patent/${sp.patent_id.replace(/-/g, "")}/en`
            : undefined;
        const label = sp.doi ? `doi:${sp.doi}` : sp.patent_id ?? sp.title;
        const chip = (
          <span
            key={key}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-surface-chip border border-border text-foreground"
          >
            <Icon name="star" className="w-3 h-3 text-amber-400 fill-current flex-none" />
            <span className="max-w-[160px] truncate">
              {sp.title.length > 34 ? sp.title.slice(0, 34) + "…" : sp.title}
            </span>
            {label !== sp.title ? (
              <span className="text-foreground-muted font-mono ml-0.5">{label}</span>
            ) : null}
          </span>
        );
        if (href) {
          return (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer">
              {chip}
            </a>
          );
        }
        return chip;
      })}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex-1 bg-surface-overlay border border-border rounded-lg px-2.5 py-2 text-center">
      <div className="text-heading font-extrabold text-brand-action leading-none">
        {n > 0 ? nfmt(n) : "—"}
      </div>
      <div className="text-[10.5px] text-foreground-muted mt-1">{label}</div>
    </div>
  );
}
