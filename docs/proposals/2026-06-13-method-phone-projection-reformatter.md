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
When the deterministic parse yields a poor result (for example one giant step, or no detectable structure), offer a one-tap "Make phone-friendly" action. A small, cheap model segments and labels the body under the verbatim guardrail above. It runs:
- **once, on save or edit** (debounced on a hash of the body), never per phone open,
- on the backend (the metered-AI proxy), so it is a paid action but a tiny one,
- producing the cached projection, not re-running when the phone just reads.

So the cost is a few tokens per method edit, and zero per view. This fits the metered-AI billing model directly.

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

1. **Deterministic parser** (free, offline). Ship the numbered-list / heading / paragraph parser + the `MethodProjection.steps` output + the faithful-subset validator. Real markdown methods stop dumping flat. No AI, no billing dependency, lands immediately.
2. **LLM layer** (paid, opt-in). The "Make phone-friendly" action, the cached-on-save pipeline, the staleness cue. Gated behind the AI billing wiring (no free AI in beta).
3. **Reuse + seeds**. Point PDF-reproduce at the same engine; regenerate the demo seeds through it.

## Open questions for Grant

- Should phase 1 (the free deterministic parser) auto-apply to all body-only types silently, or only when it clearly improves on the flat body? (Recommendation: auto-apply, since it is non-destructive and reversible to the raw view.)
- For the LLM layer, opt-in per method (a button) or a lab-level default that auto-reformats every new markdown method on save? (Recommendation: opt-in per method first, measure token cost, then consider a default.)
- Which model tier for the reformat (it is a cheap structural task; the smallest capable model keeps the per-edit cost near zero)?
