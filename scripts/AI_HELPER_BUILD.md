# AI Helper prompt build pipeline

The AI Helper feature ships a ResearchOS-trained system prompt that users
paste into their own Claude / ChatGPT / Gemini account. The prompt is
assembled from hand-written prose partials (`ai-helper/partials/*.md`),
auto-extracted entity schemas (from `frontend/src/lib/types.ts`), canonical
fixture examples (from `frontend/public/demo-data/`), and a wiki nav table
(from `frontend/src/lib/wiki/nav.ts`). The resulting Markdown lives at
`frontend/public/ai-helper/{full,lean,minimal}.md` and is served as a
static asset alongside the rest of the app.

## What the build script does

`scripts/build-ai-helper.mjs` runs end-to-end with no flags. It:

1. Reads every partial in `ai-helper/partials/`. Empty partials get a
   `> _Section pending — chip 2 will fill this in._` placeholder so the
   output is valid markdown even before chip 2 lands the prose.
2. Reads `frontend/src/lib/types.ts` verbatim and wraps it in a fenced
   `typescript` block. The comments in `types.ts` ARE the documentation;
   no parsing is done.
3. Walks the demo fixture (`frontend/public/demo-data/`) for one canonical
   example per entity type (Project, Task variants, Method per
   `method_type`, PCRProtocol, PurchaseItem, Note, HighLevelGoal,
   Dependency, Event, LabLink, etc.). Examples are emitted as fenced
   `json` blocks with their source path.
4. Extracts a flat `(label, href)` table from `WIKI_NAV` in `nav.ts`.
5. Stitches everything into three size variants:
   - **`full.md`** — every section, every schema, every example.
   - **`lean.md`** — drops §5 examples, trims §6 to one-liner-per-route
     and §7 to the first 4 hero workflows.
   - **`minimal.md`** — identity + Project/Task/Method/PurchaseItem
     schemas only + first 2 workflows + behavior. Drops examples,
     architecture, mental model, drafting helpers, and the wiki nav
     trim down to a footer link.
6. Computes `schema_hash = sha256(<schemasSection>)` and a separate
   `structural_fingerprint` that also covers examples + wiki nav. Reads
   the previous `manifest.json` to decide whether to bump
   `helper_version` (bumps when the structural fingerprint changes;
   prose-only edits don't bump).
7. Writes `frontend/public/ai-helper/manifest.json` recording version,
   hash, build commit, build timestamp, and per-variant byte/token sizes.

### Privacy guard

Every fixture file the script reads is checked TWICE:

- **Path check.** Must live under `frontend/public/demo-data/`. If the
  path is `users/<u>/...`, `<u>` must be one of `alex`, `morgan`,
  `public`, or `lab`.
- **Content check.** Any string-valued `owner` or `username` field
  (recursively) must be in the same allowlist.

Either check failing aborts the build with an explicit error. Real user
data must never leak into the public-deploy AI Helper bundle.

## When to run which script

| Command | When |
| --- | --- |
| `npm run --prefix frontend ai-helper:build` | After editing any partial or after `types.ts` / fixture changes — regenerates the bundle in place. Does NOT commit. |
| `npm run --prefix frontend ai-helper:check` | Quickly verify the on-disk bundle matches `types.ts`. CI-friendly: exits 0 on match, 1 on drift. Wired into `prebuild` automatically. |
| `npm run --prefix frontend ai-helper:refresh` | Build + auto-commit the regenerated bundle on the current branch (one commit, message `AI Helper: refresh prompts (auto)`). Use when you've made schema changes that should ship together. |

## Drift detection at CI

`frontend/package.json`'s `prebuild` runs:

```
check-wiki-coverage.mjs --ci
build-demo-zip.mjs
build-ai-helper.mjs
check-ai-helper.mjs
```

So a Vercel deploy (or local `npm run build`) regenerates the bundle in
the build sandbox AND verifies the regenerated bundle matches `types.ts`.
If a developer edits `types.ts` and forgets to commit a refreshed bundle,
the build still ships fresh prompts — but the assertion catches the case
where the build script itself drifts from the check script.

## Adding a new partial section

1. Create `ai-helper/partials/<n>-<slug>.md` (e.g. `4b-edge-cases.md`).
2. In `scripts/build-ai-helper.mjs`, add the partial name to
   `PARTIAL_NAMES` and a human title to `SECTION_TITLES`.
3. Decide where it slots in `assembleFull` / `assembleLean` /
   `assembleMinimal` — those three functions control the rendering order
   and the size-variant trimming. The numbering convention
   (1-identity, 2-architecture, 3-mental-model, 4 = schemas (auto),
   5 = examples (auto), 6-features, 7-workflows, 8-behavior, 9-drafting,
   10 = wiki nav (auto), 11 = build metadata footer) keeps the section
   headers stable; if you insert a 4b, decide whether minimal/lean
   should include it.

## Extending with a new entity type

The fixture extraction loop (`buildExamplesSection` →
`ENTITY_PICKERS`) is a declarative array. Each picker entry has:

```js
{
  label: "Display name",        // becomes an `### <label>` header
  dir: "fixture_subdir_name",   // null + `sidecarFile` for top-level files
  predicate: (json) => boolean, // optional — filter within a directory
  discriminatorField: "x",      // optional — emit ONE example per distinct value
  excludeSuffixes: ["-hosted"], // optional — skip files ending in these
  optional: true,               // optional — don't fail if no fixture exists
}
```

Add a new entry, save the file, run `npm run --prefix frontend
ai-helper:build` — the new entity surfaces in the output without
touching the script's main flow. If your new entity type doesn't have
fixture coverage yet, mark it `optional: true` so the build skips it
gracefully (with a "fixture pending" placeholder); add real fixture
files later in `scripts/generate-demo-data.mjs`.

## File map

```
ai-helper/
└── partials/                       ← hand-written prose, edit freely
    ├── 1-identity.md
    ├── 2-architecture.md
    ├── 3-mental-model.md
    ├── 6-features.md
    ├── 7-workflows.md
    ├── 8-behavior.md
    └── 9-drafting.md

scripts/
├── build-ai-helper.mjs             ← stitches partials + auto sections
├── check-ai-helper.mjs             ← schema_hash drift gate
└── AI_HELPER_BUILD.md              ← this file

frontend/public/ai-helper/          ← BUILD OUTPUT — do not hand-edit
├── full.md
├── lean.md
├── minimal.md
└── manifest.json
```

## Style conventions for partials

The partials feed into a system prompt the user pastes into a third-party
LLM. Voice should be:

- Second-person, direct, short paragraphs.
- No em-dashes (matches ResearchOS wiki voice — see AGENTS.md §5).
- Code spans for filenames / fields / route paths.
- H3 (`###`) per subsection — the lean/minimal variants use H3 boundaries
  to trim. If a partial has no H3s, the trimmer passes it through whole.

Chip 2 owns the prose. Chip 1 (this scaffolding) only guarantees the
build produces valid output regardless of partial content.
