// Phase 2 Chunk 2B, provision-on-demand against the cloud account.
//
// The load-bearing assertion: the bind body that provisionDeviceKeyForAccount
// POSTs to /api/directory/oauth-bind must carry a signature that verifies under
// the SAME canonical payload the route reconstructs (buildBindingPayload over the
// session email + the published public keys), with verifyBindingSignature, the
// exact check the server runs. If this passes, the server will accept the bind.
//
// We also check the key_backup_blob envelope round-trips back to a usable
// keypair, the result mapping over a mocked fetch (session + bind), and that the
// recovery words are NEVER part of the request body sent to the server.
//
// Runs in the node-env vitest project (.test.ts), WebCrypto + Argon2id available.

import { afterEach, describe, expect, it, vi } from "vitest";

import { hexToBytes } from "@noble/hashes/utils.js";

import { type KdfParams } from "../backup";
import { canonicalizeEmail } from "../../directory/email";
import {
  buildBindingPayload,
  verifyBindingSignature,
} from "../../directory/signature";
import { parseKeyBackupField } from "../key-backup-envelope";
import { unlockKeysFromRecoveryBlob } from "../device-key";

// Fast Argon2id params so the test does not pay the 64 MiB production cost.
const FAST: KdfParams = { t: 1, m: 256, p: 1, dkLen: 32 };

const SESSION_EMAIL = "Jane.Researcher@Example.EDU";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

// Import the subject AFTER stubbing the at-rest vault (no IndexedDB in node) and
// fetch, so the module binds to our stubs.
async function loadSubject() {
  vi.doMock("../device-vault", () => ({
    persistKeysAtRest: vi.fn(async () => {}),
  }));
  return await import("../provision");
}

/**
 * A fetch stub that answers the session probe and captures the oauth-bind body.
 * bindStatus controls the bind response; sessionEmail null simulates no session.
 */
function stubFetch(opts: {
  sessionEmail: string | null;
  bindStatus?: number;
  bindThrows?: boolean;
}): { captured: () => unknown } {
  let capturedBody: unknown = null;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/session") {
      if (opts.sessionEmail === null) {
        return new Response(JSON.stringify({ user: null }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ user: { email: opts.sessionEmail } }),
        { status: 200 },
      );
    }
    if (url === "/api/directory/oauth-bind") {
      if (opts.bindThrows) throw new Error("network down");
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;
      const status = opts.bindStatus ?? 200;
      const payload = status === 200 ? { ok: true, fingerprint: "fp" } : { error: "x" };
      return new Response(JSON.stringify(payload), { status });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return { captured: () => capturedBody };
}

describe("provisionDeviceKeyForAccount", () => {
  it("builds a bind signature that verifies under the route's reconstructed payload", async () => {
    const { captured } = stubFetch({ sessionEmail: SESSION_EMAIL });
    const { provisionDeviceKeyForAccount } = await loadSubject();

    const result = await provisionDeviceKeyForAccount({ params: FAST });
    expect(result.ok).toBe(true);

    const body = captured() as {
      x25519PublicKey: string;
      ed25519PublicKey: string;
      keyBackupBlob: string;
      signature: string;
      issuedAt: string;
    };
    expect(body).toBeTruthy();

    // Reconstruct EXACTLY what oauth-bind/route.ts builds: the canonical session
    // email (server-derived), the two published pubkeys, and the issuedAt.
    const payload = buildBindingPayload({
      email: canonicalizeEmail(SESSION_EMAIL),
      x25519PublicKey: body.x25519PublicKey,
      ed25519PublicKey: body.ed25519PublicKey,
      issuedAt: body.issuedAt,
    });
    const ok = verifyBindingSignature(
      payload,
      hexToBytes(body.signature),
      hexToBytes(body.ed25519PublicKey),
    );
    expect(ok).toBe(true);
  });

  it("publishes a key_backup_blob envelope that round-trips to the keypair", async () => {
    const { captured } = stubFetch({ sessionEmail: SESSION_EMAIL });
    const { provisionDeviceKeyForAccount } = await loadSubject();

    const result = await provisionDeviceKeyForAccount({ params: FAST });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const body = captured() as {
      ed25519PublicKey: string;
      keyBackupBlob: string;
    };
    const envelope = parseKeyBackupField(body.keyBackupBlob);
    expect(envelope).not.toBeNull();

    // The returned recovery words must unlock the published blob to the SAME key
    // the route stored the pubkey for (the cross-device restore contract).
    const restored = unlockKeysFromRecoveryBlob(
      envelope!.mnemonic,
      result.recoveryWords,
    );
    expect(restored).not.toBeNull();
    expect(Buffer.from(restored!.signing.publicKey).toString("hex")).toBe(
      body.ed25519PublicKey,
    );
  });

  it("never sends the recovery words or private keys to the server", async () => {
    const { captured } = stubFetch({ sessionEmail: SESSION_EMAIL });
    const { provisionDeviceKeyForAccount } = await loadSubject();

    const result = await provisionDeviceKeyForAccount({ params: FAST });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = JSON.stringify(captured());
    // The recovery words and code are shown locally only; they must not appear
    // anywhere in the published body.
    expect(raw).not.toContain(result.recoveryWords);
    expect(raw).not.toContain(result.recoveryCode);
    // The body keys are exactly the bind shape, no private-key field (no
    // displayName here since none was passed).
    const keys = Object.keys(captured() as object).sort();
    expect(keys).toEqual(
      [
        "ed25519PublicKey",
        "issuedAt",
        "keyBackupBlob",
        "signature",
        "x25519PublicKey",
      ].sort(),
    );
  });

  it("returns a recovery code that matches the published words", async () => {
    stubFetch({ sessionEmail: SESSION_EMAIL });
    const { provisionDeviceKeyForAccount } = await loadSubject();
    const result = await provisionDeviceKeyForAccount({
      params: FAST,
      displayName: "Dr. Jane",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { mnemonicToRecoveryCode } = await import("../recovery-code");
    expect(result.recoveryCode).toBe(
      mnemonicToRecoveryCode(result.recoveryWords),
    );
    expect(result.fingerprint).toMatch(/^[0-9a-f ]+$/);
  });

  it("maps a missing session to unauthorized (never mints a key)", async () => {
    const { captured } = stubFetch({ sessionEmail: null });
    const { provisionDeviceKeyForAccount } = await loadSubject();
    const result = await provisionDeviceKeyForAccount({ params: FAST });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    // No bind call happened (the body capture stays null).
    expect(captured()).toBeNull();
  });

  it("maps a 401 from the bind route to unauthorized", async () => {
    stubFetch({ sessionEmail: SESSION_EMAIL, bindStatus: 401 });
    const { provisionDeviceKeyForAccount } = await loadSubject();
    const result = await provisionDeviceKeyForAccount({ params: FAST });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("maps a 400/429/5xx from the bind route to publish-failed", async () => {
    stubFetch({ sessionEmail: SESSION_EMAIL, bindStatus: 400 });
    const { provisionDeviceKeyForAccount } = await loadSubject();
    const result = await provisionDeviceKeyForAccount({ params: FAST });
    expect(result).toEqual({ ok: false, reason: "publish-failed" });
  });

  it("maps a thrown bind fetch to offline", async () => {
    stubFetch({ sessionEmail: SESSION_EMAIL, bindThrows: true });
    const { provisionDeviceKeyForAccount } = await loadSubject();
    const result = await provisionDeviceKeyForAccount({ params: FAST });
    expect(result).toEqual({ ok: false, reason: "offline" });
  });

  it("omits displayName from the body when none is given", async () => {
    const { captured } = stubFetch({ sessionEmail: SESSION_EMAIL });
    const { provisionDeviceKeyForAccount } = await loadSubject();
    await provisionDeviceKeyForAccount({ params: FAST });
    const body = captured() as Record<string, unknown>;
    expect("displayName" in body).toBe(false);
  });
});
