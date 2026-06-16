"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sharedNotebooksApi, usersApi } from "@/lib/local-api";
import LivingPopup from "@/components/ui/LivingPopup";
import type { SharedNotebook } from "@/lib/types";

// Shared Notebooks Phase 2 (notebooks-phase2 sub-bot, 2026-06-02). See
// docs/proposals/SHARED_NOTEBOOKS_PROPOSAL.md.
//
// The SETUP flow: a small modal that lets the current user (PI or member, no
// role gate) start a shared notebook with another lab member. The roster
// comes from `usersApi.list()` (the same active-member list the share dialog
// uses, archived + deleted users already filtered out); the current user is
// excluded so a notebook is always between two DISTINCT people. On confirm we
// call `sharedNotebooksApi.create`, which stamps both members into
// `shared_with` at "edit" so the picked person reaches the same notebook from
// their own Notes page.

interface StartSharedNotebookDialogProps {
  /** Usernames that already have a shared notebook with the current user, so the
   *  picker can flag a duplicate before the user creates a second one. */
  existingPartners: Set<string>;
  onClose: () => void;
  /** Fires with the freshly created notebook so the parent can select it. */
  onCreated: (notebook: SharedNotebook) => void;
}

const CLOSE_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const PEOPLE_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export default function StartSharedNotebookDialog({
  existingPartners,
  onClose,
  onCreated,
}: StartSharedNotebookDialogProps) {
  const [roster, setRoster] = useState<string[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [selected, setSelected] = useState<string>("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { users, current_user } = await usersApi.list();
        if (cancelled) return;
        // EXCLUDE self: a notebook is always between two distinct people.
        setRoster(users.filter((u) => u && u !== current_user).sort());
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
  }, []);

  const alreadyHas = useMemo(
    () => Boolean(selected) && existingPartners.has(selected),
    [selected, existingPartners],
  );

  const handleCreate = useCallback(async () => {
    if (!selected || creating) return;
    setCreating(true);
    setError(null);
    try {
      const trimmed = title.trim();
      const notebook = await sharedNotebooksApi.create({
        otherMember: selected,
        ...(trimmed ? { title: trimmed } : {}),
      });
      onCreated(notebook);
    } catch (err) {
      console.error("Failed to create shared notebook:", err);
      setError("Could not create the notebook. Please try again.");
      setCreating(false);
    }
  }, [selected, title, creating, onCreated]);

  return (
    <LivingPopup
      open
      onClose={onClose}
      label="Start a shared notebook"
      widthClassName="max-w-md"
      card={false}
      showClose={false}
    >
      <div className="w-full rounded-xl bg-surface-raised shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-brand-action">
              {PEOPLE_SVG}
            </span>
            <div>
              <h2 className="text-title font-semibold text-foreground">
                Start a shared notebook
              </h2>
              <p className="text-meta text-foreground-muted">
                A shared place for notes, shared with one or more lab
                members.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 rounded-lg p-1 text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground-muted"
          >
            {CLOSE_SVG}
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="notebook-partner"
              className="text-meta font-semibold uppercase tracking-wide text-foreground-muted"
            >
              Share with
            </label>
            {loadingRoster ? (
              <p className="text-body italic text-foreground-muted">Loading lab members…</p>
            ) : roster.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-surface-sunken/50 px-3 py-3 text-body text-foreground-muted">
                No other lab members yet. Invite someone to your data folder
                first.
              </p>
            ) : (
              <select
                id="notebook-partner"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                data-testid="notebook-partner-select"
                className="w-full rounded-lg border border-border px-3 py-2 text-body focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
              >
                <option value="">Pick a lab member…</option>
                {roster.map((u) => (
                  <option key={u} value={u}>
                    {u}
                    {existingPartners.has(u) ? "  (already shared)" : ""}
                  </option>
                ))}
              </select>
            )}
            {alreadyHas && (
              <p className="text-meta text-amber-600 dark:text-amber-400">
                You already share a notebook with {selected}. Creating another
                makes a second, separate shared notebook.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="notebook-title"
              className="text-meta font-semibold uppercase tracking-wide text-foreground-muted"
            >
              Title <span className="font-normal text-foreground-muted">(optional)</span>
            </label>
            <input
              id="notebook-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selected ? `Shared with ${selected}` : "e.g. Thesis notes"}
              data-testid="notebook-title-input"
              className="w-full rounded-lg border border-border px-3 py-2 text-body focus:border-brand-action focus:outline-none focus:ring-2 focus:ring-brand-action/30"
            />
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
            onClick={() => void handleCreate()}
            disabled={!selected || creating}
            data-testid="notebook-create-confirm"
            className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-lg px-4 py-2 text-body font-medium disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create notebook"}
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
