"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { purchasesApi, tasksApi, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  MISC_CATEGORY_LABEL,
  ensureMiscProject,
  isMiscProject,
} from "@/lib/purchases/misc-project";

/**
 * Quick "+ New Purchase" modal mounted from the /purchases page.
 *
 * Two-step product model (Task + PurchaseItem) collapsed into one form
 * for the common case: a single line item against a single
 * purchase-typed task. The Onboarding v4 §6.14 walkthrough demo drives
 * this modal end-to-end via the BeakerBot cursor, so every input that
 * the cursor types into carries a `data-tour-target` attribute.
 *
 * Save flow:
 *   1. Ensure the funding-string row exists. If the typed name doesn't
 *      match an existing FundingAccount, create one with budget 0 so
 *      future purchases pick it up from the dropdown / datalist on the
 *      inline PurchaseEditor row.
 *   2. Create the parent Task with `task_type: "purchase"`, the typed
 *      name, today's date, and a 1-day duration.
 *   3. Create the PurchaseItem line item under that task, capturing
 *      vendor + price + qty + funding_string.
 *   4. Dispatch `tour:purchase-created` with `{ taskId, itemId,
 *      fundingString }` so the v4 walkthrough step can capture the
 *      artifacts via its onEnter listener.
 *   5. Invalidate the React Query caches the /purchases page reads.
 *
 * Schema: no new types — the modal builds on `tasksApi.create` +
 * `purchasesApi.create` + `purchasesApi.createFundingAccount`, which
 * already exist.
 */

interface NewPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional initial values, used by the cursor demo so a refresh
   *  mid-step lands on a partially-filled form predictably. The
   *  walkthrough does not currently pass these; reserved for future
   *  resume-state work. */
  initial?: Partial<NewPurchaseFormState>;
}

interface NewPurchaseFormState {
  name: string;
  vendor: string;
  price: string;
  quantity: string;
  fundingString: string;
  /**
   * Category select value. Either the literal `MISC_CATEGORY_LABEL`
   * (string "Miscellaneous") to route the purchase under the hidden
   * `_misc_purchases` project, OR the stringified id of a real project
   * owned by the current user. Empty string means "no project chosen
   * yet" — the save flow falls back to MISC if the form is submitted
   * without picking, matching the design pick "default to first
   * non-misc project owned by the user, otherwise default to Misc".
   */
  category: string;
}

const EMPTY_STATE: NewPurchaseFormState = {
  name: "",
  vendor: "",
  price: "",
  quantity: "1",
  fundingString: "",
  category: "",
};

const FUNDING_DATALIST_ID = "new-purchase-funding-options";

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function NewPurchaseModal({
  open,
  onClose,
  initial,
}: NewPurchaseModalProps) {
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const [form, setForm] = useState<NewPurchaseFormState>(EMPTY_STATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Project list powers the Category select. Hidden projects are
  // intentionally NOT requested here: the picker offers real projects +
  // a synthetic "Miscellaneous" row that routes to the hidden misc
  // project under the hood. Filtered to current-user-owned projects so
  // shared projects don't appear as picker options (we never want to
  // attach a purchase to someone else's project from this surface).
  const { data: allProjects = [], isSuccess: projectsLoaded } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: () => fetchAllProjectsIncludingShared(),
    enabled: open,
  });
  const userProjects = useMemo(
    () =>
      allProjects.filter(
        (p) =>
          !p.is_archived &&
          !p.is_shared_with_me &&
          !isMiscProject(p) &&
          (currentUser === "" || p.owner === currentUser),
      ),
    [allProjects, currentUser],
  );

  // Reset to empty (or seeded) state when the modal opens. Avoids
  // stale-state when the user closes + reopens after a save.
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_STATE, ...(initial ?? {}) });
      setError(null);
    }
  }, [open, initial]);

  // Once projects have loaded, default the category select. Design pick:
  // first non-misc owned project if any exist, otherwise "Miscellaneous".
  // Gated on `projectsLoaded` so we don't briefly select "Miscellaneous"
  // off an empty pre-fetch list and then lock that choice in (the
  // user-already-picked guard below would otherwise refuse to reassign).
  // Skip if the user (or `initial`) already picked something.
  useEffect(() => {
    if (!open) return;
    if (!projectsLoaded) return;
    if (form.category) return;
    if (userProjects.length > 0) {
      setForm((prev) => ({ ...prev, category: String(userProjects[0].id) }));
    } else {
      setForm((prev) => ({ ...prev, category: MISC_CATEGORY_LABEL }));
    }
  }, [open, projectsLoaded, userProjects, form.category]);

  // Esc to close. Mounted only while the modal is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Existing funding accounts power the datalist autocomplete so the
  // user (and the cursor demo) can either pick an existing line or type
  // a new one. The cursor demo types "BeakerBot's allowance"; if no
  // account by that name exists, the save flow creates it.
  const { data: fundingAccounts = [] } = useQuery({
    queryKey: ["funding-accounts"],
    queryFn: () => purchasesApi.listFundingAccounts(),
    enabled: open,
  });

  const handleField = useCallback(
    <K extends keyof NewPurchaseFormState>(
      field: K,
      value: NewPurchaseFormState[K],
    ) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleSave = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!form.name.trim()) {
        setError("Item name is required.");
        return;
      }
      setSaving(true);
      setError(null);
      try {
        // 1. Ensure the funding-string row exists if the user typed
        //    one. Skipped when the field is blank — funding_string is
        //    nullable on PurchaseItem.
        const fundingTrimmed = form.fundingString.trim();
        if (fundingTrimmed) {
          const existing = fundingAccounts.find(
            (acc) => acc.name === fundingTrimmed,
          );
          if (!existing) {
            try {
              await purchasesApi.createFundingAccount({
                name: fundingTrimmed,
                total_budget: 0,
              });
            } catch (err) {
              // Non-fatal: the line item itself can still record the
              // string; the funding-account row exists for budget
              // tracking but isn't required for the PurchaseItem
              // foreign-key shape (funding_string is a free-form
              // column).
              console.warn(
                "[new-purchase] funding account create failed:",
                err,
              );
            }
          }
        }

        // 2a. Resolve the category selection into a `project_id` + an
        //     optional reserved category string. Two paths:
        //
        //     - "Miscellaneous": find-or-create the hidden
        //       `_misc_purchases` project for the current user; tag the
        //       PurchaseItem with the reserved category label so
        //       downstream filters (dashboards, search) can recognise
        //       misc items without a project lookup.
        //
        //     - a project id (string-encoded integer): route the new
        //       purchase task under that project. Leave PurchaseItem
        //       .category null — the project_id is the source of truth
        //       for project purchases.
        //
        //     If somehow nothing is selected (form opened with no
        //     projects loaded + user submitted before the default-set
        //     effect ran), fall back to Miscellaneous so the purchase
        //     still lands somewhere addressable instead of project_id=0.
        let projectId: number | undefined;
        let itemCategory: string | null = null;
        if (form.category === MISC_CATEGORY_LABEL || form.category === "") {
          if (!currentUser) {
            throw new Error(
              "Cannot create a Miscellaneous purchase without a logged-in user.",
            );
          }
          const miscProject = await ensureMiscProject(currentUser);
          projectId = miscProject.id;
          itemCategory = MISC_CATEGORY_LABEL;
        } else {
          const parsed = Number.parseInt(form.category, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            projectId = parsed;
          }
        }

        // 2b. Create the parent purchase task.
        const task = await tasksApi.create({
          name: form.name.trim(),
          start_date: todayLocal(),
          duration_days: 1,
          task_type: "purchase",
          ...(projectId !== undefined ? { project_id: projectId } : {}),
        });

        // 3. Create the line item.
        const item = await purchasesApi.create({
          task_id: task.id,
          item_name: form.name.trim(),
          quantity: parseInt(form.quantity) || 1,
          price_per_unit: parseFloat(form.price) || 0,
          vendor: form.vendor.trim() || null,
          funding_string: fundingTrimmed || null,
          category: itemCategory,
        });

        // 4. Dispatch the tour event. Detail carries the task + item
        //    ids + the funding string so the v4 walkthrough step's
        //    onEnter listener can stash the three artifacts (task,
        //    line item, funding string).
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("tour:purchase-created", {
              detail: {
                taskId: task.id,
                itemId: item.id,
                fundingString: fundingTrimmed || null,
              },
            }),
          );
        }

        // 5. Refresh the lists the /purchases page reads. `projects` is
        //    invalidated too so a freshly-created misc project surfaces
        //    on the next /purchases render (with `includeHidden: true`).
        await queryClient.refetchQueries({ queryKey: ["tasks"] });
        await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
        await queryClient.refetchQueries({ queryKey: ["funding-accounts"] });
        await queryClient.refetchQueries({ queryKey: ["projects"] });

        onClose();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to save purchase.";
        setError(msg);
      } finally {
        setSaving(false);
      }
    },
    [form, fundingAccounts, queryClient, onClose, currentUser],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Click outside the form closes — match the TaskModal click-
        // outside behaviour. Saving guard prevents accidental dismiss
        // mid-write.
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <form
        onSubmit={handleSave}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 p-6"
        data-tour-target="purchases-form"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          New Purchase
        </h3>

        {error && (
          <div className="mb-4 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Item Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleField("name", e.target.value)}
              placeholder="e.g. 12-well plates"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              autoFocus
              data-tour-target="purchases-form-name"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Vendor
            </label>
            <input
              type="text"
              value={form.vendor}
              onChange={(e) => handleField("vendor", e.target.value)}
              placeholder="e.g. Sigma-Aldrich"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              data-tour-target="purchases-form-vendor"
            />
          </div>

          <div>
            <label
              htmlFor="new-purchase-category"
              className="block text-xs font-medium text-gray-500 mb-1"
            >
              Category
            </label>
            <select
              id="new-purchase-category"
              value={form.category}
              onChange={(e) => handleField("category", e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
              data-tour-target="purchases-form-category"
            >
              {userProjects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
              <option value={MISC_CATEGORY_LABEL}>{MISC_CATEGORY_LABEL}</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Pick a project, or use Miscellaneous for one-off purchases
              like conference travel.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Price per unit
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => handleField("price", e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                data-tour-target="purchases-form-price"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Quantity
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={form.quantity}
                onChange={(e) => handleField("quantity", e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                data-tour-target="purchases-form-quantity"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Funding string
            </label>
            <input
              type="text"
              list={FUNDING_DATALIST_ID}
              value={form.fundingString}
              onChange={(e) => handleField("fundingString", e.target.value)}
              placeholder="e.g. NIH-R01-12345"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              data-tour-target="purchases-form-funding"
            />
            <datalist id={FUNDING_DATALIST_ID}>
              {fundingAccounts.map((acc) => (
                <option key={acc.id} value={acc.name} />
              ))}
            </datalist>
            <p className="text-xs text-gray-400 mt-1">
              Picks from your existing funding lines, or types a new
              one. New strings register as a budget-zero account you can
              configure later.
            </p>
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            data-tour-target="purchases-form-submit"
            className="px-4 py-2 text-sm text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
