import { NAV_ITEMS } from "@/lib/nav";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/**
 * Derive the user's visible-tab list from their Phase 1 feature picks.
 * v3 successor to `tabsForUseCases()` in `use-case-tab-mapping.ts`:
 * tab visibility is no longer driven by a use-case taxonomy, it is
 * derived directly from the Q1 (solo vs lab) + Q2-Q5 (binary feature)
 * answers per ONBOARDING_V3_PROPOSAL.md §4.
 *
 * Contract:
 *   - `picks === null` → return `null`. The caller (tab-visibility
 *     consumer) interprets this as "fall back to settings.json
 *     visibleTabs as-is", which preserves the L1/L22 invariant that
 *     existing users (migrated v3 → v4 with feature_picks=null) see
 *     no change to their tab set.
 *   - `picks !== null` → return an array of NAV_ITEMS hrefs in canonical
 *     nav order, including only the tabs visible under the picks.
 *
 * Tab inclusion rules (per proposal §4):
 *   - "/" (Home), "/workbench", "/gantt", "/methods", "/search":
 *     always visible.
 *   - "/purchases":  iff picks.purchases === "yes".
 *   - "/calendar":   iff picks.calendar  === "yes".
 *   - "/links" (Lab Mode / Lab Links): iff picks.account_type === "lab".
 *
 * Note on tabs the proposal mentions that don't have nav hrefs yet:
 * the proposal also names "Experiments always visible" and "Goals iff
 * picks.goals === yes". Neither has a top-nav route today (Experiments
 * lives under Workbench; Goals lives under Gantt/Workbench). When
 * dedicated `/experiments` or `/goals` nav items land, extend this
 * helper to include them under the same rules. P2a flags this in the
 * arc report so a follow-up chip can pick it up.
 */
export function tabsForFeaturePicks(
  picks: FeaturePicks | null,
): string[] | null {
  if (picks === null) return null;

  const visible = new Set<string>([
    "/",
    "/workbench",
    "/gantt",
    "/methods",
    "/search",
  ]);
  if (picks.purchases === "yes") visible.add("/purchases");
  if (picks.calendar === "yes") visible.add("/calendar");
  if (picks.account_type === "lab") visible.add("/links");

  return NAV_ITEMS.map((item) => item.href).filter((href) =>
    visible.has(href),
  );
}
