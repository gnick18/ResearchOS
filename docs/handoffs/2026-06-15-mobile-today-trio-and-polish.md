# Handoff — MobileUI lane: app-store beta, global Today dropdown + header trio, mobile polish (2026-06-15)

**Lane:** MobileUI. **Status:** all built + tsc 0 + verified live on the Android emulator; most pushed to origin (Grant pushed mid-session). **Last two commits may be UNPUSHED** — verify with `git log origin/main..main` and push.

Memory: `[[project_app_store_beta_launch]]`, `[[reference_file_dropzone]]`, `[[project_method_phone_reformatter]]`. AGENTS.md has the matching top-of-stack notes (FILE-PICKER DROPZONE SWEEP, MOBILEUI app-store).

## What shipped this session (commits, newest first)
- `efd94df0f` fix(mobile): Connect-to-your-lab beaker uses signature blue (white disc + sky beaker on the blue pair hero tile, matches splash). `app/pair.tsx`. **Pair screen is unpaired-only — verified by code, not driven.**
- `98e882408` polish(mobile): Today stat tile count moved to top-right (was crowding the top-left icon). `components/TodayPanel.tsx`. Verified live.
- `d9e857cae` fix(mobile): running-timer card reads as clean amber wash, not muddy gray. Root cause: a translucent accent gradient (`amberDim` 0.14a) with NO opaque base bled the gray screen behind. Added `backgroundColor: surface.surface` under the gradient on the Timers `TimerRow` (`liveWrap`) AND Home's "Running now" card. **Real-device bug, not the shim.** Verified live.
- `1eeeb815a` fix(mobile): demo inbox no longer stuck on "Sending". Two bugs: (1) a capture left at `sending` (app killed / fake relay never answers) was unrecoverable since Send-all only retries queued/failed — `listCaptures` now resets stored `sending`→`queued` on load (general fix for real users too); (2) new `markDemoCapturesSent()` marks every `Demo:` capture delivered, called from the Notebook demo effect (rescues stuck samples + future seeds). `lib/captures.ts`, `app/(tabs)/notebook.tsx`. Verified: demo inbox shows "On your laptop".
- `36f5c1c91` refactor(mobile): dropped the redundant inline Today list from Home (Today is a dropdown now; one source of truth). Kept the Active Experiments band. `app/(tabs)/home.tsx`.
- `3c37f93f3` polish(mobile): Today stat tiles restyled to match the Notebook capture cards (gradient fill, white Ionicon in a translucent tile, white count+label, bottom-right circle accent). `components/TodayPanel.tsx`.
- `880370eda` feat(mobile): notif/Today/settings trio on EVERY tab root via shared `TabHeader` (converted Home w/ `eyebrow`, Timers, Methods, Inventory, Wiki; Notebook + Calc already used it).
- (core, same batch) feat(mobile): global Today dropdown. New `lib/today-store.ts` (open state + snapshot + `openToday/closeToday/toggleToday/requestTodayReload` + `useTodayState`/`useTodayBadgeCount`) + `components/TodayHost.tsx` (mounted once in `app/_layout.tsx`, owns the single `fetchSnapshot('today')`, renders `TodayPanel`). `TabHeader` is now self-sufficient: Today always present (gated on `todayPrefs.showToday`) toggles the global panel; bell reads `useUnreadNotificationCount()` globally. Notebook dropped its local Today panel/state + feeds the global store from its sync. **Behavior change:** Today no longer auto-opens on Notebook (now an explicit header button everywhere).
- `8418aebae` refactor(mobile): alarm options live only in Settings (removed the duplicate `AlarmSettingsCard` from the Timers tab; it was already in Settings > Alerts).
- `20be1deb7` fix(mobile): floating mascot dodges header buttons + picks the least-overlapping spot. `TabHeader` registers its action cluster as a mascot keep-out; `HeaderMascot` got side-edge fallback anchors + least-overlap selection (was a blind bottom-right fallback). Mascot is opt-in (default off, Settings toggle).
- Earlier: `981390d80` stamp-render fix; `4f0c6d312` committed `mobile/google-services.json`; FileDropzone (`3d43cedfd`) + 16-picker rollout (frontend, see `[[reference_file_dropzone]]`).

## App-store beta (the big one) — see `[[project_app_store_beta_launch]]`
- **Android = SHIPPED** as a direct EAS preview APK: build `b0ce24f7`, install page on expo.dev (QR + Install). Sidesteps the Play Store 12-tester/14-day closed-test clock. Rebuild: `cd mobile && eas build -p android --profile preview --non-interactive --no-wait`. Keystore auto-managed by EAS.
- **iOS = BLOCKED on Apple, not code.** Apple Developer enrollment stuck "pending" (started 2026-06-07), almost certainly never paid (no $99 receipt/charge anywhere; the $105.92 PayPal charge was Anthropic Claude Max, NOT the dev fee). Owning Apple ID unconfirmed: vault said `support@research-os.app` (a forwardemail alias → `gnickles@wisc.edu`); Grant believes personal `gnick317@icloud.com`. Enrollment ID `PTR262UUT9`; Apple Support chat case `#102915780727` open. When Active + Team ID known: `eas build -p ios --profile production` + `eas submit -p ios --latest` → TestFlight, then drive App Store Connect tester setup via Chrome. Corrected record: LLC vault `09_App_Store_Accounts/dev-accounts.md`.

## Local verification rig (Android emulator)
- AVD `ros_pixel7` = `emulator-5554` (the cold-boot bg task was killed near session end; may need a relaunch: `~/Library/Android/sdk/emulator/emulator -avd ros_pixel7 -no-snapshot-load`).
- Installed dev APK = `ROS-mobile-redesign/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (Jun 14, HAS the `expo-linear-gradient`/`expo-blur` native modules — required by current main).
- Metro: run from the MAIN checkout (`cd /Users/gnickles/Desktop/ResearchOS/mobile`) with `CI=1 npx expo start --port 8081` (CI mode so it survives backgrounding; plain `expo start` exits without a TTY). Load on device: `adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d "researchos://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081"`. First bundle ~30-45s; cold app start can be slow (ANR on a busy box — give it an uninterrupted stretch).
- **IMPORTANT:** main's `mobile/node_modules` was missing `expo-linear-gradient`/`expo-blur` (added on the foundation branch, merge brought package.json but not the install). Ran `npm install` in `mobile/` (lockfile already had them, so no lockfile churn). If a fresh checkout red-boxes on those modules, run `npm install` in `mobile/`.
- adb taps: device is 1080x2400 (NOT half-scale of the rendered screenshot — use real device px). Find buttons via `uiautomator dump` + `content-desc` (RN `testID` is NOT reliably in the dump; the a11y label is, e.g. Today button content-desc "Today, 3 due").

## Open / next
1. **Push** `98e882408` + `efd94df0f` if `git log origin/main..main` shows them unpushed.
2. **iOS build** once Apple enrollment is Active (the only blocker; see above).
3. **Active Experiments band on Home** (kept): tapping an experiment opens `/method-detail?read=1` which shows the LAST laptop-published method, NOT per-experiment. Grant weighing whether to make it genuinely per-experiment (would need a relay request + a laptop-side on-demand publish handler) — deferred feature, not a bug.
4. `LabSignInGate.test.tsx` (7 failing on main) was fixed by `b9e2dfd14` (spawned chip `task_6b2e97ba`, Grant started it) — confirm merged.
5. The classifier (Bash safety) was intermittently unavailable near session end; if a `git`/`eas` command refuses, retry shortly.

## House rules honored
Shared single checkout — commit path-scoped + immediately (never hold edits; other lanes' `git checkout` can wipe). No em-dashes/emojis/mid-sentence colons in user-facing copy. Icons via the registry (`@/components/icons` web / Ionicons mobile) — never inline `<svg>` (icon-guard).
