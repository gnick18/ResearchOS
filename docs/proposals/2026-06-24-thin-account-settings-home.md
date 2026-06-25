# Thin Account + Settings as the home

Date: 2026-06-24
Status: APPROVED (model + profile-home locked by Grant), build not started
Owner: testing-hub session

## Decision (Grant, 2026-06-24)

The Account hub and Settings overlap confusingly (see the IA audit memo). Grant
locked two choices:

1. **Thin Account + Settings is home.** `/account` shrinks to a launcher:
   folder selection + go-to links + lab companion link + display-only identity.
   Identity, billing, and security all move into Settings. The cloud-backed
   Settings sections become reachable with **no folder connected**.
2. **Profile lives inside Settings.** One consolidated Settings "Profile"
   section edits handle/name/avatar/affiliation/bio/links/ORCID.
   `/u/<handle>` stays the public read-only view.

## Why (from the audit)

Account hub is ~70% a duplicate of Settings:
- displayName editable in **3 places / 3 backends** (Account `/api/account/profile`,
  Settings published identity, Settings local Appearance).
- affiliation in 2 cloud copies; ORCID in 2 backends (published + local metadata).
- billing/storage on Account = read-only mirror of Settings Plan & storage.
- "security" = 3 surfaces, 3 meanings (Account Security, Settings Account&keys,
  Settings Account&security).

## The one real constraint

`/account` is the ONLY surface reachable with NO folder connected (folderless
bypass in `providers.tsx`). Settings reads heavily from the local folder. So the
work is NOT moving cards visually, it is making the cloud-backed Settings
sections render in a **folderless mode**. The split is cloud-identity vs
this-folder-config.

## Target IA

**Account (`/account`) = thin launcher (folderless):**
- Identity header: avatar + name + @handle + role chip, DISPLAY ONLY.
- Folders card (connect / switch / add + drag-drop) - the primary action.
- Go-to links: Settings, Network profile (`/u/handle`), Lab site (heads),
  Back to app.
- Lab companion site link (heads).
- A single "Edit profile, plan, security in Settings" entry (replaces the 3
  scattered links today).
- REMOVED from Account: Identity edit card, Plan & billing card, the 4 stat
  cards, Security/keys section, Your-labs section.

**Settings (`/settings`) = the home:**
- "Profile" section: ONE editor for handle, name, avatar, affiliation, bio,
  links, ORCID. Source of truth = published identity (cloud). Kill the duplicate
  local displayName + local-metadata ORCID.
- Plan & billing (already there).
- Security & keys: merge the 3 into one section, one meaning.
- Workspace / Data / Lab sections: folder-scoped, unchanged.
- Settings shell gains a **folderless mode**: when no folder is connected, render
  only the cloud sections (Profile, Plan & billing, Security & keys) and show a
  "connect a folder to configure the rest" note for the folder-scoped sections.

## Phased build

- **P1 (enabling):** Settings folderless mode. Let `/settings` render cloud-only
  sections when no folder is connected (add `/settings` to the folderless bypass
  set; gate folder-scoped sections behind `isConnected`). No visual change for
  connected users. Behind a flag.
- **P2:** Consolidate Profile in Settings. One editor; remove the duplicate
  displayName (local Appearance) and the duplicate local-metadata ORCID; published
  identity = source of truth.
- **P3:** Merge the 3 security surfaces into one Settings "Security & keys".
- **P4:** Thin the Account hub to the launcher (remove migrated cards; add the
  single "manage in Settings" entry; keep Folders + go-to + lab companion +
  display-only identity).
- **P5:** Cleanup + copy + the `/u/handle` "edit in Settings" deep links.

Each phase: isolated worktree, gated, tsc 0, land on local main, Grant eyeballs
on :3000. Auth/folderless-bypass change (P1) is the riskiest - verify the
no-folder sign-in path before flag flip.

## Open follow-ups
- Does the Run-a-lab upsell move to Settings Lab group or stay a go-to? (lean:
  Settings, with an Account go-to link.)
- Exact merge of "Account & security" (password + user-switch) vs "Account & keys"
  (E2E identity) naming.

Related: [[project_account_settings_ia_audit]], [[project_settings_redesign]],
[[project_researcher_social_layer]], [[project_cloud_accounts_local_data]].
