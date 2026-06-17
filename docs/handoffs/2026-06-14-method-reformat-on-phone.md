# Handoff: Method phone-projection reformatter (Phase 2) + BeakerBot working bubble

**Date:** 2026-06-14
**Status:** BUILT + MERGED DARK to local `main` (`090d73ef0`, then later main commits on top), **UNPUSHED**, all flag-gated OFF. Frontend tsc 0 + 656 tests pass. Mobile tsc adds 0 errors over the pre-existing 12-error missing-package baseline. **Live Samsung verification IN PROGRESS, parked mid-test** (see "Where the live test is parked").
**Memory:** `[[project_method_phone_reformatter]]` (full build detail), spec `docs/proposals/2026-06-13-method-phone-projection-reformatter.md`.

## What this is

Turn a researcher's own free-form markdown method into clean, bench-readable steps on the phone, on demand, with a metered-AI call. Phase 1 (the free, offline deterministic parser in `mobile/lib/method-read.ts parseBodyToSteps`) already shipped. This is **Phase 2 = the opt-in LLM layer** + its **phone trigger** + a reusable **"BeakerBot is working" bubble**.

**Key architecture decision:** the model emits **tidied MARKDOWN**, not a new step JSON schema. So the phone's existing `parseBodyToSteps` is unchanged and the verbatim guardrail compares plain text. Markdown in, tidier markdown out, same facts.

## The pieces (all behind `NEXT_PUBLIC_METHOD_PHONE_REFORMAT`, default off)

Frontend:
- `frontend/src/lib/methods/reformat-validate.ts` — **the safety-critical guardrail**. Deterministic verbatim faithful-subset check: every distinct NUMBER and content WORD in the output must exist in the source (minus a tiny structural allowlist: step/materials/reagents/of/note/figure), plus a coverage floor (0.85) so a step-dropping reformat is rejected. Strips list indices + heading hashes so they never count as values; multiply-sign + decimals safe. 14 tests.
- `frontend/src/lib/methods/reformat-prompt.ts` — structure-only system prompt + user framing + code-fence cleanup.
- `frontend/src/app/api/ai/reformat-method/route.ts` — mirrors the chat proxy (server-only `AI_API_KEY`, `AI_BILLING_ENABLED` fail-closed, metering). Single non-stream temperature-0 call, then the guardrail: an output that invents/changes any value returns `{ok:false, reason:'validation_failed', ...}` so the caller falls back to the deterministic parse. Returns `usage{prompt,completion,total}`. `AI_REFORMAT_MODEL` env override. 5 route tests (mocked provider).
- `frontend/src/lib/methods/phone-reformat-cache.ts` — caches the reformat as a **sha-marked sidecar** next to the source (`foo.md` -> `foo.phone.md`), sequence-store precedent. First line embeds the source SHA -> an edited method auto-invalidates it. One fixed path per source = no stale accumulation. 11 tests. `method-snapshot.ts buildBody` prefers a fresh cached reformat over the raw body.
- `frontend/src/lib/methods/__tests__/*` — the unit tests above.
- `frontend/src/components/methods/MakePhoneFriendlyButton.tsx` + wired into `MethodTabs.tsx` action toolbar (next to View-on-phone, body-file methods only) — the **laptop** trigger.
- `frontend/src/lib/mobile-relay/ai-job-status.ts` — `publishAiJobStatus` + `AiJobStatus` type; a lean per-device status snapshot under the generic `ai-job` name (no relay change, relay stores snapshots by name).
- `frontend/src/lib/mobile-relay/poll.ts` — new `reformat-method` command case + handler. Resolves the method body, calls `/api/ai/reformat-method`, caches via `writePhoneReformat`, republishes the method snapshot, announces `ai-job` status. **ACKs after every terminal outcome** so a metered job never auto-retries and re-bills (re-tap is the retry).
- `frontend/src/lib/mobile-relay/method-snapshot.ts` — stamps `reformatAvailable` (from the flag) into `MethodSnapshot` so the phone gates its trigger on the SAME flag as the laptop button.

Mobile:
- `mobile/lib/beakerbot-job.ts` — transient app-wide job store (pub/sub, the app's established pattern) + `fireMethodRefresh`/`subscribeMethodRefresh` nudge.
- `mobile/lib/reformat-method.ts` — `postReformatMethod` sealed command sender (mirrors `add-variation`) + `estimateReformatSeconds`.
- `mobile/components/BeakerBotWorkingBubble.tsx` — persistent upper-right pill (living Skia BeakerBot mark + local ETA countdown), tap-expand card (time left + token count). OWNS the loop: while working it polls the `ai-job` snapshot, lands on outcome + tokens, fires the method-refresh nudge (open reader reloads in place), then auto-dismisses. 75s timeout safety net. Mounted in `app/_layout.tsx`, native-only, null when idle. **Reusable for any future metered-AI job (PDF reproduce, summaries).**
- `mobile/components/method/MethodReadMode.tsx` — optional `onMakePhoneFriendly` prop -> a ✨ (`sparkles-outline`) action in the top chrome.
- `mobile/app/method-detail.tsx` — wires the confirm Alert (shows ETA + "uses AI credits" + verbatim promise) + job start + the refresh subscription, gated to body methods in a paired experiment with `reformatAvailable`.
- `mobile/lib/snapshots.ts` — `reformatAvailable?` on the phone `MethodSnapshot` type.

**The loop:** phone ✨ -> confirm -> seals `reformat-method` command (same channel as add-variation) + raises bubble -> laptop poll loop reformats + caches + republishes + publishes `ai-job` status -> phone polls `ai-job`, lands on token count, refreshes the reader to the tidied steps, auto-dismisses.

Progress model (Grant's locked choice): **final token count + live ETA** — the countdown is local, the real token total snaps in on done. Live-streamed token ticking is a deferred enhancement.

## Commits (on local main, in order)

`ca532d429` engine+guardrail · `f373218f3` sidecar cache · `a633c6ef3` laptop button · `fd7b559de` laptop relay handler + ai-job channel · `2b516f17e` phone trigger + bubble · `4a2bd7f92` reformatAvailable flag gate. Merged dark via the worktree-merge-then-ff pattern (other lanes' uncommitted work in the shared checkout left untouched).

## Where the live test is parked (IMPORTANT)

To verify on Grant's paired Samsung (`R3CTB09L7KA`), there is a running test rig that **must be cleaned up**:
- A **tunnel Metro** serving the merged code from worktree `/Users/gnickles/Desktop/ROS-method-reformat/mobile` (port 8085, tunnel host `l7jiyua-gnickles-8085.exp.direct`). Log: `/tmp/reformat-metro-tunnel.log`.
- The worktree `ROS-method-reformat` (branch `feat/method-reformat-llm`, now merged) with **COW node_modules** + borrowed `expo-linear-gradient`/`expo-blur`/`@expo-google-fonts/*` from `ROS-mobile-redesign`.
- **A TEST SHIM** at `ROS-method-reformat/mobile/node_modules/expo-linear-gradient/build/LinearGradient.js` (passthrough `View`). Needed because **the Samsung's installed dev-client APK predates the gradient/blur native modules** (only exports `[ExpoImage, ExpoCamera]`), so the real native gradient red-boxes the app. The shim lets the app run (gradients flat on unrelated screens). It is in throwaway node_modules, never committed — delete with the worktree.
- The Samsung is repointed to the 8085 tunnel and **the app loads fine** (Home renders, active experiment "test" Day 2 visible, the fixed settings gear shows). Also set `stay_on_while_plugged_in=3` on the device (revert if desired).

**Blocker to finish the test:** the phone shows "Waiting for first sync" — **no method snapshot is published**. To see the ✨ + bubble, on the LAPTOP open an experiment with a **markdown** method and hit **"View on phone"**, then on the phone open that method in read mode (the experiment read path, not the library `?uid` path — the ✨ is only wired to the experiment path). Then tap ✨ -> confirm -> watch the bubble + tidied steps.

**Proper long-term fix (separate chore):** Grant's Samsung needs a fresh dev-client APK built from current main (has the native modules) so the shim is unnecessary. Neither existing built APK (`ROS-mobile-redesign/.../app-debug.apk` has the modules but signature-incompatible; `ResearchOS/mobile/.../app-debug.apk` is older + lacks them) can update in place without uninstall (would drop pairing).

## Remaining / next

1. Finish the Samsung verification (publish a markdown method via View-on-phone, drive ✨ -> bubble -> tidied steps). Then **push main**.
2. Laptop button browser verify (flag is `=1` in `frontend/.env.local`, `AI_API_KEY` set, `AI_BILLING_ENABLED=false` so it runs free — `:3000` runs from the main checkout).
3. Cleanup: kill the 8085 tunnel Metro, `git worktree remove ROS-method-reformat`, optionally revert the device stay-awake.
4. Deferred enhancements: live-streamed token ticking; reuse the bubble for PDF-reproduce / summaries.

## Unrelated decision this session

**External barcode lookup is SCRAPPED** (Grant: paid not worth it, no free DB covers lab reagents). Recorded in `mobile/lib/barcode.ts` comment + commit `aa8aa7700`. The naming layer stays the offline GS1 parse + lab-shared barcode memory (both already shipped, free, offline).
