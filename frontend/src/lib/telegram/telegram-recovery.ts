// Decision layer for the IDB-token recovery prompt. Pure(-ish) — takes the
// cached payload + a `getMe` callable and returns a discriminated union
// describing what the UI should do. Factored out from the React component
// so the security-manager-pinned 401 / 403 / 5xx / network branches are
// unit-testable without spinning up a DOM.
//
// SENSITIVE: see SECURITY_AUDIT.md §1.3 for the threat model behind the
// "validate-before-offer" tightening. The 401 / 403 path SILENTLY drops
// the cache because a revoked token would dead-end the user; the 5xx /
// network path KEEPS the cache so a Cloudflare hiccup at api.telegram.org
// can't wipe the recovery path.

import { TelegramApiError, type TelegramBotInfo } from "./telegram-client";
import type { CachedTelegramToken } from "./telegram-token-cache";

export type RecoveryDecision =
  /** No cache for this {folder, user}, or disk already has a pairing. */
  | { kind: "none" }
  /**
   * Cache exists but the token is revoked (Telegram returned 401 / 403 to
   * getMe). The caller MUST drop the cache for this {folder, user} so the
   * predicate flips to "none" on next check, and MUST NOT render a prompt.
   */
  | { kind: "drop"; reason: "revoked"; cached: CachedTelegramToken }
  /** Validated cache; render the recovery prompt with bot info attached. */
  | { kind: "show"; cached: CachedTelegramToken; botInfo: TelegramBotInfo }
  /**
   * Offline mode is on. Render the prompt but disable the Reconnect CTA
   * (the user has opted out of outbound network, so we don't probe
   * getMe — we trust the cache is fine to show, and the CTA tooltip
   * tells them how to act).
   */
  | { kind: "showOffline"; cached: CachedTelegramToken }
  /**
   * Transient failure (5xx / network / timeout). Keep the cache and
   * render a retry state so a single Cloudflare blip doesn't wipe the
   * recovery path forever.
   */
  | { kind: "retry"; cached: CachedTelegramToken };

interface DecideRecoveryOpts {
  /** Result of `readTelegramTokenCache(folder, user)` — null if no cache. */
  cached: CachedTelegramToken | null;
  /** True when the user's offline-mode setting is on. */
  offlineMode: boolean;
  /** Injected `getMe` so this function stays pure / mock-friendly in tests. */
  getMe: (token: string) => Promise<TelegramBotInfo>;
}

export async function decideRecovery(
  opts: DecideRecoveryOpts,
): Promise<RecoveryDecision> {
  if (!opts.cached) return { kind: "none" };

  if (opts.offlineMode) {
    // Don't run getMe — offline mode means no outbound. Show the prompt
    // with the CTA disabled per constraint [10].
    return { kind: "showOffline", cached: opts.cached };
  }

  try {
    const botInfo = await opts.getMe(opts.cached.botToken);
    return { kind: "show", cached: opts.cached, botInfo };
  } catch (err) {
    if (err instanceof TelegramApiError && (err.code === 401 || err.code === 403)) {
      // Revoked. Silently drop the cache; no prompt.
      return { kind: "drop", reason: "revoked", cached: opts.cached };
    }
    // 5xx / network / timeout / anything else. Keep the cache, show retry.
    return { kind: "retry", cached: opts.cached };
  }
}
