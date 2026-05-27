/**
 * §6.4d Methods page — BeakerBot creates a funny markdown method.
 *
 * Design call (§12 Q1 in the proposal): the funny content is
 * "BeakerBot's Patent-Pending Coffee Brewing Protocol." Tongue in cheek,
 * obviously not real lab work. The brief offered "Coffee Brewing
 * Protocol" or "Cat Hair Extraction SOP" as suggestions, and let P5
 * pick. We pick coffee brewing.
 *
 * Cursor sequence (Grant 2026-05-21 feedback: nothing was happening
 * after the markdown tile click in v0; this rewrite drives the WHOLE
 * form):
 *
 *   1. Click the Standard Markdown tile in the picker so the markdown
 *      form mounts.
 *   2. Click + type the funny method name into the name input.
 *   3. Click + type the user's earlier-picked category (read from the
 *      `V4_METHODS_CATEGORY_PICK_KEY` localStorage key the
 *      `methods-category-prompt` beat writes) into the Folder input.
 *      Falls back to "Methods" when the pick is missing (e.g. tour
 *      resumed past §6.4a).
 *   4. Click into the markdown body wrapper so the empty-state textarea
 *      inside `HybridMarkdownEditor` focuses, then type the funny
 *      coffee body into that textarea, then click the editor's Save
 *      button so the buffered typed content flushes through to the
 *      modal's `mdContent` state (manual-save model, commit ff96016e).
 *      Without that flush the Create Method button stays disabled.
 *   5. Click the Create Method button to save.
 *
 * Completion event: `tour:method-created`, dispatched by
 * `CreateMethodModal.tsx` after `methodsApi.create` resolves. The
 * polling fallback in `watchMethodCreated` still covers any code path
 * that bypasses the modal's save handler.
 *
 * Artifact:
 *   { type: "method", id: "<methodId>:placeholder", cleanup_default: "discard" }
 *
 * Cleanup default "discard" — the user didn't write it, BeakerBot did,
 * and the content is not real lab work. The Phase 4 grid pre-unchecks
 * keep for placeholder methods.
 *
 * Classification: BEAKERBOT DEMO (per Grant's design correction
 * 2026-05-21). Speech is "I'm picking Standard Markdown and typing in
 * something obviously-not-real lab work." Both clauses are explicit
 * BeakerBot-led promises. Cursor performs the type-picker click +
 * name + category + body + submit as advertised: the whole point is
 * BeakerBot filling in a funny method so the user can see the editor
 * flow without composing it themselves.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
  callbackAction,
} from "./lib/cursor-script";
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { TOUR_DOM_EVENTS } from "./lib/tour-events";
import {
  clearMethodsCategoryPick,
  readMethodsCategoryPick,
} from "./MethodsCategoryPromptStep";
import { flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";

const STEP_ID = "methods-create";

export const FUNNY_METHOD_NAME =
  "BeakerBot's Patent-Pending Coffee Brewing Protocol";

export const FUNNY_METHOD_BODY = `# BeakerBot's Patent-Pending Coffee Brewing Protocol

> Disclaimer: BeakerBot is not licensed to dispense caffeine advice.

## Reagents

- Filtered water, 250 mL, room temperature.
- Whole-bean coffee, 18 g, freshly ground to a medium coarseness.
- Optional: 5 mL milk, sourced from your local dairy aisle.

## Procedure

1. Heat the water to 94 degrees Celsius. Do not boil.
2. Rinse the filter with 30 mL of hot water, then discard.
3. Add the ground coffee.
4. Bloom with 40 mL of water in concentric circles. Wait 30 seconds.
5. Continue pouring in 50 mL increments, pausing 15 seconds between pours, until 250 mL is delivered.
6. Total brew time: 3 minutes, 30 seconds.

## Notes

This protocol does NOT replace actual lab methods. Real PCRs are upstairs.
`;

/** Fallback category when the user skipped or resumed past the
 *  `methods-category-prompt` beat. Matches the same fallback the
 *  category demo step uses so a stale pick degrades consistently. */
const FALLBACK_CATEGORY = "Methods";

/** Read-then-watch pause between cursor beats inside the methods-create
 *  demo (Methods fix manager 2026-05-22). 800ms is the same cadence the
 *  §6.10 `ai-helper-size-diff` demo uses between Full → Medium →
 *  Minimal clicks; the cycle gives the user a beat to register each
 *  visible action (markdown tile click → name typing → category typing
 *  → body typing → submit) before the next one fires. Without these
 *  pauses, the cursor blew through the 5-action script faster than the
 *  user could follow per Grant's 2026-05-22 testing feedback. Exported
 *  so the pacing test can pin the exact duration. */
export const METHODS_CREATE_PAUSE_MS = 800;

/** Sleep helper for the callbackAction pause. setTimeout returns a
 *  cleanup handle we don't need; the wrapper just resolves on tick.
 *  Same shape as SettingsAiHelperSizeDiffStep's pause helper. */
async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== "undefined") {
      window.setTimeout(resolve, ms);
    } else {
      setTimeout(resolve, ms);
    }
  });
}

export const methodsCreateStep = buildWalkthroughStep({
  id: STEP_ID,
  speech:
    "For general lab work, you'll usually use the Standard Markdown builder. I'll type in something obviously-not-real so you can see how the text editor flows.",
  pose: "typing-on-laptop",
  targetSelector: targetSelector(TOUR_TARGETS.methodsCreateForm),
  cursorScript: cursorScript(async () => {
    // 1. Click the Standard Markdown tile in the picker.
    const pickMarkdown = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsTypeMarkdown),
    );

    // 2. Click + type the funny name into the Method Name input.
    //    25ms cadence keeps the typing visible without dragging the
    //    sequence out (~3 seconds for the 50-character name).
    const typeName = await safeTypeAction(
      targetSelector(TOUR_TARGETS.methodsCreateNameInput),
      FUNNY_METHOD_NAME,
      25,
    );

    // 3. Click + type the user's earlier-picked category into the
    //    Folder input. The Folder field doubles as the category in
    //    the methods grouping (folders ARE categories in the data
    //    model — see `app/methods/page.tsx`'s grouped-by-folder render).
    const categoryLabel = readMethodsCategoryPick() ?? FALLBACK_CATEGORY;
    const typeCategory = await safeTypeAction(
      targetSelector(TOUR_TARGETS.methodsCreateCategoryInput),
      categoryLabel,
      30,
    );

    // 4a. Click the markdown body wrapper to focus the editor and
    //     guarantee a textarea is mounted before we try to type into
    //     it. `HybridMarkdownEditor`'s `autoStartEditing` prop (set by
    //     `CreateMethodModal` for the markdown branch) seeds
    //     `editingBlockOffset=0` on initial mount when the value is
    //     empty, so the empty-state textarea SHOULD already be there.
    //     But the wrapper's onClick is a safe no-op when the textarea
    //     is already mounted (the `editingBlockOffset === null` guard
    //     short-circuits) and it actively mounts one when it isn't.
    //     This makes the body-typing beat resilient to any future flip
    //     in HybridMarkdownEditor's autoStartEditing seed timing.
    const clickBodyWrapper = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsCreateBodyInput),
    );

    // 4b. Type the funny body into the markdown editor's empty-state
    //     textarea. The CSS combinator selector reaches into the
    //     wrapper's nested textarea without needing a second
    //     tour-target name. `safeTypeAction` passes the selector
    //     through so BeakerBotCursor.typeInto can re-resolve if the
    //     node remounts mid-loop.
    //
    //     25ms cadence on the ~700-character body keeps total typing
    //     around 18 seconds. Faster than that reads as paste; slower
    //     drags the demo.
    const typeBody = await safeTypeAction(
      '[data-tour-target="methods-create-body-input"] textarea',
      FUNNY_METHOD_BODY,
      25,
    );

    // 4c. methods-create body-typing fix manager 2026-05-27: flush the
    //     buffered edit into the parent's `mdContent` BEFORE clicking
    //     Create Method. Under HybridMarkdownEditor's manual-save
    //     model (commit ff96016e, 2026-05-26) typing into the textarea
    //     writes only to a local buffer; the parent's `onChange` fires
    //     only on explicit Save (button click or Cmd+S). Without this
    //     beat, `CreateMethodModal`'s `mdContent.trim()` stays empty,
    //     the Create Method button stays disabled, and BeakerBot's
    //     submit click silently no-ops, dead-ending Grant's 2026-05-27
    //     hand-walk.
    //
    //     The Save button is rendered by `SaveChrome` inside the
    //     editor; it carries `data-testid="hybrid-editor-save"` and is
    //     enabled (non-disabled) whenever the editor is dirty, which
    //     it becomes on the first typed keystroke via
    //     `handleEditChange → markDirty`. We click via the data-testid
    //     selector rather than adding a new tour-target so this stays
    //     local to MethodsCreateStep without touching the editor's
    //     render layer.
    const saveBody = await safeClickAction(
      '[data-tour-target="methods-create-body-input"] [data-testid="hybrid-editor-save"]',
    );

    // 5. Click Create Method to save. The modal dispatches
    //    `tour:method-created` from its handleSave success branch, so
    //    the step's completion listener fires the instant the save
    //    resolves.
    const submit = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsCreateSubmit),
    );

    // Methods fix manager 2026-05-22: interleave 800ms read-then-watch
    // pauses between each visible action so the user can register one
    // beat (markdown tile picked → name typed → category typed → body
    // clicked → body typed → body saved → submit) before the next one
    // fires. Pattern matches §6.10 SettingsAiHelperSizeDiffStep's
    // Full → pause → Medium → pause → Minimal cycle. The pauses run
    // at PLAYBACK time via callbackAction (not build time) so each
    // pause resolves AFTER the preceding click / type has visibly
    // landed.
    return compactScript([
      pickMarkdown,
      callbackAction(() => pause(METHODS_CREATE_PAUSE_MS)),
      typeName,
      callbackAction(() => pause(METHODS_CREATE_PAUSE_MS)),
      typeCategory,
      callbackAction(() => pause(METHODS_CREATE_PAUSE_MS)),
      clickBodyWrapper,
      callbackAction(() => pause(METHODS_CREATE_PAUSE_MS)),
      typeBody,
      callbackAction(() => pause(METHODS_CREATE_PAUSE_MS)),
      saveBody,
      callbackAction(() => pause(METHODS_CREATE_PAUSE_MS)),
      submit,
    ]);
  }),
  // Methods fix manager 2026-05-22: full page-lock during the BeakerBot
  // demo. The cursor's clicks pass through via the
  // `__beakerBotCursorClicking` flag in TourPageLock; only stray USER
  // clicks (outside the speech bubble) are blocked. Prevents the user
  // from accidentally clicking outside the CreateMethodModal /
  // category-builder and soft-walking themselves out of the tour.
  // Empty allowList = total lock (only the speech bubble's Got-it /
  // Skip / Back are interactive). The pill label tells the user
  // BeakerBot is driving so the lock doesn't read as a freeze.
  pageLock: {
    allowList: [],
    pillLabel: "BeakerBot is typing. Click Got it, next when ready.",
  },
  // Universal pacing (Grant 2026-05-22): BeakerBot demo steps wait for the user to click before advancing.
  // The `tour:method-created` event still fires when the save resolves;
  // onEnter listens to capture the new method id, then the user clicks
  // to advance.
  completion: manualAdvance("Got it, next"),
  // Capture the created method id out of the `tour:method-created` DOM
  // event detail (dispatched by CreateMethodModal on save success). The
  // id is encoded with the `:placeholder` source tag so the Phase 4
  // cleanup grid renders "Method #N (placeholder body)" via
  // decodeMethodSource — keeps the v3 + v4 grid display consistent.
  // cleanup_default "discard" because BeakerBot wrote a funny coffee
  // method, not real lab content (per the brief).
  onEnter: () => {
    if (typeof window === "undefined") return;
    const handler = (evt: Event) => {
      const id = (evt as CustomEvent<{ id?: number }>).detail?.id;
      if (id === undefined || id === null) return;
      pendingArtifactStore.add(STEP_ID, {
        type: "method",
        id: `${id}:placeholder`,
        cleanup_default: "discard",
      });
      window.removeEventListener(TOUR_DOM_EVENTS.methodCreated, handler);
    };
    window.addEventListener(TOUR_DOM_EVENTS.methodCreated, handler);
  },
  onExit: async () => {
    await flushPendingArtifacts(STEP_ID);
    // experiment-flow fix manager 2026-05-27: clear the picked category
    // label only AFTER the methods-create demo has consumed it (the
    // Folder input is typed mid-script). Was previously cleared on
    // `methods-category`'s exit, which wiped the value before this
    // step's cursor read it. Funny markdown method then landed in the
    // "Methods" fallback folder instead of the user's category. A re-run
    // of the tour still starts fresh because the prompt step re-writes
    // the localStorage value on its own advance.
    clearMethodsCategoryPick();
  },
  expectedRoute: "/methods",
});
