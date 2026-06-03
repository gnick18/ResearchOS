/**
 * §6.6 Method attachment + variation notes + snapshot teach (split into
 * 4 popup-mount-safe sub-steps as of 2026-05-21, HR-dispatched).
 *
 * The original single `experiment-attach-method` step spanned the
 * popup-mount boundary in a single cursor script: it clicked the
 * methods tab, the attach button, and the variation-notes field in one
 * shot. Same class of bug as §6.2's project-route-entered: the cursor
 * script's targets don't exist until the popup mounts, so the second
 * click in the script either timed out or fired on a stale DOM.
 *
 * The split mirrors §6.2's NAV / PROSE pattern. 2026-06-03 (HR /
 * tour-simplification) merged the framing 4 beats to 3:
 *
 *   1. `experiment-attach-method-open`   — open the popup + frame the
 *                                          Methods tab (absorbed the cut
 *                                          `-tab` beat's framing).
 *   2. `experiment-attach-method-attach` — click Attach + pick first
 *                                          method (the funny markdown
 *                                          one from §6.7c). Its onEnter
 *                                          re-stages the Methods tab.
 *   3. `experiment-attach-method-notes`  — type the variation note +
 *                                          deliver the mental-model
 *                                          speech.
 *
 * The cut `experiment-attach-method-tab` beat (cursor just clicked the
 * Methods tab) was redundant: the `-attach` beat's onEnter
 * (`ensureExperimentPopupOpen`) reopens the popup AND activates the
 * Methods tab on its own.
 *
 * This file is kept as a re-export hub so the test fixtures and
 * back-compat callers (`import { methodAttachmentStep } from
 * "../MethodAttachmentStep"`) keep working. `methodAttachmentStep`
 * aliases the terminal id (`experiment-attach-method-notes`) — the
 * "step completed" telemetry beat still fires at the same logical
 * moment (user attached a method and added a variation note).
 */
export { methodAttachmentOpenStep } from "./MethodAttachmentOpenStep";
// 2026-06-03 (HR / tour-simplification): methodAttachmentTabStep
// (experiment-attach-method-tab) was cut and its source file deleted; the
// re-export is gone with it.
export { methodAttachmentAttachStep } from "./MethodAttachmentAttachStep";
export { methodAttachmentNotesStep } from "./MethodAttachmentNotesStep";
// VARIATION_NOTE removed (experiment-flow fix manager 2026-05-27): the
// hand-walk simplification dropped the typing demo from the notes
// sub-step, so the constant is no longer used anywhere. Callers that
// still pin the literal text should hard-code their own value.

// Back-compat alias: the original `methodAttachmentStep` export now
// points at the terminal id of the split. Callers that pinned the old
// id (renamed to `experiment-attach-method-notes` here) keep working.
import { methodAttachmentNotesStep } from "./MethodAttachmentNotesStep";
export const methodAttachmentStep = methodAttachmentNotesStep;
