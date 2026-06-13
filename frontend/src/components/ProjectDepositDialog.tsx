"use client";

/**
 * ProjectDepositDialog - PROJECT-LEVEL guided repository deposit
 * (deposit-widening bot, 2026-05-29). Widens the single-experiment guided
 * deposit (DepositDialog) to a PROJECT, which maps to ONE dataset / one DOI.
 *
 * Three steps:
 *   1. SELECT    - multi-select which experiments AND notes from this project
 *                  go into the deposit, plus the per-item presentation format.
 *   2. METADATA  - a DataCite-mapped form titled from the PROJECT, with
 *                  multi-funder prefill (primary grant + derived charged
 *                  grants) and the owner's ORCID. License is required.
 *   3. HANDOFF   - pick a repository, build the bundle (each item exported
 *                  individually + the combined mega-PDF + raw + datacite.json),
 *                  download it, and open the repository's own upload page.
 *
 * GUIDED only: NO API calls, NO credentials, NO DOI minted here, NO new
 * on-disk data-shape. The bundle is downloadable; nothing is written into the
 * user's data folder. The repository mints the DOI.
 *
 * Conventions: no em-dashes, no emojis, custom inline SVG icons only, Tooltip
 * for icon-only affordances (never native title=). Reuses the existing deposit
 * modules (datacite, bundle, repositories) and the export pipeline.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import type { Project, Task, Note } from "@/lib/types";
import {
  isValidOrcid,
  normalizeOrcid,
  orcidRecordUrl,
} from "@/lib/metadata/orcid";
import {
  buildProjectDepositMetadata,
  inspectDepositMetadata,
  LICENSE_OPTIONS,
  type DepositMetadata,
} from "@/lib/deposit/datacite";
import {
  loadProjectDepositPrefill,
  combinedFundingAccounts,
  type ProjectDepositPrefill,
} from "@/lib/deposit/project-prefill";
import {
  buildProjectDepositBundle,
  downloadBlob,
  type DepositBundleResult,
  type ProjectDepositExperiment,
  type ProjectDepositNote,
} from "@/lib/deposit/bundle";
import {
  REPOSITORIES,
  findRepository,
  type RepositoryId,
} from "@/lib/deposit/repositories";
import { buildExperimentPayload } from "@/lib/export/extract";
import { projectsApi, methodsApi, filesApi } from "@/lib/local-api";
import type { ExportFormat } from "@/lib/export/types";

type Step = "select" | "metadata" | "handoff";

const OTHER_LICENSE_CHOICE = "__other__";

interface ProjectDepositDialogProps {
  isOpen: boolean;
  project: Project;
  currentUser: string | null;
  // When the viewer is an edit-permission receiver of a shared project, every
  // read routes into the owner's directory. Own / view-only projects pass
  // undefined.
  ownerHint?: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Inline SVG icons (no emoji, no icon library)
// ---------------------------------------------------------------------------

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Step rail
// ---------------------------------------------------------------------------

const STEP_ORDER: Step[] = ["select", "metadata", "handoff"];
const STEP_LABELS: Record<Step, string> = {
  select: "Select",
  metadata: "Metadata",
  handoff: "Hand off",
};

function StepRail({ step }: { step: Step }) {
  const activeIndex = STEP_ORDER.indexOf(step);
  return (
    <div className="flex items-center gap-2" aria-label="Deposit steps">
      {STEP_ORDER.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 text-meta font-medium ${
                active ? "text-blue-700 dark:text-blue-300" : done ? "text-foreground-muted" : "text-foreground-muted"
              }`}
            >
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-meta ${
                  active
                    ? "bg-brand-action text-white"
                    : done
                      ? "bg-green-500 text-white"
                      : "bg-surface-sunken text-foreground-muted"
                }`}
              >
                {done ? <CheckIcon /> : i + 1}
              </span>
              {STEP_LABELS[s]}
            </div>
            {i < STEP_ORDER.length - 1 ? (
              <span className="w-6 h-px bg-surface-sunken" aria-hidden />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

export default function ProjectDepositDialog({
  isOpen,
  project,
  currentUser,
  ownerHint,
  onClose,
}: ProjectDepositDialogProps) {
  const [step, setStep] = useState<Step>("select");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<ProjectDepositPrefill | null>(null);

  // Selection state: which experiment / note ids are checked.
  const [selectedExpIds, setSelectedExpIds] = useState<Set<number>>(new Set());
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<number>>(new Set());
  const [bundleFormat, setBundleFormat] = useState<ExportFormat>("html");

  // Metadata state (user-editable).
  const [abstract, setAbstract] = useState("");
  const [orcidDraft, setOrcidDraft] = useState("");
  const [licenseChoice, setLicenseChoice] = useState<string>("");
  const [licenseCustom, setLicenseCustom] = useState("");
  const [publicationDate, setPublicationDate] = useState("");

  // Handoff state.
  const [repoId, setRepoId] = useState<RepositoryId>("zenodo");
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState<DepositBundleResult | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Synchronous open-reset keyed on (isOpen, project.id), the same render-time
  // reset pattern DepositDialog / ExportFormatDialog use to avoid the
  // set-state-in-effect lint while still wiping stale state on open.
  const openKey = isOpen ? `open:${project.id}` : "closed";
  const [prevOpenKey, setPrevOpenKey] = useState(openKey);
  if (prevOpenKey !== openKey) {
    setPrevOpenKey(openKey);
    setStep("select");
    setLoadError(null);
    setBuilt(null);
    setBuildError(null);
    setCopied(false);
    setLoading(isOpen);
    setPrefill(null);
    setSelectedExpIds(new Set());
    setSelectedNoteIds(new Set());
  }

  // Load the project prefill once per open.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    loadProjectDepositPrefill(project, currentUser, ownerHint)
      .then((p) => {
        if (cancelled) return;
        setPrefill(p);
        // Default selection: every experiment in the project, no notes (the
        // user opts notes in explicitly since they are not project-scoped).
        setSelectedExpIds(new Set(p.experiments.map((e) => e.id)));
        setSelectedNoteIds(new Set());
        setBundleFormat("html");
        setAbstract("");
        setOrcidDraft(p.ownerOrcid ?? "");
        setLicenseChoice("");
        setLicenseCustom("");
        setPublicationDate(p.defaultPublicationDate);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Could not load this project.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, project, currentUser, ownerHint]);

  // Scrim click / Escape / the corner X all route through LivingPopup, but never
  // mid-build (matches the old guarded backdrop + Escape behavior).
  const handleClose = () => {
    if (!building) onClose();
  };

  const isOtherLicense = licenseChoice === OTHER_LICENSE_CHOICE;
  const licenseSpdxId = isOtherLicense ? null : licenseChoice || null;
  const licenseCustomName = isOtherLicense ? licenseCustom || null : null;

  // The combined funder set (primary first, then derived charged grants).
  const funders = useMemo(
    () => (prefill ? combinedFundingAccounts(prefill) : []),
    [prefill],
  );

  // The live project-level DataCite metadata from the current form state.
  const metadata: DepositMetadata | null = useMemo(() => {
    if (!prefill) return null;
    return buildProjectDepositMetadata({
      project: prefill.project,
      ownerDisplayName: prefill.ownerDisplayName,
      ownerOrcid: orcidDraft || null,
      fundingAccount: prefill.primaryFundingAccount,
      additionalFundingAccounts: prefill.chargedGrants.accounts,
      abstract,
      licenseSpdxId,
      licenseCustomName,
      publicationDate: publicationDate || null,
    });
  }, [prefill, orcidDraft, abstract, licenseSpdxId, licenseCustomName, publicationDate]);

  const issues = useMemo(
    () => (metadata ? inspectDepositMetadata(metadata, orcidDraft) : null),
    [metadata, orcidDraft],
  );

  const handoffReady = !!issues && !issues.licenseMissing;
  const selectionCount = selectedExpIds.size + selectedNoteIds.size;
  const hasSelection = selectionCount > 0;

  const toggleExp = useCallback((id: number) => {
    setSelectedExpIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleNote = useCallback((id: number) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBuild = useCallback(async () => {
    if (!prefill || !metadata) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const selectedExperiments = prefill.experiments.filter((e) =>
        selectedExpIds.has(e.id),
      );
      const selectedNotes = prefill.notes.filter((n) =>
        selectedNoteIds.has(n.id),
      );

      // Build each selected experiment's export payload once (the individual
      // export + the combined PDF share these so we read disk once per item).
      const deps = { projectsApi, methodsApi, filesApi };
      const experiments: ProjectDepositExperiment[] = await Promise.all(
        selectedExperiments.map(async (task: Task) => ({
          id: task.id,
          payload: await buildExperimentPayload(task, currentUser, deps),
        })),
      );
      const notes: ProjectDepositNote[] = selectedNotes.map((n: Note) => ({
        id: n.id,
        note: n,
      }));

      const result = await buildProjectDepositBundle({
        title: prefill.project.name,
        experiments,
        notes,
        format: bundleFormat,
        metadata,
        currentUser,
      });
      setBuilt(result);
      downloadBlob(result.blob, result.filename);
    } catch (err) {
      setBuildError(
        err instanceof Error ? err.message : "Could not build the bundle.",
      );
    } finally {
      setBuilding(false);
    }
  }, [prefill, metadata, selectedExpIds, selectedNoteIds, bundleFormat, currentUser]);

  const handleCopyMetadata = useCallback(async () => {
    if (!built) return;
    try {
      await navigator.clipboard.writeText(built.metadataJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be denied; the metadata is also visible in the panel.
    }
  }, [built]);

  if (!isOpen) return null;

  const repo = findRepository(repoId);

  return (
    <LivingPopup
      open
      onClose={handleClose}
      label="Deposit to a repository"
      selfSize
      showClose={false}
      closeOnScrimClick={!building}
    >
      <div
        data-testid="project-deposit-dialog"
        className="pointer-events-auto bg-surface-raised rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-title font-semibold text-foreground line-clamp-2">
                Deposit to a repository
              </h2>
              <p className="text-meta text-foreground-muted mt-1 line-clamp-1">
                {project.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => !building && onClose()}
              aria-label="Close"
              className="text-foreground-muted hover:text-foreground-muted p-1 -mr-1"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="mt-3">
            <StepRail step={step} />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-body text-foreground-muted py-8 justify-center">
              <Spinner />
              Reading the project...
            </div>
          ) : loadError ? (
            <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-body text-red-800 dark:text-red-300">
              {loadError}
            </div>
          ) : step === "select" && prefill ? (
            <SelectStep
              prefill={prefill}
              selectedExpIds={selectedExpIds}
              selectedNoteIds={selectedNoteIds}
              toggleExp={toggleExp}
              toggleNote={toggleNote}
              bundleFormat={bundleFormat}
              setBundleFormat={setBundleFormat}
            />
          ) : step === "metadata" && prefill && metadata && issues ? (
            <MetadataStep
              prefill={prefill}
              metadata={metadata}
              funders={funders}
              issues={issues}
              abstract={abstract}
              setAbstract={setAbstract}
              orcidDraft={orcidDraft}
              setOrcidDraft={setOrcidDraft}
              licenseChoice={licenseChoice}
              setLicenseChoice={setLicenseChoice}
              licenseCustom={licenseCustom}
              setLicenseCustom={setLicenseCustom}
              publicationDate={publicationDate}
              setPublicationDate={setPublicationDate}
            />
          ) : step === "handoff" && built === null ? (
            <HandoffPickStep repoId={repoId} setRepoId={setRepoId} />
          ) : step === "handoff" && built ? (
            <HandoffDownloadStep
              repoId={repoId}
              built={built}
              copied={copied}
              onCopy={handleCopyMetadata}
            />
          ) : null}
          {buildError ? (
            <div className="mt-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-body text-red-800 dark:text-red-300">
              {buildError}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (step === "metadata") setStep("select");
              else if (step === "handoff" && built === null) setStep("metadata");
              else if (step === "handoff" && built) {
                setBuilt(null);
                setStep("handoff");
              } else onClose();
            }}
            disabled={building}
            className="px-3 py-1.5 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg disabled:opacity-50"
          >
            {step === "select" ? "Cancel" : built ? "Build again" : "Back"}
          </button>

          <div className="flex items-center gap-2">
            {step === "select" ? (
              <button
                type="button"
                disabled={loading || !hasSelection}
                onClick={() => setStep("metadata")}
                className="px-4 py-1.5 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="project-deposit-to-metadata"
              >
                Next: metadata ({selectionCount})
              </button>
            ) : step === "metadata" ? (
              <button
                type="button"
                disabled={!handoffReady}
                onClick={() => setStep("handoff")}
                className="px-4 py-1.5 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="project-deposit-to-handoff"
              >
                Next: hand off
              </button>
            ) : step === "handoff" && built === null ? (
              <button
                type="button"
                disabled={building}
                onClick={handleBuild}
                className="inline-flex items-center gap-2 px-4 py-1.5 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="project-deposit-build-bundle"
              >
                {building ? <Spinner /> : null}
                {building ? "Building..." : "Build bundle + open repository"}
              </button>
            ) : built && repo?.uploadUrl ? (
              <a
                href={repo.uploadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg"
              >
                Open {repo.name}
                <ExternalLinkIcon />
              </a>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}

// ---------------------------------------------------------------------------
// Step 1: multi-select experiments + notes
// ---------------------------------------------------------------------------

function SelectStep({
  prefill,
  selectedExpIds,
  selectedNoteIds,
  toggleExp,
  toggleNote,
  bundleFormat,
  setBundleFormat,
}: {
  prefill: ProjectDepositPrefill;
  selectedExpIds: Set<number>;
  selectedNoteIds: Set<number>;
  toggleExp: (id: number) => void;
  toggleNote: (id: number) => void;
  bundleFormat: ExportFormat;
  setBundleFormat: (f: ExportFormat) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-blue-50 dark:bg-blue-500/15 border border-blue-100 px-3 py-2 text-meta text-blue-800 dark:text-blue-300 leading-relaxed">
        A project deposit is one dataset with one DOI. Pick the experiments and
        notes that belong in the public record. Each item is exported
        individually, plus one combined PDF that ties them together.
      </div>

      {/* Experiments */}
      <div>
        <div className="text-meta font-medium text-foreground mb-1.5">
          Experiments ({prefill.experiments.length})
        </div>
        {prefill.experiments.length === 0 ? (
          <div className="text-meta text-foreground-muted rounded-lg border border-border bg-surface-sunken px-3 py-2">
            This project has no experiments yet.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1" data-testid="project-deposit-experiments">
            {prefill.experiments.map((exp) => {
              const checked = selectedExpIds.has(exp.id);
              return (
                <label
                  key={exp.id}
                  className="flex items-center gap-2.5 rounded-md border border-border px-2.5 py-1.5 cursor-pointer hover:border-blue-300"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleExp(exp.id)}
                    data-testid={`project-deposit-exp-${exp.id}`}
                  />
                  <span className="flex-1 min-w-0 text-body text-foreground truncate">
                    {exp.name || `Experiment ${exp.id}`}
                  </span>
                  {exp.is_complete ? (
                    <span className="text-meta text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-500/15 border border-green-200 dark:border-green-500/30 rounded px-1.5 py-0.5">
                      complete
                    </span>
                  ) : (
                    <span className="text-meta text-foreground-muted bg-surface-sunken border border-border rounded px-1.5 py-0.5">
                      in progress
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <div className="text-meta font-medium text-foreground mb-1.5">
          Notes ({prefill.notes.length})
        </div>
        {prefill.notes.length === 0 ? (
          <div className="text-meta text-foreground-muted rounded-lg border border-border bg-surface-sunken px-3 py-2">
            No notes to attach.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1" data-testid="project-deposit-notes">
            {prefill.notes.map((note) => {
              const checked = selectedNoteIds.has(note.id);
              return (
                <label
                  key={note.id}
                  className="flex items-center gap-2.5 rounded-md border border-border px-2.5 py-1.5 cursor-pointer hover:border-blue-300"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleNote(note.id)}
                    data-testid={`project-deposit-note-${note.id}`}
                  />
                  <span className="flex-1 min-w-0 text-body text-foreground truncate">
                    {note.title || `Note ${note.id}`}
                  </span>
                  {note.is_running_log ? (
                    <span className="text-meta text-foreground-muted bg-surface-sunken border border-border rounded px-1.5 py-0.5">
                      running log
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Per-item presentation format */}
      <div>
        <div className="text-meta font-medium text-foreground mb-1.5">
          Per-item format
        </div>
        <div className="flex gap-2">
          {(
            [
              ["html", "HTML"],
              ["pdf", "PDF"],
              ["raw", "Raw"],
            ] as [ExportFormat, string][]
          ).map(([fmt, label]) => (
            <button
              key={fmt}
              type="button"
              onClick={() => setBundleFormat(fmt)}
              className={`px-3 py-1.5 text-meta rounded-lg border ${
                bundleFormat === fmt
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 font-medium"
                  : "border-border text-foreground-muted hover:border-border"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-meta text-foreground-muted mt-1.5">
          How each experiment is rendered in the bundle. The combined navigable
          PDF and the raw re-importable bundles are always included as well.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: metadata (project-level, multi-funder)
// ---------------------------------------------------------------------------

function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <label className="text-meta font-medium text-foreground">{children}</label>
      {hint ? <span className="text-meta text-foreground-muted">{hint}</span> : null}
    </div>
  );
}

function PrefilledBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-meta font-medium text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-500/15 border border-green-200 dark:border-green-500/30 rounded px-1.5 py-0.5">
      <CheckIcon />
      prefilled
    </span>
  );
}

function MetadataStep({
  prefill,
  metadata,
  funders,
  issues,
  abstract,
  setAbstract,
  orcidDraft,
  setOrcidDraft,
  licenseChoice,
  setLicenseChoice,
  licenseCustom,
  setLicenseCustom,
  publicationDate,
  setPublicationDate,
}: {
  prefill: ProjectDepositPrefill;
  metadata: DepositMetadata;
  funders: { id: number }[];
  issues: ReturnType<typeof inspectDepositMetadata>;
  abstract: string;
  setAbstract: (s: string) => void;
  orcidDraft: string;
  setOrcidDraft: (s: string) => void;
  licenseChoice: string;
  setLicenseChoice: (s: string) => void;
  licenseCustom: string;
  setLicenseCustom: (s: string) => void;
  publicationDate: string;
  setPublicationDate: (s: string) => void;
}) {
  const orcidValid = orcidDraft.trim().length > 0 && isValidOrcid(orcidDraft);
  const orcidUrl = orcidRecordUrl(orcidDraft);
  const isOther = licenseChoice === OTHER_LICENSE_CHOICE;
  const selectedLicense = isOther
    ? undefined
    : LICENSE_OPTIONS.find((o) => o.spdxId === licenseChoice);
  const fundingRefs = metadata.fundingReferences;
  const hasDerived = prefill.chargedGrants.accounts.length > 0;
  // Number of derived (non-primary) funder accounts that contributed a
  // reference, for the soft "+N derived grants" hint.
  const derivedFunderCount = Math.max(0, funders.length - (prefill.primaryFundingAccount ? 1 : 0));

  return (
    <div className="space-y-4">
      {/* Title (the project name) */}
      <div className="space-y-1">
        <FieldLabel hint="from the project name">
          Title <PrefilledBadge />
        </FieldLabel>
        <div className="text-body text-foreground rounded-lg border border-border bg-surface-sunken px-3 py-2">
          {metadata.titles[0]?.title}
        </div>
      </div>

      {/* Creator + ORCID */}
      <div className="space-y-1">
        <FieldLabel hint="from your profile">
          Creator {prefill.ownerOrcid ? <PrefilledBadge /> : null}
        </FieldLabel>
        <div className="text-body text-foreground rounded-lg border border-border bg-surface-sunken px-3 py-2">
          {prefill.ownerDisplayName}
        </div>
        <div className="mt-1.5">
          <div className="relative">
            <input
              type="text"
              value={orcidDraft}
              onChange={(e) => setOrcidDraft(e.target.value)}
              onBlur={() => {
                const n = normalizeOrcid(orcidDraft);
                if (n) setOrcidDraft(n);
              }}
              placeholder="ORCID iD, e.g. 0000-0002-1825-0097"
              className="w-full text-body rounded-lg border border-border px-3 py-2 pr-9 focus:border-blue-400 focus:ring-1 focus:ring-blue-300 outline-none"
              data-testid="project-deposit-orcid"
            />
            {orcidDraft.trim().length > 0 ? (
              <span
                className={`absolute right-2.5 top-1/2 -translate-y-1/2 ${
                  orcidValid ? "text-green-600 dark:text-green-300" : "text-amber-500"
                }`}
              >
                {orcidValid ? <CheckIcon /> : <WarnIcon />}
              </span>
            ) : null}
          </div>
          {issues.orcidInvalid ? (
            <p className="text-meta text-amber-600 dark:text-amber-300 mt-1">
              This does not match the ORCID checksum. It will still be saved, but
              double-check the digits.
            </p>
          ) : orcidValid && orcidUrl ? (
            <a
              href={orcidUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-meta text-blue-600 dark:text-blue-300 hover:underline mt-1"
            >
              View ORCID record <ExternalLinkIcon />
            </a>
          ) : null}
        </div>
      </div>

      {/* Abstract */}
      <div className="space-y-1">
        <FieldLabel>Description / abstract</FieldLabel>
        <textarea
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          rows={4}
          placeholder="A short summary of the dataset for the repository record."
          className="w-full text-body rounded-lg border border-border px-3 py-2 focus:border-blue-400 focus:ring-1 focus:ring-blue-300 outline-none resize-y"
          data-testid="project-deposit-abstract"
        />
        {issues.abstractMissing ? (
          <p className="text-meta text-foreground-muted">
            Optional, but a description helps people find and reuse your data.
          </p>
        ) : null}
      </div>

      {/* Keywords + publication date */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <FieldLabel hint="from project tags">
            Keywords {metadata.subjects.length > 0 ? <PrefilledBadge /> : null}
          </FieldLabel>
          <div className="flex flex-wrap gap-1 min-h-[2.25rem] rounded-lg border border-border bg-surface-sunken px-2 py-1.5">
            {metadata.subjects.length > 0 ? (
              metadata.subjects.map((s) => (
                <span
                  key={s.subject}
                  className="text-meta bg-surface-raised border border-border rounded px-1.5 py-0.5 text-foreground"
                >
                  {s.subject}
                </span>
              ))
            ) : (
              <span className="text-meta text-foreground-muted self-center">
                No tags on this project.
              </span>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <FieldLabel>Publication date</FieldLabel>
          <input
            type="date"
            value={publicationDate}
            onChange={(e) => setPublicationDate(e.target.value)}
            className="w-full text-body rounded-lg border border-border px-3 py-[0.4rem] focus:border-blue-400 focus:ring-1 focus:ring-blue-300 outline-none"
          />
        </div>
      </div>

      {/* Funding (primary + derived charged grants) */}
      <div className="space-y-1">
        <FieldLabel hint="primary grant + grants charged in this project">
          Funding{" "}
          {fundingRefs.length > 0 ? <PrefilledBadge /> : null}
        </FieldLabel>
        {fundingRefs.length > 0 ? (
          <div className="space-y-1.5" data-testid="project-deposit-funders">
            {fundingRefs.map((funding, i) => (
              <div
                key={`${funding.funderName}-${funding.awardNumber ?? ""}-${i}`}
                className="text-body text-foreground rounded-lg border border-border bg-surface-sunken px-3 py-2 space-y-0.5"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{funding.funderName}</span>
                  {i === 0 && prefill.primaryFundingAccount ? (
                    <span className="text-meta text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 rounded px-1.5 py-0.5">
                      primary
                    </span>
                  ) : (
                    <span className="text-meta text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/15 border border-purple-200 dark:border-purple-500/30 rounded px-1.5 py-0.5">
                      charged
                    </span>
                  )}
                </div>
                {funding.awardNumber ? (
                  <div className="text-meta text-foreground-muted">
                    Award {funding.awardNumber}
                    {funding.awardTitle ? ` - ${funding.awardTitle}` : ""}
                  </div>
                ) : null}
                {funding.funderIdentifier ? (
                  <div className="text-meta text-foreground-muted">
                    {funding.funderIdentifierType ?? "ID"}: {funding.funderIdentifier}
                  </div>
                ) : null}
              </div>
            ))}
            {derivedFunderCount > 0 ? (
              <p className="text-meta text-foreground-muted">
                {derivedFunderCount} additional{" "}
                {derivedFunderCount === 1 ? "grant" : "grants"} derived from
                purchases charged in this project.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="text-meta text-foreground-muted rounded-lg border border-border bg-surface-sunken px-3 py-2">
            {hasDerived
              ? "Grants were charged in this project but carry no funder name or award number yet. Add award metadata in Purchases & Funding to prefill funding."
              : "No grant is linked to this project and nothing was charged. Add a grant in the project settings to prefill funding, or leave it out."}
          </div>
        )}
      </div>

      {/* License (required) */}
      <div className="space-y-1.5">
        <FieldLabel hint="required">
          <span className="inline-flex items-center gap-1.5">
            License
            {issues.licenseMissing ? (
              <span className="text-amber-600 dark:text-amber-300">
                <WarnIcon />
              </span>
            ) : (
              <span className="text-green-600 dark:text-green-300">
                <CheckIcon />
              </span>
            )}
          </span>
        </FieldLabel>
        <select
          value={licenseChoice}
          onChange={(e) => setLicenseChoice(e.target.value)}
          className="w-full text-body rounded-lg border border-border px-3 py-2 focus:border-blue-400 focus:ring-1 focus:ring-blue-300 outline-none bg-surface-raised"
          data-testid="project-deposit-license"
        >
          <option value="" disabled>
            Choose a license...
          </option>
          {LICENSE_OPTIONS.map((opt) => (
            <option
              key={opt.label}
              value={opt.spdxId === "" ? OTHER_LICENSE_CHOICE : opt.spdxId}
            >
              {opt.label}
              {opt.recommended ? "  (recommended)" : ""}
            </option>
          ))}
        </select>
        {isOther ? (
          <input
            type="text"
            value={licenseCustom}
            onChange={(e) => setLicenseCustom(e.target.value)}
            placeholder="License name or SPDX id, e.g. ODbL-1.0"
            className="w-full text-body rounded-lg border border-border px-3 py-2 focus:border-blue-400 focus:ring-1 focus:ring-blue-300 outline-none"
            data-testid="project-deposit-license-custom"
          />
        ) : null}
        {selectedLicense ? (
          <p className="text-meta text-foreground-muted leading-relaxed">
            {selectedLicense.explainer}
          </p>
        ) : null}
        {issues.licenseMissing ? (
          <p className="text-meta text-amber-600 dark:text-amber-300">
            A license is required before you can hand off. NIH expects shared
            data to carry one. CC BY 4.0 or CC0 are safe defaults.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3a: handoff repository picker
// ---------------------------------------------------------------------------

function HandoffPickStep({
  repoId,
  setRepoId,
}: {
  repoId: RepositoryId;
  setRepoId: (id: RepositoryId) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-meta text-foreground-muted leading-relaxed">
        Pick where this dataset will live. ResearchOS builds a ready-to-upload
        bundle and the metadata file. The repository mints the DOI; ResearchOS
        does not.
      </p>
      <div className="space-y-2">
        {REPOSITORIES.map((r) => (
          <label
            key={r.id}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${
              repoId === r.id
                ? "border-blue-500 bg-blue-50 dark:bg-blue-500/15"
                : "border-border hover:border-border"
            }`}
          >
            <input
              type="radio"
              name="project-repo"
              className="mt-0.5"
              checked={repoId === r.id}
              onChange={() => setRepoId(r.id)}
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-body font-medium text-foreground">
                  {r.name}
                </span>
                {r.oneClickComingSoon ? (
                  <span className="text-meta font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/15 border border-purple-200 dark:border-purple-500/30 rounded px-1.5 py-0.5">
                    one-click publishing coming soon
                  </span>
                ) : null}
              </span>
              <span className="block text-meta text-foreground-muted mt-0.5">
                {r.blurb}
              </span>
              <span className="block text-meta text-foreground-muted mt-1">
                {r.guidedNote}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3b: handoff download + paste guidance
// ---------------------------------------------------------------------------

function HandoffDownloadStep({
  repoId,
  built,
  copied,
  onCopy,
}: {
  repoId: RepositoryId;
  built: DepositBundleResult;
  copied: boolean;
  onCopy: () => void;
}) {
  const repo = findRepository(repoId);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 px-3 py-2.5 text-body text-green-800 dark:text-green-300 flex items-start gap-2">
        <span className="text-green-600 dark:text-green-300 mt-0.5">
          <CheckIcon />
        </span>
        <div>
          <div className="font-medium">Bundle downloaded</div>
          <div className="text-meta mt-0.5">
            <span className="font-mono">{built.filename}</span> is in your
            downloads. It contains each selected item exported individually, the
            combined PDF, the raw re-importable bundles, and{" "}
            <span className="font-mono">datacite.json</span>.
          </div>
        </div>
      </div>

      <ol className="space-y-2 text-body text-foreground">
        <li className="flex gap-2">
          <span className="font-medium text-foreground-muted">1.</span>
          <span>
            Open {repo?.name ?? "your repository"}&apos;s new-upload page (the
            button below opens it in a new tab).
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-medium text-foreground-muted">2.</span>
          <span>
            Drag <span className="font-mono">{built.filename}</span> into the
            upload area.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-medium text-foreground-muted">3.</span>
          <span>
            Copy the metadata below and paste each field into the
            repository&apos;s form (title, authors, description, keywords,
            funding, license).
          </span>
        </li>
      </ol>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-meta font-medium text-foreground">
            Prefilled metadata (datacite.json)
          </span>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 text-meta px-2.5 py-1 rounded-md border border-border text-foreground-muted hover:border-border"
          >
            {copied ? (
              <>
                <span className="text-green-600 dark:text-green-300">
                  <CheckIcon />
                </span>
                Copied
              </>
            ) : (
              "Copy metadata"
            )}
          </button>
        </div>
        <pre
          className="text-meta bg-surface-sunken text-foreground rounded-lg p-3 overflow-auto max-h-52 leading-relaxed"
          data-testid="project-deposit-metadata-json"
        >
          {built.metadataJson}
        </pre>
      </div>
    </div>
  );
}
