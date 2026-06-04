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

import { useCallback, useEffect, useState } from "react";

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
  /** Re-read both halves, call after a claim, restore, or user switch. */
  refresh: () => Promise<void>;
}

export function useSharingIdentity(): UseSharingIdentityResult {
  const { currentUser } = useCurrentUser();
  const [status, setStatus] = useState<SharingIdentityStatus>("loading");
  const [sidecar, setSidecar] = useState<SharingIdentitySidecar | null>(null);

  const refresh = useCallback(async () => {
    if (!currentUser) {
      setSidecar(null);
      setStatus("none");
      return;
    }
    setStatus("loading");
    const [side, localKey] = await Promise.all([
      readSharingIdentity(currentUser),
      hasIdentity(),
    ]);
    setSidecar(side);
    if (!side) {
      setStatus("none");
    } else if (!localKey) {
      setStatus("needs-restore");
    } else {
      setStatus("ready");
    }
  }, [currentUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    status,
    sidecar,
    email: sidecar?.email ?? null,
    isReady: status === "ready",
    refresh,
  };
}
