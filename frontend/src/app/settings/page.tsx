"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { retentionApi } from "@/lib/local-api";
import {
  DEFAULT_RETENTION_YEARS,
  RETENTION_TARGETS,
  retentionTargetLabel,
  targetHoldsBytes,
  disposalEligibleDate,
  type RetentionTarget,
} from "@/lib/lab/retention";
import { computeFolderManifest } from "@/lib/lab/manifest";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SettingsRailFooter from "@/components/settings/SettingsRailFooter";
import AccountPasswordPopup from "@/components/AccountPasswordPopup";
import DataSetupScreen from "@/components/DataSetupScreen";
import UserLoginScreen from "@/components/UserLoginScreen";
import ImportExperimentDialog from "@/components/ImportExperimentDialog";
import MigrationStatusRow from "@/components/settings/MigrationStatusRow";
import MigrateToSoloModal from "@/components/lab/MigrateToSoloModal";
import DevicesSection from "@/components/settings/DevicesSection";
import ImportELNDialog from "@/components/import-eln/ImportELNDialog";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { useEscapeLayer } from "@/hooks/useEscapeLayer";
import UserAvatar from "@/components/UserAvatar";
import VersionBadge from "@/components/VersionBadge";
import WhatsNewModal from "@/components/WhatsNewModal";
import { RELEASE_NOTES } from "@/lib/release-notes";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import { storePreDemoRoute } from "@/lib/file-system/pre-demo-route";
import { useIsLabMode } from "@/hooks/useIsLabMode";
import { useIsMultiUserFolder } from "@/hooks/useIsMultiUserFolder";
import { useAppStore } from "@/lib/store";
import { useCompanionHub } from "@/lib/ui/companion-hub-store";
import { fileService } from "@/lib/file-system/file-service";
import {
  patchUserSettings,
  readUserSettings,
  SIDEBAR_HORIZON_CHOICES,
  DEFAULT_PURCHASE_ROUTING,
  DEFAULT_LAB_MEMBERSHIP_AGREEMENT,
  type UserSettings,
  type CalendarViewMode,
  type DateFormat,
  type TimeFormat,
  type PurchaseRoutingConfig,
  type PurchaseRoutingContact,
  type LabMembershipAgreement,
} from "@/lib/settings/user-settings";
import { setSpellCheckEnabledLocal } from "@/lib/spellcheck/spellchecker";
import { NAV_ITEMS, HOME_HREF } from "@/lib/nav";
import { ANIMATION_METADATA, renderAnimationIcon, type AnimationType, type RealAnimationType } from "@/components/animations";
import DynamicAnimation from "@/components/DynamicAnimation";
import { hasLocalAccount } from "@/lib/auth/account-store";
import LabRoster from "@/components/lab-head/LabRoster";
import LabMembershipPanel from "@/components/lab-head/LabMembershipPanel";
import { useLabPendingRequests } from "@/hooks/useLabPendingRequests";
import LabIdentitySection from "@/components/lab/LabIdentitySection";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import AuditTrailViewer from "@/components/lab-head/AuditTrailViewer";
import MyLabViewPanel from "@/components/lab/MyLabViewPanel";
import MyLabRequestsPanel from "@/components/lab/MyLabRequestsPanel";
import { loadIdentity } from "@/lib/sharing/identity/storage";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
import { USER_COLOR_QUERY_KEY } from "@/hooks/useUserColor";
import StreaksSection from "./StreaksSection";
import { patchStreak } from "@/lib/streak/streak-sidecar";
import { useTheme, type ThemeChoice } from "@/lib/theme/use-theme";
import {
  TRASH_CLEANUP_OPTIONS,
  getUserTrashCleanupDays,
  type UserSettingsWithTrash,
} from "@/lib/trash";
import {
  HighlightedText,
  SearchableRow,
  SectionMatchProvider,
  SettingsSearchProvider,
  useSectionSearchState,
  useSettingsSearch,
} from "./search-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { useHasCloudSession } from "@/components/account/AccountFirstRedirect";
import SettingsShell, {
  type SettingsGroupDef,
} from "@/components/settings/SettingsShell";
import ProfileSettingsContent from "@/components/profile/ProfileSettingsContent";
import AiUsageSection from "@/components/settings/sections/AiUsageSection";
import CloudStorageUsageSection from "@/components/settings/sections/CloudStorageUsageSection";
import ModelABilling from "@/components/billing/ModelABilling";
import { AccountBenefitsUpsell } from "@/components/settings/sections/AccountBenefitsUpsell";
import NotificationsSection from "@/components/settings/sections/NotificationsSection";
import FolderSwitcher from "@/components/file-system/FolderSwitcher";
import { signOut } from "next-auth/react";

const GANTT_VIEW_OPTIONS: { value: UserSettings["defaultGanttViewMode"]; label: string }[] = [
  { value: "1week", label: "1 week" },
  { value: "2week", label: "2 weeks" },
  { value: "3week", label: "3 weeks" },
  { value: "1month", label: "1 month" },
  { value: "3month", label: "3 months" },
  { value: "6month", label: "6 months" },
  { value: "1year", label: "1 year" },
  { value: "all", label: "All" },
];

const CALENDAR_VIEW_OPTIONS: { value: CalendarViewMode; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: "MDY", label: "MM/DD/YYYY (US)" },
  { value: "DMY", label: "DD/MM/YYYY (EU)" },
  { value: "YMD", label: "YYYY-MM-DD (ISO)" },
];

const TIME_FORMAT_OPTIONS: { value: TimeFormat; label: string }[] = [
  { value: "12h", label: "12-hour (1:30 PM)" },
  { value: "24h", label: "24-hour (13:30)" },
];

export default function SettingsPage() {
  const router = useRouter();

  // Full-screen settings: no AppShell, so the app nav is gone and settings take
  // over the whole window like a focused workspace. Leaving is a permanent X in
  // the corner or Esc, both go back to where you came from (the workbench if
  // there is no history to pop, e.g. a direct load).
  const exit = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/workbench");
    }
  }, [router]);

  // Settings is the bottom overlay layer: register on the shared Escape stack so
  // a nested dialog (e.g. Rotate key) opened on top closes FIRST and only a
  // second Escape exits Settings. The raw window listener this replaces ignored
  // defaultPrevented, so Escape used to bypass an open dialog and exit Settings
  // outright. Section nav uses router.replace (no history buildup) and a direct
  // load falls back to /workbench, so exit() never walks into chrome://newtab.
  useEscapeLayer(true, exit);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-surface-sunken">
      {/* Permanent close, top-right. Esc also exits. */}
      <Tooltip label="Close settings">
        <button
          type="button"
          onClick={exit}
          aria-label="Close settings (Esc)"
          className="absolute right-4 top-3.5 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-foreground-muted shadow-sm transition-colors hover:bg-surface-sunken hover:text-foreground"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </Tooltip>
      <SettingsBody />
    </div>
  );
}

/**
 * Public settings body. Wraps the real body in its own
 * `SettingsSearchProvider` so the inline filter bar works no matter how
 * the body is mounted, the `/settings` route OR the in-app SettingsModal
 * (which renders `SettingsBody` directly inside a LivingPopup). Without
 * the provider here, the modal mount fell back to the context default
 * whose `setQuery` is a no-op, so typing in the search bar did nothing.
 */
export function SettingsBody({
  initialSectionId,
}: {
  /** Section to open on when the shell is mounted without a `?section=` query
   *  (i.e. inside a modal). The /settings route leaves this unset and reads the
   *  URL instead. */
  initialSectionId?: string;
} = {}) {
  return (
    <SettingsSearchProvider>
      <SettingsBodyInner initialSectionId={initialSectionId} />
    </SettingsSearchProvider>
  );
}

// The old Personal / Lab Mode tab identifier + its `?tab=` normalizer were
// retired by the settings-build bot (2026-06-11) when the left-rail shell
// replaced the tab strip. Old `?tab=lab` deep-links still resolve, the mapping
// now lives in SettingsShell.defaultSectionForTab.

// Exported so the SettingsModal (avatar-menu "Settings") can render the exact
// same body inside a popup. The modal lazy-imports this via next/dynamic to
// avoid a circular import (this page imports AppShell, which mounts the modal).
function SettingsBodyInner({
  initialSectionId,
}: {
  initialSectionId?: string;
}) {
  const { currentUser, isConnected, directoryName, disconnect } = useFileSystem();
  const hydrateFromSettings = useAppStore((s) => s.hydrateFromSettings);
  const queryClient = useQueryClient();

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recentlySaved, setRecentlySaved] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwExists, setPwExists] = useState<boolean | null>(null);

  // Cross-boundary sharing identity (Personal-tab "Sharing identity" + "Inbox
  // and storage" sections). The hook reads the per-user sidecar + the device key
  // and reports loading / none / needs-restore / ready. The three identity
  // modals follow the same parent-owns-the-open-state pattern as the password
  // popup, a section button flips a boolean here.
  // The sharing identity itself (Account and keys + Inbox + Cloud storage) and
  // its rotate / restore / disconnect / reset modals moved to the Profile
  // surface (2026-06-06), it is "your account", not an app setting. Settings
  // keeps only `sharing` (read) for the ProfilePointerCard + SecuritySection.
  const sharing = useSharingIdentity();
  // Account gating reads the unified capability model; `sharing` is kept for the
  // genuine identity reads it feeds DevicesSection (status + refresh).
  const caps = useAccountCapabilities();
  // A NextAuth (cloud) session counts as having an account for billing surfaces:
  // AI billing + storage are keyed on the OAuth session server-side, so a
  // cloud-signed-in user must be able to reach Usage & billing even if they have
  // not claimed a local sharing identity (caps.mode). See the AI billing design.
  const hasCloudSession = useHasCloudSession();
  // floating-cluster-split bot (2026-06-02): the Data-folder + Switch-user
  // CONFIG actions relocated here from the AppShell floating cluster. Each
  // opens the same self-contained modal/screen the floating buttons used.
  const [showDataSetup, setShowDataSetup] = useState(false);
  const [showUserSwitch, setShowUserSwitch] = useState(false);

  // Lab-mode users see a Personal / Lab Mode tab strip; solos see the
  // original single-stream Settings layout. The gate mirrors the Lab
  // Inbox visibility logic in AppShell.tsx so the two surfaces stay in
  // sync: `lab_head` always qualifies (a PI necessarily has a lab), and
  // a `member` qualifies when their onboarding picks declared a lab
  // workspace. Existing demo users (Mira, alex, etc.) have
  // `feature_picks: null` because they predate Phase 1; for them the
  // `account_type === "lab_head"` branch carries the signal so Mira
  // still gets the Lab Mode tab. The `settings.account_type` field
  // (member vs lab_head) is also what gates the Lab Head admin controls
  // inside the tab.
  // Identity model simplification Phase 2 (2026-06-07): "lab mode" is now the
  // DERIVED signal (folder has 2 or more users OR any lab head is present), not
  // the stored onboarding solo/lab choice. The onboarding pick is only a hint,
  // so a member who picked "lab" but is alone in their folder is treated as
  // solo until a second user joins (Grant's locked decision). useIsLabMode()
  // reads the folder's users + roles and runs isLabModeFolder, which is the same
  // predicate as folderRequiresLogin, so the "2 or more" rule has one home and
  // the prior bespoke discoverUsers() effect here is retired. The lab_head
  // fast-path keeps a PI's Lab Mode tab visible instantly from the already
  // loaded settings, without waiting on the async folder read. The
  // settings.account_type field still gates the Lab Head admin controls INSIDE
  // the tab (the role gate, unchanged).
  const derivedLabMode = useIsLabMode() ?? false;
  const isLabMode = settings?.account_type === "lab_head" || derivedLabMode;
  // Whether this folder genuinely holds 2+ local users (a legacy multi-user
  // folder). A cross-folder cloud lab has only the PI locally, so the folder
  // roster is redundant there and the unified Members section hides it.
  const isMultiUser = useIsMultiUserFolder() ?? false;

  // Pending lab join-request count (lab-pending-requests-ux, 2026-06-14). Drives
  // the count pill + attention dot on the Members rail item so a PI sees who is
  // waiting without opening the section. Inert (0, no fetch) for non-PIs. React
  // Query dedupes this with the avatar-menu dot in AppShell by the shared key.
  const { count: pendingRequestCount } = useLabPendingRequests();

  // Load on mount + when the active user changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (!currentUser || !isConnected) {
        setSettings(null);
        setLoading(false);
        return;
      }
      const s = await readUserSettings(currentUser);
      const exists = await hasLocalAccount(currentUser);
      if (cancelled) return;
      setSettings(s);
      // Mirror the spell-check pref to localStorage so the inline editor reads
      // it synchronously at mount (same first-paint pattern as editorWidthPreset).
      setSpellCheckEnabledLocal(s.spellCheckInEditor ?? false);
      setPwExists(exists);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isConnected]);

  const refreshPwExists = useCallback(async () => {
    if (!currentUser) return;
    setPwExists(await hasLocalAccount(currentUser));
  }, [currentUser]);

  // Single canonical save path. Each section calls update({ fieldX: value }).
  const update = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!currentUser || !settings) return;
      const optimistic: UserSettings = { ...settings, ...patch };
      setSettings(optimistic);
      setSaving(true);
      try {
        const saved = await patchUserSettings(currentUser, patch);
        setSettings(saved);
        // Keep the in-memory Zustand store in sync so other tabs/components
        // react immediately (without waiting for a re-login).
        hydrateFromSettings({
          animationType: saved.animationType,
          viewMode: saved.defaultGanttViewMode,
          calendarViewMode: saved.defaultCalendarViewMode,
          showShared: saved.showSharedByDefault,
          visibleTabs: saved.visibleTabs,
          navLayout: saved.navLayout ?? null,
          defaultLandingTab: saved.defaultLandingTab,
          sidebarShowTasks: saved.sidebarShowTasks,
          sidebarShowCalendarEvents: saved.sidebarShowCalendarEvents,
          sidebarEventsHorizonDays: saved.sidebarEventsHorizonDays,
          coloredHeader: saved.coloredHeader,
          showCompanionButton: saved.showCompanionButton,
          offlineMode: saved.offlineMode,
        });
        // If either color field changed, invalidate the user-color map so
        // every <UserAvatar /> in the app re-renders with the new gradient
        // on the next paint.
        if (patch.color !== undefined || patch.colorSecondary !== undefined) {
          queryClient.invalidateQueries({ queryKey: USER_COLOR_QUERY_KEY });
        }
        // If the lab-visibility flag changed, bust the lab-goals cache so the
        // Roadmaps tab in Lab Mode reflects the change immediately.
        if (patch.hideGoalsFromLab !== undefined) {
          queryClient.invalidateQueries({ queryKey: ["lab", "goals"] });
          queryClient.invalidateQueries({ queryKey: ["users", "hide-goals-from-lab"] });
        }
        setRecentlySaved(true);
        // Auto-dismiss the "Saved" pill after 1.5s. Set in the handler (not
        // a sync useEffect) so we don't trip the no-setState-in-effect lint.
        setTimeout(() => setRecentlySaved(false), 1500);
      } catch (err) {
        console.error("[Settings] save failed", err);
      } finally {
        setSaving(false);
      }
    },
    [currentUser, settings, hydrateFromSettings, queryClient],
  );

  if (!isConnected || !currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <h2 className="text-heading font-semibold text-foreground">Settings unavailable</h2>
          <p className="text-body text-foreground-muted">
            Connect to a research folder and pick a user to manage your account settings.
          </p>
        </div>
      </div>
    );
  }

  if (loading || !settings) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    );
  }

  // ── Section registry → the SettingsShell rail IA ──────────────────────────
  //
  // settings-build bot (2026-06-11): the old Personal / Lab Mode scroll-wall is
  // replaced by a grouped left rail + content pane. Each section below reuses an
  // EXISTING section component with its existing wiring and role gates, so no
  // control changed how it reads or writes. The page still owns the loaded
  // `settings` + `update`, and passes them through exactly as before.
  //
  // The Lab group is gated on the same predicate the old Lab Mode tab used
  // (isLabMode), and each lab-head-only section keeps its own account_type gate.
  const isLabHead = shouldShowLabHeadAuditTrail(settings);

  // Solo users (no sharing account) lose the cloud-tier features: BeakerBot AI,
  // cloud storage, the email + phone notification channels, companion pairing,
  // and sharing. We hide the pages they do not have (the Usage and billing
  // group) and show one gentle "what an account adds" callout instead, so the
  // surface is tuned to what they can actually use. `status === "ready"` is the
  // same has-an-account signal NotificationsSection + DevicesSection gate on.
  const hasAccount = caps.mode === "account";
  // Billing surfaces also open for a cloud (OAuth) session, not just a claimed
  // local identity, so a signed-in user can actually reach AI usage + buy credits.
  const canSeeBilling = hasAccount || hasCloudSession === true;

  const groups: SettingsGroupDef[] = [
    {
      label: "You",
      sections: [
        {
          id: "profile",
          group: "You",
          title: "Profile & appearance",
          icon: "users",
          keywords:
            "display name avatar color gradient header tint orcid affiliation publications researcher profile public account keys identity sharing email fingerprint recovery",
          // Folds the old /profile page fully in (appearance, researcher
          // profile, public-profile card, account and keys). Same component the
          // /profile route renders, so all of its flows are preserved.
          render: () => <ProfileSettingsContent />,
        },
        {
          id: "account",
          group: "You",
          title: "Account & security",
          icon: "shield",
          keywords:
            "account user switch sign in out login logout password lock security google github unlock",
          render: () => (
            <>
              <AccountSection
                currentUser={currentUser}
                onSwitchUser={() => setShowUserSwitch(true)}
              />
              <SecuritySection
                pwExists={pwExists}
                claimed={caps.mode !== "solo"}
                onOpen={() => setPwOpen(true)}
              />
            </>
          ),
        },
        // Solo-only gentle upsell. Replaces the discovery the hidden Usage and
        // billing group would have given, so a solo user still learns what a
        // free account adds and where to add it, without any locked dead pages.
        ...(!hasAccount
          ? [
              {
                id: "account-benefits",
                group: "You",
                title: "Add a free account",
                icon: "cloud" as const,
                keywords:
                  "account sign up cloud sharing collaborate beakerbot ai email phone notifications companion pairing storage sync unlock free",
                render: () => <AccountBenefitsUpsell />,
              },
            ]
          : []),
      ],
    },
    // Usage and billing is account-only (BeakerBot tokens + cloud storage both
    // need a cloud account). Shown for a claimed local identity OR a cloud
    // (OAuth) session; hidden for true solo users so they never land on an empty
    // or locked billing page.
    ...(canSeeBilling
      ? [
          {
            label: "Usage & billing",
            sections: [
              {
                id: "ai",
                group: "Usage & billing",
                title: "AI usage",
                icon: "bolt" as const,
                flag: "new" as const,
                keywords:
                  "beakerbot tokens balance buy prepaid trial metered cost analysis figure question write-up billing pricing",
                render: () => <AiUsageSection />,
              },
              {
                id: "storage",
                group: "Usage & billing",
                title: "Plan & storage",
                icon: "cloud" as const,
                flag: "new" as const,
                keywords:
                  "plan solo lab department base usage cap card on file accrued balance cloud storage used GB inbox shares sync billing pricing beta",
                render: () => (
                  <>
                    <ModelABilling />
                    <CloudStorageUsageSection />
                  </>
                ),
              },
            ],
          } satisfies SettingsGroupDef,
        ]
      : []),
    {
      label: "Workspace",
      sections: [
        {
          id: "appearance",
          group: "Workspace",
          title: "Appearance & motion",
          icon: "sun",
          keywords:
            "theme light dark system animation motion beakerbot professional mode sparkles celebration playful",
          render: () => (
            <>
              <AppearanceSection />
              <AnimationSection settings={settings} update={update} />
              <ProfessionalModeSection settings={settings} update={update} />
            </>
          ),
        },
        {
          id: "defaults",
          group: "Workspace",
          title: "Defaults",
          icon: "gauge",
          keywords:
            "gantt calendar date time format show shared default view",
          render: () => <DefaultsSection settings={settings} update={update} />,
        },
        {
          id: "sidebar",
          group: "Workspace",
          title: "Sidebar & tabs",
          icon: "list",
          keywords:
            "tabs visible landing sidebar tasks calendar events horizon days",
          render: () => (
            <>
              <TabsSection settings={settings} update={update} />
              <SidebarSection settings={settings} update={update} />
            </>
          ),
        },
        {
          id: "companion",
          group: "Workspace",
          title: "Companion",
          icon: "phone",
          keywords:
            "companion phone pair pairing mobile capture photo qr relay inbox camera bench notes scan today glance devices hub open",
          render: () => (
            <SectionShell
              id="devices"
              title="Companion"
              description="Pair your phone to the ResearchOS Companion app. Capture at the bench, glance at today, and have everything sync back to your folder automatically."
              searchKeywords="companion phone pair pairing mobile capture photo qr relay inbox camera bench notes scan today glance devices hub open"
            >
              <OpenCompanionHubButton />
              {/*
                Same two preferences the Companion popover Settings tab shows.
                Both read and write UserSettings via `update`, so toggling here
                or in the popover stays in sync (the showCompanionButton write
                also flows into the Zustand store through hydrateFromSettings,
                so the header button reacts instantly).
              */}
              <div className="space-y-4">
                <ToggleRow
                  label="Show Companion button on Home"
                  description="The phone button in the app header. Off hides it; the Companion stays reachable from Settings."
                  checked={settings?.showCompanionButton ?? true}
                  onChange={(v) => update({ showCompanionButton: v })}
                />
                <ToggleRow
                  label="Auto-publish snapshots to paired phones"
                  description="The laptop pushes today, inventory, and notebook snapshots to your paired phones. Off stops the push."
                  checked={settings?.autoPublishSnapshotsToPhones ?? true}
                  onChange={(v) => update({ autoPublishSnapshotsToPhones: v })}
                />
              </div>
              <DevicesSection
                status={sharing.status}
                refreshIdentity={sharing.refresh}
              />
            </SectionShell>
          ),
        },
        {
          id: "notifications",
          group: "Workspace",
          title: "Notifications",
          icon: "bell",
          keywords:
            "notifications notify alert bell email phone laptop desktop pop-up push quiet hours channel route digest mention comment shared reminder",
          render: () => (
            <SectionShell
              id="notifications"
              title="Notifications"
              description="Choose what you hear about, and where each kind of notification goes, the bell, your laptop, your phone, or your inbox."
              searchKeywords="notifications notify alert bell email phone laptop desktop pop-up push quiet hours channel route digest mention comment shared reminder"
            >
              <NotificationsSection settings={settings} update={update} />
            </SectionShell>
          ),
        },
        {
          id: "aihelper",
          group: "Workspace",
          title: "AI Helper",
          icon: "ask",
          keywords:
            "ai helper schema prompt external chatgpt claude copy clipboard provider",
          render: () => <AIHelperSection />,
        },
        {
          id: "behavior",
          group: "Workspace",
          title: "Behavior",
          icon: "check",
          keywords:
            "behavior confirm destructive spell check spelling editor outline",
          render: () => <BehaviorSection settings={settings} update={update} />,
        },
        {
          id: "streaks",
          group: "Workspace",
          title: "Streaks & PTO",
          icon: "today",
          keywords: "streak streaks pto time off vacation daily activity",
          render: () => <StreaksSection />,
        },
        {
          id: "tips",
          group: "Workspace",
          title: "Tips",
          icon: "book",
          keywords: "tips feature hints onboarding help walkthrough",
          render: () => <TipsSection />,
        },
        {
          id: "asset-library",
          group: "Workspace",
          title: "Icon library",
          icon: "library",
          keywords:
            "icon library asset open source biorender icons svg figure contribute review verify clipart illustration phylopic bioicons",
          render: () => (
            <SectionShell
              id="asset-library"
              title="Icon library"
              description="A free, openly-licensed library of scientific icons and silhouettes you can drop into figures — every asset carries its source and license, and credits are added automatically. Browse it, contribute your own, or help review community submissions."
              searchKeywords="icon library asset open source biorender icons svg figure contribute review verify clipart illustration phylopic bioicons"
            >
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/library"
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-action px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  <Icon name="library" className="h-4 w-4" />
                  Browse the library
                </Link>
                <Link
                  href="/library/contribute"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-sunken"
                >
                  <Icon name="plus" className="h-4 w-4" />
                  Contribute an icon
                </Link>
                <Link
                  href="/library/review"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-sunken"
                >
                  <Icon name="check" className="h-4 w-4" />
                  Review submissions
                </Link>
              </div>
            </SectionShell>
          ),
        },
      ],
    },
    {
      label: "Data",
      sections: [
        {
          id: "folder",
          group: "Data",
          title: "Data folder",
          icon: "folder",
          keywords:
            "data folder directory connect switch research storage disk location",
          render: () => (
            <DataFolderSection
              directoryName={directoryName}
              onConnectOrSwitch={() => setShowDataSetup(true)}
            />
          ),
        },
        {
          id: "inventory",
          group: "Data",
          title: "Inventory & export",
          icon: "box",
          keywords:
            "files disk indexeddb cache external calls api network privacy export orphaned artifacts",
          render: () => <DataInventorySection />,
        },
        {
          id: "trash",
          group: "Data",
          title: "Trash & history",
          icon: "trash",
          keywords:
            "trash delete soft-delete restore cleanup window history version control orphaned",
          render: () => (
            <TrashAndHistorySection settings={settings} update={update} />
          ),
        },
        {
          id: "maintenance",
          group: "Data",
          title: "Maintenance",
          icon: "bolt",
          keywords:
            "repair method links source paths formats reconcile import experiment zip migrate convert solo migration history",
          render: () => <MaintenanceSection />,
        },
        {
          id: "labarchives",
          group: "Data",
          title: "Lab archives",
          icon: "database",
          keywords: "lab archives accessible restore retention finished work",
          render: () => <LabArchivesSection />,
        },
        {
          id: "offline",
          group: "Data",
          title: "Offline & sync",
          icon: "refresh",
          keywords:
            "offline mode network proxy server outbound block disable api sync conflicts",
          render: () => (
            <OfflineModeSection settings={settings} update={update} />
          ),
        },
      ],
    },
    // Lab group, gated on the same predicate the old Lab Mode tab used. Each
    // lab-head-only section keeps its own account_type gate unchanged.
    ...(isLabMode
      ? [
          {
            label: "Lab",
            labBadge: true,
            sections: [
              // One unified Members page: the cloud lab roster + invite link +
              // pending join requests (lab head) AND the folder roster with
              // archive/restore. The folder roster is hidden for a cross-folder
              // cloud lab head (no other local users to manage) and shown for a
              // legacy multi-user folder or to a member, which is their roster.
              {
                id: "members",
                group: "Lab",
                title: "Members",
                icon: "users" as const,
                // Surfaces pending join requests right on the rail item.
                badgeCount: pendingRequestCount,
                keywords:
                  "members roster invite join link add request archive restore lab people seat pending sponsored collaborator",
                render: () => (
                  <>
                    {LAB_TIER_ENABLED && isLabHead ? (
                      <LabMembershipSection />
                    ) : null}
                    {isMultiUser || !(LAB_TIER_ENABLED && isLabHead) ? (
                      <LabRosterSection />
                    ) : null}
                  </>
                ),
              },
              // Lab settings: the account-type (role) control plus, for a lab
              // head, the lab agreement (mode / visibility / approval policy).
              // Policy lives apart from the people list above.
              {
                id: "labsettings",
                group: "Lab",
                title: "Lab settings",
                icon: "shield" as const,
                keywords:
                  "account type member pi lab head role agreement mode solo lab visibility approval policy settings name title logo identity branding",
                render: () => (
                  <>
                    {LAB_TIER_ENABLED && isLabHead ? (
                      <LabIdentitySection settings={settings} />
                    ) : null}
                    <AccountTypeSection settings={settings} update={update} />
                    {isLabHead ? (
                      <LabAgreementSection settings={settings} update={update} />
                    ) : null}
                  </>
                ),
              },
              // Member transparency: every lab user (member or head) can see
              // exactly what their lab head's lab view has read and changed about
              // them. Not lab-head-gated, this is the member's half of the trust
              // contract behind the PI lab-scoped read.
              {
                id: "mylabview",
                group: "Lab",
                title: "Your lab view",
                icon: "eye" as const,
                keywords:
                  "transparency privacy what my pi lab head sees reads access audit my data lab view",
                render: () => <MyLabViewSection />,
              },
              // Phase C: requests from the lab head for the member's heavy items
              // (big tables) that are not in the eager mirror. The member
              // approves to upload them for a window. Visible to every lab user.
              {
                id: "labrequests",
                group: "Lab",
                title: "Requests from your lab head",
                icon: "download" as const,
                keywords:
                  "requests lab head approve share heavy table on demand upload grant pi",
                render: () => <MyLabRequestsSection />,
              },
              ...(isLabHead
                ? [
                    {
                      id: "audit",
                      group: "Lab",
                      title: "Audit trail",
                      icon: "history" as const,
                      keywords:
                        "audit log history pi lab head edits trail changes",
                      render: () => <LabAuditTrailSection />,
                    },
                    {
                      id: "retention",
                      group: "Lab",
                      title: "Retention registry",
                      icon: "file" as const,
                      keywords:
                        "retention registry policy r2 compliance funder data retention member",
                      render: () => (
                        <RetentionRegistrySection currentUser={currentUser} />
                      ),
                    },
                    {
                      id: "routing",
                      group: "Lab",
                      title: "Department routing",
                      icon: "mail" as const,
                      keywords:
                        "department routing contacts email template purchase send hand off accountant stores",
                      render: () => (
                        <PurchaseRoutingSection
                          settings={settings}
                          update={update}
                        />
                      ),
                    },
                  ]
                : []),
            ],
          } satisfies SettingsGroupDef,
        ]
      : []),
  ];

  // A lab head runs the lab, so the Lab group leads their rail instead of
  // sitting last below the personal + workspace settings. Members and solo
  // users keep the default You -> Workspace -> Data (-> Lab) order.
  const orderedGroups: SettingsGroupDef[] = isLabHead
    ? [
        ...groups.filter((g) => g.label === "Lab"),
        ...groups.filter((g) => g.label !== "Lab"),
      ]
    : groups;

  // key={currentUser} on the shell resets each section's local draft state when
  // the lab user switches mid-session, so we never show user A's half-typed
  // draft to user B (the same guard the old scroll-wall had).
  return (
    <div className="min-h-0 flex-1 flex flex-col bg-surface-sunken">
      <SettingsShell
        key={currentUser}
        groups={orderedGroups}
        currentUser={currentUser}
        initialSectionId={initialSectionId}
        roleLabel={
          isLabHead ? "Lab head" : isLabMode ? "Lab member" : undefined
        }
        headerExtra={
          // Slim top bar: title on the left, quick-exit controls + saved
          // indicator on the right. "Disconnect folder" and "Log out" live here
          // so they are visible the moment Settings opens, not buried two levels
          // deep. Keeps the `settings-folder-section` spotlight anchor.
          <div
            data-tour-target="settings-folder-section"
            className="flex items-center justify-between gap-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="text-title font-bold text-foreground">Settings</h1>
              <VersionBadge />
            </div>
            <div className="flex items-center gap-2">
              {/* Disconnect folder: removes the active folder from the app and
                  returns to the connect screen. Files on disk are untouched. */}
              <Tooltip label="Return to the connect screen. Your files on disk are not changed." placement="bottom">
                <button
                  type="button"
                  onClick={() => {
                    const ok = window.confirm(
                      "Disconnect this folder? Your files on disk are not changed and you will return to the connect screen.",
                    );
                    if (ok) void disconnect();
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-meta text-foreground-muted transition hover:border-border-strong hover:text-foreground"
                >
                  <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                  <span>Disconnect folder</span>
                </button>
              </Tooltip>
              {/* Log out: ends the NextAuth cloud session and returns to /.
                  Uses the dedicated "logout" glyph (door with an arrow leaving),
                  added to the registry for this meaning. */}
              <Tooltip label="Sign out of your account" placement="bottom">
                <button
                  type="button"
                  onClick={() =>
                    void (async () => {
                      // Forget the folder before signing out so "/" lands on
                      // home, never the folder picker. Sign out regardless.
                      try {
                        await disconnect();
                      } catch {
                        // ignore
                      }
                      await signOut({ callbackUrl: "/" });
                    })()
                  }
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-meta text-foreground-muted transition hover:border-border-strong hover:text-foreground"
                >
                  <Icon name="logout" className="h-3.5 w-3.5 shrink-0" />
                  <span>Log out</span>
                </button>
              </Tooltip>
              <SavedIndicator saving={saving} recentlySaved={recentlySaved} />
            </div>
          </div>
        }
        railSearch={<SettingsSearchBar />}
        railFooter={<SettingsRailFooter />}
      />

      {pwOpen && currentUser && (
        <AccountPasswordPopup
          username={currentUser}
          onClose={() => {
            setPwOpen(false);
            void refreshPwExists();
          }}
        />
      )}


      {/* Data folder + Switch user modals (floating-cluster-split bot,
          2026-06-02). Relocated verbatim from the AppShell floating
          cluster — same DataSetupScreen / UserLoginScreen, same
          invalidate-on-login behavior — so no capability is lost. */}
      <DataSetupScreen
        isOpen={showDataSetup}
        onClose={() => setShowDataSetup(false)}
      />
      {showUserSwitch && (
        <UserLoginScreen
          onLogin={() => {
            setShowUserSwitch(false);
            queryClient.invalidateQueries();
          }}
        />
      )}
    </div>
  );
}

function SavedIndicator({ saving, recentlySaved }: { saving: boolean; recentlySaved: boolean }) {
  if (saving) return <span className="text-meta text-foreground-muted">Saving…</span>;
  if (recentlySaved) return <span className="text-meta text-emerald-600 dark:text-emerald-300">Saved</span>;
  return null;
}

/**
 * Settings page inline filter bar (settings search UX manager, 2026-05-23).
 *
 * Renders the magnifying-glass + input + clear-button row that drives the
 * SettingsSearchProvider's query. Reads + writes the shared context so
 * every SectionShell + SearchableRow on the page filters live as the
 * user types. The provider already debounces the lower-cased query by
 * ~120ms so a fast typist doesn't trigger 20 re-renders per keystroke;
 * the input itself stays uncontrolled-feeling (raw value updates
 * immediately so the caret follows the keys).
 */
function SettingsSearchBar() {
  const { query, setQuery } = useSettingsSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <span
        className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted pointer-events-none"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search settings..."
        aria-label="Search settings"
        className="w-full pl-9 pr-9 py-2 border border-border rounded-lg text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {query && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Tooltip label="Clear search">
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="p-1 text-foreground-muted hover:text-foreground-muted rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ── Sections ────────────────────────────────────────────────────────────────

interface SectionProps {
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => Promise<void>;
}

// Opens the Companion hub popup (Connect / Info / Settings tabs) from inside the
// Settings Companion section. This is the escape hatch when the header Companion
// button is hidden (hub Settings -> "Show Companion button on Home" off): the
// inline DevicesSection below only covers Connect, so without this the show-button
// toggle in the hub's Settings tab would be unreachable.
function OpenCompanionHubButton() {
  const open = useCompanionHub((s) => s.open);
  return (
    <button
      type="button"
      onClick={(e) => open({ x: e.clientX, y: e.clientY })}
      className="ros-btn-neutral inline-flex items-center gap-2 px-3.5 py-2 text-body font-medium"
    >
      <Icon name="phone" className="h-4 w-4" />
      Open Companion hub
    </button>
  );
}

function SectionShell({
  title,
  description,
  children,
  id,
  tourTarget,
  /** Extra strings to include in the section's search-match check
   *  beyond `title` + `description`. Used when a section contains
   *  meaningful row keywords that aren't directly in its own title
   *  (e.g. the Tabs section references each NAV_ITEM label).
   *  Concatenated with spaces. */
  searchKeywords,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Optional fragment-id anchor — used by deep-links like
   *  `/settings#personalize` (fired by onboarding tips' setupActions). */
  id?: string;
  /** Optional `data-tour-target` value — used by the Onboarding v4
   *  walkthrough to anchor spotlights on specific Settings sections
   *  (e.g. the AI Helper section in §6.10). */
  tourTarget?: string;
  searchKeywords?: string;
}) {
  // Hook into the page-level search filter. The section hides itself
  // when the query is active AND neither the section's own
  // title / description / keywords nor any registered child row match.
  // `data-tour-target` stays on the outermost <section> in both render
  // paths so the V4 walkthrough selectors keep resolving.
  const descBlob = [description, searchKeywords].filter(Boolean).join(" ");
  const state = useSectionSearchState(title, descBlob || undefined);

  return (
    <section
      id={id}
      data-tour-target={tourTarget}
      data-settings-section-marker="1"
      hidden={state.shouldHide}
      className="bg-surface-raised rounded-xl border border-border ros-seam p-6 scroll-mt-4"
    >
      <div className="mb-4">
        <h2 className="text-title font-semibold text-foreground">
          <HighlightedText text={title} />
        </h2>
        {description && (
          <p className="text-meta text-foreground-muted mt-1">
            <HighlightedText text={description} />
          </p>
        )}
      </div>
      <SectionMatchProvider register={state.register}>
        <div className="space-y-4">{children}</div>
      </SectionMatchProvider>
    </section>
  );
}

// ── Data folder ─────────────────────────────────────────────────────────────
//
// floating-cluster-split bot (2026-06-02): relocated from the AppShell floating
// cluster. Beta feedback flagged the cluster as overloaded with CONFIG actions
// that belong in Settings; connecting / switching the on-disk data folder is
// exactly that. The button opens the same DataSetupScreen the floating folder
// icon used, so no capability changed — only its home.

function DataFolderSection({
  directoryName,
  onConnectOrSwitch,
}: {
  directoryName: string | null;
  onConnectOrSwitch: () => void;
}) {
  return (
    <SectionShell
      title="Data folder"
      description="The local folder where this app reads and writes all your lab data. Connect a folder or point the app at a different one."
      searchKeywords="data folder directory connect switch research storage disk location"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-body text-foreground">
            Connected folder:{" "}
            <span className={directoryName ? "font-medium text-foreground" : "text-foreground-muted"}>
              {directoryName ?? "none"}
            </span>
          </p>
          <p className="text-meta text-foreground-muted mt-1">
            Switching folders does not move or delete any files; it only changes
            which folder the app is pointed at.
          </p>
        </div>
        <button
          type="button"
          onClick={onConnectOrSwitch}
          className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
        >
          Connect or switch folder
        </button>
      </div>
      {/* Folders you have opened before (panel variant of the folder switcher).
          Lists remembered folders with switch / rename / forget controls and
          an "Open another folder" row at the bottom. Gated by the same
          NEXT_PUBLIC_MULTI_FOLDER flag as the component itself; renders
          nothing when the flag is off. */}
      <p className="text-meta text-foreground-muted">Folders you have opened before:</p>
      <FolderSwitcher variant="panel" />
    </SectionShell>
  );
}

// ── Account (switch user) ───────────────────────────────────────────────────
//
// floating-cluster-split bot (2026-06-02): relocated from the AppShell floating
// cluster. The avatar button that switched the signed-in user was a CONFIG
// action, not a quick-action, so it moves here. Opens the same UserLoginScreen
// the floating button used. The `user-picker-button` tour target rides along on
// the new button so any walkthrough anchoring keeps resolving.

function AccountSection({
  currentUser,
  onSwitchUser,
}: {
  currentUser: string | null;
  onSwitchUser: () => void;
}) {
  return (
    <SectionShell
      title="Account"
      description="The user you are currently signed in as inside this app. Switch to another user in this folder, or sign in / out."
      searchKeywords="account user switch sign in sign out login logout profile"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {currentUser ? (
            <UserAvatar username={currentUser} size="sm" />
          ) : (
            <span className="inline-flex w-9 h-9 items-center justify-center rounded-full bg-surface-sunken text-foreground-muted text-body font-semibold">
              ?
            </span>
          )}
          <div className="min-w-0">
            <p className="text-body text-foreground">
              Signed in as{" "}
              <span className={currentUser ? "font-medium text-foreground" : "text-foreground-muted"}>
                {currentUser ?? "no one"}
              </span>
              .
            </p>
            <p className="text-meta text-foreground-muted mt-1">
              Same picker as the app login screen.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSwitchUser}
          data-tour-target="user-picker-button"
          className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
        >
          Switch user
        </button>
      </div>
    </SectionShell>
  );
}

// The old "Profile and account" pointer card linked OUT to a separate /profile
// page. The settings-build bot (2026-06-11) folded that page fully into the new
// "Profile & appearance" rail section (it renders ProfileSettingsContent inline),
// so the pointer card is retired and there is one place to edit yourself.

/**
 * Lab Head Phase 1 (lab head Phase 1 manager, 2026-05-23): account-role
 * picker. Member vs Lab Head. Member is the default and matches the
 * existing behavior — picking Lab Head reveals the Lab Overview top-nav
 * entry (renamed from "Lab Inbox" + promoted to top-nav 2026-05-23) and
 * (Phase 2+) audit + soft-write surfaces. Multiple users in the same
 * lab can hold Lab Head (co-PIs allowed by design).
 *
 * No password gate yet — Phase 5 will reuse the account password to
 * unlock soft-write edit mode. For now the toggle is unguarded.
 */
function AccountTypeSection({ settings, update }: SectionProps) {
  const options: Array<{
    value: UserSettings["account_type"];
    title: string;
    description: string;
  }> = [
    {
      value: "member",
      title: "Member",
      description: "Regular lab researcher. The default for everyone.",
    },
    {
      value: "lab_head",
      title: "PI",
      description:
        "Principal investigator. Adds a fixed, curated Lab Overview page, plus audit logging and purchase approval.",
    },
  ];

  // Lab head UX polish manager Bug 4 (2026-05-24): role switch is
  // consequential (changes nav, sidebar, available widgets, audit gates)
  // but previously fired silently. Two-step: confirm before commit, then
  // a 10s "Switch back" undo toast after commit.
  const [pendingSwitch, setPendingSwitch] = useState<
    UserSettings["account_type"] | null
  >(null);
  const [undoToast, setUndoToast] = useState<{
    previous: UserSettings["account_type"];
    next: UserSettings["account_type"];
  } | null>(null);

  useEffect(() => {
    if (!undoToast) return;
    const timer = window.setTimeout(() => setUndoToast(null), 10000);
    return () => window.clearTimeout(timer);
  }, [undoToast]);

  const commitSwitch = useCallback(
    async (target: UserSettings["account_type"]) => {
      const previous = settings.account_type;
      if (previous === target) return;
      await update({ account_type: target });
      setUndoToast({ previous, next: target });
    },
    [settings.account_type, update],
  );

  const undoSwitch = useCallback(async () => {
    if (!undoToast) return;
    await update({ account_type: undoToast.previous });
    setUndoToast(null);
  }, [undoToast, update]);

  return (
    <SectionShell
      id="account-type"
      title="Account type"
      description="What's your role in this lab? Member is the default. PI adds a fixed, curated Lab Overview page, plus audit logging and purchase approval."
      searchKeywords="member PI principal investigator lab head role"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((opt) => {
          const selected = settings.account_type === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                if (settings.account_type !== opt.value) {
                  setPendingSwitch(opt.value);
                }
              }}
              aria-pressed={selected}
              className={`flex flex-col items-start gap-1 p-3 rounded-lg border-2 text-left transition-colors ${
                selected
                  ? "border-amber-400 bg-amber-50 dark:bg-amber-500/15"
                  : "border-border hover:border-border hover:bg-surface-sunken"
              }`}
            >
              <span
                className={`text-body font-semibold ${
                  selected ? "text-amber-800 dark:text-amber-300" : "text-foreground"
                }`}
              >
                {opt.title}
              </span>
              <span className="text-meta text-foreground-muted">{opt.description}</span>
            </button>
          );
        })}
      </div>

      {/* Confirmation dialog: shown after a click on a non-current
       *  option, before any write hits disk. Single confirm per Bug 4
       *  spec; no double-confirm. */}
      {pendingSwitch && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-type-confirm-title"
          data-testid="account-type-confirm"
        >
          <div className="bg-surface-overlay rounded-xl ros-popup-card-shadow max-w-md w-full mx-4 p-5">
            <h3
              id="account-type-confirm-title"
              className="text-title font-semibold text-foreground"
            >
              {pendingSwitch === "lab_head"
                ? "Switch your account type to PI?"
                : "Switch your account type to Member?"}
            </h3>
            <p className="text-body text-foreground-muted mt-2">
              {pendingSwitch === "lab_head"
                ? "This adds the curated Lab Overview page, audit logging, and the ability to approve purchases."
                : "This hides the Lab Overview surface and lab-head-only controls. You will keep your existing data."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingSwitch(null)}
                className="px-3 py-1.5 text-body text-foreground hover:bg-surface-sunken rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingSwitch;
                  setPendingSwitch(null);
                  void commitSwitch(target);
                }}
                className="ros-btn-raise px-3 py-1.5 text-body bg-amber-600 text-white hover:bg-amber-700 rounded-lg transition-colors"
                data-testid="account-type-confirm-ok"
              >
                Switch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-commit undo toast — 10s window. Click "Switch back" to
       *  revert immediately. After 10s the toast self-dismisses and the
       *  switch stands. */}
      {undoToast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-surface-overlay text-foreground border border-border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3"
          role="status"
          aria-live="polite"
          data-testid="account-type-undo-toast"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="flex-shrink-0 text-emerald-600 dark:text-emerald-400"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-body">
            Switched to{" "}
            <span className="font-semibold">
              {undoToast.next === "lab_head" ? "PI" : "Member"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void undoSwitch()}
            className="text-meta font-medium text-amber-600 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-200 underline-offset-2 hover:underline"
            data-testid="account-type-undo-button"
          >
            Switch back
          </button>
        </div>
      )}
    </SectionShell>
  );
}

/**
 * Settings tabs manager 2026-05-23: Lab Roster wrapped in its own
 * SectionShell so it can stand alone in the Lab Mode tab. Lab heads see
 * an interactive archive / restore UI; members see the same roster
 * read-only (LabRoster gates its archive buttons internally via
 * `canArchive`). Previously the roster was nested inside
 * `LabHeadSection`; pulling it out keeps members from losing access to
 * the read-only roster surface when they aren't lab heads themselves.
 */
function LabRosterSection() {
  return (
    <SectionShell
      id="lab-roster"
      title="Lab Roster"
      description="Active and archived lab members. PIs can archive or restore members; everyone else sees the roster read-only."
      searchKeywords="members archive restore lab"
    >
      <LabRoster />
    </SectionShell>
  );
}

/**
 * PI capability revamp Phase 4 (sharing + collaboration manager, 2026-06-07):
 * the Settings home of the lab-head audit trail. A short explainer plus a button
 * that opens the AuditTrailViewer with NO targetUser, so it lands on the member
 * picker. There is no password control here, the old PI edit-session unlock is
 * gone, opening the read-only viewer is sufficient.
 *
 * Gated to lab heads only by the caller (LabModeTabContent renders it only when
 * `settings.account_type === "lab_head"`). A member in a lab workspace still
 * sees the Lab Mode tab but never this section.
 */
/**
 * Gate predicate for the lab-head-only Settings sections (the audit trail).
 * Exported so the gate can be unit-tested without mounting the heavy Settings
 * page. The Lab Mode tab is visible to a member in a lab workspace too, so this
 * checks the actual account_type rather than the looser isLabMode tab flag.
 */
export function shouldShowLabHeadAuditTrail(
  settings: Pick<UserSettings, "account_type"> | null | undefined,
): boolean {
  return settings?.account_type === "lab_head";
}

/**
 * Lab tier Phase 8d: the relay-based lab-membership controls (invite link +
 * pending join requests). Lab-head only, and only when the lab tier is on.
 * Distinct from the folder-based LabRoster above it on the same tab.
 */
function LabMembershipSection() {
  return (
    <SectionShell
      id="lab-membership"
      title="Lab membership"
      description="Invite members with a one-time link and add them when they request to join."
      searchKeywords="invite member join link lab tier add request"
    >
      <LabMembershipPanel />
    </SectionShell>
  );
}

/**
 * The member-facing transparency section, the member's half of the PI
 * lab-scoped-read trust contract (docs/proposals/2026-06-17-beakerbot-lab-head-
 * utilities.md). Visible to every lab user, not gated to lab heads. A short
 * explainer plus a button that opens the read-only MyLabViewPanel onto the
 * current user's own audit log.
 */
function MyLabViewSection() {
  const [panelOpen, setPanelOpen] = useState(false);
  return (
    <SectionShell
      id="my-lab-view"
      title="Your lab view"
      description="See exactly what your lab head's lab view has read and changed about your work. Read-only."
      searchKeywords="transparency privacy what my pi lab head sees reads access audit my data lab view"
    >
      <div className="space-y-3">
        <p className="text-meta text-foreground-muted leading-relaxed">
          Your lab head can read the work you sync to the lab, since they own the
          grant and the records. Every time their lab view reads or changes your
          work it is logged here, on its own, and nobody can quietly turn the log
          off. Open it to see the full record.
        </p>
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="ros-btn-neutral inline-flex items-center gap-2 px-3.5 py-2 text-body font-medium"
          data-testid="open-my-lab-view-settings"
        >
          <span aria-hidden="true" className="text-foreground-muted">
            <Icon name="eye" className="h-4 w-4" />
          </span>
          Open your lab view
        </button>
      </div>
      <MyLabViewPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </SectionShell>
  );
}

/**
 * Phase C: the member's "Requests from your lab head" section. Visible to every
 * lab user. Lists the heavy items the PI has asked for and lets the member
 * approve, which uploads them for a TTL window. See MyLabRequestsPanel.
 */
function MyLabRequestsSection() {
  return (
    <SectionShell
      id="my-lab-requests"
      title="Requests from your lab head"
      description="Approve your lab head's requests for your heavy items (like big data tables) to upload them for a window."
      searchKeywords="requests lab head approve share heavy table on demand upload grant pi"
    >
      <div className="space-y-3">
        <p className="text-meta text-foreground-muted leading-relaxed">
          Heavy items like large data tables are not uploaded automatically. When
          your lab head wants to see one, it shows up here. Approving uploads that
          one item and keeps it shared for 30 days, then it reverts to on-request.
        </p>
        <MyLabRequestsPanel />
      </div>
    </SectionShell>
  );
}

function LabAuditTrailSection() {
  const [viewerOpen, setViewerOpen] = useState(false);
  return (
    <SectionShell
      id="lab-audit-trail"
      title="Lab audit trail"
      description="Review every change you saved to a member's record as the lab head, field by field. Read-only."
      searchKeywords="audit log history pi lab head edits trail changes"
    >
      <div className="space-y-3">
        <p className="text-meta text-foreground-muted leading-relaxed">
          When you edit a member&apos;s task, note, or purchase as the lab head,
          each field change is logged to their folder. Open the audit trail to
          see those changes per member. This view never edits anything.
        </p>
        <button
          type="button"
          onClick={() => setViewerOpen(true)}
          className="ros-btn-neutral inline-flex items-center gap-2 px-3.5 py-2 text-body font-medium"
          data-testid="open-audit-trail-settings"
        >
          <span aria-hidden="true" className="text-foreground-muted">
            <Icon name="history" className="h-4 w-4" />
          </span>
          Open audit trail
        </button>
      </div>
      <AuditTrailViewer open={viewerOpen} onClose={() => setViewerOpen(false)} />
    </SectionShell>
  );
}


/**
 * Department-routing config (PURCHASE_DOCS_AND_ROUTING.md, the Purchasing module
 * of the Lab Head hub). A PI turns on routing, adds the department / HR contacts
 * a purchase document gets emailed to, and edits the draft templates. Disabled +
 * empty by default, so the whole thing (and the "Send to department" button on
 * purchases) stays hidden until the PI opts in. The draft opens in the PI's own
 * mail app, so it sends from their real address with no stored credentials.
 */
function PurchaseRoutingSection({ settings, update }: SectionProps) {
  const [draft, setDraft] = useState<PurchaseRoutingConfig>(
    () => settings.purchaseRouting ?? DEFAULT_PURCHASE_ROUTING,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    await update({ purchaseRouting: draft });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addContact = () => {
    const c: PurchaseRoutingContact = {
      id: crypto.randomUUID(),
      name: "",
      email: "",
    };
    setDraft((d) => ({ ...d, contacts: [...d.contacts, c] }));
  };
  const editContact = (
    id: string,
    field: "name" | "email",
    value: string,
  ) =>
    setDraft((d) => ({
      ...d,
      contacts: d.contacts.map((c) =>
        c.id === id ? { ...c, [field]: value } : c,
      ),
    }));
  const removeContact = (id: string) =>
    setDraft((d) => ({ ...d, contacts: d.contacts.filter((c) => c.id !== id) }));

  const input =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-body";

  return (
    <SectionShell
      title="Department routing"
      description="Optional. Email a purchase's documents to your department or HR contact in one click, drafted from your own account. Turn it on to add a Send to department button on approved purchases."
      searchKeywords="purchase routing department HR email send document invoice receipt grant"
    >
      <label className="flex items-center gap-2 text-body text-foreground">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) =>
            setDraft((d) => ({ ...d, enabled: e.target.checked }))
          }
        />
        Enable department routing
      </label>

      <div className={draft.enabled ? "" : "pointer-events-none opacity-50"}>
        <div className="mt-4">
          <p className="mb-1 text-meta font-semibold text-foreground-muted">
            Department / HR contacts
          </p>
          <div className="space-y-2">
            {draft.contacts.length === 0 && (
              <p className="text-meta text-foreground-muted">No contacts yet.</p>
            )}
            {draft.contacts.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <input
                  className={input}
                  placeholder="Name / role"
                  value={c.name}
                  onChange={(e) => editContact(c.id, "name", e.target.value)}
                />
                <input
                  className={input}
                  placeholder="email@university.edu"
                  value={c.email}
                  onChange={(e) => editContact(c.id, "email", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeContact(c.id)}
                  className="text-foreground-muted hover:text-rose-600"
                  aria-label="Remove contact"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addContact}
            className="ros-btn-neutral mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-meta font-medium"
          >
            <Icon name="plus" className="h-3.5 w-3.5" /> Add contact
          </button>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-meta font-semibold text-foreground-muted">
            Email subject template
          </label>
          <input
            className={input}
            value={draft.subjectTemplate}
            onChange={(e) =>
              setDraft((d) => ({ ...d, subjectTemplate: e.target.value }))
            }
          />
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-meta font-semibold text-foreground-muted">
            Email body template
          </label>
          <textarea
            rows={6}
            className={input}
            value={draft.bodyTemplate}
            onChange={(e) =>
              setDraft((d) => ({ ...d, bodyTemplate: e.target.value }))
            }
          />
        </div>
        <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
          Placeholders filled in when you draft: {"{item}"} {"{grant}"}{" "}
          {"{vendor}"} {"{total}"} {"{me}"}. The draft opens in your own mail app
          so it sends from your real address. Attach the PDF (open it from the
          purchase) before sending, since a drafted email cannot carry the file
          for you.
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="ros-btn-raise rounded-lg bg-brand-action px-3 py-1.5 text-body font-medium text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save routing settings"}
        </button>
        {saved && (
          <span className="text-meta text-emerald-600 dark:text-emerald-400">
            Saved
          </span>
        )}
      </div>
    </SectionShell>
  );
}

/**
 * Lab membership agreement, PI side (LAB_ARCHIVE_CONTINUITY.md). The lab head
 * drafts the data-ownership acknowledgment a member accepts at join, and bumps
 * its version when the text changes materially (so an acceptance records which
 * version was agreed to). This is the PI-side spine only; the member-side
 * recorded acceptance + the join gating are a later slice, so the card is honest
 * that nothing is enforced at join yet. Lab-head only. Framing is
 * institutional-data / PI-as-custodian and explicitly NOT legal advice.
 */
function LabAgreementSection({ settings, update }: SectionProps) {
  const [draft, setDraft] = useState<LabMembershipAgreement>(
    () => settings.labMembershipAgreement ?? DEFAULT_LAB_MEMBERSHIP_AGREEMENT,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    // Bump the version when the text changed materially, so a later acceptance
    // can record exactly which wording the member agreed to.
    const prev = settings.labMembershipAgreement ?? DEFAULT_LAB_MEMBERSHIP_AGREEMENT;
    const textChanged = draft.text.trim() !== prev.text.trim();
    const next: LabMembershipAgreement = {
      enabled: draft.enabled,
      text: draft.text,
      version: textChanged ? prev.version + 1 : prev.version,
    };
    await update({ labMembershipAgreement: next });
    setDraft(next);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const input =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-body";

  return (
    <SectionShell
      title="Membership agreement"
      description="Optional. The data-ownership acknowledgment new members accept when they join your lab. Editing the text bumps its version. Recording acceptances at join is coming next, this is where you draft and version the text."
      searchKeywords="membership agreement consent join data ownership institutional retention NIH IP policy custodian"
    >
      <label className="flex items-center gap-2 text-body text-foreground">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) =>
            setDraft((d) => ({ ...d, enabled: e.target.checked }))
          }
        />
        Present this agreement to new members
      </label>

      <div className={draft.enabled ? "mt-3" : "mt-3 pointer-events-none opacity-50"}>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-meta font-semibold text-foreground-muted">
            Agreement text
          </label>
          <span className="text-meta text-foreground-muted">
            Version {draft.version}
          </span>
        </div>
        <textarea
          rows={10}
          className={input}
          value={draft.text}
          onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
        />
        <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
          Frame data as institutional research data with the lab head as
          custodian, not as the PI&apos;s personal property. This is a lab
          agreement, not legal advice, so check it against your institution&apos;s
          own data and IP policy. Nothing is enforced at join yet.
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="ros-btn-raise rounded-lg bg-brand-action px-3 py-1.5 text-body font-medium text-white hover:bg-brand-action/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save agreement"}
        </button>
        {saved && (
          <span className="text-meta text-emerald-600 dark:text-emerald-400">
            Saved
          </span>
        )}
      </div>
    </SectionShell>
  );
}

/**
 * Retention registry (LAB_ARCHIVE_CONTINUITY.md phase 1a). The PI's compliance
 * dashboard: one row per retained unit recording where a member's data lives
 * (R2 / hard drive / institutional drive), for how long, and when it becomes
 * eligible for disposition. Phase 1a moves no bytes, the PI records entries by
 * hand; the export that fills the manifest comes in phase 2. Lab-head only.
 */
function RetentionRegistrySection({ currentUser }: { currentUser: string }) {
  const queryClient = useQueryClient();
  const { data: entries = [] } = useQuery({
    queryKey: ["lab-retention"],
    queryFn: () => retentionApi.list(),
  });

  const EMPTY = {
    member: "",
    unit: "All data",
    target: "r2" as RetentionTarget,
    location: "",
    retention_years: String(DEFAULT_RETENTION_YEARS),
    note: "",
  };
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["lab-retention"] });

  const add = async () => {
    if (!form.member.trim()) return;
    setBusy(true);
    try {
      const years = parseInt(form.retention_years, 10);
      await retentionApi.create({
        member: form.member.trim(),
        unit: form.unit.trim() || "All data",
        target: form.target,
        location: form.location.trim() || retentionTargetLabel(form.target),
        archived_at: new Date().toISOString(),
        archived_by: currentUser,
        retention_years: Number.isFinite(years) ? years : DEFAULT_RETENTION_YEARS,
        manifest_sha256: null,
        note: form.note.trim() || null,
      });
      await invalidate();
      setForm({ ...EMPTY });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await retentionApi.delete(id);
    await invalidate();
  };

  // Compute the SHA-256 manifest of the member's folder and store the combined
  // hash on the entry, the integrity anchor an auditor (or a later re-verify)
  // checks against. FSA-heavy (reads every file), so it runs on demand per row.
  const [manifestBusyId, setManifestBusyId] = useState<number | null>(null);
  const computeManifest = async (id: number, member: string) => {
    setManifestBusyId(id);
    try {
      const manifest = await computeFolderManifest(`users/${member}`);
      await retentionApi.update(id, { manifest_sha256: manifest.combined });
      await invalidate();
    } catch {
      alert("Could not read the member's folder to compute the manifest.");
    } finally {
      setManifestBusyId(null);
    }
  };

  const input = "rounded-lg border border-border bg-surface px-2 py-1.5 text-meta";

  return (
    <SectionShell
      title="Data retention"
      description="Record where each member's lab data is retained for NIH and institutional compliance, wherever the bytes live. ResearchOS tracks the retention, it does not have to hold the data."
      searchKeywords="retention archive NIH compliance grant data member hard drive institutional disposition audit"
    >
      {entries.length === 0 ? (
        <p className="text-meta text-foreground-muted">
          No retention records yet. Add one below as members finish or leave.
        </p>
      ) : (
        <table className="w-full text-left text-meta">
          <thead>
            <tr className="border-b border-border text-foreground-muted">
              <th className="px-2 py-2 font-semibold">Member</th>
              <th className="px-2 py-2 font-semibold">Unit</th>
              <th className="px-2 py-2 font-semibold">Retained at</th>
              <th className="px-2 py-2 font-semibold">Recorded</th>
              <th className="px-2 py-2 font-semibold">Keep until</th>
              <th className="px-2 py-2 font-semibold">Manifest</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0">
                <td className="px-2 py-2 text-foreground">{e.member}</td>
                <td className="px-2 py-2 text-foreground-muted">{e.unit}</td>
                <td className="px-2 py-2 text-foreground-muted">
                  {retentionTargetLabel(e.target)}
                  {e.location && !targetHoldsBytes(e.target) ? ` — ${e.location}` : ""}
                </td>
                <td className="px-2 py-2 text-foreground-muted">
                  {e.archived_at.slice(0, 10)}
                </td>
                <td className="px-2 py-2 text-foreground-muted">
                  {disposalEligibleDate(e.archived_at, e.retention_years)}
                </td>
                <td className="px-2 py-2 text-foreground-muted">
                  {manifestBusyId === e.id ? (
                    <span>Hashing...</span>
                  ) : e.manifest_sha256 ? (
                    <span
                      className="font-mono"
                      title={`SHA-256 ${e.manifest_sha256}`}
                    >
                      {e.manifest_sha256.slice(0, 8)}
                      <button
                        type="button"
                        onClick={() => computeManifest(e.id, e.member)}
                        className="ml-2 text-blue-600 hover:underline dark:text-blue-400"
                      >
                        re-verify
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => computeManifest(e.id, e.member)}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Compute
                    </button>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => remove(e.id)}
                    className="text-meta text-foreground-muted hover:text-rose-600"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <input
          className={input}
          placeholder="Member"
          value={form.member}
          onChange={(e) => setForm((f) => ({ ...f, member: e.target.value }))}
        />
        <input
          className={input}
          placeholder="Unit (e.g. All data)"
          value={form.unit}
          onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
        />
        <select
          className={input}
          value={form.target}
          onChange={(e) =>
            setForm((f) => ({ ...f, target: e.target.value as RetentionTarget }))
          }
        >
          {RETENTION_TARGETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          className={input}
          placeholder={targetHoldsBytes(form.target) ? "ResearchOS R2" : "Location / drive"}
          value={form.location}
          onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
        />
        <input
          className={input}
          type="number"
          min={0}
          placeholder="Keep (years)"
          value={form.retention_years}
          onChange={(e) =>
            setForm((f) => ({ ...f, retention_years: e.target.value }))
          }
        />
        <input
          className={input}
          placeholder="Note (custodian, box...)"
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        />
      </div>
      <button
        type="button"
        onClick={add}
        disabled={busy || !form.member.trim()}
        className="ros-btn-raise mt-3 rounded-lg bg-brand-action px-3 py-1.5 text-body font-medium text-white hover:bg-brand-action/90 disabled:opacity-50"
      >
        {busy ? "Recording..." : "Record retention"}
      </button>
    </SectionShell>
  );
}

function TabsSection({ settings, update }: SectionProps) {
  const visible = useMemo(() => new Set(settings.visibleTabs), [settings.visibleTabs]);
  const reachableLandingTabs = NAV_ITEMS.filter(
    (item) => item.href === HOME_HREF || visible.has(item.href),
  );

  const toggle = (href: string) => {
    if (href === HOME_HREF) return; // Home is non-toggleable
    const next = new Set(visible);
    if (next.has(href)) next.delete(href);
    else next.add(href);
    void update({ visibleTabs: Array.from(next) });
  };

  // Search keywords: every nav-item label flows through here so a query
  // like "Calendar" or "Methods" surfaces the Tabs section even though
  // the section's own title is just "Tabs".
  const navKeywords = NAV_ITEMS.map((i) => i.label).join(" ");
  return (
    <SectionShell
      title="Tabs"
      tourTarget="settings-tabs-section"
      description="Pick which tabs show up in the header. Home is always shown so you have a guaranteed landing spot. Settings (this page) is always reachable via the gear icon."
      searchKeywords={`${navKeywords} default landing tab`}
    >
      <div className="grid grid-cols-2 gap-2">
        {NAV_ITEMS.map((item) => {
          const isHome = item.href === HOME_HREF;
          const checked = isHome || visible.has(item.href);
          return (
            <label
              key={item.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                isHome ? "bg-surface-sunken border-border text-foreground-muted" : "bg-surface-raised border-border hover:bg-surface-sunken cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={isHome}
                onChange={() => toggle(item.href)}
                className="accent-blue-600"
              />
              <span className="text-body text-foreground">{item.label}</span>
              {isHome && <span className="text-meta text-foreground-muted ml-auto">always on</span>}
            </label>
          );
        })}
      </div>

      <div>
        <label className="block text-meta font-medium text-foreground mb-1">
          Default landing tab
        </label>
        <select
          value={settings.defaultLandingTab}
          onChange={(e) => void update({ defaultLandingTab: e.target.value })}
          className="w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {reachableLandingTabs.map((item) => (
            <option key={item.href} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
        <p className="text-meta text-foreground-muted mt-1">
          Where ResearchOS opens to when you load the app.
        </p>
      </div>
    </SectionShell>
  );
}

function SidebarSection({ settings, update }: SectionProps) {
  const bothOff = !settings.sidebarShowTasks && !settings.sidebarShowCalendarEvents;
  return (
    <SectionShell
      title="Sidebar"
      description="The left sidebar shown on every page except Calendar (which has its own). Pick what to show, tasks for today, today's calendar events, or both stacked."
      searchKeywords="tasks calendar events horizon next days today overdue upcoming"
    >
      <div className="space-y-2">
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-surface-sunken cursor-pointer">
          <input
            type="checkbox"
            checked={settings.sidebarShowTasks}
            onChange={(e) => void update({ sidebarShowTasks: e.target.checked })}
            className="accent-blue-600"
          />
          <span className="text-body text-foreground">Tasks</span>
          <span className="ml-auto text-meta text-foreground-muted">
            today + overdue + upcoming
          </span>
        </label>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-surface-sunken cursor-pointer">
          <input
            type="checkbox"
            checked={settings.sidebarShowCalendarEvents}
            onChange={(e) =>
              void update({ sidebarShowCalendarEvents: e.target.checked })
            }
            className="accent-blue-600"
          />
          <span className="text-body text-foreground">Calendar events</span>
          <span className="ml-auto text-meta text-foreground-muted">
            today and beyond
          </span>
        </label>
      </div>

      <div
        className={settings.sidebarShowCalendarEvents ? "" : "opacity-50 pointer-events-none"}
      >
        <label className="block text-meta font-medium text-foreground mb-1">
          How much calendar to show
        </label>
        <select
          value={settings.sidebarEventsHorizonDays}
          onChange={(e) =>
            void update({ sidebarEventsHorizonDays: parseInt(e.target.value, 10) })
          }
          disabled={!settings.sidebarShowCalendarEvents}
          className="w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-surface-sunken"
        >
          {SIDEBAR_HORIZON_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <p className="text-meta text-foreground-muted mt-1">
          Controls the &ldquo;Next N days&rdquo; section under Today&apos;s Events.
        </p>
      </div>

      {bothOff && (
        <p className="text-meta text-amber-600 dark:text-amber-300 mt-1">
          Both off — the sidebar will be empty on non-calendar pages.
        </p>
      )}
    </SectionShell>
  );
}

function DefaultsSection({ settings, update }: SectionProps) {
  return (
    <SectionShell
      title="View defaults"
      description="Initial values for the GANTT range and Calendar view. In-app changes still let you flip between them for the current session."
      searchKeywords="GANTT calendar week month year date format time format MDY DMY YMD 12-hour 24-hour shared"
    >
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label="GANTT default range"
          value={settings.defaultGanttViewMode}
          options={GANTT_VIEW_OPTIONS}
          onChange={(v) => void update({ defaultGanttViewMode: v })}
        />
        <SelectField
          label="Calendar default view"
          value={settings.defaultCalendarViewMode}
          options={CALENDAR_VIEW_OPTIONS}
          onChange={(v) => void update({ defaultCalendarViewMode: v })}
        />
        <SelectField
          label="Date format"
          value={settings.dateFormat}
          options={DATE_FORMAT_OPTIONS}
          onChange={(v) => void update({ dateFormat: v })}
        />
        <SelectField
          label="Time format"
          value={settings.timeFormat}
          options={TIME_FORMAT_OPTIONS}
          onChange={(v) => void update({ timeFormat: v })}
        />
      </div>
      <ToggleRow
        label="Show shared content by default"
        description="When on, GANTT and other views include tasks shared with you (not just your own)."
        checked={settings.showSharedByDefault}
        onChange={(v) => void update({ showSharedByDefault: v })}
      />
    </SectionShell>
  );
}

// State for the live preview overlay that fires when the user picks an
// animation tile. The `nonce` is bumped on every click and used as the
// DynamicAnimation `key`, so clicking a new tile mid-animation forces
// React to unmount the in-flight preview (clearing its timers + particle
// state via the animation component's useEffect cleanup) and mount the
// new one fresh. This is the halt-and-restart pattern from the retired
// AnimationSettingsPopup (see commit 9d1c01ad).
interface AnimationPreviewState {
  type: AnimationType;
  x: number;
  y: number;
  nonce: number;
}

/** Inline glyph for the "None / off" animation tile. A circle with a
 *  slash (the universal "disabled" mark). Inline SVG to match the
 *  project's no-emoji icon idiom. */
function NoAnimationIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    </svg>
  );
}

// Professional mode lives in its own section near the top of Settings (moved
// out of the Animation section 2026-06-03). One master switch that quiets the
// playful surfaces at once: the streak badge, the per-task animation, and
// BeakerBot. Flipping ON sets all three off; flipping OFF does nothing
// automatic (the user re-enables each surface individually). The streak sidecar
// lives outside UserSettings, so it is patched separately via the streak lib.
function ProfessionalModeSection({ settings, update }: SectionProps) {
  const { currentUser } = useFileSystem();
  const handleProfessionalMode = (on: boolean) => {
    if (on) {
      void update({
        professionalMode: true,
        animationType: "none",
        beakerBotAnimations: false,
      });
      if (currentUser) {
        void patchStreak(currentUser, (cur) => ({ ...cur, enabled: false }));
      }
    } else {
      void update({ professionalMode: false });
    }
  };
  return (
    <SectionShell
      id="professional-mode"
      title="Professional mode"
      description="A focused, minimal workspace with the playful touches turned off."
      searchKeywords="professional mode quiet focus minimal animation beakerbot streak badge celebration playful"
    >
      <ToggleRow
        label="Quiet the streak badge, animations, and BeakerBot"
        description="Turns all three off at once. Turning professional mode back off lets you re-enable each one individually."
        checked={settings.professionalMode}
        onChange={handleProfessionalMode}
      />
    </SectionShell>
  );
}

// Appearance / theme picker. Theme is a per-device display preference (stored
// in localStorage via useTheme, not the folder), so this section takes no
// settings/update; it reads + writes the live theme directly. "System" follows
// the OS. Styled with literal light colors to match its sibling sections, the
// Settings page is not token-converted yet (see docs/proposals/
// dark-mode-toggle.md); convert this with the rest of the page later.
function AppearanceSection() {
  const { choice, setTheme } = useTheme();
  const options: {
    value: ThemeChoice;
    label: string;
    description: string;
    icon: React.ReactNode;
  }[] = [
    {
      value: "light",
      label: "Light",
      description: "The classic bright look.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ),
    },
    {
      value: "dark",
      label: "Dark",
      description: "Easier on the eyes at night.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      ),
    },
    {
      value: "system",
      label: "System",
      description: "Match your device setting.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      ),
    },
  ];
  return (
    <SectionShell
      id="appearance"
      title="Appearance"
      description="Choose a light or dark theme, or follow your device. The welcome page always stays light."
      searchKeywords="theme dark mode light night appearance color scheme"
    >
      <div className="grid grid-cols-3 gap-2">
        {options.map((opt) => {
          const selected = choice === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              aria-pressed={selected}
              data-theme-choice={opt.value}
              className={`flex flex-col items-start gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
                selected
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-500/15"
                  : "border-border hover:border-border hover:bg-surface-sunken"
              }`}
            >
              <span className={selected ? "text-blue-600 dark:text-blue-300" : "text-foreground-muted"}>
                {opt.icon}
              </span>
              <div className="min-w-0">
                <p className={`text-body font-medium ${selected ? "text-blue-700 dark:text-blue-300" : "text-foreground"}`}>
                  {opt.label}
                </p>
                <p className="text-meta text-foreground-muted">{opt.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </SectionShell>
  );
}

function AnimationSection({ settings, update }: SectionProps) {
  // Real animations only (ANIMATION_METADATA excludes the "none" opt-out,
  // which gets its own dedicated tile below).
  const types = Object.keys(ANIMATION_METADATA) as RealAnimationType[];

  // Concatenate every animation's name + description into the section's
  // search-keyword blob. Lets a query like "confetti" or "explosion"
  // surface the Animation section even though the section title is
  // just "Animation".
  const animationKeywords = types
    .flatMap((t) => [
      ANIMATION_METADATA[t].name,
      ANIMATION_METADATA[t].description,
    ])
    .join(" ");
  const [preview, setPreview] = useState<AnimationPreviewState | null>(null);
  const handlePick = (
    type: AnimationType,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    // Persist the user's selection (fire-and-forget; the optimistic
    // update inside `update` keeps the UI snappy).
    void update({ animationType: type });
    // Fire the preview overlay at the clicked tile's center. The nonce
    // forces a remount on each click so a rapid second click halts the
    // in-flight preview and starts the new one immediately. No lockout,
    // no queueing.
    const rect = event.currentTarget.getBoundingClientRect();
    setPreview({
      type,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      nonce: Date.now(),
    });
  };
  return (
    <SectionShell
      id="animation"
      tourTarget="settings-animation-picker"
      title="Animation"
      description="Plays when you complete a task. Pick the one that suits your vibe."
      searchKeywords={animationKeywords}
    >
      <div className="grid grid-cols-2 gap-2">
        {types.map((type) => {
          const meta = ANIMATION_METADATA[type];
          const selected = settings.animationType === type;
          return (
            <button
              key={type}
              type="button"
              data-animation-theme={type}
              onClick={(e) => handlePick(type, e)}
              className={`flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
                selected ? "border-purple-400 bg-purple-50 dark:bg-purple-500/15" : "border-border hover:border-border hover:bg-surface-sunken"
              }`}
            >
              {renderAnimationIcon(meta.icon, meta.color, "text-heading", "w-7 h-7")}
              <div className="min-w-0 flex-1">
                <p className={`text-body font-medium ${selected ? "text-purple-700 dark:text-purple-300" : "text-foreground"}`}>
                  {meta.name}
                </p>
                <p className="text-meta text-foreground-muted truncate">{meta.description}</p>
              </div>
            </button>
          );
        })}
        {/* "None / off" tile: fully disables the per-task celebration. It
            has no ANIMATION_METADATA entry (it is not a real animation), so
            it is rendered as a dedicated tile rather than via the map above.
            Picking it persists animationType "none"; DynamicAnimation then
            renders nothing on task completion. */}
        <button
          key="none"
          type="button"
          data-animation-theme="none"
          onClick={() => void update({ animationType: "none" })}
          className={`flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
            settings.animationType === "none"
              ? "border-purple-400 bg-purple-50 dark:bg-purple-500/15"
              : "border-border hover:border-border hover:bg-surface-sunken"
          }`}
        >
          <span
            className="inline-flex items-center justify-center text-foreground-muted"
            aria-hidden="true"
          >
            <NoAnimationIcon className="w-7 h-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={`text-body font-medium ${
                settings.animationType === "none" ? "text-purple-700 dark:text-purple-300" : "text-foreground"
              }`}
            >
              None / off
            </p>
            <p className="text-meta text-foreground-muted truncate">No animation on task completion</p>
          </div>
        </button>
      </div>
      {/* Preview overlay. The `key={preview.nonce}` swap on each click
       *  forces React to unmount the previous DynamicAnimation (running
       *  its useEffect cleanup, which clears the underlying interval +
       *  timeout) and mount the new one, so the user can rapidly flip
       *  between tiles to compare. The old animation's onComplete fires
       *  during cleanup but the `setPreview(null)` it queues is harmless,
       *  React batches it after the new preview state already replaced
       *  null. */}
      {preview && (
        <DynamicAnimation
          key={preview.nonce}
          type={preview.type}
          x={preview.x}
          y={preview.y}
          onComplete={() => setPreview(null)}
        />
      )}
      {/* BeakerBot animations toggle (beakerbot-joy manager). Distinct
          from the task-completion picker above: this controls the BeakerBot
          streak-celebration scenes. The per-task picker (and its "none"
          option) stays its own control. */}
      <div className="mt-4 pt-4 border-t border-border">
        <ToggleRow
          label="BeakerBot animations"
          description="BeakerBot's streak and milestone celebrations. Turn off for a quieter experience."
          checked={settings.beakerBotAnimations}
          onChange={(v) => void update({ beakerBotAnimations: v })}
        />
      </div>
    </SectionShell>
  );
}

function BehaviorSection({ settings, update }: SectionProps) {
  return (
    <SectionShell
      id="behavior"
      title="Behavior"
      description="Safety prompts for destructive actions and editor helpers."
      searchKeywords="destructive confirm prompts safety behavior spell check spelling dictionary editor"
    >
      <ToggleRow
        label="Confirm destructive actions"
        description='Show "Are you sure?" prompts before deleting tasks, projects, etc.'
        checked={settings.confirmDestructiveActions}
        onChange={(v) => void update({ confirmDestructiveActions: v })}
      />
      <ToggleRow
        label="Spell-check in the editor"
        description="Underline likely misspellings while you write notes, with click-to-fix suggestions. The dictionary already knows common lab terms, and you can add your own words. Off by default, bench shorthand can read as misspelled."
        checked={settings.spellCheckInEditor ?? false}
        onChange={(v) => {
          // Mirror to localStorage first so the editor reads the new value on
          // its next mount, then persist to settings.json.
          setSpellCheckEnabledLocal(v);
          void update({ spellCheckInEditor: v });
        }}
      />
      {/* Lab Mode retirement R1b (R1b sharing completion manager, 2026-05-23):
          the global "Hide my goals from lab view" toggle is removed.
          Goal visibility is now PER-GOAL via the unified ShareDialog
          (each HighLevelGoal has its own `shared_with` list). The
          `hide_goals_from_lab` user-metadata field is kept on the type
          for one release (R1 migration honored it once on first login),
          but the UI control no longer exists. */}
    </SectionShell>
  );
}

// ── Data inventory ──────────────────────────────────────────────────────────
//
// Read-only verification surface for the wiki's "data stays on your computer"
// claim. Lists every file the app has written under the user's folder + every
// IndexedDB key the app keeps in the browser. No actions besides Refresh.
// Closes the security audit role brief's affordance #1.

const IDB_KEYS: { key: string; meaning: string }[] = [
  {
    key: "research-os-fsa / handles / research-os-directory-handle",
    meaning:
      "Opaque FSA directory handle (the proof your browser has permission to read/write this folder). Does NOT contain the path string.",
  },
  {
    key: "keyval-store / keyval / research-os-directory-handle-meta",
    meaning: "Folder name + grant timestamp.",
  },
  {
    key: "keyval-store / keyval / research-os-current-user",
    meaning: "Username string of the currently signed-in user.",
  },
  {
    key: "keyval-store / keyval / research-os-main-user",
    meaning:
      "Username string of the Lab Mode primary account, when Lab Mode is in use.",
  },
];

async function scanFolderFiles(): Promise<string[]> {
  const collected: string[] = [];
  const walk = async (dirPath: string): Promise<void> => {
    const subFiles = await fileService.listFiles(dirPath);
    for (const f of subFiles) {
      collected.push(dirPath ? `${dirPath}/${f}` : f);
    }
    const subDirs = await fileService.listDirectories(dirPath);
    for (const d of subDirs) {
      await walk(dirPath ? `${dirPath}/${d}` : d);
    }
  };
  await walk("");
  collected.sort();
  return collected;
}

function DataInventorySection() {
  const { directoryName, currentUser } = useFileSystem();
  const [scanning, setScanning] = useState(false);
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const collected = await scanFolderFiles();
      setFiles(collected);
    } catch (err) {
      console.error("[Data inventory] scan failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Scan failed. See console for details.",
      );
    } finally {
      setScanning(false);
    }
  }, []);

  // Run once on mount. The user can Refresh manually after that.
  useEffect(() => {
    void runScan();
  }, [runScan]);

  // Group by top-level path segment ("(root)" for files at folder root).
  const grouped = useMemo(() => {
    if (!files) return null;
    const map = new Map<string, string[]>();
    for (const path of files) {
      const slash = path.indexOf("/");
      const group = slash === -1 ? "(root)" : `${path.slice(0, slash)}/`;
      const arr = map.get(group) ?? [];
      arr.push(path);
      map.set(group, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "(root)") return -1;
      if (b === "(root)") return 1;
      return a.localeCompare(b);
    });
  }, [files]);

  const fileCount = files?.length ?? 0;
  const dirCount = grouped?.length ?? 0;

  return (
    <SectionShell
      title="Data inventory"
      description="Every file path the app has written to your folder, plus every IndexedDB key in your browser. Read-only — proves nothing is leaving your computer."
      searchKeywords="files disk IndexedDB IDB cache external calls api network privacy"
    >
      <div>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-foreground">Files on disk</p>
            {scanning && !files ? (
              <p className="text-meta text-foreground-muted mt-1">Scanning your folder…</p>
            ) : files ? (
              <p className="text-meta text-foreground-muted mt-1">
                <strong>{fileCount}</strong> file{fileCount === 1 ? "" : "s"}{" "}
                across <strong>{dirCount}</strong>{" "}
                {dirCount === 1 ? "group" : "groups"}. All paths are under your
                selected folder.
              </p>
            ) : null}
            {error && <p className="text-meta text-red-600 dark:text-red-300 mt-2">{error}</p>}
          </div>
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={scanning}
            className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg whitespace-nowrap"
          >
            {scanning ? "Scanning…" : "Refresh"}
          </button>
        </div>
        {grouped && grouped.length > 0 && (
          <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 max-h-96 overflow-y-auto space-y-3">
            {grouped.map(([group, paths]) => (
              <div key={group}>
                <p className="text-meta font-semibold text-foreground uppercase tracking-wide">
                  {group}{" "}
                  <span className="text-foreground-muted font-normal normal-case">
                    ({paths.length})
                  </span>
                </p>
                <ul className="mt-1 space-y-0.5">
                  {paths.map((p) => (
                    <li key={p}>
                      <code className="text-meta text-foreground font-mono break-all">
                        {p}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {grouped && grouped.length === 0 && !scanning && (
          <p className="text-meta text-foreground-muted">No files found in your folder.</p>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-body font-medium text-foreground">Browser IndexedDB keys</p>
        <p className="text-meta text-foreground-muted mt-1 mb-2">
          Four known keys, listed below. Open DevTools → Application → IndexedDB
          to verify.
        </p>
        <ul className="space-y-2">
          {IDB_KEYS.map((k) => (
            <li
              key={k.key}
              className="rounded-md border border-border bg-surface-sunken px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <code className="text-meta text-foreground font-mono break-all">
                    {k.key}
                  </code>
                  <p className="text-meta text-foreground-muted mt-1">{k.meaning}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-body font-medium text-foreground">External calls</p>
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          When using ResearchOS, your browser makes outbound calls to: (a){" "}
          <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta">
            /api/calendar-feed
          </code>{" "}
          on this app&apos;s origin, which fetches ICS calendars on your behalf
          with the subscription URL in the{" "}
          <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta">
            x-calendar-url
          </code>{" "}
          request header; (b){" "}
          <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta">
            va.vercel-scripts.com
          </code>{" "}
          +{" "}
          <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta">
            vitals.vercel-insights.com
          </code>{" "}
          for anonymous page-view pings via Vercel Web Analytics and
          anonymous Core Web Vitals via Vercel Speed Insights; and (c){" "}
          <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta">
            research-os-xi.vercel.app
          </code>{" "}
          only if you click{" "}
          <strong>Pull latest from research-os-xi.vercel.app</strong> in the AI
          Helper section above (a user-initiated, on-demand fetch of the newest
          AI Helper prompt when the bundled copy is stale). Toggle
          &quot;Offline mode&quot; below to disable destinations (a) and (b)
          durably.
        </p>
      </div>
    </SectionShell>
  );
}

// VCP R1 trash MVP notes (2026-05-26): the "History & Trash" section
// surfaces the cleanup-window radio (OQ1 default: 30 days) and a link
// to /trash. OQ7 reserves a slot for the orphaned-files cleanup tool;
// we render placeholder copy noting it ships in R2.
function TrashAndHistorySection({ settings, update }: SectionProps) {
  const cleanupDays = getUserTrashCleanupDays(
    settings as UserSettings & UserSettingsWithTrash,
  );
  const handleChange = async (value: number | null) => {
    // Cast: the field isn't in the base UserSettings interface yet
    // (R1 keeps it on the parallel UserSettingsWithTrash shape so the
    // trash module stays decoupled). `patchUserSettings.normalize`
    // preserves unknown keys, so the cast lands cleanly on disk.
    await update({
      trash_cleanup_days: value,
    } as unknown as Partial<UserSettings>);
  };
  return (
    <SectionShell
      id="history-and-trash"
      title="History & Trash"
      description="Deleted records sit in the trash for a configurable window before being permanently removed. Restore from /trash."
      searchKeywords="trash delete soft-delete restore cleanup window history version control"
    >
      <SearchableRow
        id="trash-cleanup-window"
        label="Cleanup window"
        desc="How long deleted records stay recoverable before they are permanently removed."
      >
        <div className="space-y-2">
          <p className="text-meta text-foreground-muted">
            How long deleted records stay recoverable before they are
            permanently removed.
          </p>
          <fieldset className="space-y-1">
            <legend className="sr-only">Cleanup window</legend>
            {TRASH_CLEANUP_OPTIONS.map((opt) => {
              const id = `trash-cleanup-${opt.value === null ? "never" : opt.value}`;
              const checked = cleanupDays === opt.value;
              return (
                <label
                  key={id}
                  htmlFor={id}
                  className="flex items-center gap-2 text-body text-foreground cursor-pointer"
                >
                  <input
                    id={id}
                    type="radio"
                    name="trash-cleanup-window"
                    checked={checked}
                    onChange={() => void handleChange(opt.value)}
                    className="text-blue-600 dark:text-blue-300 focus:ring-blue-500"
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </fieldset>
        </div>
      </SearchableRow>
      <SearchableRow
        id="trash-manage"
        label="Manage trash"
        desc="Open the /trash page to restore or permanently delete records."
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-meta text-foreground-muted flex-1">
            Open the trash page to restore records back to their original
            location, or permanently delete them ahead of the cleanup window.
          </p>
          <Link
            href="/trash"
            className="px-3 py-1.5 text-body rounded-md border border-border bg-surface-raised hover:bg-surface-sunken"
          >
            Open trash
          </Link>
        </div>
      </SearchableRow>
      <SearchableRow
        id="trash-orphaned-files"
        label="Orphaned files"
        desc="Find image attachments that no live record references. Coming in R2."
      >
        <p className="text-meta text-foreground-muted">
          Image attachments referenced only by deleted records currently stay
          on disk. A &ldquo;View orphaned files&rdquo; tool that scans for
          unreferenced attachments and offers cleanup ships in R2.
        </p>
      </SearchableRow>
    </SectionShell>
  );
}

function MaintenanceSection() {
  const [importOpen, setImportOpen] = useState(false);
  const [soloOpen, setSoloOpen] = useState(false);
  const { currentUser } = useFileSystem();
  const isLabMode = useIsLabMode() ?? false;

  return (
    <SectionShell
      title="Data maintenance"
      description="Tools for normalising on-disk task and method data. Safe to run any time; reports what it changed."
      searchKeywords="repair method links source paths split lab notes results attachments stamp formats reconcile cross-owner project sharing import experiment zip LabArchives orphan credentials convert single user solo separate accounts migrate"
    >
      <ImportRow onOpen={() => setImportOpen(true)} />
      {importOpen && (
        <ImportExperimentDialog
          isOpen={importOpen}
          onClose={() => setImportOpen(false)}
        />
      )}
      <MigrationStatusRow />
      {isLabMode && currentUser && (
        <>
          <ConvertToSoloRow onOpen={() => setSoloOpen(true)} />
          {soloOpen && (
            <MigrateToSoloModal onClose={() => setSoloOpen(false)} primaryUser={currentUser} />
          )}
        </>
      )}
    </SectionShell>
  );
}

function ConvertToSoloRow({ onOpen }: { onOpen: () => void }) {
  return (
    <SearchableRow
      id="convert:single-user"
      label="Convert this folder to single-user"
      desc="Turn a shared multi-user folder into your own single-user folder. Everyone else is packaged into a portable copy you can hand them, their data moves to a recoverable Trash, and the lab overhead goes away. Your own data is untouched."
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-body text-foreground">
            <HighlightedText text="Convert this folder to single-user" />
          </p>
          <p className="text-meta text-foreground-muted mt-1">
            Turn a shared multi-user folder into your own single-user folder. Everyone else is packaged into a
            portable copy you can hand them, their originals move to a recoverable Trash, and the multi-user overhead
            goes away. Your own data is untouched, and you preview exactly what moves before anything happens.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
        >
          Convert...
        </button>
      </div>
    </SearchableRow>
  );
}

function ImportRow({ onOpen }: { onOpen: () => void }) {
  return (
    <SearchableRow
      id="import:experiment"
      label="Import experiment"
      desc="Bring an experiment exported by another ResearchOS user (a -raw.zip bundle) into your workspace. You'll get a chance to match its project and methods against your own before anything is written."
    >
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-body text-foreground">
          <HighlightedText text="Import experiment" />
        </p>
        <p className="text-meta text-foreground-muted mt-1">
          Bring an experiment exported by another ResearchOS user (a <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta">-raw.zip</code> bundle) into your workspace.
          You&apos;ll get a chance to match its project and methods against your own before anything is written.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
      >
        Import .zip
      </button>
    </div>
    </SearchableRow>
  );
}

// ── LabArchives section ─────────────────────────────────────────────────────
//
// 2026-05-14: the institutional API setup feature was removed; the only
// remaining LabArchives surface is the offline-ZIP import wizard. Connect
// card + deployer-creds setup card both gone. See AGENTS.md §8
// "LabArchives institutional API removal" for context.

function LabArchivesSection() {
  const [elnImportOpen, setElnImportOpen] = useState(false);

  return (
    <SectionShell
      title="LabArchives"
      description="Bulk-import offline LabArchives notebooks into ResearchOS. Each notebook page becomes a task; folders become projects you can map onto your existing list."
      searchKeywords="ELN notebook import zip offline notebook pages projects fetch images"
    >
      <LabArchivesOptionCard
        title="Import from LabArchives"
        whatItDoes={
          <>
            Bring a LabArchives <strong>Offline Notebook</strong> ZIP into
            ResearchOS. Each notebook page becomes a task; folders become
            projects you can map to your existing project list.
          </>
        }
        whyExplainer={
          <>
            LabArchives is read-only inside ResearchOS — there&apos;s no
            live two-way sync. The offline ZIP is the canonical hand-off
            from LabArchives to anywhere else, and this wizard is what
            turns that ZIP into native ResearchOS tasks. Inline images that
            LabArchives stores online (Form-B) are recovered via the
            wizard&apos;s &quot;Fetch images&quot; step (DevTools-script
            paste or folder drop) or the per-image popup in any imported
            note — no institutional API setup required.
          </>
        }
        helpHref="/wiki/integrations/labarchives"
        action={
          <button
            type="button"
            onClick={() => setElnImportOpen(true)}
            className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
          >
            Open import…
          </button>
        }
        footer={
          <Link
            href="/wiki/integrations/labarchives#exporting-from-labarchives"
            className="inline-flex items-center gap-1 text-meta text-blue-600 dark:text-blue-300 hover:text-blue-700 underline"
          >
            How to export from LabArchives →
          </Link>
        }
      />
      {elnImportOpen && (
        <ImportELNDialog
          isOpen={elnImportOpen}
          onClose={() => setElnImportOpen(false)}
        />
      )}
    </SectionShell>
  );
}

/** One option card inside the LabArchives section. Layout matches the rest
 *  of the Settings page: title, short description, "?" tooltip with the
 *  longer "why" explanation, action button, optional footer. */
function LabArchivesOptionCard({
  title,
  whatItDoes,
  whyExplainer,
  helpHref,
  action,
  footer,
}: {
  title: string;
  whatItDoes: React.ReactNode;
  whyExplainer: React.ReactNode;
  helpHref: string;
  action: React.ReactNode;
  footer: React.ReactNode;
}) {
  const [showExplainer, setShowExplainer] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-body font-medium text-foreground">{title}</p>
            <Tooltip label={showExplainer ? "Hide details" : "Why this exists"}>
              <button
                type="button"
                onClick={() => setShowExplainer((v) => !v)}
                aria-expanded={showExplainer}
                aria-label={`Explain ${title}`}
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-surface-sunken hover:bg-surface-sunken text-foreground-muted text-meta font-semibold leading-none"
              >
                ?
              </button>
            </Tooltip>
          </div>
          <p className="text-meta text-foreground-muted mt-1">{whatItDoes}</p>
          {showExplainer && (
            <div className="mt-2 text-meta text-foreground bg-surface-sunken border border-border rounded-md px-3 py-2 leading-relaxed">
              {whyExplainer}
              <div className="mt-1.5">
                <Link
                  href={helpHref}
                  className="text-blue-600 dark:text-blue-300 hover:underline"
                >
                  Read more in the wiki →
                </Link>
              </div>
            </div>
          )}
          {footer && <div className="mt-2">{footer}</div>}
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </div>
  );
}

// ── AI Helper section ───────────────────────────────────────────────────────
//
// Surfaces the schema-aware-chatbot prompt that lives at
// `frontend/public/ai-helper/{full,lean,minimal}.md`. Reads `manifest.json`
// on mount for freshness metadata, then lazy-fetches the selected size's
// markdown only when the user picks it (don't pull ~50 KB of prompt text
// for users who never open this section). Provides copy-to-clipboard +
// one-click "open in your provider" deep links to Claude / ChatGPT /
// Gemini / Copilot.
//
// Stale-prompt detection compares `manifest.built_from_commit` against
// `process.env.NEXT_PUBLIC_RESEARCHOS_COMMIT` (resolved at build time in
// `next.config.ts`). When the running app is newer than the served
// manifest, an amber callout offers a "Pull latest from
// research-os-xi.vercel.app" trapdoor that fetches the live deployed
// manifest + selected size variant cross-origin. Skipped entirely in
// demo / wiki-capture mode so the fixture stays deterministic and we
// don't make outbound network calls during screenshot captures.
//
// Per docs/proposals/done/AI_HELPER_PROPOSAL.md "Automation contract" items 5 + 6 + the
// chip 3 brief.

type AIHelperSize = "lean" | "full" | "minimal";

interface AIHelperManifestSize {
  bytes: number;
  tokens: number;
}

interface AIHelperManifest {
  helper_version: number;
  schema_hash: string;
  structural_fingerprint?: string;
  built_at: string;
  built_from_commit: string;
  sizes: Record<AIHelperSize, AIHelperManifestSize>;
}

const AI_HELPER_SIZE_OPTIONS: ReadonlyArray<{
  value: AIHelperSize;
  label: string;
  blurb: string;
}> = [
  {
    value: "lean",
    label: "Lean",
    // Token counts come from the live manifest (rendered alongside each option),
    // so the blurb stays descriptive only, no hardcoded figure to drift.
    blurb: "Fits most chat windows",
  },
  {
    value: "full",
    label: "Full (recommended)",
    blurb:
      "Best for drafting on big-context models like Claude Sonnet, GPT-5, Gemini 2.5 Pro",
  },
  {
    value: "minimal",
    label: "Minimal",
    blurb: "For tiny windows or local models",
  },
];

const AI_HELPER_PROVIDERS: ReadonlyArray<{
  key: "claude" | "chatgpt" | "gemini" | "copilot";
  label: string;
  url: string;
}> = [
  { key: "claude", label: "Claude", url: "https://claude.ai/new" },
  { key: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { key: "gemini", label: "Gemini", url: "https://gemini.google.com/app" },
  // Microsoft Copilot is free with many university / institutional M365
  // accounts (including UW-Madison), which makes it a no-cost option for
  // a lot of our users. Same open-and-paste flow as the others.
  { key: "copilot", label: "Copilot", url: "https://copilot.microsoft.com/" },
];

const AI_HELPER_LIVE_BASE = "https://research-os-xi.vercel.app";

/** Format a YYYY-MM-DD slice of the ISO timestamp for the footer. Avoids
 *  showing the time-of-day (which would just be "the moment Vercel built
 *  this commit" — not useful) and avoids locale-specific Date parsing
 *  that varies by client. */
function formatBuiltDate(iso: string): string {
  const slice = iso.slice(0, 10);
  return slice.length === 10 ? slice : iso;
}

/** Best-effort clipboard write that falls back to a hidden textarea +
 *  `document.execCommand("copy")` when `navigator.clipboard` isn't
 *  available (Safari without HTTPS, some older WebViews). Returns true
 *  on success. */
async function writeToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path
    }
  }
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    const ok = document.execCommand("copy");
    return ok;
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

function AIHelperSection() {
  const inFixtureMode = isDemoOrWikiCapture();
  const runningCommit = process.env.NEXT_PUBLIC_RESEARCHOS_COMMIT ?? "";

  const [manifest, setManifest] = useState<AIHelperManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [selectedSize, setSelectedSize] = useState<AIHelperSize>("full");
  // Cache fetched markdown per size so size-flip + re-copy doesn't re-fetch.
  const [promptBySize, setPromptBySize] = useState<Partial<Record<AIHelperSize, string>>>({});
  const [loadingSize, setLoadingSize] = useState<AIHelperSize | null>("full");
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Inline 4s toast, mirrors the TipsSection pattern.
  const [status, setStatus] = useState<string | null>(null);
  const [pullingLive, setPullingLive] = useState(false);

  // Mount: pull manifest.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/ai-helper/manifest.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`manifest fetch failed (${res.status})`);
        const data = (await res.json()) as AIHelperManifest;
        if (!cancelled) setManifest(data);
      } catch (err) {
        if (!cancelled) {
          setManifestError(
            err instanceof Error ? err.message : "Couldn't load AI Helper manifest.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazy-fetch the markdown for the currently selected size on first
  // selection. Cached via promptBySize so subsequent selects of the same
  // size are instant. We trigger this from a separate effect rather than
  // inline in handleSizeChange so the initial "lean" selection on mount
  // also kicks off a fetch.
  useEffect(() => {
    if (promptBySize[selectedSize] !== undefined) {
      // Already cached; clear loading + error.
      setLoadingSize(null);
      setFetchError(null);
      return;
    }
    let cancelled = false;
    setLoadingSize(selectedSize);
    setFetchError(null);
    (async () => {
      try {
        const res = await fetch(`/ai-helper/${selectedSize}.md`, { cache: "no-store" });
        if (!res.ok) throw new Error(`prompt fetch failed (${res.status})`);
        const text = await res.text();
        if (cancelled) return;
        setPromptBySize((prev) => ({ ...prev, [selectedSize]: text }));
        setLoadingSize(null);
      } catch (err) {
        if (cancelled) return;
        setLoadingSize(null);
        setFetchError(
          err instanceof Error
            ? err.message
            : "Couldn't load that prompt. Try again in a moment.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSize, promptBySize]);

  const showStatus = useCallback((msg: string) => {
    setStatus(msg);
    window.setTimeout(() => {
      setStatus((current) => (current === msg ? null : current));
    }, 4000);
  }, []);

  const promptText = promptBySize[selectedSize];
  const promptReady = typeof promptText === "string" && promptText.length > 0;
  const sizeMeta = manifest?.sizes[selectedSize];
  const sizeLabel =
    AI_HELPER_SIZE_OPTIONS.find((opt) => opt.value === selectedSize)?.label ?? selectedSize;
  const tokenCount = sizeMeta?.tokens;
  const tokenSuffix = tokenCount ? ` (~${tokenCount.toLocaleString()} tokens)` : "";
  const friendlySizeLabel = sizeLabel.toLowerCase().replace(" (recommended)", "");

  const handleCopy = useCallback(async () => {
    if (!promptReady || promptText === undefined) return;
    const ok = await writeToClipboard(promptText);
    if (ok) {
      showStatus(`Copied ${friendlySizeLabel} prompt${tokenSuffix} to clipboard.`);
    } else {
      showStatus("Couldn't access the clipboard. Try opening the prompt source instead.");
    }
  }, [promptReady, promptText, showStatus, friendlySizeLabel, tokenSuffix]);

  const handleOpenIn = useCallback(
    (provider: (typeof AI_HELPER_PROVIDERS)[number]) => {
      if (!promptReady || promptText === undefined) return;
      // Open the tab FIRST while we still have the user-gesture permission.
      // If we awaited the clipboard write before opening, popup blockers
      // would treat the opener as a non-gesture context and silently
      // swallow the new tab.
      window.open(provider.url, "_blank", "noopener");
      // Fire-and-resolve the clipboard write. The toast lands once the
      // browser confirms; in the rare failure path the user still has the
      // provider tab open and can use the Copy button to retry.
      void (async () => {
        const ok = await writeToClipboard(promptText);
        if (ok) {
          showStatus(
            `Copied ${friendlySizeLabel} prompt${tokenSuffix} to clipboard. Paste it as your first message in ${provider.label}.`,
          );
        } else {
          showStatus(
            `Opened ${provider.label} in a new tab, but couldn't copy automatically. Use the Copy button and try again.`,
          );
        }
      })();
    },
    [promptReady, promptText, showStatus, friendlySizeLabel, tokenSuffix],
  );

  const handlePullLatest = useCallback(async () => {
    if (inFixtureMode) {
      // Defensive — the button shouldn't render in demo/fixture mode at
      // all, but if a future refactor exposes it, keep the behaviour
      // strictly local-only.
      showStatus("Pull-from-deploy is disabled in demo mode.");
      return;
    }
    setPullingLive(true);
    try {
      const [manifestRes, promptRes] = await Promise.all([
        fetch(`${AI_HELPER_LIVE_BASE}/ai-helper/manifest.json`, { cache: "no-store" }),
        fetch(`${AI_HELPER_LIVE_BASE}/ai-helper/${selectedSize}.md`, { cache: "no-store" }),
      ]);
      if (!manifestRes.ok || !promptRes.ok) {
        throw new Error(
          `live fetch failed (${manifestRes.status} / ${promptRes.status})`,
        );
      }
      const liveManifest = (await manifestRes.json()) as AIHelperManifest;
      const livePrompt = await promptRes.text();
      setManifest(liveManifest);
      setPromptBySize((prev) => ({ ...prev, [selectedSize]: livePrompt }));
      const builtDate = formatBuiltDate(liveManifest.built_at);
      showStatus(
        `Pulled latest live prompt (helper_version ${liveManifest.helper_version}, ${builtDate}).`,
      );
    } catch (err) {
      console.error("[AIHelper] pull-from-deploy failed", err);
      showStatus(
        "Couldn't reach live prompt source. The local copy still works.",
      );
    } finally {
      setPullingLive(false);
    }
  }, [inFixtureMode, selectedSize, showStatus]);

  // Stale detection: only when we have BOTH a running-app commit (set by
  // next.config.ts at build time) AND a manifest commit, and they differ.
  // Skipped entirely in demo/fixture mode to keep captures deterministic
  // and avoid spurious amber chrome in the wiki/demo screenshots.
  const showStaleCallout =
    !inFixtureMode &&
    !!runningCommit &&
    !!manifest?.built_from_commit &&
    manifest.built_from_commit !== runningCommit;

  const builtDate = manifest ? formatBuiltDate(manifest.built_at) : null;
  const shortManifestCommit = manifest?.built_from_commit
    ? manifest.built_from_commit.slice(0, 7)
    : null;
  const shortRunningCommit = runningCommit ? runningCommit.slice(0, 7) : null;

  return (
    <SectionShell
      id="ai-helper"
      tourTarget="settings-ai-helper-section"
      title="AI Helper"
      description="Train your own AI chatbot to know ResearchOS inside out. Paste this prompt into Claude, ChatGPT, Gemini, or Microsoft Copilot and the chatbot becomes a schema-aware support assistant."
      searchKeywords="Claude ChatGPT Gemini Copilot Microsoft prompt copy clipboard lean full minimal size tokens schema chatbot LLM"
    >
      <div className="space-y-4">
        {/* Size picker */}
        <div>
          <p className="text-body font-medium text-foreground mb-2">Pick a size</p>
          <div className="flex flex-col gap-2">
            {AI_HELPER_SIZE_OPTIONS.map((opt) => {
              const selected = selectedSize === opt.value;
              const sizeBytes = manifest?.sizes[opt.value]?.bytes;
              const sizeTokens = manifest?.sizes[opt.value]?.tokens;
              // Onboarding v4 §6.10 walkthrough anchors. The
              // TOUR_TARGETS registry uses "medium" as the slug for the
              // middle-sized option (which is `lean` here — the
              // recommended ~10k-token build). Map `full`/`lean`/
              // `minimal` -> `tab-full`/`tab-medium`/`tab-minimal` so
              // the cursor demo can address each tile by name.
              const tourTarget =
                opt.value === "full"
                  ? "settings-ai-helper-tab-full"
                  : opt.value === "lean"
                    ? "settings-ai-helper-tab-medium"
                    : opt.value === "minimal"
                      ? "settings-ai-helper-tab-minimal"
                      : undefined;
              return (
                <label
                  key={opt.value}
                  data-tour-target={tourTarget}
                  className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    selected
                      ? "border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/15"
                      : "border-border hover:border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="ai-helper-size"
                    value={opt.value}
                    checked={selected}
                    onChange={() => setSelectedSize(opt.value)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-medium text-foreground">{opt.label}</p>
                    <p className="text-meta text-foreground-muted mt-0.5">{opt.blurb}</p>
                    {sizeTokens !== undefined && sizeBytes !== undefined && (
                      <p className="text-meta text-foreground-muted mt-1">
                        Built size: ~{sizeTokens.toLocaleString()} tokens · {Math.round(sizeBytes / 1024)} KB
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Copy button */}
        <div>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!promptReady}
            data-tour-target="settings-ai-helper-copy"
            className="ros-btn-raise px-4 py-2 text-body bg-brand-action hover:bg-brand-action/90 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg"
          >
            {loadingSize === selectedSize
              ? "Loading prompt…"
              : promptReady
                ? "Copy prompt to clipboard"
                : "Prompt unavailable"}
          </button>
          {fetchError && (
            <p className="text-meta text-red-600 dark:text-red-300 mt-2">{fetchError}</p>
          )}
        </div>

        {/* Open-in provider buttons */}
        <div>
          <p className="text-body font-medium text-foreground mb-2">Open in your AI</p>
          <div className="flex flex-wrap gap-2">
            {AI_HELPER_PROVIDERS.map((provider) => (
              <button
                key={provider.key}
                type="button"
                onClick={() => handleOpenIn(provider)}
                disabled={!promptReady}
                className="inline-flex items-center gap-1 px-3 py-2 text-body border border-border bg-surface-raised hover:bg-surface-sunken disabled:opacity-50 disabled:cursor-not-allowed text-foreground rounded-lg"
              >
                {provider.label}
                <span aria-hidden className="text-foreground-muted">↗</span>
              </button>
            ))}
          </div>
          <p className="text-meta text-foreground-muted mt-2">
            Each &ldquo;Open in&rdquo; button copies the prompt and opens the provider in a new tab.
            Paste it as your first message, or save it as a Claude Project / Custom GPT / Gem for a
            persistent helper.
          </p>
          <p className="text-meta text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-md px-3 py-2 mt-2">
            <span className="font-medium">Heads up:</span> this is for the chat interface
            (claude.ai, chatgpt.com, gemini.google.com, copilot.microsoft.com). Your Claude Max
            / ChatGPT Plus / Gemini Advanced subscription works fine, and Microsoft Copilot is
            free with many university and institutional accounts (including UW-Madison). You do{" "}
            <em>not</em> need an Anthropic / OpenAI / Google API key, and your chat-tier
            subscription does not include API credits.
          </p>
        </div>

        {/* Inline status toast (4s auto-dismiss) */}
        {status && (
          <p className="text-meta text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 rounded-md px-3 py-2">
            {status}
          </p>
        )}

        {/* Freshness footer */}
        <div className="pt-3 border-t border-border text-meta text-foreground-muted">
          {manifestError ? (
            <p className="text-amber-700 dark:text-amber-300">
              Couldn&apos;t load freshness info: {manifestError}
            </p>
          ) : !manifest ? (
            <p>Loading prompt manifest…</p>
          ) : (
            <p>
              Last refreshed: {builtDate} · helper_version {manifest.helper_version} · ResearchOS @{" "}
              <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta">{shortManifestCommit}</code>
            </p>
          )}
        </div>

        {/* Stale-prompt callout (only when running-app commit differs from
            manifest commit; suppressed in demo/fixture mode). */}
        {showStaleCallout && (
          <div className="rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-meta text-amber-900 dark:text-amber-300 space-y-2">
            <p>
              <span aria-hidden>⚠ </span>
              These prompts are from{" "}
              <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-500/15 rounded text-meta">
                {shortManifestCommit}
              </code>{" "}
              but the running app is at{" "}
              <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-500/15 rounded text-meta">
                {shortRunningCommit}
              </code>
              . They may be older than the running app.
            </p>
            <button
              type="button"
              onClick={() => void handlePullLatest()}
              disabled={pullingLive}
              className="ros-btn-raise px-2.5 py-1 text-meta bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md"
            >
              {pullingLive
                ? "Pulling…"
                : "Pull latest from research-os-xi.vercel.app"}
            </button>
          </div>
        )}

        {/* Footer links. Note: the "Read setup guide" link to
            /wiki/integrations/ai-helper was removed (wiki round-trip fix,
            Bug 3 option A): the page never existed and the section is
            self-explanatory (prompt + copy button + "Open in Claude /
            ChatGPT / Gemini" affordances are right above). Re-add if a
            dedicated /wiki/integrations/ai-helper page is later created. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
          <Link
            href={`/ai-helper/${selectedSize}.md`}
            target="_blank"
            className="text-blue-600 dark:text-blue-300 hover:underline"
          >
            View prompt source →
          </Link>
        </div>
      </div>
    </SectionShell>
  );
}

/**
 * Onboarding section. The v4 tour engine has been removed; this section now
 * surfaces the What's New popup and the demo lab exploration button.
 */
function TipsSection() {
  // What's-new on-demand re-open (whats-new bot). Shows the FULL release
  // history (every release expanded) so the popup is viewable any time,
  // not just on a genuine upgrade. Does NOT touch last-seen.
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  return (
    <SectionShell
      title="Onboarding"
      description="Revisit release highlights or explore the demo lab."
      searchKeywords="what's new whats new release notes changelog updates announcement demo"
    >
      {/* What's new (whats-new bot): re-open the developer-announcement
          popup showing the full release history on demand. The popup
          otherwise fires only on a genuine APP_VERSION upgrade, so this
          row keeps it reachable any time. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-body text-foreground">What&apos;s new</p>
          <p className="text-meta text-foreground-muted mt-1">
            Revisit the latest release highlights and the full history of
            what changed in ResearchOS.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWhatsNewOpen(true)}
          data-testid="settings-open-whats-new"
          className="ros-btn-neutral px-3 py-2 text-body whitespace-nowrap"
        >
          What&apos;s new
        </button>
      </div>
      <WhatsNewModal
        open={whatsNewOpen}
        releases={RELEASE_NOTES}
        showAllExpanded
        waveOnOpen={false}
        onDismiss={() => setWhatsNewOpen(false)}
      />

      {/* The "View welcome page" revisit was removed 2026-06-11 with the
          standalone /welcome route; the marketing now lives only as the entry
          surface slide-down for new visitors. */}

      {/* Pop into the seeded demo lab and back. Entering hard-navigates to
          /demo so FileSystemProvider remounts and installWikiCaptureFixture
          backs up the real folder first; the always-visible Leave Demo button
          restores it. We stash the current route so leaving returns here, not
          the home page. (Grant 2026-06-10) */}
      <div className="mt-4 flex items-start justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-body text-foreground">Explore the demo lab</p>
          <p className="text-meta text-foreground-muted mt-1">
            Open a fully seeded fake lab to look around safely. Your real folder
            is backed up while you browse, and Leave Demo brings you right back
            here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            storePreDemoRoute(window.location.pathname + window.location.search);
            window.location.assign("/demo");
          }}
          data-testid="settings-explore-demo"
          className="ros-btn-neutral px-3 py-2 text-body whitespace-nowrap"
        >
          Explore the demo
        </button>
      </div>
      {process.env.NODE_ENV === "development" && (
        <div className="mt-4 border-t border-border pt-3 text-meta text-foreground-muted">
          <Link
            href="/dev/beakerbot-gallery"
            data-testid="settings-beakerbot-gallery-link"
            className="text-blue-600 dark:text-blue-300 hover:underline"
          >
            BeakerBot Gallery (dev)
          </Link>
          <span className="ml-2 text-foreground-muted">
            Browse every BeakerBot pose and scene in one place.
          </span>
        </div>
      )}
    </SectionShell>
  );
}

function SecuritySection({
  pwExists,
  claimed,
  onOpen,
}: {
  pwExists: boolean | null;
  // True when this account has claimed a global sharing identity (status
  // "ready" or "needs-restore"). Per D1 a claimed account treats the password
  // as the OFFLINE fallback and can also unlock online with Google or GitHub
  // (that provider-unlock UI lives on the login screen, not here); this section
  // just explains the relationship so the password no longer reads as the sole
  // lock.
  claimed: boolean;
  onOpen: () => void;
}) {
  return (
    <SectionShell
      title="Security"
      description="A password blocks accidental sign-in to this account from inside the app. It does not encrypt files on disk."
      searchKeywords="password lock login sign-in google github unlock"
    >
      {claimed && (
        <p className="text-body text-foreground-muted mb-3 leading-relaxed">
          Your password is the offline lock for this account. When you are
          online you can also unlock by signing in with Google or GitHub, the
          same identity you share with. The password stays as the offline
          fallback.
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-body text-foreground">
            Password is currently{" "}
            <span className={pwExists ? "text-emerald-600 dark:text-emerald-300 font-medium" : "text-foreground-muted"}>
              {pwExists === null ? "…" : pwExists ? "set" : "not set"}
            </span>
            .
          </p>
          <p className="text-meta text-foreground-muted mt-1">
            {claimed
              ? "Online unlock with Google or GitHub appears on the login screen."
              : "Same flow as the lock icon on the login screen."}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
        >
          {pwExists ? "Change password" : "Set password"}
        </button>
      </div>
    </SectionShell>
  );
}

// ── Offline mode ────────────────────────────────────────────────────────────
//
// Closes the role brief's affordance #2: a single switch that stops the
// browser → own-server proxy call (`/api/calendar-feed`).

function OfflineModeSection({ settings, update }: SectionProps) {
  return (
    <SectionShell
      title="Offline mode"
      description="Disable the /api/calendar-feed proxy route so the app makes no calls to its own server. Useful if you want zero outbound network from the app surface."
      searchKeywords="network proxy server outbound block disable api"
    >
      <ToggleRow
        label="Block calls to our server"
        description="External calendar feeds stop syncing."
        checked={settings.offlineMode}
        onChange={(v) => void update({ offlineMode: v })}
      />
      {settings.offlineMode && (
        <div className="rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-3 py-2 text-meta text-amber-900 dark:text-amber-300">
          Offline mode active. Calendar feeds are blocked.
        </div>
      )}
    </SectionShell>
  );
}

// ── Reusable controls ───────────────────────────────────────────────────────

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  // Each SelectField counts as one search-indexable row. The visible
  // option labels are also baked into the desc so picking "MM/DD/YYYY"
  // out of "Date format" still surfaces this row when the user types
  // "MDY" or "DD/MM".
  const optionsBlob = options.map((o) => o.label).join(" ");
  return (
    <SearchableRow
      id={`select:${label}`}
      label={label}
      desc={optionsBlob}
    >
    <div>
      <label className="block text-meta font-medium text-foreground mb-1">
        <HighlightedText text={label} />
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
    </SearchableRow>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  // Auto-registers with the parent section's search index so the
  // page-level filter can hit any ToggleRow by label or description
  // substring. The `id` is the label itself: labels are unique within
  // every section we ship, and even if a label collides the Map's
  // last-write-wins semantics still gives correct match information
  // (both entries would carry the same strings).
  return (
    <SearchableRow id={`toggle:${label}`} label={label} desc={description}>
      <label className="flex items-start justify-between gap-4 cursor-pointer">
        <div className="min-w-0">
          <p className="text-body text-foreground">
            <HighlightedText text={label} />
          </p>
          {description && (
            <p className="text-meta text-foreground-muted mt-0.5">
              <HighlightedText text={description} />
            </p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors mt-0.5 ${
            checked ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-surface-raised shadow transition-transform ${
              checked ? "translate-x-4" : "translate-x-0.5"
            } translate-y-0.5`}
          />
        </button>
      </label>
    </SearchableRow>
  );
}

