# Seamless folder reconnect on login

Date 2026-06-20
Status DESIGN, decision doc. No code in this pass.
Author seamless-reconnect design-agent
Related `[[project_reload_one_click_reconnect]]`, `[[project_account_centric_folder_identity]]`, `[[project_login_flow_fixes]]`, `[[project_page_boot_loader]]`, `docs/proposals/2026-06-18-reload-one-click-reconnect.md`, `docs/proposals/2026-06-15-account-folder-identity-redesign.md`

## The report

Grant, live. Every login the app "has no memory of the paths linked to the account". A returning user who already has a folder connected is dropped on the `/account` folder-connect screen and made to re-pick their folder through the OS picker, every single time. Grant's ideal is plain. If a user logs in and they already have a folder connected, they should NOT see that screen unless they navigate to profile settings on purpose.

Second, a just-shipped "splash on every login" change (branch `claude/splash-every-login`) does not actually show its splash. Same root cause.

This doc explains the File System Access constraint that bounds any fix, names the precedence bug that produces both symptoms, specifies a reconnect state machine for login, and gives a phased build plan.

## 1. The File System Access constraint (what we can and cannot store)

The whole app reads and writes one folder on the user's disk through the File System Access API (FSA). There is no backend for data (`AGENTS.md` section 1).

FSA has no re-openable path. Access is a `FileSystemDirectoryHandle`, an opaque, device-local object. There is no portable path string, and the absolute path is deliberately hidden, even the folder name is the only thing the API exposes (`file-system-context.tsx:79` comments this on `folderMissing`, "the File System Access API hides the absolute path"). A handle is granted only by the user through the OS picker (or a folder drop), and it is per-device, per-browser-profile. It does not travel to another machine or browser.

A handle CAN be persisted on the same device. We structured-clone it into IndexedDB (`research-os-fsa` DB, `handles` store, via `storeDirectoryHandle` / `getStoredDirectoryHandle`, imported `file-system-context.tsx:6-8`). On the next load we can re-attach to it WITHOUT the OS picker, by checking and re-granting permission on the stored handle.

Permission is the catch. Chrome can drop the readwrite grant after a session ends. The persisted handle survives, but its `queryPermission({mode:"readwrite"})` then returns `"prompt"` instead of `"granted"`. Re-granting requires `requestPermission`, which the browser only honors inside a user gesture. So a silent, zero-click reconnect is possible exactly when Chrome still says `"granted"`, and a one-click re-grant (a single Allow) is the unavoidable floor when it says `"prompt"`. This is a browser behavior, not something we can defeat.

What this means for the cloud. The cloud can know that an account HAS a folder and can store light metadata about it (a display name). It can NEVER store the handle or a re-openable path, and it can never silently reconnect another device. "Seamless reconnect" is therefore a PER-DEVICE story told from IndexedDB, never a cloud story.

Concretely.
- Cloud MAY store. account-has-a-folder boolean, folder display name, last-active folder id for ordering. None of it can reopen the folder.
- Cloud CANNOT store. the `FileSystemDirectoryHandle`, the absolute path, anything that re-grants permission. Those live only in this device's IndexedDB and only the user's gesture re-grants them.

The good news. The handle and the re-grant machinery already exist and already work. The 2026-06-18 investigation (`docs/proposals/2026-06-18-reload-one-click-reconnect.md`) confirmed the folder side needs verification, not rebuilding. The silent-granted path is implemented at `file-system-context.tsx:993-1023`, and a one-click "Reconnect <folder>" button already renders in `FolderConnectGate.tsx:432-458`, `AccountHome.tsx:285-300`, and `AccountHub.tsx:308-309`. What is broken is not the reconnect, it is a gate that fires before the reconnect is ever offered.

## 2. Root cause, the account-first redirect preempts the reconnect and the splash

The entry state machine is a chain of early-return branches in `AppContent` (`providers.tsx`). The order they appear in the function is the order they win. The relevant ones, in source order on `main`:

1. `isLoading` -> `StagedLoadingScreen` (`providers.tsx:942-955`).
2. post-OAuth HOLD, account-first on and `hasCloudSession === null` (`providers.tsx:1082-1096`).
3. account-first redirect, account-first on and `hasCloudSession === true && !isConnected && !currentUser && !needsInitialization` -> `<AccountFirstRedirect/>` (`providers.tsx:1106-1127`).
4. front-door / sign-in / folder-connect-gate branches below (`providers.tsx:1146+`, the `!isConnected` gate at `1289`).

`isAccountFirstEnabled()` is DEFAULT-ON (`account-first.ts:16-20`, "On unless explicitly disabled"). So branch 3 is live in prod.

Now trace a returning user logging in on a device that already has a stored handle.

The FSA boot effect runs in `file-system-context.tsx:745-1058`. Initial state is `isLoading: true` (`file-system-context.tsx:275`), so the very first paint takes branch 1 and shows the loading screen. Inside the effect, the silent-reconnect block reads the stored handle and calls `queryPermission({mode:"readwrite"})` (`file-system-context.tsx:993-998`).

- If Chrome returns `"granted"`, the effect sets `isLoading: true`, then `finishConnect` flips `isConnected: true` (`file-system-context.tsx:998-1015`, `finishConnect` at `690-702`). Branch 1 stays in control through the connect, the user lands in the app. This case is already fine.

- If Chrome returns `"prompt"` (the lapsed-grant case Grant is hitting), the granted block is skipped. The effect falls through to the bottom and sets `isLoading: false` with `lastConnectedFolder` populated from the stored handle name (`file-system-context.tsx:1040-1050`). Now `isLoading` is false, `isConnected` is false, `currentUser` is null. `useHasCloudSession` resolves to true a tick later (`AccountFirstRedirect.tsx:32-44`). Branch 3 matches and renders `<AccountFirstRedirect/>`, which `router.replace`s to `/account` (`AccountFirstRedirect.tsx:77-88`). The user sees the folder-connect screen even though a perfectly good stored handle is sitting in IndexedDB one Allow click away.

That is the bug. The account-first redirect fires the moment `hasCloudSession` resolves, on `!isConnected && !currentUser`, with no regard for whether a stored handle exists and could be reconnected. It preempts the one-click reconnect by routing to `/account` first, and on `/account` the reconnect is a manual button, not an automatic attempt. So every login looks like "no memory of the folder".

Same root cause for the splash. On the `claude/splash-every-login` branch the login-splash floor branch (`/tmp` view of that branch, `providers.tsx:1152-1166`, condition `loginSplashFloorActive` armed by `isLoginReturn = sharingClaimReturn || signInInFlight`, `:646`) sits ABOVE the account-first redirect (`:1176-1197`). But the floor only arms during an active OAuth RETURN window (`?sharingClaim` / `?signIn` in flight). A plain reload or a return that has already cleared its markers is not a "login return", so `loginSplashFloorActive` is false and the splash branch does not match. The account-first redirect then wins and routes to `/account`, so the splash never gets its minimum window. The floor was scoped to the OAuth-return query markers, but the case Grant sees (already-authed reload, no markers) skips it entirely and lands on the redirect.

Net. one precedence chain explains both. The fix is to insert a reconnect-aware hold ABOVE the account-first redirect so that, when a stored handle exists, we attempt the silent reconnect (and on lapse offer one click) BEFORE we ever route a folderless-looking session to `/account`.

## 3. The reconnect state machine on login

Evaluated in order, on every load where a cloud session resolves true (and in the no-account / flag-off cases, on every load period). It runs as a hold ABOVE the account-first redirect, under the same `StagedLoadingScreen` splash, so the user sees the brand splash, not a flash of `/account`.

Inputs. `storedHandle = getStoredDirectoryHandle()`, `permission = queryPermission({mode:"readwrite"})` on it, `isConnected`, `currentUser`, `lastConnectedFolder`.

a. Stored handle AND `permission === "granted"`. SILENT reconnect. This is the existing `file-system-context.tsx:993-1015` path and already works. `finishConnect` flips `isConnected`, the user lands straight in the app, the splash covers the transition. NEVER show the folder screen. No change needed beyond making sure the splash holds across it (Phase 1, item 4 below).

b. Stored handle AND `permission === "prompt"` (grant lapsed). A ONE-CLICK affordance, not the generic picker and not the generic `/account` screen. Show a focused "Reconnect <foldername>" card (the FolderConnectGate panel content at `:432-458` is the right shape). The single Allow click is the user gesture `requestPermission` needs (`reconnectWithStoredHandle` -> `requestPermission`, `file-system-context.tsx:1133-1183`). On grant, land in the app via client nav (NOT a hard reload, see the AccountHome note at `:294-300`, a reload re-lapses the fresh grant). This card must render INSTEAD OF the `/account` redirect, which means the entry chain has to recognize "a stored handle exists" as a higher-precedence state than "folderless, route to /account".

c. No stored handle (new account, or after an explicit forget-this-device). The folder-connect screen / picker, today's behavior. For an account-first signed-in user with genuinely no folder, `/account` is still correct (that is the account-first design, a folderless home). The state machine only diverts from `/account` when a stored handle is present.

d. Explicit full sign-out, forget or remember. RECOMMENDATION below.

### Decision d. does a full sign-out forget the device or keep it for one-click next login

Today it FORGETS. `fullSignOut` (`full-sign-out.ts:31-62`) calls `opts.disconnect()` (step 2, `:46-54`), which in single-folder mode runs `clearDirectoryHandle()` and wipes the stored handle (`file-system-context.tsx:1481-1482`). The comment is explicit, forget the folder so the reload cannot auto-reconnect (`full-sign-out.ts:21-22, 46-47`). That is deliberate, a full sign-out is a full logout and should not silently re-enter the app.

Recommendation. KEEP forget-on-explicit-sign-out as the default. It is the correct privacy posture and it matches the user's mental model of "sign out". The seamless story is for RELOAD and RE-LOGIN, not for after an explicit sign-out. A user who signs out is telling us to forget.

Refinement worth a Grant call. Distinguish "Sign out" (forget the device, today's behavior) from a lighter "Lock" or "Switch account" that keeps the handle for one-click return. On a personal laptop, forgetting on every sign-out is more friction than most solo users want, but on a shared computer forgetting is the safe default. See Open Question 1. Until Grant decides, do not change `fullSignOut`, keep forget-on-sign-out.

## 4. Splash integration

The splash (`StagedLoadingScreen`) must cover the login -> silent-reconnect -> app transition as one continuous brand moment, and must not flash `/account` in the middle.

The fix is precedence, not new splash code. Insert the reconnect-aware hold ABOVE the account-first redirect (above `providers.tsx:1106`). While a stored handle exists and the silent-reconnect attempt is in flight (or the cloud-session check has not yet resolved), hold on `StagedLoadingScreen`. Only fall through to the account-first redirect when state (c) is reached, genuinely no stored handle.

This SUPERSEDES the current login-splash-floor branch on `claude/splash-every-login`. That branch armed the splash only on the OAuth-return markers (`isLoginReturn`, `:646`), which is why it misses the already-authed reload. The reworked hold keys on "stored handle present and reconnect not yet resolved", which covers reload, re-login, and OAuth-return uniformly. Keep the `LOGIN_SPLASH_MIN_MS` minimum-display idea (`:438`, 1500ms) so a fast silent reconnect still reads as a deliberate splash rather than a sub-second flash, but drive it off the reconnect attempt, not off the query markers. When that branch merges, reconcile it against this hold rather than landing both.

## 5. Where the folder screen SHOULD still appear

The "unless they navigate to profile settings" part. The folder screen and the `/account` folder controls remain the intentional place to change or disconnect a folder.

- `/account` (AccountHome / AccountHub) stays the home for a signed-in user with NO stored handle (state c). That is the account-first design and is correct.
- Changing or disconnecting a folder is a deliberate action the user takes from account / profile settings, the existing connect / reconnect / disconnect controls there (`AccountHome.tsx:285-318`). The state machine never auto-routes a user with a good stored handle to that screen, but the user can always reach it on purpose.
- The folder-missing path (handle stale because the folder moved / renamed / deleted on disk) still surfaces its clear "locate or pick another" screen (`file-system-context.tsx:468-481`, `folderMissing`). That is a real dead end the user must resolve, not a silent reconnect case.

No soft-locks (`[[feedback_no_soft_locks]]`). Every reconnect surface keeps a visible "pick a different folder" / "open another folder" escape, including the one-click card in state (b).

## 6. Multi-folder, which folder reconnects

`MULTI_FOLDER_ENABLED` is OFF by default in prod (`multi-folder-config.ts:17-19`), so the common case is single-folder, the one stored handle reconnects, full stop.

When the flag is on, the app remembers a SET of folders with an ACTIVE pointer (`getActiveFolderId` / `setActiveFolderId`, the remembered set carries each structured-clone handle, `file-system-context.tsx:496-507, 718-728`). The state machine reconnects the ACTIVE / last-active folder, the one `getStoredDirectoryHandle` already returns (the legacy single key is kept in lockstep with the active folder, `:494-507`). The pinned-picker composes as a SECONDARY affordance, after the active folder reconnects (or in the state-b card), the user can one-click switch to another pinned folder via `switchFolder` (`:1632+`) / `FolderSwitcher` (`FolderConnectGate.tsx:461-467`). Pinned order does not change which folder auto-reconnects, last-active wins. At most three folders pin (`setFolderPinned`, `file-system-context.tsx:172-180`).

## 7. Edge cases

- Permission revoked mid-session. The handle goes stale on the next file op, `finishConnect`'s escape-hatch and `isDirectoryHandleMissing` probe already distinguish a vanished folder from an empty one (`file-system-context.tsx:460-492`). On the next load this resolves to state (b), one-click re-grant.
- Second account on the same device. The stored handle is per-device, not per-account. If user B signs in on user A's device and a stale handle is present, the reconnect attempt should NOT silently open A's folder under B's account. Gate the silent reconnect on identity, only auto-reconnect when the cloud session matches the account associated with the stored folder, otherwise fall to state (c). This is a real correctness item, flagged as Open Question 2.
- The misleading "Initialize New Folder" prompt. Already guarded, a present-but-empty folder flips `needsInitialization` and the account-first redirect is explicitly skipped on `needsInitialization` so it does not loop the first-folder onboarding (`providers.tsx:1111-1115`, `file-system-context.tsx:482-491`). The state machine must preserve that, do not reconnect-hold a `needsInitialization` folder, let it fall to the init prompt.
- Demo / wikiCapture. UNTOUCHED. Those modes early-return above every gate (`providers.tsx:919-940`, fixture branch `file-system-context.tsx:756-877`) and seed their own connected state. The reconnect hold sits below the demo / wiki-capture return, so it never runs in those modes. Verify the hold is placed after the `isDemoOrWikiCapture()` returns.
- Account-first flag off. With `NEXT_PUBLIC_ACCOUNT_FIRST=0`, branch 3 is inert and the old folder-first flow runs, which already lands on `FolderConnectGate` with its one-click reconnect (`FolderConnectGate.tsx:432-458`). The state machine still improves this case by attempting the SILENT reconnect under splash before showing the gate, but it must stay byte-compatible when there is genuinely no handle.

## 8. Phased build plan

Phase 1, attempt silent reconnect under splash before the /account redirect, plus a one-click fallback that is not /account.
- Insert a reconnect-aware hold ABOVE the account-first redirect in `providers.tsx` (above `:1106`), below the demo / wiki-capture returns. Hold on `StagedLoadingScreen` while a stored handle exists and the silent-reconnect attempt or the cloud-session check is unresolved.
- When `queryPermission` is `"prompt"`, render the one-click "Reconnect <folder>" card (reuse the FolderConnectGate panel content) INSTEAD OF routing to `/account`. Land via client nav, not reload.
- Reconcile / supersede the `claude/splash-every-login` floor so the splash holds across the reconnect on every login, not just on the OAuth-return markers.
- Files. `providers.tsx` (the gate chain + the new hold), possibly a small `lib/file-system/` helper to expose "has a stored handle, and its permission state" cleanly to the gate, `FolderConnectGate.tsx` / a shared reconnect card if extracted. No on-disk format change, no cloud change.

Phase 2, polish and settings entry.
- Confirm `/account` and profile-settings remain the deliberate place to change / disconnect the folder, and that the only auto-route to it is state (c).
- Multi-folder, surface the last-active reconnect plus the pinned switcher in the state-b card when the flag is on.
- Optional, the Lock vs Sign-out split from Decision d if Grant wants it.
- Files. `AccountHome.tsx` / `AccountHub.tsx` (settings entry copy), `full-sign-out.ts` only if the Lock split is approved, `FolderSwitcher` composition.

## 9. Open questions for Grant

1. Explicit sign-out, forget or remember the device. Recommendation is KEEP forget-on-sign-out (today's behavior, the safe and intuitive default). Do you want an additional lighter "Lock" / "Switch account" that keeps the handle for one-click return, distinct from a full "Sign out" that forgets? The shared-computer privacy angle, on a shared lab machine, forgetting on sign-out is the safe default, but a "remember" option would be a footgun there unless it is clearly the non-default.
2. Second account on the same device. Should the silent reconnect be gated on the cloud session matching the account tied to the stored folder, so signing in as a different person never auto-opens the previous person's folder. Recommendation is YES, fall to the picker when the account does not match.
3. The one-click card in state (b), is the focused "Reconnect <folder>" card the right surface, or should that case still route through `/account` (where the same reconnect button lives) for consistency. Recommendation is the focused card, it is fewer clicks and matches Grant's "land them in the app, not the folder screen" ask.
4. Minimum splash window. Keep `LOGIN_SPLASH_MIN_MS` at 1500ms for the deliberate brand moment, or shorten it so a fast silent reconnect feels instant. Tradeoff is brand presence vs perceived speed.
