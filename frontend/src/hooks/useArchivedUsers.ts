"use client";

import { useQuery } from "@tanstack/react-query";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { readAllUserMetadata } from "@/lib/file-system/user-metadata";
import { readArchivedSet } from "@/lib/lab/user-archive";

export const ARCHIVED_USERS_QUERY_KEY = ["archived-users"] as const;

/**
 * Lab Head Phase 6 (lab head Phase 6 manager, 2026-05-23): cached read of
 * the archived-users set across the lab.
 *
 * Used by mention / share / assignee pickers to drop archived members
 * from their option lists. Mirrors the `useLabUserProfileMap` shape (a
 * single React-Query entry whose data is shared across every consumer
 * that subscribes), so the disk fan-out happens once per session and
 * downstream pickers just read from cache.
 *
 * Returns an empty Set on:
 *   - not-connected file-system
 *   - read error (defensive — better to show an unfiltered list than
 *     to accidentally hide an active member because of a transient FS
 *     error)
 *
 * Invalidate the query via `queryClient.invalidateQueries({ queryKey:
 * ARCHIVED_USERS_QUERY_KEY })` after a Lab Roster archive/restore
 * action so the picker reflects the change on the next render.
 */
export function useArchivedUsers(): Set<string> {
  const { isConnected } = useFileSystem();

  const { data } = useQuery({
    queryKey: ARCHIVED_USERS_QUERY_KEY,
    queryFn: async () => {
      try {
        const meta = await readAllUserMetadata();
        const usernames = Object.keys(meta);
        return await readArchivedSet(usernames);
      } catch {
        return new Set<string>();
      }
    },
    enabled: isConnected,
    staleTime: 60_000,
  });

  return data ?? new Set<string>();
}
