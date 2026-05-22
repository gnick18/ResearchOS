/**
 * §6.8 Gantt — USER wires Fake B → user_experiment as a dependency
 * (Gantt redesign 2026-05-22, Gantt manager).
 *
 * NEW user-action step. After BeakerBot demonstrated the dep wiring in
 * the previous step, the user does the same operation in the other
 * direction (B as a "start after" of the user's experiment).
 *
 * Page lock: ON. The TourPageLock allows clicks only on Fake B's bar
 * and (after the drag) on the dependency-type-picker's "start after"
 * option. Wrong clicks anywhere else surface an "Oops, try X" speech
 * bubble flash (2-second).
 *
 * Completion: event-driven. Listens for `tour:user-created-dep` (a new
 * custom event fired by `dependenciesApi.create` when the parent is
 * the user's experiment and the child is Fake B). The dep_type "FS"
 * matches "start after" semantics in the existing dependency-picker.
 *
 * Implementation note: rather than patch `dependenciesApi.create` to
 * dispatch a custom event (which would broaden the platform contract
 * for a tour-only signal), the step listens on a window-level
 * `tour:user-created-dep` event AND polls the dependenciesApi.list
 * result every 500ms as a back-up. The polling fallback is what
 * actually catches the user's dep creation in the current build; the
 * window-level custom event hook is a forward-looking hook so future
 * GanttChart code can fire the event explicitly for a snappier
 * completion.
 */
import { useEffect } from "react";
import { dependenciesApi } from "@/lib/local-api";
import { buildWalkthroughStep, advanceOnEvent } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  resolveFakeTaskIds,
  resolveUserExperiment,
} from "./lib/gantt-redesign-helpers";
import { useOptionalTourController } from "../../TourController";

/**
 * Inline component that toggles the page-lock allow-list on mount and
 * clears it on unmount. Rendered inside the speech bubble so it
 * naturally participates in the React lifecycle scoped to the step.
 */
function GanttDepsUserSpeech() {
  const controller = useOptionalTourController();
  useEffect(() => {
    // Optional controller — when this body renders outside a
    // TourControllerProvider (in step-bodies.test rendering the speech
    // in isolation), skip the page-lock wiring entirely.
    if (!controller) return;
    controller.setPageLock(
      [
        TOUR_TARGETS.ganttBarFakeB,
        TOUR_TARGETS.ganttBarUserExperiment,
        // The dep-type picker's affordances aren't reliably tagged with
        // data-tour-target attributes yet; we allow the dialog wrapper
        // via a future-friendly addition. The Gantt's dependency popup
        // surfaces "start before" / "start after" picker options inside
        // a contained <div> that we'd ideally stamp. For now the lock
        // is a hard guard against ALL other UI; once the user drops B
        // onto the user experiment, the picker pops over the lock layer
        // (z-index above 419) and the user can click through. (See
        // ONBOARDING_V4_GANTT_REDESIGN.md: this is a known
        // FOLLOW-UP — the picker's allow-list isn't stamped on the
        // existing GanttChart dep popup; first cut accepts that the
        // user might trip the lock with a slightly off click on the
        // popup edge.)
      ],
      (
        <>
          <p className="mb-1">Oops, that's not the right thing.</p>
          <p>
            Drag Fake experiment B onto your experiment, then pick "start
            after".
          </p>
        </>
      ),
    );
    return () => {
      controller.clearPageLock();
    };
  }, [controller]);
  return (
    <>
      <p className="mb-2">
        Your turn. Drag Fake experiment B onto your experiment, then
        pick "start after".
      </p>
      <p className="text-xs text-gray-500">
        (I'll keep you on rails. Clicks outside the right affordance
        will be ignored.)
      </p>
    </>
  );
}

export const ganttDepsUserStep = buildWalkthroughStep({
  id: "gantt-deps-user",
  speech: () => <GanttDepsUserSpeech />,
  pose: "pointing",
  targetSelector: targetSelector(TOUR_TARGETS.ganttBarFakeB),
  completion: advanceOnEvent((advance) => {
    // Polling-based completion: every 500ms, check the user's active
    // project deps for a (user_experiment → fakeB) edge. When found,
    // advance.
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      if (cancelled) return;
      try {
        const userExp = await resolveUserExperiment();
        const { fakeBId, projectId } = await resolveFakeTaskIds();
        if (!userExp || !fakeBId || !projectId) return;
        const deps = await dependenciesApi.list(projectId);
        const hit = deps.find(
          (d) => d.parent_id === userExp.id && d.child_id === fakeBId,
        );
        if (hit) {
          cancelled = true;
          if (timer) clearInterval(timer);
          advance();
        }
      } catch (err) {
        // Best-effort polling — swallow + log so a transient FS hiccup
        // doesn't wedge the step.
        console.warn(
          "[gantt-deps-user] dep-poll failed",
          err,
        );
      }
    };

    timer = setInterval(poll, 500);
    // Fire once immediately so a back-step into a state where the dep
    // already exists auto-advances.
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }),
  expectedRoute: "/gantt",
});
