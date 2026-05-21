/**
 * §6.7 Hybrid editor — keyboard shortcuts sub-step.
 *
 * First of four hybrid-editor sub-steps. BeakerBot demonstrates the
 * markdown editor's shortcut surface by typing into the experiment's
 * Notes tab and triggering the shortcuts inline: Cmd+B for bold,
 * Cmd+I for italic, triple-backtick + python for a code block, `>`
 * for blockquote, `##` for heading 2.
 *
 * Cursor primitives only support typing characters; the real
 * Cmd+B / Cmd+I activations need keyboard events that the cursor
 * primitive doesn't dispatch in P2. To bridge the gap, the typed
 * content is markdown ITSELF (the bare syntax) so the hybrid editor's
 * preview pane renders the formatting. The user sees the same
 * formatting result either way; we just don't shortcut-fire the
 * synthetic keypresses.
 *
 * No artifact at this sub-step. The Notes content (and any image
 * embedded in later sub-steps) lands as one combined
 * `notes_content` artifact at §6.7's last sub-step.
 *
 * Multi-paragraph speech bubble:
 *   "Quick fact: ResearchOS runs on markdown. Notes, methods, results,
 *    task descriptions, the whole shebang. These keyboard shortcuts
 *    work in every markdown editor on the site:
 *    Cmd+B bold, Cmd+I italic, triple-backtick code block, > blockquote,
 *    ## heading two."
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech closes with "I'll type a chunk to show the
 * preview", an explicit BeakerBot-led promise. Cursor performs the
 * notes-tab open + the markdown chunk typing as advertised.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { autoAdvanceAfter, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

const SHORTCUTS_DEMO = [
  "## Notes",
  "",
  "**Bold** and *italic* both work.",
  "",
  "```python",
  "print('hello, world')",
  "```",
  "",
  "> Block quotes work too.",
  "",
].join("\n");

export const hybridEditorShortcutsStep = buildWalkthroughStep({
  id: "hybrid-editor",
  speech: (
    <>
      <p className="mb-2">
        Quick fact: ResearchOS runs on markdown. Notes, methods,
        results, task descriptions, the whole shebang. These keyboard
        shortcuts work in every markdown editor on the site.
      </p>
      <p>
        Bold (Cmd+B), italic (Cmd+I), triple-backtick code block,
        block-quote with `&gt;`, heading two with `##`. I&apos;ll type a
        chunk to show the preview.
      </p>
    </>
  ),
  pose: "typing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorTextarea),
  cursorScript: cursorScript(async () => {
    const openNotes = await safeClickAction(
      targetSelector(TOUR_TARGETS.experimentNotesTab),
    );
    // 25ms cadence — same as the long methods body. Faster than the
    // 95ms default so the user isn't waiting through a multi-line
    // markdown sample.
    const typeShortcuts = await safeTypeAction(
      targetSelector(TOUR_TARGETS.hybridEditorTextarea),
      SHORTCUTS_DEMO,
      25,
    );
    return compactScript([openNotes, typeShortcuts]);
  }),
  completion: autoAdvanceAfter(
    Math.ceil(SHORTCUTS_DEMO.length * 25) + 1500,
  ),
});
