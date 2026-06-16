"use client";

// Add / edit an InventoryStock (chunk 2). One stock is a lot/batch of physical
// containers of one item. The count is the spine (design Move 1). amount /unit
// are optional and only shown as a labeled detail, never required (design Move
// 5). status is derived-and-persisted by the API's deriveInventoryStatus, so
// this form sets the inputs and lets the API derive; a manual low/empty tap is
// done from the stock row, not here. House style: <Icon> only, brand + semantic
// tokens, no emojis, no em-dashes, no mid-sentence colons.

import { useState } from "react";

import type {
  InventoryItem,
  InventoryStock,
  InventoryStockCreate,
  InventoryStockUpdate,
  StorageNode,
} from "@/lib/types";
import { Icon } from "@/components/icons";
import LocationPicker from "./LocationPicker";
import { containerWord, dateInputToIso, isoToDateInput } from "./inventory-ui";

const INPUT_CLASS =
  "w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action";
const LABEL_CLASS = "block text-meta font-medium text-foreground-muted mb-1";

interface StockFormDialogProps {
  /** The parent item (for the container word + the amount-field gate). */
  item: InventoryItem;
  /** The stock to edit, or null when adding a new one. */
  stock: InventoryStock | null;
  /** The storage-node tree, for the cascading location picker. */
  nodes: StorageNode[];
  onCancel: () => void;
  onSubmit: (data: InventoryStockCreate | InventoryStockUpdate) => Promise<void>;
}

interface FormState {
  container_count: string;
  lot_number: string;
  received_date: string;
  expiration_date: string;
  amount_per_container: string;
  unit: string;
  concentration: string;
  location_text: string;
  container_code: string;
  notes: string;
}

function stockToForm(stock: InventoryStock | null): FormState {
  return {
    container_count:
      stock != null ? String(stock.container_count) : "1",
    lot_number: stock?.lot_number ?? "",
    received_date: isoToDateInput(stock?.received_date),
    expiration_date: isoToDateInput(stock?.expiration_date),
    amount_per_container:
      stock?.amount_per_container != null
        ? String(stock.amount_per_container)
        : "",
    unit: stock?.unit ?? "",
    concentration: stock?.concentration ?? "",
    location_text: stock?.location_text ?? "",
    container_code: stock?.container_code ?? "",
    notes: stock?.notes ?? "",
  };
}

function toNullable(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export default function StockFormDialog({
  item,
  stock,
  nodes,
  onCancel,
  onSubmit,
}: StockFormDialogProps) {
  const isEdit = stock !== null;
  const [form, setForm] = useState<FormState>(() => stockToForm(stock));
  // Node-based location (the box-finder pin). Coexists with location_text: when
  // a box + cell are set they take precedence on display, but the free-text
  // note is always preserved and still valid on its own (design v2).
  const [locationNodeId, setLocationNodeId] = useState<number | null>(
    () => stock?.location_node_id ?? null,
  );
  const [position, setPosition] = useState<string | null>(
    () => stock?.position ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Amount-per-container is opt-in detail. Show it pre-filled when the stock
  // already carries an amount, otherwise behind a small toggle so the default
  // count-only flow never sees a volume field it must maintain (design 2.6).
  const [showAmount, setShowAmount] = useState(
    () => stock?.amount_per_container != null || (stock?.unit ?? "") !== "",
  );

  const word = containerWord(item.container_label);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canSubmit = !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);

    const countRaw = form.container_count.trim();
    let container_count = 1;
    if (countRaw.length > 0) {
      const parsed = Number(countRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Container count must be 0 or more.");
        return;
      }
      container_count = Math.floor(parsed);
    }

    let amount_per_container: number | null = null;
    if (showAmount && form.amount_per_container.trim().length > 0) {
      const parsed = Number(form.amount_per_container);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Amount per container must be a non-negative number.");
        return;
      }
      amount_per_container = parsed;
    }

    const payload: InventoryStockCreate & InventoryStockUpdate = {
      item_id: item.id,
      container_count,
      lot_number: toNullable(form.lot_number),
      received_date: dateInputToIso(form.received_date),
      expiration_date: dateInputToIso(form.expiration_date),
      amount_per_container,
      unit: showAmount ? toNullable(form.unit) : null,
      concentration: toNullable(form.concentration),
      location_text: toNullable(form.location_text),
      // The node-based pin coexists with the free-text note. We only persist a
      // position when a box is actually selected (a non-box node records the
      // general spot without a cell).
      location_node_id: locationNodeId,
      position: locationNodeId != null ? position : null,
      container_code: toNullable(form.container_code),
      notes: toNullable(form.notes),
    };
    setSaving(true);
    try {
      await onSubmit(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the stock.");
      setSaving(false);
    }
  };

  return (
    <div className="p-6 sm:p-7">
      <h2 className="text-title font-semibold text-foreground mb-1">
        {isEdit ? "Edit stock" : "Add stock"}
      </h2>
      <p className="text-meta text-foreground-muted mb-5">
        A lot of {word}s for {item.name}. Change the count only when a container
        is finished or a new one arrives.
      </p>

      {error && (
        <div className="mb-4 px-3 py-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg text-meta text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Count + lot */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="stock-count" className={LABEL_CLASS}>
              Container count ({word}s)
            </label>
            <input
              id="stock-count"
              type="number"
              min={0}
              step={1}
              className={INPUT_CLASS}
              value={form.container_count}
              onChange={(e) => set("container_count", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="stock-lot" className={LABEL_CLASS}>
              Lot number
            </label>
            <input
              id="stock-lot"
              className={INPUT_CLASS}
              value={form.lot_number}
              onChange={(e) => set("lot_number", e.target.value)}
              placeholder="Optional"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Received + expiration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="stock-received" className={LABEL_CLASS}>
              Received date
            </label>
            <input
              id="stock-received"
              type="date"
              className={INPUT_CLASS}
              value={form.received_date}
              onChange={(e) => set("received_date", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="stock-expiration" className={LABEL_CLASS}>
              Expiration date
            </label>
            <input
              id="stock-expiration"
              type="date"
              className={INPUT_CLASS}
              value={form.expiration_date}
              onChange={(e) => set("expiration_date", e.target.value)}
            />
            <p className="text-meta text-foreground-muted mt-1">
              Type it once. The clock flags expiring soon forever.
            </p>
          </div>
        </div>

        {/* Concentration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="stock-conc" className={LABEL_CLASS}>
              Concentration
            </label>
            <input
              id="stock-conc"
              className={INPUT_CLASS}
              value={form.concentration}
              onChange={(e) => set("concentration", e.target.value)}
              placeholder="10 uM, 5 mg/mL"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Location: the cascading box picker plus the v1 free-text note. Both
            paths are valid; a box + cell take precedence on display, the note
            is the fallback. */}
        <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
          <p className={LABEL_CLASS}>Location</p>
          <LocationPicker
            nodes={nodes}
            nodeId={locationNodeId}
            position={position}
            onChange={({ nodeId, position: pos }) => {
              setLocationNodeId(nodeId);
              setPosition(pos);
            }}
          />
          <div className="mt-3">
            <label htmlFor="stock-location" className={LABEL_CLASS}>
              Or a free-text note
            </label>
            <input
              id="stock-location"
              className={INPUT_CLASS}
              value={form.location_text}
              onChange={(e) => set("location_text", e.target.value)}
              placeholder="-80 door, left"
              autoComplete="off"
            />
            <p className="text-meta text-foreground-muted mt-1">
              Use the picker for an exact box cell, or leave a quick note. Both
              still work.
            </p>
          </div>
        </div>

        {/* Container code */}
        <div>
          <label htmlFor="stock-code" className={LABEL_CLASS}>
            Container code
          </label>
          <input
            id="stock-code"
            className={INPUT_CLASS}
            value={form.container_code}
            onChange={(e) => set("container_code", e.target.value)}
            placeholder="A lab label or QR id, optional"
            autoComplete="off"
          />
        </div>

        {/* Optional amount per container (opt-in detail) */}
        {showAmount ? (
          <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="stock-amount" className={LABEL_CLASS}>
                  Amount per container
                </label>
                <input
                  id="stock-amount"
                  type="number"
                  min={0}
                  step="any"
                  className={INPUT_CLASS}
                  value={form.amount_per_container}
                  onChange={(e) =>
                    set("amount_per_container", e.target.value)
                  }
                  placeholder="Optional label"
                />
              </div>
              <div>
                <label htmlFor="stock-unit" className={LABEL_CLASS}>
                  Unit
                </label>
                <input
                  id="stock-unit"
                  className={INPUT_CLASS}
                  value={form.unit}
                  onChange={(e) => set("unit", e.target.value)}
                  placeholder="uL, mg, rxn"
                  autoComplete="off"
                />
              </div>
            </div>
            <p className="text-meta text-foreground-muted mt-2">
              A label on each container, never a running total. The low-stock
              signal still counts containers.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAmount(true)}
            className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-action hover:underline"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add an amount per container
          </button>
        )}

        {/* Notes */}
        <div>
          <label htmlFor="stock-notes" className={LABEL_CLASS}>
            Notes
          </label>
          <textarea
            id="stock-notes"
            className={`${INPUT_CLASS} min-h-[60px] resize-y`}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Anything worth remembering about this lot."
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="ros-btn-neutral px-4 py-2 text-body text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 px-4 py-2 text-body rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="check" className="h-4 w-4" />
          {isEdit ? "Save stock" : "Add stock"}
        </button>
      </div>
    </div>
  );
}
