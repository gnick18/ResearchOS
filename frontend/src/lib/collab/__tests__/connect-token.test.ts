// External-collab chunk 2, PIECE A unit tests for the connect-token attach.
//
// Asserts the three auth params are appended when this device has a sharing
// identity (a directory email + an unlocked signing key), and that NOTHING is
// appended (empty suffix) when either half is missing. Also confirms the
// appended signature verifies under the same Ed25519 scheme the relay DO uses,
// so an enforced doc would actually accept the token.

import { describe, it, expect, beforeEach } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";

import { buildConnectTokenSuffix } from "../client/connect-token";
import { setCollabSignerEmail } from "../client/current-email";
import { setSessionIdentity } from "@/lib/sharing/identity/session-key";
import { generateIdentityKeys } from "@/lib/sharing/identity/keys";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";

const SESSION_ID = "deadbeefdeadbeefdeadbeefdeadbeef";
const EMAIL = "owner@example.edu";

function storedIdentity(): StoredIdentity {
  return {
    keys: generateIdentityKeys(),
    deviceSalt: new Uint8Array(16),
  };
}

function parseSuffix(suffix: string): URLSearchParams {
  // The suffix begins with "&"; wrap it as a query string to parse.
  return new URLSearchParams(suffix.replace(/^&/, ""));
}

describe("buildConnectTokenSuffix", () => {
  beforeEach(() => {
    setCollabSignerEmail(null);
    setSessionIdentity(null);
  });

  it("returns empty when there is no sharing identity at all", () => {
    expect(buildConnectTokenSuffix(SESSION_ID)).toBe("");
  });

  it("returns empty when an email is set but the key is locked", () => {
    setCollabSignerEmail(EMAIL);
    setSessionIdentity(null);
    expect(buildConnectTokenSuffix(SESSION_ID)).toBe("");
  });

  it("returns empty when a key is unlocked but no email is published", () => {
    setSessionIdentity(storedIdentity());
    setCollabSignerEmail(null);
    expect(buildConnectTokenSuffix(SESSION_ID)).toBe("");
  });

  it("appends authEmail, authTs, authSig when an identity is present", () => {
    const identity = storedIdentity();
    setSessionIdentity(identity);
    setCollabSignerEmail(EMAIL);

    const suffix = buildConnectTokenSuffix(SESSION_ID);
    expect(suffix.startsWith("&")).toBe(true);

    const params = parseSuffix(suffix);
    expect(params.get("authEmail")).toBe(EMAIL);
    expect(params.get("authTs")).toBeTruthy();
    expect(params.get("authSig")).toMatch(/^[0-9a-f]+$/);

    // The signature must verify under the exact canonical message the relay DO
    // rebuilds: connect\n${sessionId}\n${authEmail}\n${authTs}
    const authTs = params.get("authTs")!;
    const message = `connect\n${SESSION_ID}\n${EMAIL}\n${authTs}`;
    const ok = ed25519.verify(
      hexToBytes(params.get("authSig")!),
      new TextEncoder().encode(message),
      identity.keys.signing.publicKey,
    );
    expect(ok).toBe(true);
  });
});
