# Relay brief: §5 fixture-data legacy-shape bugs

**To:** methods-expansion manager (parallel session)
**From:** AI Helper manager (parallel session)
**Via:** Grant relay
**Surfaced by:** AI Helper full-variant eval (sub-bot, 2026-05-15) — see [ai-helper/evals/results/subbot-full-eval.json](ai-helper/evals/results/subbot-full-eval.json) for the raw findings.

## What's broken

The AI Helper build script extracts canonical examples for §5 by reading real fixture files under `frontend/public/demo-data/users/{alex,morgan}/`. The full-variant eval surfaced that those fixture files are using **legacy shapes that no longer match the current §4 interfaces in [frontend/src/lib/types.ts](frontend/src/lib/types.ts)**. This affects:

- The AI Helper `frontend/public/ai-helper/full.md` (the §5 examples are misleading)
- The actual app's wiki captures + demo lab (any UI rendering these fixtures gets the legacy shape)
- Anyone reading `demo-data/` expecting it to be a faithful schema-by-example

The build script is faithfully extracting them — the bug is in the demo-data files themselves.

## Specific issues

### Issue 1: Task fixtures use legacy `method_id` (singular) + top-level `pcr_gradient` / `pcr_ingredients`

Current Task schema ([types.ts:210](frontend/src/lib/types.ts:210)) has:
```typescript
method_ids: number[]
method_attachments: TaskMethodAttachment[]
```

Plural `method_ids` (the new field) replaced the singular legacy `method_id` field, and per-attachment data lives on `TaskMethodAttachment`, not at the Task root.

But fixture files like `frontend/public/demo-data/users/alex/tasks/1.json` carry:
```json
{
  "method_id": null,         // legacy field, should be removed
  "method_ids": [],           // current field, kept
  "pcr_gradient": null,       // legacy top-level field, should be removed (now on TaskMethodAttachment)
  "pcr_ingredients": null,    // legacy top-level field, should be removed
  "method_attachments": []
}
```

The legacy `method_id` / `pcr_gradient` / `pcr_ingredients` fields should be removed from every Task fixture.

### Issue 2: TaskMethodAttachment fixture shape doesn't match the interface

Current `TaskMethodAttachment` schema ([types.ts:179](frontend/src/lib/types.ts:179)) has:
```typescript
{
  method_id: number,
  pcr_gradient: string | null,         // JSON-stringified PCRGradient
  pcr_ingredients: string | null,
  lc_gradient: string | null,
  body_override: string | null,
  plate_annotation: string | null,
  cell_culture_schedule: string | null,
  variation_notes: string | null
}
```

But fixture TaskMethodAttachment entries are showing up with `{ method_id, owner, snapshot_at }` — completely different shape. Either the fixture writer (`scripts/generate-demo-data.mjs`) is using a stale interface, or the fixture files were hand-edited at some point and never reconciled.

Suggest grepping for `snapshot_at` / `owner` inside any TaskMethodAttachment-shaped JSON in `demo-data/` and dropping those keys, then populating with the real shape.

### Issue 3: PCRProtocol fixture carries a `tags` field not on the interface

Current `PCRProtocol` schema ([types.ts:497](frontend/src/lib/types.ts:497)):
```typescript
{
  id: number,
  name: string,
  gradient: PCRGradient,
  ingredients: PCRIngredient[],
  notes: string | null,
  is_public: boolean,
  created_by: string | null
}
```

No `tags` field. But the fixture PCRProtocol example has a `tags` array. Either add `tags` to the interface (if it's wanted) or drop it from the fixture (if it's stale).

## Why this matters for methods-expansion specifically

This is methods-expansion arc territory because:

1. **The TaskMethodAttachment shape is methods-expansion's canonical surface** — Phase 2A (PCR retrofit), Phase 2B (markdown diff-overlay), Phase 2C (Plate layout) all added fields here. Reconciling the fixture-data shape against the now-canonical interface naturally lands in this arc.
2. **The legacy `method_id` / `pcr_gradient` / `pcr_ingredients` Task fields are pre-method-attachment, before the methods system was extracted.** Dropping them from fixtures is part of the same cleanup pass.
3. **Phase 2D (cell culture passaging) is queued to land in this arc** — it'll add `CellCulturePlannedEvent` / `CellCultureSchedule` / `CellCultureScheduleInstance` to types.ts. When Phase 2D lands, fixture coverage for cell-culture should land too. Coordinating the fixture refresh with Phase 2D keeps the work in one shipment.

## Suggested chip scope

A single fixture-cleanup chip:
1. Grep `frontend/public/demo-data/` for the legacy fields (`method_id`, top-level `pcr_gradient`, top-level `pcr_ingredients`, `snapshot_at` on TaskMethodAttachment, `tags` on PCRProtocol).
2. Drop them from every fixture file that has them.
3. If any fixture carries the LEGACY shape but the corresponding NEW shape is empty, populate the new shape with sensible canonical content (e.g. if old `pcr_gradient` was on a Task, move it onto a `method_attachments[0].pcr_gradient` entry that references a real PCRProtocol id from the fixture).
4. Update `scripts/generate-demo-data.mjs` to emit the canonical shape going forward (so the next `npm run demo:data` doesn't regress).
5. Run `npm run demo:images` + `npm run demo:zip` per the AGENTS.md `27aa8204` playbook to keep the downloadable demo bundle in sync.
6. Verify by re-running the AI Helper build (`npm run --prefix frontend ai-helper:build`) — the §5 examples in `frontend/public/ai-helper/full.md` should now show the canonical shape rather than the legacy shape.

## Out of scope for this chip

- Fixing the cell_culture missing-from-Method.method_type union (that's a Phase 2D landing concern, not a fixture-shape concern).
- Renaming any current fields. The only changes are: drop legacy fields that shouldn't be there, populate new fields where they're empty.
- Touching the AI Helper prompt itself. The AI Helper build script picks up the new shapes automatically once the fixtures are clean.

## How to coordinate

- Fixture changes touch `frontend/public/demo-data/` and `scripts/generate-demo-data.mjs` — both methods-expansion territory.
- Wiki capture impact: re-running `npm run wiki:screenshots` after the fixture cleanup will refresh the wiki page screenshots that render these task / method shapes. Coordinate with wiki manager if any visible wiki copy references the legacy field names.
- AGENTS.md §8 should get a "Fixture cleanup: dropped legacy method_id / pcr_gradient / pcr_ingredients from Task fixtures" entry once landed.

— AI Helper manager
