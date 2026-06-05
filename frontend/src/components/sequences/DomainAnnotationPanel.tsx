"use client";

// sequence editor master. OPT-IN protein DOMAIN ANNOTATION (EBI InterProScan).
//
// Lives inside the CDS protein-properties drawer. The user clicks "Annotate
// domains"; on first use we show a ONE-TIME privacy notice (modeled on the NCBI
// Primer-BLAST handoff), persisted so it is asked once. On confirm we submit the
// CDS's translated protein to EBI InterProScan (browser-direct, CORS-open), poll
// with a calm cancelable progress state, parse the Pfam hits, and open a
// Detect-Features-style review list. Accepted hits are mapped back to DNA
// coordinates on the CDS and added as features in ONE undoable edit.
//
// PRIVACY. The ONLY thing sent off the machine is the single translated protein.
// No DNA, no file name, no user email (a fixed app-level address tracks the job).
//
// Icons inline SVG, <Tooltip> for icon-only controls, no emoji, no em-dashes, no
// mid-sentence colons. Type tokens (text-meta / text-body / text-title).

import { useCallback, useEffect, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { colorForType } from "@/lib/sequences/feature-colors";
import type { EditFeature } from "@/lib/sequences/edit-model";
import type { FeatureDraft } from "@/lib/sequences/feature-edit";
import {
  domainHitToFeature,
  DOMAIN_FEATURE_TYPE,
} from "@/lib/sequences/domain-features";
import {
  fetchInterProScanResult,
  parseInterProScanResult,
  submitInterProScan,
  waitForInterProScan,
  type DomainHit,
} from "@/lib/sequences/interproscan";

/** Persisted, once-asked consent for the external InterProScan submission. */
export const DOMAIN_CONSENT_KEY = "researchos:sequences:domain-annotation-consent";

function hasDomainConsent(): boolean {
  try {
    return typeof window !== "undefined" &&
      window.localStorage.getItem(DOMAIN_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}
function rememberDomainConsent(): void {
  try {
    window.localStorage.setItem(DOMAIN_CONSENT_KEY, "1");
  } catch {
    // Private mode / blocked storage: consent is then re-asked next time, which
    // is the safe direction for an external-submit gate.
  }
}

type Phase =
  | { kind: "idle" }
  | { kind: "consent" }
  | { kind: "searching"; note: string }
  | { kind: "error"; message: string }
  | { kind: "results"; hits: DomainHit[]; rows: Row[] };

interface Row {
  hit: DomainHit;
  draft: FeatureDraft;
  selected: boolean;
}

export default function DomainAnnotationPanel({
  feature,
  protein,
  seqLength,
  disabled,
  disabledReason,
  onAddDomains,
}: {
  /** The selected CDS feature (for strand + exon joins). */
  feature: EditFeature;
  /** Its translated protein (trailing stop already trimmed by the drawer). */
  protein: string;
  /** The molecule length, for clamping mapped spans. */
  seqLength: number;
  /** Disable the action (empty / not-a-clean-ORF translation). */
  disabled: boolean;
  /** Tooltip explaining why the action is disabled. */
  disabledReason?: string;
  /** Apply accepted domains as features in one undoable edit. */
  onAddDomains: (drafts: FeatureDraft[]) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight job when the panel unmounts (drawer closed). The PANEL
  // IS KEYED BY THE SELECTED FEATURE in the drawer, so a feature change remounts
  // it fresh (idle phase, new abort controller) rather than leaking a stale
  // result list across features; no reset effect is needed.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const run = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "searching", note: "Submitting to EBI InterProScan…" });
    try {
      const jobId = await submitInterProScan(protein, { signal: controller.signal });
      await waitForInterProScan(jobId, {
        signal: controller.signal,
        onStatus: (status) => {
          if (status === "FINISHED") return;
          setPhase({ kind: "searching", note: "Searching domains at EBI…" });
        },
      });
      const raw = await fetchInterProScanResult(jobId, controller.signal);
      const hits = parseInterProScanResult(raw);
      const rows: Row[] = hits
        .map((hit) => {
          const draft = domainHitToFeature(hit, feature, seqLength);
          return draft ? { hit, draft, selected: true } : null;
        })
        .filter((r): r is Row => r !== null);
      if (controller.signal.aborted) return;
      setPhase({ kind: "results", hits, rows });
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || controller.signal.aborted) {
        // User cancelled: return to idle quietly.
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({
        kind: "error",
        message: (e as Error)?.message || "The domain search did not complete.",
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [protein, feature, seqLength]);

  // The "Annotate domains" click: gate on the one-time consent.
  const onClickAnnotate = useCallback(() => {
    if (hasDomainConsent()) {
      void run();
    } else {
      setPhase({ kind: "consent" });
    }
  }, [run]);

  const onConfirmConsent = useCallback(() => {
    rememberDomainConsent();
    void run();
  }, [run]);

  const onCancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase({ kind: "idle" });
  }, []);

  const toggleRow = useCallback((i: number) => {
    setPhase((p) =>
      p.kind === "results"
        ? {
            ...p,
            rows: p.rows.map((r, idx) =>
              idx === i ? { ...r, selected: !r.selected } : r,
            ),
          }
        : p,
    );
  }, []);

  const applyAccepted = useCallback(() => {
    if (phase.kind !== "results") return;
    const drafts = phase.rows.filter((r) => r.selected).map((r) => r.draft);
    if (drafts.length > 0) onAddDomains(drafts);
    setPhase({ kind: "idle" });
  }, [phase, onAddDomains]);

  const swatch = colorForType(DOMAIN_FEATURE_TYPE);

  // --- IDLE: the trigger button -------------------------------------------
  if (phase.kind === "idle") {
    const button = (
      <button
        type="button"
        onClick={onClickAnnotate}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-body font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
      >
        <DomainIcon className="h-4 w-4" />
        Annotate domains
      </button>
    );
    return disabled && disabledReason ? (
      <Tooltip label={disabledReason}>
        <span className="block">{button}</span>
      </Tooltip>
    ) : (
      button
    );
  }

  // --- CONSENT: the one-time privacy notice -------------------------------
  if (phase.kind === "consent") {
    return (
      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-meta text-sky-800">
        <p className="flex items-start gap-1.5 font-medium">
          <IconGlobe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This sends the translated protein of this CDS to EBI InterProScan to
          find domains.
        </p>
        <p className="mt-1 text-sky-700">
          Your sequence file and your other data stay on your machine. Only this
          protein is submitted. Domains found are added as features you review
          first.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onConfirmConsent}
            className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-sky-700"
          >
            <IconGlobe className="h-3.5 w-3.5" />
            Search domains
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-meta font-medium text-sky-700 transition-colors hover:bg-sky-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // --- SEARCHING: calm progress + cancel ----------------------------------
  if (phase.kind === "searching") {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 text-meta text-gray-600">
        <p className="flex items-center gap-2 font-medium text-gray-700">
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          {phase.note}
        </p>
        <p className="mt-1 text-gray-500">
          InterProScan jobs take about 30 seconds to a few minutes. You can keep
          working; this runs in the background.
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 rounded-md px-2.5 py-1 text-meta font-medium text-gray-600 transition-colors hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    );
  }

  // --- ERROR: message + retry ---------------------------------------------
  if (phase.kind === "error") {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-meta text-rose-700">
        <p className="font-medium">Domain search did not finish.</p>
        <p className="mt-1 text-rose-600">{phase.message}</p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            className="rounded-md bg-rose-600 px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-rose-700"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-meta font-medium text-rose-700 transition-colors hover:bg-rose-100"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // --- RESULTS: Detect-Features-style review list -------------------------
  const rows = phase.rows;
  const selectedCount = rows.filter((r) => r.selected).length;
  return (
    <div className="rounded-md border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <DomainIcon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
        <span className="text-meta font-semibold text-gray-700">
          Domains found
        </span>
        <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-meta font-medium text-gray-500">
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-center text-meta text-gray-400">
          No domains were found in this protein.
        </p>
      ) : (
        <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto">
          {rows.map((row, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={() => toggleRow(i)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-500"
                />
                <span
                  className="mt-0.5 h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/10"
                  style={{ backgroundColor: swatch }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-body font-medium text-gray-800">
                      {row.hit.name}
                    </span>
                    <span className="shrink-0 text-meta text-gray-400">
                      {row.hit.db} {row.hit.accession}
                    </span>
                  </span>
                  {row.hit.description ? (
                    <span className="block truncate text-meta text-gray-500">
                      {row.hit.description}
                    </span>
                  ) : null}
                  <span className="block text-meta text-gray-400 tabular-nums">
                    residues {row.hit.start}..{row.hit.end}
                    {row.hit.evalue !== undefined
                      ? ` · E ${row.hit.evalue.toExponential(1)}`
                      : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 border-t border-gray-100 px-3 py-2">
        <span className="text-meta text-gray-400">via EBI InterProScan</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-meta font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={applyAccepted}
            className="rounded-md bg-indigo-500 px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add {selectedCount > 0 ? selectedCount : ""} domain
            {selectedCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- ICONS (inline SVG; no emoji / icon-font dependency) --------------------

function DomainIcon({ className }: { className?: string }) {
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
      <rect x="3" y="9" width="18" height="6" rx="2" />
      <path d="M8 9V7" />
      <path d="M16 15v2" />
      <path d="M12 9V5" />
    </svg>
  );
}

function IconGlobe({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`${className ?? ""} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
