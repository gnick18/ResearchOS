"use client";

// annotate-from-reference bot — HOMOLOGY-BASED ANNOTATION TRANSFER dialog.
//
// Pick a reference sequence from the library, align the open sequence against it
// (lib/sequences/annotate-from-reference, which uses the project's own IUPAC-
// aware aligner on both strands), and review the features the alignment proposes
// to carry over. Each proposal shows name, type, mapped position, identity %,
// and a partial-map warning; the user checks the ones to keep and applies them
// as real features on the open sequence through the editor's add-feature path.
//
// Calm, compact layout. Type tokens (text-meta / text-body / text-title). Icon-
// only buttons wrapped in <Tooltip>. No emojis (inline SVG only), no em-dashes.

import { useCallback, useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { sequencesApi } from "@/lib/local-api";
import { documentFromDetail } from "@/lib/sequences/edit-model";
import type { FeatureDraft } from "@/lib/sequences/feature-edit";
import { colorForType } from "@/lib/sequences/feature-colors";
import {
  annotateFromReference,
  DEFAULT_IDENTITY_THRESHOLD,
  type ProposedFeature,
  type ReferenceFeature,
  type AnnotateResult,
} from "@/lib/sequences/annotate-from-reference";
import type { SequenceRecord } from "@/lib/types";
import LivingPopup from "@/components/ui/LivingPopup";

export interface AnnotateFromReferenceRequest {
  /** The open document's bases (the target the features land on). */
  openSeq: string;
  /** The open sequence's own id, excluded from the reference picker. */
  currentSeqId: number;
  /** Apply the chosen proposals as real features (one undoable edit). */
  onApply: (features: FeatureDraft[]) => void;
  onCancel: () => void;
}

type Stage = "pick" | "review";

/** A proposal plus its selected state in the review checklist. */
interface ReviewRow {
  proposal: ProposedFeature;
  selected: boolean;
}

export default function AnnotateFromReferenceDialog({
  request,
}: {
  request: AnnotateFromReferenceRequest | null;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [library, setLibrary] = useState<SequenceRecord[] | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [refId, setRefId] = useState<number | null>(null);
  const [refName, setRefName] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnnotateResult | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);

  // Reset everything whenever the dialog opens fresh.
  useEffect(() => {
    if (!request) return;
    setStage("pick");
    setRefId(null);
    setRefName("");
    setResult(null);
    setRows([]);
    setLibError(null);
    setLibrary(null);
    let cancelled = false;
    (async () => {
      try {
        const all = await sequencesApi.list();
        if (cancelled) return;
        setLibrary(all.filter((s) => s.id !== request.currentSeqId));
      } catch {
        if (!cancelled) setLibError("Could not load the sequence library.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const runTransfer = useCallback(async () => {
    if (!request || refId == null) return;
    setRunning(true);
    try {
      const detail = await sequencesApi.get(refId);
      if (!detail) {
        setLibError("Could not load the chosen reference.");
        setRunning(false);
        return;
      }
      // documentFromDetail re-parses the GenBank so we get the FULL feature
      // list (strand / type / multi-segment locations), not the lossy summary.
      const refDoc = documentFromDetail(detail);
      const refFeatures: ReferenceFeature[] = refDoc.features.map((f) => ({
        name: f.name,
        type: f.type,
        strand: f.strand === -1 ? -1 : 1,
        start: f.start,
        end: f.end,
        segments:
          f.locations && f.locations.length > 1 ? f.locations : undefined,
        color: f.color,
        notes: f.notes,
      }));
      const res = annotateFromReference(request.openSeq, refDoc.seq, refFeatures);
      setResult(res);
      setRows(
        res.proposals.map((p) => ({
          proposal: p,
          // Pre-check everything that mapped (full or partial); leave unmapped
          // unchecked (and they will render disabled).
          selected: !p.unmapped,
        })),
      );
      setStage("review");
    } catch {
      setLibError("The transfer failed while aligning the sequences.");
    } finally {
      setRunning(false);
    }
  }, [request, refId]);

  const toggleRow = useCallback((i: number) => {
    setRows((prev) =>
      prev.map((r, idx) =>
        idx === i && !r.proposal.unmapped ? { ...r, selected: !r.selected } : r,
      ),
    );
  }, []);

  const mappable = rows.filter((r) => !r.proposal.unmapped);
  const allSelected = mappable.length > 0 && mappable.every((r) => r.selected);
  const toggleAll = useCallback(() => {
    setRows((prev) => {
      const next = !prev.filter((r) => !r.proposal.unmapped).every((r) => r.selected);
      return prev.map((r) =>
        r.proposal.unmapped ? r : { ...r, selected: next },
      );
    });
  }, []);

  // Count ONLY the rows that are both selected AND addable (mapped). Unmapped /
  // not-found rows render disabled and are never counted, so this number is the
  // exact set apply() will transfer — the footer "M of N selected" and the
  // "Add M features" button both read from it and can never diverge.
  const selectedCount = rows.filter((r) => r.selected && !r.proposal.unmapped).length;

  const apply = useCallback(() => {
    if (!request) return;
    const drafts: FeatureDraft[] = rows
      .filter((r) => r.selected && !r.proposal.unmapped)
      .map((r) => {
        const p = r.proposal;
        return {
          name: p.name,
          type: p.type || "misc_feature",
          strand: p.strand,
          start: p.start,
          end: p.end,
          color: p.color,
          segments: p.segments && p.segments.length > 1 ? p.segments : undefined,
        };
      });
    request.onApply(drafts);
  }, [request, rows]);

  if (!request) return null;

  return (
    <LivingPopup open onClose={request.onCancel} label="Annotate from reference" selfSize>
      <div className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface-raised ros-popup-card-shadow">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <TransferIcon className="h-4 w-4 shrink-0 text-sky-500" />
          <h2 className="text-title font-semibold text-foreground">
            Annotate from reference
          </h2>
          {stage === "review" && result && (
            <span className="ml-auto rounded-full bg-surface-sunken px-2 py-0.5 text-meta font-medium text-foreground-muted">
              {result.referenceOrientation === "reverse"
                ? "reverse strand"
                : "forward strand"}
              {" · "}
              {Math.round(result.overallIdentity * 100)}% overall
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {stage === "pick" ? (
            <PickStage
              library={library}
              libError={libError}
              refId={refId}
              onPick={(rec) => {
                setRefId(rec.id);
                setRefName(rec.display_name);
              }}
            />
          ) : (
            <ReviewStage
              refName={refName}
              rows={rows}
              allSelected={allSelected}
              onToggle={toggleRow}
              onToggleAll={toggleAll}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <p className="text-meta text-foreground-muted">
            {stage === "pick"
              ? "Features at least 70% identical over their aligned span are offered."
              : `${selectedCount} of ${mappable.length} mappable feature${
                  mappable.length === 1 ? "" : "s"
                } selected`}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {stage === "review" && (
              <button
                type="button"
                onClick={() => setStage("pick")}
                className="rounded-md px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={request.onCancel}
              className="rounded-md px-3 py-1.5 text-body font-medium text-foreground-muted hover:bg-surface-sunken"
            >
              Cancel
            </button>
            {stage === "pick" ? (
              <button
                type="button"
                disabled={refId == null || running}
                onClick={runTransfer}
                className="ros-btn-raise rounded-md bg-brand-action px-3 py-1.5 text-body font-medium text-white hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {running ? "Aligning…" : "Find features"}
              </button>
            ) : (
              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={apply}
                className="ros-btn-raise rounded-md bg-brand-action px-3 py-1.5 text-body font-medium text-white hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add {selectedCount} feature{selectedCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}

// --- PICK STAGE -------------------------------------------------------------

function PickStage({
  library,
  libError,
  refId,
  onPick,
}: {
  library: SequenceRecord[] | null;
  libError: string | null;
  refId: number | null;
  onPick: (rec: SequenceRecord) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-body text-foreground-muted">
        Pick a sequence whose features you want to carry over. ResearchOS aligns
        the open sequence to it (both strands) and proposes the features that map.
      </p>
      {libError ? (
        <p className="rounded-md border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/15 px-3 py-2 text-body text-rose-600 dark:text-rose-300">
          {libError}
        </p>
      ) : library == null ? (
        <p className="text-body text-foreground-muted">Loading library…</p>
      ) : library.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-body text-foreground-muted">
          No other sequences in your library to use as a reference.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {library.map((rec) => {
            const active = rec.id === refId;
            return (
              <li key={rec.id}>
                <button
                  type="button"
                  onClick={() => onPick(rec)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    active ? "bg-sky-50 dark:bg-sky-500/15" : "hover:bg-surface-sunken"
                  }`}
                >
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded-full border ${
                      active
                        ? "border-sky-500 bg-sky-500"
                        : "border-border bg-surface-raised"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-foreground">
                      {rec.display_name}
                    </span>
                    <span className="block text-meta text-foreground-muted">
                      {rec.length.toLocaleString()} bp ·{" "}
                      {rec.feature_count} feature
                      {rec.feature_count === 1 ? "" : "s"} ·{" "}
                      {rec.circular ? "circular" : "linear"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- REVIEW STAGE -----------------------------------------------------------

function ReviewStage({
  refName,
  rows,
  allSelected,
  onToggle,
  onToggleAll,
}: {
  refName: string;
  rows: ReviewRow[];
  allSelected: boolean;
  onToggle: (i: number) => void;
  onToggleAll: () => void;
}) {
  const mappableCount = rows.filter((r) => !r.proposal.unmapped).length;
  const unmappedCount = rows.length - mappableCount;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-body text-foreground-muted">
          Proposed from{" "}
          <span className="font-medium text-foreground">{refName}</span>
        </p>
        {mappableCount > 0 && (
          <button
            type="button"
            onClick={onToggleAll}
            className="ml-auto text-meta font-medium text-sky-600 dark:text-sky-300 hover:underline"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-body text-foreground-muted">
          The reference has no features to transfer.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {rows.map((row, i) => (
            <ProposalRow key={i} row={row} onToggle={() => onToggle(i)} />
          ))}
        </ul>
      )}

      {unmappedCount > 0 && (
        <p className="text-meta text-foreground-muted">
          {unmappedCount} reference feature{unmappedCount === 1 ? "" : "s"} did
          not map to this sequence and {unmappedCount === 1 ? "is" : "are"} shown
          dimmed (not transferred).
        </p>
      )}
    </div>
  );
}

function ProposalRow({
  row,
  onToggle,
}: {
  row: ReviewRow;
  onToggle: () => void;
}) {
  const p = row.proposal;
  const swatch = colorForType(p.type || "misc_feature");
  const pct = Math.round(p.identity * 100);
  const span =
    p.start === p.end ? "—" : `${(p.start + 1).toLocaleString()}..${p.end.toLocaleString()}`;
  return (
    <li>
      <label
        className={`flex items-center gap-3 px-3 py-2 ${
          p.unmapped ? "opacity-50" : "cursor-pointer hover:bg-surface-sunken"
        }`}
      >
        <input
          type="checkbox"
          checked={row.selected}
          disabled={p.unmapped}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 accent-sky-500"
        />
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-sm seq-swatch-border"
          style={{ backgroundColor: swatch }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-body font-medium text-foreground">
              {p.name}
            </span>
            <span className="shrink-0 text-meta text-foreground-muted">
              {p.type || "misc_feature"}
            </span>
            <span className="shrink-0 text-meta text-foreground-muted">
              {p.strand === -1 ? "(−)" : "(+)"}
            </span>
          </span>
          <span className="block text-meta text-foreground-muted">
            {p.unmapped ? "not found in this sequence" : `${span} · ${pct}% identity`}
          </span>
        </span>
        {!p.unmapped && p.partial && (
          <Tooltip label="Only part of this feature aligned; the mapped span is clipped to what matched.">
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-500/15 px-2 py-0.5 text-meta font-medium text-amber-700 dark:text-amber-300">
              <WarnIcon className="h-3 w-3" />
              partial
            </span>
          </Tooltip>
        )}
      </label>
    </li>
  );
}

// --- ICONS (inline SVG; no emoji / icon-font dependency) --------------------

function TransferIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h13" />
      <path d="m13 3 4 4-4 4" />
      <path d="M20 17H7" />
      <path d="m11 21-4-4 4-4" />
    </svg>
  );
}

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

// Keep DEFAULT_IDENTITY_THRESHOLD referenced so the help copy and the engine
// default stay in lockstep if either changes.
void DEFAULT_IDENTITY_THRESHOLD;
