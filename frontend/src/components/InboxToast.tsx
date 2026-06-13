"use client";

import { useCallback, useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { imageEvents } from "@/lib/attachments/image-events";
import { type ImageSidecar, sidecarPath } from "@/lib/attachments/image-folder";
import { moveImageBetweenBases } from "@/lib/attachments/move-image";
import { resolveTaskResultsBase } from "@/lib/tasks/results-paths";
import { useAppStore } from "@/lib/store";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import InboxPanel from "./InboxPanel";

interface ToastItem {
  /** Stable id (filename — inbox filenames are unique). */
  id: string;
  filename: string;
  caption?: string;
  thumbUrl?: string;
}

const TOAST_TTL_MS = 12000;

function inboxBase(username: string): string {
  return `users/${username}/inbox`;
}

/**
 * Derive a human-readable label from an image filename when the sidecar
 * caption is missing. Strips the extension and the trailing `-<digits>`
 * batch-index suffix so e.g. "Fu-1.jpg" → "Fu". Returns null only for
 * empty input, so the caller's final "No caption" fallback still fires
 * for truly nameless files.
 *
 * Belt-and-suspenders for two cases the toast can't otherwise show a
 * caption for: (1) a brief race where attachImageToTask emits
 * `image-attached` before the caller's writeSidecar lands, and (2) the
 * per-photo /skip path that intentionally leaves caption unset.
 */
export function filenameToCaptionStem(filename: string): string | null {
  const noExt = filename.replace(/\.[^.]+$/, "");
  const stem = noExt.replace(/-\d+$/, "");
  return stem || null;
}

/**
 * Bottom-right transient toast that surfaces every new arrival in the
 * user's Telegram inbox. Each toast gives a one-click "File to active
 * experiment" button (when something's open) plus an "Open inbox" escape
 * hatch — so the edge case where a photo lands in the inbox (no popup
 * open, or popup closed mid-flight) is one click to recover from instead
 * of three.
 *
 * Auto-dismisses after a few seconds. Multiple arrivals stack.
 */
export default function InboxToast() {
  const { currentUser } = useCurrentUser();
  const activeTask = useAppStore((s) => s.activeTask);
  const [items, setItems] = useState<ToastItem[]>([]);
  const [filingId, setFilingId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    const myInbox = inboxBase(currentUser);
    const unsub = imageEvents.onAttached(async (ev) => {
      if (ev.basePath !== myInbox) return;
      const filename = ev.relativePath.replace(/^Images\//, "");
      const fullPath = `${myInbox}/Images/${filename}`;
      const sidecar = await fileService.readJson<ImageSidecar>(
        sidecarPath(myInbox, filename)
      );
      const thumbUrl = (await blobUrlResolver.getBlobUrl(fullPath)) ?? undefined;
      const item: ToastItem = {
        id: filename,
        filename,
        caption: sidecar?.caption,
        thumbUrl,
      };
      setItems((prev) => [...prev.filter((p) => p.id !== item.id), item]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((p) => p.id !== item.id));
      }, TOAST_TTL_MS);
    });
    // If something else (the inbox panel, a manual move) clears an inbox
    // file we surfaced, drop it from the toast queue too.
    const unsubDel = imageEvents.onDeleted((ev) => {
      if (ev.basePath !== myInbox) return;
      setItems((prev) => prev.filter((p) => p.id !== ev.filename));
    });
    return () => {
      unsub();
      unsubDel();
    };
  }, [currentUser]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const fileToActive = useCallback(
    async (item: ToastItem) => {
      if (!currentUser || !activeTask) return;
      setFilingId(item.id);
      try {
        const taskBase = await resolveTaskResultsBase(
          { id: activeTask.id, owner: activeTask.owner },
          currentUser
        );
        await moveImageBetweenBases(inboxBase(currentUser), taskBase, item.filename);
        // moveImageBetweenBases emits image-deleted on the inbox basePath,
        // which our subscription above turns into a queue drop — no manual
        // dismiss needed.
      } catch (err) {
        console.error("[inbox-toast] file failed", err);
        alert("Failed to file image to experiment.");
        setFilingId(null);
      }
    },
    [currentUser, activeTask]
  );

  if (!currentUser || items.length === 0) {
    return panelOpen ? <InboxPanel onClose={() => setPanelOpen(false)} /> : null;
  }

  return (
    <>
      <div className="fixed bottom-6 right-6 z-[115] flex flex-col gap-2 max-w-sm pointer-events-none">
        {items.map((item) => {
          const filing = filingId === item.id;
          return (
            <div
              key={item.id}
              className="pointer-events-auto flex items-center gap-3 p-2 pr-3 bg-surface-raised border border-amber-200 dark:border-amber-500/30 rounded-xl shadow-lg shadow-amber-100/60"
            >
              {item.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbUrl}
                  alt={item.filename}
                  className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-surface-sunken"
                />
              ) : (
                <div
                  className="w-12 h-12 rounded-lg bg-surface-sunken flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-meta font-medium text-foreground truncate">
                  {item.caption ?? filenameToCaptionStem(item.filename) ?? (
                    <span className="italic text-foreground-muted">No caption</span>
                  )}
                </p>
                <p className="text-meta text-foreground-muted">
                  Inbox — {activeTask ? `file to ${activeTask.name}?` : "no experiment open"}
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-1 flex-shrink-0">
                {activeTask ? (
                  <button
                    type="button"
                    onClick={() => void fileToActive(item)}
                    disabled={filing}
                    className="px-2 py-1 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors disabled:opacity-50"
                  >
                    {filing ? "Filing…" : "File here"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPanelOpen(true)}
                    className="px-2 py-1 text-meta text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-brand-action/15 hover:bg-blue-100 dark:hover:bg-brand-action/20 rounded-md transition-colors"
                  >
                    Open inbox
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="px-2 py-0.5 text-meta text-foreground-muted hover:text-foreground hover:bg-surface-sunken rounded-md transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {panelOpen && <InboxPanel onClose={() => setPanelOpen(false)} />}
    </>
  );
}
