# Account-scoped vs folder-scoped settings

Status: design, direction set by Grant 2026-06-17 (triggered by the Owen Sullivan calendar scare). Author: Billing/orchestrator lane.

## The problem

Today EVERY setting lives in the local folder (`users/<u>/settings.json`, `_calendar-feeds.json`, etc.). So when a user connects a DIFFERENT folder (Owen set up a new Google Drive folder), their external calendar connection, their PI status, and their preferences all appear to vanish, because those things were tied to the folder, not to the account. With one login now able to hold MULTIPLE folders (Class Mode), this gets worse, the same person opening their lab vs a class would see different "settings" each time.

Insight (Grant): some settings are ACCOUNT-WIDE and should be SHARED across every connected folder. A user connecting an external calendar to their profile should not be tied to one local folder, it belongs to their account. Other settings can stay LOCAL to a folder.

## The split

### Account-scoped (lives in OUR cloud, keyed by identity, synced to every connected folder)

These are preferences and external CONNECTIONS, not research data:
- External calendar subscriptions (the ICS feed URLs). THIS is Owen's exact case.
- Display name + public profile (already cloud, in `directory_profiles`).
- Appearance: theme / dark mode, animation type, beakerbot animations, colored header, date + time format.
- AI helper level, professional mode.
- Companion app pairing, phone push + notification preferences.
- Default landing tab + visible-tab set, as ACCOUNT DEFAULTS a folder can override.
- "I am a lab head / PI" as an account-level CAPABILITY (see decision below). Today `account_type: lab_head` is folder-local, which is why a new empty folder rendered Owen as an individual.

### Folder-scoped (stays LOCAL on disk, per workspace)

These are research data and per-workspace facts:
- All content: notes, experiments, methods, sequences, chemistry, data hub, phylo, figures, tasks, purchases, inventory, links.
- Calendar EVENTS created inside a folder (the actual meetings) stay folder-local, they are content like notes. (A future account-level "personal calendar" could be added separately, but created events are not auto-account-wide.)
- The lab roster / members and the sharing graph for that specific folder/lab.
- Any per-folder OVERRIDE of an account default (e.g. a class folder wants a different visible-tab set than the personal lab).

## Privacy stance (decision needed)

Putting account settings in our cloud is a small departure from pure local-first, so it must respect the promise. The promise is "your research DATA stays on your computer", and the account-scoped tier is preferences + connections, not data, so the principle holds. Two ways to store it:
- E2E-encrypted blob (recommended): encrypt the account-settings blob to the user's identity key so our cloud stores ciphertext we cannot read, consistent with the rest of the privacy positioning. The user already has a recoverable identity (OAuth + recovery code), so the blob is decryptable on any device they sign into.
- Plaintext in our cloud: simpler, but we would be able to read calendar URLs + prefs, which cuts against the brand.

## The PI/role question (decision needed)

Owen rendered as an individual because `account_type: lab_head` was folder-local and the new folder lacked it. In the multi-folder / Class Mode world, the SAME person is a PI of their lab AND an instructor of their classes. So role is really two layers:
- ACCOUNT level: "I am a lab head / I hold a lab plan" (a capability + entitlement, cloud).
- CONTEXT level: "in THIS folder I am the PI of this lab" vs "in this folder I am running a class" (per-folder).

Recommend moving the lab-head CAPABILITY to the account tier (so a PI is always recognized as a PI regardless of which folder they open), while keeping the per-folder context (which lab / which class) local. This also fixes the class-of-bug Owen hit.

## Mechanism

- A small `account_settings` store in our cloud keyed by the identity hash (same key the directory + billing use). Fetched on login, merged over folder-local defaults, written back on change. Optionally E2E-encrypted per the decision above.
- Folder `settings.json` keeps folder-scoped + override fields. On connect, the effective settings = account-scoped (cloud) merged with folder overrides (local).
- Migration: first time an existing user logs in, lift their current folder's account-scoped fields (calendar feeds, theme, name, AI prefs) up into the account store. Idempotent, non-destructive (the local copy can remain as a fallback).

## Why this matters now

- It is the ROOT FIX for the Owen calendar scare (no more "my settings vanished" when opening a different folder).
- It is FOUNDATIONAL for Class Mode (one account, many folders, consistent identity + preferences across all of them). See docs/proposals/2026-06-17-class-mode-teaching.md.
- It cleans up the lab dormancy / lab->solo mode switch (account-scoped settings naturally survive the switch, because they were never folder-bound). See docs/proposals/2026-06-17-lab-dormancy-lifecycle.md.

## FLAG (data-shape)

New cloud `account_settings` store (new table keyed by identity hash) + a migration that lifts account-scoped fields out of folder `settings.json`. This is a data-shape + new-cloud-surface change, so it needs sign-off on the split + the privacy stance before code, and it merges only after verification.

## Open decisions

1. Privacy stance, E2E-encrypted account blob (recommended) vs plaintext in our cloud.
2. Move the lab-head CAPABILITY to the account tier (recommended) vs keep role purely folder-local.
3. Confirm the account-scoped vs folder-scoped field list above, especially the ambiguous ones (visible tabs as account-default-with-override, created calendar events staying folder-local).
