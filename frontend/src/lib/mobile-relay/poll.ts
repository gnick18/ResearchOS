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
import { filesApi, methodsApi, notesApi, inventoryItemsApi, inventoryStocksApi, purchasesApi, tasksApi, buildCurrentViewer } from "@/lib/local-api";
import { writePhoneReformat } from "@/lib/methods/phone-reformat-cache";
import { publishMethodToAllDevices } from "./method-snapshot";
import { publishAiJobStatus, type AiJobStatus } from "./ai-job-status";
import { canWriteIgnoringPiRole } from "@/lib/sharing/unified";
import { attachImageToTask, attachImageToNote } from "@/lib/attachments/attach-image";
import { writeAnnotations, type AnnotationDoc } from "@/lib/attachments/annotations";
import { writeOcr, type OcrResult } from "@/lib/attachments/ocr";
import { imageEvents } from "@/lib/attachments/image-events";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import {
  ackCaptures,
  ackCommands,
  fetchInbox,
  fetchObject,
  pollCommands,
  type PendingCapture,
  type UserCaptureKeys,
} from "@/lib/mobile-relay/client";
import { openSealed } from "@/lib/sharing/encryption";
import { hexToBytes } from "@noble/hashes/utils.js";
import { loadIdentity } from "@/lib/sharing/identity/storage";
import {
  taskNotesBase,
  taskResultsBase,
  taskResultsTabBase,
} from "@/lib/tasks/results-paths";
import { useAppStore } from "@/lib/store";
import { useLaptopTimerStore } from "@/lib/timers/laptop-timers";
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

// Decoupled OCR layers awaiting their image, keyed by captureId. MODULE-LEVEL so
// an ocr-sidecar command that arrives in a different poll cycle than its image
// is still applied (the command is acked on arrival, but the OCR persists here
// until the image lands). Consumed + deleted when the image is written; capped
// so a capture whose image never arrives cannot leak unboundedly.
const ocrByCaptureId = new Map<string, OcrResult>();
const OCR_BY_CAPTURE_CAP = 200;

function rememberOcr(captureId: string, ocr: OcrResult): void {
  if (ocrByCaptureId.size >= OCR_BY_CAPTURE_CAP) {
    const oldest = ocrByCaptureId.keys().next().value;
    if (oldest !== undefined) ocrByCaptureId.delete(oldest);
  }
  ocrByCaptureId.set(captureId, ocr);
}

/** Write the decoupled OCR sidecar next to a just-written image, if one arrived
 *  for this captureId. Consumes (deletes) the entry. Best-effort, never throws. */
async function writeOcrSidecarIfPresent(
  captureId: string,
  basePath: string,
  finalFilename: string,
): Promise<void> {
  const ocr = ocrByCaptureId.get(captureId);
  if (!ocr) return;
  try {
    await writeOcr(basePath, finalFilename, ocr);
    ocrByCaptureId.delete(captureId);
    console.info(
      `${LOG_PREFIX} wrote OCR sidecar ${basePath}/Images/${finalFilename}.ocr.json`,
    );
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} failed to write OCR sidecar for ${finalFilename}`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

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

// ── Phase 1 command channel ─────────────────────────────────────────────────

/**
 * A route-capture command, sealed by the phone and polled by the laptop.
 * The phone seals this JSON to the user's X25519 public key and POSTs it via
 * postCommand. The laptop's runCaptureInboxPoll unseals it, maps the captureId
 * to a task folder, and routes the matching inbox image there instead of to the
 * default inbox path.
 *
 * Phase 2 added append-line. Unknown types are intentionally left un-acked
 * (a TTL on the relay handles eventual cleanup).
 */
interface RouteCaptureCommand {
  type: "route-capture";
  /** The captureId of the relay inbox item to route. */
  captureId: string;
  /** Numeric task id (matches ActiveTask.id in the store). */
  taskId: number;
  /** Owner username (matches ActiveTask.owner). */
  owner: string;
  /** Which editor tab the image should land in. */
  tab: "notes" | "results";
}

/**
 * An append-line command, sealed by the phone (Phase 2). The phone seals this
 * JSON to the user's X25519 public key and POSTs it via postCommand. The
 * laptop unseals it and appends `text` as a new line at the end of the chosen
 * tab's markdown doc, either live (via a window event to the open popup) or
 * directly to the on-disk .md file when the experiment is not open.
 */
interface AppendLineCommand {
  type: "append-line";
  /** Numeric task id (matches ActiveTask.id in the store). */
  taskId: number;
  /** Owner username (matches ActiveTask.owner). */
  owner: string;
  /** Which doc tab the line should be appended to. */
  tab: "notes" | "results";
  /** Plain markdown line: "<expr> = <value with units>", no bullet/label. */
  text: string;
}

/**
 * A route-capture-note command (Phase 1.5). The phone seals this JSON to the
 * user's X25519 public key. The laptop unseals it and routes the uploaded
 * capture to the specified note entry via attachImageToNote, then dispatches
 * a note:routed window event so the open popup auto-switches to that entry.
 */
interface RouteCaptureNoteCommand {
  type: "route-capture-note";
  /** The captureId of the relay inbox item to route. */
  captureId: string;
  /** Numeric note id. */
  noteId: number;
  /** Owner username. */
  owner: string;
  /** Entry id to append the image to. Null means use the latest entry (fallback). */
  entryId: string | null;
}

/**
 * An ocr-sidecar command (decoupled OCR delivery). The phone seals this for
 * every scanned capture, keyed to the captureId, INDEPENDENT of routing. The
 * laptop stores it by captureId and writes {image}.ocr.json next to the image
 * WHEREVER it lands (inbox, notebook, or experiment), so a scan keeps its OCR
 * layer no matter where the user files it (or if they leave it in the inbox).
 */
interface OcrSidecarCommand {
  type: "ocr-sidecar";
  /** The captureId this OCR layer belongs to. */
  captureId: string;
  /** The OCR result to write to {image}.ocr.json. */
  ocr: OcrResult;
}

/**
 * An append-note-text command (text routing). The phone seals this JSON to the
 * user's X25519 public key. The laptop unseals it and appends text into the
 * given note entry. The text rides inside the sealed command (no relay object
 * upload). When entryId is null the laptop uses the latest entry, or creates
 * one if the note has no entries.
 */
interface AppendNoteTextCommand {
  type: "append-note-text";
  /** Numeric note id. */
  noteId: number;
  /** Owner username. */
  owner: string;
  /** Entry id to append to. Null means use the latest entry (or create one). */
  entryId: string | null;
  /** Markdown text to append. */
  text: string;
}

/**
 * An add-variation command (View method on phone, 2026-06-10). The phone seals
 * this when the researcher records a variation while following a method at the
 * bench (e.g. "this batch I used 30 cycles not 28"). The laptop unseals it and
 * appends the text as a new timestamped "### Variation" entry on the matching
 * method attachment's variation_notes, reusing the existing variations feature
 * (tasksApi.saveVariationNote) so the note shows up in the laptop's Variation
 * Notes panel + the method's Linked Experiments hover.
 *
 * methodId selects which attached method's variation_notes to append to (an
 * experiment can attach several methods). When absent the laptop falls back to
 * the task's first method attachment, which is the common single-method case.
 */
interface AddVariationCommand {
  type: "add-variation";
  /** Numeric task id (matches ActiveTask.id / the focused experiment). */
  taskId: number;
  /** Owner username (matches the focused experiment's owner). */
  owner: string;
  /** Which attached method's variation_notes to append to. Optional. */
  methodId?: number;
  /** The variation text the researcher typed at the bench (plain markdown). */
  text: string;
  /** ISO timestamp from the phone, used in the entry header when present. */
  at?: string;
}

/**
 * A method-check command (2026-06-13). The phone seals this when the researcher
 * ticks reagents off a method's checklist at the bench. The laptop overwrites
 * the matching attachment's gathered_checks with the FULL map (last-write-wins,
 * so retries and out-of-order delivery are harmless and no dedup is needed). It
 * shows up as a "N of M gathered" indicator on the experiment's method view.
 * Like add-variation, this writes the per-experiment attachment, never the
 * source method.
 */
interface MethodCheckCommand {
  type: "method-check";
  /** Numeric task id (matches the focused experiment). */
  taskId: number;
  /** Owner username (matches the focused experiment's owner). */
  owner: string;
  /** Which attached method's gathered state to set. Optional (first method). */
  methodId?: number;
  /** Full ticked map, keyed by `${stepIndex}:${checkIndex}`. */
  checks: Record<string, boolean>;
  /** How many checks are ticked, precomputed by the phone. */
  gatheredCount: number;
  /** Total checks the method has, for the "N of M" display. */
  total: number;
  /** ISO timestamp of the phone tick that produced this state. */
  at: string;
}

/**
 * A reformat-method command (method phone projection reformatter, Phase 2 phone
 * trigger, 2026-06-14). The phone seals this when the researcher taps "make a
 * phone version" on a body-type method at the bench. The laptop reads the
 * method's source body, calls the metered reformat endpoint, caches the result
 * next to the source (writePhoneReformat), republishes the method snapshot so the
 * phone re-renders with the tidied steps, and publishes an ai-job status so the
 * phone bubble can land on the real token count. The model only restructures the
 * user's own content under a verbatim guardrail (enforced server-side), so this
 * stays inside BeakerBot's allowed scope.
 */
interface ReformatMethodCommand {
  type: "reformat-method";
  /** Correlation id the phone minted, echoed back in the ai-job status so the
   *  phone only reacts to its own job. */
  jobId: string;
  /** Numeric task id (the focused experiment the method is viewed under). */
  taskId: number;
  /** Owner username (whose namespace the method + experiment live in). */
  owner: string;
  /** The method to reformat. */
  methodId: number;
  /** ISO timestamp from the phone. */
  at?: string;
}

/**
 * A timer command (Phase 3). The phone seals this when it starts or dismisses a
 * timer so the laptop mirrors it. op "create" carries the full timer; op
 * "dismiss" carries only the id. "done" is never sent (each device flips to done
 * locally from the absolute endsAt). Applied to the laptop timer store + acked
 * immediately, since timers have no dependency on the capture route map.
 */
interface TimerCommand {
  type: "timer";
  op: "create" | "dismiss";
  /** Origin-prefixed id (phn_...), the cross-device dedupe + dismiss key. */
  timerId: string;
  label?: string;
  durationSec?: number;
  startedAt?: number;
  endsAt?: number;
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

  // ── Phase 1+2 command poll ──────────────────────────────────────────────
  // Poll any pending commands from paired phones before pulling the inbox so
  // the route map is ready before we process images.
  //
  // Handled: route-capture (Phase 1), append-line (Phase 2). Unknown types
  // (switch-tab, timer, etc.) are NOT acked so they are not lost before their
  // handler lands. A brief comment acknowledges the un-bounded growth risk;
  // the relay TTL (set by the worker) is the guard.
  const routeMap = new Map<string, { taskId: number; owner: string; tab: "notes" | "results"; commandId: string }>();
  // Note route map: captureId -> note destination + commandId (Phase 1.5).
  const noteRouteMap = new Map<string, { noteId: number; owner: string; entryId: string | null; commandId: string }>();
  // Append-line commands to apply after the route-map pass. Accumulated here so
  // we process captures first (route-map must be complete), then apply appends.
  const appendLineQueue: Array<{ cmd: AppendLineCommand; commandId: string }> = [];
  // Append-note-text commands (text routing). Applied after captures for the
  // same ordering reason as appendLineQueue.
  const appendNoteTextQueue: Array<{ cmd: AppendNoteTextCommand; commandId: string }> = [];
  // Add-variation commands (View method on phone). Applied after captures so the
  // variation write does not race route-map construction; each is independent.
  const addVariationQueue: Array<{ cmd: AddVariationCommand; commandId: string }> = [];
  // Method-check commands (gathered reagents). Applied after captures; each
  // overwrites its attachment's gathered_checks (last-write-wins).
  const methodCheckQueue: Array<{ cmd: MethodCheckCommand; commandId: string }> = [];
  // Reformat-method commands (phone "make phone-friendly"). Applied after captures;
  // each calls the metered AI endpoint, caches the result, and republishes.
  const reformatQueue: Array<{ cmd: ReformatMethodCommand; commandId: string }> = [];

  // Load the user's X25519 private key for unsealing commands. The relay
  // seals each command to the user's identity encryption key, which is
  // identity.keys.encryption.privateKey. loadIdentity() returns the same
  // unlocked record that loadUserCaptureKeys reads signing from.
  let x25519PrivateKey: Uint8Array | null = null;
  try {
    const identity = await loadIdentity();
    if (identity) {
      x25519PrivateKey = identity.keys.encryption.privateKey;
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} could not load identity for command unsealing`, err instanceof Error ? err.message : String(err));
  }

  if (x25519PrivateKey !== null) {
    try {
      const commands = await pollCommands(keys);
      if (commands.length > 0) {
        console.info(`${LOG_PREFIX} ${commands.length} pending command(s)`);
      }
      for (const cmd of commands) {
        try {
          const sealedBytes = hexToBytes(cmd.sealed);
          const plaintext = openSealed(sealedBytes, x25519PrivateKey);
          const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { type?: string };

          if (parsed.type === "route-capture") {
            const rc = parsed as RouteCaptureCommand;
            if (rc.captureId && typeof rc.taskId === "number" && rc.owner && (rc.tab === "notes" || rc.tab === "results")) {
              routeMap.set(rc.captureId, {
                taskId: rc.taskId,
                owner: rc.owner,
                tab: rc.tab,
                commandId: cmd.commandId,
              });
              console.info(
                `${LOG_PREFIX} route-capture command: captureId=${rc.captureId} -> task ${rc.owner}/${rc.taskId} tab=${rc.tab}`,
              );
            } else {
              console.warn(`${LOG_PREFIX} route-capture command ${cmd.commandId} has invalid fields, skipping`);
            }
          } else if (parsed.type === "route-capture-note") {
            // Phase 1.5: route a capture into a specific note entry.
            const rcn = parsed as RouteCaptureNoteCommand;
            if (rcn.captureId && typeof rcn.noteId === "number" && rcn.owner) {
              noteRouteMap.set(rcn.captureId, {
                noteId: rcn.noteId,
                owner: rcn.owner,
                entryId: rcn.entryId ?? null,
                commandId: cmd.commandId,
              });
              console.info(
                `${LOG_PREFIX} route-capture-note command: captureId=${rcn.captureId} -> note ${rcn.owner}/${rcn.noteId} entryId=${rcn.entryId ?? "latest"}`,
              );
            } else {
              console.warn(`${LOG_PREFIX} route-capture-note command ${cmd.commandId} has invalid fields, skipping`);
            }
          } else if (parsed.type === "ocr-sidecar") {
            // Decoupled OCR. Store the OCR layer by captureId + ack now; it is
            // written to {image}.ocr.json wherever this capture's image lands
            // (inbox / note / experiment), no dependency on routing.
            const osc = parsed as OcrSidecarCommand;
            if (osc.captureId && osc.ocr && typeof osc.ocr.text === "string") {
              rememberOcr(osc.captureId, osc.ocr);
              console.info(`${LOG_PREFIX} ocr-sidecar command: captureId=${osc.captureId}`);
              try {
                await ackCommands(keys, [cmd.commandId]);
              } catch (ackErr) {
                console.warn(
                  `${LOG_PREFIX} failed to ack ocr-sidecar command ${cmd.commandId}`,
                  ackErr instanceof Error ? ackErr.message : String(ackErr),
                );
              }
            } else {
              console.warn(`${LOG_PREFIX} ocr-sidecar command ${cmd.commandId} has invalid fields, skipping`);
            }
          } else if (parsed.type === "append-line") {
            // Phase 2: append a calc result line to a task doc. Defer to after
            // captures are processed (image routing has no dependency here, but
            // appends are user-visible writes and should not race route-map
            // construction).
            const al = parsed as AppendLineCommand;
            if (typeof al.taskId === "number" && al.owner && (al.tab === "notes" || al.tab === "results") && typeof al.text === "string") {
              appendLineQueue.push({ cmd: al, commandId: cmd.commandId });
              console.info(
                `${LOG_PREFIX} append-line command queued: task ${al.owner}/${al.taskId} tab=${al.tab} text="${al.text.slice(0, 60)}"`,
              );
            } else {
              console.warn(`${LOG_PREFIX} append-line command ${cmd.commandId} has invalid fields, skipping`);
            }
          } else if (parsed.type === "append-note-text") {
            // Text routing: append markdown text into a note entry.
            const ant = parsed as AppendNoteTextCommand;
            if (typeof ant.noteId === "number" && ant.owner && typeof ant.text === "string") {
              appendNoteTextQueue.push({ cmd: ant, commandId: cmd.commandId });
              console.info(
                `${LOG_PREFIX} append-note-text command queued: note ${ant.owner}/${ant.noteId} entryId=${ant.entryId ?? "latest"} text="${ant.text.slice(0, 60)}"`,
              );
            } else {
              console.warn(`${LOG_PREFIX} append-note-text command ${cmd.commandId} has invalid fields, skipping`);
            }
          } else if (parsed.type === "add-variation") {
            // View method on phone: a variation recorded at the bench. Queue it
            // for after the capture pass (same ordering rationale as the append
            // queues). The text is required; methodId is optional (falls back to
            // the task's first method attachment in the handler).
            const av = parsed as AddVariationCommand;
            if (typeof av.taskId === "number" && av.owner && typeof av.text === "string" && av.text.trim()) {
              addVariationQueue.push({ cmd: av, commandId: cmd.commandId });
              console.info(
                `${LOG_PREFIX} add-variation command queued: task ${av.owner}/${av.taskId} methodId=${av.methodId ?? "first"} text="${av.text.slice(0, 60)}"`,
              );
            } else {
              console.warn(`${LOG_PREFIX} add-variation command ${cmd.commandId} has invalid fields, skipping`);
            }
          } else if (parsed.type === "method-check") {
            // Gathered reagents synced from read mode. Queue it for after the
            // capture pass; the handler overwrites the attachment's
            // gathered_checks (last-write-wins). checks must be an object.
            const mc = parsed as MethodCheckCommand;
            if (
              typeof mc.taskId === "number" &&
              mc.owner &&
              mc.checks &&
              typeof mc.checks === "object"
            ) {
              methodCheckQueue.push({ cmd: mc, commandId: cmd.commandId });
              console.info(
                `${LOG_PREFIX} method-check command queued: task ${mc.owner}/${mc.taskId} methodId=${mc.methodId ?? "first"} ${mc.gatheredCount ?? "?"}/${mc.total ?? "?"} gathered`,
              );
            } else {
              console.warn(`${LOG_PREFIX} method-check command ${cmd.commandId} has invalid fields, skipping`);
            }
          } else if (parsed.type === "reformat-method") {
            // Phone "make phone-friendly". Queue for after the capture pass; the
            // handler calls the metered AI endpoint, so it must not block the
            // route-map / image work. jobId + methodId + owner are required.
            const rm = parsed as ReformatMethodCommand;
            if (
              typeof rm.jobId === "string" &&
              rm.jobId &&
              typeof rm.taskId === "number" &&
              rm.owner &&
              typeof rm.methodId === "number"
            ) {
              reformatQueue.push({ cmd: rm, commandId: cmd.commandId });
              console.info(
                `${LOG_PREFIX} reformat-method command queued: task ${rm.owner}/${rm.taskId} method ${rm.methodId} job ${rm.jobId}`,
              );
            } else {
              console.warn(`${LOG_PREFIX} reformat-method command ${cmd.commandId} has invalid fields, skipping`);
            }
          } else if (parsed.type === "timer") {
            // Phase 3: a timer started or dismissed on the phone. No dependency
            // on the capture route map, so apply to the laptop timer store and
            // ack right away. The store update re-renders the open Timers panel.
            const tc = parsed as TimerCommand;
            const store = useLaptopTimerStore.getState();
            let applied = false;
            if (
              tc.op === "create" &&
              tc.timerId &&
              typeof tc.durationSec === "number" &&
              typeof tc.startedAt === "number" &&
              typeof tc.endsAt === "number"
            ) {
              store.ingestPhoneTimer({
                id: tc.timerId,
                label: typeof tc.label === "string" ? tc.label : "",
                durationSec: tc.durationSec,
                startedAt: tc.startedAt,
                endsAt: tc.endsAt,
              });
              applied = true;
              console.info(`${LOG_PREFIX} timer create: ${tc.timerId}`);
            } else if (tc.op === "dismiss" && tc.timerId) {
              store.applyPhoneDismiss(tc.timerId);
              applied = true;
              console.info(`${LOG_PREFIX} timer dismiss: ${tc.timerId}`);
            } else {
              console.warn(`${LOG_PREFIX} timer command ${cmd.commandId} has invalid fields, skipping`);
            }
            if (applied) {
              try {
                await ackCommands(keys, [cmd.commandId]);
              } catch (ackErr) {
                console.warn(
                  `${LOG_PREFIX} failed to ack timer command ${cmd.commandId}`,
                  ackErr instanceof Error ? ackErr.message : String(ackErr),
                );
              }
            }
          } else {
            // Unknown command type. Do NOT ack so a later phase can handle it.
            // The relay TTL (configured on the worker) handles eventual cleanup
            // so un-acked unknown commands do not accumulate unboundedly.
            console.info(
              `${LOG_PREFIX} unhandled command type ${String(parsed.type)}, leaving for a later phase`,
            );
          }
        } catch (cmdErr) {
          console.warn(
            `${LOG_PREFIX} failed to unseal/parse command ${cmd.commandId}`,
            cmdErr instanceof Error ? cmdErr.message : String(cmdErr),
          );
        }
      }
    } catch (pollErr) {
      // Command poll is best-effort; a relay error must not block the inbox pull.
      console.warn(`${LOG_PREFIX} pollCommands failed (continuing without route map)`, pollErr instanceof Error ? pollErr.message : String(pollErr));
    }
  }
  // ── end command poll ────────────────────────────────────────────────────

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
        // Phase 1.5: note routing takes precedence over experiment routing when
        // a route-capture-note command is present for this captureId.
        const noteRoute = noteRouteMap.get(capture.captureId);

        if (noteRoute) {
          // Permission gate (chooser-perm bot, 2026-06-09): before writing into
          // a note that may be owned by another user, confirm the current user
          // has edit access. Three cases grant write:
          //   1. Own note: noteRoute.owner === currentUser (owner always writes).
          //   2. Explicitly shared at edit level: the note's `shared_with` array
          //      contains the current user (or "*") with level "edit".
          //   3. 1:1 notebook note: same as (2) because the note is created with
          //      both members at "edit" in shared_with via pairingSharedWith.
          // canWriteIgnoringPiRole covers all three with one call: it returns true
          // for the note owner AND for any explicit edit-share recipient. The PI
          // implicit-write-all is intentionally excluded (that path requires a
          // once-per-session confirm in the popup UI; the poller has no UI, so we
          // gate to explicit-edit only). If the note is not found or the user only
          // has view access, fall back to the inbox image path instead of writing
          // into a note they cannot edit.
          let noteWritable = false;
          try {
            const noteRecord = await notesApi.get(noteRoute.noteId, noteRoute.owner);
            if (noteRecord) {
              const viewer = await buildCurrentViewer();
              // Build a minimal ShareableRecord from the note. The note's owner
              // field is the ownerUsername from the command (source of truth for
              // the folder path); shared_with carries the edit grants.
              const shareableNote = {
                owner: noteRoute.owner,
                shared_with: noteRecord.shared_with ?? [],
              };
              noteWritable = canWriteIgnoringPiRole(shareableNote, viewer);
            } else {
              console.warn(
                `${LOG_PREFIX} route-capture-note: note ${noteRoute.owner}/${noteRoute.noteId} not found, falling back to inbox`,
              );
            }
          } catch (permErr) {
            console.warn(
              `${LOG_PREFIX} route-capture-note: permission check failed for note ${noteRoute.owner}/${noteRoute.noteId}, falling back to inbox`,
              permErr instanceof Error ? permErr.message : String(permErr),
            );
          }

          if (!noteWritable) {
            // Not writable: route to the inbox so the image is not lost.
            console.warn(
              `${LOG_PREFIX} route-capture-note: ${currentUser} does not have edit access to note ${noteRoute.owner}/${noteRoute.noteId}, routing to inbox instead`,
            );
            // Ack the command so it doesn't loop (the permission is authoritative;
            // retrying will produce the same result). The capture itself continues
            // below to the standard inbox landing path.
            try {
              await ackCommands(keys, [noteRoute.commandId]);
            } catch {
              // best-effort
            }
            // Fall through to the standard inbox path by letting noteRoute remain
            // set but overriding the destination. We do this by jumping to the
            // regular attachImageToTask inbox path: clear noteRoute in the local
            // scope by reusing the imageLanding block below.
            // Simplest approach: write directly to the inbox here and continue.
            const inboxResult = await attachImageToTask({
              ownerUsername: currentUser,
              taskId: 0,
              basePath,
              blob,
              suggestedFilename: suggestedImageFilename(capture),
              altText: caption,
            });
            await writeCaptureSidecar(basePath, inboxResult.finalFilename, {
              source: "relay",
              caption,
              receivedAt: new Date().toISOString(),
            });
            console.info(
              `${LOG_PREFIX} wrote inbox fallback ${basePath}/Images/${inboxResult.finalFilename} (note not writable)`,
            );
            await writeOcrSidecarIfPresent(
              capture.captureId,
              basePath,
              inboxResult.finalFilename,
            );
            await markCaptureSeen(currentUser, seen, capture.captureId);
            await ackCaptures(keys, [capture.captureId]);
            console.info(`${LOG_PREFIX} acked ${capture.captureId} (note-perm inbox fallback)`);
            pulled += 1;
            continue;
          }

          console.info(
            `${LOG_PREFIX} routing ${capture.captureId} -> note ${noteRoute.owner}/${noteRoute.noteId} entryId=${noteRoute.entryId ?? "latest"}`,
          );
          // Attribution: attachImageToNote calls notesApi.updateEntry(noteId, entryId,
          // data, ownerUsername). updateEntry triggers recordEntryHistory, which calls
          // resolveAttributionActor(null) -> getCurrentUserCached() -> the current
          // signed-in user (the writer, not the note owner). So last_edited_by on the
          // history row is stamped to currentUser automatically; no extra threading needed.
          const noteResult = await attachImageToNote({
            ownerUsername: noteRoute.owner,
            noteId: noteRoute.noteId,
            blob,
            suggestedFilename: suggestedImageFilename(capture),
            altText: caption,
            entryId: noteRoute.entryId ?? undefined,
          });
          console.info(
            `${LOG_PREFIX} wrote note ${noteRoute.noteId}/Images/${noteResult.finalFilename}`,
          );

          // Decoupled OCR: write the sidecar next to the note image if an
          // ocr-sidecar command arrived for this capture (scanned handwriting).
          await writeOcrSidecarIfPresent(
            capture.captureId,
            `users/${noteRoute.owner}/notes/${noteRoute.noteId}`,
            noteResult.finalFilename,
          );

          // Dispatch note:routed so the open note popup auto-switches to the entry.
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("note:routed", {
                detail: {
                  noteId: noteRoute.noteId,
                  owner: noteRoute.owner,
                  entryId: noteResult.appendedToEntryId ?? noteRoute.entryId,
                },
              }),
            );
          }

          // Ack the note route command after the write succeeds.
          try {
            await ackCommands(keys, [noteRoute.commandId]);
            console.info(`${LOG_PREFIX} acked route-capture-note command ${noteRoute.commandId}`);
          } catch (ackCmdErr) {
            console.warn(
              `${LOG_PREFIX} failed to ack route-capture-note command ${noteRoute.commandId}`,
              ackCmdErr instanceof Error ? ackCmdErr.message : String(ackCmdErr),
            );
          }

          // Record + ack the capture itself.
          await markCaptureSeen(currentUser, seen, capture.captureId);
          await ackCaptures(keys, [capture.captureId]);
          console.info(`${LOG_PREFIX} acked ${capture.captureId} (note route)`);
          pulled += 1;
          continue;
        }

        // Phase 1 route-capture: if a route-capture command maps this captureId
        // to a specific task tab, land it there instead of the inbox.
        const route = routeMap.get(capture.captureId);
        let imageLandingPath: string;
        let imageLandingTaskId: number;
        let imageLandingOwner: string;
        let routeCommandId: string | null = null;
        // The destination to auto-switch the open popup to, for BOTH an explicit
        // phone route command and an implicit "an experiment is open" auto-route.
        // Null means the photo went to the inbox, so no popup gets switched.
        let routedDetail:
          | { taskId: number; owner: string; tab: "notes" | "results" }
          | null = null;

        if (route) {
          try {
            imageLandingPath =
              route.tab === "results"
                ? taskResultsTabBase({ id: route.taskId, owner: route.owner })
                : taskNotesBase({ id: route.taskId, owner: route.owner });
            imageLandingTaskId = route.taskId;
            imageLandingOwner = route.owner;
            routeCommandId = route.commandId;
            routedDetail = { taskId: route.taskId, owner: route.owner, tab: route.tab };
            console.info(
              `${LOG_PREFIX} routing ${capture.captureId} -> ${imageLandingPath} (tab=${route.tab})`,
            );
          } catch (routeErr) {
            // Path helpers failed unexpectedly; fall back to inbox.
            console.warn(
              `${LOG_PREFIX} route path build failed for ${capture.captureId}, falling back to inbox`,
              routeErr instanceof Error ? routeErr.message : String(routeErr),
            );
            imageLandingPath = basePath;
            imageLandingTaskId = 0;
            imageLandingOwner = currentUser;
          }
        } else {
          // No explicit route command from the phone. Honor the promise the open
          // experiment popup makes in its header ("Paired phone will send photos
          // to Results / Lab Notes"): if an experiment popup is open, land the
          // photo in its active tab (Results when the user is on Results,
          // otherwise Lab Notes, matching that tooltip) instead of the inbox, and
          // let the capture:routed dispatch below switch/refresh it. Falls back
          // to the inbox when no experiment is open.
          const openTask = useAppStore.getState().activeTask;
          const openTab = useAppStore.getState().activeTaskTab;
          if (openTask) {
            const tab: "notes" | "results" =
              openTab === "results" ? "results" : "notes";
            try {
              imageLandingPath =
                tab === "results"
                  ? taskResultsTabBase({ id: openTask.id, owner: openTask.owner })
                  : taskNotesBase({ id: openTask.id, owner: openTask.owner });
              imageLandingTaskId = openTask.id;
              imageLandingOwner = openTask.owner;
              routedDetail = { taskId: openTask.id, owner: openTask.owner, tab };
              console.info(
                `${LOG_PREFIX} auto-routing ${capture.captureId} -> open experiment ${openTask.owner}/${openTask.id} (tab=${tab})`,
              );
            } catch (autoErr) {
              console.warn(
                `${LOG_PREFIX} auto-route path build failed for ${capture.captureId}, falling back to inbox`,
                autoErr instanceof Error ? autoErr.message : String(autoErr),
              );
              imageLandingPath = basePath;
              imageLandingTaskId = 0;
              imageLandingOwner = currentUser;
            }
          } else {
            imageLandingPath = basePath;
            imageLandingTaskId = 0;
            imageLandingOwner = currentUser;
          }
        }

        const result = await attachImageToTask({
          ownerUsername: imageLandingOwner,
          taskId: imageLandingTaskId,
          basePath: imageLandingPath,
          blob,
          suggestedFilename: suggestedImageFilename(capture),
          altText: caption,
        });
        await writeCaptureSidecar(imageLandingPath, result.finalFilename, {
          source: "relay",
          caption,
          receivedAt: new Date().toISOString(),
        });
        console.info(
          `${LOG_PREFIX} wrote ${imageLandingPath}/Images/${result.finalFilename}`,
        );

        // Decoupled OCR: write the sidecar next to the image wherever it landed
        // (a routed experiment, or the default inbox), if an ocr-sidecar command
        // arrived for this capture.
        await writeOcrSidecarIfPresent(
          capture.captureId,
          imageLandingPath,
          result.finalFilename,
        );

        // Auto-switch the open experiment popup to the tab the photo landed in
        // (locked decision A/B). The popup saves any unsaved editor changes
        // first, then switches and shows the new image. A window CustomEvent
        // keeps poll.ts decoupled from the popup internals (same pattern the
        // tour uses). Fires for a routed capture, whether the route was an
        // explicit phone command or the open-experiment auto-route; stays silent
        // for an inbox landing (routedDetail null).
        if (routedDetail && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("capture:routed", { detail: routedDetail }),
          );
        }

        // Photo markup from the phone, written as the non-destructive
        // {imageName}.annot.json sidecar the web AnnotatedImage renderer reads,
        // so markup is editable across phone and laptop. Defensive: a malformed
        // annotation is skipped, never blocks the image import.
        if (capture.annotation) {
          try {
            const doc = JSON.parse(capture.annotation) as AnnotationDoc;
            if (doc && Array.isArray(doc.shapes)) {
              await writeAnnotations(imageLandingPath, result.finalFilename, doc);
              console.info(
                `${LOG_PREFIX} wrote ${imageLandingPath}/Images/${result.finalFilename}.annot.json`,
              );
            }
          } catch (err) {
            console.warn(
              `${LOG_PREFIX} skipped malformed annotation for ${result.finalFilename}`,
              err,
            );
          }
        }

        // After the capture is on disk, ack the route-capture command that
        // directed it here (only if one existed). Acked here, after the write,
        // so the command is not consumed if the image write fails.
        if (routeCommandId) {
          try {
            await ackCommands(keys, [routeCommandId]);
            console.info(`${LOG_PREFIX} acked route-capture command ${routeCommandId}`);
          } catch (ackCmdErr) {
            // Best-effort. The command will re-appear next poll; the capture is
            // already in `seen`, so the image will not be written twice.
            console.warn(
              `${LOG_PREFIX} failed to ack route-capture command ${routeCommandId}`,
              ackCmdErr instanceof Error ? ackCmdErr.message : String(ackCmdErr),
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

  // ── Phase 2 append-line processing ─────────────────────────────────────
  // Apply any append-line commands that arrived this poll. Each is handled
  // independently so a bad text does not block the rest.
  for (const { cmd, commandId } of appendLineQueue) {
    try {
      // Check whether the target experiment is currently open in the popup.
      const active = useAppStore.getState().activeTask;
      if (active && active.id === cmd.taskId && active.owner === cmd.owner) {
        // The popup is open: dispatch a window event so the live editor can
        // apply the line via its Loro insert (or legacy state update). The
        // popup's useEffect listener does the actual append and persist.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("notebook:append-line", {
              detail: {
                taskId: cmd.taskId,
                owner: cmd.owner,
                tab: cmd.tab,
                text: cmd.text,
              },
            }),
          );
          console.info(
            `${LOG_PREFIX} append-line dispatched to open popup: task ${cmd.owner}/${cmd.taskId} tab=${cmd.tab}`,
          );
        }
      } else {
        // The experiment is not open: write directly to the .md file on disk.
        // taskResultsBase gives the outer folder; the .md files live at
        // notes.md / results.md within that folder (not under the per-tab
        // attachment subdirs).
        const base = taskResultsBase({ id: cmd.taskId, owner: cmd.owner });
        const filePath = cmd.tab === "results"
          ? `${base}/results.md`
          : `${base}/notes.md`;

        let existing = "";
        try {
          const read = await filesApi.readFile(filePath);
          existing = read.content;
        } catch {
          // File does not exist yet (fresh experiment). Start with an empty doc.
        }

        // Append: trim trailing whitespace, add newline separator if non-empty,
        // then the line. Matches appendTaskLine semantics in task-doc.ts.
        const base64Content = existing.replace(/\s+$/, "");
        const next = base64Content ? base64Content + "\n" + cmd.text : cmd.text;
        await filesApi.writeFile(
          filePath,
          next,
          `Append calc result to task ${cmd.taskId}`,
        );
        console.info(
          `${LOG_PREFIX} append-line wrote to disk: ${filePath}`,
        );
      }

      // Ack the command after a successful apply.
      try {
        await ackCommands(keys, [commandId]);
        console.info(`${LOG_PREFIX} acked append-line command ${commandId}`);
      } catch (ackErr) {
        // Best-effort ack. The command will re-appear next poll; the append is
        // idempotent at the Loro layer and a duplicate disk write is a no-op
        // when the text is already present at the tail.
        console.warn(
          `${LOG_PREFIX} failed to ack append-line command ${commandId}`,
          ackErr instanceof Error ? ackErr.message : String(ackErr),
        );
      }

      pulled += 1;
    } catch (appendErr) {
      errors += 1;
      console.warn(
        `${LOG_PREFIX} failed to apply append-line command ${commandId}`,
        appendErr instanceof Error ? appendErr.message : String(appendErr),
      );
    }
  }
  // ── end append-line processing ──────────────────────────────────────────

  // ── append-note-text processing ─────────────────────────────────────────
  // Apply any append-note-text commands that arrived this poll. Each is handled
  // independently so one failure does not block the rest.
  for (const { cmd, commandId } of appendNoteTextQueue) {
    try {
      // Permission gate: same pattern as the route-capture-note handler above.
      // buildCurrentViewer + canWriteIgnoringPiRole covers own / shared-edit /
      // 1:1 notebook. PI implicit-write-all excluded (no UI here for confirmation).
      let noteWritable = false;
      let noteRecord = null;
      try {
        noteRecord = await notesApi.get(cmd.noteId, cmd.owner);
        if (noteRecord) {
          const viewer = await buildCurrentViewer();
          const shareableNote = {
            owner: cmd.owner,
            shared_with: noteRecord.shared_with ?? [],
          };
          noteWritable = canWriteIgnoringPiRole(shareableNote, viewer);
        } else {
          console.warn(
            `${LOG_PREFIX} append-note-text: note ${cmd.owner}/${cmd.noteId} not found, falling back to inbox note`,
          );
        }
      } catch (permErr) {
        console.warn(
          `${LOG_PREFIX} append-note-text: permission check failed for note ${cmd.owner}/${cmd.noteId}, falling back to inbox note`,
          permErr instanceof Error ? permErr.message : String(permErr),
        );
      }

      if (!noteWritable || !noteRecord) {
        // Not writable or not found: land as a plain inbox Note so text is not lost.
        console.warn(
          `${LOG_PREFIX} append-note-text: no write access to note ${cmd.owner}/${cmd.noteId}, landing as inbox note`,
        );
        const now = new Date().toISOString();
        await notesApi.create({
          title: now.slice(0, 10) + " (mobile note)",
          entries: [
            {
              title: now.slice(0, 10),
              date: now.slice(0, 10),
              content: cmd.text,
            },
          ],
        });
        console.info(`${LOG_PREFIX} append-note-text: created inbox fallback note`);
        // Ack so the command does not loop (permission is authoritative).
        try {
          await ackCommands(keys, [commandId]);
          console.info(`${LOG_PREFIX} acked append-note-text command ${commandId} (inbox fallback)`);
        } catch {
          // best-effort
        }
        pulled += 1;
        continue;
      }

      // Resolve the target entry.
      // Priority: given entryId -> latest entry by updated_at -> create new.
      let targetEntryId: string;
      const entries = noteRecord.entries ?? [];

      if (cmd.entryId && entries.some((e) => e.id === cmd.entryId)) {
        // Caller supplied a specific entry id and it exists in the note.
        targetEntryId = cmd.entryId;
        console.info(
          `${LOG_PREFIX} append-note-text: using given entryId=${targetEntryId}`,
        );
      } else if (entries.length > 0) {
        // Use the latest entry by updated_at.
        const latest = entries.reduce((a, b) =>
          (a.updated_at ?? "") >= (b.updated_at ?? "") ? a : b,
        );
        targetEntryId = latest.id;
        console.info(
          `${LOG_PREFIX} append-note-text: using latest entryId=${targetEntryId}`,
        );
      } else {
        // Note has no entries: create one now, then use it.
        const now = new Date().toISOString();
        const created = await notesApi.addEntry(
          cmd.noteId,
          { title: now.slice(0, 10), date: now.slice(0, 10), content: "" },
          cmd.owner,
        );
        const newEntries = created?.entries ?? [];
        if (newEntries.length === 0) {
          throw new Error("addEntry returned no entries");
        }
        targetEntryId = newEntries[newEntries.length - 1].id;
        console.info(
          `${LOG_PREFIX} append-note-text: created new entry ${targetEntryId}`,
        );
        // Re-read the record so existingContent is current after addEntry.
        noteRecord = created;
      }

      // Append the text.
      // Attribution: updateEntry calls recordEntryHistory, which calls
      // resolveAttributionActor(null) -> getCurrentUserCached() -> the current
      // signed-in user (the writer). Same attribution path as route-capture-note.
      const existingEntry = (noteRecord?.entries ?? []).find(
        (e) => e.id === targetEntryId,
      );
      const existingContent = existingEntry?.content ?? "";
      const newContent = existingContent.replace(/\s+$/, "")
        ? existingContent.replace(/\s+$/, "") + "\n\n" + cmd.text
        : cmd.text;

      await notesApi.updateEntry(
        cmd.noteId,
        targetEntryId,
        { content: newContent },
        cmd.owner,
      );
      console.info(
        `${LOG_PREFIX} append-note-text: appended to note ${cmd.owner}/${cmd.noteId} entry ${targetEntryId}`,
      );

      // Dispatch note:routed so an open NoteDetailPopup refreshes to this entry.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("note:routed", {
            detail: {
              noteId: cmd.noteId,
              owner: cmd.owner,
              entryId: targetEntryId,
            },
          }),
        );
      }

      // Ack the command after the write succeeds.
      try {
        await ackCommands(keys, [commandId]);
        console.info(`${LOG_PREFIX} acked append-note-text command ${commandId}`);
      } catch (ackErr) {
        console.warn(
          `${LOG_PREFIX} failed to ack append-note-text command ${commandId}`,
          ackErr instanceof Error ? ackErr.message : String(ackErr),
        );
      }

      pulled += 1;
    } catch (appendTextErr) {
      errors += 1;
      console.warn(
        `${LOG_PREFIX} failed to apply append-note-text command ${commandId}`,
        appendTextErr instanceof Error ? appendTextErr.message : String(appendTextErr),
      );
    }
  }
  // ── end append-note-text processing ─────────────────────────────────────

  // ── add-variation processing ────────────────────────────────────────────
  // Apply any add-variation commands that arrived this poll. Each appends a new
  // timestamped "### Variation" entry onto the target method attachment's
  // variation_notes via the existing variations feature (tasksApi.saveVariationNote),
  // so the note shows up in the laptop's Variation Notes panel. Handled
  // independently so one bad command does not block the rest.
  for (const { cmd, commandId } of addVariationQueue) {
    try {
      // Read the focused experiment from the owner's namespace.
      const task = await tasksApi.get(cmd.taskId, cmd.owner);
      if (!task) {
        console.warn(
          `${LOG_PREFIX} add-variation: task ${cmd.owner}/${cmd.taskId} not found, skipping`,
        );
        // Ack so the command does not loop forever on a deleted task.
        try {
          await ackCommands(keys, [commandId]);
        } catch {
          // best-effort
        }
        continue;
      }

      // Permission gate: the writer must have edit access to the experiment.
      // Mirrors the note-write gate (own / shared-edit; PI implicit-write-all is
      // excluded because the poller has no UI to run the once-per-session confirm).
      const viewer = await buildCurrentViewer();
      const writable = canWriteIgnoringPiRole(
        { owner: task.owner, shared_with: task.shared_with ?? [] },
        viewer,
      );
      if (!writable) {
        console.warn(
          `${LOG_PREFIX} add-variation: ${currentUser} has no edit access to task ${cmd.owner}/${cmd.taskId}, skipping`,
        );
        try {
          await ackCommands(keys, [commandId]);
        } catch {
          // best-effort
        }
        continue;
      }

      // Resolve which attached method's variation_notes to append to. Given
      // methodId wins when it matches an attachment; otherwise fall back to the
      // first attachment (the common single-method experiment).
      const attachments = task.method_attachments ?? [];
      if (attachments.length === 0) {
        console.warn(
          `${LOG_PREFIX} add-variation: task ${cmd.owner}/${cmd.taskId} has no methods attached, skipping`,
        );
        try {
          await ackCommands(keys, [commandId]);
        } catch {
          // best-effort
        }
        continue;
      }
      const targetAttachment =
        (typeof cmd.methodId === "number"
          ? attachments.find((a) => a.method_id === cmd.methodId)
          : undefined) ?? attachments[0];
      const targetMethodId = targetAttachment.method_id;

      // Build the new entry. Mirrors VariationNotesPanel.handleAddNote: a
      // "### Variation - <timestamp>" header followed by the body, prepended so
      // the newest entry is first (same ordering the panel uses).
      const stampSource = cmd.at ? new Date(cmd.at) : new Date();
      const timestamp = `${stampSource.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })} ${stampSource.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })}`;
      const newEntry = `### Variation - ${timestamp}\n\n${cmd.text.trim()}`;
      const existing = targetAttachment.variation_notes ?? "";
      const nextNotes = existing.trim()
        ? `${newEntry}\n\n${existing.trim()}`
        : newEntry;

      // Persist via the existing variations feature. The 4th arg routes the
      // write to the owner's namespace (the experiment may be shared with the
      // current user, owned by someone else). saveVariationNote stamps
      // attribution to the current signed-in writer via the same path the note
      // writes use.
      await tasksApi.saveVariationNote(cmd.taskId, targetMethodId, nextNotes, cmd.owner);
      console.info(
        `${LOG_PREFIX} add-variation: appended to task ${cmd.owner}/${cmd.taskId} method ${targetMethodId}`,
      );

      // Ack the command after the write succeeds.
      try {
        await ackCommands(keys, [commandId]);
        console.info(`${LOG_PREFIX} acked add-variation command ${commandId}`);
      } catch (ackErr) {
        console.warn(
          `${LOG_PREFIX} failed to ack add-variation command ${commandId}`,
          ackErr instanceof Error ? ackErr.message : String(ackErr),
        );
      }

      pulled += 1;
    } catch (variationErr) {
      errors += 1;
      console.warn(
        `${LOG_PREFIX} failed to apply add-variation command ${commandId}`,
        variationErr instanceof Error ? variationErr.message : String(variationErr),
      );
    }
  }
  // ── end add-variation processing ────────────────────────────────────────

  // ── method-check processing ─────────────────────────────────────────────
  // Apply any method-check commands. Each OVERWRITES the target attachment's
  // gathered_checks with the full map the phone sent (last-write-wins), so the
  // experiment's method view can show "N of M gathered". Same task lookup +
  // edit-access gate + methodId resolution as add-variation.
  for (const { cmd, commandId } of methodCheckQueue) {
    try {
      const task = await tasksApi.get(cmd.taskId, cmd.owner);
      if (!task) {
        console.warn(
          `${LOG_PREFIX} method-check: task ${cmd.owner}/${cmd.taskId} not found, skipping`,
        );
        try {
          await ackCommands(keys, [commandId]);
        } catch {
          // best-effort
        }
        continue;
      }

      const viewer = await buildCurrentViewer();
      const writable = canWriteIgnoringPiRole(
        { owner: task.owner, shared_with: task.shared_with ?? [] },
        viewer,
      );
      if (!writable) {
        console.warn(
          `${LOG_PREFIX} method-check: ${currentUser} has no edit access to task ${cmd.owner}/${cmd.taskId}, skipping`,
        );
        try {
          await ackCommands(keys, [commandId]);
        } catch {
          // best-effort
        }
        continue;
      }

      const attachments = task.method_attachments ?? [];
      if (attachments.length === 0) {
        console.warn(
          `${LOG_PREFIX} method-check: task ${cmd.owner}/${cmd.taskId} has no methods attached, skipping`,
        );
        try {
          await ackCommands(keys, [commandId]);
        } catch {
          // best-effort
        }
        continue;
      }
      const targetAttachment =
        (typeof cmd.methodId === "number"
          ? attachments.find((a) => a.method_id === cmd.methodId)
          : undefined) ?? attachments[0];
      const targetMethodId = targetAttachment.method_id;

      // Normalize the gathered state from the (untrusted) command. Recompute the
      // count from the map so it cannot disagree with the booleans, and clamp.
      const checks = cmd.checks ?? {};
      const gatheredCount = Object.values(checks).filter(Boolean).length;
      const total =
        typeof cmd.total === "number" && cmd.total >= gatheredCount
          ? cmd.total
          : gatheredCount;
      const gathered = {
        checks,
        gatheredCount,
        total,
        at: typeof cmd.at === "string" ? cmd.at : new Date().toISOString(),
      };

      await tasksApi.saveGatheredChecks(cmd.taskId, targetMethodId, gathered, cmd.owner);
      console.info(
        `${LOG_PREFIX} method-check: set ${gatheredCount}/${total} gathered on task ${cmd.owner}/${cmd.taskId} method ${targetMethodId}`,
      );

      try {
        await ackCommands(keys, [commandId]);
        console.info(`${LOG_PREFIX} acked method-check command ${commandId}`);
      } catch (ackErr) {
        console.warn(
          `${LOG_PREFIX} failed to ack method-check command ${commandId}`,
          ackErr instanceof Error ? ackErr.message : String(ackErr),
        );
      }

      pulled += 1;
    } catch (methodCheckErr) {
      errors += 1;
      console.warn(
        `${LOG_PREFIX} failed to apply method-check command ${commandId}`,
        methodCheckErr instanceof Error ? methodCheckErr.message : String(methodCheckErr),
      );
    }
  }
  // ── end method-check processing ─────────────────────────────────────────

  // ── reformat-method processing ──────────────────────────────────────────
  // Apply any reformat-method commands. Each reads the method's source body,
  // calls the metered AI reformat endpoint (server-side guardrail), caches the
  // result next to the source, republishes the method snapshot, and announces an
  // ai-job status so the phone bubble lands on the real token count. We ACK after
  // every terminal outcome (success OR a handled error) so a failed job never
  // auto-retries and re-bills; the user re-taps to retry instead.
  for (const { cmd, commandId } of reformatQueue) {
    const announce = (patch: Partial<AiJobStatus>) =>
      publishAiJobStatus(keys, {
        kind: "reformat-method",
        jobId: cmd.jobId,
        methodId: cmd.methodId,
        taskId: cmd.taskId,
        status: "working",
        at: new Date().toISOString(),
        ...patch,
      }).catch(() => {
        // best-effort, the phone also runs its own local countdown
      });
    const ack = async () => {
      try {
        await ackCommands(keys, [commandId]);
      } catch (ackErr) {
        console.warn(
          `${LOG_PREFIX} failed to ack reformat-method command ${commandId}`,
          ackErr instanceof Error ? ackErr.message : String(ackErr),
        );
      }
    };
    try {
      const method = await methodsApi.get(cmd.methodId, cmd.owner).catch(() => null);
      const sourcePath = method?.source_path ?? null;
      if (!method || !sourcePath || sourcePath.includes("://")) {
        console.warn(
          `${LOG_PREFIX} reformat-method: method ${cmd.owner}/${cmd.methodId} has no markdown body, skipping`,
        );
        await announce({ status: "error", errorReason: "no_body" });
        await ack();
        continue;
      }

      await announce({ status: "working" });

      const file = await filesApi.readFile(sourcePath);
      const res = await fetch("/api/ai/reformat-method", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: file.content, task_id: cmd.jobId }),
      });

      if (res.status === 402) {
        await announce({ status: "error", errorReason: "out_of_credits" });
        await ack();
        continue;
      }
      if (!res.ok) {
        // The endpoint refused before spending tokens (no key, provider error).
        await announce({ status: "error", errorReason: "failed" });
        await ack();
        continue;
      }

      const data = (await res.json()) as {
        ok?: boolean;
        reformatted?: string;
        usage?: { total?: number };
      };
      let outcome: NonNullable<AiJobStatus["outcome"]> = "kept-plain";
      if (data?.ok && typeof data.reformatted === "string") {
        await writePhoneReformat(sourcePath, file.sha, data.reformatted);
        outcome = "reformatted";
        console.info(
          `${LOG_PREFIX} reformat-method: cached phone reformat for method ${cmd.owner}/${cmd.methodId}`,
        );
      } else {
        // The guardrail refused the reformat; the phone keeps the deterministic
        // plain steps, which is a calm outcome, not an error.
        console.info(
          `${LOG_PREFIX} reformat-method: guardrail kept plain steps for method ${cmd.owner}/${cmd.methodId}`,
        );
      }

      // Republish the method snapshot so the phone re-renders (a fresh cache hit
      // when reformatted, the same body when kept-plain). Best-effort.
      await publishMethodToAllDevices(keys, cmd.taskId, cmd.owner).catch(() => {});

      const tokens = typeof data?.usage?.total === "number" ? data.usage.total : 0;
      await announce({ status: "done", outcome, tokens });
      await ack();
      pulled += 1;
    } catch (reformatErr) {
      errors += 1;
      console.warn(
        `${LOG_PREFIX} failed to apply reformat-method command ${commandId}`,
        reformatErr instanceof Error ? reformatErr.message : String(reformatErr),
      );
      // Ack even on an unexpected throw, so a metered job never auto-retries and
      // re-bills; the phone shows an error and the user can re-tap to retry.
      await announce({ status: "error", errorReason: "failed" });
      await ack();
    }
  }
  // ── end reformat-method processing ──────────────────────────────────────

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
