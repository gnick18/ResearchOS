"use client";

// protein analyze bot — the sequence editor's "Protein properties" dialog, the
// SECOND door into the protein-properties engine (lib/calculators/protein.ts).
// The first door is the Lab calculators panel tab; both render the SAME shared
// ProteinPropertiesView so the readout never drifts.
//
// Source selection, in priority order:
//   1. If a region is selected in the editor, translate that selection (frame
//      from the selection start) and prefill it.
//   2. Else, if the molecule has CDS / gene features, offer a picker over them
//      and translate the chosen feature's range (honoring strand + exon joins).
//   3. The amino-acid sequence is always shown in an editable field, so the
//      reader can confirm it, tweak the frame, or paste a different protein.
//
// A single trailing stop (*) is trimmed before analysis. Internal * or X stay
// in (analyzeProtein ignores them for the math and the shared view flags them).
//
// Calm modal shell mirroring CompareSequencesDialog. No emojis (inline SVG
// only), no em-dash, no mid-sentence colons in copy. Type tokens throughout.

import { useEffect, useMemo, useState } from "react";
import { analyzeProtein } from "@/lib/calculators/protein";
import { translateFrame1 } from "@/lib/sequences/export";
import type { EditFeature } from "@/lib/sequences/edit-model";
import {
  isCodingFeature,
  translateFeature,
  trimTrailingStop,
} from "@/lib/sequences/feature-protein";
import ProteinPropertiesView, {
  NonStandardNotice,
} from "./ProteinPropertiesView";
import LivingPopup from "@/components/ui/LivingPopup";

function ProteinIcon({ className }: { className?: string }) {
  // A small chain-of-beads glyph, reading as a polypeptide. Inline SVG to match
  // the rest of the editor's iconography.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="14" cy="6" r="2.5" />
      <circle cx="18" cy="13" r="2.5" />
      <circle cx="10" cy="17" r="2.5" />
      <path d="M8.4 7.6 11.7 6.6 M15.9 7.9 17.1 11 M16.3 14.6 11.6 15.8 M8.2 15.7 7 9.3" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

type SourceKind = "selection" | "feature" | "manual";

export default function ProteinPropertiesDialog({
  open,
  onClose,
  seq,
  features,
  selection,
}: {
  open: boolean;
  onClose: () => void;
  /** The molecule's DNA / RNA bases. */
  seq: string;
  /** The document's features, for the CDS / gene picker. */
  features: EditFeature[];
  /** The current editor selection range, if any (half-open [lo, hi)). */
  selection: { lo: number; hi: number; hasRange: boolean } | null;
}) {
  // The protein actually analyzed. Editable so the reader can confirm, adjust
  // the frame, or paste a different sequence.
  const [protein, setProtein] = useState("");
  // Which source last filled the field, for the readout line + picker default.
  const [source, setSource] = useState<SourceKind>("manual");
  // The chosen feature index (into codingFeatures), when source === "feature".
  const [featureIdx, setFeatureIdx] = useState(0);

  const codingFeatures = useMemo(
    () => features.filter(isCodingFeature),
    [features],
  );

  const hasSelection = !!selection && selection.hasRange;

  // Seed the field when the dialog opens: selection wins, then the first coding
  // feature, else leave it empty for a paste.
  useEffect(() => {
    if (!open) return;
    if (hasSelection && selection) {
      const aa = trimTrailingStop(
        translateFrame1(seq.slice(selection.lo, selection.hi)),
      );
      setProtein(aa);
      setSource("selection");
      return;
    }
    if (codingFeatures.length > 0) {
      setFeatureIdx(0);
      setProtein(trimTrailingStop(translateFeature(seq, codingFeatures[0])));
      setSource("feature");
      return;
    }
    setProtein("");
    setSource("manual");
    // open is the trigger; seeding once per open is intentional, so the user's
    // later edits are not clobbered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onPickFeature = (idx: number) => {
    setFeatureIdx(idx);
    setSource("feature");
    const f = codingFeatures[idx];
    if (f) setProtein(trimTrailingStop(translateFeature(seq, f)));
  };

  const useSelection = () => {
    if (!selection) return;
    setProtein(
      trimTrailingStop(translateFrame1(seq.slice(selection.lo, selection.hi))),
    );
    setSource("selection");
  };

  // analyzeProtein already trims internally (cleanProteinSeq drops non-standard
  // letters), but we trim a trailing stop on seed so the field shows the mature
  // chain. A manual edit re-trims here too, defensively.
  const result = useMemo(
    () => analyzeProtein(trimTrailingStop(protein.trim())),
    [protein],
  );

  if (!open) return null;

  const featureLabel = (f: EditFeature, i: number) => {
    const name = f.name || f.type || `Feature ${i + 1}`;
    const span = Math.abs(f.end - f.start);
    return `${name} (${(f.type || "feature").toLowerCase()}, ${span} bp)`;
  };

  return (
    <LivingPopup open onClose={onClose} label="Protein properties" selfSize showClose={false}>
      <div
        className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface-raised ros-popup-card-shadow"
        data-testid="protein-properties-dialog"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <ProteinIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">
              Protein properties
            </h2>
            <p className="text-meta text-foreground-muted">
              ProtParam-style molecular weight, pI, extinction, and composition
              for a translated protein.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Source controls */}
        <div className="border-b border-border px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {codingFeatures.length > 0 && (
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  Coding feature
                </span>
                <select
                  value={source === "feature" ? String(featureIdx) : ""}
                  onChange={(e) =>
                    e.target.value === ""
                      ? undefined
                      : onPickFeature(Number(e.target.value))
                  }
                  className="w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-body text-foreground focus:border-sky-400 focus:outline-none"
                >
                  {source !== "feature" && (
                    <option value="">Pick a CDS or gene…</option>
                  )}
                  {codingFeatures.map((f, i) => (
                    <option key={i} value={String(i)}>
                      {featureLabel(f, i)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {hasSelection && (
              <button
                type="button"
                onClick={useSelection}
                className="ros-btn-neutral self-end px-3 py-1.5 text-body font-medium"
              >
                Use selection
              </button>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Amino-acid sequence
            </span>
            <textarea
              value={protein}
              onChange={(e) => {
                setProtein(e.target.value);
                setSource("manual");
              }}
              placeholder="Translated protein appears here, or paste your own (one-letter codes)."
              rows={3}
              className="w-full rounded-md border border-border px-3 py-2 font-mono text-body text-foreground focus:border-sky-400 focus:outline-none resize-y"
            />
          </label>
          <p className="text-meta text-foreground-muted">
            {source === "selection"
              ? "Translated from the current selection in reading frame 1. A trailing stop is trimmed."
              : source === "feature"
                ? "Translated from the chosen feature, honoring strand and exon joins. A trailing stop is trimmed."
                : "Paste a protein, or select a region or coding feature above to translate it in. Whitespace and digits are ignored."}
          </p>
        </div>

        {/* Result body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {result && <NonStandardNotice chars={result.nonStandardChars} />}
          {result === null ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-sunken p-4 text-body text-foreground-muted">
              {protein.trim().length === 0
                ? "Select a region or a coding feature, or paste a protein sequence, to see its properties."
                : "No standard amino acids found yet. Check the sequence above."}
            </div>
          ) : (
            <ProteinPropertiesView result={result} />
          )}
        </div>
      </div>
    </LivingPopup>
  );
}
