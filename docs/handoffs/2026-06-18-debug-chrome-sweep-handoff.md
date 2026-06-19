# Handoff: DEBUG Chrome bug-sweep round 2 + plot / CM6 visual sweep (2026-06-18)

Orchestrator session "DEBUG" (the Chrome bug-sweep). This was a long multi-arc session driving Grant's app through the real Claude-in-Chrome bridge, finding bugs, dispatching well-scoped fix-chips, and serializing their merges. House rules respected throughout (no em-dashes, no mid-sentence colons, no emojis, `<Tooltip>`/`<Icon>` only).

## Context for the next orchestrator
- `origin/main` AUTO-DEPLOYS to prod (research-os.app). Treat every push as a prod deploy.
- Grant + Emile ran a live lab-make demo on prod at 4:30 today. During the run-up I HELD merges, then on Grant's "add it all" pushed the verified batch live.
- ~6 concurrent chip sessions append to the shared LOCAL `main` ref and the primary checkout is ON `main` and DIRTY. The shared `:3000` dev server is churny (transient build breaks, state resets, my own pushes got clobbered once). Do not reset/`branch -f`/`update-ref` local main. Append-only is safe; reset is not.

## Shipped this session (all on origin/main, gate-green, prod)
| Fix | Commit | Verified |
|---|---|---|
| AppNavBar ResizeObserver infinite-loop crash (rAF-defer + change-guard) | `8bdf7a3d1` | browser |
| Data Hub Transform-button pastel shimmer | `3e252a4f5` | browser |
| Transform builder: friendly inline error for empty/invalid filter operand | (merged) | browser |
| PCR Edit-Step: soft amber out-of-range temp hint (0-110C, non-blocking) | (merged) | browser |
| Sequence editor: IUPAC-aware base-input sanitizer (+ SeqViz caret fix) | (merged) | browser |
| Calendar: block end-date-before-start + `effectiveEndDate` clamp | `d74273927` | browser |
| Data Hub plots: short "Value" Y-title + `fitAxisTitle` clamp + estimation de-collide + per-type graph names | `c6d2d46af` | browser |
| Lab/onboarding founder-identity placeholders genericized | `c6d2d46af` | merge |
| SnapGene-style stacked embed feature labels (`planRibbonLabels`) | `063b32747` | browser |
| Running-log entry date off-by-one (UTC parse) + per-entry editor remount | `5b32a11e9` | tests |
| Style-Guide / insert path gluing block syntax onto prior line | `b4649c5c5` | tests |

(Earlier round-1 fixes from `docs/audits/2026-06-17-stress-test-findings.md` are separate and already live.)

## Key technical findings
- **The "## heading renders literal in Preview" bug is NOT a Preview-renderer bug.** RenderedMarkdown's remark pipeline renders `## H\ntext` correctly on a single newline (proven, 243 tests). The real cause is the Style-Guide rail / insert path in `InlineMarkdownEditor.tsx` gluing block syntax onto the prior line (`a checkbox task## Heading`), which CommonMark then reads as paragraph text. Fixed in `b4649c5c5` (block inserts get their own line, inline chips get a separating space; new helper `lib/markdown/block-insert-syntax.ts`).
- **Data Hub plots are canvas-rendered.** Visual QA is screenshot/zoom only, no DOM text extraction.
- **The AppNavBar crash** was a textbook ResizeObserver-callback-setState feedback loop. The pattern to remember: any `useLayoutEffect`/ResizeObserver that setState on a measured size needs a pure compute + rAF-deferred write + change-guard, or it can crash on layout thrash from a sibling view.

## Patterns established (reuse these)
1. **Dedicated isolated server for visual QA during churn.** `nohup scripts/worktree-dev.sh <wt>/frontend 3090 NEXT_PUBLIC_DATAHUB_ENABLED=1 NEXT_PUBLIC_DATAHUB_BIGTABLE=1 NEXT_PUBLIC_PHYLO_ENABLED=1 &` on a clean origin/main worktree, driven via Chrome. Isolated from the sibling sessions' build breaks. A server (`:3090`, worktree `.claude/worktrees/ros-plotsweep`) is likely still running, reset it to latest origin/main and restart before reusing.
2. **git ops do not reliably trip Turbopack's watcher.** After `git reset --hard`/merge in a worktree, RESTART the dev server (or do a one-byte content nudge) for a guaranteed-fresh compile. This bit me repeatedly verifying the calendar fix (the worktree had the code on disk but the running server served stale).
3. **Serialize-and-verify merges.** Each fix-chip builds on a worktree branch off origin/main, gates (tsc + tests), reports branch + SHA back, and does NOT self-merge. The orchestrator merges (overlap-check vs dirty tree + other branches), gates the merged tree, pushes, and VERIFIES IT STUCK on origin (grep a marker), because the shared local main gets clobbered, my calendar push was dropped once by a sibling rebase and had to be re-landed.
4. **Verify before reporting.** Three false bug reports were refuted: the "Data Hub hit an error" on convert was a sibling session's uncommitted `BeakerBot.tsx` TDZ hot-reloading mid-save (the tell was the source line-numbers shifting between two reads); the negative-duration list task was valid data (input `min=1`); the Preview-heading bug was the editor insert path. Do not reproduce a known page-FREEZE through the Chrome bridge (it hangs the bridge for 90s+).

## STILL IN FLIGHT (hand to the next orchestrator)
- **Lab Notes editor FREEZE (`local_42e9dcff`), the last big one and the most serious. INVESTIGATION-ONLY so far, no verified fix.** Branch `fix/labnotes-degenerate-md-freeze` (`020507aa4`) currently touches ONLY `docs/investigations/2026-06-18-labnotes-degenerate-md-freeze.md` (no code, rebased clean on origin/main, no conflict with the `b4649c5c5` insert fix, nothing to merge yet). The Edit-mode Lab Notes editor freezes the whole page for 90s+ on malformed markdown (an ordered list immediately followed by a `## heading` + a GitHub table). Root cause LOCALIZED to a CodeMirror rAF-driven MEASURE cycle on that degenerate doc (3-6s measure frames observed foreground); all synchronous paths (decoration build, lezer parse, geometry, typing) are fast and ruled out. The stuck-save (Cmd+S / Done not committing) is likely a consequence of the main-thread pin, to be confirmed. GOTCHA, it cannot be verified in a headless Preview tab (hidden tab pauses requestAnimationFrame, so the rAF freeze never fires), it needs a VISIBLE Chrome. Post-demo plan (the session's own): repro in visible Chrome, profile the measure frame, bisect via empty inline-reveal decorations to choose between bounding the inline-reveal collapse vs throttling the measure rebuild, verify the freeze is gone + the note saves through reload, add a regression test, then hand the verified fix to the BILLING session (`local_2709a063`) to serialize (Billing owns that chip). Demo guardrail given to Grant: plain prose + simple lists in Lab Notes, no complex tables. Owner files when it codes a fix: `lib/markdown/cm-focus-mode/` + `cm-inline-reveal/`, `LiveMarkdownEditor.tsx`. The dispatched `task_977527f4` (heading-Preview) is DONE/merged, do not re-spawn it.

## Open / lower-priority
- The SnapGene embed leader LINES read subtly at the compact embed size; the stacking + no-clipping is solid, but worth an eyeball on whether the connector lines pop enough (the fixer's judgment call; numbers moved above the bar).
- Pre-existing tsc errors in `frontend/src/lib/ai/tools/__tests__/lab-head.test.ts` (stale test-call signature, a sibling's AI-tools area, not build-blocking). Not mine.
- CM6 contexts NOT yet swept individually (they share the same editor, so covered by the dispatched fixes): Check-ins notes, and a deeper pass on experiment Lab Notes/Results beyond confirming they reuse the shared editor.
- Surfaces not yet swept at all: GANTT interactions deeper than the toolbar, phylo tree studio, marketing/transparency/admin charts.
