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
 *   - "/" (Home), "/workbench", "/gantt", "/methods", "/sequences",
 *     "/search": always visible.
 *   - "/purchases":  iff picks.purchases === "yes".
 *   - "/calendar":   iff picks.calendar  === "yes".
 *   - "/links" (Links / Lab Links): iff picks.links === "yes" (Lab
 *     Links manager 2026-05-22). Previously gated on
 *     `picks.account_type === "lab"`; now gated on the Q7 answer so
 *     both solo and lab users get an explicit opt-in. The DISPLAYED
 *     label is conditional on account_type ("Links" for solo, "Lab
 *     Links" for lab) — that's rendered by the nav-label resolver in
 *     AppShell, not here. This file only owns visibility, not labels.
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
    // Sequences arc 2026-06-02: the SnapGene-style sequence editor is a
    // core molecular-biology surface alongside Methods, with no Q2-Q5
    // feature-pick to gate it. Always visible (like /methods); a future
    // wizard question can add a gate here if de-bloat calls for one.
    "/sequences",
    "/search",
  ]);
  if (picks.purchases === "yes") visible.add("/purchases");
  if (picks.calendar === "yes") visible.add("/calendar");
  // Lab Links manager 2026-05-22: gated on Q7 answer (links === "yes")
  // for everyone, replacing the previous account_type === "lab" gate.
  // Solo + lab users both get an explicit opt-in via Q7.
  if (picks.links === "yes") visible.add("/links");

  return NAV_ITEMS.map((item) => item.href).filter((href) =>
    visible.has(href),
  );
}

/**
 * Compose the effective visible-tab set from the user's Phase 1
 * feature_picks (primary) and the settings.json visibleTabs (manual
 * override layer). This is the AppShell-side read path that pairs
 * with `tabsForFeaturePicks`.
 *
 * Contract (per ONBOARDING_V3_PROPOSAL.md §10 + master + Grant
 * 2026-05-20 design lock):
 *   - feature_picks is PRIMARY. If picks === null (existing user,
 *     picks not yet set), the manual layer is authoritative as-is,
 *     which preserves the L1/L22 invisibility invariant for any
 *     pre-v4 sidecar.
 *   - When picks !== null, settings.json.visibleTabs can additionally
 *     HIDE tabs that feature_picks would show (manual override), but
 *     it CANNOT unhide tabs that feature_picks excluded. A user who
 *     answered "no" to /calendar in the wizard but whose settings.json
 *     still lists /calendar (carryover from defaults) gets /calendar
 *     HIDDEN; the wizard answer wins.
 *
 * Settings UI carve-out (intentionally out of scope for this read
 * path): the existing Settings → "Visible tabs" toggles still WRITE
 * to settings.json.visibleTabs, not to feature_picks. The Settings
 * redesign is deferred. Consequence: a user who picked "no" for a tab
 * in the wizard and then opens Settings cannot toggle that tab back
 * on; the toggle sticks to "off" because feature_picks blocks it.
 * This is the documented manual-override semantics, not a bug.
 *
 * Returns a fresh array; never mutates the input.
 */
export function deriveVisibleTabs(
  picks: FeaturePicks | null,
  settingsVisibleTabs: readonly string[],
): string[] {
  const featurePicksTabs = tabsForFeaturePicks(picks);
  if (featurePicksTabs === null) return [...settingsVisibleTabs];
  return settingsVisibleTabs.filter((href) => featurePicksTabs.includes(href));
}
