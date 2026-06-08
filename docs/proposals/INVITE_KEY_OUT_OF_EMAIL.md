# Taking the invite key out of the email (P1-A)

Status: ACCEPTED 2026-06-08. Grant signed off on Option 2 (keyless branded email,
sender delivers the key out of band) with both a full private link AND a short
unlock code as the out-of-band format. Ready to build.
Owner: security follow-up (HR)
Source: 2026-06-08 sharing-relay audit, finding P1-A.

## What this is about

ResearchOS lets a user share a note, experiment, method, project, or sequence
with someone who is NOT on ResearchOS yet. That is the "invite a non-user" growth
loop (`inviteShare` / `inviteRawShare` in
`frontend/src/lib/sharing/relay/client.ts`). Because the recipient has no identity
keypair, the sender cannot seal to a public key. Instead the sender mints a fresh
one-time XChaCha20-Poly1305 key, seals the item under it, parks the sealed bytes
on the relay (R2), and the recipient needs that one-time key to open it.

Today that key reaches the recipient inside the accept link. The link is
`https://research-os.app/accept/<inviteId>#k=<hexKey>`, and the key sits in the
URL fragment (the part after `#`). The accept page reads the key only from
`window.location.hash` (`frontend/src/app/accept/[inviteId]/page.tsx`), and a
browser never transmits a fragment to a server, so the design intent is that our
infrastructure never sees the key.

## The problem

The intent leaks in one place. The CLIENT composes the full accept URL (key in
fragment) and POSTs it as a plain body field to
`/api/relay/invite/confirm` (`frontend/src/app/api/relay/invite/confirm/route.ts`),
which hands it to Resend so the branded email can carry a clickable link
(`frontend/src/lib/sharing/relay/mailer.ts`). So for the invite path the one-time
key does:

1. Travel as a request body through the Vercel function (transient memory). The
   route is careful never to log it, so this is ephemeral, not retained.
2. Land in the email body that Resend sends, and therefore in Resend's
   email-activity log, which Resend retains for roughly 30 days.

That second hop defeats the end-to-end intent for the invite path. Anyone with
access to the Resend account (Resend staff, a compromised Resend API key, a
subpoena to Resend) can read both the parked-item's deep link and its decryption
key for the retention window, and the relay still holds the sealed bytes, so the
two together open the content.

Scope note. This is the INVITE (keyless) path only. The registered-to-registered
send path (`/api/relay/send`, `sendShare` / `sendRawShare`) seals to the
recipient's published X25519 public key and never emails a key, so it stays
E2E-blind and is out of scope here. P1-B (storage-budget bypass) from the same
audit is already fixed and tested separately.

## Threat model

Assets.

- The one-time symmetric key K for a single invite.
- The sealed item bytes parked on R2 under the bearer `inviteId`.

Who we are defending against, and what changes.

- Resend (the email provider) and anyone who reads Resend's stored activity.
  Today they can recover K from the stored email body. This is the leak P1-A is
  about. Removing K from the email closes it.
- Our own Vercel function logs / memory. Today K transits memory but is never
  logged. Low residual risk, but a future logging change or a memory-dump
  incident could expose it. Removing K from the request body closes it too.
- The relay / R2 operator (us). The relay holds only sealed bytes and never the
  key, in every option below. We must NOT introduce a design where the server can
  reconstruct K, or we trade a Resend-retention leak for a worse "the host can
  decrypt" property.
- Anyone who can read the recipient's email. In EVERY design where the recipient
  is keyless, whoever controls the channel that carries K can open the data. That
  is inherent to inviting someone who has no key yet. The goal is not to defeat
  this, it is to make sure that channel is NOT a system we operate and log.

Explicit non-goal. We are not trying to make a keyless invite as strong as a
registered send. We are trying to ensure the decryption key never rests in a
service we run or contract (Resend, Vercel), so the relay's "we cannot read your
data" claim holds for the invite path the way it already does for the send path.

## The constraint that shapes every option

For a brand-new non-user there is no pre-shared secret and no published key, so K
has to travel to them somehow. Three properties are in tension and you cannot keep
all three at once.

- Single channel. The recipient gets everything from the one branded email.
- Relay stays blind. Our server can never reconstruct K.
- Immediate delivery. The recipient can open the item right away, with no waiting
  on the sender to come back online.

The reason is simple. If any decryption-sufficient material is in the email body,
it transits Resend and is retained, so "key out of Resend" forces that material
out of the email. Once it is out of the email, the recipient (who has no other
secret with us) must get it from somewhere else, which is either a second channel,
or their own newly created identity. Every real option gives up exactly one of the
three properties. The three named options map onto exactly that choice, and a
"split-key" scheme does not escape it (see Option 3).

## Options

### Option 1. Register first, then deliver the key to the established identity

The email carries NO key, only "X wants to share <title> with you, create a free
account to receive it." The recipient lands on the accept page, creates their
sharing identity through the existing `SharingSetupWizard` (proving the same email
the invite was sent to), and publishes an X25519 public key to the directory. Only
then does the parked item become openable. This effectively converts a keyless
invite into the registered-send path, deferred until the recipient has a key.

The hard part is who re-seals the parked bytes to the recipient's brand-new public
key, because re-sealing needs either the plaintext or K, which only the sender's
device holds.

- 1a, sender re-seals when next online. The sender's device keeps a "pending
  invites" list (K or the plaintext bundle, local only). When the recipient
  registers, the sender is notified and performs a normal registered send.
  Relay stays fully blind, this is the strongest crypto. But delivery is deferred
  and unreliable, the sender may never return, and it needs new local state plus a
  notify/poll mechanism.
- 1b, server-mediated re-key at registration. The confirm route stores K wrapped
  under a server-held KMS key (never plaintext). When the recipient registers and
  proves the invite's target email, the server unwraps K in memory, re-seals it to
  the recipient's new public key, and discards the plaintext. K never touches
  Resend and is never persisted in the clear. BUT the server now holds wrapped-K
  plus the sealed bytes, so it CAN decrypt the item. That breaks the relay's blind
  property, which is arguably a bigger regression than the Resend leak we are
  fixing. Not recommended.

Removes key from Resend/Vercel: yes (no key in the email at all).
Relay stays blind: yes for 1a, no for 1b.
UX for a brand-new non-user: highest friction, the recipient must create an
account BEFORE they can even preview the item, so we lose the "see the note, then
decide to sign up" hook that makes the loop convert. 1a additionally makes
delivery feel slow or broken when the sender is offline.
Implementation cost: high. Pending-invite local store, a re-key/notify path, and
changes to the accept flow ordering.

### Option 2. Email is a keyless branded landing, the sender delivers the key out of band

The email carries only `https://research-os.app/accept/<inviteId>` with NO
fragment, so Resend stores a keyless link. The client still mints K and uploads
the sealed bytes exactly as today, but it does NOT send K to the confirm route.
Instead, after a successful invite, the sender's own ResearchOS UI shows the
sender the complete private link (`/accept/<id>#k=<key>`) or a copyable unlock
code, with the instruction "send this to <recipient> yourself (Slack, text, in
person)". The recipient opens the item in one of two ways.

- They click the sender-delivered private link directly (fragment present), which
  skips the email entirely, or
- They click the keyless email link, the accept page detects no fragment and
  shows a "paste the unlock code the sender sent you" field, and pasting it
  reconstructs the fragment client-side and decrypts.

Removes key from Resend/Vercel: yes. The confirm route never receives K, the
email body never contains K.
Relay stays blind: yes, no change to the crypto or the relay's data model.
UX for a brand-new non-user: the recipient experience is unchanged once they have
the code (still a zero-account preview, then sign up to keep). The cost is on the
SENDER, who now does a second manual send. Honest framing, the key IS the
capability and whoever holds it holds the data, we are only moving that channel
off the systems we log. A sender who pastes the full link into an insecure channel
is making that choice outside our infrastructure, which is strictly better than us
retaining it.
Implementation cost: moderate. Drop `acceptUrl` from the confirm body and have the
route build the keyless link from the `inviteId` it already has, return the
full private link (or code) from `inviteShare` / `inviteRawShare` to the caller,
add a "share this link / copy code" panel to the send-invite UI, and add a
"paste unlock code" state to the accept page.

### Option 3. Split-key or wrapping so the email fragment alone is insufficient

The idea is to put a partial key in the email and require a second piece the
recipient supplies. For a keyless non-user this does not produce a new option, it
collapses into one of the others, and it is worth writing down why so it is not
revisited.

- If the email half is decryption-relevant on its own (combined with anything the
  server stores), then that half still transits Resend and is retained, so we have
  not actually removed key material from Resend. No gain.
- If the second piece is something the recipient must obtain independently, then
  for a brand-new non-user that piece can only be (a) an out-of-band secret the
  sender conveys, which is exactly Option 2 with extra steps, or (b) derived from
  their newly created identity, which is exactly Option 1.
- A "fetch the key half from our server once" endpoint would mean the server
  stored a sufficient half, so the server could decrypt, which breaks blindness
  like Option 1b.

So Option 3 is dominated. It either fails to remove the key from Resend, or it
reduces to Option 2 or Option 1. Not recommended as a distinct path.

## Comparison

| Property | Today | Option 1a | Option 1b | Option 2 |
| --- | --- | --- | --- | --- |
| Key absent from Resend log | no | yes | yes | yes |
| Key absent from Vercel function | no (transient) | yes | yes | yes |
| Relay/server cannot decrypt | yes | yes | NO | yes |
| Zero-account preview before signup | yes | NO | NO | yes |
| Single channel (email only) | yes | yes | yes | NO (sender sends key) |
| Immediate delivery | yes | NO (deferred) | yes | yes |
| Implementation cost | n/a | high | high | moderate |

## Recommendation

Adopt Option 2 as the fix, and treat Option 1a as the longer-term maximal path
that converges with the registered-send and external-collab work already
designed.

Why Option 2 now.

- It actually removes the key from Resend and from the Vercel request body, which
  is the whole point of P1-A.
- It keeps the relay fully blind, with no new "the host can decrypt" property. It
  does not regress the security model the way Option 1b would.
- It preserves the growth-loop hook, the recipient can still preview the item
  with no account and decide to sign up.
- It is honest about the trust boundary. A keyless invite is inherently "whoever
  holds the key holds the data". We are not pretending otherwise, we are moving
  that key off the channels we operate and log.
- Moderate, well-contained implementation cost.

The one real downside is sender friction (a second manual send). That is the price
of not having the recipient establish a key first, and it is a smaller cost than
Option 1's "create an account before you can see anything" wall.

Why Option 1a later, not now.

When the recipient eventually becomes a registered user (which the loop is trying
to make happen anyway), a deferred registered send is the strongest possible
delivery and shares all its machinery with the external-collab initiative
(`docs/proposals/EXTERNAL_COLLAB_SHARING.md`). It is worth building once that
surface exists, as an upgrade, not as the P1-A patch.

## Recommended path, in detail (Option 2)

Crypto and relay. Unchanged. The client still calls `sealUnderOneTimeKey`,
uploads the sealed bytes to the presigned R2 URL, and the relay still holds only
opaque bytes under a server-generated `inviteId`.

Confirm route (`/api/relay/invite/confirm`).

- Stop accepting `acceptUrl` in the body. Build the email's link from the
  `inviteId` it already verifies, as a keyless `<<origin>>/accept/<inviteId>`.
- The mailer's "do not log the link" and content-minimization comments can be
  simplified, the link no longer carries a secret.

Mailer (`mailer.ts`).

- The accept link in the email is keyless. The body copy changes from "click to
  open" to "X shared <title> with you, they will send you a private link or unlock
  code to open it, create your free account here". Keep CAN-SPAM footer as is.

Client (`inviteShare` / `inviteRawShare`).

- Keep composing the full private link with the fragment, but RETURN it to the
  caller instead of sending it to the confirm route. Something like
  `{ inviteId, expiresAt, privateLink, unlockCode }`.

Send-invite UI (the component that calls `inviteShare`).

- After a successful invite, show the sender a "copy this private link / unlock
  code and send it to <recipient> yourself" panel, with copy buttons and a one-
  line explanation of why (the link is the key, keep it off public channels).

Accept page (`accept/[inviteId]/page.tsx`).

- When the URL has a valid fragment key, behave exactly as today.
- When the fragment is missing or malformed, instead of the current "this link is
  incomplete" dead end, show a "paste the unlock code the sender sent you" input.
  A valid 64-hex code reconstructs the fragment client-side and proceeds. This is
  a small addition to the existing `readFragmentKey` / `bad-link` handling.

Tests and docs.

- Update the invite client tests and confirm-route tests for the dropped
  `acceptUrl` and the keyless email link.
- Update the inline header comments in client.ts, the confirm route, and mailer.ts
  that currently describe the key traveling in the email link.
- Update the wiki / sharing copy that promises end-to-end encryption to describe
  the invite path's out-of-band key step accurately.

## Decisions (signed off 2026-06-08)

1. Path. Option 2, out-of-band key with a keyless branded email. Option 1a is
   noted as a future upgrade alongside external collab, not part of this fix.
2. Out-of-band format. BOTH, the sender is shown a full private link (one-click
   for the recipient) AND a short copyable unlock code (for the "paste on the
   accept page" flow).
3. Email CTA wording. Still to be finalized at build time, the email says the
   sender will send a separate private link or unlock code rather than the email
   itself opening the item. Minor copy, no security bearing.

Signed, security follow-up (HR).
