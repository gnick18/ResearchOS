/**
 * Server-side helper for HMAC-signed LabArchives REST calls.
 *
 * Wraps the "sign + fetch + on 401 → re-sync + retry once" pattern so the
 * three signed-request routes (login, refresh, fetch-image) don't repeat
 * the same boilerplate. The retry exists because the signed `expires` field
 * is built from `Date.now() + offset`, and if the offset hasn't been
 * computed yet (or has drifted) LabArchives surfaces the skew as a 401 with
 * no other distinguishing signal. Re-syncing once and retrying covers the
 * common case where the deployment server's clock skewed past the multi-
 * minute accept window since process startup.
 *
 * Also wires in a 30s timeout via `AbortController`, with `clearTimeout` on
 * every exit path — mirrors the round-2 hardening pattern from
 * `lib/api/url-guards.ts`.
 */
import {
  buildSignedParams,
  nowMs,
  syncEpochOffset,
} from "./sign";

interface LabArchivesCredsLike {
  accessKeyId: string;
  accessPassword: string;
  baseUrl: string;
}

export interface SignedFetchOptions {
  /** Extra query params to append to the URL (besides `akid`, `expires`,
   *  `sig`). Order doesn't matter; values are URL-encoded by URLSearchParams. */
  params?: Record<string, string>;
  /** End-to-end timeout in ms. Defaults to 30s. */
  timeoutMs?: number;
}

export type SignedFetchResult =
  | { kind: "response"; res: Response; retriedAfterReSync: boolean }
  | { kind: "network-error"; error: Error; aborted: boolean };

/**
 * Sign + fetch a LabArchives REST endpoint with a built-in 30s timeout and
 * one automatic retry on 401 (after re-syncing the clock offset).
 *
 * `apiMethod` is the un-prefixed REST method name, e.g. `"user_access_info"`.
 * `urlPath` is the full path including the leading slash relative to
 * `baseUrl`, e.g. `"/users/user_access_info"`. They're separated because the
 * signature is over the method name only, but the URL needs the full path.
 *
 * Returned shape:
 *  - `{ kind: "response", res, retriedAfterReSync }` — got an HTTP response
 *    (2xx OR error status). Caller still has to parse XML to decide
 *    success vs content-level failure. The body has NOT been consumed.
 *  - `{ kind: "network-error", error, aborted }` — `fetch` itself threw, or
 *    the request aborted on timeout. `aborted=true` distinguishes the
 *    timeout case from a TCP-level failure.
 *
 * The first call after process startup synchronously triggers a clock-offset
 * sync (via `syncEpochOffset`) before signing. Subsequent calls reuse the
 * cached offset until a 401 is observed, at which point we re-sync and
 * retry once.
 */
export async function signedLabArchivesFetch(
  creds: LabArchivesCredsLike,
  apiMethod: string,
  urlPath: string,
  options: SignedFetchOptions = {},
): Promise<SignedFetchResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;

  // Best-effort sync on every call. Internally this hits the unsigned
  // `/utilities/epoch_time` endpoint and caches the offset at module scope;
  // a failure leaves the cached offset alone (so a previously-good sync
  // survives a transient outage of the time endpoint). Cheap relative to
  // the main signed call.
  await syncEpochOffset(creds.baseUrl);

  const attemptOnce = async (): Promise<SignedFetchResult> => {
    const signed = buildSignedParams(
      creds.accessKeyId,
      creds.accessPassword,
      apiMethod,
      nowMs(),
    );
    const url = new URL(`${creds.baseUrl}${urlPath}`);
    url.searchParams.set("akid", signed.akid);
    url.searchParams.set("expires", signed.expires);
    url.searchParams.set("sig", signed.sig);
    for (const [k, v] of Object.entries(options.params ?? {})) {
      url.searchParams.set(k, v);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
        signal: ctrl.signal,
      });
      return { kind: "response", res, retriedAfterReSync: false };
    } catch (err) {
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || /aborted/i.test(err.message));
      const e = err instanceof Error ? err : new Error(String(err));
      return { kind: "network-error", error: e, aborted };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await attemptOnce();
  // Network error: pass straight back, no retry — re-syncing the clock won't
  // help a TCP-level failure, and the timeout already had its full budget.
  if (first.kind === "network-error") return first;
  // 401 specifically can indicate clock drift past LabArchives' accept
  // window. Other errors (4xx for bad creds, 5xx upstream) won't be helped
  // by a re-sync, so we don't retry those.
  if (first.res.status !== 401) return first;

  // Drain the first 401's body so the connection releases — we'll surface
  // the SECOND response if the retry produced one, and don't want a dangling
  // unread body.
  await first.res.text().catch(() => {});
  const offsetAfter = await syncEpochOffset(creds.baseUrl);
  if (offsetAfter === null) {
    // Re-sync failed; nothing to retry against. We synthesize a stand-in
    // 401 response so the caller can decide what to surface. Body is empty
    // because we already drained the original.
    return {
      kind: "response",
      res: new Response("", { status: 401, statusText: "Unauthorized" }),
      retriedAfterReSync: false,
    };
  }
  const second = await attemptOnce();
  if (second.kind === "response") {
    return { ...second, retriedAfterReSync: true };
  }
  return second;
}
