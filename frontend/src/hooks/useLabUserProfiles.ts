"use client";

import { useQuery } from "@tanstack/react-query";
import { fileService } from "@/lib/file-system/file-service";
import { readAllUserMetadata } from "@/lib/file-system/user-metadata";
import {
  readUserSettings,
  type AccountType,
} from "@/lib/settings/user-settings";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export const LAB_USER_PROFILES_QUERY_KEY = ["lab-user-profiles"] as const;

/**
 * Lightweight, cross-user profile entry — just the bits comment threads
 * need today (displayName + account_type). Added in Lab Head Phase 1
 * (lab head Phase 1 manager, 2026-05-23) so comment renderers can show a
 * "PI" badge next to lab_head authors and fall back to gray when the
 * author isn't present in the metadata map (departed lab member case).
 *
 * `displayName` is read from each user's `settings.json#displayName`;
 * `null` means the user prefers their folder name as the display name.
 * `account_type` is read from the same file (Lab Head Phase 1 added the
 * field — see `frontend/src/lib/settings/user-settings.ts`).
 */
export interface LabUserProfile {
  username: string;
  displayName: string | null;
  account_type: AccountType;
}

export type LabUserProfileMap = Record<string, LabUserProfile>;

/**
 * Load the per-user profile map (displayName + account_type) for every
 * user found in `users/_user_metadata.json`. Cached for the session;
 * the Settings page's existing color-invalidation already triggers a
 * re-fetch of related queries when the active user updates their own
 * settings, but this hook's data is rarely changed mid-session so
 * `staleTime: Infinity` is fine.
 *
 * Tolerance: a missing or malformed `settings.json` per user falls back
 * to `{ displayName: null, account_type: "member" }`. Never throws.
 */
export function useLabUserProfileMap(): LabUserProfileMap {
  const { isConnected } = useFileSystem();

  const { data } = useQuery({
    queryKey: LAB_USER_PROFILES_QUERY_KEY,
    queryFn: async () => {
      if (!fileService.isConnected()) return {} as LabUserProfileMap;
      const meta = await readAllUserMetadata();
      // Exclude soft-deleted (tombstoned) accounts. A username with
      // `deleted_at` set in _user_metadata.json is a deleted account whose
      // folder still lives on disk (e.g. it persists in OneDrive). The
      // active-profile map must skip them so deleted test/old accounts don't
      // leak into rosters like Trainee notes & goals. Archived/deleted users
      // have their own surface (useArchivedUsers).
      const usernames = Object.keys(meta).filter((u) => !meta[u]?.deleted_at);
      const out: LabUserProfileMap = {};
      // Read each user's settings.json in parallel. A 404 / parse error
      // falls back to the safe default below so a single broken settings
      // file can never poison the whole map.
      const entries = await Promise.all(
        usernames.map(async (username) => {
          try {
            const settings = await readUserSettings(username);
            const entry: LabUserProfile = {
              username,
              displayName: settings.displayName,
              account_type: settings.account_type,
            };
            return [username, entry] as const;
          } catch {
            const fallback: LabUserProfile = {
              username,
              displayName: null,
              account_type: "member",
            };
            return [username, fallback] as const;
          }
        }),
      );
      for (const [username, entry] of entries) {
        out[username] = entry;
      }
      return out;
    },
    enabled: isConnected,
    staleTime: Infinity,
  });

  return data ?? {};
}
