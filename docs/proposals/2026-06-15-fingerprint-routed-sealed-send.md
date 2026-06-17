# Fingerprint-routed sealed send — seam + deferred-build design (2026-06-15)

**Status:** contract LOCKED, relay build DEFERRED to a focused security-reviewed pass (Grant 2026-06-15). This is the social build-plan's "C2" (Popup Unifier authors the backend, INJEST consumes in the UI). Goal: a researcher found on `/network` can be sent work in **one click, no email typed**.

## The friction (today)
The relay mailbox is **email-hash-keyed**. `sendShare` (`lib/sharing/relay/client.ts`) takes `recipientEmail` → `POST /api/directory/lookup` → seals to the returned x25519 key → `POST /api/relay/send`, which canonicalizes + `hashEmail`s the recipient and resolves `getBindingByHash(recipientHash)`, depositing to a mailbox row keyed by `recipientEmailHash`. So even though directory **search already returns the recipient's fingerprint + published x25519 key**, the sender must still know/type the email. That kills seamlessness.

## The unlock
Route the SEND by **fingerprint** (which search has) instead of a sender-typed email. The mailbox stays email-hash-keyed and the recipient's inbox + quotas are **unchanged**; only the sender's *addressing* changes, and the recipient's email is **never exposed to the sender** (the server resolves fingerprint → mailbox hash internally).

## Contract (what INJEST builds against — STABLE)
Client (my tree, `lib/sharing/relay/client.ts`):
```ts
sealedShareByFingerprint({
  senderEmail: string,           // sender's own verified email (signs the request)
  recipientFingerprint: string,  // from directory search — the only recipient id needed
  bundle: ShareBundle,           // the per-entity bundle the existing builders produce
}): Promise<SendResult>          // same shape sendShare returns
```
- Handle-only recipients with **no published key** are out of scope here — they keep the existing one-time **invite-link** fallback (`inviteShare`), unchanged.
- `FindAndShareModal` gains an **additive** `initialRecipient?: { fingerprint, displayName, x25519PublicKey }` prop (I own it — it's my component) so a found researcher is pre-picked; existing callers are untouched.

INJEST side: a recipient-first **"Share work with [name]"** front door on the researcher profile (runs **in-app**, where the sender has a folder + sharing identity; the public `/network` is discovery-only) → object picker → `sealedShareByFingerprint`.

## Deferred relay build (my tree — held for security pass)
1. **`getBindingByFingerprint(fp)`** on `directory_identities` (already carries fingerprint + emailHash + keys). Add a fingerprint index. Returns the binding (incl. `emailHash`) without exposing the email.
2. **`/api/relay/send`**: accept a **signed** `recipientFingerprint` as an alternative to `recipientEmail`. The signed request schema gains the field; the signature must cover it (design the canonical message together so old `recipientEmail` sends still verify). Resolve `getBindingByFingerprint` → `recipientHash` → existing deposit path. Per-recipient count + byte caps and the per-IP limit are unchanged (keyed by the resolved `recipientHash`).
3. **Client** `sealedShareByFingerprint` mirroring `sendShare` (lookup-by-fingerprint variant: it already has the x25519 key, so it can skip the `/lookup` round-trip).
4. Gate behind the social-layer flags (dark by default).

## Security notes (why this is the part to review carefully)
- It changes the **signed send-request schema** + the relay **delivery** path → review the canonical-message construction so a fingerprint send can't be replayed/cross-bound, and old-shape sends still verify.
- No new enumeration: fingerprint → keys is already public via `/api/directory/researcher`; fingerprint → emailHash stays **server-internal** (email never returned).
- Mailbox quotas/caps unchanged (keyed by the resolved recipient hash), so the anti-spam ceilings still hold.

## Why deferred
Registered-to-registered relay delivery + a signed-schema change is exactly the kind of surface that wants a deliberate security pass, not an end-of-session build. The contract above is stable, so INJEST can build the front door now; the relay backend lands in a focused pass.
