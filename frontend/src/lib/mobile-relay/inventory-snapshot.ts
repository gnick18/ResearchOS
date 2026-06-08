// Mobile DOWNLOAD path, the laptop inventory publisher (barcode reorder, web half).
//
// Builds a small snapshot of the connected folder's inventory and seals it,
// once per paired phone, to that phone's X25519 key before publishing it to the
// capture relay under the "inventory" kind. The relay only ever holds the sealed
// bytes, so a phone with the matching device key is the only thing that can read
// its own snapshot. The phone uses this snapshot to resolve a scanned barcode to
// a known item before sending a reorder request back up.
//
// This mirrors today-snapshot.ts exactly; see that file + relay/scripts/
// smoke-snapshot.mjs for the full seal/openSealed round-trip contract.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { inventoryItemsApi } from "@/lib/local-api";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";

/** A single inventory item as it appears in the phone's scan-to-identify view. */
export interface SnapshotInventoryItem {
  id: number;
  name: string;
  category: string;
  vendor: string | null;
  catalog_number: string | null;
  product_barcode: string | null;
  low_at_count: number | null;
  container_label: string | null;
}

/** The decrypted shape the phone reads after openSealed. */
export interface InventorySnapshot {
  generatedAt: string;
  items: SnapshotInventoryItem[];
}

/** Reads the connected folder's inventory and builds the snapshot. */
export async function buildInventorySnapshot(): Promise<InventorySnapshot> {
  const items = await inventoryItemsApi.list();
  return {
    generatedAt: new Date().toISOString(),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      vendor: i.vendor,
      catalog_number: i.catalog_number,
      product_barcode: i.product_barcode,
      low_at_count: i.low_at_count,
      container_label: i.container_label,
    })),
  };
}

/**
 * Builds the inventory snapshot once, then seals + publishes a copy to every
 * paired phone that has an X25519 key on file. Phones registered before the
 * DOWNLOAD path landed have no seal key and are skipped (logged, not an error).
 * Returns how many were published vs skipped.
 */
export async function publishInventoryToAllDevices(
  keys: UserCaptureKeys,
): Promise<{ published: number; skipped: number }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0 };

  const snap = await buildInventorySnapshot();
  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      console.info(
        `[inventory-publisher] skip device ${device.devicePubkey.slice(0, 12)}... (no x25519 seal key)`,
      );
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(plaintext, decodePublicKey(device.x25519Pubkey));
    await publishSnapshot(keys, "inventory", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped };
}
