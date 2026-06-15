# Lab identity + branding

2026-06-14. Feature branch `lab-identity-branding`.

## Why

A lab's identity is distinct from the PI's name. Dr. Emile Gluck-Thaler (the PI)
runs the "Fungal Interactions Lab" (the lab). Today a lab is auto-created with no
name, no PI title, and no logo, so every member-facing surface can only fall back
to the head's username. That reads like a personal account, not a lab.

This feature gives a lab three cosmetic identity fields plus an optional logo,
and uses them to:

1. Brand the invite / join welcome (the showpiece): a warm "Welcome to the
   {labName}" screen with the PI's name + title, the lab logo, and a custom
   BeakerBot welcome animation.
2. Show the lab logo ambiently on every member's screen (a small mark in the
   app header), so a member always feels they are inside their lab.

## Storage decision: cosmetic branding lives OUTSIDE the signed log

The lab's head-signed membership log (lab-membership.ts canonicalEntryMessage,
re-verified by the relay LabRecordDO) is the access-control source of truth. It
is crypto-load-bearing: every byte the head signs gates who can open the lab key.

Lab branding is COSMETIC. A wrong or spoofed lab name can never grant access, so
it MUST NOT enter the signed log or canonicalEntryMessage. Putting it there would
mean a head-signature ceremony for a name edit and would couple a cosmetic string
to the crypto contract. Instead:

- The three text fields (`lab_name`, `pi_title`, `pi_display`) live in the
  LabRecordDO `meta` table, alongside `head_pubkey` / `lab_id`.
- The logo image lives in the `LAB_DATA` R2 bucket under `logos/<labId>`, with
  `meta.has_logo = "1"` as the presence marker.
- Reads are OPEN (like the existing open `/lab/get` roster read): the branding is
  public-facing by design (it is shown to a not-yet-member on the invite page).
- Writes are HEAD-SIGNED via the existing `requireHeadSig(message, sig, issuedAt)`
  helper, so only the lab head can set the name / title / logo. This reuses the
  exact freshness-windowed Ed25519 scheme the accept-list / dismiss routes use.

No new crypto. No change to lab-key.ts / lab-membership.ts / the signed log.

## Relay endpoints (new)

All on the per-lab `LabRecordDO` (addressed by `?lab=<labId>`).

- `POST /lab/create` (extended, backward compatible): body may carry optional
  `labName` / `piTitle` / `piDisplay`; stored in meta at create time. All
  optional so existing creates are unaffected.
- `POST /lab/profile` (new, head-signed): updates the three text fields later.
  Signed message: `lab-profile\n<labId>\n<labName>\n<piTitle>\n<piDisplay>\n<issuedAt>`.
- `POST /lab/profile/get` (new, OPEN read): returns
  `{ labName, piTitle, piDisplay, hasLogo }` from meta.
- `POST /lab/logo` (new, head-signed): raw image bytes (cap 512 KB; png/jpeg/webp/svg).
  Signed message: `lab-logo\n<labId>\n<sha256hex>\n<issuedAt>`. Stored to
  `LAB_DATA` under `logos/<labId>` with the content-type in R2 httpMetadata; sets
  `meta.has_logo = "1"` and `meta.logo_ct = <contentType>`.
- `GET /lab/logo?lab=<labId>` (new, OPEN read): streams the bytes with the stored
  content-type, 404 when none.

## Frontend client

`frontend/src/lib/lab/lab-profile-client.ts`:

- `fetchLabProfile(labId)` -> `{ labName?, piTitle?, piDisplay?, hasLogo? } | null`
- `updateLabProfile(labId, { labName, piTitle, piDisplay }, headEd25519Priv)`
- `uploadLabLogo(labId, fileBytes, contentType, headEd25519Priv)`
- `labLogoUrl(labId)` -> the relay GET url (cache-busted)

Mirrors the signing + `relayHttpBase()` pattern in lab-do-client.ts /
lab-accept-client.ts. The invite payload (`LabInvitePayload`) gains OPTIONAL
display-only `labName` / `piTitle` (NOT part of `canonicalInviteMessage`, exactly
like the existing display-only `headUsername`).

## Phases

- Phase 0: data model + relay storage + read API + frontend client (this doc). No
  app UI.
- Phase 1: "Set up your lab" capture step (replaces the silent auto-create) +
  Settings editor.
- Phase 2: branded `/lab/join` welcome (MarketingBackdrop + Reveal + a custom
  BeakerBot welcome scene holding a lab-name sign). A reskin; the accept / enter /
  pending / error flow and the V2 token-join path are preserved.
- Phase 3: persistent member-screen lab logo in the app header.

## Voice / brand rules

BeakerBot mascot stays pastel (hardcoded). No emojis, no em-dashes, no
mid-sentence colons in code comments. Icon-only buttons get a Tooltip + aria-label.
