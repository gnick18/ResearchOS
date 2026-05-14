"use client";

import { useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl flex-shrink-0" aria-hidden>📄</span>
              <h3 className="text-sm font-semibold text-gray-900 truncate" title={filename}>
                {filename}
              </h3>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={handleDownload}
                className="px-3 py-1.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              >
                Download
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              >
                Close
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto bg-gray-50">
            <pre className="m-0 p-4 text-xs font-mono text-gray-800 whitespace-pre-wrap break-words">
              <code>{text}</code>
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-3">
            <span className="text-2xl flex-shrink-0" aria-hidden>
              {kind === "pdf" ? "📕" : "📄"}
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 truncate" title={filename}>
                {filename}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {kind === "pdf" ? "PDF document" : "Text file"}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          {step === "loading" ? (
            <div className="flex items-center justify-center py-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
              <span className="ml-2 text-xs text-gray-500">Loading file…</span>
            </div>
          ) : step === "error" ? (
            <p className="text-xs text-red-600">{errorMessage || "Something went wrong."}</p>
          ) : (
            <p className="text-xs text-gray-600">
              {kind === "pdf"
                ? "Open this PDF in a new browser tab, or download a copy."
                : "Open the contents in a viewer, or download a copy."}
            </p>
          )}
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={step === "loading"}
              className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Download
            </button>
            <button
              type="button"
              onClick={handleView}
              disabled={step === "loading"}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              View
            </button>
          </div>
        </div>
      </div>
    </div>
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
