"use client";

// sequence Phase 2b bot — the calm confirmation dialog for large/destructive
// sequence edits (Cut/Delete a range, Paste a clip). SnapGene's "feels safe"
// quality comes from naming exactly what will change BEFORE it happens, so this
// dialog states the bp count, the position, and the features it touches — but in
// a quiet, compact layout, never a scary wall of text.
//
// Pure presentational + a confirm/cancel callback; all clipboard logic lives in
// lib/sequences/clipboard.ts. Mirrors the project confirm-dialog pattern
// (ErrorReportConfirmDialog): centered overlay, click-scrim to cancel, calm
// header, footer actions. No emojis (inline SVG only), no em-dashes.

import { useEffect } from "react";
import type { AffectedFeature } from "@/lib/sequences/clipboard";

export type ConfirmTone = "paste" | "delete";

export interface SequenceConfirmRequest {
  tone: ConfirmTone;
  title: string;
  /** Primary line, e.g. "Insert 1,234 bp and 3 features at position 512." */
  summary: string;
  /** Features the action removes or trims (delete/cut only). */
  affected?: AffectedFeature[];
  /** Optional secondary note (e.g. raw-text paste filtering). */
  note?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function IconPaste({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
    </svg>
  );
}
function IconTrash({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export default function SequenceConfirmDialog({ request }: { request: SequenceConfirmRequest | null }) {
  // Esc cancels, Enter confirms — standard dialog ergonomics.
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        request.onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        request.onConfirm();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request]);

  if (!request) return null;

  const isDelete = request.tone === "delete";
  const accent = isDelete
    ? { bg: "bg-rose-100", fg: "text-rose-600", btn: "bg-rose-600 hover:bg-rose-700" }
    : { bg: "bg-sky-100", fg: "text-sky-600", btn: "bg-sky-600 hover:bg-sky-700" };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="sequence-confirm-dialog"
      data-tour-popup-occluding="sequence-confirm"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={request.onCancel} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent.bg}`}>
            {isDelete ? <IconTrash className={`h-5 w-5 ${accent.fg}`} /> : <IconPaste className={`h-5 w-5 ${accent.fg}`} />}
          </div>
          <h2 className="text-base font-semibold text-gray-900">{request.title}</h2>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-gray-700">{request.summary}</p>

          {request.affected && request.affected.length > 0 ? (
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                Affected features
              </p>
              <ul className="space-y-0.5">
                {request.affected.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between text-sm">
                    <span className="truncate text-gray-700">{f.name}</span>
                    <span
                      className={`ml-3 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        f.effect === "removed" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {f.effect === "removed" ? "removed" : "trimmed"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {request.note ? <p className="text-xs text-gray-500">{request.note}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <button
            type="button"
            onClick={request.onCancel}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={request.onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${accent.btn}`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
