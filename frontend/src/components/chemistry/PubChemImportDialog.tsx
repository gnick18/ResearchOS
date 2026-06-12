"use client";

// PubChem import dialog (chemistry-workbench Phase 1). Mirrors the sequences NCBI
// import: search a public government database browser-direct, preview several
// candidate compounds + their metadata, import any into the library in one click.
// The only thing that leaves the browser is the name typed, sent to PubChem (a
// public NIH resource), the privacy story the copy states.
//
// Each candidate card lazily fetches its own 2D SDF and renders the preview with
// RDKit (the PubChem depiction PNG is not allowed by our img-src CSP, and
// connect-src is open to PubChem). Import stores the SDF's Molfile block as the
// molecule's .mol with source "pubchem" and the CID recorded.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import { moleculesApi } from "@/lib/chemistry/api";
import {
  searchCompounds,
  fetchSdf,
  type PubChemCompound,
} from "@/lib/chemistry/pubchem";
import { computeIdentity } from "@/lib/chemistry/rdkit";
import { MoleculeThumbnail } from "./MoleculeThumbnail";

// A PubChem 2D SDF is a Molfile (connection table up to "M  END") followed by the
// data block and the "$$$$" delimiter. The store's source of truth is the Molfile,
// so we keep the connection table (its 2D coordinates) and drop the SDF tail.
function molblockFromSdf(sdf: string): string {
  const i = sdf.indexOf("M  END");
  return i >= 0 ? `${sdf.slice(0, i + 6)}\n` : sdf;
}

export function PubChemImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the new molecule id after a successful import. */
  onImported?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PubChemCompound[] | null>(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setCandidates(null);
    try {
      setCandidates(await searchCompounds(q, 8));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "PubChem search failed. Try another name.",
      );
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  const handleImported = useCallback(
    async (id: string) => {
      await queryClient.invalidateQueries({ queryKey: ["molecules"] });
      onImported?.(id);
      onClose();
    },
    [queryClient, onImported, onClose],
  );

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Search PubChem"
      widthClassName="max-w-3xl"
      card={false}
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-surface-sunken">
          <h3 className="text-title font-bold text-foreground">Search PubChem</h3>
          <p className="text-meta text-foreground-muted mt-0.5">
            Pull any of 100M+ public compounds with full metadata.
          </p>
        </div>

        <div className="px-5 py-4">
          <div className="flex gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
              placeholder="Compound name or CID, e.g. caffeine"
              className="flex-1 text-body text-foreground bg-surface-raised border border-border rounded-lg px-3 py-2 outline-none focus:border-brand-action"
            />
            <button
              type="button"
              data-testid="pubchem-search-submit"
              onClick={() => void runSearch()}
              disabled={loading || !query.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-brand-action transition-colors hover:bg-brand-action/90 disabled:opacity-60"
            >
              <Icon name="search" className="w-4 h-4" />
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
          <p className="text-meta text-foreground-muted mt-2 max-w-prose">
            The only thing that leaves your browser is the name you type, sent to
            PubChem, a public NIH resource. No account, no proxy, no tracking. You
            receive back public structures.
          </p>

          <div className="mt-4 min-h-[140px] max-h-[55vh] overflow-y-auto">
            {error ? (
              <p className="text-meta text-red-600 dark:text-red-300 py-4">
                {error}
              </p>
            ) : loading ? (
              <p className="text-meta text-foreground-muted py-4">
                Searching PubChem…
              </p>
            ) : candidates && candidates.length > 0 ? (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                {candidates.map((c) => (
                  <CandidateCard
                    key={c.cid}
                    compound={c}
                    onImported={handleImported}
                  />
                ))}
              </div>
            ) : (
              <p className="text-meta text-foreground-muted py-4">
                Search a compound to preview the candidates and import one.
              </p>
            )}
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}

function CandidateCard({
  compound,
  onImported,
}: {
  compound: PubChemCompound;
  onImported: (id: string) => void;
}) {
  const [molblock, setMolblock] = useState<string | null>(null);
  const [previewSmiles, setPreviewSmiles] = useState<string | undefined>(undefined);
  const [structErr, setStructErr] = useState(false);
  const [importing, setImporting] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Lazily fetch this candidate's 2D structure for the thumbnail (and to reuse on
  // import, so import does not re-fetch).
  useEffect(() => {
    let cancelled = false;
    fetchSdf(compound.cid)
      .then(async (sdf) => {
        if (cancelled || !alive.current) return;
        const mb = molblockFromSdf(sdf);
        setMolblock(mb);
        const smi = await computeIdentity(mb)
          .then((id) => id.smiles || undefined)
          .catch(() => undefined);
        if (!cancelled && alive.current) setPreviewSmiles(smi);
      })
      .catch(() => {
        if (!cancelled && alive.current) setStructErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, [compound.cid]);

  const handleImport = useCallback(async () => {
    if (!molblock || importing) return;
    setImporting(true);
    try {
      const detail = await moleculesApi.create(molblock, {
        name: compound.name,
        source: "pubchem",
        pubchem_cid: compound.cid,
        // Persist PubChem's physicochemical descriptors onto the sidecar so they
        // travel with the molecule record, the same as the BeakerBot import path.
        xlogp: compound.xlogp,
        h_bond_donor_count: compound.h_bond_donor_count,
        h_bond_acceptor_count: compound.h_bond_acceptor_count,
        tpsa: compound.tpsa,
      });
      onImported(detail.meta.id);
    } catch {
      setImporting(false);
    }
  }, [molblock, importing, compound, onImported]);

  const mw =
    compound.mol_weight != null ? `${compound.mol_weight.toFixed(2)} g/mol` : "";
  return (
    <div className="bg-surface-raised border border-border rounded-xl overflow-hidden shadow-sm flex flex-col">
      <div className="h-[120px] bg-white grid place-items-center border-b border-border p-2">
        {structErr ? (
          <span className="text-[11px] text-foreground-muted">no preview</span>
        ) : (
          <MoleculeThumbnail
            structure={previewSmiles || molblock || ""}
            width={180}
            height={104}
          />
        )}
      </div>
      <div className="px-3 py-2.5 flex flex-col gap-2 flex-1">
        <div>
          <div className="text-body font-bold text-foreground leading-tight line-clamp-2">
            {compound.name}
          </div>
          <div className="text-meta text-foreground-muted font-mono leading-relaxed mt-1">
            CID {compound.cid}
            <br />
            {[compound.formula, mw].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button
          type="button"
          data-testid="pubchem-import-btn"
          onClick={handleImport}
          disabled={importing || !molblock}
          className="mt-auto inline-flex items-center justify-center gap-2 px-3 py-1.5 text-meta font-semibold text-white rounded-lg bg-brand-action transition-colors hover:bg-brand-action/90 disabled:opacity-50"
        >
          <Icon name="download" className="w-3.5 h-3.5" />
          {importing ? "Importing…" : molblock ? "Import" : "Loading…"}
        </button>
      </div>
    </div>
  );
}
