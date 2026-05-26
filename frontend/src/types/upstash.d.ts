/**
 * Ambient module declarations for the OPTIONAL Upstash peer deps used by
 * `lib/api/rate-limit.ts`. The packages are deliberately not in
 * `package.json` — they only get installed by deployers who set the
 * `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars (or use
 * the Vercel Upstash integration which provisions both).
 *
 * Without these ambient declarations, `tsc --noEmit` (Vercel's build
 * step) fails with `Cannot find module '@upstash/redis'`. The dynamic
 * imports in `rate-limit.ts` are wrapped in try/catch and use
 * `webpackIgnore` + `turbopackIgnore` magic comments so the bundler
 * skips them at build time; the casts on the await results provide the
 * actual typing, so these declarations only need to satisfy the
 * resolver, not enumerate the real shape.
 */
declare module "@upstash/redis";
declare module "@upstash/ratelimit";
