"use client";

// sequence editor master. "Download from NCBI" dialog.
//
// A small typed form (Gene by symbol + organism, Genome by accession, or any
// Accession) -> a cheap dataset_report PREVIEW (organism, name, accession, size,
// contigs, assembly level) -> a CAPS gate (Download disabled with the exact
// reason when over a cap) -> a calm cancelable DOWNLOAD (fetch -> unzip ->
// parse). On success it hands the parsed ImportedSequence[] (tagged with NCBI
// provenance) back to the page, which reuses its existing persistNew path.
//
// PRIVACY. There is NO consent gate. The only thing sent out is the public
// identifier the user typed (a gene symbol + organism, or an accession) to a
// public government API, and we receive a public sequence. The copy says so.
//
// Inline stroke-only SVG icons (no emoji), <Tooltip> for icon-only controls,
// useEscapeToClose, site typography tokens. No em-dash, no mid-sentence colon.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  previewGeneBySymbol,
  previewGenomeByAccession,
  downloadPackage,
  includeForKind,
  checkCaps,
  resolveTaxonomy,
  sniffAccessionKind,
  NcbiDatasetsError,
  type NcbiPreview,
} from "@/lib/sequences/ncbi-datasets";
import {
  efetchGenbank,
  resolveGeneToAccession,
  parseEfetchPreview,
  EfetchError,
  NoRefSeqGeneError,
  type EfetchPreview,
} from "@/lib/sequences/ncbi-efetch";
import {
  ncbiPackageToImports,
  efetchGenbankToImports,
  type NcbiImportedSequence,
} from "@/lib/sequences/ncbi-import";

type Tab = "gene" | "genome" | "accession";

type Phase = "form" | "previewing" | "preview" | "downloading";

/** Optional prefill applied when the dialog opens, so a cross-link (e.g. the
 *  taxonomy tree explorer's import jump on a species node) lands on the right
 *  tab with the organism / accession filled in. */
export interface NcbiDownloadPrefill {
  /** Which tab to land on. Defaults to the gene tab when an organism is given. */
  tab?: Tab;
  /** Seed the gene tab's organism field. */
  organism?: string;
  /** Seed the gene tab's gene symbol field. */
  geneSymbol?: string;
  /** Seed the genome / accession field. */
  accession?: string;
}

export interface NcbiDownloadDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the parsed, provenance-tagged sequences on a successful
   *  download. The page persists them via its existing persistNew path. */
  onImported: (sequences: NcbiImportedSequence[]) => void | Promise<void>;
  /** Optional one-shot prefill applied when the dialog opens. */
  prefill?: NcbiDownloadPrefill;
}

// --- Inline SVG icons (no emoji) --------------------------------------------

function svgBase(className?: string) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

/** Cloud with a down-arrow: "download from a remote service". */
function DownloadCloudIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" />
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)} className={`animate-spin ${className ?? ""}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg {...svgBase(className)}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// --- Helpers ----------------------------------------------------------------

function formatBp(bp?: number): string | null {
  if (typeof bp !== "number" || !Number.isFinite(bp)) return null;
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(2)} Mb`;
  if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`;
  return `${bp.toLocaleString()} bp`;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "gene", label: "Gene" },
  { id: "genome", label: "Genome" },
  { id: "accession", label: "Accession" },
];

export default function NcbiDownloadDialog({
  open,
  onClose,
  onImported,
  prefill,
}: NcbiDownloadDialogProps) {
  const [tab, setTab] = useState<Tab>("gene");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<NcbiPreview | null>(null);
  // The efetch (annotated GenBank) preview, used by the accession path for any
  // record that is not an assembly. Mutually exclusive with `preview` above.
  const [efetchPreview, setEfetchPreview] = useState<EfetchPreview | null>(null);
  // A calm inline note that is not an error (e.g. "no RefSeqGene, used FASTA").
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  // Form fields.
  const [geneSymbol, setGeneSymbol] = useState("");
  const [organism, setOrganism] = useState("");
  const [genomeAcc, setGenomeAcc] = useState("");
  const [accession, setAccession] = useState("");
  // Gene tab toggle. Off (default) imports the annotated RefSeqGene record via
  // efetch; on keeps the bulk gene / rna / protein / cds FASTA download.
  const [geneSequenceOnly, setGeneSequenceOnly] = useState(false);
  // The RefSeqGene NG_ accession resolved for the previewed gene, or null when
  // the gene has no RefSeqGene record (the annotated path then falls back to
  // FASTA). Resolved once at preview, reused at download.
  const [geneNgAccession, setGeneNgAccession] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // The fetched efetch GenBank text, held between preview and download so the
  // accession path never fetches the same record twice.
  const efetchTextRef = useRef<string | null>(null);

  const busy = phase === "previewing" || phase === "downloading";
  useEscapeToClose(() => {
    if (busy) return; // let the in-flight cancel button own the abort
    handleClose();
  }, open);

  const resetState = useCallback(() => {
    setPhase("form");
    setError(null);
    setPreview(null);
    setEfetchPreview(null);
    setNote(null);
    setProgress("");
    setGeneNgAccession(null);
    efetchTextRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resetState();
    setGeneSymbol("");
    setOrganism("");
    setGenomeAcc("");
    setAccession("");
    setGeneSequenceOnly(false);
    onClose();
  }, [onClose, resetState]);

  const switchTab = useCallback(
    (next: Tab) => {
      setTab(next);
      resetState();
    },
    [resetState],
  );

  // Apply an optional prefill when the dialog opens (e.g. the taxonomy tree
  // explorer's import jump on a species node). Runs only on the open transition
  // so a user can still edit the fields afterward. A species name lands on the
  // gene tab in the organism field, the natural starting point for a gene-by-
  // organism import; an accession lands on the accession tab.
  useEffect(() => {
    if (!open || !prefill) return;
    const next =
      prefill.tab ?? (prefill.accession ? "accession" : "gene");
    setTab(next);
    if (prefill.organism !== undefined) setOrganism(prefill.organism);
    if (prefill.geneSymbol !== undefined) setGeneSymbol(prefill.geneSymbol);
    if (prefill.accession !== undefined) setAccession(prefill.accession);
    // Intentionally keyed on `open` only: re-applying on every prefill identity
    // change would fight the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The Datasets-package paths (genome, gene FASTA) gate on the size / contig
  // caps. The efetch path imports one individual record (a gene region or a
  // transcript or a plasmid), which is never assembly-scale, so it has no cap.
  const capCheck = useMemo(() => {
    if (efetchPreview) return { ok: true as const };
    return preview ? checkCaps(preview) : { ok: false as const };
  }, [preview, efetchPreview]);

  // Run the preview for the active tab. The gene tab and the genome tab preview
  // through the cheap Datasets report. The accession tab routes by accession
  // class: an assembly (GCF_ / GCA_) previews through Datasets, anything else
  // (NG_ / NM_ / NP_ / NC_ / a plasmid) fetches the annotated GenBank via efetch
  // and previews straight off the record (one fetch, reused at download).
  const handlePreview = useCallback(async () => {
    setError(null);
    setNote(null);
    setPreview(null);
    setEfetchPreview(null);
    efetchTextRef.current = null;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("previewing");
    try {
      if (tab === "gene") {
        const result = await previewGeneBySymbol(
          geneSymbol,
          organism,
          controller.signal,
        );
        setPreview(result);
        // Resolve the RefSeqGene NG_ now (one cheap report call) so the preview
        // can say whether an annotated whole-gene record is available, and so
        // the download reuses it. A gene with no RefSeqGene shows a calm note
        // that it will import as FASTA.
        if (!geneSequenceOnly) {
          try {
            const ng = await resolveGeneToAccession(geneSymbol, organism, {
              signal: controller.signal,
            });
            setGeneNgAccession(ng);
          } catch (e) {
            if ((e as Error)?.name === "AbortError") throw e;
            if (e instanceof NoRefSeqGeneError) {
              setGeneNgAccession(null);
              setNote(
                "This gene has no annotated RefSeqGene record. It will import as a sequence-only FASTA.",
              );
            } else {
              throw e;
            }
          }
        }
        setPhase("preview");
      } else if (tab === "genome") {
        const result = await previewGenomeByAccession(
          genomeAcc,
          controller.signal,
        );
        setPreview(result);
        setPhase("preview");
      } else {
        // Accession tab. An assembly stays on Datasets; everything else is an
        // individual record served annotated by efetch.
        const acc = accession.trim();
        if (sniffAccessionKind(acc) === "genome") {
          const result = await previewGenomeByAccession(acc, controller.signal);
          setPreview(result);
        } else {
          const text = await efetchGenbank(acc, { signal: controller.signal });
          efetchTextRef.current = text;
          setEfetchPreview(parseEfetchPreview(text));
        }
        setPhase("preview");
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setPhase("form");
        return;
      }
      setError(
        e instanceof NcbiDatasetsError || e instanceof EfetchError
          ? e.message
          : "Could not look that up on NCBI. Check your entry and try again.",
      );
      setPhase("form");
    } finally {
      abortRef.current = null;
    }
  }, [tab, geneSymbol, organism, genomeAcc, accession]);

  // Best-effort named-lineage resolve. Resolved ONCE per import (every record
  // shares one organism), drops only the lineage on failure, never blocks the
  // import, and re-raises an abort so a cancel stops cleanly.
  const resolveLineage = useCallback(
    async (
      taxQuery: string | undefined,
      signal: AbortSignal,
    ): Promise<NcbiImportedSequence["provenance"]["tax_lineage"]> => {
      const q = (taxQuery || "").trim();
      if (!q) return undefined;
      try {
        const tax = await resolveTaxonomy(q, { signal });
        return tax.lineage;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") throw e;
        return undefined;
      }
    },
    [],
  );

  // Download an annotated efetch record (already fetched at preview, or fetched
  // here for the annotated gene path) and hand the parsed sequences back.
  const importEfetchRecord = useCallback(
    async (
      genbank: string,
      accessionId: string,
      signal: AbortSignal,
    ): Promise<void> => {
      const previewInfo = parseEfetchPreview(genbank);
      const taxLineage = await resolveLineage(previewInfo.organism, signal);
      setProgress("Reading the annotated record...");
      const imports = await efetchGenbankToImports(genbank, {
        source: "ncbi-efetch",
        ncbi_accession: accessionId,
        organism: previewInfo.organism,
        tax_lineage: taxLineage,
      });
      await onImported(imports);
    },
    [onImported, resolveLineage],
  );

  // Download a Datasets ZIP package (genome assembly, or the gene FASTA bulk
  // path) and hand the parsed sequences back.
  const importDatasetsPackage = useCallback(
    async (target: NcbiPreview, signal: AbortSignal): Promise<void> => {
      setProgress("Downloading from NCBI...");
      const zip = await downloadPackage({
        kind: target.kind,
        id: target.accession,
        include: includeForKind(target.kind),
        signal,
      });
      const taxLineage = await resolveLineage(target.taxId, signal);
      setProgress("Unpacking and reading the sequence...");
      const imports = await ncbiPackageToImports(zip, {
        source: "ncbi-datasets",
        ncbi_accession: target.accession,
        organism: target.organism,
        tax_id: target.taxId,
        tax_lineage: taxLineage,
      });
      await onImported(imports);
    },
    [onImported, resolveLineage],
  );

  // Download -> import -> hand back to the page. Routes by which preview is live
  // and, for the gene tab, by the "Sequence only" toggle.
  const handleDownload = useCallback(async () => {
    if (!capCheck.ok) return;
    setError(null);
    setNote(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("downloading");
    try {
      if (efetchPreview && efetchTextRef.current) {
        // Accession tab, an individual annotated record fetched at preview.
        await importEfetchRecord(
          efetchTextRef.current,
          efetchPreview.name,
          controller.signal,
        );
      } else if (preview && tab === "gene" && !geneSequenceOnly && geneNgAccession) {
        // Gene tab, annotated default: the RefSeqGene NG_ was resolved at
        // preview, so efetch it directly for the whole annotated gene record.
        setProgress("Downloading the annotated gene from NCBI...");
        const text = await efetchGenbank(geneNgAccession, {
          signal: controller.signal,
        });
        await importEfetchRecord(text, geneNgAccession, controller.signal);
      } else if (preview) {
        // Genome accession, the gene tab with "Sequence only" on, or a gene with
        // no RefSeqGene record (the annotated path falls back to bulk FASTA).
        // Genome accession, or the gene tab with "Sequence only" on.
        await importDatasetsPackage(preview, controller.signal);
      } else {
        return;
      }
      handleClose();
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setProgress("");
        setPhase("preview");
        return;
      }
      setError(
        e instanceof NcbiDatasetsError || e instanceof EfetchError
          ? e.message
          : (e as Error)?.message ||
              "The download could not be completed. Try again.",
      );
      setProgress("");
      setPhase("preview");
    } finally {
      abortRef.current = null;
    }
  }, [
    capCheck.ok,
    preview,
    efetchPreview,
    tab,
    geneSequenceOnly,
    geneNgAccession,
    importEfetchRecord,
    importDatasetsPackage,
    handleClose,
  ]);

  const cancelInFlight = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Whether the active form has the minimum input to preview.
  const canPreview = useMemo(() => {
    if (tab === "gene") return geneSymbol.trim() !== "" && organism.trim() !== "";
    if (tab === "genome") return genomeAcc.trim() !== "";
    return accession.trim() !== "";
  }, [tab, geneSymbol, organism, genomeAcc, accession]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="ncbi-download-dialog"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={busy ? undefined : handleClose}
      />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <DownloadCloudIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">
              Download from NCBI
            </h2>
            <p className="text-meta text-foreground-muted">
              Pull a gene or genome from NCBI straight into your collection.
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              aria-label="Close"
              className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted disabled:opacity-40"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Tab picker */}
          <div
            role="tablist"
            aria-label="What to download"
            className="inline-flex rounded-lg border border-border bg-surface-sunken p-0.5"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                disabled={busy}
                onClick={() => switchTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-meta font-medium transition-colors disabled:opacity-50 ${
                  tab === t.id
                    ? "bg-surface-raised text-foreground shadow-sm"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Form fields per tab */}
          <div className="mt-4 space-y-3">
            {tab === "gene" ? (
              <>
                <Field
                  label="Gene symbol"
                  placeholder="e.g. BRCA1"
                  value={geneSymbol}
                  onChange={setGeneSymbol}
                  disabled={busy}
                />
                <Field
                  label="Organism"
                  placeholder="e.g. Homo sapiens (or a tax id like 9606)"
                  value={organism}
                  onChange={setOrganism}
                  disabled={busy}
                />
                <label className="flex items-start gap-2 pt-0.5">
                  <input
                    type="checkbox"
                    checked={geneSequenceOnly}
                    disabled={busy}
                    onChange={(e) => {
                      setGeneSequenceOnly(e.target.checked);
                      resetState();
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-200 disabled:opacity-50"
                  />
                  <span className="text-meta leading-relaxed text-foreground-muted">
                    Sequence only. Skip the annotated whole-gene record and
                    download the gene, RNA, protein, and CDS FASTA instead.
                  </span>
                </label>
              </>
            ) : tab === "genome" ? (
              <Field
                label="Genome accession"
                placeholder="e.g. GCF_000005845.2"
                value={genomeAcc}
                onChange={setGenomeAcc}
                disabled={busy}
              />
            ) : (
              <Field
                label="Accession"
                placeholder="Any accession (NG_, NM_, NP_, NC_, a plasmid, or GCF_ / GCA_)"
                value={accession}
                onChange={setAccession}
                disabled={busy}
              />
            )}
          </div>

          {/* Privacy note: only the public identifier is sent. */}
          <p className="mt-3 text-meta leading-relaxed text-foreground-muted">
            Only the identifier you type is sent to NCBI, a public government
            database. Nothing of your own data leaves this app.
          </p>

          {/* Error */}
          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/15 px-3 py-2.5">
              <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-meta leading-relaxed text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          ) : null}

          {/* Calm note (not an error), e.g. a gene with no RefSeqGene record. */}
          {note ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/15 px-3 py-2.5">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
              <p className="text-meta leading-relaxed text-sky-800 dark:text-sky-300">{note}</p>
            </div>
          ) : null}

          {/* efetch preview card (an individual annotated record). */}
          {efetchPreview && (phase === "preview" || phase === "downloading") ? (
            <div className="mt-4 rounded-xl border border-border bg-surface-sunken/60 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="truncate text-body font-semibold text-foreground">
                  {efetchPreview.name}
                </h3>
                <span className="shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Annotated
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-meta">
                {efetchPreview.organism ? (
                  <PreviewRow label="Organism" value={efetchPreview.organism} />
                ) : null}
                <PreviewRow label="Accession" value={efetchPreview.name} />
                {formatBp(efetchPreview.lengthBp) ? (
                  <PreviewRow
                    label="Length"
                    value={formatBp(efetchPreview.lengthBp)!}
                  />
                ) : null}
                <PreviewRow
                  label="Features"
                  value={efetchPreview.featureCount.toLocaleString()}
                />
              </dl>
            </div>
          ) : null}

          {/* Preview card */}
          {preview && (phase === "preview" || phase === "downloading") ? (
            <div className="mt-4 rounded-xl border border-border bg-surface-sunken/60 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="truncate text-body font-semibold text-foreground">
                  {preview.title}
                </h3>
                <span className="shrink-0 rounded-full bg-sky-100 dark:bg-sky-500/15 px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
                  {preview.kind}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-meta">
                <PreviewRow label="Organism" value={preview.organism} />
                <PreviewRow label="Accession" value={preview.accession} />
                {formatBp(preview.lengthBp) ? (
                  <PreviewRow label="Length" value={formatBp(preview.lengthBp)!} />
                ) : null}
                {typeof preview.contigs === "number" ? (
                  <PreviewRow
                    label="Contigs"
                    value={preview.contigs.toLocaleString()}
                  />
                ) : null}
                {preview.assemblyLevel ? (
                  <PreviewRow label="Assembly" value={preview.assemblyLevel} />
                ) : null}
                {tab === "gene" && !geneSequenceOnly && geneNgAccession ? (
                  <PreviewRow
                    label="Annotated record"
                    value={geneNgAccession}
                  />
                ) : null}
              </dl>

              {/* Caps gate: an over-cap preview disables Download with the reason. */}
              {!capCheck.ok && capCheck.reason ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-2.5">
                  <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <p className="text-meta leading-relaxed text-amber-800 dark:text-amber-300">
                    {capCheck.reason}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Download progress */}
          {phase === "downloading" ? (
            <div className="mt-3 flex items-center gap-2 text-meta text-foreground-muted">
              <SpinnerIcon className="h-4 w-4 text-sky-500" />
              <span>{progress || "Working..."}</span>
            </div>
          ) : null}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          {phase === "downloading" || phase === "previewing" ? (
            <button
              type="button"
              onClick={cancelInFlight}
              className="rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
            >
              Close
            </button>
          )}

          {phase === "preview" && (preview || efetchPreview) ? (
            <button
              type="button"
              onClick={handleDownload}
              disabled={!capCheck.ok}
              className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <DownloadCloudIcon className="h-4 w-4" />
              Download into collection
            </button>
          ) : phase === "form" || phase === "previewing" ? (
            <button
              type="button"
              onClick={handlePreview}
              disabled={!canPreview || phase === "previewing"}
              className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "previewing" ? (
                <>
                  <SpinnerIcon className="h-4 w-4" />
                  Looking up...
                </>
              ) : (
                "Preview"
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// --- Small presentational pieces --------------------------------------------

function Field({
  label,
  placeholder,
  value,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-surface-sunken disabled:text-foreground-muted"
      />
    </label>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </>
  );
}
