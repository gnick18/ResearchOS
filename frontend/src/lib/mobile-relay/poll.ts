// Mobile capture relay, the single-poll engine (piece D, shared core).
//
// This is the one place that pulls pending captures off the relay and lands
// them in the connected data folder. It is called from TWO entry points, the
// CaptureInboxPoller headless component (interval + window focus) and the
// "Check for new captures" button in Settings > Devices. Keeping the loop here
// (not inside the component) means both paths share identical behavior and the
// upcoming on-device batch test is diagnosable from the browser console.
//
// Routing by content type:
//   image/*       writes into users/<user>/inbox/Images via attachImageToTask
//                 plus a source:"relay" sidecar, then acks.
//   text/*        creates a real Note (notesApi.create) so it shows up in the
//                 Notes UI, then acks. Title comes from the caption, the body
//                 is the markdown text.
//   application/x-researchos-reorder
//                 a barcode reorder request from a paired phone. The body is a
//                 JSON description of the item; it lands as a real purchase
//                 line item ("needs_ordering") in the per-user reorder queue
//                 (see reorder-queue.ts) so it shows up on the Purchases tab,
//                 then acks.
//   application/x-researchos-mark-arrived   (W3, scan-manager web sub-bot, 2026-06-08)
//                 marks a purchase item as "received" and creates/links an
//                 InventoryStock. Payload: { purchaseItemId: number }.
//   application/x-researchos-register-tracker  (W3)
//                 registers a stock for units-per-scan tracking. Payload:
//                 { stockId?: number, purchaseItemId?: number, productBarcode: string,
//                   unitsPerScan: number, totalUnits: number, unitLabel?: string }.
//   application/x-researchos-deduct  (W3)
//                 deducts `amount` from units_remaining on a stock. Payload:
//                 { stockId?: number, productBarcode?: string, amount: number }.
//   application/x-researchos-create-purchase  (W3 round 2, scan-manager web sub-bot, 2026-06-08)
//                 creates a STANDALONE (task-less) purchase in "received" status
//                 for a package that just arrived and was not previously ordered
//                 through the app. Payload:
//                 { name, vendor?, catalog?, productBarcode?,
//                   quantity?, unitsPerScan?, totalUnits?, unitLabel? }.
//                 Reuses the addReorderQueueItem sentinel-task mechanism (no
//                 task_id optionality needed on PurchaseItem). Also creates an
//                 InventoryItem + InventoryStock linked to the purchase. If
//                 unitsPerScan + totalUnits are present, registers the tracker
//                 in the same action.
//   application/x-researchos-create-inventory  (W3 round 2)
//                 creates an InventoryItem + InventoryStock with no purchase
//                 record. Payload: { name, vendor?, catalog?, productBarcode?,
//                   unitsPerScan?, totalUnits?, unitLabel? }.
//                 If unitsPerScan + totalUnits are present, registers the
//                 tracker in the same action.
//   anything else logged and SKIPPED (not acked, so nothing is lost, the relay
//                 keeps it and a future build can handle it).
//
// Robustness: each capture is handled inside its own try/catch so one bad item
// never wedges the loop, and a capture is only acked AFTER it has landed on
// disk. An un-acked capture simply reappears on the next poll. To stop that
// retry from creating DUPLICATES (a reorder purchase / note has no dedup the
// way images get a "-1" copy), every landed captureId is recorded in a
// `.seen_captures` ledger BEFORE the ack (see seen-captures.ts); a later poll
// that sees a known captureId re-acks it and skips the write.
//
// Observability: every step logs a `[capture-poller]` line so the console tells
// the whole story (poll start, pending count, per-item import, write path, ack,
// and errors with status / message).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import { appQueryClient } from "@/lib/query-client";
import { notesApi, inventoryItemsApi, inventoryStocksApi, purchasesApi } from "@/lib/local-api";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { writeAnnotations, type AnnotationDoc } from "@/lib/attachments/annotations";
import { imageEvents } from "@/lib/attachments/image-events";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import {
  ackCaptures,
  fetchInbox,
  fetchObject,
  type PendingCapture,
  type UserCaptureKeys,
} from "@/lib/mobile-relay/client";
import { addReorderQueueItem } from "@/lib/purchases/reorder-queue";
import {
  loadSeenCaptures,
  markCaptureSeen,
} from "@/lib/mobile-relay/seen-captures";
import {
  deductUnitsFromScan,
  registerTrackedBarcode,
} from "@/components/inventory/barcode-consume";

const LOG_PREFIX = "[capture-poller]";

/** Coarse category a capture is routed by, derived from its content type. */
export type CaptureKind =
  | "image"
  | "text"
  | "reorder"
  | "mark-arrived"
  | "register-tracker"
  | "deduct"
  | "create-purchase"
  | "create-inventory"
  | "other";

/** The barcode-reorder content type the phone sends a reorder request as. */
const REORDER_CONTENT_TYPE = "application/x-researchos-reorder";

// W3 action content types (scan-manager web sub-bot, 2026-06-08).
const MARK_ARRIVED_CONTENT_TYPE = "application/x-researchos-mark-arrived";
const REGISTER_TRACKER_CONTENT_TYPE = "application/x-researchos-register-tracker";
const DEDUCT_CONTENT_TYPE = "application/x-researchos-deduct";

// W3 round-2 create action content types (scan-manager web sub-bot, 2026-06-08).
const CREATE_PURCHASE_CONTENT_TYPE = "application/x-researchos-create-purchase";
const CREATE_INVENTORY_CONTENT_TYPE = "application/x-researchos-create-inventory";

/** Decoded reorder request payload. Every field is optional (the phone may
 *  only know a scanned barcode and nothing else), so consumers must tolerate
 *  a partial object. */
interface ReorderPayload {
  product_barcode?: string;
  itemId?: number | string;
  name?: string;
  catalog_number?: string;
  vendor?: string;
  note?: string;
}

// W3 action payloads (scan-manager web sub-bot, 2026-06-08).
// All fields are typed loosely (number | string) where the phone may send JSON
// integers or stringified values, and treated defensively below.

/** mark-arrived: a purchase package just arrived; mark it received + link stock. */
interface MarkArrivedPayload {
  purchaseItemId?: number | string;
}

/** register-tracker: the user just set up scan tracking for a barcode. */
interface RegisterTrackerPayload {
  stockId?: number | string;
  purchaseItemId?: number | string;
  productBarcode?: string;
  unitsPerScan?: number | string;
  totalUnits?: number | string;
  unitLabel?: string;
}

/** deduct: the user scanned a tracked barcode; deduct `amount` units. */
interface DeductPayload {
  stockId?: number | string;
  productBarcode?: string;
  amount?: number | string;
}

// W3 round-2 create payloads (scan-manager web sub-bot, 2026-06-08).
// Tracking fields are bundled here because the phone has no new record id to
// chain a separate register-tracker call after the create resolves.

/**
 * create-purchase: a package arrived that was not previously ordered in the
 * app. Creates a standalone "received" purchase via the sentinel-task queue
 * plus a linked InventoryStock (and optional tracker registration).
 */
interface CreatePurchasePayload {
  name?: string;
  vendor?: string;
  catalog?: string;
  productBarcode?: string;
  quantity?: number | string;
  unitsPerScan?: number | string;
  totalUnits?: number | string;
  unitLabel?: string;
}

/**
 * create-inventory: a plain stock add with no purchase record. Creates an
 * InventoryItem + InventoryStock (and optional tracker registration).
 */
interface CreateInventoryPayload {
  name?: string;
  vendor?: string;
  catalog?: string;
  productBarcode?: string;
  unitsPerScan?: number | string;
  totalUnits?: number | string;
  unitLabel?: string;
}

/**
 * Classify a capture content type into the branch that handles it. Pure +
 * exported so the routing can be unit tested without any relay / file mocking.
 * Matching is case-insensitive and tolerant of charset suffixes
 * (e.g. "text/markdown; charset=utf-8").
 */
export function classifyCapture(contentType: string | null | undefined): CaptureKind {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("image/")) return "image";
  // Check the more-specific application/* types before the generic reorder prefix.
  if (ct.startsWith(MARK_ARRIVED_CONTENT_TYPE)) return "mark-arrived";
  if (ct.startsWith(REGISTER_TRACKER_CONTENT_TYPE)) return "register-tracker";
  if (ct.startsWith(DEDUCT_CONTENT_TYPE)) return "deduct";
  if (ct.startsWith(CREATE_PURCHASE_CONTENT_TYPE)) return "create-purchase";
  if (ct.startsWith(CREATE_INVENTORY_CONTENT_TYPE)) return "create-inventory";
  if (ct.startsWith(REORDER_CONTENT_TYPE)) return "reorder";
  if (ct.startsWith("text/")) return "text";
  return "other";
}

/** Best-effort label for a reorder request, for the note title. */
function reorderLabel(payload: ReorderPayload): string {
  return (
    payload.name?.trim() ||
    payload.catalog_number?.trim() ||
    payload.product_barcode?.trim() ||
    "item"
  );
}

/** Maps a capture content-type to a sensible image extension. */
function extForContentType(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("heic")) return "heic";
  if (ct.includes("heif")) return "heif";
  if (ct.includes("avif")) return "avif";
  return "jpg";
}

function suggestedImageFilename(capture: PendingCapture): string {
  const ext = extForContentType(capture.contentType);
  // createdAt is ISO; keep it filename-safe and human-scannable.
  const stamp = (capture.createdAt || new Date().toISOString())
    .replace(/[:.]/g, "-")
    .replace(/[^0-9a-zA-Z-]/g, "");
  return `capture-${stamp}.${ext}`;
}

/**
 * Build a human note title from the capture caption, falling back to a dated
 * "Quick note" when the phone sent no caption. Trimmed and length-capped so a
 * runaway caption cannot produce a pathological title.
 */
function noteTitleFor(capture: PendingCapture): string {
  const caption = (capture.caption ?? "").trim();
  if (caption) return caption.slice(0, 120);
  const stamp = (capture.createdAt || new Date().toISOString()).slice(0, 10);
  return `Quick note ${stamp}`;
}

// ── W3 action handlers ────────────────────────────────────────────────────────
// Each is a standalone async function so the main poll loop stays readable.
// All are defensive: unknown / missing ids log + skip rather than throwing.

/** Safe integer coercion for id fields the phone may send as string or number. */
function toNumber(value: number | string | undefined | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * mark-arrived: set a purchase item to "received" and create a linked
 * InventoryStock. A new InventoryItem is auto-created from the purchase item's
 * fields (mirrors the web ReceiveToInventoryDialog "Create new item" step).
 * Best-effort: if the purchase item is not found, logs + returns.
 */
async function applyMarkArrived(
  payload: MarkArrivedPayload,
  logPrefix: string,
): Promise<void> {
  const purchaseItemId = toNumber(payload.purchaseItemId);
  if (purchaseItemId == null) {
    console.warn(`${logPrefix} mark-arrived: missing or invalid purchaseItemId, skipping`);
    return;
  }
  const allPurchases = await purchasesApi.listAll();
  const purchase = allPurchases.find((p) => p.id === purchaseItemId) ?? null;
  if (!purchase) {
    console.warn(`${logPrefix} mark-arrived: purchase item ${purchaseItemId} not found, skipping`);
    return;
  }

  // Create a new InventoryItem from the purchase details (additive, no prior state needed).
  const item = await inventoryItemsApi.create({
    name: purchase.item_name,
    category: "reagent",
    vendor: purchase.vendor ?? undefined,
    cas: purchase.cas ?? undefined,
    url: purchase.link ?? undefined,
  });

  // Create a stock linked back to the purchase item.
  const today = new Date().toISOString();
  await inventoryStocksApi.create({
    item_id: item.id,
    purchase_item_id: purchase.id,
    received_date: today,
    container_count:
      typeof purchase.quantity === "number" && purchase.quantity >= 1
        ? Math.floor(purchase.quantity)
        : 1,
    status: "in_stock",
  });

  // Mark the purchase item as received.
  await purchasesApi.setOrderStatus(purchaseItemId, "received");
  console.info(
    `${logPrefix} mark-arrived: purchase ${purchaseItemId} received, stock created under item ${item.id}`,
  );
}

/**
 * register-tracker: set up units-per-scan tracking on a stock. The stock can be
 * identified by stockId (direct) or purchaseItemId (look up the stock via the
 * purchase link). The product barcode is written to the parent item.
 * Best-effort: missing or unresolvable ids log + return.
 */
async function applyRegisterTracker(
  payload: RegisterTrackerPayload,
  logPrefix: string,
): Promise<void> {
  const unitsPerScan = toNumber(payload.unitsPerScan);
  const totalUnits = toNumber(payload.totalUnits);

  if (!payload.productBarcode) {
    console.warn(`${logPrefix} register-tracker: missing productBarcode, skipping`);
    return;
  }
  if (!unitsPerScan || unitsPerScan <= 0) {
    console.warn(`${logPrefix} register-tracker: invalid unitsPerScan (${payload.unitsPerScan}), skipping`);
    return;
  }
  if (totalUnits == null || totalUnits < 0) {
    console.warn(`${logPrefix} register-tracker: invalid totalUnits (${payload.totalUnits}), skipping`);
    return;
  }

  let stock = null;
  let item = null;

  const stockId = toNumber(payload.stockId);
  if (stockId != null) {
    stock = await inventoryStocksApi.get(stockId);
    if (stock) item = await inventoryItemsApi.get(stock.item_id);
  }

  // Fall back to purchaseItemId lookup if stockId was not given or not found.
  if (!stock) {
    const purchaseItemId = toNumber(payload.purchaseItemId);
    if (purchaseItemId != null) {
      const allStocks = await inventoryStocksApi.list();
      stock = allStocks.find((s) => s.purchase_item_id === purchaseItemId) ?? null;
      if (stock) item = await inventoryItemsApi.get(stock.item_id);
    }
  }

  if (!stock || !item) {
    console.warn(
      `${logPrefix} register-tracker: could not resolve stock (stockId=${payload.stockId}, purchaseItemId=${payload.purchaseItemId}), skipping`,
    );
    return;
  }

  await registerTrackedBarcode(stock, item, {
    totalUnits,
    unitsPerScan,
    productBarcode: payload.productBarcode,
  });

  // Write scan_unit_label when provided.
  if (payload.unitLabel) {
    await inventoryStocksApi.update(stock.id, { scan_unit_label: payload.unitLabel });
  }

  console.info(
    `${logPrefix} register-tracker: stock ${stock.id} registered (ups=${unitsPerScan}, total=${totalUnits}, barcode=${payload.productBarcode})`,
  );
}

/**
 * deduct: subtract `amount` units from a tracked stock's units_remaining.
 * The stock can be identified by stockId or by productBarcode (resolved via
 * the item list). When multiple stocks share the same product barcode, the
 * first in-stock one is used.
 * Best-effort: missing ids / unresolvable barcodes log + return.
 */
async function applyDeduct(
  payload: DeductPayload,
  logPrefix: string,
): Promise<void> {
  const amount = toNumber(payload.amount);
  if (!amount || amount <= 0) {
    console.warn(`${logPrefix} deduct: invalid amount (${payload.amount}), skipping`);
    return;
  }

  let stock = null;

  const stockId = toNumber(payload.stockId);
  if (stockId != null) {
    stock = await inventoryStocksApi.get(stockId);
  }

  // Fall back to productBarcode lookup.
  if (!stock && payload.productBarcode) {
    const [items, stocks] = await Promise.all([
      inventoryItemsApi.list(),
      inventoryStocksApi.list(),
    ]);
    const barcode = payload.productBarcode.trim().toLowerCase();
    const matchItem = items.find(
      (it) => (it.product_barcode ?? "").trim().toLowerCase() === barcode,
    );
    if (matchItem) {
      // Prefer a stock with units_remaining > 0; fall back to the first match.
      const itemStocks = stocks.filter((s) => s.item_id === matchItem.id);
      stock =
        itemStocks.find(
          (s) =>
            typeof s.units_per_scan === "number" &&
            typeof s.units_remaining === "number" &&
            s.units_remaining > 0,
        ) ?? itemStocks[0] ?? null;
    }
  }

  if (!stock) {
    console.warn(
      `${logPrefix} deduct: could not resolve stock (stockId=${payload.stockId}, barcode=${payload.productBarcode}), skipping`,
    );
    return;
  }

  const unitsPerScan = stock.units_per_scan ?? 1;
  const currentRemaining = stock.units_remaining ?? 0;
  const newRemaining = deductUnitsFromScan(currentRemaining, unitsPerScan, amount);

  await inventoryStocksApi.update(stock.id, { units_remaining: newRemaining });
  console.info(
    `${logPrefix} deduct: stock ${stock.id} ${currentRemaining} -> ${newRemaining} (amount=${amount} x ups=${unitsPerScan})`,
  );
}


/**
 * create-purchase (W3 round 2, scan-manager web sub-bot, 2026-06-08):
 * create a STANDALONE "received" purchase (no prior ordering step) plus a
 * linked InventoryItem and InventoryStock. Optionally register the tracker.
 *
 * Reuses the addReorderQueueItem sentinel-task mechanism with
 * order_status="received" so the purchase lands on the Purchases tab under
 * the _reorder_queue sentinel alongside other mobile-sourced items, with no
 * change to the PurchaseItem data shape (task_id remains required; the
 * sentinel task is the container).
 *
 * Best-effort: missing name logs + returns (no name = nothing to create).
 */
async function applyCreatePurchase(
  payload: CreatePurchasePayload,
  currentUser: string,
  logPrefix: string,
): Promise<void> {
  const name = (payload.name ?? "").trim();
  if (!name) {
    console.warn(`${logPrefix} create-purchase: missing name, skipping`);
    return;
  }

  // Land the purchase into the reorder-queue sentinel task with "received"
  // status. This is the minimal-change reuse of the existing task-less path
  // (the sentinel provides the required task_id without touching the schema).
  const { item: purchaseItem, taskId } = await addReorderQueueItem(
    currentUser,
    {
      item_name: name,
      vendor: payload.vendor ?? null,
      catalog_number: payload.catalog ?? null,
      product_barcode: payload.productBarcode ?? null,
    },
    "received",
  );
  console.info(
    `${logPrefix} create-purchase: purchase item ${purchaseItem.id} created (received) under sentinel task ${taskId}`,
  );

  // Create an InventoryItem from the incoming fields.
  const invItem = await inventoryItemsApi.create({
    name,
    category: "reagent",
    vendor: payload.vendor ?? undefined,
    catalog_number: payload.catalog ?? undefined,
    product_barcode: payload.productBarcode ?? undefined,
  });

  // Create a stock linked to the purchase item.
  const quantity = toNumber(payload.quantity);
  const today = new Date().toISOString();
  const stock = await inventoryStocksApi.create({
    item_id: invItem.id,
    purchase_item_id: purchaseItem.id,
    received_date: today,
    container_count: quantity != null && quantity >= 1 ? Math.floor(quantity) : 1,
    status: "in_stock",
  });
  console.info(
    `${logPrefix} create-purchase: inventory item ${invItem.id} + stock ${stock.id} created`,
  );

  // Register the tracker when tracking fields are present.
  await maybeRegisterTrackerOnStock(
    stock.id,
    invItem.id,
    payload.unitsPerScan,
    payload.totalUnits,
    payload.productBarcode,
    payload.unitLabel,
    logPrefix,
  );
}

/**
 * create-inventory (W3 round 2, scan-manager web sub-bot, 2026-06-08):
 * create an InventoryItem + InventoryStock with no purchase record. Optionally
 * register the tracker.
 *
 * Best-effort: missing name logs + returns.
 */
async function applyCreateInventory(
  payload: CreateInventoryPayload,
  logPrefix: string,
): Promise<void> {
  const name = (payload.name ?? "").trim();
  if (!name) {
    console.warn(`${logPrefix} create-inventory: missing name, skipping`);
    return;
  }

  const invItem = await inventoryItemsApi.create({
    name,
    category: "reagent",
    vendor: payload.vendor ?? undefined,
    catalog_number: payload.catalog ?? undefined,
    product_barcode: payload.productBarcode ?? undefined,
  });

  const today = new Date().toISOString();
  const stock = await inventoryStocksApi.create({
    item_id: invItem.id,
    received_date: today,
    container_count: 1,
    status: "in_stock",
  });
  console.info(
    `${logPrefix} create-inventory: item ${invItem.id} + stock ${stock.id} created`,
  );

  // Register the tracker when tracking fields are present.
  await maybeRegisterTrackerOnStock(
    stock.id,
    invItem.id,
    payload.unitsPerScan,
    payload.totalUnits,
    payload.productBarcode,
    payload.unitLabel,
    logPrefix,
  );
}

/**
 * Register a stock for tracked scanning when tracking fields are present.
 * Shared by both create-purchase and create-inventory. No-op when
 * unitsPerScan or totalUnits is absent/invalid.
 */
async function maybeRegisterTrackerOnStock(
  stockId: number,
  itemId: number,
  unitsPerScanRaw: number | string | undefined,
  totalUnitsRaw: number | string | undefined,
  productBarcode: string | undefined,
  unitLabel: string | undefined,
  logPrefix: string,
): Promise<void> {
  const unitsPerScan = toNumber(unitsPerScanRaw);
  const totalUnits = toNumber(totalUnitsRaw);
  if (!unitsPerScan || unitsPerScan <= 0 || totalUnits == null || totalUnits < 0) {
    // Tracking fields absent or invalid; no tracker to register.
    return;
  }
  const stock = await inventoryStocksApi.get(stockId);
  const item = await inventoryItemsApi.get(itemId);
  if (!stock || !item) {
    console.warn(
      `${logPrefix} maybeRegisterTrackerOnStock: could not reload stock ${stockId} or item ${itemId}, skipping tracker`,
    );
    return;
  }
  await registerTrackedBarcode(stock, item, {
    totalUnits,
    unitsPerScan,
    productBarcode: productBarcode ?? null,
  });
  if (unitLabel) {
    await inventoryStocksApi.update(stockId, { scan_unit_label: unitLabel });
  }
  console.info(
    `${logPrefix} tracker registered on stock ${stockId} (ups=${unitsPerScan}, total=${totalUnits})`,
  );
}

/** Write/merge a capture sidecar (same shape Telegram routing uses). */
async function writeCaptureSidecar(
  basePath: string,
  filename: string,
  updates: Partial<ImageSidecar>,
): Promise<void> {
  const path = sidecarPath(basePath, filename);
  const existing = (await fileService.readJson<ImageSidecar>(path)) ?? {};
  const merged: ImageSidecar = { ...existing, ...updates };
  await fileService.writeJson(path, merged);
  imageEvents.emitMetadataChanged({ basePath, filename });
}

export interface PollResult {
  /** How many captures were successfully landed AND acked this run. */
  pulled: number;
  /** How many captures hit an error (left un-acked, will retry next poll). */
  errors: number;
}

/**
 * Run exactly one poll cycle. Caller owns the unlocked identity (keys) and the
 * connected user. Returns a small summary so the manual trigger can report it.
 * Never throws on a per-item failure; a relay-level failure (the inbox listing
 * itself) is surfaced by re-throwing so the caller can show a connection error.
 */
export async function runCaptureInboxPoll(
  keys: UserCaptureKeys,
  currentUser: string,
): Promise<PollResult> {
  console.info(`${LOG_PREFIX} poll start for ${currentUser}`);

  let pending: PendingCapture[];
  try {
    pending = await fetchInbox(keys);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`${LOG_PREFIX} fetchInbox failed`, message);
    // Re-throw so the manual trigger can show "could not reach the relay". The
    // interval/focus caller swallows this (transient, retry next tick).
    throw err;
  }

  console.info(`${LOG_PREFIX} ${pending.length} pending`);

  const basePath = `users/${currentUser}/inbox`;
  let pulled = 0;
  let errors = 0;

  // Captures we have already landed (across previous polls). Loaded once per
  // poll; markCaptureSeen mutates this set + the on-disk ledger as we go so the
  // idempotency check below is correct both across polls AND within one poll.
  const seen = await loadSeenCaptures(currentUser);

  for (const capture of pending) {
    const kind = classifyCapture(capture.contentType);
    console.info(
      `${LOG_PREFIX} importing ${capture.captureId} (${capture.contentType}) as ${kind}`,
    );

    if (kind === "other") {
      // Unknown type. Do NOT ack; nothing is lost and a future build can route
      // it. Logged so the console shows why it stuck around.
      console.warn(
        `${LOG_PREFIX} skipping ${capture.captureId}, unsupported content type ${capture.contentType}`,
      );
      continue;
    }

    // Idempotency guard. A capture only lands in `seen` AFTER its destination
    // write succeeded last time, so if it is here the previous ack must have
    // failed and the relay handed it back. Re-ack to clean it off the relay and
    // skip the write so we never create a duplicate purchase / note.
    if (seen.has(capture.captureId)) {
      console.info(
        `${LOG_PREFIX} skipping ${capture.captureId}, already processed (dedup), re-acking`,
      );
      try {
        await ackCaptures(keys, [capture.captureId]);
      } catch (ackErr) {
        const message = ackErr instanceof Error ? ackErr.message : String(ackErr);
        console.warn(`${LOG_PREFIX} re-ack failed for ${capture.captureId}`, message);
      }
      continue;
    }

    try {
      const { blob } = await fetchObject(keys, capture.captureId);
      const caption = capture.caption ?? undefined;

      if (kind === "image") {
        const result = await attachImageToTask({
          ownerUsername: currentUser,
          taskId: 0,
          basePath,
          blob,
          suggestedFilename: suggestedImageFilename(capture),
          altText: caption,
        });
        await writeCaptureSidecar(basePath, result.finalFilename, {
          source: "relay",
          caption,
          receivedAt: new Date().toISOString(),
        });
        console.info(
          `${LOG_PREFIX} wrote ${basePath}/Images/${result.finalFilename}`,
        );
        // Photo markup from the phone, written as the non-destructive
        // {imageName}.annot.json sidecar the web AnnotatedImage renderer reads,
        // so markup is editable across phone and laptop. Defensive: a malformed
        // annotation is skipped, never blocks the image import.
        if (capture.annotation) {
          try {
            const doc = JSON.parse(capture.annotation) as AnnotationDoc;
            if (doc && Array.isArray(doc.shapes)) {
              await writeAnnotations(basePath, result.finalFilename, doc);
              console.info(
                `${LOG_PREFIX} wrote ${basePath}/Images/${result.finalFilename}.annot.json`,
              );
            }
          } catch (err) {
            console.warn(
              `${LOG_PREFIX} skipped malformed annotation for ${result.finalFilename}`,
              err,
            );
          }
        }
      } else if (kind === "reorder") {
        // Barcode reorder request. The phone sends a JSON body describing the
        // item to reorder. We land it as a real purchase line item in the
        // per-user reorder queue (needs_ordering) so it shows up on the
        // Purchases tab and flows through the normal ordering pipeline.
        // Tolerant of partial payloads.
        let payload: ReorderPayload = {};
        try {
          payload = JSON.parse(await blob.text()) as ReorderPayload;
        } catch (parseErr) {
          console.warn(
            `${LOG_PREFIX} reorder ${capture.captureId} has unparseable body, landing a bare line item`,
            parseErr instanceof Error ? parseErr.message : String(parseErr),
          );
        }
        const { taskId, item } = await addReorderQueueItem(currentUser, {
          item_name: reorderLabel(payload),
          vendor: payload.vendor ?? null,
          catalog_number: payload.catalog_number ?? null,
          product_barcode: payload.product_barcode ?? null,
          inventory_item_id: payload.itemId ?? null,
          note: payload.note ?? null,
        });
        console.info(
          `${LOG_PREFIX} wrote reorder purchase item ${item.id} into queue task ${taskId}`,
        );

      } else if (kind === "mark-arrived") {
        // W3 (scan-manager web sub-bot, 2026-06-08): mark a purchase as received
        // and create/link an InventoryStock from its details.
        let arrivedPayload: MarkArrivedPayload = {};
        try {
          arrivedPayload = JSON.parse(await blob.text()) as MarkArrivedPayload;
        } catch (parseErr) {
          console.warn(
            `${LOG_PREFIX} mark-arrived ${capture.captureId} has unparseable body`,
            parseErr instanceof Error ? parseErr.message : String(parseErr),
          );
        }
        await applyMarkArrived(arrivedPayload, LOG_PREFIX);

      } else if (kind === "register-tracker") {
        // W3: register a stock for units-per-scan tracking.
        let trackerPayload: RegisterTrackerPayload = {};
        try {
          trackerPayload = JSON.parse(await blob.text()) as RegisterTrackerPayload;
        } catch (parseErr) {
          console.warn(
            `${LOG_PREFIX} register-tracker ${capture.captureId} has unparseable body`,
            parseErr instanceof Error ? parseErr.message : String(parseErr),
          );
        }
        await applyRegisterTracker(trackerPayload, LOG_PREFIX);

      } else if (kind === "deduct") {
        // W3: deduct `amount` scans from a tracked stock.
        let deductPayload: DeductPayload = {};
        try {
          deductPayload = JSON.parse(await blob.text()) as DeductPayload;
        } catch (parseErr) {
          console.warn(
            `${LOG_PREFIX} deduct ${capture.captureId} has unparseable body`,
            parseErr instanceof Error ? parseErr.message : String(parseErr),
          );
        }
        await applyDeduct(deductPayload, LOG_PREFIX);

      } else if (kind === "create-purchase") {
        // W3 round 2 (scan-manager web sub-bot, 2026-06-08): create a standalone
        // "received" purchase + linked InventoryItem + stock. Optionally registers
        // the tracker when tracking fields are present.
        let createPurchasePayload: CreatePurchasePayload = {};
        try {
          createPurchasePayload = JSON.parse(await blob.text()) as CreatePurchasePayload;
        } catch (parseErr) {
          console.warn(
            `${LOG_PREFIX} create-purchase ${capture.captureId} has unparseable body`,
            parseErr instanceof Error ? parseErr.message : String(parseErr),
          );
        }
        await applyCreatePurchase(createPurchasePayload, currentUser, LOG_PREFIX);

      } else if (kind === "create-inventory") {
        // W3 round 2: create an InventoryItem + stock with no purchase record.
        // Optionally registers the tracker when tracking fields are present.
        let createInventoryPayload: CreateInventoryPayload = {};
        try {
          createInventoryPayload = JSON.parse(await blob.text()) as CreateInventoryPayload;
        } catch (parseErr) {
          console.warn(
            `${LOG_PREFIX} create-inventory ${capture.captureId} has unparseable body`,
            parseErr instanceof Error ? parseErr.message : String(parseErr),
          );
        }
        await applyCreateInventory(createInventoryPayload, LOG_PREFIX);

      } else {
        // text/*. Land a real Note so it is visible in the Notes UI. The body is
        // the markdown the phone sent; the title is the caption (or a dated
        // fallback). created note routes to users/<currentUser>/notes/.
        const text = await blob.text();
        const note = await notesApi.create({
          title: noteTitleFor(capture),
          entries: [
            {
              title: noteTitleFor(capture),
              date: (capture.createdAt || new Date().toISOString()).slice(0, 10),
              content: text,
            },
          ],
        });
        console.info(
          `${LOG_PREFIX} wrote users/${currentUser}/notes/${note.id}.json`,
        );
      }

      // Record the capture as landed BEFORE acking. If the ack then fails the
      // capture reappears next poll, but the dedup guard above sees it in the
      // ledger and skips the re-create. Written first so the ledger is never
      // behind the destination write.
      await markCaptureSeen(currentUser, seen, capture.captureId);

      // Only ack after the capture is safely on disk and ledgered.
      await ackCaptures(keys, [capture.captureId]);
      console.info(`${LOG_PREFIX} acked ${capture.captureId}`);
      pulled += 1;
    } catch (err) {
      // One bad capture must not wedge the loop; skip it this round.
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `${LOG_PREFIX} failed to import ${capture.captureId}`,
        message,
      );
    }
  }

  // The poller writes notes/images straight through the API + file-service layer,
  // which does NOT run the React Query mutation hooks that normally refresh open
  // views, so the Notes list / Photos inbox would stay stale until a manual
  // refresh. Invalidate once after a productive poll so they re-fetch and the new
  // items appear on their own (mirrors SharedFolderAutoRefresh's invalidate).
  if (pulled > 0) {
    void appQueryClient.invalidateQueries();
  }

  return { pulled, errors };
}
