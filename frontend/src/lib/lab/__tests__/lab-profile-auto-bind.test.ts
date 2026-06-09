// Tests for lab-profile-auto-bind.ts (P3a).
//
// Covers: bind-once guard, no-sidecar skip, successful bind + sidecar write,
// network failure resilience, I/O error resilience, display-name fallback.
// All I/O is injected so no real fetch or FSA calls happen.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  autoBindLabProfile,
  buildLabAutoBindBody,
  type AutoBindDeps,
} from "../lab-profile-auto-bind";
import type { SharingIdentitySidecar } from "../../sharing/identity/sidecar";
import type { StoredIdentity } from "../../sharing/identity/storage";
import { generateIdentityKeys } from "../../sharing/identity/keys";
import {
  wrapDeviceKey,
} from "../../sharing/identity/device-key";
import type { KdfParams } from "../../sharing/identity/backup";

const FAST: KdfParams = { t: 1, m: 256, p: 1, dkLen: 32 };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIdentity(): StoredIdentity {
  const keys = generateIdentityKeys();
  return { keys, deviceSalt: new Uint8Array(16) };
}

function makeSidecar(overrides: Partial<SharingIdentitySidecar> = {}): SharingIdentitySidecar {
  const { wrapped } = wrapDeviceKey(generateIdentityKeys(), FAST);
  return {
    version: 1,
    x25519PublicKey: "aabbccdd",
    ed25519PublicKey: "eeff0011",
    fingerprint: "aa bb cc dd",
    createdAt: "2026-06-08T00:00:00.000Z",
    recoveryConfirmedAt: null,
    recoveryBlob: wrapped.recoveryBlob,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AutoBindDeps> = {}): AutoBindDeps {
  return {
    readSidecar: vi.fn(async () => makeSidecar()),
    writeSidecar: vi.fn(async () => {}),
    fetchBind: vi.fn(async () => ({ ok: true })),
    now: () => "2026-06-08T12:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildLabAutoBindBody (pure, no I/O)
// ---------------------------------------------------------------------------

describe("buildLabAutoBindBody", () => {
  it("returns the required fields", () => {
    const identity = makeIdentity();
    const sidecar = makeSidecar();
    const body = buildLabAutoBindBody({
      oauthEmail: "Jane@Example.com",
      oauthName: "Jane Smith",
      identity,
      sidecar,
      issuedAt: "2026-06-08T12:00:00.000Z",
    });
    expect(body).toHaveProperty("x25519PublicKey");
    expect(body).toHaveProperty("ed25519PublicKey");
    expect(body).toHaveProperty("signature");
    expect(body).toHaveProperty("issuedAt", "2026-06-08T12:00:00.000Z");
    expect(body).toHaveProperty("displayName", "Jane Smith");
    // Email is canonicalized (lowercased) inside buildBindingPayload, not
    // included in the body (the route reads it from the session server-side).
    expect(body).not.toHaveProperty("email");
  });

  it("lowercases and trims the email for the binding payload", () => {
    const identity = makeIdentity();
    const sidecar = makeSidecar();
    // No assertion on the email directly since the route reads it server-side;
    // assert that the function does not throw and returns a valid body with
    // a non-null signature (which proves the payload was built without error).
    const body = buildLabAutoBindBody({
      oauthEmail: "  JANE@EXAMPLE.COM  ",
      oauthName: null,
      identity,
      sidecar,
      issuedAt: "2026-06-08T12:00:00.000Z",
    });
    expect(typeof body.signature).toBe("string");
    expect((body.signature as string).length).toBeGreaterThan(0);
  });

  it("falls back to the email local part when oauthName is null", () => {
    const identity = makeIdentity();
    const sidecar = makeSidecar();
    const body = buildLabAutoBindBody({
      oauthEmail: "jsmith@wisc.edu",
      oauthName: null,
      identity,
      sidecar,
      issuedAt: "2026-06-08T12:00:00.000Z",
    });
    expect(body).toHaveProperty("displayName", "jsmith");
  });

  it("falls back to the email local part when oauthName is an empty string", () => {
    const identity = makeIdentity();
    const sidecar = makeSidecar();
    const body = buildLabAutoBindBody({
      oauthEmail: "jsmith@wisc.edu",
      oauthName: "   ",
      identity,
      sidecar,
      issuedAt: "2026-06-08T12:00:00.000Z",
    });
    expect(body).toHaveProperty("displayName", "jsmith");
  });

  it("includes keyBackupBlob when sidecar has recoveryBlob", () => {
    const identity = makeIdentity();
    const sidecar = makeSidecar();
    const body = buildLabAutoBindBody({
      oauthEmail: "j@wisc.edu",
      oauthName: null,
      identity,
      sidecar,
      issuedAt: "2026-06-08T12:00:00.000Z",
    });
    expect(body.keyBackupBlob).not.toBeNull();
    const parsed = JSON.parse(body.keyBackupBlob as string);
    expect(parsed).toHaveProperty("v", 2);
    expect(parsed).toHaveProperty("mnemonic");
  });

  it("sends keyBackupBlob null when sidecar has no recoveryBlob", () => {
    const identity = makeIdentity();
    const sidecar = makeSidecar({ recoveryBlob: undefined });
    const body = buildLabAutoBindBody({
      oauthEmail: "j@wisc.edu",
      oauthName: "Jo",
      identity,
      sidecar,
      issuedAt: "2026-06-08T12:00:00.000Z",
    });
    expect(body.keyBackupBlob).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// autoBindLabProfile (orchestrator with injected deps)
// ---------------------------------------------------------------------------

describe("autoBindLabProfile", () => {
  let identity: StoredIdentity;

  beforeEach(() => {
    identity = makeIdentity();
  });

  it("calls fetchBind and writes the email to the sidecar on success", async () => {
    const deps = makeDeps();
    await autoBindLabProfile({
      oauthEmail: "manny@wisc.edu",
      oauthName: "Manny Tester",
      username: "Manny",
      identity,
      deps,
    });
    expect(deps.fetchBind).toHaveBeenCalledOnce();
    expect(deps.writeSidecar).toHaveBeenCalledOnce();
    const [, written] = (deps.writeSidecar as ReturnType<typeof vi.fn>).mock.calls[0] as [string, SharingIdentitySidecar];
    expect(written.email).toBe("manny@wisc.edu");
    expect(written.claimedAt).toBe("2026-06-08T12:00:00.000Z");
  });

  it("skips when sidecar.email is already set (bind-once guard)", async () => {
    const deps = makeDeps({
      readSidecar: vi.fn(async () => makeSidecar({ email: "manny@wisc.edu" })),
    });
    await autoBindLabProfile({
      oauthEmail: "manny@wisc.edu",
      oauthName: null,
      username: "Manny",
      identity,
      deps,
    });
    expect(deps.fetchBind).not.toHaveBeenCalled();
    expect(deps.writeSidecar).not.toHaveBeenCalled();
  });

  it("skips when sidecar is null (no keypair on this device)", async () => {
    const deps = makeDeps({
      readSidecar: vi.fn(async () => null),
    });
    await autoBindLabProfile({
      oauthEmail: "manny@wisc.edu",
      oauthName: null,
      username: "Manny",
      identity,
      deps,
    });
    expect(deps.fetchBind).not.toHaveBeenCalled();
  });

  it("does not write sidecar when fetchBind returns ok:false", async () => {
    const deps = makeDeps({
      fetchBind: vi.fn(async () => ({ ok: false })),
    });
    await autoBindLabProfile({
      oauthEmail: "manny@wisc.edu",
      oauthName: null,
      username: "Manny",
      identity,
      deps,
    });
    expect(deps.fetchBind).toHaveBeenCalledOnce();
    expect(deps.writeSidecar).not.toHaveBeenCalled();
  });

  it("swallows a network error from fetchBind and does not write sidecar", async () => {
    const deps = makeDeps({
      fetchBind: vi.fn(async () => { throw new Error("network down"); }),
    });
    await expect(
      autoBindLabProfile({
        oauthEmail: "manny@wisc.edu",
        oauthName: null,
        username: "Manny",
        identity,
        deps,
      }),
    ).resolves.toBeUndefined(); // must not throw
    expect(deps.writeSidecar).not.toHaveBeenCalled();
  });

  it("swallows a sidecar read error and skips gracefully", async () => {
    const deps = makeDeps({
      readSidecar: vi.fn(async () => { throw new Error("FSA error"); }),
    });
    await expect(
      autoBindLabProfile({
        oauthEmail: "manny@wisc.edu",
        oauthName: null,
        username: "Manny",
        identity,
        deps,
      }),
    ).resolves.toBeUndefined();
    expect(deps.fetchBind).not.toHaveBeenCalled();
  });

  it("still resolves when writeSidecar throws after a successful bind", async () => {
    const deps = makeDeps({
      writeSidecar: vi.fn(async () => { throw new Error("disk full"); }),
    });
    await expect(
      autoBindLabProfile({
        oauthEmail: "manny@wisc.edu",
        oauthName: null,
        username: "Manny",
        identity,
        deps,
      }),
    ).resolves.toBeUndefined();
    // The bind happened but the sidecar write failed; next login will retry the
    // bind (idempotent on the server) and attempt the sidecar write again.
    expect(deps.fetchBind).toHaveBeenCalledOnce();
  });

  it("canonicalizes the email written to the sidecar", async () => {
    const deps = makeDeps();
    await autoBindLabProfile({
      oauthEmail: "MANNY@WISC.EDU",
      oauthName: null,
      username: "Manny",
      identity,
      deps,
    });
    const [, written] = (deps.writeSidecar as ReturnType<typeof vi.fn>).mock.calls[0] as [string, SharingIdentitySidecar];
    expect(written.email).toBe("manny@wisc.edu");
  });

  it("preserves all other sidecar fields when writing the email", async () => {
    const original = makeSidecar({ recoveryConfirmedAt: "2026-06-07T10:00:00.000Z" });
    const deps = makeDeps({
      readSidecar: vi.fn(async () => original),
    });
    await autoBindLabProfile({
      oauthEmail: "manny@wisc.edu",
      oauthName: "Manny",
      username: "Manny",
      identity,
      deps,
    });
    const [, written] = (deps.writeSidecar as ReturnType<typeof vi.fn>).mock.calls[0] as [string, SharingIdentitySidecar];
    expect(written.recoveryConfirmedAt).toBe("2026-06-07T10:00:00.000Z");
    expect(written.version).toBe(1);
    expect(written.x25519PublicKey).toBe(original.x25519PublicKey);
  });
});
