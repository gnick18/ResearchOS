// Shared relay fetch with a hard timeout. Every relay call (snapshot download,
// capture/note/reorder upload, device register) goes through here so a stalled
// relay or a mid-handoff cellular drop fails fast instead of hanging forever. We
// abort at 30s, comfortably under the relay's +-120s timestamp freshness window,
// so a request that times out here would have 401'd on staleness anyway. House
// style: no em-dashes, no emojis, no mid-sentence colons.

// Default relay timeout in milliseconds. Well under the relay's 120s freshness
// window so a stale request is aborted long before the relay would reject it.
export const RELAY_TIMEOUT_MS = 30_000;

// fetch wrapper that aborts after timeoutMs. RN 0.81 polyfills AbortSignal from
// the abort-controller package, which does NOT ship the static
// AbortSignal.timeout, so the AbortController + setTimeout pair below is the path
// that actually runs here. We still prefer AbortSignal.timeout when a runtime
// provides it, then fall back. On abort the underlying fetch rejects, which we
// normalize into a readable "timed out" Error so callers surface a clear message
// instead of hanging or showing a raw AbortError.
export async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs: number = RELAY_TIMEOUT_MS,
): Promise<Response> {
  // Fast path when the runtime exposes the static AbortSignal.timeout.
  if (typeof (AbortSignal as { timeout?: unknown }).timeout === 'function') {
    try {
      return await fetch(input, {
        ...init,
        signal: (AbortSignal as { timeout: (ms: number) => AbortSignal }).timeout(
          timeoutMs,
        ),
      });
    } catch (err) {
      throw asTimeoutError(err, timeoutMs);
    }
  }

  // Fallback: AbortController + setTimeout. This is the live path on RN 0.81.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    throw asTimeoutError(err, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

// Normalize an abort into a readable timeout Error, passing any other error
// through untouched. A fired signal rejects fetch with a DOMException whose name
// is "AbortError" (controller.abort) or "TimeoutError" (AbortSignal.timeout).
function asTimeoutError(err: unknown, timeoutMs: number): unknown {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new Error(
      `Relay request timed out after ${Math.round(timeoutMs / 1000)}s. Check your connection and try again.`,
    );
  }
  return err;
}
