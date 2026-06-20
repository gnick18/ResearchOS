"use client";

import Link from "@/components/FixtureLink";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import DailyTasksSidebar from "./DailyTasksSidebar";
import CalendarSidebar from "./CalendarSidebar";
import CollapsibleSidebar from "./CollapsibleSidebar";
import InboxBadge from "./InboxBadge";
import InboxToast from "./InboxToast";
import NoteDeleteUndoToast from "./NoteDeleteUndoToast";
import SequenceDeleteUndoToast from "./SequenceDeleteUndoToast";
import MoleculeDeleteUndoToast from "./MoleculeDeleteUndoToast";
import NotificationBadge from "./NotificationBadge";
import NotificationDesktopWatcher from "./NotificationDesktopWatcher";
import ReminderRunner from "./ReminderRunner";
import IdlePasswordWipe from "./IdlePasswordWipe";
import Tooltip from "./Tooltip";
import FeedbackButton from "./FeedbackButton";
import CalculatorsButton from "./CalculatorsButton";
import DevTestNotificationButton from "./DevTestNotificationButton";
import DevDemoToggleButton from "./DevDemoToggleButton";
import DevForceTourButton from "./DevForceTourButton";
import DevBeakerBotGalleryButton from "./DevBeakerBotGalleryButton";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import FeedbackModal from "./FeedbackModal";
import Wordmark from "./Wordmark";
import { useShowcaseUnlock } from "./showcase/useShowcaseUnlock";
import StreakBadge from "./StreakBadge";
import LabHeaderLogo from "@/components/lab/LabHeaderLogo";
import PiContextBanner from "@/components/lab-head/PiContextBanner";
import FolderSwitcher from "@/components/file-system/FolderSwitcher";
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";
import { installStreakActivityTracking } from "@/lib/streak/streak-activity-bootstrap";
import { readStreak } from "@/lib/streak/streak-sidecar";
import { writeUserStats } from "@/lib/beakerbot/user-stats-cache";
import { computeUserStats } from "@/lib/beakerbot/compute-user-stats";
import { NAV_ITEMS, HOME_HREF } from "@/lib/nav";
import {
  lensLabel,
  buildLabLensItems,
  filterResearcherItems,
  filterClassStudentNav,
} from "@/lib/lab/class-chrome";
import { useClassDashboard } from "@/hooks/useClassDashboard";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import { CHEMISTRY_ENABLED } from "@/lib/chemistry/config";
import { DATAHUB_ENABLED } from "@/lib/datahub/config";
import { PHYLO_ENABLED } from "@/lib/phylo/config";
import { ASSET_LIBRARY_ENABLED } from "@/lib/figure/asset-library";
import { HELP_HREF, appRouteToWikiRoute } from "@/lib/wiki/nav";
import { useAppStore } from "@/lib/store";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useUserColors } from "@/hooks/useUserColor";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import { useFeaturePicks } from "@/hooks/useFeaturePicks";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useIsClassMode } from "@/hooks/useIsClassMode";
import { useIsClassStudent } from "@/hooks/useIsClassStudent";
import { useStudentAssignmentCount } from "@/hooks/useStudentAssignmentCount";
import { CLASS_MODE_ENABLED } from "@/lib/lab/class-mode-config";
import StudentAssignmentsDrawer from "@/components/lab-overview/StudentAssignmentsDrawer";
import { deriveVisibleTabs } from "@/lib/onboarding/feature-picks-tabs";
import { hasTourResume } from "@/lib/onboarding/tour-demo-session";
import { usePrefetchOnHover } from "@/lib/perf/use-prefetch-on-hover";
import { headerGradient, rainbowTheme } from "@/lib/colors";
import UserAvatarMenu from "@/components/UserAvatarMenu";
import ResearcherProfileModal from "@/components/researchers/ResearcherProfileModal";
import ProfileSettingsModal from "@/components/profile/ProfileSettingsModal";
import SettingsModal from "@/components/settings/SettingsModal";
import CompanionHub from "@/components/CompanionHub";
import TimersPopup from "@/components/TimersPopup";
import TimerAlarm from "@/components/TimerAlarm";
import { Icon } from "@/components/icons";
import { useCompanionHub } from "@/lib/ui/companion-hub-store";
import { useTimersPopup } from "@/lib/ui/timers-popup-store";
import { useRunningTimerCount } from "@/lib/timers/laptop-timers";
import { usePhonePaired } from "@/hooks/usePhonePaired";
import { useLabPendingRequests } from "@/hooks/useLabPendingRequests";
import SharingClaimResume from "@/components/sharing/SharingClaimResume";
import RequireAccountGate from "@/components/account/RequireAccountGate";
import { useHasCloudSession } from "@/components/account/AccountFirstRedirect";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import {
  isRequireAccountEnabled,
  shouldGateForClaim,
} from "@/lib/account/require-account";
import { isOAuthPublishAvailable } from "@/lib/sharing/oauth-availability";
import LabInviteResume from "@/components/lab/LabInviteResume";
import LabCreateResume from "@/components/lab/LabCreateResume";
import LabProvisionResume from "@/components/lab/LabProvisionResume";
import LabGenesisPublishRetry from "@/components/lab/LabGenesisPublishRetry";
import { LabSessionMount } from "@/components/lab/LabSessionMount";
import BeakerSearchBottomBar from "@/components/beaker-search/BeakerSearchBottomBar";
import AppNavBar from "@/components/AppNavBar";
import PiViewModeToggle from "@/components/PiViewModeToggle";
import { usePiViewMode } from "@/hooks/usePiViewMode";
import type { NavItem } from "@/lib/nav";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The sequence editor is a dense full-bleed focus surface; the global
  // floating Calculators / Report-bug FABs are hidden there (see the dock
  // below) so they don't crowd its toolbar + inspector.
  const onSequences = !!pathname?.startsWith("/sequences");
  const visibleTabs = useAppStore((s) => s.visibleTabs);
  const coloredHeader = useAppStore((s) => s.coloredHeader);
  const showCompanionButton = useAppStore((s) => s.showCompanionButton);
  const openCompanion = useCompanionHub((s) => s.open);
  const openTimers = useTimersPopup((s) => s.open);
  const runningTimers = useRunningTimerCount();
  const phonePaired = usePhonePaired();
  // Pending lab join-request count (lab-pending-requests-ux, 2026-06-14). Drives
  // an attention dot on the avatar menu so a PI sees waiting requests without
  // opening Settings. Inert for non-PIs; shares the React Query cache with the
  // settings rail badge by key, so this is not an extra fetch.
  const pendingRequests = useLabPendingRequests();
  const { currentUser } = useFileSystem();
  // Require-account enforcement (require-account-ironclad, 2026-06-18). A
  // connected user whose account is local-only (a keypair with no verified-email
  // binding, status "ready" + not published) is held at the claim gate before
  // the app renders. Guarded so it never soft-locks: only when require-account
  // is on, an OAuth claim path actually exists, and not in demo/capture. The
  // identity hook is called unconditionally here to keep hook order stable.
  const identity = useSharingIdentity();
  // Whether an OAuth session exists (null while the imperative check resolves).
  // This is the gate's release signal: the requirement is "signed in", not a
  // successful directory publish.
  const hasCloudSession = useHasCloudSession();
  const userColors = useUserColors(currentUser ?? "");
  const baseColor = userColors.primary;
  // Onboarding v3 §10: feature_picks is the primary tab-visibility
  // source. `deriveVisibleTabs` returns settings.visibleTabs as-is when
  // picks are null (existing-user invariant L1/L22) and otherwise lets
  // settings additionally hide — but not unhide — relative to picks.
  // See `frontend/src/lib/onboarding/feature-picks-tabs.ts` for the
  // full contract + Settings UI carve-out note. `undefined` (loading)
  // is treated the same as `null` so first-paint never flickers.
  const featurePicks = useFeaturePicks(currentUser);
  // Intent-scoped hover-prefetch: warm note/experiment Loro docs on row hover so
  // their detail popups open instantly (flag-gated, see use-prefetch-on-hover).
  usePrefetchOnHover(currentUser);
  const effectiveVisibleTabs = useMemo(
    () => deriveVisibleTabs(featurePicks ?? null, visibleTabs),
    [featurePicks, visibleTabs],
  );

  // Phase S2 bootstrap (Streak-and-Milestones, see proposal §4.2 / §5).
  // `installStreakActivityTracking` is idempotent — it registers the
  // file-write observer + beforeunload flusher exactly once even when
  // AppShell remounts (route changes don't unmount AppShell on this
  // app, but a future provider-stack tweak could). Mounting from the
  // shell rather than from the provider stack keeps the bootstrap in
  // the same surface that hosts the badge: any code path that renders
  // the AppShell gets streak tracking. Pre-login / data-setup screens
  // that don't render AppShell don't tick streaks, which matches the
  // "no active user, no tracking" contract.
  useEffect(() => {
    installStreakActivityTracking();
  }, []);

  // BeakerBot Tier-B stats cache write. Once per session (keyed on
  // currentUser) after the shell mounts with a real user, read the
  // streak sidecar AND compute real activity counts (experiments, notes,
  // projects, wordsLastWeek, checkinsThisMonth) then merge them into a
  // single UserStatsSummary written to localStorage. The entry-lines
  // builder skips absent/zero fields gracefully, so a partial snapshot
  // is safe. Guard: only write when currentUser is real (not demo, not null).
  useEffect(() => {
    if (!currentUser || isDemoOrWikiCapture()) return;
    // Cancel flag: prevents writes after unmount (writeUserStats itself is
    // safe to call late, but this avoids unnecessary work).
    let cancelled = false;
    void (async () => {
      const now = Date.now();

      // 1. Streak sidecar (streakDays + lastActivityAt).
      let streakDays: number | undefined;
      let lastActivityAt: number | undefined;
      try {
        const sc = await readStreak(currentUser);
        if (sc.current_count > 0) streakDays = sc.current_count;
        // Convert YYYY-MM-DD last activity to a midnight-UTC ms timestamp.
        if (sc.last_activity_date) {
          const ms = Date.parse(sc.last_activity_date);
          if (Number.isFinite(ms)) lastActivityAt = ms;
        }
      } catch {
        // Sidecar missing or unreadable on first login: streakDays stays undefined.
      }

      // 2. Real activity counts from data stores.
      let computed: Partial<import("@/lib/beakerbot/entry-lines").UserStatsSummary> = {};
      try {
        computed = await computeUserStats(currentUser, now);
      } catch {
        // computeUserStats should never reject (internal try/catch per source),
        // but guard here so streak fields still write if something escapes.
      }

      if (cancelled) return;

      // 3. Merge: real counts + streak fields; skip writing on empty snapshot.
      const merged = {
        ...computed,
        ...(streakDays !== undefined && { streakDays }),
        ...(lastActivityAt !== undefined && { lastActivityAt }),
      };
      const hasData =
        streakDays !== undefined ||
        lastActivityAt !== undefined ||
        Object.keys(computed).length > 0;
      if (hasData) {
        writeUserStats(currentUser, { ...merged, updatedAt: now });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once per distinct user (covers folder-switch + account-switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // Dev-only floating buttons (gallery, force-walkthrough, test-notification,
  // demo-toggle) must NOT show in capture / demo presentation mode, or they
  // leak into wiki screenshots and the welcome-page demo recordings. We default
  // hidden and reveal only after mount once we confirm we're NOT in capture or
  // demo mode, so capture mode never flashes them (the check reads sessionStorage,
  // which is client-only). Normal dev shows them a frame after mount, which is
  // fine for dev tooling.
  const [showDevDock, setShowDevDock] = useState(false);
  // Demo / wiki-capture sessions get to preview not-yet-launched modules
  // (Data Hub, Chemistry) even when their production flags are off, so the
  // public demo can showcase them while real production users never see them.
  // Same hydration-safe pattern as showDevDock above. We default to the
  // prod-safe value (false) on the server and first client render, then read
  // the client-only demo signal after mount, so the nav filter re-runs and the
  // tabs appear a frame later in demo without ever causing an SSR mismatch.
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    const demo = isDemoOrWikiCapture();
    setShowDevDock(!demo);
    setIsDemo(demo);
  }, []);

  // While the onboarding tour is running its deep demos (the transparent overlay
  // over the real app), suppress incidental header chrome that competes with
  // Beaker's spotlight, like the streak badge. A live tour-resume marker is the
  // precise signal (set when the tour enters demo mode, cleared on exit). Same
  // hydration-safe pattern: default false on the server + first render, read the
  // client-only marker after mount, so the badge never causes an SSR mismatch.
  const [tourActive, setTourActive] = useState(false);
  useEffect(() => {
    setTourActive(hasTourResume());
  }, []);

  // Showcase unlock: counts clicks on the brand-mark BeakerBot. Clicks
  // 1 to 6 still spawn hearts (the heart easter egg is internal to
  // BeakerBot and untouched); click 7 fires the Curtain Reveal and
  // routes to /showcase. This is the ONLY BeakerBot instance wired to
  // the unlock (settings / tip-card instances stay hearts-only). Also
  // covers the public /demo, which renders this same AppShell.
  const { onBeakerBotClick, revealElement } = useShowcaseUnlock();

  const {
    showBugReport,
    showErrorToast,
    currentError,
    openBugReport,
    closeBugReport,
    reportCurrentError,
    dismissErrorToast,
  } = useErrorReporting();

  // The `?` help button routes to the wiki page that documents whatever
  // view the user is currently looking at, and stashes the return path
  // so the wiki's "Back to app" button can drop them back exactly where
  // they were rather than the app home.
  const helpHref = useMemo(() => {
    const path = pathname ?? "/";
    const wikiPath = appRouteToWikiRoute(path);
    const qs = searchParams?.toString();
    const returnPath = path + (qs ? `?${qs}` : "");
    return `${wikiPath}?return=${encodeURIComponent(returnPath)}`;
  }, [pathname, searchParams]);

  // Lab Head Phase 1 (lab head Phase 1 manager, 2026-05-23): append a
  // "Lab Inbox" nav entry when the active user has `settings.account_type
  // === "lab_head"`. The entry is account-type-gated rather than
  // feature-picks-gated because being a PI is a per-user role, not a
  // workspace shape — multiple users in the same lab can hold lab_head
  // (co-PIs). `useAccountType` returns `undefined` while the settings
  // read is in flight; we treat that the same as "not lab_head" so the
  // entry never flickers in for a regular member on first paint.
  //
  // Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): also show
  // the tab for ordinary lab members in lab-mode workspaces, so they can
  // see PI announcements. Solo accounts (feature_picks.account_type ===
  // "solo") have no lab to belong to and never get the tab. The composer
  // + metrics gate themselves internally on account_type === "lab_head".
  //
  // Widget-framework teardown v2 (2026-06-02): there is one dashboard nav
  // entry (href "/") whose LABEL is account-aware: "Lab Overview" for a
  // lab_head (PI), "Home" for solo + member. Clicking it lands on "/",
  // which is now a pure router that bounces to the role surface
  // (/lab-overview for a PI, /workbench for everyone else). Keeping the
  // single "/" entry preserves the always-reachable landing tab + the "/"
  // deep-link handlers. This mirrors the "Links" vs "Lab Links"
  // account-aware label pattern.
  //
  // `isLabHead === undefined` (settings read in flight) is treated the
  // same as "not lab_head" → the label resolves to "Home" until the read
  // settles. The tab itself never disappears (the dashboard at "/" is the
  // guaranteed-reachable landing tab), so there's no flicker-out risk.
  const isLabHead = useIsLabHead(currentUser ?? null);

  // Class Mode (CM-P2B): is the active folder a teaching class this user heads.
  // A class instructor is a lab_head by role, so without this the shell would
  // dress them in the full research-lab chrome (Funding, Approvals, Lab
  // Overview), which is wrong for a classroom. `useIsClassMode` returns
  // `undefined` while the read is in flight; we collapse that to `false` so
  // class chrome never flickers in (mirroring how `isLabHead === undefined` is
  // treated as not-lab-head). With NEXT_PUBLIC_CLASS_MODE off no folder carries
  // lab_kind === "class", so `classMode` is always false and every consumer
  // below resolves to its byte-identical research-lab value.
  const classMode = useIsClassMode(currentUser ?? null) === true;

  // Class Mode (CT-2): a STUDENT (class member) gets a global Assignments entry in
  // the top nav, with a count badge, that opens a slide-over so they can peek at or
  // submit an assignment from any page. The dedicated workbench Assignments tab is
  // the full home; this is the everywhere shortcut. Both render ClassAssignmentsPanel.
  const isClassStudent = useIsClassStudent(currentUser ?? null) === true;
  const showStudentAssignments = CLASS_MODE_ENABLED && isClassStudent && !!currentUser;
  const assignmentCount = useStudentAssignmentCount(showStudentAssignments);
  // CT-6: the instructor-controlled student nav allowlist (coursework default when
  // unset). Applied to the researcher nav below ONLY for a class student.
  const { studentNav } = useClassDashboard(currentUser ?? null);
  const [assignmentsDrawerOpen, setAssignmentsDrawerOpen] = useState(false);

  // PI view mode (NAV-1/2/3): a lab head defaults to the lab lens and can flip to
  // their personal "My work" researcher view. Only affects the nav for a lab head.
  const { mode: piViewMode } = usePiViewMode();
  const labLens = isLabHead === true && piViewMode === "lab";

  // Department + Institution admin are no longer in-app nav entries. They live in
  // their own standalone, sign-in-gated portals (/department, /institution via
  // PortalShell), reached from the welcome page, not from inside the app shell.

  // The dashboard ("/") is always shown so the user has a guaranteed safe
  // landing tab even if they hide everything else (or if Settings was
  // wiped). Settings itself is rendered as a gear icon, never as part of
  // NAV_ITEMS.
  const filtered = NAV_ITEMS.filter((item) => {
    if (item.href === HOME_HREF) return true;
    if (item.href === "/inventory" && !INVENTORY_ENABLED) return false;
    // /chemistry (the molecule workbench) is an opt-in module. Force it visible
    // when the flag is on (so dogfooding does not depend on the legacy tab list),
    // and also in demo so the public demo showcases it, while it stays hidden
    // for real production users (flag off, not demo), mirroring how inventory gates.
    if (item.href === "/chemistry") return CHEMISTRY_ENABLED || isDemo;
    // /datahub (the Prism-style analysis + plotting tab) is an opt-in module,
    // same pattern as /chemistry. Visible when the flag is on or in demo, hidden
    // otherwise (prod default), so it stays dark for real users until launch.
    if (item.href === "/datahub") return DATAHUB_ENABLED || isDemo;
    // /phylo (the phylogenetics page: Tree Builder + Tree Studio) is an opt-in
    // module, same pattern as /chemistry and /datahub. Visible when the flag is on
    // or in demo, hidden otherwise (prod default), so it stays dark until launch.
    if (item.href === "/phylo") return PHYLO_ENABLED || isDemo;
    // /figures (the universal figure composer: compose saved plots onto a real
    // page). Its only source today is Data Hub, so gate it the same way (visible
    // when Data Hub is on or in demo), broadening as more figure sources land.
    if (item.href === "/figures") return DATAHUB_ENABLED || isDemo;
    // /library (the open icon/asset library) is gated on its own flag, like the
    // other opt-in modules. Visible when the asset library is on or in demo; it
    // defaults into the More overflow (not in DEFAULT_INLINE_HREFS).
    if (item.href === "/library") return ASSET_LIBRARY_ENABLED || isDemo;
    // /sequences (the molecular-biology editor) is a flagship surface that
    // must always be reachable from the nav. Existing accounts whose
    // visibleTabs list predates the route would otherwise never see it (the
    // route was only reachable by opening a project's attached file). Force
    // it visible like Home, regardless of the legacy tab list. (2026-06-03)
    if (item.href === "/sequences") return true;
    return effectiveVisibleTabs.includes(item.href);
  });
  // Widget catalog cleanup (widget catalog cleanup manager, 2026-05-23):
  // for lab_head accounts the /purchases top-nav entry is hidden because
  // the LabPurchasesWidget on the dashboard now covers their workflow
  // (pending approvals + recent purchases + funding rollup). The route
  // itself stays alive, so a lab head who types /purchases directly still
  // gets the full page, and members keep the nav entry unchanged.
  const navItemsWithOverview = useMemo(() => {
    // Widget-framework teardown follow-up (2026-06-02): "/" no longer
    // renders anything (it is a pure redirect). So a PI's dashboard entry
    // becomes "Lab Overview" pointing STRAIGHT at the curated /lab-overview
    // page (no "/" redirect hop), and everyone else has no dashboard at all
    // (Workbench is their landing), so the "/" entry is dropped. The
    // /purchases entry is NO LONGER hidden for PIs: the LabPurchasesWidget
    // that justified hiding it was deleted with the canvas, so a PI needs
    // the /purchases nav entry back.
    // PI lab lens (NAV-1): the lab-head's default nav is the full PI lineup (Lab
    // Overview, People, Lab Work, Approvals, Activity, Funding) followed by the
    // lab tools. The personal Workbench drops out of the primary set (it is the
    // researcher home, reached via the "My work" toggle), per NAV-3. The PI tabs
    // are kept OUT of the shared NAV_ITEMS so they never appear for members or in
    // the drag-customize visibleTabs set.
    if (labLens) {
      // CM-P2B: the lab-lens lineup is built by a pure resolver. When classMode
      // is true the Overview entry reads "Class Overview" and the research-only
      // PI tabs (Funding, Approvals) + research-only tools (Purchases) are
      // omitted; the science tools stay. classMode false is byte-identical to
      // the legacy inline loop.
      return buildLabLensItems(filtered, classMode);
    }
    // Member, OR a lab head in "My work" mode: the researcher tab set (Workbench
    // landing), with the PI-only tabs hidden. The "My work" toggle in the header
    // is the way back to the lab lens for a PI. CM-P2B also strips the
    // research-only tools (Purchases) in class mode; filterResearcherItems is
    // the identity filter when classMode is false.
    const researcher = filterResearcherItems(
      filtered.filter((item) => item.href !== HOME_HREF),
      classMode,
    );
    // CT-6: a class STUDENT sees only the instructor's allowlist (coursework
    // default when unset). /workbench is always kept (the resolver force-adds it),
    // and this hides nav entries only, never gates routes (no soft-lock). For a
    // non-class member, a research lab, or flag-off, isClassStudent is false and
    // this is a no-op.
    if (isClassStudent) {
      return filterClassStudentNav(researcher, studentNav);
    }
    return researcher;
  }, [filtered, labLens, classMode, isClassStudent, studentNav]);

  // Supplies hub (Supplies hub, 2026-06-07). When INVENTORY_ENABLED is on,
  // Inventory and Purchases collapse into ONE "Supplies" nav item pointing at
  // the unified /supplies page (label "Supplies", active for /supplies AND the
  // legacy /inventory + /purchases routes, which now redirect into it). The old
  // two-tab SuppliesTabs header is retired (Supplies v2 chunk 7, 2026-06-08).
  // When the flag is OFF (prod default) this collapse does NOT run, so Purchases
  // keeps its own standalone nav item and Inventory stays hidden exactly as
  // today. The collapse only touches these two entries; every other nav item is
  // untouched (the broader nav audit is a separate task). The replacement is
  // positioned where the first of the two (Inventory before Purchases in
  // NAV_ITEMS) sat so the nav order is stable.
  const navItems = useMemo(() => {
    if (!INVENTORY_ENABLED) return navItemsWithOverview;
    const hasInventory = navItemsWithOverview.some(
      (item) => item.href === "/inventory",
    );
    const hasPurchases = navItemsWithOverview.some(
      (item) => item.href === "/purchases",
    );
    // Nothing to collapse if neither tab is currently visible (a user can hide
    // /purchases via feature picks; /inventory force-shows under the flag).
    if (!hasInventory && !hasPurchases) return navItemsWithOverview;
    const out: typeof navItemsWithOverview = [];
    let inserted = false;
    for (const item of navItemsWithOverview) {
      if (item.href === "/inventory" || item.href === "/purchases") {
        if (!inserted) {
          out.push({ href: "/supplies", label: "Supplies" });
          inserted = true;
        }
        continue;
      }
      out.push(item);
    }
    return out;
  }, [navItemsWithOverview]);

  // NAV-1/NAV-3: in the PI lab lens the nav uses a FIXED lineup (the PI tabs
  // inline in order, every researcher tool in More), overriding the user's saved
  // drag-layout. Without this the PI tabs are new hrefs that resolveNavLayout
  // pushes into More, burying People/Lab Work/Approvals/Activity/Funding.
  const labNavLayout = useMemo(() => {
    if (!labLens) return undefined;
    const order = [
      "/lab-overview",
      "/people",
      "/lab-work",
      "/approvals",
      "/activity",
      "/funding",
    ];
    const inlineSet = new Set(order);
    return {
      inline: order.filter((h) => navItems.some((i) => i.href === h)),
      more: navItems.filter((i) => !inlineSet.has(i.href)).map((i) => i.href),
    };
  }, [labLens, navItems]);

  // Header is tinted only when (a) a user is signed in, AND (b) the user
  // has opted into a colored header in Settings → Profile. Either off →
  // the classic white header. On the tinted variant, every interactive
  // element lives inside a floating white pill so text never sits
  // directly on the gradient. The tinted header also carries `light-scope`
  // (see header className) so its contents stay light-mode-readable even when
  // the app is in dark mode: the gradient + white pills are always light, so
  // dark-mode token values (light text) would wash out on them.
  //
  // Stop selection: when the user has opted into a 2-color gradient
  // (`color_secondary` set) we render those two stops directly so the
  // header matches the avatar exactly. Otherwise we derive a darker,
  // deeper gradient from the single primary color via `headerGradient()`
  // — the same behavior pre-gradient users get today.
  // The rainbow themes are sentinel strings, not hexes, so headerGradient()
  // can't derive stops from them (it fell back to a teal/cyan). rainbowTheme()
  // resolves either rainbow (pastel or vivid) to its 5-stop ramp, matching the
  // avatar; ordinary hex colors return null and use the derived 2-stop.
  const rainbow = rainbowTheme(baseColor);
  const [stop1, stop2] = userColors.secondary
    ? [baseColor, userColors.secondary]
    : headerGradient(baseColor);
  const tinted = !!currentUser && coloredHeader;
  const headerStyle = tinted
    ? {
        background: rainbow
          ? rainbow.header
          : `linear-gradient(to right, ${stop1}, ${stop2})`,
      }
    : undefined;

  // Hold a local-only account at the claim gate before the app renders. All
  // hooks above have run, so this early return keeps hook order stable. The
  // guards encode the no-soft-lock rule: skip when require-account is off, when
  // there is no OAuth claim path to complete, in demo/capture, and never block
  // while the identity read is still resolving (status only becomes "ready"
  // after the async read settles, and a stalled read falls back to "none").
  //
  // CRITICAL: skip the gate while a claim is actively resuming (?sharingClaim /
  // ?sharingEmail in the URL). During that window the normal shell must render
  // so the global SharingClaimResume below mounts and finishes keygen + publish.
  // The gate's own panel cannot resume a claim, so blocking here would loop the
  // user back to the claim screen after every OAuth round-trip.
  const claimResuming =
    !!searchParams?.get("sharingClaim") || !!searchParams?.get("sharingEmail");
  const mustClaimAccount =
    !claimResuming &&
    shouldGateForClaim({
      requireAccount: isRequireAccountEnabled(),
      oauthPublishAvailable: isOAuthPublishAvailable(),
      hasConnectedUser: !!currentUser,
      isDemoOrCapture: isDemoOrWikiCapture(),
      identityStatus: identity.status,
      published: identity.published,
      hasCloudSession,
    });
  if (mustClaimAccount && currentUser) {
    // Auto-claim (Phase 1, D3): when the gate fired for an ALREADY signed-in user
    // (the deferred-mint dead zone), the gate reuses the live session and goes
    // straight to keygen + the recovery code, with no provider to choose. A
    // signed-out user (hasCloudSession === false) still sees the manual sign-in
    // card. hasCloudSession is true here only on the new signed-in branch of
    // shouldGateForClaim, so this read alone distinguishes the two cases.
    return (
      <RequireAccountGate
        username={currentUser}
        autoClaim={hasCloudSession === true}
        onClaimed={() => void identity.refresh()}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface-sunken">
      {/* Showcase unlock Curtain Reveal overlay (portaled to body when
          the 7th brand-mark click fires). Null otherwise. */}
      {revealElement}
      <IdlePasswordWipe />
      {/* Header */}
      <header
        className={`px-4 py-1.5 flex items-center gap-2 ${
          tinted ? "light-scope shadow-sm" : "bg-surface-raised border-b border-border"
        }`}
        style={headerStyle}
      >
        <PillWrap on={tinted}>
          {/* Canonical lockup via the shared <Wordmark>, text-only here: the
              BeakerBot mark is dropped from the header because BeakerBot lives
              permanently on the search palette, so the mascot was redundant
              chrome. The 7-click showcase unlock (clicks 1 to 6 spawn hearts,
              click 7 fires the Curtain Reveal into /showcase) moves onto the
              "ResearchOS" text. The wordmark leads; the streak badge trails it
              (hidden at count 0, when streaks are disabled, or pre-login).
              textAs="h1" keeps the header's existing document outline. */}
          <span className="flex items-center gap-1.5">
            <Wordmark
              size="sm"
              textAs="h1"
              textOnly
              textTestId="appshell-beakerbot-brand"
              onTextClick={onBeakerBotClick}
            />
            {!tourActive ? <StreakBadge username={currentUser} /> : null}
            {/* Ambient lab mark: only renders for a signed-in lab member whose
                lab has a logo, otherwise nothing (no layout shift for solos). */}
            <LabHeaderLogo />
          </span>
        </PillWrap>

        {/* The persistent "My work" toggle (NAV-2). Lab head only: it flips the
            nav between the lab lens and the personal researcher view. */}
        {isLabHead === true && (
          <PillWrap on={tinted}>
            {/* CM-P2B: the lens reads "Class" for a class instructor, "Lab"
                for a research PI. lensLabel(classMode) is byte-identical to
                "Lab" when class mode is off. */}
            <PiViewModeToggle labLabel={lensLabel(classMode)} />
          </PillWrap>
        )}

        {/* Navigation — the slim, drag-customizable bar (AppNavBar). The
            inline-vs-More split is the user's to set; the responsive auto-
            overflow + edit mode live inside the component. The Supplies hub
            item (href "/supplies" under the flag) is the active tab for the
            unified page AND the legacy /inventory + /purchases routes, which
            redirect into it. */}
        <AppNavBar
          navItems={navItems}
          pathname={pathname ?? null}
          tinted={tinted}
          currentUser={currentUser ?? null}
          isSuppliesActive={(item: NavItem) =>
            INVENTORY_ENABLED &&
            item.href === "/supplies" &&
            item.label === "Supplies" &&
            (pathname === "/supplies" ||
              pathname === "/inventory" ||
              pathname === "/purchases")
          }
          layoutOverride={labNavLayout}
          // Permanent folder control, rendered inside the nav directly beside
          // the More menu (always=true keeps the pill visible even for a single
          // folder so add-folder and switching are one click away). Gated here
          // by NEXT_PUBLIC_MULTI_FOLDER so the nav reserves space for it only
          // when it will actually render; when the flag is off the nav is
          // unchanged.
          trailing={
            MULTI_FOLDER_ENABLED ? (
              <FolderSwitcher variant="header" always tinted={tinted} />
            ) : undefined
          }
        />

        <div className="flex items-center gap-2">
          {/* Top-nav BeakerSearch pill removed 2026-06-12 (the nav-slimming it
              was sequenced behind has shipped). BeakerSearch's home is the
              bottom-center ask bar (BeakerSearchBottomBar, rendered below) plus
              the Cmd-K palette; the redundant top-nav button is gone. */}
          <NotificationBadge pill={tinted} />
          <InboxBadge />
          {/* Class Mode (CT-2): the student Assignments entry. Opens the slide-over
              so a student can act on an assignment from any page. Count badge hidden
              at zero. Only for a class student (flag + role gated). */}
          {showStudentAssignments ? (
            <Tooltip label="Assignments" placement="bottom">
              <button
                type="button"
                aria-label="Open your assignments"
                onClick={() => setAssignmentsDrawerOpen(true)}
                className={`relative p-1.5 rounded-full transition-colors ${
                  tinted
                    ? "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
                }`}
              >
                <Icon name="mortarboard" className="w-[18px] h-[18px]" />
                {assignmentCount > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-teal-600 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-surface-raised">
                    {assignmentCount}
                  </span>
                ) : null}
              </button>
            </Tooltip>
          ) : null}
          {/* Timers button. Opens the Timers popup (running countdowns + new
              timer). A count badge shows how many are running, hidden at zero. */}
          <Tooltip label="Timers" placement="bottom">
            <button
              type="button"
              aria-label="Open Timers"
              onClick={(e) => openTimers({ x: e.clientX, y: e.clientY })}
              className={`relative p-1.5 rounded-full transition-colors ${
                tinted
                  ? "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
              }`}
            >
              <Icon name="alarmClock" className="w-[18px] h-[18px]" />
              {runningTimers > 0 ? (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-surface-raised">
                  {runningTimers}
                </span>
              ) : null}
            </button>
          </Tooltip>
          {/* Companion button. Opens the Companion hub (Connect / Info /
              Settings). The status dot is green when a phone is paired, gray
              otherwise. Hidden when the "Show Companion button on Home" pref is
              off (still reachable from Settings). */}
          {showCompanionButton ? (
            <Tooltip label="Companion" placement="bottom">
              <button
                type="button"
                aria-label="Open Companion"
                onClick={(e) => openCompanion({ x: e.clientX, y: e.clientY })}
                className={`relative p-1.5 rounded-full transition-colors ${
                  tinted
                    ? "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
                }`}
              >
                <Icon name="phone" className="w-[18px] h-[18px]" />
                <span
                  className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ring-2 ring-surface-raised ${
                    phonePaired ? "bg-green-500" : "bg-gray-400"
                  }`}
                />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip label="Help & documentation" placement="bottom">
          <Link
            href={helpHref}
            aria-label="Open the ResearchOS wiki"
            data-tour-target="wiki-nav-tab"
            className={`p-1.5 rounded-full transition-colors ${
              tinted
                ? pathname?.startsWith(HELP_HREF)
                  ? "bg-white text-gray-900 shadow-sm"
                  : "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
                : pathname?.startsWith(HELP_HREF)
                ? "bg-accent-soft text-accent"
                : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </Link>
          </Tooltip>
          {/* VCP R1 trash MVP notes (2026-05-26): small Settings-area
              trash-can link. Lives between Help and Settings so it's
              easy to reach but not part of the main NAV_ITEMS strip
              (per the proposal — trash is admin-area, not first-class
              navigation). The icon stays neutral grey; restore /
              permanent-delete affordances live on the route itself. */}
          <Tooltip label="Trash" placement="bottom">
            <Link
              href="/trash"
              aria-label="Open trash"
              className={`p-1.5 rounded-full transition-colors ${
                tinted
                  ? pathname === "/trash"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
                  : pathname === "/trash"
                  ? "bg-accent-soft text-accent"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </Link>
          </Tooltip>
          {/* User avatar menu: circular chip showing the user's initial + color;
              click opens a dropdown with Researcher profile and Settings links.
              Dark-mode toggle lives here too (moved from top-bar to free space). */}
          {currentUser && (
            <UserAvatarMenu
              currentUser={currentUser}
              primaryColor={baseColor}
              tinted={tinted}
              pathname={pathname}
              attention={pendingRequests.count > 0}
            />
          )}
        </div>
      </header>

      {/* Main content with route-specific sidebar.
       *
       * Widget-framework teardown v2 (2026-06-02): the lab_head ->
       * CustomizableSidebar branch is removed (the customizable widget rail
       * was deleted with the rest of the framework). Sidebar selection is
       * now purely route-based:
       *   - /calendar : CalendarSidebar (its own date rail).
       *   - /gantt    : DailyTasksSidebar (the Today-at-a-glance task rail).
       *   - all others: NO sidebar, full-width (Grant 2026-06-11 scoped the
       *                 Today rail to the GANTT only; it was clutter on every
       *                 other surface, and "/" is a router with no canvas). */}
      <div className="flex flex-1 overflow-hidden">
        {pathname === "/calendar" ? (
          /* Calendar keeps its own date rail. */
          <CollapsibleSidebar>
            <CalendarSidebar />
          </CollapsibleSidebar>
        ) : pathname?.startsWith("/gantt") ? (
          /* The Today-at-a-glance rail (overdue / today / upcoming tasks)
           *  now lives ONLY beside the GANTT (Grant 2026-06-11). The GANTT
           *  is the scheduling surface where a task glance fits the
           *  context; everywhere else the rail was screen clutter. Every
           *  other page renders full-width (the old per-surface carve-out
           *  for /sequences /chemistry /datahub /methods /workbench /
           *  lab-overview is now the default). "/" is a pure router that
           *  bounces to /workbench or /lab-overview, so there is no home
           *  dashboard to host the rail either. */
          <CollapsibleSidebar>
            <DailyTasksSidebar />
          </CollapsibleSidebar>
        ) : null}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* PI-context stopgap (Owen pilot, A7 Part 1). Warns a lab head when
           *  the active folder is not bound to their lab and links to the
           *  Settings account-type control. Self-gates via usePiContextMismatch
           *  (validated against the signed lab record) so a real solo user never
           *  sees it. */}
          <PiContextBanner username={currentUser ?? null} />
          <LabSessionMount>{children}</LabSessionMount>
        </main>
      </div>

      <InboxToast />
      {/* Class Mode (CT-2): the global student-assignments slide-over, opened from
          the top-nav Assignments entry. Only rendered while open + for a class
          student, so it is inert everywhere else. */}
      {showStudentAssignments && assignmentsDrawerOpen && currentUser ? (
        <StudentAssignmentsDrawer
          currentUser={currentUser}
          onClose={() => setAssignmentsDrawerOpen(false)}
        />
      ) : null}
      {/* Lab head UX polish manager Bug 3 (2026-05-24): global Undo
       *  toast for soft-deleted notes. Mounted once at the shell so
       *  every notesApi.delete call site can pop a "Deleted X — Undo"
       *  toast via emitNoteDeleted without prop-drilling its own
       *  handler. */}
      <NoteDeleteUndoToast />
      {/* seq delete trash bot (2026-06-04): the same global Undo toast for
       *  soft-deleted sequences (single + bulk), driven by
       *  emitSequenceDeleted. */}
      <SequenceDeleteUndoToast />
      {/* chem-trash bot (2026-06-11): the same global Undo toast for
       *  soft-deleted molecules, driven by emitMoleculeDeleted. */}
      <MoleculeDeleteUndoToast />
      {/* Researcher profile popup (2026-06-05): opens over the current page as
       *  a living, blurred-backdrop popup when a profile is opened from the
       *  avatar menu or a search result, driven by the profile-modal store. */}
      <ResearcherProfileModal />
      {/* Profile settings popup (2026-06-06): the avatar-menu "Profile settings"
       *  entry opens the appearance + researcher-profile body as a living,
       *  blurred-backdrop popup over the current page instead of navigating to
       *  /profile, same treatment as the public-profile popup above. */}
      <ProfileSettingsModal />
      {/* Settings popup (2026-06-06): the avatar-menu "Settings" entry opens the
       *  full settings body as a living, blurred-backdrop popup over the current
       *  page instead of navigating to /settings, same treatment as the profile
       *  popups above. SettingsBody is lazy-imported inside to avoid a cycle. */}
      <SettingsModal />
      <CompanionHub />
      <TimersPopup />
      <TimerAlarm />
      {/* BeakerBot app-wide dock is mounted in the ROOT layout (app/layout.tsx),
          inside Providers but OUTSIDE AppShell, so the panel and its useAiChat
          conversation persist across client-side route changes. AppShell is NOT
          persistent (each page renders its own), so mounting the dock here used
          to reset the chat and the pending Allow/Skip prompt on a navigate-then-
          click. See BeakerBotDock for its own visibility gate. */}
      {/* Global OAuth-claim resume (account-creation-flow bot, 2026-06-05):
       *  finishes sharing-account creation when the user returns from the
       *  provider redirect with ?sharingClaim=1. Mounts SharingSetupWizard for
       *  the connected user; the wizard's own resume effect drives keygen +
       *  publish + recovery kit and strips the param on success. Self-gates on
       *  the URL flag + a connected user + non-capture mode, so it is inert on
       *  every normal page load. */}
      <SharingClaimResume />
      {/* Phase B2: after a lab-create OAuth round-trip, creates the lab and
          promotes the user to lab_head, then lets LabSessionMount engage.
          Self-gates on sessionStorage "researchos:lab-create" + live session
          + connected user + unlocked identity. Inert otherwise. */}
      <LabCreateResume />
      {/* Staged PI provisioning: when a PI an operator pre-staged a lab for signs
          in for the first time, runs the real lab genesis ON DEVICE inheriting the
          staged branding, then binds the reserved slug + consumes the staging.
          Self-gates on LAB_TIER_ENABLED + a connected user + unlocked identity +
          an OAuth email + a server-confirmed pending staging. Headless and inert
          for every user who has no staged lab. */}
      <LabProvisionResume />
      {/* Retries the relay genesis publish for a lab created locally whose
          publish has not landed yet, and shows a small "Lab sync pending"
          banner while outstanding. The PI is already a full lab head locally;
          this only catches the server up. Self-gates on LAB_TIER_ENABLED + a
          connected user. */}
      <LabGenesisPublishRetry />
      <LabInviteResume />
      <ReminderRunner />
      <NotificationDesktopWatcher />

      {/* Universal floating utility cluster — a single fixed flex row at
          bottom-right, ordered right-to-left by expected frequency:
          Support (rightmost), Report Bug, User Switch, Data folder. The
          flex container owns the fixed positioning and z-index; each
          button inside just declares size/color/shape, so spacing stays
          uniform regardless of how many buttons live here.

          UI affordance fix (break-bot Bug 1, 2026-05-24): the container
          is now `pointer-events-none` so its bounding box (which can
          extend several pixels above the visible button circles via the
          flex line-box + tooltip portals + invisible dev FABs) cannot
          intercept clicks on the content underneath. Each interactive
          button explicitly re-enables `pointer-events-auto` via the
          `pointer-events-auto` utility on the button element (the
          per-button wrappers in `Tooltip` pass that class through to
          the cloned trigger via `composeRefs` — but we set it directly
          on each button below for belt-and-suspenders, because Tooltip
          doesn't propagate utility classes from the container.) */}
      <div
        data-floating-dock
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 pointer-events-none"
      >
        {showDevDock && (
          <>
            <DevBeakerBotGalleryButton />

            <DevTestNotificationButton />

            <DevDemoToggleButton />

            <DevForceTourButton />
          </>
        )}

        {/* The /sequences editor is a dense, full-bleed focus surface with its
            own toolbar + operations rail + inspector on the RIGHT, exactly where
            this bottom-right FAB cluster sits. So on /sequences the Calculator
            FAB is suppressed (its path there is the inline calculator callout)
            and the Report-bug FAB relocates to the bottom-LEFT (rendered below)
            so it clears the rail but stays one click away during the active
            redesign + beta. Both stay in the right cluster on every other
            route, and both actions remain reachable from Settings / the wiki. */}
        {!onSequences && <CalculatorsButton />}

        {/* floating-cluster-split bot (2026-06-02): the Data-folder and
            Switch-user CONFIG actions used to live here as floating
            buttons. Beta feedback flagged the cluster as overloaded with
            config that belongs in Settings, so both moved to dedicated
            Settings sections (Data folder + Account → /settings). Nothing
            was removed — only relocated. The cluster now carries genuine
            quick-actions only: Calculators, Report bug.

            donation-relocation (2026-06-05): the Support / Donate heart left
            the global cluster too. It was floating on every page; it now lives
            on the Settings page (and the onboarding / welcome surfaces) so the
            ask appears where it belongs, not over every workflow. */}

        {!onSequences && <FeedbackButton onClick={openBugReport} />}
      </div>

      {/* BeakerAI build. BeakerSearch's permanent home, a slim always-present
          ask bar docked bottom-CENTER on every route (Option A). It opens the
          same shared BeakerSearch surface the top-nav pill and Cmd K open, so it
          is an additional trigger, not a second surface. Centered, so it clears
          the bottom-right utility cluster above and the /sequences bottom-left
          FAB below. It hides itself under record / capture mode (it owns that
          logic, mirroring the dock and flask). */}
      <BeakerSearchBottomBar />

      {/* On /sequences the Report-bug FAB lives here at the bottom-LEFT instead
          of the bottom-right cluster, so it stays available without floating
          over the operations rail, inspector, or coordinate bar on the right. */}
      {onSequences && (
        <div className="fixed bottom-6 left-6 z-50 flex items-center gap-2 pointer-events-none">
          <FeedbackButton onClick={openBugReport} />
        </div>
      )}

      {/* Data-folder + Switch-user modals moved to /settings (floating-
          cluster-split bot, 2026-06-02). They are now owned by the Data
          folder and Account sections on the Settings page. */}

      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />

      {/* Auto-error confirm dialog used to mount here; it moved to
          lib/providers.tsx (via AutoErrorConfirmHost) so it renders on
          pre-login surfaces too (UserLoginScreen, DataSetupScreen,
          ResearchFolderSetupNew). The hook's auto-error confirm state
          is now backed by a global store, so any callsite's
          useErrorReporting() reads the same flag. (feedback polish R1) */}

      {/* Error toast — stacks above the cluster on the right edge so it
          doesn't collide with any of the four icon buttons at bottom-6. */}
      {showErrorToast && currentError && (
        <div className="fixed bottom-24 right-6 bg-red-600 text-white border border-red-700 px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3 max-w-sm">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-body font-medium">An error occurred</p>
            <p className="text-meta opacity-90 truncate">{currentError.message}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={reportCurrentError}
              className="text-meta bg-white/20 hover:bg-white/30 px-2 py-1 rounded transition-colors"
            >
              Report
            </button>
            <Tooltip label="Dismiss" placement="top">
              <button
                onClick={dismissErrorToast}
                aria-label="Dismiss error toast"
                className="text-meta hover:bg-white/20 px-1 rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

/** Wrap children in a floating white pill only when a colored gradient
 *  header is active. Pre-login the wordmark stays naked on bg-white. */
function PillWrap({ on, children }: { on: boolean; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className="bg-white rounded-full px-3.5 py-1.5 shadow-sm">{children}</div>
  );
}
