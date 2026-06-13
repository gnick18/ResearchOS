"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { usersApi } from "@/lib/local-api";
import { createLocalIdentity } from "@/lib/sharing/identity/storage";
import { seedEphemeralWorkspace } from "@/lib/dev/seed-ephemeral";
import { isRecordingMode } from "@/lib/file-system/wiki-capture-mock";

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
  // Mount-gate so the recording-mode check runs only on the client, with no
  // server/client hydration mismatch: both render null first, then the effect
  // reveals the button in dev unless `?record=1` is active. Recording mode
  // (`?record=1`) is a pristine surface for marketing video, so this dev
  // chrome stays hidden there alongside the demo chrome.
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && !isRecordingMode()) {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  return <DevEphemeralSessionInner />;
}

// Folder names connectEphemeralDev / its reload-reconnect set as directoryName.
// Either one means the current session is an ephemeral OPFS one, so a "restart
// fresh" button is safe to offer (it never touches a real disk folder).
const EPHEMERAL_DIR_NAMES = ["Dev ephemeral", "researchos-dev-ephemeral"];

function DevEphemeralSessionInner() {
  const router = useRouter();
  const { connectEphemeralDev, setCurrentUser, currentUser, directoryName } =
    useFileSystem();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const inEphemeralSession =
    !!directoryName && EPHEMERAL_DIR_NAMES.includes(directoryName);

  // Spin up (or restart) a guaranteed-fresh ephemeral session and seed it with a
  // small sample data set. connectEphemeralDev always wipes + recreates the OPFS
  // folder, so calling this from inside a live session restarts it clean.
  const startFresh = async () => {
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
      // Preload one of each thing (project / experiment with an image / list
      // task / single note / multi-entry note / purchase items) so the fresh
      // session is testable immediately.
      await seedEphemeralWorkspace(username);
      // Land in the app. A fresh Incognito briefly looks like a "new visitor"
      // and the gate can redirect to the sticky /welcome route mid-flow; now
      // that a user is signed in, "/" renders the app home. Client-side nav
      // (not a reload) so the in-memory OPFS connection is preserved (the
      // ephemeral handle is intentionally not persisted).
      router.replace("/");
      setBusy(false);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Ephemeral dev sign-in failed.");
      setBusy(false);
    }
  };

  // In a real (disk) session there is nothing to offer. The start button shows
  // pre-login; the restart button shows only while already inside an ephemeral
  // session, so it never wipes a real folder.
  if (currentUser && !inEphemeralSession) return null;

  const restart = currentUser && inEphemeralSession;

  return (
    <div className="flex max-w-xs flex-col items-start gap-1.5">
      {msg && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-meta text-amber-800 shadow-lg">
          {msg}
        </div>
      )}
      <button
        type="button"
        onClick={startFresh}
        disabled={busy}
        title={
          restart
            ? "Wipe and restart the ephemeral session with fresh seed data"
            : "Start a throwaway in-browser session, preloaded with sample data"
        }
        className="pointer-events-auto rounded-full bg-brand-action px-4 py-2 text-meta font-semibold text-white shadow-lg transition-all hover:scale-[1.03] hover:bg-brand-action/90 disabled:opacity-60"
      >
        {busy
          ? restart
            ? "Restarting..."
            : "Starting..."
          : restart
            ? "Dev: restart fresh session"
            : "Dev: fresh ephemeral session"}
      </button>
    </div>
  );
}
