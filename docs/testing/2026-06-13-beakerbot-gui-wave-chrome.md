# Chrome verification: BeakerBot GUI-wave (2026-06-13)

Human-in-the-browser test for the four tools landed 2026-06-13: per-user memory,
setup_experiment, save_summary_as_note, and the paper-reproduce draft tools.
Run via the Claude-in-Chrome extension. One scratch folder, batched, ordered so
the setup_experiment step seeds the data the summary step then summarizes.

## Preconditions (Grant does these once, before handing to the agent)

1. Dev server running at `http://127.0.0.1:3000` (isolated origin, not a shared tab).
2. A FRESH empty scratch folder connected via the native picker (the agent cannot
   drive the OS folder dialog). Suggested: `~/Desktop/ResearchOS-GUIWave-Verify`.
3. Signed in as a new user. On first sign-in the app provisions a sharing identity
   and shows a ONE-TIME recovery code. CAPTURE IT before continuing or the account
   can lock out mid-test.
4. BeakerBot must be functional in this environment (the AI proxy reachable and
   credits/billing available, since AI is gated in beta). If BeakerBot will not
   answer at all, stop and tell Grant; that is an environment gap, not a bug in
   these tools.

---

## The prompt to paste into Claude-in-Chrome

You are testing BeakerBot, the in-app AI assistant in ResearchOS, a local-first
research app open at http://127.0.0.1:3000 in this browser. A fresh data folder is
already connected and a user is signed in. Do NOT open the OS file picker, switch
folders, or use demo mode; everything you need is in the app.

Opening BeakerBot: click the floating BeakerBot button (a sky-blue mascot, usually
bottom-right), or press Cmd+K to open the search palette, type a question, and pick
the top "Ask BeakerBot about ..." row. The palette grows into a chat. To start a
clean conversation, use the "New chat" control in the chat header. When BeakerBot
proposes a write, it shows an approval card with Allow/Skip (or Approve/Reject);
click Allow to let the step run, unless a step says otherwise below.

Run these four tests in order and keep a running PASS/FAIL note for each numbered
check. After a BeakerBot reply, wait until it finishes typing before acting.

TEST 1 - Per-user memory
1a. Open BeakerBot. Send: "Remember that I default to Phusion polymerase for all my
    PCRs." Approve if it shows a card. PASS if BeakerBot confirms it saved the
    preference.
1b. Start a NEW chat (so there is no carryover in the conversation itself). Send:
    "I'm setting up a new PCR. Which polymerase should I use?" PASS if it answers
    with Phusion specifically, citing it as your default (this proves the saved
    preference was injected into a brand-new chat, not remembered from the live
    transcript).
1c. In a new chat send: "Actually, forget that I default to Phusion." Approve if
    carded. Then start ANOTHER new chat and ask the 1b question again. PASS if it no
    longer assumes Phusion (it should ask or stay generic).

TEST 2 - setup_experiment (this also creates data for Test 3)
2a. Open BeakerBot. Send: "Set up a qPCR experiment called 'Cyp51A expression'
    starting next Monday, lasting 3 days. Add prep tasks 'order primers' and 'make
    qPCR plate', and I want results tracking." 
2b. PASS if a SINGLE approval card appears that lists every step it will do (create
    the experiment, the two prep tasks, link them, scaffold results) as a numbered
    preview, rather than several separate cards. Click Allow.
2c. PASS if, after approval, the app navigates to the GANTT/schedule and briefly
    highlights the new bars, and you can see the "Cyp51A expression" experiment with
    the two prep tasks linked to it (a finish-to-start arrow/line to the experiment).
2d. Open the "Cyp51A expression" experiment and check its Results tab. PASS if the
    results area already has a header (it should not be blank).

TEST 3 - save_summary_as_note (uses the experiment from Test 2)
3a. Open BeakerBot. Send: "Summarize my experiments." PASS if it returns a summary
    that counts your experiment(s) (it should reflect the one you just created).
3b. Send: "Save that summary as a note." Approve the draft-preview card.
3c. Open the created note. PASS if the note contains: a timeline/table section, a
    breakdown, and clickable drill-down chips/links to the experiment. CRITICAL: the
    counts in the note must MATCH the summary exactly (no invented or different
    numbers). FAIL if any number in the note disagrees with what 3a reported.

TEST 4 - Paper-reproduce draft tools (text pasted in chat; there is no PDF upload
yet, that UI is intentionally not built)
4a. Open BeakerBot. Paste this as one message:
    "Here is a paper's text. Draft a faithful summary of it as a note.
    ---
    Title: A GTR+G maximum-likelihood phylogeny of fungal cyp51A.
    Methods: Sequences were aligned with MAFFT v7.490 (L-INS-i). Ambiguous columns
    were trimmed with trimAl (gappyout). A maximum-likelihood tree was built in
    IQ-TREE 2.2.0 under the GTR+G model with 1000 ultrafast bootstrap replicates and
    rooted at the midpoint.
    Results: The 48-taxon tree recovered three well-supported cyp51A clades."
4b. Approve the draft card. PASS if the note is a faithful summary that states only
    what the text says (study, methods, result) with NO added interpretation,
    judgment, or recommendation (e.g. it must NOT say the approach is rigorous, or
    suggest a different tool). FAIL if it editorializes or invents content.
4c. New chat. Paste the same text and send: "Extract the methods section into my
    method catalog, verbatim." Approve. PASS if the drafted method preserves the
    exact tool names, versions, and numbers (MAFFT v7.490, trimAl gappyout, IQ-TREE
    2.2.0, GTR+G, 1000 bootstraps) word-for-word, and shows the source passage. FAIL
    if any value is paraphrased or changed.

When done, report a table of each check (1a..4c) with PASS/FAIL and a one-line note,
plus any console errors, blank pages, or cards that behaved oddly. If BeakerBot ever
produces an interpretation or a scientific conclusion about the user's data anywhere
(it should only summarize, transcribe, and operate), flag it prominently.

---

## What each test proves

- Test 1: memory file round-trip + the per-turn injection (1b is the real proof,
  it must apply in a fresh chat) + forget.
- Test 2: the composite write as ONE consent, the FS links on the GANTT, the results
  scaffold, and the navigate-and-highlight.
- Test 3: the summary-to-note artifact composes correctly AND the verbatim-number
  rule holds (the model never re-counts).
- Test 4: the no-interpretation scope on the highest-hallucination-risk flow, and
  verbatim method extraction.

## Known-not-built (do not file as bugs)

- No PDF upload UI yet; Test 4 pastes text on purpose.
- Paper-reproduce outputs 3 (pipeline recipe) and 4 (figure style) are not in this
  wave (gated on phylo review and a vision model).
