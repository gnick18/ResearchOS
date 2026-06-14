# BeakerBot GUI gaps, modern LLM-product affordances we are missing

Owner: BeakerAI lane. Status: living backlog. Recovered 2026-06-13, **refreshed to
current reality 2026-06-14**.

## Provenance

This started as an inline brainstorm in a BeakerAI chat (session `d25e897f`, 2026-06-12).
Grant's prompt was that BeakerBot is the most important feature of the whole site, so
where are the gaps versus modern LLM products, plus two specific asks (stringing complex
multi-page methods, and rich summaries over dates/users/projects). The brainstorm became
this file, scored against what has shipped. The recommended sequence was C then B then A,
and that is what happened.

## Status legend

- SHIPPED, landed on main.
- PARTIAL, an embryo exists, the full idea is open.
- OPEN, not started.
- GATED, built but behind a flag / pending a verification gate.

## Headline (2026-06-14)

**All three tiers A, B, C are essentially cleared.** The original A/B/C list was the
"catch up to modern LLM products" backlog, and it is done. The frontier has moved to the
adjacent epics in the "What's next" map at the bottom. BeakerBot is now a real agentic
product surface (CRUD on every object, composite setup, macros, summaries, a browsable
record-set widget, Canvas, memory, @/commands), not a chat line.

## A. Modern LLM-GUI functions (the chat product layer)

- **Stop / cancel mid-run.** [SHIPPED] AbortController through `runAgentLoop`, send button becomes Stop while running. Session 4.
- **Suggested follow-up chips.** [SHIPPED] 2 to 3 contextual next actions after a reply. Session 4.
- **Provenance chips in answers.** [SHIPPED] Facts about the user's data render the source as a clickable chip. Session 4.
- **Per-user persistent memory.** [SHIPPED] Bounded `users/<username>/_beakerbot_memory.json` + remember/forget tools. 2026-06-13.
- **`@` mentions and `/` commands.** [SHIPPED] `@` to attach an object as context, `/` slash commands. Merged `b03d4c02e` 2026-06-13. (Doc previously said OPEN.)
- **Editable artifacts (Canvas).** [SHIPPED] `BeakerBotCanvas.tsx` + `canvas-store.ts`, drafts render in an editable side panel before saving. (Doc previously said OPEN.)
- **Regenerate.** [SHIPPED] Regenerate on the last assistant reply; user messages have copy + revert-to-here.
- **Edit-and-resend / branch.** [PARTIAL] Regenerate + revert-to-here exist; true conversation branching does not.
- **Image drop in chat (multimodal).** [GATED] Composer accepts pasted images behind `BEAKERBOT_VISION_ENABLED`; rides on the Fireworks vision model (kimi-k2p6).
- **Voice input.** [OPEN] Hands are busy at the bench. The one genuinely-unstarted A item.

## B. Stringing complex multi-page methods (the agentic layer)

- **Composite "set up X" tools.** [SHIPPED] `setup_experiment` creates the experiment, attaches methods, FS-links prep tasks, drops a results scaffold, in one consented call. 2026-06-13. More composite tools can follow the pattern.
- **Reusable named workflows (macros).** [SHIPPED] Saved `/command` sequences, store + runner + slash-invoke + editor + rail manager. Merged `ba2ad9364`. (Doc previously said OPEN.)
- **Live progress in the plan card, resume from a failed step.** [SHIPPED, flag] Live-ticking, resume-from-stopped-step, loop-driven per step. Merged `51b9728b9` behind `NEXT_PUBLIC_BEAKERBOT_PLAN_STEPS`. 4 upstream polish follow-ups before the prod flag-on. (Doc previously said PARTIAL.)
- **Cross-object atomic actions.** [PARTIAL] `create_experiment_chain`, `link_tasks`, `setup_experiment` exist; a fully general cross-type composite is still open.
- **Full CRUD + content-edit on every object.** [SHIPPED, not in the original list] create / read / update / content-edit / delete for all 7 core object types, gated + own-only + no-interpretation. 2026-06-14.

## C. Rich summaries over dates, users, projects (the PI killer feature)

- **Dedicated per-type summary tools.** [SHIPPED] `summarize_experiments/notes/projects/purchases/inventory` + `lab_digest`. The tool owns every count, the model only narrates. Session 4.
- **A filter wizard.** [SHIPPED] Guided picker extending `ask_user` for ambiguous filters. Session 4.
- **Summaries as real artifacts.** [SHIPPED] `save_summary_as_note` composes a structured note via the draft-preview gate, numbers verbatim from the tools. 2026-06-13.
- **Deterministic resolvers.** [SHIPPED, not in the original list] period/calendar windows, project + member name resolution (fuzzy), `search_full_text` body grep, `list_records` top-N. Verified live 7/7. 2026-06-14.
- **Inline record-set widget.** [SHIPPED, not in the original list] When any record tool returns a SET, the chat renders a searchable master-detail browser (2 to 4 compact chip-tabs + preview, 5+ full search + rail), deterministic, full set to the UI / capped to the model. Live-verified + fixed. Merged `2d57e50a3` + `406248cd1`. 2026-06-14.

## What's next (the adjacent epics, the real frontier)

The A/B/C catch-up is done. These are the live targets, roughly by leverage.

1. **One-front-door BeakerSearch, finish the unification.** [~80% BUILT] The instant
   cross-type GUI palette (`CommandPalette.tsx` + `beaker-search/global-index.ts`), the
   ask-mode escalation into chat, the Layer 0 context bridge, `search_my_work` (Layer 1),
   and most Layer 2 read-by-id tools all EXIST. Remaining gaps:
   - The GUI palette and the AI `search_my_work` read TWO separate indices
     (`GlobalIndexEntry` vs `ArtifactBrief`) that cover the same types but can drift.
     Unify on one shared index (the "one front door" ideal, one index both surfaces read).
   - 3 missing Layer 2 read tools: `read_task` (generic tasks), `read_inventory`,
     `read_datahub` (the document, not just `read_datahub_analysis`).
   - Phylo trees are in `searchMyWork` but not in the GUI `buildGlobalIndex`, so the
     palette does not show them.
   - Context-bridge coverage audit, not every page calls `setBeakerContext` yet.
2. **PDF-reproduce-from-paper.** [PARTIAL] Outputs 1 and 2 (draft_paper_summary,
   extract_paper_method) shipped. Open: the ingestion UI (attach a PDF, pdf.js text
   extraction) that feeds the draft tools, plus outputs 3 and 4 (pipeline -> generate_tree,
   figure -> editable style spec), gated on phylo review and the vision model. See
   `beakerbot-pdf-reproduce-analysis.md`.
3. **Flag-on / launch gates.** Resumable plan card's 4 upstream follow-ups before its prod
   flag; vision-model verification to ungate image drop.
4. **A-list stragglers.** Voice input; true conversation branching.
5. **Record-set widget v2 polish.** Pending lab_digest crash repro (Next 16 undefined-throw
   class, cleared on retry); an optional panel resize handle.

## Shipped waves, for the record

- 2026-06-13 wave: per-user memory (A), `setup_experiment` composite (B),
  `save_summary_as_note` (C), PDF-reproduce outputs 1 and 2.
- 2026-06-13/14: `@`/`/` commands, workflow macros, resumable plan card, full CRUD +
  content-edit + delete.
- 2026-06-14: summary-robustness deterministic resolvers (live-verified 7/7), the inline
  record-set widget (all record tools, compact + full layouts, live-verified).
