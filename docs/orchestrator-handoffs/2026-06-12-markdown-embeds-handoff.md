# Orchestrator handoff, markdown + ResearchOS embed system

Date: 2026-06-12 (early AM). Written because the session is near its usage limit; this lets another account pick up cleanly.

## TL;DR of session state

- `main` == `origin/main` == `88f3d79d4` (verify with `git rev-parse --short main origin/main`). Everything below is pushed.
- The **markdown + ResearchOS embed system** (a Notion/Obsidian-style live-preview where object references render as rich cards) is BUILT and on origin through Phase 1, 2, 3, the captions/numbering polish, and the Phase 4 backlinks foundation.
- ONE background bot was running when we paused (see "In-flight work"). It may be lost on an account switch, recover or re-dispatch it.

## What is built + on origin (do not rebuild)

Full design proposal: `docs/proposals/2026-06-11-markdown-embed-hybrid.md`. BeakerBot integration guide: `docs/proposals/2026-06-11-beakerbot-embed-integration.md`.

- **Phase 0, format + parser** (`frontend/src/lib/references.ts`): `objectEmbedMarkdown(type, id, name, {view})` builds `[caption](/deeplink#ros=view)`; `parseObjectEmbed(href)` -> `{type, id, view, isEmbed, opts}`; `DEFAULT_EMBED_VIEW`. Plain `[name](/path)` (no fragment) = inline chip, backward compatible.
- **Phase 1, preview block embeds** (`frontend/src/components/embeds/`): `ObjectEmbed.tsx` is the dispatcher (a `<figure>`) + lazy per-type renderer registry + generic `ObjectEmbedCard` fallback. RenderedMarkdown.tsx `p` override renders a lone-embed-link paragraph as a block embed, `a` override renders inline chips, `img` override renders native images (with caption + `#w=` width). Picker (`ReferencePicker.tsx`) has a Mention/Embed toggle, defaults to Embed.
- **Phase 2, editor live-preview** (`frontend/src/lib/markdown/cm-inline-reveal/`): `embed-widget.ts` (block embed widget, mounts the React ObjectEmbed via createRoot), `object-chip-widget.ts` (inline mention chip, static DOM). Wired in `inline-reveal.ts` (buildBlockDeco for block embeds, buildDeco for inline chips). Reveal-on-caret like the existing table/image widgets.
- **Rich renderers, every type except file**: molecule (RDKit structure), sequence (feature ribbon), datahub (table + plot via `renderPlot`, + result via `resultToText`/`plainLanguageSummary`), note, method, project, collection, task, experiment. File uses the generic card (no clean load-by-id). All lazy, all degrade to the card when the object is missing.
- **Chip hover-cards** (`ChipHoverCard.tsx` + `ObjectChip.tsx`): lazy per-type preview on hover.
- **Captions + numbering polish**: `EmbedCaption` (in ObjectEmbed) renders a `<figcaption>` for figure-type embeds when caption != name OR numbering is on. Numbering is opt-in per doc via the `<!-- ros:number-figures -->` directive, inserted/removed by the "Number figures" toolbar toggle (`LiveMarkdownEditor.tsx`) and HIDDEN in the editor via `stamp-hide.ts`. `lib/embeds/figure-numbering.ts` is the plan builder; RenderedMarkdown assigns labels in document order.
- **Phase 4 backlinks foundation** (88f3d79d4): `lib/object-backlinks.ts` `scanBacklinks(type, id)` (generalized from the molecule scan) + `ObjectBacklinks.tsx` reusable "Referenced in" panel. `molecule-backlinks.ts` now delegates to it.

~150 tests across the feature, all green. tsc clean on all embed files. icon-guard clean.

## In-flight work (IMPORTANT on account switch)

A background sub-bot was dispatched and was STILL RUNNING at pause:

- **agentId `a99c87b5b639b39db`** (branch `worktree-agent-a99c87b5b639b39db`, worktree `.claude/worktrees/agent-a99c87b5b639b39db`). Task: wire `<ObjectBacklinks>` into 3 detail surfaces.
  - To RECOVER if it finished: `git log --oneline worktree-agent-a99c87b5b639b39db` to find its commit; the files are `frontend/src/components/chemistry/MoleculeDetail.tsx` (replace the inline "Used in" with `<ObjectBacklinks type="molecule" id={molecule.id} className="mt-6" showEmpty />`, removing the dead state/effect), `frontend/src/app/sequences/page.tsx` (add `<ObjectBacklinks type="sequence" id={String(selected.id)} className="mt-3" />` in the open-sequence header), `frontend/src/app/methods/page.tsx` (add `<ObjectBacklinks type="method" id={String(method.id)} className="mt-4" />` in the method detail).
  - Integration pattern (see "Gotchas"): copy its files into the main checkout, CHECK they did not clobber another session's edits to those big files, run tsc/icon-guard/tests, commit with explicit pathspecs, push.
  - If it was lost, re-dispatch with the same instructions (above).

## Decisions locked this session

- Embed format = URL-fragment links; render in editor AND preview; live-with-pin freshness; caption = link text; numbering opt-in PER DOCUMENT; default views sequence=map, molecule=card; chip hover in Phase 1. (All built.)
- Phase 4 = backlinks ONLY. The share-safety pieces (share-time dependency warning + clearer no-access placeholder) are FOLDED INTO PHASE 6 (share-with-dependencies), since they share the same intricate share dialog and the per-type access model. Note: embeds are ALREADY leak-safe (a no-access object load returns null -> calm card showing only the name, which is already in the readable note text; no data is rendered).
- File embeds intentionally use the generic card (filesApi has no clean load-by-id from `/files/ID`).

## Remaining work (later phases, design-heavy)

From the proposal, Phases 5-7:
- **Phase 5, export/publish baking**: freeze embeds to self-contained figures/tables for PDF, Word, LaTeX export + the publish/Zenodo/transparency paths, with captions, numbers, a bibliography from citation embeds, provenance stamps.
- **Phase 6, share-with-dependencies + share-safety**: bundle a note + its embedded objects into one cross-boundary package (recipient picks each item's collection); the share-time dependency warning; permission-aware "no access" placeholder; the portable-identity resolver (`ref=` fragment, so a received object lights up its embeds by content identity, InChIKey/content-hash/origin-uuid); request-access flow; reconcile same-folder shares to the project-less inbound rule.
- **Phase 7, polish**: pin + staleness badge, transclusion (`![[note#heading]]`), in-place view switching, BeakerBot authoring, mobile + a11y. Also: external/literature embeds (DOI/PubMed/PubChem/URL), datahub result-view richer formatting, file-embed reshape (pdf inline / csv-as-table / notebook).

These need Grant's input on UX (especially Phase 6 share flow). Do NOT fire-and-forget them.

## Gotchas / lessons (READ before committing)

1. **Shared working tree, CHECK THE BRANCH.** This repo's single checkout is shared by multiple concurrent sessions and gets switched between `main` and feature branches. ALWAYS run `git branch --show-current` before committing. Once a commit landed on a `fix/...` branch because the tree was not on main; recovered with `git push origin <sha>:main` (fast-forward, since it was parented on origin/main) + `git update-ref refs/heads/main <sha>`. Stage explicit pathspecs only, NEVER `git add -A` (sweeps other sessions' dirty files + symlinked node_modules).
2. **`WorkbenchExperimentsPanel.tsx` is broken** on the tree (mid-edit by another session, ~29 tsc errors, undefined names). NOT ours. A full `npx tsc --noEmit` shows those, ignore them; filter to your own files (`| grep <yourfile>`).
3. **Never run `update-icon-baseline.mjs` wholesale** on the shared tree, it regenerates from the current (dirty, multi-session) state and sweeps in other sessions' svg-count changes. For a legit data-viz svg, `git checkout HEAD -- frontend/icon-svg-baseline.json` then hand-add the single entry.
4. **Parallel-bot integration pattern**: dispatch sonnet bots with `isolation: worktree`, `run_in_background`, a detailed brief telling them to create files only (NOT edit `ObjectEmbed.tsx`, the orchestrator registers renderers), symlink node_modules for tests (`ln -s /Users/gnickles/Desktop/ResearchOS/frontend/node_modules frontend/node_modules` + root), commit on their branch. On integration: copy files (or `git show <branch>:<path>` if the worktree was cleaned), register in `ObjectEmbed.tsx` `EMBED_RENDERERS`, verify, commit explicit paths, push. Bots ran on disjoint files to avoid conflicts.
5. **Gates**: tsc clean on your files, `node frontend/scripts/icon-guard-precommit.mjs` exit 0, vitest green. House style everywhere: no em-dashes, no emojis, no mid-sentence colons.
6. Commit body sign-off: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Do NOT push unless Grant asks (he asked throughout this session, so embeds are pushed).

## Pointers

- Memory index: `~/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/MEMORY.md`, especially `project_markdown_embed_hybrid.md` (the full running log of this feature) and `project_seamless_object_export.md`.
- Separate, already-resolved this session: the demo-notes "body in description" bug (fixed at the generator source `scripts/generate-demo-data.mjs` via `relocateStuffedNoteBodies`, regenerates both public/demo-data and the wiki-capture fixture; on origin). Demo must be re-seeded (fresh tab) to show fixes.
