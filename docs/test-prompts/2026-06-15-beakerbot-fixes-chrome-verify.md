# Chrome verify — BeakerBot analysis picker + scroll + popup fixes (2026-06-15)

Hand to Claude-in-Chrome on Grant's authed `http://localhost:3000` (signed in, real folder, real model). Verifies the BeakerAI-lane fixes.

> Steps 1-3 are on `main`. **Step 4 (picker-driven run stays in chat) is on branch `feat/picker-result-in-chat`** (commit `f9cf44672`, worktree `.claude/worktrees/picker-in-chat`) and is NOT yet merged — check that branch out before running step 4, or run it as a follow-up after the branch lands.

## 1. Analysis picker (suggest_analyses + table-capabilities engine)
- Open the Data Hub and open any table (ideally a Column table with group columns, e.g. a Control vs Drug table).
- Open BeakerBot, send exactly: `What analyses and figures can I make on this table?`
- EXPECT: Beaker narrates the valid options and an **inline picker mounts below the reply with two sections, "Analyses" and "Graphs"**.
- VERIFY the constraint-awareness: it must NOT list anything that then refuses to run. (On an XY table it should NOT offer a t-test; `residualPlot`/`ROC` should appear ONLY if a regression/ROC analysis is already saved on the table.)
- Click one analysis option. EXPECT: Beaker runs it (sends "Run the <test> on <table>") and produces the validated result.

## 2. Chat scroll past inline widgets (43486f702)
- With the picker (or a `suggest_tree_overlays` Smart Data Binding wizard) showing in the chat, put the mouse OVER the widget and scroll.
- EXPECT: the **chat scrolls** (the widget no longer traps the wheel).
- Scroll up to read earlier messages. EXPECT: it does NOT snap you back to the bottom while you are reading.

## 3. Object chips open a popup, not a navigation (0af1e8c83)
- Send: `List my active experiments`.
- When Beaker lists them as links/chips, click one.
- EXPECT: it opens a **popup over the chat** (the BeakerBot chat stays mounted behind it). Closing the popup leaves you exactly where you were.
- It must NOT navigate the page or close the chat.

## 4. Picker-driven run stays in chat (branch `feat/picker-result-in-chat`)
Verifies the locked nuance: a run launched FROM the inline picker keeps its result in chat, while a typed run still navigates.
- Open the Data Hub, open a Column table (e.g. Control vs Drug), open BeakerBot.
- Send: `What analyses and figures can I make on this table?` and wait for the inline picker.
- **Click an analysis option in the picker** (e.g. a t-test).
- EXPECT: Beaker runs it and gives the one-line verdict **IN THE CHAT — the page does NOT navigate to a `/datahub?...&analysis=...` result sheet, and the chat stays exactly where it is.** (The result is still stored on the table; you can open it later from the Data Hub.)
- CONTRAST — now type directly into the composer: `Run a t-test on Control vs Drug`.
- EXPECT: this DOES navigate to the Data Hub result sheet (typed runs are unchanged), **and the BeakerBot panel persists across that navigation** (it morphs/docks, the conversation is intact).
- Also test a picker **graph** option (e.g. "Bar chart") -> stays in chat, no navigation to `&plot=...`.
- Refresh the page after a picker run. EXPECT: the BeakerBot conversation is still there (persisted thread), not wiped.

## Report
For each step: pass/fail, the on-screen result, and any console error. If step 1 offers something it then refuses, capture the table type + the offered option (that's an engine-parity miss). For step 4, note explicitly whether the picker run navigated (it should NOT) and whether the typed run navigated (it should) with the panel surviving.
