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

## Update 2026-06-18 (visible Claude-in-Chrome session): measure hypothesis NOT supported; a separate confirmed render bug fixed

Reproduced in a VISIBLE foreground Chrome tab (rAF actually running, confirmed by
140+ visible polling ticks per run) on demo mode. All timings are the worst
inter-frame gap over a multi-second rAF window, with a console.warn counter for
CodeMirror "measure loop" restarts.

Reliable results (every variant, no measure-loop warnings):

- Baseline real note (32 lines): 17 ms.
- The EXACT real degenerate doc (the `2. 2.` / heading + table absorbed into the
  ordered list), measured fresh at cursor end / top / deep: 66 / 25 / 34 ms.
- Live typing the repro while visible (real CDP keystrokes firing the real
  auto-list-continuation): worst gap 551 ms, and that gap landed about 8 s AFTER
  typing finished, so it is not the typing path.
- Nested ordered list depth 10 -> 80: 9 -> 16 ms.
- Flat-absorbed table 10 -> 160 rows: flat at ~9 ms.
- Many standalone tables 1 -> 60: flat at ~9 ms. CM6 virtualizes block widgets to
  the viewport, so only ONE table widget is ever in the DOM regardless of count;
  table count does not multiply measure cost.

Conclusion: the multi-second measure-frame hypothesis is NOT supported by reliable
visible-tab measurements. The single "5.7 s" reading in the original pass was
almost certainly one of the hidden-tab artifacts this doc already warned about.
The cost does not scale super-linearly with list depth, absorption size, or table
count, and the `2. 2.` continuation comes from CodeMirror's built-in
`insertNewlineContinueMarkup` (lang-markdown), not our keymap (our keymap binds no
Enter and has no list-renumber loop). The 90 s prod freeze therefore is NOT in the
CM measure / render path. The remaining untested suspect is the real-folder Loro
persist + version-control-on-commit path that demo lacks, which also matches the
save-stuck symptom (Unsaved-changes never clearing, Cmd+S / Done not saving). NEXT:
capture a CPU profile on prod where it reproduces, or reproduce locally against a
real connected folder (Loro persist + autosave), and read the hot frame in the
debounced commit / persist path rather than the decoration build.

### Separate confirmed bug, fixed in this session: standalone tables render blank

Found while reproducing: a STANDALONE GFM table (a real Table node, e.g. after a
`## Results` heading, NOT the absorbed-into-a-list case) renders blank the moment
the caret leaves it. Root cause: the `remark-gfm -> remark-rehype -> rehype-raw`
round-trip in `render-html.ts` emits a run of leading newline text nodes before
the `<table>` (about one per row). The block widget paints that string with
`innerHTML` inside `.cm-inline-table`, which inherits `white-space: break-spaces`
from `.cm-content`, so each stray newline rendered as a visible blank LINE. A
two-row table became a 729 px-tall mostly-empty widget (the real `<table>` is
116 px) that pushed the table below the popup fold, reading as "the table stopped
rendering". This is view-only and byte-for-byte round-trip safe (no doc mutation).

Fix (this branch):
- `render-html.ts`: `renderMarkdownToHtml(...)` returns `.trim()` so the leading /
  trailing whitespace is dropped. Newlines INSIDE a block (fenced code body) are
  untouched, since they sit within `<pre><code>` and not at the string edges.
- `theme.ts`: `.cm-inline-block { white-space: normal }` as defense in depth, so a
  future stray newline between block elements collapses instead of inflating the
  widget height.
- `render-html.test.ts`: regression test asserting the rendered table HTML has no
  leading / trailing whitespace and starts with `<table`, that fenced code keeps
  its inner newline, and that the bound holds across row counts.

Verified live: widget box went 729 px -> 116 px, first child is now `<table>` (was
a 20-newline text node), table renders inline directly under the heading with the
caret off it. `npx tsc --noEmit` clean; the 12 cm-inline-reveal test files (125
tests) pass including the new ones.
