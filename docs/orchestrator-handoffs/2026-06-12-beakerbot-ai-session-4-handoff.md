# BeakerAI session 4 handoff (2026-06-12)

The BeakerAI lane (BeakerBot in-app assistant + BeakerSearch palette + AI
orchestration under `frontend/src/lib/ai/` + `frontend/src/components/ai/`). One
of several parallel sessions. This doc is where work stands at the token-budget
pause. Everything below is on LOCAL `main` unless noted; a sibling session's
commit `f89f661e2` is the current HEAD and all of this lane's commits are
ancestors of it (verified intact).

## What landed on main this session (verified tsc 0 + AI suite green)

1. Summary suite (per-type deterministic aggregators + lab_digest + filter
   wizard + `list_lab_members`). The TOOL owns every count/total, the model only
   narrates. Wizard asks a guided step ONLY when the request is ambiguous
   (Grant's choice), otherwise runs with whole-lab/all-time defaults.

2. Hard NO-INTERPRETATION scope in `system-prompt.ts`. BeakerBot expands and
   summarizes the user's OWN content, relays tool data, operates the app, and
   NEVER interprets results, concludes, hypothesizes, or invents science.
   Textbook facts are fine. One scoped carve-out (PDF-reproduce flow only): light
   FACTUAL method comparison (the paper's recipe vs the user's, as facts), never
   a judgment or recommendation. Verified live: BeakerBot warmly declined "what
   does this mean for my research?" and still answered "what is a t-test".

3. Phylo tools: `list_phylo_trees` / `read_phylo_tree` (read-only, tree-card
   embeds) and `generate_tree` (commit `940e6adf0`). generate_tree fills
   `BuilderOptions` from `@/lib/phylo/catalog` with validated catalog values
   only, calls `generateRecipe(o)`, returns the runnable RecipeOutput
   (commands/install/envYaml/runScript/markdown). It NEVER writes a raw flag, the
   generator owns them. Read-only, runs immediately. The sequence-ids -> FASTA
   binding is deliberately NOT wired (the open co-design with the phylo lane).

4. New stats consume-tools (engine owns every number): nested t-test / nested
   ANOVA, contingency / chi-square, plus Theme 3+4 (Cox, ROC/AUC, RM-ANOVA,
   mixed model, Grubbs) merged from the Data v2 relay.

5. GUI quick-wins (commit chain via Build 1 merge `e6a3e3cee`):
   - Stop / cancel button: AbortController threaded through `runAgentLoop`; the
     send button becomes Stop while running; abort is a clean empty-answer stop,
     no error banner; the gate stays fail-closed on a thrown abort.
   - Follow-up chips: the model may end a reply with `<!-- followups: A | B | C -->`;
     the store parses + strips it (even malformed), caps at 3, renders tappable
     chips on the latest assistant message only.
   - Provenance source chips: prompt guidance to cite tool deepLinks inline,
     renders via the existing ObjectChip path (no renderer change).
   - The living blue-blob thinking indicator restored (`BeakerBotThinking`
     variant `pulse`).

6. CRITICAL fixes surfaced by Grant's Claude-in-Chrome verification run:
   - lab_digest CRASH (commit `1e50e80a3`): a thrown `undefined`/non-Error in
     `runToolCall` could reach Next 16.1.6's `.digest` handler and BLANK the
     page. Now `gateToolCall` is wrapped (a gate throw returns an error result
     and does NOT fall through to execute, so the gate stays fail-closed) and
     both catch blocks normalize undefined/null/non-Error. Class-level fix, no
     tool throw can crash the page again. NOTE: the bot could not reproduce the
     EXACT original trigger on demo data (lab_digest is safe when empty), so a
     re-run of "what did the lab do this week" on :3000 is the confirmation.
   - Purchase money-MISCOUNT (commit `ab58ae7e6`): `summarize-purchases` keyed
     its byId map by the plain per-user numeric id, so two owners sharing id 1
     collided, double-counting one and dropping the other. The tool itself
     computed ~$5,769 vs the true $6,966.00 / 36 items. Fixed with a compound
     `owner:id` key; a demo-fixture test asserts $6,966.00 / 36 exactly.
   - SAME collision class fixed in summarize-experiments + summarize-notes
     (commit `dc33cbd12`, done by hand, see git hazard below). Totals were always
     right, the byStatus/byProject/byOwner/entry BREAKDOWNS were silently wrong.
   - Project ids resolved to NAMES in summarize-experiments (was "project 1/2/3").
   - VERBATIM-ECHO rule: tools now return preformatted `*Display` strings
     (totalSpendDisplay, spendDisplay, totalPriceDisplay); the prompt tells the
     model to copy them char-for-char and never re-type or re-sum a figure.

## Bot C: MERGED (the last loose thread is closed)

- Bot C (reopen-blank chat + queue-while-streaming) is now on main as
  `b3e9494f9` (cherry-picked off the stale anchor, Build 1's stop/followups
  verified intact, tsc 0 + 39 conversation tests green). Root cause of the blank
  reopen: a race between `revealAnswer` and `saveChat` where a concurrent
  new-chat/`stop()` nulled `currentThreadId`, so the `threadId !== null` guard
  skipped `saveChat` and the on-disk file kept only the user message. Fix
  snapshots `boundThreadId` + `savedMessages` right after the reveal. Queue is a
  single-slot last-wins design (`pendingQueuedText` + reactive `queuedText` +
  `clearQueue`), auto-fires one tick after the turn settles, and an explicit
  `stop()` discards it. A queued-message indicator chip with a Discard button is
  in `BeakerBotConversation`.

## Queued (in order)

1. Per-user memory. Grant's brief: "keep a file on the user but occasionally
   consolidate it and always prevent it from getting too big (token usage issues
   if its huge)." Design: a bounded per-user prefs/memory file, READ into context
   each turn CAPPED, a remember/forget tool, and a periodic consolidation/dedup
   pass as it grows. Edits `conversation-store.ts` (per-turn context inject) +
   `system-prompt.ts` + a new tool, so it waited on Bot C.

2. PDF-reproduce-analysis feature. SPEC'd at
   `docs/proposals/beakerbot-pdf-reproduce-analysis.md` (memory
   `[[project_beakerbot_pdf_reproduce]]`). Attach a paper PDF -> 4 grounded
   approved drafts: summary->note, method->methods (verbatim), pipeline->
   generate_tree recipe, figure->editable style spec in the Figure Studio.
   Decisions locked with Grant: light factual comparison allowed, editable style
   spec (not auto-apply), SPEC-FIRST then phylo-lane reviews outputs 3+4 before
   build. A signed relay was handed to Grant for the phylo lane (review the two
   [PHYLO REVIEW] blocks: param->BuilderOptions mapping + FASTA binding, and the
   Figure Studio style-spec + vision-to-spec). Outputs 1+2 are text-only and
   buildable independently; 3 needs generate_tree (done) + the FASTA binding; 4
   needs the Figure Studio style model + a VISION-capable model (gates on the
   Fireworks model choice in the billing build).

3. Re-run the Chrome verification TAIL. Grant's run (script
   `docs/testing/2026-06-12-beakerbot-full-verification-chrome.md`, isolated
   origin `http://127.0.0.1:3000`, fresh folder `~/Desktop/ResearchOS-BeakerBot-Verify`)
   hit the usage limit after test D1. PASSED: B (relative dates), C6 (whose
   filter), D1 (no-interpretation decline). FIXED-since: C1 project names, C2
   purchase total, C4 lab_digest crash, A reopen-blank (Bot C). NEVER REACHED:
   D2 (textbook answer), E (phylo tree card), F (the new stats step blocks), G
   (no-crash-on-navigate-after-analysis). Re-run those four after Bot C lands.

## The git hazard to know (cost real time this session)

`isolation:worktree` Agent dispatches branch from a FIXED harness anchor
(observed `2b0162bb9`) that PREDATED this session's own Build1/A/B merges. One
bot died on that stale base; its diff would have reverted a merged test file +
another bot's rewrite. Before integrating ANY background bot:
`git merge-base main <branch>` and `git diff --stat <mergebase> <branch>`. If the
base predates your merges AND the bot touched a file you already changed, do NOT
`git merge --no-ff` (ort can silently clobber). CHERRY-PICK (`git cherry-pick -x
<branch>`) so overlap surfaces as a conflict, then grep a sentinel line to
confirm your earlier work survived. If the bot heavily rewrote a file you also
rewrote, redo the small change yourself off current main instead. Recorded in
memory `[[feedback_subagent_anchor_drift]]`.

## Lane discipline reminders

- We OWN `frontend/src/lib/ai/*` + `frontend/src/components/ai/*`. We CONSUME the
  Data Hub engine/transforms/embeds READ-ONLY (Data v2 owns them) and the phylo
  catalog/recipe/render (phylo lane owns them). Coordinate via shared docs +
  Grant relays (To:/From: signed; do not spawn a chip for a lane with a running
  agent).
- Stage explicit paths, never `git add -A` in a worktree. `--no-verify` is
  justified ONLY when the pre-commit failure is a foreign uncommitted file and
  your own staged source is icon-guard-clean.
- Run vitest/tsc from `frontend/` (the `@` alias lives in
  `frontend/vitest.config.mts`).
