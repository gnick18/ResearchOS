"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { labApi, projectsApi as rawProjectsApi, tasksApi } from "@/lib/local-api";
import { defaultFundingStringForProject } from "@/lib/funding/prefill";
import SharingChips from "@/components/sharing/SharingChips";
import { ownerScopedPurchasesApi } from "@/lib/purchases/owner-scoped-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLabHeadEditGate } from "@/hooks/useLabHeadEditGate";
import RequestEditButton from "@/components/RequestEditButton";
import EditSessionBanner from "@/components/EditSessionBanner";
import AuditTrailNotice from "@/components/AuditTrailNotice";
import {
  PurchaseApprovalToggle,
  PurchaseApprovalBadge,
  PurchaseDeclinedBadge,
} from "@/components/lab-head/PurchaseApprovalControls";
import FlagForReviewButton from "@/components/lab-head/FlagForReviewButton";
import PurchaseAssigneePicker from "@/components/PurchaseAssigneePicker";
import PurchaseOrderStatusControl from "@/components/PurchaseOrderStatusControl";
import BuyAgainButton from "@/components/BuyAgainButton";
import Tooltip from "@/components/Tooltip";
import { normalizeOrderStatus } from "@/lib/types";
import type { CatalogItem, PurchaseItem, Task } from "@/lib/types";

interface PurchaseEditorProps {
  taskId: number;
  readOnly?: boolean; // When true, all editing is disabled (for lab mode)
  username?: string; // When provided, fetch from this user's data (for lab mode)
  // Optional. When the parent passes the task's type and it's NOT "purchase",
  // a soft inline note appears above the line-item table flagging that items
  // added here will land in the spending dashboard's "Items on non-purchase
  // tasks" line. Informational only — does not block editing. Callers that
  // omit this prop (e.g. LabPurchasesPanel) suppress the note entirely.
  taskType?: Task["task_type"];
  // When true the task is shared INTO the current user. Mirrors the parent
  // /purchases page destructive-gate at a87dfeb0: purchasesApi.create /
  // update / delete are current-user scoped (no owner arg) so writes from a
  // shared task would land in the receiver's data dir under the same
  // numeric task_id — clobbering or orphaning items. Disable every write
  // affordance with an owner-aware Tooltip; items stay viewable.
  isSharedWithMe?: boolean;
  // Owner username shown in the disabled-button tooltip when shared.
  // Falls back to "the owner" when omitted.
  ownerLabel?: string;
}

interface EditingRow {
  item_name: string;
  quantity: string;
  link: string;
  cas: string;
  price_per_unit: string;
  shipping_fees: string;
  notes: string;
  funding_string: string;
  vendor: string;
  category: string;
}

const EMPTY_ROW: EditingRow = {
  item_name: "",
  quantity: "",
  link: "",
  cas: "",
  price_per_unit: "",
  shipping_fees: "",
  notes: "",
  funding_string: "",
  vendor: "",
  category: "",
};

function itemToEditingRow(item: PurchaseItem): EditingRow {
  return {
    item_name: item.item_name,
    quantity: item.quantity.toString(),
    link: item.link || "",
    cas: item.cas || "",
    price_per_unit: (item.price_per_unit ?? 0).toString(),
    shipping_fees: (item.shipping_fees ?? 0).toString(),
    notes: item.notes || "",
    funding_string: item.funding_string || "",
    vendor: item.vendor || "",
    category: item.category || "",
  };
}

const VENDOR_DATALIST_ID = "purchase-editor-vendor-options";
const CATEGORY_DATALIST_ID = "purchase-editor-category-options";

export default function PurchaseEditor({
  taskId,
  readOnly: propReadOnly = false,
  username,
  taskType,
  isSharedWithMe = false,
  ownerLabel,
}: PurchaseEditorProps) {
  const queryClient = useQueryClient();
  // Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): gate the
  // prop-passed readOnly behind the PI edit-mode session. When unlocked,
  // writes become available + a banner shows in the editor header.
  //
  // Lab Head Phase 5 R1 (lab head Phase 5 R1 manager, 2026-05-23): writes
  // now route to the OWNER's purchase_items folder via
  // `ownerScopedPurchasesApi`, not the PI's. Closes the silent-data-
  // corruption gap Phase 5 deferred. When the session is NOT unlocked
  // (or any session arg is missing) the wrapper falls through to the raw
  // purchasesApi — current-user behavior is unchanged for members and
  // PIs editing their own data.
  const labHeadGate = useLabHeadEditGate({
    readOnly: propReadOnly,
    recordOwner: username ?? null,
  });
  const readOnly = labHeadGate.effectiveReadOnly;
  const purchasesApi = useMemo(
    () =>
      ownerScopedPurchasesApi({
        targetOwner: labHeadGate.unlocked ? username : undefined,
        actor: labHeadGate.unlocked ? labHeadGate.activeUser : undefined,
        sessionId: labHeadGate.unlocked ? labHeadGate.sessionId : undefined,
      }),
    [
      labHeadGate.unlocked,
      labHeadGate.activeUser,
      labHeadGate.sessionId,
      username,
    ],
  );
  // Catalog/funding mutations + autocomplete queries call the raw API
  // unconditionally — they target the PI's own catalog/funding, never the
  // owner's. Lab-head purchase edits only touch line items.
  // Writes are blocked when the host marks the editor as read-only (lab
  // mode) OR when the task is shared into the current user. Used to gate
  // buttons, hide the new-row input, and skip the autocomplete query.
  const writesDisabled = readOnly || isSharedWithMe;
  const sharedTooltip = `Only the owner${ownerLabel ? ` (${ownerLabel})` : ""} can edit this shared purchase order`;

  // R1b: pull the parent task's shared_with for the SharingChips
  // row. The chip set is read-only so a lightweight query is enough;
  // failure renders no chips (graceful).
  const { data: parentTask } = useQuery({
    queryKey: ["task-shared-with", taskId, username],
    queryFn: () => tasksApi.get(taskId, username ?? undefined),
    enabled: !!taskId,
  });
  const [newRow, setNewRow] = useState<EditingRow>({ ...EMPTY_ROW });
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<CatalogItem | null>(null);
  const [overwriteDialog, setOverwriteDialog] = useState<{
    field: string;
    catalogItem: CatalogItem;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const suggestionsRef = useRef<HTMLTableCellElement>(null);
  
  // Editing state for existing items
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingRow, setEditingRow] = useState<EditingRow>({ ...EMPTY_ROW });
  const [editSuggestions, setEditSuggestions] = useState<CatalogItem[]>([]);
  const [showEditSuggestions, setShowEditSuggestions] = useState(false);
  const [, setEditSelectedCatalogItem] = useState<CatalogItem | null>(null);
  const editSuggestionsRef = useRef<HTMLTableCellElement>(null);

  const { data: items = [], refetch } = useQuery({
    queryKey: ["purchases", taskId, username],
    queryFn: () => {
      // If username is provided (lab mode), use lab API
      if (username) {
        return labApi.getUserPurchaseItems(username, taskId);
      }
      // Otherwise use regular purchases API
      return purchasesApi.listByTask(taskId);
    },
  });

  // Fetch funding accounts for the dropdown
  const { data: fundingAccounts = [] } = useQuery({
    queryKey: ["funding-accounts"],
    queryFn: () => purchasesApi.listFundingAccounts(),
  });

  // Funding-string prefill (funding-niceties bot, 2026-05-28). Load the parent
  // task's project so a new purchase can default its funding string to the
  // project's PRIMARY grant link (Project.funding_account_id). Read-only: this
  // is a default the user can change or clear, never a stored value. Routed
  // through the same `username` owner hint the task read uses so shared-project
  // tasks resolve the project from the owner's directory.
  const projectId = parentTask?.project_id ?? null;
  const { data: parentProject } = useQuery({
    queryKey: ["purchase-editor-project", projectId, username],
    queryFn: () =>
      projectId != null
        ? rawProjectsApi.get(projectId, username ?? undefined)
        : Promise.resolve(null),
    enabled: projectId != null,
  });
  // The primary grant's NAME (matches how funding_string resolves to an
  // account). null when the project is unlinked or its grant was deleted.
  const projectFundingDefault = useMemo(
    () =>
      defaultFundingStringForProject(
        parentProject?.funding_account_id,
        fundingAccounts,
      ),
    [parentProject?.funding_account_id, fundingAccounts],
  );
  // Funding-string prefill state (funding-niceties bot, 2026-05-28).
  // `fundingTouched` flips true once the user edits the funding <select> so the
  // prefill stops re-asserting the default (and never fights an explicit
  // clear). `lastAppliedFundingDefault` tracks the default we last wrote so the
  // render-time sync below only fires when the resolved default actually
  // changes (mirrors OverviewSection's "store info from previous renders"
  // pattern, which the lint rules permit because it runs in render, not an
  // effect). Both reset when the new row resets after a successful add.
  const [fundingTouched, setFundingTouched] = useState(false);
  const [lastAppliedFundingDefault, setLastAppliedFundingDefault] = useState<
    string | null
  >(null);

  // Render-time prefill sync. When the resolved project default changes (the
  // project loads, or its grant link changes) and the user has not touched the
  // field, write the default into the empty new-row funding string. Setting
  // state during render is the React-blessed alternative to the effect+setState
  // anti-pattern: React bails out of the in-flight render and re-renders with
  // the new value, no extra commit / flash. Guarded on a value change so it
  // does not loop. Skipped entirely in read-only / shared contexts (no new
  // row is rendered there).
  if (
    !writesDisabled &&
    !fundingTouched &&
    projectFundingDefault &&
    projectFundingDefault !== lastAppliedFundingDefault &&
    newRow.funding_string.trim().length === 0
  ) {
    setLastAppliedFundingDefault(projectFundingDefault);
    setNewRow((prev) =>
      prev.funding_string.trim().length === 0
        ? { ...prev, funding_string: projectFundingDefault }
        : prev,
    );
  }

  // Autocomplete sources for vendor + category come from the same merged-view
  // dataset the /purchases page already fetches. Reusing the queryKey lets
  // React Query share the cache instead of double-fetching. Skipped in lab
  // (read-only) mode — autocomplete is only relevant when the user can type.
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";
  const { data: autocompleteItems = [] } = useQuery({
    queryKey: ["purchases-all", currentUser],
    queryFn: () => purchasesApi.listAllIncludingShared(currentUser),
    enabled: !writesDisabled && !!currentUser,
  });
  const vendorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of autocompleteItems) {
      if (item.vendor) set.add(item.vendor);
    }
    return [...set].sort();
  }, [autocompleteItems]);
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of autocompleteItems) {
      if (item.category) set.add(item.category);
    }
    return [...set].sort();
  }, [autocompleteItems]);

  // Search catalog as user types item name
  useEffect(() => {
    const q = newRow.item_name.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await purchasesApi.searchCatalog(q);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [newRow.item_name, purchasesApi]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
      if (
        editSuggestionsRef.current &&
        !editSuggestionsRef.current.contains(e.target as Node)
      ) {
        setShowEditSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Search catalog as user types in edit row
  useEffect(() => {
    const q = editingRow.item_name.trim();
    if (q.length < 2) {
      setEditSuggestions([]);
      setShowEditSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await purchasesApi.searchCatalog(q);
        setEditSuggestions(results);
        setShowEditSuggestions(results.length > 0);
      } catch {
        setEditSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [editingRow.item_name, purchasesApi]);

  const handleSelectSuggestion = useCallback((cat: CatalogItem) => {
    setNewRow((prev) => ({
      ...prev,
      item_name: cat.item_name,
      link: cat.link || "",
      cas: cat.cas || "",
      price_per_unit: cat.price_per_unit.toString(),
    }));
    setSelectedCatalogItem(cat);
    setShowSuggestions(false);
  }, []);

  const handleSelectEditSuggestion = useCallback((cat: CatalogItem) => {
    setEditingRow((prev) => ({
      ...prev,
      item_name: cat.item_name,
      link: cat.link || "",
      cas: cat.cas || "",
      price_per_unit: cat.price_per_unit.toString(),
    }));
    setEditSelectedCatalogItem(cat);
    setShowEditSuggestions(false);
  }, []);

  const handleStartEdit = useCallback((item: PurchaseItem) => {
    setEditingItemId(item.id);
    setEditingRow(itemToEditingRow(item));
    setEditSelectedCatalogItem(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingItemId(null);
    setEditingRow({ ...EMPTY_ROW });
    setEditSelectedCatalogItem(null);
  }, []);

  const handleEditFieldChange = useCallback(
    (field: keyof EditingRow, value: string) => {
      setEditingRow((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editingItemId || !editingRow.item_name.trim()) return;
    setSaving(true);
    try {
      const newPayload = {
        item_name: editingRow.item_name.trim(),
        quantity: parseInt(editingRow.quantity) || 1,
        link: editingRow.link.trim() || null,
        cas: editingRow.cas.trim() || null,
        price_per_unit: parseFloat(editingRow.price_per_unit) || 0,
        shipping_fees: parseFloat(editingRow.shipping_fees) || 0,
        notes: editingRow.notes.trim() || null,
        funding_string: editingRow.funding_string.trim() || null,
        vendor: editingRow.vendor.trim() || null,
        category: editingRow.category.trim() || null,
      };
      // Phase 5 R1: purchasesApi is owner-scoped — write routes to the
      // owner's purchase_items folder + audit entries emitted automatically
      // when a PI edit session is unlocked.
      await purchasesApi.update(editingItemId, newPayload);

      setEditingItemId(null);
      setEditingRow({ ...EMPTY_ROW });
      setEditSelectedCatalogItem(null);
      refetch();
      await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
      await queryClient.refetchQueries({ queryKey: ["funding-accounts"] });
    } catch {
      alert("Failed to update item");
    } finally {
      setSaving(false);
    }
  }, [
    editingItemId,
    editingRow,
    refetch,
    queryClient,
    purchasesApi,
  ]);

  const handleFieldChange = useCallback(
    (field: keyof EditingRow, value: string) => {
      setNewRow((prev) => ({ ...prev, [field]: value }));

      // Check if user changed link, cas, or price_per_unit after selecting from catalog
      if (
        selectedCatalogItem &&
        (field === "link" || field === "cas" || field === "price_per_unit")
      ) {
        const originalValue =
          field === "link"
            ? selectedCatalogItem.link || ""
            : field === "cas"
            ? selectedCatalogItem.cas || ""
            : selectedCatalogItem.price_per_unit.toString();

        if (value !== originalValue && value.trim() !== "") {
          // Will show dialog on save
        }
      }
    },
    [selectedCatalogItem]
  );

  const computeTotal = useCallback((row: EditingRow): string => {
    const qty = parseInt(row.quantity) || 0;
    const ppu = parseFloat(row.price_per_unit) || 0;
    const ship = parseFloat(row.shipping_fees) || 0;
    return (qty * ppu + ship).toFixed(2);
  }, []);

  const doAddRow = useCallback(async (rowData: EditingRow) => {
    try {
      await purchasesApi.create({
        task_id: taskId,
        item_name: rowData.item_name.trim(),
        quantity: parseInt(rowData.quantity) || 1,
        link: rowData.link.trim() || null,
        cas: rowData.cas.trim() || null,
        price_per_unit: parseFloat(rowData.price_per_unit) || 0,
        shipping_fees: parseFloat(rowData.shipping_fees) || 0,
        notes: rowData.notes.trim() || null,
        funding_string: rowData.funding_string.trim() || null,
        vendor: rowData.vendor.trim() || null,
        category: rowData.category.trim() || null,
      });
      setNewRow({ ...EMPTY_ROW });
      setSelectedCatalogItem(null);
      // Re-arm the funding prefill so the next item re-defaults to the
      // project's primary grant (funding-niceties bot, 2026-05-28).
      setFundingTouched(false);
      setLastAppliedFundingDefault(null);
      refetch();
      await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
      await queryClient.refetchQueries({ queryKey: ["funding-accounts"] });
    } catch {
      alert("Failed to add item");
    } finally {
      setSaving(false);
    }
  }, [taskId, refetch, queryClient, purchasesApi]);

  const handleAddRow = useCallback(async () => {
    if (!newRow.item_name.trim() || !newRow.quantity) return;
    setSaving(true);

    // Check if catalog item was modified
    if (selectedCatalogItem) {
      const linkChanged =
        newRow.link !== (selectedCatalogItem.link || "") && newRow.link.trim() !== "";
      const casChanged =
        newRow.cas !== (selectedCatalogItem.cas || "") && newRow.cas.trim() !== "";
      const priceChanged =
        newRow.price_per_unit !== selectedCatalogItem.price_per_unit.toString() &&
        newRow.price_per_unit.trim() !== "";

      if (linkChanged || casChanged || priceChanged) {
        setOverwriteDialog({
          field: [
            linkChanged ? "Link" : "",
            casChanged ? "CAS" : "",
            priceChanged ? "Price" : "",
          ]
            .filter(Boolean)
            .join(", "),
          catalogItem: selectedCatalogItem,
        });
        setSaving(false);
        return;
      }
    }

    await doAddRow(newRow);
  }, [newRow, selectedCatalogItem, doAddRow]);

  const handleOverwriteChoice = useCallback(
    async (choice: "overwrite" | "new") => {
      if (!overwriteDialog) return;
      setSaving(true);

      if (choice === "overwrite") {
        try {
          await purchasesApi.updateCatalogItem(overwriteDialog.catalogItem.id, {
            item_name: newRow.item_name.trim(),
            link: newRow.link.trim() || null,
            cas: newRow.cas.trim() || null,
            price_per_unit: parseFloat(newRow.price_per_unit) || 0,
          });
        } catch {
          alert("Failed to update catalog");
        }
      } else {
        try {
          await purchasesApi.createCatalogItem({
            item_name: newRow.item_name.trim(),
            link: newRow.link.trim() || null,
            cas: newRow.cas.trim() || null,
            price_per_unit: parseFloat(newRow.price_per_unit) || 0,
          });
        } catch {
          alert("Failed to create catalog item");
        }
      }

      setOverwriteDialog(null);
      await doAddRow(newRow);
    },
    [overwriteDialog, newRow, doAddRow, purchasesApi]
  );

  const handleDeleteItem = useCallback(
    async (id: number) => {
      try {
        await purchasesApi.delete(id);
        refetch();
        await queryClient.refetchQueries({ queryKey: ["purchases-all"] });
      } catch {
        alert("Failed to delete item");
      }
    },
    [refetch, queryClient, purchasesApi]
  );

  const taskTotal = items.reduce((sum, i) => sum + (i.total_price ?? 0), 0);

  return (
    <div className="p-4">
      {/* R1b: sharing chips — read-only visibility hint row for the
          parent purchase task. */}
      {parentTask && (
        <div className="mb-2">
          <SharingChips
            sharedWith={parentTask.shared_with || []}
            ownerUsername={parentTask.owner}
            viewerUsername={currentUser ?? undefined}
          />
        </div>
      )}

      {/* PI Phase 5 (PI Phase 5 manager, 2026-05-23):
          unlocked-session timer banner for the purchase editor. */}
      {labHeadGate.unlocked && labHeadGate.activeUser && (
        <div className="-mx-4 -mt-4 mb-3">
          <EditSessionBanner
            contextLabel={`${username ?? "lab member"}'s purchases`}
            scopedToUsername={labHeadGate.activeUser}
          />
        </div>
      )}

      {/* PI Phase 5 — Request edit prompt for the purchase editor.
          Renders as a row above the table when PI is viewing another
          member's purchase items but hasn't unlocked yet. */}
      {labHeadGate.canRequestEdit && !labHeadGate.unlocked && labHeadGate.activeUser && (
        <div className="mb-3 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-meta text-gray-700">
          <span>
            Read-only view of {username ?? "lab member"}&apos;s purchase items.
            Unlock edit mode to make changes (attributed to you in the audit log).
          </span>
          <RequestEditButton
            username={labHeadGate.activeUser}
            targetLabel={`${username ?? "member"}'s purchases`}
          />
        </div>
      )}

      {/* PI Phase 5 — record-level audit trail for the parent task
          (purchase items are scoped to a task; the task's audit entries
          cover the editor surface). */}
      {propReadOnly && username && (
        <div className="mb-3">
          <AuditTrailNotice
            targetUser={username}
            recordType="task"
            recordId={taskId}
          />
        </div>
      )}

      {/* Non-purchase-task warning — informational only (PURCHASES_PAGE_PROPOSAL.md
          §5 Path 2 / locked decision Q4). Editor still renders normally; the
          dashboard's "Items on non-purchase tasks" line is the formal surface. */}
      {taskType && taskType !== "purchase" && (
        <div className="mb-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-meta text-yellow-800">
          This task is not typed as a purchase order. Items added here will
          appear in the spending dashboard&apos;s &ldquo;Items on non-purchase
          tasks&rdquo; line.
        </div>
      )}

      {/* Autocomplete sources for vendor + category inputs. Distinct non-null
          values across the current user's own + shared-visible purchase items.
          Empty list (first user, no past values) renders as a plain input — no
          error state. */}
      <datalist id={VENDOR_DATALIST_ID}>
        {vendorOptions.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id={CATEGORY_DATALIST_ID}>
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* Overwrite dialog */}
      {overwriteDialog && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-body font-medium text-amber-800 mb-2">
            You changed {overwriteDialog.field} from the catalog entry &ldquo;
            {overwriteDialog.catalogItem.item_name}&rdquo;.
          </p>
          <p className="text-meta text-amber-600 mb-3">
            Update the existing catalog entry, or save as a new item?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleOverwriteChoice("overwrite")}
              className="px-3 py-1.5 text-meta bg-amber-600 text-white rounded-lg hover:bg-amber-700"
            >
              Overwrite existing
            </button>
            <button
              onClick={() => handleOverwriteChoice("new")}
              className="px-3 py-1.5 text-meta bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Save as new item
            </button>
            <button
              onClick={() => {
                setOverwriteDialog(null);
                setSaving(false);
              }}
              className="px-3 py-1.5 text-meta text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-48">
                Item Name
              </th>
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-16">
                Qty
              </th>
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-40">
                Link
              </th>
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-32">
                CAS / Accession
              </th>
              <th className="text-right py-2 px-2 text-meta font-semibold text-gray-500 w-24">
                Price/Unit
              </th>
              <th className="text-right py-2 px-2 text-meta font-semibold text-gray-500 w-24">
                Shipping
              </th>
              <th className="text-right py-2 px-2 text-meta font-semibold text-gray-500 w-24">
                Total
              </th>
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-28">
                Funding String
              </th>
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-28">
                Vendor
              </th>
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-28">
                Category
              </th>
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-32">
                Notes
              </th>
              {/* Lab-manager ordering workflow (purchases-assignee fix,
                  2026-05-29): who was asked to place this order. */}
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-32">
                Assigned to
              </th>
              {/* Per-item ordering status (purchases-ordered-stage,
                  2026-05-29): the real Needs ordering / Ordered / Received
                  stage. */}
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-40">
                Order status
              </th>
              {/* PI Phase 3 (PI Phase 3 manager, 2026-05-23):
                  approval + flag column. Always rendered so list rows
                  line up consistently regardless of view. */}
              <th className="text-left py-2 px-2 text-meta font-semibold text-gray-500 w-28">
                PI status
              </th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {/* Existing items */}
            {items.map((item) => (
              editingItemId === item.id ? (
                // Edit mode row
                <tr
                  key={item.id}
                  className="border-b border-gray-50 bg-amber-50/50"
                >
                  <td className="py-2 px-2 relative" ref={editSuggestionsRef}>
                    <input
                      type="text"
                      value={editingRow.item_name}
                      onChange={(e) => handleEditFieldChange("item_name", e.target.value)}
                      placeholder="Item name..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    {/* Edit suggestions dropdown */}
                    {showEditSuggestions && editSuggestions.length > 0 && (
                      <div className="absolute top-full left-2 right-2 z-10 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                        {editSuggestions.map((cat) => (
                          <button
                            key={cat.id}
                            onClick={() => handleSelectEditSuggestion(cat)}
                            className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-gray-50 last:border-b-0"
                          >
                            <p className="text-body font-medium text-gray-900">
                              {cat.item_name}
                            </p>
                            <p className="text-meta text-gray-400">
                              ${(cat.price_per_unit ?? 0).toFixed(2)}
                              {cat.cas ? ` · ${cat.cas}` : ""}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={editingRow.quantity}
                      onChange={(e) =>
                        handleEditFieldChange("quantity", e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="0"
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={editingRow.link}
                      onChange={(e) => handleEditFieldChange("link", e.target.value)}
                      placeholder="URL..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={editingRow.cas}
                      onChange={(e) => handleEditFieldChange("cas", e.target.value)}
                      placeholder="CAS#..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={editingRow.price_per_unit}
                      onChange={(e) =>
                        handleEditFieldChange("price_per_unit", e.target.value)
                      }
                      placeholder="0.00"
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body text-right focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={editingRow.shipping_fees}
                      onChange={(e) =>
                        handleEditFieldChange("shipping_fees", e.target.value)
                      }
                      placeholder="0.00"
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body text-right focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2 text-right font-medium text-gray-700">
                    ${computeTotal(editingRow)}
                  </td>
                  <td className="py-2 px-2">
                    <select
                      value={editingRow.funding_string}
                      onChange={(e) => handleEditFieldChange("funding_string", e.target.value)}
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white"
                    >
                      <option value="">—</option>
                      {fundingAccounts.map((acc) => (
                        <option key={acc.id} value={acc.name}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      list={VENDOR_DATALIST_ID}
                      value={editingRow.vendor}
                      onChange={(e) => handleEditFieldChange("vendor", e.target.value)}
                      placeholder="Vendor..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      list={CATEGORY_DATALIST_ID}
                      value={editingRow.category}
                      onChange={(e) => handleEditFieldChange("category", e.target.value)}
                      placeholder="Category..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={editingRow.notes}
                      onChange={(e) => handleEditFieldChange("notes", e.target.value)}
                      placeholder="Notes..."
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  </td>
                  {/* Empty assignee + order-status + PI-status cells to keep
                      columns aligned in edit mode — assign / advance status /
                      approve actions aren't surfaced mid-edit. */}
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2" />
                  <td className="py-2 px-1 flex items-center gap-1">
                    <Tooltip label="Save changes" placement="bottom">
                      <button
                        aria-label="Save changes"
                        onClick={handleSaveEdit}
                        disabled={saving || !editingRow.item_name.trim()}
                        className="text-green-500 hover:text-green-700 text-body font-bold disabled:opacity-30"
                      >
                        ✓
                      </button>
                    </Tooltip>
                    <Tooltip label="Cancel editing" placement="bottom">
                      <button
                        aria-label="Cancel editing"
                        onClick={handleCancelEdit}
                        className="text-gray-400 hover:text-gray-600 text-body"
                      >
                        ✕
                      </button>
                    </Tooltip>
                  </td>
                </tr>
              ) : (
                // View mode row
                <tr
                  key={item.id}
                  className={`border-b border-gray-50 ${!writesDisabled ? "hover:bg-gray-50 cursor-pointer" : ""}`}
                  onClick={!writesDisabled ? () => handleStartEdit(item) : undefined}
                >
                  <td className="py-2 px-2 text-gray-700">{item.item_name}</td>
                  <td className="py-2 px-2 text-gray-700">{item.quantity}</td>
                  <td className="py-2 px-2">
                    {item.link ? (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline truncate block max-w-[150px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.link}
                      </a>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-gray-500 text-meta">
                    {item.cas || "—"}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-700">
                    ${(item.price_per_unit ?? 0).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-500">
                    ${(item.shipping_fees ?? 0).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right font-medium text-gray-900">
                    ${(item.total_price ?? 0).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-gray-500 text-meta">
                    {item.funding_string || "—"}
                  </td>
                  <td className="py-2 px-2 text-gray-500 text-meta">
                    {item.vendor || "—"}
                  </td>
                  <td className="py-2 px-2 text-gray-500 text-meta">
                    {item.category || "—"}
                  </td>
                  <td className="py-2 px-2 text-gray-400 text-meta">
                    {item.notes || "—"}
                  </td>
                  {/* Lab-manager ordering workflow (purchases-assignee
                      fix, 2026-05-29): per-item assignee chip + picker.
                      readOnly in lab mode (the comment thread is the
                      ask-the-owner path) and when the task is shared into
                      the current user (writes are owner-scoped). The
                      owner is `username` for shared / lab-mode items,
                      otherwise the current user. */}
                  <td
                    className="py-2 px-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <PurchaseAssigneePicker
                      item={item}
                      ownerUsername={username ?? currentUser}
                      currentUser={currentUser}
                      readOnly={writesDisabled}
                      onAssigned={() => refetch()}
                    />
                  </td>
                  {/* Per-item ordering status (purchases-ordered-stage,
                      2026-05-29): the real Needs ordering / Ordered /
                      Received stage + advance / revert arrows. readOnly in
                      lab mode + shared-into-me (writes are owner-scoped).
                      Advancing into "Ordered" fires the requester's
                      purchase_ordered bell. */}
                  <td
                    className="py-2 px-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <PurchaseOrderStatusControl
                      item={item}
                      ownerUsername={username ?? currentUser}
                      currentUser={currentUser}
                      readOnly={writesDisabled}
                      onChanged={() => refetch()}
                    />
                  </td>
                  {/* PI Phase 3 (PI Phase 3 manager,
                      2026-05-23): approval toggle (PI in unlocked
                      session) + flag button on hover for PIs, plus the
                      "PI Approved" / flag chip badges. Owners see the
                      badges only; everyone else (Approve toggle) hides
                      unless the unlock conditions are met. */}
                  <td
                    className="py-2 px-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex flex-col items-start gap-1">
                      {labHeadGate.canRequestEdit && labHeadGate.unlocked && labHeadGate.activeUser && labHeadGate.sessionId && username && (
                        <PurchaseApprovalToggle
                          item={item}
                          actor={labHeadGate.activeUser}
                          sessionId={labHeadGate.sessionId}
                          targetOwner={username}
                          onChanged={() => refetch()}
                        />
                      )}
                      {item.approved && (
                        <PurchaseApprovalBadge item={item} />
                      )}
                      {!item.approved && item.declined_at && (
                        <PurchaseDeclinedBadge item={item} />
                      )}
                      {labHeadGate.canRequestEdit && labHeadGate.unlocked && labHeadGate.activeUser && labHeadGate.sessionId && username && (
                        <FlagForReviewButton
                          recordType="purchase_item"
                          recordId={item.id}
                          recordName={item.item_name}
                          targetOwner={username}
                          actor={labHeadGate.activeUser}
                          sessionId={labHeadGate.sessionId}
                          currentFlag={item.flagged ?? null}
                          onFlagged={() => refetch()}
                        />
                      )}
                      {item.flagged && !(labHeadGate.canRequestEdit && labHeadGate.unlocked) && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-meta font-semibold uppercase tracking-wide bg-red-100 text-red-800 border border-red-300"
                          title={item.flagged.reason ?? `Flagged by ${item.flagged.by}`}
                          data-testid="lab-head-purchase-flag-badge"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            aria-hidden="true"
                          >
                            <path d="M4 22V4a2 2 0 0 1 2-2h8l2 4h4v10h-6l-2-4H6v10" />
                          </svg>
                          Flagged
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-1">
                    <div className="flex items-center gap-1.5">
                    {/* Buy again (reorder-loop sub-bot, 2026-05-31):
                        one-click reorder of a RECEIVED item. Creates a fresh
                        needs-ordering line item copying name / vendor / cas /
                        link / price / quantity into the CURRENT user's data
                        (the reorder is yours, even when viewing a shared
                        item). Own items route to the source task's project;
                        shared items route to the current user's Misc bucket
                        (the owner's project_id is meaningless in our space).
                        Hidden in lab read-only mode (the comment thread is
                        the canonical path there). */}
                    {!readOnly &&
                      normalizeOrderStatus(item.order_status) === "received" && (
                        <BuyAgainButton
                          item={item}
                          projectId={
                            isSharedWithMe ? undefined : parentTask?.project_id ?? undefined
                          }
                          onDone={() => {
                            refetch();
                            void queryClient.refetchQueries({
                              queryKey: ["purchases-all"],
                            });
                          }}
                        />
                      )}
                    {/* Lab-mode (readOnly) hides the affordance entirely
                        because the comment thread / mascot is the canonical
                        ask-the-owner path. Shared-into-me mode keeps the
                        button visible but disabled with an owner-aware
                        Tooltip + aria-label — mirrors the parent-chip
                        destructive-gate at a87dfeb0. */}
                    {!readOnly && !isSharedWithMe && (
                      <Tooltip label="Delete item" placement="left">
                        <button
                          aria-label="Delete item"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Purchases UX fix (purchases UX fix manager,
                            // 2026-05-24): mirror the parent-task delete
                            // confirm above. A single misclick on the
                            // tiny ✕ used to drop a reagent line with no
                            // recourse. Copy mirrors the order-level
                            // dialog ("Are you sure...") so the two
                            // destructive paths read the same way.
                            const itemLabel = item.item_name?.trim() || "this item";
                            if (
                              !confirm(
                                `Remove "${itemLabel}" from this purchase order?`,
                              )
                            ) {
                              return;
                            }
                            handleDeleteItem(item.id);
                          }}
                          className="text-red-400 hover:text-red-600 text-meta"
                        >
                          ✕
                        </button>
                      </Tooltip>
                    )}
                    {isSharedWithMe && (
                      <Tooltip label={sharedTooltip} placement="left">
                        <button
                          aria-label={sharedTooltip}
                          disabled
                          onClick={(e) => e.stopPropagation()}
                          className="text-red-400 text-meta opacity-30 cursor-not-allowed"
                        >
                          ✕
                        </button>
                      </Tooltip>
                    )}
                    </div>
                  </td>
                </tr>
              )
            ))}

            {/* New row input — hidden in readOnly (lab) mode AND in
                isSharedWithMe mode. Hiding (vs disabling) is the cleaner
                surface for the shared case: a disabled empty input row
                would be visual noise without explaining why, and the
                view-mode row gate above already prevents click-to-edit. */}
            {!writesDisabled && (
              <tr className="bg-blue-50/30">
                <td className="py-2 px-2 relative" ref={suggestionsRef}>
                  <input
                    type="text"
                    value={newRow.item_name}
                    onChange={(e) =>
                      handleFieldChange("item_name", e.target.value)
                    }
                    placeholder="Item name..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  {/* Suggestions dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute top-full left-2 right-2 z-10 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {suggestions.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => handleSelectSuggestion(cat)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-b-0"
                        >
                          <p className="text-body font-medium text-gray-900">
                            {cat.item_name}
                          </p>
                          <p className="text-meta text-gray-400">
                            ${(cat.price_per_unit ?? 0).toFixed(2)}
                            {cat.cas ? ` · ${cat.cas}` : ""}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={newRow.quantity}
                    onChange={(e) =>
                      handleFieldChange("quantity", e.target.value.replace(/\D/g, ""))
                    }
                    placeholder="0"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.link}
                    onChange={(e) => handleFieldChange("link", e.target.value)}
                    placeholder="URL..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.cas}
                    onChange={(e) => handleFieldChange("cas", e.target.value)}
                    placeholder="CAS#..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={newRow.price_per_unit}
                    onChange={(e) =>
                      handleFieldChange("price_per_unit", e.target.value)
                    }
                    placeholder="0.00"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={newRow.shipping_fees}
                    onChange={(e) =>
                      handleFieldChange("shipping_fees", e.target.value)
                    }
                    placeholder="0.00"
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2 text-right font-medium text-gray-700">
                  ${computeTotal(newRow)}
                </td>
                <td className="py-2 px-2">
                  <select
                    value={newRow.funding_string}
                    onChange={(e) => {
                      // Mark the funding field as user-touched so the project
                      // prefill default stops re-asserting itself (and an
                      // explicit clear to "—" sticks). funding-niceties bot.
                      setFundingTouched(true);
                      handleFieldChange("funding_string", e.target.value);
                    }}
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                  >
                    <option value="">—</option>
                    {fundingAccounts.map((acc) => (
                      <option key={acc.id} value={acc.name}>
                        {acc.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    list={VENDOR_DATALIST_ID}
                    value={newRow.vendor}
                    onChange={(e) => handleFieldChange("vendor", e.target.value)}
                    placeholder="Vendor..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    list={CATEGORY_DATALIST_ID}
                    value={newRow.category}
                    onChange={(e) => handleFieldChange("category", e.target.value)}
                    placeholder="Category..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.notes}
                    onChange={(e) => handleFieldChange("notes", e.target.value)}
                    placeholder="Notes..."
                    className="w-full px-2 py-1 border border-gray-200 rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                {/* Assignee + order-status + PI-status cells are empty in the
                    new-row: all three act on the persisted record, so assign
                    / advance status / approve happen after the item is added
                    (a fresh item is always "Needs ordering"). */}
                <td className="py-2 px-2" />
                <td className="py-2 px-2" />
                <td className="py-2 px-2" />
                <td className="py-2 px-1">
                  <Tooltip label="Add item" placement="left">
                    <button
                      aria-label="Add item"
                      onClick={handleAddRow}
                      disabled={saving || !newRow.item_name.trim() || !newRow.quantity}
                      className="text-blue-500 hover:text-blue-700 text-body font-bold disabled:opacity-30"
                    >
                      +
                    </button>
                  </Tooltip>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200">
              <td colSpan={6} className="py-2 px-2 text-right text-meta font-semibold text-gray-500">
                Order Total:
              </td>
              <td className="py-2 px-2 text-right font-bold text-gray-900">
                ${taskTotal.toFixed(2)}
              </td>
              {/* Funding + Vendor + Category + Notes + Assigned to + Order
                  status + PI status + actions = 8 trailing columns. */}
              <td colSpan={8}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
