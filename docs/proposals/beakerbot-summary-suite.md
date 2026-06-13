# BeakerBot summary suite, design proposal

Status: proposed 2026-06-12, BeakerAI lane. Spec-before-mockup-before-build per the UI-review rule. House voice throughout.

## Why

BeakerBot can READ any single object and SEARCH by name + date window (search_my_work over the artifact index). What it cannot do is the thing a PI most wants: aggregate ACROSS many objects with rich filters and write a grounded summary. "Summarize Kritika's experiments in Q2", "what did the cyp51A project accomplish last month", "every purchase over 500 dollars this year", "the lab's week in review". This is the highest-leverage gap, it is the feature a PI would pay for, and no competitor does it well for a local-first ELN.

It is also the single HIGHEST hallucination-risk feature, because the model is being asked to count, total, and characterize many records. So the central design rule is non-negotiable.

## The hard rule (same principle as the Data Hub engine owning numbers)

The TOOL does the filtering, counting, grouping, and totaling DETERMINISTICALLY. The model only narrates from the structured aggregate the tool returns. The model never counts records, never sums a spend, never invents a date or a status. Every summary tool returns:
1. the exact filter it applied (echoed back, so the user sees the scope),
2. the deterministic aggregates (counts, totals, group-by tallies, a timeline),
3. a bounded list of the actual matched items (with ids + deep links), capped and explicitly labeled when truncated,
and the model writes prose ONLY from that. A summary must also be able to say "no matching records" plainly.

This makes summaries trustworthy AND keeps them cheap (the model reads a compact aggregate, not thousands of raw records).

This is a special case of BeakerBot's GLOBAL hard scope (Grant, 2026-06-12, now in the system prompt): BeakerBot rewrites / expands / summarizes the user's OWN content and relays tool data, and it NEVER interprets results, draws conclusions, generates hypotheses, or invents scientific content. A summary therefore reports structure (counts, dates, totals, titles, status), never a finding or a meaning the user did not write. v1 note summaries are structural only, with NO model-extracted conclusions, by design and forever, not just for v1.

## Architecture

Three layers, each independently useful.

### Layer 1, a shared query/filter over the artifact model
We already have `frontend/src/lib/ai/artifact-index.ts`: a unified `ArtifactBrief` with per-type converters (noteToBrief, experimentToBrief which is a Task, methodToBrief, sequenceToBrief, dataHubToBrief, projectToBrief, purchaseToBrief, moleculeToBrief), plus `dayPrefix` for day-granular dates and `scoreBrief` for name matching. Add a pure `filterArtifacts(briefs, filter)` that applies:
- `types`: which object kinds,
- `since` / `until`: inclusive day-granular date window (reuse dayPrefix),
- `owners`: which lab members (own + shared, via the existing listAllForUser / fetchAll*IncludingShared paths; usersApi.list gives the member roster),
- `projects`: project ids or names,
- `status`: per-type status (complete / open / overdue for experiments+tasks),
- `keywords`: token overlap via the existing scorer.
Pure and unit-testable against fixtures, no DOM. This is the same scope the planned cross-type index (project_beakerbot_context_index Layers 1+2) wants, so we build it once and both features share it.

### Layer 2, per-type summary tools (deterministic aggregates)
Each is a read-only tool (previewable false, runs immediately like search_my_work, it changes nothing). Each takes the Layer-1 filter and returns a type-specific aggregate. The model gets the aggregate and writes one tight narrative, then can offer to save it (Layer 3).

- **summarize_experiments** (experiments are Tasks of task_type experiment). Aggregate: total count, by status (done / in progress / overdue / upcoming), by project, by owner, a date histogram (per week or month), the count finishing this week, and the top N by recency with deep links. Sources: fetchAllTasksIncludingShared, filtered.
- **summarize_notes**. Aggregate: count, by project, by owner, a date histogram, total words / images as a rough effort signal, and the top N recent notes with deep links and their first heading. (Key-result extraction is a later enhancement, v1 stays structural to avoid the model inventing findings.)
- **summarize_projects**. Aggregate: per project, the task counts by status, the percent complete, the next milestone / due date, and a "blocked / overdue" flag. Sources: projectsApi.list + the task rollup.
- **summarize_purchases**. Aggregate: count, total spend, spend by vendor, by category, by month, the largest line items, and pending vs received. Sources: purchasesApi.listAll(IncludingShared). The deterministic totals here matter most, never let the model add money.
- **summarize_inventory**. Aggregate: item count, what is low (below reorder), what is expiring soon, recently consumed stock movements. Sources: inventoryItemsApi + inventoryStocksApi (fetchAll*IncludingShared).
- **lab_digest** (cross-type rollup). Calls the above over a window and assembles a single "what happened" digest: experiments run + finished, results stored, notes written, purchases made, what is scheduled next. The weekly-review artifact.

### Layer 3, summaries as artifacts, not just chat text
A good summary is a deliverable, not a chat bubble. After a summary tool returns, BeakerBot can:
- render it as a structured report inline (a timeline, a small chart via the Data Hub plot path, a sortable table), reusing the markdown-embed system,
- offer "save this as a note" (write_note with the rendered report + the live embeds), so it becomes a dated lab record,
- offer a PDF export (the existing note-to-PDF / bake-embeds path),
- include DRILL-DOWN chips, every count and every listed item is a clickable ObjectChip to the underlying object, so the summary is navigable, not a dead end.

## The filter wizard (the UX Grant asked for)

Typing a complex filter in prose is error-prone ("Kritika's overdue cyp51A experiments since April"), and the model can mis-parse it. So when a summary request is ambiguous or broad, BeakerBot offers a GUIDED filter picker instead of guessing. This extends the existing ask_user button pattern into a small multi-field wizard:
1. What do you want to summarize? (experiments / notes / projects / purchases / inventory / everything) -> picks the tool(s).
2. Over what dates? (this week / this month / this quarter / a custom range) -> since/until.
3. Whose? (me / a member / the whole lab) -> owners, from usersApi.list.
4. Which project(s)? (a multi-select of real project names) -> projects.
5. Any status or keyword filter? (optional).
Each step is real buttons populated from the user's actual projects/members, so they pick real values, never free-text that the model re-parses. The wizard resolves to a Layer-1 filter and fires the Layer-2 tool. BeakerBot only invokes the wizard when the request is underspecified; a precise request ("summarize my purchases this month") runs directly.

Open UX question for the mockup: is the wizard a sequence of ask_user button prompts in the chat (cheapest, reuses the choice card), or a single compact multi-field panel (nicer, more to build). Recommend starting with the chat-button sequence, it ships fast and stays in the conversation.

## What BeakerBot must NOT do

- Never count, total, or tally itself. The tool returns the numbers.
- Never summarize an owner's PRIVATE data the current user cannot see. The owners filter must respect the existing ACL / shared-with permission checks (deriveSourcePermission etc.), exactly as fetchAll*IncludingShared already does. A PI summarizing the lab sees only what is shared with them.
- Never fabricate a finding or a result in a note summary. v1 reports structure (counts, dates, titles), not invented conclusions.

## Build phasing

1. **Layer 1 filterArtifacts** + tests (pure, no UI). Foundation, shared with the index work.
2. **summarize_experiments** end to end (the most-wanted type) + summarize_purchases (the cleanest deterministic-total case). Prove the pattern + the safety rule.
3. **The filter wizard** (chat-button sequence) so broad requests are guided.
4. **Remaining tools** (notes, projects, inventory) + **lab_digest**.
5. **Summary-as-artifact** (render + save-as-note + drill-down chips), then PDF export.

## Open questions for Grant

- Wizard as a chat-button sequence (recommended, fast) vs a single multi-field panel.
- For the cross-lab case, confirm the ACL rule (a PI sees only shared work, never a member's private notes) is the intended boundary.
- Should lab_digest be offerable as a SCHEDULED recurring artifact (a Monday "week in review" note) later, tying into the standing-roles / scheduled-task work.
- v1 keeps note summaries structural (no model-extracted findings). Confirm, or do we want a later, clearly-labeled "BeakerBot's read of the results" section that is explicitly the model's interpretation, not stored fact.
