# Multi-lab membership: authoritative BUILD SPEC

Status: BUILD SPEC, design-first, awaiting Grant go-ahead per phase. This is the SINGLE source for the joined-lab / multi-lab build. It consolidates and SUPERSEDES (as the build brief) the scattered design notes: docs/proposals/2026-06-18-multi-lab-membership.md, docs/proposals/2026-06-18-joined-lab-loop-findings.md, the locked residency in docs/proposals/LAB_TIER_REDESIGN.md, and the switcher in docs/proposals/2026-06-15-account-folder-identity-redesign.md. Produced by a 14-agent reconciliation + exhaustive consumer-wiring audit workflow (2026-06-18) plus an adversarial completeness critic.

Owner: Billing lane. House voice: no em-dashes, no emojis, no mid-sentence colons.

LOCKED context (do not re-open): residency = member keeps own folder, shared lab data flows via relay + directory cached locally on both sides, never a shared disk, PI co-owns a team key (E2E, server blind). Topology (Grant 2026-06-18) = multi-lab MEMBERSHIP (head own + member of others), ONE active context at a time via a switcher, membership SET (labs[] + per-lab role) + activeLabId, account-scoped.

Coordination boundary (require-account collision): the require-account RequireAccountGate (AppShell.tsx) owns 'is there a signed-in account at all'. This build owns 'which labs the account belongs to + the active-lab context' DOWNSTREAM of that gate. They compose, not collide.

---

## Synthesized spec

# Multi-Lab Membership + Residency Wiring Build Spec

Authoritative build spec reconciling the four design docs (LAB_TIER_REDESIGN.md, 2026-06-18-multi-lab-membership.md, 2026-06-18-joined-lab-loop-findings.md, 2026-06-15-account-folder-identity-redesign.md) with the full consumer-surface code audit. House voice applies. Every change is additive and flag-gated; solo / own-folder behavior must stay byte-identical when no lab context is active.

## 1. Locked decisions (restated)

### 1.1 Residency model (LOCKED, LAB_TIER_REDESIGN.md)
- Each lab MEMBER keeps their OWN local single-user folder. There is NO shared disk.
- A lab you JOINED is RELAY-BACKED, not folder-backed. You do NOT hold its folder on disk. It is an overlay assembled from the cloud relay + directory, materialized and cached locally on BOTH sides.
- A HEAD's own lab stays FOLDER-BACKED plus relay-synced as today.
- The member's own records legitimately live in their own local folder and are PUSHED to the R2 mirror under the team key (`syncLabWorkToMirror`, `frontend/src/lib/lab/lab-sync.ts:193`). The member's lab VIEW (shared-with-me from others) is REBUILT from the R2 mirror by `pullLabView` (`frontend/src/lib/lab/lab-read.ts:127`).
- The PI co-owns the team key and reads everything by construction (`pullMemberLabRecords` at `frontend/src/lib/lab/lab-sync.ts:334`, consumed by `frontend/src/lib/lab/lab-scoped-read.ts`).
- Crypto LOCKED: E2E to a PI-co-owned team key; server blind; key rotates on departure; seed-chain for history; signed membership log = audit trail.
- Caching is lazy / materialize-on-open. Do NOT materialize the whole lab.

### 1.2 Membership model (LOCKED by Grant, 2026-06-18, multi-lab topology)
- Support MULTI-LAB membership. A user can head their own lab AND be a member of others simultaneously. This rejects the one-lab-per-user model the code assumes today. (NOTE the joined-lab-loop findings doc records an earlier "1 will be the answer / one-lab-context-at-a-time" reading; the later 2026-06-18-multi-lab-membership.md supersedes it with the multi-lab topology lock. Reconciled here in favor of the membership SET, with one ACTIVE context at a time.)
- Replace the single scalar `lab_id?: string` (VERIFIED at `frontend/src/lib/settings/user-settings.ts:338`) with a membership SET: `labs: LabMembership[]` where each entry is `{ labId, role: "head" | "member", source: "folder" | "relay", folderId? }`, plus an `activeLabId` pointer.
- `account_type` / role becomes PER-LAB (the `role` on each membership), not a single account-level field. This is the fix for the head-vs-member contradiction.
- The membership SET + `activeLabId` live in ACCOUNT-scoped settings, not folder-local `users/<u>/settings.json`. Migrate existing single-`lab_id` users to a one-entry set.
- Local-first preserved and non-negotiable. Personal data stays in the member's own folder. A joined lab is a relay-backed overlay with no folder needed on disk.

### 1.3 One active context + unified switcher (LOCKED)
- One active lab context at a time, selected by `activeLabId`.
- Extend the existing `MULTI_FOLDER_ENABLED` folder switcher into a UNIFIED workspace / lab switcher listing BOTH folder-backed labs (own, folder on disk) AND relay-backed joined labs (member, no folder). Picking an entry sets `activeLabId`. Folder-backed -> mount the folder. Relay-backed -> open the relay lab session (`frontend/src/lib/lab/lab-session-effects.ts`).
- Reuse, do not rebuild: `RememberedFolder[]`, `listRememberedFolders`, `getActiveFolderId`/`setActiveFolderId`, `rememberFolder`, `forgetRememberedFolder` (`frontend/src/lib/file-system/indexeddb-store.ts`); the per-account scope keyer `frontend/src/lib/file-system/folder-account-scope.ts`; and the relay lab session in `frontend/src/lib/lab/lab-session-effects.ts` / `lab-do-client.ts`.

### 1.4 The core bug
Consumers read the OPEN LOCAL FOLDER (`discoverUsers()` / `useLabData().users` / folder sidecars) instead of the assembled lab view. For a JOINED lab the member has no folder on disk, so every folder-reading surface returns a one-person lab or empty roster. The residency-correct read path `pullLabView` is BUILT and unit-tested but has ZERO production callers (VERIFIED: only `lab-read.ts` and `lab-read.test.ts` reference it). Diagnosis is roughly 70% mis-wired, 30% genuinely unbuilt.

## 2. Complete consumer table

### 2.A FOLDER-BOUND surfaces that are WRONG for a joined lab (must change)

#### Roster / membership enumeration
| Surface | File | Gap | Fix direction |
|---|---|---|---|
| `discoverUsers()` (folder roster primitive) | `frontend/src/lib/file-system/user-discovery.ts` | Lists `users/` subdirs of the open folder; only sees co-located people | For a joined lab, source roster from `getLabRemote(activeLabId).record.members`; keep `discoverUsers` only for PI own-folder / legacy multi-user folder |
| `usersApi.list()` (duplicate folder enumerator) | `frontend/src/lib/local-api.ts` (~line 10058) | Same `listDirectories('users')` flaw; feeds share + notebook pickers | Return the active lab roster from relay; folder fallback for solo only |
| `loadLabUsers()` + `labApi.getUsers/getTasks/getProjects` | `frontend/src/lib/local-api.ts` (~9293) | Wrap `discoverUsers()`; joined member sees only own work | Route member enumeration through assembled lab view (`pullLabView` over `getLabRemote` owners) for joined labs |
| `labApi.getTasksFull / getProjectsFull / getInventoryItemsFull` (PI rollups) | `frontend/src/lib/local-api.ts` (~9351) | Same `loadLabUsers()`/`discoverUsers()` walk | PI: `pullMemberLabRecords` per member; member: `pullLabView`, owner-stamped |
| `cabinetApi.getNotes` (cross-member notes) | `frontend/src/lib/local-api.ts` (~9786) | `discoverUsers()` union; shared-with-me notes never appear | Build union from `pullLabView` then apply existing `canRead` overlay |
| `fetchAllInventoryItemsIncludingShared` / `...Stocks...` | `frontend/src/lib/local-api.ts` (~3114) | `discoverUsers()` union; empty of co-members | Assemble from `pullLabView`, keep `canRead` overlay |
| `useLabRosterRows` (shared roster loader) | `frontend/src/hooks/useLabRoster.ts` | `discoverUsers()` + per-member folder sidecars; one-row roster for joined member | Build rows from `getLabRemote(activeLabId).record.members`; hydrate display/IDP/sharing from `pullLabView` |
| `useLabData` (users/tasks/projects) | `frontend/src/hooks/useLabData.ts` | Wraps folder-sourced `labApi.*` | Follows once `labApi.*` reads the assembled view; no hook change beyond corrected source |
| `useLabUserProfileMap` (displayName/account_type map) | `frontend/src/hooks/useLabUserProfiles.ts` | Reads `users/_user_metadata.json` + per-user settings off open folder | Resolve from relay roster + directory/profile data for active lab |
| `useIsLabMode` (lab-mode predicate) | `frontend/src/hooks/useIsLabMode.ts` | Derives lab-mode from on-disk user count; joined member reads NOT lab mode | Derive from account-scoped membership (`labs[]` non-empty / `activeLabId` set) or `getLabRemote` |
| `useIsMultiUserFolder` (multi-user predicate) | `frontend/src/hooks/useIsMultiUserFolder.ts` | `discoverUsers().length >= 2`; used as a lab-participation proxy | Keep for literal on-disk migrate-to-solo gate (rename/scope to local-disk); use membership set for any lab-participation decision |

#### People / dashboard / work surfaces
| Surface | File | Gap | Fix direction |
|---|---|---|---|
| `PeoplePage` (PI People roster) | `frontend/src/components/people/PeoplePage.tsx` | Roster+workload folder-sourced; only billing chip from `getLabRemote` | Make relay roster the primary list joined to assembled view; key billing onto relay roster |
| `MemberPanel` (People detail) | `frontend/src/components/people/PeoplePage.tsx` | Deep-links into folder-derived lab pages | Source member from relay roster; deep-link into that member's `pullLabView` |
| `LabRoster` (Settings roster) | `frontend/src/components/lab-head/LabRoster.tsx` | `useLabRosterRows` folder list; copy says "populates as users log in to this lab folder"; shown to non-head members too | Drive list from relay membership log; keep archive as folder-local PI affordance only |
| `MemberWorkloadWidget` | `frontend/src/components/lab-overview/widgets/MemberWorkloadWidget.tsx` | Iterates `useLabData().users` | Roster from relay; per-member counts from `pullLabView` |
| `LabActivityWidget` | `frontend/src/components/lab-overview/widgets/LabActivityWidget.tsx` | Aggregates folder-sourced notes/tasks/announcements | Feed buckets from `pullLabView` + relay-stored announcements |
| `AssignTaskButton` | `frontend/src/components/lab-head/AssignTaskButton.tsx` | Assignee dropdown = `useLabData().users` | Populate from relay roster intersected with assembled view |
| `PurchaseAssigneePicker` | `frontend/src/components/PurchaseAssigneePicker.tsx` | Dropdown folder-sourced | Source candidates from relay roster + assembled view |
| `lab-experiments` page member filter | `frontend/src/app/lab-experiments/page.tsx` | `selectedUsernames = new Set(useLabData().users)` | Member set from relay roster; task pool from `pullLabView` |
| `lab-notes` page member filter | `frontend/src/app/lab-notes/page.tsx` | Same pattern | Same fix |
| `LabWorkPage` member filter | `frontend/src/components/lab-work/LabWorkPage.tsx` | Same pattern | Relay roster + assembled view |
| `LabGanttChart` member rows | `frontend/src/components/LabGanttChart.tsx` | Member rows keyed by `useLabData().users` | Rows from relay roster; tasks from `pullLabView` |
| `LabSearchPanel` member facet | `frontend/src/components/LabSearchPanel.tsx` | Facet from `useLabData().users` | Scope across relay roster owners via assembled view |
| `MyLabViewPanel` (member transparency log) | `frontend/src/components/lab/MyLabViewPanel.tsx` | Reads own pi-audit log + actor labels from local folder | Read audit log + PI actor profile from the R2 mirror so it matches where data lives |
| Lab Overview page shell | `frontend/src/components/lab-overview/LabOverviewPage.tsx` | All widgets ride folder-sourced `labApi` | Hydrate from `pullLabView(activeLabId)` for members; PI-all enumeration for the head |
| Lab Overview route gate | `frontend/src/app/lab-overview/page.tsx` | Gates on folder-derived `accountType`, bounces non-head members | Resolve role from account-scoped membership; render a member-facing overview instead of redirecting |
| Needs-you hero / Lab stat strip | `frontend/src/components/lab-overview/LabOverviewPage.tsx` | Counts from folder walks | Derive from `pullLabView` records + relay roster |
| Announcements composer + list | `frontend/src/components/lab-overview/widgets/AnnouncementsWidget.tsx` | Reads/writes `_announcements.json` at open-folder root | Announcements are lab-wide; route through the R2 lab store keyed by labId |
| announcements data module | `frontend/src/lib/lab/announcements.ts` | `_announcements.json` + `_pi_audit.json` at folder root; assumes shared disk | Route reads/writes through R2 lab store via lab-data client |
| Lab Overview BeakerSearch source/hook | `frontend/src/app/lab-overview/lab-overview-beaker-source.ts` (+ `useLabOverviewBeakerSource.ts`) | Snapshots folder-sourced | Feed builder from `pullLabView` + relay roster; inline PI actions owner-route via relay write |
| `AuditTrailViewer` MemberPicker | `frontend/src/components/lab-head/AuditTrailViewer.tsx` (~203) | `discoverUsers()` for auditable members | Populate from `getLabRemote(labId).record.members` |

#### One-on-ones / check-ins (all in `WorkbenchOneOnOnePanel.tsx` unless noted)
| Surface | File | Gap | Fix direction |
|---|---|---|---|
| Check-ins tab root / space list | `frontend/src/components/workbench/WorkbenchOneOnOnePanel.tsx` | `labApi.getOneOnOnes()` iterates `discoverUsers()` | Source spaces from assembled lab view keyed by `activeLabId` |
| New-1:1 member picker | same | `usersApi.list()`; empty-state literally says "no one else has joined your data folder yet" | Picker from `getLabRemote(activeLabId)` roster |
| WeeklyGoalsArea / NotesArea / AgendaArea / TaskBoardArea / RotationArea / CompactArea / OnboardingArea | same | All resolve via `discoverUsers()` loops; counterpart records live in another folder | Aggregate from R2 lab mirror for active lab |
| SpaceHeader skip-level + next-meeting write | same | Computed over folder-sourced `allSpaces`; writes target open folder | Compute over assembled view; route write to relay/owner mirror |
| `IdpPanel` | `frontend/src/components/workbench/idp/IdpPanel.tsx` | `idpsApi.getForMember` reads trainee's own folder; mentor cannot read | Read trainee IDP (sharing-gated) from assembled lab view |
| `MentorshipTree` | `frontend/src/components/workbench/checkins/MentorshipTree.tsx` | Pure render but input is folder-sourced | No change once input (`getOneOnOnes`) is lab-view-sourced |
| `labApi.getOneOnOnes / ...Notes / ...WeeklyGoals / ...ActionItems` | `frontend/src/lib/local-api.ts` (~9949-10022) | Each starts `const usernames = await discoverUsers()` | Replace enumeration with relay roster + lab mirror for `activeLabId`, keep `canRead` gates |
| `findOneOnOne / findCompactForSpace / findOnboardingForSpace / findRotationForSpace` | `frontend/src/lib/local-api.ts` (~6518) | Walk `discoverUsers()` to find records in owner's folder | Resolve via assembled lab view + owner mirror; route writes through relay |
| `checkinCompactsApi / checkinOnboardingApi / checkinRotationsApi / idpsApi` | `frontend/src/lib/local-api.ts` (~7070-7549) | All resolve via `findOneOnOne` / `listAllForUser` over `discoverUsers()` | Re-point at assembled lab view for `activeLabId`, gated by `canRead` |

#### Sharing / collab
| Surface | File | Gap | Fix direction |
|---|---|---|---|
| ShareDialog "Add someone" picker | `frontend/src/components/sharing/ShareDialog.tsx` | Recipient `<select>` from `usersApi.list()`; member sees only self | Source eligible recipients from relay roster for `activeLabId` |
| ShareDialog "Whole lab" grant preview | `frontend/src/components/sharing/ShareDialog.tsx` | `wholeLabRoster` from `_user_metadata.json` map | Compute preview from relay roster |
| UnifiedShareDialog solo detection | `frontend/src/components/sharing/UnifiedShareDialog.tsx` | `isSolo` from local profile-map size; joined member wrongly solo, defaults to Outside tab | Drive `isSolo` from relay roster size for `activeLabId`; solo = no active membership |
| AddNotebookMemberDialog | `frontend/src/components/notebooks/AddNotebookMemberDialog.tsx` | Candidate roster from `usersApi.list()` | Populate from relay roster |
| `grantCollabOnShare` (in-lab grant) | `frontend/src/lib/collab/client/grant-on-share.ts` | Resolves username->email via `readSharingIdentity` from local folder; joined member has no peer sidecars so every grant skips | Resolve username->email/pubkey from relay roster (`getLabRemote(activeLabId).record.members`) |
| `resolveInLabBackfill` (first-grant backfill) | `frontend/src/lib/collab/client/external-grant.ts` | Backfills via folder sidecars; enforcing a doc silently evicts lab co-editors (403) | Build backfill list from relay-assembled roster with directory email+pubkey |
| `readSharingIdentity` (username->email binding) | `frontend/src/lib/sharing/identity/sidecar.ts` | Reads `users/<u>/_sharing_identity.json`; peer lookups return null for joined member | Expose member directory identities via relay record / directory keyed by `activeLabId` |
| Notebook-note collab bootstrap | `frontend/src/components/NoteDetailPopup.tsx` | Inherits folder-sidecar resolution in `grantCollabOnShare` | Pass relay-roster-resolved members + own account-scoped email into `grantCollabOnShare` |

#### Session / membership / switcher state
| Surface | File | Gap | Fix direction |
|---|---|---|---|
| `lab_id` user-settings field | `frontend/src/lib/settings/user-settings.ts:338` (VERIFIED scalar) | Single scalar in folder-local `settings.json`; one lab, folder-scoped, no set | Move to account-scoped `labs[]` + per-lab role + `activeLabId`; settings.json keeps at most a migration shim |
| `persistLabMembership` | `frontend/src/lib/lab/lab-membership-persist.ts` | Writes `account_type` + single `lab_id` folder-local; second join clobbers first | Append `{labId, role}` to account-scoped `labs[]`, set `activeLabId` |
| `checkAndEnterLab` | `frontend/src/lib/lab/lab-member-activation.ts:84` (VERIFIED `patchUserSettings(username,{lab_id:labId})`) | Relay approval correct, but persists folder-local `lab_id` | Keep relay approval; add to `labs[]`, set `activeLabId` |
| `enterLabViaToken` | `frontend/src/lib/lab/lab-member-activation.ts:169` (VERIFIED same write) | Same shape | Same fix |
| `useLabSession` | `frontend/src/hooks/useLabSession.ts` | Resolves active lab from folder-local `lab_id`; gate never mounts on a different folder | Read `activeLabId` from account-scoped store; subscribe to account-settings writes |
| `useLabWorkMirror` (push trigger) | `frontend/src/hooks/useLabWorkMirror.ts:91` | Push half only; NO pull hook to materialize the lab view back | Add companion pull/materialize hook calling `pullLabView(activeLabId)` on the same triggers |
| `LabMembershipPanel` active-lab source | `frontend/src/components/lab-head/LabMembershipPanel.tsx` | Reads `readUserSettings(currentUser).lab_id` (folder-local) for the lab; relay roster read itself is correct; head-gated so members never see it | Obtain lab from `activeLabId`; keep `getLabRemote` read; surface relay roster read-only to members |
| `lab-scoped-read` lab resolution | `frontend/src/lib/lab/lab-scoped-read.ts` | Per-member R2 pull correct, but `getLabId` reads folder-local `lab_id` | Resolve labId from `activeLabId`; per-member pull unchanged |
| `lab/join` page | `frontend/src/app/lab/join/page.tsx` | Relay accept correct, but enter persists folder-local `lab_id` | On enter, append to `labs[]` + set `activeLabId` |
| FolderSwitcher | `frontend/src/components/file-system/FolderSwitcher.tsx` | Switches the open disk folder only; no lab switch | Become / parallel a LAB switcher driven by `labs[]` + `activeLabId`; relay-backed pick rebuilds via `pullLabView`/`getLabRemote` |
| FileSystemProvider context | `frontend/src/lib/file-system/file-system-context.tsx` | Folder-centric; `discoverUsers` is the roster source | Add account-scoped membership layer alongside the folder pointer |
| Remembered-folders registry | `frontend/src/lib/file-system/indexeddb-store.ts` | A folder SET keyed to disk handles; no `activeLabId`, no `labs[]` | Right home for the lab-membership SET; add a parallel lab registry, do not overload folder handles |
| Settings Data-folder section | `frontend/src/app/settings/page.tsx` | Only disk-folder switching exists | Add a Lab switcher section reading `labs[]` + `activeLabId` |
| Settings Members gating | `frontend/src/app/settings/page.tsx` | Gated on folder-derived `account_type` / `isMultiUserFolder`; relay section head-only | Gate on account-scoped membership for `activeLabId`; show members the relay roster read-only |
| `AccountPasswordPopup` user list | `frontend/src/components/AccountPasswordPopup.tsx:55` | `discoverUsers()` for login | Keep folder-scoped for local login; do NOT reuse as a lab roster |

### 2.B ALREADY LAB-VIEW (residency-correct, leave as-is or feed downstream)
| Surface | File | Status |
|---|---|---|
| `getLabRemote(labId).record` (head-signed roster) | `frontend/src/lib/lab/lab-do-client.ts` | Authoritative relay roster; the spine to wire member surfaces onto |
| `pullMemberLabRecords` (PI-all read) | `frontend/src/lib/lab/lab-sync.ts:334` | Correct for PI; members must NOT use it (enumerates everyone) |
| `readLabMembersWork` / lab-scoped-read | `frontend/src/lib/lab/lab-scoped-read.ts:106` | Correct PI-only read; keep PI gate |
| `syncLabWorkToMirror` (member PUSH) | `frontend/src/lib/lab/lab-sync.ts:193` | Correct push of member's own folder to R2; no change |
| `runLabSyncForSession` (push orchestrator) | `frontend/src/lib/lab/lab-sync-runner.ts:148` | Correct push; needs a PULL counterpart authored |
| `createLabSessionEffects.openLabKey` | `frontend/src/lib/lab/lab-session-effects.ts` | Relay-correct key open; only feed it `activeLabId` from account scope |
| `LabMembershipPanel` roster section | `frontend/src/components/lab-head/LabMembershipPanel.tsx` | Reads relay roster correctly; adopt as single roster source |
| `/api/billing/lab/roster` | `frontend/src/app/api/billing/lab/roster/route.ts` | Relay-only; ensure member callers also supply the relay roster |
| use-collab-session / sync-hooks / current-email / inbox / accept (sender verify) / ExternalCollabSection / entitlement | `frontend/src/lib/loro/collab/use-collab-session.ts`, `frontend/src/lib/collab/client/sync-hooks.ts`, `.../current-email.ts`, `.../inbox.ts`, `.../accept.ts`, `frontend/src/components/sharing/ExternalCollabSection.tsx`, `frontend/src/lib/collab/client/entitlement.ts` | Relay/directory-scoped; correct. Collab correctness depends entirely on fixing the grant/roster resolution above |
| FindAndShareModal / RecipientShareDialog / SendOutsideDialog family | `frontend/src/components/account/FindAndShareModal.tsx`, `frontend/src/components/social/RecipientShareDialog.tsx`, `frontend/src/components/sharing/SendOutsideDialog.tsx` | External/directory-sourced; correct. Own-object lists reading the local folder are correct by the model |
| `folder-account-scope` | `frontend/src/lib/file-system/folder-account-scope.ts` | Account-scoping infra; reuse to key the new lab-membership set |
| `accept` materialize target | `frontend/src/lib/collab/client/accept.ts` | MIXED: sender verify correct; materialize into own folder is acceptable but `currentUser`/notes path must resolve from account-scoped self identity, not folder-enumerated username |

### 2.C The ORPHAN (built, correct, ZERO callers)
| Surface | File | Status |
|---|---|---|
| `pullLabView` (member lab-view assembler) | `frontend/src/lib/lab/lab-read.ts:127` | VERIFIED zero production callers (only its own file + `lab-read.test.ts`). The residency-correct member read (own + shared-with-me from R2). Must become the data spine for every member-facing roster/work surface in 2.A |

## 3. Wiring plan

1. Replace `lab_id` scalar with account-scoped membership SET. Add `LabMembership { labId, role, source, folderId? }`, `labs: LabMembership[]`, `activeLabId` to an account-scoped store (parallel to the remembered-folders registry in `indexeddb-store.ts`, keyed via `folder-account-scope.ts`). Add a one-time migration from folder-local `lab_id` -> one `{labId, role: account_type-derived, source: "folder"|"relay"}` entry. Keep a read shim on `settings.json` so flag-off is byte-identical.
2. Re-point activation writes. `persistLabMembership`, `checkAndEnterLab:84`, `enterLabViaToken:169`, and the `lab/join` page append to `labs[]` + set `activeLabId` instead of `patchUserSettings({lab_id})`. Relay approval / crypto untouched.
3. Resolve `activeLabId` everywhere active-lab is read. `useLabSession`, `LabMembershipPanel`, `lab-scoped-read.getLabId`, and `createLabSessionEffects` take labId from the account-scoped `activeLabId`, not folder-local `lab_id`.
4. WIRE the pull half. Author a member pull hook (`useLabViewPull` or similar) and a `runLabViewPullForSession` orchestrator mirroring `runLabSyncForSession` (`lab-sync-runner.ts:148`): session-live -> `getLabRemote(activeLabId).record.members` (owners) -> `pullLabView` -> decrypt under the in-memory session key -> persist a materialized local cache. Mount it on the same triggers as `useLabWorkMirror`.
5. Add a residency-aware roster source. A single hook returns, for a JOINED lab, the relay roster from `getLabRemote(activeLabId)` hydrated by `pullLabView`; for a solo / own-folder lab, `discoverUsers()`. Route `useLabRosterRows`, `useLabUserProfileMap`, `usersApi.list`, and `loadLabUsers` through it.
6. Switch member data accessors onto the assembled view. `labApi.getUsers/getTasks/getProjects/...Full`, `cabinetApi.getNotes`, inventory unions, and the four one-on-one aggregations replace `discoverUsers()` enumeration with `pullLabView` records (members) / `pullMemberLabRecords` (PI), keeping existing `canRead` / `is_shared_with_me` overlays. `useLabData` follows automatically.
7. Switch sharing + collab member resolution. ShareDialog / UnifiedShareDialog / AddNotebookMemberDialog pickers and `grantCollabOnShare` / `resolveInLabBackfill` / `readSharingIdentity` resolve peers from the relay roster keyed by `activeLabId`, not folder sidecars. This unblocks co-edit grants for joined members.
8. Move lab-wide announcements + lab audit off the folder root. `announcements.ts` and `AnnouncementsWidget` read/write the R2 lab store via the lab-data client keyed by labId, not `_announcements.json` / `_pi_audit.json` on one disk.
9. Fix predicates. `useIsLabMode` derives from `activeLabId` / non-empty `labs[]`. `useIsMultiUserFolder` stays a literal on-disk check, scoped/renamed so it is not used as a lab-participation proxy.
10. Build the unified switcher. Extend `FolderSwitcher` + `file-system-context.tsx` to list folder-backed AND relay-backed labs from `labs[]`. Selecting sets `activeLabId`; folder-backed mounts the folder, relay-backed opens the lab session. Add the Lab switcher section to Settings and re-gate Members on account-scoped membership.
11. Flag + parity. Everything behind the multi-lab / `MULTI_FOLDER_ENABLED` flag. With the flag off, no membership-set reads, no `pullLabView` mount, solo behavior byte-identical.

## 4. UNBUILT vs MIS-WIRED

### Genuinely UNBUILT (~30%)
- Account-scoped membership SET (`labs[]` + per-lab role + `source` + `activeLabId`) and its store + migration. Today only a scalar `lab_id?: string` exists (`user-settings.ts:338`).
- The member PULL half. There is no pull hook and no `runLabViewPullForSession`; `useLabWorkMirror` is push-only.
- A member-facing lab analog of `readLabMembersWork` (member uses `pullLabView`, no role gate).
- The unified workspace / lab switcher (only a folder switcher exists, `MULTI_FOLDER` off).
- Relay-backed announcements + lab audit store (today single folder-root JSON files).
- Member-facing relay roster surfacing in Settings (relay section is head-gated).

### Merely MIS-WIRED (~70%, primitives exist, nothing consumes them for a joined lab)
- `pullLabView` (`lab-read.ts:127`): built, unit-tested, ZERO callers.
- `getLabRemote(...).record.members`: the authoritative roster, consumed only by PI / billing surfaces; member surfaces ignore it.
- Every roster/work/sharing/one-on-one surface in 2.A reads `discoverUsers()` / `useLabData().users` / folder sidecars instead of the assembled view.
- The write/join/approval loop already works end to end; it just lands membership in folder-local `lab_id` (`lab-member-activation.ts:84,169`) instead of an account-scoped set.
- The PI read path (`pullMemberLabRecords` + `lab-scoped-read`) is correct and wired; only its labId source is folder-bound.


---

## Completeness critic addendum (MUST fold into the build, critic returned complete=false)

### Additional member-facing surfaces the synthesized spec MISSED
- CommentsThread (frontend/src/components/CommentsThread.tsx) - resolves comment author displayName/PI-badge via useLabUserProfileMap (reads users/_user_metadata.json + per-user settings off the open folder). For a joined member, every co-member comment author renders as a gray username with no PI badge. NOT in the spec.
- MentionPicker (frontend/src/components/MentionPicker.tsx) - the @mention autocomplete roster is built from useLabUserProfileMap (folder _user_metadata). A joined member can only @mention themselves. This is a member-facing write affordance the spec entirely omits.
- AttributionChip (frontend/src/components/AttributionChip.tsx) - the 'who created/owns this' chip resolves via useLabUserProfileMap; co-member attributions on shared records render wrong for a joined member. NOT in spec.
- useUserColorMap / useUserColor / useUserColors (frontend/src/hooks/useUserColor.ts) - reads users/_user_metadata.json directly (readAllUserMetadata) for per-member colors used across Gantt bands, avatars, comments, task boards. For a joined member only their own color resolves; all co-members fall back to deterministic palette, diverging from the colors everyone else sees. The spec mentions useUserColorMap only in passing inside the TaskBoardArea row and never lists it as a surface to fix.
- AI/BeakerBot member tools: summarize-experiments, summarize-notes, summarize-purchases, list-records, lab-members (frontend/src/lib/ai/tools/*.ts) - all call usersApi.list() to enumerate lab members for member/PI BeakerBot queries. VERIFIED. For a joined member every 'across the lab' BeakerBot answer is scoped to their own folder. The spec's consumer table covers usersApi.list generically but never lists these AI tool callers, which are prominent member-facing surfaces.
- ApprovalsPage (frontend/src/components/approvals/ApprovalsPage.tsx) and supplies OrdersApprovalsLens + LabInventoryLens (frontend/src/components/supplies/*.tsx) - all hydrate member labels via useLabUserProfileMap (folder). The approvals/inventory member columns are blank/wrong for a joined member. Not enumerated in the spec.
- Gantt BeakerSource (frontend/src/app/gantt/useGanttBeakerSource.ts) - reads useLabData().users + useLabUserProfileMap (folder) for the Gantt member rows/labels, separate from the LabGanttChart the spec does cover. The standalone /gantt beaker source is omitted.
- Lab-overview BeakerSource hook (frontend/src/app/lab-overview/useLabOverviewBeakerSource.ts) reads useLabUserProfileMap for displayName resolution - the spec lists lab-overview-beaker-source.ts but the displayName/profile-map read in the companion hook is a distinct folder dependency not called out.
- StartSharedNotebookDialog (frontend/src/components/notebooks/StartSharedNotebookDialog.tsx) - the shared-notebook creation member picker reads usersApi.list() (VERIFIED line 83). The spec covers AddNotebookMemberDialog but misses its sibling StartSharedNotebookDialog, which has the identical folder-roster flaw on the notebook CREATE path.
- usePiRecordMenu (frontend/src/hooks/usePiRecordMenu.tsx) - the PI right-click record menu reaches for useLabData / useLabUserProfileMap / useArchivedUsers (folder). It is the inline PI-action surface across record lists and is not in the spec's table.
- Version-history actor labels: EntityVersionHistorySidebar, VersionDiffView, SequenceHistoryPanel, MoleculeHistoryPanel (frontend/src/components/history/*, sequences/*, chemistry/*) - all resolve the editor/actor via useLabUserProfileMap. For a joined lab, co-member edit attributions in version history render wrong. Whole version-history domain omitted.
- FlagBanner and PurchaseApprovalControls (frontend/src/components/lab-head/*) - resolve member labels via useLabUserProfileMap; though PI-gated, on a relay-assembled PI device they read folder metadata that may be absent. Not in spec.
- UserAvatar / UserAvatarMenu (frontend/src/components/UserAvatar*.tsx) - consume useUserColor/profile data for member avatars shown throughout the app chrome; co-member avatars render with wrong color/name for a joined member. Not enumerated.

### Critical gaps to add as build steps
- PUSH-SIDE COVERAGE OMITTED (the biggest gap). The spec's central remedy is 'route member surfaces through pullLabView,' but pullLabView can only return record TYPES that were actually mirrored to R2 by the push side. VERIFIED: syncLabWorkToMirror / createLocalApiLabWorkSource (frontend/src/lib/lab/lab-work-source-localapi.ts) mirror ONLY tasks, notes, methods, purchase_items, inventory_items, inventory_stocks, projects, and task result/note sheets. They do NOT mirror one-on-ones, check-in compacts/onboarding/rotations, IDPs, weekly goals, action items, or announcements. The spec's §2.A one-on-one block and the lab-overview announcements block tell those surfaces to 'read from pullLabView / the assembled lab view,' but there is NOTHING in the mirror to read. The spec must add a build step extending the push work-source (lab-work-source-localapi.ts) + syncLabWorkToMirror to mirror one_on_one / checkin / idp / weekly_goal / action_item / rotation / compact / onboarding record types BEFORE any member pull can serve those surfaces. This is genuinely UNBUILT, not mis-wired, and the spec's '70% mis-wired' framing understates it for the entire one-on-one domain.
- OWN-RECORD READ PATH MIS-ROUTED THROUGH R2. pullLabView (lab-read.ts:99-106) returns the viewer's OWN records by reading them back FROM the R2 mirror, not from the local folder. The locked model says the member's own records LIVE in their own local folder (source of truth) and are merely PUSHED to R2; the relay assembly is for shared-with-me data. Routing member surfaces' own-record reads through pullLabView makes a member's own data depend on a successful push+pull round-trip to R2 (stale/empty if push hasn't run, offline, or mid-sync). The spec never says 'own records come from the local folder, only shared-with-me from R2' for the read surfaces - it uniformly says 'replace discoverUsers with pullLabView.' Wiring plan should split: own = local folder (existing accessors), shared-with-me = pullLabView, then union.
- ARCHIVED-USERS / ROSTER GHOST-CLEANUP not addressed. useArchivedUsers and the lab-roster-ghost-cleanup logic (frontend/src/lib/file-system/__tests__/lab-roster-ghost-cleanup.test.ts) operate on the folder roster. Multiple surfaces subtract archived users from the folder-derived roster. The spec switches the roster source to the relay membership log but never says how archive/ghost state maps onto the relay roster, nor whether archived-on-folder vs removed-from-relay are reconciled. Risk: archived members reappear, or the relay-removed members linger.
- AUDIT WRITE-BACK on PI read not covered. lab-scoped-read performs a per-member audit write when the PI reads (the transparency log MyLabViewPanel surfaces). The spec moves MyLabViewPanel to read the audit from R2 and moves announcements.ts lab-root _pi_audit.json to R2, but never specifies WHERE the PI read-audit gets WRITTEN once members no longer hold a co-located folder. VERIFIED announcements.ts writes a LAB-ROOT _pi_audit.json (distinct from per-user users/<u>/_pi_audit.json). The spec conflates these and does not define the R2 audit write path for either, only the read.
- MIGRATION DIRECTION for lab_id -> labs[] is account-scoped but the source scalar is FOLDER-LOCAL. The spec's step-1 migration reads folder-local lab_id and writes an account-scoped entry, but a user may have DIFFERENT lab_id values across multiple remembered folders (the scalar is per-folder). The migration as written only sees the currently-connected folder's lab_id and will silently drop memberships recorded in other remembered folders. Migration must iterate remembered folders (indexeddb-store) to recover all prior lab_ids, or accept lossy migration explicitly.
- FLAG INTERACTION underspecified. The spec gates everything behind 'the multi-lab / MULTI_FOLDER_ENABLED flag' as if one flag. These are two distinct concerns (membership-set storage vs the folder switcher). Bundling them means the residency read-path fix cannot ship without also flipping the folder switcher, and vice versa. Needs explicit separate flags or a stated dependency order.
- providers.tsx query-invalidation not addressed. useUserColorMap, useLabUserProfileMap, useLabRosterRows are React-Query hooks invalidated on folder/user change (file-system-provider-query-invalidate.test). When the source flips to relay (activeLabId), the invalidation triggers must also fire on activeLabId change and on pull-materialization completion, or stale rosters/colors persist after a lab switch. The spec's switcher step never mentions cache invalidation wiring.

### Residency / crypto violations to correct in the wiring
- pullLabView reads the viewer's OWN records from the R2 mirror (lab-read.ts:99-106), and the spec routes member surfaces' own-record reads through it. The locked model states the member's own records LIVE in their own local folder; the R2 mirror is a push target and (for assembly) a shared-with-me source. Treating R2 as the read source for the member's OWN data demotes the local folder from source-of-truth and creates a window where the member's own work is invisible until push+pull completes. Residency-correct read = own from local folder, shared-with-me from R2, unioned.
- The spec moves announcements + lab audit to 'the R2 lab store keyed by labId via the lab-data client.' announcements.ts today also writes a LAB-ROOT _pi_audit.json that is the PI read-transparency log. Putting raw lab-wide announcements and the audit log into R2 under the team key is consistent with the model only if encrypted under the team key the PI co-owns; the spec says 'R2 lab store' without specifying E2E encryption under the team key. If the lab-data-client putLabRecord path is not E2E to the team key (server-blind), this violates the LOCKED crypto requirement (server blind, E2E to PI-co-owned team key). The spec must state announcements/audit are encrypted under the same team key, not stored server-readable.
- The spec's roster source 'getLabRemote(activeLabId).record.members' is the head-SIGNED relay roster - correct - but several fix directions also say to 'hydrate display/IDP/sharing from pullLabView' for OTHER members. A member must NOT be able to read another member's IDP/sharing identity unless explicitly shared (shared_with names the viewer). pullLabView already enforces shared_with for non-own records, but the spec's IdpPanel fix ('read the trainee IDP from the assembled lab view') only works if the trainee actually shared the IDP with the mentor AND the IDP record type is mirrored. As written it implies a mentor can read a trainee IDP from the lab view by role, which would violate the per-record shared_with gate (only the PI co-owner reads everything by construction; a mentor who is not the PI does not). Needs explicit clarification that mentor IDP access requires an explicit share, not lab membership.

---

## Phased plan (P0 already in flight)
- P0 (PREREQUISITE, ALREADY IN FLIGHT, do not duplicate): the simple one-lab onboarding join-vs-create branch and the lab-save fix. Arriving via an invite link must JOIN (add a member entry / set the single lab_id today) and NEVER force-create the joiner their own lab; fix the onboarding force-create that produced the spurious second lab. This makes the simple one-lab case correct in the meantime. Start the phases below AFTER these land.
- P1 Membership data model. Add account-scoped LabMembership {labId, role, source, folderId?}, labs[] and activeLabId to a new account-scoped store (parallel to indexeddb-store.ts remembered-folders, keyed via folder-account-scope.ts). Add the migration from folder-local lab_id (user-settings.ts:338) to a one-entry set with the role derived from account_type. Re-point persistLabMembership, checkAndEnterLab (lab-member-activation.ts:84), enterLabViaToken (:169) and lab/join to append to labs[] + set activeLabId. Keep a settings.json shim so flag-off is byte-identical. Flag-gated, no consumer changes yet.
- P2 Wire the member PULL + active-lab resolution. Author useLabViewPull + runLabViewPullForSession mirroring lab-sync-runner.ts:148 (getLabRemote roster owners -> pullLabView -> decrypt under session key -> materialize local cache), mounted on the useLabWorkMirror triggers. Re-point useLabSession, lab-scoped-read.getLabId, LabMembershipPanel and createLabSessionEffects to read activeLabId from the account store. This makes pullLabView (lab-read.ts:127) have its first real callers.
- P3 Repoint member-facing consumers onto the assembled lab view. Introduce one residency-aware roster source and route useLabRosterRows, useLabUserProfileMap, usersApi.list, loadLabUsers through it. Switch labApi.getUsers/getTasks/getProjects/...Full, cabinetApi.getNotes, inventory unions, the four one-on-one aggregations (local-api.ts ~9949-10022) and their finders/sub-apis onto pullLabView (member) / pullMemberLabRecords (PI), keeping canRead overlays. People page, lab-overview widgets, lab-experiments/lab-notes/lab-work/Gantt/search, AssignTaskButton, PurchaseAssigneePicker, and the one-on-one panel all follow. Move lab-wide announcements + lab audit off the folder root onto the R2 lab store.
- P4 Sharing + collab member resolution. Repoint ShareDialog / UnifiedShareDialog / AddNotebookMemberDialog pickers and grantCollabOnShare / resolveInLabBackfill / readSharingIdentity to resolve peers from the relay roster keyed by activeLabId, unblocking co-edit grants and the whole-lab grant preview for joined members. Fix useIsLabMode to derive from membership; scope useIsMultiUserFolder to a literal on-disk check.
- P5 Unified switcher + Settings. Extend FolderSwitcher + file-system-context.tsx into a unified workspace/lab switcher listing folder-backed and relay-backed labs from labs[]; selecting sets activeLabId (folder-backed mounts the folder, relay-backed opens the lab session). Add the Lab switcher section to Settings and re-gate the Members tab on account-scoped membership, surfacing the relay roster read-only to members.
- P6 Verification + flag flip. Two-browser live smoke (head + a pure relay-only joined member with no folder on disk): roster, People, one-on-ones, sharing pickers, co-edit grants, and the switcher all reflect the assembled lab. Confirm flag-off keeps solo byte-identical. Then flip the flag.

## Open questions (Grant / cross-lane)
- On-disk folder structure for a head's own folder: fully single-tenant <folder>/notes/... vs a thin users/<me>/ wrapper, chosen to ease the migration converter. Left open across LAB_TIER_REDESIGN.md (both a 'be deliberate' item and an explicit open decision).
- Lab membership record location + format on the relay/directory: the directory holds it, but the exact shape, signing, and the invite/join flow specifics are unsettled. The account-scoped settings location for labs[]+activeLabId is named as P1 work but the exact store path and migration mechanics are not specified in the docs.
- Team-key recovery design specifics: PI recovery, member recovery, and the lockout-bootstrap guard (avoiding the all-recoverers-locked-out trap). Also unreconciled with the account-folder-identity-redesign C3 server-escrow tier, which is awaiting Grant sign-off on the crypto design doc.
- A joined member with no local folder: relay-only workspace (recommended) vs prompted to connect a personal folder on first join. The materialize-target in collab accept (accept.ts) assumes a writable own-folder users/<self>/notes tree, which a pure relay-only member may not have shaped.
- Scope / timing: whether multi-lab is a launch blocker built now or a deliberate next-phase build, with the simple one-lab onboarding + lab-save fix shipped first. The phased plan assumes the latter (P0 in flight), but Grant owns the final sequencing.
- Residency-vs-multi-lab ownership conflict between docs: the joined-lab-loop findings record '1 will be the answer / one-lab-context-at-a-time' and forbid building labs[] without Billing sign-off, while 2026-06-18-multi-lab-membership.md locks the multi-lab membership SET. This spec reconciles in favor of the SET with one active context, but the Billing-lane sign-off on building the array is still the gating call.
- Pricing mechanics: LAB_TIER_REDESIGN locked metered cost-recovery, but its header marks that SUPERSEDED by solidarity pricing (BILLING_FACTS.md), so the exact lab pricing and the paywall moment for create/join are effectively re-opened. Does not block the wiring build but affects the join gate copy.
- Roster-vs-billing and unified-data-model constraints: the member roster read must consume the SAME head-signed DO record the lab-systems-convergence lane hardens (so member and billing rosters agree), and the read path must go through the pullLabView record abstraction rather than hard-coding the legacy JSON path so the eventual Loro-per-entity migration is not blocked. Both are open coordination items, not resolved designs.

## Reference artifacts
- Roster-bridge head-start branch: feat/lab-tier-member-bridge @ dd1c679e8 (discoverUsers -> getLabRemote roster for useLabUserProfileMap/useLabRosterRows + ShareDialog + check-in picker). Reference, not merged.
- Trace + consumer audit: docs/proposals/2026-06-18-joined-lab-loop-findings.md (branch design/joined-lab-loop).
- Full 14-agent audit (8 domains) raw output retained in the workflow task result.