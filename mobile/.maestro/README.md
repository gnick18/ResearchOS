# Maestro UI flows for the ResearchOS companion (marketing demo clips)

These are [Maestro](https://maestro.mobile.dev) flows that drive the companion
app deterministically through DEMO MODE (no laptop, no relay, no real pairing) so
you can record clean marketing clips. Every flow self-clears app state, so the
order you run them in does not matter.

- appId: `app.researchos.companion`
- All flows start from the unpaired first run and enter the reviewer demo via
  Notebook pair CTA -> Pair screen -> "Try the demo".

## One-time setup

1. Install Maestro:
   ```
   curl -Ls "https://get.maestro.mobile.dev" | bash
   ```
   Then add it to your PATH per the installer output (`~/.maestro/bin`).
2. Prerequisites:
   - Java (JDK 11+) on PATH (`java -version`).
   - Android SDK platform-tools for `adb` (`adb version`).
3. Start an Android emulator (Android Studio AVD) OR plug in a device with USB
   debugging on. Confirm Maestro can see it:
   ```
   adb devices
   ```

## Build and run the companion

From `mobile/`:
```
npm install        # first time only
npm run android    # builds + installs the dev client and launches Metro
```
Leave Metro running. The dev client is required for the native document scanner,
but NONE of these demo flows use the scanner, so a plain build is fine too.

## Run a flow (assertions, no recording)

From `mobile/`:
```
maestro test .maestro/01-pair-demo.yaml
```
A flow exits non-zero if any `assertVisible` fails, so a broken step fails loudly.

## RECORD a flow to video (the marketing path)

From `mobile/`:
```
maestro record .maestro/02-capture.yaml
```
This drives the flow on the device while capturing an mp4. This is the command
to use for every clip below.

## The flows

| File | Records (one-line clip) |
| --- | --- |
| `subflows/enter-demo.yaml` | (shared subflow, not a clip) clears state, launches, enters demo, waits for the demo Notebook. |
| `01-pair-demo.yaml` | First run: unpaired Notebook -> Pair screen -> "Try the demo" -> populated demo Notebook with the Today glance (today / overdue / coming-up fixtures). |
| `02-capture.yaml` | The Inbox with two seeded sample captures, then "Send all". (Camera-free, see note below.) |
| `03-quick-note.yaml` | Quick note compose: open the panel, type a realistic bench title + body, the "Send to lab" button live. (See DEMO GAP below.) |
| `04-inventory.yaml` | Inventory tab: tracked stocks with low / ok pills (DMEM, FBS, Puromycin) and purchase orders. |
| `05-calc.yaml` | Bench calculator: Scientific "5*2+7" -> live "17", then Molarity (MW 58.44, 150 mM, 500 mL) -> mass to weigh out. |
| `06-timer.yaml` | Bench timer: tap the 1 min quick-start preset -> a Running timer counts down. |

## Important notes / gotchas

- **No camera in demo (clip 02).** The Notebook "Take a photo" button always
  opens the real device camera (`onTakePhoto` is not demo-bypassed), which needs
  a camera + permission dialog and is not deterministic on an emulator. So the
  capture clip records the already-seeded Inbox + "Send all" instead. On first
  demo entry the Notebook asynchronously seeds two sample captures.
- **Quick note has no clean demo success (clip 03).** `sendTextNote` is not
  demo-guarded, so "Send to lab" makes a real network call that fails in demo and
  raises a "Note failed" alert. Clip 03 records the compose experience (the
  on-camera-worthy part) and dismisses that alert if it appears. For a true
  success clip, use a real laptop+relay pairing, or add a demo short-circuit to
  `sendTextNote` (mirroring `fetchSnapshot`).
- **Android notification dialog.** On first demo entry the Notebook (and the
  Timer screen on mount) call `ensureNotificationPermission`, which on Android 13+
  raises a system "Allow notifications?" dialog. The flows dismiss it with an
  optional `tapOn: "Allow"` so they never hang. If your emulator already answered
  the prompt (or is below Android 13), the optional tap is skipped.
- **Tabs are tapped by visible label** (Notebook / Inventory / Calc / Timer /
  Wiki). The Timer TAB label is "Timer" while the screen title is "Timers".
- **testIDs** are used via Maestro's `id:` selector for buttons/inputs/rows;
  stable visible text is used for labels and fixture content.
