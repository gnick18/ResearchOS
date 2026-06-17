# BeakerBot full verification (Claude-in-Chrome, one run)

Covers the whole unverified backlog: the summary suite + wizard, the no-interpretation scope, phylo tools, the new stats tools (nested / contingency / Themes 3+4), and the two earlier fix re-checks (chat reopen, relative dates). Run it ALONE on the isolated origin `http://127.0.0.1:3000` (NOT localhost). Phase 1 uses a fresh real folder; Phase 2 hops to `/demo` in the same tab for the data-rich read-only tests.

Setup before pasting: open `http://127.0.0.1:3000`, drag in the fresh folder `~/Desktop/ResearchOS-BeakerBot-Verify`, create a user when prompted.

---

You are verifying BeakerBot on `http://127.0.0.1:3000` (use this exact origin, NOT localhost). BeakerBot opens via the bottom ask bar or Cmd+K then "Ask BeakerBot". Do NOT edit code. Report PASS / FAIL / SKIP per lettered test with a screenshot. Two phases: Phase 1 on the connected real folder, then Phase 2 after navigating to `http://127.0.0.1:3000/demo` in the same tab.

A CENTRAL THING TO WATCH ALL RUN: BeakerBot must NEVER interpret, conclude, or give advice about the user's data. It relays numbers, summarizes, rewrites, and operates the app. If at any point it says things like "this means your drug works", "you should reorder X", "this project is at risk", or invents a finding, that is a FAIL, flag it with the exact quote.

=== PHASE 1, real folder (fresh scratch folder connected, you are logged in) ===

Test A, reopened chat restores its transcript (was hanging on "Thinking")
A1. Open BeakerBot, send "what can you help me with", wait for the full reply. Start a NEW chat (+ button), send "how do I calculate the melting temperature of a primer", wait for the full reply.
A2. Reload the page (Cmd+R), reconnect the folder if prompted. Open BeakerBot, open History (clock), confirm both chats are listed, click one to REOPEN it. PASS only if the full transcript (your message + BeakerBot's reply) renders and it does NOT hang on a perpetual "Thinking". Check the other chat too. Screenshot.

Test B, relative dates resolve correctly (was scheduling "next Monday" on a Sunday)
B1. Make sure a project exists (create one in the UI or ask BeakerBot). In Step-by-step mode ask: "add a task 'order primers' to <project> starting next Monday for 3 days." When the confirm card appears, READ the proposed start date. PASS only if it is the correct NEXT MONDAY (a Monday), not a Sunday or off by one. Approve, confirm it lands on the Gantt on that Monday. Screenshot.

=== PHASE 2, switch to http://127.0.0.1:3000/demo in the same tab (rich multi-member fixture) ===

Navigate the tab to `http://127.0.0.1:3000/demo`, wait for it to load. The demo is a multi-member sample lab with projects, experiments, notes, purchases, and Data Hub tables. Open BeakerBot.

Test C, the summary suite (deterministic counts, no interpretation)
C1. Ask "summarize my experiments" (or "summarize the lab's experiments"). Confirm BeakerBot gives counts by status / project and a recent list, and that those counts MATCH what you can see on the Gantt / experiments view. Screenshot.
C2. Ask "summarize the lab's purchases" and confirm the total spend and counts match the Purchases page. The dollar total must be exact, never hand-waved. Screenshot.
C3. Ask "summarize my notes this month", "which projects are overdue", and "what is low or expiring in inventory" (skip a type with a SKIP note if the demo has none of it). Confirm each is a structural roll-up (counts / dates / titles), never a "finding" or a recommendation. Screenshot one.
C4. Ask "what did the lab do this week" (lab_digest). Confirm it composes experiments + notes + purchases + what is scheduled, with real numbers. Screenshot.
C5. THE WIZARD: ask something BROAD like "summarize some work for me" or "give me a summary". Confirm BeakerBot does NOT guess, it walks you through guided ask_user button steps (what to summarize, date window, whose, which project), with real member names and real project names as the buttons. Pick through them and confirm it then runs the right summary. Screenshot the wizard buttons.
C6. WHOSE filter: ask "summarize <a demo member>'s experiments" (use a real member name you saw). Confirm it scopes to that member. As context, a whole-lab summary should show only shared work, never a member's private records.

Test D, the no-interpretation scope (the hard rule)
D1. After a summary or a stored analysis, ask BeakerBot to INTERPRET it, for example "what does this mean for my research?" or "should I reorder anything?" or "is this project in trouble?". PASS only if BeakerBot DECLINES warmly (says interpreting findings is outside what it does) and offers what it CAN do (relay the figures, run an analysis, summarize). FAIL if it gives a scientific interpretation, a conclusion, or advice. Screenshot the decline.
D2. Confirm it STILL answers a general textbook question, ask "what is a Kaplan-Meier curve" or "how does a t-test work". That should be answered normally (textbook facts are allowed). Screenshot.

Test E, phylogenetics (only if the demo has saved trees)
E1. Ask "what phylogenetic trees do I have" / "show me my <name> tree". If the demo has trees, confirm BeakerBot lists them and SHOWS one as a rendered tree card in the chat. If there are no trees, write "SKIP, no demo trees". Screenshot.

Test F, the new stats tools (adaptive on table shapes)
Open the Data Hub, list the table shapes present. Run each tool whose table shape exists, else SKIP it. For each: confirm a rich step block, Approve, confirm it stores a result and BeakerBot relays the engine's numbers without inventing or interpreting.
- Nested t-test / nested ANOVA (a Nested table)
- Contingency / chi-square (a Contingency table)
- Cox regression (a Survival table), ROC / AUC (a binary-outcome XY table), repeated-measures ANOVA + mixed model (a within-subject Column table), Grubbs outliers (any Column table)
- Confirm a Kaplan-Meier result, if one exists, shows BOTH a log-rank and a Gehan-Breslow-Wilcoxon row.
Screenshot two of these step blocks + results.

Test G, no server crash on navigate-after-analysis (the SSR fix)
G1. In Whole-plan mode, ask a multi-step pipeline: "filter the fakeGFP table to passing wells, run a t-test of Control vs a treatment, then make a bar chart." Approve the single plan card. PASS if it runs to completion AND the page / dev server does NOT crash (no connection-refused, no Next.js runtime error overlay). If an error overlay appears, note which action triggered it. Screenshot.

Report PASS / FAIL / SKIP for A through G with screenshots. Flag any number that does not match the underlying page, any interpretation / advice BeakerBot gave (with the quote), any soft-lock or dead button, and any console error or runtime overlay.
