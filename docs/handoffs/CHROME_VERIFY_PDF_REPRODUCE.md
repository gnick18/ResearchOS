# BeakerBot reproduce-from-PDF — live verification (Claude in Chrome)

Verify the full **reproduce a published analysis from a PDF** flow end to end on
**http://localhost:3000**. The whole feature (ingestion + all 4 outputs) is already
built and unit-green (`pdf-extract.test.ts`, `phylo-tools-figure-output4.test.ts` 20/20,
`generate-tree-fixtures.test.ts`). This live pass confirms a **real model** actually:
routes an attached paper onto the right draft tools, keeps every output a gated draft,
and holds the **transcriber-not-analyst** scope (no interpretation, judgment, or
conclusions) — the single highest hallucination-risk surface BeakerBot has.

Source of truth for what shipped:
`docs/proposals/beakerbot-pdf-reproduce-analysis.md` + commits `0f2c946ee`→`b4a624d10`.

## Setup
1. Open **http://localhost:3000/demo** (seeded lab data so writes land in a real folder),
   OR your own connected folder. Wait for the workbench to load.
2. Have ready:
   - **A real paper PDF** — ideally a phylogenetics methods paper (so Outputs 3 & 4 have
     something real to chew on). Any paper works for Outputs 1 & 2.
   - **A figure image** for Output 4: a screenshot/crop of ONE tree figure from that paper,
     saved as a PNG/JPG (Output 4 is vision-driven and takes the figure as an *attached
     image*, NOT auto-extracted from the PDF — see note at the bottom).
   - For Output 3: at least a couple of **sequences** in your library (or be ready to paste
     Newick) and, for Output 4, **a saved tree** (or paste Newick).
3. Open **BeakerBot**. Start a fresh conversation per numbered check so context doesn't leak.

> Confirm the named tool fired via the tool chip / thinking panel where visible; otherwise
> judge by the asserted behavior/shape of the answer.

---

## Check 0 — Ingestion: attach a PDF, text extracts
Click the **attach** button on the composer (paperclip/file glyph, always visible) and pick
your paper PDF. (Also try **drag-and-drop** the PDF onto the chat.)

**EXPECT:**
- An "Extracting…" chip, then a ready chip showing the **file name + page count**.
- No console errors (pdf.js worker loads from `/pdf.worker.min.mjs`).
- Send a message like `what did you get?` — BeakerBot should acknowledge the attached paper
  (the extracted text reaches it as an `[Attached paper: …]` system note).

**FAIL if:** the chip never turns ready, the worker 404s, or the paper text never reaches
the model.

---

## Check 1 — Proactive offer of the drafts
With the paper freshly attached, send: `I attached a paper.` (or just attach + send empty).

**EXPECT:** In ONE short message BeakerBot proactively offers the available drafts:
a faithful **summary → note** (`draft_paper_summary`), the **methods verbatim → catalog**
(`extract_paper_method`), and — *if the paper describes a tree-building pipeline* — the
**runnable recipe** on your own sequences (`generate_tree`). It does not dump all four
unprompted; it proposes and waits.

**FAIL if:** it silently summarizes with no gate, or invents an offer unrelated to the paper.

---

## Check 2 — Output 1: summary → note (gated draft, transcription only)
**Prompt:** `Draft a faithful summary of this paper as a note.`

**EXPECT:**
- `draft_paper_summary` fires and surfaces a **draft card / Canvas draft** for review BEFORE
  writing — nothing is saved until you approve.
- The draft states **only what the paper says** (what was studied, what they did, what they
  report). Spot-check 2–3 sentences against the PDF: no added interpretation, judgment,
  recommendation, or invented content.
- On approve, a new **note** appears in Notes.

**FAIL if:** it writes without a draft gate, or the draft contains a claim/finding/opinion
not in the paper.

---

## Check 3 — Output 2: methods → catalog (verbatim + source passage)
**Prompt:** `Pull this paper's methods into my method catalog.`

**EXPECT:**
- `extract_paper_method` fires, draft-gated.
- Numbers, temperatures, cycle counts, flags, tool names, **versions are quoted VERBATIM**
  (not paraphrased), and the **exact source passage** is shown so you can verify against the
  paper.
- On approve, a new **method** appears in the catalog.

**FAIL if:** any value is paraphrased/rounded, or no source passage accompanies the draft.

---

## Check 4 — Output 3: pipeline → generate_tree recipe
**Prompt:** `Recreate this paper's tree-building pipeline as a recipe on my own sequences.`
(Name a couple of your sequences if it asks.)

**EXPECT:**
- `generate_tree` fires and returns a **runnable recipe** (install steps / conda env /
  commands / run script / markdown) built from the paper's described params mapped onto
  catalog options.
- Where the paper named a tool/model the catalog lacks, it uses the **nearest catalog value
  with a flagged FACTUAL note** (or passes an exact substitution-model string through
  `fixedModel`) — never a hard refusal, never a judgment that one tool is "better."
- It does **not** invent a flag, a tip count, or a tree.

**FAIL if:** it fabricates a tree/values, writes a raw flag the generator didn't own, or
judges the paper's choices.

---

## Check 5 — Output 4: figure → tree style (vision)
Attach your **figure image** (the tree figure crop) via the image-attach button, and supply
your own tree.

**Prompt:** `Match this figure's style on my <saved tree name>.` (or paste Newick)

**EXPECT:**
- BeakerBot **looks at the figure** and calls `match_figure_style` with a style-only spec
  (layout rectangular/circular/slanted/unrooted, phylogram vs cladogram, italic tip labels,
  support values shown, palette, aligned tracks).
- It applies the style to **your** tree and navigates to **Tree Studio** hydrated with it,
  ending with the tree embed `[<name>](/phylo?doc=<id>#ros=studio)`.
- It **never reads topology / tip names / data values off the image**, and never invents a
  tree. If you give no tree, it ASKS for one instead of calling the tool.

**FAIL if:** vision is off (no image understood), it reads the tree itself off the figure,
or it invents tips/branches.

---

## What "pass" looks like
- PDF attaches and extracts cleanly; the paper reaches the model (Check 0).
- BeakerBot proposes the drafts, doesn't auto-write (Check 1).
- Every write (summary, method) is a **gated draft** with a source passage; nothing saves
  before approval (Checks 2, 3).
- Methods values are **verbatim**; the recipe is generator-owned with flagged catalog
  misses (Checks 3, 4).
- Output 4 emits **style only** from the image onto the user's own tree (Check 5).
- Across all checks: **zero interpretation, judgment, ranking, or conclusions** about the
  paper — the hard transcriber-only scope.

## If something fails — likely suspects by symptom
- chip never ready / worker 404 → `pdf-extract.ts` / `public/pdf.worker.min.mjs` /
  `handlePdfFile` in `BeakerBotConversation.tsx`
- no proactive offer / silent write → `system-prompt.ts` lines ~209–211
- write with no draft gate → `action`/`describeAction` on `draftPaperSummaryTool` /
  `extractPaperMethodTool` in `paper-reproduce-tools.ts`
- paraphrased values / no source passage → `extract_paper_method` description + draft body
- recipe fabricates / refuses on catalog miss → `resolveBuilderOptions` /
  `generateTreeTool` in `phylo-tools.ts`
- Output 4 reads the tree off the image / no vision → `matchFigureStyleTool` +
  `NEXT_PUBLIC_BEAKERBOT_VISION` (must be `true`)

## Architecture note worth knowing (not a bug)
PDF extraction is **text-only** (`pdf-extract.ts`, commit `1b7cd7137` "vision-free").
Output 4's figure therefore is **not** auto-pulled from the PDF — the user attaches the tree
figure as a **separate image**. Auto-rendering PDF page regions to images for the vision step
was a deferred nicety in the proposal (§Architecture/Ingestion); v1 takes the figure as an
attached image. If the end-to-end "attach one PDF, get all four" feel is wanted, that
page-region-to-image renderer is the follow-up.
