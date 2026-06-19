"use client";

import { useQuery } from "@tanstack/react-query";
import { fileService } from "@/lib/file-system/file-service";
import { discoverRealLocalUsers } from "@/lib/file-system/user-discovery";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export const MULTI_USER_FOLDER_QUERY_KEY = ["multi-user-folder"] as const;

/**
 * Whether the connected folder genuinely holds two or more human users.
 *
 * This is deliberately NARROWER than `useIsLabMode`: lab mode is true the moment
 * a folder has 2+ users OR contains a lab head (the login-gating predicate), so
 * a brand-new SOLO lab head (one user, account_type lab_head) is in lab mode but
 * is NOT multi-user. The migrate-to-solo gate keys off THIS hook, because a solo
 * PI has no other users to package out and must never be nagged to "convert this
 * folder to mine".
 *
 * Counts via `discoverRealLocalUsers`, which filters the reserved sentinel dirs
 * (public, lab), tombstoned users, AND materialized co-members. The last
 * exclusion is the multi-lab Task C fix: when LAB_AS_FOLDER_ENABLED is on, the
 * roster materialize writes the head + co-members of someone else's lab into a
 * member's OWN folder as cached identities. Counting those (as plain
 * `discoverUsers` does) made a lone member of another person's lab look
 * "multi-user", so the migrate-to-solo gate wrongly fired and offered to package
 * out / trash cached co-members. Excluding materialized co-members means the gate
 * fires only for a folder with genuine co-located humans, while a lone member
 * resolves to just themselves (one real user, gate stays closed). This does NOT
 * lock anyone out: the gate is purely a nudge and still has its own escape
 * hatches; the narrower count simply stops nagging a member who has nothing to
 * split.
 *
 * Returns `undefined` while the read is in flight (or before a folder is
 * connected) so callers can suppress chrome until the answer settles.
 *
 * House style: no emojis, no em-dashes, no mid-sentence colons.
 */
export function useIsMultiUserFolder(): boolean | undefined {
  const { isConnected } = useFileSystem();

  const { data } = useQuery({
    queryKey: MULTI_USER_FOLDER_QUERY_KEY,
    queryFn: async (): Promise<boolean> => {
      if (!fileService.isConnected()) return false;
      const usernames = await discoverRealLocalUsers();
      return usernames.length >= 2;
    },
    enabled: isConnected,
    staleTime: Infinity,
  });

  return data;
}
