// Cross-boundary sharing, relay rate-limiter wiring.
//
// Proves the per-IDENTITY relay limiter and the loose per-IP backstop exist, are
// lazily constructed singletons (no env touched at import), and are distinct
// limiters from each other and from the directory IP limiter (so they carry
// independent budgets and Redis key prefixes). The Upstash Ratelimit constructor
// does no network I/O, so building the clients here is safe with only the KV env
// set, no live Redis is contacted.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getIpLimiter,
  getRelayIdentityLimiter,
  getRelayIpBackstopLimiter,
} from "@/lib/sharing/directory/ratelimit";

const PREV_URL = process.env.KV_REST_API_URL;
const PREV_TOKEN = process.env.KV_REST_API_TOKEN;

beforeEach(() => {
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "test-token";
});

afterEach(() => {
  if (PREV_URL === undefined) delete process.env.KV_REST_API_URL;
  else process.env.KV_REST_API_URL = PREV_URL;
  if (PREV_TOKEN === undefined) delete process.env.KV_REST_API_TOKEN;
  else process.env.KV_REST_API_TOKEN = PREV_TOKEN;
});

describe("relay rate limiters", () => {
  it("exposes a per-identity limiter as a callable limiter", () => {
    const limiter = getRelayIdentityLimiter();
    expect(typeof limiter.limit).toBe("function");
  });

  it("exposes a loose per-IP backstop limiter as a callable limiter", () => {
    const limiter = getRelayIpBackstopLimiter();
    expect(typeof limiter.limit).toBe("function");
  });

  it("returns the same singleton instance on repeated calls", () => {
    expect(getRelayIdentityLimiter()).toBe(getRelayIdentityLimiter());
    expect(getRelayIpBackstopLimiter()).toBe(getRelayIpBackstopLimiter());
  });

  it("keeps the identity, backstop, and directory-IP limiters distinct", () => {
    // Three different limiter instances means three independent Redis prefixes
    // and budgets. The per-identity limiter must NOT be the same object as the
    // per-IP limiters, otherwise a shared NAT IP would still bind the budget.
    const identity = getRelayIdentityLimiter();
    const backstop = getRelayIpBackstopLimiter();
    const directoryIp = getIpLimiter();
    expect(identity).not.toBe(backstop);
    expect(identity).not.toBe(directoryIp);
    expect(backstop).not.toBe(directoryIp);
  });
});
