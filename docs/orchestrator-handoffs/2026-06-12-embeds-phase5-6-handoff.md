# Orchestrator handoff, markdown embeds Phase 5 + Phase 6 (export baking + share-with-dependencies)

Date: 2026-06-12 (late). Written near a usage limit so another session can pick up cleanly. This continues the markdown + ResearchOS embed system (the earlier handoff `docs/orchestrator-handoffs/2026-06-12-markdown-embeds-handoff.md` covered Phases 1-4 on origin). This session built Phase 5, all of Phase 6 except 6d, plus a loopback integration test.

## Verify first (the shared checkout was flapping at session end)

Everything below is on LOCAL main, UNPUSHED (origin/main is stale at `2f800472e`). The single `main` checkout is shared by many concurrent sessions (datahub, billing, checkins, etc.) that land merge commits every 1-2 minutes; at session end the refs were observed flapping (one read briefly showed main reset to the session-start commit `7e61ffedd`, then it settled). My work IS durable. The verification anchor is commit **`2bb5d6669`** (the loopback test), which is the tip snapshot containing ALL of this session's Phase 5/6 work.

```
git merge-base --is-ancestor 2bb5d6669 main && echo "Phase 5/6 on main, good" || echo "RECOVER (see SHAs below)"
```

If it is NOT on main, a concurrent session reset main; recover by fast-forwarding or cherry-picking from the SHAs listed under "Commits" below (2bb5d6669 contains them all).

## What is built + on local main this session

All gate-verified (tsc 0, the named test suites green), NOT browser-verified beyond the loopback simulation. House voice throughout (no em-dashes, no emojis, no mid-sentence colons).

### Pre-Phase-5 cleanup
- **Phase 4 backlinks wiring** (`3badc7991`): the shared `<ObjectBacklinks>` "Referenced in" panel is now on all three detail surfaces (molecule `MoleculeDetail.tsx`, sequence `sequences/page.tsx`, method `methods/page.tsx`). Recovered from the in-flight sub-bot of the prior handoff. This closed Phase 4.

### Phase 5, export/publish baking (`a5c7d23a9`)
Grant locked: targets = PDF + Zenodo; citations = internal "Referenced objects" list (NO external DOI/literature). When a note/results body is exported to PDF (and therefore the Zenodo deposit, which reuses `buildPdf`), every embedded object is baked into a self-contained figure.
- New `frontend/src/lib/export/bake-embeds.ts`: `BakedEmbed` union (image|table|text|card|missing), `scanEmbedRefs`, `bakeAllEmbeds(string[]) -> Map keyed by href`, DOM-guarded `svgToPngDataUrl`.
- `pdf.ts`: pre-bake pass in `buildPdf`, a `renderBakedEmbed` walker case in the paragraph handler, and a "Referenced objects" appendix + TOC entry.
- Bakes molecule (RDKit `get_svg` -> PNG) and datahub plot (`renderPlotSvg` -> PNG) as images; datahub table as a native PDF table; datahub result as native text; note/method/project/task/etc as native cards; missing -> calm card.
- The two inline `<svg>` (sequence ribbon + test fixtures) are SVG strings for rasterization, added to `frontend/icon-svg-baseline.json` like `plot-spec.ts` (NOT icons).
- 110 export+embed tests green. **VERIFICATION GAP: the image rasterize path only runs in a REAL browser export (jsdom throws CanvasUnavailableError), so the actual figures + the hand-rolled sequence ribbon need a real PDF export to eyeball.** Deferred: method-body embeds, the Zenodo DataCite description line.

### Phase 6, share-with-dependencies (D1-D8 all approved by Grant)
Decisions doc: `docs/proposals/2026-06-12-phase6-share-with-dependencies.md`. Mockup: `docs/mockups/2026-06-12-share-with-dependencies-decisions.html`. The flow: a shared note carries the objects it embeds; sender trims dependencies; recipient recreates-or-links them.

- **6a foundation** (merge `79451dc3b`, fix `01518da61`): `source_uuid` optional field on Note/Method/Project/Task (minted at create, lazy-backfilled on read), `lib/sharing/portable-identity.ts` (`portableIdentityFor` reuses InChIKey for molecules / seq fingerprint for sequences / `source_uuid` otherwise; `resolveByPortableId`), `lib/sharing/can-view.ts` (`canViewObject` consolidating per-type ACL via the real `canRead`), `lib/sharing/note-dependencies.ts` (`scanNoteDependencies`). **I CAUGHT + FIXED a real bug in the bot's work: the backfill wrote a minted source_uuid into ANOTHER user's folder on read (cross-owner read-mutation + nondeterministic-id race); now it persists ONLY for own-store records (cross-user reads return unchanged; the method helper takes currentUser to tell own from public/foreign).** Data-shape, Grant approved the merge. ONE-TIME behavior: each existing record gets a background source_uuid stamp the first time it is read after this lands.
- **6b-1 bundle contract** (merge `dce7e51e5`): `BundleEmbeddedObject` on `bundle.ts` (`embeddedObjects?` optional on `BuildBundleInput`, required on `ReadBundleResult`, carried in RO-Crate metadata + file payloads under `objects/` in the BagIt bag), `collectEmbeddedObjects` (`embedded-object-collect.ts`) wired into `buildNoteBundleInput` with optional `excludeHrefs`/`fullDataHrefs` (D1 include-all default, D8 datahub snapshot default + opt-in full).
- **6b-2 sender panel** (in merge `68fcfbd80` area, branch SHA `c59937ad8`): `NoteDependencyPanel.tsx` + `SendOutsideDialog` wiring, the "This note references" include/deselect list + datahub full-data checkbox, passing `{ embedOpts: { excludeHrefs, fullDataHrefs } }` to `buildNoteBundleInput`. Reused registry icons (no new ones).
- **6c recipient import** (merge `68fcfbd80`, branch SHA `67d329898`): relay `ReceiveShareResult` now carries `embeddedObjects`; `embedded-object-import.ts` `importEmbeddedObjects` (D4 link via `resolveByPortableId` else recreate per type, D3 file into a "Shared by <sender>" project, rewrite the note's embed hrefs preserving the `ref=` identity, skip datahub-snapshot + file, never throws); wired into `importNoteBundle`.
- **Loopback integration test** (`2bb5d6669`, `share-with-deps-loopback.test.ts`): the real `buildBundle -> sealToRecipient -> openSealed -> readBundle -> importEmbeddedObjects` path (only the network relay and the leaf create APIs mocked). GREEN. Proves seal/open is lossless, embedded objects survive crypto + bag serialization byte-identical, and import links dups / imports new / skips snapshots + files. It also caught the real `moleculesApi.create` return shape (`{ meta: { id } }`).

## Commits (recovery list, all reachable from 2bb5d6669)
`3badc7991` backlinks wiring; `a5c7d23a9` Phase 5 baking; `79451dc3b` 6a merge (+ `01518da61` the cross-owner fix inside it); `dce7e51e5` 6b-1 merge + ai-helper; `68fcfbd80` 6b-2 + 6c merge; `2bb5d6669` loopback test. Plus several `chore(ai-helper)` regenerations (the autogen schema_hash changes whenever a new lib type lands; regenerate with `node frontend/../scripts/build-ai-helper.mjs` + `check-ai-helper.mjs`).

## Grant's pending action
A TRUE 2-browser test TOMORROW: send a note embedding a molecule + sequence + datahub result from account A, accept on B, confirm embeds light up (with a dedup "link existing"). The loopback covers everything EXCEPT the live `/api/relay/*` endpoints, the email->pubkey directory lookup, real FSA writes, and the accept/picker UI. Do not re-verify those headlessly; they need his hardware.

## Remaining work
- **6d, no-access placeholder**: a calm name-only card in the embed renderers when `canViewObject` is false OR the embed did not arrive in the bundle (excluded/deferred). Embeds are already leak-safe (a missing load returns null -> card showing only the name). Build this in the embed renderers (`components/embeds/*`); the orchestrator registers renderers, so a sub-bot should create the placeholder component and the orchestrator wires it.
- **6c per-item picker UI follow-up**: `destinationByHref` is plumbed end-to-end through `importNoteBundle -> importEmbeddedObjects`; only the UI to build that map is stubbed (TODO in `SharedWithMeTab.tsx` + `app/accept/[inviteId]/page.tsx`). Default behavior (auto "Shared by <sender>" + auto-link dups) works without it.
- **Known limitations baked in (by design, document if surfaced to users)**: method embeds import as a name/type STUB (body not serialized; full method body is the existing `buildMethodSendPayload` path); task/experiment carry metadata only; datahub embeds arrive as a frozen snapshot card, not a live re-runnable doc; `MoleculeSource` has no "received" value so a received molecule uses `"imported"` (a follow-up could add the value); `resolveByPortableId` returns null for datahub/file so those never dedup.
- **Phase 7 polish** (later, design-heavy): pin + staleness badge, transclusion (`![[note#heading]]`), in-place view switching, external/literature embeds (DOI/PubMed/PubChem/URL), BeakerBot authoring, mobile + a11y.

## Gotchas / lessons (READ before integrating on the shared main)
1. **The shared main checkout is a treadmill.** Concurrent sessions land merge commits every 1-2 minutes, so `git merge --ff-only` of a worktree branch almost always loses the race. The working pattern this session: `git merge <worktree-branch> --no-edit` FROM the main checkout (the same pattern the other sessions use; you will see `Merge branch 'worktree-agent-...'` commits on main). ALWAYS `git branch --show-current` and check for a foreign `MERGE_HEAD` before starting (if another session's merge is in progress, WAIT, do not touch it). Refs can flap mid-read; take multiple reads.
2. **ai-helper autogen** changes its schema_hash whenever a new lib type/export lands (Phase 5 BakedEmbed, 6a source_uuid, 6b-1 BundleEmbeddedObject, 6c ReceiveShareResult). The build gate `check-ai-helper.mjs` FAILS the deploy on drift. After any merge that adds a lib type, regenerate (`build-ai-helper.mjs`) and commit the 4 `public/ai-helper/*` files. Do NOT run full `prebuild` (wiki-coverage etc. can fail on unrelated drift); run the ai-helper scripts directly.
3. **Cross-owner reconcile is owner-only.** Any lazy-normalize/backfill that writes a field on read MUST only persist for the current user's own records; never write into another user's folder on a read (it mutates data you do not own and races the owner). The 6a backfill bug was exactly this.
4. **Worktree sub-bots committed properly this session** (unlike some earlier ones) but TWO finished without committing in the past; always check `git -C <worktree> status` and grab the branch commit. Bots' tests sometimes mock at the wrong shape (the loopback caught `moleculesApi.create` = `{ meta: { id } }`); verify bot work yourself, do not trust the report alone.
5. **Data-shape changes wait for Grant's verification before merge**; additive wire-format and pure-logic changes can merge on report. 6a (record field) waited; 6b-1/6b-2/6c/loopback (wire format + UI + logic) merged on report.

## Pointers
- Memory: `~/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/project_markdown_embed_hybrid.md` (the full running log) and `MEMORY.md` index.
- Phase 6 decisions + build plan: `docs/proposals/2026-06-12-phase6-share-with-dependencies.md`.
- Phase 6 mockup (interactive, marked-up): `docs/mockups/2026-06-12-share-with-dependencies-decisions.html`.
- The parent embed design: `docs/proposals/2026-06-11-markdown-embed-hybrid.md`; BeakerBot author guide: `docs/proposals/2026-06-11-beakerbot-embed-integration.md`.
- Prior handoff (Phases 1-4, on origin): `docs/orchestrator-handoffs/2026-06-12-markdown-embeds-handoff.md`.
