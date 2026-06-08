# Lab Tier Phase 5: the OAuth-gated lab session

Status: DECISIONS LOCKED by Grant 2026-06-08. Build in progress (SHARING + COLLAB manager), starting with the pure core. See "Decisions (LOCKED)" + "Build sequencing" below.

Sibling docs: `LAB_TIER_REDESIGN.md` (the pivot + the five locked decisions), `IDENTITY_OAUTH_ONLY.md` (the existing keypair-first identity model). This doc covers ONLY the lab session, the runtime layer that the data plane (Phase 3) has been waiting on.

## The one-sentence version

For a LAB account, opening ResearchOS requires an online OAuth sign-in, and that sign-in unlocks the member's existing local keypair, which in turn opens the lab key, which puts the sync engine into motion. For a SOLO account nothing changes, there is no login at all.

## Why this is smaller than it sounds

The pivot wording ("lab members log in via OAuth") reads like a new auth system. It is not. Almost every piece already exists and Phase 5 mostly composes them.

Already built and reused as-is:
- NextAuth OAuth with Google, GitHub, ORCID, LinkedIn (`lib/sharing/auth.ts`, `lib/sharing/oauth-availability.ts`).
- The OAuth-to-keypair flow (`lib/sharing/claim-oauth.ts`): sign in with a provider, return with a verified email, mint or match the local keypair, seal it.
- Passkey-PRF unlock and recovery-code fallback for the keypair private key (`lib/sharing/identity/passkey.ts`, `recovery-code.ts`, `session-key.ts`, `webauthn.ts`).
- The lab key itself, sealed to each member's X25519 public key and opened with their X25519 private key (`lib/lab/lab-key.ts`, `distributeLabKey` / `openLabKeyCopy`), with the sealed envelopes living in the Lab Record DO (Phase 1).
- The whole server-blind data plane (Phase 3 chunks 1, 2a, 2b-enumerate, plus tombstones and the local-api adapter now in flight).

The genuinely NEW work in Phase 5 is a single state machine and the gating around it, described next.

## The crucial reconciliation: OAuth gates, the keypair owns

This is the part to get right, because the existing identity model and the pivot pull in opposite directions and they must be reconciled, not chosen between.

- Existing model (solo, sharing): the ACCOUNT is a local Ed25519/X25519 keypair created offline. OAuth is an OPTIONAL extra used only to publish a findable directory profile. The keypair is primary, OAuth is garnish.
- Phase 5 (lab tier): OAuth becomes REQUIRED to start a lab session. But it does not replace the keypair. The keypair is still the cryptographic identity, because the lab key is sealed to the member's X25519 key and only that private key can open it. OAuth proves "you are the person behind this account" so we are willing to start an online session and unlock the keypair, the keypair does the actual crypto.

So the layering is:

```
OAuth sign-in (session gate, proves identity, online)
        |
        v
unlock the keypair private key (passkey-PRF, or recovery code)
        |
        v
fetch this member's sealed lab-key envelope from the Lab Record DO
        |
        v
openLabKeyCopy(x25519Priv) -> the 32-byte lab key, in memory
        |
        v
lab session is LIVE: { labId, labKey, ed25519 signing key } held in memory
        |
        v
the Phase 3 sync engine can now push/pull (2b-bind wires the trigger here)
```

OAuth never touches the lab key. The relay never sees it. This keeps the server-blind property from Phase 3 fully intact, OAuth is purely an entry turnstile.

## Account types, and what each requires

Solo account:
- Local keypair, created offline. No OAuth. No online requirement. Fully offline, free.
- Exactly today's solo identity. Phase 5 does not touch it beyond making sure the lab gate never triggers for solo.

Lab account (a member or the head/PI):
- Local keypair PLUS a required OAuth session to use the app online.
- The lab key is in memory only while the session is live.
- Offline is out of scope by design (locked decision), a lab account that cannot reach OAuth or the relay is in a degraded read-only state, not a working offline mode.

Open question flagged below: where the app reads "is this a solo or lab account" from. The honest answer is we need a small account-type marker plus the Lab Record DO membership as the source of truth.

## The lab session state machine (the new module)

A new `lib/lab/lab-session.ts` (plus a React context/provider) holding:

```
type LabSessionState =
  | { kind: "solo" }                              // no gate, ignore everything below
  | { kind: "locked" }                            // lab account, not yet signed in
  | { kind: "authenticating" }                    // OAuth round-trip in progress
  | { kind: "unlocking" }                         // OAuth done, unlocking the keypair
  | { kind: "live"; labId; labKey; signingKeyPair; member }  // ready, keys in memory
  | { kind: "expired" }                           // OAuth session lapsed -> re-gate
```

Transitions:
- App open on a lab account -> `locked`. Render the lab sign-in gate (reuse the existing provider buttons), block lab surfaces until `live`.
- Provider chosen -> `authenticating` via the existing `signIn(provider)`. On return, NextAuth gives the verified email (same as `claim-oauth`).
- Verified email maps to the local keypair -> `unlocking`. Unlock the keypair private key with passkey-PRF (one tap), recovery code as fallback. This reuses `session-key.ts` so the private key is held the way the existing identity system already holds it.
- Fetch the member's sealed lab-key envelope from the Lab Record DO (`/lab/get`), `openLabKeyCopy` -> `live`, holding `{ labId, labKey, signingKeyPair }`.
- On logout, idle timeout (if enabled), or a lapsed NextAuth session -> drop the keys from memory, go to `expired` / `locked`.

The sync trigger (2b-bind) subscribes to this: it only runs while the session is `live`, and it reads `labId` / `labKey` / `signingKeyPair` straight from the session rather than threading them through every call.

## Security properties to preserve

- The lab key lives in memory only, never written to disk in the clear. On `expired` / logout it is zeroed. (Reuse the session-key handling that already does this for the identity private key.)
- The relay stays server-blind. OAuth adds an identity gate at the app, it does not give the server any new read power.
- OAuth email binds to the keypair on first lab sign-in (the `claim-oauth` flow already mints/seals at first verified email). Later sign-ins must resolve to the SAME keypair, a different email cannot silently take over a member slot. This binding check is one of the decisions to confirm.
- The PI (head) follows the same flow. The head's comprehensive access comes from the lab key (the head holds a copy of every generation, Phase 1), not from any OAuth superpower. OAuth just gates the head's session like anyone else's.

## What Phase 5 deliberately does NOT do

- It does not build metered billing (Phase 6) or the migration/cutover that deletes the old multi-user-in-one-folder model (Phase 7).
- It does not add real-time co-editing (that remains a later CRDT layer on top of the mirror).
- It does not change solo accounts.

## Suggested build slices (each its own flag-gated, testable chunk)

1. Account-type resolution + the `solo | lab` distinction surfaced to the app (small, unblocks the gate).
2. The `lab-session.ts` state machine + provider, pure where possible, unit-tested with the OAuth and unlock steps injected.
3. The lab sign-in gate UI (reuse existing provider buttons + passkey unlock), shown only for lab accounts when not `live`.
4. Wire 2b-bind: the sync trigger reads keys from the live session and pushes via the Phase 3 engine. This is where the data plane finally runs end to end.
5. Expiry / idle / logout handling and the degraded read-only state.

## Decisions (LOCKED by Grant 2026-06-08)

1. PROVIDERS. Enable ALL of them at launch: Google, ORCID, GitHub, LinkedIn, and Microsoft. The first four are already scaffolded in NextAuth; Microsoft must be ADDED (the scaffolding currently lists LinkedIn, not Microsoft). Provider availability still degrades gracefully when a deployer has not configured a provider's credentials (`oauth-availability.ts`).
2. KEYPAIR UNLOCK IN A LAB SESSION. Passkey-PRF as primary unlock, recovery code as fallback (reuse the existing `lib/sharing/identity/*` layer), re-unlock on each app open. Built on the existing `session-key.ts` keypair-session state.
3. OAUTH SESSION EXPIRY BEHAVIOR. GRACE PERIOD THEN LOCK. When the NextAuth session lapses, the member keeps working through a soft grace window (default 15 minutes), after which the lab tier locks behind the sign-in gate and the in-memory lab key is zeroed. (Chosen over an immediate hard lock so work is not yanked away mid-thought.)
4. OAUTH-TO-KEYPAIR BINDING. First lab sign-in binds the verified email to the keypair; later sign-ins must resolve to the SAME keypair (no silent takeover). A genuine OAuth-email change is a deliberate re-key/recovery flow, not an automatic rebind (recovery path detailed when the binding slice is built).
5. ACCOUNT-TYPE SOURCE OF TRUTH. Lab Record DO membership (is this keypair a member or head of any lab) is the authoritative signal, plus a small persisted `account_type` marker so the gate can render before any network call. Membership can only UPGRADE solo->lab; a failed network check never downgrades lab->solo (fail-safe). This folds in the deferred identity-model Phase 2 (`account_type -> isLabHead`).

## Build sequencing (post-lock)

These slices are INHERENTLY SEQUENTIAL (each sits on the session state machine) and several touch live shared files (AppShell, providers, `auth.ts`), so they are built in order, not fanned out in parallel:
1. PURE CORE (in progress): `lab-account-type.ts` (resolveAccountType) + `lab-session.ts` (state machine + controller), all external effects injected, fully unit-tested, new files only. No live wiring.
2. Add the Microsoft NextAuth provider (`auth.ts`) + confirm the four existing providers.
3. Wire the controller's injected effects to reality: `authenticate` -> `signIn(provider)`; `unlockKeypair` -> the passkey-PRF / `session-key.ts` unlock; `openLabKey` -> `getLabRemote` + `openLabKeyCopy`; `resolveAccountType`'s `checkLabMembership` -> `getLabRemote`; the persisted `account_type` marker storage.
4. The lab sign-in gate UI (reuse the sharing provider buttons + passkey unlock), shown only for `LAB_TIER_ENABLED` lab accounts when the session is not `live`.
5. Wire the 2b-bind sync trigger: while the session is `live`, enumerate via `createLocalApiLabWorkSource()` -> `enumerateLabWork` -> `syncLabWorkToMirror` with the session's keys. This is where the whole data plane finally runs end to end.
6. Grace-then-lock expiry handling + the degraded read-only state in the live app.
