/**
 * §6.12 wiki-pointer nav suppression flag, extracted to a standalone
 * dependency-free module (circular-import break, 2026-05-27).
 *
 * Why this file exists: these four helpers used to live in
 * `TourBootstrap.tsx`. WikiPointerStep.tsx imported the set/clear
 * helpers from TourBootstrap; TourBootstrap imports `getStep` from
 * `step-registry`; step-registry imports WikiPointerStep (to register
 * it). That closed a cycle:
 *
 *   step-registry -> WikiPointerStep -> TourBootstrap -> step-registry
 *
 * The cycle is tolerated by Next.js's bundler but breaks vitest's
 * module loader: when step-registry evaluates, it triggers
 * WikiPointerStep, which triggers TourBootstrap, which re-enters
 * step-registry mid-evaluation (exports still undefined), so the
 * registry's `wikiPointerIntroStep.id` read throws
 * "Cannot read properties of undefined". The whole step-bodies test
 * suite couldn't import.
 *
 * Pulling the flag helpers into this tiny module (no imports beyond
 * the DOM's sessionStorage) lets WikiPointerStep import from HERE
 * instead of from TourBootstrap, so the cycle never forms. Mirrors
 * the `lib/query-client.ts` extraction pattern (dependency-free module
 * for cross-tree consumers).
 *
 * 2026-06-03 (HR / tour-simplification): the §6.12 cursor navigation
 * beats (wikiPointerClickDemoStep, wikiPointerBackDemoStep) that set +
 * cleared this flag were cut, so `markWikiPointerNavActive` is no longer
 * called from the cluster and the flag is effectively never set in normal
 * tour flow. The module + its TourBootstrap guard + the Discard/Restart
 * clear calls are retained as a harmless safety net in case a future
 * cluster beat re-introduces a BeakerBot-driven wiki navigation. The
 * per-function references to the cut beats below are kept for historical
 * context.
 */

/** sessionStorage key flipped to "1" while the §6.12 wiki-pointer
 *  cluster is mid-walk and the BeakerBot-driven cursor click on the
 *  `?` icon is about to (or has just) navigated the user to a
 *  `/wiki/*` route. The wiki route runs under a different early-return
 *  branch in `providers.tsx`, which unmounts the previous tree's
 *  `V4MountForUser` and mounts a fresh one inside the wiki shell. That
 *  remount restarts TourBootstrap from scratch, which reads the
 *  persisted `wizard_resume_state.current_step` off disk (now a
 *  wiki-pointer-* step) and would otherwise surface the
 *  Restart / Resume / Discard modal mid-tour. The flag tells the probe
 *  "I'm mid-cluster, do NOT pop the modal; silently resume the saved
 *  step instead." Set in `wikiPointerClickDemoStep.onEnter`, cleared in
 *  `wikiPointerBackDemoStep.onExit` so the suppression is scoped to
 *  the in-cluster window only. */
export const WIKI_NAV_FLAG = "tour:wiki-pointer-nav-active";

/** True when the wiki-pointer nav suppression flag is set. SSR-safe:
 *  returns false when `sessionStorage` is undefined. */
export function isWikiNavInProgress(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(WIKI_NAV_FLAG) === "1";
  } catch {
    return false;
  }
}

/** Set the wiki-pointer nav suppression flag. Called from
 *  `wikiPointerClickDemoStep.onEnter` the moment the cluster's
 *  cursor-driven navigation beat starts. Swallows storage errors
 *  (private-mode / disabled storage) so the step never throws on entry. */
export function markWikiPointerNavActive(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(WIKI_NAV_FLAG, "1");
  } catch {
    // Swallow.
  }
}

/** Clear the wiki-pointer nav suppression flag. Called from
 *  `wikiPointerBackDemoStep.onExit` once the cluster's final beat
 *  truly advances past the cluster. Also called defensively from the
 *  Discard / Restart paths so a flag left over from a previous run
 *  cannot bleed into the next session. */
export function clearWikiPointerNavActive(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(WIKI_NAV_FLAG);
  } catch {
    // Swallow.
  }
}
