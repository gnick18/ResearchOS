# Lab Tier: membership + invite-by-email + OAuth binding (Phase 8)

Status: DRAFT for sign-off (SHARING + COLLAB manager, 2026-06-08). Answers Grant's two questions directly: (1) how OAuth login is actually tied to joining a lab, and (2) PIs inviting members by typing an email. This is the MEMBERSHIP layer on top of the now-working login + data plane.

Siblings: `LAB_SESSION_PHASE5.md` (the login, built + live-verified), `CROSS_BOUNDARY_SHARING_INVITE.md` / `INVITE_KEY_OUT_OF_EMAIL.md` / `EXTERNAL_COLLAB_SHARING.md` (the existing invite/inbox/directory infrastructure this REUSES).

## The honest gap this closes
What we built: a lab exists, a member's keypair opens the lab key, the server-blind data plane round-trips. But two things are NOT yet real:
- The OAuth login is a SOFT gate (the `authenticate` effect returns whatever email the session has; it does not check that email against the lab or the keypair). The KEYPAIR is the real access control today; OAuth is unbound.
- There is NO invite-by-email. `addMember` seals the lab key to a member's X25519 PUBLIC KEY, not an email; nothing resolves an email to a member or runs the invite handshake.

## The one idea that ties it together: the OAuth-verified email is the identity anchor
A person's verified email is the single thread connecting every layer:
- INBOX: addressed by `hashEmail(email)` (the relay's `/inbox/push|list`), so you can deliver an invite to someone by email alone.
- KEYPAIR: a published profile (`publishProfile`) binds the keypair to the OAuth-verified email (established by `claim-oauth`, which mints the keypair against the verified email).
- MEMBERSHIP: the lab key is sealed to that keypair (the roster entry + `addMember`).
- LOGIN: on sign-in, the OAuth-verified email must resolve to the keypair the lab key was sealed to.

So "you must log in with your Google/ORCID to join" becomes meaningful because your verified email is what the invite was sent to, what your profile/keypair is bound to, and what the login checks. OAuth is not a decorative gate; it is the proof that the person logging in owns the email the membership was issued to.

## Part 1 (Q2): PI invites a member by email
A two-phase handshake, reusing the existing `/inbox/*` + profile + `addMember` infrastructure (this is the `EXTERNAL_COLLAB_SHARING` / `CROSS_BOUNDARY_SHARING_INVITE` pattern applied to lab membership). Two-phase because (a) the invitee must CONSENT and supply a fresh pubkey, and (b) only the head can sign roster entries.

1. INVITE (PI, online): PI types the invitee's email in an "Invite member" dialog (mirror `SendOutsideDialog`). The client `/inbox/push`-es a signed lab-invite envelope to `hashEmail(invitee_email)` containing: labId, lab name, the head's pubkey + fingerprint, and an issuedAt. The optional email nudge (`notifyOnCollabInvite`) pings the invitee.
2. ACCEPT (invitee, after OAuth login): the invitee reads their inbox at `hashEmail(their_verified_email)`, sees the pending lab invite, and ACCEPTS. Accepting sends their identity back to the head's inbox: their username + X25519/Ed25519 public keys + fingerprint, signed by their keypair (so the head can trust the pubkey is theirs and bound to the inviting email via their published profile).
3. FINALIZE (head, online): the head's client verifies the accept (signature + the invitee's profile binds the accepted email), then runs `addMember(record, labKey, invitee, headEd25519Priv)` -> seals the CURRENT lab key to the invitee's X25519 + `appendAddMemberRemote` (head-signed "add" log entry + the sealed copy). The invitee is now in the roster with a sealed key copy.
4. JOINED: the invitee's next lab login -> `openLabKey` opens THEIR sealed copy -> they are in, and `pullLabView` now surfaces what is shared with them.

Constraint to confirm: the head is the only signer of roster entries, so the head must be online to FINALIZE an add (step 3). Step 1 (invite) and step 2 (accept) are async via the inbox; only the seal needs the head live. (A future "delegated add" could relax this; out of scope here.)

## Part 2 (Q1): the OAuth <-> keypair <-> membership binding
Make the existing login actually enforce identity (this is the deferred decision #4, match-on-login):
- A member's keypair publishes a profile bound to their OAuth-verified email (already true via `claim-oauth` + `publishProfile`).
- On lab login, extend the session so `authenticate` returns the verified email AND `openLabKey` (or a new binding step) verifies: the roster member whose sealed copy we open has a published profile claiming the SAME verified email. If the OAuth email does not match the membership's bound email -> REJECT (no silent takeover). 
- Net effect: you can only unlock a lab membership by logging in with the email that membership was issued to. The keypair does the crypto; the OAuth email proves the human.

Edge: a member who has not published a profile (or whose profile email differs) cannot be auto-verified -> fall back to the keypair-only gate with a flag, or block, per the strictness decision below.

## Build phases (sequenced; each flag-gated + testable like Phase 5)
- 8a BINDING: extend the session effects so login verifies OAuth email == roster member's profile email (reject mismatch). Unit-testable; live-testable via the existing harness.
- 8b INVITE SEND: "Invite member by email" action (PI) -> signed lab-invite to `/inbox/push` at `hashEmail(email)`. Reuse `SendOutsideDialog` UX + the inbox client.
- 8c ACCEPT + FINALIZE: invitee "Pending lab invites" inbox UI -> accept (send signed identity back) -> head's client finalizes via `addMember` + `appendAddMemberRemote`.
- 8d INVITE UX: the PI invite dialog + the invitee accept surface, wired into the (gated) lab app.
- 8e EDGE: invitee has no ResearchOS identity yet -> an invite-to-onboard path (the invite email links them to set up an identity, then accept). Reuse the existing identity setup.

## Open decisions for Grant
1. HANDSHAKE SHAPE: two-phase (invite -> invitee accepts with a fresh pubkey -> head seals) [recommended: consent + fresh key + reuses the proven cross-boundary pattern] versus one-phase (PI looks the invitee up in the directory and seals immediately). One-phase needs an email->keypair directory index (today the directory is fingerprint-keyed), and it seals without the invitee's live consent. Recommend two-phase.
2. HEAD-ONLINE-TO-FINALIZE: accept that the head must be online to complete an add (the head is the only roster signer), or invest in a delegated/async add mechanism now? Recommend accept-for-now.
3. BINDING STRICTNESS: on an OAuth-email/membership mismatch, hard-REJECT the login [recommended, true to "no silent takeover"] versus warn-and-allow. And: block login for a member with no published profile, or allow keypair-only with a notice?
4. INVITE TO A NON-USER: support inviting someone with no ResearchOS identity yet (invite-to-onboard, 8e), or require the invitee already have an identity? Recommend support it (it is how real labs onboard students), but it can be a later sub-phase.
5. PROVIDER: any verified-email provider is acceptable (the email is the anchor, per locked decision #1) -> the invite + binding key off the email, not the provider. Confirm.

## Why this is tractable
Every primitive exists: `/inbox/push|list|dismiss` (email-addressable delivery), `publishProfile`/`fetchProfileByFingerprint` (the email<->keypair directory), `sealToRecipient`, `addMember` + `appendAddMemberRemote` (seal + roster append), and the `SendOutsideDialog` UX to mirror. Phase 8 is composition + the binding check + the invite UX, not new cryptography.
