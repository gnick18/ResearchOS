/**
 * §6.4d Methods page — BeakerBot creates a funny markdown method.
 *
 * Design call (§12 Q1 in the proposal): the funny content is
 * "BeakerBot's Patent-Pending Coffee Brewing Protocol." Tongue in cheek,
 * obviously not real lab work. The brief offered "Coffee Brewing
 * Protocol" or "Cat Hair Extraction SOP" as suggestions, and let P5
 * pick. We pick coffee brewing.
 *
 * Cursor goes back to the picker, clicks Standard Markdown, fills out
 * the form (name + body), and saves. Completion event:
 * `methodsApi.create` success via the polling watcher in tour-events.ts.
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
 * name + body + submit as advertised: the whole point is BeakerBot
 * filling in a funny method so the user can see the editor flow
 * without composing it themselves.
 */
import {
  cursorScript,
  safeClickAction,
  safeTypeAction,
  compactScript,
} from "./lib/cursor-script";
import { advanceOnEvent, buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { watchMethodCreated } from "./lib/tour-events";

export const FUNNY_METHOD_NAME =
  "BeakerBot's Patent-Pending Coffee Brewing Protocol";

export const FUNNY_METHOD_BODY = `# BeakerBot's Patent-Pending Coffee Brewing Protocol

> Disclaimer: BeakerBot is not licensed to dispense caffeine advice.

## Reagents

- Filtered water, 250 mL, room temperature.
- Whole-bean coffee, 18 g, freshly ground to a medium coarseness.
- Optional: 5 mL milk, sourced from your local dairy aisle.

## Equipment

- Pour-over cone, V60 or equivalent.
- Filter paper, pre-rinsed with 30 mL hot water.
- Kettle, 92 to 96 °C.
- Timer (or BeakerBot's internal sense of urgency).

## Procedure

1. Heat the water to 94 °C. Do NOT boil. Boiling is for amateurs.
2. Place the filter paper in the cone. Rinse with 30 mL of the hot
   water, then discard.
3. Add the ground coffee. Note: a level surface improves extraction
   uniformity. BeakerBot recommends a chef's pat.
4. Bloom: pour 40 mL of water in concentric circles, starting from the
   center. Wait 30 seconds.
5. Continue pouring in 50 mL increments, pausing 15 seconds between
   pours, until 250 mL is delivered.
6. Total brew time should be 3 minutes, 30 seconds. Deviations beyond
   ±20 seconds invalidate the protocol (per BeakerBot's strict QC).

## Notes

- This protocol does NOT replace actual lab methods. Real PCRs are
  upstairs.
- If the coffee tastes burnt, your water was too hot. If sour, too
  cold. If neither, congratulations.
`;

export const methodsCreateStep = buildWalkthroughStep({
  id: "methods-create",
  speech:
    "Time to make a method. I'm picking Standard Markdown and typing in something obviously-not-real lab work, so you can see how the editor flows.",
  pose: "typing",
  targetSelector: targetSelector(TOUR_TARGETS.methodsCreateForm),
  cursorScript: cursorScript(async () => {
    const pickMarkdown = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsTypeMarkdown),
    );
    const typeName = await safeTypeAction(
      targetSelector(TOUR_TARGETS.methodsCreateNameInput),
      FUNNY_METHOD_NAME,
    );
    const typeBody = await safeTypeAction(
      targetSelector(TOUR_TARGETS.methodsCreateBodyInput),
      FUNNY_METHOD_BODY,
      // Faster cadence on the long body so the user isn't waiting
      // 90 seconds for typing. Still slow enough to read as typing,
      // not pasting.
      25,
    );
    const submit = await safeClickAction(
      targetSelector(TOUR_TARGETS.methodsCreateSubmit),
    );
    return compactScript([pickMarkdown, typeName, typeBody, submit]);
  }),
  completion: advanceOnEvent(watchMethodCreated),
  expectedRoute: "/methods",
});
