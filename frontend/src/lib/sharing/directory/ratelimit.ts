// Cross-boundary sharing, directory rate limiting and OTP storage (Phase 1b-ii).
//
// All ephemeral state for the directory lives in Upstash Redis. Two things:
//   1. Rate limiters (per IP, and a stricter per-email-hash signup limiter) via
//      @upstash/ratelimit's sliding window, to blunt enumeration and OTP spam.
//   2. Pending OTP storage with a TTL, so a code expires on its own without a
//      cron, plus an attempt counter capped at 3.
//
// The Redis client is built explicitly from the KV_ env names the Vercel Upstash
// integration created, NOT Redis.fromEnv() (which expects UPSTASH_REDIS_REST_*).
// Everything is lazy, so importing this during build or tsc requires no secrets.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// These packages ship their types under the package-root `types` field but not
// under a `types` condition in their `exports` map, so under bundler resolution
// TS sees the named imports as value-only. InstanceType<typeof X> recovers the
// instance type from the class value without needing the missing type export.
type RedisClient = InstanceType<typeof Redis>;
type RatelimitClient = InstanceType<typeof Ratelimit>;

let redisSingleton: RedisClient | null = null;
let ipLimiterSingleton: RatelimitClient | null = null;
let signupLimiterSingleton: RatelimitClient | null = null;
let inviteLimiterSingleton: RatelimitClient | null = null;

/** The OTP TTL in seconds, the 15-minute expiry from the proposal. */
export const OTP_TTL_SECONDS = 900;

/** Maximum verify attempts before a stored OTP is burned. */
export const MAX_OTP_ATTEMPTS = 3;

/**
 * Lazily constructs the Redis client from the KV_REST_API_* env vars. Throws a
 * clear error if either is missing so a misconfigured deployment fails at
 * request time. We do not use Redis.fromEnv() because the Vercel integration
 * provisions KV_-prefixed names, not the @upstash defaults.
 */
function getRedis(): RedisClient {
  if (redisSingleton) return redisSingleton;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "KV_REST_API_URL / KV_REST_API_TOKEN are not set. The directory needs Upstash Redis.",
    );
  }
  redisSingleton = new Redis({ url, token });
  return redisSingleton;
}

/**
 * Per-IP sliding-window limiter, 20 requests per minute. Applied to every
 * directory route to cap how fast a single source can probe or spam.
 */
export function getIpLimiter(): RatelimitClient {
  if (ipLimiterSingleton) return ipLimiterSingleton;
  ipLimiterSingleton = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    prefix: "directory:ip",
  });
  return ipLimiterSingleton;
}

/**
 * Per-email-hash signup limiter, 3 requests per 15 minutes. This is the resend
 * cap from the proposal, it stops an attacker from forcing a flood of OTP emails
 * to one address even from rotating IPs.
 */
export function getSignupLimiter(): RatelimitClient {
  if (signupLimiterSingleton) return signupLimiterSingleton;
  signupLimiterSingleton = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(3, "900 s"),
    prefix: "directory:signup",
  });
  return signupLimiterSingleton;
}

/**
 * Per-sender invite limiter, 10 new-address invites per day. This is the
 * anti-spam-relay cap from the invite design, an authenticated user can only
 * invite a bounded number of non-users per day even across rotating IPs, so we
 * cannot be turned into a bulk email relay. Keyed by the sender's email hash
 * (not IP) so it follows the identity, not the network path.
 */
export function getInviteLimiter(): RatelimitClient {
  if (inviteLimiterSingleton) return inviteLimiterSingleton;
  inviteLimiterSingleton = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(10, "86400 s"),
    prefix: "relay:invite",
  });
  return inviteLimiterSingleton;
}

/** The Redis key holding the pending OTP record for an email hash. */
function otpKey(emailHash: string): string {
  return `directory:otp:${emailHash}`;
}

/**
 * A pending OTP as stored, the storage hash, the salt as hex (so it survives the
 * JSON round-trip), and the attempt counter. The plaintext code is never stored,
 * only its salted hash, matching otp.ts.
 */
export interface StoredOtp {
  hashedOtp: string;
  saltHex: string;
  attempts: number;
}

/**
 * Stores a fresh OTP record with a TTL, overwriting any previous pending code
 * for the same email hash (a resend supersedes the old code). attempts starts at
 * zero. The TTL means the code self-expires without a sweep job.
 */
export async function storeOtp(
  emailHash: string,
  hashedOtp: string,
  saltHex: string,
  ttlSeconds: number = OTP_TTL_SECONDS,
): Promise<void> {
  const redis = getRedis();
  const record: StoredOtp = { hashedOtp, saltHex, attempts: 0 };
  await redis.set(otpKey(emailHash), JSON.stringify(record), {
    ex: ttlSeconds,
  });
}

/**
 * Reads the pending OTP record for an email hash, or null if none is stored or
 * it has already expired. The Upstash client may hand back either a parsed
 * object or the raw JSON string depending on the stored shape, so we normalize
 * both here.
 */
export async function readOtp(emailHash: string): Promise<StoredOtp | null> {
  const redis = getRedis();
  // No generic type-arg here, the instance type recovered via InstanceType drops
  // get()'s generic signature. We cast the result and normalize both shapes.
  const raw = (await redis.get(otpKey(emailHash))) as StoredOtp | string | null;
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as StoredOtp;
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * Deletes the pending OTP record. Called after a successful verify (the code is
 * single-use) or after the attempt cap is hit (the code is burned).
 */
export async function consumeOtp(emailHash: string): Promise<void> {
  const redis = getRedis();
  await redis.del(otpKey(emailHash));
}

/**
 * Records one failed verify attempt and returns the new attempt count. Preserves
 * the remaining TTL with KEEPTTL so a wrong guess does not extend the code's life
 * (which would let an attacker keep a code alive indefinitely). The caller burns
 * the code once the returned count reaches MAX_OTP_ATTEMPTS.
 */
export async function incrementOtpAttempts(
  emailHash: string,
  current: StoredOtp,
): Promise<number> {
  const redis = getRedis();
  const next = current.attempts + 1;
  const updated: StoredOtp = { ...current, attempts: next };
  await redis.set(otpKey(emailHash), JSON.stringify(updated), {
    keepTtl: true,
  });
  return next;
}
