// Cross-boundary sharing, relay request-auth unit tests (Phase 2a-ii).
//
// These cover the pure pieces of the signed-request model, payload determinism,
// the action being bound into the signed bytes (a "send" signature cannot be
// replayed as a "fetch"), the freshness window, body validation, and a good
// versus tampered signature. The directory lookup that verifyRelayRequest does
// (getBindingByHash) is the only I/O, and it is mocked so the end-to-end verify
// path can be exercised without a live Neon connection. No R2, no real DB.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the directory db before importing auth, so verifyRelayRequest picks up the
// mocked getBindingByHash. We control what binding (if any) a hash resolves to.
const getBindingByHash = vi.fn();
vi.mock("@/lib/sharing/directory/db", () => ({
  getBindingByHash: (...args: unknown[]) => getBindingByHash(...args),
}));

import {
  buildRelayPayload,
  isFresh,
  parseRelayBody,
  verifyRelayRequest,
  type RelayAction,
} from "../auth";

const PEPPER = "test-pepper-value";

// A deterministic Ed25519 key pair for the caller.
const PRIV = new Uint8Array(32).fill(7);
const PUB = ed25519.getPublicKey(PRIV);
const PUB_HEX = bytesToHex(PUB);

const CALLER_EMAIL = "alice@example.com";

/** Builds and signs a full relay request body for the given action and fields. */
function signedBody(
  action: RelayAction,
  extra: Record<string, unknown>,
  issuedAt: string,
): Record<string, unknown> {
  const payload = buildRelayPayload({
    action,
    email: CALLER_EMAIL,
    issuedAt,
    recipientEmail: extra.recipientEmail as string | undefined,
    sizeBytes: extra.sizeBytes as number | undefined,
    bundleId: extra.bundleId as string | undefined,
  });
  const signature = bytesToHex(ed25519.sign(payload, PRIV));
  return { action, email: CALLER_EMAIL, issuedAt, signature, ...extra };
}

beforeEach(() => {
  getBindingByHash.mockReset();
});

describe("buildRelayPayload, determinism and field binding", () => {
  const issuedAt = "2026-06-03T12:00:00.000Z";

  it("is byte-for-byte stable for the same input", () => {
    const a = buildRelayPayload({ action: "inbox", email: CALLER_EMAIL, issuedAt });
    const b = buildRelayPayload({ action: "inbox", email: CALLER_EMAIL, issuedAt });
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it("binds the action into the bytes, send and fetch differ", () => {
    const send = buildRelayPayload({
      action: "send",
      email: CALLER_EMAIL,
      issuedAt,
      recipientEmail: "bob@example.com",
      sizeBytes: 10,
    });
    const fetchP = buildRelayPayload({
      action: "fetch",
      email: CALLER_EMAIL,
      issuedAt,
      bundleId: "abc",
    });
    expect(bytesToHex(send)).not.toBe(bytesToHex(fetchP));
  });

  it("binds the action into the bytes, confirm and ack differ on the same bundleId", () => {
    const confirmP = buildRelayPayload({
      action: "confirm",
      email: CALLER_EMAIL,
      issuedAt,
      bundleId: "abc",
    });
    const ackP = buildRelayPayload({
      action: "ack",
      email: CALLER_EMAIL,
      issuedAt,
      bundleId: "abc",
    });
    expect(bytesToHex(confirmP)).not.toBe(bytesToHex(ackP));
  });

  it("includes only the action-specific fields that are set", () => {
    const text = new TextDecoder().decode(
      buildRelayPayload({ action: "inbox", email: CALLER_EMAIL, issuedAt }),
    );
    expect(text).not.toContain("recipientEmail=");
    expect(text).not.toContain("bundleId=");
    expect(text).not.toContain("sizeBytes=");
    expect(text).toContain("action=inbox");
  });
});

describe("isFresh, the 5-minute window", () => {
  const now = Date.parse("2026-06-03T12:00:00.000Z");

  it("accepts a just-now timestamp", () => {
    expect(isFresh("2026-06-03T12:00:00.000Z", now)).toBe(true);
  });

  it("accepts a timestamp four minutes old", () => {
    expect(isFresh("2026-06-03T11:56:00.000Z", now)).toBe(true);
  });

  it("rejects a timestamp six minutes old", () => {
    expect(isFresh("2026-06-03T11:54:00.000Z", now)).toBe(false);
  });

  it("rejects a future-dated timestamp", () => {
    expect(isFresh("2026-06-03T12:01:00.000Z", now)).toBe(false);
  });

  it("rejects a non-date string", () => {
    expect(isFresh("not-a-date", now)).toBe(false);
  });
});

describe("parseRelayBody, shape validation", () => {
  const issuedAt = "2026-06-03T12:00:00.000Z";
  const base = { email: CALLER_EMAIL, issuedAt, signature: "ab12" };

  it("rejects a body whose action does not match the expected action", () => {
    expect(parseRelayBody({ ...base, action: "send" }, "inbox")).toBeNull();
  });

  it("requires recipientEmail and sizeBytes for send", () => {
    expect(parseRelayBody({ ...base, action: "send" }, "send")).toBeNull();
    expect(
      parseRelayBody(
        { ...base, action: "send", recipientEmail: "bob@example.com", sizeBytes: 5 },
        "send",
      ),
    ).not.toBeNull();
  });

  it("rejects a non-integer or negative sizeBytes for send", () => {
    expect(
      parseRelayBody(
        { ...base, action: "send", recipientEmail: "bob@example.com", sizeBytes: -1 },
        "send",
      ),
    ).toBeNull();
    expect(
      parseRelayBody(
        { ...base, action: "send", recipientEmail: "bob@example.com", sizeBytes: 1.5 },
        "send",
      ),
    ).toBeNull();
  });

  it("accepts a fingerprint instead of an email for send, normalized to compact lowercase", () => {
    const parsed = parseRelayBody(
      {
        ...base,
        action: "send",
        recipientFingerprint: "ABCD EF12 3456 7890",
        sizeBytes: 5,
      },
      "send",
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.recipientFingerprint).toBe("abcdef1234567890");
    expect(parsed?.recipientEmail).toBeUndefined();
  });

  it("rejects a send carrying BOTH an email and a fingerprint", () => {
    expect(
      parseRelayBody(
        {
          ...base,
          action: "send",
          recipientEmail: "bob@example.com",
          recipientFingerprint: "abcdef1234567890",
          sizeBytes: 5,
        },
        "send",
      ),
    ).toBeNull();
  });

  it("rejects a send carrying NEITHER an email nor a fingerprint", () => {
    expect(
      parseRelayBody({ ...base, action: "send", sizeBytes: 5 }, "send"),
    ).toBeNull();
  });

  it("rejects a malformed fingerprint for send", () => {
    expect(
      parseRelayBody(
        { ...base, action: "send", recipientFingerprint: "nothex!!", sizeBytes: 5 },
        "send",
      ),
    ).toBeNull();
  });

  it("does NOT accept a fingerprint for invite (email-only)", () => {
    expect(
      parseRelayBody(
        {
          ...base,
          action: "invite",
          recipientFingerprint: "abcdef1234567890",
          sizeBytes: 5,
        },
        "invite",
      ),
    ).toBeNull();
  });

  it("requires bundleId for confirm, fetch and ack", () => {
    expect(parseRelayBody({ ...base, action: "fetch" }, "fetch")).toBeNull();
    expect(parseRelayBody({ ...base, action: "confirm" }, "confirm")).toBeNull();
    expect(
      parseRelayBody({ ...base, action: "fetch", bundleId: "x" }, "fetch"),
    ).not.toBeNull();
    expect(
      parseRelayBody({ ...base, action: "ack", bundleId: "x" }, "ack"),
    ).not.toBeNull();
    expect(
      parseRelayBody({ ...base, action: "confirm", bundleId: "x" }, "confirm"),
    ).not.toBeNull();
  });

  it("rejects a non-hex signature", () => {
    expect(
      parseRelayBody({ ...base, action: "inbox", signature: "zz" }, "inbox"),
    ).toBeNull();
  });

  it("rejects a non-round-tripping issuedAt", () => {
    expect(
      parseRelayBody({ ...base, action: "inbox", issuedAt: "2026-06-03" }, "inbox"),
    ).toBeNull();
  });

  it("accepts a well-formed inbox body", () => {
    expect(parseRelayBody({ ...base, action: "inbox" }, "inbox")).not.toBeNull();
  });
});

describe("verifyRelayRequest, end to end", () => {
  const issuedAt = new Date().toISOString();

  it("accepts a good signature from a registered caller", async () => {
    getBindingByHash.mockResolvedValue({
      emailHash: "h",
      x25519PublicKey: "00",
      ed25519PublicKey: PUB_HEX,
      fingerprint: "fp",
      keyBackupBlob: null,
    });
    const body = signedBody("inbox", {}, issuedAt);
    const result = await verifyRelayRequest(body, "inbox", PEPPER);
    expect(result).not.toBeNull();
    expect(result?.binding.ed25519PublicKey).toBe(PUB_HEX);
  });

  it("rejects when the caller is not registered (no binding)", async () => {
    getBindingByHash.mockResolvedValue(null);
    const body = signedBody("inbox", {}, issuedAt);
    expect(await verifyRelayRequest(body, "inbox", PEPPER)).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    getBindingByHash.mockResolvedValue({
      emailHash: "h",
      x25519PublicKey: "00",
      ed25519PublicKey: PUB_HEX,
      fingerprint: "fp",
      keyBackupBlob: null,
    });
    const body = signedBody("inbox", {}, issuedAt);
    // Flip the last hex nibble of the signature.
    const sig = body.signature as string;
    const flipped = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    expect(
      await verifyRelayRequest({ ...body, signature: flipped }, "inbox", PEPPER),
    ).toBeNull();
  });

  it("rejects a send signature replayed as a fetch", async () => {
    getBindingByHash.mockResolvedValue({
      emailHash: "h",
      x25519PublicKey: "00",
      ed25519PublicKey: PUB_HEX,
      fingerprint: "fp",
      keyBackupBlob: null,
    });
    // A valid "send" body, signed for the send action.
    const sendBody = signedBody(
      "send",
      { recipientEmail: "bob@example.com", sizeBytes: 42 },
      issuedAt,
    );
    // Present the same signature under a fetch shape. parseRelayBody fails first
    // (action mismatch), and even if reshaped the bytes would not verify.
    const replay = { ...sendBody, action: "fetch", bundleId: "abc" };
    expect(await verifyRelayRequest(replay, "fetch", PEPPER)).toBeNull();
  });

  it("rejects an ack signature replayed as a confirm", async () => {
    getBindingByHash.mockResolvedValue({
      emailHash: "h",
      x25519PublicKey: "00",
      ed25519PublicKey: PUB_HEX,
      fingerprint: "fp",
      keyBackupBlob: null,
    });
    // A valid "ack" body, signed for the ack action over the same bundleId.
    const ackBody = signedBody("ack", { bundleId: "bundle-x" }, issuedAt);
    // Re-label it as confirm. parseRelayBody fails on the action mismatch, and
    // even reshaped the signed bytes would not verify under the confirm action.
    const replay = { ...ackBody, action: "confirm" };
    expect(await verifyRelayRequest(replay, "confirm", PEPPER)).toBeNull();
  });

  it("accepts a good confirm signature carrying a bundleId", async () => {
    getBindingByHash.mockResolvedValue({
      emailHash: "h",
      x25519PublicKey: "00",
      ed25519PublicKey: PUB_HEX,
      fingerprint: "fp",
      keyBackupBlob: null,
    });
    const body = signedBody("confirm", { bundleId: "bundle-x" }, issuedAt);
    const result = await verifyRelayRequest(body, "confirm", PEPPER);
    expect(result).not.toBeNull();
    expect(result?.parsed.bundleId).toBe("bundle-x");
  });

  it("rejects a stale request", async () => {
    getBindingByHash.mockResolvedValue({
      emailHash: "h",
      x25519PublicKey: "00",
      ed25519PublicKey: PUB_HEX,
      fingerprint: "fp",
      keyBackupBlob: null,
    });
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const body = signedBody("inbox", {}, stale);
    expect(await verifyRelayRequest(body, "inbox", PEPPER)).toBeNull();
  });
});
