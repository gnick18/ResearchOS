"use client";

// PubChem import dialog (chemistry-workbench Phase 1). Mirrors the sequences NCBI
// import: search a public government database browser-direct, preview the
// structure + metadata, import into the library in one click. The only thing that
// leaves the browser is the name typed, sent to PubChem (a public NIH resource),
// the same privacy story the copy states.
//
// We resolve the name to a compound and fetch its 2D SDF, then render the preview
// thumbnail with RDKit (the PubChem depiction PNG is not allowed by our img-src
// CSP, and connect-src is open to PubChem, so the SDF + RDKit path is correct).
// Import stores the SDF's Molfile block as the molecule's .mol with
// source "pubchem" and the CID recorded.

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import { moleculesApi } from "@/lib/chemistry/api";
import {
  searchCompound,
  fetchSdf,
  type PubChemCompound,
} from "@/lib/chemistry/pubchem";
import { computeIdentity } from "@/lib/chemistry/rdkit";
import { MoleculeThumbnail } from "./MoleculeThumbnail";

// A PubChem 2D SDF is a Molfile (connection table up to "M  END") followed by the
// data block and the "$$$$" delimiter. The store's source of truth is the Molfile,
// so we keep the connection table (which carries the 2D coordinates) and drop the
// SDF property tail. RDKit parses either, but storing a clean Molfile keeps the
// editor reopen faithful.
function molblockFromSdf(sdf: string): string {
  const i = sdf.indexOf("M  END");
  return i >= 0 ? `${sdf.slice(0, i + 6)}\n` : sdf;
}

interface Result {
  compound: PubChemCompound;
  molblock: string;
  /** Canonical SMILES for a clean preview (PubChem 2D SDFs carry explicit Hs). */
  previewSmiles?: string;
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
  const [result, setResult] = useState<Result | null>(null);
  const [importing, setImporting] = useState(false);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const compound = await searchCompound(q);
      const sdf = await fetchSdf(compound.cid);
      const molblock = molblockFromSdf(sdf);
      // Canonical SMILES gives a clean depiction (no explicit Hs) for the preview;
      // the Molfile is still what we store, to keep PubChem's 2D coordinates.
      const previewSmiles = await computeIdentity(molblock)
        .then((id) => id.smiles || undefined)
        .catch(() => undefined);
      setResult({ compound, molblock, previewSmiles });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "PubChem search failed. Try another name.",
      );
    } finally {
      setLoading(false);
    }
  }, [query, loading]);

  const handleImport = useCallback(async () => {
    if (!result || importing) return;
    setImporting(true);
    try {
      const detail = await moleculesApi.create(result.molblock, {
        name: result.compound.name,
        source: "pubchem",
        pubchem_cid: result.compound.cid,
      });
      await queryClient.invalidateQueries({ queryKey: ["molecules"] });
      onImported?.(detail.meta.id);
      onClose();
    } catch {
      setError("Import failed. The structure is still available to retry.");
    } finally {
      setImporting(false);
    }
  }, [result, importing, queryClient, onImported, onClose]);

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Search PubChem"
      widthClassName="max-w-2xl"
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
              onClick={() => void runSearch()}
              disabled={loading || !query.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-gradient-to-br from-brand-action to-brand-purple disabled:opacity-60"
            >
              <Icon name="search" className="w-4 h-4" />
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
          <p className="text-meta text-foreground-muted mt-2 max-w-prose">
            The only thing that leaves your browser is the name you type, sent to
            PubChem, a public NIH resource. No account, no proxy, no tracking. You
            receive back a public structure.
          </p>

          <div className="mt-4 min-h-[120px]">
            {error ? (
              <p className="text-meta text-red-600 dark:text-red-300 py-4">
                {error}
              </p>
            ) : loading ? (
              <p className="text-meta text-foreground-muted py-4">
                Searching PubChem…
              </p>
            ) : result ? (
              <ResultCard
                result={result}
                importing={importing}
                onImport={handleImport}
              />
            ) : (
              <p className="text-meta text-foreground-muted py-4">
                Search a compound to preview its structure and metadata before
                importing.
              </p>
            )}
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}

function ResultCard({
  result,
  importing,
  onImport,
}: {
  result: Result;
  importing: boolean;
  onImport: () => void;
}) {
  const { compound, molblock, previewSmiles } = result;
  const mw =
    compound.mol_weight != null ? `${compound.mol_weight.toFixed(2)} g/mol` : "";
  return (
    <div className="flex gap-4 items-center bg-surface-raised border border-border rounded-xl p-3 shadow-sm">
      <div className="w-[130px] h-[120px] flex-shrink-0 bg-white grid place-items-center rounded-lg border border-border p-2">
        <MoleculeThumbnail
          structure={previewSmiles || molblock}
          width={150}
          height={104}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-title font-bold text-foreground truncate">
          {compound.name}
        </div>
        <div className="text-meta text-foreground-muted font-mono leading-relaxed mt-1">
          CID {compound.cid}
          <br />
          {[compound.formula, mw].filter(Boolean).join(" · ")}
          {compound.inchikey ? (
            <>
              <br />
              {compound.inchikey}
            </>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onImport}
        disabled={importing}
        className="inline-flex items-center gap-2 px-4 py-2 text-body font-semibold text-white rounded-lg bg-gradient-to-br from-brand-action to-brand-purple disabled:opacity-60 flex-shrink-0"
      >
        <Icon name="download" className="w-4 h-4" />
        {importing ? "Importing…" : "Import to library"}
      </button>
    </div>
  );
}
