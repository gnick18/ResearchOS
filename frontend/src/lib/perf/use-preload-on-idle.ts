"use client";

import { useEffect } from "react";

/**
 * Warm a lazy (next/dynamic) chunk on idle so the first time the user opens the
 * surface it is instant, no chunk-load delay or skeleton flash. Pass the SAME
 * `import("...")` the dynamic() loader uses; calling it just fills webpack's chunk
 * cache. Runs once per mount, on requestIdleCallback (with a setTimeout fallback
 * for browsers without it, e.g. Safari), so it never competes with first paint.
 *
 * Use it on a component that is mounted when the user is plausibly ABOUT to need
 * the chunk (the surface that owns the lazy modal, or the route that precedes the
 * heavy view), not globally, so heavy chunks are only fetched on real intent.
 */
export function usePreloadOnIdle(loader: () => Promise<unknown>, fallbackDelayMs = 1500) {
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const run = () => {
      void loader().catch(() => {
        /* preload is best-effort; a failed warm just means the real open loads it */
      });
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(run, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, fallbackDelayMs);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
