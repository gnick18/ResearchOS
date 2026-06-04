# Settings and Account, Catching Up to the Sharing Model

The sharing work introduced a global identity, a relay inbox, and a two-layer login model, and Settings has not caught up. This doc plans the Settings pass, two new sections to add, and two existing areas that must CHANGE because of decisions already locked in CROSS_BOUNDARY_SHARING_IDENTITY_INTERACTION.md. It is a design contract, the build is a phase after the notes send/receive loop is working and tested.

---

## Why Settings has to change, not just grow

Today Settings has a Security section (a local password), a Lab Mode tab (a separate PI password, a lab roster that can archive/restore members, a Member/PI toggle), and Telegram as the only notification channel. None of it knows about the global sharing identity, none of it shows the relay inbox or its limits, and the password and lab-management model still assumes the old "local password is the only gate, a lab head manages member accounts" world. The locked decisions (D1, D5, D6) change that world, so two existing areas must be revised, not merely extended.

---

## New section, Sharing identity (Personal tab)

The single home for the global identity, consolidating what today only appears when a user tries to send.

When not claimed, a short explainer and a "Set up sharing" button that launches the existing SharingSetupWizard (intent is the same as D4, the user opts in when they reach for it).

When claimed, show
- the verified email,
- the key fingerprint,
- the date claimed,
- recovery-words status (confirmed or not, with a "view / confirm recovery words" action so a user who skipped it can finish).

Actions
- Rotate key (re-bind a fresh key to the same email, uses the directory rotate route).
- Restore on this device (recovery words, for the needs-restore state when the sidecar exists but this device has no private key).
- Disconnect identity (remove the local key from this device, with a clear warning about losing access to sealed items until restored).

A small connection indicator belongs here too, whether sharing is available on this build and whether this device holds the key.

---

## New section, Inbox and storage (Personal tab)

The relay budget, made visible.

- Usage, how many shares are pending and their total size, against the user's limit.
- The per-recipient cap and the 30-day expiry policy, stated plainly so nobody expects permanent storage.
- A jump to the inbox.
- Forward-looking note (not built here), this same budget is what collaborate mode would draw on, one budget, two uses.

Open product input needed, the actual numbers (how much free storage per user, the pending-share cap). The relay enforces a per-recipient count cap today, the byte budget is a product decision.

---

## Revision, Security and login (D1)

Today the Security section treats the local password as the only gate. Per D1 the model is two layers,

- The local password becomes the OFFLINE fallback gate. It still works with no account anywhere, which preserves clone-and-run-local.
- A claimed account gains "Sign in with Google or GitHub to unlock" when online. This is the sense in which the password "goes away" for connected users, it becomes the fallback rather than the primary.

The Security section copy and the unlock UI need to reflect this. The unlock screen (UserLoginScreen) gains the optional provider sign-in alongside the password, and Settings explains the relationship instead of presenting the password as the sole lock.

---

## Revision, Lab management is local-only (D5, D6)

This is the behavior change to sign off on. The locked decisions,

- D5, a lab head manages members' LOCAL accounts only (display name, color, archive/restore, the folder data). A lab head MAY see which members have a global identity (a small read-only badge, useful for knowing who can receive cross-lab shares), but has no power over it, cannot impersonate it, cannot read into a member's sealed shares.
- D6, resetting a member's local password resets only the offline fallback. It cannot reset their Google or GitHub login (that is the provider's), and it grants no access to their keys or sealed shares.

So the Lab Roster keeps its local management, gains a read-only "has sharing identity" badge, and gains copy that makes the limit explicit. Nothing in Settings should imply a lab head can change, reset, or stand in for another person's global identity. This matches the earlier call that "seeing other people in your lab and changing their accounts can't be a thing anymore" for the global layer, the LOCAL roster survives, the GLOBAL layer is hands-off.

---

## Email

There is no user-facing email setting today (notifications are Telegram only). The sharing email is the identity email, bound to the keypair, so it is not an editable profile field. "Change email" is a deliberate re-verify and rotate flow (claim the new email, rotate the binding), not a free text edit. Settings should present the verified email as fixed, with a rotate path, so nobody expects to retype it like a display name.

---

## Decisions to confirm before building

1. The storage numbers (free byte budget per user, the pending-share cap shown in the Inbox and storage section). Product call.
2. The Lab-management revision (D5/D6 made visible), confirm the roster keeps local management, adds the read-only identity badge, and drops any implication of global-account control. This is a visible behavior change to existing lab-head users.
3. Whether "Sharing identity" and "Inbox and storage" are two sections or one combined "Sharing" section. Two reads cleaner given how different identity vs storage are, but it is a layout call.

Everything else follows the locked identity-interaction decisions and the existing add-a-section pattern in settings/page.tsx.

---

## Sequencing

Build after the notes send/receive loop is working and tested. The sharing-identity section reuses the wizard and the directory rotate/recover routes (already built), the inbox-and-storage section reads the relay inbox (already built), and the Security and Lab revisions are UI plus copy over decisions already locked. So this phase is mostly assembly, but it touches login and lab-head behavior, so it gets its own careful pass and verification.
