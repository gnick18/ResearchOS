"use client";

import { useQuery } from "@tanstack/react-query";
import { readAllUserMetadata } from "@/lib/file-system/user-metadata";
import { fallbackColorForUsername } from "@/lib/colors";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export const USER_COLOR_QUERY_KEY = ["user-color-map"] as const;

export interface UserColors {
  /** Primary swatch — always present. */
  primary: string;
  /** Optional second swatch. When null/undefined the user renders as solid. */
  secondary: string | null;
}

export type UserColorMap = Record<string, UserColors>;

/**
 * Loads the per-user color map (primary + optional secondary) from
 * `users/_user_metadata.json` and keeps it cached for the session. The
 * Settings page invalidates this query when the current user changes
 * their own color, so other components re-render immediately without
 * polling the file.
 *
 * SELF override (avatar color as a cloud user setting): the signed-in user's own
 * color comes from the account-scoped E2E blob, so it follows the account across
 * folders + devices, while OTHER users stay sourced from the folder roster (their
 * color is not this account's to own and the blob is readable only by its owner).
 * Flag-guarded (account settings) and best-effort, so with the flag off or no
 * identity unlocked the map is byte-identical to the roster-only behavior.
 * `currentUser` is part of the query key so a user switch re-resolves the
 * override; prefix invalidation of USER_COLOR_QUERY_KEY still matches.
 */
export function useUserColorMap(): UserColorMap {
  const { isConnected, currentUser } = useFileSystem();

  const { data } = useQuery({
    queryKey: [...USER_COLOR_QUERY_KEY, currentUser ?? null],
    queryFn: async () => {
      const map = await readAllUserMetadata();
      const out: UserColorMap = {};
      for (const [username, entry] of Object.entries(map)) {
        out[username] = {
          primary: entry.color,
          secondary: entry.color_secondary ?? null,
        };
      }
      if (currentUser) {
        try {
          const { isAccountSettingsEnabled } = await import(
            "@/lib/account/account-settings-config"
          );
          if (isAccountSettingsEnabled()) {
            const { fetchAccountSettings } = await import(
              "@/lib/account/account-settings"
            );
            const account = await fetchAccountSettings();
            // Only override when the account actually carries a color (a null
            // means the user never set one, so the roster value stays).
            if (account && account.color != null) {
              out[currentUser] = {
                primary: account.color,
                secondary: account.colorSecondary ?? null,
              };
            }
          }
        } catch {
          // Account layer unavailable: keep the roster value for the self user.
        }
      }
      return out;
    },
    enabled: isConnected,
    staleTime: Infinity,
  });

  return data ?? {};
}

/**
 * Resolve a single user's color pair. Returns the persisted entry when
 * known, otherwise a deterministic palette pick based on the username so
 * the pre-folder login screen still gets stable per-user colors. Auto-
 * assigned users never get a secondary (gradients are opt-in via Settings).
 */
export function useUserColors(username: string): UserColors {
  const map = useUserColorMap();
  return map[username] ?? { primary: fallbackColorForUsername(username), secondary: null };
}

/**
 * Backwards-compatible single-color accessor. Callers that only need the
 * primary swatch (e.g. legacy avatar-gradient generators that derive their
 * own second stop from one hue) keep working unchanged. New callers that
 * want to honor a user's opt-in gradient should use `useUserColors`.
 */
export function useUserColor(username: string): string {
  return useUserColors(username).primary;
}
