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
import { getCurrentUserCached } from "@/lib/storage/json-store";
import { buildWalkthroughStep, advanceOnEvent } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import {
  recordUserToFakeBDepArtifact,
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
  // Bug-squad fix bot 2026-05-26 (Bug 3 family): same controller-dep
  // infinite loop pattern as MethodsCategoryOpenSpeech. Pin only the
  // stable useCallback handles so the effect doesn't re-fire every
  // time the TourController's context value rebuilds.
  const setPageLock = controller?.setPageLock;
  const clearPageLock = controller?.clearPageLock;
  useEffect(() => {
    // Optional controller — when this body renders outside a
    // TourControllerProvider (in step-bodies.test rendering the speech
    // in isolation), skip the page-lock wiring entirely.
    if (!setPageLock || !clearPageLock) return;
    // Gantt fix manager R1 (P0 #3): the dep-type picker's "start after"
    // button MUST be on the allow-list so the user can complete the
    // chain after the drag lands. The picker now carries
    // `data-tour-target` attributes (see GanttChart.tsx).
    //
    // R2 chip C 2026-05-22: tightened the picker allow-list to ONLY
    // include `ganttDepPickerStartAfter`. The advance poll only fires
    // for dep_type === "FS" (start after), so wrong-sibling clicks on
    // "start before" / "start same" used to close the picker silently
    // and strand the user. With the tightened allow-list, those wrong
    // clicks now surface the standard TourPageLock oops flash instead.
    setPageLock(
      [
        TOUR_TARGETS.ganttBarFakeB,
        TOUR_TARGETS.ganttBarUserExperiment,
        TOUR_TARGETS.ganttDepPickerStartAfter,
      ],
      (
        <>
          <p className="mb-1">Oops, that's not the right thing.</p>
          <p>
            Drag Fake experiment B onto your experiment, then pick "start
            after" so B starts after your experiment finishes.
          </p>
        </>
      ),
    );
    return () => {
      clearPageLock();
    };
  }, [setPageLock, clearPageLock]);
  return (
    <>
      <p className="mb-2">
        Now you wire the other side. Drop Fake B onto your experiment,
        then pick "start after" so B is forced to wait until your
        experiment finishes.
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
        // Gantt fix manager R1 (P1 #5): dep_type matters here. The
        // step's brief instructs the user to pick "start after" (= FS
        // semantics). If they pick a different type the poll should
        // NOT advance — the wrong-click flash will surface the right
        // copy via the page-lock's oops handler instead. Look for an
        // exact FS hit.
        const hit = deps.find(
          (d) =>
            d.parent_id === userExp.id &&
            d.child_id === fakeBId &&
            d.dep_type === "FS",
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
  // Gantt fix manager R1 (P1 #9): record the user→fake_b dep edge as a
  // discard artifact for Phase 4 cleanup. Best-effort; failures don't
  // block the step transition.
  onExit: async () => {
    try {
      const username = await getCurrentUserCached();
      const resolved = username && username !== "_no_user_" ? username : null;
      await recordUserToFakeBDepArtifact({ username: resolved });
    } catch (err) {
      console.warn(
        "[gantt-deps-user] onExit artifact persist failed",
        err,
      );
    }
  },
  expectedRoute: "/gantt",
});
