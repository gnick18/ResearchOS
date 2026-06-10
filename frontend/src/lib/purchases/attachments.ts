// Purchase attachment file I/O (PURCHASE_DOCS_AND_ROUTING.md phase 1b).
//
// The bytes live local-first as real files under the purchase's per-owner
// folder, users/<owner>/purchase_items/<id>/. The PurchaseAttachment record on
// the item (managed via the Loro field map) is just the reference. This module
// is the only place that reads/writes those files.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import type { PurchaseAttachment, PurchaseAttachmentKind } from "@/lib/types";

/** Directory holding a purchase item's attachment files. */
export function purchaseAttachmentDir(owner: string, purchaseId: number): string {
  return `users/${owner}/purchase_items/${purchaseId}`;
}

/** Make a stored filename filesystem-safe and bounded. The attachment id is
 *  prefixed by the caller, so collisions between same-named uploads cannot
 *  happen and this only needs to sanitize, not uniquify. */
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return cleaned || "document.pdf";
}

function newAttachmentId(): string {
  // crypto.randomUUID is available in secure contexts on Chrome/Edge (the only
  // browsers this app supports) and on localhost.
  return `att-${crypto.randomUUID()}`;
}

/** Write a file into the purchase's folder and return its on-record reference.
 *  Does NOT persist the reference, the caller saves it onto the PurchaseItem. */
export async function writePurchaseAttachment(
  owner: string,
  purchaseId: number,
  file: File,
  kind: PurchaseAttachmentKind,
): Promise<PurchaseAttachment> {
  const id = newAttachmentId();
  // Prefix the stored name with the id so two uploads of the same filename
  // never overwrite each other on disk.
  const stored = `${id}-${sanitizeFilename(file.name)}`;
  const path = `${purchaseAttachmentDir(owner, purchaseId)}/${stored}`;
  await fileService.writeFileFromBlob(path, file);
  return {
    id,
    filename: file.name,
    path,
    kind,
    uploaded_at: new Date().toISOString(),
    file_size: file.size,
  };
}

/** Open an attachment in a new browser tab (reads the bytes back). Returns false
 *  if the file could not be read (e.g. moved or deleted on disk). */
export async function openPurchaseAttachment(
  att: PurchaseAttachment,
): Promise<boolean> {
  const blob = await fileService.readFileAsBlob(att.path);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  // Revoke after a delay so the new tab has time to load the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Delete an attachment's file from disk. Idempotent, a missing file is fine,
 *  because removing the on-record reference is what actually matters. */
export async function deletePurchaseAttachmentFile(
  att: PurchaseAttachment,
): Promise<void> {
  try {
    await fileService.deleteFile(att.path);
  } catch {
    // ignore
  }
}

/** Human-readable file size for the UI (e.g. "12.3 KB", "1.1 MB"). */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
