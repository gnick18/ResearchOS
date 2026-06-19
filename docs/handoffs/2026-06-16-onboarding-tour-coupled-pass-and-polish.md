# Handoff — Onboarding tour coupled pass + polish (2026-06-16)

Session `3fd289f3` (the BeakerAI-lane takeover, continued). This doc covers the
`feat/onboarding-tour-mount` branch and the session's already-merged work.

Memories: `[[project_llm_onboarding_tutor]]`, `[[project_beakerbot_analysis_picker]]`,
`[[project_beakerbot_crud_tools]]`. AGENTS.md §5 has the one-paragraph status.

---

## Already MERGED to local main this session (done, verified)

- **picker-in-chat** (`b9691fc91`): picker-driven Data Hub runs stay in chat, typed runs still navigate. Grant Chrome-verified both paths, ff-merged, `:3033` + worktree torn down.
- **setup_project composite** (`d2c843a71`): the project-level analog of `setup_experiment` — creates a project + every experiment already assigned to it, optional FS chain, results scaffolds. 24 tests, tsc 0, ff-merged. gui-gaps "Cross-object atomic actions" flipped to SHIPPED.

---

## The branch: `feat/onboarding-tour-mount` (UNMERGED)

Worktree `.claude/worktrees/tour-mount`. ~22 commits beyond main, **based on stale main (merge-base `05fe013e5`) — needs a rebase onto current main before merge.** All gated on `NEXT_PUBLIC_ONBOARDING_TUTOR` (OFF/inert) EXCEPT three GLOBAL changes (see below). `tsc 0`, 201 onboarding lib tests green.

### What it does (the coupled pass, `9b2c63e27`)
Deep-demo beats now drive the REAL pages instead of the placeholder stand-in:
- `OnboardingTutor` gained `live` + `onBeginShow` + `onProgress`. In live mode, deep_demo beats render the transparent `LiveCursorLayer` (cursor + soft ring over the real `[data-tutor-target]` control) instead of `ShowcaseStage`. The dev preview (`/dev/onboarding-tutor`) stays non-live (mock page, no real controls) and keeps the stand-in.
- `TourHost` (mounted in `providers.tsx`) wires the real demo enter/exit using the same helpers as `DevDemoToggleButton`: picker start → opaque "Setting the stage" cover → persist progress → HARD-reload into `/demo`; complete/skip → restore real folder + clear demo + reload back, **only when actually in demo**.

### Durable full-state resume (`423a1ef05`)
New `lib/onboarding/tour-progress.ts` (localStorage): persists `{phase, role, goals, beatIndex}` on every machine change; rebuilds the EXACT state on mount; cleared ONLY on finish/skip. So the walkthrough reopens precisely where the user was across refresh / folder reconnect / tab close-and-reopen. Cross-session playing resume re-enters demo (demo mode is sessionStorage-backed → dies on tab close). Replaced the lightweight "started" flag (`84f87df1c`). Pure converters round-trip tested (14 tests).

### Polish (all browser-verified by Grant on a flag-on `:3050`)
- Streak badge hidden during the tour (`hasTourProgress`).  [`2e5eb8455`]
- Twirl: `beakerBotTwirl` keyframe Z-rotate → perspective `rotateY` (upright "live" twirl). **GLOBAL** — also affects thanks-page + showcase twirls.  [`2e5eb8455`]
- Streak first-reveal "hide your streak in Settings" popup REMOVED for good. **GLOBAL** (`StreakBadge.tsx`); badge + hover tooltip + click-popover stay.  [`ea122e617`]
- Welcome meter reads "Free AI" (no raw "0k / 150k" token count).  [`40361eeff`]
- Picker Beaker 32px → 160px (~5x).  [`7873a5190`]
- Beaker's spoken text in his signature font `var(--font-ai)` (Hanken); all welcome/picker type a notch bigger.  [`c8dce786c`]
- Welcome headline "Hi, I'm Beaker (AI)" ((AI) in brand green).  [`849b3b9f9`]
- "Show me around" CTA: pure-CSS **brand green→teal glass pill** (gradient rim + sheen + soft float shadow, white label).  [`77f87515a`]

### GLOBAL (not flag-gated) changes to be aware of at merge
The twirl keyframe (`BeakerBot.module.css`) and the streak first-reveal removal (`StreakBadge.tsx` + test) take effect regardless of the tutor flag. Streak-hide is effectively inert (only fires when a tour is in progress). The CTA/font/beaker/meter/AI changes are all inside the flag-gated tutor components.

### `liquid-glass-react` lesson (do NOT re-add)
Tried the library Grant linked. It does not coexist with Tailwind: tags its shadow layers with the class `bg-black` (painted solid black, left in flow as black pills), applies a base `translate(-50%,-50%)` expecting absolute centering, is SSR-unsafe (reads `navigator` at render), and its displacement is Chromium-only. Removed it; the pure-CSS glass renders identically on every browser with no dependency.

---

## VERIFIED vs PENDING

- **VERIFIED:** all the welcome/picker VISUALS (Grant, live `:3050`), `tsc 0`, 201 onboarding lib tests.
- **PENDING (needs Grant, flag-on, fresh user):** the live deep-demo-over-real-page flow + the cross-session demo re-entry. These are browser/demo/rAF-coupled. **The rAF cursor cannot be verified by Claude-in-Chrome automation** — the `!document.hidden` gate in `LiveCursorLayer`/`ShowcaseStage` freezes the player when the tab is backgrounded (this is why the stand-in looked "frozen" during automated review). Grant must watch it live.

## How to run / verify
- **Quick visual (no account):** `NEXT_PUBLIC_ONBOARDING_TUTOR=1 PORT=3050 pnpm dev` from the worktree frontend, then `localhost:3050/dev/onboarding-tutor` — welcome → picker → stand-in deep demos.
- **The real coupled pass:** same flag, then the app root as a FRESH user (empty connected folder — `isFreshUserForWizard` needs no settings.json/metadata footprint). Walkthrough auto-mounts; deep demos drive real pages in demo mode. To force a clean run, clear `localStorage` keys `ros.onboardingTutor.done.v1` + `ros.onboardingTutor.progress.v1`.

## NEXT
1. Grant's flag-on functional verify of the coupled pass + resume (the only gate before merge).
2. Rebase `feat/onboarding-tour-mount` onto current main, resolve any AppShell / package.json / AGENTS.md conflicts, then merge (coordinate with MobileUI on shared-tree sequencing).
3. Optional follow-ups still on the lane: AiDemoBeat → real BeakerBot panel; tutor increment 6 (account-vault memory persistence — `handleRememberFact` is still a TODO in TourHost); carry Beaker's font + size bump into the deep-demo `CoachBubble` narration if wanted.
