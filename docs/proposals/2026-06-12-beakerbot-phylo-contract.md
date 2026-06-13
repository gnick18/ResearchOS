# Phylogenetics data contract for BeakerBot

From: Phylogenetics lane. To: BeakerAI. 2026-06-12.

Relay of the real /phylo contract so BeakerBot builds against actual exports, not guesses. Three honesty markers up front:

- The Studio STORAGE and the SVG RENDERER are stable and ready now.
- The Tree Builder OPTIONS shape is mid-redesign (Grant is vetting a wizard expansion). Build the Builder integration against the FROZEN shape, which I will re-relay when it lands. Details below.
- The EMBED type and the deep-link ROUTE do not exist yet. They are Phase 5, which the phylo lane will build. Planned shapes below so you can design ahead.

## 1. Tree Builder (the script generator) — programmatic entry exists, shape is changing

The Builder does NOT build trees. There is no compute and no `runAnalysis` equivalent that produces a tree (by design, no server compute, no inference in-app). The programmatic core is a PURE, deterministic generator:

- `generateRecipe(o: BuilderOptions): RecipeOutput` from `@/lib/phylo/recipe`
  (also `generateCommands`, `generateInstall`, `generateEnvYaml`, `generateRunScript`).
- `RecipeOutput = { commands: string; install: string; envYaml: string; runScript: string; markdown: string }`.

This is exactly the "BeakerBot never codes" model: BeakerBot fills `BuilderOptions` by SELECTING from the curated catalog, then calls `generateRecipe`. The generator emits every flag. BeakerBot must never write a flag or command itself.

The valid option values live in the catalog (`@/lib/phylo/catalog`): `DATA_TYPES`, `HAVE_INPUTS`, `ALIGN_TOOLS`, `TRIM_TOOLS`, `MODEL_CHOICES`, `INFER_TOOLS`, `SUPPORT_CHOICES`, `OS_CHOICES`, plus `DEFAULT_OPTIONS`. Pick only from these.

CURRENT `BuilderOptions` (catalog.ts): `{ dataType, have, nTaxa, nSites, align, trim, model, infer, support, os }`.

> CHANGING SOON, do not freeze against this. The vetted expansion (not yet applied to code) removes `codon` from dataType, removes `nTaxa`/`nSites` (MAFFT goes `--auto`), turns the fixed model into a picked model string, and ADDS: an `analysis` fork (`single` | `supermatrix` | `coalescent`), partition fields (`partScheme`, `brlen`), an optional `outgroup`, and advanced fields (`bnni`, replicate counts, `asc`, `restrictModels`, `threads`). The three analysis values produce three different pipelines (single locus; concatenated supermatrix via AMAS + partitioned IQ-TREE; per-gene trees summarized with ASTRAL). I will re-relay the FROZEN `BuilderOptions` + catalog the moment it lands. Until then, the Builder is navigate + guide.

"Build a tree FROM these sequences": NOT wired yet. `HAVE_INPUTS` has a `library` value, but it is currently only a recipe hint ("export the selected sequences to FASTA first"). There is no sequence-id -> FASTA-export input binding. That binding is a future addition we should co-design (it is the missing piece for your "build a tree from these sequences" tool). Flag it back to me and we will spec the input contract together.

## 2. Tree Studio (storage) — STABLE

On-disk pair, mirroring molecule-store: `users/<owner>/phylo/<id>.tree` (raw Newick / Nexus / PhyloXML, the source of truth) + `users/<owner>/phylo/<id>.meta.json` (`PhyloMeta`). Entity `phylo`, per-user `_counters.json`, the id is a stringified integer (stable).

API `phyloApi` from `@/lib/phylo/api`:

- `list(): Promise<PhyloMeta[]>`
- `listForUser(username): Promise<PhyloMeta[]>`
- `listByProject(projectId): Promise<PhyloMeta[]>`
- `get(id): Promise<RawPhyloFiles | null>` where `RawPhyloFiles = { meta: PhyloMeta; tree: string }`
- `create(tree: string, meta): Promise<RawPhyloFiles>`
- `updateMeta(id, patch): Promise<PhyloMeta | null>`
- `remove(id): Promise<boolean>`

Types (`@/lib/phylo/types`):

```
PhyloMeta = { id, name, project_ids: string[], added_at, format: "newick"|"nexus"|"phyloxml",
              source?: "upload"|"paste"|"builder", tip_count?, figure?: PhyloFigureSpec, metadata?: PhyloMetadataBinding }
PhyloFigureSpec = { layout: "rectangular"|"circular"|"slanted"|"unrooted", branchLengths: boolean, tracks: Record<string, boolean> }
PhyloMetadataBinding = { tipColumn, rows?: Record<string,string>[], datahubTableId?,
                        categoryColumn?, barColumn?, heatColumns?: string[] }
```

## 3. The renderer (the embed building block) — STABLE

- `parseNewick(text: string): TreeNode` from `@/lib/phylo/parse`.
- `renderTreeSvg(root: TreeNode, spec: RenderSpec): string` from `@/lib/phylo/render` — returns a SELF-CONTAINED SVG string (it is what the live canvas injects via dangerouslySetInnerHTML and what the SVG/PNG export reuses, one source).

```
RenderSpec = { layout: "rectangular"|"circular", phylogram: boolean,
               tracks: FigureTracks, columns: FigureColumns, width, height,
               metadata?: Map<number, Record<string,string>>, categoryColors?, cladeHighlight?, branchColors? }
FigureTracks = { labels, labelsItalic, points, strip, bars, heat, clade, support }  // all boolean
FigureColumns = { category?, bar?, heat?: string[] }
```

So the render path for a card is: `renderTreeSvg(parseNewick(tree), spec)`. Note the STORED `PhyloFigureSpec` + `PhyloMetadataBinding` are the persisted form; `PhyloStudio.tsx` maps them into a `RenderSpec`. In Phase 5 I will extract that mapping into a shared `figure -> RenderSpec` helper so the embed renderer and the Studio share one adapter (you should call the shared helper, not re-derive it).

## 4. Embed + deep-link — NOT BUILT, Phase 5 (phylo lane will build)

Today there is NO `phylo` `ObjectRefType` (references.ts has molecule, datahub, etc.) and NO `?doc=` route on `/phylo` (the page is internal-view-state only). PLANNED, mirroring Data Hub:

- ObjectRefType `"phylo"`, deep-link `/phylo?doc=<id>`, embed fragment `[name](/phylo?doc=<id>#ros=view)`.
- A `/phylo?doc=<id>` route param that opens that tree in the Studio.
- An ObjectEmbed renderer for `phylo` that loads `phyloApi.get(id)`, maps figure+metadata via the shared adapter, calls `renderTreeSvg`, and returns the SVG card, so it auto-appears in the embed dispatcher exactly like Data Hub plots/results and molecules.

When these land I will relay the FROZEN type string + descriptor. Until then a tree figure cannot render as a chat card. Consume, do not duplicate.

## 5. Constraints (what BeakerBot must NOT do)

- NEVER write or invent flags / commands / code. Select from the catalog into `BuilderOptions`, call `generateRecipe`. The deterministic generator owns every flag. This is Grant's hard rule (Beaker never codes).
- NO server compute, NO running any tool, NO tree inference. BeakerBot may produce a recipe and save it to a note, never execute a tree build.
- Studio is native-JS render only via `renderTreeSvg`. The ggtree R code is EXPORT-ONLY (a file the user runs in their own R), never executed here.
- Consume the catalog / recipe / store / renderer read-only. Do not reimplement them (lane split, same as Data Hub).
