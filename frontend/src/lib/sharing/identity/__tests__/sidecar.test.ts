// Cross-boundary sharing, the per-user identity sidecar helpers.
//
// These run the real sidecar read/write/exists/delete helpers over an in-memory
// fileService mock (path -> JSON), the same faithful pattern used by
// canread-integration.test.ts. The focus is the delete path the "start over"
// reset flow depends on: deleteSharingIdentity must remove ONLY this user's
// sidecar so the account reads as unclaimed again, leaving other users alone.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("../../../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, JSON.parse(JSON.stringify(data)));
    }),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
  },
}));

// Imports after the mock.
import {
  type SharingIdentitySidecar,
  readSharingIdentity,
  writeSharingIdentity,
  hasSharingIdentity,
  deleteSharingIdentity,
} from "../sidecar";

function makeSidecar(email: string): SharingIdentitySidecar {
  return {
    version: 1,
    email,
    x25519PublicKey: "x25519-pub",
    ed25519PublicKey: "ed25519-pub",
    fingerprint: "AAAA BBBB CCCC DDDD",
    claimedAt: "2026-06-05T00:00:00.000Z",
    recoveryConfirmedAt: null,
  };
}

describe("sharing identity sidecar", () => {
  beforeEach(() => {
    memFs.clear();
  });

  it("round-trips a sidecar and reports existence", async () => {
    expect(await hasSharingIdentity("alex")).toBe(false);
    expect(await readSharingIdentity("alex")).toBeNull();

    const data = makeSidecar("alex@example.edu");
    await writeSharingIdentity("alex", data);

    expect(await hasSharingIdentity("alex")).toBe(true);
    expect(await readSharingIdentity("alex")).toEqual(data);
  });

  it("deleteSharingIdentity removes the sidecar so the account reads as unclaimed", async () => {
    await writeSharingIdentity("alex", makeSidecar("alex@example.edu"));
    expect(await hasSharingIdentity("alex")).toBe(true);

    const removed = await deleteSharingIdentity("alex");

    expect(removed).toBe(true);
    expect(await hasSharingIdentity("alex")).toBe(false);
    expect(await readSharingIdentity("alex")).toBeNull();
  });

  it("deleteSharingIdentity returns false when no sidecar is present", async () => {
    expect(await deleteSharingIdentity("alex")).toBe(false);
  });

  it("deleteSharingIdentity touches only the named user", async () => {
    await writeSharingIdentity("alex", makeSidecar("alex@example.edu"));
    await writeSharingIdentity("mira", makeSidecar("mira@example.edu"));

    await deleteSharingIdentity("alex");

    expect(await hasSharingIdentity("alex")).toBe(false);
    expect(await hasSharingIdentity("mira")).toBe(true);
  });
});
