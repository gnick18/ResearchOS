# Orchestrator session wrap (2026-06-19)

Owner: master/orchestrator session (Billing-lane takeover). Picks up the prior
`docs/handoffs/2026-06-19-multi-lab-membership-handoff.md`. House voice: no
em-dashes, no emojis, no mid-sentence colons.

Everything below is on `origin/main` and LIVE in prod unless marked otherwise.
Commits are the as-landed hashes (some are merge/cherry-pick hashes; main has
moved past them via other lanes, all still in history).

## Prod flag state (verified in Vercel this session)

- `NEXT_PUBLIC_LAB_AS_FOLDER` = ON
- `NEXT_PUBLIC_LAB_TOKENS_V2` = ON (so the seal-on-approval eager reconcile runs)
- `NEXT_PUBLIC_SINGLE_USER_FOLDERS` = ON (FLIPPED THIS SESSION, after live verify)
- `NEXT_PUBLIC_PRICING_LIVE` = NOT set (pricing stays in its maintenance state + all
  pricing links hidden). This is the NEW single-source flag; the old server-only
  `PRICING_LIVE` is SUPERSEDED/inert and can be deleted. Set
  `NEXT_PUBLIC_PRICING_LIVE=true` + redeploy to expose pricing everywhere at once.

## What shipped (all live)

### Multi-lab NEXT queue (from the prior handoff) cleared
- SEAL-ON-APPROVAL fix (merge `680f2c663`). Token-join (4B) members were stranded
  ("the lab head has not finished adding you yet") because the seal only ran on the
  head's full lab login. New `reconcilePendingSealsForHead` (lab-head-membership.ts)
  is wired into `LabMembershipPanel` to seal eagerly on panel open + after approve/add
  (isLabTokensV2-gated, best-effort). Member-side waiting copy is now honest, no
  soft-lock. 29 unit tests.
- DISCOVERY (task_0754f33b). Code was already on main (`da7ea61ec`). DEPLOYED the
  relay this session (`wrangler deploy`, worker `researchos-collab-relay` version
  `1f77b2ce`, `LAB_MEMBERSHIP_INDEX` KV id `4a853f473b4d4aa491db61f267f14606` active).
  Endpoint `POST /lab/discover-memberships` is live+routed. The index self-populates
  (kvIndexAddMembership on lab-record write + member-add). BACKFILL was NOT run
  (optional, only for pre-deploy never-re-touched memberships). To backfill needs
  RELAY_URL + WRANGLER_ACCOUNT_ID + KV_NAMESPACE_ID + a CF API token with KV write
  (the OAuth login wrangler uses cannot do the REST writes). Wrangler is OAuth-authed
  as gnick317@gmail.com, account `810d2fc803045ac0861a1ccb2d933719`.
- COLOR single-source (`967ab7110`): new `lib/file-system/user-color.ts` dedups the
  deterministic-color algo across user-metadata / colors / lab-roster-materialize.
- ROSTER GHOST-CLEANUP (`14038834b`, FLAG): additive `materialized_member` flag on
  `UserMetadataEntry`; materialize tombstones co-members removed from the relay roster
  (reversible, never the viewer/head/current-member).
- LAB-MODE COUNT FIX (`45297a638`): a REAL bug. With LAB_AS_FOLDER on, a lone member of
  someone else's lab has the materialized head/co-members on disk, so
  `useIsMultiUserFolder` (discoverUsers >= 2) over-counted and the globally-mounted
  MigrationGate wrongly nagged them. New `discoverRealLocalUsers()` excludes
  materialized members; `useIsMultiUserFolder` uses it.

### Identity-surface fixes (found via live Chrome testing)
- PI-LEAK in the account chooser (`35231fc07`): the chooser listed materialized
  co-members, so a lone member was offered to sign in AS their PI. New
  `usersApi.listLocalIdentities()` (= list minus materialized) is used ONLY by the
  identity chooser; the broad `usersApi.list` keeps the full roster for the ~16
  display/sharing surfaces. 2 regression tests in user-tombstone.test.ts. Audit:
  UserLoginScreen was the only prod identity-selection surface fetching the list.
- DRAG-DROP FOLDER OPEN on the welcome gate (`3c7bd446d`): dragging a folder onto
  WelcomeBackSignIn fell through to the window-level GlobalDropGuard (a folder reports
  as "Files") which showed a file-attachment toast. The gate now owns the drop,
  reusing FolderConnectGate's `extractDirectoryHandleFromDrop` -> `connectWithHandle`
  with stopPropagation.

### Multi-user-folder phase-out (Grant decision: phase it out, block-new + grace-then-force)
- Behind `NEXT_PUBLIC_SINGLE_USER_FOLDERS` (FLIPPED ON). `lib/lab/single-user-folders.ts`
  + config + 17 unit tests. Block-new (`canCreateAnotherUser`, only the first user of
  an empty folder may be created) + grace-then-force (3 dismissals OR 7 days from
  first-seen, then the MigrationGate becomes blocking, dismiss removed, the "use a
  different folder" disconnect escape always stays = no soft-lock). Uses
  discoverRealLocalUsers so lab member folders are never miscounted. Spec:
  `docs/proposals/2026-06-19-phase-out-multi-user-folders.md`.
- LEGACY-DISMISS FIX (`69fde5cea`): MigrationGate returned null on the legacy
  `ros_migration_gate_dismissed_v1` boolean regardless of the flag, so anyone who
  dismissed the OLD always-dismissible gate before the flip escaped grace-then-force
  entirely (exactly the existing-folder population the phase-out targets). Now the
  legacy boolean only suppresses the gate when the flag is OFF; flag ON ignores it and
  grace governs from a fresh window. CONFIRMED LIVE on Grant's own (multi-user)
  GrantFolder, which had the legacy dismiss and now correctly shows the grace gate.
- LIVE-VERIFIED in Grant's Chrome: block-new explainer, within-grace dismiss with the
  temporary copy, dismiss increments + closes, grace-exhausted -> blocking with the
  disconnect escape intact, and the control (a genuine 2-real-user folder still fires
  the gate).

### Gate footer unification + full-exit sign-out (`e89b5d5ef`, live)
- One compact shared MarketingFooter on the login / folder-connect / welcome gates
  (Terms, Privacy, User & account help, Setting up a shared lab account?, Report Bug,
  Support). Full marketing footer unchanged on product pages. "What we're building"
  (stale RoadmapModal) dropped. Duplicate "Sign out" removed (kept the unconditional
  `login-sign-out`).
- FULL-EXIT SIGN OUT (Grant decision): Sign out previously cleared only the OAuth
  session and left the folder connected, stranding the user on the folder's account
  chooser. Now both gate Sign-out buttons `disconnect()` the folder AND `signOut()` to
  the landing. disconnect is a safe no-op when no folder is connected.

### Pricing fully hidden while in maintenance (`87e069862`, live, verified)
- `/pricing` shows a "Pricing is getting an update" maintenance state in prod. The
  welcome inline links + the global MarketingNav/MarketingFooter still linked to it.
  New shared `lib/pricing/pricing-live.ts` (`isPricingLive` / `isPricingPublic`,
  NEXT_PUBLIC + always-on in local dev) now gates: the pricing-page maintenance gate
  (migrated off the server-only PRICING_LIVE), the 3 welcome /pricing links, and the
  Pricing item in MarketingNav + MarketingFooter. Verified live: 0 `/pricing` links on
  the welcome landing and on `/ai`. Set `NEXT_PUBLIC_PRICING_LIVE=true` to flip all of
  it live together.

### Provider-rebind (social-layer Phase 4) SPEC ONLY, not built
- `docs/proposals/2026-06-19-account-provider-rebind.html` (interactive before/after
  decision doc, 6 decisions incl. "cross-key server records to the stable fingerprint
  instead of the email-hash"). The code trace confirmed there is NO way today to change
  a user's linked third-party login without orphaning directory + lab membership +
  billing + settings (only the local keypair survives). AWAITING Grant's Export
  verdicts before any build. See [[project_researcher_social_layer]].

## NEXT (open, nothing in flight)

1. SHARING ROUND-TRIP (full, test targets only) live in prod. Grant chose it; we got
   diverted by the sign-out bug and never ran it. Needs Grant re-sign-in (he signed out)
   + a test recipient he controls; confirm each send before firing.
2. PROVIDER-REBIND: Grant reviews the spec doc + Exports verdicts, then build.
3. PENDING MERGES (both merge clean): `feat/welcome-mascot-canonical` (Grant's :3000
   visual pass) + `feat/require-account-ironclad` (require-login-default-ON go-live call).
4. DISCOVERY BACKFILL (optional, low-stakes, see creds note above).
5. PRICING: flip `NEXT_PUBLIC_PRICING_LIVE=true` when pricing is signed off; remove the
   inert `PRICING_LIVE`.
6. PHASE-OUT follow-up (Grant flagged, NOT queued): close/gate the "No, I'm someone else
   -> create another user" path more fully so no new multi-user folders form. See
   [[project_migration_to_solo_ironclad]].
7. Optional eyeballs (all low-risk + verified): footer/sign-out + pricing-gate on prod.

## Coordination / hazards

- The shared primary checkout (`/Users/gnickles/Desktop/ResearchOS`) was on the privacy
  lane's branch `fix/privacy-share-dialog-seed-identity` at one point (Grant/lanes switch
  it), and a cherry-pick briefly landed on THAT branch. Recovered cleanly (their branch
  + uncommitted work restored). LESSON, now hard-wired in memory: ALWAYS
  `git branch --show-current` before any cherry-pick/merge in the primary checkout, and
  integrate finished branches via an isolated worktree + `git push origin HEAD:main`,
  never in the dirty primary checkout. See [[feedback_integrate_from_worktree]].
- Other lanes pushed to main repeatedly this session (it moved many times). All my
  integrations were FF/clean-merge + verified with `git merge-base --is-ancestor`.

## Verify-mechanics notes (for the next live session)

- Claude-in-Chrome drives navigation/clicks/reads but CANNOT operate the OS folder
  picker or a Finder->browser drag (human-only steps; Grant does those).
- The Preview-MCP dev server gets idle-reaped during non-preview work. Run the worktree
  dev server via `nohup bash scripts/worktree-dev.sh <frontend-dir> <port> ENV=V &` in a
  Bash run_in_background instead (durable). A fresh worktree needs a real pnpm install
  for a live dev server (symlinked node_modules only works for tsc/vitest).
- `vercel ls | grep` silently eats output (the colored status bullet). Use
  `vercel ls 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed -n '8p'` or `head` instead.
- `vercel env pull` returns blank for Sensitive vars.
