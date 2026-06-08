/**
 * Tiny pubsub for image-related changes that should make UI components
 * re-list / refresh without prop drilling. The image strip listens here so
 * that newly-attached images (from in-app upload OR the mobile relay
 * pipeline) show up immediately, and so that sidecar-caption edits
 * propagate to tooltips.
 *
 * Cross-tab plumbing: Grant runs ResearchOS in multiple tabs. The
 * mobile-relay poller is cross-tab-locked to one tab, so when a photo
 * lands the attach emit fires only in that tab; without cross-tab
 * broadcast the OTHER tabs' InboxBadge / InboxToast / ImageStrip stay
 * stale until a refresh. We solve it with a layered approach: keep the
 * in-tab EventTarget for synchronous in-tab dispatch (ImageStrip's
 * optimistic UI patterns rely on that), and additionally fan out via
 * BroadcastChannel + a localStorage write so the storage event reaches
 * tabs in browsers/private-mode where BC fails. Subscribers dedup by
 * eventId so the same emit doesn't fire their handler twice.
 *
 * Drag events are intentionally tab-local: cross-tab "drag started" would
 * be confusing UX.
 */

type AttachedDetail = { basePath: string; relativePath: string };
type MetadataDetail = { basePath: string; filename: string };
type DeletedDetail = { basePath: string; filename: string };
type AnnotatedDetail = { basePath: string; filename: string };
type DragStartDetail = { basePath: string; filename: string; caption?: string };

type CrossTabType =
  | "image-attached"
  | "image-metadata"
  | "image-deleted"
  | "image-annotated";
type CrossTabDetail = AttachedDetail | MetadataDetail | DeletedDetail | AnnotatedDetail;

interface Envelope {
  type: CrossTabType;
  eventId: string;
  detail: CrossTabDetail;
}

const CHANNEL_NAME = "researchos-image-events";
const FALLBACK_LS_KEY = "researchos-image-events-signal";

const target = new EventTarget();

function makeEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function postCrossTab(envelope: Envelope): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel(CHANNEL_NAME);
      try {
        ch.postMessage(envelope);
      } finally {
        ch.close();
      }
    }
  } catch {
    /* private-mode Safari, etc. — fall through to localStorage */
  }
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FALLBACK_LS_KEY, JSON.stringify(envelope));
    }
  } catch {
    /* quota / private mode: nothing we can do */
  }
}

function emitCrossTab(type: CrossTabType, detail: CrossTabDetail): void {
  const eventId = makeEventId();
  const envelope: Envelope = { type, eventId, detail };
  target.dispatchEvent(new CustomEvent(type, { detail: envelope }));
  postCrossTab(envelope);
}

function subscribe<D extends CrossTabDetail>(
  type: CrossTabType,
  handler: (detail: D) => void,
): () => void {
  const recentlySeen = new Map<string, number>();
  const DEDUPE_WINDOW_MS = 1000;

  function deliver(envelope: Envelope): void {
    if (envelope.type !== type) return;
    const now = Date.now();
    if (recentlySeen.has(envelope.eventId)) return;
    recentlySeen.set(envelope.eventId, now);
    for (const [k, t] of recentlySeen) {
      if (now - t > DEDUPE_WINDOW_MS * 4) recentlySeen.delete(k);
    }
    try {
      handler(envelope.detail as D);
    } catch (err) {
      console.warn("[image-events] handler threw", err);
    }
  }

  const inTabListener = (ev: Event): void => {
    const env = (ev as CustomEvent<Envelope>).detail;
    deliver(env);
  };
  target.addEventListener(type, inTabListener);

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent) => {
        const env = event.data as Envelope | undefined;
        if (!env || typeof env !== "object" || typeof env.eventId !== "string") return;
        deliver(env);
      };
    }
  } catch {
    channel = null;
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== FALLBACK_LS_KEY || !event.newValue) return;
    try {
      const env = JSON.parse(event.newValue) as Envelope;
      if (!env || typeof env !== "object" || typeof env.eventId !== "string") return;
      deliver(env);
    } catch {
      /* malformed payload, ignore */
    }
  }
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  return () => {
    target.removeEventListener(type, inTabListener);
    if (channel) {
      try {
        channel.close();
      } catch {
        /* ignore */
      }
      channel = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export const imageEvents = {
  emitAttached(detail: AttachedDetail): void {
    emitCrossTab("image-attached", detail);
  },
  onAttached(handler: (detail: AttachedDetail) => void): () => void {
    return subscribe<AttachedDetail>("image-attached", handler);
  },

  emitMetadataChanged(detail: MetadataDetail): void {
    emitCrossTab("image-metadata", detail);
  },
  onMetadataChanged(handler: (detail: MetadataDetail) => void): () => void {
    return subscribe<MetadataDetail>("image-metadata", handler);
  },

  emitDeleted(detail: DeletedDetail): void {
    emitCrossTab("image-deleted", detail);
  },
  onDeleted(handler: (detail: DeletedDetail) => void): () => void {
    return subscribe<DeletedDetail>("image-deleted", handler);
  },

  /**
   * Fired after the annotation editor writes (or clears) a `.annot.json`
   * layer for an image, so every mounted `<AnnotatedImage>` for that file
   * re-reads and re-renders its SVG overlay live. Cross-tab so a save in one
   * tab refreshes the overlay in the others.
   */
  emitAnnotated(detail: AnnotatedDetail): void {
    emitCrossTab("image-annotated", detail);
  },
  onAnnotated(handler: (detail: AnnotatedDetail) => void): () => void {
    return subscribe<AnnotatedDetail>("image-annotated", handler);
  },

  emitDragStart(detail: DragStartDetail): void {
    target.dispatchEvent(new CustomEvent("image-drag-start", { detail }));
  },
  emitDragEnd(): void {
    target.dispatchEvent(new CustomEvent("image-drag-end"));
  },
  onDragStart(handler: (detail: DragStartDetail) => void): () => void {
    const listener = (ev: Event) => handler((ev as CustomEvent<DragStartDetail>).detail);
    target.addEventListener("image-drag-start", listener);
    return () => target.removeEventListener("image-drag-start", listener);
  },
  onDragEnd(handler: () => void): () => void {
    const listener = () => handler();
    target.addEventListener("image-drag-end", listener);
    return () => target.removeEventListener("image-drag-end", listener);
  },
};
