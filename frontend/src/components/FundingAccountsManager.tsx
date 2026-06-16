"use client";

/**
 * FundingAccountsManager — extracted from `app/purchases/page.tsx`
 * (LabPurchases popup expansion manager, 2026-05-23).
 *
 * Why the extract: the lab-head LabPurchases popup needs the same
 * funding-accounts editor surface the regular `/purchases` page exposes.
 * Inlining the component twice would duplicate the create / edit / delete
 * mutations; lifting it to a standalone file lets both surfaces import
 * the canonical version.
 *
 * The create / edit-budget / delete flows all route through
 * `purchasesApi.{createFundingAccount,updateFundingAccount,deleteFundingAccount}`
 * and invalidate the `["funding-accounts"]` query key on each write.
 *
 * Structured grant metadata (metadata implementation bot, 2026-05-28): each
 * account gains a collapsible "Grant details (for data sharing / DOI)" group
 * — award number, funder name (datalist seeded with NIH + NSF), funder ID +
 * funder ID type, and an optional award title. These map 1:1 to the DataCite
 * fundingReference fields so a later DOI deposit is a direct copy. The
 * account's `name` stays the user-chosen label that purchases match on; the
 * award number is a separate structured value (the UI keeps them visually
 * distinct).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { purchasesApi } from "@/lib/local-api";
import type { FundingAccount, FunderIdType } from "@/lib/types";

interface FundingAccountsManagerProps {
  fundingAccounts: FundingAccount[];
}

const NIH_NAME = "National Institutes of Health";
const NSF_NAME = "National Science Foundation";
// Convenience auto-fill: NIH's canonical Crossref Funder ID.
const NIH_FUNDER_ID = "10.13039/100000002";

const FUNDER_ID_TYPES: Array<Exclude<FunderIdType, null>> = [
  "Crossref Funder ID",
  "ROR",
  "GRID",
  "ISNI",
  "Other",
];

// Editable shape for the grant-details group. Strings (never null) for the
// inputs; we map back to null on save when blank.
interface GrantDraft {
  award_number: string;
  funder_name: string;
  funder_id: string;
  funder_id_type: FunderIdType;
  award_title: string;
}

function toGrantDraft(acc: FundingAccount): GrantDraft {
  return {
    award_number: acc.award_number ?? "",
    funder_name: acc.funder_name ?? "",
    funder_id: acc.funder_id ?? "",
    funder_id_type: acc.funder_id_type ?? null,
    award_title: acc.award_title ?? "",
  };
}

function blankToNull(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

/**
 * NIH-style award numbers look like `5R01GM123456-03` (activity code +
 * institute + serial + suffix). This is a SOFT shape hint only — it never
 * blocks the save, it just nudges. Returns true when the value clearly
 * doesn't resemble that shape so we can show a gentle note.
 */
function looksUnlikeNihAward(awardNumber: string): boolean {
  const t = awardNumber.trim();
  if (t.length === 0) return false;
  // Very loose: an NIH-ish award has letters+digits and is reasonably long.
  // We only warn on obviously-too-short / all-one-class strings.
  const hasLetters = /[A-Za-z]/.test(t);
  const hasDigits = /\d/.test(t);
  return !(hasLetters && hasDigits) || t.length < 6;
}

/** Inline external-link / DOI icon (no emoji, no lucide). */
function DataSharingIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-foreground-muted"
    >
      <path d="M4 7V5a2 2 0 0 1 2-2h2" />
      <path d="M20 7V5a2 2 0 0 0-2-2h-2" />
      <path d="M4 17v2a2 2 0 0 0 2 2h2" />
      <path d="M20 17v2a2 2 0 0 1-2 2h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform ${open ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/**
 * The collapsible "Grant details" group. Used both in the per-account editor
 * and in the create form. Controlled: parent owns the draft + setter.
 */
function GrantDetailsGroup({
  draft,
  setDraft,
  idPrefix,
}: {
  draft: GrantDraft;
  setDraft: (next: GrantDraft) => void;
  idPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const datalistId = `${idPrefix}-funder-names`;

  const onFunderNameChange = (value: string) => {
    // Convenience auto-fill: choosing NIH seeds the Crossref Funder ID +
    // type when those fields are still empty, so the common case is
    // one-click. We only auto-fill when the id is blank so we never clobber
    // a value the user already typed.
    if (value === NIH_NAME && draft.funder_id.trim().length === 0) {
      setDraft({
        ...draft,
        funder_name: value,
        funder_id: NIH_FUNDER_ID,
        funder_id_type: "Crossref Funder ID",
      });
      return;
    }
    setDraft({ ...draft, funder_name: value });
  };

  return (
    <div className="mt-2 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-meta font-medium text-foreground-muted hover:text-foreground"
        aria-expanded={open}
      >
        <Chevron open={open} />
        <DataSharingIcon />
        Grant details (for data sharing / DOI)
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-meta text-foreground-muted mb-1">
                Award number
              </label>
              <input
                type="text"
                value={draft.award_number}
                onChange={(e) =>
                  setDraft({ ...draft, award_number: e.target.value })
                }
                className="w-full px-2.5 py-1.5 border border-border rounded text-body"
                placeholder="e.g. 5R01GM123456-03"
              />
              {looksUnlikeNihAward(draft.award_number) && (
                <p className="text-meta text-amber-600 dark:text-amber-300 mt-1">
                  NIH award numbers usually look like 5R01GM123456-03. This is
                  just a hint; any value is accepted.
                </p>
              )}
            </div>
            <div>
              <label className="block text-meta text-foreground-muted mb-1">
                Funder name
              </label>
              <input
                type="text"
                list={datalistId}
                value={draft.funder_name}
                onChange={(e) => onFunderNameChange(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-border rounded text-body"
                placeholder="e.g. National Institutes of Health"
              />
              <datalist id={datalistId}>
                <option value={NIH_NAME} />
                <option value={NSF_NAME} />
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-meta text-foreground-muted mb-1">
                Funder ID
              </label>
              <input
                type="text"
                value={draft.funder_id}
                onChange={(e) =>
                  setDraft({ ...draft, funder_id: e.target.value })
                }
                className="w-full px-2.5 py-1.5 border border-border rounded text-body"
                placeholder="e.g. 10.13039/100000002"
              />
            </div>
            <div>
              <label className="block text-meta text-foreground-muted mb-1">
                Funder ID type
              </label>
              <select
                value={draft.funder_id_type ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    funder_id_type:
                      e.target.value === ""
                        ? null
                        : (e.target.value as FunderIdType),
                  })
                }
                className="w-full px-2.5 py-1.5 border border-border rounded text-body bg-surface-raised"
              >
                <option value="">None</option>
                {FUNDER_ID_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-meta text-foreground-muted mb-1">
              Award title (optional)
            </label>
            <input
              type="text"
              value={draft.award_title}
              onChange={(e) =>
                setDraft({ ...draft, award_title: e.target.value })
              }
              className="w-full px-2.5 py-1.5 border border-border rounded text-body"
              placeholder="e.g. Mechanisms of fungal secondary metabolism"
            />
          </div>

          <p className="text-meta text-foreground-muted">
            The account name is your own label (what purchases match on); the
            award number is the official grant identifier. Both map to DataCite
            funding metadata for a later DOI deposit.
          </p>
        </div>
      )}
    </div>
  );
}

export default function FundingAccountsManager({
  fundingAccounts,
}: FundingAccountsManagerProps) {
  const [newName, setNewName] = useState("");
  const [newBudget, setNewBudget] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newGrant, setNewGrant] = useState<GrantDraft>({
    award_number: "",
    funder_name: "",
    funder_id: "",
    funder_id_type: null,
    award_title: "",
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBudget, setEditBudget] = useState("");
  const [editGrant, setEditGrant] = useState<GrantDraft>({
    award_number: "",
    funder_name: "",
    funder_id: "",
    funder_id_type: null,
    award_title: "",
  });
  const queryClient = useQueryClient();

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await purchasesApi.createFundingAccount({
        name: newName.trim(),
        total_budget: parseFloat(newBudget) || 0,
        description: newDescription.trim() || undefined,
        award_number: blankToNull(newGrant.award_number),
        funder_name: blankToNull(newGrant.funder_name),
        funder_id: blankToNull(newGrant.funder_id),
        funder_id_type: newGrant.funder_id_type,
        award_title: blankToNull(newGrant.award_title),
      });
      setNewName("");
      setNewBudget("");
      setNewDescription("");
      setNewGrant({
        award_number: "",
        funder_name: "",
        funder_id: "",
        funder_id_type: null,
        award_title: "",
      });
      queryClient.invalidateQueries({ queryKey: ["funding-accounts"] });
    } catch {
      alert("Failed to create funding account");
    }
  };

  const startEdit = (acc: FundingAccount) => {
    setEditingId(acc.id);
    setEditBudget(acc.total_budget.toString());
    setEditGrant(toGrantDraft(acc));
  };

  const handleSaveEdit = async (id: number) => {
    try {
      await purchasesApi.updateFundingAccount(id, {
        total_budget: parseFloat(editBudget) || 0,
        award_number: blankToNull(editGrant.award_number),
        funder_name: blankToNull(editGrant.funder_name),
        funder_id: blankToNull(editGrant.funder_id),
        funder_id_type: editGrant.funder_id_type,
        award_title: blankToNull(editGrant.award_title),
      });
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["funding-accounts"] });
    } catch {
      alert("Failed to update funding account");
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete funding account "${name}"? This will not delete associated purchases.`)) return;
    try {
      await purchasesApi.deleteFundingAccount(id);
      queryClient.invalidateQueries({ queryKey: ["funding-accounts"] });
    } catch {
      alert("Failed to delete funding account");
    }
  };

  return (
    <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
      <div className="p-4 border-b border-border bg-surface-sunken">
        <h3 className="text-body font-semibold text-foreground">Funding Accounts</h3>
        <p className="text-meta text-foreground-muted">Manage funding strings and budgets</p>
      </div>

      <div className="p-4">
        {/* Existing accounts */}
        <div className="space-y-2 mb-4">
          {fundingAccounts.map((acc) => (
            <div key={acc.id} className="p-3 bg-surface-sunken rounded-lg">
              {editingId === acc.id ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-body font-medium text-foreground">
                        {acc.name}
                      </p>
                      {acc.description && (
                        <p className="text-meta text-foreground-muted">
                          {acc.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-meta text-foreground-muted">Budget: $</span>
                      <input
                        type="number"
                        value={editBudget}
                        onChange={(e) => setEditBudget(e.target.value)}
                        className="w-24 px-2 py-1 border border-border rounded text-body"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  <GrantDetailsGroup
                    draft={editGrant}
                    setDraft={setEditGrant}
                    idPrefix={`edit-${acc.id}`}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2 py-1 text-meta text-foreground-muted hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSaveEdit(acc.id)}
                      className="ros-btn-raise px-3 py-1 text-meta bg-emerald-600 text-white rounded hover:bg-emerald-700"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-body font-medium text-foreground">
                      {acc.name}
                    </p>
                    {acc.description && (
                      <p className="text-meta text-foreground-muted">{acc.description}</p>
                    )}
                    {(acc.award_number || acc.funder_name) && (
                      <p className="text-meta text-foreground-muted mt-0.5">
                        {acc.award_number && (
                          <span>
                            Award{" "}
                            <span className="font-mono">{acc.award_number}</span>
                          </span>
                        )}
                        {acc.award_number && acc.funder_name && " · "}
                        {acc.funder_name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-body font-medium text-foreground">
                        ${acc.total_budget.toFixed(2)}
                      </p>
                      <p className="text-meta text-foreground-muted">budget</p>
                    </div>
                    <button
                      onClick={() => startEdit(acc)}
                      className="text-meta text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(acc.id, acc.name)}
                      className="text-meta text-red-600 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* New account form */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-meta text-foreground-muted mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-body"
                placeholder="e.g., GRANT-123-ABC"
              />
            </div>
            <div className="w-32">
              <label className="block text-meta text-foreground-muted mb-1">Budget</label>
              <input
                type="number"
                value={newBudget}
                onChange={(e) => setNewBudget(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-body"
                placeholder="0.00"
              />
            </div>
            <div className="flex-1">
              <label className="block text-meta text-foreground-muted mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-body"
                placeholder="e.g., NIH Grant for cancer research"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="ros-btn-raise px-4 py-2 bg-emerald-600 text-white rounded-lg text-body hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Account
            </button>
          </div>
          <GrantDetailsGroup
            draft={newGrant}
            setDraft={setNewGrant}
            idPrefix="new"
          />
        </div>
      </div>
    </div>
  );
}
