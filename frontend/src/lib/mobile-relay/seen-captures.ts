// Mobile capture idempotency ledger (audit fix-bot, reorder-queue).
//
// The poller acks a capture only AFTER it has landed on disk. If the ack
// fails (transient relay error, tab closed mid-flight) the capture reappears
// on the next poll and the destination write runs a second time, which for a
// reorder or a text note means a DUPLICATE record. Images dedup-name to a
// "-1" copy, but purchases and notes have no such guard.
//
// This sidecar closes that hole regardless of destination. It records every
// captureId we have successfully landed, written BEFORE the ack, so a later
// poll that sees the same captureId can skip the write entirely. The file
// lives alongside the rest of the relay's landing data under the user's inbox
// dir, hidden by a leading dot so it never renders as a user file.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";

/** Hidden ledger filename under the user's inbox (relay data) dir. */
const SEEN_CAPTURES_FILE = ".seen_captures.json";

/**
 * Upper bound on retained captureIds. Acked captures are dropped by the relay
 * and never reappear, so the ledger only needs enough history to cover the
 * window between a failed ack and the retry that cleans it up. We keep a
 * generous tail and trim the oldest beyond it so the file cannot grow without
 * bound over the lifetime of a folder.
 */
const MAX_RETAINED = 2000;

/** On-disk shape. Versioned so a future format change can migrate cleanly. */
interface SeenCapturesSidecar {
  version: 1;
  /** captureIds in insertion order (oldest first). */
  captureIds: string[];
}

/** Path to the idempotency ledger for `currentUser`. */
export function seenCapturesPath(currentUser: string): string {
  return `users/${currentUser}/inbox/${SEEN_CAPTURES_FILE}`;
}

/**
 * Load the set of captureIds already landed for `currentUser`. A missing or
 * malformed file reads as an empty set (fileService.readJson already returns
 * null for both), so the caller never has to special-case a fresh folder.
 */
export async function loadSeenCaptures(currentUser: string): Promise<Set<string>> {
  const data = await fileService.readJson<SeenCapturesSidecar>(
    seenCapturesPath(currentUser),
  );
  if (!data || !Array.isArray(data.captureIds)) return new Set();
  return new Set(data.captureIds.filter((id) => typeof id === "string"));
}

/**
 * Record `captureId` as landed and persist the ledger. Mutates `seen` in place
 * (so the running poll loop sees it immediately) and writes the trimmed list
 * to disk. Call this BEFORE acking the capture so an ack failure cannot cause
 * a re-create on the next poll.
 */
export async function markCaptureSeen(
  currentUser: string,
  seen: Set<string>,
  captureId: string,
): Promise<void> {
  seen.add(captureId);
  // Keep insertion order, trim the oldest beyond the cap.
  const ids = [...seen].slice(-MAX_RETAINED);
  const sidecar: SeenCapturesSidecar = { version: 1, captureIds: ids };
  await fileService.writeJson(seenCapturesPath(currentUser), sidecar);
}
