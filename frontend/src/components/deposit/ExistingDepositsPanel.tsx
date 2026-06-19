"use client";

import { useCallback, useEffect, useState } from "react";
import { depositsApi } from "@/lib/local-api";
import type { Deposit } from "@/lib/types";
import { Icon } from "@/components/icons";

/**
 * "Your deposits" panel (edit-the-DOI-later, 2026-06-18). The guided deposit
 * flow writes a persistent Deposit record at hand-off, but a repository mints
 * the DOI minutes or days later on its own web page. This panel surfaces the
 * deposits already recorded for an experiment or project and lets the user add
 * or correct the DOI afterward, without re-running the whole deposit flow.
 *
 * Read-and-edit only. It never deposits anything itself.
 */

const REPO_LABEL: Record<Deposit["repository"], string> = {
  zenodo: "Zenodo",
  figshare: "Figshare",
  other: "a repository",
};

function doiHref(doi: string): string {
  const trimmed = doi.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://doi.org/${trimmed.replace(/^doi:/i, "")}`;
}

export default function ExistingDepositsPanel({
  taskId = null,
  projectId = null,
}: {
  taskId?: number | null;
  projectId?: number | null;
}) {
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await depositsApi.list();
      const mine = all.filter((d) => {
        if (taskId != null) return d.task_id === taskId;
        if (projectId != null) return d.project_id === projectId;
        return false;
      });
      // Newest first so the most recent deposit reads at the top.
      mine.sort((a, b) =>
        (b.deposited_at ?? b.created_at).localeCompare(a.deposited_at ?? a.created_at),
      );
      setDeposits(mine);
    } catch {
      setDeposits([]);
    }
  }, [taskId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!deposits || deposits.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface-sunken px-4 py-3">
      <div className="flex items-center gap-1.5 text-meta font-medium text-foreground-muted mb-2">
        <span className="text-green-600 dark:text-green-400">
          <Icon name="check" className="w-3.5 h-3.5" />
        </span>
        Your deposits
      </div>
      <ul className="flex flex-col gap-2.5">
        {deposits.map((d) => (
          <DepositRow key={d.id} deposit={d} onSaved={load} />
        ))}
      </ul>
    </div>
  );
}

function DepositRow({
  deposit,
  onSaved,
}: {
  deposit: Deposit;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(deposit.doi == null);
  const [draft, setDraft] = useState(deposit.doi ?? "");
  const [saving, setSaving] = useState(false);

  const repoLabel = REPO_LABEL[deposit.repository];
  const title = deposit.title?.trim() || "Untitled deposit";

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const next = draft.trim() || null;
      await depositsApi.update(deposit.id, { doi: next });
      setEditing(false);
      onSaved();
    } catch {
      // Leave the editor open so the value is not lost on a write failure.
    } finally {
      setSaving(false);
    }
  }, [draft, deposit.id, onSaved]);

  return (
    <li className="text-body">
      <div className="text-foreground line-clamp-1" title={title}>
        Deposited to {repoLabel}
      </div>
      <div className="text-meta text-foreground-muted line-clamp-1 mb-1" title={title}>
        {title}
      </div>
      {editing || !deposit.doi ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste the DOI once the repository mints it"
            data-testid="deposit-doi-input"
            className="flex-1 min-w-0 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-meta text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action/40"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            data-testid="deposit-doi-save"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-action px-2.5 py-1.5 text-meta font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Icon name="save" className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <a
            href={doiHref(deposit.doi as string)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="deposit-doi-link"
            className="text-meta text-brand-action hover:underline truncate"
          >
            {deposit.doi}
          </a>
          <button
            type="button"
            onClick={() => {
              setDraft(deposit.doi ?? "");
              setEditing(true);
            }}
            aria-label="Edit DOI"
            data-testid="deposit-doi-edit"
            className="inline-flex items-center gap-1 text-meta text-foreground-muted hover:text-foreground"
          >
            <Icon name="pencil" className="w-3.5 h-3.5" />
            Edit
          </button>
        </div>
      )}
    </li>
  );
}
