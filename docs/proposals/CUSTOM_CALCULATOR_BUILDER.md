# Custom Calculator Builder

Status: design locked, mockup approved (2026-06-10). Not built yet.

Mockup (the visual + interaction spec, reviewed change by change):
`docs/mockups/2026-06-10-custom-calculator-builder.html`

## Why

A beta user loved the Lab Calculators (and that they work on both the laptop and
the companion phone) and asked whether labs could build their own. The case that
keeps coming up is field-specific math that is too niche to ship for everyone but
makes sense for everyone in one lab, for example a spore-suspension concentration
from five hemocytometer counts. So we let a user build a calculator out of typed
inputs and formulas, share it lab-wide or with an external person, and have it
appear on the paired phone automatically. This fits the local-first model cleanly
because a custom calculator is just more user data living in the folder, like a
method.

## Locked decisions

- v1 formula model is inputs + steps + conditionals + outputs. The mini-spreadsheet
  (a reagent-style table with per-row formulas) is the planned follow-up after this
  lands, not part of v1.
- Sharing supports lab-wide and external from the start, reusing the existing
  `shared_with` primitive. Lab-wide is a live reference (a fix propagates), external
  sends a copy over the encrypted collaboration relay.
- Lives inside the existing Lab Calculators modal, which gets the wider two-pane
  rework it needed anyway (this also fixes the long-standing too-tall Scientific
  keypad overflow).
- A template library mirrors the method catalog, seeded with 10 starter calculators.
- Submission to the public library is curated via GitHub, the same pipeline the
  feedback button uses. Reviewed, not instant. No backend.

## Data model

Custom calculators are user data, stored like methods.

- Path: `users/<owner>/calculators/<id>.json`.
- Shape (draft, finalize in types.ts):
  - `id`, `name`, `description`, `field` (optional grouping label).
  - `inputs[]`: `{ key, type: "number" | "replicate" | "dropdown", label, unit?,
    default?, options?: { label, value }[] }`. Dropdown `value` may be a number or a
    string so a formula can branch on the selection.
  - `steps[]`: `{ key, expr }` named intermediate values.
  - `conditionals[]`: `{ expr }` using `if(cond, a, b)` for plain-language guidance.
  - `outputs[]`: `{ label, expr, unit? }`.
  - `shared_with: string[]` (unified sharing primitive).
- Field renames follow the lazy-normalize + on-demand-repair pattern in AGENTS.md so
  shared files from other users with older shapes keep working.

## Engine

Reuse `expr-eval-fork` (already in the bundle, powers the Scientific tab), so no new
dependency. The math layer extends `lib/calculators/scientific.ts` (or a sibling
`lib/calculators/custom.ts`) behind a thin tested wrapper, with golden tests pinning
input-to-output the way `calculators.golden.test.ts` does today.

Two small additions make all 10 seed templates expressible:

1. A curated set of list-aware functions for replicate lists: `shannon`, `simpson`,
   `geomean`, `sumproduct`, `linfit_slope`, `linfit_intercept`. These cover the
   ecology diversity case and unlock simple standard-curve calcs (Bradford, BCA,
   absolute qPCR) for free. Keep the common case simple by NOT adding a comprehension
   syntax.
2. Enum-valued dropdowns so a formula can branch on the selection, for example the
   RCF and RPM mode switch.

Boundary: calculators do arithmetic on known coefficients. Full nonlinear curve
fitting (4PL ELISA, etc.) stays in the Data Hub.

## The 10 seed templates and coverage

| # | Calculator | Field | Coverage |
|---|------------|-------|----------|
| 1 | Cell viability + count (trypan blue) | Cell culture | Works today |
| 2 | CFU per mL from plate counts | Microbiology | Works today |
| 3 | OD600 to cells per mL | Microbiology | Works today |
| 4 | qPCR amplification efficiency | Molecular biology | Works today |
| 5 | PCR master mix maker | Molecular biology | Expressible, wants the table follow-up |
| 6 | Injection volume by body weight | In vivo / pharmacology | Works today |
| 7 | RCF and RPM converter | General lab | Needs enum dropdown |
| 8 | Doubling time and growth rate | Microbiology | Works today |
| 9 | Isotope decay correction | Radiochemistry | Works today |
| 10 | Shannon diversity index | Ecology / microbiome | Needs a list helper |

8 of 10 express with the base model. Master mix motivates the spreadsheet follow-up.
Shannon needs the `shannon()` list helper. RCF/RPM needs enum dropdowns.

## Template library

Mirrors the method catalog (see `[[reference_method_catalog_shape]]`).

- Static JSON seed under `frontend/public/calculator-templates/`, one file per
  template, loaded by a catalog loader.
- A golden test validates every template against the builder schema and pins a
  reference input-to-output pair, like `method-catalog-files.test.ts`.
- The builder gets a "Start from a template" entry, grouped by field. Opening a
  template loads it into the builder ready to tweak, then save-as-your-own.

## Submission (curated via GitHub)

A "Share to the library" button in the builder exports the calculator JSON and opens
a pre-filled GitHub submission, the same mechanism as the feedback / issue flow
(`.github/ISSUE_TEMPLATE/`). A maintainer reviews for correctness, accepted ones ship
in the next release seed. Zero backend, reviewable JSON, honest that it is reviewed
not instant. This is a new pattern that could later also apply to the method library.

## Phone sync

The phone ships with the built-in calculators baked in. On pairing it pulls the
user's and labmates' custom calculators over the same sealed relay snapshot the
view-method-on-phone feature uses (`mobile/lib/mobile-relay/method-snapshot.ts`
pattern), and renders them with one generic custom-calc renderer fed by the JSON, so
a new calculator works on the bench with no app-store update.

## Phasing

1. Builder + engine. The two-pane modal rework, the input / step / conditional /
   output builder, the engine wrapper with the list helpers + enum dropdowns, the
   Use / Edit loop. Lands behind a flag. Template library lands alongside (seed JSON
   + loader + golden test + Start-from-a-template).
2. Sharing. Wire `shared_with` for lab-wide (live reference) and external (relay
   copy).
3. Phone sync. Relay snapshot publisher on the laptop + generic renderer on the
   phone.
4. Submission. The Share-to-library GitHub export.
5. Follow-up: the mini-spreadsheet table input type (the master mix case).

Wiki page for `/wiki/features/calculators` (or a new sub-page) is written by a
dedicated wiki sub-bot after the UI settles, per AGENTS.md, not by the feature
sub-bots.
