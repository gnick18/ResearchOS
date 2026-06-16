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
  AntibodyRegistry,
  CatalogItem,
  InventoryCategory,
  InventoryItem,
  InventoryItemCreate,
  InventoryItemUpdate,
  InventoryRegistry,
  PlasmidRegistry,
} from "@/lib/types";
import { Icon } from "@/components/icons";
import {
  ANTIBODY_APPLICATIONS,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
} from "./inventory-ui";

const INPUT_CLASS =
  "w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action";
const LABEL_CLASS = "block text-meta font-medium text-foreground-muted mb-1";
// The typed-registry section block (design §7): a left-accented, sunken card
// that appears only for the antibody / plasmid categories.
const TYPED_SECTION_CLASS =
  "rounded-xl border border-border border-l-[3px] border-l-brand-action bg-surface-sunken p-4";
const TYPED_HEADER_CLASS =
  "mb-3 text-meta font-semibold text-brand-action";

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
  storage_class: string;
  hazard_note: string;
  sds_url: string;
  low_at_count: string;
  product_barcode: string;
  notes: string;
  // Antibody registry fields (design §7.2). Kept in state regardless of the
  // current category so switching away and back does not lose typed entries;
  // only the category-matching registry is SAVED.
  ab_target: string;
  ab_host_species: string;
  ab_clonality: "" | "monoclonal" | "polyclonal";
  ab_clone: string;
  ab_conjugate: string;
  ab_isotype: string;
  ab_reactivity: string;
  ab_applications: string[];
  ab_rrid: string;
  ab_recommended_dilution: string;
  // Plasmid registry fields (design §7.1).
  pl_backbone: string;
  pl_insert: string;
  pl_resistance: string;
  pl_bacterial_host: string;
  pl_size_bp: string;
  pl_source: string;
  pl_addgene_id: string;
  pl_sequence_file_path: string;
  pl_map_notes: string;
}

function asAntibody(reg: InventoryRegistry | null | undefined): AntibodyRegistry {
  return (reg ?? {}) as AntibodyRegistry;
}

function asPlasmid(reg: InventoryRegistry | null | undefined): PlasmidRegistry {
  return (reg ?? {}) as PlasmidRegistry;
}

function itemToForm(item: InventoryItem | null): FormState {
  const ab = item?.category === "antibody" ? asAntibody(item.registry) : {};
  const pl = item?.category === "plasmid" ? asPlasmid(item.registry) : {};
  return {
    name: item?.name ?? "",
    category: item?.category ?? "reagent",
    catalog_number: item?.catalog_number ?? "",
    vendor: item?.vendor ?? "",
    cas: item?.cas ?? "",
    url: item?.url ?? "",
    container_label: item?.container_label ?? "",
    storage_class: item?.storage_class ?? "",
    hazard_note: item?.hazard_note ?? "",
    sds_url: item?.sds_url ?? "",
    low_at_count:
      item?.low_at_count != null ? String(item.low_at_count) : "",
    product_barcode: item?.product_barcode ?? "",
    notes: item?.notes ?? "",
    ab_target: ab.target ?? "",
    ab_host_species: ab.host_species ?? "",
    ab_clonality: ab.clonality ?? "",
    ab_clone: ab.clone ?? "",
    ab_conjugate: ab.conjugate ?? "",
    ab_isotype: ab.isotype ?? "",
    ab_reactivity: ab.reactivity ?? "",
    ab_applications: ab.applications ?? [],
    ab_rrid: ab.rrid ?? "",
    ab_recommended_dilution: ab.recommended_dilution ?? "",
    pl_backbone: pl.backbone ?? "",
    pl_insert: pl.insert ?? "",
    pl_resistance: pl.resistance ?? "",
    pl_bacterial_host: pl.bacterial_host ?? "",
    pl_size_bp:
      typeof pl.size_bp === "number" ? String(pl.size_bp) : "",
    pl_source: pl.source ?? "",
    pl_addgene_id: pl.addgene_id ?? "",
    pl_sequence_file_path: pl.sequence_file_path ?? "",
    pl_map_notes: pl.map_notes ?? "",
  };
}

function toNullable(value: string): string | null {
  const v = value.trim();
  return v.length > 0 ? v : null;
}

/** Build the category-matching registry for the current form, or null for a
 *  non-typed category. Each field is trimmed to null; the size_bp / applications
 *  fields are coerced to their typed shapes. */
function buildRegistry(form: FormState): InventoryRegistry | null {
  if (form.category === "antibody") {
    const reg: AntibodyRegistry = {
      target: toNullable(form.ab_target),
      host_species: toNullable(form.ab_host_species),
      clonality: form.ab_clonality === "" ? null : form.ab_clonality,
      clone: toNullable(form.ab_clone),
      conjugate: toNullable(form.ab_conjugate),
      isotype: toNullable(form.ab_isotype),
      reactivity: toNullable(form.ab_reactivity),
      applications:
        form.ab_applications.length > 0 ? [...form.ab_applications] : null,
      rrid: toNullable(form.ab_rrid),
      recommended_dilution: toNullable(form.ab_recommended_dilution),
    };
    return reg;
  }
  if (form.category === "plasmid") {
    const sizeRaw = form.pl_size_bp.trim();
    const sizeParsed = sizeRaw.length > 0 ? Number(sizeRaw) : NaN;
    const reg: PlasmidRegistry = {
      backbone: toNullable(form.pl_backbone),
      insert: toNullable(form.pl_insert),
      resistance: toNullable(form.pl_resistance),
      bacterial_host: toNullable(form.pl_bacterial_host),
      size_bp: Number.isFinite(sizeParsed) ? Math.floor(sizeParsed) : null,
      source: toNullable(form.pl_source),
      addgene_id: toNullable(form.pl_addgene_id),
      sequence_file_path: toNullable(form.pl_sequence_file_path),
      map_notes: toNullable(form.pl_map_notes),
    };
    return reg;
  }
  return null;
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

  const toggleApplication = (app: string) =>
    setForm((f) => ({
      ...f,
      ab_applications: f.ab_applications.includes(app)
        ? f.ab_applications.filter((a) => a !== app)
        : [...f.ab_applications, app],
    }));

  const canSubmit = form.name.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    const lowRaw = form.low_at_count.trim();
    let low_at_count: number | null = null;
    if (lowRaw.length > 0) {
      const parsed = Number(lowRaw);
      // A threshold of 0 can never fire (total < 0 is always false), so it would
      // silently disable the flag. Require 1 or more, and leave blank for off.
      if (!Number.isFinite(parsed) || parsed < 1) {
        setError("Low-stock count must be 1 or more (leave blank to turn off).");
        return;
      }
      low_at_count = Math.floor(parsed);
    }
    // Save ONLY the registry matching the current category. An antibody item
    // saves an AntibodyRegistry, a plasmid item a PlasmidRegistry, every other
    // category saves registry: null (any typed entries stay in state but are not
    // persisted while the category does not match).
    const registry: InventoryRegistry | null = buildRegistry(form);

    const payload: InventoryItemCreate & InventoryItemUpdate = {
      name: form.name.trim(),
      category: form.category,
      catalog_number: toNullable(form.catalog_number),
      vendor: toNullable(form.vendor),
      cas: toNullable(form.cas),
      url: toNullable(form.url),
      container_label: toNullable(form.container_label),
      storage_class: toNullable(form.storage_class),
      hazard_note: toNullable(form.hazard_note),
      sds_url: toNullable(form.sds_url),
      low_at_count,
      product_barcode: toNullable(form.product_barcode),
      notes: toNullable(form.notes),
      registry,
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

        {/* Antibody details (design §7.2) — only when category is Antibody. */}
        {form.category === "antibody" && (
          <div className={TYPED_SECTION_CLASS}>
            <div className={TYPED_HEADER_CLASS}>Antibody details</div>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ab-target" className={LABEL_CLASS}>
                    Target
                  </label>
                  <input
                    id="ab-target"
                    className={INPUT_CLASS}
                    value={form.ab_target}
                    onChange={(e) => set("ab_target", e.target.value)}
                    placeholder="beta-actin"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="ab-host" className={LABEL_CLASS}>
                    Host species
                  </label>
                  <input
                    id="ab-host"
                    className={INPUT_CLASS}
                    value={form.ab_host_species}
                    onChange={(e) => set("ab_host_species", e.target.value)}
                    placeholder="Rabbit, Mouse"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ab-clonality" className={LABEL_CLASS}>
                    Clonality
                  </label>
                  <select
                    id="ab-clonality"
                    className={INPUT_CLASS}
                    value={form.ab_clonality}
                    onChange={(e) =>
                      set(
                        "ab_clonality",
                        e.target.value as FormState["ab_clonality"],
                      )
                    }
                  >
                    <option value="">Unspecified</option>
                    <option value="monoclonal">Monoclonal</option>
                    <option value="polyclonal">Polyclonal</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ab-conjugate" className={LABEL_CLASS}>
                    Conjugate
                  </label>
                  <input
                    id="ab-conjugate"
                    className={INPUT_CLASS}
                    value={form.ab_conjugate}
                    onChange={(e) => set("ab_conjugate", e.target.value)}
                    placeholder="HRP, AlexaFluor-488, unconjugated"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ab-clone" className={LABEL_CLASS}>
                    Clone
                  </label>
                  <input
                    id="ab-clone"
                    className={INPUT_CLASS}
                    value={form.ab_clone}
                    onChange={(e) => set("ab_clone", e.target.value)}
                    placeholder="Clone id (monoclonals)"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="ab-isotype" className={LABEL_CLASS}>
                    Isotype
                  </label>
                  <input
                    id="ab-isotype"
                    className={INPUT_CLASS}
                    value={form.ab_isotype}
                    onChange={(e) => set("ab_isotype", e.target.value)}
                    placeholder="IgG1"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ab-reactivity" className={LABEL_CLASS}>
                    Reactivity
                  </label>
                  <input
                    id="ab-reactivity"
                    className={INPUT_CLASS}
                    value={form.ab_reactivity}
                    onChange={(e) => set("ab_reactivity", e.target.value)}
                    placeholder="Human, Mouse"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="ab-rrid" className={LABEL_CLASS}>
                    RRID
                  </label>
                  <input
                    id="ab-rrid"
                    className={INPUT_CLASS}
                    value={form.ab_rrid}
                    onChange={(e) => set("ab_rrid", e.target.value)}
                    placeholder="AB_xxxxxxx"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div>
                <span className={LABEL_CLASS}>Applications</span>
                <div className="flex flex-wrap gap-2">
                  {ANTIBODY_APPLICATIONS.map((app) => {
                    const on = form.ab_applications.includes(app);
                    return (
                      <button
                        key={app}
                        type="button"
                        onClick={() => toggleApplication(app)}
                        aria-pressed={on}
                        className={`rounded-full border px-3 py-0.5 text-meta transition-colors ${
                          on
                            ? "border-brand-action bg-brand-action text-white"
                            : "border-border bg-surface-raised text-foreground hover:bg-surface-sunken"
                        }`}
                      >
                        {app}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label htmlFor="ab-dilution" className={LABEL_CLASS}>
                  Recommended dilution
                </label>
                <input
                  id="ab-dilution"
                  className={INPUT_CLASS}
                  value={form.ab_recommended_dilution}
                  onChange={(e) =>
                    set("ab_recommended_dilution", e.target.value)
                  }
                  placeholder="1:1000 (WB)"
                  autoComplete="off"
                />
              </div>
              <p className="text-meta text-foreground-muted">
                These appear only for the Antibody category. All optional. RRID,
                applications, and dilution feed the planned Western blot / IHC
                method types later.
              </p>
            </div>
          </div>
        )}

        {/* Plasmid details (design §7.1) — only when category is Plasmid. */}
        {form.category === "plasmid" && (
          <div className={TYPED_SECTION_CLASS}>
            <div className={TYPED_HEADER_CLASS}>Plasmid details</div>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pl-backbone" className={LABEL_CLASS}>
                    Backbone
                  </label>
                  <input
                    id="pl-backbone"
                    className={INPUT_CLASS}
                    value={form.pl_backbone}
                    onChange={(e) => set("pl_backbone", e.target.value)}
                    placeholder="pUC19, pET-28a"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="pl-insert" className={LABEL_CLASS}>
                    Insert
                  </label>
                  <input
                    id="pl-insert"
                    className={INPUT_CLASS}
                    value={form.pl_insert}
                    onChange={(e) => set("pl_insert", e.target.value)}
                    placeholder="GFP"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pl-resistance" className={LABEL_CLASS}>
                    Resistance
                  </label>
                  <input
                    id="pl-resistance"
                    className={INPUT_CLASS}
                    value={form.pl_resistance}
                    onChange={(e) => set("pl_resistance", e.target.value)}
                    placeholder="Ampicillin, Kanamycin"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="pl-host" className={LABEL_CLASS}>
                    Bacterial host
                  </label>
                  <input
                    id="pl-host"
                    className={INPUT_CLASS}
                    value={form.pl_bacterial_host}
                    onChange={(e) => set("pl_bacterial_host", e.target.value)}
                    placeholder="DH5-alpha"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pl-size" className={LABEL_CLASS}>
                    Size (bp)
                  </label>
                  <input
                    id="pl-size"
                    type="number"
                    min={0}
                    step={1}
                    className={INPUT_CLASS}
                    value={form.pl_size_bp}
                    onChange={(e) => set("pl_size_bp", e.target.value)}
                    placeholder="2686"
                  />
                </div>
                <div>
                  <label htmlFor="pl-addgene" className={LABEL_CLASS}>
                    Addgene #
                  </label>
                  <input
                    id="pl-addgene"
                    className={INPUT_CLASS}
                    value={form.pl_addgene_id}
                    onChange={(e) => set("pl_addgene_id", e.target.value)}
                    placeholder="e.g. 12345"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="pl-source" className={LABEL_CLASS}>
                  Source
                </label>
                <input
                  id="pl-source"
                  className={INPUT_CLASS}
                  value={form.pl_source}
                  onChange={(e) => set("pl_source", e.target.value)}
                  placeholder="Addgene #, collaborator, in-house"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="pl-seqfile" className={LABEL_CLASS}>
                  Sequence file
                </label>
                <input
                  id="pl-seqfile"
                  className={INPUT_CLASS}
                  value={form.pl_sequence_file_path}
                  onChange={(e) =>
                    set("pl_sequence_file_path", e.target.value)
                  }
                  placeholder="Path to a .gb / .fasta / .dna in your data folder"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="pl-mapnotes" className={LABEL_CLASS}>
                  Map notes
                </label>
                <textarea
                  id="pl-mapnotes"
                  className={`${INPUT_CLASS} min-h-[60px] resize-y`}
                  value={form.pl_map_notes}
                  onChange={(e) => set("pl_map_notes", e.target.value)}
                  placeholder="Free-text feature list as a stopgap."
                />
              </div>
              <p className="text-meta text-foreground-muted">
                Appear only for the Plasmid category. The sequence file is a path
                for now; an interactive feature map is the sequence editor's
                territory.
              </p>
            </div>
          </div>
        )}

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

        {/* Safety and storage (audit fix, additive-fields). Manual entry for
            chemical safety + EHS inventory reporting, no auto-lookup. All
            optional. The SDS field shows an Open link once a URL is set. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="inv-storage-class" className={LABEL_CLASS}>
              Storage class
            </label>
            <input
              id="inv-storage-class"
              className={INPUT_CLASS}
              value={form.storage_class}
              onChange={(e) => set("storage_class", e.target.value)}
              placeholder="Flammable, Corrosive, Oxidizer"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="inv-sds" className={LABEL_CLASS}>
              Safety data sheet (SDS)
            </label>
            <input
              id="inv-sds"
              className={INPUT_CLASS}
              value={form.sds_url}
              onChange={(e) => set("sds_url", e.target.value)}
              placeholder="https://"
              autoComplete="off"
            />
            {form.sds_url.trim().length > 0 && (
              <a
                href={form.sds_url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-meta text-brand-action hover:underline"
              >
                Open SDS
              </a>
            )}
          </div>
        </div>

        {/* Hazard note */}
        <div>
          <label htmlFor="inv-hazard" className={LABEL_CLASS}>
            Hazard note
          </label>
          <input
            id="inv-hazard"
            className={INPUT_CLASS}
            value={form.hazard_note}
            onChange={(e) => set("hazard_note", e.target.value)}
            placeholder="Store below 4C, keep away from acids"
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
              min={1}
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
          className="ros-btn-neutral px-4 py-2 text-body text-foreground"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 inline-flex items-center gap-1.5 px-4 py-2 text-body rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon name="check" className="h-4 w-4" />
          {isEdit ? "Save item" : "Add item"}
        </button>
      </div>
    </div>
  );
}
