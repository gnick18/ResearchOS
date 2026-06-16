"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { labApi, projectsApi as rawProjectsApi, tasksApi, purchasesApi } from "@/lib/local-api";
import {
  defaultFundingStringForProject,
  resolveFundingAccountId,
} from "@/lib/funding/prefill";
import SharingChips from "@/components/sharing/SharingChips";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { PURCHASE_LORO_ENABLED } from "@/lib/loro/config";
import { usePurchaseRowLoro } from "@/lib/loro/use-purchase-row-loro";
import { usePurchasePresence } from "@/lib/loro/use-purchase-presence";
import { getPurchaseFields } from "@/lib/loro/purchase-doc";
import { writePurchaseUpdateThroughLoro } from "@/lib/loro/purchase-write-through";
import PurchaseHistoryPopup from "@/components/PurchaseHistoryPopup";
import PurchaseRowPresence from "@/components/PurchaseRowPresence";
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
import FileDropzone from "@/components/ui/FileDropzone";
import { Icon } from "@/components/icons";
import PiEditConfirmDialog from "@/components/lab-head/PiEditConfirmDialog";
import PiEditAuditNote from "@/components/lab-head/PiEditAuditNote";
import { usePiEditGate } from "@/hooks/usePiEditGate";
import { usePiRecordMenu } from "@/hooks/usePiRecordMenu";
import { savePiRecordEdit } from "@/lib/lab/pi-record-edit";
import { auditRecordTypeFor } from "@/lib/lab/pi-record-menu";
import { normalizeOrderStatus } from "@/lib/types";
import type {
  CatalogItem,
  PurchaseItem,
  PurchaseAttachment,
  PurchaseAttachmentKind,
  Task,
} from "@/lib/types";
import {
  writePurchaseAttachment,
  openPurchaseAttachment,
  deletePurchaseAttachmentFile,
  formatAttachmentSize,
  ATTACHMENT_KINDS,
  attachmentKindLabel,
} from "@/lib/purchases/attachments";
import { buildDepartmentMailto } from "@/lib/purchases/routing";
import { readUserSettings } from "@/lib/settings/user-settings";

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
  catalog_number: string;
  category: string;
  // Purchase documents (PURCHASE_DOCS_AND_ROUTING.md phase 1b). Held on the edit
  // row and persisted with the form save, so attachment writes ride the same
  // tested save routing as every other field. Files are written to disk on
  // attach; this is just the on-record reference list.
  attachments: PurchaseAttachment[];
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
  catalog_number: "",
  category: "",
  attachments: [],
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
    catalog_number: item.catalog_number || "",
    category: item.category || "",
    attachments: item.attachments ?? [],
  };
}

const VENDOR_DATALIST_ID = "purchase-editor-vendor-options";
const CATEGORY_DATALIST_ID = "purchase-editor-category-options";

/**
 * Purchase documents sub-row (PURCHASE_DOCS_AND_ROUTING.md phase 1b). A thin row
 * under a purchase item spanning all columns, showing its attached PDFs and (in
 * edit mode) the attach + remove + per-doc kind controls. Renders nothing for a
 * display row with no documents, so it adds no noise to purchases that have
 * none. Files open in a new tab; attaching / removing / re-kinding happen in
 * edit mode and persist with the row save.
 */
function PurchaseDocsRow({
  attachments,
  editing,
  attaching,
  colSpan,
  onFiles,
  onRemove,
  onOpen,
  onKindChange,
  routing,
}: {
  attachments: PurchaseAttachment[];
  editing: boolean;
  attaching: boolean;
  colSpan: number;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onOpen: (att: PurchaseAttachment) => void;
  onKindChange: (id: string, kind: PurchaseAttachmentKind) => void;
  // Department routing (slice 3). Non-null only for a display row of an approved
  // purchase when the PI has routing enabled with at least one contact. The
  // draft-and-hand-off opens the PI's own mail client.
  routing?: {
    contacts: { id: string; name: string; email: string }[];
    onSend: (email: string) => void;
  } | null;
}) {
  const [sendTo, setSendTo] = useState(routing?.contacts[0]?.email ?? "");
  if (!editing && attachments.length === 0) return null;
  return (
    <tr className="border-b border-border/40 bg-surface-sunken/40">
      <td colSpan={colSpan} className="px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-meta text-foreground-muted">
            <Icon name="file" className="w-3.5 h-3.5" />
            Documents
          </span>
          {attachments.length === 0 ? (
            <span className="text-meta text-foreground-muted">none yet</span>
          ) : (
            attachments.map((att) => (
              <span
                key={att.id}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-meta"
              >
                {editing ? (
                  <select
                    value={att.kind}
                    onChange={(e) =>
                      onKindChange(att.id, e.target.value as PurchaseAttachmentKind)
                    }
                    className="rounded border border-border bg-transparent py-0.5 text-meta text-foreground-muted"
                    aria-label="Document kind"
                  >
                    {ATTACHMENT_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-foreground-muted">
                    {attachmentKindLabel(att.kind)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onOpen(att)}
                  className="max-w-[16rem] truncate text-blue-600 dark:text-blue-400 hover:underline"
                  title={`${att.filename}${
                    att.file_size ? ` (${formatAttachmentSize(att.file_size)})` : ""
                  }`}
                >
                  {att.filename}
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => onRemove(att.id)}
                    className="text-foreground-muted hover:text-rose-600"
                    aria-label={`Remove ${att.filename}`}
                  >
                    <Icon name="close" className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))
          )}
          {editing && (
            <FileDropzone
              accept="application/pdf,.pdf"
              onFiles={onFiles}
              disabled={attaching}
              icon="file"
              label={attaching ? "Attaching..." : "Attach PDF"}
              hint="PDF"
              compact
              ariaLabel="Attach PDF document"
            />
          )}
          {routing && routing.contacts.length > 0 && (
            <span className="ml-auto inline-flex items-center gap-1">
              {routing.contacts.length > 1 && (
                <select
                  value={sendTo || routing.contacts[0].email}
                  onChange={(e) => setSendTo(e.target.value)}
                  className="rounded border border-border bg-transparent py-0.5 text-meta text-foreground-muted"
                  aria-label="Department recipient"
                >
                  {routing.contacts.map((c) => (
                    <option key={c.id} value={c.email}>
                      {c.name || c.email}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => routing.onSend(sendTo || routing.contacts[0].email)}
                className="ros-btn-neutral inline-flex items-center gap-1 px-2 py-0.5 text-meta font-medium"
                title="Draft an email to the department with this purchase's details"
              >
                <Icon name="share" className="w-3.5 h-3.5" />
                Send to department
              </button>
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function PurchaseEditor({
  taskId,
  readOnly: propReadOnly = false,
  username,
  taskType,
  isSharedWithMe = false,
  ownerLabel,
}: PurchaseEditorProps) {
  const queryClient = useQueryClient();
  // PI edit-mode removal (remove-edit-mode bot, 2026-06-07): the PI
  // edit-session soft-write was removed. The prop-passed readOnly is now the
  // effective readOnly (writes follow standard share permissions). A lab head
  // viewing a MEMBER's purchase order can still approve / flag line items via
  // the actions below — those are role privileges, not record writes.
  const { currentUser: gateCurrentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(gateCurrentUser);
  const isOtherUserRecord =
    !!username && !!gateCurrentUser && username !== gateCurrentUser;
  const canActAsLabHead = propReadOnly && isLabHead && isOtherUserRecord;
  const readOnly = propReadOnly;
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
  // Synchronous double-fire guard for the overwrite-dialog choice (a
  // double-click before re-render would otherwise create a duplicate row).
  const overwriteInFlightRef = useRef(false);
  const suggestionsRef = useRef<HTMLTableCellElement>(null);
  
  // Editing state for existing items
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingRow, setEditingRow] = useState<EditingRow>({ ...EMPTY_ROW });
  const [editSuggestions, setEditSuggestions] = useState<CatalogItem[]>([]);
  const [showEditSuggestions, setShowEditSuggestions] = useState(false);
  const [, setEditSelectedCatalogItem] = useState<CatalogItem | null>(null);
  const editSuggestionsRef = useRef<HTMLTableCellElement>(null);

  // Purchase items on Loro chunk 4: version-history popup state. Holds the
  // item id whose history is open + the click origin for the LivingPopup zoom.
  // Only ever set when PURCHASE_LORO_ENABLED (the History button is flag-gated),
  // so this stays null and renders no popup when the flag is off.
  const [historyItemId, setHistoryItemId] = useState<number | null>(null);
  const [historyOrigin, setHistoryOrigin] = useState<{ x: number; y: number } | null>(
    null,
  );

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

  // Department routing (PURCHASE_DOCS_AND_ROUTING.md slice 3). The viewer's own
  // settings hold the routing config; it is meaningful only for a lab head who
  // turned it on. Members / non-configured labs read a disabled config and the
  // "Send to department" affordance never appears.
  const { data: mySettings } = useQuery({
    queryKey: ["user-settings", gateCurrentUser],
    queryFn: () => readUserSettings(gateCurrentUser ?? ""),
    enabled: !!gateCurrentUser,
  });
  const routingCfg = mySettings?.purchaseRouting;
  const routingActive =
    !!routingCfg?.enabled && (routingCfg.contacts?.length ?? 0) > 0;

  const handleSendToDept = useCallback(
    (item: PurchaseItem, email: string) => {
      if (!routingCfg) return;
      const acct = fundingAccounts.find(
        (a) => a.id === item.funding_account_id,
      );
      const grant = acct?.name || item.funding_string || "(no grant)";
      const me = mySettings?.displayName || gateCurrentUser || "";
      const url = buildDepartmentMailto(email, item, routingCfg, {
        item: item.item_name,
        grant,
        vendor: item.vendor || "",
        total: `$${(item.total_price ?? 0).toFixed(2)}`,
        me,
      });
      // mailto: opens the OS mail client without navigating the app away.
      window.location.href = url;
    },
    [routingCfg, fundingAccounts, mySettings, gateCurrentUser],
  );

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
  const currentUser = gateCurrentUser ?? "";

  // Purchase items on Loro (docs/proposals/PURCHASE_LORO.md) chunk 2 = READ +
  // CONNECT for the single actively-edited row. Flag-gated: a pure no-op when
  // PURCHASE_LORO_ENABLED is false (no handle, no session, no subscription).
  // The folder owner is the lab-mode `username` when present, else the current
  // user (the same path the items live under). queryUsername is the exact
  // `username` value the ["purchases", taskId, username] query key uses, so a
  // remote-change invalidation matches that key byte-for-byte.
  const rowLoroOwner = username ?? currentUser;
  const rowLoro = usePurchaseRowLoro({
    itemId: editingItemId,
    owner: rowLoroOwner,
    taskId,
    queryUsername: username,
    currentUser,
  });

  // Purchase items on Loro chunk 4: live presence over the open row's shared
  // EphemeralStore. Broadcasts this device's presence while a row is open and
  // reads OTHER peers on the same item. Flag-off / no session, rowLoro.ephemeral
  // is null and this returns an empty list (a pure no-op).
  const remotePresencePeers = usePurchasePresence({
    store: rowLoro.ephemeral,
    itemId: editingItemId,
    username: currentUser,
  });

  // PI capability revamp Phase 1 (2026-06-07): the role-based PI edit gate for
  // the actively-edited purchase row. A lab head viewing a MEMBER's purchase
  // order edits a row inline like their own data, behind one once-per-session
  // confirm; the save then routes to the owner's folder + the lab audit trail
  // (see handleSaveEdit). The gate is scoped to the open row (editingItemId);
  // purchase items have no ACL of their own, so the share check uses the parent
  // task's shared_with. propReadOnly carries the existing writesDisabled flag,
  // so a non-PI / own-record / shared-into-me view behaves exactly as before.
  // The item the PI is about to edit (clicked) or is editing. The gate is keyed
  // to this id so the once-per-session confirm is remembered per purchase item.
  // Rows edit one at a time, so a single gate scoped to this id is enough.
  const [pendingPiItemId, setPendingPiItemId] = useState<number | null>(null);
  const gateItemId = editingItemId ?? pendingPiItemId ?? 0;
  const purchaseOwner = username ?? gateCurrentUser ?? null;
  const piGate = usePiEditGate({
    owner: purchaseOwner,
    sharedWith: parentTask?.shared_with ?? [],
    recordType: "purchase",
    recordId: gateItemId,
    propReadOnly: writesDisabled,
  });
  // A PI editing a member's purchase row stays read-only until they cross the
  // confirm; everyone else keeps the standard writesDisabled flag.
  const piActive = piGate.isPiEdit && piGate.confirmed;

  // PI capability revamp Phase 2: right-click PI actions on a member's purchase
  // line item. The builder gates internally (no menu for a non-PI viewer or a
  // PI on their own item), so wiring it on every view row is safe.
  const piMenu = usePiRecordMenu();

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
      catalog_number: cat.catalog_number || "",
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
      catalog_number: cat.catalog_number || "",
      price_per_unit: cat.price_per_unit.toString(),
    }));
    setEditSelectedCatalogItem(cat);
    setShowEditSuggestions(false);
  }, []);

  const handleStartEdit = useCallback((item: PurchaseItem) => {
    setEditingItemId(item.id);
    setEditingRow(itemToEditingRow(item));
    setEditSelectedCatalogItem(null);
    // Start a fresh session-attached list so orphan cleanup only ever acts on
    // files written during THIS edit session.
    sessionAttachedRef.current = [];
  }, []);

  // Row click. The normal (non-PI) path opens the editor directly when writes
  // are allowed. A lab head on a member's row instead crosses the once-per-
  // session confirm: the first click on a not-yet-confirmed item points the
  // gate at this item and opens the are-you-sure dialog (the actual editor
  // opens from the dialog's onConfirm, below). Once confirmed, clicks open the
  // editor directly. This is the only path that lets a PI edit a member's row
  // while writesDisabled (lab read-only) is true.
  const handleRowClick = useCallback(
    (item: PurchaseItem) => {
      if (piGate.isPiEdit) {
        if (!piGate.confirmed) {
          setPendingPiItemId(item.id);
          piGate.beginEdit();
          return;
        }
        handleStartEdit(item);
        return;
      }
      if (!writesDisabled) handleStartEdit(item);
    },
    [piGate, writesDisabled, handleStartEdit],
  );

  // After the PI confirms the are-you-sure, mark the gate confirmed and open the
  // editor for the pending item.
  const handlePiConfirm = useCallback(() => {
    piGate.confirmEdit();
    const item = items.find((i) => i.id === pendingPiItemId);
    if (item) handleStartEdit(item);
  }, [piGate, items, pendingPiItemId, handleStartEdit]);

  const handlePiCancel = useCallback(() => {
    piGate.cancelEdit();
    setPendingPiItemId(null);
  }, [piGate]);

  const handleCancelEdit = useCallback(() => {
    // Files attached during this edit but never saved are orphans, delete them.
    for (const att of sessionAttachedRef.current) {
      void deletePurchaseAttachmentFile(att);
    }
    sessionAttachedRef.current = [];
    setEditingItemId(null);
    setEditingRow({ ...EMPTY_ROW });
    setEditSelectedCatalogItem(null);
    setPendingPiItemId(null);
  }, []);

  const handleEditFieldChange = useCallback(
    (field: keyof EditingRow, value: string) => {
      setEditingRow((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  // Purchase items on Loro chunk 2: read the open editor's INITIAL field values
  // from the Loro projection (the CRDT truth) instead of the raw .json item,
  // once the flag is on and the handle has opened. handleStartEdit seeds the
  // draft from the .json item immediately (so the editor never blocks on a
  // loader), then this effect re-seeds it from getPurchaseFields the moment the
  // handle is ready. It fires exactly once per opened item (tracked by a ref),
  // before the user has typed, so it cannot clobber an in-progress edit. Flag
  // off / handle not yet open: it is a no-op and the .json seed stands.
  const loroSeededItemId = useRef<number | null>(null);
  useEffect(() => {
    if (!PURCHASE_LORO_ENABLED) {
      loroSeededItemId.current = null;
      return;
    }
    if (editingItemId === null) {
      // Edit ended: clear the guard so the next open re-seeds from the doc.
      loroSeededItemId.current = null;
      return;
    }
    // Wait for the handle to finish opening for THIS row before seeding.
    if (rowLoro.opening || !rowLoro.handle) return;
    if (loroSeededItemId.current === editingItemId) return;

    loroSeededItemId.current = editingItemId;
    setEditingRow(itemToEditingRow(getPurchaseFields(rowLoro.handle.doc)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingItemId, rowLoro.opening, rowLoro.handle]);

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
        // Authoritative FK + denormalized label (funding-rework, 2026-06-08).
        funding_account_id: resolveFundingAccountId(
          editingRow.funding_string,
          fundingAccounts,
        ),
        funding_string: editingRow.funding_string.trim() || null,
        vendor: editingRow.vendor.trim() || null,
        catalog_number: editingRow.catalog_number.trim() || null,
        category: editingRow.category.trim() || null,
        // Purchase documents (PURCHASE_DOCS_AND_ROUTING.md phase 1b). Persisted
        // with the rest of the row through the shared write routing.
        attachments: editingRow.attachments,
      };

      // The persistence closure, shared by the normal and the PI-edit paths so
      // the two write IDENTICAL bytes. Purchase items on Loro
      // (docs/proposals/PURCHASE_LORO.md) chunk 3 = WRITE routing. When
      // PURCHASE_LORO_ENABLED, the save lands in the Loro doc (the same cached
      // handle this row already has open from chunk 2), which persists the
      // .loro sidecar AND the .json mirror and fans the change out over the
      // relay. The mirror is byte-identical to what the legacy .update wrote,
      // so every legacy reader stays correct. Flag off, it falls through to
      // purchasesApi.update. rowLoroOwner is the folder the items live under
      // (the lab-mode `username` when present, else the current user), the same
      // owner chunk 2 opened the read handle against, and the same owner the PI
      // audit + write must target.
      const writePurchase = () => {
        if (PURCHASE_LORO_ENABLED) {
          return writePurchaseUpdateThroughLoro(
            rowLoroOwner,
            editingItemId,
            newPayload,
            currentUser,
          );
        }
        // PI edits route the legacy write to the OWNER's folder; the non-PI
        // path keeps the current-user-scoped call (no owner arg) unchanged.
        return piActive && purchaseOwner
          ? purchasesApi.update(editingItemId, newPayload, purchaseOwner)
          : purchasesApi.update(editingItemId, newPayload);
      };

      // PI capability revamp Phase 1: a lab head editing a member's row routes
      // the save through savePiRecordEdit so every changed field lands in the
      // owner's _pi_audit.json, attributed to the PI. The dataWrite is the SAME
      // persistence the non-PI path uses, so behavior is identical except for
      // the audit trail. The diff is computed against the row's pre-edit values
      // (the live item) vs the payload being written. Own-record / non-PI saves
      // (piActive false) keep the plain write below, completely unaudited.
      if (piActive && purchaseOwner && currentUser) {
        const beforeItem = items.find((i) => i.id === editingItemId);
        await savePiRecordEdit({
          targetOwner: purchaseOwner,
          actor: currentUser,
          // Audit record_type for a purchase is "purchase_item" (one home in
          // auditRecordTypeFor), matching pi-actions + the per-record viewer
          // filter so a purchase's history is not split across two types.
          recordType: auditRecordTypeFor("purchase"),
          recordId: editingItemId,
          fieldPaths: Object.keys(newPayload),
          oldRecord: (beforeItem ?? {}) as unknown as Record<string, unknown>,
          newRecord: newPayload as unknown as Record<string, unknown>,
          dataWrite: writePurchase,
        });
      } else {
        await writePurchase();
      }

      // Orphan cleanup: now that the new attachment set is saved, delete the
      // files that are no longer referenced. Candidates are the row's original
      // attachments plus anything attached this session; keep only what the
      // saved row still points at.
      const keptPaths = new Set(editingRow.attachments.map((a) => a.path));
      const removedCandidates = [
        ...(items.find((i) => i.id === editingItemId)?.attachments ?? []),
        ...sessionAttachedRef.current,
      ];
      for (const att of removedCandidates) {
        if (!keptPaths.has(att.path)) void deletePurchaseAttachmentFile(att);
      }
      sessionAttachedRef.current = [];

      setEditingItemId(null);
      setEditingRow({ ...EMPTY_ROW });
      setEditSelectedCatalogItem(null);
      setPendingPiItemId(null);
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
    fundingAccounts,
    refetch,
    queryClient,
    purchasesApi,
    rowLoroOwner,
    currentUser,
    piActive,
    purchaseOwner,
    items,
  ]);

  // Purchase documents (PURCHASE_DOCS_AND_ROUTING.md phase 1b). Attaching writes
  // the file to the purchase's folder immediately and appends the reference to
  // the open edit row; the reference persists when the row is saved. Removing
  // drops the reference (the file is left on disk in v1, orphaned once saved).
  const [attaching, setAttaching] = useState(false);
  // Files written to disk during the open edit session. Used by orphan cleanup
  // (save deletes removed-but-original + attached-then-removed files; cancel
  // deletes everything attached this session). Reset whenever an edit starts.
  const sessionAttachedRef = useRef<PurchaseAttachment[]>([]);

  const handleAttachFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !editingItemId) return;
      setAttaching(true);
      try {
        const att = await writePurchaseAttachment(
          rowLoroOwner,
          editingItemId,
          file,
          "other",
        );
        sessionAttachedRef.current = [...sessionAttachedRef.current, att];
        setEditingRow((prev) => ({
          ...prev,
          attachments: [...prev.attachments, att],
        }));
      } catch {
        alert(`Failed to attach ${file.name}`);
      } finally {
        setAttaching(false);
      }
    },
    [editingItemId, rowLoroOwner],
  );

  const handleRemoveAttachment = useCallback((id: string) => {
    setEditingRow((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((a) => a.id !== id),
    }));
  }, []);

  const handleAttachmentKindChange = useCallback(
    (id: string, kind: PurchaseAttachmentKind) => {
      setEditingRow((prev) => ({
        ...prev,
        attachments: prev.attachments.map((a) =>
          a.id === id ? { ...a, kind } : a,
        ),
      }));
    },
    [],
  );

  const handleOpenAttachment = useCallback(async (att: PurchaseAttachment) => {
    const ok = await openPurchaseAttachment(att);
    if (!ok) {
      alert("Could not open the file. It may have been moved or deleted.");
    }
  }, []);

  // Missing-receipt nudge (PURCHASE_DOCS_AND_ROUTING.md phase 1b). Counts only
  // ordered / received purchases with no document, since a not-yet-ordered line
  // legitimately has no receipt. A gentle hint for the grant record, never a
  // blocker.
  const missingDocCount = useMemo(
    () =>
      items.filter(
        (i) =>
          (i.order_status === "ordered" || i.order_status === "received") &&
          !(i.attachments?.length),
      ).length,
    [items],
  );

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
        // Authoritative FK + denormalized label (funding-rework, 2026-06-08).
        funding_account_id: resolveFundingAccountId(
          rowData.funding_string,
          fundingAccounts,
        ),
        funding_string: rowData.funding_string.trim() || null,
        vendor: rowData.vendor.trim() || null,
        catalog_number: rowData.catalog_number.trim() || null,
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
  }, [taskId, fundingAccounts, refetch, queryClient, purchasesApi]);

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
      // Guard against a double-click firing two catalog writes + two
      // doAddRow calls (which would create a duplicate line item). The
      // disabled buttons cover the common case; this ref covers the
      // synchronous double-fire before React re-renders.
      if (overwriteInFlightRef.current) return;
      overwriteInFlightRef.current = true;
      setSaving(true);

      if (choice === "overwrite") {
        try {
          await purchasesApi.updateCatalogItem(overwriteDialog.catalogItem.id, {
            item_name: newRow.item_name.trim(),
            link: newRow.link.trim() || null,
            cas: newRow.cas.trim() || null,
            catalog_number: newRow.catalog_number.trim() || null,
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
            catalog_number: newRow.catalog_number.trim() || null,
            price_per_unit: parseFloat(newRow.price_per_unit) || 0,
          });
        } catch {
          alert("Failed to create catalog item");
        }
      }

      setOverwriteDialog(null);
      try {
        await doAddRow(newRow);
      } finally {
        overwriteInFlightRef.current = false;
      }
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
        <div className="mb-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-4">
          <p className="text-body font-medium text-amber-800 dark:text-amber-200 mb-2">
            You changed {overwriteDialog.field} from the catalog entry &ldquo;
            {overwriteDialog.catalogItem.item_name}&rdquo;.
          </p>
          <p className="text-meta text-amber-600 dark:text-amber-300 mb-3">
            Update the existing catalog entry, or save as a new item?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleOverwriteChoice("overwrite")}
              disabled={saving}
              className="ros-btn-raise px-3 py-1.5 text-meta bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Overwrite existing
            </button>
            <button
              onClick={() => handleOverwriteChoice("new")}
              disabled={saving}
              className="ros-btn-raise px-3 py-1.5 text-meta bg-brand-action text-white rounded-lg hover:bg-brand-action/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save as new item
            </button>
            <button
              onClick={() => {
                setOverwriteDialog(null);
                setSaving(false);
              }}
              className="px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Missing-receipt nudge (PURCHASE_DOCS_AND_ROUTING.md phase 1b). */}
      {missingDocCount > 0 && (
        <div className="mb-2 flex items-center gap-1.5 text-meta text-foreground-muted">
          <Icon name="file" className="h-3.5 w-3.5" />
          {missingDocCount} ordered{" "}
          {missingDocCount === 1 ? "purchase has" : "purchases have"} no document
          attached. Attach receipts to keep the grant record complete.
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          {/* Unified Popup Chrome (POPUP_CHROME_ROLLOUT_PROPOSALS.md §1 Purchase
              body): the column heads de-band into a quiet caption row — no solid
              header bar / heavy bottom border, lighter weight + uppercase
              tracking — so the table reads on the one calm surface instead of a
              banded strip. The amber in-edit row, the Documents sub-row and the
              totals tfoot are unchanged. */}
          <thead>
            <tr>
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-48">
                Item Name
              </th>
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-16">
                Qty
              </th>
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-40">
                Link
              </th>
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-32">
                CAS / Accession
              </th>
              <th className="text-right pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-24">
                Price/Unit
              </th>
              <th className="text-right pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-24">
                Shipping
              </th>
              <th className="text-right pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-24">
                Total
              </th>
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-28">
                Funding String
              </th>
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-28">
                Vendor
              </th>
              {/* Vendor ordering / catalog number (audit fix, additive-fields):
                  the reorder id a user types back into the vendor site. */}
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-28">
                Catalog #
              </th>
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-28">
                Category
              </th>
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-32">
                Notes
              </th>
              {/* Lab-manager ordering workflow (purchases-assignee fix,
                  2026-05-29): who was asked to place this order. */}
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-32">
                Assigned to
              </th>
              {/* Per-item ordering status (purchases-ordered-stage,
                  2026-05-29): the real Needs ordering / Ordered / Received
                  stage. */}
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-40">
                Order status
              </th>
              {/* PI Phase 3 (PI Phase 3 manager, 2026-05-23):
                  approval + flag column. Always rendered so list rows
                  line up consistently regardless of view. */}
              <th className="text-left pb-2 px-2 text-meta font-medium uppercase tracking-wide text-foreground-muted w-28">
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
                <Fragment key={item.id}>
                <tr
                  className="border-b border-border/40 bg-amber-50 dark:bg-amber-500/10"
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
                      <div className="absolute top-full left-2 right-2 z-10 bg-surface-raised border border-border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                        {editSuggestions.map((cat) => (
                          <button
                            key={cat.id}
                            onClick={() => handleSelectEditSuggestion(cat)}
                            className="w-full text-left px-3 py-2 hover:bg-amber-50 dark:hover:bg-amber-500/10 border-b border-border last:border-b-0"
                          >
                            <p className="text-body font-medium text-foreground">
                              {cat.item_name}
                            </p>
                            <p className="text-meta text-foreground-muted">
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
                  <td className="py-2 px-2 text-right font-medium text-foreground">
                    ${computeTotal(editingRow)}
                  </td>
                  <td className="py-2 px-2">
                    <select
                      value={editingRow.funding_string}
                      onChange={(e) => handleEditFieldChange("funding_string", e.target.value)}
                      className="w-full px-2 py-1 border border-amber-300 rounded text-body focus:outline-none focus:ring-1 focus:ring-amber-400 bg-surface-raised"
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
                      value={editingRow.catalog_number}
                      onChange={(e) => handleEditFieldChange("catalog_number", e.target.value)}
                      placeholder="M0491S"
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
                  {/* Empty assignee + order-status cells to keep columns
                      aligned in edit mode — assign / advance status actions
                      aren't surfaced mid-edit. The PI-status cell carries the
                      inline "editing as lab head" audit note when a lab head is
                      editing this member's row. */}
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2" />
                  <td className="py-2 px-2">
                    {piActive && (
                      <PiEditAuditNote memberName={purchaseOwner} />
                    )}
                  </td>
                  <td className="py-2 px-1 flex items-center gap-1">
                    {/* Purchase items on Loro chunk 4: quiet live-presence
                        indicator. Renders only when a REMOTE peer is editing
                        this same item over the relay; otherwise it is invisible.
                        Flag-off / solo, remotePresencePeers is empty so this is a
                        no-op. */}
                    <PurchaseRowPresence peers={remotePresencePeers} />
                    <Tooltip label="Save changes" placement="bottom">
                      <button
                        aria-label="Save changes"
                        onClick={handleSaveEdit}
                        disabled={saving || !editingRow.item_name.trim()}
                        className="text-green-500 hover:text-green-700 dark:hover:text-green-300 text-body font-bold disabled:opacity-30"
                      >
                        <Icon name="check" className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip label="Cancel editing" placement="bottom">
                      <button
                        aria-label="Cancel editing"
                        onClick={handleCancelEdit}
                        className="text-foreground-muted hover:text-foreground-muted text-body"
                      >
                        <Icon name="close" className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  </td>
                </tr>
                <PurchaseDocsRow
                  attachments={editingRow.attachments}
                  editing
                  attaching={attaching}
                  colSpan={16}
                  onFiles={(files) => void handleAttachFile(files[0])}
                  onRemove={handleRemoveAttachment}
                  onOpen={handleOpenAttachment}
                  onKindChange={handleAttachmentKindChange}
                />
                </Fragment>
              ) : (
                // View mode row
                <Fragment key={item.id}>
                <tr
                  className={`border-b border-border/40 ${!writesDisabled || piGate.isPiEdit ? "hover:bg-surface-sunken cursor-pointer" : ""}`}
                  onClick={
                    !writesDisabled || piGate.isPiEdit
                      ? () => handleRowClick(item)
                      : undefined
                  }
                  onContextMenu={(e) =>
                    piMenu.handleContextMenu(e, {
                      recordType: "purchase",
                      record: {
                        owner: purchaseOwner ?? "",
                        id: item.id,
                        flagged: !!item.flagged,
                        approved: !!item.approved,
                      },
                      onEditAsPi: () => handleRowClick(item),
                    })
                  }
                >
                  <td className="py-2 px-2 text-foreground">{item.item_name}</td>
                  <td className="py-2 px-2 text-foreground">{item.quantity}</td>
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
                      <span className="text-foreground-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-foreground-muted text-meta">
                    {item.cas || "—"}
                  </td>
                  <td className="py-2 px-2 text-right text-foreground">
                    ${(item.price_per_unit ?? 0).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right text-foreground-muted">
                    ${(item.shipping_fees ?? 0).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-right font-medium text-foreground">
                    ${(item.total_price ?? 0).toFixed(2)}
                  </td>
                  <td className="py-2 px-2 text-foreground-muted text-meta">
                    {item.funding_string || "—"}
                  </td>
                  <td className="py-2 px-2 text-foreground-muted text-meta">
                    {item.vendor || "—"}
                  </td>
                  <td className="py-2 px-2 text-foreground-muted text-meta">
                    {item.catalog_number || "—"}
                  </td>
                  <td className="py-2 px-2 text-foreground-muted text-meta">
                    {item.category || "—"}
                  </td>
                  <td className="py-2 px-2 text-foreground-muted text-meta">
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
                      {canActAsLabHead && gateCurrentUser && username && (
                        <PurchaseApprovalToggle
                          item={item}
                          actor={gateCurrentUser}
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
                      {canActAsLabHead && gateCurrentUser && username && (
                        <FlagForReviewButton
                          recordType="purchase_item"
                          recordId={item.id}
                          recordName={item.item_name}
                          targetOwner={username}
                          actor={gateCurrentUser}
                          currentFlag={item.flagged ?? null}
                          onFlagged={() => refetch()}
                        />
                      )}
                      {item.flagged && !canActAsLabHead && (
                        <Tooltip
                          label={
                            item.flagged.reason ??
                            `Flagged by ${item.flagged.by}`
                          }
                          placement="bottom"
                        >
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-meta font-semibold uppercase tracking-wide bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-200 border border-red-300"
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
                        </Tooltip>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-1">
                    <div className="flex items-center gap-1.5">
                    {/* Purchase items on Loro chunk 4: version history. Only
                        rendered when PURCHASE_LORO_ENABLED (the history engine
                        reads the .loro sidecar, which only exists once the flag
                        is on), so flag-off this adds zero surface. Icon-only
                        custom inline SVG (clock + counter-arrow) wrapped in the
                        Tooltip component (never title=). */}
                    {PURCHASE_LORO_ENABLED && (
                      <Tooltip label="Version history" placement="left">
                        <button
                          type="button"
                          aria-label="Version history"
                          onClick={(e) => {
                            e.stopPropagation();
                            setHistoryOrigin({ x: e.clientX, y: e.clientY });
                            setHistoryItemId(item.id);
                          }}
                          className="text-foreground-muted hover:text-foreground transition-colors"
                        >
                          <Icon name="history" className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    )}
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
                          className="text-red-400 hover:text-red-600 dark:hover:text-red-300 text-meta"
                        >
                          <Icon name="close" className="w-3.5 h-3.5" />
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
                          <Icon name="close" className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    )}
                    </div>
                  </td>
                </tr>
                <PurchaseDocsRow
                  attachments={item.attachments ?? []}
                  editing={false}
                  attaching={false}
                  colSpan={16}
                  onFiles={() => {}}
                  onRemove={() => {}}
                  onOpen={handleOpenAttachment}
                  onKindChange={() => {}}
                  routing={
                    routingActive && item.approved
                      ? {
                          contacts: routingCfg!.contacts,
                          onSend: (email) => handleSendToDept(item, email),
                        }
                      : null
                  }
                />
                </Fragment>
              )
            ))}

            {/* New row input — hidden in readOnly (lab) mode AND in
                isSharedWithMe mode. Hiding (vs disabling) is the cleaner
                surface for the shared case: a disabled empty input row
                would be visual noise without explaining why, and the
                view-mode row gate above already prevents click-to-edit. */}
            {!writesDisabled && (
              // The add-new line stays the last table row (not a separate band):
              // the heavy blue fill de-bands to a faint tint so it reads on the
              // calm surface while still cueing the "add an item" affordance.
              <tr className="bg-blue-500/[0.04] dark:bg-blue-500/10">
                <td className="py-2 px-2 relative" ref={suggestionsRef}>
                  <input
                    type="text"
                    value={newRow.item_name}
                    onChange={(e) =>
                      handleFieldChange("item_name", e.target.value)
                    }
                    placeholder="Item name..."
                    className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  {/* Suggestions dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div className="absolute top-full left-2 right-2 z-10 bg-surface-raised border border-border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {suggestions.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => handleSelectSuggestion(cat)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-brand-action/10 border-b border-border last:border-b-0"
                        >
                          <p className="text-body font-medium text-foreground">
                            {cat.item_name}
                          </p>
                          <p className="text-meta text-foreground-muted">
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
                    className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.link}
                    onChange={(e) => handleFieldChange("link", e.target.value)}
                    placeholder="URL..."
                    className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.cas}
                    onChange={(e) => handleFieldChange("cas", e.target.value)}
                    placeholder="CAS#..."
                    className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
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
                    className="w-full px-2 py-1 border border-border rounded text-body text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
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
                    className="w-full px-2 py-1 border border-border rounded text-body text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2 text-right font-medium text-foreground">
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
                    className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400 bg-surface-raised"
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
                    className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.catalog_number}
                    onChange={(e) => handleFieldChange("catalog_number", e.target.value)}
                    placeholder="M0491S"
                    className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    list={CATEGORY_DATALIST_ID}
                    value={newRow.category}
                    onChange={(e) => handleFieldChange("category", e.target.value)}
                    placeholder="Category..."
                    className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newRow.notes}
                    onChange={(e) => handleFieldChange("notes", e.target.value)}
                    placeholder="Notes..."
                    className="w-full px-2 py-1 border border-border rounded text-body focus:outline-none focus:ring-1 focus:ring-blue-400"
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
                      className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 text-body font-bold disabled:opacity-30"
                    >
                      +
                    </button>
                  </Tooltip>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            {/* Totals row kept, de-banded from a heavy 2px rule to a quiet hair
                divider so it sits on the calm surface. */}
            <tr className="border-t border-border/50">
              <td colSpan={6} className="py-2 px-2 text-right text-meta font-semibold text-foreground-muted">
                Order Total:
              </td>
              <td className="py-2 px-2 text-right font-bold text-foreground">
                ${taskTotal.toFixed(2)}
              </td>
              {/* Funding + Vendor + Catalog # + Category + Notes + Assigned to
                  + Order status + PI status + actions = 9 trailing columns. */}
              <td colSpan={9}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Purchase items on Loro chunk 4: per-item version history popup. Only
          mounted when PURCHASE_LORO_ENABLED + a row's History button has been
          clicked (historyItemId non-null). canRestore mirrors the row-edit gate
          (writes must be allowed), so a read-only / shared-into-me viewer can
          browse history but never restore. Flag-off, historyItemId stays null
          and nothing renders. */}
      {PURCHASE_LORO_ENABLED && historyItemId !== null && (
        <PurchaseHistoryPopup
          open={historyItemId !== null}
          onClose={() => setHistoryItemId(null)}
          origin={historyOrigin}
          owner={rowLoroOwner}
          itemId={historyItemId}
          canRestore={!writesDisabled}
          currentUser={currentUser}
          onRestored={() => {
            refetch();
            void queryClient.refetchQueries({ queryKey: ["purchases-all"] });
          }}
        />
      )}

      {/* PI capability revamp Phase 1 (2026-06-07): the once-per-session
          are-you-sure a lab head crosses before editing a member's purchase
          row. Opens from handleRowClick on the first edit of a not-yet-
          confirmed item; onConfirm marks the gate confirmed AND opens the
          editor for the pending item. Only ever rendered/open for a PI on a
          member's record. */}
      <PiEditConfirmDialog
        open={piGate.confirmDialogOpen}
        memberName={purchaseOwner}
        recordLabel="purchase item"
        onConfirm={handlePiConfirm}
        onCancel={handlePiCancel}
      />

      {/* PI capability revamp Phase 2: assign-modal home for the PI record menu
          (purchases use approve/decline, not assign, so this stays inert here;
          rendered for hook symmetry). */}
      {piMenu.modals}
    </div>
  );
}
