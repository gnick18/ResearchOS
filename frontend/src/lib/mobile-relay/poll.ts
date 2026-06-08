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
//   anything else logged and SKIPPED (not acked, so nothing is lost, the relay
//                 keeps it and a future build can handle it).
//
// Robustness: each capture is handled inside its own try/catch so one bad item
// never wedges the loop, and a capture is only acked AFTER it has landed on
// disk. An un-acked capture simply reappears on the next poll.
//
// Observability: every step logs a `[capture-poller]` line so the console tells
// the whole story (poll start, pending count, per-item import, write path, ack,
// and errors with status / message).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
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

const LOG_PREFIX = "[capture-poller]";

/** Coarse category a capture is routed by, derived from its content type. */
export type CaptureKind = "image" | "text" | "other";

/**
 * Classify a capture content type into the branch that handles it. Pure +
 * exported so the routing can be unit tested without any relay / file mocking.
 * Matching is case-insensitive and tolerant of charset suffixes
 * (e.g. "text/markdown; charset=utf-8").
 */
export function classifyCapture(contentType: string | null | undefined): CaptureKind {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("text/")) return "text";
  return "other";
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

      // Only ack after the capture is safely on disk. If ack fails the capture
      // reappears next poll, which dedup-names images to a -1 copy; the common
      // path acks cleanly so duplicates are rare.
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

  return { pulled, errors };
}
