"use client";

// Mobile capture relay, the inbox poller (piece D).
//
// The laptop side of the make-it-real backbone. When a folder is connected AND
// the user's identity is unlocked, this polls the capture relay on an interval
// (and on window focus), pulls each pending capture, writes it into
// users/<username>/inbox/Images, drops a sidecar, then acks it so the relay
// deletes the blob. Mirrors SharedFolderAutoRefresh: a headless component
// mounted once in the signed-in tree.
//
// Robustness: each capture is handled independently inside its own try/catch so
// one bad item never wedges the loop, and a capture is only acked AFTER it has
// landed on disk. An un-acked capture simply reappears on the next poll.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef } from "react";

import { useFileSystem } from "@/lib/file-system/file-system-context";
import { fileService } from "@/lib/file-system/file-service";
import { attachImageToTask } from "@/lib/attachments/attach-image";
import { imageEvents } from "@/lib/attachments/image-events";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import {
  ackCaptures,
  fetchInbox,
  fetchObject,
  type PendingCapture,
} from "@/lib/mobile-relay/client";
import { loadUserCaptureKeys } from "@/lib/mobile-relay/keys";

const POLL_INTERVAL_MS = 20_000;

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

function suggestedFilename(capture: PendingCapture): string {
  const ext = extForContentType(capture.contentType);
  // createdAt is ISO; keep it filename-safe and human-scannable.
  const stamp = (capture.createdAt || new Date().toISOString())
    .replace(/[:.]/g, "-")
    .replace(/[^0-9a-zA-Z-]/g, "");
  return `capture-${stamp}.${ext}`;
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

export default function CaptureInboxPoller() {
  const { currentUser, isConnected } = useFileSystem();

  // A run-lock so overlapping triggers (interval + focus) don't double-pull.
  const runningRef = useRef(false);

  useEffect(() => {
    if (!isConnected || !currentUser) return;

    let cancelled = false;

    const runOnce = async () => {
      if (cancelled || runningRef.current) return;
      runningRef.current = true;
      try {
        const keys = await loadUserCaptureKeys();
        // No unlocked identity on hand here (needs-restore state): stay dark.
        if (!keys || cancelled) return;

        let pending: PendingCapture[];
        try {
          pending = await fetchInbox(keys);
        } catch {
          // Relay unreachable / transient; try again next tick.
          return;
        }

        const basePath = `users/${currentUser}/inbox`;
        for (const capture of pending) {
          if (cancelled) return;
          try {
            const { blob } = await fetchObject(keys, capture.captureId);
            const caption = capture.caption ?? undefined;
            const result = await attachImageToTask({
              ownerUsername: currentUser,
              taskId: 0,
              basePath,
              blob,
              suggestedFilename: suggestedFilename(capture),
              altText: caption,
            });
            await writeCaptureSidecar(basePath, result.finalFilename, {
              source: "relay",
              caption,
              receivedAt: new Date().toISOString(),
            });
            // Only ack after the capture is safely on disk. If ack fails the
            // capture reappears next poll, which dedup-names to a -1 copy; the
            // common path acks cleanly so duplicates are rare.
            await ackCaptures(keys, [capture.captureId]);
          } catch (err) {
            // One bad capture must not wedge the loop; skip it this round.
            console.warn("[capture-poller] failed to import capture", err);
          }
        }
      } finally {
        runningRef.current = false;
      }
    };

    void runOnce();
    const timer = setInterval(() => void runOnce(), POLL_INTERVAL_MS);

    const onFocus = () => void runOnce();
    const onVisible = () => {
      if (document.visibilityState === "visible") void runOnce();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [currentUser, isConnected]);

  return null;
}
