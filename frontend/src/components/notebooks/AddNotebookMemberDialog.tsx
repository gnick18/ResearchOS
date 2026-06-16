"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notebooksApi, usersApi } from "@/lib/local-api";
import LivingPopup from "@/components/ui/LivingPopup";
import type { Notebook } from "@/lib/types";
import { Icon } from "@/components/icons";

// Notebooks Generalization Phase 2 (notebooks-gen Phase 2 bot, 2026-06-06).
// The PROMOTION-FLIP flow (locked decision 5): adding a member to a notebook
// shares EVERY note already inside it with the new member. This dialog picks a
// member, then when the notebook already holds notes it shows a confirm warning
// BEFORE the flip so it is never a surprise. Wired to `notebooksApi.addMember`
// only after the user confirms.

interface AddNotebookMemberDialogProps {
  notebook: Notebook;
  /** How many notes currently live in this notebook (drives the flip warning). */
  noteCount: number;
  onClose: () => void;
  onAdded: (notebook: Notebook) => void;
}

const CLOSE_SVG = <Icon name="close" className="h-[18px] w-[18px]" />;
const ADD_PERSON_SVG = <Icon name="userPlus" className="h-[18px] w-[18px]" />;

export default function AddNotebookMemberDialog({
  notebook,
  noteCount,
  onClose,
  onAdded,
}: AddNotebookMemberDialogProps) {
  const [roster, setRoster] = useState<string[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [selected, setSelected] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { users, current_user } = await usersApi.list();
        if (cancelled) return;
        // Exclude self + anyone already a member of this notebook.
        const existing = new Set(notebook.members);
        setRoster(
          users
            .filter((u) => u && u !== current_user && !existing.has(u))
            .sort(),
        );
      } catch (err) {
        console.error("Failed to load lab roster:", err);
        if (!cancelled) setError("Could not load the lab roster.");
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notebook.members]);

  const hasNotes = noteCount > 0;

  const noteLabel = useMemo(
    () => (noteCount === 1 ? "1 note" : `${noteCount} notes`),
    [noteCount],
  );

  const handleAdd = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await notebooksApi.addMember(notebook.id, selected);
      if (!updated) throw new Error("Notebook not found");
      onAdded(updated);
    } catch (err) {
      console.error("Failed to add member:", err);
      setError("Could not add the member. Please try again.");
      setBusy(false);
    }
  }, [selected, busy, notebook.id, onAdded]);

  // Primary action: if the notebook holds notes and we have not yet shown the
  // flip confirm, surface it first; otherwise add the member.
  const handlePrimary = useCallback(() => {
    if (!selected) return;
    if (hasNotes && !confirming) {
      setConfirming(true);
      return;
    }
    void handleAdd();
  }, [selected, hasNotes, confirming, handleAdd]);

  return (
    <LivingPopup
      open
      onClose={onClose}
      label="Add a member"
      widthClassName="max-w-md"
      card={false}
      showClose={false}
    >
      <div className="w-full rounded-xl bg-surface-raised shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-brand-action">
              {ADD_PERSON_SVG}
            </span>
            <div>
              <h2 className="text-title font-semibold text-foreground">
                Add a member
              </h2>
              <p className="text-meta text-foreground-muted">
                {notebook.title?.trim()
                  ? notebook.title
                  : "Share this notebook with another lab member."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 rounded-lg p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            {CLOSE_SVG}
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="notebook-add-member"
              className="text-meta font-semibold uppercase tracking-wide text-foreground-muted"
            >
              Share with
            </label>
            {loadingRoster ? (
              <p className="text-body italic text-foreground-muted">
                Loading lab members…
              </p>
            ) : roster.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-surface-sunken/50 px-3 py-3 text-body text-foreground-muted">
                No other lab members available. Everyone is already in this
                notebook, or you have not invited anyone to your data folder
                yet.
              </p>
            ) : (
              <select
                id="notebook-add-member"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setConfirming(false);
                }}
                data-testid="notebook-add-member-select"
                className="w-full rounded-lg border border-border px-3 py-2 text-body focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
              >
                <option value="">Pick a lab member…</option>
                {roster.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
          </div>

          {confirming && selected && (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-body text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
              data-testid="notebook-flip-warning"
            >
              Adding {selected} shares every note currently in this notebook
              ({noteLabel}) with them. They will be able to read and edit those
              notes. Continue?
            </div>
          )}

          {error && <p className="text-body text-red-500">{error}</p>}
        </div>

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
            onClick={handlePrimary}
            disabled={!selected || busy}
            data-testid="notebook-add-member-confirm"
            className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-lg px-4 py-2 text-body font-medium disabled:opacity-40"
          >
            {busy
              ? "Adding…"
              : confirming
                ? `Share with ${selected}`
                : hasNotes
                  ? "Continue"
                  : "Add member"}
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
