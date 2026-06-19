# Multi-lab membership lane handoff (2026-06-19)

Owner: Billing lane. Read this with the authoritative build spec
`docs/proposals/2026-06-18-multi-lab-build-spec.md` and the memory
`project_joined_lab_loop` (both have deeper detail). House voice: no em-dashes,
no emojis, no mid-sentence colons.

## What this lane did

Closed the foundational "joined lab is inert" finding from Grant's live
co-founder (Emile) test: a user who JOINED another person's lab registered in the
relay roster (the head saw them) but on the joiner's side nothing lit up. Built
the fix across three phases, all merged and LIVE on origin/main, behind the flag
`NEXT_PUBLIC_LAB_AS_FOLDER` which Grant has now FLIPPED ON in prod.

## The design (Grant's simplification: a lab IS a folder)

Do NOT build a separate account-scoped membership store. The folder layer already
carries it:
- `account_type` (solo / lab_head / member) and `lab_id` are already per-folder
  (folder-local `user-settings.ts`).
- The remembered-folders registry is already account-scoped (`folder-account-scope.ts`,
  keyed by the account signing pubkey).
- The folder switcher already exists (`getActiveFolderId` = active lab).

So the account-scoped folder set IS the membership set, the folder switcher IS the
lab switcher, and the relay/directory stays the membership-of-record for
cross-device. Residency is the locked overlay/cache model (`LAB_TIER_REDESIGN.md`):
member keeps their own folder, shared lab data assembles from the relay + directory
cached locally, never a shared disk, PI co-owns the team key (E2E, server blind).

## What shipped (all on origin/main, flag-gated, flag now ON)

- P1 `794c7f51e`: joining auto-creates a managed OPFS member folder (no picker, via
  `navigator.storage.getDirectory`) and switches to it, NEVER overwriting the
  current folder (the Emile-test corruption). Switcher labels Solo / "X Lab - head"
  / "Y Lab - member" (`folder-lab-label.ts`, `FolderSwitcher.tsx`). Files:
  `lab-as-folder-config.ts`, `provision-member-folder.ts`, `folder-lab-label.ts`,
  `lab-member-activation.ts`, `indexeddb-store.ts`, `FolderSwitcher.tsx`,
  `app/lab/join/page.tsx`.
- P2 `05ac994bb`: wired the previously-callerless `pullLabView` via a new
  `useLabViewPull` hook mounted in `LabSignInGate`; new `lab-view-pull-runner.ts`
  + `lab-view-materialize.ts` materialize SHARED-WITH-ME records into the active
  member OPFS folder (own records stay local = residency-correct). Extended the
  push mirror (`lab-work-source-localapi.ts`, `lab-work-enumerate.ts`) to the 7
  missing record types (one_on_one, one_on_one_action_item, idp, weekly_goal, the
  3 check-in types) plus announcements. R2 path confirmed E2E to the team key.
- P3 `0a123766e`: new `lab-roster-materialize.ts` (wired into the pull runner after
  the verify gate) materializes the roster + per-member metadata
  (users/<owner>/settings.json + _user_metadata.json) so People, names, colors,
  PI badge, comments, mentions, attribution, avatars, version-history actor labels
  ALL light up without re-pointing consumers. IDP privacy fixed at PUSH
  (`stripIdpForMirror` in `lib/idp/visibility.ts` strips values_reflection +
  unshared sections before mirror). `verifyMembershipLog` now gates the roster.

Each phase was built by an ultracode build + 3-lens adversarial-verify + conditional-fix
workflow. All verdicts PASS (residency, crypto, IDP-privacy end-to-end no-bypass,
roster-lightup no-dark-surfaces, flag-off byte-identical).

## Simple-case fixes (earlier in the arc, live)

- Lab-save `36fbbf0b0`: the Settings-save 401 was relay requireHeadSig clock-skew
  (widened to 1h on cosmetic head routes; relay wrangler-deployed separately, a
  manual step the main push does not do); plus wizard-captured name now persists.
- Onboarding join-vs-create `e4ae7367b`: an invite makes you a pure member, never a
  second lab. The real fix was adding `/lab/join` to the folderless gate
  (`providers.tsx`) so a fresh invite is stashed.

## Live verify (flag ON, 2026-06-19) - two real findings

1. WORKS: P1 switcher shows "Solo"; the folderless `/lab/join` page renders, Enter
   lab works, status messages are clear. So the flag is live + the join UX is sound.
2. BLOCKER (seal): a member APPROVED INTO THE ROSTER but NOT KEY-SEALED is stranded
   with "The lab head has not finished adding you yet" (from `lab-member-activation.ts`,
   the `openLabKeyCopy` throw). Membership (roster) and key-access (sealed copy) are
   separate steps; the deferred-seal only finalizes when the HEAD reopens the lab and
   the reconcile runs. No remedy on the member side. This blocked finishing the live
   materialization check (Grant is in Emile's roster but unsealed). FIX CANDIDATE,
   approval should finalize the seal (or auto-retry, or surface "waiting for the lab
   head to finish setup"). NOT YET CHIPPED (awaiting Grant's go).
3. GAP (discovery): there is NO relay-membership-discovery. A member can only see or
   enter a lab they joined if a LOCAL member folder exists, and folders are only
   created at join time (`provisionMemberFolder` is called solely from
   `checkAndEnterLab`/`enterLabViaToken`). So a pre-flag, cross-device, or
   reset-folder-set membership is invisible. CHIPPED `task_0754f33b` (discover from
   the relay + surface in the switcher + materialize on entry; it must first
   determine whether the relay needs an account->labs reverse index, the roster is
   per-lab today).

## Greeting fix (merged this session)

PR #18 `d8e3dfc0f`: honorific strip (greeting read "Dr" because `firstName()` took
the first word of a "Dr. <name>" display name) + account-scoped `preferredName` + a
skippable "What do you like to be called?" onboarding step + a dynamic contextual
splash headline (Midnight oil? / Busy day ahead / time-of-day) replacing the static
"WELCOME BACK", bubble removed. Additive data-shape only (preferredName in
settings.json + the account E2E blob, default null).

## Coordination

- Mascot-unify lane (`feat/welcome-mascot-canonical`) holds for Grant's :3000 visual
  sign-off and MUST re-rebase onto current main, it shares `FolderSwitcher.tsx` +
  `LabSignInGate.tsx` with the multi-lab work.
- require-account lane (`feat/require-account-ironclad`, unmerged) flips require-login
  default-ON, that is Grant's go-live decision. It owns AppShell (is-there-a-session);
  multi-lab owns which-labs downstream of that gate. They compose, not collide.
- DEBUG holds the Lab Notes markdown-freeze fix.
- Also live this arc, flag-off-dormant where noted: send-outside-paid gate
  (`b059f9714`), admin Locked-pricing card, page-boot loader sweep fix (layout
  `left` -> compositor `transform`), sign-out-forgets-folder.

## Build-agent hazard (standing rule)

A P2 build agent accidentally edited Grant's main checkout, then reverted (recovered,
main verified intact). Every build/worktree chip MUST be told to create its own
worktree and read/write ONLY in it, never the main-repo path, never
git checkout/rm/stash in main. The P3 chip with that rule hard-wired did not repeat it.

## NEXT

1. Finish the live multi-lab verify once Emile reopens his lab (finalizes the seal),
   then confirm the member folder materializes + the lab lights up.
2. Chip the seal-on-approval fix (Grant to confirm).
3. Land `task_0754f33b` (membership discovery).
4. Minor follow-ups: deterministic co-member colors have no shared source; roster
   ghost-cleanup reconciliation (archived-on-folder vs removed-from-relay);
   `useIsLabMode`/`useIsMultiUserFolder` derive from membership not on-disk count.
5. Pending merges: mascot branch (Grant's visual pass), require-account (go-live call).
