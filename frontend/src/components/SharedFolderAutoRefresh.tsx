"use client";

import { useEffect } from "react";
import { appQueryClient } from "@/lib/query-client";
import { fileService } from "@/lib/file-system/file-service";

/**
 * Auto-refresh the app when the connected data folder changes on disk.
 *
 * ResearchOS is local-first: there is no central server to push "something
 * changed" events the way Google Drive / Docs do. The source of truth is the
 * shared folder, and a collaborator's change (a new note, task, project, etc.)
 * reaches you as a FILE appearing in that folder (instantly on a shared machine
 * or network drive, after sync on Box / Dropbox). So the local-first equivalent
 * of a server push is to WATCH THE FOLDER.
 *
 * Primary mechanism: a FileSystemObserver (Chrome 129+) on the data folder.
 * On any file change we invalidate the React Query caches, so the UI reflects
 * it without a manual refresh. The whole app benefits from one integration
 * because every entity (notes, tasks, projects, sequences) is just files.
 *
 * Fallback: when FileSystemObserver is unavailable, refetch on window focus
 * instead (the app disables refetchOnWindowFocus by default, so this is opt-in
 * and only the fallback path turns it on).
 *
 * Self-write note: the observer fires on the local user's OWN writes too (e.g.
 * every autosave commit). The invalidate is debounced (~1s) so a burst of own
 * writes coalesces into a single refetch when editing pauses, and a refetch
 * with staleTime 0 is silent when the data is unchanged. Future refinement
 * could diff the changed paths and invalidate only the affected query keys.
 *
 * Mounted only in the signed-in tree (see lib/providers.tsx). No-op when no
 * folder handle is available. No em-dashes, no emojis, no mid-sentence colons.
 */

// Minimal ambient shape for FileSystemObserver (not yet in the TS DOM lib).
interface FileSystemObserverLike {
  observe(
    handle: FileSystemDirectoryHandle,
    options?: { recursive?: boolean },
  ): Promise<void>;
  disconnect(): void;
}
type FileSystemObserverCtor = new (
  callback: (records: unknown[], observer: FileSystemObserverLike) => void,
) => FileSystemObserverLike;

const DEBOUNCE_MS = 1000;

export default function SharedFolderAutoRefresh() {
  useEffect(() => {
    let cancelled = false;
    let observer: FileSystemObserverLike | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const invalidate = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!cancelled) void appQueryClient.invalidateQueries();
      }, DEBOUNCE_MS);
    };

    const Ctor = (
      globalThis as { FileSystemObserver?: FileSystemObserverCtor }
    ).FileSystemObserver;
    const handle = fileService.getDirectoryHandle();

    // Focus fallback, used only when the observer is unavailable.
    const onFocus = () => invalidate();
    const onVisible = () => {
      if (document.visibilityState === "visible") invalidate();
    };

    if (Ctor && handle) {
      try {
        observer = new Ctor(() => {
          if (!cancelled) invalidate();
        });
        // observe() can reject (permission lost, unsupported FS); fall back.
        void observer.observe(handle, { recursive: true }).catch((err) => {
          console.warn(
            "[auto-refresh] folder observe failed; using focus fallback",
            err,
          );
          observer = null;
          window.addEventListener("focus", onFocus);
          document.addEventListener("visibilitychange", onVisible);
        });
      } catch (err) {
        console.warn(
          "[auto-refresh] FileSystemObserver unavailable; using focus fallback",
          err,
        );
        observer = null;
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisible);
      }
    } else {
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisible);
    }

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      if (observer) {
        try {
          observer.disconnect();
        } catch {
          // Already gone; nothing to do.
        }
      }
    };
  }, []);

  return null;
}
