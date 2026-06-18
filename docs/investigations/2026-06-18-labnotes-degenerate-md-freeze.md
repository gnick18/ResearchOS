# Lab Notes editor freeze on degenerate markdown (heading + table absorbed into an ordered list)

Branch: `fix/labnotes-degenerate-md-freeze` (off origin/main). Status: ROOT CAUSE
LOCALIZED, NOT yet fixed or verified. No behavioral change committed yet.

## Symptom (reported, live on research-os.app)

In an experiment Lab Notes editor (CodeMirror inline editor, TaskDetailPopup ->
Loro mode), typing content where the auto-list-continuation pulls a following
`## heading` and a GitHub-style table INTO an ordered list (rendered as items
4-9) pins the whole renderer for 90+ seconds. Also reported: the "Unsaved
changes" indicator never clears, Cmd+S does nothing, and Done does not save or
close. Those save symptoms are most likely a CONSEQUENCE of the main-thread pin
(all input times out during the freeze), but treat as possibly separate until
the freeze is fixed and save is re-checked.

## What was ruled OUT (reliable, synchronous measurements)

Reproduced the exact degenerate document both as a static string and by driving
the live editor (demo mode, `/demo`) with the real keystrokes including the
Enter auto-continuation. The continuation renumbers the markers and grows the
indentation, e.g.:

```
## Steps
1. Pull the Af293 assembly from NCBI.
2. 2. Run `antismash --taxon fungi Af293.gbk`.
   3. 3. Export the region table.
     
      4. ## Results
     
      5. | Cluster | Type | Closest known |
     ...
```

All of these are FAST and are NOT the cause:

- `buildDeco` / `buildBlockDeco` (inline-reveal decorations): rebuild once per
  keystroke, ~0 ms each. Counted in the live browser.
- The lezer markdown parser: `forceParsing` over the whole degenerate doc is
  ~0.1 ms (jsdom).
- DOM size: the rendered editor is tiny (62 nodes, 14 lines, 0 block widgets).
- Typing itself: ~730 ms for the full 10-line degenerate doc in the live
  browser, ~2-5 ms per keystroke, no growth.
- Synchronous geometry/measure: `coordsAtPos` across the entire doc 14.9 ms,
  selection dispatch 4-6 ms, reflow (`scrollHeight`) 0 ms.
- React/Loro per-keystroke path: typing burst is synchronous and fast; no
  super-linear per-keystroke growth observed.

## What IS the cause (localized, not fully isolated)

The cost lives in CodeMirror's **requestAnimationFrame-driven measure cycle**
that runs AFTER the synchronous typing burst, on the degenerate
deeply-indented-ordered-list structure. The one trustworthy measurement (taken
while the preview tab was momentarily foreground) showed the first measure frame
after building the degenerate doc taking ~5.7 s, and a forced measure ~3.0 s. On
a real machine with a real folder/Loro persist this is consistent with
escalating to the reported 90 s.

The rAF-scheduled focus behaviors in our stack (`typewriterScrollExtension`,
`focusDimmingExtension` in `lib/markdown/cm-focus-mode/focus-mode.ts`) and the
spellchecker are all OFF by default and were confirmed off, so they are not the
cause. That leaves CM core measure and/or the inline-reveal atomic ranges
(collapsed-marker replace decorations) re-read during the measure on
`viewportChanged`. These two could not be separated in this harness (see below).

## Why it could not be fully isolated or fix-verified here

The Claude preview is a HEADLESS browser whose tab reports
`document.visibilityState === "hidden"`. Hidden tabs PAUSE
`requestAnimationFrame`, so any freeze that lives in the rAF/measure cycle does
not run, and any `await requestAnimationFrame(...)` based timing hangs for
unrelated reasons (a false "freeze"). Several intermediate observations in this
session were such false positives and were discarded. JS self-profiling is also
blocked here by Document Policy, and jsdom cannot run the geometry-dependent
measure/cursor code.

Proper isolation + fix verification needs a VISIBLE browser (Claude-in-Chrome
against a foreground tab, or a real Chrome) so the rAF measure cycle actually
runs and a CPU profile can be captured.

## Proposed next steps (post-demo)

1. Reproduce in a VISIBLE Chrome (demo mode -> experiment -> Lab Notes -> type
   the degenerate content). Capture a Performance profile of the multi-second
   measure frame; read the hot frame.
2. Bisect the rAF cost with the tab visible: temporarily return empty
   decorations from `buildDeco`/`buildBlockDeco` (inline-reveal) and re-measure.
   If the multi-second frame disappears, the fix is to BOUND the inline-reveal
   collapse for degenerate structures (skip emitting atomic replace ranges when
   the structure is a deeply-indented list / list-item-containing-table-pipes,
   falling back to plain source, which is already the chip's behavior for
   touched/complex content). If it persists, the cost is in CM core measure and
   the remedy is throttling/deferring the measure-driven rebuild.
3. Re-check the save path (Cmd+S handler in InlineMarkdownEditor + the Loro
   debounced commit/flush + TaskDetailPopup autosave) once the freeze is gone,
   to confirm Done/Cmd+S commit and the note persists through a reload.
4. Add a regression test that drives the degenerate markdown through the editor
   in a VISIBLE browser and asserts the page stays responsive (the synchronous
   build/parse paths already proven fast are not sufficient guards on their own).

## Coordination notes

- Do NOT touch `RenderedMarkdown.tsx` (owned by a sibling session for a separate
  read-only Preview bug).
- Any change to a shared markdown lib file (remark plugin, sanitize schema) must
  be flagged to the orchestrator first.
- origin/main auto-deploys to prod. Merges in the markdown area are HELD until
  after the demo. An unverified freeze fix on prod pre-demo is worse than the
  current state plus the "no complex tables in Lab Notes during the demo"
  guardrail.
