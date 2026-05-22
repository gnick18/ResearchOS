/**
 * §6.7 HE-8 — image attach (BeakerBot demo with off-screen cursor entry).
 *
 * Hybrid editor manager 2026-05-22. The cursor materialises off-screen
 * right, holding a thumbnail of BeakerBot's funny selfie. It glides
 * into the attachments area (the editor's image strip) and drops the
 * file. The image preview tracks the cursor for the whole step.
 *
 * Artifact:
 *   { type: "notes_image", id: "<encoded>", cleanup_default: "discard" }
 *
 * Hybrid editor manager 2026-05-22: this step continues to rely on the
 * existing `onEnterHybridEditorImageDrop` helper to actually seed the
 * selfie blob into the experiment's Notes-tab Images folder, so the
 * image strip has something to surface. The cursor's drop animation
 * is choreography — the real attachment lands via the onEnter helper.
 *
 * Off-screen entry: `cursorEntry: "offscreen-right"` snaps the cursor
 * beyond the right viewport edge before the first glide. The
 * `cursorHeldImage` config renders the selfie thumb next to the
 * cursor for the whole step.
 *
 * Completion: manual ("Got it, next").
 */
import {
  cursorScript,
  safeGlideToElementAction,
  compactScript,
} from "./lib/cursor-script";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { SELFIE_PUBLIC_URL } from "./lib/on-enter-helpers";

export const hybridImageAttachStep = buildWalkthroughStep({
  id: "hybrid-image-attach",
  speech: (
    <>
      <p className="mb-2">
        Time for images. I&apos;ll attach my own image to your
        experiment so you can see how it works.
      </p>
      <p>Watch, I&apos;m bringing a file in from off-screen.</p>
    </>
  ),
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.hybridEditorImageStrip),
  cursorEntry: "offscreen-right",
  cursorHeldImage: {
    src: SELFIE_PUBLIC_URL,
    width: 56,
    height: 56,
    alt: "BeakerBot selfie",
  },
  cursorScript: cursorScript(async () => {
    // The cursor's snapTo runs BEFORE this script via the controller's
    // cursorEntry handling. The first glide here brings the cursor
    // (with the held image) onto the attachments area. We use a glide
    // action rather than a drag because the actual attachment landing
    // is handled by the onEnter helper (`onEnterHybridImageAttach`).
    const glideToStrip = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.hybridEditorImageStrip),
      3000,
    );
    return compactScript([glideToStrip]);
  }),
  completion: manualAdvance("Got it, next"),
});
