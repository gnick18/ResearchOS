# Onboarding v3.0 — proposal

**Status:** Design locked via master ↔ Grant brainstorm 2026-05-20. Ready for manager-bot dispatch.
**Replaces:** v1 (welcome modal + 11-tip catalog + `/demo?tutorial=1` sequencer) and v2 (7-step wizard modal). Both are deprecated in full.
**Author:** master bot (synthesis of brainstorm; no planning-bot intermediary needed since every design call was locked live).

---

## 1. Thesis

Onboarding v3.0 is a **single guided experience on the user's real account** that fuses:

- **A short feature-preference Q&A** (replacing v2's use-case taxonomy; users pick FEATURES they want, not jobs they hold)
- **A BeakerBot-driven interactive walkthrough on the user's real account** (replacing v1's `/demo?tutorial=1` sequencer and v1's 11-tip popup catalog)
- **An optional Lab Mode tour** (only fires for lab accounts, can be deferred to first natural Lab Mode entry)
- **A cleanup selector at the end** so users can keep, individually discard, or wipe everything BeakerBot helped them create

**Total target duration: ~10 minutes** for the maximal lab-account-plus-all-features path. Solo with minimal features lands closer to 5-6 minutes.

**Why fuse?** The v2 wizard front-loads questions then dumps users into an empty app. The v1 tip catalog interrupts work-in-progress with popups. The `/demo?tutorial=1` sequencer teaches on fake data that the user can't keep. v3 collapses all three by *teaching while the user creates their actual first project* on their actual disk.

---

## 2. What v3 deprecates

| v1/v2 surface | Fate in v3 |
|---|---|
| `OnboardingWizard.tsx` (v2 7-step modal) | Deleted (replaced by v3 wizard component) |
| `OnboardingTutorialSequencer.tsx` (`/demo?tutorial=1`) | Deleted |
| `tips.ts` (11-tip catalog) | Deleted |
| `sidecar.ts` v3 tip fields (`mode`, `tips`, `last_tip_at`, `shown_count`, `tips_off`) | Removed in sidecar v4 |
| `use-case-tab-mapping.ts` (9-use-case → tabs table) | Deleted; tab visibility derived from feature picks |
| Settings "Re-run welcome tour" card (v2 entry point) | Retained; re-runs v3 wizard |
| `?wizard-preview=1` dev hook | Retained; previews v3 wizard in fixture mode |
| `?tutorial=1` URL flag | Removed (no `/demo?tutorial=1` route to gate) |
| `/demo` public route | Retained as marketing/fixture surface; loses the sequencer overlay |
| Wiki page `wiki/getting-started/welcome-wizard` | Rewritten end-to-end for v3 (see Phase 6) |
| `_user_metadata` mainUser pointer | Retained unchanged |
| `_onboarding.json` sidecar | Migrates v3 → v4 schema (see §6) |

---

## 3. Design locks (every call answered)

| # | Question | Locked answer |
|---|---|---|
| L1 | Trigger | First-connect for fresh data folders ONLY. Existing users skip automatically. |
| L2 | Existing-user re-run path | Settings card (same button v2 ships). Invisible by default; no banner, no auto-fire. |
| L3 | Time target | ~10 min for max path, 5-6 min for minimal |
| L4 | Setup question style | FEATURES (purchases, calendar, goals, Telegram, AI Helper), NOT jobs/use-cases |
| L5 | Solo vs lab branching | Q1 first; lab adds Q1a/Q1b storage-setup sub-questions |
| L6 | AI Helper prompt size picker | 3 sizes; default **Full** (most users use big-tech models, unaware of small-context tradeoffs) |
| L7 | Walkthrough surface | User's REAL account. No fake fixture data; no `/demo` redirect. |
| L8 | Persistent skip | "I've got it from here" link on every step → jumps to Phase 4 cleanup selector |
| L9 | Individual step skip | Yes; if a downstream step depends on the skipped item, BeakerBot creates the prerequisite for them |
| L10 | Mid-walkthrough close | On next open: prompt "Restart / Resume / Discard" |
| L11 | Pacing | Next button on every step (text-video-game cadence). No auto-advance, no animated speech bubbles. |
| L12 | Animation scope | BeakerBot mascot animation + live-typing animation as BeakerBot demonstrates in the user's UI (e.g., markdown in hybrid editor). Speech bubble text appears statically. |
| L13 | BeakerBot color | Sky blue, matches existing mascot SVG |
| L14 | BeakerBot voice | Funny + playful throughout |
| L15 | W2 method real-doc path | File picker AND markdown-picker option (both inline) |
| L16 | W2 method placeholder voice | Voice A: "Let's add your first method! Want me to drop in placeholder text so we can keep moving, or do you have a real method document handy?" |
| L17 | Hybrid editor demo | BeakerBot live-types real keyboard shortcuts: bold, italic, code-block (Python), quote, headings |
| L18 | Lab tour timing | Phase 2 end offers "now or later". "Later" → first natural Lab Mode entry triggers walkthrough with three buttons: take now / snooze / dismiss. Snooze re-fires next natural entry. Dismiss kills permanently. |
| L19 | Fake user for Lab tour | Spawn "BeakerBot" as a temporary fake user. Sky-colored. Auto-shares an experiment with the real user. |
| L20 | Permission practice | Practice BOTH edit (success) and view-only / red (blocked delete) permissions on BeakerBot's shared task |
| L21 | Tip catalog fate | Fully deleted. v3 walkthrough subsumes all 11 tips' content. |
| L22 | Onboarding visibility | New users get full v3. Existing users get nothing automatic; Settings re-run still works. |
| L23 | Industry/startup framing | Maintained throughout. No "your lab" assumption in solo paths; copy says "your work" or "your account". |
| L24 | Phase 4 cleanup default | All created items pre-checked (default keep). Master toggle "Start fresh" wipes everything. |

---

## 4. Phase 1 — Setup questions

BeakerBot mascot in upper-left of every step. 2-sentence elevator pitch on intro.

### Step 0: Welcome
**Copy:** "ResearchOS keeps your experiments, lab notes, methods, and calendar in one local-first place. I'm BeakerBot, and I'm gonna help you get set up in about ten minutes. Ready?"
**Buttons:** Let's go / Skip setup (defaults to show-all-features)

### Q1: Solo or lab? (single-select)
- **Solo** (just me on my account)
- **Lab** (multiple people working together)

If **Lab**, branch to Q1a + Q1b:

### Q1a (Lab only): Where will the lab data live?
- **Local disk only** (each user picks their own folder)
- **Google Drive shared folder**
- **OneDrive shared folder**
- **Box shared folder**
- **I'll figure it out later**

### Q1b (Lab only): How will lab members connect?
Brief inline blurb explaining: every lab member points their ResearchOS at the same shared folder. Storage provider sync handles the rest. Link to wiki page for detailed setup. **No action required here**, just informational.

### Q2: Will you track lab purchases?
- Yes / No / Maybe later

### Q3: Want calendar feeds?
- Yes / No / Maybe later

### Q4: Want a goal-tracking page?
- Yes / No / Maybe later

### Q5: Want a Telegram bot for image inbox?
- Yes / No / Maybe later

### Q6: Want an AI Helper prompt for Claude / ChatGPT / Gemini?
- **Yes — Full prompt** (default, most context, recommended)
- Yes — Medium prompt
- Yes — Minimal prompt
- No / Maybe later

**Tab visibility derived from Q2-Q5:** Purchases tab visible iff Q2 = Yes. Calendar tab iff Q3 = Yes. Goals tab iff Q4 = Yes. (Workbench, Methods, Experiments, Gantt, Search always visible.) Lab Mode visible iff Q1 = Lab.

---

## 5. Phase 2 — Walkthrough (W1–W14)

Every step has:
- BeakerBot mascot + speech text (static; no animated typing of speech)
- "Next" button (drives pacing)
- "I've got it from here" link (jumps to Phase 4)
- "Skip this step" link (BeakerBot creates the prerequisite if downstream steps need it)

### Universal sequence (W1-W9, fires for everyone)

| # | Step | What happens |
|---|---|---|
| W1 | Create first project | BeakerBot prompts user for a project name (placeholder: "My First Project"). User clicks Create. New project folder appears in Workbench. |
| W2 | Create first method | Voice A prompt: "Let's add your first method! Placeholder or real doc?" Branch: **Placeholder** → BeakerBot auto-fills a sample method markdown. **Real doc** → file picker + markdown picker inline. Either way ends with a method in the user's account. |
| W3 | Create first experiment | BeakerBot creates an experiment inside W1's project. User picks a name (placeholder default). |
| W4 | Link method to experiment | BeakerBot walks them through attaching W2's method to W3's experiment via the link UI. |
| W5 | Hybrid mode tour | Opens hybrid editor on the experiment's note. BeakerBot **live-types** demonstrations of: bold (Cmd+B), italic (Cmd+I), code block (triple-backtick + `python`), block quote (`>`), heading 2 (`##`). User watches the keyboard shortcuts produce live markdown. BeakerBot's speech bubble says "Try one yourself" before Next. |
| W6 | Personalization | Tour settings: animations toggle, accent color picker, theme. BeakerBot demos changing the accent color live (user sees the chrome shift). |
| W7 | Search tab tour | Open Search tab. BeakerBot live-types a query that matches W3's experiment. Result highlights. |
| W8 | Notifications tour | BeakerBot fires a test notification. User sees the badge, opens the panel, dismisses. |
| W9 | Wiki discovery stub | Brief blurb pointing to the wiki sidebar. "If you ever get stuck, click the Wiki tab. There's a getting-started guide and feature reference." (No tour of wiki itself; pure pointer.) |

### Conditional sequence (W10-W14, fires per Q2-Q6 picks)

| # | Step | Fires when |
|---|---|---|
| W10 | Purchases tour | Q2 = Yes. BeakerBot creates a sample purchase request and walks the user through approving + receiving it. |
| W11 | Goals tour | Q4 = Yes. BeakerBot creates a sample goal and demos linking it to W3's experiment. |
| W12 | Telegram tour (with image attach) | Q5 = Yes. Inline Telegram bot pair flow. BeakerBot then demos sending an image from Telegram and showing it appearing in the user's image inbox AND attaching it to W3's experiment note. |
| W13 | Calendar tour | Q3 = Yes. Inline calendar feed subscribe flow. BeakerBot shows the feed appearing on the Calendar tab. |
| W14 | AI Helper tour | Q6 = Yes (any size). BeakerBot grabs the chosen prompt size, copies it to clipboard with a "Copied!" toast, and explains how to paste it into Claude / ChatGPT / Gemini. |

---

## 6. Phase 3 — Lab Mode tour (L1-L11, lab accounts only)

Fires at Phase 2 end with a prompt: "Want to tour Lab Mode now or later?" If **later**, snooze until first natural Lab Mode entry; that entry triggers a smaller prompt (take now / snooze / dismiss).

| # | Step | What happens |
|---|---|---|
| L1 | What Lab Mode is | BeakerBot explains: "Lab Mode is where you collaborate. Right now I'm the only other lab member. Let me show you." |
| L2 | Spawn fake BeakerBot user | A temporary "BeakerBot" user (sky-colored avatar) is created in the lab's `_user_metadata`. BeakerBot auto-shares a sample experiment titled something playful with the real user. |
| L3 | See BeakerBot's task | Switch to Lab Mode. BeakerBot's shared experiment appears in the user's Workbench + Gantt. BeakerBot's speech: "That's mine! You can see it because I shared it with you." |
| L4 | Permission practice | **Edit (green):** User can edit BeakerBot's task. BeakerBot shows them where to type. **View-only (red):** BeakerBot creates a second task shared as view-only. User attempts to delete; UI blocks with red lock indicator. BeakerBot explains the diff in playful copy. |
| L5 | User shares back | User creates a new experiment and shares it with BeakerBot. BeakerBot's speech bubble reacts: "Ooh, thanks!" |
| L6 | Revoke sharing | User walks through revoking BeakerBot's access on the experiment they just shared. UI confirms BeakerBot no longer sees it. |
| L7 | Gantt + activity feed | User views the lab Gantt (shows both their tasks + BeakerBot's shared task). Activity feed shows the shares and revokes from L4-L6. |
| L8 | Lab purchases (if Q2 = Yes) | Brief tour of the Lab Mode purchases page. BeakerBot creates a sample request as "BeakerBot" so user sees a teammate's request appear. |
| L9 | Lab search | User searches Lab Mode; results include BeakerBot's shared task. |
| L10 | (reserved / merged into L8 if Q2 = No) | — |
| L11 | BeakerBot cleanup option | At end: "Want me to clean up the BeakerBot user and the demo tasks I made? Yes / No / Decide at the end" → defaults to surfacing in Phase 4 cleanup selector. |

---

## 7. Phase 4 — Cleanup selector

Final screen, fires after every walkthrough completes (universal end + Lab end if Lab tour ran).

Layout: checkbox grid of every artifact BeakerBot helped create, grouped by category:

- **Project:** "My First Project" (W1) ☑
- **Method:** sample method (W2) ☑
- **Experiment:** sample experiment (W3) ☑
- **Hybrid edits:** the bold/italic/code-block/quote/heading typing demo in the note ☑
- **Settings changes:** accent color, animations toggle (only listed if user made changes) ☑
- **Purchase request** (if W10) ☑
- **Goal** (if W11) ☑
- **Telegram link** (if W12) ☑
- **Calendar feed** (if W13) ☑
- **Lab Mode artifacts:** BeakerBot fake user, shared tasks L2/L4/L8 ☑

Default: **all checked = keep**. User unchecks individual items to discard them. Master "Start fresh" toggle at the top unchecks everything + adds a confirm step ("This wipes everything BeakerBot and you made during onboarding. Continue?").

Footer button: **Finish setup** → writes `wizardCompletedAt` + applies cleanup decisions + closes wizard + lands on Workbench.

---

## 8. Behavior contracts

### Mid-walkthrough close (L10 lock)
On any close (tab close, browser quit, force-quit, navigation away):

- Persist current step ID + every artifact created so far in `_onboarding.json` (new field `wizard_resume_state`)
- On next open of ResearchOS with this data folder:
  - If `wizard_resume_state` exists, fire modal: "Welcome back! You were partway through setup. **Resume / Restart / Discard**"
  - **Resume:** restore to step ID + keep all artifacts
  - **Restart:** clear resume state, delete artifacts (with confirm), fire walkthrough from start
  - **Discard:** clear resume state, keep artifacts, mark `wizard_skipped_at`, never auto-fire again (Settings re-run still works)

### "I've got it from here" link (L8 lock)
Persistent on every step. Click → confirm modal: "Skip to the cleanup selector? You can review everything we made and keep or discard each item." → **Yes:** jumps to Phase 4. **Cancel:** stays on current step.

### Individual step skip (L9 lock)
Every step has "Skip this step". Click → BeakerBot inspects downstream dependencies:

- If the skipped step creates an artifact a future step depends on (W1 → W3, W2 → W4, etc.), BeakerBot silently creates a placeholder version of the artifact so the rest of the walkthrough still flows
- Skip is logged in `wizard_resume_state.skipped_steps` for cleanup selector visibility
- Skipped artifacts appear in Phase 4 cleanup grid with a small "(auto-created)" tag

### Lab tour deferral (L18 lock)
If user picks "later" at Phase 2 end:

- Set `_onboarding.json.lab_tour_pending = true`
- On first navigation to Lab Mode after that, fire small modal: "Take the Lab tour now? **Now / Snooze / Dismiss**"
- **Now:** fires Lab tour, clears `lab_tour_pending`
- **Snooze:** keeps `lab_tour_pending = true`; modal fires again next Lab Mode entry
- **Dismiss:** clears `lab_tour_pending`; never fires again automatically. Settings re-run still works.

---

## 9. BeakerBot character spec

**Visual:** Existing mascot SVG, sky-blue. Mounted top-left of wizard modal at ~80px. Idle state: gentle bobbing animation. Speaking state: subtle mouth animation (if mascot has one) OR slight scale pulse.

**Animation scope (L11/L12 locks):**
- Mascot animation: yes, always (idle bob, attention pulse on step transitions)
- Speech bubble text: STATIC (no typewriter animation on the speech itself)
- Live-typing into user's UI: YES — when BeakerBot demos hybrid editor / search / accent color picker, the keystrokes/picks animate at human-readable cadence (~80-120ms per char) so the user can follow what's happening

**Voice (L14 lock):** Funny + playful throughout. Examples:
- W1: "Every great experiment starts with a project. Or a snack, but mostly a project."
- W5: "Watch this. I'm gonna make this bold like it just got cast in a summer blockbuster."
- L2: "Hi! I'm a fake user for the next two minutes. I'll share something with you so we can practice."
- L4 (view-only): "Try to delete this one. I dare you."

Tone is friendly-quirky, never sarcastic at the user's expense. Never em-dashes (master style rule).

---

## 10. Data model — sidecar v4

`_onboarding.json` migrates from v3 to v4. New + removed fields:

```ts
// Removed (v3 → v4)
- mode: "tips_on" | "tips_off"
- tips: Record<string, TipState>
- last_tip_at: string | null
- shown_count: number
- tips_off: boolean
- use_cases: string[]          // v2 use-case taxonomy
- other_use_case: string | null

// Retained
+ wizard_completed_at: string | null
+ wizard_skipped_at: string | null
+ wizard_force_show: boolean      // dev hook

// New (v3.0)
+ schema_version: 4
+ feature_picks: {
+   account_type: "solo" | "lab"
+   lab_storage?: "local" | "google_drive" | "onedrive" | "box" | "deferred"
+   purchases: "yes" | "no" | "maybe"
+   calendar: "yes" | "no" | "maybe"
+   goals: "yes" | "no" | "maybe"
+   telegram: "yes" | "no" | "maybe"
+   ai_helper: "full" | "medium" | "minimal" | "no" | "maybe"
+ }
+ wizard_resume_state: {
+   current_step: string         // "W3", "L4", "phase4-cleanup", etc.
+   skipped_steps: string[]
+   artifacts_created: Array<{ type: string; id: string; cleanup_default: "keep" | "discard" }>
+ } | null
+ lab_tour_pending: boolean
+ lab_tour_dismissed_at: string | null
```

**Migration:** v3 sidecars (use_cases / wizard_completed_at + tip fields) are upgraded on read. `feature_picks` is inferred from v2 `use_cases` when possible (lab-manager → account_type=lab, etc.); when ambiguous, left empty and `wizard_force_show=false` so users aren't re-tutorial'd.

**Tab visibility:** Driven directly from `feature_picks` (no separate `visibleTabs` field needed). Settings still allows manual override.

---

## 11. Gating + trigger logic

**Fresh-folder rule (unchanged from v2):** Wizard auto-fires iff:
1. `_user_metadata` is empty OR has no `mainUser`
2. AND `_onboarding.json` doesn't exist OR has no `wizard_completed_at` AND no `wizard_skipped_at`
3. AND NOT `isDemoOrWikiCapture()` (unless `?wizard-preview=1` dev flag set)

**Existing users:** Sidecars upgraded to v4 transparently on read. No wizard auto-fires. Settings "Re-run welcome tour" available.

**Lab tour micro-gate:** Lab tour auto-fires on first Lab Mode entry iff `lab_tour_pending = true`.

---

## 12. Phase plan for implementation manager

| Phase | Effort | Scope |
|---|---|---|
| P0 | S | Sidecar v3 → v4 migration + types. Feature_picks inference from v2 use_cases. New fields wired into `sidecar.ts`. AI Helper schema_hash bump via prebuild. |
| P1 | M | Wizard component skeleton (`OnboardingWizard.tsx` redesign). Step state machine: linear forward + back + individual-step-skip + "I've got it from here" + resume support. Mount logic in `AppShell` per §11 gating. |
| P2a | M | Phase 1 setup steps (Welcome + Q1 solo/lab + Q1a/Q1b storage + Q2-Q6 feature picks). UI components, validation, persistence to `feature_picks`. |
| P2b | L | Phase 2 universal walkthrough (W1-W9). Project / method / experiment creation flows, hybrid editor live-typing demo, settings tour, search demo, notifications demo, wiki pointer. Auto-create-prerequisite logic for skipped steps. |
| P2c | M | Phase 2 conditional walkthroughs (W10-W14). Purchases / goals / Telegram-with-image / calendar / AI Helper. Conditional gating from `feature_picks`. |
| P3a | M | Phase 3 Lab Mode tour (L1-L11). Fake BeakerBot user spawn, shared-task creation, edit + view-only permission demos, share-back flow, revoke flow, lab Gantt + activity feed, lab purchases (conditional), lab search. |
| P3b | S | Lab tour deferral: `lab_tour_pending` gate + first-natural-entry trigger + snooze/dismiss flow |
| P4 | M | Phase 4 cleanup selector. Artifact-tracking machinery (every BeakerBot-created item registers in `artifacts_created`). Checkbox grid UI. "Start fresh" master toggle + confirm. |
| P5 | S | Resume state machinery + mid-close persistence + Resume/Restart/Discard modal |
| P6 | S | Wiki page rewrite (`wiki/getting-started/welcome-wizard`). Wiki manager territory. |
| P7 | XS | Deprecation sweep: delete `OnboardingTutorialSequencer.tsx`, `tips.ts`, `/demo?tutorial=1` route handler, `use-case-tab-mapping.ts`. Verify nothing imports them. |
| P8 | XS | Existing-user invisibility test (vitest case) + AGENTS.md §6 trap if needed |
| P9 | XS | BeakerBot character animation polish: idle bob, attention pulse, live-typing cadence tuning |

**Total estimated effort:** ~3-4 weeks at one manager dispatching chips sequentially with some parallelism in P2a/P2b/P2c.

---

## 13. Out-of-scope (explicit)

- AI Helper feature itself (only the prompt-copy step in W14 + the prompt-size pick in Q6 are touched)
- Hybrid editor internals (only the keyboard-shortcut demo wraps existing functionality)
- Standalone Telegram pair-flow component (W12 invokes it; doesn't redesign it)
- `/demo` public route (the marketing surface stays; the `?tutorial=1` overlay is what's removed)
- `users/` data-folder migration for existing accounts (P0 only migrates sidecar shape, not user artifacts)

---

## 14. Acknowledgment / handoff

This proposal is ready for an Onboarding v3 manager to absorb as their role brief. Manager should:

1. Create `ONBOARDING_V3_MANAGER_ROLE_BRIEF.md` modeled on v2's brief, with this proposal cited as the canonical spec
2. Append an AGENTS.md §8 "Active bot branches (in flight)" entry once they start
3. Dispatch P0 first (data shape); hold final merge until master verifies
4. Surface any unlocked design call to master via AskUserQuestion before the dependent chip fires (per the brief-flagged-design-questions memory rule)

Signed: **master bot**, 2026-05-20
