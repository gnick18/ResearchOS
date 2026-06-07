"use client";

// Add / edit an InventoryItem (chunk 2). Rendered inside a LivingPopup by the
// /inventory page. Covers the catalog fields (what a thing IS): name, category,
// catalog #, vendor, cas, url, container_label, low_at_count, notes, and the
// plain-text product_barcode (the camera scanner is chunk 6). Name / vendor /
// cas / url autocomplete from the existing Purchases catalog history (design
// Move 4) via purchasesApi.searchCatalog, reusing the same source the Purchases
// editor uses. House style: <Icon> only, brand + semantic tokens, no emojis, no
// em-dashes, no mid-sentence colons.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { purchasesApi } from "@/lib/local-api";
import type {
  CatalogItem,
  InventoryCategory,
  InventoryItem,
  InventoryItemCreate,
  InventoryItemUpdate,
} from "@/lib/types";
import { Icon } from "@/components/icons";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "./inventory-ui";

const INPUT_CLASS =
  "w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action";
const LABEL_CLASS = "block text-meta font-medium text-foreground-muted mb-1";

const VENDOR_DATALIST_ID = "inventory-item-vendor-options";

interface ItemFormDialogProps {
  /** The item to edit, or null when adding a new one. */
  item: InventoryItem | null;
  /** The lab-wide vendor list (extracted from purchase history) for the vendor
   *  datalist. */
  vendorOptions: string[];
  /** Pre-fill `product_barcode` on a NEW item (the scan-to-register flow, chunk
   *  6). Ignored when editing an existing item. */
  initialBarcode?: string | null;
  onCancel: () => void;
  /** Resolve with the created/updated record so the page can refresh. */
  onSubmit: (data: InventoryItemCreate | InventoryItemUpdate) => Promise<void>;
}

interface FormState {
  name: string;
  category: InventoryCategory;
  catalog_number: string;
  vendor: string;
  cas: string;
  url: string;
  container_label: string;
  low_at_count: string;
  product_barcode: string;
  notes: string;
}

function itemToForm(item: InventoryItem | null): FormState {
  return {
    name: item?.name ?? "",
    category: item?.category ?? "reagent",
    catalog_number: item?.catalog_number ?? "",
    vendor: item?.vendor ?? "",
    cas: item?.cas ?? "",
    url: item?.url ?? "",
    container_label: item?.container_label ?? "",
    low_at_count:
      item?.low_at_count != null ? String(item.low_at_count) : "",
    product_barcode: item?.product_barcode ?? "",
    notes: item?.notes ?? "",
  };
}

function toNullable(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export default function ItemFormDialog({
  item,
  vendorOptions,
  initialBarcode,
  onCancel,
  onSubmit,
}: ItemFormDialogProps) {
  const isEdit = item !== null;
  const [form, setForm] = useState<FormState>(() => {
    const base = itemToForm(item);
    // Scan-to-register prefill: only on a new item, only when the form has no
    // barcode yet (never clobber an edited item's existing code).
    if (!item && initialBarcode && !base.product_barcode) {
      return { ...base, product_barcode: initialBarcode };
    }
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Name autocomplete from the Purchases catalog (design Move 4). Mirrors the
  // PurchaseEditor: a debounced purchasesApi.searchCatalog query, results shown
  // as a small suggestion list under the name field. Picking a suggestion fills
  // name / cas / url so re-stocking a known reagent is a pick, not a re-type.
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = form.name.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await purchasesApi.searchCatalog(q);
        setSuggestions(results.slice(0, 8));
        setShowSuggestions(results.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [form.name]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pickSuggestion = (cat: CatalogItem) => {
    setForm((f) => ({
      ...f,
      name: cat.item_name,
      cas: cat.cas ?? f.cas,
      url: cat.link ?? f.url,
    }));
    setShowSuggestions(false);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canSubmit = form.name.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    const lowRaw = form.low_at_count.trim();
    let low_at_count: number | null = null;
    if (lowRaw.length > 0) {
      const parsed = Number(lowRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Low-stock count must be a number of containers (0 or more).");
        return;
      }
      low_at_count = Math.floor(parsed);
    }
    const payload: InventoryItemCreate & InventoryItemUpdate = {
      name: form.name.trim(),
      category: form.category,
      catalog_number: toNullable(form.catalog_number),
      vendor: toNullable(form.vendor),
      cas: toNullable(form.cas),
      url: toNullable(form.url),
      container_label: toNullable(form.container_label),
      low_at_count,
      product_barcode: toNullable(form.product_barcode),
      notes: toNullable(form.notes),
    };
    setSaving(true);
    try {
      await onSubmit(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the item.");
      setSaving(false);
    }
  };

  const vendorList = useMemo(
    () => [...new Set(vendorOptions.filter(Boolean))].sort(),
    [vendorOptions],
  );

  return (
    <div className="p-6 sm:p-7">
      <h2 className="text-title font-semibold text-foreground mb-1">
        {isEdit ? "Edit item" : "Add item"}
      </h2>
      <p className="text-meta text-foreground-muted mb-5">
        What this thing is. Add containers as a stock after saving.
      </p>

      {error && (
        <div className="mb-4 px-3 py-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg text-meta text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Name + autocomplete */}
        <div className="relative" ref={suggestionsRef}>
          <label htmlFor="inv-name" className={LABEL_CLASS}>
            Name
          </label>
          <input
            id="inv-name"
            className={INPUT_CLASS}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            placeholder="Q5 High-Fidelity DNA Polymerase"
            autoComplete="off"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-border bg-surface-raised shadow-lg">
              {suggestions.map((cat) => (
                <li key={cat.id}>
                  <button
                    type="button"
                    onClick={() => pickSuggestion(cat)}
                    className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-sunken"
                  >
                    <span className="text-body text-foreground">
                      {cat.item_name}
                    </span>
                    {cat.cas && (
                      <span className="text-meta text-foreground-muted">
                        CAS {cat.cas}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-meta text-foreground-muted mt-1">
            Suggestions come from your past purchases.
          </p>
        </div>

        {/* Category */}
        <div>
          <label htmlFor="inv-category" className={LABEL_CLASS}>
            Category
          </label>
          <select
            id="inv-category"
            className={INPUT_CLASS}
            value={form.category}
            onChange={(e) =>
              set("category", e.target.value as InventoryCategory)
            }
          >
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>

        {/* Vendor + catalog number */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="inv-vendor" className={LABEL_CLASS}>
              Vendor
            </label>
            <input
              id="inv-vendor"
              className={INPUT_CLASS}
              value={form.vendor}
              onChange={(e) => set("vendor", e.target.value)}
              list={VENDOR_DATALIST_ID}
              placeholder="NEB"
              autoComplete="off"
            />
            <datalist id={VENDOR_DATALIST_ID}>
              {vendorList.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="inv-catalog" className={LABEL_CLASS}>
              Catalog number
            </label>
            <input
              id="inv-catalog"
              className={INPUT_CLASS}
              value={form.catalog_number}
              onChange={(e) => set("catalog_number", e.target.value)}
              placeholder="M0491S"
              autoComplete="off"
            />
          </div>
        </div>

        {/* CAS + container label */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="inv-cas" className={LABEL_CLASS}>
              CAS number
            </label>
            <input
              id="inv-cas"
              className={INPUT_CLASS}
              value={form.cas}
              onChange={(e) => set("cas", e.target.value)}
              placeholder="Chemicals only"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="inv-container-label" className={LABEL_CLASS}>
              Container word
            </label>
            <input
              id="inv-container-label"
              className={INPUT_CLASS}
              value={form.container_label}
              onChange={(e) => set("container_label", e.target.value)}
              placeholder="vial, tube, bottle, plate, box"
              autoComplete="off"
            />
            <p className="text-meta text-foreground-muted mt-1">
              How one container reads in the count. Defaults to container.
            </p>
          </div>
        </div>

        {/* URL */}
        <div>
          <label htmlFor="inv-url" className={LABEL_CLASS}>
            Product page
          </label>
          <input
            id="inv-url"
            className={INPUT_CLASS}
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
            placeholder="https://"
            autoComplete="off"
          />
        </div>

        {/* Low-at count + barcode */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="inv-low" className={LABEL_CLASS}>
              Flag low when below
            </label>
            <input
              id="inv-low"
              type="number"
              min={0}
              step={1}
              className={INPUT_CLASS}
              value={form.low_at_count}
              onChange={(e) => set("low_at_count", e.target.value)}
              placeholder="containers (leave blank for off)"
            />
            <p className="text-meta text-foreground-muted mt-1">
              Counts every container across this item. Blank means no auto flag.
            </p>
          </div>
          <div>
            <label htmlFor="inv-barcode" className={LABEL_CLASS}>
              Product barcode
            </label>
            <input
              id="inv-barcode"
              className={INPUT_CLASS}
              value={form.product_barcode}
              onChange={(e) => set("product_barcode", e.target.value)}
              placeholder="UPC / EAN, optional"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="inv-notes" className={LABEL_CLASS}>
            Notes
          </label>
          <textarea
            id="inv-notes"
            className={`${INPUT_CLASS} min-h-[72px] resize-y`}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Anything worth remembering about this item."
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-body rounded-lg border border-border text-foreground hover:bg-surface-sunken transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="btn-brand inline-flex items-center gap-1.5 px-4 py-2 text-body rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="check" className="h-4 w-4" />
          {isEdit ? "Save item" : "Add item"}
        </button>
      </div>
    </div>
  );
}
