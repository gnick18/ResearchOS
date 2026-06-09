"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { usersApi } from "@/lib/local-api";
import { createLocalIdentity } from "@/lib/sharing/identity/storage";

/**
 * Dev-only one-click clean-slate session. Spins up a throwaway in-browser
 * (OPFS) data folder, mints a fresh local identity, and signs in, all with no
 * OS folder picker and nothing to silently reconnect to on the next load.
 * `disconnect()` wipes the folder. This lets a phone be paired against a
 * guaranteed-fresh session every time without juggling real disk folders or
 * tripping the stale-locked-identity wall.
 *
 * Renders nothing in production (Next inlines the "development" literal and
 * drops the component as dead code) and nothing once a user is signed in. The
 * data lives inside the browser (OPFS), so it is not visible in Finder, which
 * is the tradeoff for needing no folder picker.
 */
export default function DevEphemeralSessionButton() {
  if (process.env.NODE_ENV !== "development") return null;
  return <DevEphemeralSessionInner />;
}

function DevEphemeralSessionInner() {
  const router = useRouter();
  const { connectEphemeralDev, setCurrentUser, currentUser } = useFileSystem();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Once a user is active we are inside the app; nothing to offer here.
  if (currentUser) return null;

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const ok = await connectEphemeralDev();
      if (!ok) {
        setMsg("Could not start an ephemeral session (OPFS unavailable?).");
        setBusy(false);
        return;
      }
      const username = "Dev";
      await usersApi.create(username);
      // The OPFS folder is always fresh, so mint a matching identity for it.
      // This keeps the on-disk sidecar and the in-session key in lockstep (a
      // re-paired phone gets the current key).
      await createLocalIdentity(username);
      await usersApi.login(username);
      await setCurrentUser(username);
      // Land in the app. A fresh Incognito briefly looks like a "new visitor"
      // and the gate can redirect to the sticky /welcome route mid-flow; now
      // that a user is signed in, "/" renders the app home. Client-side nav
      // (not a reload) so the in-memory OPFS connection is preserved (the
      // ephemeral handle is intentionally not persisted).
      router.replace("/");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Ephemeral dev sign-in failed.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 flex max-w-xs flex-col items-start gap-1.5">
      {msg && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-meta text-amber-800 shadow-lg">
          {msg}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="pointer-events-auto rounded-full bg-sky-500 px-4 py-2 text-meta font-semibold text-white shadow-lg transition-all hover:scale-[1.03] hover:bg-sky-600 disabled:opacity-60"
      >
        {busy ? "Starting..." : "Dev: fresh ephemeral session"}
      </button>
    </div>
  );
}
