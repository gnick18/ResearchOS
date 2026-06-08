/**
 * purchase-doc.ts
 *
 * Loro model for a single purchase item (docs/proposals/PURCHASE_LORO.md
 * chunk 1). A purchase item is a FLAT STRUCTURED record (~20 scalar fields plus
 * the approval state machine), NOT freeform text, so unlike task-doc (a single
 * LoroText) the model is a FIELD MAP.
 *
 * Containers:
 *   - "meta" LoroMap: the "collab_doc_id" key (the SAME key notes and tasks
 *     use), so getCollabDocId + buildCollabBaseDoc adopt the DO canonical
 *     entity-agnostically. The seed never writes collab_doc_id; it is minted on
 *     the shared context in a later chunk.
 *   - "fields" LoroMap: one key per PurchaseItem scalar field. A LoroMap is
 *     last-write-wins per key, which is the right semantic for a structured
 *     record: two people editing DIFFERENT fields merge cleanly, the SAME field
 *     is last-write-wins.
 *
 * Value encoding: strings / numbers / booleans / null are stored directly.
 * `flagged` is a small object (PiFlag | null); we store it as a JSON-serialized
 * string under the "flagged" key (FLAGGED_KEY). A serialized string round-trips
 * cleanly through a LoroMap value and keeps the field-map flat and LWW per key
 * (no nested-container determinism to reason about). null serializes to the
 * string "null".
 *
 * Identity fields (`id`, `task_id`) ARE stored in the fields map so the
 * projection reconstructs a complete PurchaseItem, but they are SEED values and
 * are treated as immutable: setPurchaseField rejects them so a field edit can
 * never re-key the record.
 *
 * Determinism (the fork-fix invariant, mirroring seedTaskDoc / seedNoteDoc): the
 * seed uses the fixed seedActorId and writes the fields in a fixed declared key
 * order in a single commit, so two devices that independently seed the same
 * PurchaseItem JSON produce byte-equal Loro output and converge rather than fork
 * when they connect to the relay.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { LoroDoc, LoroMap } from "loro-crdt";
import type { PurchaseItem, PiFlag, PurchaseOrderStatus } from "@/lib/types";
import { seedActorId } from "./seed";

/** Root container names. "fields" holds the scalars; "meta" holds collab_doc_id. */
const FIELDS_KEY = "fields";
const META_KEY = "meta";

/** The fields-map key under which the serialized PiFlag lives. */
const FLAGGED_KEY = "flagged";

/**
 * The scalar PurchaseItem keys stored directly in the fields map, in a fixed
 * declared order. `flagged` is handled separately (serialized). Order is locked
 * because Loro encodes ops in insertion order and the same insertion sequence
 * must play out on both devices for byte-equal seeds.
 */
const SCALAR_FIELD_KEYS = [
  "id",
  "task_id",
  "item_name",
  "quantity",
  "link",
  "cas",
  "price_per_unit",
  "shipping_fees",
  "total_price",
  "notes",
  "funding_string",
  "vendor",
  "category",
  "assigned_to",
  "order_status",
  "approved",
  "approved_by",
  "approved_at",
  "declined_at",
  "declined_by",
  "last_edited_by",
  "last_edited_at",
  // New keys (funding_account_id FK + catalog number) appended at the END of
  // the locked key order so existing seeds keep their byte layout; new keys
  // only add to the tail. Order between these two is irrelevant; both seed null
  // when the record omits them.
  "funding_account_id",
  "catalog_number",
] as const;

type ScalarFieldKey = (typeof SCALAR_FIELD_KEYS)[number];

/** Identity fields that are seed values and must never be re-keyed by an edit. */
const IMMUTABLE_FIELD_KEYS: ReadonlySet<string> = new Set(["id", "task_id"]);

/** Editable scalar field keys (everything except identity and flagged). */
export const PURCHASE_FIELD_KEYS = SCALAR_FIELD_KEYS.filter(
  (k) => !IMMUTABLE_FIELD_KEYS.has(k),
) as ScalarFieldKey[];

/** The container key the read/write wiring binds to. Locked for parity tests. */
export const PURCHASE_FIELDS_CONTAINER = FIELDS_KEY;
export const PURCHASE_META_CONTAINER = META_KEY;

/** A field value as stored in the LoroMap. */
type FieldValue = string | number | boolean | null;

/**
 * Read a scalar value off a PurchaseItem by key, normalizing undefined to a
 * deterministic default so two devices seed identical bytes regardless of which
 * optional fields a given JSON record happens to omit.
 */
function scalarFor(item: PurchaseItem, key: ScalarFieldKey): FieldValue {
  switch (key) {
    case "id":
      return item.id;
    case "task_id":
      return item.task_id;
    case "item_name":
      return item.item_name ?? "";
    case "quantity":
      return item.quantity ?? 0;
    case "link":
      return item.link ?? null;
    case "cas":
      return item.cas ?? null;
    case "price_per_unit":
      return item.price_per_unit ?? 0;
    case "shipping_fees":
      return item.shipping_fees ?? 0;
    case "total_price":
      return item.total_price ?? 0;
    case "notes":
      return item.notes ?? null;
    case "funding_account_id":
      return item.funding_account_id ?? null;
    case "funding_string":
      return item.funding_string ?? null;
    case "vendor":
      return item.vendor ?? null;
    case "category":
      return item.category ?? null;
    case "assigned_to":
      return item.assigned_to ?? null;
    case "order_status":
      return item.order_status ?? null;
    case "approved":
      return item.approved ?? false;
    case "approved_by":
      return item.approved_by ?? null;
    case "approved_at":
      return item.approved_at ?? null;
    case "declined_at":
      return item.declined_at ?? null;
    case "declined_by":
      return item.declined_by ?? null;
    case "last_edited_by":
      return item.last_edited_by ?? null;
    case "last_edited_at":
      return item.last_edited_at ?? null;
    case "catalog_number":
      return item.catalog_number ?? null;
  }
}

/**
 * Build a fresh Loro doc snapshot for a purchase item from its JSON record.
 *
 * Deterministic: fixed seed actor, fixed key order, single commit. Two devices
 * seeding the same PurchaseItem produce byte-equal output and converge.
 */
export function seedPurchaseDoc(item: PurchaseItem): Uint8Array {
  const doc = new LoroDoc();
  doc.setPeerId(seedActorId);

  // meta is created empty (collab_doc_id is minted later on the shared context).
  // Touching the container keeps it present in the snapshot for parity with the
  // task / note seeds, which always materialize their meta map.
  doc.getMap(META_KEY);

  const fields = doc.getMap(FIELDS_KEY);
  for (const key of SCALAR_FIELD_KEYS) {
    fields.set(key, scalarFor(item, key));
  }
  // `flagged` (a small object) is stored as a JSON-serialized string. null
  // serializes to "null" and round-trips back to null.
  fields.set(FLAGGED_KEY, JSON.stringify(item.flagged ?? null));

  doc.commit();
  return doc.export({ mode: "snapshot" });
}

/** The live "fields" LoroMap (the scalar field map). */
export function getPurchaseFieldsMap(doc: LoroDoc): LoroMap {
  return doc.getMap(FIELDS_KEY);
}

/** The purchase meta map (holds collab_doc_id). */
export function getPurchaseMeta(doc: LoroDoc): LoroMap {
  return doc.getMap(META_KEY);
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNumber(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
/** Like asNumber but preserves null (used for nullable FK columns). */
function asNullableNumber(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/** Parse the serialized flagged value back into a PiFlag (or null). */
function parseFlagged(raw: unknown): PiFlag | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null ? null : (parsed as PiFlag);
  } catch {
    return null;
  }
}

/**
 * Project the fields map back into a plain PurchaseItem-shaped object. The
 * inverse of seedPurchaseDoc: seeding from an item then projecting yields an
 * equivalent PurchaseItem (optional-undefined fields normalize to their seeded
 * defaults, e.g. null / 0 / false).
 */
export function getPurchaseFields(doc: LoroDoc): PurchaseItem {
  const fields = getPurchaseFieldsMap(doc);
  const get = (k: ScalarFieldKey) => fields.get(k);

  return {
    id: asNumber(get("id")),
    task_id: asNumber(get("task_id")),
    item_name: asString(get("item_name")) ?? "",
    quantity: asNumber(get("quantity")),
    link: asString(get("link")),
    cas: asString(get("cas")),
    price_per_unit: asNumber(get("price_per_unit")),
    shipping_fees: asNumber(get("shipping_fees")),
    total_price: asNumber(get("total_price")),
    notes: asString(get("notes")),
    funding_account_id: asNullableNumber(get("funding_account_id")),
    funding_string: asString(get("funding_string")),
    vendor: asString(get("vendor")),
    catalog_number: asString(get("catalog_number")),
    category: asString(get("category")),
    assigned_to: asString(get("assigned_to")),
    order_status:
      (asString(get("order_status")) as PurchaseOrderStatus | null) ?? undefined,
    approved: typeof get("approved") === "boolean" ? (get("approved") as boolean) : false,
    approved_by: asString(get("approved_by")),
    approved_at: asString(get("approved_at")),
    flagged: parseFlagged(fields.get(FLAGGED_KEY)),
    declined_at: asString(get("declined_at")),
    declined_by: asString(get("declined_by")),
    last_edited_by: asString(get("last_edited_by")) ?? undefined,
    last_edited_at: asString(get("last_edited_at")) ?? undefined,
  };
}

/**
 * Write a single scalar field into the fields map. Rejects the immutable
 * identity keys (id / task_id) so an edit can never re-key the record. Does NOT
 * commit; callers commit (debounced) via the handle.
 */
export function setPurchaseField(
  doc: LoroDoc,
  key: string,
  value: FieldValue,
): void {
  if (IMMUTABLE_FIELD_KEYS.has(key)) {
    throw new Error(`[loro] purchase field "${key}" is immutable and cannot be edited`);
  }
  getPurchaseFieldsMap(doc).set(key, value);
}

/** Write the flagged object (serialized) into the fields map. Does NOT commit. */
export function setPurchaseFlagged(doc: LoroDoc, flagged: PiFlag | null): void {
  getPurchaseFieldsMap(doc).set(FLAGGED_KEY, JSON.stringify(flagged ?? null));
}

/**
 * Apply a partial PurchaseItem update into the fields map, ignoring the
 * immutable identity keys. The `flagged` object is serialized; every other
 * present key is written as-is. Undefined values are skipped (no write). Does
 * NOT commit.
 */
export function applyPurchaseUpdate(
  doc: LoroDoc,
  update: Partial<PurchaseItem>,
): void {
  const fields = getPurchaseFieldsMap(doc);
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue;
    if (IMMUTABLE_FIELD_KEYS.has(key)) continue;
    if (key === FLAGGED_KEY) {
      fields.set(FLAGGED_KEY, JSON.stringify((value as PiFlag | null) ?? null));
      continue;
    }
    fields.set(key, value as FieldValue);
  }
}
