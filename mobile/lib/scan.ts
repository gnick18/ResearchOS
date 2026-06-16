// Scan-flow actions and snapshot shapes (mobile). The receiving/inventory loop
// uploads device-signed "action" captures over the same relay the bench photo,
// quick note, and reorder use. Each action is a small UTF-8 JSON body with a
// dedicated contentType the laptop poller recognizes and applies to the real
// data (see docs/proposals/MOBILE_SCAN_FLOW.md for the contract). The phone also
// reads an extended inventory snapshot (trackedStocks + recentPurchases +
// barcodeIndex) the laptop publishes. Every snapshot field is tolerated missing
// so an older laptop shape never crashes the screen. House style: no em-dashes,
// no emojis, no mid-sentence colons.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/curves/utils.js';

import type { Pairing } from '@/lib/pairing';
import { captureUploadMessage } from '@/lib/captures';
import { fireSuccess } from '@/lib/success-burst';

// ---------------------------------------------------------------------------
// Action contentTypes (must match the laptop poll handlers exactly)
// ---------------------------------------------------------------------------
export const ACTION = {
  markArrived: 'application/x-researchos-mark-arrived',
  registerTracker: 'application/x-researchos-register-tracker',
  deduct: 'application/x-researchos-deduct',
  reorder: 'application/x-researchos-reorder',
  // Create paths from a scan. createPurchase is the task-less purchase intake
  // (a data-shape decision flagged to Grant); createInventory adds a stock with
  // no purchase record. Both prefilled from the barcode autopopulate, confirmed.
  createPurchase: 'application/x-researchos-create-purchase',
  createInventory: 'application/x-researchos-create-inventory',
} as const;

// ---------------------------------------------------------------------------
// Extended inventory snapshot shapes (laptop publishes, phone reads)
// ---------------------------------------------------------------------------

// A reagent the lab is tracking by barcode with a units ledger. Produced for
// every InventoryStock that has both a product_barcode and units_per_scan set.
export type TrackedStock = {
  stockId?: number | string;
  itemName?: string;
  vendor?: string | null;
  productBarcode?: string | null;
  unitsPerScan?: number;
  unitsRemaining?: number;
  unitLabel?: string | null;
  lowAtCount?: number | null;
  purchaseItemId?: number | string | null;
  totalUnits?: number;
  // Free-text physical location of this stock ("-80 door, left"), from the
  // laptop's InventoryStock.location_text. Spatial inventory Phase A. Tolerated
  // missing so an older laptop snapshot never crashes the row.
  location?: string | null;
  // Structured location path resolved from the laptop's StorageNode box-finder
  // tree ("-80 #2 > Box: Q5 - A1"). Spatial inventory Phase B bridge. Preferred
  // over `location` for display when present; tolerated missing.
  locationPath?: string | null;
};

// A purchase that has been ordered but not yet marked arrived. Drives the
// "which recent order is this?" match step.
export type RecentPurchase = {
  purchaseItemId?: number | string;
  name?: string;
  vendor?: string | null;
  orderedDate?: string | null;
  catalog?: string | null;
  productBarcode?: string | null;
};

// Best-effort product guess for a barcode, drawn from past purchases/stocks.
export type BarcodeIndexEntry = {
  name?: string;
  vendor?: string | null;
  catalog?: string | null;
};

// One inventory item in the legacy snapshot list (the reorder screen reads this).
export type InventoryItem = {
  id?: number;
  name?: string;
  category?: string;
  vendor?: string | null;
  catalog_number?: string | null;
  product_barcode?: string | null;
  low_at_count?: number | null;
  container_label?: string | null;
};

export type InventorySnapshot = {
  generatedAt?: string;
  items?: InventoryItem[];
  trackedStocks?: TrackedStock[];
  recentPurchases?: RecentPurchase[];
  barcodeIndex?: Record<string, BarcodeIndexEntry>;
};

// ---------------------------------------------------------------------------
// Action payloads
// ---------------------------------------------------------------------------
export type MarkArrivedPayload = { purchaseItemId: number | string };
export type RegisterTrackerPayload = {
  stockId?: number | string;
  purchaseItemId?: number | string;
  productBarcode: string;
  unitsPerScan: number;
  totalUnits: number;
  unitLabel: string;
  // Spatial inventory Phase A: free-text location captured at scan-in ("-80 door").
  location?: string;
};
export type DeductPayload = {
  stockId?: number | string;
  productBarcode?: string;
  amount: number;
};
export type ReorderActionPayload = { purchaseItemId: number | string };
// Prefilled from the barcode autopopulate, the user confirmed before saving.
// Tracking fields are bundled in (create + register in one action) because the
// phone has no new record id to chain a separate register call to. When they are
// absent the laptop just creates the record without tracking.
export type CreatePayload = {
  name: string;
  vendor?: string | null;
  catalog?: string | null;
  productBarcode?: string;
  quantity?: number;
  unitsPerScan?: number;
  totalUnits?: number;
  unitLabel?: string;
  // Spatial inventory Phase A: free-text location captured at scan-in ("-80 door").
  location?: string;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Upload plumbing (mirrors reorder.ts / notes.ts / captures.ts)
// ---------------------------------------------------------------------------
let idCounter = 0;
function makeActionId(): string {
  idCounter += 1;
  return `action_${Date.now().toString(36)}_${idCounter}`;
}

// Encode UTF-8 bytes to base64 without btoa (absent in the RN runtime). The
// data: uri FormData approach lets the runtime send non-empty JSON bytes
// reliably. Mirrors the helper in notes.ts and reorder.ts.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

// Upload one action to the relay. Encodes the payload as UTF-8 JSON, hashes it,
// signs the canonical upload message with the device key, and POSTs multipart to
// ${relayUrl}/capture/upload exactly like a photo, note, or reorder. The caption
// is a short human label so the laptop has a readable line without parsing JSON.
async function uploadAction(
  contentType: string,
  payload: unknown,
  caption: string,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<ActionResult> {
  try {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    if (bytes.length === 0) return { ok: false, error: 'Nothing to send.' };

    const shaHex = bytesToHex(sha256(bytes));
    const captureId = makeActionId();
    const createdAt = new Date().toISOString();

    const message = captureUploadMessage(pairing.u, captureId, createdAt, shaHex);
    const sig = await deviceSign(message);

    const form = new FormData();
    const dataUri = `data:${contentType};base64,${bytesToBase64(bytes)}`;
    form.append('blob', {
      uri: dataUri,
      name: 'action.json',
      type: contentType,
    } as unknown as Blob);
    form.append(
      'meta',
      JSON.stringify({
        u: pairing.u,
        devicePubkey: pairing.devicePubkey,
        captureId,
        caption: caption.trim(),
        createdAt,
        contentType,
        sig,
      }),
    );

    const base = pairing.relayUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/capture/upload`, { method: 'POST', body: form });
    const resBody = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!res.ok || resBody.ok !== true) {
      return {
        ok: false,
        error: `Send failed (status ${res.status})${resBody.error ? ` ${resBody.error}` : ''}`,
      };
    }
    fireSuccess({ subtitle: caption ? caption.slice(0, 60) : undefined });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not reach your lab.',
    };
  }
}

// ---------------------------------------------------------------------------
// Typed action wrappers
// ---------------------------------------------------------------------------
export function markArrived(
  payload: MarkArrivedPayload,
  caption: string,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<ActionResult> {
  return uploadAction(ACTION.markArrived, payload, caption, pairing, deviceSign);
}

export function registerTracker(
  payload: RegisterTrackerPayload,
  caption: string,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<ActionResult> {
  return uploadAction(ACTION.registerTracker, payload, caption, pairing, deviceSign);
}

export function deductUnits(
  payload: DeductPayload,
  caption: string,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<ActionResult> {
  return uploadAction(ACTION.deduct, payload, caption, pairing, deviceSign);
}

export function reorderFromPurchase(
  payload: ReorderActionPayload,
  caption: string,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<ActionResult> {
  return uploadAction(ACTION.reorder, payload, caption, pairing, deviceSign);
}

export function createPurchase(
  payload: CreatePayload,
  caption: string,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<ActionResult> {
  return uploadAction(ACTION.createPurchase, payload, caption, pairing, deviceSign);
}

export function createInventory(
  payload: CreatePayload,
  caption: string,
  pairing: Pairing,
  deviceSign: (message: string) => Promise<string>,
): Promise<ActionResult> {
  return uploadAction(ACTION.createInventory, payload, caption, pairing, deviceSign);
}
