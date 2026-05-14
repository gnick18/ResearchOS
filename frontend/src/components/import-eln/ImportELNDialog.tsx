"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  applyELNImportPlan,
  buildDefaultPlan,
  parseELNZip,
} from "@/lib/import/eln/orchestrate";
import { getCurrentUserCached } from "@/lib/storage/json-store";
import type {
  ELNApplyProgress,
  ELNImportPlan,
  ELNImportResult,
  ELNProjectMapping,
  ParsedNotebook,
} from "@/lib/import/eln/types";
import BulkSortScreen from "./BulkSortScreen";
import PickFormatStep, { type ELNFormat } from "./steps/PickFormatStep";
import UploadStep from "./steps/UploadStep";
import PreviewStep from "./steps/PreviewStep";
import ProjectMappingStep from "./steps/ProjectMappingStep";
import ApplyProgressStep from "./steps/ApplyProgressStep";
import DoneStep from "./steps/DoneStep";

type Step =
  | "format"
  | "upload"
  | "parsing"
  | "preview"
  | "mapping"
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
  applying: "5 · Importing",
  done: "6 · Done",
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
  }, []);

  // Escape key closes the dialog except during phases where we don't want
  // the user to bail mid-write.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (step === "applying" || step === "parsing") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, step, onClose]);

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
    try {
      const out = await parseELNZip(file);
      setParsed(out);
      const startedAt = new Date().toISOString();
      const receiver = (await getCurrentUserCached()) ?? "";
      const defaultPlan = buildDefaultPlan(out, receiver, startedAt);
      setMappings(defaultPlan.projectMappings);
      setPlan(defaultPlan);
      setStep("preview");
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Failed to read the ZIP file.",
      );
      setStep("upload");
    }
  }, [file]);

  const handleStartApply = useCallback(async () => {
    if (!plan) return;
    const planForApply: ELNImportPlan = { ...plan, projectMappings: mappings };
    setPlan(planForApply);
    setApplyError(null);
    setProgress({ phase: "projects", current: 0, total: 0 });
    setStep("applying");
    try {
      const r = await applyELNImportPlan(planForApply, {
        onProgress: setProgress,
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
  }, [plan, mappings, queryClient]);

  const goToPrevStep = useCallback(() => {
    if (step === "upload") setStep("format");
    else if (step === "preview") setStep("upload");
    else if (step === "mapping") setStep("preview");
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
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={requestClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
              {renderedTitle}
            </p>
            <h2 className="text-base font-semibold text-gray-900 mt-0.5">
              Import from another ELN
            </h2>
          </div>
          {step !== "applying" && step !== "parsing" && (
            <button
              type="button"
              onClick={requestClose}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none p-1"
              aria-label="Close"
            >
              ×
            </button>
          )}
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
          {step === "preview" && parsed && <PreviewStep parsed={parsed} />}
          {step === "mapping" && (
            <ProjectMappingStep
              mappings={mappings}
              onChange={setMappings}
              onValidityChange={setMappingValid}
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
    </div>
  );
}

function ParsingPanel() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div className="h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-gray-700 font-medium">Parsing notebook…</p>
      <p className="text-xs text-gray-500 max-w-sm text-center">
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
  if (step === "applying" || step === "parsing" || step === "done") return null;

  const primaryCls =
    "px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed";
  const secondaryCls = "px-3 py-2 text-sm text-gray-700 hover:text-gray-900";
  const ghostCls =
    "px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg";

  return (
    <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
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
