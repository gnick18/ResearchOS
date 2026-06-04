"use client";

// Shared gate for the cross-boundary sharing UI (Phase 2b).
//
// Both the send entry points and the inbox need the same answer, does the
// current folder-local user have a usable global sharing identity. A usable
// identity needs two halves, the published sidecar (users/<user>/
// _sharing_identity.json, which carries the email and public keys) AND this
// device's private key in IndexedDB. The two can diverge, a user who claimed
// an identity on one machine and opened the folder on another has the sidecar
// but not the local key, which is the "restore your key" state from the
// identity-interaction doc (D3).
//
// Status values,
//   "loading"       still reading the sidecar and the device store
//   "none"          no sidecar, this account has never claimed an identity
//   "needs-restore" sidecar present but no local key on this device
//   "ready"         sidecar present and local key present, send and receive work
//
// The UI uses this to decide whether to launch the SharingSetupWizard ("none"),
// prompt a recovery-words restore ("needs-restore"), or proceed ("ready").

import { useCallback, useEffect, useRef, useState } from "react";

import { useCurrentUser } from "./useCurrentUser";
import {
  readSharingIdentity,
  type SharingIdentitySidecar,
} from "@/lib/sharing/identity/sidecar";
import { hasIdentity } from "@/lib/sharing/identity/storage";

export type SharingIdentityStatus =
  | "loading"
  | "none"
  | "needs-restore"
  | "ready";

export interface UseSharingIdentityResult {
  status: SharingIdentityStatus;
  /** The published sidecar when one exists, else null. */
  sidecar: SharingIdentitySidecar | null;
  /** Canonical email of the claimed identity, convenience for the relay client. */
  email: string | null;
  /** True only when status is "ready" (both halves present). */
  isReady: boolean;
  /**
   * True only when every read attempt (the initial try plus the bounded
   * retries) timed out or threw. The status then carries a determinate
   * fallback rather than spinning on "loading" forever, and a caller may
   * surface a retry affordance that calls refresh(). Additive, false on every
   * success path so the existing four-state consumers are unaffected.
   */
  stalled: boolean;
  /** Re-read both halves, call after a claim, restore, user switch, or to retry a stalled read. */
  refresh: () => Promise<void>;
}

// A transient File System Access read of _sharing_identity.json can stall or
// reject without ever settling. Left unbounded that pins the hook on "loading"
// and every share dialog spins on "Checking your sharing setup" forever (a real
// hang a page refresh cleared). The reads below are therefore raced against a
// timeout and retried with growing backoff so a transient stall recovers on its
// own within a few seconds instead of hanging.
const READ_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;
// Delay before the 2nd and 3rd attempts. Length is MAX_ATTEMPTS - 1.
const RETRY_BACKOFF_MS = [600, 2000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rejects if the wrapped promise has not settled within ms. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`sharing identity read timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function useSharingIdentity(): UseSharingIdentityResult {
  const { currentUser } = useCurrentUser();
  const [status, setStatus] = useState<SharingIdentityStatus>("loading");
  const [sidecar, setSidecar] = useState<SharingIdentitySidecar | null>(null);
  const [stalled, setStalled] = useState(false);

  // Guards against setState-after-unmount and against a slow in-flight attempt
  // resolving late and clobbering a newer one. Every refresh() bumps the
  // generation, and unmount bumps it too, so an attempt only commits state when
  // it is still both mounted and the latest run.
  const mountedRef = useRef(true);
  const generationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    const generation = (generationRef.current += 1);
    const isCurrent = () =>
      mountedRef.current && generationRef.current === generation;

    if (!currentUser) {
      if (!isCurrent()) return;
      setSidecar(null);
      setStalled(false);
      setStatus("none");
      return;
    }

    if (!isCurrent()) return;
    setStalled(false);
    setStatus("loading");

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const [side, localKey] = await withTimeout(
          Promise.all([readSharingIdentity(currentUser), hasIdentity()]),
          READ_TIMEOUT_MS,
        );
        if (!isCurrent()) return;
        setSidecar(side);
        setStalled(false);
        if (!side) {
          setStatus("none");
        } else if (!localKey) {
          setStatus("needs-restore");
        } else {
          setStatus("ready");
        }
        return;
      } catch {
        if (!isCurrent()) return;
        const backoff = RETRY_BACKOFF_MS[attempt - 1];
        if (attempt < MAX_ATTEMPTS && backoff != null) {
          await delay(backoff);
          if (!isCurrent()) return;
        }
      }
    }

    // Every attempt timed out or threw. Settle on a determinate, honest outcome
    // (no usable identity on hand) instead of hanging on "loading", and flag the
    // result as stalled so a caller can offer a retry. refresh() re-runs the
    // whole sequence, so any "Loading" UI keeps a path forward.
    if (!isCurrent()) return;
    setSidecar(null);
    setStatus("none");
    setStalled(true);
  }, [currentUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    status,
    sidecar,
    email: sidecar?.email ?? null,
    isReady: status === "ready",
    stalled,
    refresh,
  };
}
