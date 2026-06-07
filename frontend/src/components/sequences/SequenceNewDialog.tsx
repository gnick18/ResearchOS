"use client";

// sequence entry-path bot — the calm "New sequence" dialog (the NEW flow of
// the entry path). Name + molecule type + an optional pasted raw sequence;
// leave the paste empty for a blank sequence to build up in the editor. Pasted
// bases are sanitized for the chosen molecule type (whitespace, line numbers,
// FASTA headers, and out-of-alphabet characters are dropped) before a GenBank
// record is built. Mirrors SequenceConfirmDialog's calm modal shell. No emojis
// (inline SVG only), no em-dashes.

import { useEffect, useMemo, useRef, useState } from "react";
import type { SeqType } from "@/lib/types";
import { sanitizeRawSequence } from "@/lib/sequences/import";

function IconPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export interface NewSequenceSubmit {
  name: string;
  seqType: SeqType;
  rawSequence: string;
  /** True when the user chose a blank sequence (no pasted bases). */
  allowEmpty: boolean;
}

export default function SequenceNewDialog({
  open,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (data: NewSequenceSubmit) => void;
}) {
  const [name, setName] = useState("");
  const [seqType, setSeqType] = useState<SeqType>("dna");
  const [raw, setRaw] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setName("");
      setSeqType("dna");
      setRaw("");
      // Defer focus until after the dialog paints.
      const t = setTimeout(() => nameRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  // Live preview of the cleaned length so the paste feels responsive + smart.
  const cleanedLength = useMemo(
    () => sanitizeRawSequence(raw, seqType).length,
    [raw, seqType],
  );

  if (!open) return null;

  const hasName = name.trim().length > 0;
  const unit = seqType === "protein" ? "residues" : "bp";

  const submit = (blank: boolean) => {
    onSubmit({
      name,
      seqType,
      rawSequence: blank ? "" : raw,
      allowEmpty: blank,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="sequence-new-dialog">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-surface-raised shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100">
            <IconPlus className="h-5 w-5 text-sky-600" />
          </div>
          <h2 className="text-title font-semibold text-foreground">New sequence</h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Name
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. pEGFP-N1 backbone"
              className="w-full rounded-md border border-border px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-meta font-medium uppercase tracking-wide text-foreground-muted">
              Type
            </label>
            <div className="flex items-center rounded-md border border-border p-0.5 text-body font-medium">
              {(["dna", "rna", "protein"] as SeqType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSeqType(t)}
                  className={`flex-1 rounded px-3 py-1.5 ${
                    seqType === t ? "bg-sky-600 text-white" : "text-foreground-muted hover:bg-surface-sunken"
                  }`}
                >
                  {t === "protein" ? "Protein" : t === "rna" ? "RNA" : "DNA"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-meta font-medium uppercase tracking-wide text-foreground-muted">
                Sequence (optional)
              </label>
              {raw.trim().length > 0 ? (
                <span className="text-meta text-foreground-muted">
                  {cleanedLength.toLocaleString()} {unit}
                </span>
              ) : null}
            </div>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={
                seqType === "protein"
                  ? "Paste residues (MKV...), or leave empty for a blank sequence"
                  : "Paste bases (ATCG...), or leave empty for a blank sequence"
              }
              rows={5}
              spellCheck={false}
              className="w-full rounded-md border border-border px-3 py-2 font-mono text-meta leading-relaxed text-foreground placeholder:font-sans placeholder:text-foreground-muted focus:border-sky-400 focus:outline-none"
            />
            <p className="mt-1 text-meta text-foreground-muted">
              Whitespace, line numbers, and characters outside the {seqType.toUpperCase()} alphabet are removed automatically.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-sunken px-4 py-3">
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={!hasName}
            className="rounded-lg px-3 py-2 text-body text-foreground-muted transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create blank
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-body text-foreground-muted transition-colors hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={!hasName || cleanedLength === 0}
              className="rounded-lg bg-sky-600 px-4 py-2 text-body font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create sequence
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
