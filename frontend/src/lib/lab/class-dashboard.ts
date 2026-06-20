// Class dashboard (CT-5 + CT-3): the instructor-authored curated-Workbench
// template plus the class visibility default, delivered to every student via ONE
// lab-wide-public relay record.
//
// WHAT "DASHBOARD" MEANS (Grant 2026-06-19): a student's dashboard IS the curated
// Workbench (app/workbench/page.tsx), a FIXED tab strip (Projects / Experiments /
// Notes / Lists / Mentoring). The drag-drop widget grid was torn down 2026-06-02
// and is NEVER resurrected here. The instructor picks which workbench tabs render
// and in what order, the landing tab, an optional intro banner, the enabled tool
// + method-type surfaces, and the class visibility default. Students get exactly
// that. V1 is FORCE-ONLY (no per-student customization, no apply-banner).
//
// DELIVERY (the same path announcements ride): a NEW lab-wide-public relay record
// TYPE `class_dashboard`, instructor-owned at a well-known recordId, E2E under the
// class team key (server-blind), surfaced to every roster member by the extended
// `isLabWidePublic` guard in lab-read.ts. The record is a singleton per class.
//
// THE RESOLUTION CONTRACT (mirrors resolveEnabledMethodTypes in
// methods/method-type-enablement.ts; load-bearing, every consumer must honor it):
//
//  - NO template (not a class, or the record is absent) => today's hardcoded
//    workbench: all tabs in their default order, the default landing tab, no
//    intro banner. A flag-off / research-lab folder NEVER reads this record, so
//    its workbench is byte-identical to before.
//  - ABSENT `tabs` on a present template => all tabs on (the absent-is-all-on
//    rule, same as enabledMethodTypes). An EMPTY `tabs` array is a real
//    "everything off" choice, distinct from absent, but at least the landing tab
//    is always kept so a student is never stranded on an empty strip.
//  - `tabs` is an ordered subset of the workbench TabType union; unknown ids are
//    dropped, order is preserved as authored.
//  - `landingTab` lands the student on that tab if it survives the resolved set;
//    otherwise the first resolved tab.
//  - `visibilityDefault` seeds a NEW student record's initial shared_with at
//    create time ONLY ("collaborative" => ["*"], "private"/absent => empty). It
//    never retroactively reshares.
//
// No emojis, no em-dashes, no mid-sentence colons.

// ---------------------------------------------------------------------------
// The workbench tab vocabulary.
// ---------------------------------------------------------------------------

/**
 * The workbench tab ids, in their DEFAULT render order. This MUST stay in sync
 * with the TabType union + button order in app/workbench/page.tsx. Kept here as
 * the single source the resolver orders + validates against, so the page and the
 * resolver agree on "all tabs in order".
 */
export const WORKBENCH_TAB_ORDER = [
  "projects",
  "experiments",
  "notes",
  "lists",
  "oneonone",
] as const;

export type WorkbenchTabId = (typeof WORKBENCH_TAB_ORDER)[number];

/** The default landing tab when no template names one (today's hardcoded value). */
export const DEFAULT_LANDING_TAB: WorkbenchTabId = "projects";

function isWorkbenchTabId(value: unknown): value is WorkbenchTabId {
  return (
    typeof value === "string" &&
    (WORKBENCH_TAB_ORDER as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The relay-record shape.
// ---------------------------------------------------------------------------

/** The reserved recordType for the class dashboard relay record. */
export const CLASS_DASHBOARD_RECORD_TYPE = "class_dashboard";

/**
 * The well-known recordId for the singleton class dashboard. One per class, so
 * an author always overwrites the same key and every student reads the same key.
 */
export const CLASS_DASHBOARD_RECORD_ID = "class";

/**
 * The on-record payload (CT-5 curated workbench + CT-3 visibility default,
 * consolidated). Every field is optional so an instructor can publish a minimal
 * template and fill it in later. `rev` monotonically increases per author write
 * so a later device can tell which template is newer.
 *
 * FLAG (data-shape): a NEW lab-wide-public lab-record type `class_dashboard`,
 * additive + E2E under the team key. An unknown record type was invisible to
 * pullLabView before, so introducing it is safe.
 */
export interface ClassDashboard {
  /** Ordered subset of the workbench tabs. ABSENT = all tabs on. */
  tabs?: string[];
  /** Which resolved tab the student lands on. Falls back to the first resolved tab. */
  landingTab?: string;
  /** An instructor-pinned intro / syllabus banner shown above the tabs. */
  intro?: { title?: string; body?: string };
  /** Enabled tool surfaces (mirrors classConfig.enabledTools). ABSENT = all on. */
  enabledTools?: string[];
  /** Enabled method types (mirrors enabledMethodTypes). ABSENT = all on. */
  enabledMethodTypes?: string[];
  /** CT-3: the create-time visibility default for student-authored records. */
  visibilityDefault?: "collaborative" | "private";
  /**
   * CT-6: the student TOP-NAV allowlist (hrefs the instructor lets students see).
   * ABSENT = the coursework default (CLASS_STUDENT_NAV_DEFAULT, less-is-more). A
   * PRESENT array is the instructor's exact choice. /workbench is ALWAYS kept by
   * the resolver so a student is never stranded with no home (no soft-lock), and
   * hiding a screen from the nav never gates its ROUTE, so a direct link still
   * works. Mirrors the absent-is-default contract of `tabs`/`enabledTools`.
   */
  nav?: string[];
  /** Monotonic author revision. */
  rev: number;
}

// ---------------------------------------------------------------------------
// CT-6: the student top-nav allowlist.
// ---------------------------------------------------------------------------

/**
 * The coursework default student top-nav (less is more): the screens that make
 * sense in a classroom out of the box. /workbench (their home + Assignments tab)
 * plus the science tools a course uses. Everything else (GANTT, Purchases,
 * Inventory, Links, Figures, Phylo, Network, ...) is hidden by default and the
 * instructor turns it on per class. This is only a STARTING POINT, the instructor
 * tunes it via the class dashboard.
 */
export const CLASS_STUDENT_NAV_DEFAULT: readonly string[] = [
  "/workbench",
  "/methods",
  "/sequences",
  "/chemistry",
  "/datahub",
  "/figures",
  "/calendar",
];

/**
 * The screens an instructor can toggle for students in the class dashboard.
 * /workbench is NOT listed because it is always on (the student's home). Labels
 * mirror NAV_ITEMS. The default-checked set is whichever of these is in
 * CLASS_STUDENT_NAV_DEFAULT.
 */
export const CLASS_STUDENT_NAV_CHOICES: readonly { href: string; label: string }[] = [
  { href: "/methods", label: "Methods" },
  { href: "/sequences", label: "Sequences" },
  { href: "/chemistry", label: "Chemistry" },
  { href: "/datahub", label: "Data Hub" },
  { href: "/phylo", label: "Phylogenetics" },
  { href: "/figures", label: "Figures" },
  { href: "/library", label: "Icon Library" },
  { href: "/calendar", label: "Calendar" },
  { href: "/gantt", label: "GANTT" },
  { href: "/inventory", label: "Inventory" },
  { href: "/purchases", label: "Purchases" },
  { href: "/links", label: "Links" },
];

/**
 * Resolve the set of top-nav hrefs a class STUDENT may see, from the template.
 *
 *  - ABSENT `nav` => the coursework default (CLASS_STUDENT_NAV_DEFAULT).
 *  - PRESENT `nav` => exactly those hrefs (the instructor's choice), with
 *    /workbench force-added so the student always keeps their home.
 *
 * The caller filters the rendered nav by membership in this set. Hiding a screen
 * here is a NAV-visibility choice only, never a route gate, so the no-soft-locks
 * rule holds (a hidden screen stays reachable by URL, and the instructor can flip
 * it back on). Pure + synchronous, like resolveClassDashboard.
 */
export function resolveClassStudentNav(
  template: ClassDashboard | null | undefined,
): ReadonlySet<string> {
  if (template != null && Array.isArray(template.nav)) {
    const set = new Set<string>();
    for (const href of template.nav) {
      if (typeof href === "string" && href.length > 0) set.add(href);
    }
    // Never hide the student's home (no soft-lock onto an empty nav).
    set.add("/workbench");
    return set;
  }
  return new Set(CLASS_STUDENT_NAV_DEFAULT);
}

/**
 * The resolved, ready-to-render template. Always a concrete tab list + a concrete
 * landing tab so the workbench page never has to re-apply the absent-is-all-on
 * rule itself.
 */
export interface ResolvedClassDashboard {
  /** Concrete ordered tab ids to render. Never empty (always keeps the landing). */
  tabs: WorkbenchTabId[];
  /** Concrete landing tab, guaranteed to be a member of `tabs`. */
  landingTab: WorkbenchTabId;
  /** The intro banner, or null when none was authored. */
  intro: { title?: string; body?: string } | null;
}

// ---------------------------------------------------------------------------
// resolveClassDashboard.
// ---------------------------------------------------------------------------

/**
 * The default resolution: every tab in default order, the default landing tab,
 * no intro. Returned when there is no template (not a class / absent record),
 * which is exactly today's hardcoded workbench.
 */
export function defaultResolvedClassDashboard(): ResolvedClassDashboard {
  return {
    tabs: [...WORKBENCH_TAB_ORDER],
    landingTab: DEFAULT_LANDING_TAB,
    intro: null,
  };
}

/**
 * Resolve a raw `class_dashboard` payload (or its absence) into the concrete
 * tabs + landing + intro the workbench renders. Pure + synchronous so the page
 * and the tests can call it on a snapshot without async I/O.
 *
 *  - `null`/`undefined` template => defaultResolvedClassDashboard (all tabs).
 *  - ABSENT `tabs` => all tabs in default order.
 *  - A present `tabs` array => its known ids in AUTHORED order, unknown dropped.
 *    If that leaves nothing, the landing tab (or the default landing) is kept so
 *    the strip is never empty (no soft-lock onto a blank workbench).
 *  - `landingTab` is honored if it survives; otherwise the first resolved tab.
 */
export function resolveClassDashboard(
  template: ClassDashboard | null | undefined,
): ResolvedClassDashboard {
  if (template == null) return defaultResolvedClassDashboard();

  // Resolve the tab set. Absent => all on; present => known ids in authored order.
  let tabs: WorkbenchTabId[];
  if (template.tabs == null) {
    tabs = [...WORKBENCH_TAB_ORDER];
  } else {
    const seen = new Set<WorkbenchTabId>();
    tabs = [];
    for (const id of template.tabs) {
      if (isWorkbenchTabId(id) && !seen.has(id)) {
        seen.add(id);
        tabs.push(id);
      }
    }
  }

  // Resolve the landing tab before any empty-guard backfill, so an explicit
  // landing choice can rescue an otherwise-empty strip.
  const landingCandidate = isWorkbenchTabId(template.landingTab)
    ? template.landingTab
    : null;

  // Empty-strip guard: never strand the student on a blank workbench. Keep the
  // landing tab if one was named, else the default landing tab.
  if (tabs.length === 0) {
    tabs = [landingCandidate ?? DEFAULT_LANDING_TAB];
  }

  // The landing tab must be a member of the rendered set. Honor the authored
  // choice when it survives; otherwise land on the first resolved tab.
  const landingTab =
    landingCandidate && tabs.includes(landingCandidate)
      ? landingCandidate
      : tabs[0];

  const intro =
    template.intro &&
    ((template.intro.title && template.intro.title.trim().length > 0) ||
      (template.intro.body && template.intro.body.trim().length > 0))
      ? template.intro
      : null;

  return { tabs, landingTab, intro };
}

// ---------------------------------------------------------------------------
// CT-3: the create-time visibility seed.
// ---------------------------------------------------------------------------

/** The whole-lab sentinel, duplicated here to keep this module dependency-light
 *  (it equals WHOLE_LAB_SENTINEL in lib/sharing/unified.ts). */
const WHOLE_LAB = "*";

/** One `shared_with` entry, matching the SharedUser shape the record stores use
 *  (lib/sharing/unified.ts). Kept structurally compatible without importing the
 *  type so this module stays dependency-light. */
export interface ClassSharedSeedEntry {
  username: string;
  level: "read" | "edit";
}

/**
 * CT-3: the initial `shared_with` a NEW student-authored record should carry,
 * given the class visibility default. Consulted ONLY at record-create time in a
 * class context; never retroactively. Absent / "private" => empty (today's
 * behavior, the exam default); "collaborative" => the whole-class "*" entry at
 * read level (the CURE default, the whole class can read).
 *
 * Returns SharedUser-shaped entries so the caller can drop them straight into a
 * new record's `shared_with`.
 */
export function seedSharedWithForVisibility(
  visibilityDefault: "collaborative" | "private" | null | undefined,
): ClassSharedSeedEntry[] {
  return visibilityDefault === "collaborative"
    ? [{ username: WHOLE_LAB, level: "read" }]
    : [];
}

// ---------------------------------------------------------------------------
// Serialization for the relay record.
// ---------------------------------------------------------------------------

/** Encode a ClassDashboard payload to the bytes putLabRecord stores (E2E under
 *  the team key by the caller). */
export function encodeClassDashboard(template: ClassDashboard): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(template));
}

/**
 * Decode the plaintext of a `class_dashboard` record back into a ClassDashboard.
 * Defensive: a malformed / non-object payload returns null so a single bad write
 * never poisons every student's workbench (it falls back to the default).
 */
export function decodeClassDashboard(
  plaintext: Uint8Array,
): ClassDashboard | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  const out: ClassDashboard = {
    rev: typeof rec.rev === "number" ? rec.rev : 0,
  };
  if (Array.isArray(rec.tabs)) {
    out.tabs = rec.tabs.filter((t): t is string => typeof t === "string");
  }
  if (typeof rec.landingTab === "string") out.landingTab = rec.landingTab;
  if (typeof rec.intro === "object" && rec.intro !== null) {
    const intro = rec.intro as Record<string, unknown>;
    out.intro = {
      title: typeof intro.title === "string" ? intro.title : undefined,
      body: typeof intro.body === "string" ? intro.body : undefined,
    };
  }
  if (Array.isArray(rec.enabledTools)) {
    out.enabledTools = rec.enabledTools.filter(
      (t): t is string => typeof t === "string",
    );
  }
  if (Array.isArray(rec.enabledMethodTypes)) {
    out.enabledMethodTypes = rec.enabledMethodTypes.filter(
      (t): t is string => typeof t === "string",
    );
  }
  if (
    rec.visibilityDefault === "collaborative" ||
    rec.visibilityDefault === "private"
  ) {
    out.visibilityDefault = rec.visibilityDefault;
  }
  return out;
}
