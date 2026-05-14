# Deployment

This doc covers operational concerns that come up when running ResearchOS as a public deployment rather than a single-user local app. For local-first / single-lab usage you can ignore most of this — the defaults are tuned for "drop it on Vercel free tier and forget about it" and will be safe for low-volume traffic.

## Rate limiting

ResearchOS includes a built-in per-IP rate limiter on its five server-side proxy routes:

| Route | Limit | Purpose |
|---|---|---|
| `/api/calendar-feed` | 60 / 60s | ICS calendar passthrough |
| `/api/telegram-file` | 30 / 60s | Telegram file CDN proxy |
| `/api/labarchives/fetch-image` | 100 / 60s | LabArchives image rehydration (bursty during import) |
| `/api/auth/labarchives/login` | 10 / 60s | LabArchives credential check |
| `/api/auth/labarchives/refresh` | 20 / 60s | LabArchives stored-connection probe |

When a client exceeds its budget the route returns `429 Too Many Requests` with a `Retry-After` header. The wrapper sits at `frontend/src/lib/api/rate-limit.ts` and runs BEFORE the SSRF / signed-fetch logic, so an over-limit request never reaches the upstream API.

By default the limiter is **in-memory and per-instance** — sufficient for low-volume deployments (a single lab, dozens of users). For public deploys facing potential abuse, choose one of the options below.

### Option A (recommended): Upstash Redis

Free tier is sufficient for any single-lab deploy and bounds your costs against an unbounded attacker.

1. Sign up at <https://upstash.com> (free).
2. Create a Redis database, copy the REST URL + Token from the dashboard.
3. Set the env vars on your deployment:
   - `UPSTASH_REDIS_REST_URL=https://...upstash.io`
   - `UPSTASH_REDIS_REST_TOKEN=...`
4. Install the optional peer dependencies (they're intentionally not in `package.json` so the default bundle stays clean):
   ```bash
   npm install @upstash/ratelimit @upstash/redis
   ```
5. Redeploy. The rate limiter automatically detects both env vars and switches to a globally-shared sliding-window limit per IP. No code change required.

If the Upstash call fails at runtime (network blip, quota exceeded, packages not installed), the limiter falls back to in-memory rather than 5xx-ing legitimate users.

### Option B: Cloudflare in front

Set up Cloudflare DNS for your Vercel deployment; enable Cloudflare's free DDoS protection + WAF rules. No code change needed; the per-IP edge limit runs before requests reach Vercel.

### Option C: Vercel Firewall / WAF

If you're on a Vercel paid plan, the platform's built-in WAF can also rate-limit at the edge. Configure it through the Vercel dashboard.

### Caveats

- **Shared NAT IPs**: large university labs often share one external IP. A 30/min limit on Telegram-file effectively rate-limits the whole lab, not one user. Raise the limits in the route files (`limit:` option to `withRateLimit`) if you're seeing legitimate users hit 429s.
- **Cold-start eviction**: in-memory state is lost on every serverless cold start. The in-memory backend is best-effort. Use Upstash if this matters.
- **"unknown" bucket**: when no `x-forwarded-for` / `x-real-ip` / `request.ip` header is available, all such requests share a single bucket. This is intentional — bucketing anonymous requests together is safer than skipping the check — but means a misconfigured proxy can throttle everyone.

## Other operational notes

- **LabArchives env vars**: see `frontend/src/lib/labarchives/config.ts` for the precedence order. `LABARCHIVES_ACCESS_KEY_ID` + `LABARCHIVES_ACCESS_PASSWORD` configure the institution-wide integration; without them, the per-user sidecar at `_labarchives-deployer.json` in the data folder takes over.
- **Telegram bot token**: passed per-request via `x-telegram-token` header so it never lands in URL access logs.
- **ICS feed cache**: the calendar-feed route sets `Cache-Control: public, max-age=900, stale-while-revalidate=3600`, so Vercel's edge cache absorbs repeat hits and the function-invocation budget stays low even with many users hitting the same upstream.
