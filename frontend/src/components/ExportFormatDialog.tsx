"use client";

import { useEffect } from "react";
import type { ExportFormat } from "@/lib/export/types";

interface ExportFormatDialogProps {
  isOpen: boolean;
  taskCount: number;
  taskName?: string;
  isExporting?: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat) => void;
}

interface FormatOption {
  format: ExportFormat;
  title: string;
  description: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    format: "pdf",
    title: "PDF report",
    description:
      "Professional PDF with table of contents, bookmarks, and inline images. Files referenced inline are listed in an appendix at the end.",
  },
  {
    format: "html",
    title: "HTML report",
    description:
      "Single self-contained HTML page wrapped with its attachments. Open in any browser; share with anyone.",
  },
  {
    format: "raw",
    title: "Raw ResearchOS format",
    description:
      "The full experiment as a sharable bundle. Best for sharing with another ResearchOS user.",
  },
];

export default function ExportFormatDialog({
  isOpen,
  taskCount,
  taskName,
  isExporting = false,
  onClose,
  onExport,
}: ExportFormatDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isExporting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isExporting, onClose]);

  if (!isOpen) return null;

  const heading =
    taskCount === 1 && taskName
      ? `Export ${taskName}`
      : `Export ${taskCount} experiments`;

  const handleBackdropClick = () => {
    if (!isExporting) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900 line-clamp-2">
            {heading}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Choose a format. Multi-experiment exports produce a zip with one
            file per experiment.
          </p>
        </div>

        <div className="p-4 space-y-2">
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.format}
              type="button"
              disabled={isExporting}
              onClick={() => onExport(opt.format)}
              className="w-full text-left rounded-lg border border-gray-200 px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:bg-white"
            >
              <div className="text-sm font-medium text-gray-900">
                {opt.title}
              </div>
              <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                {opt.description}
              </div>
            </button>
          ))}
        </div>

        <div className="px-4 pb-4 pt-1 flex items-center justify-between">
          <div className="text-xs text-gray-500 min-h-[1.25rem]">
            {isExporting && (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="animate-spin w-3.5 h-3.5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Preparing export…
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
