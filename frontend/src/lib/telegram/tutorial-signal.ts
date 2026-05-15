/**
 * Cross-tab signal channel for the Telegram-onboarding tutorial.
 *
 * The polling tab (the user's REAL ResearchOS tab, holding the
 * `telegram-poller-tab` localStorage lock) routes inbound photos. The
 * tutorial tab (the demo tab opened by the welcome modal at
 * `/demo?tutorial=1`) listens for those photo arrivals and the
 * `/tutorial` text command, then advances the sequencer or re-opens the
 * welcome modal accordingly.
 *
 * Design picks:
 *  - **BroadcastChannel preferred, localStorage fallback.** Modern
 *    browsers ship BroadcastChannel; if it's missing or throws (Safari
 *    private mode historically did), we fall back to a `localStorage`
 *    write that triggers the `storage` event in other tabs. Both
 *    surfaces produce identical `TutorialSignal` events to subscribers.
 *  - **Channel name `researchos-telegram`.** Per the proposal. Single
 *    channel for both signal types (`photo-arrived`, `trigger-tutorial-modal`)
 *    keeps the surface area small.
 *  - **No replay, no buffering.** A signal sent to a non-listening tab
 *    is lost. Acceptable: the sequencer's first-photo step has a 90s
 *    fallback for the "no real tab listening" case (see
 *    `OnboardingTutorialSequencer.tsx`).
 */

const CHANNEL_NAME = "researchos-telegram";
/** Storage-event fallback key. The value carries a JSON-serialized
 *  `TutorialSignal` plus a unique `nonce` so back-to-back identical
 *  signals still trip the `storage` listener (storage events fire only
 *  when the value actually changes). */
const FALLBACK_LS_KEY = "researchos-telegram-signal";

export type TutorialSignal =
  | {
      type: "photo-arrived";
      /** Task id the photo attached to, if a popup was open. Null when
       *  the photo went to inbox. The tutorial tab uses this only for
       *  message text, not for routing decisions. */
      taskId: number | null;
      /** True when the photo was routed to the user's inbox (no active
       *  task at the time). */
      fromInbox: boolean;
    }
  | {
      type: "trigger-tutorial-modal";
    };

interface FallbackEnvelope {
  signal: TutorialSignal;
  nonce: string;
}

function makeNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Send a signal to all listeners. Best-effort: failures (private mode,
 *  storage quota, etc.) are swallowed so the calling code path
 *  (image-router photo handling) never breaks because of a
 *  cross-tab-comms failure. */
export function broadcastTutorialSignal(signal: TutorialSignal): void {
  if (typeof window === "undefined") return;
  // BroadcastChannel branch.
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      try {
        ch.postMessage(signal);
      } finally {
        ch.close();
      }
    }
  } catch {
    /* swallow, fall through to localStorage */
  }
  // localStorage fallback. We always also write to localStorage even
  // when BroadcastChannel succeeded, because some tabs (or browsers
  // that have BroadcastChannel scoped weirdly across iframes) might
  // only catch the storage event. The cost is one localStorage write
  // per signal; the tutorial signal is rare (a photo arrival, or a
  // `/tutorial` command), so it's fine.
  try {
    const envelope: FallbackEnvelope = { signal, nonce: makeNonce() };
    localStorage.setItem(FALLBACK_LS_KEY, JSON.stringify(envelope));
  } catch {
    /* private-mode or quota: nothing we can do */
  }
}

export type TutorialSignalListener = (signal: TutorialSignal) => void;

/** Subscribe to tutorial signals from this and other tabs. Returns an
 *  unsubscribe function. SSR-safe: returns a no-op unsubscriber when
 *  called on the server.
 *
 *  Subscribers see the signal at most once per broadcast (we de-dupe
 *  the BroadcastChannel + storage-event paths via a per-listener
 *  recently-seen-nonces window). */
export function subscribeTutorialSignal(
  listener: TutorialSignalListener,
): () => void {
  if (typeof window === "undefined") return () => {};

  // Per-listener short-window de-dupe so a signal that arrives via
  // BOTH BroadcastChannel and the storage-event fallback only fires
  // once. Keys are the JSON-serialized signal; values are timestamps.
  // ~250ms window is plenty for the two paths to land back-to-back
  // and well under any realistic gap between distinct signals.
  const recentlySeen = new Map<string, number>();
  const DEDUPE_WINDOW_MS = 250;

  function deliver(signal: TutorialSignal): void {
    const key = JSON.stringify(signal);
    const now = Date.now();
    const last = recentlySeen.get(key);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
    recentlySeen.set(key, now);
    // Trim old entries opportunistically so the map doesn't grow.
    for (const [k, t] of recentlySeen) {
      if (now - t > DEDUPE_WINDOW_MS * 4) recentlySeen.delete(k);
    }
    try {
      listener(signal);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[tutorial-signal] listener threw", err);
    }
  }

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as TutorialSignal | undefined;
        if (!data || typeof data !== "object" || !("type" in data)) return;
        if (
          data.type !== "photo-arrived" &&
          data.type !== "trigger-tutorial-modal"
        ) {
          return;
        }
        deliver(data);
      };
    }
  } catch {
    channel = null;
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== FALLBACK_LS_KEY || !event.newValue) return;
    try {
      const env = JSON.parse(event.newValue) as FallbackEnvelope;
      if (!env || !env.signal || typeof env.signal !== "object") return;
      const sig = env.signal as TutorialSignal;
      if (
        sig.type !== "photo-arrived" &&
        sig.type !== "trigger-tutorial-modal"
      ) {
        return;
      }
      deliver(sig);
    } catch {
      /* malformed payload, ignore */
    }
  }
  window.addEventListener("storage", onStorage);

  return () => {
    if (channel) {
      try {
        channel.close();
      } catch {
        /* ignore */
      }
      channel = null;
    }
    window.removeEventListener("storage", onStorage);
  };
}
