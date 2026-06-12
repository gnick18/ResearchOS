"use client";

// sequences / ncbi-wizard. The guided "Download from NCBI" flow.
//
// Replaces the typed three-tab form with a path that mirrors how a scientist
// thinks: type an ORGANISM, pick its REFERENCE genome, browse CONTIGS, search a
// GENE by name, grab a WINDOW around it, import only that slice. An accession
// escape hatch on step 1 lets people who already know what they want skip the
// wizard, and every step keeps a full-download option (whole genome on an
// assembly, whole chromosome on a contig) so no step forces you to narrow.
//
// All network calls are the backend lib functions (already on main + tested).
// This file owns only the flow, the loading / error states, and the import
// hand-off (it reuses the page's persistNew path via onImported, exactly like
// the old dialog). No new sequence logic lives here.
//
// House rules: icons via <Icon> (no inline svg), <Tooltip> for icon-only
// controls. No em-dash, no emoji, no mid-sentence colon.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  suggestTaxa,
  listTaxonAssemblies,
  listAssemblySequences,
  previewGenomeByAccession,
  previewByAccession,
  downloadPackage,
  includeForKind,
  sniffAccessionKind,
  resolveTaxonomy,
  checkCaps,
  NCBI_CAPS,
  NcbiDatasetsError,
  type TaxonSuggestion,
  type TaxonAssembly,
  type AssemblySequence,
  type GenePlacement,
  type NcbiPreview,
} from "@/lib/sequences/ncbi-datasets";
import {
  esearchGenes,
  NcbiSearchError,
  type GeneSearchHit,
} from "@/lib/sequences/ncbi-esearch";
import {
  efetchGenbank,
  EfetchError,
  type EfetchPreview,
  parseEfetchPreview,
} from "@/lib/sequences/ncbi-efetch";
import {
  ncbiPackageToImports,
  efetchGenbankToImports,
  type NcbiImportedSequence,
} from "@/lib/sequences/ncbi-import";
import {
  WIZARD_STEPS,
  WIZARD_STEP_LABELS,
  type WizardStep,
  stepIndex,
  formatBp,
  resolveWindow,
  hitHasPlacement,
  placementFromHit,
  ncbiGeneSearchUrl,
} from "@/lib/sequences/guided-ncbi-import";

const DEFAULT_FLANK = 1000;

/** Under the hard {@link NCBI_CAPS} ceiling but big enough that a whole download
 *  will be slow and can make the editor sluggish, so we confirm first. */
const SOFT_WARN_BP = 10_000_000;

/** Compact Mb label for a size confirm (e.g. "29 Mb"). */
function mbLabel(bp: number): string {
  const mb = bp / 1_000_000;
  return mb >= 10 ? `${Math.round(mb)} Mb` : `${mb.toFixed(1)} Mb`;
}

export interface GuidedNcbiImportProps {
  /** Called with the parsed, provenance-tagged sequences on a successful
   *  import. The page persists them via its existing persistNew path. */
  onImported: (sequences: NcbiImportedSequence[]) => void | Promise<void>;
  /** Close the dialog (the wizard never closes itself except on the done
   *  screen's run-again reset; the shell owns the actual close). */
  onClose: () => void;
  /** Optional organism seed (e.g. a cross-link from the taxonomy explorer). */
  initialOrganism?: string;
  /** Optional accession seed; opens straight on the accession escape hatch. */
  initialAccession?: string;
}

/** A self-resolving error message for a caught network error. The libs throw
 *  typed errors with friendly messages; anything else gets a calm fallback. */
function messageFor(e: unknown, fallback: string): string {
  if (
    e instanceof NcbiDatasetsError ||
    e instanceof NcbiSearchError ||
    e instanceof EfetchError
  ) {
    return e.message;
  }
  return fallback;
}

function isAbort(e: unknown): boolean {
  return (e as Error)?.name === "AbortError";
}

export default function GuidedNcbiImport({
  onImported,
  onClose,
  initialOrganism,
  initialAccession,
}: GuidedNcbiImportProps) {
  const [step, setStep] = useState<WizardStep>("organism");

  // Resolved selections threaded forward through the steps.
  const [organism, setOrganism] = useState(initialOrganism ?? "");
  const [taxon, setTaxon] = useState<TaxonSuggestion | null>(null);
  const [assembly, setAssembly] = useState<TaxonAssembly | null>(null);
  const [contig, setContig] = useState<AssemblySequence | null>(null);
  const [placement, setPlacement] = useState<GenePlacement | null>(null);
  const [flank, setFlank] = useState(DEFAULT_FLANK);

  // A calm summary of what was just imported, shown on the done screen.
  const [doneSummary, setDoneSummary] = useState<string>("");

  // One in-flight controller at a time; a step change or close aborts it.
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A pending large-download confirm (whole genome / whole chromosome over the
  // soft size threshold). Cleared on navigation, cancel, or proceed.
  const [confirm, setConfirm] = useState<
    null | { sizeLabel: string; proceed: () => void }
  >(null);

  const newController = useCallback(() => {
    abortRef.current?.abort();
    const c = new AbortController();
    abortRef.current = c;
    return c;
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Best-effort named-lineage resolve (one per import, drops on failure, never
  // blocks the import, re-raises an abort).
  const resolveLineage = useCallback(
    async (
      q: string | undefined,
      signal: AbortSignal,
    ): Promise<NcbiImportedSequence["provenance"]["tax_lineage"]> => {
      const query = (q || "").trim();
      if (!query) return undefined;
      try {
        const tax = await resolveTaxonomy(query, { signal });
        return tax.lineage;
      } catch (e) {
        if (isAbort(e)) throw e;
        return undefined;
      }
    },
    [],
  );

  // --- Import hand-offs ------------------------------------------------------

  /** Fetch the ZIP for an already-previewed assembly and hand the imports back.
   *  Split from the size guard so a confirmed large download reuses the preview. */
  const downloadWholeGenome = useCallback(
    async (target: TaxonAssembly, preview: NcbiPreview) => {
      setConfirm(null);
      setError(null);
      setBusy(true);
      setBusyLabel("Downloading and unpacking the assembly...");
      const c = newController();
      try {
        const zip = await downloadPackage({
          kind: "genome",
          id: target.accession,
          include: includeForKind("genome"),
          signal: c.signal,
        });
        const lineage = await resolveLineage(preview.taxId, c.signal);
        const imports = await ncbiPackageToImports(zip, {
          source: "ncbi-datasets",
          ncbi_accession: target.accession,
          organism: preview.organism,
          tax_id: preview.taxId,
          tax_lineage: lineage,
        });
        await onImported(imports);
        setDoneSummary(
          `${target.accession}, the whole ${preview.organism} genome (${imports.length} sequence${imports.length === 1 ? "" : "s"}).`,
        );
        setStep("done");
      } catch (e) {
        if (isAbort(e)) return;
        setError(messageFor(e, "The whole-genome download could not be completed. Try again."));
      } finally {
        setBusy(false);
        setBusyLabel("");
      }
    },
    [newController, onImported, resolveLineage],
  );

  /** Preview a whole assembly, refuse it if it is over the hard cap, confirm it
   *  if it is large but allowed, otherwise download straight away. */
  const importWholeGenome = useCallback(
    async (target: TaxonAssembly) => {
      setError(null);
      setConfirm(null);
      setBusy(true);
      setBusyLabel("Checking the genome size...");
      const c = newController();
      try {
        const preview: NcbiPreview = await previewGenomeByAccession(
          target.accession,
          c.signal,
        );
        const cap = checkCaps(preview);
        if (!cap.ok) {
          setError(cap.reason ?? "This genome is too large to import in the browser.");
          return;
        }
        setBusy(false);
        setBusyLabel("");
        if (typeof preview.lengthBp === "number" && preview.lengthBp > SOFT_WARN_BP) {
          setConfirm({
            sizeLabel: mbLabel(preview.lengthBp),
            proceed: () => void downloadWholeGenome(target, preview),
          });
          return;
        }
        await downloadWholeGenome(target, preview);
      } catch (e) {
        if (isAbort(e)) return;
        setError(messageFor(e, "The whole-genome download could not be completed. Try again."));
      } finally {
        setBusy(false);
        setBusyLabel("");
      }
    },
    [newController, downloadWholeGenome],
  );

  /** efetch a whole contig / chromosome record and hand the import back. */
  const downloadWholeContig = useCallback(
    async (seq: AssemblySequence) => {
      setConfirm(null);
      setError(null);
      setBusy(true);
      setBusyLabel("Downloading the whole chromosome from NCBI...");
      const c = newController();
      try {
        const text = await efetchGenbank(seq.refseqAccession, { signal: c.signal });
        const info = parseEfetchPreview(text);
        const lineage = await resolveLineage(info.organism ?? organism, c.signal);
        const imports = await efetchGenbankToImports(text, {
          source: "ncbi-efetch",
          ncbi_accession: seq.refseqAccession,
          organism: info.organism,
          tax_lineage: lineage,
        });
        await onImported(imports);
        setDoneSummary(
          `${seq.refseqAccession}, the whole chromosome (${formatBp(seq.lengthBp)}).`,
        );
        setStep("done");
      } catch (e) {
        if (isAbort(e)) return;
        setError(messageFor(e, "The chromosome download could not be completed. Try again."));
      } finally {
        setBusy(false);
        setBusyLabel("");
      }
    },
    [newController, onImported, organism, resolveLineage],
  );

  /** Guard a whole-chromosome download by its known length: refuse over the hard
   *  cap, confirm if large but allowed, otherwise download straight away. */
  const importWholeContig = useCallback(
    (seq: AssemblySequence) => {
      setError(null);
      setConfirm(null);
      if (seq.lengthBp > NCBI_CAPS.maxGenomeBp) {
        setError(
          `This chromosome is ${mbLabel(seq.lengthBp)}, over the ` +
            `${mbLabel(NCBI_CAPS.maxGenomeBp)} limit for an in-browser import. ` +
            `For a record this size, use the NCBI Datasets command-line tool.`,
        );
        return;
      }
      if (seq.lengthBp > SOFT_WARN_BP) {
        setConfirm({
          sizeLabel: mbLabel(seq.lengthBp),
          proceed: () => void downloadWholeContig(seq),
        });
        return;
      }
      void downloadWholeContig(seq);
    },
    [downloadWholeContig],
  );

  /** efetch the gene-plus-flank window and hand the import back. */
  const importWindow = useCallback(async () => {
    if (!placement) return;
    setError(null);
    setBusy(true);
    setBusyLabel("Fetching the region from NCBI...");
    const c = newController();
    try {
      const win = resolveWindow(placement, flank, contig?.lengthBp);
      const text = await efetchGenbank(placement.contigAccession, {
        signal: c.signal,
        window: { start: win.start, stop: win.stop },
      });
      const info = parseEfetchPreview(text);
      const lineage = await resolveLineage(info.organism ?? organism, c.signal);
      const imports = await efetchGenbankToImports(text, {
        source: "ncbi-efetch",
        ncbi_accession: placement.contigAccession,
        organism: info.organism,
        tax_lineage: lineage,
      });
      await onImported(imports);
      setDoneSummary(
        `${placement.symbol} region (${placement.contigAccession} ${win.start.toLocaleString("en-US")}..${win.stop.toLocaleString("en-US")}), ${formatBp(win.span)}, annotated.`,
      );
      setStep("done");
    } catch (e) {
      if (isAbort(e)) return;
      setError(messageFor(e, "The region could not be fetched. Try again."));
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }, [placement, flank, contig, newController, onImported, organism, resolveLineage]);

  /** The accession escape hatch. Routes by accession class, genome -> package,
   *  gene / contig -> the annotated efetch path. */
  const importAccession = useCallback(
    async (raw: string) => {
      const acc = raw.trim();
      if (!acc) return;
      setError(null);
      setBusy(true);
      setBusyLabel("Looking that up on NCBI...");
      const c = newController();
      try {
        if (sniffAccessionKind(acc) === "genome") {
          const preview = await previewByAccession(acc, c.signal);
          const cap = checkCaps(preview);
          if (!cap.ok) {
            setError(cap.reason ?? "This genome is too large to import in the browser.");
            return;
          }
          setBusyLabel("Downloading and unpacking the assembly...");
          const zip = await downloadPackage({
            kind: preview.kind,
            id: preview.accession,
            include: includeForKind(preview.kind),
            signal: c.signal,
          });
          const lineage = await resolveLineage(preview.taxId, c.signal);
          const imports = await ncbiPackageToImports(zip, {
            source: "ncbi-datasets",
            ncbi_accession: preview.accession,
            organism: preview.organism,
            tax_id: preview.taxId,
            tax_lineage: lineage,
          });
          await onImported(imports);
          setDoneSummary(`${preview.accession}, ${preview.organism}.`);
        } else {
          setBusyLabel("Downloading the annotated record...");
          const text = await efetchGenbank(acc, { signal: c.signal });
          const info = parseEfetchPreview(text);
          const lineage = await resolveLineage(info.organism, c.signal);
          const imports = await efetchGenbankToImports(text, {
            source: "ncbi-efetch",
            ncbi_accession: acc,
            organism: info.organism,
            tax_lineage: lineage,
          });
          await onImported(imports);
          setDoneSummary(`${info.name}${info.organism ? `, ${info.organism}` : ""}.`);
        }
        setStep("done");
      } catch (e) {
        if (isAbort(e)) return;
        setError(messageFor(e, "Could not import that accession. Check it and try again."));
      } finally {
        setBusy(false);
        setBusyLabel("");
      }
    },
    [newController, onImported, resolveLineage],
  );

  // --- Navigation ------------------------------------------------------------

  const goto = useCallback(
    (next: WizardStep) => {
      abortRef.current?.abort();
      setError(null);
      setConfirm(null);
      setBusy(false);
      setBusyLabel("");
      setStep(next);
    },
    [],
  );

  const restart = useCallback(() => {
    abortRef.current?.abort();
    setStep("organism");
    setTaxon(null);
    setAssembly(null);
    setContig(null);
    setPlacement(null);
    setFlank(DEFAULT_FLANK);
    setError(null);
    setConfirm(null);
    setDoneSummary("");
    setBusy(false);
    setBusyLabel("");
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Step rail */}
      {step !== "done" ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-sunken/50 px-5 py-2.5 text-meta">
          {WIZARD_STEPS.map((s, i) => {
            const current = stepIndex(step);
            const n = i + 1;
            const state = n < current ? "done" : n === current ? "active" : "todo";
            return (
              <span key={s} className="flex items-center gap-1">
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 ${
                    state === "active" ? "font-semibold text-foreground" : "text-foreground-muted"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                      state === "done"
                        ? "bg-emerald-500 text-white"
                        : state === "active"
                          ? "bg-sky-600 text-white"
                          : "bg-surface-sunken text-foreground-muted"
                    }`}
                  >
                    {state === "done" ? <Icon name="check" className="h-2.5 w-2.5" /> : n}
                  </span>
                  {WIZARD_STEP_LABELS[i]}
                </span>
                {i < WIZARD_STEPS.length - 1 ? (
                  <Icon name="chevronRight" className="h-3 w-3 text-border" />
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="ncbi-wizard-body">
        {error ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/15">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-meta leading-relaxed text-rose-700 dark:text-rose-300">{error}</p>
          </div>
        ) : null}

        {step === "organism" ? (
          <OrganismStep
            organism={organism}
            setOrganism={setOrganism}
            initialAccession={initialAccession}
            onPickTaxon={(t) => {
              setTaxon(t);
              setOrganism(t.name);
              goto("assemblies");
            }}
            onImportAccession={importAccession}
            busy={busy}
          />
        ) : null}

        {step === "assemblies" && taxon ? (
          <AssembliesStep
            taxon={taxon}
            busy={busy}
            onPick={(a) => {
              setAssembly(a);
              goto("contigs");
            }}
            onWholeGenome={importWholeGenome}
            onBack={() => goto("organism")}
          />
        ) : null}

        {step === "contigs" && assembly ? (
          <ContigsStep
            assembly={assembly}
            busy={busy}
            onPick={(seq) => {
              setContig(seq);
              goto("gene");
            }}
            onWholeContig={importWholeContig}
            onSearchGene={() => {
              setContig(null);
              goto("gene");
            }}
            onBack={() => goto("assemblies")}
          />
        ) : null}

        {step === "gene" ? (
          <GeneStep
            organism={organism}
            busy={busy}
            onPick={(hit) => {
              if (hitHasPlacement(hit)) {
                setPlacement(placementFromHit(hit));
                goto("window");
              }
            }}
            onBack={() => goto(assembly ? "contigs" : "organism")}
          />
        ) : null}

        {step === "window" && placement ? (
          <WindowStep
            placement={placement}
            contigLen={contig?.lengthBp}
            flank={flank}
            setFlank={setFlank}
            busy={busy}
            onImport={importWindow}
            onBack={() => goto("gene")}
          />
        ) : null}

        {step === "done" ? (
          <DoneScreen summary={doneSummary} onAgain={restart} onClose={onClose} />
        ) : null}

        {/* Large-download confirm: big but under the hard cap. Cancel keeps the
            user in place (no soft-lock), Download anyway proceeds. */}
        {confirm && !busy ? (
          <div
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10"
            data-testid="ncbi-size-confirm"
          >
            <div className="flex items-start gap-2">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-meta leading-relaxed text-amber-800 dark:text-amber-200">
                This download is about {confirm.sizeLabel}. A record this large can
                take a moment to fetch and may make the editor sluggish. Import it
                anyway?
              </p>
            </div>
            <div className="mt-2.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                data-testid="ncbi-size-confirm-cancel"
                className="rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm.proceed}
                data-testid="ncbi-size-confirm-proceed"
                className="rounded-md bg-amber-600 px-3 py-1 text-meta font-medium text-white transition-colors hover:bg-amber-700"
              >
                Download anyway
              </button>
            </div>
          </div>
        ) : null}

        {/* Inline busy line (download / fetch in progress). */}
        {busy && busyLabel ? (
          <div className="mt-4 flex items-center gap-2 text-meta text-foreground-muted">
            <Icon name="refresh" className="h-4 w-4 animate-spin text-sky-500" />
            <span>{busyLabel}</span>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="ml-auto rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Step 1: Organism --------------------------------------------------------

function OrganismStep({
  organism,
  setOrganism,
  initialAccession,
  onPickTaxon,
  onImportAccession,
  busy,
}: {
  organism: string;
  setOrganism: (v: string) => void;
  initialAccession?: string;
  onPickTaxon: (t: TaxonSuggestion) => void;
  onImportAccession: (acc: string) => void;
  busy: boolean;
}) {
  const [suggestions, setSuggestions] = useState<TaxonSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [showAccession, setShowAccession] = useState(Boolean(initialAccession));
  const [accession, setAccession] = useState(initialAccession ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctlRef = useRef<AbortController | null>(null);

  // Debounced organism autocomplete from NCBI Taxonomy.
  useEffect(() => {
    const q = organism.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    ctlRef.current?.abort();
    if (q.length < 2) {
      setSuggestions([]);
      setLoading(false);
      setSuggestError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const c = new AbortController();
      ctlRef.current = c;
      setLoading(true);
      setSuggestError(null);
      suggestTaxa(q, { signal: c.signal })
        .then((rows) => {
          setSuggestions(rows);
          setLoading(false);
        })
        .catch((e) => {
          if (isAbort(e)) return;
          setLoading(false);
          setSuggestError(messageFor(e, "Could not reach NCBI Taxonomy. Try again."));
        });
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [organism]);

  return (
    <div>
      <h3 className="text-body font-semibold text-foreground">Which organism?</h3>
      <p className="mt-0.5 text-meta text-foreground-muted">
        Type a name, we autocomplete from NCBI Taxonomy. Pick the species to see its genomes.
      </p>
      <input
        type="text"
        value={organism}
        autoComplete="off"
        placeholder="e.g. Aspergillus fumigatus"
        disabled={busy}
        onChange={(e) => setOrganism(e.target.value)}
        data-testid="ncbi-organism-input"
        className="mt-3 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-50"
      />

      {loading ? (
        <p className="mt-2 flex items-center gap-2 text-meta text-foreground-muted">
          <Icon name="refresh" className="h-3.5 w-3.5 animate-spin text-sky-500" />
          Searching NCBI Taxonomy...
        </p>
      ) : null}
      {suggestError ? (
        <p className="mt-2 text-meta text-rose-600 dark:text-rose-300">{suggestError}</p>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        {suggestions.map((t) => (
          <button
            key={t.taxId}
            type="button"
            disabled={busy}
            onClick={() => onPickTaxon(t)}
            data-testid="ncbi-taxon-row"
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-left transition-colors hover:border-sky-400 disabled:opacity-50"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">{t.name}</div>
              <div className="text-meta text-foreground-muted">
                {t.rank || "taxon"}, taxid {t.taxId}
              </div>
            </div>
            <Icon name="chevronRight" className="h-4 w-4 text-foreground-muted" />
          </button>
        ))}
      </div>

      {/* Accession escape hatch. */}
      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowAccession((v) => !v)}
          className="text-meta font-medium text-sky-700 hover:underline dark:text-sky-300"
        >
          I have an accession
        </button>
        {showAccession ? (
          <div className="mt-2 rounded-lg border border-border bg-surface-raised p-3">
            <p className="text-meta text-foreground-muted">
              Know exactly what you want? Paste any accession (a gene NM_ / NG_, a genome GCF_ / GCA_, or a contig NC_) and skip the guided path.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={accession}
                disabled={busy}
                placeholder="e.g. NC_007197.1 or GCF_000002655.1"
                onChange={(e) => setAccession(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && accession.trim()) onImportAccession(accession);
                }}
                data-testid="ncbi-accession-input"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-meta text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-50"
              />
              <button
                type="button"
                disabled={busy || !accession.trim()}
                onClick={() => onImportAccession(accession)}
                data-testid="ncbi-accession-go"
                className="rounded-md bg-sky-600 px-3.5 py-2 text-meta font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Go
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- Step 2: Assemblies ------------------------------------------------------

function AssembliesStep({
  taxon,
  busy,
  onPick,
  onWholeGenome,
  onBack,
}: {
  taxon: TaxonSuggestion;
  busy: boolean;
  onPick: (a: TaxonAssembly) => void;
  onWholeGenome: (a: TaxonAssembly) => void;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<TaxonAssembly[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setLoadError(null);
    listTaxonAssemblies(taxon.taxId, { signal: c.signal })
      .then((res) => {
        setRows(res.assemblies);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((e) => {
        if (isAbort(e)) return;
        setLoading(false);
        setLoadError(messageFor(e, "Could not list genomes for this organism."));
      });
    return () => c.abort();
  }, [taxon.taxId]);

  return (
    <div>
      <h3 className="text-body font-semibold text-foreground">
        Genomes for <span className="italic">{taxon.name}</span>
      </h3>
      <p className="mt-0.5 text-meta text-foreground-muted">
        The reference genome is flagged, so you do not have to know the accession. Click a genome to browse its chromosomes, or grab the whole assembly at once.
      </p>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-meta text-foreground-muted">
          <Icon name="refresh" className="h-3.5 w-3.5 animate-spin text-sky-500" />
          Listing genomes...
        </p>
      ) : null}
      {loadError ? (
        <p className="mt-3 text-meta text-rose-600 dark:text-rose-300">{loadError}</p>
      ) : null}
      {!loading && !loadError && rows.length === 0 ? (
        <p className="mt-3 text-meta text-foreground-muted">
          No sequenced genome is listed for this taxon. Go back and pick a different organism, or paste an accession.
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {rows.map((a) => (
          <div
            key={a.accession}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5"
            data-testid="ncbi-assembly-row"
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(a)}
              className="min-w-0 flex-1 text-left disabled:opacity-50"
              title="Browse this assembly's chromosomes"
            >
              <div className="font-mono text-meta font-medium text-foreground">
                {a.accession}{" "}
                <span className="font-sans text-foreground-muted">{a.organismName}</span>
              </div>
              <div className="text-meta text-foreground-muted">
                {a.assemblyLevel || "assembly"} level
              </div>
            </button>
            {a.isReference ? (
              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                Reference
              </span>
            ) : null}
            <Tooltip label="Download every contig in this assembly">
              <button
                type="button"
                disabled={busy}
                onClick={() => onWholeGenome(a)}
                data-testid="ncbi-whole-genome"
                className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:border-sky-400 disabled:opacity-50"
              >
                Whole genome
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
      {total > rows.length ? (
        <p className="mt-2 text-meta text-foreground-muted">
          Showing the first {rows.length} of {total} assemblies.
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
        >
          <Icon name="chevronLeft" className="h-3.5 w-3.5" />
          Back
        </button>
      </div>
    </div>
  );
}

// --- Step 3: Contigs ---------------------------------------------------------

function ContigsStep({
  assembly,
  busy,
  onPick,
  onWholeContig,
  onSearchGene,
  onBack,
}: {
  assembly: TaxonAssembly;
  busy: boolean;
  onPick: (s: AssemblySequence) => void;
  onWholeContig: (s: AssemblySequence) => void;
  onSearchGene: () => void;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<AssemblySequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setLoadError(null);
    listAssemblySequences(assembly.accession, c.signal)
      .then((res) => {
        setRows(res);
        setLoading(false);
      })
      .catch((e) => {
        if (isAbort(e)) return;
        setLoading(false);
        setLoadError(messageFor(e, "Could not list the chromosomes for this assembly."));
      });
    return () => c.abort();
  }, [assembly.accession]);

  const maxLen = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.lengthBp), 1),
    [rows],
  );

  return (
    <div>
      <h3 className="text-body font-semibold text-foreground">
        Chromosomes in <span className="font-mono">{assembly.accession}</span>
      </h3>
      <p className="mt-0.5 text-meta text-foreground-muted">
        Pulled live from the assembly. Browse and grab a whole chromosome, or just search a gene and we land you on the right one.
      </p>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-meta text-foreground-muted">
          <Icon name="refresh" className="h-3.5 w-3.5 animate-spin text-sky-500" />
          Listing chromosomes...
        </p>
      ) : null}
      {loadError ? (
        <p className="mt-3 text-meta text-rose-600 dark:text-rose-300">{loadError}</p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {rows.map((s) => (
          <div
            key={s.refseqAccession}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5"
            data-testid="ncbi-contig-row"
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(s)}
              className="min-w-0 flex-1 text-left disabled:opacity-50"
              title="Search a gene on this chromosome"
            >
              <div className="font-mono text-meta font-medium text-foreground">
                {s.refseqAccession}
              </div>
              <div className="text-meta text-foreground-muted">
                {s.name ? `${s.moleculeType || "Sequence"} ${s.name}, ` : ""}
                {formatBp(s.lengthBp)}
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-sky-500"
                  style={{ width: `${Math.max(2, (s.lengthBp / maxLen) * 100).toFixed(0)}%` }}
                />
              </div>
            </button>
            <Tooltip label="Download this whole chromosome">
              <button
                type="button"
                disabled={busy}
                onClick={() => onWholeContig(s)}
                data-testid="ncbi-whole-contig"
                className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:border-sky-400 disabled:opacity-50"
              >
                Whole chromosome
              </button>
            </Tooltip>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
        >
          <Icon name="chevronLeft" className="h-3.5 w-3.5" />
          Back
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSearchGene}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
        >
          <Icon name="search" className="h-3.5 w-3.5" />
          Search a gene instead
        </button>
      </div>
    </div>
  );
}

// --- Step 4: Gene search -----------------------------------------------------

function GeneStep({
  organism,
  busy,
  onPick,
  onBack,
}: {
  organism: string;
  busy: boolean;
  onPick: (hit: GeneSearchHit) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeneSearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const ctlRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    ctlRef.current?.abort();
    const c = new AbortController();
    ctlRef.current = c;
    setLoading(true);
    setSearchError(null);
    try {
      const rows = await esearchGenes(q, organism, c.signal);
      setHits(rows);
      setSearched(true);
    } catch (e) {
      if (isAbort(e)) return;
      setSearchError(messageFor(e, "Could not search NCBI Gene. Try again."));
    } finally {
      setLoading(false);
    }
  }, [query, organism]);

  useEffect(() => () => ctlRef.current?.abort(), []);

  return (
    <div>
      <h3 className="text-body font-semibold text-foreground">Search a gene</h3>
      <p className="mt-0.5 text-meta text-foreground-muted">
        Type a symbol, a locus tag, or the protein name if that is all you know. We search NCBI Gene scoped to {organism || "this organism"}, then resolve where each hit sits. You do not need the accession.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={query}
          autoComplete="off"
          disabled={busy}
          placeholder="cyp51A, or sterol 14-alpha-demethylase"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          data-testid="ncbi-gene-input"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={busy || !query.trim() || loading}
          onClick={runSearch}
          data-testid="ncbi-gene-search"
          className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-2 text-meta font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon name="search" className="h-3.5 w-3.5" />
          )}
          Search
        </button>
      </div>

      {searchError ? (
        <p className="mt-2 text-meta text-rose-600 dark:text-rose-300">{searchError}</p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {hits.map((h) => {
          const placed = hitHasPlacement(h);
          return (
            <button
              key={h.geneId}
              type="button"
              disabled={busy || !placed}
              onClick={() => onPick(h)}
              data-testid="ncbi-gene-row"
              title={placed ? "Window this gene" : "No chromosome placement on this record"}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-left transition-colors hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">
                  {h.symbol}{" "}
                  {h.geneId ? (
                    <span className="font-mono text-meta font-normal text-foreground-muted">
                      gene {h.geneId}
                    </span>
                  ) : null}
                </div>
                <div className="text-meta text-foreground-muted">
                  {h.description}
                  {h.chrName ? `, chromosome ${h.chrName}` : ""}
                </div>
              </div>
              {placed ? (
                <Icon name="chevronRight" className="h-4 w-4 text-foreground-muted" />
              ) : (
                <span className="text-[10px] uppercase tracking-wide text-foreground-muted">
                  no placement
                </span>
              )}
            </button>
          );
        })}
      </div>

      {searched && hits.length === 0 && !loading ? (
        <p className="mt-3 text-meta text-foreground-muted">
          No genes matched in our search.
        </p>
      ) : null}

      <p className="mt-3 text-meta text-foreground-muted">
        Not seeing it?{" "}
        <a
          href={ncbiGeneSearchUrl(organism)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sky-700 hover:underline dark:text-sky-300"
        >
          Search on NCBI Gene
          <Icon name="export" className="h-3 w-3" />
        </a>
        , then paste the accession back on the first step.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
        >
          <Icon name="chevronLeft" className="h-3.5 w-3.5" />
          Back
        </button>
      </div>
    </div>
  );
}

// --- Step 5: Window ----------------------------------------------------------

function WindowStep({
  placement,
  contigLen,
  flank,
  setFlank,
  busy,
  onImport,
  onBack,
}: {
  placement: GenePlacement;
  contigLen?: number;
  flank: number;
  setFlank: (n: number) => void;
  busy: boolean;
  onImport: () => void;
  onBack: () => void;
}) {
  const win = useMemo(
    () => resolveWindow(placement, flank, contigLen),
    [placement, flank, contigLen],
  );

  // Strand-bar geometry: the gene block plus the flanking context, as percent of
  // the resolved window.
  const total = win.stop - win.start + 1;
  const pct = (v: number) => ((v - win.start) / total) * 100;
  const geneL = Math.max(0, pct(placement.begin));
  const geneR = Math.min(100, pct(placement.end));
  const geneW = Math.max(1, geneR - geneL);

  return (
    <div>
      <h3 className="text-body font-semibold text-foreground">
        Grab a window around <span className="font-medium">{placement.symbol}</span>
      </h3>
      <p className="mt-0.5 text-meta text-foreground-muted">
        Default is the gene plus a flank on each side, so you keep the promoter and terminator context for cloning. Edit the flank, we fetch only that slice, not the whole chromosome.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-meta">
        <span className="text-foreground-muted">Gene plus</span>
        <input
          type="number"
          min={0}
          step={100}
          value={flank}
          disabled={busy}
          onChange={(e) => setFlank(Math.max(0, Number(e.target.value) || 0))}
          data-testid="ncbi-flank-input"
          className="w-24 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-foreground focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-50"
        />
        <span className="text-foreground-muted">bp on each side</span>
        <span className="ml-auto text-foreground-muted">
          Region{" "}
          <span className="font-mono text-emerald-600 dark:text-emerald-300">
            {placement.contigAccession}:{win.start.toLocaleString("en-US")}..
            {win.stop.toLocaleString("en-US")}
          </span>
          , <span className="font-semibold text-foreground">{formatBp(win.span)}</span>
        </span>
      </div>

      {/* Strand bar */}
      <div className="relative mt-3 h-10 overflow-hidden rounded-lg border border-border bg-surface-sunken">
        <div
          className="absolute inset-y-0 left-0 bg-sky-500/10"
          style={{ width: `${geneL}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-sky-500/10"
          style={{ left: `${geneR}%` }}
        />
        <div
          className="absolute top-2 flex h-6 items-center justify-center rounded bg-sky-600 px-1 text-[11px] font-bold text-white"
          style={{ left: `${geneL}%`, width: `${geneW}%` }}
        >
          <span className="truncate">{placement.symbol}</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-foreground-muted">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-600 align-middle" />
          {placement.symbol} gene ({placement.orientation} strand)
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-500/20 align-middle" />
          flank, the promoter and terminator context
        </span>
      </div>

      <p className="mt-3 text-meta text-foreground-muted">
        This window is {formatBp(win.span)}, so it parses and renders instantly. The whole chromosome would be much larger and slower.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken disabled:opacity-50"
        >
          <Icon name="chevronLeft" className="h-3.5 w-3.5" />
          Back
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onImport}
          data-testid="ncbi-import-region"
          className="ml-auto flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
        >
          <Icon name="import" className="h-3.5 w-3.5" />
          Import this region
        </button>
      </div>
    </div>
  );
}

// --- Terminal: Done ----------------------------------------------------------

function DoneScreen({
  summary,
  onAgain,
  onClose,
}: {
  summary: string;
  onAgain: () => void;
  onClose: () => void;
}) {
  return (
    <div className="py-8 text-center" data-testid="ncbi-done">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
        <Icon name="check" className="h-6 w-6" />
      </div>
      <h3 className="text-body font-semibold text-foreground">Imported into your library</h3>
      {summary ? (
        <p className="mx-auto mt-1 max-w-md text-meta text-foreground-muted">{summary}</p>
      ) : null}
      <div className="mt-5 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onAgain}
          className="rounded-md border border-border px-3.5 py-1.5 text-meta font-medium text-foreground transition-colors hover:bg-surface-sunken"
        >
          Import another
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-sky-600 px-3.5 py-1.5 text-meta font-medium text-white transition-colors hover:bg-sky-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}
