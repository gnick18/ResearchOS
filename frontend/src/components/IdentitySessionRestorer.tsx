"use client";

// Boot-time sharing-identity restore.
//
// The unlocked identity lives in an in-memory session (session-key.ts) that is
// cleared on every page reload, while the key itself is persisted in IndexedDB
// (saveIdentity, written on create + unlock). Before this, nothing repopulated
// the session on boot, so the user had to re-unlock ("reconnect their profile")
// on every refresh. This headless component restores the persisted key into the
// session once a folder + user are on hand, so the identity stays "ready" across
// reloads and every reader (useSharingIdentity, the mobile relay, sharing/collab)
// sees one consistent unlocked identity. No-op when nothing is persisted (the
// user then unlocks via recovery code or passkey). Mounted in providers next to
// the other headless boot effects.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useEffect } from "react";

import { useFileSystem } from "@/lib/file-system/file-system-context";
import { restoreSessionFromStore } from "@/lib/sharing/identity/storage";

export default function IdentitySessionRestorer() {
  const { currentUser, isConnected } = useFileSystem();

  useEffect(() => {
    if (!isConnected || !currentUser) return;
    void restoreSessionFromStore();
  }, [currentUser, isConnected]);

  return null;
}
