"use client";

// Literature companion for a single structure (chemistry-workbench Phase 1). The
// free answer to the SciFinder feature: the papers and patents that mention this
// compound, fetched browser-direct from Europe PMC (full-text mentions) and
// PubChem xrefs (curated linked papers + patents). No backend, no key.
//
// Used in the editor's companion rail ("Papers & patents" tab) and reusable by the
// hub "Find in literature" mode. It fetches once when mounted with a query, so the
// parent should only mount it when the tab is open (lazy, not on every editor open).

import { useEffect, useState } from "react";

import {
  europePmcPapers,
  pubchemLinks,
  patentGoogleUrl,
  type Paper,
} from "@/lib/chemistry/literature";
import { resolveNameToCid } from "@/lib/chemistry/pubchem";

interface LitData {
  hitCount: number;
  papers: Paper[];
  patentCount: number;
  patents: string[];
}

const nfmt = (n: number) => n.toLocaleString("en-US");

export function MoleculeLiterature({
  query,
  cid,
  maxPapers = 6,
  maxPatents = 12,
}: {
  /** Compound name (or any text) to search Europe PMC + resolve a CID from. */
  query: string;
  /** Known PubChem CID (e.g. for an imported compound); resolved from name if absent. */
  cid?: number;
  maxPapers?: number;
  maxPatents?: number;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LitData | null>(null);

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
        setData({
          hitCount: epmc.hitCount,
          papers: epmc.papers,
          patentCount: links.patents.length,
          patents: links.patents.slice(0, maxPatents),
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

  if (loading) {
    return (
      <p className="text-meta text-foreground-muted py-2">
        Fetching live from PubChem and Europe PMC…
      </p>
    );
  }
  if (error) {
    return <p className="text-meta text-red-600 dark:text-red-300 py-2">{error}</p>;
  }
  if (!data || (!data.papers.length && !data.patents.length)) {
    return (
      <p className="text-meta text-foreground-muted py-2">
        No papers or patents found for this structure.
      </p>
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <Stat n={data.hitCount} label="papers" />
        <Stat n={data.patentCount} label="patents" />
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
      </p>
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
