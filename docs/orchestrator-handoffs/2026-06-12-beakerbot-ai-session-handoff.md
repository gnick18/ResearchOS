# BeakerAI session handoff, 2026-06-12

For: the next agent picking up the BeakerAI / BeakerBot lane (possibly on a different account). This is the state at pause. House voice: no em-dashes, no emojis, no mid-sentence colons.

## Who this session is, and the lane

This session ("BeakerAI") owns BeakerBot (the in-app AI assistant) + BeakerSearch (the unified command palette) + all AI orchestration. It does NOT own the Data Hub itself, that is a SEPARATE running session, "Data v2" (sessionId local_96104a2e), who owns the Data Hub engine, the transform operations, the stats engine, the markdown-embed renderers, and the manual Data Hub UI.

The split, stated by Grant and reconciled with the Data v2 agent:
- Data v2 owns: the Data Hub engine + transform verb set + recipe storage + manual table UI + the embed renderers (ObjectEmbed dispatcher).
- BeakerAI (this session) owns: BeakerBot tools, the chat surface, and the AI orchestration that CONSUMES the Data v2 agent's code read-only. BeakerBot only does what a user could do by hand.
- Coordination channel: the SHARED design docs (do NOT edit Data v2's actively-edited files, consume them read-only) + Grant relays messages. You CANNOT send_message to the Data v2 session (it runs unsupervised, the tool is blocked). Hand Grant a message for him to relay.

## What landed this session (all on main)

The whole BeakerBot + BeakerSearch arc shipped. Highlights (search the git log for the exact shas):
- BeakerSearch v2 unified surface: centered modal (replaced the old floating dock), morph from search into chat in place, ">" de-clutter (commands behind a prefix), adaptive dodge (the surface glides away from BeakerBot's spotlight), dock retired (the FAB opens the palette in Ask mode). The conversation state lives in a root Zustand store (conversation-store.ts) so it persists.
- Context awareness (context-bridge), the cross-type artifact index (search_my_work) + per-type read tools, the root popup host (notes/tasks/experiments open in place from a tile via ObjectPopupHost + object-popup-bridge).
- Coworker tools: run_datahub_analysis, make_datahub_graph, write_note, the experiment/GANTT tools (create_experiment, reschedule_experiment, create_experiment_chain with real dependency arrows + a navigate-and-highlight on the GANTT), the sequence tools (compute_tm, translate, reverse_complement, find_orfs, design_primers reusing the validated engines, create_sequence), the chemistry tools (search_pubchem, create_molecule, import_molecule), and the transform_table tool (the 5 single-table transforms with a block-approval card).
- The analysis-finder protocol ("Help me choose?"), a cheap widget wizard (system-prompt only).
- Embeds: BeakerBot renders referenced artifacts as the Data v2 agent's rich embeds in chat (molecule structures, and Data Hub result/plot views = verdict+stats and the figure SVG inline), via the ObjectEmbed dispatcher, so new renderers Data v2 ships auto-appear.

All BeakerBot tool files live under frontend/src/lib/ai/ and frontend/src/components/ai/. The system prompt is frontend/src/lib/ai/system-prompt.ts.

## READY TO LAND, but NOT landed (do this first)

The v4 onboarding-tour teardown. Grant approved deleting the dead v4 tour (~145 files) while keeping the sidecar/feature-picks tab system, the entry surfaces, CelebrationManager, and BeakerBot's separate spotlight.
- It is COMPLETE and tsc-clean on branch `claude/rip-v4-tour` at commit `f7790fad3`. Worktree at `/Users/gnickles/Desktop/ResearchOS-riptour`.
- It deletes the whole `frontend/src/components/onboarding/v4/` dir + TourSpotlight.tsx + DevForceWalkthroughButton.tsx, de-wires every importer, and preserves the genuinely-used bits (BEAKERBOT_LAB_USERNAME inlined into WorkbenchExperimentsPanel, CelebrationManager re-mounted in providers.tsx).
- NOT landed because it needs a REAL 3-WAY MERGE, not the checkout-from-branch technique: main changed `frontend/src/lib/providers.tsx` (+23) and `frontend/src/components/LiveMarkdownEditor.tsx` (+36) since the teardown's base (18b236b02), so a blind file-checkout would clobber those.
- TO LAND SAFELY: in the worktree, `git merge main` into the branch, resolve the conflicts on those 2 files (keep BOTH main's additions AND the teardown's removals, providers.tsx is prerender-sensitive so verify the build path), re-run `pnpm exec tsc --noEmit` (MUST be 0), confirm `grep -rnE "(import|from|vi.mock)[^/]*['\"][^'\"]*(onboarding/v4|TourSpotlight|DevForceWalkthroughButton|TourController|V4MountForUser)" src` is zero (ignore comments), then from the main checkout `git merge --ff-only claude/rip-v4-tour`. The tour is already flag-killed (V4_TOUR_KILLED) so it is inert until then, no rush, but do it carefully.

## Gated / queued (do NOT build yet)

- The RELATIONAL transform tool (join/groupby/pivot/filter). Gated on the Data v2 agent landing his generalized TransformOp pipeline contract (he is widening derivedFrom from {transform,params} to {sources, recipe: TransformOp[]}). My transform_table approval card already uses a steps[] array, so it stacks to multi-step with no UI change once his contract lands. There is a partial pandas-validated engine I built before the role split, preserved on branch `claude/datahub-transform-engine`, as an optional head start FOR HIM.
- The "Help me choose?" BUTTON on the Data Hub Analyze toolbar is the Data v2 agent's lane. My analysis-finder protocol is live; the button just needs to call openBeakerBot() (from useBeakerSearch) + sendToBeakerBot("help me choose an analysis for this table"). I sent Grant a message to relay this to Data v2.

## Pending decisions for Grant

- Auto-navigate vs inline-embed for the Data Hub tools: now that analysis/graph results render inline in the chat (as embeds), should run_datahub_analysis / make_datahub_graph STILL auto-navigate the user to the Data Hub sheet, or just show it inline and keep them in the conversation? Currently both (navigation kept, embed additive). His call.
- The future AI + wizard onboarding (greenfield after the tour teardown lands): build on the kept sidecar preferences + entry surfaces. Not designed yet.

## Approved mockups (the design targets, all in docs/mockups/)

- beakersearch-unified-redesign.html (the v2 unified surface, approved).
- beakersearch-centered-adaptive.html (centered + the adaptive dodge, approved).
- beakerbot-transform-blocks.html (the transform pipeline as approvable blocks, approved, built).
- beakerbot-analysis-finder.html (the Help-me-choose wizard, approved, built).
- beakerbot-gui-review.html (the earlier GUI review, 6/7 approved).

## Design docs (docs/proposals/)

- data-transform-wrangling.md (the data-wrangling spec, SHARED with Data v2, he is the active editor, do NOT edit it).
- 2026-06-11-beakerbot-embed-integration.md (Data v2's contract for how BeakerBot emits embeds, authoritative).
- beakersearch-v2-build.md, beakerbot-context-and-index.md, root-popup-host-and-result-tiles.md, beakerbot-economics-for-billing.md.

## Conventions and traps learned this session (important)

- COW-worktree unreliability: in a sub-bot's COW-cloned worktree, jest-dom matchers throw "Invalid Chai property: toBeInTheDocument" on EVERY jsdom test (env, not a regression), and tsc can be cache-unreliable (0 then 503 errors). ALWAYS confirm the real signal on the primary (non-worktree) main checkout after landing. A symlinked node_modules fixes the matchers if you must run jsdom tests in a worktree.
- Landing technique: build in an isolated worktree, then land on the shared (dirty) main checkout via `git checkout <branch> -- <explicit paths>` + `git add` + `git commit` for SMALL non-diverged file sets. For BIG or diverged sets (like the tour teardown), do a real merge-main-into-branch then `git merge --ff-only` instead. ALWAYS divergence-check first: `git diff --stat $(git merge-base <branch> main) main -- <shared files>` (non-empty = needs a merge, not a checkout).
- A killed/stalled background sub-bot leaves its work UNCOMMITTED in its worktree. Check `git -C <worktree> status` before assuming loss, then verify + commit + land it yourself (recovered the centered-redesign and the tour teardown this way).
- Consume the Data v2 agent's files (references.ts, embeds/, RenderedMarkdown.tsx, lib/datahub/) READ-ONLY. He edits them by the hour. Touching them collides at merge. BeakerBot renders THROUGH his ObjectEmbed dispatcher so his new renderers auto-appear.
- Branch hygiene: this session deleted ~24 fully-merged not-checked-out branches (`git branch -d` refuses unmerged, safe). ~300 unmerged branches remain across other sessions, do NOT delete those.
- Never `git add -A` in a worktree (stage explicit paths or `git add frontend/src`). Never `git stash` in the shared main tree.

## Memory

Recall files under the memory dir cover all of this: project_beakerbot_context_index (the BeakerBot/BeakerSearch arc, blow-by-blow), project_data_transforms (the transforms + analysis-finder + the role split), project_ai_assistant, project_datahub_v2_stats. MEMORY.md is the index (and is over its size budget, keep new entries to one line).
