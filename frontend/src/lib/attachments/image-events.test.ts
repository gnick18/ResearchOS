// frontend/src/lib/attachments/image-events.test.ts
//
// Story: Grant runs ResearchOS in multiple tabs. The Telegram polling
// loop is cross-tab-locked to ONE tab; when a photo arrives, that tab
// runs the file write and `imageEvents.emitAttached(...)`. Before this
// fix, the EventTarget was tab-local so the viewing tab's InboxBadge /
// InboxToast / ImageStrip stayed stale until refresh. Now emits also
// fan out via BroadcastChannel and a localStorage write, and subscribers
// listen on all three surfaces with eventId dedup.
//
// These tests pin the contract:
//   1. Same-tab emit still reaches same-tab listener (regression guard
//      for the in-tab synchronous path ImageStrip relies on).
//   2. Cross-tab BC: a BC posted from one "tab" reaches a subscriber.
//   3. Dedup: same emit firing both in-tab AND cross-tab paths fires
//      the listener exactly once.
//   4. Detail shape preserved across the wire.
//   5. localStorage fallback fires the listener when BC is unavailable.
//   6. Drag events are tab-local — no BC post, no localStorage write.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHANNEL_NAME = "researchos-image-events";
const FALLBACK_LS_KEY = "researchos-image-events-signal";

interface StoredEvent {
  key: string;
  value: string;
}

class StubLocalStorage {
  public writes: StoredEvent[] = [];
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.map.keys())[i] ?? null;
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
    this.writes.push({ key: k, value: v });
  }
}

/** Build a minimal Window-like stub (an EventTarget) and install it
 *  along with localStorage. Returns helpers for cleanup + manual storage
 *  event dispatch. */
function installWindowStubs(): {
  win: EventTarget & { addEventListener: EventTarget["addEventListener"] };
  ls: StubLocalStorage;
  dispatchStorage: (key: string, newValue: string) => void;
} {
  const win = new EventTarget() as EventTarget & {
    addEventListener: EventTarget["addEventListener"];
  };
  const ls = new StubLocalStorage();
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", ls);
  function dispatchStorage(key: string, newValue: string): void {
    const ev = new Event("storage") as Event & {
      key?: string;
      newValue?: string;
    };
    ev.key = key;
    ev.newValue = newValue;
    win.dispatchEvent(ev);
  }
  return { win, ls, dispatchStorage };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("imageEvents — in-tab synchronous path", () => {
  it("emit reaches a same-tab listener exactly once", async () => {
    // Default node env: no window stub → cross-tab branches are no-ops,
    // we're exercising the in-tab EventTarget path that ImageStrip relies
    // on. This is the regression guard.
    const { imageEvents } = await import("./image-events");
    const handler = vi.fn();
    const unsub = imageEvents.onAttached(handler);
    imageEvents.emitAttached({ basePath: "/A", relativePath: "Images/x.jpg" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      basePath: "/A",
      relativePath: "Images/x.jpg",
    });
    unsub();
  });
});

describe("imageEvents — BroadcastChannel cross-tab", () => {
  it("a message posted on a different BC instance with the same name reaches the subscriber", async () => {
    // Simulate two tabs sharing a name. Subscriber registers its own BC
    // in tab A; tab B posts on its own BC. The browser's same-name BC
    // delivery semantics (verified for Node's impl) cross the boundary.
    installWindowStubs();
    vi.resetModules();
    const { imageEvents } = await import("./image-events");

    const handler = vi.fn();
    const unsub = imageEvents.onAttached(handler);

    const otherTab = new BroadcastChannel(CHANNEL_NAME);
    const envelope = {
      type: "image-attached",
      eventId: "tab-B-1",
      detail: { basePath: "/B", relativePath: "Images/from-other-tab.jpg" },
    };
    otherTab.postMessage(envelope);

    // BC delivery is async — wait a microtask + macrotask cycle.
    await new Promise((r) => setTimeout(r, 20));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      basePath: "/B",
      relativePath: "Images/from-other-tab.jpg",
    });

    otherTab.close();
    unsub();
  });
});

describe("imageEvents — eventId dedup", () => {
  it("a single emit firing both in-tab CustomEvent and cross-tab BC fires the handler once", async () => {
    // With `window` stubbed, emit takes BOTH paths: synchronous in-tab
    // dispatch + BC.postMessage that round-trips to the subscriber's
    // own BC listener in the same realm. Without dedup the handler
    // would fire twice. The eventId dedup map keeps it at one.
    installWindowStubs();
    vi.resetModules();
    const { imageEvents } = await import("./image-events");

    const handler = vi.fn();
    const unsub = imageEvents.onAttached(handler);
    imageEvents.emitAttached({ basePath: "/A", relativePath: "Images/dup.jpg" });

    // Wait for any async BC delivery.
    await new Promise((r) => setTimeout(r, 20));

    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
  });
});

describe("imageEvents — detail shape preserved across the wire", () => {
  it("string fields with special characters survive BroadcastChannel round-trip", async () => {
    installWindowStubs();
    vi.resetModules();
    const { imageEvents } = await import("./image-events");

    const handler = vi.fn();
    const unsub = imageEvents.onAttached(handler);

    const otherTab = new BroadcastChannel(CHANNEL_NAME);
    const detail = {
      basePath: "/Users/Grant/Folder with spaces/Year 1",
      relativePath: "Images/photo \"weird\" — name.jpg",
    };
    otherTab.postMessage({
      type: "image-attached",
      eventId: "shape-test-1",
      detail,
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(detail);

    otherTab.close();
    unsub();
  });

  it("metadata + deleted shapes (with filename) round-trip identically", async () => {
    installWindowStubs();
    vi.resetModules();
    const { imageEvents } = await import("./image-events");

    const metaHandler = vi.fn();
    const delHandler = vi.fn();
    const unsubMeta = imageEvents.onMetadataChanged(metaHandler);
    const unsubDel = imageEvents.onDeleted(delHandler);

    const otherTab = new BroadcastChannel(CHANNEL_NAME);
    otherTab.postMessage({
      type: "image-metadata",
      eventId: "m-1",
      detail: { basePath: "/A", filename: "a.jpg" },
    });
    otherTab.postMessage({
      type: "image-deleted",
      eventId: "d-1",
      detail: { basePath: "/A", filename: "b.jpg" },
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(metaHandler).toHaveBeenCalledExactlyOnceWith({
      basePath: "/A",
      filename: "a.jpg",
    });
    expect(delHandler).toHaveBeenCalledExactlyOnceWith({
      basePath: "/A",
      filename: "b.jpg",
    });

    otherTab.close();
    unsubMeta();
    unsubDel();
  });
});

describe("imageEvents — localStorage fallback", () => {
  it("when BroadcastChannel is undefined, a storage event still notifies the subscriber", async () => {
    const { dispatchStorage } = installWindowStubs();
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.resetModules();
    const { imageEvents } = await import("./image-events");

    const handler = vi.fn();
    const unsub = imageEvents.onAttached(handler);

    const envelope = {
      type: "image-attached",
      eventId: "ls-fallback-1",
      detail: { basePath: "/A", relativePath: "Images/ls.jpg" },
    };
    dispatchStorage(FALLBACK_LS_KEY, JSON.stringify(envelope));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      basePath: "/A",
      relativePath: "Images/ls.jpg",
    });

    unsub();
  });

  it("emit writes the envelope to localStorage so other tabs see the storage event", async () => {
    const { ls } = installWindowStubs();
    vi.resetModules();
    const { imageEvents } = await import("./image-events");

    imageEvents.emitAttached({
      basePath: "/A",
      relativePath: "Images/persisted.jpg",
    });

    expect(ls.writes).toHaveLength(1);
    expect(ls.writes[0].key).toBe(FALLBACK_LS_KEY);
    const parsed = JSON.parse(ls.writes[0].value);
    expect(parsed.type).toBe("image-attached");
    expect(typeof parsed.eventId).toBe("string");
    expect(parsed.detail).toEqual({
      basePath: "/A",
      relativePath: "Images/persisted.jpg",
    });
  });
});

describe("imageEvents — drag events stay tab-local", () => {
  it("emitDragStart does NOT post to BroadcastChannel and does NOT touch localStorage", async () => {
    const { ls } = installWindowStubs();
    // Spy on BC postMessage by replacing the global constructor with one
    // that tracks calls. Any cross-tab post would route through here.
    const postSpy = vi.fn();
    class TrackedBC {
      name: string;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      constructor(name: string) {
        this.name = name;
      }
      postMessage(data: unknown): void {
        postSpy(data);
      }
      close(): void {
        /* noop */
      }
    }
    vi.stubGlobal("BroadcastChannel", TrackedBC);
    vi.resetModules();
    const fresh = await import("./image-events");

    fresh.imageEvents.emitDragStart({
      basePath: "/A",
      filename: "x.jpg",
      caption: "drag me",
    });
    fresh.imageEvents.emitDragEnd();

    expect(postSpy).not.toHaveBeenCalled();
    expect(ls.writes).toHaveLength(0);
  });
});
