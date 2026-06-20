import { fileService } from "../file-system/file-service";
import {
  setUserMetadataField,
  setUserMetadataColors,
  getUserMetadata,
} from "../file-system/user-metadata";
import type { ViewMode } from "../types";
import type { AnimationType } from "../store";
import { ALL_TAB_HREFS, HOME_HREF, isValidTabHref } from "../nav";
import {
  type NotificationPreferences,
  normalizeNotificationPreferences,
} from "@/lib/notifications/preferences";

export type CalendarViewMode = "month" | "week" | "day";
export type DateFormat = "MDY" | "DMY" | "YMD";
export type TimeFormat = "12h" | "24h";

// Markdown editor writing-surface width (MARKDOWN_EDITOR_TYPORA_DESIGN.md
// Phase 1, editor-fluid-width bot 2026-05-29). The four presets the Focus
// Mode width control offers. "comfortable" (~72ch) is the default measure;
// the others widen progressively, and "full" drops the measure cap so the
// surface uses the available width. The ch-value -> Tailwind-class mapping
// lives in `lib/markdown/editor-width-preset.ts` (the single source of truth
// the editor reads), so this type only enumerates the legal values.
export type EditorWidthPreset = "narrow" | "comfortable" | "wide" | "full";

// Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
// per-user persistence of the Lab Overview widget canvas + customizable
// sidebar (proposal §3, §3g). Stored in users/<u>/settings.json under
// the `lab_overview_layout` key — additive, optional; missing payload
// resolves to the account-type-default layout at read time (see
// `frontend/src/lib/lab-overview/layout-persistence.ts`).
//
// Schema is versioned so future catalog additions can run a one-way
// migration that appends the new widget at the bottom of `canvas` (or
// `sidebar.order`) without trashing the user's custom positions. Unknown
// widget IDs (e.g. a widget that got renamed or removed) are dropped at
// read time with a console.warn; the read helper still resolves to a
// usable shape.
/**
 * Widget canvas Phase A (Phase A redispatch manager, 2026-05-23):
 * the persisted layout shape switched from the R2 free-grid map to a
 * simple ordered list of widget IDs per surface.
 *
 * v2 (current) — `LabOverviewLayout`:
 *   { version: 2, widgetOrder: { canvas: string[], sidebar: string[] } }
 *
 * v1 (legacy, migrated at read time) — `LabOverviewLayoutV1`:
 *   { version: 1, canvas: { [id]: { x, y, w, h } },
 *                 sidebar: { order, hidden } }
 *
 * Both shapes can exist on disk; `migrateLayoutToV2` in
 * `frontend/src/lib/lab-overview/layout-persistence.ts` upgrades v1
 * payloads on read. The `LabOverviewLayout` union type below covers
 * both so consumers (mostly the layout-persistence module) can hold a
 * reference to either while still being type-checked.
 */
export interface LabOverviewWidgetPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Legacy v1 free-grid shape. Still appears on disk for users who
 *  haven't visited the Lab Overview surface since the Phase A change.
 *  Migrated at read time; never written. */
export interface LabOverviewLayoutV1 {
  version: 1;
  canvas: Record<string, LabOverviewWidgetPosition>;
  sidebar: {
    order: string[];
    hidden: string[];
  };
}

/**
 * Per-instance widget configuration (weekly-goals widget, 2026-05-29).
 *
 * PERSISTED-LAYOUT-SHAPE CHANGE — additive + optional. A placed widget can
 * carry a small config object persisted alongside the canvas layout. The
 * first (and currently only) field is `pinnedMember`: when set, a widget
 * that supports a single-member mode (e.g. the Trainee notes + weekly goals
 * widget) shows that ONE member directly instead of the roster step. Unset
 * = the widget's default (everyone / roster) mode.
 *
 * Old layouts that predate this field simply have no `widgetConfig` map and
 * read as "every widget in default mode" — no migration needed.
 */
export interface WidgetInstanceConfig {
  /** When set, the widget is pinned to this one member's username. */
  pinnedMember?: string;
  /**
   * Project-widgets family (project-widgets, 2026-05-29). PERSISTED-
   * LAYOUT-SHAPE CHANGE: additive + optional.
   *
   * The Projects Overview widget's scope toggle. `"my"` = the viewer's
   * own projects; `"lab"` = all members' projects the viewer can see
   * (sharing-respecting). UNSET = the widget's default-by-surface
   * (`"lab"` on the lab-overview canvas, `"my"` on /home). Persisting it
   * lets a PI flip a home instance to lab scope, or a member flip a
   * canvas instance to their own projects, and have it stick.
   */
  projectScope?: "my" | "lab";
  /**
   * Project-widgets family (project-widgets, 2026-05-29). PERSISTED-
   * LAYOUT-SHAPE CHANGE: additive + optional.
   *
   * The Single-Project widget's pinned target. Carries BOTH the project
   * id AND its owner because project ids are namespaced per-owner (a PI's
   * own project 5 and a trainee's project 5 are distinct records). Unset
   * = the widget shows its empty "pick a project" state. Mirrors
   * `pinnedMember` as a single-target pin, but for a project instead of a
   * member.
   */
  pinnedProject?: { id: number; owner: string };
}

/**
 * Project-widgets family (project-widgets, 2026-05-29): is this
 * per-instance config "empty", i.e. carries no meaningful field, so the
 * persistence layer should DROP the entry and let the widget fall back to
 * its default mode?
 *
 * Before this helper, the canvas + persistence layers special-cased the
 * single `pinnedMember` field ("empty iff no pinnedMember"). With more
 * config fields (`projectScope`, `pinnedProject`) that test would wrongly
 * discard a `{ projectScope: "lab" }` config. This is the single source
 * of truth: a config is empty iff EVERY known field is unset/blank.
 */
export function isWidgetConfigEmpty(
  config: WidgetInstanceConfig | null | undefined,
): boolean {
  if (!config) return true;
  const hasMember =
    config.pinnedMember !== undefined && config.pinnedMember !== "";
  const hasScope = config.projectScope !== undefined;
  const hasProject =
    config.pinnedProject !== undefined &&
    config.pinnedProject !== null &&
    typeof config.pinnedProject.id === "number";
  return !hasMember && !hasScope && !hasProject;
}

/** Current v2 ordered-list shape. Written by every Phase A mutator. */
export interface LabOverviewLayoutV2 {
  version: 2;
  widgetOrder: {
    canvas: string[];
    sidebar: string[];
  };
  /**
   * Per-instance widget config, keyed by widget id (weekly-goals widget,
   * 2026-05-29). Optional + additive: absent map = every widget in its
   * default mode. Keyed by widget id (the same id used in `widgetOrder`)
   * because the canvas tracks one placed instance per widget id today.
   * Entries for ids not in `widgetOrder` are harmless and ignored.
   */
  widgetConfig?: Record<string, WidgetInstanceConfig>;
}

/** The canonical type consumers reference. Always v2 when read through
 *  `layout-persistence.readResolvedLayout`. Persisted payloads can
 *  still be v1 on disk; settings reader hands them through unchanged
 *  and the layout-persistence module migrates on the fly. */
export type LabOverviewLayout = LabOverviewLayoutV2;
// Lab Head Phase 1 (2026-05-23): per-user account role inside a shared lab.
// `member` = regular lab researcher (the existing behavior, defaults here).
// `lab_head` = PI / principal investigator; reveals the Lab Overview surface
// and (in Phase 2+) gains audit + soft-write capabilities. This is
// orthogonal to `FeaturePicks.account_type` ("solo" | "lab") which captures
// the onboarding-wizard choice of workspace shape; this field captures the
// user's role *within* a lab and is meaningful only for lab accounts.
export type AccountType = "member" | "lab_head";

// Class Mode (CM-P1, 2026-06-19): per-class teaching configuration. A class IS a
// lab structurally (own labId + team key, instructor = head, student = member);
// this config carries the teaching-specific cosmetics and defaults that a research
// lab has no use for. It rides on the class folder's instructor settings under
// `classConfig`, present only when `lab_kind === "class"`. Every sub-field except
// `isClass` is optional so a class can be minted minimally and filled in later.
//   - courseName  cosmetic course title shown in class chrome.
//   - term        cosmetic term label (e.g. "Fall 2026").
//   - enabledTools the teaching tool subset the instructor opts in to.
//   - visibilityDefault the default visibility for student-authored work in this
//                  class ("collaborative" = class-visible, "private" = student-only).
//   - lmsLink      an optional deep link back to the institution LMS.
export interface ClassConfig {
  isClass: boolean;
  courseName?: string;
  term?: string;
  enabledTools?: string[];
  visibilityDefault?: "collaborative" | "private";
  lmsLink?: string;
}

// Purchase department routing (PURCHASE_DOCS_AND_ROUTING.md). A PI-configured,
// opt-in module: a lab head adds the department / HR contacts a purchase
// document gets emailed to, plus the draft templates. Invisible everywhere until
// `enabled` is true, so a lab that does not use it never sees the surface. Lives
// in the lab head's own settings (the PI owns the lab config in a local folder).
export interface PurchaseRoutingContact {
  /** Stable id for editing / removal. */
  id: string;
  /** Display label, e.g. "Dept purchasing - Jane Doe". */
  name: string;
  /** Where the drafted email is addressed. */
  email: string;
}

export interface PurchaseRoutingConfig {
  /** The opt-in switch. False hides the whole routing surface. */
  enabled: boolean;
  /** Department / HR recipients the PI can pick when drafting. */
  contacts: PurchaseRoutingContact[];
  /** Draft subject template. Placeholders {item} {grant} {vendor} {total} {me}. */
  subjectTemplate: string;
  /** Draft body template. Same placeholders. */
  bodyTemplate: string;
}

export const DEFAULT_PURCHASE_ROUTING: PurchaseRoutingConfig = {
  enabled: false,
  contacts: [],
  subjectTemplate: "Purchase documentation for {grant}: {item}",
  bodyTemplate:
    "Hi,\n\nAttached is the order documentation for a purchase on {grant}.\n\n" +
    "Item: {item}\nVendor: {vendor}\nTotal: {total}\n\n" +
    "Please let me know if you need anything else.\n\nThank you,\n{me}",
};

// Lab membership agreement (LAB_ARCHIVE_CONTINUITY.md). PI-owned, opt-in. The
// data-ownership acknowledgment a member accepts at join. PI-side spine here
// (the template + version the PI edits); the member-side recorded acceptance +
// join gating is a separate slice. `version` bumps when the text changes
// materially, so an acceptance can record which version was agreed to. Framing
// is institutional-data / PI-as-custodian, NOT "the PI personally owns it", and
// it is NOT legal advice (the PI checks it against the institution's policy).
export interface LabMembershipAgreement {
  /** Whether the agreement is presented at join (gating wired in a later slice). */
  enabled: boolean;
  /** Bumps on material text change; acceptances record the accepted version. */
  version: number;
  /** The agreement body. */
  text: string;
}

export const DEFAULT_LAB_MEMBERSHIP_AGREEMENT: LabMembershipAgreement = {
  enabled: false,
  version: 1,
  text:
    "Research data created in this lab is institutional research data. The lab " +
    "head is its custodian and is responsible for retaining it to meet funder " +
    "and institution requirements (for example NIH data retention and your " +
    "university's policy).\n\n" +
    "By joining this lab you acknowledge that your finished lab work may be " +
    "archived and retained by the lab head for those compliance purposes, and " +
    "that the lab head can view and edit lab records as part of running the lab.\n\n" +
    "This is a lab agreement, not legal advice. Please read it against your " +
    "institution's own data and intellectual-property policy.",
};

export interface UserSettings {
  schemaVersion: 1;

  // Nav / layout
  visibleTabs: string[];          // hrefs from NAV_ITEMS — Home is always shown regardless of contents
  defaultLandingTab: string;      // href; falls back to HOME_HREF if not visible
  /** Layered ON TOP of `visibleTabs`: of the tabs that are visible at all,
   *  which sit inline in the bar vs. in the "More" overflow, and in what order.
   *  Both arrays are ordered hrefs. Absent = the default split. Reconciled to
   *  the current rendered nav set on read (see normalize). Additive, no migration. */
  navLayout?: { inline: string[]; more: string[] };

  // View defaults (mirror Zustand fields, but disk-backed)
  defaultGanttViewMode: ViewMode;
  defaultCalendarViewMode: CalendarViewMode;
  showSharedByDefault: boolean;

  // Personalization
  displayName: string | null;     // null → use folder name
  /** The user's preferred / greeting name ("call me Grant"). null → derive the
   *  greeting from the honorific-stripped first name of the display name. Lives
   *  here as the folder-local slot; the account-scoped value (account-settings)
   *  elevates over it so the preference follows the user across folders. */
  preferredName: string | null;
  color: string;                  // hex; mirrored to _user_metadata.json
  /** Optional second hex for a 2-stop user gradient. `null` → solid (the
   *  default). Mirrored to `_user_metadata.json:color_secondary`. */
  colorSecondary: string | null;
  coloredHeader: boolean;         // false → keep header white instead of tinting with `color`
  /** Show the Companion button in the app header. Off hides it; the hub stays
   *  reachable from Settings. */
  showCompanionButton: boolean;
  /** Auto-publish today/inventory/notebook snapshots to paired phones. Off is
   *  the kill switch; the laptop stops pushing snapshots to the companion. */
  autoPublishSnapshotsToPhones: boolean;
  /** How this laptop alerts when a timer finishes (Phase 3). "sound-visual"
   *  plays the Chime + the BeakerBot celebration; "visual-only" stays silent.
   *  Per-device; the phone keeps its own sound/vibration settings. */
  laptopAlarmMode: "sound-visual" | "visual-only";
  animationType: AnimationType;
  /** When off, suppresses the BeakerBot streak-celebration scenes
   *  (mouseWave / eureka / ladder / skateboard, etc.). Default true
   *  (opt-out). This is distinct from `animationType`
   *  above (the per-task-completion celebration the user picks) and from
   *  the v4 onboarding tour's guided BeakerBot cursor, neither of which
   *  this flag touches. Read by CelebrationManager. */
  beakerBotAnimations: boolean;
  /** Master "professional mode" switch. This flag itself gates nothing at
   *  read time: it is purely a one-shot convenience. When the Settings UI
   *  flips it ON it quiets all three playful surfaces at once (streak
   *  sidecar enabled=false, animationType="none", beakerBotAnimations=false).
   *  Turning it OFF does nothing automatic; the user re-enables each surface
   *  individually. Default false. */
  professionalMode: boolean;

  // Formatting
  dateFormat: DateFormat;
  timeFormat: TimeFormat;

  // Behavior
  confirmDestructiveActions: boolean;

  // Left sidebar (the one shown on every page except /calendar, which has
  // its own dedicated sidebar). Independent toggles so the user can pick
  // "tasks only", "calendar events only", or both stacked.
  sidebarShowTasks: boolean;
  sidebarShowCalendarEvents: boolean;
  /** When `sidebarShowCalendarEvents` is on, how far past today to peek.
   *  `0` = show today only (no "Next N days" subsection). */
  sidebarEventsHorizonDays: number;

  // Per-user opt-out (mirrored to _user_metadata.json so the existing lab readers keep working)
  hideGoalsFromLab: boolean;

  // Dashboard unification (dashboard-unification build, 2026-05-29):
  // ONE per-user dashboard layout. Home (route "/") and Lab Overview
  // (route "/lab-overview", now a redirect to "/") collapsed into a
  // single widget canvas at "/". This field is the unified persistence
  // for that canvas, replacing the previous split between `home_layout`
  // and `lab_overview_layout`.
  //
  // DATA-SHAPE MIGRATION (read at `readResolvedDashboardLayout`): when
  // this field is absent, it is seeded ONCE from the account-appropriate
  // legacy field — lab_head from `lab_overview_layout`, everyone else
  // from `home_layout` — and a Projects Overview instance is injected at
  // the top if the seeded layout lacks one. The legacy fields below stay
  // READABLE for one release for back-compat (do not delete them in the
  // same change). Optional + additive; same v2 shape as the legacy
  // fields so the SnapshotCanvas mechanics are reused unchanged.
  dashboard_layout?: LabOverviewLayout | LabOverviewLayoutV1;

  // Lab Head Phase 1: role inside the lab. Defaults to `member` for every
  // existing user via plain object spread in `normalize()`. `lab_head`
  // reveals the Lab Overview top-nav entry (renamed from "Lab Inbox" +
  // promoted out of the sidebar 2026-05-23) and (Phase 2+) audit + soft-write
  // surfaces. Multiple users in a lab can hold `lab_head` (co-PIs are
  // allowed by design, per Grant's 2026-05-23 decisions).
  account_type: AccountType;

  /** Lab Manager delegation (Phase 1, docs/proposals/2026-06-20-lab-admin-
   *  delegation-and-co-pi.md). True when this member was granted Lab Manager by a
   *  head-signed "role" log entry (the roster member's `admin` flag, materialized
   *  here so the folder-bound consumers can read the capability without re-fetching
   *  the relay record). It is a delegated APP-LEVEL capability (approve purchases,
   *  view audit / ops, manage companion-site content, propose member changes for the
   *  head to ratify), NOT a second cryptographic signer. Orthogonal to account_type:
   *  a manager is still account_type "member" (the head is the only "lab_head"), so
   *  the binary PI-vs-member role is unchanged and only an additive capability is
   *  layered on. Absent / false for the head and plain members. */
  lab_manager?: boolean;

  /** Lab-tier: the lab this user belongs to (head or member). Absent for solo users. */
  lab_id?: string;

  /** Class Mode (CM-P1): whether the lab this folder represents is a research lab
   *  or a teaching CLASS. A class IS a lab structurally (own labId + team key,
   *  instructor = head, student = member), so this kind discriminator rides
   *  ALONGSIDE lab_id rather than replacing it. Additive + optional + nullable:
   *  ABSENT means a research lab (the only kind before class mode), so every
   *  existing settings.json reads as a research lab unchanged. Only the class
   *  provisioner ever writes "class". normalize() leaves it absent when absent. */
  lab_kind?: "lab" | "class";

  /** Class Mode (CM-P1): per-class teaching configuration, present only on a
   *  class folder (lab_kind === "class"). All sub-fields are optional so a class
   *  can be minted with just isClass:true and filled in later. Additive +
   *  optional: ABSENT on every research-lab and solo folder, so normalize() never
   *  injects it and a flag-off settings.json is byte-identical. */
  classConfig?: ClassConfig;

  /** Lab-tier: genesis artifacts for a lab created locally whose relay publish
   *  has not yet succeeded. Present => LabGenesisPublishRetry keeps retrying the
   *  publish; cleared on success. Lets a PI be a lab head instantly without the
   *  relay, and lets openLabKey re-derive the key offline. */
  lab_pending_genesis?: import("@/lib/lab/lab-membership").PendingLabGenesis;

  /** Lab-tier reload-reconnect (NEXT_PUBLIC_LAB_RELOAD_RECONNECT): the PUBLIC
   *  sealed key artifacts for the lab this user last opened (the head-signed lab
   *  record plus this member's current-generation key envelope, exactly what a
   *  blind relay serves). Written on every successful openLabKey so that a later
   *  reload can re-derive the lab key offline when the relay is briefly
   *  unreachable, instead of bouncing the still-authenticated member to the
   *  "Sign in to your lab" gate. The 32-byte lab key is NEVER stored here (it is
   *  re-derived from the envelope, same as lab_pending_genesis). Absent until the
   *  flag is on and a lab has been opened at least once. */
  lab_envelope_cache?: import("@/lib/lab/lab-envelope-cache").CachedLabEnvelope;

  /** Department tier Phase 1: the dept_id this user ADMINISTERS, if any. Set when
   *  they create a department or accept an institution's dept-admin invite. An
   *  additive org relationship, NOT a mutually-exclusive account_type, so a PI can
   *  be both a lab head and a dept admin (the Department lens shows when this is
   *  set). Absent for everyone who does not run a department. */
  dept_admin_of?: string | null;

  /** Institution tier Phase 4: the institution_id this user ADMINISTERS, if any.
   *  Set when they create an institution. Additive org relationship like
   *  dept_admin_of (the Institution lens shows when set); a person can hold any
   *  combination of lab head / dept admin / institution admin. */
  institution_admin_of?: string | null;

  /** Purchase department-routing config (lab-head only, opt-in). Defaults to a
   *  disabled empty config; normalize() repairs a hand-edited bad shape. */
  purchaseRouting: PurchaseRoutingConfig;

  /** Per-category notification routing (bell / laptop / phone / email) plus
   *  quiet hours. Absent until the user opens the Notifications settings;
   *  consumers fall back to DEFAULT_NOTIFICATION_PREFERENCES. Phone + email are
   *  account-only, so a solo user's prefs never activate them. */
  notificationPreferences?: NotificationPreferences;

  /** Lab membership agreement config (lab-head only, opt-in). PI-side template +
   *  version; normalize() repairs a hand-edited bad shape. */
  labMembershipAgreement: LabMembershipAgreement;

  // When on, the app makes zero calls to its own server proxy
  // (`/api/calendar-feed`).
  offlineMode: boolean;

  // What's-new popup (whats-new bot, 2026-05-29). The version string of
  // the most recent release the user has acknowledged in the developer-
  // announcement / "What's New" popup. Optional + additive:
  //   - absent  → brand-new account / never seen the popup. On first load
  //     the manager silently records the current APP_VERSION here WITHOUT
  //     showing the popup, so only a genuine upgrade (a newer APP_VERSION
  //     than this stored value) ever triggers it.
  //   - present → the popup fires when APP_VERSION is strictly newer than
  //     this value; dismissing sets it to the latest release version.
  // Per-account: stored under users/<u>/settings.json like every other
  // user setting, so two accounts on the same browser track independently.
  lastSeenAnnouncementVersion?: string;

  // Markdown editor writing-surface width preset (MARKDOWN_EDITOR_TYPORA_
  // DESIGN.md Phase 1, editor-fluid-width bot 2026-05-29). DATA-SHAPE CHANGE:
  // additive + optional. The Focus Mode width control (Narrow / Comfortable /
  // Wide / Full-bleed) writes the user's choice here so it sticks across
  // sessions and devices. Absent = "comfortable" (the ~72ch default measure);
  // no migration needed for existing accounts. The editor also mirrors this
  // to localStorage for a synchronous first-paint read (the design doc's
  // per-editor preference pattern); settings.json is the durable per-user
  // record. Clamped to the legal union in `normalize()` so a hand-edited
  // garbage value falls back to the default at read time.
  editorWidthPreset?: EditorWidthPreset;

  // Spell-check in the Markdown editor (spell-check build, 2026-06-09). DATA-
  // SHAPE CHANGE: additive + optional. When on, the inline editor underlines
  // misspelled words (an English dictionary seeded with a curated lab wordlist
  // plus the user's "Add to dictionary" words) and offers click-to-fix
  // suggestions. Default OFF: spell-check on bench shorthand is noisy, so it is
  // opt-in. The Settings toggle mirrors this to localStorage
  // (`ros.spellcheck.enabled`) so the editor reads it synchronously at mount,
  // the same first-paint pattern as editorWidthPreset. Absent = off.
  spellCheckInEditor?: boolean;

  // Markdown editor focus behaviors (UNIFIED_EDITOR_SURFACE_DESIGN.md §3A, U5
  // toggles). DATA-SHAPE CHANGE: additive + optional, BOTH default OFF (the
  // design's "amber decision"). They engage ONLY at the fullscreen (expanded)
  // editor scale, never in the docked editor or BeakerBotCanvas. Mirrored to
  // localStorage (`ros.editor.typewriter` / `ros.editor.dimming`) so the editor
  // reads them synchronously at mount, the same first-paint pattern as
  // editorWidthPreset / spellCheckInEditor; settings.json is the durable
  // per-user record. Absent = off.
  //
  // editorTypewriterScroll: hold the active line at ~42% of the viewport so the
  // caret stops chasing down the page.
  editorTypewriterScroll?: boolean;
  // editorFocusDimming: fade every line except the active paragraph to ~30%
  // opacity, ONLY while the editor is focused (removed on blur so the resting
  // note is full-contrast).
  editorFocusDimming?: boolean;

  // LEGACY (dashboard-unification build, 2026-05-29): superseded by
  // `dashboard_layout` above. Kept READABLE for one release so the
  // one-time migration can seed `dashboard_layout` from it for an
  // existing lab_head's saved arrangement. Never written by the new
  // dashboard mutators; do not delete in this change.
  //
  // Lab Mode retirement R2 (R2 widget framework manager, 2026-05-23):
  // optional, additive. When absent, the layout-persistence reader fills
  // in the account-type-appropriate default. When present, unknown
  // widget IDs are dropped at read time and new catalog widgets append
  // at the end of canvas / sidebar. See `LabOverviewLayout` above.
  //
  // Widget canvas Phase A (Phase A redispatch manager, 2026-05-23): the
  // field type accepts either v1 (legacy free-grid) or v2 (current
  // ordered lists) so disk payloads from before the migration still
  // type-check. `readResolvedLayout` migrates v1 → v2 on the fly.
  lab_overview_layout?: LabOverviewLayout | LabOverviewLayoutV1;

  // LEGACY (dashboard-unification build, 2026-05-29): superseded by
  // `dashboard_layout` above. Kept READABLE for one release so the
  // one-time migration can seed `dashboard_layout` from it for an
  // existing member's / solo's saved arrangement. Never written by the
  // new dashboard mutators; do not delete in this change.
  //
  // Home canvas migration (Home canvas migration manager, 2026-05-23):
  // separate per-user persistence for the old /home widget canvas.
  // Reuses the same v2 shape as `lab_overview_layout` so the
  // SnapshotCanvas-style mechanics can be reused.
  home_layout?: LabOverviewLayout | LabOverviewLayoutV1;

  // Extension Store Phase U2 (extension-store U2 bot, 2026-05-29).
  // DATA-SHAPE CHANGE: additive + optional. The set of method types the
  // user has chosen to keep available in their new-method picker + template
  // library (anti-clutter, METHOD doc §4.3 / EXTENSION doc §1.3).
  //
  // ABSENT = all types enabled (existing users see ZERO change; this is the
  // back-compat default). An empty array is a DELIBERATE "everything off"
  // choice and is honored as such; do not conflate absent with empty. Each
  // entry is a `MethodTypeId` string; unknown ids (a type removed in a later
  // build) are ignored at resolve time.
  //
  // Enablement gates CREATION + PICKER/STORE-DEFAULT VISIBILITY ONLY. It
  // NEVER hides, deletes, or breaks rendering of an already-created or
  // shared method of a disabled type (otherwise receiving a mass-spec method
  // into a lab that disabled mass spec would break): the viewer/editor
  // dispatch always resolves any persisted type regardless of enablement.
  // See `frontend/src/lib/methods/method-type-enablement.ts` for the
  // resolution + gating helpers. Per-account / folder-scoped, like every
  // other field in this file.
  enabledMethodTypes?: string[];

  // Extension Store Phase U3 (extension-store U3 bot, 2026-05-29).
  // DATA-SHAPE CHANGE: additive + optional. The set of dashboard / home
  // WIDGETS the user has chosen to keep available in their "+ Add widget"
  // palette + the Widget store (the widget analogue of
  // `enabledMethodTypes`, EXTENSION doc §3.5).
  //
  // ABSENT = all widgets enabled (existing users see ZERO change; this is
  // the back-compat default). An empty array is a DELIBERATE "everything
  // off" choice and is honored as such; do not conflate absent with empty.
  // Each entry is a widget `id` from the registry; unknown ids (a widget
  // removed in a later build) are ignored at resolve time.
  //
  // Enablement gates PALETTE / STORE-DEFAULT OFFERING ONLY, and ONLY ON TOP
  // OF the existing account-type + surface gating (it NEVER widens
  // visibility: a member still never sees a PI-only widget). It NEVER
  // hides, deletes, or breaks an ALREADY-PLACED widget instance: a disabled
  // widget already on a saved layout keeps rendering, it just stops being
  // offered in the Add palette. See
  // `frontend/src/lib/lab-overview/widget-enablement.ts` for the resolution
  // + gating helpers. Per-account / folder-scoped, like every other field
  // in this file.
  enabledWidgets?: string[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  schemaVersion: 1,
  visibleTabs: [...ALL_TAB_HREFS],
  defaultLandingTab: HOME_HREF,
  defaultGanttViewMode: "2week",
  defaultCalendarViewMode: "month",
  showSharedByDefault: true,
  displayName: null,
  preferredName: null,
  color: "#3b82f6",
  colorSecondary: null,
  coloredHeader: true,
  showCompanionButton: true,
  autoPublishSnapshotsToPhones: true,
  laptopAlarmMode: "sound-visual",
  animationType: "rock",
  beakerBotAnimations: true,
  professionalMode: false,
  dateFormat: "MDY",
  timeFormat: "12h",
  confirmDestructiveActions: true,
  sidebarShowTasks: true,
  sidebarShowCalendarEvents: false,
  sidebarEventsHorizonDays: 7,
  hideGoalsFromLab: false,
  offlineMode: false,
  account_type: "member",
  purchaseRouting: DEFAULT_PURCHASE_ROUTING,
  labMembershipAgreement: DEFAULT_LAB_MEMBERSHIP_AGREEMENT,
};

/** Horizon choices surfaced in the Settings → Sidebar selector. */
export const SIDEBAR_HORIZON_CHOICES: Array<{ value: number; label: string }> = [
  { value: 0, label: "Today only" },
  { value: 3, label: "Today + next 3 days" },
  { value: 7, label: "Today + next 7 days" },
  { value: 14, label: "Today + next 14 days" },
  { value: 30, label: "Today + next 30 days" },
];

function settingsPath(username: string): string {
  return `users/${username}/settings.json`;
}

/**
 * Merges a (possibly partial / older-schema) payload from disk with the
 * default settings, dropping unknown tab hrefs and clamping the landing tab
 * to something the user can actually reach.
 */
// Legacy href → current href. The `/experiments` route was renamed to
// `/workbench` (EXPERIMENTS_STANDALONE_PROPOSAL.md); without this map a
// user with `/experiments` in their saved tab list would silently lose
// it on the first load post-rename.
const LEGACY_HREF_RENAMES: Record<string, string> = {
  "/experiments": "/workbench",
};

function migrateHref(href: string): string {
  return LEGACY_HREF_RENAMES[href] ?? href;
}

function normalize(raw: Partial<UserSettings> | null | undefined): UserSettings {
  const merged: UserSettings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };

  const visibleTabs = (merged.visibleTabs ?? [])
    .map(migrateHref)
    .filter(isValidTabHref);
  // Home is always visible — it's the safe fallback landing tab.
  if (!visibleTabs.includes(HOME_HREF)) visibleTabs.unshift(HOME_HREF);
  merged.visibleTabs = visibleTabs;

  // navLayout (additive, optional): the inline-vs-More split layered on top of
  // visibleTabs. Absent stays absent (the component synthesizes the default
  // split against the live rendered nav set, not here). When present, sanitize
  // both arrays the same way as visibleTabs (drop invalid hrefs, migrate
  // renames), de-dupe across the two lists, and force Home first in inline.
  if (raw && (raw as Partial<UserSettings>).navLayout) {
    const rawLayout = (raw as Partial<UserSettings>).navLayout!;
    const seen = new Set<string>();
    const clean = (list: unknown): string[] => {
      if (!Array.isArray(list)) return [];
      const out: string[] = [];
      for (const entry of list) {
        if (typeof entry !== "string") continue;
        const href = migrateHref(entry);
        if (!isValidTabHref(href)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        out.push(href);
      }
      return out;
    };
    const inline = clean(rawLayout.inline);
    const more = clean(rawLayout.more);
    // Home, when present in either list, is forced to inline[0].
    const stripHome = (list: string[]) =>
      list.filter((h) => h !== HOME_HREF);
    if (seen.has(HOME_HREF)) {
      merged.navLayout = {
        inline: [HOME_HREF, ...stripHome(inline)],
        more: stripHome(more),
      };
    } else {
      merged.navLayout = { inline, more };
    }
  } else {
    delete merged.navLayout;
  }

  merged.defaultLandingTab = migrateHref(merged.defaultLandingTab);
  if (!isValidTabHref(merged.defaultLandingTab) || !visibleTabs.includes(merged.defaultLandingTab)) {
    merged.defaultLandingTab = HOME_HREF;
  }

  // Clamp the events horizon to a sane range — 0..365 days. A hand-edited
  // settings.json with NaN or a negative number would otherwise break the
  // sidebar's upcoming-events filter.
  const horizonRaw = Number(merged.sidebarEventsHorizonDays);
  merged.sidebarEventsHorizonDays = Number.isFinite(horizonRaw)
    ? Math.max(0, Math.min(365, Math.floor(horizonRaw)))
    : DEFAULT_SETTINGS.sidebarEventsHorizonDays;

  // Lab Head Phase 1: clamp `account_type` to the accepted union so a
  // hand-edited settings.json with a garbage value falls back to `member`
  // (the safe default — never accidentally elevate someone to lab_head).
  if (merged.account_type !== "member" && merged.account_type !== "lab_head") {
    merged.account_type = "member";
  }

  // Lab Manager (Phase 1): clamp the delegated-capability flag to a strict
  // boolean, and never let it ride on the head (the head holds every power, so
  // the flag is meaningless there and would only confuse a capability check).
  merged.lab_manager =
    merged.lab_manager === true && merged.account_type !== "lab_head";

  // Purchase routing: repair a missing / hand-edited bad shape so the UI always
  // reads a well-formed config (disabled empty default when absent or garbage).
  const pr = merged.purchaseRouting as Partial<PurchaseRoutingConfig> | undefined;
  merged.purchaseRouting =
    pr && typeof pr === "object"
      ? {
          enabled: pr.enabled === true,
          contacts: Array.isArray(pr.contacts)
            ? pr.contacts.filter(
                (c): c is PurchaseRoutingContact =>
                  !!c &&
                  typeof c.id === "string" &&
                  typeof c.name === "string" &&
                  typeof c.email === "string",
              )
            : [],
          subjectTemplate:
            typeof pr.subjectTemplate === "string"
              ? pr.subjectTemplate
              : DEFAULT_PURCHASE_ROUTING.subjectTemplate,
          bodyTemplate:
            typeof pr.bodyTemplate === "string"
              ? pr.bodyTemplate
              : DEFAULT_PURCHASE_ROUTING.bodyTemplate,
        }
      : { ...DEFAULT_PURCHASE_ROUTING };

  // Notification routing: repair a hand-edited shape to the full matrix. Left
  // absent when the user has never set it, so consumers default cleanly.
  if (merged.notificationPreferences) {
    merged.notificationPreferences = normalizeNotificationPreferences(
      merged.notificationPreferences,
    );
  }

  // Lab membership agreement: same defensive repair as the routing config.
  const ag = merged.labMembershipAgreement as
    | Partial<LabMembershipAgreement>
    | undefined;
  merged.labMembershipAgreement =
    ag && typeof ag === "object"
      ? {
          enabled: ag.enabled === true,
          version:
            Number.isFinite(ag.version) && (ag.version as number) >= 1
              ? Math.floor(ag.version as number)
              : DEFAULT_LAB_MEMBERSHIP_AGREEMENT.version,
          text:
            typeof ag.text === "string" && ag.text.trim()
              ? ag.text
              : DEFAULT_LAB_MEMBERSHIP_AGREEMENT.text,
        }
      : { ...DEFAULT_LAB_MEMBERSHIP_AGREEMENT };

  // Editor width preset (Phase 1): drop a hand-edited garbage value so the
  // field reads as "unset" (= the default measure) rather than a class the
  // mapping can't resolve. Additive + optional: a genuinely absent field is
  // left absent (not coerced to a default) so we never write a value the
  // user didn't pick.
  if (
    merged.editorWidthPreset !== undefined &&
    merged.editorWidthPreset !== "narrow" &&
    merged.editorWidthPreset !== "comfortable" &&
    merged.editorWidthPreset !== "wide" &&
    merged.editorWidthPreset !== "full"
  ) {
    delete merged.editorWidthPreset;
  }

  return merged;
}

export async function readUserSettings(username: string): Promise<UserSettings> {
  if (!fileService.isConnected()) return { ...DEFAULT_SETTINGS };
  const raw = await fileService.readJson<Partial<UserSettings>>(settingsPath(username));

  // Seed `color` and `hideGoalsFromLab` from `_user_metadata.json` when
  // they aren't in settings.json yet. Without this, the legacy-migration
  // path (which calls patchUserSettings → writeUserSettings → mirror) would
  // overwrite an existing user's metadata color with DEFAULT_SETTINGS.color
  // the first time they're switched to on a browser that previously held a
  // different user's settings. See the user-switch regression where a
  // user's red color flipped to blue on first login.
  const needsColorFallback = !raw || raw.color === undefined;
  const needsSecondaryFallback = !raw || raw.colorSecondary === undefined;
  const needsHideFallback = !raw || raw.hideGoalsFromLab === undefined;
  let metaSeed: Partial<UserSettings> = {};
  if (needsColorFallback || needsSecondaryFallback || needsHideFallback) {
    const meta = await getUserMetadata(username);
    if (meta) {
      metaSeed = {
        ...(needsColorFallback && meta.color ? { color: meta.color } : {}),
        ...(needsSecondaryFallback
          ? { colorSecondary: meta.color_secondary ?? null }
          : {}),
        ...(needsHideFallback
          ? { hideGoalsFromLab: meta.hide_goals_from_lab ?? false }
          : {}),
      };
    }
  }

  return normalize({ ...metaSeed, ...(raw ?? {}) });
}

/**
 * The EFFECTIVE user settings = the account-scoped defaults (cloud, follow the
 * user) merged OVER the folder-local settings.json. This is the read a consumer
 * wants when it should honor an account preference (appearance, formatting, nav
 * defaults) that follows the user across folders.
 *
 * SURGICAL + FAILS CLOSED: when the account-settings flag is OFF, or no account
 * blob exists, this returns the folder-local settings byte-for-byte (it just
 * delegates to readUserSettings + mergeAccountOverFolder with a null blob, which
 * returns the folder unchanged), so flag-off behavior is identical to today. The
 * folder-local readUserSettings stays the source of truth for the WRITE path and
 * for callers that must see only what is on disk; this reader is opt-in.
 *
 * Nav defaults (defaultLandingTab + visibleTabs) are account DEFAULTS the folder
 * can OVERRIDE: we detect whether the folder explicitly set them (present in the
 * raw on-disk settings) and only let the account value apply when the folder did
 * NOT, so a class folder keeps its own tab set.
 */
export async function readEffectiveUserSettings(
  username: string,
): Promise<UserSettings> {
  const folder = await readUserSettings(username);
  // Lazy import to keep the settings module free of an account-layer dependency
  // at module scope (and to stay tree-shakeable when the flag path is unused).
  const { isAccountSettingsEnabled } = await import(
    "@/lib/account/account-settings-config"
  );
  if (!isAccountSettingsEnabled()) return folder;
  try {
    const { fetchAccountSettings, mergeAccountOverFolder } = await import(
      "@/lib/account/account-settings"
    );
    const account = await fetchAccountSettings();
    if (!account) return folder;
    // Detect whether the folder set its OWN nav fields on disk, so account nav
    // defaults only fill the gaps (folder override wins).
    const raw = fileService.isConnected()
      ? await fileService.readJson<Partial<UserSettings>>(settingsPath(username))
      : null;
    const folderNavIsDefault = {
      defaultLandingTab: !raw || raw.defaultLandingTab === undefined,
      visibleTabs: !raw || raw.visibleTabs === undefined,
    };
    return mergeAccountOverFolder(folder, account, folderNavIsDefault);
  } catch {
    // Any account-layer failure falls back to the folder settings, never breaks
    // a settings read.
    return folder;
  }
}

export async function userSettingsFileExists(username: string): Promise<boolean> {
  if (!fileService.isConnected()) return false;
  return fileService.fileExists(settingsPath(username));
}

export async function writeUserSettings(username: string, settings: UserSettings): Promise<void> {
  if (!fileService.isConnected()) return;
  const normalized = normalize(settings);
  await fileService.writeJson(settingsPath(username), normalized);

  // Mirror the few fields that legacy readers still look up in _user_metadata.json.
  // The two color fields go through `setUserMetadataColors` so they land in
  // ONE read-modify-write cycle — without that, two sequential field writes
  // could let the primary land on disk while the secondary is dropped by a
  // concurrent reader (the Settings save handler relies on this atomicity
  // when the user picks a new gradient).
  try {
    await setUserMetadataColors(
      username,
      normalized.color,
      normalized.colorSecondary,
    );
    await setUserMetadataField(username, "hide_goals_from_lab", normalized.hideGoalsFromLab);
  } catch (err) {
    console.warn("[user-settings] Failed to mirror to _user_metadata.json", err);
  }

  // Fire the success bus so live readers (e.g. `useAccountType`) can
  // refresh without waiting for a route change. See `onUserSettingsWritten`
  // docblock below for the full root-cause writeup. (top-nav visibility
  // fix manager, 2026-05-27)
  dispatchUserSettingsWritten({ username, next: normalized });
}

// ---------------------------------------------------------------------------
// Per-user write serialization (enablement-race bot, 2026-05-30)
//
// readUserSettings -> mutate -> writeUserSettings is a read-modify-write. Two
// mutations fired in the same synchronous tick (e.g. toggling two method types
// or two widgets back to back) both read the SAME pre-update snapshot, so the
// second write clobbers the first (a lost update). The store had no
// serialization, so concurrent curation writes silently dropped changes.
//
// We serialize all mutating writes per user through a chained-promise queue: a
// module-level Map<username, Promise> whose value is the tail of that user's
// write chain. Each new update awaits the prior one before it reads, so every
// updater observes the result of the update before it instead of a stale
// snapshot. Reads (readUserSettings) are NOT queued; only the read-modify-write
// mutators below go through `updateUserSettings`.
// ---------------------------------------------------------------------------

const userSettingsWriteQueues = new Map<string, Promise<unknown>>();

function enqueueUserSettingsWrite<T>(
  username: string,
  task: () => Promise<T>,
): Promise<T> {
  const prior = userSettingsWriteQueues.get(username) ?? Promise.resolve();
  // Continue regardless of whether the prior write fulfilled or rejected, so a
  // single failed write does not poison the chain for every later write to the
  // same user. `task` ignores its argument, so passing it as both handlers is
  // safe.
  const run = prior.then(task, task);
  userSettingsWriteQueues.set(username, run);
  // Drop the tail once it settles, but only if no newer task has replaced it,
  // so the Map does not grow without bound across many users.
  void run.then(
    () => {
      if (userSettingsWriteQueues.get(username) === run) {
        userSettingsWriteQueues.delete(username);
      }
    },
    () => {
      if (userSettingsWriteQueues.get(username) === run) {
        userSettingsWriteQueues.delete(username);
      }
    },
  );
  return run;
}

/**
 * Atomically mutate a user's settings with a functional updater. The updater
 * receives the LATEST settings (re-read inside the serialized step, after any
 * prior queued write has landed) and returns a partial patch; the patch is
 * merged, normalized, written, and the resulting settings returned.
 *
 * Use this (not a bare read + patchUserSettings) whenever the new value depends
 * on the current one, so concurrent updaters compose instead of clobber. The
 * per-user queue guarantees ordering: a rapid A-then-B in the same tick applies
 * A, then B reads A's result, so BOTH changes survive.
 */
export async function updateUserSettings(
  username: string,
  updater: (current: UserSettings) => Partial<UserSettings>,
): Promise<UserSettings> {
  return enqueueUserSettingsWrite(username, async () => {
    const current = await readUserSettings(username);
    const next = normalize({ ...current, ...updater(current) });
    await writeUserSettings(username, next);
    return next;
  });
}

export async function patchUserSettings(
  username: string,
  patch: Partial<UserSettings>,
): Promise<UserSettings> {
  // Route through the serialized updater so a patch never races with another
  // concurrent write to the same user.
  return updateUserSettings(username, () => patch);
}

// ---------------------------------------------------------------------------
// User-settings success bus (top-nav visibility fix manager, 2026-05-27)
//
// Mirrors `onSidecarWritten` in `lib/onboarding/sidecar.ts`. Hooks like
// `useAccountType` previously read on mount + username change only; the
// Settings page's `update({ account_type })` and onboarding Q1c's new
// bridge to `_user_settings.account_type` both write without bumping the
// hook's local state. Subscribers receive the full normalized next
// settings object so they don't have to re-read disk (a follow-up write
// could otherwise read past this snapshot).
//
// The dispatch is fire-and-forget; subscriber errors are logged but
// never bubble so a misbehaving subscriber doesn't break the write
// path. Use `_clearUserSettingsWrittenSubscribersForTest` in vitest
// `beforeEach` hooks to keep tests isolated.
// ---------------------------------------------------------------------------

export interface UserSettingsWrittenEvent {
  username: string;
  next: UserSettings;
}

type UserSettingsWrittenCallback = (event: UserSettingsWrittenEvent) => void;

const userSettingsWrittenSubscribers = new Set<UserSettingsWrittenCallback>();

export function onUserSettingsWritten(
  callback: UserSettingsWrittenCallback,
): () => void {
  userSettingsWrittenSubscribers.add(callback);
  return () => {
    userSettingsWrittenSubscribers.delete(callback);
  };
}

export function _clearUserSettingsWrittenSubscribersForTest(): void {
  userSettingsWrittenSubscribers.clear();
}

function dispatchUserSettingsWritten(event: UserSettingsWrittenEvent): void {
  for (const sub of [...userSettingsWrittenSubscribers]) {
    try {
      sub(event);
    } catch (err) {
      console.error("[user-settings] written-bus subscriber threw", err);
    }
  }
}
