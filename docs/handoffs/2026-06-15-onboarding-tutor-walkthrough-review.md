# Onboarding Tutor — full walkthrough review (browser-driven)

**Date:** 2026-06-15
**By:** BeakerAI lane, driving Grant's Chrome through the dev preview `/dev/onboarding-tutor`
**Build under review:** Phases 1-4 + 3-live foundation (commits f31672840 → 64a6881dc), flag-gated dark.

I walked the entire flow twice (PI + analyze + trees, then PI + track-experiments), tested both escape paths, both AI variants, and the memory write. Below: what works, what is clunky, and what I would change or remove. Severity tags: **[P1]** fix before ship, **[P2]** should-fix, **[P3]** nice-to-have.

---

## What works well (keep as-is)

1. **The whole flow completes end to end and dismisses cleanly.** welcome → picker → deep demo(s) → AI demo → montage → memory → recap → done → unmount to the app. No crashes, no console errors.
2. **The adaptive director works LIVE.** 2 picks (analyze, trees) → 2 deep demos (Data Hub, Phylogenetics). 1 pick (track) → 1 deep demo (Methods). Confirmed in the browser, not just unit tests.
3. **The AI-demo variant switches correctly by picks.** trees/analyze → `overlay_tree` ("Just ask, and I'll put your data right onto the tree"); neither → `make_table` ("Paste anything and I'll turn it into a table"). The "chat only for an AI feature" rule is visually unmistakable: the violet **AI FEATURE · CHAT SHOWN** badge vs the amber **SAMPLE DATA · NOTHING SAVED** badge on the page-driven demos.
4. **The memory write fires.** Accepting "Yes, remember" pushed the fact through the `onRememberFact` callback (the dev dock captured "remembered: PI / lab head. Wants to analyze data and build trees").
5. **The recap is accurate.** Role / Interested in / Showed you rows all reflect the picks and the demos actually shown.
6. **Trust cues are visible throughout** as designed: the ephemeral "nothing saved" badge on every demo, the capped token meter on welcome, the per-user/never-shared promise on the memory beat.
7. **Role vs goal color coding reads cleanly** (role = violet, goals = green).
8. **The presenter cursor, coach bubble, and humanized narration all render** (the CSS clip-path arrow works, the voice-checked lines appear).
9. **Skip works from welcome and from mid-flow** (tested from the montage) and dismisses cleanly.

---

## Issues to fix

### [P1] The interest picker has no escape (no-soft-lock gap)
Welcome and the playing beats show "Skip for now", but the **picker phase has none**. A user who starts onboarding and changes their mind at the picker is stuck unless they pick a role and proceed. This violates the no-soft-lock invariant we explicitly designed for. **Fix:** add "Skip for now" to the picker (and ideally a "Back" to the welcome).

### [P2] Inconsistent per-beat controls — AI demo and montage feel stuck
Deep demos have **Pause + Skip demo**. The AI demo and the montage have **neither** — they only auto-advance on a timer. The only way to move on from them is to skip the entire tour. **Fix:** give the AI demo and montage a "Next"/"Skip this part" control, matching the deep demos, so a user who gets the point can move forward without bailing out.

### [P2] The stand-in demo stage reads as empty / unfinished
The deep-demo stage is a large grey box with a small "resistance table" placeholder top-left and a floating target marker in dead space. The reveal (morph) box barely registers — I could not see it land. This is expected for the stand-in (the real page lands with the live mount), but right now it does not communicate "a table became a plot." **Fix path:** prioritize the real-page mount; until then, make the stand-in morph clearly visible (a fake table that visibly becomes a fake plot) so it does not look broken.

### [P2] Everything floats mid-screen with large empty margins
Welcome, picker, AI demo, memory, and recap all sit vertically centered with a lot of dead space above and to the sides, on a near-white flat background. It reads sparse and lonely on a wide monitor. **Fix:** anchor the content in a contained panel/card or add the subtle brand-soft backdrop from the mockup, so each beat feels composed rather than adrift.

### [P3] The memory fact copy is terse / robotic
"PI / lab head. Wants to analyze data and build trees." reads like a database row, not Beaker. **Fix:** warmer phrasing, e.g. "You lead a lab and want to analyze data and build trees." (The recap rows are fine; it is the standalone proposed fact that is stiff.)

### [P3] Memory propose is missing the "Edit" affordance
The mockup had Yes / Not now / **Edit**. Only Yes / Not now shipped. Letting the user tweak what gets remembered before it saves reinforces the control story. Add it back if cheap.

---

## Robustness note (not a blocker, but real)

### [P2] Timer-based animation throttles in background tabs
The showcase drives on `setInterval` (deep demos) and `setTimeout` (AI/montage). Browsers throttle both in inactive/background tabs, so during this review the demos crawled and a couple auto-advanced unexpectedly while I waited. In a focused production tab it is fine, but: if a user tabs away mid-onboarding it stalls, and the cadence is not frame-aligned. **Consider:** `requestAnimationFrame` + a `visibilitychange` pause for smoother, throttle-resistant timing that also pauses cleanly when the user looks away.

---

## Things to consider removing / simplifying

- **Deep-demo "Pause" button:** for a ~40s auto-demo with replay-from-Help, is pause earning its place, or is Skip enough? Could simplify.
- **Montage pacing:** 6 sequential ~3s cards can feel long. Consider a faster single "here is everything else" grid (all surfaces at once) or 2 per card, so the tail does not drag.

---

## What I could NOT verify (needs the real app-level mount)

The deep demos ran on the **stand-in stage**, so I could not verify real navigation, ephemeral seeding, or the cursor landing on actual controls. That is the live-mount step (the last, riskiest piece) and the only way to judge the real "Beaker drives the page" feel.

## Environment notes (not tutor bugs)
- The shared dev server hiccuped once (a transient 404 + "Compiling") from concurrent-lane churn; reload recovered it. The route + flow are fine.
- The lab lane's uncommitted `LabIdentityFields.tsx` WIP currently reddens whole-repo tsc; unrelated to the tutor.

---

## Recommended next actions, in order
1. **[P1]** Add the picker escape.
2. **[P2]** Add Next/Skip to the AI demo + montage.
3. **[P2]** Warm up the memory-fact copy + anchor the layout.
4. Then the **real app-level mount + per-surface live wiring** (in a worktree, when the shared tree is calmer), which also resolves the empty-stage issue and unlocks verifying the real driving feel.
