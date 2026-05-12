"use client";

import { useCallback, useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import { imageEvents } from "@/lib/attachments/image-events";
import { listImagesInFolder, type FolderImageEntry, sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import { resolveTaskResultsBase } from "@/lib/tasks/results-paths";
import { useAppStore, type ActiveTask } from "@/lib/store";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface InboxPanelProps {
  onClose: () => void;
}

interface InboxEntry extends FolderImageEntry {
  blobUrl?: string;
}

function inboxBase(username: string): string {
  return `users/${username}/inbox`;
}

export default function InboxPanel({ onClose }: InboxPanelProps) {
  const { currentUser } = useCurrentUser();
  const activeTask = useAppStore((s) => s.activeTask);
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const raw = await listImagesInFolder(inboxBase(currentUser));
      const withUrls: InboxEntry[] = [];
      for (const e of raw) {
        const fullPath = `${inboxBase(currentUser)}/Images/${e.name}`;
        const blobUrl = (await blobUrlResolver.getBlobUrl(fullPath)) ?? undefined;
        withUrls.push({ ...e, blobUrl });
      }
      setEntries(withUrls);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const moveToActive = useCallback(
    async (entry: InboxEntry, task: ActiveTask) => {
      if (!currentUser) return;
      setBusy(entry.name);
      try {
        const inbox = inboxBase(currentUser);
        const srcPath = `${inbox}/Images/${entry.name}`;
        const srcSidecar = sidecarPath(inbox, entry.name);

        const taskBase = await resolveTaskResultsBase(
          { id: task.id, owner: task.owner },
          currentUser
        );
        const destPath = `${taskBase}/Images/${entry.name}`;
        const destSidecar = sidecarPath(taskBase, entry.name);

        const blob = await fileService.readFileAsBlob(srcPath);
        if (!blob) throw new Error("Source image not found");
        await fileService.writeFileFromBlob(destPath, blob);

        const existingSidecar = await fileService.readJson<ImageSidecar>(srcSidecar);
        if (existingSidecar) {
          await fileService.writeJson(destSidecar, existingSidecar);
        }

        await fileService.deleteFile(srcPath);
        await fileService.deleteFile(srcSidecar);
        blobUrlResolver.revokePath(srcPath);

        imageEvents.emitAttached({ basePath: taskBase, relativePath: `Images/${entry.name}` });
        imageEvents.emitDeleted({ basePath: inbox, filename: entry.name });
        await refresh();
      } catch (err) {
        console.error("[inbox] move failed", err);
        alert("Failed to move image to experiment.");
      } finally {
        setBusy(null);
      }
    },
    [currentUser, refresh]
  );

  const deleteInbox = useCallback(
    async (entry: InboxEntry) => {
      if (!currentUser) return;
      const ok = window.confirm(`Delete "${entry.name}" from your inbox?`);
      if (!ok) return;
      setBusy(entry.name);
      try {
        const inbox = inboxBase(currentUser);
        await fileService.deleteFile(`${inbox}/Images/${entry.name}`);
        await fileService.deleteFile(sidecarPath(inbox, entry.name));
        blobUrlResolver.revokePath(`${inbox}/Images/${entry.name}`);
        imageEvents.emitDeleted({ basePath: inbox, filename: entry.name });
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [currentUser, refresh]
  );

  return (
    <div
      className="fixed inset-0 z-[105] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">📥</span>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Inbox</h3>
              <p className="text-xs text-gray-500">
                Photos sent via Telegram while no experiment was open.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-8">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-8">
              Inbox is empty. Photos sent via Telegram while no experiment is open will
              appear here.
            </p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => {
                const caption = entry.sidecar?.caption;
                return (
                  <li
                    key={entry.name}
                    className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 hover:border-gray-200"
                  >
                    {entry.blobUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.blobUrl}
                        alt={entry.name}
                        className="w-16 h-16 rounded object-cover bg-gray-100 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded bg-gray-100 flex items-center justify-center text-gray-300 text-2xl flex-shrink-0">
                        🖼
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate" title={entry.name}>
                        {caption ?? <span className="italic text-gray-400">No caption</span>}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{entry.name}</p>
                      {entry.sidecar?.receivedAt && (
                        <p className="text-xs text-gray-400">
                          {new Date(entry.sidecar.receivedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!activeTask || busy === entry.name}
                        onClick={() => activeTask && moveToActive(entry, activeTask)}
                        title={
                          activeTask
                            ? `Move to Experiment ${activeTask.id} (${activeTask.name})`
                            : "Open an experiment first"
                        }
                        className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Move to active
                      </button>
                      <button
                        type="button"
                        disabled={busy === entry.name}
                        onClick={() => deleteInbox(entry)}
                        className="px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
