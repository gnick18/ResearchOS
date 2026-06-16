"use client";

import { useCallback, useRef, useEffect, useState } from "react";
import { notebooksApi } from "@/lib/local-api";
import type { Notebook } from "@/lib/types";
import {
  NOTEBOOK_COLORS,
  SUBJECT_ICON_KEYS,
  SUBJECT_ICONS,
  type SubjectIconKey,
} from "./subject-icons";
import LivingPopup from "@/components/ui/LivingPopup";

interface NotebookAppearanceDialogProps {
  notebook: Notebook;
  onClose: () => void;
  onSaved: (notebook: Notebook) => void;
}

export default function NotebookAppearanceDialog({
  notebook,
  onClose,
  onSaved,
}: NotebookAppearanceDialogProps) {
  const [color, setColor] = useState<string | null>(notebook.color ?? null);
  const [icon, setIcon] = useState<SubjectIconKey | null>(
    (notebook.subject_icon as SubjectIconKey) ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstSwatchRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog on open.
  useEffect(() => {
    firstSwatchRef.current?.focus();
  }, []);

  const handleSave = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await notebooksApi.updateAppearance(notebook.id, {
        color: color ?? null,
        subject_icon: icon ?? null,
      });
      if (!updated) throw new Error("Notebook not found");
      onSaved(updated);
    } catch (err) {
      console.error("Failed to save appearance:", err);
      setError("Could not save. Please try again.");
      setBusy(false);
    }
  }, [busy, notebook.id, color, icon, onSaved]);

  return (
    <LivingPopup
      open
      onClose={onClose}
      label="Customize notebook"
      widthClassName="max-w-sm"
      card={false}
      showClose={false}
    >
      <div className="w-full rounded-xl bg-surface-raised shadow-xl">
        {/* Header */}
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-title font-semibold text-foreground">
            Customize notebook
          </h2>
          <p className="text-meta text-foreground-muted">
            {notebook.title?.trim() || "Untitled notebook"}
          </p>
        </div>

        <div className="flex flex-col gap-5 px-5 py-4">
          {/* Color picker */}
          <div className="flex flex-col gap-2">
            <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              Color
            </span>
            <div className="flex flex-wrap gap-2">
              {/* "None" swatch */}
              <button
                ref={firstSwatchRef}
                type="button"
                aria-label="No color"
                onClick={() => setColor(null)}
                className={`h-7 w-7 rounded-full border-2 bg-surface-sunken transition-all ${
                  color === null
                    ? "scale-110 border-foreground"
                    : "border-border hover:border-foreground-muted"
                }`}
              >
                <svg
                  viewBox="0 0 28 28"
                  className="h-full w-full text-foreground-muted"
                  aria-hidden="true"
                >
                  <line
                    x1="6"
                    y1="6"
                    x2="22"
                    y2="22"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              {NOTEBOOK_COLORS.map(({ hex, label }) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={label}
                  onClick={() => setColor(hex)}
                  className={`h-7 w-7 rounded-full border-2 transition-all ${
                    color === hex
                      ? "scale-110 border-foreground"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>

          {/* Subject icon picker */}
          <div className="flex flex-col gap-2">
            <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              Subject icon
            </span>
            <div className="grid grid-cols-4 gap-2">
              {SUBJECT_ICON_KEYS.map((key) => {
                const { label, Icon: SubIcon } = SUBJECT_ICONS[key];
                const isSelected = icon === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={label}
                    aria-pressed={isSelected}
                    onClick={() => setIcon(isSelected ? null : key)}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center transition-all ${
                      isSelected
                        ? "border-brand-action bg-brand-action/10 text-brand-action"
                        : "border-border text-foreground-muted hover:border-foreground-muted hover:text-foreground"
                    }`}
                  >
                    <SubIcon className="h-5 w-5" />
                    <span className="text-meta leading-tight">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-body text-red-500">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            data-testid="notebook-appearance-save"
            className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-lg px-4 py-2 text-body font-medium disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
