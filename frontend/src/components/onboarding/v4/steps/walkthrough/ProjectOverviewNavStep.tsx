/**
 * §6.2 Project route Overview (NAV sub-step).
 *
 * First of two §6.2 sub-steps. It frames the project page the user has just
 * landed on, then hands off to the PROSE sub-step (`project-overview-prose`),
 * which types the placeholder hypothesis into the Overview textarea.
 *
 * Widget-framework teardown v2 (2026-06-02): this beat used to glide the
 * cursor to the auto-pinned Single Project widget tile on the dashboard and
 * click it to navigate into the project. The widget canvas (and that tile)
 * were removed in Phase 2. The §6.1 FILL beat's create now routes straight to
 * the new project's page (NewProjectButton.onCreated calls router.push), so by
 * the time this beat runs the user is already on `/workbench/projects/<id>`.
 * The beat is SIMPLIFIED to plain narration that frames the page; there is no
 * tile to click and nothing to navigate.
 *
 * No artifact tracking on this sub-step. The project artifact lands in §6.1's
 * fill sub-step; this is pure framing.
 *
 * Pose: `pointing` keeps BeakerBot gesturing toward the page content.
 */
import { manualAdvance, buildWalkthroughStep } from "./lib/step-helpers";

export const projectOverviewNavStep = buildWalkthroughStep({
  id: "project-overview-nav",
  speech:
    "Here's the project you just made. Every experiment, method, and task you create gets attached to a project, and this page is where all of that comes back together in one view.",
  pose: "pointing",
  // No cursorScript, no targetSelector: the §6.1 create flow already routed
  // the user here, so there is nothing to click. Pure narration framing the
  // project page before the PROSE beat takes over the Overview textarea.
  completion: manualAdvance("Got it, next"),
  // No expectedRoute: the FILL beat's create routed the user to
  // `/workbench/projects/<id>` (a project-specific path the controller can't
  // reconstruct), so an auto-nav to a bare `/workbench/projects` would 404.
  // The PROSE beat that follows uses the same no-expectedRoute pattern for
  // exactly this reason.
});
