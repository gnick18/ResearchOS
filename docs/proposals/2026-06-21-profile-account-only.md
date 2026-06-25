# Profile is account-only (retire folder-local identity)

Date: 2026-06-21
Status: PARTIALLY BUILT (Phase 0, 1, and the displayName half of Phase 2 landed
on branch claude/profile-account-only, not merged). See "Build status" below.
Owner: Profile-account-only audit bot

## Build status (2026-06-25, branch claude/profile-account-only)

Built through the existing flags (NEXT_PUBLIC_ACCOUNT_SETTINGS for the merge /
lift, NEXT_PUBLIC_PROFILE_CONSOLIDATION for the editor swap in Phase 3). Every
change fails closed and is byte-identical with the account-settings flag off.
tsc 0, lint 0 errors, account-settings-merge tests 47 passing.

- Phase 0 DONE. providers.tsx sources the splash displayName from
  readEffectiveUserSettings (account-elevated) instead of the folder username,
  falling back to the folder value. Fixes the reported greeting clobber.
- Phase 1 DONE for color + colorSecondary. Added to AccountScopedSettings + the
  merge + the lift (seedIfAbsent) + OPTIONAL_PREF_KEYS + the lift-on-connect
  popup read. Behaviorally inert until the avatar reads flip. coloredHeader,
  displayName, preferredName were already on the account.
- Phase 2 PARTIAL. The SELF displayName reads now use the account-elevated value
  at the proposal's worst offenders: deposit prefill (self owner only),
  DevicesSection, PurchaseEditor, LabMembershipPanel. REMAINING: the avatar
  COLOR self-resolver (see "Remaining work").
- Phase 3 NOT STARTED. Editor consolidation + retiring folder writes + the ORCID
  cross-store lift.

### Open owner decisions (recommended defaults applied, confirm or redirect)

1. account_type + lab_manager STAY folder-scoped. APPLIED as recommended (no
   change made to those fields). NOTE: confirm.
2. Canonical home displayName/preferredName = E2E AccountScopedSettings blob (for
   greeting + merge); ORCID/avatar/bio/affiliation = Neon account_profiles.
   APPLIED for displayName/preferredName/color via the blob. ORCID was NOT lifted
   in Phase 1 because its home is account_profiles (a different store than the
   blob lift). NOTE: confirm the ORCID home before the Phase 3 cross-store lift.
3. Inert folder copies left as offline fallback, no tombstone yet. APPLIED: no
   folder profile field is deleted; reads fall back to the folder.

### Remaining work (deferred, each independently shippable)

- Avatar color self-resolver (rest of Phase 2). The avatar color is read
  SYNCHRONOUSLY from the cached _user_metadata.json roster across many hot-path
  render surfaces (UserAvatar, RainbowOrb, BeakerBotCursor, NoteListRow, lab
  roster / presence, calendar swatches), while the account color read is ASYNC.
  Flipping it needs a sync/async bridge (an async resolver hook that resolves the
  SELF entry from the account, OTHER users from metadata), not a 1-line swap.
  Color was lifted into the account in Phase 1, so folder and account agree post
  lift and nothing diverges visibly while this read stays folder-sourced.
- Phase 3 editor consolidation. Behind NEXT_PUBLIC_PROFILE_CONSOLIDATION, route
  color / colorSecondary / displayName / coloredHeader / ORCID edits through the
  one cloud editor (ProfileEditor.tsx) and stop the folder writes in
  AppearanceCard, ColorPickerRows, OrcidField. Needs the cloud editor extended to
  write color / colorSecondary into the E2E blob (it currently writes only the
  account_profiles fields).
- ORCID cross-store lift. Seed account_profiles.links.orcid from the folder
  _user_metadata.json when the account lacks it, gated on decision 2. Belongs
  with Phase 3 since the ProfileEditor already owns the account_profiles ORCID
  write.

## The directive

A ResearchOS user set a name on their cloud ACCOUNT. After they connected a data
folder, the displayed name was OVERWRITTEN by the name associated with the
FOLDER. This proves user identity still lives folder-local and some path lets the
folder value out-rank the account value. Owner directive: "remove all of this and
migrate to all profile settings only being on our cloud."

This document scopes that migration. It does NOT implement it.

## TL;DR for the owner

1. The clobber is NOT a bad write into the account. The account-blob write path is
   correctly guarded (the folder value seeds the account only when the account
   lacks it). The clobber is a READ-LAYER bug: the welcome-back splash greets the
   user by the folder username because it never reads the account display name.
   Root cause is `frontend/src/lib/providers.tsx:1703`.
2. Identity today is a HYBRID spread across FOUR stores (folder settings.json,
   folder `_user_metadata.json`, the E2E account blob, and the plaintext Neon
   `account_profiles` table), plus a fifth keypair-scoped `directory_profiles`
   copy. The same name and ORCID are editable in up to three places.
3. A consolidation refactor is already partly built behind
   `NEXT_PUBLIC_PROFILE_CONSOLIDATION` (proposal
   `docs/proposals/2026-06-24-thin-account-settings-home.md`). This migration
   should land THROUGH that flag, not as a parallel effort.

## 1. Inventory of folder-local profile / identity fields

Two folder-local stores hold identity:

- `users/<username>/settings.json` via
  `frontend/src/lib/settings/user-settings.ts` (the `UserSettings` interface).
- `users/_user_metadata.json` via
  `frontend/src/lib/file-system/user-metadata.ts` (the `UserMetadataEntry`
  interface).

For each field below: where it is stored, written, and read, and whether it is
already represented on the cloud account.

### 1a. True PROFILE fields (the migration target)

#### displayName
- Store: `settings.json` (`UserSettings.displayName`, default null) at
  `frontend/src/lib/settings/user-settings.ts:284` and `:576`.
- Written: `frontend/src/components/profile/AppearanceCard.tsx:40` (Appearance
  editor, commit on blur `:34-41`) via `update` -> `patchUserSettings` ->
  `writeUserSettings` (`user-settings.ts:865`). Also onboarding
  `frontend/src/components/onboarding/wizard/steps/IdentityStep.tsx` and
  `ProfileStep.tsx`.
- Read (folder value, NOT account): greeting/splash via
  `frontend/src/lib/greeting/greeting-name.ts`; `components/UserAvatar.tsx`;
  `AppearanceCard.tsx:58-64` preview; `components/settings/DevicesSection.tsx:312`;
  `components/PurchaseEditor.tsx:380`; `components/lab-head/LabMembershipPanel.tsx:174`;
  deposit prefill `lib/deposit/prefill.ts` (`resolveOwnerDisplayName`) and
  `lib/deposit/project-prefill.ts`; lab roster
  `hooks/useLabUserProfiles.ts` / `LabRoster.tsx`.
- Already on the account? YES in TWO cloud copies: the E2E blob
  `AccountScopedSettings.displayName` (`account-settings-crypto.ts:121`) and the
  Neon `account_profiles.displayName` (`lib/account/account-profile.ts:49`,
  `/api/account/profile`). The folder remains the write target in
  `AppearanceCard`, so all three can silently diverge.

#### preferredName ("call me Grant")
- Store: `settings.json` (`UserSettings.preferredName`, default null) at
  `user-settings.ts:287`.
- Written: `frontend/src/lib/account/preferred-name.ts:52` (`savePreferredName`)
  writes BOTH the folder slot (`patchUserSettings`) AND the account blob
  (`:63`). UI is onboarding only (`PreferredNameStep.tsx`, `IdentityStep.tsx`,
  splash variants); there is no standalone Settings editor.
- Read: `lib/greeting/greeting-name.ts`; `components/admin/BeakerBotGreeting.tsx`;
  the splash.
- Already on the account? YES, `AccountScopedSettings.preferredName`
  (`account-settings-crypto.ts:130`).

#### ORCID
- Store: `_user_metadata.json` ONLY (`UserMetadataEntry.orcid`,
  `user-metadata.ts:150`). Not in settings.json.
- Written: `frontend/src/components/settings/OrcidField.tsx:103`
  (`setUserMetadataField(currentUser, "orcid", next)`, mounted inside
  `AppearanceCard.tsx:106`). Also onboarding `IdentityStep.tsx` / `ProfileStep.tsx`
  and auto-bind `lib/lab/lab-profile-auto-bind.ts`.
- Read: deposit prefill (`lib/deposit/owner-orcid.ts`, `prefill.ts`,
  `project-prefill.ts`), `lib/metadata/orcid.ts`, `OrcidPublications.tsx`,
  `SharingSection.tsx`, AI `network-tools.ts`.
- Already on the account? NOT in the E2E blob. It HAS a cloud home in
  `account_profiles.links.orcid` (Neon, `account-profile.ts:69`, edited in
  `ProfileEditor.tsx`) under the consolidation flag, and a third copy in the
  sharing `directory_profiles`. The live folder editor still writes folder-local.

#### color (avatar color)
- Store: DUAL, `settings.json` (`UserSettings.color`, default "#3b82f6",
  `user-settings.ts:288`) AND `_user_metadata.json` (`UserMetadataEntry.color`,
  `user-metadata.ts:99`). `writeUserSettings` mirrors settings -> metadata via
  `setUserMetadataColors` (`user-settings.ts:877`); `readUserSettings` seeds back
  from metadata (`:787-803`).
- Written: `frontend/src/components/profile/ColorPickerRows.tsx:81,97`; the login
  create flow `setUserMetadataColors` / `createUserMetadataEntry`.
- Read (metadata is the canonical roster read): `UserAvatar.tsx`, `RainbowOrb.tsx`,
  `BeakerBotCursor.tsx`, `NoteListRow.tsx`, `PurchaseRowPresence.tsx`, lab
  roster/presence, login screen, calendar swatches.
- Already on the account? NO. The `color` field in `account-settings.ts:231` is a
  calendar-feed color, unrelated. This is the biggest pure-folder gap.

#### colorSecondary (gradient second stop)
- Store: DUAL, `settings.json` (`UserSettings.colorSecondary`, default null,
  `user-settings.ts:291`) AND `_user_metadata.json`
  (`UserMetadataEntry.color_secondary`, `user-metadata.ts:104`). Mirrored with
  `color`.
- Written: `ColorPickerRows.tsx:97,103,110`; `setUserMetadataColors`
  (`user-metadata.ts:578`).
- Read: same gradient consumers as `color`.
- Already on the account? NO.

#### coloredHeader (tint the header with the user color)
- Store: `settings.json` (`UserSettings.coloredHeader`, default true,
  `user-settings.ts:292`).
- Written: `AppearanceCard.tsx:119`.
- Read: app header tint.
- Already on the account? YES, `AccountScopedSettings.coloredHeader`
  (`account-settings-crypto.ts:102`); merge applies at `account-settings.ts:107`.

#### avatar / bio / affiliation (cloud-only today)
- These have NO folder-local home. They exist only in the Neon
  `account_profiles` table (`account-profile.ts:46-70`: `avatarUrl`, `bio`,
  `affiliation`, `links`). Listed here so the owner sees the full identity set;
  they are already account-only and need no migration, only consolidation of the
  duplicate editors.

### 1b. ROLE / context fields (folder-scoping may be CORRECT, owner decision)

#### account_type ("member" | "lab_head")
- Store: `settings.json` (`UserSettings.account_type`, default "member",
  `user-settings.ts:361`); clamped in `normalize()` `:694`.
- Written: Settings `update({ account_type })`; onboarding Q1c bridge (see the
  written-bus docblock `user-settings.ts:982`).
- Read: `useAccountType`; gates Lab Overview nav and PI surfaces everywhere.
- Already on the account? PARTIALLY. The account blob carries `labHead?: boolean`
  (`account-settings-crypto.ts:86`) which PROMOTES `account_type` to "lab_head" in
  the merge (`account-settings.ts:96`). This is one-directional (elevate never
  demote), by design.
- DECISION: account_type mixes a GLOBAL capability (am I a PI at all) with a
  PER-FOLDER role (am I the head of THIS lab vs a member of someone else's). The
  current split (`labHead` on the account elevates, the folder still says which
  role you hold in THIS folder) is deliberate. Recommend KEEP folder-scoped, do
  not migrate to account-only.

#### lab_manager (delegated capability)
- Store: `settings.json` (`UserSettings.lab_manager`, `user-settings.ts:373`),
  clamped `:701`. Materialized from the head-signed relay roster record.
- Read: capability checks (purchase approval, audit, ops, companion site).
- DECISION: this is a per-lab delegated capability, not global identity. Recommend
  KEEP folder-scoped.

#### lab_id, lab_kind, dept_admin_of, institution_admin_of
- Store: `settings.json` (`user-settings.ts:376, 385, 416, 422`).
- These are org-relationship / folder-context fields (a folder is a lab or class).
- DECISION: KEEP folder-scoped (a folder IS the lab context). Out of scope for a
  profile migration.

### 1c. Other `_user_metadata.json` fields (NOT identity, listed for completeness)
`native_calendar_color` (per-folder calendar swatch), `hide_goals_from_lab` (a
preference, mirrored from settings.json), `created_at`, `deleted_at`,
`is_tutorial`, `materialized_member` (bookkeeping / tombstones). None are profile;
leave folder-scoped.

### 1d. Fields ALREADY in the cloud account blob (AccountScopedSettings)
From `account-settings-crypto.ts`: `calendarFeeds`, `labHead`, `theme`,
`animationType`, `beakerBotAnimations`, `coloredHeader`, `dateFormat`,
`timeFormat`, `professionalMode`, `showCompanionButton`,
`autoPublishSnapshotsToPhones`, `notificationPreferences`, `displayName`,
`preferredName`, `defaultLandingTab`, `visibleTabs`.

The plaintext Neon `account_profiles` row holds: `handle`, `displayName`,
`affiliation`, `avatarUrl`, `bio`, `links` (orcid / researchgate / website),
`theme`.

### Count

Folder-local IDENTITY fields that still exist: 8 in the strict sense
(displayName, preferredName, ORCID, color, colorSecondary, coloredHeader,
account_type, lab_manager). Of these, the TRUE-PROFILE migration set is 6
(displayName, preferredName, ORCID, color, colorSecondary, coloredHeader);
account_type and lab_manager are role/context and recommended to stay
folder-scoped.

Worst offenders:
- WRITE: `components/profile/AppearanceCard.tsx:40` and
  `components/profile/ColorPickerRows.tsx:81,97` write displayName / color to the
  FOLDER with no account write, so the folder copy can diverge from the account.
- WRITE: `components/settings/OrcidField.tsx:103` writes ORCID only to folder
  `_user_metadata.json`.
- READ: `frontend/src/lib/providers.tsx:1703` (splash) and the deposit prefill
  `resolveOwnerDisplayName` in `lib/deposit/prefill.ts` and `project-prefill.ts`
  read the FOLDER displayName, ignoring the account value.

## 2. The overwrite path (root cause)

The account-blob WRITE path is NOT the bug. `liftAccountStateSilently`
(`account-settings.ts:650`) and `liftFolderSettingsOnLogin` (`:621`) both route
through `liftFolderIntoAccount` -> `seedIfAbsent` (`:288-296`), which seeds a
folder value into the account blob ONLY when `account[key] === undefined`.
`hasLiftableAccountState` (`:351`) gates on `account.displayName === undefined`.
The connect-flow caller `components/account/LiftOnConnectPopup.tsx:183-188`
respects that guard, and the silent lift only seeds, never overwrites. There is no
unguarded folder-to-account name write anywhere (the only other account-blob name
writer is `lib/account/preferred-name.ts:63`, which writes the explicit
preferredName the user typed, not a folder value).

The clobber is at the READ / DISPLAY layer:

ROOT CAUSE: `frontend/src/lib/providers.tsx:1703`. The launch splash passes
`userName={currentUser ?? undefined}`. `currentUser` (from `useCurrentUser`,
`hooks/useCurrentUser.ts`) is the FOLDER-scoped username from the file-system
context, NOT the account display name. The splash variants resolve the greeting as
`resolveGreetingName({ preferredName, displayName: userName })`
(`VariantSplitStage.tsx:57`, `VariantBloom.tsx:45`, `VariantAurora.tsx:44`), and
`resolveGreetingName` (`lib/greeting/greeting-name.ts:79-80`) returns
`firstName(displayName)` when no `preferredName` is set. So a user with an account
display name but no preferredName is greeted by the FOLDER USERNAME. The account
name is effectively out-ranked by the folder name at the display layer. Note
`providers.tsx:774-778` already reads `readEffectiveUserSettings().preferredName`
(account-elevated) for the preferredName prop, so the fix is to source displayName
the same way instead of from `currentUser`.

Compounding cause: `readEffectiveUserSettings` (the account-elevated reader,
`user-settings.ts:827`) has essentially ONE non-test caller (`providers.tsx`).
Every other surface (60-plus call sites) reads the folder-only `readUserSettings`,
so almost nothing in the app honors the account-elevated name even where the merge
would do the right thing.

## 3. Migration plan to account-only profile

### Fields that move to account-only
displayName, preferredName, ORCID, color, colorSecondary, coloredHeader. (avatar /
bio / affiliation are already account-only.)

### Fields that DO NOT move (owner decisions)
account_type and lab_manager (per-folder role / capability), and lab_id /
lab_kind / dept_admin_of / institution_admin_of (folder = lab context). See the
DECISION callouts in section 1b.

### Single source of truth
Pick ONE cloud home per field and land this through the existing
`NEXT_PUBLIC_PROFILE_CONSOLIDATION` flag and the
`docs/proposals/2026-06-24-thin-account-settings-home.md` IA so we do not build a
parallel system. Recommended homes:
- displayName, preferredName, ORCID, avatar, bio, affiliation: the cloud profile
  the consolidation work already targets (`account_profiles` via
  `/api/account/profile`), with displayName / preferredName ALSO mirrored into the
  E2E `AccountScopedSettings` blob since the greeting + effective-settings merge
  already read from there.
- color, colorSecondary, coloredHeader: ADD to `AccountScopedSettings`
  (`account-settings-crypto.ts`) so they ride the existing encrypted blob and the
  `mergeAccountOverFolder` machinery. coloredHeader is already there; color and
  colorSecondary are new fields plus new merge + lift + seedIfAbsent lines.

### One-time idempotent migration
On first authenticated connect (reuse the existing lift entry point so there is
ONE migration site), for each profile field: if the account already carries it,
the account value WINS and the folder copy is ignored (this is already exactly
what `seedIfAbsent` and `hasLiftableAccountState` do for displayName /
preferredName). For the NEW fields (color, colorSecondary, ORCID) extend the same
lift: seed the account from the folder ONLY when the account lacks the value, then
stop trusting the folder copy on read. The lift must remain non-destructive: never
write a folder value over an existing account value (that is the Owen bug the
guard exists to prevent).

### Make every read use the account / effective value
- Replace folder-only self-name reads with the account-elevated value at the worst
  offenders first: `providers.tsx:1703` (splash displayName), deposit prefill
  `resolveOwnerDisplayName` in `lib/deposit/prefill.ts` and `project-prefill.ts`,
  `DevicesSection.tsx:312`, `PurchaseEditor.tsx:380`,
  `LabMembershipPanel.tsx:174`.
- For roster / avatar surfaces that read `color` from `_user_metadata.json`,
  resolve the SELF entry from the account first, falling back to metadata for
  OTHER users (whose colors are still folder-cached identities). A shared resolver
  (analogous to `readEffectiveUserSettings` but for the avatar fields) keeps every
  surface consistent.

### Stop folder writes of profile fields
Retire the folder write in `AppearanceCard.tsx` (displayName, coloredHeader),
`ColorPickerRows.tsx` (color, colorSecondary), and `OrcidField.tsx` (ORCID) in
favor of the consolidated cloud editor (`ProfileEditor.tsx` / the new Settings
Profile section). The consolidation flag already swaps these editors; this
migration extends that swap to color and verifies no remaining writer touches the
folder profile fields.

### What to do with the folder-local copies
The app is local-first and E2E, so DO NOT silently delete user data. Leave the
folder copies INERT: stop reading them for the SELF user (account wins), stop
writing them, but keep them on disk as a read-only fallback for the offline / no-
account case (section 4) and for OTHER users' cached identity in the roster. A
later cleanup pass can tombstone them, but only after a release of account-only
reads has proven stable. No destructive change in the migration itself.

## 4. Risks and edge cases

- Offline / no account unlocked: `fetchAccountSettings` returns null when no
  identity is unlocked or the flag is off, and `readEffectiveUserSettings` then
  returns the folder value byte-for-byte (`user-settings.ts:836,841`). So the
  folder copy MUST stay readable as the offline fallback. The migration must not
  break the flag-off / no-identity path; the account read is opt-in and fails
  closed to the folder.
- Demo / wiki-capture: the splash is already suppressed via
  `isDemoOrWikiCapture()` (`providers.tsx:1700`). Demo uses fixture identity, not a
  real account; keep the account read guarded so demo never hits the network.
- Multi-folder: this is the whole point. The same account opened in folder A and
  folder B must show ONE name. After the migration, the SELF name comes from the
  account regardless of folder; only OTHER users in a shared lab read from the
  folder-cached roster (their identity is not this account's to own).
- Migrate-to-solo (just fixed, iron-clad): `lib/lab/migrate-to-solo-executor.ts`
  does NOT touch displayName / color / ORCID, so the profile migration is
  orthogonal. Verify the migration still leaves the solo folder readable and that
  the solo user's account name resolves the same before and after.
- Fixtures / tests asserting folder displayName: tests that assert
  `readUserSettings().displayName` or the splash greeting from the folder username
  will need updating to the account-elevated value. Audit the greeting + splash +
  deposit-prefill tests before flipping any read to account-only.

## 5. Phased build plan (each phase independently shippable, no-op-safe)

### Phase 0 (acute) -- fix the displayed-name clobber
Source the splash displayName from the account / effective value instead of
`currentUser`. In `providers.tsx`, read `readEffectiveUserSettings().displayName`
alongside the preferredName it already reads at `:774-778`, and pass that as
`userName` at `:1703`, with the folder username only as a last-resort fallback.
This is the smallest change that stops the account name being clobbered by the
folder name at the greeting. Fails closed: when no account blob exists, the
effective read returns the folder value, so flag-off behavior is unchanged.

### Phase 1 -- extend the account blob and the one-time lift
Add color and colorSecondary to `AccountScopedSettings` plus their
`mergeAccountOverFolder`, `liftFolderIntoAccount` / `seedIfAbsent`, and
`hasLiftableAccountState` lines (mirror the displayName treatment). Extend the
first-connect lift to seed color / colorSecondary / ORCID from the folder only
when the account lacks them. Non-destructive and idempotent; no read changes yet,
so shipping this alone is inert behaviorally.

### Phase 2 -- flip the reads to account-elevated
Convert the SELF read sites (deposit prefill, DevicesSection, PurchaseEditor,
LabMembershipPanel, and the avatar color resolver for the self user) to the
account / effective value, account-wins with folder fallback. Update the affected
fixtures / tests. Each read site is independently shippable.

### Phase 3 -- consolidate the editors and retire folder writes
Behind `NEXT_PUBLIC_PROFILE_CONSOLIDATION`, route all profile edits (displayName,
preferredName, ORCID, color, colorSecondary, coloredHeader, avatar, bio,
affiliation) through the single cloud Settings Profile section. Stop the folder
writes in `AppearanceCard`, `ColorPickerRows`, `OrcidField`. Leave the folder
copies inert (read-only fallback), do not delete.

### Phase 4 (optional, later) -- tombstone the inert folder copies
Only after Phase 2-3 have shipped and proven stable. A non-destructive tombstone
(not a delete) of the self user's folder profile fields, gated and reversible.

## Decisions the owner must make

1. account_type and lab_manager: confirm these STAY folder-scoped (per-folder role
   / capability), as recommended, rather than moving to the account. They are the
   one place folder-scoping is arguably correct.
2. Single source of truth for displayName / ORCID: confirm the cloud profile
   (`account_profiles` via `/api/account/profile`, the consolidation target) is
   the canonical home, with displayName / preferredName ALSO mirrored into the E2E
   `AccountScopedSettings` blob for the greeting + merge. We currently have THREE
   name copies and THREE ORCID copies; the owner picks the winner.
3. Disposition of the inert folder copies: confirm "leave inert as offline
   fallback now, tombstone (never hard-delete) only in a later proven phase",
   consistent with local-first + E2E.

Profile-account-only audit bot
