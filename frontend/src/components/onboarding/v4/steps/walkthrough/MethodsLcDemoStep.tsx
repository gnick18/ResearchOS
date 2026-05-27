/**
 * §6.4b LC Gradient editor demo (Wave 1 skeleton, 2026-05-27).
 *
 * Re-introduced by Grant's 2026-05-27 tour script rewrite. Sits between
 * `methods-type-tour` (PCR builder demo) and `methods-create` (standard
 * markdown method). Cursor opens the LC Gradient editor and lets the
 * user see the live-chart-updates-as-you-edit feel.
 *
 * Wave 1 ships the skeleton (correct id + voice + spotlight + manual
 * completion + viewport anchor). Wave 2 will fill in the real speech
 * and the cursor script that opens the LC tile + nudges one or two
 * gradient values to show the chart updating.
 *
 * Voice classification per the new script: BEAKERBOT_DEMO
 * Spotlight: LC Gradient editor surface (`lcEditorWrapper` in
 *   targets.ts) — same anchor the retired LC step used.
 * Completion: manual ("Got it, next")
 * ExpectedRoute: methods catalog / LC editor — unset because the LC
 *   editor opens inside the CreateMethodModal that's already mounted
 *   when this step fires.
 *
 * v4 tour structural manager
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const methodsLcDemoStep = buildWalkthroughStep({
  id: "methods-lc-demo",
  speech: "TODO(wave2): methods-lc-demo",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.lcEditorWrapper),
  viewportAnchor: targetSelector(TOUR_TARGETS.lcEditorWrapper),
  completion: manualAdvance("Got it, next"),
});
