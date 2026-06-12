/**
 * Demo-only response cache for the chemistry browser-direct API calls
 * (PubChem PUG REST + Europe PMC). DISABLED by default, so every production
 * fetch is byte-for-byte unchanged (pure passthrough). The demo-video recording
 * surface turns it on and pre-warms the exact queries a clip is about to run, so
 * a live search lands instantly on camera ("movie magic") instead of stalling on
 * a 2-4s network round trip.
 *
 * Only GET requests are cached, keyed by full URL. A hit replays a cloned
 * Response; the stored original is never consumed, so it stays clonable for the
 * whole recording session. POST / stateful endpoints (e.g. SureChEMBL submit +
 * poll) must NOT be routed through this.
 */

let enabled = false;
const cache = new Map<string, Promise<Response>>();

/** Turn the demo cache on/off. Turning it off clears any warmed entries. */
export function setDemoFetchCacheEnabled(on: boolean): void {
  enabled = on;
  if (!on) cache.clear();
}

export function isDemoFetchCacheEnabled(): boolean {
  return enabled;
}

/**
 * A `fetch()` drop-in for read-only GETs. Passthrough to the real fetch unless
 * the demo cache is enabled and the request is a GET, in which case identical
 * URLs share one in-flight request and every caller gets a fresh clone.
 */
export function cachedFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (!enabled || method !== "GET") return fetch(url, init);
  const hit = cache.get(url);
  if (hit) return hit.then((r) => r.clone());
  const p = fetch(url, init);
  cache.set(url, p);
  // Drop failures so a later real call can retry rather than replay the error.
  p.catch(() => cache.delete(url));
  return p.then((r) => r.clone());
}
