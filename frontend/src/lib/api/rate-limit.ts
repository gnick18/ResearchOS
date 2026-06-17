import type { NextRequest } from "next/server";

/**
 * Per-IP rate-limit wrapper for Next.js Route Handlers.
 *
 * ResearchOS exposes five server-side proxy routes that each make an outbound
 * HTTP call and burn serverless function time. Public deploys must protect
 * those routes from volume abuse (DoS of the function budget, low-volume
 * open-proxy use). The URL-guards in `lib/api/url-guards.ts` close SSRF;
 * this wrapper closes volume.
 *
 * Two backends:
 *
 *   1. **In-memory** (default) — module-scope `Map<ip, { count, resetAt }>`.
 *      Per-instance, lost on cold start. Fine for casual abuse; a determined
 *      attacker rotating across Vercel cold-start instances can still drain
 *      the function budget. Memory is bounded (`MAX_ENTRIES` cap with FIFO
 *      eviction) and entries are lazily reaped on access.
 *
 *   2. **Upstash Redis** (opt-in) — when `UPSTASH_REDIS_REST_URL` AND
 *      `UPSTASH_REDIS_REST_TOKEN` are both set, the module dynamically imports
 *      `@upstash/ratelimit` + `@upstash/redis`. The packages are NOT listed in
 *      `package.json`; deployers who opt in install them themselves (or use
 *      the Vercel Upstash integration which provisions both env vars). This
 *      keeps the default bundle clean for labs that don't need cloud state.
 *
 * Usage:
 *
 *   export const GET = withRateLimit(originalGet, {
 *     limit: 60,
 *     windowMs: 60_000,
 *     name: "calendar-feed",
 *   });
 *
 * On overflow the wrapped handler short-circuits with a 429 + `Retry-After`
 * header. Body is the literal string `"Too many requests"` — no internal
 * counters or backend names leaked.
 *
 * IP extraction (in order): `x-forwarded-for` first hop → `x-real-ip` →
 * `request.ip` (set by Next.js on edge runtime) → the string `"unknown"`.
 * The "unknown" bucket is intentional: bucketing all anonymous requests
 * together is safer than skipping the check.
 */

const MAX_ENTRIES = 10_000;

type Bucket = { count: number; resetAt: number };

const memoryStore: Map<string, Bucket> = new Map();

export type RateLimitOptions = {
  /** Max requests per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Short label used for log lines and Upstash key prefixes. */
  name: string;
};

type AsyncHandler<T extends NextRequest> = (req: T) => Promise<Response> | Response;

/**
 * Wrap a Next.js Route Handler so it checks the per-IP rate limit before
 * dispatching to the underlying handler. The wrapper is type-preserving and
 * sits OUTSIDE any signed-fetch / safe-fetch logic — those run unchanged
 * once the rate-limit check passes.
 */
export function withRateLimit<T extends NextRequest>(
  handler: AsyncHandler<T>,
  opts: RateLimitOptions
): AsyncHandler<T> {
  return async (req: T): Promise<Response> => {
    const ip = extractClientIp(req);
    const verdict = await checkRateLimit(ip, opts);
    if (!verdict.ok) {
      const retryAfter = Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000));
      return new Response("Too many requests", {
        status: 429,
        headers: {
          "Retry-After": retryAfter.toString(),
          // Help upstream caches / load balancers avoid storing the 429.
          "Cache-Control": "no-store",
        },
      });
    }
    return handler(req);
  };
}

function extractClientIp(req: NextRequest): string {
  // `x-forwarded-for` is `client, proxy1, proxy2` — first hop is the client.
  // Vercel sets this on every request. We trust it because Vercel rewrites
  // the header at the edge; for self-hosted deploys behind their own proxy
  // the deployer must ensure their proxy does the same.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  // Next.js sets `req.ip` on the edge runtime. Cast through unknown because
  // `NextRequest` typings vary across versions and this field isn't on the
  // base `Request`.
  const ip = (req as unknown as { ip?: string }).ip;
  if (ip && ip.trim()) return ip.trim();
  return "unknown";
}

type Verdict = { ok: true } | { ok: false; resetAt: number };

async function checkRateLimit(ip: string, opts: RateLimitOptions): Promise<Verdict> {
  const upstash = await getUpstashLimiter(opts);
  if (upstash) {
    try {
      const res = await upstash.limit(`${opts.name}:${ip}`);
      if (res.success) return { ok: true };
      return { ok: false, resetAt: res.reset };
    } catch (err) {
      // If Upstash itself errors (network blip, quota exceeded, bad env
      // vars), fall through to in-memory so the route stays available. The
      // alternative — 5xx-ing legitimate users because the rate limiter is
      // sick — is strictly worse.
      console.warn(
        `[rate-limit:${opts.name}] Upstash limiter failed; falling back to in-memory`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return checkInMemory(ip, opts);
}

function checkInMemory(ip: string, opts: RateLimitOptions): Verdict {
  const now = Date.now();
  const key = `${opts.name}:${ip}`;
  const existing = memoryStore.get(key);
  if (!existing || existing.resetAt <= now) {
    // FIFO eviction when the map exceeds the cap. `Map` preserves insertion
    // order, so `keys().next().value` is the oldest entry. This is rough
    // (doesn't account for reset time), but it's a hard memory cap, not a
    // fairness policy — the lazy reap below cleans expired entries anyway.
    if (memoryStore.size >= MAX_ENTRIES) {
      const oldest = memoryStore.keys().next().value;
      if (oldest !== undefined) memoryStore.delete(oldest);
    }
    memoryStore.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true };
  }
  if (existing.count >= opts.limit) {
    return { ok: false, resetAt: existing.resetAt };
  }
  existing.count += 1;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Upstash lazy loader
// ---------------------------------------------------------------------------

type UpstashLimiter = {
  limit: (key: string) => Promise<{ success: boolean; reset: number }>;
};

// Cache the limiter per (name, limit, windowMs) tuple. Each wrapped route gets
// its own limiter because the sliding-window state is per (prefix, key) and
// the prefix needs to encode the route's name + budget.
const upstashCache: Map<string, Promise<UpstashLimiter | null>> = new Map();

function getUpstashLimiter(opts: RateLimitOptions): Promise<UpstashLimiter | null> {
  // Accept BOTH the upstash-native names AND the KV_* names the Vercel Upstash
  // (Marketplace) integration provisions, so connecting the database is enough,
  // no manual env duplication. Prefer the explicit upstash names when both exist.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return Promise.resolve(null);

  const cacheKey = `${opts.name}|${opts.limit}|${opts.windowMs}`;
  let cached = upstashCache.get(cacheKey);
  if (!cached) {
    cached = buildUpstashLimiter(opts, url, token).catch((err) => {
      console.warn(
        `[rate-limit:${opts.name}] failed to load Upstash limiter; falling back to in-memory`,
        err instanceof Error ? err.message : String(err)
      );
      return null;
    });
    upstashCache.set(cacheKey, cached);
  }
  return cached;
}

async function buildUpstashLimiter(
  opts: RateLimitOptions,
  url: string,
  token: string
): Promise<UpstashLimiter | null> {
  // Dynamic imports keep both packages out of the default bundle. Deployers
  // who set the Upstash env vars must install the packages themselves —
  // documented in `frontend/DEPLOYMENT.md`.
  //
  // We can't `import type` because the packages aren't in package.json;
  // `@ts-expect-error` is acceptable per the brief.
  let RedisCtor: new (cfg: { url: string; token: string }) => unknown;
  let RatelimitCtor: new (cfg: {
    redis: unknown;
    limiter: unknown;
    prefix: string;
    analytics?: boolean;
  }) => UpstashLimiter;
  let slidingWindow: (limit: number, window: string) => unknown;
  try {
    // Magic comments tell Webpack + Turbopack to skip static resolution of
    // these specifiers. The packages are optional peer deps that deployers
    // install themselves; without the comments the build fails with
    // `Module not found` even though the require is wrapped in try/catch.
    // The `as { ... }` casts on each await give TypeScript a typed result
    // without needing the (now-unused) @ts-expect-error directives that
    // previously sat above each line.
    const redisMod = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ "@upstash/redis"
    )) as { Redis: typeof RedisCtor };
    const ratelimitMod = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ "@upstash/ratelimit"
    )) as {
      Ratelimit: typeof RatelimitCtor & { slidingWindow: typeof slidingWindow };
    };
    RedisCtor = redisMod.Redis;
    RatelimitCtor = ratelimitMod.Ratelimit;
    slidingWindow = ratelimitMod.Ratelimit.slidingWindow;
  } catch (err) {
    console.warn(
      `[rate-limit:${opts.name}] Upstash env vars set but packages not installed; falling back to in-memory.`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }

  const redis = new RedisCtor({ url, token });
  // Encode the window as the string `${n} ms` / `${n} s` Upstash expects. We
  // prefer seconds when the window is a clean multiple of 1000 to keep the
  // analytics readout readable.
  const windowSpec =
    opts.windowMs % 1000 === 0 ? `${opts.windowMs / 1000} s` : `${opts.windowMs} ms`;
  return new RatelimitCtor({
    redis,
    limiter: slidingWindow(opts.limit, windowSpec),
    prefix: `researchos-rl:${opts.name}`,
    analytics: false,
  });
}

// ---------------------------------------------------------------------------
// Test-only helpers — exported for unit-test hygiene; safe no-ops in prod.
// ---------------------------------------------------------------------------

/** Reset the in-memory store. Tests use this between cases. */
export function __resetRateLimitState(): void {
  memoryStore.clear();
  upstashCache.clear();
}
