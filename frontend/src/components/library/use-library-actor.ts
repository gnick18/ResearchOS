"use client";

import { useCallback, useEffect, useState } from "react";

// The actor identity for library contributions + reviews.
//
// `/library` and its subpages are PUBLIC and folderless (no AppShell, no
// file-system provider), so we cannot read the in-app `currentUser`. Instead the
// contributor/reviewer confirms their @handle once and we persist it locally, so
// every action they take (submit / verify / reject / revert) is attributed to the
// SAME handle and recorded server-side. The independent-verifier rule and the
// rejection audit trail are only as strong as this handle's honesty; binding it
// cryptographically to the cloud account (Ed25519 signing, identity vault) is the
// documented follow-up. This makes attribution real + consistent today, and the
// Chrome end-to-end test runnable (synthetic agents cannot complete OAuth/passkey).

const STORAGE_KEY = "ros.library.actorHandle";

/** Normalize a typed handle: trim, single leading "@", collapse inner spaces. */
export function normalizeHandle(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.startsWith("@") ? t : `@${t}`;
}

export interface LibraryActor {
  /** The confirmed actor @handle, or "" until the user sets one. */
  handle: string;
  /** True once a non-empty handle is set (the "signed-in for the library" state). */
  ready: boolean;
  /** Persist + adopt a handle (normalized). Pass "" to sign out. */
  setHandle: (raw: string) => void;
}

export function useLibraryActor(): LibraryActor {
  const [handle, setHandleState] = useState<string>("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setHandleState(stored);
    } catch {
      /* localStorage unavailable (private mode / SSR) — start empty */
    }
  }, []);

  const setHandle = useCallback((raw: string) => {
    const next = normalizeHandle(raw);
    setHandleState(next);
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, next);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore persistence failure; in-memory value still drives this session */
    }
  }, []);

  return { handle, ready: handle.length > 0, setHandle };
}
