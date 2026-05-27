/**
 * §6.7 HE-8 — image attach (USER ACTION, voice-changed 2026-05-27 by
 * v4 tour structural manager Wave 1).
 *
 * Pre-2026-05-27 this was BEAKERBOT_DEMO: BeakerBot's cursor materialised
 * off-screen holding a thumbnail of the funny selfie, glided over the
 * editor's image strip, and dropped the attachment with the onEnter
 * helper landing the file in the experiment's Notes-tab Images folder.
 *
 * Grant's 2026-05-27 tour script rewrite reclassifies this beat as a
 * USER ACTION: the user drags any image file from their computer into
 * the editor themselves. Wave 1 removes the cursor script, the
 * off-screen cursor entry, and the held image so the user owns the
 * drag without any cursor in the way. Spotlight stays on
 * `hybridEditorImageStrip` so the user knows where to drop. Completion
 * stays manual ("Got it, next") per the new script's metadata block.
 *
 * The seed-the-selfie-blob `onEnter` helper still hangs off this step
 * in step-registry.ts. Wave 2 may revisit (the user is bringing their
 * own image, so the helper might be retired) but it is harmless to
 * leave in place for now; the seeded blob just doesn't get used.
 *
 * Wave 2 will fill in the real speech.
 *
 * v4 tour structural manager
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";

export const hybridImageAttachStep = buildWalkthroughStep({
  id: "hybrid-image-attach",
  // TODO(wave2): hybrid-image-attach
  // (User-action prompt: "Try it now: drag any image file from your
  // computer into the editor.")
  speech: "TODO(wave2): hybrid-image-attach",
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorImageStrip),
  // No cursorScript, no cursorEntry, no cursorHeldImage: user-action
  // step. Wave 2 may add a page-lock if the new script's "drag any
  // image file from your computer" intent needs to enforce that the
  // drop lands on the editor strip and not elsewhere.
  completion: manualAdvance("Got it, next"),
});
