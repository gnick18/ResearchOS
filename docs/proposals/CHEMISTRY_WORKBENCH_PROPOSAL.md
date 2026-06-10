# Chemistry Workbench Proposal (the ChemDraw alternative)

Status: design, locked decisions captured 2026-06-10. Not built. This is the
chemistry analogue of the sequence-editor arc (see
`docs/proposals/SEQUENCE_EDITOR_PROPOSAL.md`), and it deliberately recycles the
same shapes the sequences feature proved out. Read that doc and `AGENTS.md`
section 2 (repo layout) before building.

## 1. What we are building

A built-in molecular structure tool, opt-in, with three faces that match the
user's framing of "a tool, a hub, and companion tools on the page itself."

- A **drawing canvas** (the ChemDraw alternative) for sketching small molecules,
  embedded like the live-markdown editor is embedded.
- A **saved chemical library** of drawn or imported structures, linked to
  projects, exactly the way the sequence library links `.gb` files to projects.
- A **PubChem importer** that searches a public database browser-direct and
  pulls structures with full metadata into the library, the same pattern as the
  NCBI import for sequences.
- A **Chemistry hub page** at `/chemistry` that is the home for the library
  grid, PubChem search, and quick-draw, surfaced only for users who opt the
  feature in.

This stays true to the architecture. No backend, all data on the user's disk via
the File System Access API, only the existing thin CORS-proxy allowance if ever
needed (PubChem does not need it, see section 5).

## 2. Locked decisions (Grant, 2026-06-10)

1. **Editor + engine: Ketcher + RDKit.js.** Ketcher (EPAM, Apache-2.0) is the
   canvas, running standalone on Indigo WASM (Apache-2.0). RDKit.js
   (`@rdkit/rdkit`, BSD-3-Clause WASM) is the cheminformatics engine for
   canonical SMILES, InChIKey, formula, molecular weight, descriptors,
   fingerprints, substructure search, and library thumbnails. **Footprint
   accepted (Grant, 2026-06-10):** the live spike measured ~5.7 MB gzipped on
   first editor open (Indigo 2.99 + RDKit 2.03 + ketcher-react 0.67), which is
   fine for a desktop research app because it is lazy-loaded behind
   `dynamic(ssr:false)` and browser-cached, never on the dashboard. OpenChemLib
   (~1.5 MB) stays the documented fallback only.
2. **ChemDraw formats: CDXML best-effort, skip binary CDX.** Read CDXML through
   RDKit's partial parser plus all standard open formats. Binary `.cdx` shows a
   calm "export as CDXML or MOL from ChemDraw first" message rather than a broken
   import. No GPL dependency (OpenBabel, the only solid binary-CDX reader, is
   GPL-2.0 and conflicts with our AGPLv3, so it is out).
3. **PubChem: live browser-direct search.** Search on demand exactly like the
   NCBI import, every result carries name, CID, SMILES, InChIKey, formula, MW,
   and a 2D depiction, one click imports into the library. No bundled dataset
   (PubChem is 100M+ compounds, a full local index is impractical). A curated
   common-reagents starter set can be revisited later.
4. **Surface: opt-in module + Chemistry hub page.** Gate behind a
   `NEXT_PUBLIC_CHEMISTRY_ENABLED` flag, mirror the inventory opt-in pattern, and
   give it a `/chemistry` hub. Library stored as `users/<u>/molecules/<id>.mol`
   plus a `<id>.meta.json` sidecar carrying `project_ids[]`.

## 3. The recycled-stack research basis

Full report and citations live in the deep-research run from 2026-06-10. The load-bearing facts, all adversarially verified:

| Piece | Choice | License | Client-side | Notes |
| --- | --- | --- | --- | --- |
| Drawing canvas | Ketcher (`ketcher-react` + `ketcher-standalone`) | Apache-2.0 | Yes, Indigo WASM standalone, no server | React component or iframe, JS API via `ketcher-core` |
| Editor backing engine | Indigo (`indigo-ketcher`) | Apache-2.0 | Yes, Emscripten WASM | layout / clean2d / convert / render / aromatize |
| Cheminformatics engine | RDKit.js (`@rdkit/rdkit`) | BSD-3-Clause | Yes, MinimalLib WASM via `initRDKitModule()` | canonical SMILES, InChIKey, descriptors, fingerprints, substructure, SVG depiction |
| Public database | PubChem PUG-REST | public gov API | Yes, browser-direct, `access-control-allow-origin: *` verified live | name to CID to SMILES/InChI/SDF/2D/properties |
| Optional 3D | 3Dmol.js or Mol\* | MIT | Yes | deferred to a later phase |

Rejected and why, so nobody re-litigates it.

- **ChemDoodle Web** core is GPLv3. The MIT `react-chemdoodle` wrapper does no
  chemistry on its own, so it is effectively a GPL dependency. Out.
- **Marvin JS** (ChemAxon) is commercial. Out.
- **OpenBabel-WASM** is the only strong binary-CDX reader but is GPL-2.0, which
  cannot be combined with our AGPLv3 in one program. Out as a bundled dep.
- **JSME** is genuinely BSD (the "custom license" worry was a mix-up with the
  commercial JSDraw), but it is a weaker editor than Ketcher, so it is a fallback
  only, not the pick.
- **OpenChemLib-JS** (BSD, very actively maintained) is a strong lighter-weight
  alternative that bundles editor + viewer + engine in one. We are not using it
  as the primary canvas, but it is the natural fallback if the Ketcher + RDKit
  WASM footprint proves too heavy.

Known risk to track. RDKit.js lost its lead JS maintainer around April 2026 and
is seeking a replacement. The C++ core is robustly maintained, and OpenChemLib-JS
is a drop-in engine fallback if RDKit.js stalls, so this is a watch item, not a
blocker.

## 4. On-disk shape (mirrors the sequence library exactly)

The sequence library is `users/<owner>/sequences/<id>.gb` plus
`<id>.meta.json` (with `project_ids: string[]`) plus `<id>.artifacts.json`, all
read and written through `fileService` JSON helpers
(`frontend/src/lib/sequences/artifacts.ts`,
`frontend/src/lib/sequences/api.ts`). The chemistry library is the same pattern.

```
users/<owner>/molecules/
  <id>.mol              ← the structure, MDL Molfile (v2000) as the canonical on-disk form
  <id>.meta.json        ← sidecar (below)
```

Locked sidecar shape, the contract the project surface reads against:

```ts
export interface MoleculeMeta {
  id: string;
  /** Display name shown in the library + the project surface. */
  name: string;
  /** Collection membership: the projects this molecule is linked to. */
  project_ids: string[];
  /** ISO timestamp the molecule was added. */
  added_at: string;
  /** Cheminformatics identity, computed once on save by RDKit.js. */
  smiles?: string;        // canonical
  inchikey?: string;
  formula?: string;       // Hill formula
  mol_weight?: number;
  /** Provenance, mirrors the NCBI provenance tag on imported sequences. */
  source?: "drawn" | "imported" | "pubchem";
  pubchem_cid?: number;   // set when source === "pubchem"
}
```

Why Molfile and not SMILES as the canonical store. SMILES loses 2D coordinates
and drawing intent. The Molfile keeps the exact atoms, bonds, and layout the user
drew so the editor reopens it pixel-faithful, while SMILES/InChIKey live in the
sidecar for search and dedup. This is the chemistry analogue of storing the real
`.gb` GenBank file, not just the bare bases.

The project link is `project_ids[]`, so a molecule can belong to several
projects, identical to sequences. The Workbench project surface gets a
"Molecules" section next to its "Sequences" section by mapping over a
`moleculesApi.listByProject(projectId)` seam shaped exactly like
`sequencesApi.listByProject` in `frontend/src/lib/sequences/api.ts`.

## 5. PubChem import (the NCBI-import analogue)

PUG-REST is browser-direct CORS-open (verified live 2026-06-10), so this is a
direct mirror of `NcbiDownloadDialog` + `lib/sequences/ncbi-*.ts`, with no proxy
route. A small typed search box (by name, SMILES, InChIKey, or CID) hits:

- `…/compound/name/{name}/property/Title,ConnectivitySMILES,InChIKey,MolecularFormula,MolecularWeight/JSON`
  for the metadata preview (note PubChem renamed `CanonicalSMILES` to
  `ConnectivitySMILES` in 2025+, use the current name).
- `…/compound/cid/{cid}/record/SDF` for the structure on import.
- `…/compound/cid/{cid}/PNG` for the 2D preview thumbnail.

Privacy copy matches the sequences NCBI dialog. The only thing leaving the
browser is the public identifier the user typed, sent to a public government API.
Honor the courtesy limits (~5 req/sec, 400 req/min) with the same client-side
throttle the NCBI client uses.

## 6. The Chemistry hub (`/chemistry`)

Mirrors the `SequencesLauncher` "calm workbench overview" idea, but as a full
page rather than a right-pane empty state, because the user asked for a dedicated
hub. Three regions.

- **Library grid.** Cards of saved molecules with RDKit-rendered 2D SVG
  thumbnails, name, formula, MW, and project chips. Click opens the editor.
  Search filters by name, formula, or substructure (RDKit substructure match
  against the library's stored SMILES).
- **Actions you can take now.** New structure (opens a blank Ketcher canvas),
  Import file (mol/sdf/smiles/inchi/cml/cdxml drop zone, the chemistry analogue
  of `SequenceDropZone`), Search PubChem (the importer dialog).
- **Companion tools, available when a structure is open.** Editor-internal
  helpers surfaced as a hint list the way the sequence launcher advertises
  primers/restriction-sites, here molecular-weight and formula readout, canonical
  SMILES/InChIKey copy, descriptor panel, and optional 3D view.

Gating. `frontend/src/lib/chemistry/config.ts` exports
`CHEMISTRY_ENABLED = process.env.NEXT_PUBLIC_CHEMISTRY_ENABLED === "1" || === "true"`,
default off, exactly like `frontend/src/lib/inventory/config.ts`. The `/chemistry`
route, the nav entry, and the project "Molecules" section all gate on it. Opt-in
discovery rides the existing interest-based feature picks
(`frontend/src/lib/onboarding/feature-picks-tabs.ts`).

## 6b. Literature and patent discovery (the SciFinder-gap companion)

Added 2026-06-10 after Grant flagged that his chemist friend's favorite paid
SciFinder feature is substructure-or-compound to literature search. Decision rule
(Grant): if PubChem already does it free, we just wire it; if it is free
elsewhere but unpackaged, we build the convenience layer; if it is genuinely
CAS-proprietary, we do not pretend to replicate it. A verified deep-research pass
(2026-06-10, full report in the run output) settled each item, with live CORS
checks. The headline result is that the most valuable capability is free and
browser-direct, no backend.

| SciFinder capability | Verdict | Free source (CORS-open, no key) |
| --- | --- | --- |
| Compound to papers + patents | ALREADY FREE in PubChem, wire it | PUG-REST `xrefs/PubMedID` and `xrefs/PatentID`, PUG-View `?heading=Literature` / `?heading=Patents` |
| Substructure to matching compounds | ALREADY FREE in PubChem, wire it | PUG-REST `fastsubstructure/smarts/...` (sync) or async ListKey poll, accepts SMARTS |
| Substructure to papers (the chained pipeline) | BUILD the layer over free pieces | substructure to CIDs (PubChem) then each CID to its literature/patent links |
| Richer full-text chemical mentions | BUILD the layer | Europe PMC Annotations API (SciLite), text-mined chemicals across 10.2M full-text articles, `annotationsByEntity?entity=...&type=Chemicals`, CORS-open, no key |
| Patent chemistry search | BUILD the layer (partial) | SureChEMBL, 28.5M compounds / 28M patents, `POST /search/structure` by SMILES/SMARTS, CORS-open, no key |
| Advanced query control (lock atom/ring, variable attachment, X/Q/A atom types) | BUILD it client-side (mostly) | RDKit.js SMARTS + Ketcher query mode. Caveat, some CAS variable-atom abstractions (Ak any-carbon-chain, Cy any-cyclic) map awkwardly or not at all to SMARTS. Needs a small targeted spike. |
| Markush / generic patent-structure deconstruction | CANNOT replicate, be honest | CAS-proprietary. SureChEMBL indexes specific extracted compounds, not generic claim scope |
| CASREACT reaction substructure + atom mapping + manual curation back to 1900s | CANNOT replicate, be honest | CAS-proprietary. No free CORS-open reaction-curation API found |

Locked scope (Grant, 2026-06-10). Position it as a **first-class hub mode plus an
editor-rail panel**, a dedicated "Find in literature" search in the `/chemistry`
hub (draw a fragment or pick a compound, see papers and patents) AND a "Papers and
patents" tab in the editor companion rail for whatever structure is open. Query
**all three free sources in v1**, PubChem links + Europe PMC Annotations + SureChEMBL.

So the companion to build is "draw a fragment or pick a compound, see the papers
and patents that mention it," assembled entirely client-side from PubChem +
Europe PMC + SureChEMBL. It will not match CAS curation depth, and the copy must
say so plainly (state the honest limit, the no-CAS-curation reality, in the WHY
voice). What it gives a researcher for free is the thing they currently pay a
heavy SciFinder seat for.

Verified live 2026-06-10 (driven by curl, real responses, CORS headers checked).

- PubChem papers + patents, browser-direct, `access-control-allow-origin: *`.
  `…/compound/cid/{cid}/xrefs/PubMedID/JSON` (aspirin returned 26,452 PMIDs),
  `…/xrefs/PatentID/JSON` (aspirin returned 111,159 patents). Substructure feeds
  this via `…/compound/fastsubstructure/smarts/{query}/cids/JSON`.
- Europe PMC Annotations, browser-direct, `access-control-allow-origin: *`, no key.
  `https://www.ebi.ac.uk/europepmc/annotations_api/annotationsByEntity?entity={name}&type=Chemicals&format=JSON`
  returns articles with exact text spans + ontology URIs + pmcid, paginated by
  `cursorMark`.
- SureChEMBL patents, browser-direct, `access-control-allow-origin: *` (POST
  allowed), no key. ASYNC submit-then-poll, like PubChem's ListKey.
  `POST /api/search/structure` with body
  `{"StructureSearchRequest":{"struct":"<SMILES/SMARTS>","structSearchType":"substructure","maxResults":N,"query":""}}`
  (note the Jackson root wrapper `StructureSearchRequest`, an un-wrapped body 400s)
  returns `{data:{hash}}`, then `GET /api/search/{hash}/status` and
  `GET /api/search/{hash}/results`, and `POST /api/search/documents_for_structures`
  maps structures to patent documents.

Firehose design note. A common compound returns tens of thousands of papers and
hundreds of thousands of patents (aspirin, 26k / 111k above). The UI must default
to a ranked, paginated view (most recent, or co-occurrence-scored), never dump the
full set, and show the total count as context. A substructure query is even
broader, so cap and page the matched-compound set before fanning out to links.

Honest-limit copy to bake in. Europe PMC chemical annotations cover open-access /
CC-licensed full text plus all abstracts, not every paywalled PubMed article.
PubChem links are curated co-occurrence + depositor data. SureChEMBL is extracted
specific compounds, not Markush scope. We surface what is free and say what it is
not, no overstating.

Time-sensitive note. OpenAlex started requiring a free API key on 2026-02-13, so
it is no longer cleanly anonymous browser-direct, embedding a key in client JS
leaks it. Prefer Europe PMC and PubChem (both anonymous, CORS-open) for the
browser-only path; Crossref is the anonymous fallback if we want DOIs.

## 7. Embedding the editor like live-markdown

The user's anchor is "similar to how we have the livemarkdown editor." Two embed
points beyond the hub.

- **Inline in notes and results.** A molecule block the way images embed today, a
  read-only RDKit SVG depiction that opens the full Ketcher canvas in a
  `LivingPopup` on click. This is the live-markdown-editor parallel, a rich
  object living inside the markdown surface.
- **The project "Molecules" section.** Same place sequences appear on a project.

Next.js + WASM gotchas to pre-empt (from the research open questions). Ketcher and
both WASM engines are client-only, so every mount is a `dynamic(() => …, { ssr:
false })` boundary to avoid "window is not defined". RDKit's `.wasm`/`.js` assets
get copied into `public/` and loaded with an explicit `locateFile`, the
documented Next.js setup. Thumbnail generation for a large library grid runs in a
web worker so it never blocks the main thread.

## 8. Suggested phasing

Each phase lands on `main` behind the flag and is independently verifiable, the
same discipline as the sequence-editor and inventory arcs.

- **Phase 0, seam + flag.** `lib/chemistry/config.ts` flag,
  `moleculesApi.listByProject` empty seam (shape locked, returns `[]`), the
  `MoleculeMeta` type. No UI. Lets the project surface wire the "Molecules"
  section against a locked contract immediately, the way the de-bloat arc wired
  against the sequences seam.
- **Phase 1, editor + library persistence.** Ketcher canvas in a popup, RDKit.js
  engine wired, real `molecules/<id>.mol` + `.meta.json` read/write, the
  `/chemistry` hub with the library grid and New/Import. This is the flagged
  data-shape change, verify before merge.
- **Phase 2, PubChem importer.** The search dialog + browser-direct PUG-REST
  client + one-click import with provenance.
- **Phase 3, embedding + project links.** Inline molecule blocks in notes/results
  and the project "Molecules" section.
- **Phase 4, companion tools + polish.** Descriptor panel, substructure search
  across the library, optional 3D view, wiki page.

## 9. Validation status + open items

**Stack validated live (2026-06-10).** The spike at
`docs/spikes/chemistry-stack-spike.html` proved, by driving the real page, that
RDKit.js runs fully client-side (aspirin parsed and depicted, correct canonical
SMILES / InChIKey / MW) and that PubChem PUG-REST imports browser-direct with no
proxy (caffeine CID 2519 round-tripped through RDKit, InChIKey matched). Footprint
measured and accepted (see section 2). React 19 is officially supported by
ketcher-react (`^18.2.0 || ^19.0.0`), and RDKit has zero deps. Licensing clean.

Open items before building.

- An interactive UI mockup of the `/chemistry` hub and the editor popup for Grant
  to mark up before any code, per the standing UI-redesign-review convention.
- The one remaining technical risk is embedding the full Ketcher **React canvas**
  inside the live Next.js app (web workers + wasm asset paths). Metadata fit is
  confirmed, but the real embed gets validated as the first action of Phase 1
  when we install the deps for real (Grant's go-ahead to add the three packages).
- A wiki page (`/wiki/features/chemistry`) and screenshots, held until the UI
  settles, same as the sequences wiki was held.
