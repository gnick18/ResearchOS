"use client";

import {
  useCallback,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  applyELNImportPlan,
  buildDefaultPlan,
  detectChangedPagesAgainstDisk,
  parseELNZip,
} from "@/lib/import/eln/orchestrate";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import type {
  ELNApplyProgress,
  ELNImportPlan,
  ELNImportResult,
  ELNProjectMapping,
  FetchedImage,
  ParsedNotebook,
} from "@/lib/import/eln/types";
import type { ChangedPage } from "@/lib/import/eln/apply";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import LivingPopup from "@/components/ui/LivingPopup";
import BulkSortScreen from "./BulkSortScreen";
import PickFormatStep, { type ELNFormat } from "./steps/PickFormatStep";
import UploadStep from "./steps/UploadStep";
import PreviewStep from "./steps/PreviewStep";
import ProjectMappingStep from "./steps/ProjectMappingStep";
import LabArchivesSignInStep from "./steps/LabArchivesSignInStep";
import ApplyProgressStep from "./steps/ApplyProgressStep";
import DoneStep from "./steps/DoneStep";

type Step =
  | "format"
  | "upload"
  | "parsing"
  | "preview"
  | "mapping"
  | "fetch-images"
  | "applying"
  | "done"
  | "bulk-sort";

interface ImportELNDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEP_TITLES: Record<Exclude<Step, "bulk-sort">, string> = {
  format: "1 · Choose format",
  upload: "2 · Upload ZIP",
  parsing: "3 · Reading notebook",
  preview: "3 · Preview notebook",
  mapping: "4 · Map projects",
  "fetch-images": "5 · Fetch images",
  applying: "6 · Importing",
  done: "7 · Done",
};

export default function ImportELNDialog({ isOpen, onClose }: ImportELNDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("format");
  const [format, setFormat] = useState<ELNFormat | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedNotebook | null>(null);
  const [mappings, setMappings] = useState<ELNProjectMapping[]>([]);
  const [mappingValid, setMappingValid] = useState(true);
  const [plan, setPlan] = useState<ELNImportPlan | null>(null);
  const [progress, setProgress] = useState<ELNApplyProgress | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<ELNImportResult | null>(null);
  // Held in state purely so an in-progress retry from the apply error screen
  // can re-use the already-fetched bytes without re-prompting. The getter
  // isn't read directly in JSX — the runApply caller reads from the closure
  // capture instead.
  const [, setFetchedImages] = useState<Map<string, FetchedImage>>(new Map());
  // Pages whose dedupKey matches an existing on-disk task BUT whose content
  // has changed since the last import. Populated in `handleParse` and shown
  // in the Preview step.
  const [changedPages, setChangedPages] = useState<ChangedPage[]>([]);
  // Per-page user opt-in for the overwrite path. Defaults to empty Set, so
  // unless the user explicitly ticks pages, the historical silent-skip
  // behavior is preserved.
  const [overwritePageIds, setOverwritePageIds] = useState<Set<string>>(
    () => new Set(),
  );

  const reset = useCallback(() => {
    setStep("format");
    setFormat(null);
    setFile(null);
    setParseError(null);
    setParsed(null);
    setMappings([]);
    setMappingValid(true);
    setPlan(null);
    setProgress(null);
    setApplyError(null);
    setResult(null);
    setFetchedImages(new Map());
    setChangedPages([]);
    setOverwritePageIds(new Set());
  }, []);

  // Closing the dialog is blocked during phases where we don't want the user
  // to bail mid-write. LivingPopup's scrim / X / Escape all route through
  // requestClose below.
  const requestClose = useCallback(() => {
    if (step === "applying" || step === "parsing") return;
    onClose();
  }, [step, onClose]);

  const handleSelectFile = useCallback((f: File) => {
    setFile(f);
    setParseError(null);
  }, []);

  const handleClearFile = useCallback(() => {
    setFile(null);
    setParseError(null);
  }, []);

  const handleParse = useCallback(async () => {
    if (!file) return;
    setStep("parsing");
    setParseError(null);
    setParsed(null);
    setChangedPages([]);
    setOverwritePageIds(new Set());
    try {
      const out = await parseELNZip(file);
      setParsed(out);
      const startedAt = new Date().toISOString();
      const user = (await getCurrentUserCached()) ?? "";
      const defaultPlan = buildDefaultPlan(out, user, startedAt);
      setMappings(defaultPlan.projectMappings);
      setPlan(defaultPlan);
      // Detect re-imported pages that have changed since their last import.
      // Best-effort — a scan failure must not block the wizard.
      if (user) {
        try {
          const changed = await detectChangedPagesAgainstDisk(out, user);
          setChangedPages(changed);
        } catch {
          // Silent: the worst case is the user doesn't get the overwrite
          // prompt and falls back to the existing silent-skip behavior.
          setChangedPages([]);
        }
      }
      setStep("preview");
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Failed to read the ZIP file.",
      );
      setStep("upload");
    }
  }, [file]);

  /**
   * Decide whether the rehydration step is reachable for this plan. We skip
   * it when:
   *  - the parsed notebook has no Form-B URLs (nothing to fetch); or
   *  - we're in demo / wikiCapture mode (the step's API path would phone
   *    home and the cred-less paths don't make sense against fixture data).
   *
   * Note: as of the 2026-05-14 cred-less-paths revamp the step is reachable
   * even when `isLabArchivesConfigured()` is false — the step itself
   * surfaces the DevTools-script + manual-drop paths in that case, so the
   * user always has a way to bring images in (or skip).
   */
  const skipFetchStep = useMemo(() => {
    if (!parsed) return true;
    if (parsed.missingInlineImages.length === 0) return true;
    if (isDemoOrWikiCapture()) return true;
    return false;
  }, [parsed]);

  const runApply = useCallback(
    async (fetched: Map<string, FetchedImage>) => {
      if (!plan) return;
      const planForApply: ELNImportPlan = { ...plan, projectMappings: mappings };
      setPlan(planForApply);
      setApplyError(null);
      setProgress({ phase: "projects", current: 0, total: 0 });
      setStep("applying");
      try {
        const r = await applyELNImportPlan(planForApply, {
          onProgress: setProgress,
          fetchedImages: fetched.size > 0 ? fetched : undefined,
          overwritePageIds:
            overwritePageIds.size > 0 ? overwritePageIds : undefined,
        });
        setResult(r);
        setStep("done");
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
      } catch (err) {
        setApplyError(
          err instanceof Error ? err.message : "Failed to import the notebook.",
        );
      }
    },
    [plan, mappings, queryClient, overwritePageIds],
  );

  const handleStartApply = useCallback(() => {
    // From the mapping step: jump to fetch-images when eligible, otherwise
    // straight to applying with no rehydrated images.
    if (skipFetchStep) {
      void runApply(new Map());
      return;
    }
    setStep("fetch-images");
  }, [skipFetchStep, runApply]);

  const handleContinueFromFetch = useCallback(
    (fetched: Map<string, FetchedImage>) => {
      setFetchedImages(fetched);
      void runApply(fetched);
    },
    [runApply],
  );

  const goToPrevStep = useCallback(() => {
    if (step === "upload") setStep("format");
    else if (step === "preview") setStep("upload");
    else if (step === "mapping") setStep("preview");
    else if (step === "fetch-images") setStep("mapping");
  }, [step]);

  const goToNextFromPreview = useCallback(() => {
    setStep("mapping");
  }, []);

  const renderedTitle = useMemo(() => {
    if (step === "bulk-sort") return null;
    return STEP_TITLES[step];
  }, [step]);

  if (!isOpen) return null;

  // BulkSortScreen renders as its own full-screen overlay.
  if (step === "bulk-sort" && result && parsed) {
    return (
      <BulkSortScreen
        result={result}
        onDone={() => {
          reset();
          onClose();
        }}
      />
    );
  }

  return (
    <LivingPopup
      open={isOpen}
      onClose={requestClose}
      label="Import from LabArchives"
      widthClassName="max-w-3xl"
      card={false}
      fillHeight
    >
      <div className="bg-surface-raised rounded-xl shadow-xl w-full flex flex-col overflow-hidden max-h-full">
        <div className="px-6 pt-5 pb-3 border-b border-border flex items-center justify-between gap-4">
          <div>
            <p className="text-meta uppercase tracking-wide text-foreground-muted font-medium">
              {renderedTitle}
            </p>
            <h2 className="text-title font-semibold text-foreground mt-0.5">
              Import from LabArchives
            </h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "format" && (
            <PickFormatStep selected={format} onSelect={setFormat} />
          )}
          {step === "upload" && (
            <UploadStep
              file={file}
              onSelectFile={handleSelectFile}
              onClear={handleClearFile}
              errorMessage={parseError}
            />
          )}
          {step === "parsing" && <ParsingPanel />}
          {step === "preview" && parsed && (
            <PreviewStep
              parsed={parsed}
              changedPages={changedPages}
              overwritePageIds={overwritePageIds}
              onOverwriteChange={setOverwritePageIds}
            />
          )}
          {step === "mapping" && (
            <ProjectMappingStep
              mappings={mappings}
              onChange={setMappings}
              onValidityChange={setMappingValid}
            />
          )}
          {step === "fetch-images" && parsed && (
            <LabArchivesSignInStep
              missingImages={parsed.missingInlineImages}
              notebookLabel={parsed.notebookName ?? undefined}
              onContinue={handleContinueFromFetch}
              onBack={goToPrevStep}
            />
          )}
          {step === "applying" && (
            <ApplyProgressStep
              progress={progress}
              errorMessage={applyError}
              onRetry={() => {
                setApplyError(null);
                setStep("mapping");
              }}
              onCancel={() => {
                reset();
                onClose();
              }}
            />
          )}
          {step === "done" && result && parsed && (
            <DoneStep
              result={result}
              parsed={parsed}
              onOpenBulkSort={() => setStep("bulk-sort")}
              onClose={() => {
                reset();
                onClose();
              }}
            />
          )}
        </div>

        <Footer
          step={step}
          format={format}
          file={file}
          mappingValid={mappingValid}
          onBack={goToPrevStep}
          onContinueFromFormat={() => setStep("upload")}
          onParse={handleParse}
          onContinueFromPreview={goToNextFromPreview}
          onStartApply={handleStartApply}
          onCancel={requestClose}
        />
      </div>
    </LivingPopup>
  );
}

function ParsingPanel() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-body text-foreground font-medium">Parsing notebook…</p>
      <p className="text-meta text-foreground-muted max-w-sm text-center">
        Reading folder structure, page entries, and bundled attachments out of
        the ZIP. Larger exports can take a few seconds.
      </p>
    </div>
  );
}

function Footer({
  step,
  format,
  file,
  mappingValid,
  onBack,
  onContinueFromFormat,
  onParse,
  onContinueFromPreview,
  onStartApply,
  onCancel,
}: {
  step: Step;
  format: ELNFormat | null;
  file: File | null;
  mappingValid: boolean;
  onBack: () => void;
  onContinueFromFormat: () => void;
  onParse: () => void;
  onContinueFromPreview: () => void;
  onStartApply: () => void;
  onCancel: () => void;
}) {
  if (
    step === "applying" ||
    step === "parsing" ||
    step === "done" ||
    step === "fetch-images"
  ) {
    return null;
  }

  const primaryCls =
    "px-4 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed";
  const secondaryCls = "px-3 py-2 text-body text-foreground hover:text-foreground";
  const ghostCls =
    "px-3 py-2 text-body bg-surface-sunken hover:bg-surface-sunken text-foreground rounded-lg";

  return (
    <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2 bg-surface-sunken">
      {step === "format" && (
        <>
          <button type="button" onClick={onCancel} className={secondaryCls}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinueFromFormat}
            disabled={format !== "labarchives-zip"}
            className={primaryCls}
          >
            Continue
          </button>
        </>
      )}
      {step === "upload" && (
        <>
          <button type="button" onClick={onBack} className={ghostCls}>
            Back
          </button>
          <button
            type="button"
            onClick={onParse}
            disabled={!file}
            className={primaryCls}
          >
            Parse
          </button>
        </>
      )}
      {step === "preview" && (
        <>
          <button type="button" onClick={onBack} className={ghostCls}>
            Back
          </button>
          <button
            type="button"
            onClick={onContinueFromPreview}
            className={primaryCls}
          >
            Continue
          </button>
        </>
      )}
      {step === "mapping" && (
        <>
          <button type="button" onClick={onBack} className={ghostCls}>
            Back
          </button>
          <button
            type="button"
            onClick={onStartApply}
            disabled={!mappingValid}
            className={primaryCls}
          >
            Start import
          </button>
        </>
      )}
    </div>
  );
}
