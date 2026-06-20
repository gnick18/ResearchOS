# Revisiting OAuth key escrow: auto-restore the key, retire the scary recovery-code modal

Status: PROPOSAL, 2026-06-20. Decision-gated on Grant. Revisits the OPEN ITEM in
`IDENTITY_OAUTH_ONLY.md` ("escrow keypair in cloud under OAuth" was DECLINED
2026-06-08, "revisit only if cross-device friction is a real complaint"). Grant
raised it 2026-06-20 on seeing the "Set up sharing" wizard show a recovery code.
Author: BeakerAI lane (orchestrator).

House voice applies. No em-dashes, no emojis, no mid-sentence colons.

## The goal

Make signing in with the third party (Google / GitHub / ORCID / LinkedIn) enough
to get your encryption key back on a new device, so the user never has to write
down or paste a recovery code in the common case. Concretely, remove (or hide
behind an "advanced" disclosure) the "save this code or lose everything, it
cannot be recovered" modal that the wizard shows today.

## Why it is not already this way

The key is end-to-end encrypted. Today the flow on a new device is:

1. OAuth proves your email and fetches your encrypted `key_backup_blob` from Neon
   (`/api/directory/my-backup`, `cloud-restore.ts`).
2. You type your recovery code, and the client unwraps the blob locally
   (Argon2id over the mnemonic, `backup.ts`).

OAuth gets you the locked box. The recovery code is the only key to it, and that
is deliberate, the server can never read the box. So "OAuth alone restores the
key" is not a UI tweak. It requires that SOMETHING OTHER THAN a secret the user
holds can open the box. That something is either another device the user controls,
or a server / managed-key service we control. That is the whole tradeoff, and it
is a real one.

## The spectrum (security on the left, convenience on the right)

### A. Current: recovery code (full E2E)
The user holds the only unwrap secret. The server, the OAuth provider, and a Neon
breach all learn nothing. Cost: the scary modal, and a lost code means a lost key.
This is the baseline we are trying to soften.

### B. Device-to-device approval (E2E preserved, needs one existing device)
Model the way Signal / WhatsApp add a device. A new device generates its own
keypair, OAuth proves identity, and an EXISTING signed-in device re-wraps the
account key to the new device's public key (the re-wrap can be brokered through
the relay so the two devices need not be online at once, the ciphertext is only
openable by the new device). No recovery code in the common case, and the server
still never sees plaintext. Cost: only works if you still have at least one
active device. The zero-device case (new laptop, old one dead, never paired a
phone) still needs a lifeboat, so the recovery code stays but moves to an
"I have no other device" fallback, not the default screen.

### C. Managed key infrastructure gated by OAuth (middle, adds a vendor)
A key-infra provider (AWS KMS + Cognito, Google Cloud KMS, or an embedded-wallet
vendor like Turnkey / Privy) holds a wrapping key and releases an unwrap only
after a valid OAuth session, ideally inside an enclave so even the vendor cannot
read the key. This is the closest thing to "OAuth alone, still not full escrow,"
but it introduces a third party in the trust path and real integration + cost.
`IDENTITY_OAUTH_ONLY.md` already noted Vercel has no trusted-execution hardware,
which is why a Signal-SVR-style self-hosted version is off the table, this option
is buying that capability from a vendor.

### D. Server-side escrow gated by OAuth (max convenience, server can decrypt)
We wrap the key under a key WE hold (or our KMS holds), release it after OAuth.
Simplest to build, and it matches the mental model exactly, sign in and your key
is just there. The honest cost: ResearchOS LLC can technically decrypt a user's
key at recovery time, so it is no longer end-to-end against us. For a paid lab
product where we are already the data processor and the relay operator, this may
be an acceptable, clearly-disclosed tradeoff. It is NOT acceptable silently, it
contradicts the local-first / E2E story we tell on the marketing pages, so it
would need explicit copy and arguably an opt-in.

## Recommendation: phased, default-safe, convenience opt-in

1. Phase 1, de-scary without weakening anything. Keep the recovery code as the
   lifeboat but stop leading with it: auto-download the Recovery Kit by default,
   replace the "cannot be recovered" alarm with calm copy, and tuck the raw code
   behind an "Advanced" disclosure. This ships immediately, no crypto change, and
   removes 80 percent of the felt friction. (This is option 2 from the chat, worth
   doing regardless of what follows.)

2. Phase 2, device-to-device approval (option B). Make the DEFAULT new-device path
   "approve from another device," reusing the existing pairing surface in
   `DevicesSection.tsx` and the relay. Recovery code demotes to the explicit
   "I have no other device" branch. This is the biggest real win and it keeps full
   E2E, so it does not cost us the marketing story.

3. Phase 3, OPTIONAL convenience escrow (option D, opt-in). For users who say
   plainly "I would rather trust ResearchOS to hold my key than risk losing it,"
   offer a toggle that escrows the key under our KMS, OAuth-gated. Off by default,
   disclosed in plain language (we can recover your key, which also means we
   technically can read it). This satisfies the "sign in and it is just there"
   crowd without forcing the tradeoff on everyone.

Net: the scary modal goes away for everyone in Phase 1, the common multi-device
case needs no code at all after Phase 2, and the people who want pure convenience
get it explicitly in Phase 3 without us quietly breaking E2E for the whole base.

## Code surfaces (for scoping, not a build list yet)

- `SharingSetupWizard.tsx` and the publish/recovery modal copy (Phase 1).
- `recovery-kit.ts` auto-download default (Phase 1).
- `DevicesSection.tsx` + the mobile-relay pairing client + a new key-rewrap broker
  on the relay (Phase 2).
- `cloud-restore.ts` + `/api/directory/my-backup` (both phases, new branches).
- A new escrow blob + KMS integration + a `key_escrow` column or table, plus the
  opt-in setting (Phase 3). FLAG: this is new server-stored key material and a
  schema add, pre-flag before building.

## Open decisions for Grant

1. Is Phase 1 (soften the modal, auto-save the kit) a yes to ship now on its own?
2. For Phase 2, is "approve from another device" the model you want, and do we
   count a paired phone as an approving device?
3. For Phase 3, do you want a true convenience escrow at all, and if so is it
   opt-in only (recommended) or the default for lab accounts?
4. Vendor appetite: are you open to a managed-key vendor (option C) if it buys
   enclave-grade "OAuth alone, we still cannot read it," or do you prefer to stay
   on our own Neon + KMS (option D) and accept the disclosed tradeoff?

Related: `[[project_require_account_local_first]]`, `[[project_cloud_accounts_local_data]]`,
`[[project_researcher_social_layer]]` (provider rebind), `docs/proposals/IDENTITY_OAUTH_ONLY.md`.
