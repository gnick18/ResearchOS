"use client";

// sequence editor master. protein DOMAIN ANNOTATION (three sources).
//
// Lives inside the CDS protein-properties drawer. The user clicks "Annotate
// domains" and picks a source:
//
//   - Common domains (on-device, zero setup). We host a curated CC0 Pfam subset
//     as a static asset; the browser downloads it ONCE (cancelable progress),
//     caches it durably, and runs the WASM HMMER engine against it on the user's
//     machine. Later annotations are instant from cache. Nothing of the user's
//     is sent (the database is a one-way static download), so there is NO consent
//     gate. This is the zero-setup on-device option for users with no local .hmm.
//
//   - EBI InterProScan (off-device, full Pfam). On first use we show a ONE-TIME
//     privacy notice (modeled on the NCBI Primer-BLAST handoff), persisted so it
//     is asked once. On confirm we submit the CDS's translated protein to EBI
//     (browser-direct, CORS-open), poll with a calm cancelable progress state,
//     parse the Pfam hits, and open the review list.
//
//   - Local database (on-device). The user picks their OWN Pfam / HMM `.hmm`
//     file via the File System Access API; we read its bytes and run hmmsearch
//     in a WebWorker entirely on their machine (the WASM engine + their database
//     + their protein all stay local). Nothing is sent anywhere, so there is NO
//     consent gate on this path.
//
// All three paths produce the SAME DomainHit[], so the Detect-Features-style
// review list, the accept toggles, and domainHitToFeature -> features are shared.
// The curated path reuses runLocalHmmer + parseDomtblout exactly like the local
// .hmm path; only the byte source differs (a cached download, not a file pick).
// The EBI and local-.hmm paths are unchanged.
//
// Icons inline SVG, <Tooltip> for icon-only controls, no emoji, no em-dashes, no
// mid-sentence colons. Type tokens (text-meta / text-body / text-title).

import { useCallback, useEffect, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
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
import { runLocalHmmer } from "@/lib/sequences/hmmer-client";
import { parseDomtblout } from "@/lib/sequences/hmmer-domtbl";
import {
  getCuratedDbManifest,
  getCuratedHmmDb,
  type CuratedDbManifest,
  type DownloadProgress,
} from "@/lib/sequences/hmmer-db-cache";

/** Soft warning threshold for a chosen .hmm. Full Pfam-A (~1.5 GB) is heavy in
 *  browser memory; we do not block, just warn that a curated subset is faster. */
const LARGE_HMM_WARN_BYTES = 300 * 1024 * 1024;

/** Minimal File System Access typings (the app targets Chromium only). */
interface FsaFileHandle {
  getFile: () => Promise<File>;
}
interface WindowWithFsaOpen extends Window {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FsaFileHandle[]>;
}

/** Build the single-record FASTA the worker searches (our translated CDS). */
function proteinToFasta(protein: string): string {
  const seq = (protein || "").replace(/\s+/g, "");
  return `>cds\n${seq}\n`;
}

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

/** Which database backed the current result set, for the review footer label. */
type Source = "ebi" | "local" | "curated";

type Phase =
  | { kind: "idle" }
  | { kind: "source" }
  | { kind: "curated" }
  | { kind: "local" }
  | { kind: "consent" }
  | { kind: "downloading"; progress: DownloadProgress }
  | { kind: "searching"; note: string }
  | { kind: "error"; message: string }
  | { kind: "results"; hits: DomainHit[]; rows: Row[]; source: Source };

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
  onCandidatesChange,
  onResults,
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
  /** LIVE PREVIEW: report the CURRENTLY-SELECTED review candidates (the in-review
   *  hits the user has checked) up to the drawer, so the protein domain bar can
   *  draw them pending before they are accepted. Empty when not in review. */
  onCandidatesChange?: (hits: DomainHit[]) => void;
  /**
   * Phase 5 (results as artifacts). Fired ONCE each time a domain scan COMPLETES
   * (a results phase is reached), carrying the full hit list + which database
   * backed it, so the editor can persist a domains artifact. Best-effort: the
   * panel never awaits it and a thrown handler is swallowed.
   */
  onResults?: (hits: DomainHit[], source: Source) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // The curated-subset manifest (family count etc.), fetched lazily when the user
  // opens the "Common domains" step so the card can show "44 common Pfam
  // families" without parsing the HMM. Null until loaded; a load failure just
  // leaves the count out of the copy (the source still works).
  const [curatedManifest, setCuratedManifest] = useState<CuratedDbManifest | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);

  // Surface the current review candidates (the SELECTED rows in the results
  // phase) to the drawer for the live bar preview. Any non-results phase reports
  // an empty list, so closing / accepting / cancelling clears the pending blocks.
  // Kept in an effect so it tracks every row toggle, not just the first render.
  useEffect(() => {
    if (!onCandidatesChange) return;
    const hits =
      phase.kind === "results"
        ? phase.rows.filter((r) => r.selected).map((r) => r.hit)
        : [];
    onCandidatesChange(hits);
  }, [phase, onCandidatesChange]);

  // On unmount (drawer closed / feature changed -> panel remounts), clear any
  // pending preview so it does not leak onto the next CDS's bar.
  useEffect(() => {
    return () => {
      onCandidatesChange?.([]);
    };
    // Run only on unmount; onCandidatesChange identity is stable from the drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 5 (results as artifacts). Fire onResults ONCE when a scan completes (a
  // results phase is reached), so the editor can save a domains artifact. A ref
  // dedupes re-renders of the same results phase (row toggles re-render but must
  // not re-fire). Best-effort: a thrown handler never breaks the scan.
  const lastResultsTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase.kind !== "results") {
      lastResultsTokenRef.current = null;
      return;
    }
    const token = `${phase.source}:${phase.hits.length}:${phase.hits
      .map((h) => `${h.accession}@${h.start}-${h.end}`)
      .join(",")}`;
    if (lastResultsTokenRef.current === token) return;
    lastResultsTokenRef.current = token;
    try {
      onResults?.(phase.hits, phase.source);
    } catch {
      // best-effort: never let a save side effect break the scan UI.
    }
  }, [phase, onResults]);

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
      setPhase({ kind: "results", hits, rows, source: "ebi" });
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

  // Map a fresh DomainHit[] into review rows on this CDS (shared by both paths).
  const hitsToRows = useCallback(
    (hits: DomainHit[]): Row[] =>
      hits
        .map((hit) => {
          const draft = domainHitToFeature(hit, feature, seqLength);
          return draft ? { hit, draft, selected: true } : null;
        })
        .filter((r): r is Row => r !== null),
    [feature, seqLength],
  );

  // The LOCAL on-device path: pick a .hmm via the File System Access API, read
  // its bytes, and run hmmsearch in the WebWorker against OUR translated protein.
  // Nothing leaves the machine, so there is no consent gate here.
  const runLocal = useCallback(async () => {
    const win = window as WindowWithFsaOpen;
    if (typeof win.showOpenFilePicker !== "function") {
      setPhase({
        kind: "error",
        message:
          "This browser cannot open local files. Use Chrome or Edge for on-device databases.",
      });
      return;
    }

    let file: File;
    try {
      const [handle] = await win.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: false,
        types: [
          {
            description: "HMMER profile database",
            accept: { "application/octet-stream": [".hmm"] },
          },
        ],
      });
      if (!handle) return; // picker cancelled
      file = await handle.getFile();
    } catch (e) {
      // AbortError is the user dismissing the picker; return to the source step.
      if ((e as Error)?.name === "AbortError") {
        setPhase({ kind: "local" });
        return;
      }
      setPhase({
        kind: "error",
        message: "Could not open that file. Try choosing the .hmm again.",
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const big = file.size > LARGE_HMM_WARN_BYTES;
    setPhase({
      kind: "searching",
      note: big
        ? "Reading a large database. This runs entirely on your computer; a curated subset is faster."
        : "Running on your computer…",
    });

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (controller.signal.aborted) return;
      const domtblout = await runLocalHmmer(bytes, proteinToFasta(protein), {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const hits = parseDomtblout(domtblout);
      const rows = hitsToRows(hits);
      setPhase({ kind: "results", hits, rows, source: "local" });
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || controller.signal.aborted) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({
        kind: "error",
        message:
          (e as Error)?.message || "The on-device domain search did not complete.",
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [protein, hitsToRows]);

  // The CURATED on-device path: get the hosted subset bytes (cached after the
  // one-time download), then run hmmsearch in the WebWorker against OUR translated
  // protein exactly like the local-.hmm path. The only difference from runLocal is
  // the byte source (a cached static download, not a File System Access pick), so
  // everything downstream (parse -> rows -> review -> features) is identical.
  // Nothing of the user's is sent, so there is no consent gate.
  const runCurated = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    // Start in the download state; if the database is already cached the getter
    // returns instantly without ever calling onProgress, so we move straight on.
    setPhase({ kind: "downloading", progress: { receivedBytes: 0 } });

    try {
      const bytes = await getCuratedHmmDb({
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setPhase({ kind: "downloading", progress });
        },
      });
      if (controller.signal.aborted) return;
      setPhase({ kind: "searching", note: "Running on your computer…" });
      const domtblout = await runLocalHmmer(bytes, proteinToFasta(protein), {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const hits = parseDomtblout(domtblout);
      const rows = hitsToRows(hits);
      setPhase({ kind: "results", hits, rows, source: "curated" });
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || controller.signal.aborted) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({
        kind: "error",
        message:
          (e as Error)?.message || "The on-device domain search did not complete.",
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [protein, hitsToRows]);

  // The "Annotate domains" click opens the source picker (curated / EBI / local).
  const onClickAnnotate = useCallback(() => {
    setPhase({ kind: "source" });
  }, []);

  // Opening the curated step lazily loads the manifest (family count) once.
  const onChooseCurated = useCallback(() => {
    setPhase({ kind: "curated" });
    if (curatedManifest === null) {
      void getCuratedDbManifest()
        .then((m) => setCuratedManifest(m))
        .catch(() => {
          // A manifest miss only costs the count in the copy, not the feature.
        });
    }
  }, [curatedManifest]);

  // From the source picker, the EBI choice gates on the one-time consent.
  const onChooseEbi = useCallback(() => {
    if (hasDomainConsent()) {
      void run();
    } else {
      setPhase({ kind: "consent" });
    }
  }, [run]);

  const onChooseLocal = useCallback(() => {
    setPhase({ kind: "local" });
  }, []);

  const onConfirmConsent = useCallback(() => {
    rememberDomainConsent();
    void run();
  }, [run]);

  const onCancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase({ kind: "idle" });
  }, []);

  // Escape collapses any open step (source picker / local / consent / searching
  // / results / error) back to the idle trigger, aborting an in-flight run.
  useEscapeToClose(onCancel, phase.kind !== "idle");

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
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/15 px-3 py-1.5 text-body font-medium text-sky-700 dark:text-sky-300 transition-colors hover:bg-sky-100 dark:hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-sunken disabled:text-foreground-muted"
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

  // --- SOURCE: pick where the domain database lives -----------------------
  if (phase.kind === "source") {
    return (
      <div className="rounded-md border border-border bg-surface-raised">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <DomainIcon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="text-meta font-semibold text-foreground">
            Choose a domain database
          </span>
        </div>
        <div className="flex flex-col gap-2 p-2.5">
          <button
            type="button"
            onClick={onChooseCurated}
            className="flex items-start gap-2 rounded-md border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/15 px-3 py-2 text-left transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
          >
            <IconDownload className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
            <span className="min-w-0">
              <span className="block text-body font-medium text-indigo-800 dark:text-indigo-300">
                Common domains (on your computer, downloads once)
              </span>
              <span className="block text-meta text-indigo-700 dark:text-indigo-300">
                A curated set of common Pfam domains. Runs entirely on your
                computer; downloads once, then works offline.
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onChooseLocal}
            className="flex items-start gap-2 rounded-md border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 px-3 py-2 text-left transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
          >
            <IconLaptop className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
            <span className="min-w-0">
              <span className="block text-body font-medium text-emerald-800 dark:text-emerald-300">
                Local database (.hmm, on your machine)
              </span>
              <span className="block text-meta text-emerald-700 dark:text-emerald-300">
                Runs entirely on your computer. Your sequence and your database
                never leave your machine.
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onChooseEbi}
            className="flex items-start gap-2 rounded-md border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/15 px-3 py-2 text-left transition-colors hover:bg-sky-100 dark:hover:bg-sky-500/20"
          >
            <IconGlobe className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
            <span className="min-w-0">
              <span className="block text-body font-medium text-sky-800 dark:text-sky-300">
                EBI InterProScan (full Pfam, online)
              </span>
              <span className="block text-meta text-sky-700 dark:text-sky-300">
                Submits this protein to EBI for the full Pfam library. Leaves
                your machine; you confirm first.
              </span>
            </span>
          </button>
        </div>
        <div className="flex items-center border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded-md px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // --- CURATED: the zero-setup hosted subset (downloads once) -------------
  if (phase.kind === "curated") {
    const familyCount = curatedManifest?.families;
    return (
      <div className="rounded-md border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/15 px-3 py-2.5 text-meta text-indigo-800 dark:text-indigo-300">
        <p className="flex items-start gap-1.5 font-medium">
          <IconDownload className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Search this protein against a curated set of common Pfam domains.
        </p>
        <p className="mt-1 text-indigo-700 dark:text-indigo-300">
          A curated set of common Pfam domains. Runs entirely on your computer;
          downloads once, then works offline. The database is about 3 MB; the
          first run downloads it, later runs are instant.
          {familyCount
            ? ` This set has ${familyCount} common Pfam families.`
            : ""}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void runCurated()}
            className="inline-flex items-center gap-1 rounded-md bg-brand-action px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-brand-action/90"
          >
            <IconDownload className="h-3.5 w-3.5" />
            Annotate domains
          </button>
          <button
            type="button"
            onClick={() => setPhase({ kind: "source" })}
            className="rounded-md px-2.5 py-1 text-meta font-medium text-indigo-700 dark:text-indigo-300 transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // --- LOCAL: pick a .hmm and run on-device -------------------------------
  if (phase.kind === "local") {
    return (
      <div className="rounded-md border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 px-3 py-2.5 text-meta text-emerald-800 dark:text-emerald-300">
        <p className="flex items-start gap-1.5 font-medium">
          <IconLaptop className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Search this protein against your own HMM database, on your computer.
        </p>
        <p className="mt-1 text-emerald-700 dark:text-emerald-300">
          Runs entirely on your computer. Your sequence and your database never
          leave your machine. Choose a Pfam or HMMER .hmm file to search
          against. Large databases run slower in the browser; a curated subset
          is faster.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void runLocal()}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <IconFolderOpen className="h-3.5 w-3.5" />
            Choose HMM database
          </button>
          <button
            type="button"
            onClick={() => setPhase({ kind: "source" })}
            className="rounded-md px-2.5 py-1 text-meta font-medium text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // --- CONSENT: the one-time privacy notice -------------------------------
  if (phase.kind === "consent") {
    return (
      <div className="rounded-md border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/15 px-3 py-2.5 text-meta text-sky-800 dark:text-sky-300">
        <p className="flex items-start gap-1.5 font-medium">
          <IconGlobe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This sends the translated protein of this CDS to EBI InterProScan to
          find domains.
        </p>
        <p className="mt-1 text-sky-700 dark:text-sky-300">
          Your sequence file and your other data stay on your machine. Only this
          protein is submitted. Domains found are added as features you review
          first.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onConfirmConsent}
            className="inline-flex items-center gap-1 rounded-md bg-brand-action px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-brand-action/90"
          >
            <IconGlobe className="h-3.5 w-3.5" />
            Search domains
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-meta font-medium text-sky-700 dark:text-sky-300 transition-colors hover:bg-sky-100 dark:hover:bg-sky-500/20"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // --- DOWNLOADING: the one-time curated-database download ----------------
  if (phase.kind === "downloading") {
    const { receivedBytes, totalBytes } = phase.progress;
    const pct =
      totalBytes && totalBytes > 0
        ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
        : null;
    return (
      <div className="rounded-md border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/15 px-3 py-2.5 text-meta text-indigo-700 dark:text-indigo-300">
        <p className="flex items-center gap-2 font-medium text-indigo-800 dark:text-indigo-300">
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          Downloading the common-domain database (~3 MB), one time…
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-500/15">
          <div
            className="h-full rounded-full bg-indigo-500 transition-[width]"
            style={{ width: pct !== null ? `${pct}%` : "33%" }}
          />
        </div>
        <p className="mt-1 text-indigo-600 dark:text-indigo-300 tabular-nums">
          {pct !== null
            ? `${pct}% downloaded. Later annotations are instant.`
            : "Downloading. Later annotations are instant."}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 rounded-md px-2.5 py-1 text-meta font-medium text-indigo-700 dark:text-indigo-300 transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-500/20"
        >
          Cancel
        </button>
      </div>
    );
  }

  // --- SEARCHING: calm progress + cancel ----------------------------------
  if (phase.kind === "searching") {
    return (
      <div className="rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-meta text-foreground-muted">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          {phase.note}
        </p>
        <p className="mt-1 text-foreground-muted">
          InterProScan jobs take about 30 seconds to a few minutes. You can keep
          working; this runs in the background.
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 rounded-md px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
        >
          Cancel
        </button>
      </div>
    );
  }

  // --- ERROR: message + retry ---------------------------------------------
  if (phase.kind === "error") {
    return (
      <div className="rounded-md border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/15 px-3 py-2.5 text-meta text-rose-700 dark:text-rose-300">
        <p className="font-medium">Domain search did not finish.</p>
        <p className="mt-1 text-rose-600 dark:text-rose-300">{phase.message}</p>
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
            className="rounded-md px-2.5 py-1 text-meta font-medium text-rose-700 dark:text-rose-300 transition-colors hover:bg-rose-100 dark:hover:bg-rose-500/20"
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
    <div className="rounded-md border border-border bg-surface-raised">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <DomainIcon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
        <span className="text-meta font-semibold text-foreground">
          Domains found
        </span>
        <span className="ml-auto rounded-full bg-surface-sunken px-2 py-0.5 text-meta font-medium text-foreground-muted">
          {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-center text-meta text-foreground-muted">
          No domains were found in this protein.
        </p>
      ) : (
        <ul className="max-h-48 divide-y divide-border overflow-y-auto">
          {rows.map((row, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-surface-sunken">
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={() => toggleRow(i)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-500"
                />
                <span
                  className="mt-0.5 h-3 w-3 shrink-0 rounded-sm seq-swatch-border"
                  style={{ backgroundColor: swatch }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-body font-medium text-foreground">
                      {row.hit.name}
                    </span>
                    <span className="shrink-0 text-meta text-foreground-muted">
                      {row.hit.db} {row.hit.accession}
                    </span>
                  </span>
                  {row.hit.description ? (
                    <span className="block truncate text-meta text-foreground-muted">
                      {row.hit.description}
                    </span>
                  ) : null}
                  <span className="block text-meta text-foreground-muted tabular-nums">
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
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className="text-meta text-foreground-muted">
          {phase.source === "local"
            ? "on your computer, your database"
            : phase.source === "curated"
              ? "on your computer, common domains"
              : "via EBI InterProScan"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={applyAccepted}
            className="rounded-md bg-brand-action px-2.5 py-1 text-meta font-medium text-white transition-colors hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-40"
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

function IconLaptop({ className }: { className?: string }) {
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
      <rect x="3" y="5" width="18" height="11" rx="1.5" />
      <path d="M2 20h20" />
    </svg>
  );
}

function IconDownload({ className }: { className?: string }) {
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
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function IconFolderOpen({ className }: { className?: string }) {
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
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" />
      <path d="M3 9h17l-2 9a1 1 0 0 1-1 .8H4a1 1 0 0 1-1-1V9Z" />
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
