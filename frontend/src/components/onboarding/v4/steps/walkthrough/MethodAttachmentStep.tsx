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
 * The split mirrors §6.2's NAV / PROSE pattern, scaled to four beats:
 *
 *   1. `experiment-attach-method-open`   — click the workbench row to
 *                                          open the popup.
 *   2. `experiment-attach-method-tab`    — click the Methods tab inside
 *                                          the now-open popup.
 *   3. `experiment-attach-method-attach` — click Attach + pick first
 *                                          method (the funny markdown
 *                                          one from §6.4d).
 *   4. `experiment-attach-method-notes`  — type the variation note +
 *                                          deliver the mental-model
 *                                          speech.
 *
 * Each sub-step's cursor script runs against a stable overlay mount
 * (the popup mounts during step 1, stays mounted through steps 2-4).
 *
 * This file is kept as a re-export hub so the test fixtures and
 * back-compat callers (`import { methodAttachmentStep } from
 * "../MethodAttachmentStep"`) keep working. `methodAttachmentStep`
 * aliases the terminal id (`experiment-attach-method-notes`) — the
 * "step completed" telemetry beat still fires at the same logical
 * moment (user attached a method and added a variation note).
 */
export { methodAttachmentOpenStep } from "./MethodAttachmentOpenStep";
export { methodAttachmentTabStep } from "./MethodAttachmentTabStep";
export { methodAttachmentAttachStep } from "./MethodAttachmentAttachStep";
export {
  methodAttachmentNotesStep,
  VARIATION_NOTE,
} from "./MethodAttachmentNotesStep";

// Back-compat alias: the original `methodAttachmentStep` export now
// points at the terminal id of the split. Callers that pinned the old
// id (renamed to `experiment-attach-method-notes` here) keep working.
import { methodAttachmentNotesStep } from "./MethodAttachmentNotesStep";
export const methodAttachmentStep = methodAttachmentNotesStep;
