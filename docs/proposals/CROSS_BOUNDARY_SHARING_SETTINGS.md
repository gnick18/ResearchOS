# Settings and Account, Catching Up to the Sharing Model

The sharing work introduced a global identity, a relay inbox, and a two-layer login model, and Settings has not caught up. This doc plans the Settings pass, two new sections to add, and two existing areas that must CHANGE because of decisions already locked in CROSS_BOUNDARY_SHARING_IDENTITY_INTERACTION.md. It is a design contract, the build is a phase after the notes send/receive loop is working and tested.

This revision turns the starter draft into a build-ready spec. Every row, control, state, and copy string a developer needs is named below, along with exactly how each piece plugs into the existing Settings page (`frontend/src/app/settings/page.tsx`) and the components and hooks it reuses. Where a product number was still open, this doc recommends a default and marks it "recommended, pending Grant" rather than leaving it dangling.

---

## Why Settings has to change, not just grow

Today Settings has a Security section (a local password), a Lab Mode tab (a separate PI password, a lab roster that can archive/restore members, a Member/PI toggle), and Telegram as the only notification channel. None of it knows about the global sharing identity, none of it shows the relay inbox or its limits, and the password and lab-management model still assumes the old "local password is the only gate, a lab head manages member accounts" world. The locked decisions (D1, D5, D6) change that world, so two existing areas must be revised, not merely extended.

---

## Grounding, the existing Settings pattern this slots into

Read `frontend/src/app/settings/page.tsx` before building. The pieces this spec relies on:

- **`SettingsBody`** is the page. It loads `settings` once per user (`readUserSettings`, lines 339 to 358) and exposes the single canonical save path `update(patch)` (lines 366 to 413), which writes `users/<user>/settings.json` through `patchUserSettings` and rehydrates the Zustand store. Every preference section takes `{ settings, update }` (the `SectionProps` interface, lines 703 to 706).
- **`SectionShell`** (lines 708 to 765) is the card wrapper. It takes `title`, optional `description`, optional `id` (URL hash anchor, used by deep links like `/settings#telegram`), optional `tourTarget`, and `searchKeywords`. It auto-registers with the page search filter. Every section is one `SectionShell`.
- **`ToggleRow`** (lines 4474 to 4522), **`SelectField`** (lines 4432 to 4472), and **`SearchableRow`** (`search-context.tsx` lines 222 to 273) are the row primitives. New rows that should be searchable wrap their control in `SearchableRow` (label plus optional desc), exactly as `ToggleRow` and `SelectField` already do.
- **Section registration** is plain JSX order inside `SettingsBody`. The Personal stream is the `<> ... </>` block at lines 490 to 524. The Lab Mode tab content is `LabModeTabContent` (lines 1365 to 1387). To add a Personal section you drop a component into the lines 490 to 524 block at the desired position. To change Lab Mode you edit `LabModeTabContent`.
- **The tab split** (`SettingsTab`, lines 161 to 165, `isLabMode`, lines 251 to 254). Solo accounts never see the tab strip and get the single Personal stream. Lab accounts get Personal (default) plus Lab Mode.
- **Modals from `SettingsBody`.** `AccountPasswordPopup` is opened by `SecuritySection` through `pwOpen`/`onOpen` (lines 518 to 521 and 535 to 543). New popups (the sharing wizard, rotate, restore, disconnect confirm) follow the same parent-owns-the-open-state pattern so a section button flips a boolean in `SettingsBody`.

The sharing sections do NOT use `settings`/`update`, because the identity link is not a `settings.json` field. It lives in `users/<user>/_sharing_identity.json` (the sidecar, read by `useSharingIdentity`) and in IndexedDB (the device private key). So the sharing sections take the `useSharingIdentity()` hook plus a small set of new callbacks, not the `SectionProps` contract. This is called out per section below.

---

## Decision, one combined "Sharing" section vs two

**Recommended (pending Grant): one combined "Sharing" section with two labeled blocks inside it, "Your identity" and "Inbox and storage".**

Rationale. The two are tightly coupled in the user's head ("my sharing"), and the inbox-and-storage block is meaningless until an identity exists. Splitting them into two top-level cards puts an empty, confusing storage card above an unclaimed identity for every user who has not set up sharing yet. One card lets the storage block simply not render (or render a one-line "set up sharing to use the inbox" stub) until `status === "ready"`, which is cleaner. It also keeps the Personal stream shorter, which the beta de-bloat feedback explicitly asked for. The two blocks are still visually distinct (a divider and a sub-heading each), so nothing about the information is lost.

The spec below is written for the combined section. If Grant prefers two cards, the same rows split cleanly across two `SectionShell`s with no copy changes; the only difference is the empty-state handling described under Inbox and storage.

Placement in the Personal stream (the lines 490 to 524 block): insert the Sharing section directly after `AccountSection` and before `ProfileSection`. Rationale, it is account-level identity, so it belongs next to "Account" (who you are signed in as locally), above the appearance and preference sections. The new order around the insertion point:

```
DataFolderSection
AccountSection
SharingSection        <- NEW
ProfileSection
ProfessionalModeSection
...
```

---

## Section, Sharing (Personal tab)

The single home for the global identity and the relay budget. New component, `SharingSection`, in `page.tsx` (or split into `frontend/src/components/settings/SharingSection.tsx` if `page.tsx` size is a concern, it is already 4500+ lines). It is rendered only in the Personal stream.

### Wiring

```tsx
// inside SettingsBody, with the other useState hooks
const sharing = useSharingIdentity();          // hooks/useSharingIdentity.ts
const [sharingWizardOpen, setSharingWizardOpen] = useState(false);
const [rotateOpen, setRotateOpen] = useState(false);
const [restoreOpen, setRestoreOpen] = useState(false);
const [disconnectOpen, setDisconnectOpen] = useState(false);

// in the Personal block, after AccountSection:
<SharingSection
  currentUser={currentUser}
  sharing={sharing}
  onSetUp={() => setSharingWizardOpen(true)}
  onRotate={() => setRotateOpen(true)}
  onRestore={() => setRestoreOpen(true)}
  onDisconnect={() => setDisconnectOpen(true)}
/>

// alongside the other modals at the bottom of SettingsBody:
{sharingWizardOpen && currentUser && (
  <SharingSetupWizard
    username={currentUser}
    onComplete={() => { void sharing.refresh(); }}
    onClose={() => { setSharingWizardOpen(false); void sharing.refresh(); }}
  />
)}
{rotateOpen && currentUser && (
  <RotateIdentityPopup
    username={currentUser}
    sidecar={sharing.sidecar}
    onClose={() => { setRotateOpen(false); void sharing.refresh(); }}
  />
)}
{restoreOpen && currentUser && (
  <RestoreIdentityPopup
    username={currentUser}
    sidecar={sharing.sidecar}
    onClose={() => { setRestoreOpen(false); void sharing.refresh(); }}
  />
)}
{disconnectOpen && currentUser && (
  <DisconnectIdentityPopup
    username={currentUser}
    onClose={() => { setDisconnectOpen(false); void sharing.refresh(); }}
  />
)}
```

`SharingSetupWizard` already exists (`frontend/src/components/sharing/SharingSetupWizard.tsx`), props `{ username, onComplete, onClose }`. The three popups (`RotateIdentityPopup`, `RestoreIdentityPopup`, `DisconnectIdentityPopup`) are NEW and specified below.

`useSharingIdentity()` returns `{ status, sidecar, email, isReady, refresh }` where `status` is `"loading" | "none" | "needs-restore" | "ready"` (`hooks/useSharingIdentity.ts` lines 32 to 87). The section branches on `status`.

### Identity block, the four `status` branches

The section header is always rendered:

`SectionShell` props:
- title: `Sharing`
- description: `Send notes, methods, and files to people outside your folder, and pick up what they send you. Your identity is one verified email plus a keypair that lives on this device.`
- id: `sharing`
- searchKeywords: `sharing identity key fingerprint recovery words inbox relay storage send receive email rotate restore disconnect cross-folder collaborate`

Inside the card, render the "Your identity" sub-block first, branching on `status`.

#### status === "loading"

A single muted line, no controls.

```
Your identity
  Checking your sharing setup...
```

Copy: `Checking your sharing setup...`

#### status === "none" (no sidecar, never claimed)

Explainer plus one primary button. Mirrors D4, intent-triggered claim.

ASCII:

```
+--------------------------------------------------------------+
| Sharing                                                      |
| Send notes, methods, and files to people outside your        |
| folder, and pick up what they send you. Your identity is     |
| one verified email plus a keypair that lives on this device. |
|                                                              |
|  Your identity                                               |
|  You have not set up sharing yet. Set it up to send and      |
|  receive research across folders. It takes about a minute    |
|  and you stay in control of your keys.                       |
|                                                  [ Set up    |
|                                                   sharing ]  |
+--------------------------------------------------------------+
```

Copy:
- sub-heading: `Your identity`
- body: `You have not set up sharing yet. Set it up to send and receive research across folders. It takes about a minute and you stay in control of your keys.`
- button: `Set up sharing` (primary blue, `onClick={onSetUp}`)

No inbox-and-storage block renders in this branch (nothing to budget yet). Optionally a single muted line under the divider: `The inbox appears here once sharing is set up.` Recommended to include it so the section does not look truncated.

#### status === "ready" (sidecar present, local key present)

The full claimed view. Read every displayed value from `sharing.sidecar` (`SharingIdentitySidecar`, fields `email`, `fingerprint`, `claimedAt`, `recoveryConfirmedAt`).

ASCII:

```
+--------------------------------------------------------------+
| Sharing                                                      |
| ...description...                                            |
|                                                              |
|  Your identity                          [ On this device ]   |
|  Email          you@university.edu                           |
|  Fingerprint    8F2A 19C4 ...  (mono)        [ Copy ]        |
|  Set up         March 14, 2026                               |
|  Recovery words Confirmed                                    |
|                 (or)  Not confirmed  [ View / confirm ]      |
|                                                              |
|  [ Rotate key ]   [ Disconnect from this device ]           |
|  ----------------------------------------------------------  |
|  Inbox and storage                                           |
|  3 pending shares, 4.2 MB of 200 MB used    [progress bar]  |
|  Pending shares are held for 30 days, then removed. Each     |
|  person can hold up to 50 pending shares at a time.          |
|                                                  [ Open      |
|                                                   inbox ]    |
|  (forward-looking note, see below)                           |
+--------------------------------------------------------------+
```

Rows, top to bottom:

1. **Connection badge** (top-right of the "Your identity" sub-heading). Reads `On this device` on a calm emerald pill (the same pill style as the lab-head session-active pill, `text-emerald-700 bg-emerald-50 border-emerald-200`). It signals the device holds the key. Copy: `On this device`. Tooltip (use the `Tooltip` component, not `title=`): `Your private key is stored in this browser on this device. Shares are sealed to it.`

2. **Email row.** Label `Email`, value `sharing.email` in normal weight, not editable. No edit affordance (the email is identity-bound, see the Email decision below).

3. **Fingerprint row.** Label `Fingerprint`, value `sharing.sidecar.fingerprint` in `font-mono tracking-wide`, plus a `Copy` button (reuse the copy-with-checkmark pattern from `SharingSetupWizard`'s `copyWords`, copied state flips the label to `Copied` for ~1.8s). Tooltip on the row label: `Read these characters aloud with the other person to confirm you are sending to the right identity.`

4. **Set up row.** Label `Set up`, value `new Date(sidecar.claimedAt).toLocaleDateString()`.

5. **Recovery words row.** Label `Recovery words`. If `sidecar.recoveryConfirmedAt` is non-null, value is an emerald `Confirmed`. If null, value is a muted `Not confirmed` plus a `View / confirm` button (secondary). The button opens the recovery-words view. Copy on the not-confirmed helper line: `You skipped saving your recovery words. Save them now so you can restore your identity on another device.`

   Implementation note on `View / confirm`. The wizard generated the words from in-memory `IdentityMaterial` that is gone after the wizard closes, so we cannot re-derive the 12-word phrase from the stored public sidecar. There are two honest options for this control:
   - (a) Recommended: relabel this to `Confirm recovery words` and have it open a small confirm-only modal that says the words were shown during setup, the user re-enters them (or pastes them) to prove they have them, and on a match we set `recoveryConfirmedAt = new Date().toISOString()` via `writeSharingIdentity`. We can verify a re-entered phrase by re-deriving the keypair from it and comparing the resulting public key to the stored `ed25519PublicKey`. This keeps the claim honest (we never store the words).
   - (b) If re-deriving is out of scope for this phase, the row simply shows `Not confirmed` with no action, and confirmation only happens at setup time. Mark the action as a follow-up.

   This is a genuine design tension flagged in the report; recommending (a).

6. **Actions row.** Two buttons side by side:
   - `Rotate key` (secondary), `onClick={onRotate}`. Tooltip: `Replace your keypair while keeping the same email. Use this if your key may have been exposed.`
   - `Disconnect from this device` (secondary, slightly muted/danger-tinted text), `onClick={onDisconnect}`.

7. **Divider**, then the Inbox and storage block (only when `status === "ready"`, see below).

#### status === "needs-restore" (sidecar present, no local key on this device)

This is the multi-device / new-device case from D3. The sidecar (public email, keys, fingerprint) is readable from the folder, but IndexedDB on this device has no private key, so the user can see who they are but cannot open sealed shares or send.

ASCII:

```
+--------------------------------------------------------------+
| Sharing                                                      |
| ...description...                                            |
|                                                              |
|  Your identity                       [ Key not on device ]   |
|  Email          you@university.edu                           |
|  Fingerprint    8F2A 19C4 ...  (mono)        [ Copy ]        |
|  Set up         March 14, 2026                               |
|                                                              |
|  This account has a sharing identity, but its private key    |
|  is not on this device. Restore it with your recovery words  |
|  to send and open shares here.                               |
|                                                              |
|                                            [ Restore on     |
|                                             this device ]    |
+--------------------------------------------------------------+
```

Rows:
- Connection badge reads `Key not on device` on a muted amber pill (`text-amber-800 bg-amber-50 border-amber-300`). Tooltip: `You set up this identity on another device. Restore your key here with your recovery words.`
- Email, Fingerprint, Set up rows render exactly as in `ready` (public fields from the sidecar).
- No `Rotate key` button here (rotation needs the current private key to sign, and we do not have it on this device).
- Explainer line: `This account has a sharing identity, but its private key is not on this device. Restore it with your recovery words to send and open shares here.`
- Primary button `Restore on this device`, `onClick={onRestore}`.
- Inbox and storage block: render the storage block in a sealed-but-locked variant. The inbox count is still readable via `listInbox` only if we can sign, which needs the key, so when there is no key we CANNOT list the inbox. Show instead: `Encrypted items may be waiting. Restore your key to see and open them.` with the `Open inbox` button replaced by `Restore on this device`. This matches D3's guidance to say "encrypted items waiting, restore your key" rather than show an error.

### Inbox and storage block (inside the Sharing section, ready state)

The relay budget made visible. It reads `listInbox({ email })` from `frontend/src/lib/sharing/relay/client.ts` (returns `InboxItem[]`, each with `sizeBytes`, `createdAt`, `expiresAt`). The block computes count and total bytes from that array client-side; there is no separate quota endpoint, so the budget is a display-side computation against the constants below.

Data fetch. Use a small `useQuery` keyed on the user email (`enabled: status === "ready"`), `queryFn` calls `listInbox({ email: sharing.email })`. This mirrors how `LabRoster` fetches with `useQuery` (`LabRoster.tsx` lines 72 to 129). On `RelayError` with `status === 404` (sharing disabled on this build), treat as "sharing unavailable" (see offline / disabled below). On any other error, show the error line.

Rows:

1. **Usage line plus progress bar.** `{count} pending {shares|share}, {humanBytes(total)} of {humanBytes(BUDGET)} used`, with a thin progress bar (width `total / BUDGET`, clamped to 100%). Bar turns amber when over 80% of budget. Pluralize "share/shares".
   - Loading: `Loading your inbox...`
   - Empty (count 0): `Nothing pending. Shares people send you will appear here.` and the progress bar shows 0 of budget.
   - Error: `Could not load your inbox right now. Try again in a moment.`

2. **Policy line.** `Pending shares are held for 30 days, then removed. Each person can hold up to 50 pending shares at a time.` The 30 days and 50 are real, see the relay constants below.

3. **Open inbox button.** Secondary, links to the inbox surface (wherever the receive UI lands; until then, the button can be omitted or disabled with tooltip `The inbox opens here once the receive screen ships.`). Use a `Link` (the page already imports `next/link`).

4. **Forward-looking note.** A muted single line, not a control: `Later, collaborate mode will draw on this same space. One budget, two uses.`

ASCII (ready, populated):

```
  ----------------------------------------------------------
  Inbox and storage
  3 pending shares, 4.2 MB of 200 MB used
  [#########.................................]
  Pending shares are held for 30 days, then removed. Each
  person can hold up to 50 pending shares at a time.
                                              [ Open inbox ]
  Later, collaborate mode will draw on this same space.
  One budget, two uses.
```

### Decision, the storage byte budget and the pending-share cap to display

The relay already enforces a hard **per-recipient pending count cap of 50** (`RECIPIENT_QUOTA = 50` in `frontend/src/app/api/relay/send/route.ts` line 43) and a **30-day TTL** (`TTL_MS = 30 * 24 * 60 * 60 * 1000`, line 46). Those are real and must be quoted verbatim in the policy line above, the build does not get to invent them.

The byte budget is a pure display number, the relay does not enforce bytes today. Recommendation:

- **Free storage budget per user: 200 MB (recommended, pending Grant).** Rationale. A bundle is a note or method plus attachments; typical lab attachments (a gel image, a PDF protocol, a few photos) run from a few hundred KB to a few MB. 200 MB comfortably holds the 50-share cap of normal text-plus-image shares without ever being the binding constraint, while still being a number that reads as "generous but finite" so nobody treats the relay as a backup drive. It also leaves headroom under the practical per-bundle ceiling (the Vercel 4.5 MB function-body cap does not apply here because sealed bytes PUT directly to R2, not through the function, so individual bundles can be larger than 4.5 MB, which is exactly why a stated byte budget matters as the real limit users feel).
- **Pending-share cap to display: 50, quoted from the relay constant.** Do not invent a second number. The count cap and the byte budget are two independent ceilings, whichever you hit first stops new shares to you. State both.

Define these as named constants in one place the section imports, for example `frontend/src/lib/sharing/relay/limits.ts` exporting `PENDING_SHARE_CAP` (re-exported or duplicated from the route's `RECIPIENT_QUOTA`, ideally the route imports from here so they cannot drift) and `FREE_STORAGE_BYTES`. The 30-day TTL should likewise be a shared constant. Mark `FREE_STORAGE_BYTES = 200 MB` as "recommended, pending Grant" in a code comment.

### The three new popups

These are small modals owned by `SettingsBody` (open-state booleans), styled like the existing dark sharing modals (`SharingSetupWizard`, `AccountPasswordPopup` use the `bg-slate-800` card). Each calls `sharing.refresh()` on close so the section re-reads.

There is currently NO browser-side helper that signs and posts a rotate or a recovery request; only the server routes (`/api/directory/rotate`, `/api/directory/recover`) and the keygen building blocks in `frontend/src/lib/sharing/identity/setup.ts` exist. So each popup needs a thin client orchestration analogous to the wizard's `publish` step. Specify them as building on the existing primitives:

#### RotateIdentityPopup

Purpose. Bind a fresh keypair to the same email, using the directory rotate route. The route (`/api/directory/rotate`) requires the request be signed by the user's CURRENT Ed25519 private key (it verifies against the stored key), so rotation only works in the `ready` state (key present on device). The popup is unreachable from `needs-restore` (no `Rotate key` button there).

Flow:
1. Confirmation copy: `Rotate your key? This replaces your keypair and gives you fresh recovery words. Your email stays the same. People you have shared with will need your new fingerprint to verify you.`
2. On confirm: generate new material (`createIdentityMaterial` from `setup.ts`), build a rotate request signed with the OLD signing key loaded from IndexedDB (`loadIdentity`), POST to `/api/directory/rotate` with `{ email, newX25519PublicKey, newEd25519PublicKey, signature, issuedAt, keyBackupBlob }`. (A `buildRotateRequest` helper, sibling to the existing `buildBindRequest`, should be added in `setup.ts`; flag this as a small new helper, not a behavior change.)
3. On success (`{ ok, fingerprint }`): save the NEW private keys to IndexedDB (`saveIdentity`, overwriting), rewrite the sidecar via `writeSharingIdentity` with the new public keys and new `fingerprint`, set `recoveryConfirmedAt = null` (new words are unconfirmed). Show the new 12 recovery words with the same "I have saved my recovery words" gate the wizard uses (reuse the `GenerateStep` word-grid and copy verbatim), because the words changed.
4. **Post-rotate state.** The section returns to `ready` with the new fingerprint and `Recovery words: Not confirmed` until the user confirms. Copy on the done screen: `Your key is rotated. Save your new recovery words, the old ones no longer work.`

States: confirm, generating (CSS spinner, same constraint as the wizard, Argon2id blocks the thread), show-new-words (gated checkbox), publishing, done, error. Error copy mirrors the wizard's publish errors (429 `Too many attempts. Wait a minute, then try again.`, network `Network error while rotating. Try again.`).

#### RestoreIdentityPopup

Purpose. The `needs-restore` path. Bring the private key back to this device from recovery words. Two valid mechanisms, recommend the recovery-words path as primary because it works offline-of-the-relay-for-keys and matches the wizard's mental model:

- Primary: **recovery words.** User pastes/types the 12 words, we re-derive the keypair deterministically (the same derivation `createIdentityMaterial` uses from a seed), verify the derived `ed25519PublicKey` matches the sidecar's stored `ed25519PublicKey` (proof the words are correct for THIS identity), then `saveIdentity` to IndexedDB. No server call needed if the words alone reconstruct the keys. On success the section flips to `ready`.
- Secondary (fallback, if the words alone cannot reconstruct keys in the chosen scheme): **email + code recovery** via `/api/directory/recover`. The user requests a code (`POST /api/directory/signup { email }`, same as the wizard), enters it, and the route returns the encrypted `keyBackupBlob`, which the recovery passphrase decrypts locally into the private keys, then `saveIdentity`. The recover route already exists and returns `{ found, keyBackupBlob }`.

States and copy:
- intro: `Restore your sharing identity on this device. Enter the 12 recovery words you saved when you set up sharing.`
- words input (3x4 grid or one textarea), validate 12 words.
- verifying: `Checking your recovery words...`
- mismatch error: `Those words do not match this identity. Check them and try again.`
- success: `Your key is restored. You can send and open shares on this device now.` then close, `sharing.refresh()` flips to `ready`.
- network/offline error (if the email-code fallback is used and the relay is unreachable): `Could not reach the recovery service. Check your connection and try again.`

#### DisconnectIdentityPopup

Purpose. Remove the local private key from THIS device only. The published directory binding and the folder sidecar are unaffected (per D8 the global identity outlives the local account and the directory keys by email, not device). So disconnect is local-key removal, reversible by restore.

Flow: confirm, then call `clearIdentity()` (`frontend/src/lib/sharing/identity/storage.ts`, the existing `clearIdentity` export at line 108). Do NOT delete the sidecar (that would orphan the published identity and mislead `useSharingIdentity` into `none`). After clearing, the section drops to `needs-restore` (sidecar still present, key gone), which is the correct, honest end state.

Copy:
- title: `Disconnect from this device?`
- body: `This removes your private key from this browser on this device. Your identity stays published and your account keeps it, but until you restore your key here you cannot send shares or open the encrypted items waiting for you on this device. You can restore any time with your recovery words.`
- danger button: `Disconnect`
- cancel: `Cancel`

**Edge case, disconnect while shares are pending.** Disconnecting does not touch the relay, so pending shares stay in the mailbox (and keep counting toward the 50 cap and the 30-day TTL). The confirm copy already warns the user they will not be able to open them until they restore. Do not block disconnect on pending shares, just warn. Recommended addition to the body when the inbox count is known and greater than zero: append ` You have {n} encrypted {item|items} waiting that you will not be able to open until you restore.`

**Edge case, rotate while shares are pending.** Pending shares were sealed to the OLD public key. After rotation the device holds only the new private key, so already-pending shares can no longer be opened. This is a real data-loss footgun. Recommended: when the inbox count is greater than zero, the rotate confirm copy gains a warning line: `You have {n} pending {share|shares} sealed to your current key. Rotating means you will not be able to open {it|them}. Pick those up first if you can.` Do not hard-block (a compromised key may need immediate rotation), but make the consequence explicit. Flag this to Grant as a behavior worth a second look.

---

## Revision, Security and login (D1)

Today `SecuritySection` (`page.tsx` lines 4362 to 4398) presents the local password as the only gate, opening `AccountPasswordPopup`. Per D1 the model is two layers:

- The local password becomes the OFFLINE fallback gate. It still works with no account anywhere, preserving clone-and-run-local. Nothing about the password mechanism changes.
- A claimed account ALSO offers "Sign in with Google or GitHub to unlock" when online. The password becomes the fallback, not the primary, for connected users.

### Changes to `SecuritySection`

The section keeps its existing password row and adds an explanatory line plus, when the account is claimed and online, a note that provider sign-in is available on the unlock screen. The Security section itself does not perform the OAuth unlock (that belongs on the unlock screen), it explains the relationship so the password no longer reads as the sole lock.

`SecuritySection` gains a prop or reads `useSharingIdentity().status` to know whether the account is claimed.

New copy for `SectionShell.description` (replacing the current one):
- when NOT claimed (`status` is `none` or `loading`): keep today's copy: `A password blocks accidental sign-in to this account from inside the app. It does not encrypt files on disk.`
- when claimed (`status` is `ready` or `needs-restore`): `Your password is the offline lock for this account. When you are online you can also unlock by signing in with Google or GitHub, the same identity you share with. The password stays as the offline fallback.`

The existing password row (lines 4375 to 4395) is unchanged in mechanics: shows `Password is currently set / not set`, button `Set password` / `Change password`. Add, when claimed, a second muted line under the password row: `Online unlock with Google or GitHub appears on the login screen.`

ASCII (claimed):

```
+--------------------------------------------------------------+
| Security                                                     |
| Your password is the offline lock for this account. When     |
| you are online you can also unlock by signing in with        |
| Google or GitHub, the same identity you share with. The      |
| password stays as the offline fallback.                      |
|                                                              |
|  Password is currently set.            [ Change password ]   |
|  Online unlock with Google or GitHub appears on the login    |
|  screen.                                                     |
+--------------------------------------------------------------+
```

### Changes to the unlock screen (`UserLoginScreen.tsx`)

This is the surface that actually gains the provider unlock. Today it gates on `hasPassword`/`verifyPassword` (imports at line 7, password gate state at lines 75 to 81). Per D1's build note, when the user being unlocked has a CLAIMED identity AND the app is online, render an optional `Sign in with Google to unlock` / `Sign in with GitHub to unlock` pair alongside the password input, reusing the `signIn` provider call pattern already used by `SharingSetupWizard.startOAuth` (and the same `next-auth` provider config). The password input stays, labeled as the offline fallback.

Concrete copy on the unlock gate when claimed and online:
- above the provider buttons: `Unlock with your sharing identity`
- buttons: `Continue with Google`, `Continue with GitHub` (reuse the wizard's button styling and `GoogleIcon` / `GitHubIcon`)
- divider: `or use your password`
- the password field keeps its current behavior.

The unlock succeeds when the signed-in provider email matches the claimed identity's email (`sidecar.email`); on a mismatch, show `That account does not match this identity. Use the password, or sign in with the email this identity is registered under.` Offline (or unclaimed): show only the password gate, exactly as today.

This is the one place this revision touches login flow, so it gets its own verification pass (see Sequencing).

---

## Revision, Lab management is local-only (D5, D6)

The behavior change to sign off on. Per D5 a lab head manages members' LOCAL accounts only (display name, color, archive/restore, folder data) and MAY SEE which members have a global identity (read-only badge) but has no power over it. Per D6 resetting a member's local password resets only the offline fallback, it cannot reset their Google/GitHub login and grants no access to keys or sealed shares.

### Decision, the exact Lab-management revision

**Recommended (pending Grant):**

1. **The roster keeps all its current local management** (`LabRoster.tsx`): display name, account-type pill, Active/Archived status, archive/restore gated by the Phase 5 edit session. No local capability is removed.
2. **Add a read-only "Has sharing identity" badge** per roster row, next to the existing PI / Active / Archived / You pills (`LabRoster.tsx` lines 220 to 257). It renders when that member's folder has `users/<member>/_sharing_identity.json`. It is purely informational, no click, no action. Copy on the pill: `Sharing` (short) with a `Tooltip`: `This member has set up a sharing identity. Only they control it, you cannot manage, reset, or open it.`
   - Data source. The roster already fans out per-user reads in its `useQuery` (`LabRoster.tsx` lines 83 to 115). Add one more best-effort read per row, `readSharingIdentity(username)` (`frontend/src/lib/sharing/identity/sidecar.ts`), and set `hasSharingIdentity: side !== null` on the `RosterRow`. Wrap in try/catch like the existing reads so a missing or unreadable sidecar just yields `false`.
3. **State the limit in copy, in two places:**
   - On the `LabRosterSection` description (`page.tsx` line 1283), append: `Sharing identities belong to each member alone, a PI cannot manage or reset them.`
   - In the archive confirm dialog (`LabRoster.tsx` lines 354 to 365), no change needed (archive is local), but if a member `hasSharingIdentity`, add a muted line to the archive dialog body: `Archiving hides them locally. It does not affect their sharing identity or anything sent to them.`
4. **Remove any implication of global-account control.** There is none in the current roster (it only archives/restores locally), so nothing is deleted; the work is additive (the badge plus the copy). The "removed" item is conceptual, the roster must never grow a "reset sharing", "manage identity", or "view shares" affordance. Note that constraint inline for future editors.
5. **The reset-password path (D6).** The existing `AccountPasswordPopup` "Forgot your password?" flow (delete `_auth.json`) is already local-only and correct. Add one clarifying sentence to that forgot-password copy (`AccountPasswordPopup.tsx` around lines 424 to 440): `This resets only the offline app password. It does not touch a member's Google or GitHub sign-in, their sharing keys, or anything sent to them.` This makes D6 explicit exactly where a lab head would reach for it.

### What a lab head sees vs cannot do

- **Sees:** every member's local profile, status, and a read-only `Sharing` badge indicating they have an identity.
- **Cannot do:** rotate, restore, disconnect, read, or reset any member's sharing identity; cannot open a member's sealed shares; cannot reset a member's Google/GitHub login. There is no UI for any of these, by design.

### Edge case, the has-identity badge for archived members

An archived member's `users/<member>/_sharing_identity.json` is untouched by archiving (archive only flips the onboarding-sidecar `archived` flag, `LabRoster.tsx` lines 98 to 105). So an archived member can still show the `Sharing` badge. That is correct and useful (a PI may want to know a departed member still has a reachable identity). Render the badge on archived rows too, in the muted/grayed style the archived row already uses, so it does not read as "active".

ASCII (roster row, member with identity):

```
+--------------------------------------------------------------+
| (avatar)  Jordan Lee   [PI] [Active] [Sharing]    [ Archive ]|
|           @jordan                                            |
+--------------------------------------------------------------+
| (avatar)  Sam Ortiz    [Archived] [Sharing]      [ Restore ] |
|           @sam  - archived 3/2/2026                          |
+--------------------------------------------------------------+
```

---

## Email

There is no user-facing email setting today (notifications are Telegram only). The sharing email is the identity email, bound to the keypair, so it is not an editable profile field. The Sharing section shows it as a fixed, non-editable value (the Email row, no edit control). "Change email" is a deliberate re-verify and rotate flow, claim the new email and rotate the binding, not a free-text edit. For this phase, changing the bound email is OUT OF SCOPE (see Out of scope below); the Email row is read-only and the only key-level action offered is `Rotate key`, which keeps the same email. If Grant wants a change-email flow later, it is a new sub-flow (verify new email, then a directory operation), not a settings field.

---

## Edge cases, consolidated

- **Multi-device, sidecar present, no local key.** Handled by the `needs-restore` branch. The section shows the public identity, a `Key not on device` badge, and a `Restore on this device` action; the inbox block says encrypted items may be waiting. (D3.)
- **Disconnect while shares are pending.** Allowed; the confirm copy warns the items cannot be opened until restore. Pending shares stay in the relay, counting toward the cap and TTL.
- **Rotate while shares are pending.** Allowed but warned; old-key-sealed pending shares become unreadable after rotation. Confirm copy states the count and the consequence.
- **Lab roster badge for archived members.** Badge still renders (sidecar survives archiving), shown in the archived (muted) style.
- **Offline path.** When the app is offline or `SHARING_ENABLED` is false on the build, `listInbox` throws `RelayError` (network, or `status: 404` for disabled). The Sharing section still renders the identity block from the local sidecar and IndexedDB (no network needed). The inbox-and-storage block shows `Your inbox is unavailable offline. Your identity and keys are still here on this device.` and disables `Open inbox`. The unlock-screen provider buttons (D1) only render when online; offline, only the password gate shows. The local password and folder-local model never depend on the network. (This matches the locked clone-and-run-local tenet.)
- **Sharing unavailable on this build.** Same as offline for the inbox block; the identity block can still show whatever the sidecar holds, and `Set up sharing` should be disabled with a tooltip `Sharing is turned off on this build.` when `SHARING_ENABLED` is false. (Detectable by a 404 from the directory routes, or a small build-flag read.)
- **Account with no claimed identity (`none`) on the inbox block.** The inbox-and-storage block does not render; an optional muted stub line points at setup.
- **User switch mid-session.** `useSharingIdentity` re-reads on `currentUser` change (it depends on `currentUser`), and `SettingsBody` already `key={currentUser}`-resets section drafts. The Sharing section re-renders for the new user automatically; no extra wiring.
- **Wizard `localLinkFailed` (no folder connected at claim).** The wizard already surfaces this. In Settings the user always has a folder connected (the page requires it, lines 415 to 426), so this path is effectively unreachable from Settings, but the section should still tolerate a `none` status right after a claim by calling `sharing.refresh()` on wizard close (already specified in the wiring).

---

## Decisions to confirm before building

1. **Storage numbers.** Recommended, pending Grant: free byte budget per user **200 MB** (display-only, the relay does not enforce bytes today), and the pending-share cap shown as **50**, quoted verbatim from the relay constant `RECIPIENT_QUOTA` in `frontend/src/app/api/relay/send/route.ts` line 43. The 30-day TTL (`TTL_MS`, line 46) is also quoted verbatim. Define all three as shared constants so the display and the route cannot drift.
2. **Lab-management revision (D5/D6 made visible).** Recommended, pending Grant: keep all local roster management, add a read-only `Sharing` badge per row (including archived members), state the limit in the section description, the archive dialog, and the forgot-password copy, and never add any global-account control to the roster. This is a visible behavior change to existing lab-head users (a new badge and new copy), but removes no capability.
3. **One combined "Sharing" section vs two.** Recommended, pending Grant: **one combined section** with "Your identity" and "Inbox and storage" blocks, inserted after `AccountSection`. Rationale above (the storage block is meaningless before an identity exists, and the combined card keeps the Personal stream shorter per the de-bloat feedback).

Two smaller design tensions are flagged for Grant in line above and are not invented away:
- The `View / confirm recovery words` action cannot re-derive the original 12 words from the public sidecar; recommend a confirm-by-re-entry modal (option a) rather than silently dropping the action.
- Rotating while shares are pending makes those shares unreadable; recommend a loud warning rather than a hard block.

Everything else follows the locked identity-interaction decisions (D1 through D8) and the existing add-a-section pattern in `settings/page.tsx`.

---

## Out of scope for this proposal

- The receive / inbox screen itself (the `Open inbox` button targets it, but its UI is a separate piece).
- A change-email flow (the Email row is read-only; only `Rotate key`, same email, is offered).
- Server-side byte-quota enforcement (the budget is display-only this phase; the relay enforces the 50-count cap and 30-day TTL only).
- Collaborate mode (referenced only as the forward-looking "one budget, two uses" note).
- Moving the global-identity claim into onboarding (D4 keeps it intent-triggered; Settings is the home for an already-claimed identity plus a `Set up sharing` entry point, not a new onboarding step).
- Any global-account management for lab heads (explicitly forbidden by D5/D6).

---

## Sequencing

Build after the notes send/receive loop is working and tested. The Sharing section reuses the wizard (`SharingSetupWizard`, exists) and the directory rotate/recover routes (exist), the inbox-and-storage block reads the relay inbox via `listInbox` (exists), and the Security and Lab revisions are UI plus copy over decisions already locked. The net-new code is small: the `SharingSection` component, three popups (`RotateIdentityPopup`, `RestoreIdentityPopup`, `DisconnectIdentityPopup`), one `buildRotateRequest` helper sibling to `buildBindRequest` in `setup.ts`, a shared `limits.ts` for the constants, one extra per-row read in `LabRoster`, and the provider-unlock branch in `UserLoginScreen`. So this phase is mostly assembly, but it touches the login flow (D1) and lab-head behavior (D5/D6), so it gets its own careful pass and the standard verifier loop before merge.

Implementation is a future roadmap task; this document is the design contract that task builds from.
