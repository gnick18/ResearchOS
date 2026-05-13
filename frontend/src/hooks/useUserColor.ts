"use client";

import { useQuery } from "@tanstack/react-query";
import { readAllUserMetadata } from "@/lib/file-system/user-metadata";
import { fallbackColorForUsername } from "@/lib/colors";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export const USER_COLOR_QUERY_KEY = ["user-color-map"] as const;

/**
 * Loads the per-user color map from `users/_user_metadata.json` and keeps
 * it cached for the session. The Settings page invalidates this query when
 * the current user changes their own color, so other components re-render
 * immediately without polling the file.
 */
export function useUserColorMap(): Record<string, string> {
  const { isConnected } = useFileSystem();

  const { data } = useQuery({
    queryKey: USER_COLOR_QUERY_KEY,
    queryFn: async () => {
      const map = await readAllUserMetadata();
      const out: Record<string, string> = {};
      for (const [username, entry] of Object.entries(map)) {
        out[username] = entry.color;
      }
      return out;
    },
    enabled: isConnected,
    staleTime: Infinity,
  });

  return data ?? {};
}

/**
 * Resolve a single user's color. Returns the persisted color when known,
 * otherwise a deterministic palette pick based on the username so the
 * pre-folder login screen still gets stable per-user colors.
 */
export function useUserColor(username: string): string {
  const map = useUserColorMap();
  return map[username] ?? fallbackColorForUsername(username);
}
