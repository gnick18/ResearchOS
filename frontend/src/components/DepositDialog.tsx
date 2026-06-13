"use client";

/**
 * DepositDialog - Repository-deposit PHASE 1 (guided-deposit bot,
 * 2026-05-28). The GUIDED path (locked design Option D): build a
 * repository-ready bundle + a prefilled DataCite metadata file, then hand
 * off to the repository's own web upload page. NO API calls, NO credentials,
 * NO server routes. The repository mints the DOI; we do not.
 *
 * Three steps:
 *   1. CURATION  - choose which sections / attachments go in the bundle.
 *   2. METADATA  - a DataCite-mapped form prefilled from task/project/ORCID;
 *                  the user fills what is missing, especially a LICENSE.
 *   3. HANDOFF   - pick a repository, download the bundle + metadata, open
 *                  the repository's new-upload page, paste the metadata.
 *
 * Conventions: no em-dashes, no emojis, custom inline SVG icons only,
 * Tooltip component (never native title=) for icon-only affordances.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import type { Task } from "@/lib/types";
import {
  isValidOrcid,
  normalizeOrcid,
  orcidRecordUrl,
} from "@/lib/metadata/orcid";
import {
  applyCuration,
  buildCurationMenu,
  defaultCurationSelection,
  selectionHasContent,
  type CurationMenu,
  type CurationSelection,
} from "@/lib/deposit/curation";
import {
  buildDepositMetadata,
  inspectDepositMetadata,
  LICENSE_OPTIONS,
  type DepositMetadata,
} from "@/lib/deposit/datacite";
import { loadDepositPrefill, type DepositPrefill } from "@/lib/deposit/prefill";
import {
  buildDepositBundle,
  downloadBlob,
  type DepositBundleResult,
} from "@/lib/deposit/bundle";
import {
  REPOSITORIES,
  findRepository,
  type RepositoryId,
} from "@/lib/deposit/repositories";
import type { ExportFormat } from "@/lib/export/types";

type Step = "curation" | "metadata" | "handoff";

// Sentinel value for the free-text "Other" license option in the picker.
// Distinct from "" (not chosen yet) so the two states never collide.
const OTHER_LICENSE_CHOICE = "__other__";

interface DepositDialogProps {
  isOpen: boolean;
  task: Task;
  currentUser: string | null;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
// Step header / progress
// ---------------------------------------------------------------------------

const STEP_ORDER: Step[] = ["curation", "metadata", "handoff"];
const STEP_LABELS: Record<Step, string> = {
  curation: "Curate",
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
                    ? "bg-blue-600 text-white"
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

export default function DepositDialog({
  isOpen,
  task,
  currentUser,
  onClose,
}: DepositDialogProps) {
  const [step, setStep] = useState<Step>("curation");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<DepositPrefill | null>(null);

  // Curation state
  const [menu, setMenu] = useState<CurationMenu | null>(null);
  const [selection, setSelection] = useState<CurationSelection | null>(null);
  const [bundleFormat, setBundleFormat] = useState<ExportFormat>("html");

  // Metadata state (user-editable)
  const [abstract, setAbstract] = useState("");
  const [orcidDraft, setOrcidDraft] = useState("");
  // License choice sentinels: "" = not chosen yet; an SPDX id (e.g.
  // "CC-BY-4.0") = a catalog license; OTHER_LICENSE_CHOICE = the free-text
  // "Other" option (the actual name lives in `licenseCustom`).
  const [licenseChoice, setLicenseChoice] = useState<string>("");
  const [licenseCustom, setLicenseCustom] = useState("");
  const [publicationDate, setPublicationDate] = useState("");

  // Handoff state
  const [repoId, setRepoId] = useState<RepositoryId>("zenodo");
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState<DepositBundleResult | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Synchronous open-reset, done at RENDER time (not in an effect) keyed on a
  // (isOpen, task.id) transition. This is the `ExportFormatDialog` pattern:
  // tracking a derived `prevOpenKey` and resetting state when it changes
  // avoids the set-state-in-effect cascading-render lint while still wiping
  // stale state every time the dialog opens for a (possibly new) task. The
  // async prefill load lives in the effect below, where its setState calls
  // are in `.then` / `.catch` callbacks (the allowed shape).
  const openKey = isOpen ? `open:${task.id}` : "closed";
  const [prevOpenKey, setPrevOpenKey] = useState(openKey);
  if (prevOpenKey !== openKey) {
    setPrevOpenKey(openKey);
    setStep("curation");
    setLoadError(null);
    setBuilt(null);
    setBuildError(null);
    setCopied(false);
    setLoading(isOpen);
    setPrefill(null);
    setMenu(null);
    setSelection(null);
  }

  // Load the prefill once per open. The synchronous reset above already set
  // `loading=true`; here we only resolve it asynchronously.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    loadDepositPrefill(task, currentUser)
      .then((p) => {
        if (cancelled) return;
        const m = buildCurationMenu(p.payload);
        setPrefill(p);
        setMenu(m);
        setSelection(defaultCurationSelection(m));
        setBundleFormat("html");
        setAbstract(p.suggestedAbstract);
        setOrcidDraft(p.ownerOrcid ?? "");
        setLicenseChoice("");
        setLicenseCustom("");
        setPublicationDate(p.defaultPublicationDate);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Could not load this experiment.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, task, currentUser]);

  // Scrim click / Escape / the corner X all route through LivingPopup, but never
  // mid-build (matches the old guarded backdrop + Escape behavior).
  const handleClose = () => {
    if (!building) onClose();
  };

  // Translate the picker sentinel into the builder's two license inputs:
  // a catalog SPDX id, or a free-text custom name for the Other choice.
  const isOtherLicense = licenseChoice === OTHER_LICENSE_CHOICE;
  const licenseSpdxId = isOtherLicense ? null : licenseChoice || null;
  const licenseCustomName = isOtherLicense ? licenseCustom || null : null;

  // Build the live DataCite metadata object from the current form state.
  const metadata: DepositMetadata | null = useMemo(() => {
    if (!prefill) return null;
    return buildDepositMetadata({
      task: prefill.payload.task,
      project: prefill.payload.project,
      ownerDisplayName: prefill.ownerDisplayName,
      ownerOrcid: orcidDraft || null,
      fundingAccount: prefill.fundingAccount,
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

  const toggleAttachment = useCallback((key: string) => {
    setSelection((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.excludedAttachmentKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, excludedAttachmentKeys: next };
    });
  }, []);

  const handleBuild = useCallback(async () => {
    if (!prefill || !selection || !metadata) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const curated = applyCuration(prefill.payload, selection);
      const result = await buildDepositBundle(curated, bundleFormat, metadata);
      setBuilt(result);
      downloadBlob(result.blob, result.filename);
    } catch (err) {
      setBuildError(
        err instanceof Error ? err.message : "Could not build the bundle.",
      );
    } finally {
      setBuilding(false);
    }
  }, [prefill, selection, metadata, bundleFormat]);

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
  const hasContent = !!menu && !!selection && selectionHasContent(menu, selection);

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
        data-testid="deposit-dialog"
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
                {task.name}
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
              Reading the experiment...
            </div>
          ) : loadError ? (
            <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-body text-red-800 dark:text-red-300">
              {loadError}
            </div>
          ) : step === "curation" && menu && selection ? (
            <CurationStep
              menu={menu}
              selection={selection}
              setSelection={setSelection}
              toggleAttachment={toggleAttachment}
              bundleFormat={bundleFormat}
              setBundleFormat={setBundleFormat}
            />
          ) : step === "metadata" && prefill && metadata && issues ? (
            <MetadataStep
              prefill={prefill}
              metadata={metadata}
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
              if (step === "metadata") setStep("curation");
              else if (step === "handoff" && built === null) setStep("metadata");
              else if (step === "handoff" && built) {
                // Allow re-curating after a build (reset the build).
                setBuilt(null);
                setStep("handoff");
              } else onClose();
            }}
            disabled={building}
            className="px-3 py-1.5 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg disabled:opacity-50"
          >
            {step === "curation" ? "Cancel" : built ? "Build again" : "Back"}
          </button>

          <div className="flex items-center gap-2">
            {step === "curation" ? (
              <button
                type="button"
                disabled={loading || !hasContent}
                onClick={() => setStep("metadata")}
                className="px-4 py-1.5 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next: metadata
              </button>
            ) : step === "metadata" ? (
              <button
                type="button"
                disabled={!handoffReady}
                onClick={() => setStep("handoff")}
                className="px-4 py-1.5 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="deposit-to-handoff"
              >
                Next: hand off
              </button>
            ) : step === "handoff" && built === null ? (
              <button
                type="button"
                disabled={building}
                onClick={handleBuild}
                className="inline-flex items-center gap-2 px-4 py-1.5 text-body font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="deposit-build-bundle"
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
// Step 1: curation
// ---------------------------------------------------------------------------

function CurationStep({
  menu,
  selection,
  setSelection,
  toggleAttachment,
  bundleFormat,
  setBundleFormat,
}: {
  menu: CurationMenu;
  selection: CurationSelection;
  setSelection: React.Dispatch<React.SetStateAction<CurationSelection | null>>;
  toggleAttachment: (key: string) => void;
  bundleFormat: ExportFormat;
  setBundleFormat: (f: ExportFormat) => void;
}) {
  const sectionRow = (
    label: string,
    description: string,
    present: boolean,
    checked: boolean,
    onToggle: () => void,
  ) => (
    <label
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
        present
          ? "border-border hover:border-blue-300 cursor-pointer"
          : "border-border bg-surface-sunken cursor-not-allowed opacity-60"
      }`}
    >
      <input
        type="checkbox"
        className="mt-0.5"
        disabled={!present}
        checked={present && checked}
        onChange={onToggle}
      />
      <span className="min-w-0">
        <span className="block text-body font-medium text-foreground">{label}</span>
        <span className="block text-meta text-foreground-muted mt-0.5">
          {present ? description : "Nothing to include."}
        </span>
      </span>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-blue-50 dark:bg-blue-500/15 border border-blue-100 px-3 py-2 text-meta text-blue-800 dark:text-blue-300 leading-relaxed">
        Repositories want a curated dataset, not your whole working notebook.
        Pick what belongs in the public deposit. You can leave out anything
        you are not ready to share.
      </div>

      <div className="space-y-2">
        {sectionRow(
          "Lab notes",
          "The experiment notes section.",
          menu.hasNotes,
          selection.includeNotes,
          () =>
            setSelection((p) =>
              p ? { ...p, includeNotes: !p.includeNotes } : p,
            ),
        )}
        {sectionRow(
          "Results",
          "The results writeup.",
          menu.hasResults,
          selection.includeResults,
          () =>
            setSelection((p) =>
              p ? { ...p, includeResults: !p.includeResults } : p,
            ),
        )}
        {sectionRow(
          "Methods",
          "Attached methods / protocols.",
          menu.hasMethods,
          selection.includeMethods,
          () =>
            setSelection((p) =>
              p ? { ...p, includeMethods: !p.includeMethods } : p,
            ),
        )}
      </div>

      {menu.attachments.length > 0 ? (
        <div>
          <div className="text-meta font-medium text-foreground mb-1.5">
            Attachments ({menu.attachments.length})
          </div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {menu.attachments.map((att) => {
              const included = !selection.excludedAttachmentKeys.has(att.key);
              return (
                <label
                  key={att.key}
                  className="flex items-center gap-2.5 rounded-md border border-border px-2.5 py-1.5 cursor-pointer hover:border-blue-300"
                >
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={() => toggleAttachment(att.key)}
                  />
                  <span className="flex-1 min-w-0 text-meta text-foreground truncate">
                    {att.filename}
                  </span>
                  <span className="text-meta text-foreground-muted uppercase">
                    {att.origin}
                  </span>
                  <span className="text-meta text-foreground-muted tabular-nums">
                    {formatBytes(att.byteLength)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <div className="text-meta font-medium text-foreground mb-1.5">
          Bundle format
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
          HTML is a self-contained, human-readable page. Raw is a re-importable
          ResearchOS bundle. PDF is a print-ready report.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: metadata
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
  prefill: DepositPrefill;
  metadata: DepositMetadata;
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
  const funding = metadata.fundingReferences[0];
  const isOther = licenseChoice === OTHER_LICENSE_CHOICE;
  const selectedLicense = isOther
    ? undefined
    : LICENSE_OPTIONS.find((o) => o.spdxId === licenseChoice);

  return (
    <div className="space-y-4">
      {/* Title (prefilled, read-only display) */}
      <div className="space-y-1">
        <FieldLabel hint="from the experiment name">
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
              data-testid="deposit-orcid"
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
        <FieldLabel hint={prefill.suggestedAbstract ? "drafted from your notes" : "no notes to draft from"}>
          Description / abstract{" "}
          {prefill.suggestedAbstract ? <PrefilledBadge /> : null}
        </FieldLabel>
        <textarea
          value={abstract}
          onChange={(e) => setAbstract(e.target.value)}
          rows={4}
          placeholder="A short summary of the dataset for the repository record."
          className="w-full text-body rounded-lg border border-border px-3 py-2 focus:border-blue-400 focus:ring-1 focus:ring-blue-300 outline-none resize-y"
          data-testid="deposit-abstract"
        />
        {issues.abstractMissing ? (
          <p className="text-meta text-foreground-muted">
            Optional, but a description helps people find and reuse your data.
          </p>
        ) : null}
      </div>

      {/* Keywords + publication date row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <FieldLabel hint="from tags">
            Keywords{" "}
            {metadata.subjects.length > 0 ? <PrefilledBadge /> : null}
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
                No tags on this experiment.
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

      {/* Funding (prefilled from the project's primary grant) */}
      <div className="space-y-1">
        <FieldLabel hint="from the project grant">
          Funding {funding ? <PrefilledBadge /> : null}
        </FieldLabel>
        {funding ? (
          <div className="text-body text-foreground rounded-lg border border-border bg-surface-sunken px-3 py-2 space-y-0.5">
            <div className="font-medium">{funding.funderName}</div>
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
        ) : (
          <div className="text-meta text-foreground-muted rounded-lg border border-border bg-surface-sunken px-3 py-2">
            No grant is linked to this project. Add one in the project settings to
            prefill funding, or leave it out.
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
          data-testid="deposit-license"
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
            data-testid="deposit-license-custom"
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
              name="repo"
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
            downloads. It contains your curated experiment and{" "}
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
          data-testid="deposit-metadata-json"
        >
          {built.metadataJson}
        </pre>
      </div>
    </div>
  );
}
