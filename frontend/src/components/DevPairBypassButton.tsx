"use client";

import { useCallback, useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { usersApi } from "@/lib/local-api";
import { createLocalIdentity, loadIdentity } from "@/lib/sharing/identity/storage";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";

/**
 * Dev-only one-click sign-in that skips the whole account ceremony (the OAuth
 * front-gate, the non-skippable recovery-code step, the "3rd factor") so a
 * phone can be paired against a freshly connected dev folder.
 *
 * On a fresh dev folder it mints a LOCAL keypair once (no recovery code shown,
 * no OAuth) and signs straight in. Reloads auto-restore the same key from
 * IndexedDB via IdentitySessionRestorer, so a re-run reuses the identity and a
 * paired phone stays paired. When the folder already holds a real locked
 * account it refuses (so it never clobbers a recoverable keypair) and points
 * at the real login.
 *
 * Renders nothing in production. Next.js inlines the literal "development" at
 * build time, so the whole component is dropped as dead code in prod builds.
 * The real login flow is untouched and still requires the full ceremony.
 */
export default function DevPairBypassButton() {
  if (process.env.NODE_ENV !== "development") return null;
  return <DevPairBypassInner />;
}

function DevPairBypassInner() {
  const { setCurrentUser } = useFileSystem();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { users } = await usersApi.list();
      const username = users[0] ?? "Dev";
      if (!users.includes(username)) {
        await usersApi.create(username);
      }
      // Reuse an existing unlocked key (session or IndexedDB) so a re-run keeps
      // the same identity and the phone stays paired. Only mint when there is
      // no key in hand AND no on-disk account that minting would clobber.
      const existing = await loadIdentity();
      if (!existing) {
        const sc = await readSharingIdentity(username);
        if (sc?.recoveryBlob) {
          setMsg(
            `"${username}" already has a locked account. Use the real login + recovery code, or connect a fresh folder for a dev identity.`,
          );
          setBusy(false);
          return;
        }
        await createLocalIdentity(username);
      }
      await usersApi.login(username);
      await setCurrentUser(username);
      // setCurrentUser flips page.tsx into the app; no further navigation needed.
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Dev sign-in failed.");
      setBusy(false);
    }
  }, [setCurrentUser]);

  return (
    <div className="fixed bottom-20 left-4 z-50 flex max-w-xs flex-col items-start gap-1.5">
      {msg && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-meta text-amber-800 shadow-lg">
          {msg}
        </div>
      )}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="pointer-events-auto rounded-full border border-dashed border-sky-400 bg-white px-4 py-2 text-meta font-semibold text-sky-600 shadow-lg transition-all hover:scale-[1.03] hover:text-sky-700 disabled:opacity-60"
      >
        {busy ? "Signing in..." : "Dev: skip setup + pair"}
      </button>
    </div>
  );
}
