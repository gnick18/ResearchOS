> RESOLVED 2026-06-17. The tombstone-register fix this report recommended is implemented on main. The delete path sets deleted_at (local-api.ts setUserMetadataField), and both discoverUsers (user-discovery.ts) and usersApi.list filter tombstoned users, so a deleted user stays gone across cloud-sync round-trips. Preserved as a record of the bug and its fix. Original branch investigation/user-list-leaks-hr (now deleted).

# User-list leaks: investigation

**Branch:** `investigation/user-list-leaks-hr` (off local `main`)
**Author:** HR sub-bot
**Scope:** investigation only — no code shipped.

This report covers two user-picker bugs Grant reported that look distinct on
the surface but are downstream of the same mechanism: ResearchOS treats every
directory entry under `users/` as a real user, with no second source of truth
to reconcile against. Cloud-sync providers (OneDrive Files On-Demand here,
but Dropbox / Google Drive behave the same way) can repopulate placeholder
directory entries underneath the app's feet, and any code path that uses
`fileService.listDirectories("users")` will surface them.

---

## Bug 1 — cosmetic `alex` leak

### Symptom

Grant's real-account picker intermittently lists `alex`, the Demo Lab PI
fixture user. He confirmed via Finder screenshot that his real `users/`
directory contains only:

- `_global_counters.json`
- `_no_user_`
- `_user_metadata.json`
- `FakeResearcher`
- `GrantNickles`
- `KritikaChopra`
- `lab`
- `public`

**No `alex` directory on disk.** This rules out the earlier hypothesis that
the wiki-capture mock writes through to disk in real-folder mode.

### Hypothesis tree (cache locations)

Each layer searched for an `alex` entry / `alex`-seeded membership.

#### (A) OneDrive Files On-Demand cloud-only stub — **HIGH**

`fileService.listDirectories(path)` at
[file-service.ts:272](frontend/src/lib/file-system/file-service.ts:272) iterates
the FSA directory handle's `.values()` and emits every entry with
`kind === "directory"`. The FSA spec has no "is this a sync placeholder"
flag, so a cloud-only stub (the same Files On-Demand mechanism Grant
captured for KritikaChopra in Bug 2) shows up as a normal directory.

Why this is the most likely root cause for `alex`:

- The picker, `usersApi.list`
  ([local-api.ts:2917](frontend/src/lib/local-api.ts:2917)), and
  `discoverUsers`
  ([user-discovery.ts:24](frontend/src/lib/file-system/user-discovery.ts:24))
  are all single-source — they read FSA `listDirectories` and filter by
  `SKIP_DIRECTORIES`. **There is no second source layered on top that
  could inject `alex` without FSA reporting it.**
- The same Files On-Demand behavior is independently observable in Bug 2
  (cloud icon next to KritikaChopra).
- "Intermittent" matches OneDrive's stub lifecycle: a folder transitions
  between "available offline", "online-only placeholder", and "free up
  space" states depending on OS pressure and the user's right-click
  actions. Finder's column view doesn't always render placeholder folders
  identically to locally-cached ones, so a placeholder can be present in
  the FSA listing but absent or visually muted in Finder.
- How `alex` would have gotten into OneDrive in the first place: a prior
  development build, manual test of the demo before mocks landed, or a
  one-off run with `?wikiCapture=1` against the real folder before the
  mock's idempotent install order was hardened. Once `alex/` was on disk
  even briefly, OneDrive synced it up; later local deletion didn't
  necessarily delete the cloud copy.

Evidence: [file-service.ts:281-285](frontend/src/lib/file-system/file-service.ts:281)
plus the absence of any cloud-stub filtering anywhere in the file-system
module.

#### (B) FileSystemProvider stuck with patched `fileService` mid-session — **MEDIUM**

`installWikiCaptureFixture()`
([wiki-capture-mock.ts:350](frontend/src/lib/file-system/wiki-capture-mock.ts:350))
overwrites methods on the **module-scope singleton** `fileService` (the
patching mutates `svc.listDirectories = ...`, `svc.setDirectoryHandle =
() => {}`, etc.). The patch is in-place and persistent for the lifetime
of the JS context — there is no `uninstallWikiCaptureFixture()`.

The trigger condition for the patch to be active in a real-folder session:

1. Grant visits `/demo` (in the same tab he's been using for his real
   folder, e.g., by editing the URL bar).
2. `FileSystemProvider`'s initialize-effect runs `getDemoMode()` →
   true, calls `installWikiCaptureFixture()`. The singleton is patched.
   `availableUsers` is set to `["alex", "morgan"]` at line 306.
3. He navigates back to `/` via in-tab navigation (browser back, header
   logo, `router.push`, etc.) instead of a full reload.
   `FileSystemProvider` doesn't remount; the patched singleton stays.
4. Any subsequent `refreshUsers()` /
   `discoverUsers()` / `usersApi.list()` reads through the mock and
   returns `["alex", "morgan"]`.
5. Sticky `sessionStorage` demo flag
   ([wiki-capture-mock.ts:239](frontend/src/lib/file-system/wiki-capture-mock.ts:239))
   keeps `getDemoMode()` truthy, so the UI may also keep treating the
   session as demo-mode.

Note that the proper Leave Demo flow does
`window.location.replace("/")`
([LeaveDemoModal.tsx:83](frontend/src/components/LeaveDemoModal.tsx:83)),
which forces a full reload and a fresh JS context. So this path requires
the user to *bypass* the modal — possible but less common than (A).

Sub-variant: **disconnect + reconnect after demo, in the same JS
context.** `disconnect()` clears IDB and resets state, but
`fileService.clearDirectoryHandle()` is a no-op under the mock
([wiki-capture-mock.ts:382](frontend/src/lib/file-system/wiki-capture-mock.ts:382)).
`connect()` opens the OS picker, gets a real handle, calls
`fileService.setDirectoryHandle(realHandle)` — also a no-op under the
mock. `discoverUsers()` then returns the seeded `["alex", "morgan"]`
from the in-memory fixture, not the real folder.

#### (C) IndexedDB pollution from demo, with stale-cleanup bypassed — **LOW**

`installWikiCaptureFixture` unconditionally calls
`storeDirectoryHandle(fakeHandle)` and (when `signIn === true`, which is
true for both `/demo` and `?wikiCapture=signed-in`)
`storeCurrentUser("alex")` + `storeMainUser("alex")`
([wiki-capture-mock.ts:472-477](frontend/src/lib/file-system/wiki-capture-mock.ts:472)).
These hit the **shared** `research-os-fsa` IndexedDB, so a demo tab can
overwrite a real session tab's IDB-stored handle / currentUser / mainUser.

A defensive cleanup branch
([file-system-context.tsx:339-353](frontend/src/lib/file-system/file-system-context.tsx:339))
detects `storedHandle.name === "wiki-capture-fixture"` on next reload
and clears all three keys. **But this only fires if the fake handle is
still the latest-stored handle.** If the real connect flow ran *after*
the fake-handle write (e.g., Grant reconnected to his real folder after
a demo run in another tab without a reload first), the stored handle's
name is the real folder name; the heuristic is skipped; `getCurrentUser()`
still returns `"alex"` from IDB.

This explains *currentUser* being `alex` after demo, but does **not**
explain `alex` appearing in `availableUsers` — the picker membership is
sourced from FSA, not IDB. So at best this is contributory, not causal.

#### (D) `_user_metadata.json` containing an `alex` entry — **LOW (contributory only)**

The metadata file at `users/_user_metadata.json` stores per-user color +
created_at
([user-metadata.ts:10-19](frontend/src/lib/file-system/user-metadata.ts:10))
and feeds `useUserColor()`'s React Query cache
([useUserColor.ts:21-32](frontend/src/hooks/useUserColor.ts:21)). It is
**not** read by `usersApi.list` or `discoverUsers`, so a lingering
`alex` entry can't put `alex` in the picker. It can, however, color the
picker entry with the demo-blue if `alex` got there via (A) or (B).

In-context writes to this file from demo mode go through the patched
`writeJson` and land in the in-memory fixture only — no leak to disk.

Real-folder writes via `setUserMetadataField` happen from
`writeUserSettings` mirroring
([user-settings.ts:167-172](frontend/src/lib/settings/user-settings.ts:167))
and `setHideGoalsFromLab`. Both pass `username`, which in a real session
is always the connected user (Grant, FakeResearcher, etc.) — never
`alex`. So real-disk metadata-pollution is not a plausible source.

#### (E) React Query cache poisoning — **LOW**

The lab-mode users query
([useLabData.ts:21-26](frontend/src/hooks/useLabData.ts:21)) keys on
`["lab", "users"]`. The user-color map keys on `["user-color-map"]`
([useUserColor.ts:8](frontend/src/hooks/useUserColor.ts:8)). Both invalidate
on `currentUser` change
([providers.tsx:56-60](frontend/src/lib/providers.tsx:56)) and both
re-fetch through `discoverUsers` / `readAllUserMetadata`. So even a
poisoned cache is rebuilt from the same FSA + metadata source, not
persisted independently.

#### (F) sessionStorage / localStorage — **LOW**

No user-list cache lives in either store. The only sessionStorage key
relevant here is the sticky `researchos:demo-mode` flag
([wiki-capture-mock.ts:239](frontend/src/lib/file-system/wiki-capture-mock.ts:239)),
which gates the *installation* of the fixture (covered by hypothesis B),
not the user list directly.

#### (G) Module-level singleton in fileService / discovery — **LOW**

`fileService` is a singleton
([file-service.ts:362](frontend/src/lib/file-system/file-service.ts:362)),
but it stores `directoryHandle` and `readCount` only — no cached user
list. `discoverUsers`, `usersApi.list`, and `loadLabUsers` all re-call
`listDirectories` on every invocation, so there's no in-memory snapshot
to go stale.

### Most likely root cause

Ranked:

1. **(A) Cloud-only stub for `alex` in OneDrive.** The same mechanism
   Grant captured for KritikaChopra in Bug 2. Most consistent with
   "intermittent," with the absence of any in-app cache that could
   independently inject `alex`, and with the fact that all picker paths
   trust FSA `listDirectories` blindly.
2. **(B) Patched-fileService mid-session leak** — only if Grant has been
   visiting `/demo` in the same tab as his real session and bypassing
   the Leave Demo modal. Plausible during testing but unusual in normal
   use.
3. **(C+D) Combinatorial residue (IDB currentUser + metadata color
   entry)** — explains why a leaked `alex` looks "alive" (colored,
   selectable) but doesn't introduce it. Will piggyback on (A) or (B)
   without being the originator.

### Proposed fix sketch (do not implement in this chip)

A single fix covers both bugs:

- **`users/_user_metadata.json`: add `deleted_at: string | null` field
  per user entry.**
  - Field schema: `users/_user_metadata.json:10-19`
    (`UserMetadataEntry`). +1 optional field, +~5 LOC.
  - Risk: schema-bump for an existing on-disk file; needs the existing
    "missing field → undefined" handling already present in
    `readMetadataFile` (it tolerates partial objects).
- **`discoverUsers` filters out tombstoned users by joining FSA
  listing with metadata.**
  - Touch: `user-discovery.ts:15-30` (+~10 LOC) — read metadata, exclude
    names where `deleted_at != null`.
  - Mirror the same join in
    `usersApi.list` (`local-api.ts:2917`) for the lab API surface.
- **Delete flow sets `deleted_at = now()` *before* attempting FSA
  hard-delete.**
  - Touch: `usersApi.delete` (`local-api.ts:3072`) and/or
    `performUserDelete` (`perform-delete.ts:35`).
  - Hard-delete becomes best-effort. If the cloud later re-creates a
    stub, the tombstone hides it.
- **Settings/admin surface to un-tombstone (recover) a deleted user.**
  - Out of scope for the cosmetic fix; useful add-on.

Risk: schema migration is the only sharp edge — older metadata files
won't have the field, but the read path already normalizes missing
fields. No write-time migration is needed.

### What Grant can check immediately

To confirm hypothesis (A):

1. Open File Explorer / Finder and navigate to `users/` in his
   ResearchOS folder.
2. **Right-click → "View" → check that hidden / cloud-only files are
   visible.** OneDrive's column should show a status icon for each
   entry. Look for `alex/` with a cloud icon — that's a Files
   On-Demand placeholder.
3. If not visible in Finder, browse to OneDrive online
   (`onedrive.live.com`), navigate to the ResearchOS folder root, then
   `users/`, and check the cloud-side listing for `alex`. The cloud
   listing is the ground truth for what Files On-Demand can re-surface.
4. **DevTools alternative:** with the real folder connected, open the
   page console and run a simulated listing. The cleanest single-line
   probe (no patched mock running):
   ```js
   const c = await navigator.permissions.query({name:"persistent-storage"});
   // Inspect IndexedDB → Application → IndexedDB → research-os-fsa →
   // handles → "research-os-directory-handle". The stored handle has
   // a .name; if it says "wiki-capture-fixture", IDB is polluted (C).
   ```
5. To rule out (C), check IndexedDB directly: DevTools → Application →
   IndexedDB → `research-os-fsa` → `handles` and the idb-keyval store
   keys `research-os-current-user`, `research-os-main-user`. If
   `current-user` or `main-user` is `"alex"`, that confirms IDB
   pollution but not picker membership.

Expected outcome: (A) explains the picker. The cloud listing has `alex`,
or Finder reveals a cloud-stub `alex` directory when hidden items are
shown.

---

## Bug 2 — cloud-folder delete register

### Symptom

Grant deleted `KritikaChopra` via the picker delete flow. The folder
later reappeared in the picker with a cloud icon (☁️) on the entry.
This is OneDrive Files On-Demand restoring a placeholder — the cloud
copy was never deleted, sync brought back a placeholder for the local
filesystem, FSA's directory iterator sees the placeholder, and
`usersApi.list` reports the folder.

### Current delete-user flow (audit)

Two-step destructive flow with optional pre-archive zip:

1. UI (`UserLoginScreen.tsx:311-380`) prompts for confirmation, then
   (if archive checkbox is on) calls `usersApi.archive(username)` —
   walks the user's folder and packages a zip blob, triggers a browser
   download. Doesn't modify disk.
2. UI calls `performUserDelete(username, deps)`
   ([perform-delete.ts:35-48](frontend/src/lib/users/perform-delete.ts:35)),
   which:
   - Calls `usersApi.delete(username, 1, true)` — returns a "warning"
     status, no I/O.
   - Calls `usersApi.delete(username, 2, true)` — the actual deletion.
   - Clears IDB `currentUser` / `mainUser` if either matched the
     deleted name.
3. `usersApi.delete` step 2
   ([local-api.ts:3089-3107](frontend/src/lib/local-api.ts:3089)):
   ```ts
   const usersDir = await fileService.getDirectory("users");
   await usersDir.removeEntry(username, { recursive: true });
   ```
   **Hard delete, no register, no tombstone, no metadata mutation.**
4. The picker's local state mirror updates:
   `setUsers(users.filter(u => u !== deleteUserSelected))`
   ([UserLoginScreen.tsx:367](frontend/src/components/UserLoginScreen.tsx:367)).
   That's an in-memory React state mutation, not persisted anywhere;
   next picker mount calls `usersApi.list` and re-derives from FSA.

There is no record anywhere on disk that says "this user was
intentionally removed." The system has no memory of the delete.

### `_user_metadata.json` structure (audit)

Path: `users/_user_metadata.json`. Read at
[user-metadata.ts:37](frontend/src/lib/file-system/user-metadata.ts:37),
written at line 83 / 121.

```ts
interface UserMetadataFile {
  users: Record<string, UserMetadataEntry>;
}

interface UserMetadataEntry {
  color: string;
  created_at: string;
  hide_goals_from_lab?: boolean;
}
```

**No `deleted_at`, no `is_deleted`, no `archived_at`, no
`replaced_by`.** No "deleted users" list at file-top either.

Readers:

- `useUserColorMap` ([useUserColor.ts:21](frontend/src/hooks/useUserColor.ts:21))
  — pulls colors only.
- `usersApi.list`, `discoverUsers`, `loadLabUsers` — **do not consult
  this file.** They use FSA listing exclusively.
- `colorFor` ([local-api.ts:87](frontend/src/lib/local-api.ts:87)) —
  per-user color lookup, never gates membership.

So even if we *did* add a `deleted_at` field today, no picker path would
honor it. The fix needs both the field AND a join.

Writers:

- `ensureLabUserMetadata` ([user-metadata.ts:62](frontend/src/lib/file-system/user-metadata.ts:62))
  auto-adds any discovered user with a palette color. **This is the
  re-resurrection hazard for tombstones:** when the cloud restores a
  stub for a tombstoned user, the next `loadLabUsers` would see the
  folder name, fall through `ensureLabUserMetadata`, and might wipe the
  tombstone field if the merge isn't careful.
- `setUserMetadataField` ([user-metadata.ts:100](frontend/src/lib/file-system/user-metadata.ts:100))
  — single-field update preserving the rest. Safe for tombstones.
- `writeUserSettings` mirrors color + `hide_goals_from_lab` only.

### Cloud-only stub detectability via FSA

**Short answer: not reliably.** The FSA spec doesn't expose Windows
file attributes (`FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`,
`FILE_ATTRIBUTE_OFFLINE`) or any cloud-provider metadata. Some indirect
probes:

| Probe | Cost | Reliability | Notes |
|---|---|---|---|
| `for await (entry of subDirHandle.values())` and check if iteration yields 0 children | 1 FSA op | Low | A real empty user folder also iterates to 0; can't distinguish |
| Try `getFileHandle("_counters.json")` and `getFile().size` | 2-3 FSA ops | Low | Triggers OneDrive to pull the stub locally (defeats the purpose) and a placeholder may still answer with valid bytes |
| Time-box the directory open | wall-clock | Very low | OneDrive cache state is unpredictable |
| Check name against `_user_metadata.json` `deleted_at` | 1 cached read | **High** | This is the tombstone approach — doesn't probe the cloud at all |

The takeaway: **detecting cloud stubs via FSA is a dead end.** The
register / tombstone approach sidesteps the detection problem entirely
by keeping a separate authoritative list of "users the human deleted on
purpose."

### Proposed register patterns (sketches — NOT implemented)

#### (a) Hard delete only (status quo)

Pros: simplest; works perfectly on local-only folders.
Cons: cloud sync re-creates the placeholder; bug persists. **Insufficient.**
Cloud generality: fails identically on OneDrive, Dropbox, Google Drive.

#### (b) Standalone `users/_deleted_users.json` register

Schema: `{ "deleted": [{ "username": "alice", "deleted_at": "ISO" }, ...] }`.
Pros: separation of concerns; no risk of stomping color/metadata
schema; easy to grep / inspect.
Cons: another file to keep consistent with `_user_metadata.json`; two
sources of truth for "is this user real."
Cloud generality: works for any sync provider — the register file
itself is just a JSON file under `users/`, and it syncs to the cloud
along with everything else. If the register is deleted from the cloud
side, tombstones are lost, but that's an acceptable failure mode.

Effort: M (~50 LOC, new file + 2 read sites).

#### (c) Tombstone field in `_user_metadata.json` — **RECOMMENDED**

Schema:
```ts
interface UserMetadataEntry {
  color: string;
  created_at: string;
  hide_goals_from_lab?: boolean;
  deleted_at?: string;  // ISO timestamp, null/missing = active
}
```

Picker / discovery filter:
```ts
const meta = await readAllUserMetadata();
const all = await fileService.listDirectories("users");
return all
  .filter(name => !SKIP_DIRECTORIES.has(name))
  .filter(name => !meta[name]?.deleted_at)
  .sort();
```

Delete flow:
1. Archive (unchanged).
2. `setUserMetadataField(username, "deleted_at", now())` — survives
   sync, hides the entry.
3. Attempt FSA `removeEntry(username, { recursive: true })` as
   best-effort; on cloud-only folders this won't actually nuke the
   cloud copy, but that's fine.

Pros: single file, single source of truth, sync-safe (the tombstone
itself is in a cloud-synced file so it re-arrives wherever the stub
re-arrives), generalizes across cloud providers, recoverable
("un-tombstone" by clearing `deleted_at`).

Cons: `ensureLabUserMetadata` must be made tombstone-aware so a
re-discovered folder doesn't wipe the field. One-line guard:
```ts
for (const username of usernames) {
  if (file.users[username]) continue;  // already covers tombstone preservation
  ...
}
```
The existing `if (file.users[username]) continue` already skips users
with any entry, so tombstones survive `ensureLabUserMetadata` calls.
The only place that needs a defensive read is anywhere that
unconditionally writes to `file.users[username] = { color, created_at,
...}` — `setUserMetadataField`'s existing spread (`{ ...existing, ... }`)
already preserves the field.

Cloud generality: same as (b) — works for any provider that syncs the
JSON file.

Effort: **S (~30 LOC)**. Field add + filter at two sites + delete-flow
mutation + test updates.

#### (d) On-load reconciliation with user prompt

On every FSA mount, walk `users/` and compare against
`_user_metadata.json`. For each name found on disk but not in the
metadata file (or vice versa), prompt the user:
"New user folder detected: `alex`. Add to your lab / Ignore / Delete."

Pros: explicit; surfaces unexpected state to the user.
Cons: high UX surface; every cloud-stub appearance triggers a modal;
annoying after the first occurrence. Doesn't actually solve the
delete-register problem on its own — just makes the user re-confirm
each time.
Cloud generality: same complexity profile for any provider.

Effort: M (~80 LOC, new modal + reconciler).

#### (e) Tombstone-and-chase

(c) plus: every app load, iterate tombstoned entries and call
`removeEntry` on each — try to chase the cloud's restoration.

Pros: aspires to keep the local folder clean.
Cons: produces sync conflicts (the local delete fights the cloud
restore), wastes I/O, requires sync-provider-specific tuning to avoid
fight loops. Doesn't help if the user is offline / sync paused.
Cloud generality: behavior varies widely by provider.

Effort: M-L (tombstone-and-chase is fragile in cross-provider testing).

#### (f) New: tombstone with self-healing on un-tombstone

(c) plus: when a user manually un-tombstones (settings page action),
the metadata entry's `deleted_at` is cleared *and* the local folder is
reconciled. If the folder still exists locally (or as a stub), the
un-tombstone is a no-op disk-wise; if the folder is gone, the user is
warned that "the data is no longer present, restoring just the user
identity."

Captures the recovery UX without the constant-chase tax of (e).

Effort: S extra on top of (c).

### Recommended pattern

**(c) Tombstone in `_user_metadata.json`, with the matching join in
`discoverUsers` + `usersApi.list`. Hard delete becomes best-effort.**

Reasoning:

1. **Single source of truth.** The metadata file is the only file the
   app already trusts for per-user state; piggybacking on it avoids
   the "which file wins" question (b) introduces.
2. **Sync-safe by construction.** The tombstone field rides into the
   cloud with the rest of `_user_metadata.json`. When OneDrive
   re-creates a placeholder for `KritikaChopra/`, the tombstone is
   already on disk waiting to hide it. (b) has this property too;
   (a) and the current state don't.
3. **No cloud-stub detection required.** The fix doesn't probe FSA for
   stub-ness, doesn't depend on provider-specific attributes, and works
   identically on Dropbox / Google Drive / iCloud / a local-only
   folder. (d) and (e) bake in cloud-provider specifics.
4. **Recoverable.** A user-facing "Restore deleted users" affordance
   becomes a single-field flip, not a multi-step file restore.
5. **Smallest blast radius.** ~30 LOC, two new test cases on top of
   the existing `perform-delete.test.ts`. (d) and (e) are 2-3× the
   surface area and add UX states.

The orthogonal "should we delete the local folder bytes too" question
should default to *yes, best-effort* — the archive zip is the user's
backup; the recursive `removeEntry` is fine to attempt. The bug is the
**re-appearance**, not the deletion itself.

Estimated effort: **S** (single afternoon).

---

## Shared root: user-list refresh path

**Both bugs reduce to the same defect.** ResearchOS treats
`fileService.listDirectories("users")` as a complete enumeration of
real users. Every consumer (`discoverUsers`, `usersApi.list`,
`loadLabUsers`, `labApi.getUsers`, the inbox / notes / purchase
aggregators at `local-api.ts:1698, 2854, 2874`, the search index at
1698, the archive walker at 3037) trusts the FSA listing without a
second authoritative source.

That's fine on a single-user, local-only disk. It breaks on **any
cloud-synced folder** because:

- Cloud sync can create directory entries the user didn't create
  (stubs / placeholders).
- Cloud sync can re-create directory entries the user just deleted.
- There's no way via the FSA spec to tell "real folder" from "cloud
  placeholder."

The fix is to introduce a second authoritative source — a tombstone /
register — that the user (not the cloud) controls. The recommended
pattern (c) covers both:

- **Bug 1 (`alex` leak):** once Grant deletes `alex` from the picker
  once, the tombstone hides it permanently regardless of OneDrive's
  cloud-stub behavior. The cosmetic re-appearance stops.
- **Bug 2 (`KritikaChopra` re-appearance):** identical mechanism. The
  tombstone hides the cloud-restored placeholder. The user doesn't
  have to keep re-deleting.

**One chip fixes both.** This is the strong recommendation: scope the
follow-up as a single tombstone chip, not two parallel fixes.

---

## Recommended next chips

### Chip: User tombstone register (single fix for both bugs)

**Scope:**
1. Add `deleted_at?: string` field to `UserMetadataEntry` in
   `user-metadata.ts`.
2. Filter tombstoned users out of `discoverUsers` and `usersApi.list`
   via a join with `readAllUserMetadata`.
3. Modify `performUserDelete` / `usersApi.delete` to set `deleted_at =
   new Date().toISOString()` before the FSA `removeEntry`. Keep the
   hard delete as best-effort.
4. Update `perform-delete.test.ts` with two new cases: tombstone is
   set before removeEntry; tombstone is preserved when
   ensureLabUserMetadata runs against a re-appeared stub.
5. (Optional, follow-on) Settings → "Hidden users" panel to un-tombstone.

**Out of scope (defer):**
- Settings-page UI to un-tombstone (separate chip if desired).
- Reconciliation prompt for unknown folders (pattern (d)).
- Cloud-provider-specific cleanup (pattern (e)).

**Risk callouts for the fix chip:**
- `ensureLabUserMetadata` already preserves existing entries; verify
  via test that a tombstoned `alex` survives a discovery pass that
  finds `alex/` on disk.
- One-time backfill / migration: not needed — missing `deleted_at`
  reads as `undefined`, which is falsy and treated as "active." No
  forward-write needed for existing files.
- Verify the picker mode (`UserLoginScreen.tsx`) and the lab Users
  panel (`useLabData.ts`) both honor the filter via integration test.

**Verification before merge:**
- Manual: with Grant's real folder, delete a test user, observe it
  stays gone across reload + cloud-sync round-trip.
- Manual: confirm `alex` disappears after one tombstone (Grant's Bug 1).
- Unit: `perform-delete.test.ts` expansions.

Signed: HR.
