# Methods Expansion v2 — Design Questions

**Status:** Open. Awaiting Grant's lock on the load-bearing primitives below before any v2 planning sub-bot fires.

**Why this doc exists:** Per Grant's lock-in (clickable AskUserQuestion answer 2026-05-15), v2 follows the same shape v1 used — design questions get captured here for Grant to react to and lock the load-bearing primitives, THEN the planning sub-bot fires with constraints baked in. Mirrors v1; avoids the "planner produces a framing you'd reject" failure mode.

---

## TL;DR — what this doc asks Grant to decide

Three things, in priority order:

1. **Method composition primitive** — the architectural shift. Lets users build "kits" that bundle multiple method components into one attachable unit (Grant's example: blank 24-well plate + PDF assay instructions = one method). **This is the load-bearing v2 decision** — its shape determines how every later method-type addition behaves.
2. **Coding workflows method type** — for scripts and Jupyter notebooks that get reused across many experiments.
3. **Mass spec parameters method type** — partially redundant with method composition (LC + MS compound is most of the use case). Worth deciding whether MS standalone is in scope or whether composition + LC is sufficient.

Plus a v2 type prioritization question once the composition primitive is locked.

---

## v2 slate — LOCKED 2026-05-15

After the AskUserQuestion round, the v2 slate is firm:

1. **Method composition primitive (foundation chip)** — `method_type: "compound"` + `components` array + `compound_snapshots` field on `TaskMethodAttachment` + recursive renderer + revamped new-method dialog (the biggest UX scope of v2). Stacked vertical render with a navigation TOC. Recursion allowed with cycle detection. Inline-create children allowed (revamped dialog). Per-child snapshot edit is in-place. Child-delete behavior: ask the user at delete time (see Q-A4 below for the prompt spec).
2. **Coding workflows** — embedded code (with optional external file pointer for editor handoff). Read-only Jupyter cell render (no execution). Curated language list (Python / R / bash / SQL / Julia / MATLAB / JavaScript) with icons + syntax highlighting; "Other" as freeform fallback. No per-task instance state (static template). Read-only preview only (no in-page editor; "open in your editor" link).
3. **Mass spec parameters** — full standalone method type. Pairs with LC via the composition primitive for LC-MS, works alone for MALDI / direct infusion / GC-MS. Field shape is planner-territory.
4. **qPCR** — composition primitive makes this cleaner. Likely shape is a "qPCR analysis" method type (Ct values / melt curves / standard curves / fold-change calc) that pairs with the existing PCR method via a compound. Exact shape (analysis-only vs full qPCR-protocol vs PCR extension) is planner-territory.

Total: 1 architectural primitive + 3 new method types. Foundation chip ships first; the 3 type chips parallel after — same shape as v1 with the lessons from §6 of AGENTS.md baked in (assign id ranges per chip up front, build the merge-bot pattern in from the start, explicit-path staging in mid-merge).

**Open for the planner to propose** (NOT for Grant to lock yet — these are within-spec proposals the planner will surface):
- Q-A4 child-delete prompt UX (sketched below; needs Grant confirm)
- Q-C2 mass spec field shape (ionization-mode discriminator, smart-per-mode vs always-show)
- Q-D2 qPCR shape (analysis-only vs full protocol vs PCR extension)

---

## Section A — Method composition primitive (LOAD-BEARING)

### The use case

Grant's framing (sharper than my earlier LC+MS framing): a method should be able to bundle multiple components so the user doesn't have to wire them up per-experiment. Concrete example:

1. User creates **Method A** = "24-well plate layout (blank template)"
2. User creates **Method B** = "Assay instructions PDF"
3. User creates **Method C** = a compound method with components `[A, B]`, labeled "Assay X full kit"
4. User attaches Method C to an experiment → the experiment page shows both the fillable plate AND the PDF instructions in one section. User fills in the plate per-experiment; the per-task `plate_annotation` snapshot pattern from v1 carries the per-experiment annotations on the plate child.

Today this isn't possible. The closest you can do is attach Method A and Method B separately to each task, which renders as separate tabs and forces the user to manage the bundle manually each time.

### Architectural shape (proposed)

A new `method_type: "compound"`. The compound method record adds:

```ts
interface CompoundMethod extends Method {
  method_type: "compound";
  components: Array<{
    method_id: number;
    ordering: number;
    label?: string;  // optional override for how this child is titled in the compound
  }>;
}
```

When a task attaches a compound method, the renderer recursively expands the components. Per-child snapshot data lives on the compound's task attachment in a new field:

```ts
// On TaskMethodAttachment
compound_snapshots: string | null;
// JSON shape: { [child_method_id]: { lc_gradient?, plate_annotation?, body_override?, ... } }
```

Each child's snapshot uses the same fields it would use as a standalone attachment — so the per-task snapshot pattern from v1 carries forward without modification.

### Open questions for Grant

#### Q-A1: Rendering of a compound method on the experiment page

**LOCKED: stacked vertically** — all children render together in one scrollable column, with section headers + clear visual dividers between components. User sees the plate widget AND the PDF embed simultaneously.

**Additional requirement (Grant 2026-05-15):** a **table of contents** at the top of the compound's tab — for big or deeply-nested compounds, the user gets a navigation strip listing every component (and sub-component, if recursive). Clicking a TOC entry scrolls to that section. Probably renders as a sticky sidebar or a horizontal chip strip at the top of the tab.

#### Q-A2: Inline create vs reference-existing in the compound editor

**LOCKED: inline create allowed, both at compound-creation time AND while editing an existing compound.** Grant's framing (2026-05-15): "The new method maker needs to be revamped to let people string things together cleanly from the one creator OR while editing."

**Scope implication this triggers:** the new-method dialog needs a real UX redesign — currently it's a flat type picker (Markdown / PDF / PCR / etc.). Post-revamp, picking "Compound method" puts the user into a builder workspace where they can add components by either picking from their methods library OR creating fresh inline. Each inline-created child gets added to the user's methods library AND added to the compound in one step. Same dialog needs to work in "edit existing compound" mode (add/remove/reorder components). This is the largest UX change of v2 — comparable in scope to v1's Phase 0 (registry + viewer extraction).

#### Q-A3: Recursion — can compounds contain other compounds?

**LOCKED: allow recursion.** Cycle detection breaks the loop if a compound's component graph ever contains itself. Depth limit TBD by the planner — Grant didn't specify a hard cap; depth=3 is plenty for any real lab workflow but the planner should pick a defensible number (likely 3-5). The TOC requirement from Q-A1 makes deep nesting navigable from the user's POV — Grant's framing: "On the user end it would still just look like a single stacked method with clear lines between linked things and ideally a TOC to help navigate."

#### Q-A4: Child deletion handling — LOCKED: ask the user at delete time

**Grant 2026-05-15:** "Why not ask? They can delete the whole kit or just the method from the larger kit, up to them."

**Proposed prompt UX (for Grant to confirm in chat):**

When the user clicks delete on a method that's referenced by N compound methods, the delete confirmation modal lists the affected compounds and gives the user three buttons:

> **"Method A" is part of 2 compound methods:**
> - Method C — "Assay X full kit"
> - Method E — "Day 1 prep kit"
>
> Choose one:
> - **[Just delete Method A]** — Compounds keep "Method A (deleted)" placeholders where it used to render. Your existing experiments stay attached to the compounds.
> - **[Delete Method A AND the 2 compounds]** — All three are removed. Experiments using Method C or E lose those attachments.
> - **[Cancel]** — Don't delete anything.

If Method A isn't referenced by any compound (the common case), the modal stays as today's simple "Are you sure?" — no extra UX cost.

This subsumes the original Option 1 (soft) and Option 3 (cascade) as user-selectable choices per-deletion. Different deletes have different intents; the user picks.

#### Q-A5: Per-child snapshot edit UX — LOCKED: in-place edit

Clicking a child's section in the rendered compound enters edit mode on that child. The child's per-task snapshot saves to `compound_snapshots[child_id]`. Mirrors how single-method tabs work today.

### Out-of-scope for v2 (defer to v3+)

- **Cross-component dependencies**: e.g., child B's defaults depend on child A's values. (Possible future, but adds significant complexity; not needed for v2's "kit" use case.)
- **Conditional rendering**: showing/hiding children based on user input. (Same — punt.)
- **Sharing a compound method into another lab**: the cross-user share path needs to handle the compound + all its children. v1's sharing code only knows single-typed methods; v2 composition probably ships private-only first, with sharing as a v2.1 follow-up.

---

## Section B — Coding workflows method type — ALL LOCKED 2026-05-15

**Locks (Grant chose all recommendations):**
- **Q-B1 storage**: Embedded code (in method record) + optional external file pointer (for "open in your editor" handoff). Most flexible.
- **Q-B2 Jupyter**: Read-only cell render — parse .ipynb, render code cells with syntax highlighting + markdown cells as rendered markdown + last-saved cell outputs. No execution.
- **Q-B3 languages**: Curated list with icons — Python, R, bash, SQL, Julia, MATLAB, JavaScript. "Other" with freeform hint as fallback.
- **Q-B4 per-task state**: None — coding-workflow methods are static reference templates. Users wanting execution logs use notes.
- **Q-B5 in-page editor**: Read-only preview only + "open externally" link. No Monaco/CodeMirror weight in the bundle.

### The use case

Reusable scripts and Jupyter notebooks that get applied across many experiments. Markdown methods can hold code blocks today, but they're prose-first — code is ornament. A coding-workflow method type would be code-first with prose as annotation. The most distinctive case is **.ipynb notebook rendering**: no markdown method can render a notebook properly today.

### Differentiation rule (Grant's "scripts vs notes" question)

When does code belong in a method (reusable) vs notes (one-off)?

- **Method** = template the user clones for many experiments. "Standard RNA-seq QC pipeline."
- **Notes** = per-experiment execution log. "The R snippet I wrote for Figure 3 of this experiment."

The coding-workflow method type is for the reusable case. If users want one-off code per experiment, that stays in notes.

### Open questions for Grant

#### Q-B1: Storage approach

How does the script content live on disk?

- **Option 1: External file reference (path + interpreter + args)** — method points at a `.py` / `.R` / `.ipynb` file on disk. Simpler data model; hits the FSA permission gate when reading; user opens in their own editor.
- **Option 2: Embedded code** — the script's text lives inside the method record's body (or a sibling field). Renderer shows syntax-highlighted preview in-page. Always accessible; loses sync with external tools.
- **Option 3: Both — embedded as primary, with optional external pointer** — embedded for inline preview, optional path for "open in your editor." Most flexible; most code.

#### Q-B2: Jupyter notebook handling

`.ipynb` is the most distinctive value proposition. How rich should the rendering be?

- **Option 1: Read-only cell render (recommended for v2)** — parse the .ipynb, render code cells with syntax highlighting + markdown cells as rendered markdown + cell outputs (stored at last save) as static images/text. No execution. Big win over markdown methods (which can't render notebooks at all).
- **Option 2: External-only — just a file link** — method holds the .ipynb path; user opens in Jupyter / VSCode. Cheapest; minimal new code.
- **Option 3: Full interactive notebook in-page** — browser-side notebook execution via Pyodide or similar. Hugely expensive; out-of-scope for v2.

#### Q-B3: Language list

Curated list with nice icons + syntax highlighting, vs freeform language hint?

- **Option 1: Curated list** — Python, R, bash, SQL, Julia, MATLAB, JavaScript. Each gets an icon, color, syntax-highlighting profile. Plus an "Other" option with freeform language hint.
- **Option 2: Freeform language hint string** — user types whatever, viewer uses a generic syntax-highlighting fallback. More flexible; less polished.

#### Q-B4: Per-task instance state

When a user attaches a coding-workflow method to a task, what (if anything) gets recorded per-experiment?

- **Option 1: None** — coding-workflow methods are static reference templates; no per-task state. Simplest. (User who wants execution logs uses notes.)
- **Option 2: Run-log fields** — per-task: ran-on-date, output paths produced, exit code, parameter values used. Extends the per-task snapshot pattern.
- **Option 3: Embedded run snapshot** — per-task: a copy of the script as it was at run time, plus the run-log fields above. Most thorough; biggest data shape.

#### Q-B5: In-page editor

For embedded code (Q-B1 option 2 or 3), is the user editing in the browser?

- **Option 1: Read-only preview with "open in your editor" link** — no in-page editing. Matches the LC editor pattern of "syntax-highlighted preview"; avoids Monaco/CodeMirror complexity.
- **Option 2: Lightweight textarea** — basic edit-in-place, no IDE features. Fast; ugly.
- **Option 3: Monaco/CodeMirror** — full IDE in-page. Heavy bundle cost (~500KB); great UX.

---

## Section C — Mass spec parameters method type

### The use case

Standalone MS shape: ionization mode (ESI+ / ESI- / APCI / EI / MALDI), source temp, capillary voltage, gas flows, scan range, mass calibration. For LC-MS specifically: pairs naturally with the LC gradient method.

### The redundancy concern

If method composition (Section A) ships, "LC-MS as a combined method" becomes a compound: LC + MS as two children. So MS as a standalone method type only earns its keep if there are real **standalone MS** workflows worth supporting:

- **MALDI** — direct ionization, no LC. Common in protein ID.
- **Direct infusion / flow injection MS** — bypasses LC for small-molecule analysis.
- **GC-MS** — gas chromatography MS, which would want a GC method type (also doesn't exist).

If these are common enough in your target labs, MS as standalone is worth shipping. If most MS use is LC-MS, then composition handles it and MS standalone is unnecessary.

### Open questions for Grant

#### Q-C1: Does standalone MS earn a v2 spot, or does composition handle it? — LOCKED: ship standalone

Full standalone MS method type. Pairs with LC via composition for LC-MS, works alone for MALDI / direct infusion / GC-MS. The standalone path covers the cases where MS isn't preceded by LC.

#### Q-C2: If MS ships, what's the shape?

(Only matters if Q-C1 = Option 2.)

- Ionization mode discriminator: ESI+ / ESI- / APCI / EI / MALDI / other
- Source params: temp, voltage, gas flows
- Scan params: m/z range, scan rate, MS/MS settings
- Mass calibration: reference standard, calibration date, expected accuracy
- Open question: does the editor try to be smart per-ionization-mode (showing only relevant params) or always show all fields?

---

## Section D — v2 type prioritization

Once Grant locks Section A (composition) and Section B (coding workflows), this section asks the slate question. Currently in scope per the brainstorm:

- **Method composition primitive** — locked-in if Section A locks
- **Coding workflows** — locked-in if Section B locks
- **Mass spec parameters** — depends on Q-C1
- **Plate layout 1xN region compaction** — small follow-up to v1 Phase 2C (the bot flagged it as a v2 punt). Is it worth a v2 chip or skip?
- **PCR routing-fix retrofits** — bug-fix manager handling 3 routings already; not v2 type work

Open question:

#### Q-D1: Other v2 method types worth considering — LOCKED: add qPCR

qPCR enters v2. Composition primitive makes the natural shape clean: a "qPCR analysis" method type (Ct values, melt curves, standard curves, fold-change calc) that pairs with the existing PCR method via a compound. Exact shape (analysis-only sub-type that pairs with PCR vs full qPCR-protocol standalone vs PCR-fields extension) is open — flagged as **Q-D2 below** for the planner to propose.

Western blot, flow cytometry, microscopy, gel electrophoresis, CRISPR — all stay deferred per v1 cuts.

#### Q-D2: qPCR shape (planner-territory; surface in proposal for Grant lock)

Three plausible shapes for the qPCR addition:

- **Option 1: qPCR-analysis-only method type** — fields are Ct values, melt curve, standard curve, fold-change calc. Doesn't carry the PCR cycling protocol — that lives on a separate PCR method, and the user composes them via a "qPCR full kit" compound. Cleanest separation.
- **Option 2: Full qPCR-protocol method type** — independent of PCR. Carries cycling + analysis. Duplicates some PCR fields but keeps qPCR self-contained.
- **Option 3: Extend the existing PCR method type with optional qPCR fields** — PCR record gets `qpcr_analysis: ... | null`. Cheapest in code but conflates two distinct workflows on one method.

Planner picks the recommended option in `METHODS_EXPANSION_V2_PROPOSAL.md`; Grant locks at proposal time.

---

## Section E — Implementation sequencing (post-lock)

Once Grant locks the design questions, implementation sequencing depends on the answers, but the constraint structure is:

1. **Method composition primitive ships FIRST.** Everything else in v2 (coding workflows, MS, any future combined-method use cases) depends on it. The new `method_type: "compound"` + `components` array + `compound_snapshots` field on TaskMethodAttachment + the renderer's recursive expansion + the editor for building compounds — that's the foundation chip, similar in scope to v1's Phase 0.
2. **Per-type chips in parallel after composition lands.** Coding workflows + MS (if locked in) can run in parallel just like v1's Phase 2 chips, mirroring all the lessons from v1's parallel arc (assign id ranges per chip up front, build the merge-bot pattern in from the start, explicit-path staging in mid-merge — see AGENTS.md §6 trap entry from `407aff8e`).

The composition primitive itself is bigger than any single v1 chip. Likely 2-3 days of sub-bot work, plus careful integration. Worth a dedicated planning sub-bot AFTER Grant locks the open questions.

---

## Bundled clickable questions for Grant — DONE 2026-05-15

All Q-A* / Q-B* / Q-C1 / Q-D1 surfaced via three `AskUserQuestion` calls 2026-05-15 and locked. Remaining decisions (Q-C2 MS field shape, Q-D2 qPCR shape) are planner-territory — the planning sub-bot proposes options, Grant locks at proposal time.

Confirmation still needed in chat:
- **Q-A4 prompt UX** — see Section A's Q-A4 entry. Plain ask: does the proposed three-button modal ("Just delete X" / "Delete X and the N compounds" / "Cancel") match what Grant had in mind?

---

## Out-of-scope for this doc (parking lot)

- **PCR fork to qPCR** — earlier brainstorm noted qPCR could ride on PCR's interface as a second tab/section. Composition primitive subsumes this: qPCR becomes a compound of PCR + a qPCR-analysis method. Worth flagging if qPCR-analysis is its own v2 candidate (currently deferred per v1 cuts).
- **ELN auto-detection of structured types** — flagged as v2 in the v1 audit; still worth doing eventually but doesn't block composition.
- **The 3 bug-fix-manager routings** from v1 close (LC `title=`, workbench-card id-collision, MethodPicker rose hardcode) — those are bug-fix manager territory, not v2 method-expansion scope.
- **Wiki coverage of v1 types** — wiki manager has the handoff doc (`METHODS_EXPANSION_V1_WIKI_HANDOFF.md`); not v2 scope.

---

## When this doc is done with

Once Grant has marked up answers (or surfaced his preferences in chat), the methods-expansion manager will:

1. Bundle the locked decisions into a planning sub-bot brief
2. Spawn the planner — produces `METHODS_EXPANSION_V2_PROPOSAL.md`
3. Surface the proposal back to Grant for the final lock
4. Fire implementation chips per the locked sequencing

— methods-expansion manager
