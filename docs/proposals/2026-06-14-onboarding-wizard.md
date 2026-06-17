# Onboarding Wizard (account setup, not a tour)

Status: SPEC, design-only. Mockup at docs/mockups/2026-06-14-onboarding-wizard.html.
Date: 2026-06-14
Author: Dr. Grant Nickles

House style: no em-dashes, no emojis, no mid-sentence colons.

---

## IMPORTANT NOTE: this is a setup wizard, NOT the retired onboarding tour

The v4 walkthrough tour was deliberately killed (flag V4_TOUR_KILLED, teardown merged
effe6f60c). That tour was a feature-discovery walk. This wizard is the OPPOSITE. It is a
purely functional account-setup flow, one decision per screen, no animated coach marks, no
gamification, no progress celebrations. It finishes the moment the account is usable and gets
out of the way. Do not conflate them.

---

## Why this exists

Today, after sign-in, a new user lands on one large `/account` page with handle-claim and
folder-connect stacked on the same screen. There are two problems.

First, unrelated decisions are forced in parallel. Handle and folder are independent
concerns; presenting them together makes each feel more daunting.

Second, the org-admin path is completely missing as a first-class entry. A department
business manager, a library/IT admin, or a procurement officer wants to set up a
department or institution account, not a personal research workspace. Today they must sign
in, land on the research `/account` page (which nags them to "connect your data folder"),
and hunt for the org card to escape. This is the wrong starting point for the wrong
audience.

The wizard fixes both by replacing the stacked page with a stepped shell that shows one
thing at a time, and by surfacing the org-admin path at the entry chooser alongside the
existing personal-research tracks.

---

## The three tracks

Every track runs inside the same stepper shell (progress indicator, Back, Skip-where-allowed,
a visible escape from every state). The tracks differ in which steps they include.

### Track 1: Solo researcher

Variants inside this track:

- **Local-only** (no account needed): skip handle and profile, go straight to folder. One step.
- **Free account** (sign in to share and be discoverable): sign in, claim handle, fill profile,
  connect folder. Four steps.

Steps in order for free-account Solo:

1. Sign in (sign-in popup, Google/GitHub/Microsoft primary, ORCID secondary, email-OTP fallback)
2. Claim handle (the @handle for the researcher directory)
3. Profile (photo, display name, affiliation, short bio, optional links)
4. Connect data folder (folder-picker popup reused as a wizard step)

For Local-only, only step 4 runs (no sign-in, no handle, no profile).

### Track 2: PI / lab head (Create path)

The solo steps above, with a lab-setup step appended at the end. The user lands as lab head
in the lab workspace after finishing.

Steps in order:

1. Sign in
2. Claim handle
3. Profile
4. Lab setup (name the lab, optional description, initial member invite links generated)
5. Connect data folder

The "join an existing lab" path is a variant of the Solo track, not the PI track: the user
joins as a member (sign in, handle, profile, folder) and the PI's lab head status comes from
the Create path, not the Join path.

### Track 3: Org admin (department or institution)

This is the key architectural correction. An org admin, in the overwhelming majority of real
cases, is a department business manager, a grants administrator, a library director, or an
IT/procurement contact. They are NOT a personal researcher who also happens to have admin
duties bolted on.

Consequently the org-admin wizard has ZERO research-workspace steps. No handle for a
researcher directory. No data folder. No E2E keypair provisioning.

The org admin wizard is standalone and folderless, and it runs on any device (the current
app is Chrome/Edge only for research work due to the File System Access API; the org admin
portal does not use the FSA API at all and can run in any browser).

Steps in order (department variant):

1. Sign in (same popup)
2. Name and describe the department (display name, institution affiliation field)
3. Link to a parent institution if applicable (search the institution directory, or skip)
4. Roster setup (generate initial lab-head invite links, or skip to do this later)
5. Billing (link a payment method, set a spending ceiling, or skip to configure later)

Steps in order (institution variant):

1. Sign in
2. Name and describe the institution
3. Roster setup (generate initial department-admin invite links, or skip)
4. Billing

After finishing, the user lands directly in the /department or /institution admin portal,
never touching /account or any folder-connect screen.

---

## The shared stepper shell

Every track runs inside a single shell component. The shell provides:

- A progress indicator at the top (segmented dots or numbered steps, labelled per track)
- A persistent Back button on every step except the first
- A Skip link on steps where skipping is safe (profile fields that are optional, billing setup,
  roster setup during the wizard)
- A visible X/close that drops the user to a safe state (local-only landing for research
  tracks, the org portal landing for org tracks)
- No hard-traps: every state has at least one visible escape (Back or X)

The shell does not show a step counter ("2 of 4") for the Local-only track because there is
only one step. It shows the counter for all multi-step tracks.

---

## Entry chooser (the first-class org-admin path)

The current chooser shows three tiles: Just me local / Free account / Lab. The redesigned
chooser adds a fourth entry point, visually separated below the personal-research tiles, for
org setup:

  "I am setting up a department or institution account"

Clicking this routes directly into the org-admin wizard (Track 3) without passing through
any research-workspace screen. The separation matters: the top three tiles are for
researchers; the bottom entry is for administrators who are setting up infrastructure for
researchers.

The chooser can be thought of as:

  TOP ZONE: How will you use ResearchOS as a researcher?
    - Just me, local
    - Free account
    - Lab (create or join)

  BOTTOM ZONE (visually separated by a thin divider):
    Setting up for a department or institution?
    [Set up a department or institution account]

The bottom zone can be collapsed to a subtle text link if the tile grid feels too crowded,
or surfaced as a full card if Grant decides to give it equal visual weight.

---

## Reusing the sign-in popup and folder-picker popup

The approved popup direction (docs/mockups/2026-06-14-onboarding-free-and-lab-revamp.html)
established two reusable popup components.

In the wizard:

- The sign-in popup is the pre-wizard entry. It fires before the wizard begins on all tracks
  that require a sign-in. Local-only and org-admin-later-billing-skip skip it.
- The folder-picker popup is rendered as a wizard step (Track 1 step 4, Track 2 step 5). Its
  UI is identical (drag-or-click drop zone, reassurance text, back/skip). It is not a
  separate standalone popup in this context; it renders inline inside the stepper shell at
  the appropriate step.

This means the folder-picker component needs to support an "embedded in wizard step" mode
where it renders without its own modal chrome (the stepper shell provides the chrome).

---

## Per-step skip rules

| Track | Step | Skip allowed? | What skip does |
|-------|------|---------------|----------------|
| Solo (free) | Sign in | No | Required for the account |
| Solo (free) | Handle | No | Required; handle can be changed later |
| Solo (free) | Profile | Yes | Skips to folder; profile editable anytime in /settings |
| Solo (free) | Folder | Yes | Skips to app (no folder = limited mode, nag on next visit) |
| PI/lab | Sign in | No | Required |
| PI/lab | Handle | No | Required |
| PI/lab | Profile | Yes | Same as Solo |
| PI/lab | Lab setup | No for name | Lab name required to create; invites can be done later |
| PI/lab | Folder | Yes | Same as Solo |
| Org admin | Sign in | No | Required for the account |
| Org admin | Org name | No | Required |
| Org admin | Link parent institution (dept only) | Yes | Can be linked later in settings |
| Org admin | Roster / invites | Yes | Can invite from the admin portal |
| Org admin | Billing | Yes | Can configure later; account is usable without billing wired |

---

## Phasing

### Phase 1 (spec + mockup, this doc)

Design artifacts only. No app code. Validate structure with Grant.

### Phase 2 (stepper shell)

Build the shared stepper shell as a standalone component: progress dots, Back, Skip, escape.
No step content yet, just the chrome.

### Phase 3 (route each track)

Wire the three tracks into the shell. Steps use existing components where available
(SharingProviderButtons for sign-in, the existing handle-claim input, the existing
folder-picker).

### Phase 4 (org-admin wizard)

Build the org-admin track steps (org naming, parent-institution link, roster, billing).
These are all new screens. The track is gated behind DEPT_TIER_ENABLED + INSTITUTION_TIER_ENABLED.

### Phase 5 (entry chooser update)

Add the fourth entry to AccountTierChooser. Gate the bottom zone behind the org tier flags.
Replace the current /account stacked page with the wizard shell as the default post-sign-in
destination for new users.

---

## Open questions for Grant

1. Bottom zone visual weight: should the org-admin entry be a full card matching the three
   research tiles, or a subtler text/link row below a divider? The mock shows both options.

2. Handle skip: the spec marks handle as not-skippable for free/lab accounts. Is that too
   strict? Some users might want to skip it and add a handle later via /settings.

3. Profile photo in wizard: should the profile step include photo upload, or defer photo to
   /settings only? Photo upload during onboarding adds friction and requires a different flow
   (camera / file picker).

4. Billing in the org wizard: should billing be required before the org account is usable,
   or is "configure later" acceptable? If billing is required, the org wizard cannot be
   skipped past the billing step.

5. Folder skip behavior: when a researcher skips the folder step, do they land on a
   "limited mode" banner in the app, or on the tier-chooser again? The current app shows the
   chooser again; the wizard model needs a clear "you finished setup, you can add a folder
   anytime from settings" landing state.

6. Join-a-lab routing: does joining a lab go through the wizard, or through the existing
   accept-link path? If through the wizard, the wizard needs a "join" variant of Track 2.
   If through the accept path, the wizard never handles join at all.

7. Org admin on mobile/non-Chrome: the spec says the org portal runs in any browser. Confirm
   there are no server-side auth flows or other Chrome/FSA dependencies blocking this.
