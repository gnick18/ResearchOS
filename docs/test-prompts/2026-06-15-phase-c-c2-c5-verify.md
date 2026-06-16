# Phase C live-verify prompts + setup — C2 (PI re-admit) & C5 (cross-device restore)

NOT YET RUN (Grant deferred). Both are collaborative human-in-the-loop Chrome-extension prompts (agent drives, STOPS to hand off OS-picker / second-account steps, never fabricates, console open). Lane: `[[project_account_folder_identity_redesign]]`. Both behind `NEXT_PUBLIC_MULTI_FOLDER=1`.

## Setup (do this once before running)
- **Server:** Grant's local dev `http://localhost:3000` with flags active (`NEXT_PUBLIC_MULTI_FOLDER`, `NEXT_PUBLIC_LAB_TIER_ENABLED`, `NEXT_PUBLIC_SHARING_ENABLED`, `NEXT_PUBLIC_AUTH_DEV_MOCK` all `=1`; restart the dev server after editing `.env.local` since `NEXT_PUBLIC_*` bakes at start).
- **Directory backend (C5):** already wired in `.env.local` (Neon `DATABASE_URL` + `SHARING_ENABLED` + `DIRECTORY_HMAC_PEPPER` + `AUTH_SECRET`). No extra server.
- **Lab relay (C2 only):** `cd relay && npm run dev` → `workerd` on `127.0.0.1:8787` (the default `COLLAB_RELAY_URL`; no Cloudflare account needed). Confirm with `lsof -nP -iTCP:8787 -sTCP:LISTEN`. **Kill it when done.**
- **Scratch folders (empty; agent populates in-app):** `~/Desktop/ROS-verify-c5`, `~/Desktop/ROS-verify-c2-pi`, `~/Desktop/ROS-verify-c2-member`.

## Known gotchas (learned from the partial C5 run, 2026-06-15)
- **C5 `my-backup` 401 ≠ no blob.** `401` = the account is NOT OAuth-claimed yet. The local "Create your account" only mints the on-device keypair; the **cloud key backup blob is written during the OAuth claim (oauth-bind)**, not the local mint. To flip `401 → 200`: **Settings → Sharing identity → "Publish a profile"** (`SharingSection.tsx:557`) → claim via **dev-mock** OAuth → writes the directory binding + `key_backup_blob` to Neon.
- **C5 fresh-device step:** clear IndexedDB DB `researchos-sharing-identity`, store `device-vault` (drops the on-device keypair so `loadIdentity()` is null). Do NOT delete the folder's notes.
- **FolderSwitcher dropdown a11y gap:** the "Switch folder" dropdown (top-left, `FolderSwitcher.tsx`) does not expose its menu items to the Chrome agent's tools — the human must switch folders by hand. (TODO: improve the role=menu item automation accessibility.)
- **C2 needs TWO DISTINCT accounts.** Incognito isolates folders/cookies/IndexedDB (NOT two servers), but **dev-mock signs in as ONE fixed email** (`AUTH_DEV_MOCK_EMAIL`/`dev@researchos.test`; UI never passes a chosen email). So two incognito windows on dev-mock = the SAME account. Pick:
  - **A:** two real OAuth logins (Google in the PI window, GitHub in the member window — both enabled). Zero code.
  - **B (not built):** add a dev-only email picker to the dev-mock sign-in so PI = `pi@…`, member = `member@…`. Small + dev-gated; `signIn("devmock", { email, callbackUrl })` already forwards `email` to the credentials `authorize` (`auth.ts:68`); the UI (`SharingSetupWizard.tsx:282`, `SharingProviderButtons`) just needs to pass a chosen email. **Awaiting Grant A-vs-B.**

---

## C5 prompt — strict cross-device restore
**Server:** `localhost:3000` · **Folder:** `~/Desktop/ROS-verify-c5`

Collaborative verify (human-in-the-loop): on a fresh device, an account with a PUBLISHED identity restores it from the cloud backup with its recovery code. Rules: STOP and hand off OS-dialog / human-only steps; never fabricate results/screenshots/values; keep devtools/console OPEN and report errors.

- **Step 1 — [HUMAN, hand off]** Ask Grant to connect `~/Desktop/ROS-verify-c5` via the OS dialog, then say when he's in the app.
- **Step 2 — [AGENT] claim + publish (THE FIX).** Settings → Sharing identity → **"Publish a profile"** → claim via dev-mock OAuth. This writes the cloud key backup. Then **verify `GET /api/directory/my-backup` returns 200** (not 401/404). If still 401, the claim didn't complete — retry the publish. Record the **recovery code** shown during account setup as ORIGINAL (read it; if unclear, ask Grant).
- **Step 3 — [AGENT]** Create a Note **"RESTORE TEST"** with a body marker (e.g. "marker keep-9animal-42"). Confirm saved.
- **Step 4 — [AGENT] fresh device.** devtools → Application → IndexedDB → DB `researchos-sharing-identity` → delete the `device-vault` store entries → reload. (Don't delete notes. If unsure, STOP and ask Grant.)
- **Step 5 — [AGENT]** Re-enter the folder; the **"Restore your identity on this device"** gate appears. Screenshot it; note which doors show.
- **Step 6 — [AGENT]** Enter ORIGINAL recovery code → **"Restore and continue"** → confirm signed in.
- **Step 7 — [AGENT]** Confirm "RESTORE TEST" note + marker intact, and the restored identity is the SAME account (same @handle/fingerprint, not a fresh mint).
- **Report:** PASS/FAIL per step (5 gate, 6 restore, 7 same identity + data), screenshot, console errors, where handed off.

---

## C2 prompt — PI re-admit
**Server:** `localhost:3000` + lab relay on `:8787` · **Folders:** PI = `~/Desktop/ROS-verify-c2-pi`, member = `~/Desktop/ROS-verify-c2-member`

Collaborative verify: a lab head re-admits a member who reset their identity. Same rules; console open.

- **Step 0 — [AGENT] gate.** Confirm lab features show (Settings → Lab Mode) and `/lab/*` calls reach the relay (no connection error). If not, STOP and tell Grant the relay/lab-tier looks unavailable.
- **Step 1 — [HUMAN, hand off]** Two distinct accounts + a lab (see "C2 needs TWO DISTINCT accounts" above — Grant must use option A or B). Ask Grant: PI connects `ROS-verify-c2-pi` + creates a lab; member connects `ROS-verify-c2-member` (separate context/account) + JOINS via the PI's invite. Wait until the member shows on the PI's Lab Roster, and which account is which.
- **Step 2 — [HUMAN, hand off]** Ask Grant: on the MEMBER, run the C1 "reset and keep your data" flow, then re-publish the profile (Settings → Sharing → Publish a profile). Wait; note the member's display name.
- **Step 3 — [AGENT]** PI → Settings → Lab Roster. Confirm the member row has a **"Re-admit (reset key)"** button. Screenshot. Click it.
- **Step 4 — [AGENT]** In the dialog: it loads the lab record, shows the member's CURRENT key fingerprint, and a search. Search the member's name → confirm candidates with fingerprints (OLD identity greyed as "current key, not a reset"). Select the NEW identity. Screenshot the old-vs-new confirm.
- **Step 5 — [AGENT]** Confirm + run (`readmitMemberRemote`). Confirm "re-admitted". In Network, confirm the TWO `/lab/append` calls (rotate then add) both 2xx. Report any 4xx/5xx.
- **Step 6 — [AGENT]** Confirm roster still shows the member. If quick: PI shares to member, member opens it; else stop at "re-admit succeeded + roster intact".
- **Report:** PASS/FAIL per step, screenshots, console/network errors, where handed off.
