"use client";

import { useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { FileIcon } from "@/lib/utils/icons";
import LivingPopup from "@/components/ui/LivingPopup";

export type FileViewerKind = "text" | "pdf";

interface FileViewerModalProps {
  filename: string;
  resolvedPath: string;
  kind: FileViewerKind;
  onClose: () => void;
}

type Step = "prompt" | "loading" | "viewing" | "error";

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FileViewerModal({
  filename,
  resolvedPath,
  kind,
  onClose,
}: FileViewerModalProps) {
  const [step, setStep] = useState<Step>("prompt");
  const [text, setText] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Escape closes via LivingPopup's built-in handler.

  const handleView = async () => {
    setStep("loading");
    try {
      const blob = await fileService.readFileAsBlob(resolvedPath);
      if (!blob) {
        setErrorMessage("File not found on disk.");
        setStep("error");
        return;
      }
      if (kind === "pdf") {
        // Browser's built-in PDF viewer handles blob URLs in a new tab.
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        // Don't revoke immediately; the new tab needs the URL alive.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        onClose();
        return;
      }
      const asText = await blob.text();
      setText(asText);
      setStep("viewing");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load file.");
      setStep("error");
    }
  };

  const handleDownload = async () => {
    try {
      const blob = await fileService.readFileAsBlob(resolvedPath);
      if (!blob) {
        setErrorMessage("File not found on disk.");
        setStep("error");
        return;
      }
      triggerBlobDownload(blob, filename);
      if (step !== "viewing") onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load file.");
      setStep("error");
    }
  };

  if (step === "viewing" && text !== null) {
    return (
      <LivingPopup
        open
        onClose={onClose}
        label={filename}
        widthClassName="max-w-4xl"
        card={false}
        fillHeight
      >
        <div className="bg-surface-raised rounded-xl shadow-2xl w-full h-full max-h-[85vh] flex flex-col overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-surface-sunken flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <FileIcon className="w-4 h-4 text-foreground-muted flex-shrink-0" />
              <h3 className="text-body font-semibold text-foreground truncate" title={filename}>
                {filename}
              </h3>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleDownload}
                className="px-3 py-1.5 text-meta text-foreground bg-surface-raised border border-border rounded-md hover:bg-surface-sunken transition-colors"
              >
                Download
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-meta text-foreground-muted hover:text-foreground hover:bg-surface-sunken rounded-md transition-colors"
              >
                Close
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-surface-sunken">
            <pre className="m-0 p-4 text-meta font-mono text-foreground whitespace-pre-wrap break-words">
              <code>{text}</code>
            </pre>
          </div>
        </div>
      </LivingPopup>
    );
  }

  return (
    <LivingPopup
      open
      onClose={onClose}
      label={filename}
      widthClassName="max-w-md"
      card={false}
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-surface-sunken">
          <div className="flex items-center gap-3">
            <FileIcon className="w-5 h-5 text-foreground-muted flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="text-title font-semibold text-foreground truncate" title={filename}>
                {filename}
              </h3>
              <p className="text-meta text-foreground-muted mt-0.5">
                {kind === "pdf" ? "PDF document" : "Text file"}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          {step === "loading" ? (
            <div className="flex items-center justify-center py-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
              <span className="ml-2 text-meta text-foreground-muted">Loading file…</span>
            </div>
          ) : step === "error" ? (
            <p className="text-meta text-red-600 dark:text-red-300">{errorMessage || "Something went wrong."}</p>
          ) : (
            <p className="text-meta text-foreground-muted">
              {kind === "pdf"
                ? "Open this PDF in a new browser tab, or download a copy."
                : "Open the contents in a viewer, or download a copy."}
            </p>
          )}
        </div>

        <div className="px-5 py-3 bg-surface-sunken border-t border-border flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-body text-foreground-muted hover:text-foreground hover:bg-surface-sunken rounded-lg transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={step === "loading"}
              className="px-4 py-2 text-body text-foreground bg-surface-raised border border-border rounded-lg hover:bg-surface-sunken transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Download
            </button>
            <button
              type="button"
              onClick={handleView}
              disabled={step === "loading"}
              className="px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              View
            </button>
          </div>
        </div>
      </div>
    </LivingPopup>
  );
}

const TEXT_LIKE_EXTENSIONS = new Set([
  // plain & data
  "md", "txt", "csv", "tsv", "log", "json", "xml", "yaml", "yml", "html", "htm",
  // code
  "py", "js", "ts", "tsx", "jsx", "css", "sh", "sql", "rb", "go", "rs", "c",
  "cpp", "h", "hpp", "java", "kt", "swift", "r", "m", "mm", "lua", "php",
  "toml", "ini", "conf", "env",
  // bio / sequence (text)
  "faa", "fna", "fasta", "fa", "gff", "gff3", "gbk", "gb", "vcf", "seq",
  "embl", "sam",
]);

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
]);

export type FileLinkAction =
  | { type: "download" }
  | { type: "prompt"; kind: FileViewerKind };

/**
 * Decide what should happen when a `[name](Files/foo.ext)` link is clicked.
 * Image extensions that leak into Files/ get an immediate download (the
 * proper rendering pipeline lives in Images/ and would already have shown
 * them inline). Text-like and PDF show a View/Download prompt. Everything
 * else (binary archives, office docs, media) downloads directly.
 */
export function classifyFileLink(filename: string): FileLinkAction {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  if (!ext) return { type: "download" };
  if (IMAGE_EXTENSIONS.has(ext)) return { type: "download" };
  if (ext === "pdf") return { type: "prompt", kind: "pdf" };
  if (TEXT_LIKE_EXTENSIONS.has(ext)) return { type: "prompt", kind: "text" };
  return { type: "download" };
}
