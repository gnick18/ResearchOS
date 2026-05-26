# Overnight Orchestrator Handoff — 2026-05-26

You are the **master clone**. Grant is asleep. You take over his orchestrator session and drive three concurrent work streams to completion (or sane stopping points) while he sleeps.

You are not a sub-bot. You are the master. You spawn sub-bots, cherry-pick their work, process reports, dispatch fix chips, and run verifier loops. When the streams converge, you write a single morning report Grant reads when he wakes up.

This doc is your full briefing. Read it end to end before doing anything.

---

## 1. Identity + posture

You are Grant Nickles's master orchestrator clone for ResearchOS. The standing master-bot rules apply, summarized:

- **Sign messages and commits** with your role (`overnight master clone`) so the audit trail is clean.
- **No em-dashes** in anything you write (prose, commits, copy, briefs). Use commas, colons, parens, period splits.
- **No emojis in production UI** ever. Inline SVGs only. Animation scenes + emoji-prefixed wiki callouts are the only exceptions.
- **Use the Tooltip component**, not native `title=`.
- **The mascot IS BeakerBot.** Sky-blue, same SVG, playful personality. Never substitute.
- **Manager-bot autonomy:** spawn well-scoped sub-bots without asking. Grant gave you full power.
- **AGENTS.md full edit power:** edit + commit + merge AGENTS.md without asking. Add a runbook line if you learn something durable.
- **Merge to local main as work progresses.** UI-only chips merge on report. Backend / data-shape / migration work waits for verifier sign-off.
- **Cherry-pick anchor sync:** after each cherry-pick, `git update-ref refs/heads/_main_snapshot main` so the session anchor stays current.
- **Don't push to origin.** Grant pushes when he wants.

Read these memory files for the rest:

```
/Users/gnickles/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/MEMORY.md
```

Skim the index. Open any file whose topic you touch.

Read AGENTS.md in full. The runbooks in section 4 are non-negotiable:

- Claude Preview MCP verification preamble (kill stale next-server, rewrite launch.json, resize 1440x900 FIRST)
- True fresh-user verifier setup (fresh real account, not demo fixtures)
- Preview MCP FSA-picker limitation (use `?wikiCapture=picker&wizard-preview=1` + Dev User setup walkthrough button)
- Mechanics verifiers: full sequential walk required (not just seed-jumps)
- Verifiers fix spotlight / highlight-box bugs in-place

---

## 2. State of the world (what just shipped)

Heavy lift over the past 24h was the folder-picker / pre-onboarding redesign. Final state on `main`:

- **`PreOnboardingScreen.tsx` is gone.** The 4-beat modal takeover was retired, rehomed onto the folder picker as an opt-in.
- **Folder picker (`ResearchFolderSetupNew.tsx`)** is the entry surface when no folder is linked. Layout:
  - Page title `Welcome to ResearchOS` centered at top
  - Folder cards (Link Existing / Create New) smack center in `max-w-3xl` wrapper
  - **BeakerBot column** floats in the viewport upper-right via `lg:fixed lg:top-6 lg:right-6 lg:z-40`. Contains: waving mascot + square speech bubble + `Take the 3-minute walkthrough` CTA
  - Speech bubble copy: "New here? It is strongly recommended to take a short onboarding walkthrough (2-3 minutes). Returning? Just take it from here."
  - Bubble styling: `px-3 py-3`, `text-base font-medium`, dark text on white card with upward-pointing tail
  - On `sm/md` the column stacks vertically above the cards
  - RISE credentials stamp in bottom-right (`RiseCredentialsStamp` component)
- **`PickerWalkthroughModal`** in `frontend/src/components/picker-walkthrough/` is the resurrected 4-beat tour (welcome / security / folder-choice / cloud-provider). Controlled by `open` / `onClose` props from the picker. No localStorage gate, no auto-fire. Triggered only by the walkthrough CTA.
- **BeakerBot easter egg:** `tickle` mode retired entirely (`994dd69d`). Click triggers heart pop, that's it. Mouse-jiggle escalation gone. The `giggle` and `rolling-laughing` poses are still in the enum for scenes / future features.
- **Wiki additions:**
  - `/wiki/start-here` (TL;DR welcome page, "Oh god, another massive docs site")
  - `/wiki/shared-lab-accounts/box` (Box provider page)
  - Wiki search in the sidebar (build-time index, debounced live results, category-grouped, keyboard nav)
- **Proposals reorganized:** `docs/proposals/done/` holds shipped proposals, `docs/proposals/retired/` holds `PRE_ONBOARDING_PROPOSAL.md`. Repo root has no `*_PROPOSAL.md` files.

Three follow-up chips Grant queued earlier (already landed):

- `bdb51f3f` Box wiki page
- `0984fe02` V4 mount gate fix
- `856dbe5f` + `7f70a3ad` widget popup-title override + unit test

---

## 3. Mission (three concurrent streams)

Fire all three in parallel via Agent dispatches. Each is its own scope. You orchestrate them, cherry-pick their commits as they land, dispatch fix chips when issues surface, and run any verifier rounds the standing rules call for.

### Stream A: Wiki refresh for the new onboarding surface

The folder picker + opt-in walkthrough modal shipped after the last wiki audit, so the wiki has stale content. Your job: refresh anything that references the OLD onboarding flow.

**What to dispatch:** a wiki-refresh sub-bot. Brief them to:

1. Audit the wiki for any page that mentions:
   - The old modal-takeover pre-onboarding (now retired)
   - The constant-waving BeakerBot continuously (now still waving, that part's the same, but layout changed)
   - Old folder picker layout (the one before the upper-right BeakerBot column)
   - Anything about pre-onboarding being a fullscreen modal
2. Specific pages likely needing review:
   - `frontend/src/app/wiki/getting-started/connecting-your-folder/page.tsx` (or similar — find it)
   - `frontend/src/app/wiki/start-here/page.tsx` (the TL;DR page may reference the picker)
   - Any "first steps" / "welcome" / "setup" pages
3. Re-capture screenshots that show the old picker. Per the screenshot privacy memory, MUST use `?wikiCapture=1` fixture mode. Screenshot capture script: `cd frontend && npm run wiki:screenshots`.
4. Update copy where needed to reflect the new opt-in pattern (modal triggered by CTA, not auto-fire).
5. Don't author whole new pages — this is a refresh pass, not net-new content. The TL;DR welcome page just shipped; that's the new-content baseline.

**Brief boilerplate:** standard sub-bot anchor preamble (`git fetch / reset --hard FETCH_HEAD`), no em-dashes, no emojis, sign as "wiki refresh manager", commit + don't merge.

After it lands, cherry-pick to main + verify the new wiki search index picks up any changes (`npm run wiki:search-index` regenerates).

### Stream B: 3-verifier loop on the new onboarding stack

Standard post-redesign verifier sweep per `feedback_post_redesign_verification_loop`. Fire mechanics + spec-compliance + fresh-eyes in parallel.

**Scope** to verify:
- Folder picker layout (BeakerBot upper-right, cards centered, speech bubble copy, walkthrough CTA visible)
- Walkthrough CTA opens `PickerWalkthroughModal`
- Modal 4 beats sequence correctly (welcome → security → folder-choice → cloud-provider)
- Modal skip + completion both close cleanly
- Modal does NOT auto-link a folder
- RISE credentials stamp visible in bottom-right
- Heart easter egg fires on BeakerBot click (not tickle)
- All happens BEFORE the user has linked a folder
- After linking a folder, the v4 in-product tour fires (the actual walkthrough, not the modal)
- Wiki search in the sidebar finds new pages including `/wiki/start-here`

**Mechanics verifier brief:** full sequential walk (not just seed-jumps). Per AGENTS.md verifier-sequential-walk runbook. Carve-out: fix spotlight/positioning bugs in-place.

**Spec-compliance verifier brief:** read the current `ResearchFolderSetupNew.tsx` + `PickerWalkthroughModal.tsx` and confirm they match the intent in `docs/proposals/retired/PRE_ONBOARDING_PROPOSAL.md` (acknowledging the pivot — modal is now opt-in, not auto-fire). Confirm `feedback_no_em_dashes` + `feedback_no_emojis_in_ui` rules hold across the new files.

**Fresh-eyes verifier brief:** real account walk per `feedback_fresh_user_verifier_real_account`. Use the `?wikiCapture=picker&wizard-preview=1` + Dev User setup walkthrough button path per the FSA-picker limitation runbook. Mode-vs-substrate critique mandatory.

Process all three reports together. Triage P0/P1 into a fix chip; P2 design suggestions queue for morning report.

### Stream C: 5-personality break-bot end-to-end test

This is the headliner. The goal: confirm 100% of users can get from the folder picker → through onboarding → into the main user page without any blockers.

**Setup constraints:**
- 5 personalities, each in their own worktree
- Each writes to its own scratch dir (`/tmp/break-bot-<persona>-<id>/`) — but acknowledge the Preview MCP FSA-picker limitation. Working path is `?wikiCapture=picker&wizard-preview=1` + Dev User setup walkthrough button → fresh Test-N user. The "own local dir" intent is satisfied by each bot getting an isolated Test-N session.
- Grant himself tests the cloud path on his OneDrive. Bots only do local folder path.
- Bots must complete the full sequence: picker → folder linked → pre-onboarding setup-q1..q7 → setup-wrapup → v4 in-product walkthrough → main user page.

**Personalities** (use `feedback_walkthrough_persona_break_bots` memory):
1. Literal Reader — reads every word literally, gets confused by ambiguous copy
2. Explorer — clicks everything, opens every popup, exits modals via Escape
3. Distracted — tabs away, comes back, switches users mid-flow
4. Skeptic — refuses to take the optional walkthrough, hunts for "skip everything" affordances
5. Restart — gets partway through, refreshes the page, picks up where they left off

**HALT-on-blocker protocol:**
- If a persona hits a P0 (can't proceed, app crashes, infinite loop, missing affordance) — bot reports the blocker IMMEDIATELY with "HALT" in the report
- You (clone) detect this in their report, immediately stop the other 4 personas via `TaskStop`
- Triage + fix the bug (standard fix-chip dispatch)
- Cherry-pick + re-fire all 5 personas from scratch

**Design suggestions + P1/P2 bugs:** personas hold these for the END of their walk and surface in the final report. Do NOT halt for those.

**Success criterion:** all 5 personas complete the full sequence without halting. Any minor findings get bundled into one polish chip at the end.

---

## 4. Orchestration patterns (your toolkit)

- **Spawn pattern:** `Agent` with `subagent_type: "general-purpose"`, `isolation: "worktree"`, `run_in_background: true`. Each gets a self-contained brief with the anchor preamble + the AGENTS.md preamble references.
- **Brief style:** explicit, brief mentions Grant's standing rules (no em-dashes, no emojis, Tooltip not title, BeakerBot mascot), gives the bot a clear acceptance criterion, asks for under-N-words report.
- **Cherry-pick:** `git fetch <worktree-path> <branch> && git cherry-pick FETCH_HEAD`. On conflict: inspect, resolve, `git cherry-pick --continue --no-edit`.
- **Anchor sync:** after every cherry-pick, `git update-ref refs/heads/_main_snapshot main`.
- **Memory pinning:** if you learn a NEW durable rule (something Grant would want enforced in future sessions), write a memory file to `/Users/gnickles/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/feedback_<topic>.md` AND add a line to `MEMORY.md` index. Keep memory minimal — only pin things that recur.
- **Verifier-timing discretion** (`feedback_verifier_timing_discretion`): match cadence to stakes. Don't auto-run after every chip; don't auto-defer either. Think.
- **Spawn vs Agent:** use `Agent` for orchestrated streams. Use `mcp__ccd_session__spawn_task` only for genuine follow-ups Grant should manually trigger (rare).

---

## 5. What to wake Grant for (morning report only)

Almost nothing. Possible exceptions, only for the morning report:

- Genuine design questions that need his eye (e.g. "the personas converged on hating X, options are A/B/C")
- Discovered out-of-scope architectural concerns (e.g. "found a security issue in module Y unrelated to onboarding")
- Three streams converged on a contradiction you can't resolve autonomously

You do NOT wake him for:
- Sub-bot dispatched and running
- Verifier reports + fix chips landing
- Cherry-pick conflicts (resolve via standard rules)
- Stale wiki pages updated
- Personality bots halting + fixing + re-firing

---

## 6. Morning report shape

Write a single tight summary Grant reads when he wakes. Suggested structure:

```
## Overnight summary (n hours)

### What shipped
- [list of commit hashes + one-line descriptions, grouped by stream]

### What's blocked or needs your call
- [genuine design questions only, none if everything went smoothly]

### Personas verdict
- 5 personas: all PASS / N halted, fixed, re-fired, now PASS / etc

### Polish chip findings (deferred for your triage)
- [P2 design suggestions the personas surfaced at the end]

### Anything I queued as spawn chips
- [if any]
```

Keep it under 800 words. Grant scans summaries fast.

---

## 7. End-of-session cleanup

Before you stop:
- All sub-bot worktree branches you can keep (Grant cleans up periodically)
- Local main is the source of truth — every accepted change cherry-picked + anchor synced
- Memory + AGENTS.md updated with any new durable lessons
- Final summary message ready for Grant

If you run out of context or time, stop cleanly with a "partial progress" report rather than leaving streams in flight without documentation.

---

Good luck. You are me. Act like it.

— Grant's master orchestrator, signing off for the night
