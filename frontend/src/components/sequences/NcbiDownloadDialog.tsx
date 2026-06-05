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

import { useCallback, useMemo, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  previewGeneBySymbol,
  previewGenomeByAccession,
  previewByAccession,
  downloadPackage,
  includeForKind,
  checkCaps,
  resolveTaxonomy,
  NcbiDatasetsError,
  type NcbiPreview,
} from "@/lib/sequences/ncbi-datasets";
import {
  ncbiPackageToImports,
  type NcbiImportedSequence,
} from "@/lib/sequences/ncbi-import";

type Tab = "gene" | "genome" | "accession";

type Phase = "form" | "previewing" | "preview" | "downloading";

export interface NcbiDownloadDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the parsed, provenance-tagged sequences on a successful
   *  download. The page persists them via its existing persistNew path. */
  onImported: (sequences: NcbiImportedSequence[]) => void | Promise<void>;
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
}: NcbiDownloadDialogProps) {
  const [tab, setTab] = useState<Tab>("gene");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<NcbiPreview | null>(null);
  const [progress, setProgress] = useState<string>("");

  // Form fields.
  const [geneSymbol, setGeneSymbol] = useState("");
  const [organism, setOrganism] = useState("");
  const [genomeAcc, setGenomeAcc] = useState("");
  const [accession, setAccession] = useState("");

  const abortRef = useRef<AbortController | null>(null);

  const busy = phase === "previewing" || phase === "downloading";
  useEscapeToClose(() => {
    if (busy) return; // let the in-flight cancel button own the abort
    handleClose();
  }, open);

  const resetState = useCallback(() => {
    setPhase("form");
    setError(null);
    setPreview(null);
    setProgress("");
  }, []);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resetState();
    setGeneSymbol("");
    setOrganism("");
    setGenomeAcc("");
    setAccession("");
    onClose();
  }, [onClose, resetState]);

  const switchTab = useCallback(
    (next: Tab) => {
      setTab(next);
      resetState();
    },
    [resetState],
  );

  const capCheck = useMemo(
    () => (preview ? checkCaps(preview) : { ok: false as const }),
    [preview],
  );

  // Run the preview for the active tab.
  const handlePreview = useCallback(async () => {
    setError(null);
    setPreview(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("previewing");
    try {
      let result: NcbiPreview;
      if (tab === "gene") {
        result = await previewGeneBySymbol(geneSymbol, organism, controller.signal);
      } else if (tab === "genome") {
        result = await previewGenomeByAccession(genomeAcc, controller.signal);
      } else {
        result = await previewByAccession(accession, controller.signal);
      }
      setPreview(result);
      setPhase("preview");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setPhase("form");
        return;
      }
      setError(
        e instanceof NcbiDatasetsError
          ? e.message
          : "Could not look that up on NCBI. Check your entry and try again.",
      );
      setPhase("form");
    } finally {
      abortRef.current = null;
    }
  }, [tab, geneSymbol, organism, genomeAcc, accession]);

  // Download -> unzip -> parse -> hand back to the page.
  const handleDownload = useCallback(async () => {
    if (!preview || !capCheck.ok) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("downloading");
    try {
      setProgress("Downloading from NCBI...");
      const zip = await downloadPackage({
        kind: preview.kind,
        id: preview.accession,
        include: includeForKind(preview.kind),
        signal: controller.signal,
      });
      // Auto-fill the named taxonomy lineage when the preview carried a tax id.
      // Best-effort and resolved ONCE for the whole download (every record in a
      // genome package shares the organism), so a multi-record import never fans
      // out to N taxonomy calls. A failed resolve keeps organism / tax id and
      // drops only the lineage; it never blocks the import.
      let taxLineage: NcbiImportedSequence["provenance"]["tax_lineage"];
      if (preview.taxId) {
        try {
          const tax = await resolveTaxonomy(preview.taxId, {
            signal: controller.signal,
          });
          taxLineage = tax.lineage;
        } catch (e) {
          if ((e as Error)?.name === "AbortError") throw e;
        }
      }
      setProgress("Unpacking and reading the sequence...");
      const imports = await ncbiPackageToImports(zip, {
        source: "ncbi-datasets",
        ncbi_accession: preview.accession,
        organism: preview.organism,
        tax_id: preview.taxId,
        tax_lineage: taxLineage,
      });
      await onImported(imports);
      handleClose();
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setProgress("");
        setPhase("preview");
        return;
      }
      setError(
        e instanceof NcbiDatasetsError
          ? e.message
          : (e as Error)?.message ||
              "The download could not be completed. Try again.",
      );
      setProgress("");
      setPhase("preview");
    } finally {
      abortRef.current = null;
    }
  }, [preview, capCheck.ok, onImported, handleClose]);

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
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={busy ? undefined : handleClose}
      />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100">
            <DownloadCloudIcon className="h-5 w-5 text-sky-600" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-gray-900">
              Download from NCBI
            </h2>
            <p className="text-meta text-gray-500">
              Pull a gene or genome from NCBI straight into your collection.
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              aria-label="Close"
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
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
            className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5"
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
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
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
                placeholder="A genome (GCF_ / GCA_) or gene (NM_, NG_, ...) accession"
                value={accession}
                onChange={setAccession}
                disabled={busy}
              />
            )}
          </div>

          {/* Privacy note: only the public identifier is sent. */}
          <p className="mt-3 text-meta leading-relaxed text-gray-400">
            Only the identifier you type is sent to NCBI, a public government
            database. Nothing of your own data leaves this app.
          </p>

          {/* Error */}
          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
              <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-meta leading-relaxed text-rose-700">{error}</p>
            </div>
          ) : null}

          {/* Preview card */}
          {preview && (phase === "preview" || phase === "downloading") ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="truncate text-body font-semibold text-gray-900">
                  {preview.title}
                </h3>
                <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-sky-700">
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
              </dl>

              {/* Caps gate: an over-cap preview disables Download with the reason. */}
              {!capCheck.ok && capCheck.reason ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <WarnIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <p className="text-meta leading-relaxed text-amber-800">
                    {capCheck.reason}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Download progress */}
          {phase === "downloading" ? (
            <div className="mt-3 flex items-center gap-2 text-meta text-gray-500">
              <SpinnerIcon className="h-4 w-4 text-sky-500" />
              <span>{progress || "Working..."}</span>
            </div>
          ) : null}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3.5">
          {phase === "downloading" || phase === "previewing" ? (
            <button
              type="button"
              onClick={cancelInFlight}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-meta font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-meta font-medium text-gray-700 transition-colors hover:bg-gray-100"
            >
              Close
            </button>
          )}

          {phase === "preview" && preview ? (
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
      <span className="mb-1 block text-meta font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-body text-gray-900 placeholder:text-gray-300 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-gray-50 disabled:text-gray-400"
      />
    </label>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-medium uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-gray-700">{value}</dd>
    </>
  );
}
