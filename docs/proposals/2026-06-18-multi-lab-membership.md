# Multi-lab membership (the "joined lab is inert" fix)

Status: DESIGN, awaiting Grant sign-off. Found in the 2026-06-18 live co-founder
test (Grant + Emile). Topology decision (Grant, 2026-06-18): support MULTI-LAB
membership (a user can head their own lab AND be a member of others), not the
one-lab-per-user model the code assumes today.

House voice: no em-dashes, no emojis, no mid-sentence colons.

## The problem (confirmed in code)

A user's "active lab" is a SINGLE `lab_id` field in their per-folder user
settings. Both join paths end identically:

    await patchUserSettings(username, { lab_id: labId });   // lab-member-activation.ts:84, 169

So the whole membership model is one lab per user. `lab-session-effects.ts` then
fetches THAT one lab's record + key from the DO relay. There is no "labs I belong
to", no switcher, and the active lab (relay-backed, keyed by `lab_id`) is
DECOUPLED from the folder you currently have open (your local data).

Why the live test broke (worst case for this model):
1. Grant is already a lab head. Joining Emile's lab set Grant's `lab_id` to
   Emile's lab, but his connected folder is still his OWN lab and his
   `account_type` is still "head". So `lab_id` (Emile's), the folder/data
   (Grant's), and `account_type` (head) contradict. Each consumer (People reads
   `remote.record.members` of the lab_id lab, other surfaces read the connected
   folder) sees a different one, so nothing lines up. This is the "registered but
   not talking to the rest of the app" symptom.
2. They ended up with TWO labs cross-joined, because onboarding forced Emile to
   create his own lab (issue #2) instead of branching to a pure join. The
   intended shape is ONE lab with a head + members.

Emile's side worked because he is the head, his folder IS his lab, and his roster
correctly shows Grant.

## What already exists (the foundation, do not rebuild)

- MULTI-FOLDER: `RememberedFolder[]`, `listRememberedFolders`,
  `getActiveFolderId` / `setActiveFolderId`, `rememberFolder`,
  `forgetRememberedFolder` (indexeddb-store.ts), plus the folder switcher in the
  top bar, all behind `MULTI_FOLDER_ENABLED`. This is a working switch-between-
  contexts system, FOLDER-backed.
- RELAY-BACKED lab sessions: `lab-session-effects.ts` already builds a live lab
  session (labKey, roster, member) from the DO relay given a `labId`, independent
  of any local folder. `lab-do-client.ts` holds the head-signed roster + sealed
  key envelopes.

The one true gap: a lab you JOINED is relay-backed (you do not have its folder on
disk), while remembered folders are folder-backed. Multi-lab unifies these.

## Target model

1. Replace the single `lab_id` with a MEMBERSHIP SET plus an active pointer:
   `labs: LabMembership[]` (each `{ labId, role: "head" | "member", source:
   "folder" | "relay", folderId? }`) and `activeLabId`. Migrate existing
   single-`lab_id` users to a one-entry set. `account_type` becomes PER-LAB
   (role), not a single account field, fixing the head-vs-member contradiction.
2. Unify the switcher: extend the existing folder switcher into a WORKSPACE / LAB
   switcher that lists BOTH folder-backed labs (your own, where you hold the
   folder) AND relay-backed joined labs (where you are a member). Picking one sets
   `activeLabId` and activates that context: mount the folder for folder-backed
   labs, or open the relay lab session for relay-backed joined labs.
3. Make consumers read the ACTIVE LAB SESSION, not the connected folder. People,
   share-with-member, collab, one-on-ones / check-ins, the lab dashboard all key
   off `activeLabId` and its session roster, so a joined lab lights up its shared
   surfaces.
4. Keep local-first intact: your personal data stays in your folder. A lab you
   joined is a relay-backed overlay you switch into; you do not need its folder on
   disk. A head's own lab stays folder-backed plus relay-synced as today.

## Onboarding branch (fixes part of issue #2)

Arriving via an invite link must JOIN (add a `member` entry to your labs set),
never force-create your own lab. Today onboarding pushes everyone to create a lab,
which produced the spurious second lab in the test. Join-vs-create is a required
companion change.

## Phasing (proposed)

- P0 (this doc) sign-off on the membership-set model + the unified switcher +
  folder-decoupling, and the onboarding join-vs-create branch.
- P1 data model: `labs[]` + `activeLabId` in account-scoped settings, migration
  from `lab_id`, per-lab role. Flag-gated.
- P2 switcher: extend the folder switcher to list joined relay-backed labs;
  switching activates the right context.
- P3 consumers: point People / share / collab / 1:1 at `activeLabId`'s session.
- P4 onboarding join-vs-create + the lab-save fix (issue #2) land alongside.

## Open sub-decisions for Grant

1. Switcher shape: one unified "workspace" switcher listing own + joined labs
   (recommended), or keep folders and labs as separate controls?
2. A joined member with no local folder: do they get a relay-only workspace
   (recommended, the only way a remote member works), or are they prompted to
   connect a personal folder on first join?
3. Scope: is this a launch blocker to build now, or a deliberate next-phase build
   with the onboarding join-vs-create branch + lab-save fix shipped first to make
   the SIMPLE one-lab case correct in the meantime?

## Affected code (entry points)

`lab-member-activation.ts` (the `patchUserSettings({ lab_id })` calls),
`lab-session-effects.ts`, `lab-do-client.ts`, `indexeddb-store.ts` (remembered
folders), `file-system-context.tsx` (folder switcher + active pointer),
`components/people/PeoplePage.tsx`, the sharing + collab + one-on-one consumers,
and onboarding (the create-a-lab step). Connects to the unified-data-model and
lab-systems-convergence work.
