// Phase 1b-ii, directory route guards and env access.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractClientIp,
  getPepper,
  isSharingEnabled,
  isSocialLayerEnabled,
  json,
} from "../guard";
import { canonicalizeEmail, hashEmail } from "../email";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.SHARING_ENABLED;
  delete process.env.SOCIAL_LAYER_ENABLED;
  delete process.env.DIRECTORY_HMAC_PEPPER;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("isSharingEnabled", () => {
  it("is false when unset", () => {
    expect(isSharingEnabled()).toBe(false);
  });

  it("is true only for the exact string 'true'", () => {
    process.env.SHARING_ENABLED = "true";
    expect(isSharingEnabled()).toBe(true);
  });

  it("is false for other truthy-looking values", () => {
    process.env.SHARING_ENABLED = "1";
    expect(isSharingEnabled()).toBe(false);
    process.env.SHARING_ENABLED = "TRUE";
    expect(isSharingEnabled()).toBe(false);
    process.env.SHARING_ENABLED = "yes";
    expect(isSharingEnabled()).toBe(false);
  });
});

describe("isSocialLayerEnabled", () => {
  it("is false when unset", () => {
    expect(isSocialLayerEnabled()).toBe(false);
  });

  it("is true only for the exact string 'true'", () => {
    process.env.SOCIAL_LAYER_ENABLED = "true";
    expect(isSocialLayerEnabled()).toBe(true);
  });

  it("is false for other truthy-looking values", () => {
    process.env.SOCIAL_LAYER_ENABLED = "1";
    expect(isSocialLayerEnabled()).toBe(false);
    process.env.SOCIAL_LAYER_ENABLED = "TRUE";
    expect(isSocialLayerEnabled()).toBe(false);
  });

  it("is independent of isSharingEnabled (separate gate)", () => {
    process.env.SHARING_ENABLED = "true";
    expect(isSocialLayerEnabled()).toBe(false);
  });
});

describe("getPepper", () => {
  it("throws a clear error when the pepper is missing", () => {
    expect(() => getPepper()).toThrow(/DIRECTORY_HMAC_PEPPER/);
  });

  it("returns the pepper when set", () => {
    process.env.DIRECTORY_HMAC_PEPPER = "test-pepper";
    expect(getPepper()).toBe("test-pepper");
  });

  it("wires through to a stable email hash (the route layer composition)", () => {
    process.env.DIRECTORY_HMAC_PEPPER = "test-pepper";
    const hash = hashEmail(canonicalizeEmail("  Alice@Example.com "), getPepper());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Same email, different case/whitespace, same hash under the same pepper.
    const again = hashEmail(canonicalizeEmail("alice@example.com"), getPepper());
    expect(hash).toBe(again);
  });
});

describe("extractClientIp", () => {
  it("uses the first hop of x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(extractClientIp(h)).toBe("1.2.3.4");
  });

  it("trims whitespace around the first hop", () => {
    const h = new Headers({ "x-forwarded-for": "  9.9.9.9 , 5.6.7.8" });
    expect(extractClientIp(h)).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip when forwarded-for is absent", () => {
    const h = new Headers({ "x-real-ip": "10.0.0.1" });
    expect(extractClientIp(h)).toBe("10.0.0.1");
  });

  it("falls back to 'unknown' when no IP header is present", () => {
    expect(extractClientIp(new Headers())).toBe("unknown");
  });
});

describe("json", () => {
  it("serializes the body and sets the JSON content type", async () => {
    const res = json(404, { error: "not found" });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
