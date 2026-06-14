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
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { defaultFundingStringForProject } from "@/lib/funding/prefill";
import CalmPopupShell from "@/components/ui/CalmPopupShell";

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

/**
 * F1 (Onboarding v4 §6.14 Purchases redesign 2026-05-22, Purchases
 * manager): item-name autocomplete with prior-item recall.
 *
 * Build the de-duped per-user prior-item list from `purchasesApi.listAll`.
 * The list keeps ONE entry per item-name (case-insensitive), pinning
 * the most-recent record so vendor + price reflect the latest order. The
 * autocomplete fires off the Item Name `change` event when the typed
 * value matches a remembered name exactly: vendor + price auto-fill,
 * quantity stays at the user default 1, funding-string stays unset.
 *
 * The list ships into a native `<datalist>` so the browser surfaces it
 * with no custom dropdown UI: matches the Funding String autocomplete
 * shape already in this modal. Onboarding's BeakerBot cursor types
 * "coff" and the datalist filters; the `purchases-autocomplete-demo`
 * step waits for the exact-match `change` event before advancing.
 */
interface PriorItemEntry {
  itemName: string;
  vendor: string | null;
  pricePerUnit: number;
  /** Most-recent purchase item id for this name (for stable React keys). */
  sourceId: number;
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
const ITEM_NAME_DATALIST_ID = "new-purchase-item-name-options";

/**
 * De-dupe prior PurchaseItems into one entry per (case-insensitive)
 * item_name. Within a name group, the entry with the LARGEST id wins
 * (proxy for "most recent" — PurchaseItem ids are monotonically
 * incrementing per user). The vendor + price on that entry are the
 * values surfaced to the user when the autocomplete fires.
 *
 * Names that are empty or whitespace-only are dropped: a blank
 * suggestion would clutter the datalist and never match anything
 * usefully.
 *
 * Exported so the NewPurchaseModal autocomplete test can pin the
 * dedupe contract directly without re-rendering the whole modal.
 */
export function buildPriorItemEntries(
  items: ReadonlyArray<{
    id: number;
    item_name: string;
    vendor: string | null;
    price_per_unit: number | null;
  }>,
): PriorItemEntry[] {
  // Group by lower-cased name, keep the entry whose id is the highest.
  const byKey = new Map<string, PriorItemEntry>();
  for (const item of items) {
    const trimmed = item.item_name?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const candidate: PriorItemEntry = {
      itemName: trimmed,
      vendor: item.vendor ?? null,
      pricePerUnit: item.price_per_unit ?? 0,
      sourceId: item.id,
    };
    const existing = byKey.get(key);
    if (!existing || existing.sourceId < candidate.sourceId) {
      byKey.set(key, candidate);
    }
  }
  // Return in alphabetical order so the datalist surface is stable
  // (browsers don't guarantee ordering preservation; alphabetical
  // matches how funding strings render below).
  return Array.from(byKey.values()).sort((a, b) =>
    a.itemName.localeCompare(b.itemName),
  );
}

/**
 * Reorder quick-pick (purchase-consolidate bot, 2026-06-02): the most
 * recently ordered distinct items, newest first, capped at `limit`.
 *
 * Reuses the exact same de-duped per-name entries that back the Item
 * Name datalist (no new data layer): `buildPriorItemEntries` already
 * keeps one entry per name pinned to its most-recent record (highest
 * id = newest, vendor + price reflect the latest order). Here we just
 * re-rank those entries by recency (descending sourceId) instead of
 * alphabetically and take the top few for a one-tap reorder row.
 *
 * Exported so the reorder-row test can pin the recency contract
 * without rendering the whole modal.
 */
export function buildRecentItemEntries(
  items: ReadonlyArray<{
    id: number;
    item_name: string;
    vendor: string | null;
    price_per_unit: number | null;
  }>,
  limit = 5,
): PriorItemEntry[] {
  return buildPriorItemEntries(items)
    .slice()
    .sort((a, b) => b.sourceId - a.sourceId)
    .slice(0, limit);
}

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
  // Funding-string prefill state (funding-niceties bot, 2026-05-28).
  // `fundingTouched` flips true once the user edits the Funding string field so
  // the project-grant default stops re-asserting itself (an explicit clear /
  // pick always wins). `lastAppliedFundingDefault` tracks the default we last
  // wrote so the render-time sync below only fires on a real change. Both reset
  // on each fresh open so a reopened modal re-defaults from the selected
  // project.
  const [fundingTouched, setFundingTouched] = useState(false);
  const [lastAppliedFundingDefault, setLastAppliedFundingDefault] = useState<
    string | null
  >(null);

  // Draft persistence: warn on navigation and survive accidental closes.
  // Key is per-user so two accounts on the same browser don't share drafts.
  const draftKey = `researchos:draft:new-purchase:${currentUser}`;
  const hasMeaningfulContent = form.name.trim().length > 0 || form.vendor.trim().length > 0 || form.fundingString.trim().length > 0;
  const { clearDraft } = useDraftPersistence(draftKey, form, hasMeaningfulContent, {
    onRestore: (saved) => {
      // Only restore if the modal is already open (it always is when mounted)
      // and the form is still at the initial empty state.
      setForm((prev) => {
        const isStillEmpty =
          !prev.name.trim() && !prev.vendor.trim() && !prev.fundingString.trim();
        return isStillEmpty ? saved : prev;
      });
    },
  });
  useUnsavedChangesGuard(hasMeaningfulContent && open);

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
  //
  // Draft-protection gate: skip the reset when the form already has
  // meaningful content. Two cases this covers:
  //   1. First mount with a sessionStorage draft — `useDraftPersistence`
  //      runs its onRestore synchronously during mount, hydrating the form
  //      before this effect fires. Without the gate the reset would clobber
  //      the restored draft on the very first open.
  //   2. Reopen after typing + closing without saving — the modal doesn't
  //      unmount (just renders null while `open` is false), so the form
  //      state carries the typed values into the next open. Same reset
  //      would silently nuke them.
  // When the form IS empty (no draft, no typed content) the reset still
  // runs to apply the optional `initial` seed and to clear any leftover
  // category default from a previous successful save.
  useEffect(() => {
    if (open) {
      setForm((prev) => {
        const isStillEmpty =
          !prev.name.trim() &&
          !prev.vendor.trim() &&
          !prev.fundingString.trim();
        if (isStillEmpty) {
          return { ...EMPTY_STATE, ...(initial ?? {}) };
        }
        return prev;
      });
      // A fresh open re-arms the funding prefill so the selected project's
      // grant can default the funding string again.
      setFundingTouched(false);
      setLastAppliedFundingDefault(null);
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

  // Escape closes via LivingPopup's built-in handler.

  // Existing funding accounts power the datalist autocomplete so the
  // user (and the cursor demo) can either pick an existing line or type
  // a new one. The cursor demo types "BeakerBot's allowance"; if no
  // account by that name exists, the save flow creates it.
  const { data: fundingAccounts = [] } = useQuery({
    queryKey: ["funding-accounts"],
    queryFn: () => purchasesApi.listFundingAccounts(),
    enabled: open,
  });

  // Funding-string prefill (funding-niceties bot, 2026-05-28). The Category
  // select doubles as the project picker here, so the selected real project's
  // primary grant link is the prefill source. "Miscellaneous" / unselected =>
  // no default. Resolve the project's `funding_account_id` to the grant NAME
  // (matches how funding_string resolves to an account).
  const selectedProjectFundingDefault = useMemo(() => {
    const parsed = Number.parseInt(form.category, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const project = userProjects.find((p) => p.id === parsed);
    return defaultFundingStringForProject(
      project?.funding_account_id,
      fundingAccounts,
    );
  }, [form.category, userProjects, fundingAccounts]);

  // Render-time prefill sync. When the selected project's resolved grant
  // default changes (the user picks a project, or funding accounts finish
  // loading) and the user has not touched the field, write the default into the
  // empty funding string. Setting state during render is the React-blessed
  // alternative to the effect+setState anti-pattern: React bails out of the
  // in-flight render and re-renders with the new value. Guarded on a value
  // change + emptiness so it never loops or clobbers a typed value.
  if (
    open &&
    !fundingTouched &&
    selectedProjectFundingDefault &&
    selectedProjectFundingDefault !== lastAppliedFundingDefault &&
    form.fundingString.trim().length === 0
  ) {
    setLastAppliedFundingDefault(selectedProjectFundingDefault);
    setForm((prev) =>
      prev.fundingString.trim().length === 0
        ? { ...prev, fundingString: selectedProjectFundingDefault }
        : prev,
    );
  }

  // F1 (§6.14 Purchases redesign 2026-05-22): prior PurchaseItems owned
  // by the current user, de-duped + sorted, used to seed the Item Name
  // datalist. Re-fires every time the modal opens so a save in the
  // previous open landing in the list is picked up on the next open.
  const { data: priorItemsRaw = [] } = useQuery({
    queryKey: ["purchases-all", currentUser, "prior-items"],
    queryFn: () => purchasesApi.listAll(),
    enabled: open,
  });
  const priorItems = useMemo(
    () => buildPriorItemEntries(priorItemsRaw),
    [priorItemsRaw],
  );
  // The most-recently-ordered distinct items, newest first. Powers the
  // one-tap reorder row above the Item Name field.
  const recentItems = useMemo(
    () => buildRecentItemEntries(priorItemsRaw),
    [priorItemsRaw],
  );

  // One-tap reorder: pre-fill name + vendor + price from a past item's
  // most-recent record. No typing. Mirrors the autocomplete's exact-match
  // prefill (quantity stays at the default 1; funding string stays
  // untouched so a re-bill can target a different grant).
  const applyReorder = useCallback((entry: PriorItemEntry) => {
    setForm((prev) => ({
      ...prev,
      name: entry.itemName,
      vendor: entry.vendor ?? prev.vendor,
      price: entry.pricePerUnit ? entry.pricePerUnit.toFixed(2) : prev.price,
    }));
  }, []);

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
      // Tracks the parent task once created so the catch block can roll it
      // back if the line-item create fails (otherwise we orphan a
      // purchase-typed task with no items).
      let createdTaskId: number | null = null;
      try {
        // 1. Ensure the funding-string row exists if the user typed
        //    one. Skipped when the field is blank — funding_string is
        //    nullable on PurchaseItem.
        // The authoritative FK to stamp on the line item (funding-rework,
        // 2026-06-08): resolve the typed label to an existing account id, or the
        // id of the one we create. Stays null if the label is blank or the
        // account create fails (the label still lands in funding_string).
        let fundingAccountId: number | null = null;
        const fundingTrimmed = form.fundingString.trim();
        if (fundingTrimmed) {
          const existing = fundingAccounts.find(
            (acc) => acc.name === fundingTrimmed,
          );
          if (existing) {
            fundingAccountId = existing.id;
          } else {
            try {
              const created = await purchasesApi.createFundingAccount({
                name: fundingTrimmed,
                total_budget: 0,
              });
              fundingAccountId = created.id;
            } catch (err) {
              // Non-fatal: the line item itself can still record the
              // string; the funding-account row exists for budget
              // tracking but isn't required for the PurchaseItem write.
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
        createdTaskId = task.id;

        // 3. Create the line item.
        const item = await purchasesApi.create({
          task_id: task.id,
          item_name: form.name.trim(),
          quantity: parseInt(form.quantity) || 1,
          price_per_unit: parseFloat(form.price) || 0,
          vendor: form.vendor.trim() || null,
          funding_account_id: fundingAccountId,
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

        clearDraft();
        onClose();
      } catch (err) {
        // Roll back a half-created purchase: if the parent task was created
        // but the line-item create (or a later step) threw, delete the task
        // so we don't leave a purchase-typed task with no items behind.
        if (createdTaskId !== null) {
          try {
            await tasksApi.delete(createdTaskId);
            await queryClient.refetchQueries({ queryKey: ["tasks"] });
            await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
            await queryClient.refetchQueries({ queryKey: ["projects"] });
          } catch (cleanupErr) {
            console.warn(
              "[new-purchase] failed to roll back orphaned task:",
              cleanupErr,
            );
          }
        }
        const msg =
          err instanceof Error ? err.message : "Failed to save purchase.";
        setError(msg);
      } finally {
        setSaving(false);
      }
    },
    [form, fundingAccounts, queryClient, onClose, currentUser, clearDraft],
  );

  // Scrim click / Escape / X close, but never mid-write (matches the old
  // guarded backdrop behaviour).
  const handleClose = () => {
    if (!saving) onClose();
  };

  return (
    // Unified Popup Chrome (UNIFIED_POPUP_CHROME_SPEC.md §1 Purchase): the quick
    // New Purchase modal adopts the shared shell. Single-view form, so no tab
    // row and no Focus toggle (it is a small fixed-size form, not an expandable
    // editor). Title "New Purchase" (no type chip, C3); Save lives in the shell
    // footer; Cancel stays reachable as the header ✕ (onClose = handleClose,
    // which never closes mid-write). The form still wraps the body so Enter
    // submits, and every input keeps its data-tour-target for the cursor demo.
    <CalmPopupShell
      open={open}
      onClose={handleClose}
      label="New purchase"
      title="New Purchase"
      expandable={false}
      dockedWidthClassName="max-w-md"
      footer={{
        doneLabel: saving ? "Saving..." : "Save",
        onDone: () => {
          if (!saving && form.name.trim()) void handleSave();
        },
        doneTourTarget: "purchases-form-submit",
      }}
    >
      <form
        onSubmit={handleSave}
        className="flex-1 overflow-y-auto px-6 py-4"
        data-tour-target="purchases-form"
      >
        {/* Hidden submit keeps native Enter-to-submit working now that the
            visible Save button lives in the shell footer outside this form. */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />

        {error && (
          <div className="mb-4 px-3 py-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg text-meta text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {recentItems.length > 0 && (
            <div data-tour-target="purchases-form-reorder">
              <p className="block text-meta font-medium text-foreground-muted mb-1.5">
                Reorder a recent item
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recentItems.map((entry) => (
                  <button
                    key={entry.sourceId}
                    type="button"
                    onClick={() => applyReorder(entry)}
                    title={
                      [
                        entry.vendor ? `from ${entry.vendor}` : null,
                        entry.pricePerUnit
                          ? `$${entry.pricePerUnit.toFixed(2)}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    className="inline-flex items-center max-w-[14rem] gap-1 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 text-meta font-medium hover:bg-amber-100 dark:hover:bg-amber-500/20 hover:border-amber-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    <svg
                      aria-hidden
                      className="w-3 h-3 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path d="M3 2v6h6" />
                      <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
                    </svg>
                    <span className="truncate">{entry.itemName}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Item Name
            </label>
            <input
              type="text"
              list={ITEM_NAME_DATALIST_ID}
              value={form.name}
              onChange={(e) => {
                const next = e.target.value;
                // F1: if the typed value matches a prior item exactly
                // (case-insensitive), auto-fill vendor + price. Quantity
                // stays at the user default 1; funding string stays
                // untouched (recurring purchases often re-bill against a
                // different grant). The save flow's `parseFloat(form.price)
                // || 0` keeps the pulled number well-typed regardless of
                // locale.
                const exact = priorItems.find(
                  (entry) =>
                    entry.itemName.toLowerCase() === next.trim().toLowerCase(),
                );
                if (exact) {
                  setForm((prev) => ({
                    ...prev,
                    name: exact.itemName,
                    vendor: exact.vendor ?? prev.vendor,
                    price: exact.pricePerUnit
                      ? exact.pricePerUnit.toFixed(2)
                      : prev.price,
                  }));
                } else {
                  handleField("name", next);
                }
              }}
              placeholder="e.g. 12-well plates"
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-amber-500 bg-surface-raised"
              autoFocus
              data-tour-target="purchases-form-name"
            />
            <datalist id={ITEM_NAME_DATALIST_ID}>
              {priorItems.map((entry) => (
                <option
                  key={entry.sourceId}
                  value={entry.itemName}
                  label={
                    [
                      entry.vendor ? `from ${entry.vendor}` : null,
                      entry.pricePerUnit
                        ? `$${entry.pricePerUnit.toFixed(2)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                />
              ))}
            </datalist>
            {priorItems.length > 0 && (
              <p className="text-meta text-foreground-muted mt-1">
                Pick a past item to fill in vendor and price automatically.
              </p>
            )}
          </div>

          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Vendor
            </label>
            <input
              type="text"
              value={form.vendor}
              onChange={(e) => handleField("vendor", e.target.value)}
              placeholder="e.g. Sigma-Aldrich"
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-amber-500 bg-surface-raised"
              data-tour-target="purchases-form-vendor"
            />
          </div>

          <div>
            <label
              htmlFor="new-purchase-category"
              className="block text-meta font-medium text-foreground-muted mb-1"
            >
              Category
            </label>
            <select
              id="new-purchase-category"
              value={form.category}
              onChange={(e) => handleField("category", e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-amber-500 bg-surface-raised"
              data-tour-target="purchases-form-category"
            >
              {userProjects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
              <option value={MISC_CATEGORY_LABEL}>{MISC_CATEGORY_LABEL}</option>
            </select>
            <p className="text-meta text-foreground-muted mt-1">
              Pick a project, or use Miscellaneous for one-off purchases
              like conference travel.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-1">
                Price per unit
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => handleField("price", e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-amber-500 bg-surface-raised"
                data-tour-target="purchases-form-price"
              />
            </div>
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-1">
                Quantity
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={form.quantity}
                onChange={(e) => handleField("quantity", e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-amber-500 bg-surface-raised"
                data-tour-target="purchases-form-quantity"
              />
            </div>
          </div>

          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Funding string
            </label>
            <input
              type="text"
              list={FUNDING_DATALIST_ID}
              value={form.fundingString}
              onChange={(e) => {
                // User edit wins over the project-grant prefill default
                // (funding-niceties bot, 2026-05-28).
                setFundingTouched(true);
                handleField("fundingString", e.target.value);
              }}
              placeholder="e.g. NIH-R01-12345"
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-amber-500 bg-surface-raised"
              data-tour-target="purchases-form-funding"
            />
            <datalist id={FUNDING_DATALIST_ID}>
              {fundingAccounts.map((acc) => (
                <option key={acc.id} value={acc.name} />
              ))}
            </datalist>
            <p className="text-meta text-foreground-muted mt-1">
              Pick an existing funding line or type a new one. New ones start
              at zero budget; configure them later.
            </p>
          </div>
        </div>
      </form>
    </CalmPopupShell>
  );
}
