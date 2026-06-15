# BeakerBot record-set widget — live verification (Claude in Chrome)

Verify the new inline searchable master-detail record-set browser on
**http://localhost:3000**. The data plumbing is proven by unit tests (full AI suite
1484 green); this pass confirms the widget RENDERS under the reply, that the preview
pane and filters work, and that it stays usable in the narrow BeakerBot panel.

What shipped: when a record-returning tool runs (list_records, search_full_text,
summarize_experiments/notes/purchases), BeakerBot renders a widget below its answer
with a left rail (search + type-filter chips + scrollable list of EVERY match) and a
right preview pane (click a row to preview it in place, no popup). "Open full" opens
the real object. Deterministic: the widget appears because the tool ran.

## Setup
1. Open **http://localhost:3000/demo** (seeded demo lab). Wait for the workbench.
2. Open **BeakerBot**. Fresh conversation per check.

---

## Check 1 — Widget appears on a list query
**Prompt:** `List my 10 most recent experiments.`
**EXPECT:** below the reply, a bordered widget (`data-testid="record-set-widget"`) with
a header ("... N matches"), a left rail listing the experiments, and a right pane
previewing the first one. The narrated answer is still there above it.

## Check 2 — Click-to-preview, no popup
In that widget, click a few different rows in the left rail.
**EXPECT:** the right pane swaps to each selected record's PREVIEW in place (a rich
card for the type, e.g. an experiment/task preview), the selected row highlights, and
NO popup/navigation happens. You can click around fast.

## Check 3 — Search + type filter
**Prompt:** `List all my records.` (mixed types)
**EXPECT:** type-filter chips appear (Notes, Experiments, Methods, ... with counts).
- Click a chip → list narrows to that type; click again → un-narrows.
- Type in "Search matches" → list filters by title/snippet live; clearing restores it.
- A search with no hits shows "No matches for this search".

## Check 4 — search_full_text widget with snippets + counts
**Prompt:** `How many of my notes mention triplicate?` then confirm the term.
**EXPECT:** the widget lists EVERY matching note (not just a capped 25), each row
showing a snippet and an "N matches" meta. Selecting a row previews the note. The
narrated count still matches.

## Check 5 — "Open full" really opens it
Select any row, click **Open full**.
**EXPECT:** the real object opens the normal way (a popup for tasks/experiments, a
soft navigation otherwise) — same behavior as an embed Open button. For a purchase
row it navigates to /purchases.

## Check 6 — Narrow panel collapse
Make the BeakerBot panel narrow (drag it in, or test on a small width).
**EXPECT:** the widget collapses to a single column — the list shows first; selecting
a row replaces it with the preview plus a "Back to list" control. Still fully usable.

## Check 7 — Font split (the earlier fix, same surface)
Glance at the conversation.
**EXPECT:** your composer text and your sent bubbles read in the app font (Geist);
Beaker's replies, and this widget's chrome, read in Beaker's signature font (Hanken).

## v2 checks (Option-D compact layout, >=2 rule, new tools)

## Check 8 — compact layout for a small set (2 to 4)
**Prompt:** `List my 3 most recent experiments.`
**EXPECT:** a compact widget (`data-layout="compact"`): a row of selectable chip
TABS across the top (one per result) + ONE shared preview pane below. Clicking a tab
swaps the preview. No search box, no left rail (that is the 5+ layout). This is the
"Option D" mini master-detail.

## Check 9 — lone result stays a chip (the floor)
**Prompt:** `What is my single most recent note?` (or any query that returns 1)
**EXPECT:** NO widget. A single inline chip in the reply. The widget only appears at
2 or more.

## Check 10 — the layout switches at 5
Ask for 4, then 5, of the same type.
**EXPECT:** 4 → compact (chip tabs); 5 → full (search box + type rail). One mental
model, two sizes.

## Check 11 — the newly wired tools
- `Summarize my projects.` → widget of PROJECT rows (preview = project card).
- `What inventory is low or expiring?` → widget of INVENTORY rows (fallback card,
  Open-full goes to /inventory).
- `Give me a lab digest for this month.` → ONE widget mixing types (Notes /
  Experiments / Purchases chips filter it).
- `Search my work for cyp51A.` → widget of mixed-type search hits.
EXPECT each renders the widget (compact or full by count) and previews correctly.

## Check 12 — Beaker does not also prose-list the set
On any of the above, EXPECT the reply gives a COUNT + one-line headline and lets the
widget show the items. It should NOT also paste the list of names in prose.

## What "pass" looks like
Widget renders on every record-returning tool, previews swap in place without popups,
search + type chips filter correctly, full-text shows all matches with snippets/counts,
Open-full works, narrow mode collapses cleanly. Report any check # + what happened.

## Suspects by symptom
- widget never appears → onToolResult wiring / `_ui` not attached by that tool
- preview blank/errors → descriptorForRow / ObjectEmbed dispatch for that type
- counts wrong / capped at 25 → search-full-text uiHits, or RECORD_SET_UI_CAP
- Open-full does nothing → openRowFull / openObjectRef / requestNavigation
- doesn't collapse → ResizeObserver / NARROW_PX in RecordSetWidget.tsx
