# Handoff — checklist-tick sync round-trip + method-tab rail (2026-06-14)

Pick up the **live checklist-tick round-trip test**. Everything is built; the test is blocked on the phone not surfacing a published method (see BLOCKED).

## Environment (already running)
- **Metro**: `:8082` with `--tunnel`, serving the mobile worktree `/Users/gnickles/Desktop/ROS-mobile-redesign/mobile`. Tunnel URL `aqfjppk-gnickles-8082.exp.direct` (stable). `adb reverse tcp:8081 tcp:8082` is set for the emulator. Restart cmd if needed: `cd .../mobile && nohup node node_modules/.bin/expo start --dev-client --tunnel --port 8082 > /tmp/metro8082.log 2>&1 &` (do NOT set `CI=1` — it disables watch/HMR).
- **adb is NOT on PATH**: use `~/Library/Android/sdk/platform-tools/adb`.
- **Devices**: Samsung `R3CTB09L7KA` = the real paired device (real key, sealing works). emulator-5554 = DEMO mode (seals to placeholder key → `sealToUser` throws → `postMethodChecks` returns `'noop'`, so the emulator CANNOT do the real round-trip). Use the Samsung.
- **Frontend**: Grant runs `:3000` himself from `/Users/gnickles/Desktop/ResearchOS/frontend` on `main`. Don't start a 2nd dev server. There's an unrelated tsc error in `src/lib/ai/tools/registry.ts` (`searchNoteBodiesTool`) = the BeakerAI lane's WIP, not ours.

## DONE this session
1. **Font last-glyph clipping** — commit `f42a12143` on branch `mobile-redesign-foundation`. Three Android bugs (Geist clips <10px, `letterSpacing>=1` clips, flex truncation), NOT a font defect. Verified on real Samsung + emulator. See memory `reference_android_text_clip`.
2. **Method-tab redesign on `main`** (frontend):
   - `20d37ce0a` — experiment Method tab: components moved from a cramped top tab bar to a **color-coded left rail** (`TYPE_META` map in `src/components/MethodTabs.tsx`).
   - `459d429e9` — actions moved to a **pinned bottom toolbar** (so the title gets full width); `ViewMethodOnPhoneButton` is now **connection-aware** (green icon + "View on phone" when paired → publishes; grey "Connect a phone" when not → opens the Companion popup) and its pairing check **retries** (was transiently hiding).
3. **Variation Notes redesign HANDED OFF** to the `quick --> live editor` lane (session `local_5d10f4d7-ecb1-443d-9961-aee9d1c5405d`): de-yellow + move to a **right column with hover summary** (model on `MethodExperimentsSidebar.tsx` ~L241-260). NOT ours to build — don't touch `VariationNotesPanel.tsx` / the per-type `*MethodTabContent.tsx` or you'll collide with them.

## Checklist-tick sync — the test (BUILT + reviewed, live verify BLOCKED)
Both halves are committed on the branches the devices run, code-reviewed correct, wire contract matches byte-for-byte (see memory `project_mobile_offline_writes`):
- Phone: `mobile/lib/add-method-check.ts` + `MethodReadMode` toggleCheck (debounced 800ms) → `method-detail` `onSyncChecks` using `snapshot.taskId/owner` + `pairing.userX25519PubHex`. Commit `da5955654` on `mobile-redesign-foundation`.
- Laptop: `poll.ts` `method-check` parser + apply (~L1937, last-write-wins, edit-gated), `tasksApi.saveGatheredChecks`, `gathered_checks` type, and the "N of M reagents gathered on the phone" **chip** in `MethodTabs.tsx` (~L242). All on `main`.

### BLOCKED symptom
Grant clicked **"View on phone"** on an experiment and **nothing appeared on the Samsung**.

`ViewMethodOnPhoneButton` calls `publishMethodToAllDevices(keys, taskId, taskOwner)` (publishes a sealed read-mode snapshot of ALL the experiment's components to every paired phone). The phone does NOT auto-open it — push auto-open is inert in this dev build (memory `project_notification_preferences`). So the snapshot most likely **landed silently** in the phone's store and only surfaces in the phone's **Methods tab** on the next poll.

### Next steps to debug/finish
1. Have Grant click **View on phone** and confirm the button shows **"Sent to phone"** (not "No phone paired" / "Could not send"). If it errors, the publish failed → check `loadUserCaptureKeys()`/`listDevices`/relay.
2. On the Samsung, check whether the method arrived: open the phone's **Methods** tab, AND dump the store:
   `~/Library/Android/sdk/platform-tools/adb -s R3CTB09L7KA shell "run-as app.researchos.companion cat databases/RKStorage" > /tmp/RK.db` then `sqlite3 /tmp/RK.db "SELECT key, length(value) FROM catalystLocalStorage;"` — look for the published method in `researchos.library.v1` (or a snapshot key) WITH a `taskId`/`owner` (the plain library cache `test:1`/`test:2` had none; the sync only fires when the opened method's snapshot carries taskId/owner).
3. Open the method read mode on the phone (`researchos://method-detail?uid=<owner:id>`), confirm it shows **reagent checkboxes** — only structured methods with a reagent list do. The **qPCR — fakeGFP** experiment's PCR method has a clean **5-reagent recipe** ("0/5 checked"); the growth-curve **Markdown** component has none. Use qPCR.
4. Run the offline round-trip (same recipe as the verified variation-note one):
   - airplane on: `adb -s R3CTB09L7KA shell cmd connectivity airplane-mode enable`
   - tick a reagent (tap the checkbox)
   - read outbox: `sqlite3 /tmp/RK.db "SELECT value FROM catalystLocalStorage WHERE key='ros.command.outbox.v1';"` → expect a sealed `method-check` command queued (real `sealedHex`)
   - airplane off: `... airplane-mode disable` → outbox drains to `[]` (queued→sent)
   - on `:3000`, the experiment's Method tab shows the **"N of 5 reagents gathered on the phone"** chip under the title.
   - Baseline captured earlier: outbox `[]`; `ros.method.checks.2 = {"2:0":false,"2:1":false}`.

## Then
Update memory `project_mobile_offline_writes` (mark the checklist round-trip verified, like the variation-note one) once it passes.
