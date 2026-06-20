// Class Mode (CM-P2B): pure resolvers for the app-shell chrome reskin under a
// class context. Centralizes the lens label, the dashboard ("/") entry label,
// and the PI-lab-lens nav lineup so AppShell consumes one tested function
// instead of inlining class branches. Pure, no I/O, no React, so the flag-off
// parity is unit-provable.
//
// A class instructor's folder carries account_type "lab_head" + lab_kind
// "class" (see lib/lab/lab-mode.ts isClassFolder, surfaced by useIsClassMode).
// That makes the instructor a PI by role, so today they would get the full
// RESEARCH-LAB chrome (Lab Overview, Funding, Approvals, purchasing). That is
// wrong for a classroom. When class mode is active this module relabels the
// lens + dashboard entry and FILTERS the research-lab-only PI tabs (Funding,
// Approvals) out of the lab-lens lineup while KEEPING the science tools a CURE
// course needs (sequences, primer design, phylo, datahub, methods, notebook,
// calendar) because those flow through the shared researcher nav, untouched.
//
// Flag-off parity: useIsClassMode is falsy whenever no class folder is active
// (and is falsy everywhere with NEXT_PUBLIC_CLASS_MODE off, since nothing ever
// writes lab_kind === "class"). Every function here takes `classMode` as a
// boolean and returns the EXISTING research-lab value when it is false, so the
// AppShell output is byte-identical to today in that case.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { NavItem } from "../nav";
import { HOME_HREF } from "../nav";

/**
 * The role-lens label shown on the PI view toggle. "Class" for a class
 * instructor, "Lab" for a research PI. classMode false returns the legacy
 * "Lab" verbatim.
 */
export function lensLabel(classMode: boolean): string {
  return classMode ? "Class" : "Lab";
}

/**
 * The dashboard ("/") nav-entry label in the PI lab lens. "Class Overview"
 * for a class instructor, "Lab Overview" for a research PI. classMode false
 * returns the legacy "Lab Overview" verbatim.
 */
export function overviewLabel(classMode: boolean): string {
  return classMode ? "Class Overview" : "Lab Overview";
}

/**
 * The Class Materials nav href. The instructor-only surface that lists the
 * records this instructor shares to the whole class (the "*" sentinel). Lives
 * only in the class lab-lens lineup; there is no research-lab equivalent, so it
 * is added ONLY when class mode is active (see buildLabLensItems below). With
 * NEXT_PUBLIC_CLASS_MODE off no folder is a class so classMode is always false
 * and this entry never mounts, keeping flag-off parity.
 */
export const CLASS_MATERIALS_HREF = "/class-materials";

/**
 * The class-context relabel of ShareDialog's whole-lab grant. The underlying
 * grant (the "*" sentinel in shared_with) is UNCHANGED; this is a pure copy
 * switch so a class instructor reads "the whole class" / "students" instead of
 * "the whole lab" / "members". classMode false returns the legacy research-lab
 * copy verbatim, so the dialog is byte-identical when the flag is off.
 */
export interface WholeAudienceCopy {
  /** The recipient-row label for the "*" entry ("Whole class" vs "Whole lab"). */
  rowLabel: string;
  /** The "add" toggle copy when the grant is NOT yet present. */
  addLabel: string;
  /** The "remove" toggle copy when the grant IS present. */
  removeLabel: string;
  /** The helper line under the toggle. */
  helper: string;
  /** The aria phrase for "the whole <audience>" in the access-level group. */
  ariaAudience: string;
  /** The roster-preview lead-in: builds "All N students" / "Currently includes (N)". */
  rosterLead: (count: number) => string;
  /** The empty-roster line. */
  rosterEmpty: string;
}

export function wholeAudienceCopy(classMode: boolean): WholeAudienceCopy {
  if (classMode) {
    return {
      rowLabel: "Whole class",
      addLabel: "+ Share with the whole class",
      removeLabel: "Remove whole-class share",
      helper:
        "Whole-class shares default to read-only. Toggle the level above after adding.",
      ariaAudience: "the whole class",
      rosterLead: (count) => `All ${count} students`,
      rosterEmpty: "No students in this class yet.",
    };
  }
  return {
    rowLabel: "Whole lab",
    addLabel: "+ Share with the whole lab",
    removeLabel: "Remove Whole-lab share",
    helper:
      "Whole-lab shares default to read-only. Toggle the level above after adding.",
    ariaAudience: "the whole lab",
    rosterLead: (count) => `Currently includes (${count})`,
    rosterEmpty: "No other active members in this lab yet.",
  };
}

/**
 * The PI-only tab hrefs that have NO classroom meaning and are hidden from the
 * lab-lens lineup when class mode is active. Funding (grant money) and
 * Approvals (purchasing approvals) are research-lab management surfaces a CURE
 * course does not use. People + Lab Work + Activity STAY for now (a roster /
 * student-work / activity view maps onto a class); Stage 3 relabels those.
 */
export const CLASS_HIDDEN_PI_HREFS: ReadonlySet<string> = new Set([
  "/funding",
  "/approvals",
]);

/**
 * Top-nav hrefs (outside the fixed PI lab-lens lineup) that have no classroom
 * meaning and are filtered from the nav when class mode is active. /purchases
 * is the research lab purchasing surface; the science tools are NOT listed
 * here, so they stay visible. Empty-equivalent when class mode is off (the
 * filter below short-circuits).
 */
export const CLASS_HIDDEN_NAV_HREFS: ReadonlySet<string> = new Set([
  "/purchases",
]);

/**
 * Build the PI lab-lens lineup. Mirrors the existing inline AppShell loop: the
 * dashboard ("/") entry expands into the curated PI tabs (Overview, People,
 * Lab Work, Approvals, Activity, Funding) and the personal Workbench drops out.
 *
 * When `classMode` is true the Overview entry is relabeled via overviewLabel
 * and the research-lab-only tabs in CLASS_HIDDEN_PI_HREFS (Funding, Approvals)
 * are omitted. When false the output is byte-identical to the legacy inline
 * loop, so flag-off parity holds.
 *
 * @param filtered    the already-filtered base nav items (post visibility gates)
 * @param classMode   whether the active folder is a class the user instructs
 */
export function buildLabLensItems(
  filtered: NavItem[],
  classMode: boolean,
): NavItem[] {
  const out: NavItem[] = [];
  for (const item of filtered) {
    if (item.href === HOME_HREF) {
      out.push({ href: "/lab-overview", label: overviewLabel(classMode) });
      out.push({ href: "/people", label: "People" });
      out.push({ href: "/lab-work", label: "Lab Work" });
      if (!(classMode && CLASS_HIDDEN_PI_HREFS.has("/approvals"))) {
        out.push({ href: "/approvals", label: "Approvals" });
      }
      out.push({ href: "/activity", label: "Activity" });
      if (!(classMode && CLASS_HIDDEN_PI_HREFS.has("/funding"))) {
        out.push({ href: "/funding", label: "Funding" });
      }
      // CT-1: the Class Materials surface is instructor-only and class-only.
      // It lists the records this instructor shares to the whole class, so it
      // is added ONLY in class mode (no research-lab equivalent). Placed right
      // after the PI tabs and before the science tools.
      if (classMode) {
        out.push({ href: CLASS_MATERIALS_HREF, label: "Class Materials" });
      }
    } else if (item.href === "/workbench") {
      // Researcher home; reachable by flipping to "My work", not in lab lens.
      continue;
    } else if (classMode && CLASS_HIDDEN_NAV_HREFS.has(item.href)) {
      // Research-lab-only tool (e.g. /purchases) with no classroom meaning.
      continue;
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * Filter applied to the researcher (non-lab-lens) tab set in class mode: drop
 * the research-lab-only tabs that have no classroom meaning. classMode false
 * is the identity filter (every tab kept), so flag-off parity holds. The
 * caller still strips the HOME_HREF entry separately, exactly as today.
 */
export function filterResearcherItems(
  researcher: NavItem[],
  classMode: boolean,
): NavItem[] {
  if (!classMode) return researcher;
  return researcher.filter((item) => !CLASS_HIDDEN_NAV_HREFS.has(item.href));
}

/**
 * CT-6: slim a class STUDENT's top-nav to the instructor's allowlist. Keeps only
 * the items whose href is in `allowed` (resolveClassStudentNav). Applied ONLY for
 * a class student (the caller gates on useIsClassStudent + the flag), so a
 * research-lab / solo / instructor / flag-off nav is never touched. /workbench is
 * always in `allowed` (the resolver force-adds it), so the student keeps their
 * home, no soft-lock. Hiding here is nav-visibility only, never a route gate.
 */
export function filterClassStudentNav(
  items: NavItem[],
  allowed: ReadonlySet<string>,
): NavItem[] {
  return items.filter((item) => allowed.has(item.href));
}
