# Reload one-click reconnect (findings + flag-gated hardening)

Branch: `feat/reload-one-click-reconnect` (off `origin/main`)
Flag: `NEXT_PUBLIC_LAB_RELOAD_RECONNECT` (default off)
Date: 2026-06-18

## The reported symptom

On research-os.app, a full page reload (or typing a URL) while signed in was
reported to drop the user to the "Sign in to your lab" gate and force a folder
re-pick. In-app router navigation keeps the session; only a full reload loses it.

## What the investigation actually found

The starting assumption was that nothing survives a reload, so we should persist
the directory handle and cache the unlock. Reading the code, both layers already
persist, so the brief's literal asks are largely already implemented, and one of
them (a sessionStorage unlock cache) would have weakened a model that is already
correct.

1. Folder handle. Already persisted in IndexedDB (`research-os-fsa` DB, `handles`
   store). On boot, `file-system-context.tsx` calls `queryPermission({mode:'readwrite'})`
   and silently reconnects when Chrome still remembers the grant. When Chrome
   returns `"prompt"` instead (it drops the grant after some restarts), the boot
   path falls through and sets `lastConnectedFolder`, and both `FolderConnectGate`
   and `AccountHome` already render a one-click "Reconnect <folder>" button that
   calls `reconnectWithStoredHandle()` -> `requestPermission({mode:'readwrite'})`
   on the stored handle, with no OS picker. This is exactly the angle-1 behavior
   the brief asked for, and it is already covered by a unit test
   (`FolderConnectGate.test.tsx`: "calls reconnectWithStoredHandle when the
   Reconnect button is clicked").

   Conclusion: the folder side needs no new code. It needs verification, not
   rebuilding.

2. E2E identity. Already persisted encrypted at rest in IndexedDB, wrapped under
   a non-extractable AES-GCM key (the device vault). `IdentitySessionRestorer`
   rehydrates the in-memory keypair on boot. The raw 32-byte keys are never
   written to disk in plaintext.

3. OAuth. Persisted in NextAuth httpOnly cookies; survives reload.

So the security-correct caching the brief worried about (do not persist private
keys) is already the implementation. Adding a sessionStorage unlock cache would
move key-derived material into weaker storage for no benefit, so we did not do it.

## The actual root cause of the "Sign in to your lab" bounce

`controller.resume()` (lab-session.ts) runs on boot and reaches `live` only if it
gets through three steps:

1. `peekSession()` finds a live OAuth cookie. If there is genuinely no session,
   staying locked and showing the sign-in buttons is correct, not a bug.
2. `unlockKeypair()` confirms the identity is unlocked. This already self-heals
   the race against `IdentitySessionRestorer` by calling `restoreSessionFromStore()`
   itself, so the identity race is already handled.
3. `openLabKey()` re-fetches the sealed key envelope from the relay via
   `getLabRemote()`.

Step 3 is the fragile one. `getLabRemote()` THROWS on a network error or a relay
5xx (lab-do-client.ts: `throw new Error("getLabRemote: relay returned ...")`).
The relay is a Cloudflare Durable Object, separate infrastructure from the Vercel
auth endpoint, so it can be briefly unreachable or lag behind a just-published
record while OAuth and the at-rest identity are both perfectly valid. When that
happens, `openLabKey()` throws, `unlockAndOpen()` catches it and dispatches RESET,
and the gate drops to `locked` with the full sign-in buttons. The lab head has a
local fallback for exactly this (`readPendingGenesis`, used when the relay has no
record yet); regular members had none.

That is the precise way a still-authenticated member gets bounced to "Sign in to
your lab" on reload: a transient relay failure during the resume key fetch.

## The fix (flag-gated)

Generalize the head's existing offline fallback to every member, behind
`NEXT_PUBLIC_LAB_RELOAD_RECONNECT` (default off, so a flag-off build is
byte-for-byte the current behavior).

- On every successful `openLabKey()`, cache the PUBLIC sealed artifacts (the
  head-signed lab record plus this member's current-generation key envelope) to
  the user's own settings under `lab_envelope_cache`. This is best-effort and
  fire-and-forget.
- On a later `openLabKey()`, if `getLabRemote()` throws (relay outage) or returns
  null/empty (record not propagated yet), fall back to the cached artifacts and
  re-derive the lab key offline, exactly as the head already does from pending
  genesis.

New/changed files:

- `frontend/src/lib/lab/config.ts` — new `LAB_RELOAD_RECONNECT_ENABLED` flag.
- `frontend/src/lib/lab/lab-envelope-cache.ts` — new. save/read/clear helpers,
  thin wrappers over user-settings, mirroring `lab-genesis-pending.ts`.
- `frontend/src/lib/lab/lab-session-effects.ts` — `openLabKey()` wraps the relay
  fetch in try/catch (flag-gated), adds the cache fallback for members, and
  writes the cache on success.
- `frontend/src/lib/settings/user-settings.ts` — new optional field
  `lab_envelope_cache` (see data-shape note below).
- Tests: `lab-envelope-cache.test.ts`, `lab-session-effects-reload-reconnect.test.ts`.

## Security tradeoff (documented per the brief)

- The 32-byte lab key is NEVER persisted. It is re-derived in memory from the
  sealed envelope via `openLabKeyCopy`, the same guarantee the head already relies
  on for pending genesis.
- What is cached is only what a blind relay already serves publicly: the
  head-signed record and a sealed-box ciphertext that only this member's X25519
  private key can open. That private key lives only in the in-memory session and,
  at rest, only wrapped under a non-extractable AES-GCM key (device vault). So the
  cache adds no new plaintext-secret exposure.
- The OAuth-email-to-membership binding in `openLabKey` (Phase 8a) still runs
  against the cached record, and `resume()` still requires a live OAuth cookie via
  `peekSession()`. A stale or absent OAuth session therefore cannot open the lab
  from cache. The cache only removes the relay as a hard dependency of the resume
  key fetch; it does not relax authentication.
- We did NOT add any sessionStorage/localStorage caching of identity keys. The
  existing device-vault (encrypted at rest, non-extractable wrap key) is the
  correct mechanism and is untouched.

## Data-shape change (flagged explicitly)

New optional field on `UserSettings`:

```
lab_envelope_cache?: { labId: string; record: LabRecord; envelope: LabKeyEnvelope }
```

It is purely additive and optional, written via the existing `patchUserSettings`
merge, and absent until the flag is on and a lab has been opened at least once. An
undefined value is dropped by `JSON.stringify`, so `clearLabEnvelopeCache` removes
it from disk. No migration is required; an older build simply ignores the field.

## Verification

- `tsc --noEmit`: 0 errors (full project).
- `eslint` on all changed files: clean.
- Unit tests (node project): 19 pass, covering the cache helpers, the
  relay-throws-with-cache reopen, the relay-null-with-cache reopen, the
  cache-on-success write (asserting the lab key is never serialized), the
  no-cache still-rejects case, and the unchanged existing openLabKey behavior with
  the flag off.

Not yet verified end-to-end in Chrome, and why:

- Folder one-click reconnect is pre-existing code (unchanged on this branch) and
  is already unit-tested. Driving the real OS permission re-grant needs a real
  connected folder plus a user gesture on the picker, which is a manual
  Claude-in-Chrome / human pass, not a headless one.
- The lab resume hardening needs a live OAuth provider, a running relay, and a
  real lab membership to exercise. The deterministic proof is the unit suite
  above; a live pass should toggle the relay offline mid-session and reload.

### Manual Chrome repro for the lab path (for a live env with the flag on)

1. Set `NEXT_PUBLIC_LAB_RELOAD_RECONNECT=1` and `NEXT_PUBLIC_LAB_TIER_ENABLED=1`.
2. Sign in, open a lab as a non-head member, reach the workbench (this writes the
   envelope cache).
3. Block the relay (offline the DO, or block `/lab/get` in devtools).
4. Hard-reload. Expected with flag on: the gate resumes to `live` from the cache,
   no sign-in buttons. Expected with flag off: the gate drops to "Sign in to your
   lab" (current behavior).

## Not merged

This is on `feat/reload-one-click-reconnect` for review. The flag is off by
default, so merging is inert until `NEXT_PUBLIC_LAB_RELOAD_RECONNECT` is set.
