# Chrome verify — BeakerBot analysis picker + scroll + popup fixes (2026-06-15)

Hand to Claude-in-Chrome on Grant's authed `http://localhost:3000` (signed in, real folder, real model). Verifies the three BeakerAI-lane fixes shipped this session.

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

## Report
For each step: pass/fail, the on-screen result, and any console error. If step 1 offers something it then refuses, capture the table type + the offered option (that's an engine-parity miss).
