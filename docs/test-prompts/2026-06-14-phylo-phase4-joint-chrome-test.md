# Joint Chrome test — Phylo Phase 4 Smart Data Binding (both front doors)

**Run on:** Grant's authenticated dev server (`http://localhost:3000`, signed in, real folder). The AI proxy 401s on an unauthenticated demo/worktree, so the chat door needs an authed session.
**Flags:** phylo + Data Hub + BeakerBot must be enabled (the default on Grant's main dev).
**What we're proving:** ONE deterministic engine (`smart-binding.ts`), TWO front doors — the `/phylo` GUI wizard AND BeakerBot's inline `suggest_tree_overlays` — detect the same joinable table, rank it identically, and add the same overlays.

Paste everything below into Claude-in-Chrome.

---

You are testing a feature called "Smart Data Binding" on a local ResearchOS dev server at http://localhost:3000 (already signed in). Work in ONE folder/session. Go step by step and REPORT what you see at each checkpoint (especially exact numbers and any console error). Do not skip the success checks.

### Data to seed

**Tree (Newick, 8 tips A–H):**
```
((A:0.1,B:0.1):0.15,((C:0.1,D:0.1):0.1,((E:0.1,F:0.1):0.1,(G:0.1,H:0.1):0.1):0.1):0.1);
```

**Data Hub table — name it `resistance_assay`, 3 columns, 8 rows.** The first column carries the tip names; one row (`Zleftover`) intentionally matches no tip so coverage is partial:

| strain_id | MIC | phenotype |
|-----------|-----|-----------|
| A | 2   | R |
| B | 8   | R |
| C | 1   | S |
| D | 16  | R |
| E | 4   | S |
| F | 0.5 | S |
| G | 32  | R |
| Zleftover | 9 | R |

(7 of the 8 tips join — H has no row — so the wizard should say **"joins 7 of 8 tips"**.)

### Step 1 — Create a project to hold both objects
1. Make (or pick) a project, e.g. "Phase4 Test". Both the tree and the table must live in THIS project (the chat door scopes to the tree's project).

### Step 2 — Seed the Data Hub table FIRST (use the FAST paste-import, NOT cell-by-cell)
2. Open Data Hub. Click the **"Import data"** entry point (rail toolbar icon, or the empty-state "Import data" button) to open the Import dialog. Do NOT create a blank table and type cells — that is slow and unnecessary.
3. In the import dialog, use the **"Paste from Excel / Google Sheets"** textarea and paste this TAB-separated block exactly (it is already tab-delimited):
```
strain_id	MIC	phenotype
A	2	R
B	8	R
C	1	S
D	16	R
E	4	S
F	0.5	S
G	32	R
Zleftover	9	R
```
4. The live preview should detect the header row, `MIC` as a number column, `phenotype` as text. Name the table `resistance_assay` and set its collection to "Phase4 Test", then create it. (The join works regardless of which column is the x/label role — the engine finds whichever column matches the tip names.)
5. CHECKPOINT: the table shows 8 rows, `MIC` reads as numbers, `phenotype` as text.

### Step 3 — Seed and save the tree
6. Go to `/phylo`. New tree → paste the Newick above → save it (name it "Phase4 Tree") and put it in the "Phase4 Test" project.
7. CHECKPOINT: the tree renders with 8 tips A–H.

### Step 4 — GUI DOOR (the /phylo wizard)
8. With "Phase4 Tree" open, open the **Layers** tab in the right rail.
9. CHECKPOINT (the auto-suggest banner): you should see a banner **"1 table can overlay this tree"**. (If you instead see a plain "Find data for this tree" button, the table didn't load — reload `/phylo` once so the table list refreshes, then reopen the tree.)
10. Click the banner → the **Find data for this tree** wizard opens.
    - Step 1 "Pick a table": a card **resistance_assay** with a chip **"joins 7 of 8 tips"** and a coverage bar. Click it → Next.
    - Step 2 "Columns": `MIC` tagged **numeric** (geoms: bars · heatmap · dots · point), `phenotype` tagged **category** (geom: color strip). The join column `strain_id` shows as the locked anchor. Leave both checked → Next.
    - Step 3 "Overlays": pick **MIC → Bars** and **phenotype → Color strip** (the recommended ones are pre-checked) → click **Add 2 overlays**.
11. CHECKPOINT (GUI result): the wizard shows "Added 2 overlays". Close it. The tree now shows a **bar track** (MIC) and a **color strip** (phenotype) aligned to the tips, and the **Layers list has 2 new overlay rows** (a bars layer + a strip layer). Tip H (no data) is blank in both. Report whether the overlays rendered.

### Step 5 — CHAT DOOR (BeakerBot inline wizard)
12. Keep "Phase4 Tree" open in `/phylo` (so BeakerBot knows which tree is "this tree" — it resolves via the context bridge). Open BeakerBot (the Ask/Cmd-J chat).
13. Type this EXACT prompt (it maps to the `suggest_tree_overlays` tool's registered examples): **What data can I overlay on this tree?**
    - If for any reason the model doesn't call the tool, retry with a fallback: **Add my data to this tree** or **What can I annotate this tree with?** — all three map to the tool.
14. CHECKPOINT (chat narration): BeakerBot should name **resistance_assay**, say it **joins 7 of 8 tips**, and that **MIC offers bars / heatmap / dots / point** (numeric, recommended bars-first) and **phenotype offers a color strip** (categorical) — these numbers must MATCH the GUI door exactly (same engine). Don't fail it if the narration leads with "bars" rather than "heatmap" — the column offers all four numeric geoms; the wizard is where you pick which one. Then the **same wizard widget renders inline below the reply**.
15. In the inline wizard: pick the table → columns → this time pick **MIC → Heatmap** (a DIFFERENT geom than the GUI door used, to show the same column drives multiple geoms) → **Add**.
16. CHECKPOINT (chat result): BeakerBot ends with a tree link/card; clicking it opens `/phylo` for "Phase4 Tree" with the heatmap overlay now ALSO present. Report whether the inline widget worked and the overlay persisted.

### What to report back
- The exact banner text and the join chip number (expect "1 table…" and "joins 7 of 8 tips") in BOTH doors.
- Whether overlays rendered on the tree (GUI) and whether the chat door's add persisted on reopening.
- Any console errors at any step (open devtools console and watch).
- Anything that looked off, mismatched between the two doors, or confusing.
