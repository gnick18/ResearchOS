// HR fix — regression tests for the self-healing behaviour of
// useSharingIdentity(). The hook used to `await Promise.all([...])` with no
// try/catch and no timeout, so a transient File System Access read of
// _sharing_identity.json that stalled or rejected pinned the hook on "loading"
// forever and every share dialog spun on "Checking your sharing setup". These
// tests pin the recovery contract,
//   1. a read that rejects on every attempt settles on a determinate,
//      non-"loading" outcome after the bounded retries (and flags `stalled`),
//   2. the retry is real (the reads run MAX_ATTEMPTS times, not once),
//   3. a first read that stalls past the timeout but recovers on a later
//      attempt lands on the correct success state, never hanging,
//   4. refresh() re-runs a stalled read and can clear the stalled flag,
//   5. the happy path is byte-unchanged (no `stalled`, normal status).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const readSharingIdentity = vi.fn();
const hasIdentity = vi.fn();
let currentUser: string | null = "alex";

vi.mock("../useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser }),
}));
vi.mock("@/lib/sharing/identity/sidecar", () => ({
  readSharingIdentity: (...args: unknown[]) => readSharingIdentity(...args),
  // The hook subscribes to this event in an effect (cross-instance resync), so
  // the mock must carry the constant or the effect mount throws on the missing
  // named export. Value mirrors the real module.
  SHARING_IDENTITY_WRITTEN_EVENT: "researchos:sharing-identity-written",
}));
vi.mock("@/lib/sharing/identity/storage", () => ({
  hasIdentity: (...args: unknown[]) => hasIdentity(...args),
}));

import { useSharingIdentity } from "../useSharingIdentity";

// A PUBLISHED, set-up identity. Under the local-keypair model the canonical
// "an account exists here" signal is the recoveryBlob (the wrapped keypair),
// independent of email; the email additionally marks it as published. The blob
// shape is opaque to the hook, only its presence matters, so a minimal
// stand-in suffices.
const SIDECAR = {
  version: 1 as const,
  email: "alex@example.com",
  x25519PublicKey: "aa",
  ed25519PublicKey: "bb",
  fingerprint: "cd ef",
  claimedAt: "2026-01-01T00:00:00.000Z",
  recoveryConfirmedAt: null,
  recoveryBlob: { v: 1 },
};

// Drives all timers (the 8s read timeout plus the backoff between retries) to
// completion, flushing the microtasks each promise settle queues in between.
async function runToSettled() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  readSharingIdentity.mockReset();
  hasIdentity.mockReset();
  currentUser = "alex";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSharingIdentity (self-healing reads)", () => {
  it("settles on a determinate, non-loading outcome when the read rejects on every attempt", async () => {
    readSharingIdentity.mockRejectedValue(new Error("transient FSA stall"));
    hasIdentity.mockResolvedValue(false);

    const { result } = renderHook(() => useSharingIdentity());
    expect(result.current.status).toBe("loading");

    await runToSettled();

    // No longer hanging: a determinate state, flagged stalled so a caller can
    // offer a retry.
    expect(result.current.status).not.toBe("loading");
    expect(result.current.status).toBe("none");
    expect(result.current.stalled).toBe(true);
    expect(result.current.isReady).toBe(false);
  });

  it("actually retries the reads (bounded) rather than giving up after one failure", async () => {
    readSharingIdentity.mockRejectedValue(new Error("transient FSA stall"));
    hasIdentity.mockResolvedValue(false);

    renderHook(() => useSharingIdentity());
    await runToSettled();

    // Three attempts: the initial try plus two bounded retries.
    expect(readSharingIdentity).toHaveBeenCalledTimes(3);
  });

  it("recovers when the first read stalls past the timeout but a later attempt succeeds", async () => {
    let attempt = 0;
    readSharingIdentity.mockImplementation(() => {
      attempt += 1;
      // First attempt never resolves (the real stall); the timeout must fire
      // and the retry must take over.
      if (attempt === 1) return new Promise(() => {});
      return Promise.resolve(SIDECAR);
    });
    hasIdentity.mockResolvedValue(true);

    const { result } = renderHook(() => useSharingIdentity());

    await runToSettled();

    expect(result.current.status).toBe("ready");
    expect(result.current.isReady).toBe(true);
    expect(result.current.stalled).toBe(false);
    expect(result.current.email).toBe("alex@example.com");
  });

  it("refresh() re-runs a stalled read and can clear the stalled flag", async () => {
    readSharingIdentity.mockRejectedValue(new Error("transient FSA stall"));
    hasIdentity.mockResolvedValue(false);

    const { result } = renderHook(() => useSharingIdentity());
    await runToSettled();
    expect(result.current.stalled).toBe(true);

    // The read recovers; refresh() (the path the dialogs already expose) must
    // drive a fresh attempt that clears the stalled fallback.
    readSharingIdentity.mockResolvedValue(SIDECAR);
    hasIdentity.mockResolvedValue(true);
    await act(async () => {
      void result.current.refresh();
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.stalled).toBe(false);
  });

  it("leaves the happy path unchanged (no stalled flag, normal status)", async () => {
    readSharingIdentity.mockResolvedValue(null);
    hasIdentity.mockResolvedValue(false);

    const { result } = renderHook(() => useSharingIdentity());
    await runToSettled();

    expect(result.current.status).toBe("none");
    expect(result.current.stalled).toBe(false);
    expect(readSharingIdentity).toHaveBeenCalledTimes(1);
  });

  // Local-keypair model: an account that was created locally (recoveryBlob
  // present) but never published has NO email. It is still "ready" once the key
  // is on hand, but `published` is false and `email` is null.
  it("treats a local-only identity (recoveryBlob, no email) as ready but not published", async () => {
    readSharingIdentity.mockResolvedValue({
      version: 1,
      x25519PublicKey: "aa",
      ed25519PublicKey: "bb",
      fingerprint: "cd ef",
      createdAt: "2026-06-06T00:00:00.000Z",
      recoveryConfirmedAt: null,
      recoveryBlob: { v: 1 },
    });
    hasIdentity.mockResolvedValue(true);

    const { result } = renderHook(() => useSharingIdentity());
    await runToSettled();

    expect(result.current.status).toBe("ready");
    expect(result.current.isReady).toBe(true);
    expect(result.current.published).toBe(false);
    expect(result.current.email).toBeNull();
  });

  // A sidecar that exists but has no recoveryBlob (no local keypair ever
  // created, e.g. a pre-cutover public-only file) reads as "none", not ready.
  it("reads a sidecar with no recoveryBlob as none", async () => {
    readSharingIdentity.mockResolvedValue({
      version: 1,
      email: "alex@example.com",
      x25519PublicKey: "aa",
      ed25519PublicKey: "bb",
      fingerprint: "cd ef",
      claimedAt: "2026-01-01T00:00:00.000Z",
      recoveryConfirmedAt: null,
    });
    hasIdentity.mockResolvedValue(true);

    const { result } = renderHook(() => useSharingIdentity());
    await runToSettled();

    expect(result.current.status).toBe("none");
    expect(result.current.published).toBe(true);
  });
});
