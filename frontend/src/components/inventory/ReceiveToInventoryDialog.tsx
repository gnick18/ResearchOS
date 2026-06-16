"use client";

// ReceiveToInventoryDialog — chunk 4 (chunk-4 bot, 2026-06-07).
//
// Shown after a PurchaseItem transitions to "received" and INVENTORY_ENABLED is
// true. Offers three choices:
//   1. Skip / do not add to inventory.
//   2. Create a new InventoryItem (pre-filled from the PurchaseItem) + a first
//      InventoryStock linked via purchase_item_id.
//   3. Add stock to an existing item — a combobox search over all lab items. If
//      an existing stock for that item already carries the same (lot, expiry,
//      location) triple, bumps its container_count; otherwise creates a new
//      stock.
//
// The dialog is a LivingPopup (card=false + showClose=false) with its own card
// chrome so it matches the AppShell living-popup vocabulary. House style:
// inline SVG icons via <Icon>, brand/semantic tokens, no emojis, no em-dashes,
// no mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import {
  fetchAllInventoryItemsIncludingShared,
  inventoryItemsApi,
  inventoryStocksApi,
} from "@/lib/local-api";
import type {
  InventoryItem,
  InventoryItemCreate,
  InventoryStockCreate,
  PurchaseItem,
} from "@/lib/types";
import { dateInputToIso, isoToDateInput } from "./inventory-ui";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ── shared form helpers ──────────────────────────────────────────────────────

const INPUT_CLASS =
  "w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action";
const LABEL_CLASS = "block text-meta font-medium text-foreground-muted mb-1";

function toNullable(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}

// ── three-way choice ─────────────────────────────────────────────────────────

type Step = "choice" | "create-new" | "add-to-existing";

// ── props ─────────────────────────────────────────────────────────────────────

export interface ReceiveToInventoryDialogProps {
  /** The just-received purchase item. */
  purchaseItem: PurchaseItem;
  /** Called when skipped or finished. */
  onClose: () => void;
}

// ── main component ────────────────────────────────────────────────────────────

export default function ReceiveToInventoryDialog({
  purchaseItem,
  onClose,
}: ReceiveToInventoryDialogProps) {
  // Receive bridge (supplies-v2 chunk 4): a line that was started via "Reorder"
  // from a supply carries inventory_item_id, so the received batch belongs to a
  // known item. Skip the three-way choice and go straight to "add stock to
  // existing" with that item pre-selected (no re-pick).
  const linkedItemId = purchaseItem.inventory_item_id ?? null;
  const [step, setStep] = useState<Step>(
    linkedItemId != null ? "add-to-existing" : "choice",
  );

  return (
    <LivingPopup
      open
      onClose={onClose}
      label="Add received item to inventory"
      card={false}
      showClose={false}
      widthClassName="max-w-lg"
      closeOnScrimClick={false}
    >
      <div className="rounded-2xl bg-surface-overlay border border-border shadow-2xl ring-1 ring-black/5 w-full overflow-hidden">
        {step === "choice" && (
          <ChoiceStep
            purchaseItem={purchaseItem}
            onSkip={onClose}
            onCreateNew={() => setStep("create-new")}
            onAddToExisting={() => setStep("add-to-existing")}
          />
        )}
        {step === "create-new" && (
          <CreateNewStep
            purchaseItem={purchaseItem}
            onBack={() => setStep("choice")}
            onClose={onClose}
          />
        )}
        {step === "add-to-existing" && (
          <AddToExistingStep
            purchaseItem={purchaseItem}
            preselectItemId={linkedItemId}
            onBack={() => setStep("choice")}
            onClose={onClose}
          />
        )}
      </div>
    </LivingPopup>
  );
}

// ── step 1: three-way choice ──────────────────────────────────────────────────

function ChoiceStep({
  purchaseItem,
  onSkip,
  onCreateNew,
  onAddToExisting,
}: {
  purchaseItem: PurchaseItem;
  onSkip: () => void;
  onCreateNew: () => void;
  onAddToExisting: () => void;
}) {
  return (
    <div className="p-6 sm:p-7">
      <div className="flex items-start gap-3 mb-5">
        <div className="mt-0.5 flex-shrink-0 rounded-lg bg-brand-action/10 p-2">
          <Icon name="box" className="h-5 w-5 text-brand-action" />
        </div>
        <div>
          <h2 className="text-title font-semibold text-foreground mb-0.5">
            Add to inventory?
          </h2>
          <p className="text-meta text-foreground-muted">
            <span className="font-medium text-foreground">
              {purchaseItem.item_name}
            </span>{" "}
            was received. Do you want to add it to your inventory?
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <ChoiceButton
          onClick={onCreateNew}
          icon={<Icon name="plus" className="h-5 w-5 text-brand-action" />}
          title="Create a new inventory item"
          description="Start tracking this reagent for the first time."
        />
        <ChoiceButton
          onClick={onAddToExisting}
          icon={<Icon name="merge" className="h-5 w-5 text-brand-action" />}
          title="Add stock to an existing item"
          description="You already have this reagent. Add the new batch."
        />
        <ChoiceButton
          onClick={onSkip}
          icon={<Icon name="skip" className="h-5 w-5 text-foreground-muted" />}
          title="Skip"
          description="Services, one-offs, or items you do not track."
          muted
        />
      </div>
    </div>
  );
}

function ChoiceButton({
  onClick,
  icon,
  title,
  description,
  muted = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-3 rounded-xl px-4 py-3 text-left border transition-colors ${
        muted
          ? "border-border hover:bg-surface-sunken text-foreground-muted"
          : "border-border hover:bg-surface-sunken hover:border-brand-action/30"
      }`}
    >
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <span>
        <span
          className={`block text-body font-medium ${muted ? "text-foreground-muted" : "text-foreground"}`}
        >
          {title}
        </span>
        <span className="block text-meta text-foreground-muted mt-0.5">
          {description}
        </span>
      </span>
      {!muted && (
        <span className="ml-auto mt-1 flex-shrink-0 text-foreground-muted">
          <Icon name="chevronRight" className="h-4 w-4" />
        </span>
      )}
    </button>
  );
}

// ── step 2: create new item + first stock ────────────────────────────────────

interface StockFields {
  expiration_date: string;
  location_text: string;
  lot_number: string;
}

function defaultStockFields(): StockFields {
  return { expiration_date: "", location_text: "", lot_number: "" };
}

function CreateNewStep({
  purchaseItem,
  onBack,
  onClose,
}: {
  purchaseItem: PurchaseItem;
  onBack: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [stock, setStock] = useState<StockFields>(defaultStockFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = <K extends keyof StockFields>(
    key: K,
    value: StockFields[K],
  ) => setStock((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const itemPayload: InventoryItemCreate = {
        name: purchaseItem.item_name,
        category: "reagent",
        vendor: purchaseItem.vendor ?? undefined,
        cas: purchaseItem.cas ?? undefined,
        url: purchaseItem.link ?? undefined,
      };
      const newItem = await inventoryItemsApi.create(itemPayload);

      const today = new Date().toISOString().split("T")[0];
      const stockPayload: InventoryStockCreate = {
        item_id: newItem.id,
        purchase_item_id: purchaseItem.id,
        // Store the full UTC-midnight ISO (same as StockFormDialog) so the
        // received/expiry dates share one shape on disk.
        received_date: dateInputToIso(today),
        container_count:
          typeof purchaseItem.quantity === "number" &&
          purchaseItem.quantity >= 1
            ? Math.floor(purchaseItem.quantity)
            : 1,
        status: "in_stock",
        expiration_date: dateInputToIso(stock.expiration_date),
        location_text: toNullable(stock.location_text),
        lot_number: toNullable(stock.lot_number),
      };
      await inventoryStocksApi.create(stockPayload);

      await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory-stocks"] });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save to inventory.",
      );
      setSaving(false);
    }
  };

  return (
    <div className="p-6 sm:p-7">
      {/* Header */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-meta font-medium text-foreground-muted hover:text-foreground mb-4 transition-colors"
      >
        <Icon name="chevronLeft" className="h-3.5 w-3.5" />
        Back
      </button>

      <h2 className="text-title font-semibold text-foreground mb-1">
        New inventory item
      </h2>
      <p className="text-meta text-foreground-muted mb-4">
        Pre-filled from the purchase order. Edit after saving if needed.
      </p>

      {/* Read-only pre-fill summary */}
      <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3 mb-4 space-y-1">
        <PreFillRow label="Name" value={purchaseItem.item_name} />
        {purchaseItem.vendor && (
          <PreFillRow label="Vendor" value={purchaseItem.vendor} />
        )}
        {purchaseItem.cas && (
          <PreFillRow label="CAS" value={purchaseItem.cas} />
        )}
        <PreFillRow
          label="Count"
          value={`${typeof purchaseItem.quantity === "number" && purchaseItem.quantity >= 1 ? Math.floor(purchaseItem.quantity) : 1} container(s)`}
        />
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="rtid-expiry" className={LABEL_CLASS}>
              Expiration date
            </label>
            <input
              id="rtid-expiry"
              type="date"
              className={INPUT_CLASS}
              value={stock.expiration_date}
              onChange={(e) => setField("expiration_date", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="rtid-lot" className={LABEL_CLASS}>
              Lot number
            </label>
            <input
              id="rtid-lot"
              className={INPUT_CLASS}
              value={stock.lot_number}
              onChange={(e) => setField("lot_number", e.target.value)}
              placeholder="Optional"
              autoComplete="off"
            />
          </div>
        </div>
        <div>
          <label htmlFor="rtid-location" className={LABEL_CLASS}>
            Location
          </label>
          <input
            id="rtid-location"
            className={INPUT_CLASS}
            value={stock.location_text}
            onChange={(e) => setField("location_text", e.target.value)}
            placeholder="-80 door, left"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onBack}
          className="ros-btn-neutral px-4 py-2 text-body text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 px-4 py-2 text-body rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="check" className="h-4 w-4" />
          {saving ? "Saving..." : "Add to inventory"}
        </button>
      </div>
    </div>
  );
}

// ── step 3: add stock to existing item ───────────────────────────────────────

function AddToExistingStep({
  purchaseItem,
  preselectItemId = null,
  onBack,
  onClose,
}: {
  purchaseItem: PurchaseItem;
  /** When the line carries an inventory_item_id (a reorder from a supply),
   *  pre-select that item once the item list loads. */
  preselectItemId?: number | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [stock, setStock] = useState<StockFields>(defaultStockFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same key the inventory page and global search use, so this list reads the
  // shared cache (and the page's invalidateQueries refreshes it) instead of
  // forking a second, never-invalidated entry.
  const { data: allItems = [] } = useQuery({
    queryKey: ["inventory-items", currentUser],
    queryFn: fetchAllInventoryItemsIncludingShared,
  });

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allItems.slice(0, 12);
    return allItems
      .filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.vendor ?? "").toLowerCase().includes(q) ||
          (it.catalog_number ?? "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [allItems, search]);

  const setField = <K extends keyof StockFields>(
    key: K,
    value: StockFields[K],
  ) => setStock((f) => ({ ...f, [key]: value }));

  const pickItem = (it: InventoryItem) => {
    setSelectedItem(it);
    setSearch(it.name);
    setShowSuggestions(false);
  };

  // Receive bridge (supplies-v2 chunk 4): when the line links to a known item,
  // pre-select it as soon as the list loads so the user does not re-pick.
  useEffect(() => {
    if (preselectItemId == null || selectedItem) return;
    const linked = allItems.find((it) => it.id === preselectItemId);
    if (linked) pickItem(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectItemId, allItems, selectedItem]);

  const handleSubmit = async () => {
    if (!selectedItem) return;
    setSaving(true);
    setError(null);
    try {
      const today = new Date().toISOString().split("T")[0];
      const newCount =
        typeof purchaseItem.quantity === "number" && purchaseItem.quantity >= 1
          ? Math.floor(purchaseItem.quantity)
          : 1;
      const expirationDate = dateInputToIso(stock.expiration_date);
      const locationText = toNullable(stock.location_text);
      const lotNumber = toNullable(stock.lot_number);

      // Check for an existing stock on this item that matches the
      // (lot, expiry, location) triple. If found, bump its count.
      const existingStocks = await inventoryStocksApi.listForItem(
        selectedItem.id,
        selectedItem.owner,
      );
      const match = existingStocks.find(
        (s) =>
          (s.lot_number ?? null) === lotNumber &&
          (s.expiration_date ?? null) === expirationDate &&
          (s.location_text ?? null) === locationText,
      );

      if (match) {
        await inventoryStocksApi.update(
          match.id,
          { container_count: match.container_count + newCount },
          selectedItem.owner,
        );
      } else {
        const stockPayload: InventoryStockCreate = {
          item_id: selectedItem.id,
          purchase_item_id: purchaseItem.id,
          received_date: dateInputToIso(today),
          container_count: newCount,
          status: "in_stock",
          expiration_date: expirationDate,
          location_text: locationText,
          lot_number: lotNumber,
        };
        await inventoryStocksApi.create(stockPayload, selectedItem.owner);
      }

      await queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory-stocks"] });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save to inventory.",
      );
      setSaving(false);
    }
  };

  return (
    <div className="p-6 sm:p-7">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-meta font-medium text-foreground-muted hover:text-foreground mb-4 transition-colors"
      >
        <Icon name="chevronLeft" className="h-3.5 w-3.5" />
        Back
      </button>

      <h2 className="text-title font-semibold text-foreground mb-1">
        Add stock to existing item
      </h2>
      <p className="text-meta text-foreground-muted mb-4">
        Search for the item, then fill in the batch details.
      </p>

      {error && <ErrorBanner message={error} />}

      <div className="space-y-4">
        {/* Item search */}
        <div className="relative">
          <label htmlFor="rtid-search" className={LABEL_CLASS}>
            Item
          </label>
          <input
            id="rtid-search"
            className={INPUT_CLASS}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedItem(null);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Search by name, vendor, or catalog number"
            autoComplete="off"
          />
          {showSuggestions && filteredItems.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-border bg-surface-raised shadow-lg">
              {filteredItems.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickItem(it)}
                    className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-sunken"
                  >
                    <span className="text-body text-foreground">{it.name}</span>
                    {(it.vendor || it.catalog_number) && (
                      <span className="text-meta text-foreground-muted">
                        {[it.vendor, it.catalog_number]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Stock details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="rtid-ae-expiry" className={LABEL_CLASS}>
              Expiration date
            </label>
            <input
              id="rtid-ae-expiry"
              type="date"
              className={INPUT_CLASS}
              value={stock.expiration_date}
              onChange={(e) => setField("expiration_date", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="rtid-ae-lot" className={LABEL_CLASS}>
              Lot number
            </label>
            <input
              id="rtid-ae-lot"
              className={INPUT_CLASS}
              value={stock.lot_number}
              onChange={(e) => setField("lot_number", e.target.value)}
              placeholder="Optional"
              autoComplete="off"
            />
          </div>
        </div>
        <div>
          <label htmlFor="rtid-ae-location" className={LABEL_CLASS}>
            Location
          </label>
          <input
            id="rtid-ae-location"
            className={INPUT_CLASS}
            value={stock.location_text}
            onChange={(e) => setField("location_text", e.target.value)}
            placeholder="-80 door, left"
            autoComplete="off"
          />
          <p className="text-meta text-foreground-muted mt-1">
            If an existing batch with the same lot, expiry, and location is
            found, its count will be bumped instead of creating a new row.
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onBack}
          className="ros-btn-neutral px-4 py-2 text-body text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !selectedItem}
          className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 px-4 py-2 text-body rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="check" className="h-4 w-4" />
          {saving ? "Saving..." : "Add stock"}
        </button>
      </div>
    </div>
  );
}

// ── small helpers ─────────────────────────────────────────────────────────────

function PreFillRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-meta">
      <span className="text-foreground-muted w-14 flex-shrink-0">{label}</span>
      <span className="text-foreground font-medium truncate">{value}</span>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 px-3 py-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg text-meta text-rose-700 dark:text-rose-300">
      {message}
    </div>
  );
}
