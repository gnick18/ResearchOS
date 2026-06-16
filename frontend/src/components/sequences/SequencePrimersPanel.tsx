"use client";

// primer panel bot — the PRIMERS tab. ONE calm panel, progressive disclosure,
// APE "Find Primers" as the model (Benchling's wizard/Task-dropdown is the
// anti-pattern). Three sections, no modal/wizard for the common case:
//
//  - PRIMERS LIST: the primer_bind features already on the molecule (unchanged
//    behaviour: click a row to zoom it, delete a row). Primers persist as
//    standard primer_bind features so they carry to the map + GenBank.
//  - DESIGN: with a region selected, one click ("Design primers") generates a
//    short RANKED list of candidate forward/reverse oligos using Primer3's
//    sensible defaults (length 18/20/27, Tm 57/60/63, %GC, 3' GC clamp). Each
//    candidate shows length / Tm / %GC and small trust BADGES (green = fine,
//    amber = worth a look). Per-row: add as a primer_bind feature (same persist
//    path) or copy the oligo. Defaults are invisible; an "Advanced" disclosure
//    (collapsed) holds the length/Tm windows, %GC range, salt/oligo conc, clamp.
//  - CHECK: paste a primer (or pick an existing one) and see length / Tm / %GC /
//    3' clamp + the trust checks (self-dimer, 3'-dimer, hairpin, poly-X) and
//    where it binds the CURRENT sequence (with extra/unintended sites flagged).
//
// The biology is REUSED: lib/sequences/primer.ts (Tm = the SantaLucia model the
// calculator uses, GC, findBindingSites) and lib/sequences/primer-design.ts
// (the scan/scoring + the trust checks). These are APE-level first-pass filters,
// NOT full Primer3 thermodynamics, and the UI says so. A "Check specificity"
// seam is left for the later local-library + NCBI Primer-BLAST item.
//
// Inline SVG only (no emoji); icon-only buttons use the Tooltip component (no
// native title=); no em-dashes.

import { useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import type { EditFeature } from "@/lib/sequences/edit-model";
import { gcContent, predictTm, sanitizePrimer } from "@/lib/sequences/primer";
import {
  DEFAULT_DESIGN_PARAMS,
  designPrimers,
  analyzePrimer,
  checkBinding,
  type PrimerCandidate,
  type PrimerDesignParams,
  type PrimerCheck,
} from "@/lib/sequences/primer-design";
import {
  scanLibrarySpecificity,
  buildPrimerBlastHandoff,
  type LibrarySequence,
  type SpecificityReport,
} from "@/lib/sequences/primer-specificity";

// --- inline icons -----------------------------------------------------------
function IconPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconTrash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function IconCopy({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
function IconPencil({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function IconGlobe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
    </svg>
  );
}
function IconShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3l8 3v5c0 4.5-3 8.5-8 10c-5-1.5-8-5.5-8-10V6l8-3z" />
    </svg>
  );
}
function IconChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className ?? ""} transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** Pull the primer's own 5'->3' sequence out of its /note "primer <SEQ>" flag. */
function primerSeqOf(f: EditFeature): string {
  const note = f.notes?.note;
  const text = Array.isArray(note) ? note.join(" ") : typeof note === "string" ? note : "";
  const m = text.match(/primer\s+([ACGTUacgtu]+)/);
  return m ? m[1].toUpperCase() : "";
}

/** A small trust badge: green when ok, amber when worth a look. */
function CheckBadge({ check }: { check: PrimerCheck }) {
  const ok = check.level === "ok";
  return (
    <Tooltip label={check.detail}>
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-meta font-medium ${
          ok ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
        {check.label}
      </span>
    </Tooltip>
  );
}

/** A small stat (label over value), compact. */
function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md bg-surface-sunken px-2.5 py-1.5">
      <div className="text-meta font-medium uppercase tracking-wide text-foreground-muted">{label}</div>
      <div className="text-body font-semibold text-foreground">{value}</div>
      {hint ? <div className="text-meta text-foreground-muted">{hint}</div> : null}
    </div>
  );
}

export interface SequencePrimersPanelProps {
  features: EditFeature[];
  /** Full forward-strand template (for design + binding checks). */
  template: string;
  /** Current selection [start, end) (forward coords), or null. */
  selection: { start: number; end: number } | null;
  onSelectPrimer: (index: number) => void;
  /** Open the SnapGene-style Edit Primer dialog for a primer_bind feature. */
  onEditPrimer?: (index: number) => void;
  selectedIndex: number | null;
  /** Open the PrimerDialog to add a custom (typed/pasted) primer with alignment. */
  onAddCustomPrimer: () => void;
  /** Persist a designed/checked primer as a primer_bind feature (shared path). */
  onAddPrimer: (
    name: string,
    primerSeq: string,
    site: { start: number; end: number; direction: 1 | -1 },
    // primer colors bot — optional per-primer color, persisted on the
    // primer_bind feature. The design/check panel does not set one (defaults
    // to the standard primer color), but the type stays in sync with the
    // shared addPrimerFeature signature.
    color?: string,
  ) => void;
  onDeletePrimer: (index: number) => void;
  readOnly?: boolean;
  /** Id of the sequence this panel is open on (the primer's intended parent for
   *  the local-library specificity scan). Lets the scan mark the designed binding
   *  site as intended vs flag extra/off-target sites elsewhere. */
  currentSequenceId?: number;
  /** Load the user's OWN connected sequences (current + project siblings, or the
   *  whole library) with their bases, for the local specificity scan. Async glue
   *  lives in the parent (sequencesApi); the panel only consumes LibrarySequence.
   *  Omit (or return only the current sequence) and the scan still runs. */
  loadLibrary?: () => Promise<LibrarySequence[]>;
  /** menu reorg bot — which sub-view to JUMP to when the parent bumps
   *  `initialModeNonce` (the toolbar Primer menu's "Check specificity..." fires
   *  this so the panel lands on Check instead of the user drilling List ->
   *  Check). The panel still OPENS on List by default; the jump only happens on a
   *  nonce bump, so a plain Primers-tab visit is unaffected. */
  initialMode?: Mode;
  initialModeNonce?: number;
}

type Mode = "list" | "design" | "check";

export default function SequencePrimersPanel({
  features,
  template,
  selection,
  onSelectPrimer,
  onEditPrimer,
  selectedIndex,
  onAddCustomPrimer,
  onAddPrimer,
  onDeletePrimer,
  readOnly = false,
  currentSequenceId,
  loadLibrary,
  initialMode,
  initialModeNonce,
}: SequencePrimersPanelProps) {
  const [mode, setMode] = useState<Mode>("list");
  // menu reorg bot — jump to the requested sub-view when the parent bumps the
  // nonce (the toolbar "Check specificity..." item fires this). This runs on
  // mount too when the nonce is already non-zero, so opening the Primers tab via
  // that menu item lands directly on Check; a plain tab visit stays on List.
  useEffect(() => {
    if (initialModeNonce && initialMode) setMode(initialMode);
  }, [initialModeNonce, initialMode]);
  const [params, setParams] = useState<PrimerDesignParams>(DEFAULT_DESIGN_PARAMS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [checkRaw, setCheckRaw] = useState("");

  // Local-library specificity scan state (CHECK mode). Lazy: only runs when the
  // user clicks "Check specificity", scoped to the primer in the box.
  const [specReport, setSpecReport] = useState<SpecificityReport | null>(null);
  const [specPrimer, setSpecPrimer] = useState<string | null>(null);
  const [specBusy, setSpecBusy] = useState(false);
  const [specError, setSpecError] = useState<string | null>(null);
  // NCBI handoff: show the one-time privacy notice before the external submit.
  const [ncbiNoticeOpen, setNcbiNoticeOpen] = useState(false);

  // Existing primers on the molecule (carry the original doc index).
  const primers = useMemo(
    () =>
      features
        .map((f, index) => ({ f, index }))
        .filter(({ f }) => (f.type || "").toLowerCase() === "primer_bind"),
    [features],
  );

  const hasSelection = !!selection && selection.end > selection.start;
  const selLen = hasSelection ? selection!.end - selection!.start : 0;

  // DESIGN: generate ranked candidates for the current selection.
  const design = useMemo(() => {
    if (mode !== "design" || !hasSelection || !selection) return null;
    return designPrimers(template, selection.start, selection.end, params, { limit: 5 });
  }, [mode, hasSelection, template, selection, params]);

  // CHECK: the pasted/picked primer, its analysis + binding sites.
  const checkPrimer = useMemo(() => sanitizePrimer(checkRaw), [checkRaw]);
  const checkAnalysis = useMemo(
    () => (checkPrimer.length > 0 ? analyzePrimer(checkPrimer, params) : null),
    [checkPrimer, params],
  );
  const checkBindingReport = useMemo(
    () => (checkPrimer.length > 0 ? checkBinding(checkPrimer, template) : null),
    [checkPrimer, template],
  );

  // Clear the "copied" flash after a beat.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1200);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async (seq: string) => {
    try {
      await navigator.clipboard.writeText(seq);
      setCopied(seq);
    } catch {
      // clipboard may be blocked; the readout already shows the sequence.
    }
  };

  // The specificity result is only valid for the primer it was run on; clear it
  // (and the NCBI notice) whenever the checked primer changes.
  useEffect(() => {
    if (specPrimer !== null && specPrimer !== checkPrimer) {
      setSpecReport(null);
      setSpecPrimer(null);
      setSpecError(null);
      setNcbiNoticeOpen(false);
    }
  }, [checkPrimer, specPrimer]);

  // Run the local-library specificity scan for the primer in the Check box. Loads
  // the user's connected sequences via the parent's loadLibrary glue, then runs
  // the pure scanLibrarySpecificity. Always works (no network); the current
  // sequence alone is a valid library if loadLibrary is absent.
  const runSpecificity = async () => {
    if (!checkPrimer) return;
    setSpecBusy(true);
    setSpecError(null);
    try {
      let library: LibrarySequence[] = [];
      if (loadLibrary) {
        library = await loadLibrary();
      }
      // Always include the current sequence (the intended parent) so the intended
      // site is classified even when loadLibrary is unavailable or omits it.
      if (currentSequenceId != null && !library.some((l) => l.id === currentSequenceId)) {
        library = [{ id: currentSequenceId, name: "this sequence", seq: template }, ...library];
      }
      if (library.length === 0) {
        library = [{ id: currentSequenceId ?? -1, name: "this sequence", seq: template }];
      }
      const report = scanLibrarySpecificity(checkPrimer, library, {
        intendedSequenceId: currentSequenceId,
      });
      setSpecReport(report);
      setSpecPrimer(checkPrimer);
    } catch {
      setSpecError("Could not load the sequence library for the scan.");
    } finally {
      setSpecBusy(false);
    }
  };

  // Build + submit the auto-submitting hidden POST form to NCBI Primer-BLAST in a
  // new tab. Form NAVIGATION (not fetch), so no CORS and no backend. Degrades to
  // the unfilled Primer-BLAST page if there is nothing to prefill.
  const submitToPrimerBlast = () => {
    const fwdSite = checkBindingReport?.sites.find((s) => s.direction === 1);
    const handoff = buildPrimerBlastHandoff({
      template,
      // The checked oligo goes in the strand field matching where it anneals.
      forwardPrimer: fwdSite || !checkBindingReport?.sites.length ? checkPrimer : undefined,
      reversePrimer: !fwdSite && checkBindingReport?.sites.length ? checkPrimer : undefined,
    });
    const form = document.createElement("form");
    form.method = "POST";
    form.action = handoff.action;
    form.target = "_blank";
    form.rel = "noopener";
    form.style.display = "none";
    for (const [name, value] of Object.entries(handoff.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
    setNcbiNoticeOpen(false);
  };

  // Add a designed candidate as a primer_bind feature (shared persist path).
  const addCandidate = (c: PrimerCandidate, idx: number) => {
    const name = `${c.direction === 1 ? "fwd" : "rev"}_${idx + 1}`;
    onAddPrimer(name, c.primer, { start: c.start, end: c.end, direction: c.direction });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-raised">
      {/* Header + mode switch */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">Primers</span>
        <div className="inline-flex rounded-md bg-surface-sunken p-0.5 text-meta font-medium ros-seg-track border border-border">
          {(
            [
              ["list", "List"],
              ["design", "Design"],
              ["check", "Check"],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded px-2.5 py-1 transition-colors ${
                mode === m ? "bg-surface-raised text-foreground ros-seg-active" : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Trust banner: our Tm matches Primer3 / Primer-BLAST. */}
      {mode !== "list" ? (
        <div className="border-b border-border bg-sky-50/60 px-4 py-1.5 text-meta text-sky-700 dark:text-sky-300">
          Tm uses the SantaLucia 1998 nearest-neighbor model, the same one Primer3 and
          Primer-BLAST use, so these numbers match those tools. The dimer, hairpin, and
          poly-X checks are a quick screen that flags likely problems, not exact
          thermodynamic modeling.
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ===================== LIST ===================== */}
        {mode === "list" ? (
          <div className="flex h-full flex-col">
            {!readOnly ? (
              <div className="flex items-center gap-2 px-4 py-2">
                <Tooltip label="Generate candidate primers for the selected region">
                  <button
                    type="button"
                    onClick={() => setMode("design")}
                    className="inline-flex items-center gap-1 rounded-md bg-brand-action px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-brand-action/90"
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                    Design primers
                  </button>
                </Tooltip>
                <Tooltip label="Add a primer you type or paste (with alignment)">
                  <button
                    type="button"
                    onClick={onAddCustomPrimer}
                    className="rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
                  >
                    Add a primer
                  </button>
                </Tooltip>
              </div>
            ) : null}

            {primers.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <p className="text-body text-foreground-muted">No primers yet.</p>
                <p className="mt-1 text-meta text-foreground-muted">
                  {readOnly
                    ? "Primers added to this sequence will appear here."
                    : "Select a region and Design primers, or add one you already have."}
                </p>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto py-1">
                {primers.map(({ f, index }) => {
                  const seq = primerSeqOf(f);
                  const len = seq.length || f.end - f.start;
                  const gc = seq ? Math.round(gcContent(seq)) : null;
                  const tm = seq ? Math.round(predictTm(seq)) : null;
                  const selected = selectedIndex === index;
                  return (
                    <li key={`${f.name}-${f.start}-${index}`}>
                      <div
                        className={`group flex items-center gap-2 px-3 py-1.5 ${
                          selected ? "bg-sky-50 dark:bg-sky-500/15" : "hover:bg-surface-sunken"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectPrimer(index)}
                          className="flex min-w-0 flex-1 flex-col items-start text-left"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-body font-medium text-foreground">
                              {f.name || "primer"}
                            </span>
                            <span className="rounded bg-surface-sunken px-1 text-meta font-medium text-foreground-muted">
                              {f.strand === -1 ? "reverse" : "forward"}
                            </span>
                          </span>
                          <span className="font-mono text-meta text-foreground-muted">
                            {(f.start + 1).toLocaleString()} .. {f.end.toLocaleString()} · {len} nt
                            {gc !== null ? ` · ${gc}% GC` : ""}
                            {tm !== null ? ` · Tm ${tm} C` : ""}
                          </span>
                          {seq ? (
                            <span className="truncate font-mono text-meta text-foreground-muted">
                              {`5'-${seq}-3'`}
                            </span>
                          ) : null}
                        </button>
                        {onEditPrimer ? (
                          <Tooltip label="Edit this primer (name, sequence, phosphorylation)">
                            <button
                              type="button"
                              onClick={() => onEditPrimer(index)}
                              aria-label={`Edit primer ${f.name}`}
                              className="rounded p-1 text-foreground-muted opacity-0 transition-opacity hover:bg-surface-sunken hover:text-sky-600 group-hover:opacity-100"
                            >
                              <IconPencil className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        ) : null}
                        {seq ? (
                          <Tooltip label="Check this primer (Tm, dimers, hairpin, binding)">
                            <button
                              type="button"
                              onClick={() => {
                                setCheckRaw(seq);
                                setMode("check");
                              }}
                              aria-label={`Check primer ${f.name}`}
                              className="rounded p-1 text-foreground-muted opacity-0 transition-opacity hover:bg-surface-sunken hover:text-sky-600 group-hover:opacity-100"
                            >
                              <IconCheck className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        ) : null}
                        {!readOnly ? (
                          <Tooltip label="Delete primer">
                            <button
                              type="button"
                              onClick={() => onDeletePrimer(index)}
                              aria-label={`Delete primer ${f.name}`}
                              className="rounded p-1 text-foreground-muted opacity-0 transition-opacity hover:bg-surface-sunken hover:text-red-500 group-hover:opacity-100"
                            >
                              <IconTrash className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {/* ===================== DESIGN ===================== */}
        {mode === "design" ? (
          <div className="space-y-3 px-4 py-3">
            {!hasSelection || !selection ? (
              <div className="rounded-md border border-dashed border-border bg-surface-sunken px-3 py-4 text-center text-body text-foreground-muted">
                Select a region in the Sequence view, then design primers for it.
                <div className="mt-1 text-meta text-foreground-muted">
                  Candidates use Primer3 defaults (length 18/20/27, Tm 57/60/63 C).
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-meta text-foreground-muted">
                  <span>
                    Region {(selection.start + 1).toLocaleString()}..
                    {selection.end.toLocaleString()}{" "}
                    <span className="text-foreground-muted">({selLen.toLocaleString()} bp)</span>
                  </span>
                  <span className="text-foreground-muted">ranked best first</span>
                </div>

                {design && design.forward.length === 0 && design.reverse.length === 0 ? (
                  <div className="rounded-md border border-dashed border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-3 text-body text-amber-700 dark:text-amber-300">
                    No candidate met the windows in this region. Widen the length/Tm/%GC
                    windows under Advanced, or pick a longer region.
                  </div>
                ) : null}

                {design ? (
                  <>
                    <CandidateList
                      title="Forward"
                      candidates={design.forward}
                      readOnly={readOnly}
                      copied={copied}
                      onCopy={copy}
                      onAdd={addCandidate}
                    />
                    <CandidateList
                      title="Reverse"
                      candidates={design.reverse}
                      readOnly={readOnly}
                      copied={copied}
                      onCopy={copy}
                      onAdd={addCandidate}
                    />
                  </>
                ) : null}
              </>
            )}

            {/* Advanced (collapsed by default) */}
            <AdvancedPanel
              open={advancedOpen}
              onToggle={() => setAdvancedOpen((o) => !o)}
              params={params}
              onChange={setParams}
              onReset={() => setParams(DEFAULT_DESIGN_PARAMS)}
            />
          </div>
        ) : null}

        {/* ===================== CHECK ===================== */}
        {mode === "check" ? (
          <div className="space-y-3 px-4 py-3">
            <label className="block">
              <span className="mb-1 block text-meta font-medium text-foreground-muted">
                Primer sequence (5&apos; to 3&apos;)
              </span>
              <textarea
                value={checkRaw}
                onChange={(e) => setCheckRaw(sanitizePrimer(e.target.value))}
                rows={2}
                placeholder="Paste a primer, or pick one from the List tab"
                spellCheck={false}
                className="w-full resize-y rounded-md border border-border px-2.5 py-2 font-mono text-body tracking-wide text-foreground focus:border-sky-400 focus:outline-none"
              />
            </label>

            {checkAnalysis && checkBindingReport ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Length" value={`${checkAnalysis.length}-mer`} />
                  <Stat label="GC" value={`${checkAnalysis.gc.toFixed(1)}%`} />
                  <Stat label="Tm" value={`${checkAnalysis.tm.toFixed(1)} °C`} hint="SantaLucia" />
                </div>

                <div>
                  <span className="mb-1 block text-meta font-medium text-foreground-muted">Trust checks</span>
                  <div className="flex flex-wrap gap-1.5">
                    {checkAnalysis.checks.map((c) => (
                      <CheckBadge key={c.label} check={c} />
                    ))}
                  </div>
                </div>

                {/* Binding on the current sequence */}
                <div>
                  <span className="mb-1 block text-meta font-medium text-foreground-muted">
                    Binds this sequence
                  </span>
                  {checkBindingReport.sites.length > 0 ? (
                    <div className="space-y-1">
                      {checkBindingReport.sites.map((s, i) => (
                        <div
                          key={`${s.start}-${s.end}-${s.direction}`}
                          className={`rounded-md px-2.5 py-1.5 text-meta ${
                            i === 0 ? "bg-surface-sunken text-foreground" : "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          <span className="font-medium">
                            {s.direction === 1 ? "Forward" : "Reverse"} strand
                          </span>
                          {", "}
                          {(s.start + 1).toLocaleString()}..{s.end.toLocaleString()}
                          {", "}
                          {s.annealedLength} of {checkAnalysis.length} bp anneal
                          {s.mismatches && s.mismatches.length
                            ? `, ${s.annealedLength - s.mismatches.length}/${s.annealedLength} matched (${Math.round((s.identity ?? 0) * 100)}%)`
                            : s.fullMatch
                              ? ""
                              : " (3'-anchored)"}
                          {i > 0 ? ", extra site, may be unintended" : ""}
                        </div>
                      ))}
                      {checkBindingReport.hasExtraSites ? (
                        <p className="text-meta text-amber-600 dark:text-amber-300">
                          More than one binding site on this sequence. Extra sites are flagged
                          amber.
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-meta text-foreground-muted">
                      No binding site found on this sequence.
                    </p>
                  )}
                </div>

                {/* Add + copy + specificity seam */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {!readOnly && checkBindingReport.sites.length > 0 ? (
                    <Tooltip label="Add this primer as a primer_bind feature at its best binding site">
                      <button
                        type="button"
                        onClick={() => {
                          const s = checkBindingReport.sites[0];
                          onAddPrimer("primer", checkPrimer, {
                            start: s.start,
                            end: s.end,
                            direction: s.direction,
                          });
                        }}
                        className="inline-flex items-center gap-1 rounded-md bg-brand-action px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-brand-action/90"
                      >
                        <IconPlus className="h-3.5 w-3.5" />
                        Add to sequence
                      </button>
                    </Tooltip>
                  ) : null}
                  <Tooltip label="Copy the oligo">
                    <button
                      type="button"
                      onClick={() => copy(checkPrimer)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
                    >
                      <IconCopy className="h-3.5 w-3.5" />
                      {copied === checkPrimer ? "Copied" : "Copy"}
                    </button>
                  </Tooltip>
                  <Tooltip label="Scan your connected sequences for off-target binding (instant, stays on your machine)">
                    <button
                      type="button"
                      onClick={runSpecificity}
                      disabled={specBusy}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken disabled:opacity-50"
                    >
                      <IconShield className="h-3.5 w-3.5" />
                      {specBusy ? "Scanning..." : "Check specificity"}
                    </button>
                  </Tooltip>
                </div>

                {/* Local-library specificity result (instant, no network) */}
                {specError ? (
                  <p className="rounded-md border border-dashed border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-2.5 py-2 text-meta text-amber-700 dark:text-amber-300">
                    {specError}
                  </p>
                ) : null}
                {specReport && specPrimer === checkPrimer ? (
                  <SpecificityResult
                    report={specReport}
                    onCheckNcbi={() => setNcbiNoticeOpen(true)}
                  />
                ) : null}

                {/* NCBI Primer-BLAST privacy notice + handoff */}
                {ncbiNoticeOpen ? (
                  <div className="rounded-md border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/15 px-3 py-2.5 text-meta text-sky-800 dark:text-sky-300">
                    <p className="flex items-start gap-1.5 font-medium">
                      <IconGlobe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      This opens NCBI Primer-BLAST in a new tab and sends your primer and
                      this template sequence to NCBI&apos;s servers.
                    </p>
                    <p className="mt-1 text-sky-700 dark:text-sky-300">
                      ResearchOS is local-first, so this is the one step that leaves your
                      machine. Nothing else about your sequence is shared.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={submitToPrimerBlast}
                        className="inline-flex items-center gap-1 rounded-md bg-brand-action px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-brand-action/90"
                      >
                        <IconGlobe className="h-3.5 w-3.5" />
                        Open Primer-BLAST
                      </button>
                      <button
                        type="button"
                        onClick={() => setNcbiNoticeOpen(false)}
                        className="rounded-md px-2.5 py-1 text-meta font-medium text-sky-700 dark:text-sky-300 transition-colors hover:bg-sky-100 dark:hover:bg-sky-500/20"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="rounded-md border border-dashed border-border px-2.5 py-3 text-center text-meta text-foreground-muted">
                Paste a primer to see its Tm, GC, trust checks and binding sites.
              </p>
            )}

            <AdvancedPanel
              open={advancedOpen}
              onToggle={() => setAdvancedOpen((o) => !o)}
              params={params}
              onChange={setParams}
              onReset={() => setParams(DEFAULT_DESIGN_PARAMS)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- specificity result (local-library scan + NCBI handoff) -----------------
function SpecificityResult({
  report,
  onCheckNcbi,
}: {
  report: SpecificityReport;
  onCheckNcbi: () => void;
}) {
  const clean = report.offTargets.length === 0;
  return (
    <div className="rounded-md border border-border bg-surface-sunken/60 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-meta font-semibold text-foreground">Local-library specificity</span>
        <span className="text-meta text-foreground-muted">
          {report.scanned} sequence{report.scanned === 1 ? "" : "s"} scanned
          {report.skipped > 0 ? ` (+${report.skipped} skipped)` : ""}
        </span>
      </div>

      {report.hits.length === 0 ? (
        <p className="text-meta text-foreground-muted">
          This primer does not anneal anywhere in your connected sequences (at or above{" "}
          {report.minAnneal} bp). It may still have an intended site that is shorter than the
          detection threshold.
        </p>
      ) : (
        <div className="space-y-1">
          {report.hits.map((h) => {
            // Three risk tiers. Intended = the designed perfect site (calm green).
            // A PERFECT off-target (0 mismatches) is the most dangerous, it primes
            // as strongly as the intended site (rose). A NEAR off-target (1-2
            // mismatches) can still cross-prime but binds weaker (amber).
            const tier = h.intended
              ? "intended"
              : h.mismatches === 0
                ? "perfect"
                : "near";
            const tone =
              tier === "intended"
                ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : tier === "perfect"
                  ? "bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300"
                  : "bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300";
            const identityPct = Math.round(h.identity * 100);
            return (
              <div
                key={`${h.sequenceId}-${h.site.start}-${h.site.end}-${h.site.direction}`}
                className={`rounded px-2 py-1 text-meta ${tone}`}
              >
                <span className="font-medium">{h.sequenceName}</span>
                {", "}
                {h.site.direction === 1 ? "forward" : "reverse"} strand,{" "}
                {(h.site.start + 1).toLocaleString()}..{h.site.end.toLocaleString()},{" "}
                {h.site.annealedLength} bp anneal
                {h.site.fullMatch ? "" : " (3'-anchored)"}
                {tier === "intended"
                  ? " (intended site)"
                  : tier === "perfect"
                    ? " (perfect off-target)"
                    : ` (${h.mismatches} mismatch${h.mismatches === 1 ? "" : "es"}, ${identityPct}% identity)`}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-1.5 text-meta text-foreground-muted">
        {clean
          ? `No off-target sites in your library${report.mismatchTolerant ? `, including near matches down to ${Math.round(report.minIdentity * 100)}% identity` : ""}. This is a local check only; it does not see genome-wide off-targets.`
          : `Rose rows are perfect off-targets (prime as strongly as the intended site); amber rows are near matches that can still cross-prime${report.mismatchTolerant ? ` (down to ${Math.round(report.minIdentity * 100)}% identity)` : ""}. This is a local check only; it does not see genome-wide off-targets.`}
      </p>

      <div className="mt-2 border-t border-border pt-2">
        <Tooltip label="Open NCBI Primer-BLAST in a new tab to check this primer against full genomes / transcriptomes">
          <button
            type="button"
            onClick={onCheckNcbi}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            <IconGlobe className="h-3.5 w-3.5" />
            Check genome-wide on NCBI
          </button>
        </Tooltip>
        <p className="mt-1 text-meta text-foreground-muted">
          Sends your primer and template to NCBI Primer-BLAST in a new tab (leaves your machine).
        </p>
      </div>
    </div>
  );
}

// --- candidate list (DESIGN rows) -------------------------------------------
function CandidateList({
  title,
  candidates,
  readOnly,
  copied,
  onCopy,
  onAdd,
}: {
  title: string;
  candidates: PrimerCandidate[];
  readOnly: boolean;
  copied: string | null;
  onCopy: (seq: string) => void;
  onAdd: (c: PrimerCandidate, idx: number) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
        {title}
      </div>
      <ul className="space-y-1.5">
        {candidates.map((c, i) => (
          <li key={`${c.primer}-${c.start}`} className="rounded-md border border-border px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="break-all font-mono text-meta text-foreground">
                5&apos;-{c.primer}-3&apos;
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Tooltip label="Copy the oligo">
                  <button
                    type="button"
                    onClick={() => onCopy(c.primer)}
                    aria-label="Copy oligo"
                    className="rounded p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
                  >
                    <IconCopy className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                {!readOnly ? (
                  <Tooltip label="Add as a primer_bind feature (lands on the map + GenBank)">
                    <button
                      type="button"
                      onClick={() => onAdd(c, i)}
                      aria-label="Add primer"
                      className="rounded p-1 text-sky-500 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/20 hover:text-sky-700"
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                ) : null}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-foreground-muted">
              <span>
                {(c.start + 1).toLocaleString()}..{c.end.toLocaleString()}
              </span>
              <span>{c.length} nt</span>
              <span>Tm {c.tm.toFixed(1)} °C</span>
              <span>{c.gc.toFixed(0)}% GC</span>
              {copied === c.primer ? <span className="text-emerald-600 dark:text-emerald-300">copied</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {c.analysis.checks.map((ck) => (
                <CheckBadge key={ck.label} check={ck} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Advanced disclosure (collapsed by default) -----------------------------
function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="w-full rounded-md border border-border px-2 py-1 text-body text-foreground focus:border-sky-400 focus:outline-none"
      />
    </label>
  );
}

function AdvancedPanel({
  open,
  onToggle,
  params,
  onChange,
  onReset,
}: {
  open: boolean;
  onToggle: () => void;
  params: PrimerDesignParams;
  onChange: (p: PrimerDesignParams) => void;
  onReset: () => void;
}) {
  const set = (patch: Partial<PrimerDesignParams>) => onChange({ ...params, ...patch });
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
      >
        <span className="inline-flex items-center gap-1.5">
          <IconChevron open={open} className="h-3.5 w-3.5" />
          Advanced
        </span>
        <span className="text-meta font-normal text-foreground-muted">defaults match Primer3</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <div>
            <div className="mb-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              Length (bp)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="min" value={params.lengthMin} onChange={(n) => set({ lengthMin: n })} />
              <NumberField label="opt" value={params.lengthOpt} onChange={(n) => set({ lengthOpt: n })} />
              <NumberField label="max" value={params.lengthMax} onChange={(n) => set({ lengthMax: n })} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              Tm (°C)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="min" value={params.tmMin} onChange={(n) => set({ tmMin: n })} />
              <NumberField label="opt" value={params.tmOpt} onChange={(n) => set({ tmOpt: n })} />
              <NumberField label="max" value={params.tmMax} onChange={(n) => set({ tmMax: n })} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              %GC range
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="min" value={params.gcMin} onChange={(n) => set({ gcMin: n })} />
              <NumberField label="max" value={params.gcMax} onChange={(n) => set({ gcMax: n })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Na+ (mM)"
              value={params.naMillimolar}
              onChange={(n) => set({ naMillimolar: n })}
            />
            <NumberField
              label="Oligo (nM)"
              value={params.oligoNanomolar}
              onChange={(n) => set({ oligoNanomolar: n })}
            />
          </div>
          <label className="flex items-center gap-2 text-meta text-foreground-muted">
            <input
              type="checkbox"
              checked={params.requireGcClamp}
              onChange={(e) => set({ requireGcClamp: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-border text-sky-600 dark:text-sky-300 focus:ring-sky-400"
            />
            Require a 3&apos; GC clamp
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onReset}
              className="rounded-md px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
