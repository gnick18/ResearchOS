"use client";

import { useEffect } from "react";
import { getUpdates, TelegramApiError } from "./telegram-client";
import { readPairing, updateLastUpdateId } from "./telegram-store";
import { routeTelegramMessage } from "./image-router";
import { routeBatchCallbackQuery } from "./batch-routing";
import { setPollingHealth } from "./telegram-runtime";
import { isStaleState, setStaleSignal } from "./staleness";

const TAB_LOCK_KEY = "telegram-poller-tab";
const HEARTBEAT_MS = 5000;
const STALE_MS = 15000;

interface TabLock {
  tabId: string;
  ts: number;
}

function readLock(): TabLock | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(TAB_LOCK_KEY) : null;
    if (!raw) return null;
    return JSON.parse(raw) as TabLock;
  } catch {
    return null;
  }
}

function writeLock(tabId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ tabId, ts: Date.now() }));
}

function tryClaimLock(tabId: string): boolean {
  const existing = readLock();
  if (!existing) {
    writeLock(tabId);
    return true;
  }
  if (existing.tabId === tabId) {
    writeLock(tabId);
    return true;
  }
  if (Date.now() - existing.ts > STALE_MS) {
    writeLock(tabId);
    return true;
  }
  return false;
}

function releaseLock(tabId: string): void {
  const existing = readLock();
  if (existing?.tabId === tabId && typeof localStorage !== "undefined") {
    localStorage.removeItem(TAB_LOCK_KEY);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Long-polls Telegram for new messages in the paired chat and routes each
 * incoming photo to the active task (or the user's inbox). Runs only while
 * the calling tab holds the cross-tab lock, so multiple ResearchOS tabs
 * don't fight over the same `getUpdates` cursor.
 */
export function useTelegramPolling(username: string | null): void {
  useEffect(() => {
    if (!username) {
      setPollingHealth("idle");
      return;
    }

    let cancelled = false;
    const tabId = Math.random().toString(36).slice(2);
    const controller = new AbortController();
    const mountedAt = Date.now();
    // Stale-detection state lives here (not in React state) so the
    // polling loop can mutate without re-rendering and the broadcast
    // signal is the only thing UI subscribes to.
    let consecutiveEmptyPolls = 0;
    let lastUpdateAt: number | null = null;

    const publishStaleness = (sidecarExists: boolean, botUsername: string | null): void => {
      const stale = isStaleState({
        consecutiveEmptyPolls,
        lastUpdateAt,
        mountedAt,
        sidecarExists,
      });
      setStaleSignal({ isStale: stale, botUsername: stale ? botUsername : null });
    };

    const heartbeat = window.setInterval(() => {
      tryClaimLock(tabId);
    }, HEARTBEAT_MS);

    void (async () => {
      let backoffMs = 1000;
      while (!cancelled) {
        const pairing = await readPairing(username);
        if (!pairing) {
          setPollingHealth("idle");
          // No sidecar → staleness check short-circuits. Reset
          // counters so a future re-pair starts clean.
          consecutiveEmptyPolls = 0;
          lastUpdateAt = null;
          publishStaleness(false, null);
          await sleep(2500);
          continue;
        }
        if (!tryClaimLock(tabId)) {
          setPollingHealth("idle");
          await sleep(HEARTBEAT_MS);
          continue;
        }
        try {
          const updates = await getUpdates(pairing.botToken, {
            offset: pairing.lastUpdateId + 1,
            timeout: 25,
            signal: controller.signal,
          });
          if (cancelled) return;
          if (updates.length === 0) {
            consecutiveEmptyPolls += 1;
          } else {
            consecutiveEmptyPolls = 0;
            lastUpdateAt = Date.now();
          }
          publishStaleness(true, pairing.botUsername);
          let maxId = pairing.lastUpdateId;
          for (const update of updates) {
            if (update.message) {
              try {
                await routeTelegramMessage(update.message, {
                  username,
                  botToken: pairing.botToken,
                  chatId: pairing.chatId,
                });
              } catch (err) {
                console.error("[telegram-poll] route failed", err);
              }
            }
            if (update.callback_query) {
              // Inline-keyboard click. Only batch-routing emits these
              // today (destination + caption-style pickers). Errors are
              // swallowed so a failed callback ack doesn't poison the
              // poll cursor — the user can re-click.
              try {
                await routeBatchCallbackQuery(update.callback_query, {
                  username,
                  botToken: pairing.botToken,
                  chatId: pairing.chatId,
                });
              } catch (err) {
                console.error("[telegram-poll] callback failed", err);
              }
            }
            if (update.update_id > maxId) maxId = update.update_id;
          }
          if (maxId > pairing.lastUpdateId) {
            await updateLastUpdateId(username, maxId);
          }
          backoffMs = 1000;
          setPollingHealth("ok");
        } catch (err) {
          if (cancelled) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (err instanceof TelegramApiError && err.code === 401) {
            console.warn("[telegram-poll] token rejected (401); user must re-pair");
            setPollingHealth("auth_error");
            await sleep(30000);
            continue;
          }
          if (err instanceof TelegramApiError && err.code === 409) {
            // Another client is polling the same bot. Step aside.
            console.info("[telegram-poll] conflict (409); another client active");
            setPollingHealth("conflict");
            await sleep(15000);
            continue;
          }
          console.warn("[telegram-poll] transient error, backing off", err);
          setPollingHealth("retrying");
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30000);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(heartbeat);
      releaseLock(tabId);
      setPollingHealth("idle");
      // Drop any stale-banner state on unmount so a re-mounting tab
      // (e.g., user toggles back to this tab) starts fresh.
      setStaleSignal({ isStale: false, botUsername: null });
    };
  }, [username]);
}
