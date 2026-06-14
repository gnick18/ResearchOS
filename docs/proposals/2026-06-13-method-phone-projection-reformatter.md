# Method phone projection: turning free-form methods into bench-friendly steps

Status: design proposal, for Grant's sign-off before any build
Date: 2026-06-13
Author: Mobile UI lane (orchestrator)
Related: [VIEW_METHOD_ON_PHONE.md](VIEW_METHOD_ON_PHONE.md), [beakerbot-pdf-reproduce](beakerbot-pdf-reproduce.md), [beakerbot-summary-suite](beakerbot-summary-suite.md), [2026-06-11-markdown-embed-hybrid.md](2026-06-11-markdown-embed-hybrid.md)

## The problem

The phone "view method" reader renders a rich, stepped, bench-friendly protocol for the three method types the laptop stores as structured data (`pcr`, `lc_gradient`, `compound`), because the projection builder in `frontend/src/lib/mobile-relay/method-snapshot.ts` reads those structured fields directly.

Every other method type (`markdown`, `pdf`, `plate`, `cell_culture`, `mass_spec`, `coding_workflow`, `qpcr_analysis`) carries only the raw `body` markdown, and the phone renders it as one flat block of text (`BodyView` in `mobile/app/method-detail.tsx`). The demo seeds are hand-authored so they look stepped, but a real free-form markdown method is a wall of text at the bench, which is the worst place to read a wall of text.

We want every method, however the researcher wrote it, to read on the phone like the structured ones do: ordered steps, reagents, key params, the value you actually need mid-pipet visible at a glance.

## Scope fit (why BeakerBot is allowed to do this)

Reformatting a user's **own** protocol markdown into steps is "expand and reformat the user's own content," which is squarely inside BeakerBot's allowed scope. It is **not** interpretation: it draws no conclusions, generates no hypotheses, invents no science. So it does not trip the hard no-interpretation rule. This is the same capability as the PDF-reproduce spec's "method -> methods verbatim draft," pointed at the user's own markdown instead of a paper.

## The one hard guardrail: verbatim values

A protocol is safety-critical. A wrong volume, temperature, or time is a ruined experiment or a hazard. So the reformatter may only **segment and label** the user's text into steps, reagents, and params. It must:

- preserve every number, unit, reagent name, and concentration **verbatim**,
- never add a step, drop a step, merge two steps' values, or paraphrase a quantity,
- only add structure (step boundaries, titles, reagent vs prose classification).

We **validate** this deterministically before saving: every numeric token and reagent string in the output must appear in the source (a faithful-subset check). If validation fails, we discard the LLM output and fall back to the deterministic parse or the flat body. This mirrors the project-wide principle already in the summary suite and vendor-spec work: the deterministic layer is the source of truth, the model only narrates and formats.

## Design: a hybrid reformatter, cached on save

### 1. Free deterministic pass (always runs first, zero tokens)
Parse the markdown for obvious structure offline:
- numbered lists (`1.` / `2.` / `1)` ) and lettered/roman sub-lists,
- `##` / `###` headings as step titles,
- blank-line-separated paragraph chunks as fallback steps,
- bold lead-ins (`**Mix:**`) as step titles,
- bullet lists under a step as its reagent/checklist items,
- a leading non-list paragraph as an intro/overview block.

Many tidy protocols are fully served by this with no model call. The result is the same `MethodProjection` shape the readers already consume (a `steps[]` plus optional `keyParams`).

### 2. Opt-in LLM pass (for messy free-form markdown)
When the deterministic parse yields a poor result (for example one giant step, or no detectable structure), a small, cheap model segments and labels the body under the verbatim guardrail above. Two user-confirmed triggers (see Decisions), never a silent lab-wide auto-run:
- the laptop-side "Make phone-friendly" button on the method, and
- a **just-in-time prompt on the phone**: when the user opens a method with no phone projection yet, the phone offers to have BeakerBot build one on the spot.

It runs on the backend (the metered-AI proxy), produces the cached projection, and does not re-run when the phone just reads. So the cost is a few tokens per method, once, and zero per view. This fits the metered-AI billing model directly.

### 3. Store as a derived artifact linked to the source
The raw `.md` method stays the portable source of truth (same philosophy as the markdown-embed-hybrid). The stepped projection is a **derivative**, stored alongside the method keyed by a content hash of the body:
- on body change, the cached projection is marked stale and regenerated (deterministic immediately, LLM on next save if it was an LLM projection),
- if stale and not yet rebuilt, the phone shows a small "rebuilt needed / showing last version" cue rather than letting the two silently drift,
- the projection is what `buildBody` / the snapshot pipeline ships to the phone, so the phone code does not change at all.

### 4. One engine, many surfaces
The reformatter is a single module (`reformatMethodToSteps(body) -> MethodProjection.steps`). It serves:
- all body-only phone readers (this proposal),
- the PDF-reproduce "method -> verbatim methods draft" (same segmentation, paper source),
- regenerating the **demo markdown/coding/etc. seeds** so the demo reflects real output instead of hand-authored polish.

## What this is not

- Not a method editor or generator. It never writes new protocol content, only restructures what the user wrote.
- Not an interpretation or QC layer. It does not flag, correct, or comment on the science.
- Not a per-view cost. The model runs on save, the phone reads the cache.

## Phases

1. **Deterministic parser** (free, offline). DONE, merged to main `56f1852d7` (2026-06-13). Built on the phone side in `mobile/lib/method-read.ts` (`parseBodyToSteps`, consumed by `buildGeneric`), so every body-type method (markdown, pdf, kit, coding, etc.) now reads as proper steps instead of a flat wall of text, with no projection-shape or relay change and fully offline. It parses numbered lists into steps, markdown headings and standalone bold lines into the step phase, bullet lists AND markdown tables into a tickable reagent checklist (amount peeled from a trailing parenthetical or the table's last column, verbatim), sub-steps (a/b, i/ii) folded into the detail, image refs into figure placeholders, and it strips inline markdown (links, `**bold**`, `code`) from the reader text WITHOUT ever touching a single `*` so a multiply sign like 5*10^6 stays verbatim (hardening commit `843087de5`). The headline is a verbatim first-sentence split that does not break on decimals or units. Reagent checks are tickable (gather as you go). It only segments and labels, never rewrites a value. Verified on the emulator against raw markdown (headings, bullets, numbered steps, sub-step, image, parenthetical amounts). NOTE: figure placeholders show a dashed box with the alt text; the real images render once the snapshot ships them (part of the figures-inline decision, a relay change for a later phase).
2. **LLM layer** (paid, opt-in). The "Make phone-friendly" action, the just-in-time phone popup, the cached-on-save pipeline, the staleness cue, the verbatim faithful-subset validator. Gated behind the AI billing wiring (no free AI in beta).
3. **Reuse + seeds + figures shipping**. Point PDF-reproduce at the same engine; ship + render figure images inline (relay change); regenerate the demo seeds through the parser.

## Validated against a real SOP (2026-06-13)

Prototyped the reformat against a real lab method (Grant's Trichoderma asperellum transformation SOP: a .docx, 43 numbered steps with a/b and i/ii sub-steps, three unlabeled material lists, three phase headers, 6 inline figures, superscripts). I reformatted it by hand as the model would, injected it as a temp seed, and rendered it on the emulator. It produced a clean 49-step phone reader with every rpm / temp / time / volume / concentration preserved verbatim. So the segment-and-label-only approach is achievable on a genuinely messy method. The test also surfaced what the projection model must gain to do these justice (today the generic/markdown path in `mobile/lib/method-read.ts` only splits a flat `body` string into headline + detail steps):

- **Explicit step kicker / phase.** `buildGeneric` hard-codes the kicker to "Step N of M" via `numberKickers`. The reformatter wants to set the phase ("Germlings", "Protoplasting", "Transformation") so the reader shows where you are. The model should let the reformatter supply the kicker. For the prototype I encoded the phase into the headline ("Transformation, pellet") as a workaround; a real phase field is cleaner.
- **Structured reagent / material checks.** The reader already renders a `checks[]` checklist for pcr/lc steps; the generic/markdown path does not populate it, so the three material lists rendered as prose detail instead of checkboxes. The reformatter should emit `checks[]` for any reagent or material list.
- **Sub-step nesting.** The SOP has a/b and i/ii/iii sub-steps. Folding them into the parent step's detail prose works but loses the structure; consider a nested/indented detail or sub-checks.
- **Figures.** The 6 inline figures (confirm germlings under scope, flask color, protoplast morphology at two mags) carry real bench meaning and were dropped to a "(see figure)" note. DECIDED: render them INLINE full width at their step, and ship the figure images in the method snapshot (see Decisions).
- **Pinned-header weight on long protocols.** SHIPPED already: the read-mode header is now collapsible (badge + title tap toggle) and auto-collapses once the reader advances past step one, unless the user manually toggles it. Merged to main (`55f64f74e` and the two merges before it). This is independent of the reformatter.

Implication for the data model: the reformatter should emit a **structured step list** (phase/title/detail/checks/figureRef), and the body-type model builder should consume that, not just a flat `body` string. That is the main model change phase 1 should include.

## Decisions (locked 2026-06-13)

- **Figures: inline, full width, images shipped.** Render each figure in the step where it is referenced (the bench needs it), and ship the figure images in the method snapshot. The relay is size-limited and E2E, so downscale/compress figures for the phone payload and reference them from the step by index (`figureRef`). Image-heavy methods are the norm, so this is worth the payload.
- **Materials and reagent lists: tickable checklist.** Reformatter emits `checks[]` for any reagent or material list, rendered as the same checkbox-row primitive the PCR reader already uses (name + mono amount), tickable as you gather. Not prose.
- **Reformat trigger: opt-in per method PLUS just-in-time on first phone open.** Two entry points, both user-confirmed, no silent lab-wide auto-reformat:
  1. A "Make phone-friendly" button on the method (laptop side), for methods you choose ahead of time.
  2. **On the phone, when a user opens a method that has no phone projection yet** (a raw pdf / md / doc / kit / etc.), the phone shows a popup offering "Have BeakerBot build a phone version of this method?" One tap fires the backend reformat, the phone then renders the result. This is the moment of need, at the bench, so it is the natural trigger. Still metered-AI, still user-confirmed (no surprise token spend).
- **Sub-steps:** fold a/b and i/ii into the parent step as indented sub-detail or sub-checks (not lost to flat prose).
- **Deterministic parser auto-applies** to all body-only types (non-destructive, the raw view is always one tap away). The LLM pass is only the opt-in / just-in-time paths above.

## Still open (small)

- Which model tier for the reformat (cheap structural task; smallest capable model keeps per-edit cost near zero). Decide at build time against the Fireworks options.
- A lab-level "auto-reformat every method on save" default is explicitly deferred until the per-method and just-in-time costs are measured.
