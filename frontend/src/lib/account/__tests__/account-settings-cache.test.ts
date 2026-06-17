// Session cache for fetchAccountSettings: hit, write-through invalidation, and
// clear-on-identity-change (the cross-user safety). The cache must NEVER serve
// one identity's settings to another, so it is keyed by the identity public key.
//
// The IO is mocked: identity storage (loadIdentity), the flag config, and the
// global fetch. The crypto is REAL (we seal a blob with the same key the mocked
// identity holds) so the decrypt path is exercised end to end.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import {
  type AccountScopedSettings,
  encryptAccountBlob,
} from "../account-settings-crypto";

// -- Mocks ------------------------------------------------------------------

let flagOn = true;
vi.mock("../account-settings-config", () => ({
  isAccountSettingsEnabled: () => flagOn,
}));

// A swappable identity, so a test can simulate a user switch by changing it.
let currentIdentity: {
  keys: {
    encryption: { privateKey: Uint8Array; publicKey: Uint8Array };
  };
} | null = null;
vi.mock("@/lib/sharing/identity/storage", () => ({
  loadIdentity: async () => currentIdentity,
}));

function makeIdentity() {
  const k = x25519.keygen();
  return {
    keys: { encryption: { privateKey: k.secretKey, publicKey: k.publicKey } },
  };
}

/** A GET response carrying the given settings sealed to the identity's key. */
function sealedGetResponse(
  settings: AccountScopedSettings,
  privateKey: Uint8Array,
) {
  const ciphertext = encryptAccountBlob(settings, privateKey);
  return {
    ok: true,
    json: async () => ({ ciphertext }),
  } as unknown as Response;
}

// Module under test is imported dynamically per test so its module-level cache
// starts fresh each time (resetModules below).
async function loadModule() {
  return import("../account-settings");
}

beforeEach(() => {
  vi.resetModules();
  flagOn = true;
  currentIdentity = makeIdentity();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAccountSettings session cache", () => {
  it("CACHE HIT: a second fetch for the same identity does not hit the network again", async () => {
    const mod = await loadModule();
    const settings: AccountScopedSettings = { theme: "dark", labHead: true };
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        sealedGetResponse(settings, currentIdentity!.keys.encryption.privateKey),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const first = await mod.fetchAccountSettings();
    const second = await mod.fetchAccountSettings();

    expect(first).toEqual(settings);
    expect(second).toEqual(settings);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // served from cache the 2nd time
  });

  it("WRITE-THROUGH: a write updates the cache so the next fetch returns the new value with no GET", async () => {
    const mod = await loadModule();
    const initial: AccountScopedSettings = { theme: "light" };
    const fetchSpy = vi.fn().mockImplementation((_url, opts?: RequestInit) => {
      if (opts?.method === "PUT") return Promise.resolve({ ok: true } as Response);
      return Promise.resolve(
        sealedGetResponse(initial, currentIdentity!.keys.encryption.privateKey),
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    await mod.fetchAccountSettings(); // 1 GET, caches { theme: light }
    const ok = await mod.writeAccountSettings({ theme: "dark", labHead: true });
    expect(ok).toBe(true);

    const after = await mod.fetchAccountSettings(); // served from write-through
    expect(after).toEqual({ theme: "dark", labHead: true });

    const gets = fetchSpy.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method !== "PUT",
    );
    expect(gets).toHaveLength(1); // only the original GET; no re-fetch after write
  });

  it("CLEAR ON IDENTITY CHANGE: clearAccountSettingsCache forces a re-fetch", async () => {
    const mod = await loadModule();
    const settings: AccountScopedSettings = { theme: "dark" };
    const fetchSpy = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          sealedGetResponse(
            settings,
            currentIdentity!.keys.encryption.privateKey,
          ),
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    await mod.fetchAccountSettings();
    mod.clearAccountSettingsCache();
    await mod.fetchAccountSettings();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // cache was dropped, so re-fetched
  });

  it("CROSS-USER SAFETY: a different identity never sees the previous user's cached blob", async () => {
    const mod = await loadModule();
    const userA = currentIdentity!;
    const settingsA: AccountScopedSettings = { displayName: "User A" };
    const settingsB: AccountScopedSettings = { displayName: "User B" };

    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(
        sealedGetResponse(
          currentIdentity === userA ? settingsA : settingsB,
          currentIdentity!.keys.encryption.privateKey,
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const a = await mod.fetchAccountSettings();
    expect(a).toEqual(settingsA);

    // Simulate a user switch WITHOUT an explicit cache clear: the owner-key keying
    // alone must prevent serving User A's blob to User B.
    currentIdentity = makeIdentity();
    const b = await mod.fetchAccountSettings();
    expect(b).toEqual(settingsB);
    expect(b).not.toEqual(settingsA);
  });

  it("FLAG OFF: never fetches and returns null (inert)", async () => {
    const mod = await loadModule();
    flagOn = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await mod.fetchAccountSettings()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NO IDENTITY: returns null without fetching", async () => {
    const mod = await loadModule();
    currentIdentity = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await mod.fetchAccountSettings()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
