"use client";

// Shared gate for the cross-boundary sharing UI (Phase 2b).
//
// Both the send entry points and the inbox need the same answer, does the
// current folder-local user have a usable sharing identity. Under the revised
// model (IDENTITY_OAUTH_ONLY.md, 2026-06-06) the ACCOUNT is a LOCAL keypair, so
// "an identity exists" means the sidecar carries a wrapped key (recoveryBlob),
// independent of any email. A usable identity needs two halves, that sidecar
// (users/<user>/_sharing_identity.json) AND this device's unlocked private key
// (session, or the legacy IndexedDB record). The two can diverge, a user who
// created an identity on one machine and opened the folder on another has the
// sidecar but no key on hand here, which is the "restore your key" state.
//
// Status values,
//   "loading"       still reading the sidecar and the device store
//   "none"          no account here (no sidecar, or a sidecar with no
//                   recoveryBlob, i.e. no local keypair was ever created)
//   "needs-restore" account exists (recoveryBlob present) but no key on hand here
//   "ready"         account exists AND the key is on hand, send and receive work
//
// PUBLISHED is orthogonal to all of this: an identity is "published" once it has
// an email (bound to the directory via the optional OAuth publish step). A local
// -only account can be "ready" with no email; the email/directory bits of the UI
// gate on `published`, not on `status`.
//
// The UI uses status to decide whether to offer create-an-identity ("none"),
// prompt a recovery-code restore ("needs-restore"), or proceed ("ready").

import { useCallback, useEffect, useRef, useState } from "react";

import { useCurrentUser } from "./useCurrentUser";
import {
  readSharingIdentity,
  SHARING_IDENTITY_WRITTEN_EVENT,
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
  /** The sidecar when one exists, else null. */
  sidecar: SharingIdentitySidecar | null;
  /** Canonical email of the PUBLISHED identity, or null for a local-only one. */
  email: string | null;
  /** True only when status is "ready" (both halves present). */
  isReady: boolean;
  /**
   * True when this identity has been PUBLISHED to the directory (it has an
   * email). Orthogonal to status, a "ready" local-only account is NOT published.
   * The email/directory bits of the UI gate on this, not on status.
   */
  published: boolean;
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
        // "An account exists here" = the sidecar carries a wrapped keypair
        // (recoveryBlob), independent of email. A sidecar with no recoveryBlob
        // means no local keypair was ever created, so it reads as "none".
        if (!side || !side.recoveryBlob) {
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

  // Re-read when any sharing-identity write lands (claim, rotate, restore) so
  // every live instance stays in sync across components. This is what lets the
  // require-account gate release the moment a claim publishes, instead of
  // waiting for a remount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onWritten = (e: Event) => {
      const detail = (e as CustomEvent<{ username?: string }>).detail;
      if (!detail?.username || detail.username === currentUser) {
        void refresh();
      }
    };
    window.addEventListener(SHARING_IDENTITY_WRITTEN_EVENT, onWritten);
    return () =>
      window.removeEventListener(SHARING_IDENTITY_WRITTEN_EVENT, onWritten);
  }, [currentUser, refresh]);

  return {
    status,
    sidecar,
    email: sidecar?.email ?? null,
    isReady: status === "ready",
    published: !!sidecar?.email,
    stalled,
    refresh,
  };
}
