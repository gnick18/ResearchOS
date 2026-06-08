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
import { notesApi } from "@/lib/local-api";
import { attachImageToTask } from "@/lib/attachments/attach-image";
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

const LOG_PREFIX = "[capture-poller]";

/** Coarse category a capture is routed by, derived from its content type. */
export type CaptureKind = "image" | "text" | "reorder" | "other";

/** The barcode-reorder content type the phone sends a reorder request as. */
const REORDER_CONTENT_TYPE = "application/x-researchos-reorder";

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

/**
 * Classify a capture content type into the branch that handles it. Pure +
 * exported so the routing can be unit tested without any relay / file mocking.
 * Matching is case-insensitive and tolerant of charset suffixes
 * (e.g. "text/markdown; charset=utf-8").
 */
export function classifyCapture(contentType: string | null | undefined): CaptureKind {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("image/")) return "image";
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
      // Unknown type. Do NOT ack, nothing is lost and a future build can route
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
