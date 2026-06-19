// Unit tests for discoverMyLabMemberships.
//
// Covers the four degradation paths (flag off, fetch error, 404, success) and
// verifies that the canonical message is signed correctly before the relay call.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  discoverMembershipsCanonicalMessage,
} from "../lab-membership-discovery";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeypair() {
  const kp = ed25519.keygen();
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

// ---------------------------------------------------------------------------
// Flag-off path: module must be re-loaded after stubbing env so it picks up
// the new flag value. Uses vi.resetModules + dynamic import pattern from
// lab-member-activation-flag.test.ts.
// ---------------------------------------------------------------------------

describe("discoverMyLabMemberships (flag OFF)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_LAB_AS_FOLDER", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns [] immediately without making a fetch call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { discoverMyLabMemberships } = await import(
      "../lab-membership-discovery"
    );
    const kp = makeKeypair();
    const result = await discoverMyLabMemberships({
      ed25519Pub: bytesToHex(kp.publicKey),
      ed25519Priv: kp.privateKey,
    });
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Flag-on paths
// ---------------------------------------------------------------------------

describe("discoverMyLabMemberships (flag ON)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_LAB_AS_FOLDER", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns [] gracefully on fetch error (network down)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("network error"),
    );
    const { discoverMyLabMemberships } = await import(
      "../lab-membership-discovery"
    );
    const kp = makeKeypair();
    const result = await discoverMyLabMemberships({
      ed25519Pub: bytesToHex(kp.publicKey),
      ed25519Priv: kp.privateKey,
    });
    expect(result).toEqual([]);
  });

  it("returns [] on 404 (relay endpoint not yet deployed)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    );
    const { discoverMyLabMemberships } = await import(
      "../lab-membership-discovery"
    );
    const kp = makeKeypair();
    const result = await discoverMyLabMemberships({
      ed25519Pub: bytesToHex(kp.publicKey),
      ed25519Priv: kp.privateKey,
    });
    expect(result).toEqual([]);
  });

  it("returns [] on 500 (relay internal error)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "internal" }), { status: 500 }),
    );
    const { discoverMyLabMemberships } = await import(
      "../lab-membership-discovery"
    );
    const kp = makeKeypair();
    const result = await discoverMyLabMemberships({
      ed25519Pub: bytesToHex(kp.publicKey),
      ed25519Priv: kp.privateKey,
    });
    expect(result).toEqual([]);
  });

  it("returns the labIds array on a 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ labIds: ["lab-aaa", "lab-bbb"] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { discoverMyLabMemberships } = await import(
      "../lab-membership-discovery"
    );
    const kp = makeKeypair();
    const result = await discoverMyLabMemberships({
      ed25519Pub: bytesToHex(kp.publicKey),
      ed25519Priv: kp.privateKey,
    });
    expect(result).toEqual(["lab-aaa", "lab-bbb"]);
  });

  it("filters out non-string values from a malformed labIds response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ labIds: ["lab-aaa", 42, null, "lab-bbb"] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { discoverMyLabMemberships } = await import(
      "../lab-membership-discovery"
    );
    const kp = makeKeypair();
    const result = await discoverMyLabMemberships({
      ed25519Pub: bytesToHex(kp.publicKey),
      ed25519Priv: kp.privateKey,
    });
    expect(result).toEqual(["lab-aaa", "lab-bbb"]);
  });

  it("signs the canonical message correctly (relay can verify)", async () => {
    let capturedBody: { issuedAt: number; signature: string } | null = null;
    let capturedUrl = "";

    vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      async (input, init) => {
        capturedUrl = typeof input === "string" ? input : String(input);
        capturedBody = JSON.parse(
          (init?.body as string) ?? "{}",
        ) as { issuedAt: number; signature: string };
        return new Response(
          JSON.stringify({ labIds: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const { discoverMyLabMemberships } = await import(
      "../lab-membership-discovery"
    );
    const kp = makeKeypair();
    const pubHex = bytesToHex(kp.publicKey);

    await discoverMyLabMemberships({
      ed25519Pub: pubHex,
      ed25519Priv: kp.privateKey,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedUrl).toContain("/lab/discover-memberships");
    expect(capturedUrl).toContain(encodeURIComponent(pubHex));

    // Reconstruct and verify the signature the relay would check.
    const { issuedAt, signature } = capturedBody!;
    const message = discoverMembershipsCanonicalMessage(pubHex, issuedAt);
    const sigBytes = Uint8Array.from(Buffer.from(signature, "hex"));
    const valid = ed25519.verify(sigBytes, message, kp.publicKey);
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// discoverMyLabMembershipsForIdentity convenience wrapper
// ---------------------------------------------------------------------------

describe("discoverMyLabMembershipsForIdentity (flag ON)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_LAB_AS_FOLDER", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("passes signing keys from the identity object correctly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ labIds: ["lab-xyz"] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { discoverMyLabMembershipsForIdentity } = await import(
      "../lab-membership-discovery"
    );
    const kp = makeKeypair();
    const identity = {
      keys: {
        signing: { publicKey: kp.publicKey, privateKey: kp.privateKey },
      },
    };
    const result = await discoverMyLabMembershipsForIdentity(identity);
    expect(result).toEqual(["lab-xyz"]);
  });
});

// Separate describe so the flag-off path gets a clean module + spy state.
describe("discoverMyLabMembershipsForIdentity (flag OFF)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_LAB_AS_FOLDER", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns [] when flag is off, without calling fetch", async () => {
    // Use a fresh fn rather than spyOn to avoid accumulating call counts from
    // previous tests that also spied on globalThis.fetch.
    const mockFetch = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const { discoverMyLabMembershipsForIdentity } = await import(
        "../lab-membership-discovery"
      );
      const kp = makeKeypair();
      const identity = {
        keys: {
          signing: { publicKey: kp.publicKey, privateKey: kp.privateKey },
        },
      };
      const result = await discoverMyLabMembershipsForIdentity(identity);
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
