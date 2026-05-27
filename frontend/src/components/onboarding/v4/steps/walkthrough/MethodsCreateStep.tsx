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
  waitForElement,
  setNativeFieldValue,
  tourClickWithLockBypass,
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

    // Hand-walk fix 2026-05-27 (second pass): the prior `await
    // safe*Action` calls for the body wrapper, body textarea, save
    // button, and submit ALL ran waitForElement at BUILD time. Two
    // ways they could fail:
    //   1. The Markdown form's body textarea doesn't exist when LC or
    //      another type was previously selected. After pickMarkdown
    //      PLAYS, the form re-renders to mount the HybridMarkdownEditor
    //      — but BUILD time runs before any action plays.
    //   2. The pickMarkdown click is the LAST thing whose targets are
    //      reliably present at build time. Everything after must defer.
    //
    // Wrap each post-pickMarkdown action in a callbackAction so the
    // selector resolves at PLAYBACK. Mirrors the
    // workbench-create-experiment-open + workbench-list-create-shell
    // defer-to-playback patterns landed earlier today.

    const clickBodyWrapper = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const wrapper = await waitForElement(
        targetSelector(TOUR_TARGETS.methodsCreateBodyInput),
        3000,
      );
      if (!(wrapper instanceof HTMLElement)) return;
      tourClickWithLockBypass(wrapper);
    });

    const typeBody = callbackAction(async () => {
      if (typeof document === "undefined") return;
      // Wait for the body wrapper's nested textarea to mount. The
      // HybridMarkdownEditor's autoStartEditing seeds the textarea on
      // mount for empty value; if it isn't there yet, the prior wrapper
      // click should have triggered the editor to mount one.
      const textarea = await waitForElement(
        '[data-tour-target="methods-create-body-input"] textarea',
        3000,
      );
      if (!(textarea instanceof HTMLTextAreaElement)) return;
      setNativeFieldValue(textarea, FUNNY_METHOD_BODY);
    });

    const saveBody = callbackAction(async () => {
      if (typeof document === "undefined") return;
      // The Save button (SaveChrome inside the editor) carries
      // data-testid="hybrid-editor-save". Enabled once the editor is
      // dirty, which it becomes on the first keystroke (or the
      // setNativeFieldValue input event above).
      const saveBtn = await waitForElement(
        '[data-tour-target="methods-create-body-input"] [data-testid="hybrid-editor-save"]',
        3000,
      );
      if (!(saveBtn instanceof HTMLElement)) return;
      tourClickWithLockBypass(saveBtn);
    });

    const submit = callbackAction(async () => {
      if (typeof document === "undefined") return;
      const btn = await waitForElement(
        targetSelector(TOUR_TARGETS.methodsCreateSubmit),
        3000,
      );
      if (!(btn instanceof HTMLElement)) return;
      tourClickWithLockBypass(btn);
    });

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
