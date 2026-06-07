"use client";

import { useQuery } from "@tanstack/react-query";
import { fileService } from "@/lib/file-system/file-service";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { readUserSettings } from "@/lib/settings/user-settings";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { isLabModeFolder } from "@/lib/lab/lab-mode";

export const LAB_MODE_QUERY_KEY = ["lab-mode"] as const;

/**
 * Identity model simplification, phase 2: the canonical "is this folder in lab
 * mode" hook.
 *
 * A folder is in lab mode the moment it has two or more users OR contains a lab
 * head, per `isLabModeFolder` (lib/lab/lab-mode.ts). This hook computes the
 * `{ userCount, anyLabHead }` inputs by discovering the folder's users
 * (`discoverUsers`, which already filters tombstones + sentinel dirs) and
 * reading each user's `account_type` (the LabRoster fan-out pattern), then
 * runs the pure predicate.
 *
 * ADDITIVE / not yet wired: this is the new canonical derived signal. It is
 * NOT consumed by any gating surface in this pass. Rewiring the existing
 * solo/lab consumers onto it is the deferred behavior-changing follow-up.
 *
 * Returns `undefined` while the read is in flight (or before a folder is
 * connected), so callers can suppress lab-mode chrome until the answer
 * settles. Tolerant: a missing or malformed per-user `settings.json` falls
 * back to `member` so one broken file never flips the answer.
 */
export function useIsLabMode(): boolean | undefined {
  const { isConnected } = useFileSystem();

  const { data } = useQuery({
    queryKey: LAB_MODE_QUERY_KEY,
    queryFn: async (): Promise<boolean> => {
      if (!fileService.isConnected()) return false;
      const usernames = await discoverUsers();
      // Read each user's account_type in parallel. A 404 / parse error falls
      // back to "member" so a single broken settings file can never flip the
      // lab-head signal.
      const accountTypes = await Promise.all(
        usernames.map(async (username) => {
          try {
            const settings = await readUserSettings(username);
            return settings.account_type;
          } catch {
            return "member" as const;
          }
        }),
      );
      const anyLabHead = accountTypes.some((t) => t === "lab_head");
      return isLabModeFolder({ userCount: usernames.length, anyLabHead });
    },
    enabled: isConnected,
    staleTime: Infinity,
  });

  return data;
}
