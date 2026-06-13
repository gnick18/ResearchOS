# Orchestrator handoff, markdown embeds: Phase 7 complete + embed-UX pass + OPEN transclusion crash

Date: 2026-06-13 (early). Continues the markdown + ResearchOS embed lane. The session this inherits from finished Phase 6 + four of six Phase 7 sub-phases (handoff `docs/orchestrator-handoffs/2026-06-12-embeds-phase6-7-handoff.md`). THIS session: finished Phase 7 (P7-4 external embeds + P7-6 a11y), shipped a batch of Grant-requested embed-UX changes, fixed several bugs surfaced by browser verification, and is leaving ONE critical OPEN bug (a transclusion-only infinite-render crash) that needs a stack trace to finish.

## Verify first (shared checkout is a treadmill)

Everything is on LOCAL main, UNPUSHED. The single `main` checkout is shared by many concurrent sessions landing merges every 1-2 min. Confirm this session's work is reachable:

```
git merge-base --is-ancestor f3d11822b main && echo "embeds session work on main, good" || echo "RECOVER from the Commits list"
```

If not reachable, cherry-pick from the Commits list below.

## What is DONE + on local main this session (all gate-green: tsc 0, named suites pass)

### Phase 7 finished
- **P7-4 external / literature embeds** (DOI/PubMed citation cards via Europe PMC, PubChem-CID + bare-SMILES structure cards via RDKit with Add-to-library, bare-URL link preview). New parallel external lane `lib/embeds/external-embeds.ts` (+ `external-cache.ts` reusing the `<note>.ros-embeds.json` sidecar, `external-fetch.ts`), components `CiteCard`/`StructureCard`/`LinkCard`/`ExternalEmbed`, wired in `RenderedMarkdown.loneEmbedFromParagraph` (external only fires when `#ros=` present; internal path byte-unchanged). I fixed a real bug the bot missed: a bare SMILES returned null (isExternalHref gate ran before the structure branch), now allowed only with explicit `#ros=structure`.
- **P7-6 mobile + a11y** pass over all embed renderers (figure/image aria-labels, name-derived alt, focus-visible rings, role=img/group, min-w-0 responsive). Read-only audit found no leaked editable chrome.
- **Preview now renders embeds** (`merge a39ed6325`/`07feeb2ea`): the note "Preview" toggle used plain `ReactMarkdown` (no embeds, raw `![[ ]]`); now routes through the embed-aware `RenderedMarkdown` (image click-to-resize + stamp-strip preserved, pin sidecar forwarded). This was the actual cause of an early "transclusion/embeds don't render" verifier report (they had tested Preview mode, which was never embed-wired).
- **Open link stays clickable while an embed loads** (`539f02e5e`): P7-6 had hidden it during load; the deep link is known up front, so restored.
- **a11y label colons removed + tests realigned** (`153982008`): the new aria-labels used mid-sentence colons (house-voice violation, they are screen-reader copy); also requeried 8+ embed tests off the old "Open" accessible name.

### Grant-requested embed-UX changes
- **Clicking an embed no longer edits the markdown** (`b450d82cf`). CM6 `EmbedWidget.ignoreEvent` returns true for MouseEvent AND a `mousedown` preventDefault on the widget wrapper for non-control targets (a/button/input/textarea/select pass through), so a click on the body or the molecule SVG never moves the caret (which was revealing source via the browser's native contenteditable selection). Grant CONFIRMED this works.
- **"Edit markdown" button** (bottom-left, pencil) added to embeds (only in the editor host); it places the caret in the source line to reveal raw markdown on demand. Keyboard caret still reveals.
- **Pin -> Freeze rename, DISPLAY COPY ONLY** (Freeze/Unfreeze, "frozen <date>", Re-freeze, "since you froze this"). Internal identifiers + the persisted `#ros=pin` fragment + `.ros-embeds.json` sidecar UNCHANGED (no migration, existing frozen embeds keep working).
- **Inserting a block embed auto-drops it on its own line** (`e2e739eb0`): new `isBlockEmbedMarkdown(md)` helper in `references.ts`; the editor `insertRef` wraps a block-embed insert with a blank line above + below and leaves the caret below, so it renders as a card immediately (no more inline-chip surprise). Inline mentions unchanged. Grant CONFIRMED.

### Bug fixes surfaced by verification
- **Picker duplicate-key crash** (`da5278d71`): private (`methodsStore`) and public (`publicMethodsStore`) methods share an id-space, so private id 1 and public id 1 both keyed `method-1` -> React "two children with same key". Now `method-priv-N` / `method-pub-N`.
- **Public method references resolve to the right method** (`98f2697f8`, closes chip `task_5632a884`): a public method ref produced `/methods/1` which resolved to the same-id PRIVATE method (private checked first). Added `methodRefId`/`splitMethodRefId` (public gets a `public:` prefix), scope-aware across the picker, MethodEmbed, ChipHoverCard, and BeakerBot's artifact-index deepLink (brief `id` stays numeric so `read_method` is unaffected). NOTE: touches `lib/ai/artifact-index.ts` (BeakerAI lane) minimally.
- **Editor broken-image-scan setState-loop trap** (`f3d11822b`, closes chip `task_84b7adfc`): `LiveMarkdownEditor`'s broken-image scan effect both depended on `onChange` and called it, and `NoteDetailPopup` passed an unstable inline `onChange`. Now the scan reads `onChange` from a ref (dropped from deps) and NoteDetailPopup passes the stable `updateEntryContent` directly. Regression test added. Browser-verified zero "Maximum update depth" on a normal note.

## THE OPEN BUG (critical, hand this off as priority 1)

**Transclusion-only infinite-render crash.** After the editor loop-trap fix above, plain note editing + `## heading` persistence WORK (Grant verified: heading saves, persists across close/reopen). BUT a TRANSCLUSION still crashes:

- Typing `![[Note Title#Heading]]` in a note, or OPENING a saved note that contains a normalized transclude link `[Heading](/notes/<id>#ros=transclude&section=Heading)`, fires **"Maximum update depth exceeded"** in `NoteDetailPopup.updateEntryContent` via the `InlineMarkdownEditor` updateListener (`onChangeRef.current?.(next)`, around `InlineMarkdownEditor.tsx:642`). Reproduces 100%.
- The transclusion NORMALIZE works correctly: `![[ ]]` -> `[Materials](/notes/3#ros=transclude&section=Materials)` is generated and persists across save/reopen. So Part B (normalize-on-save, `201bdedec`) is fine.
- The crash is the RENDER path: my normalize fix now lets transclusions reach the rendered `#ros=transclude` state in the CM6 editor for the FIRST time, which exposes a loop. `TransclusionEmbed.tsx` itself looks clean (stable effect deps, standard load->render); the loop is in how the CM6 embed widget / Loro machinery re-dispatches the doc when a transclude embed is mounted in the editor. I could NOT pin the exact re-trigger statically (Loro + CM6 runtime), and it cannot be reproduced headlessly.

**Next step = get the full stack trace** (it reproduces 100% just by opening the saved note). The capture prompt is below. The frames BETWEEN the two `updateEntryContent` calls + the React "The above error occurred in the <X> component" block will name the looping component. Then fix at the source.

**Stopgap offered, not yet done** (Grant can choose): make the CM6 editor render a transclude link as a plain inert chip (no live `TransclusionEmbed` mount in the editor), with the live section still rendering in read-only Preview. That kills the crash immediately while the real loop is diagnosed. Implement in `embed-widget.ts` / the `ObjectEmbed` transclude early-return guarded on "is this an editor host".

### Capture prompt for the trace (give to Grant or a Claude-in-Chrome session)
```
In /demo:
1. DevTools Console open, click clear, ensure "Errors" level on.
2. Open the saved note containing [Materials](/notes/3#ros=transclude&section=Materials)
   (crash fires on open).
3. Fully expand the FIRST "Maximum update depth exceeded" and copy the ENTIRE stack,
   every "at <name> (path:line)" line. Most important: the frames between the first
   and second updateEntryContent.
4. Paste the "The above error occurred in the <X> component:" block if present, and
   the Next.js red overlay "Call Stack" if shown. Do not Send Report.
```

## Open chips (queued this session, not started)
- `task_84b7adfc` editor loop-trap hardening -> DONE + committed `f3d11822b` (chip can be dismissed).
- `task_5632a884` public-method deep-link -> DONE + committed `98f2697f8` (chip can be dismissed).
- `task_46c70900` SMILES-direct RDKit import for the structure card "Add to library" (a bare SMILES currently makes an empty-geometry stub). Still open.
- `task_b6cab214` demo /demo 404 flood -> DONE by another bot (per-user `results/_index.json`), can be dismissed.

## Grant's pending browser verifies (cannot be orchestrator-verified)
1. **Transclusion end-to-end** -> currently FAILS (the open crash above). The decisive thing.
2. Phase 6 two-browser share, P7-1 pin/staleness, P7-4 external embeds rendering, auto-newline insert (all unverified or partially verified; the Freeze rename + click-safety + heading persistence are CONFIRMED).
3. Demo molecule library at `/chemistry?molecule=4` shows "not in this library" in demo, so the Freeze stale/re-freeze sub-check could not be completed in demo (the fixture's reference molecules are not in that surface). Use a real folder or a different molecule to test stale/re-freeze.

## Gotchas / lessons (reaffirmed HARD this session)
1. **Treadmill bit again**: a concurrent session's `git commit` flushed my `git merge --no-commit` staged merge through (the transclusion merge landed as `201bdedec` in the linear history, intact but via the concurrent commit). LESSON: commit IMMEDIATELY after `git merge --no-commit --no-ff` + the `--cached` foreign-bleed check; do NOT run a long tsc/test sequence in the window between. Verify in the worktree BEFORE merging instead.
2. **COW worktree node_modules silently no-ops jest-dom matchers** (`toBeInTheDocument`/`toHaveAttribute`), HIDING real component-test failures, a bot reported "green" while 8 tests were actually broken. For embed/jsdom work, run suites on the REAL main checkout OR swap the worktree node_modules to a SYMLINK to main (symlink is fine for vitest/tsc, only breaks next-dev/Turbopack).
3. **Stale dev build masquerades as a fixed/broken bug**: the "Maximum update depth" crash appeared "gone" then "back" across verifier passes because Grant's `:3000` dev server was serving stale/concurrent code (line-number mismatches, a concurrent `BeakerSearchPill is not defined` AppShell break). ALWAYS hard-refresh before trusting a browser verify, and check the running build matches current main.
4. **Re-run tsc AFTER adding/editing tests, not just vitest** (a test I committed had 2 tsc errors that slipped because I ran tsc before writing the test).
5. **Don't guess-fix without a reproducing case**: this session burned time theorizing the crash location twice; the productive moves were always (a) the real stack trace and (b) reading the actual code path. When a browser-only bug can't be reproduced headlessly, get the trace.

## Commits (recovery list, reachable from main at handoff)
`153982008` a11y colons + test realign; `539f02e5e` Open-while-loading; `a39ed6325` merge edit-markdown + Freeze; `98f2697f8` public-method deeplink; `b450d82cf` body-click no-reveal; `e2e739eb0` auto-newline insert; `201bdedec` transclusion Both (Part A render + Part B Loro normalize); `da5278d71` picker dup-key; `f3d11822b` editor loop-trap. (P7-4 external + P7-6 a11y + Preview-embeds + smiles-import landed earlier in the session via merges into the linear history.)

## Pointers
- Running memory: `~/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/project_markdown_embed_hybrid.md` (full per-phase log incl. this session).
- Phase 7 design + decisions: `docs/proposals/2026-06-12-phase7-polish.md`. Parent embed design: `docs/proposals/2026-06-11-markdown-embed-hybrid.md`.
- Prior handoffs: `docs/orchestrator-handoffs/2026-06-12-embeds-phase6-7-handoff.md` (Phase 6 + P7-1/2/3/5), `2026-06-12-embeds-phase5-6-handoff.md`, `2026-06-12-markdown-embeds-handoff.md`.
- Transclusion code: `components/embeds/TransclusionEmbed.tsx` + `TransclusionContext.tsx`, `lib/embeds/normalize-transclusions.ts`, `lib/embeds/markdown-section.ts`, the editor `normalizeRef` in `InlineMarkdownEditor.tsx` (called at `NoteDetailPopup.tsx:653/831`), Part A raw render in `RenderedMarkdown.tsx` (`RawTransclusionEmbed`/`loneRawTransclusion`).
