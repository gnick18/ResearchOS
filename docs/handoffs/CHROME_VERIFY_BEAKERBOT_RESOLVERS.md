# BeakerBot summary-robustness + deterministic resolvers — live verification (Claude in Chrome)

Verify the session-7 BeakerBot tools end to end on **http://localhost:3000**. The math
and routing logic are already proven by 182 passing unit tests; this live pass confirms
that a real model actually **routes** the user's natural language onto the new
deterministic tools (instead of refusing or eyeballing records), and that the tools'
confirm-first / never-stall / never-interpret guardrails fire in the browser.

Source of truth for what shipped:
`docs/orchestrator-handoffs/2026-06-14-beakerbot-summary-robustness-resolvers.md`.

## Setup
1. Open **http://localhost:3000/demo** — this unlocks the data-folder gate with seeded
   lab data (notes, experiments, methods, projects, purchases, members) so the
   resolvers have real records to work on. Wait for the workbench to finish loading.
2. Open **BeakerBot** (the chat palette). Start a fresh conversation for each numbered
   check so one turn's context doesn't leak into the next.
3. These checks assert on **behavior and tool routing**, not on specific seeded values —
   so they pass regardless of exactly what the demo folder contains. Where a check says
   "an integer" or "a real window", read the rendered answer / tool chip, not a fixed
   number.

> If a tool chip / "thinking" panel is visible, confirm the **named tool** fired. If the
> UI hides tool names, judge by behavior (the asserted shape of the answer).

---

## Check 1 — Never-stall: the original refusal is gone (regression)
This is the exact prompt that triggered the refusal that started this whole session.

**Prompt:** `Summarize all my experiments over the last month and write this up as a new note.`

**EXPECT:**
- BeakerBot does **NOT** refuse and does **NOT** stall asking permission to save.
- It runs a summary scoped to the last calendar month (`summarize_experiments` with a
  period window) and then saves a note (`save_summary_as_note`) — or asks at most ONE
  crisp clarifying question, then proceeds.
- The reply relays **structure** (counts / dates / titles), never an interpretation,
  finding, or conclusion about the experiments.
- A new note actually appears in Notes.

**FAIL if:** it refuses, says it "can't interpret your data," or loops asking whether to
save without ever saving.

---

## Check 2 — Deterministic period window (calendar semantics)
**Prompt:** `How many notes did I write last month?`

**EXPECT:**
- Answer is a single **integer** count over a real calendar window (e.g. if today is
  June, "last month" = all of May, not a rolling 30 days).
- `summarize_notes` fires with a resolved `period` window; the model does not enumerate
  notes and count them in prose.

**Also try:** `…and this quarter?` — EXPECT a different, sensible integer for the quarter
window. The two counts should differ if the data spans both.

---

## Check 3 — Project resolution by NAME (+ fuzzy)
Pick a real project name visible in the demo's Projects list. Then **mistype it
slightly** (drop or swap one or two letters).

**Prompt:** `Summarize my experiments in the "<slightly-misspelled project name>" project.`

**EXPECT:**
- BeakerBot resolves the typo to the correct project (fuzzy matcher) and summarizes that
  project's experiments — it does **not** ask you for a project id, and does **not**
  fall back to summarizing the whole lab.
- If the typo is too far from any real name, it asks which project you meant (the wizard)
  rather than guessing wildly or widening to everything.

---

## Check 4 — Owner/member resolution by NAME (no silent widening)
Pick a real lab member name from the demo roster.

**Prompt:** `Summarize <member name>'s purchases this year.`

**EXPECT:**
- Scoped to that member (`summarize_purchases` with `owners` resolved from the name) over
  the year window. Money totals come from the tool, not model arithmetic.

**Now the guardrail:** `Summarize Zxqv's purchases.` (a name matching nobody)

**EXPECT:** it tells you no such member resolved / asks who you meant. It must **NOT**
silently widen to the whole lab. (Per the never-widen rule.)

---

## Check 5 — `search_full_text`: deep BODY search, confirm-first, real counts
The normal search only matches titles/headings/tags. This is the deep body scan.

**Prompt:** `How many of my notes mention <pick a word likely inside a note body, not a title>?`

**EXPECT (two-step):**
1. **Confirm-first:** BeakerBot asks you to confirm the exact term before scanning
   (`ask_user`), because a body scan is broad and the exact string matters. Confirm it.
2. It runs `search_full_text` and returns an **accurate integer total** of matches plus
   the matching records with **short snippets** — it relays the records' own snippets and
   never summarizes or interprets what they say.

**Also try:** `Which of my protocols talk about the miniprep?` (or another method-body
term) — EXPECT it scans method **bodies** (read from disk) too, not just notes.

**FAIL if:** it scans silently without confirming the term, or it answers from titles
only / makes up a count.

---

## Check 6 — `list_records`: deterministic top-N / sorted lists
**Prompt:** `What are my 5 most recent experiments?`

**EXPECT:** exactly up to 5 items, **newest first**, via `list_records`
(sortBy=date, order=desc, limit=5). The model does not eyeball records to rank them.

**Also try:**
- `List my notes A to Z.` → title ascending order.
- `What are my oldest open tasks?` → oldest first, status-filtered.

**EXPECT** each returns a correctly ordered, correctly capped list and states the scope
it used.

---

## Check 7 — Degrade, don't refuse (one impossible dimension)
Combine a doable filter with one that can't be honored.

**Prompt:** `Summarize my experiments from the "<real project>" project that are tagged with a color.`
(experiments have no color tag)

**EXPECT:** it runs the closest doable summary (the real project) and **says what it
scoped to / what it couldn't honor** — it does not refuse the whole request because one
dimension was impossible.

---

## What "pass" looks like
- No refusals on doable summaries (Checks 1, 7).
- Counts/dates/totals are real integers/windows owned by the tool, never prose-counted
  (Checks 2, 5, 6).
- Names (project + member) resolve, typos forgiven, but unknown names never silently
  widen scope (Checks 3, 4).
- Body search confirms the term first and returns accurate snippets+counts (Check 5).
- Every answer relays structure/snippets only — zero interpretation or findings
  (all checks; this is the hard no-interpretation scope).

## If something fails
Note the check #, the exact prompt, what BeakerBot did, and which tool chip (if any)
fired. The likely suspects by symptom:
- refuses a doable summary → `system-prompt.ts` never-stall rule
- wrong/rolling date window → `periodToDateRange` wiring in the summarize tool
- asks for an id / widens to whole lab → `resolveProjectRefsToIds` /
  `resolveOwnerRefsToUsernames` / `fuzzyResolve`
- scans without confirming, or count is wrong → `search-full-text.ts` / `deep-text.ts`
- list mis-ordered or over the limit → `list-records.ts` / `listArtifacts`
