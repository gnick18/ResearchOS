# BeakerBot GUI gaps, modern LLM-product affordances we are missing

Owner: BeakerAI lane. Status: living backlog, recovered 2026-06-13.

## Provenance

This started as an inline brainstorm in a BeakerAI chat (session `d25e897f`, 2026-06-12). Grant's prompt was that BeakerBot is the most important feature of the whole site, so where are the gaps versus modern LLM products, plus two specific asks (stringing complex multi-page methods, and rich summaries over dates/users/projects). The brainstorm was never written to a tracked doc, only the summary-suite branch was spun out to [`beakerbot-summary-suite.md`](beakerbot-summary-suite.md). This file captures the full brainstorm so it stops living only in a transcript, and marks each item against what has since shipped.

The list is grounded in what BeakerBot actually had at the time (around 55 tools, review modes, the chat-history rail, the context bridge), so these are genuine gaps, not things already built.

## Status legend

- SHIPPED, landed on main.
- QUEUED, accepted and next up, not started.
- PARTIAL, an embryo exists, the full idea is open.
- OPEN, not started.

## A. Modern LLM-GUI functions (the chat product layer, where we lag ChatGPT, Claude, Cursor)

- **Stop / cancel mid-run.** [SHIPPED] No way to abort a running loop (a whole-plan especially), table stakes. Built session 4 (AbortController threaded through `runAgentLoop`, send button becomes Stop while running).
- **Suggested follow-up chips.** [SHIPPED] After a reply, 2 to 3 contextual next actions like "Make a chart of this", "Add to my notes", "Schedule a repeat". Surfaces capability and cuts typing, since researchers do not know what BeakerBot can do. Built session 4 (`<!-- followups: A | B | C -->`, capped at 3, latest message only).
- **Provenance chips in answers.** [SHIPPED] When BeakerBot states a fact about the user's data, render the source (which note or result) as a clickable chip. This is the antidote to the hallucination fear, "do not fabricate" becomes "always show where this came from". Built session 4 (prompt cites tool deepLinks inline, renders via the existing ObjectChip path).
- **Per-user persistent memory.** [QUEUED, #1 in the lane queue, unblocked] BeakerBot remembering preferences across chats (for example "I default to Phusion, A. fumigatus, 3 technical replicates"). Large value for a daily assistant. Grant's brief is a bounded per-user prefs/memory file, read into context capped each turn, a remember/forget tool, and a periodic consolidation pass as it grows. Edits `conversation-store.ts` plus `system-prompt.ts` plus a new tool, and adds a new on-disk file (flag the data shape before building).
- **`@` mentions and `/` commands.** [OPEN] `@` to explicitly attach an object (a note, a table, an experiment) as context, and `/summarize`, `/plot`, `/cite`. Kills the "this" / "the result" ambiguity the context bridge currently has to guess at.
- **Editable artifacts (Canvas).** [OPEN] When BeakerBot drafts a note or summary, show it in an editable side panel the user tweaks before saving, not a one-shot approve or reject card.
- **Edit-and-resend, regenerate, branch.** [OPEN] Standard chat affordances we lack.
- **Image drop in chat (multimodal).** [OPEN, gated] "What is in this gel image?" The companion app already ingests photos, the chat should accept one. Gates on the Fireworks vision-model choice in the billing build.
- **Voice input.** [OPEN] Hands are busy at the bench.

## B. Stringing complex multi-page methods (the agentic layer)

Today a cross-page task is `propose_plan`, then `go_to_page` / `read_page` / `click_element`, click by click. That is fragile (perception can miss an element) and slow. The fix is not better clicking, it is higher-level composite tools that act through the data layer, the way `create_experiment_chain` and `link_tasks` already do.

- **Composite "set up X" tools.** [PARTIAL] For example `setup_experiment` creates the experiment, attaches its methods, creates and links the prep tasks, and drops a results scaffold, in one atomic robust call instead of 12 fragile clicks. BeakerBot still only does what a user could by hand, just via the API, not simulated UI. `create_experiment_chain` is the embryo.
- **Reusable named workflows (macros).** [OPEN] Let a user save a multi-step recipe ("new cloning experiment") and re-run it with new params. `create_experiment_chain` is the start of this.
- **Live progress in the plan card, resume from a failed step.** [PARTIAL] The whole-plan card should tick off each step as it runs and resume from a failed step rather than restart the whole thing. The review-modes spec ([`beakerbot-review-modes.md`](beakerbot-review-modes.md)) covers the per-step blocks, resume is still open.
- **Cross-object atomic actions.** [PARTIAL] "Create an experiment for this method, schedule it, and link a note" as one composite that spans object types.

## C. Rich summaries over dates, users, projects (called out as the big one, the PI killer feature)

"Summarize Kritika's experiments in Q2", "what did the cyp51A project accomplish last month", "every purchase over $500 this year". This is where the model would otherwise hallucinate counts, so the hard rule is the tool does the filtering and counting, the model only narrates.

- **Dedicated per-type summary tools.** [SHIPPED] `summarize_experiments`, `summarize_notes`, `summarize_projects`, `summarize_purchases`, `summarize_inventory`, plus a cross-type `lab_digest` rollup. The tool owns every count and total, the model writes prose from the real list, never counts. Built session 4 (summary suite). See [`beakerbot-summary-suite.md`](beakerbot-summary-suite.md).
- **A filter wizard.** [SHIPPED] Instead of phrasing a complex filter in prose, a guided picker (extends the existing `ask_user` button pattern), object types, then date range, users, projects, status, keyword. BeakerBot offers it whenever a summary request is ambiguous. Built session 4.
- **Summaries as real artifacts, not just chat text.** [PARTIAL, mostly open] Render the result as a structured report (timeline plus a chart plus a table), save it as a note or export a PDF, with drill-down chips to the underlying objects. Plugs straight into the markdown-embed system. The summary-as-artifact path is partly specced, the rich report plus drill-down is still open.

This rides on the cross-type artifact index already built (see `project_beakerbot_context_index`), the summary tools are the query layer on top of it.

## Recommended sequence (from the original brainstorm)

1. **The summary suite (C)** is the highest leverage, the thing a PI would pay for and nothing else does well. Largely shipped now.
2. **The composite workflow tools (B)** are the biggest reliability win. Mostly open.
3. **The GUI affordances (A)** are cheaper polish that make it feel modern (stop button, follow-up chips, provenance chips are quick and high-impact). The quick three shipped, the rest is open.

## What is still open, at a glance

- A-list chat affordances, `@` and `/` commands, editable Canvas, regenerate or branch, image drop, voice.
- Per-user persistent memory (queued, unblocked, adds a data-shape file).
- B-list, workflow macros and resumable plans, fuller composite and cross-object tools.
- C, summaries as rich saveable artifacts with drill-down.
