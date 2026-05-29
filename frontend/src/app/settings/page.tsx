"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import AppFooter from "@/components/AppFooter";
import AccountPasswordPopup from "@/components/AccountPasswordPopup";
import ImportExperimentDialog from "@/components/ImportExperimentDialog";
import ImportELNDialog from "@/components/import-eln/ImportELNDialog";
import Tooltip from "@/components/Tooltip";
import UserAvatar from "@/components/UserAvatar";
import OrcidField from "@/components/settings/OrcidField";
import VersionBadge from "@/components/VersionBadge";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import { useAppStore } from "@/lib/store";
import {
  tasksApi,
  methodsApi,
  fetchAllTasksIncludingShared,
  fetchAllProjectsIncludingShared,
} from "@/lib/local-api";
import { splitAllTaskAttachments } from "@/lib/tasks/migrate-attachments";
import { repairStampFormats } from "@/lib/tasks/migrate-stamps";
import {
  reconcileHostedDrift,
  hostedManifestPath,
  type ReconcileReport,
} from "@/lib/sharing/project-hosting";
import { fileService } from "@/lib/file-system/file-service";
import type {
  ProjectHostedManifest,
  ProjectHostedTaskEntry,
} from "@/lib/types";
import {
  patchUserSettings,
  readUserSettings,
  SIDEBAR_HORIZON_CHOICES,
  type UserSettings,
  type CalendarViewMode,
  type DateFormat,
  type TimeFormat,
} from "@/lib/settings/user-settings";
import { NAV_ITEMS, HOME_HREF } from "@/lib/nav";
import { ANIMATION_METADATA, renderAnimationIcon, type AnimationType } from "@/components/animations";
import DynamicAnimation from "@/components/DynamicAnimation";
import { hasPassword, verifyPassword } from "@/lib/auth/password";
import {
  setLabHeadPassword,
  verifyLabHeadPassword,
} from "@/lib/lab/lab-head-auth";
import { endEditSession, formatRemaining } from "@/lib/lab/edit-session";
import { useEditSession } from "@/hooks/useEditSession";
import LabRoster from "@/components/lab-head/LabRoster";
import {
  clearCachedPassword,
  hasCachedPassword,
  setCachedPassword,
} from "@/lib/auth/cached-password";
import {
  deleteEncryptedBackup,
  hasEncryptedBackup,
  writeEncryptedBackup,
} from "@/lib/telegram/encrypted-backup";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
import { readPairing } from "@/lib/telegram/telegram-store";
import { USER_COLOR_QUERY_KEY } from "@/hooks/useUserColor";
import { readAllUserMetadata } from "@/lib/file-system/user-metadata";
import {
  isCombinationTaken,
  ownerOfCombination,
  otherUsersOnly,
  otherUsersOnlyAsync,
  takenSolidPrimaries,
  takenSecondariesFor,
} from "@/lib/file-system/user-color-collisions";
import {
  clearWizardCompletion,
  countOrphanedArtifacts,
  patchOnboarding,
  readOnboarding,
  replayOnboarding,
} from "@/lib/onboarding/sidecar";
import { useOptionalTourController } from "@/components/onboarding/v4/TourController";
import { useFeaturePicks } from "@/hooks/useFeaturePicks";
import { forgetAllTelegramTokenCache } from "@/lib/telegram/telegram-token-cache";
import StreaksSection from "./StreaksSection";
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

const USER_COLOR_PALETTE = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

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
  return (
    <AppShell>
      <SettingsSearchProvider>
        <SettingsBody />
      </SettingsSearchProvider>
    </AppShell>
  );
}

/**
 * Settings tab identifier. Drives the Personal / Lab Mode split introduced
 * by settings tabs manager 2026-05-23. Solo accounts (no lab folder) never
 * see the tab strip at all — the value is purely cosmetic for them and
 * defaults to "personal".
 */
type SettingsTab = "personal" | "lab";

function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return value === "personal" || value === "lab";
}

/**
 * Normalize a `?tab=...` query param into a canonical SettingsTab id.
 * Accepts the canonical ids ("personal", "lab") AND the visible-label
 * alias "lab-mode" (the tab strip label is "Lab Mode", and external docs
 * / wiki links sometimes use that form). Returns null on anything else
 * so the caller can fall back to the default tab rather than silently
 * dropping users on Personal when they asked for Lab Mode.
 */
function normalizeSettingsTab(
  value: string | null | undefined,
): SettingsTab | null {
  if (value === "lab-mode") return "lab";
  if (isSettingsTab(value)) return value;
  return null;
}

function SettingsBody() {
  const { currentUser, isConnected } = useFileSystem();
  const hydrateFromSettings = useAppStore((s) => s.hydrateFromSettings);
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const featurePicks = useFeaturePicks(currentUser);

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recentlySaved, setRecentlySaved] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwExists, setPwExists] = useState<boolean | null>(null);

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
  const isLabWorkspace = featurePicks?.account_type === "lab";

  // Multi-user folder detection (Grant 2026-05-23 follow-up): the prior
  // gate only surfaced the Lab Mode tab when feature_picks declared a
  // lab workspace OR the user was already lab_head. That left a
  // chicken-and-egg gap: a user created in a shared folder without
  // going through onboarding (or who picked solo) could never reach the
  // role picker to flip themselves to lab_head, because the role picker
  // lives inside the gated tab. Detect the multi-user folder shape via
  // discoverUsers() and OR that signal into the gate so the tab also
  // surfaces for anyone sharing a folder with at least one other user.
  // Self gets filtered out; the pseudo-`lab` user is already skipped by
  // discoverUsers' SKIP_DIRECTORIES list.
  const [folderHasOtherUsers, setFolderHasOtherUsers] = useState(false);
  useEffect(() => {
    if (!currentUser || !isConnected) {
      setFolderHasOtherUsers(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const all = await discoverUsers();
        if (cancelled) return;
        const others = all.filter((u) => u !== currentUser);
        setFolderHasOtherUsers(others.length > 0);
      } catch {
        // Discovery can fail on a transient FS read; default to false
        // (hide tab) rather than risk surfacing a tab on a broken folder.
        if (!cancelled) setFolderHasOtherUsers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isConnected]);

  const isLabMode =
    settings?.account_type === "lab_head" ||
    (settings?.account_type === "member" && isLabWorkspace) ||
    folderHasOtherUsers;
  // Tab state. Read the initial value from the `?tab=...` query so a
  // deep-link or in-session back-nav lands the user on the same tab.
  // Solo users never see the tab strip but we still respect the query
  // so a stray `?tab=lab` URL doesn't loop them through an inert state.
  // Accepts "personal" / "lab" plus the "lab-mode" alias so wiki +
  // README links that use the visible label still resolve correctly.
  const initialTab: SettingsTab =
    normalizeSettingsTab(searchParams.get("tab")) ?? "personal";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Keep the URL query in sync as the user clicks between tabs so they can
  // deep-link a screenshot ("see Lab Mode") and so Back/Forward restores
  // the right view. Use router.replace to avoid history bloat.
  const handleTabChange = useCallback(
    (next: SettingsTab) => {
      setActiveTab(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === "personal") {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      const query = params.toString();
      router.replace(query ? `/settings?${query}` : "/settings", {
        scroll: false,
      });
    },
    [router, searchParams],
  );

  // Sync when the URL changes from outside (e.g. an in-product Link
  // points at /settings?tab=lab). Only mirrors valid values so a stale
  // `?tab=garbage` stays harmless. The "lab-mode" alias normalizes to
  // "lab" so external links with the visible-label form still flip the
  // tab without bouncing the user back to Personal.
  useEffect(() => {
    const normalized = normalizeSettingsTab(searchParams.get("tab"));
    if (normalized !== null && normalized !== activeTab) {
      setActiveTab(normalized);
    }
    // We intentionally don't include `activeTab` here — this is a one-
    // way URL → state sync; the other direction is handled by
    // `handleTabChange`. Including it would create a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // The wrapping <div className="flex-1 overflow-y-auto"> is the actual
  // scroll container — not window. Calling el.scrollIntoView() defaults
  // to scrolling the nearest scrolling ancestor, which is unreliable
  // here because the container only mounts after `loading` flips false.
  // We need a direct handle to call scrollTo() on the right element.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // One-shot guard so we only honor the URL hash on first content render,
  // not again when the user switches accounts mid-session.
  const scrolledToHashRef = useRef(false);

  // Scroll to URL hash (e.g. /settings#ai-helper, #telegram, #personalize)
  // once the section is actually in the DOM. Onboarding-tip setupActions
  // navigate here, so this is the entry point users hit cold.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading) return;
    if (scrolledToHashRef.current) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    scrolledToHashRef.current = true;
    // Defer one frame so layout has settled after this commit; otherwise
    // offsetTop / getBoundingClientRect can read stale geometry.
    const raf = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const el = document.getElementById(hash);
      if (!el) return;
      const top =
        el.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      container.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [loading]);

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
      const exists = await hasPassword(currentUser);
      if (cancelled) return;
      setSettings(s);
      setPwExists(exists);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isConnected]);

  const refreshPwExists = useCallback(async () => {
    if (!currentUser) return;
    setPwExists(await hasPassword(currentUser));
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
          defaultLandingTab: saved.defaultLandingTab,
          sidebarShowTasks: saved.sidebarShowTasks,
          sidebarShowCalendarEvents: saved.sidebarShowCalendarEvents,
          sidebarEventsHorizonDays: saved.sidebarEventsHorizonDays,
          coloredHeader: saved.coloredHeader,
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
          <h2 className="text-xl font-semibold text-gray-900">Settings unavailable</h2>
          <p className="text-sm text-gray-600">
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

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto flex flex-col">
      <div className="max-w-3xl mx-auto w-full px-6 py-8 space-y-8">
        {/* Onboarding v4 §6.10 Settings phase redesign 2026-05-22
            (Settings manager): the page header doubles as the
            spotlight anchor for the `settings-tour-folder` narration
            beat. The `users/<user>/settings.json` line is the closest
            in-product surface that references the user's connected
            lab folder, so BeakerBot anchors there when narrating
            "this is where your lab folder lives." The dedicated
            folder-switching UI lives on the entry screen
            (ResearchFolderSetupNew); a FOLLOW-UP could surface a
            "Change folder" button right here for parity with the
            narration. */}
        <header
          data-tour-target="settings-folder-section"
          className="flex items-center justify-between"
        >
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
              <VersionBadge />
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Stored in <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">users/{currentUser}/settings.json</code>
            </p>
          </div>
          <SavedIndicator saving={saving} recentlySaved={recentlySaved} />
        </header>

        {/* Inline filter bar (settings search UX manager, 2026-05-23):
            scrolls with the page so it stays in reach but never blocks
            the header. Typing here filters every SectionShell + every
            SearchableRow on this page by case-insensitive substring on
            the row's label or description. Empty query is a no-op. */}
        <SettingsSearchBar />
        <SettingsSearchEmptyState />

        {/* Settings tabs manager 2026-05-23: split lab-admin work from
            personal preferences. Solo accounts never see this strip
            (single-stream layout, identical to the pre-tabs page). Lab
            accounts see Personal (default) and Lab Mode. Account Type +
            PI admin + Lab Roster live under Lab Mode; everything
            else stays in Personal. */}
        {isLabMode && (
          <SettingsTabStrip
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        )}

        {/* key={currentUser} resets each section's local draft state when
            the lab user switches mid-session, so we never show user A's
            half-typed display-name draft to user B. */}
        {(!isLabMode || activeTab === "personal") && (
          <>
            <ProfileSection
              key={`profile-${currentUser}`}
              settings={settings}
              update={update}
            />
            <TabsSection settings={settings} update={update} />
            <LabArchivesSection />
            <AIHelperSection />
            <SidebarSection settings={settings} update={update} />
            <DefaultsSection settings={settings} update={update} />
            <AnimationSection settings={settings} update={update} />
            <BehaviorSection settings={settings} update={update} />
            <StreaksSection />
            <TrashAndHistorySection settings={settings} update={update} />
            <DataInventorySection />
            <MaintenanceSection />
            <TipsSection />
            <SecuritySection
              pwExists={pwExists}
              onOpen={() => setPwOpen(true)}
            />
            <OfflineModeSection settings={settings} update={update} />
          </>
        )}

        {isLabMode && activeTab === "lab" && (
          <LabModeTabContent
            settings={settings}
            update={update}
            currentUser={currentUser}
          />
        )}
      </div>

      {pwOpen && currentUser && (
        <AccountPasswordPopup
          username={currentUser}
          onClose={() => {
            setPwOpen(false);
            void refreshPwExists();
          }}
        />
      )}
      <AppFooter className="mt-auto" />
    </div>
  );
}

function SavedIndicator({ saving, recentlySaved }: { saving: boolean; recentlySaved: boolean }) {
  if (saving) return <span className="text-xs text-gray-500">Saving…</span>;
  if (recentlySaved) return <span className="text-xs text-emerald-600">Saved</span>;
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
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
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
          <circle cx="11" cy="11" r="7" />
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
        className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="p-1 text-gray-400 hover:text-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
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

/**
 * Empty-state surface (settings search UX manager, 2026-05-23). Renders
 * a single line when the user has an active query but every section on
 * the page has hidden itself. Polls the DOM for visible sections after
 * each query change so we don't have to thread "did anything match?"
 * back up from every SectionShell. Cheap: one querySelectorAll on the
 * settings page scope each time the lowered query changes.
 */
function SettingsSearchEmptyState() {
  const { query, lower, active } = useSettingsSearch();
  const [noMatches, setNoMatches] = useState(false);

  useEffect(() => {
    if (!active) {
      // Reset on next frame so the effect body avoids the synchronous
      // setState-in-effect lint (cascading-render warning). Same
      // deferral that the post-query measure uses below.
      const reset = requestAnimationFrame(() => setNoMatches(false));
      return () => cancelAnimationFrame(reset);
    }
    // Defer to next frame so SectionShells have committed their
    // `hidden` attribute based on the new query.
    const raf = requestAnimationFrame(() => {
      const sections = document.querySelectorAll<HTMLElement>(
        '[data-settings-section-marker="1"]',
      );
      let anyVisible = false;
      for (const s of sections) {
        if (!s.hidden) {
          anyVisible = true;
          break;
        }
      }
      setNoMatches(!anyVisible && sections.length > 0);
    });
    return () => cancelAnimationFrame(raf);
  }, [active, lower]);

  if (!active || !noMatches) return null;
  return (
    <div
      role="status"
      className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600"
    >
      No settings match{" "}
      <span className="font-medium text-gray-800">&ldquo;{query}&rdquo;</span>.
      Try a different keyword.
    </div>
  );
}

// ── Sections ────────────────────────────────────────────────────────────────

interface SectionProps {
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => Promise<void>;
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
   *  `/settings#telegram` and `/settings#personalize` (fired by the
   *  Telegram and Personalize-Colors onboarding tips' setupActions). */
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
      className="bg-white rounded-xl border border-gray-200 p-6 scroll-mt-4"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">
          <HighlightedText text={title} />
        </h2>
        {description && (
          <p className="text-xs text-gray-500 mt-1">
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

function ProfileSection({ settings, update }: SectionProps) {
  const { currentUser } = useFileSystem();
  // Local draft for typing — parent re-mounts this section via key when
  // currentUser changes, so the initial value is always correct.
  const [draftName, setDraftName] = useState(settings.displayName ?? "");

  const commitName = () => {
    const next = draftName.trim() === "" ? null : draftName.trim();
    if (next !== settings.displayName) void update({ displayName: next });
  };

  return (
    <SectionShell
      id="personalize"
      title="Profile"
      description="How you appear in the app. The color flows everywhere your initial bubble appears — lab views, comments, the login screen, etc."
      searchKeywords="display name color avatar gradient primary secondary swatch palette personalize header tint orcid id researcher identifier"
    >
      {/* Live avatar preview — colorOverride + secondaryOverride use the
          in-flight pick so the gradient updates instantly before the save
          round-trip completes. */}
      <div className="flex items-center gap-4">
        {currentUser && (
          <UserAvatar
            username={currentUser}
            size="xl"
            letter={(draftName.charAt(0) || currentUser.charAt(0))}
            colorOverride={settings.color}
            secondaryOverride={settings.colorSecondary}
          />
        )}
        <div className="text-xs text-gray-500">
          <p className="text-sm text-gray-800 font-medium">{draftName.trim() || currentUser}</p>
          <p className="mt-0.5">
            {settings.colorSecondary
              ? "Two-color gradient — your live preview."
              : "Solid color — pick a second swatch below to make it a gradient."}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Display name
        </label>
        <input
          type="text"
          value={draftName}
          placeholder={currentUser ?? ""}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-400 mt-1">
          Leave blank to use your folder name ({currentUser}).
        </p>
      </div>

      {/* ORCID iD (metadata implementation bot, 2026-05-28). Lives on the
          person in `users/_user_metadata.json`, written via the dedicated
          metadata path — separate from the rest of this section's
          `settings.json`-backed fields. */}
      <OrcidField currentUser={currentUser ?? null} />

      {/* personalization-color step (§6.10): spotlight wraps both
          the color picker and the tint toggle so the user understands
          the whole section is theirs to play with. The inner
          `settings-color-picker` and `settings-color-tint-toggle`
          anchors stay so per-element selectors continue to work. */}
      <div data-tour-target="settings-color-and-tint" className="space-y-4">
        <div data-tour-target="settings-color-picker">
          <ColorPickerRows
            currentUser={currentUser ?? ""}
            primary={settings.color}
            secondary={settings.colorSecondary}
            update={update}
          />
        </div>

        <div data-tour-target="settings-color-tint-toggle">
          <ToggleRow
            label="Tint header with my color"
            description="When off, the top bar stays white. Your avatar bubbles around the app still use your color either way."
            checked={settings.coloredHeader}
            onChange={(v) => void update({ coloredHeader: v })}
          />
        </div>
      </div>
    </SectionShell>
  );
}

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
        "Principal investigator. Adds a Lab Overview surface with widgets, announcements, metrics, and the lab roster.",
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
      description="What's your role in this lab? Member is the default. PI adds a Lab Overview surface with customizable widgets, announcements, lab metrics, and the lab roster."
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
                  ? "border-amber-400 bg-amber-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <span
                className={`text-sm font-semibold ${
                  selected ? "text-amber-800" : "text-gray-800"
                }`}
              >
                {opt.title}
              </span>
              <span className="text-xs text-gray-500">{opt.description}</span>
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
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-5">
            <h3
              id="account-type-confirm-title"
              className="text-base font-semibold text-gray-900"
            >
              {pendingSwitch === "lab_head"
                ? "Switch your account type to PI?"
                : "Switch your account type to Member?"}
            </h3>
            <p className="text-sm text-gray-600 mt-2">
              {pendingSwitch === "lab_head"
                ? "This unlocks PI dashboards, audit logging, and the ability to approve purchases."
                : "This hides the Lab Overview surface and lab-head-only controls. You will keep your existing data."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingSwitch(null)}
                className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
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
                className="px-3 py-1.5 text-sm bg-amber-600 text-white hover:bg-amber-700 rounded-lg transition-colors"
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
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-gray-900 text-white rounded-lg shadow-lg px-4 py-3 flex items-center gap-3"
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
            className="flex-shrink-0 text-emerald-400"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-sm">
            Switched to{" "}
            <span className="font-semibold">
              {undoToast.next === "lab_head" ? "PI" : "Member"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void undoSwitch()}
            className="text-xs font-medium text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline"
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
 * Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): "Lab Head"
 * Settings section. Visible only when `account_type === "lab_head"`.
 *
 * Two controls:
 *   1. "Change lab-head password" — opens `ChangeLabHeadPasswordPopup`,
 *      verifies the current password, then sets a new one.
 *   2. "Active session" — live status pill subscribed to the
 *      module-scoped session via `useEditSession`. Shows
 *      "Active (M:SS remaining)" / "Locked" / "Not active." A
 *      companion "Lock session now" button manually ends the session.
 *
 * Per Grant 2026-05-23 (decision #3): the lab-head password starts as
 * the user's account password. First-time unlock bootstraps a hash via
 * `verifyLabHeadPassword`'s fallback path. After the first change here
 * the two passwords diverge.
 *
 * settings tabs manager 2026-05-23: the Lab Roster surface lived inside
 * this section originally. It now stands alone as
 * `LabRosterSection` so members (who never see this Lab Head section)
 * still get the read-only roster under the Lab Mode tab.
 */
function LabHeadSection({ username }: { username: string }) {
  const session = useEditSession();
  const [changePwOpen, setChangePwOpen] = useState(false);

  const isActive = session.state === "unlocked" && session.active;
  const statusLabel = isActive
    ? `Active — ${formatRemaining(session.remainingMs)} remaining`
    : session.state === "locked"
      ? "Session ended"
      : "Not active";
  const statusClass = isActive
    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : "text-gray-600 bg-gray-50 border-gray-200";

  return (
    <SectionShell
      id="lab-head"
      title="PI"
      description="Manage your edit-mode password and session for the Phase 5 PI workflow. Use Request edit on another member's record to start a session."
      searchKeywords="edit mode session password PI roster"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-white">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800">Lab-head password</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Starts as your account password. You can change it here once
              you&apos;ve unlocked edit mode at least once.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setChangePwOpen(true)}
            className="flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-amber-600 hover:bg-amber-700"
          >
            Change password
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-white">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800">Active session</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Sessions last 5 minutes and survive navigation. Close the tab or
              click Lock to end early.
            </p>
            <span
              className={`inline-block mt-1.5 px-2 py-0.5 rounded text-[11px] font-medium border ${statusClass}`}
              data-testid="lab-head-session-status"
            >
              {statusLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => endEditSession()}
            disabled={!isActive}
            className="flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Lock session now
          </button>
        </div>
      </div>

      {changePwOpen && (
        <ChangeLabHeadPasswordPopup
          username={username}
          onClose={() => setChangePwOpen(false)}
        />
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
 * Settings tabs manager 2026-05-23: Personal / Lab Mode segmented
 * control. Modeled after the Workbench tab strip
 * (`frontend/src/app/workbench/page.tsx`) so the two surfaces feel
 * consistent. Renders nothing for solo accounts — the caller already
 * gates on `isLabMode`.
 */
function SettingsTabStrip({
  activeTab,
  onTabChange,
}: {
  activeTab: SettingsTab;
  onTabChange: (next: SettingsTab) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 border-b border-gray-200 pb-3"
      role="tablist"
      aria-label="Settings sections"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "personal"}
        onClick={() => onTabChange("personal")}
        data-tour-target="settings-tab-personal"
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          activeTab === "personal"
            ? "bg-blue-100 text-blue-700"
            : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        }`}
      >
        Personal
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "lab"}
        onClick={() => onTabChange("lab")}
        data-tour-target="settings-tab-lab"
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          activeTab === "lab"
            ? "bg-amber-100 text-amber-800"
            : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        }`}
      >
        Lab Mode
      </button>
    </div>
  );
}

/**
 * Settings tabs manager 2026-05-23: container for the Lab Mode tab. Lists
 * the lab-admin sections in priority order:
 *
 *   1. AccountTypeSection — member vs lab_head toggle. Always visible
 *      to lab accounts. Toggling here is the entry point for becoming
 *      a lab head (no separate elevation flow).
 *   2. LabHeadSection — change password + active session controls.
 *      Lab heads only. The settings.account_type read drives this gate
 *      directly so the section appears live (no reload) the instant the
 *      toggle above flips to "lab_head".
 *   3. LabRosterSection — archive / restore lab members. Visible to
 *      everyone; LabRoster's internal `canArchive` gate hides the
 *      actions for non-lab-heads (or lab heads without an active edit
 *      session).
 *
 * AccountTypeSection + LabRosterSection always render under Lab Mode,
 * so the brief's defensive empty-state branch is unreachable today.
 * If both are ever gated away, swap in the friendly message described
 * in the role brief ("Lab Mode settings appear here when you're a
 * member or lab head of a lab folder.").
 */
function LabModeTabContent({
  settings,
  update,
  currentUser,
}: {
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => Promise<void>;
  currentUser: string;
}) {
  return (
    <>
      <AccountTypeSection settings={settings} update={update} />
      {settings.account_type === "lab_head" && (
        <LabHeadSection username={currentUser} />
      )}
      <LabRosterSection />
    </>
  );
}

/**
 * Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): in-place modal
 * for changing the lab-head password from the Settings → Lab Head card.
 *
 * Verifies the current password against `verifyLabHeadPassword` (which
 * itself falls back to the account password on first use), then writes
 * a fresh PBKDF2 hash via `setLabHeadPassword`.
 */
function ChangeLabHeadPasswordPopup({
  username,
  onClose,
}: {
  username: string;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!current || !next) {
      setError("Fill out all fields.");
      return;
    }
    if (next.length < 4) {
      setError("New password must be at least 4 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyLabHeadPassword(username, current);
      if (!ok) {
        setError("Current password is incorrect.");
        setBusy(false);
        return;
      }
      await setLabHeadPassword(username, next);
      setDone(true);
    } catch {
      setError("Failed to update password.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900">
          Change lab-head password
        </h2>
        {done ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-700">
              Password updated. New unlocks will require the new password.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-amber-600 hover:bg-amber-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Current password
              </label>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={busy}
                autoComplete="current-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                New password
              </label>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                disabled={busy}
                autoComplete="new-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Confirm new password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                autoComplete="new-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            {error && (
              <p className="text-xs text-red-600" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={busy || !current || !next || !confirm}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? "Updating…" : "Update password"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Two-row palette picker for primary + optional secondary color, with
 * collision-aware disabling. See `lib/file-system/user-color-collisions.ts`
 * for the rules (direction-insensitive on gradient pairs, solid-vs-solid
 * blocks only).
 */
function ColorPickerRows({
  currentUser,
  primary,
  secondary,
  update,
}: {
  currentUser: string;
  primary: string;
  secondary: string | null;
  update: (patch: Partial<UserSettings>) => Promise<void>;
}) {
  // Load the cross-user metadata so disabled-states reflect what others
  // have picked. The Settings save handler invalidates USER_COLOR_QUERY_KEY
  // after every color write, so piggy-backing on its dataUpdatedAt for the
  // dependency means we re-read whenever a peer's metadata could have
  // changed (multi-tab scenarios) without extra polling.
  const queryClient = useQueryClient();
  const colorMapState = queryClient.getQueryState(USER_COLOR_QUERY_KEY);
  const cacheVersion = colorMapState?.dataUpdatedAt ?? 0;
  const [otherUsers, setOtherUsers] = useState<
    ReturnType<typeof otherUsersOnly>
  >({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await readAllUserMetadata();
      // Mira Batch 1 polish (2026-05-23): use the async variant so
      // Phase 6 archived members' palette swatches are released back
      // to the picker. The old sync `otherUsersOnly` only filtered on
      // the UserMetadataEntry `deleted_at` tombstone, leaving archived
      // members' colors permanently reserved.
      const others = await otherUsersOnlyAsync(all, currentUser);
      if (cancelled) return;
      setOtherUsers(others);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, cacheVersion]);

  const primaryLc = primary.toLowerCase();
  const secondaryLc = secondary ? secondary.toLowerCase() : null;

  const takenSolids = useMemo(
    () => takenSolidPrimaries(otherUsers),
    [otherUsers],
  );
  const takenSecondaries = useMemo(
    () => takenSecondariesFor(primary, otherUsers),
    [primary, otherUsers],
  );

  const handlePickPrimary = async (c: string) => {
    // Switching primary: re-validate the (newPrimary, currentSecondary)
    // combo. If the secondary now collides, drop it back to solid.
    let nextSecondary: string | null = secondary;
    if (
      nextSecondary &&
      isCombinationTaken({ primary: c, secondary: nextSecondary }, otherUsers)
    ) {
      nextSecondary = null;
    }
    // Also: if we're going solid (no secondary) and that solid is taken,
    // refuse the click. The button is also disabled visually but a
    // race-time guard belongs here too.
    if (
      !nextSecondary &&
      isCombinationTaken({ primary: c, secondary: null }, otherUsers)
    ) {
      return;
    }
    await update({ color: c, colorSecondary: nextSecondary });
  };

  const handlePickSecondary = async (c: string) => {
    if (c.toLowerCase() === primaryLc) return; // can't pair with itself
    if (isCombinationTaken({ primary, secondary: c }, otherUsers)) return;
    await update({ colorSecondary: c });
  };

  const handleClearSecondary = async () => {
    // Going from gradient → solid. If the solid form is taken, surface the
    // refusal instead of writing.
    if (isCombinationTaken({ primary, secondary: null }, otherUsers)) {
      // No-op: the swatch tooltip already explains who has the solid.
      // A future polish pass could surface a toast here.
      return;
    }
    await update({ colorSecondary: null });
  };

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">
          Primary color
        </label>
        <div className="flex flex-wrap gap-2">
          {USER_COLOR_PALETTE.map((c) => {
            const cLc = c.toLowerCase();
            const isSelected = cLc === primaryLc;
            // A primary swatch is disabled when (a) the user has NO
            // secondary AND another user already has it as their solid,
            // OR (b) the user has a secondary and picking this primary
            // would not by itself collide but might also be taken solid.
            // We follow the locked design: only block solid-vs-solid.
            const wouldGoSolid = !secondary;
            const blockedSolid = wouldGoSolid && takenSolids.has(cLc);
            const ownerName = blockedSolid
              ? ownerOfCombination({ primary: c, secondary: null }, otherUsers)
              : null;
            const disabled = blockedSolid && !isSelected;
            return (
              <button
                key={c}
                type="button"
                aria-label={`Primary color ${c}`}
                title={ownerName ? `Used by ${ownerName}` : `Color ${c}`}
                disabled={disabled}
                onClick={() => void handlePickPrimary(c)}
                // Settings fix manager R1 (2026-05-22): stamp the
                // attribute the onboarding cursor script keys off of.
                // SettingsColorStep.tsx clicks
                // `[data-tour-target="settings-color-picker"] [data-color-swatch]:first-child`
                // and would silently time out without this attribute on
                // every palette button. The page-lock allow-list also
                // pivots on `[data-color-swatch]` so the optional
                // secondary stage stays clickable.
                data-color-swatch={c}
                className={`w-8 h-8 rounded-full border-2 transition-transform ${
                  isSelected
                    ? "border-gray-900 scale-110"
                    : disabled
                      ? "border-transparent opacity-30 cursor-not-allowed"
                      : "border-transparent hover:scale-105"
                }`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-medium text-gray-700">
            Optional second color for gradient
          </label>
          {secondary && (
            <button
              type="button"
              onClick={() => void handleClearSecondary()}
              className="text-xs text-gray-500 hover:text-gray-900 underline"
            >
              Clear secondary
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {USER_COLOR_PALETTE.map((c) => {
            const cLc = c.toLowerCase();
            const isSelected = secondaryLc === cLc;
            const isSamePrimary = cLc === primaryLc;
            const isTakenPair = takenSecondaries.has(cLc);
            const ownerName = isTakenPair
              ? ownerOfCombination(
                  { primary, secondary: c },
                  otherUsers,
                )
              : null;
            const disabled =
              (isSamePrimary || isTakenPair) && !isSelected;
            const title = isSamePrimary
              ? "Same as primary"
              : ownerName
                ? `Used by ${ownerName}`
                : `Color ${c}`;
            return (
              <button
                key={c}
                type="button"
                aria-label={`Secondary color ${c}`}
                title={title}
                disabled={disabled}
                onClick={() => void handlePickSecondary(c)}
                // Settings fix manager R1 (2026-05-22): identical
                // attribute on the secondary palette so the page-lock
                // allow-list (`[data-color-swatch]`) covers BOTH rows.
                // Without this stamp the secondary stage stays locked
                // even though the onboarding step body permits clicks.
                data-color-swatch={c}
                className={`w-8 h-8 rounded-full border-2 transition-transform ${
                  isSelected
                    ? "border-gray-900 scale-110"
                    : disabled
                      ? "border-transparent opacity-30 cursor-not-allowed"
                      : "border-transparent hover:scale-105"
                }`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Pick a second color to make your avatar a 2-stop gradient.
          Helpful when your lab has more than 10 people. Direction
          doesn&apos;t matter — blue-to-green and green-to-blue count as
          the same combo.
        </p>
      </div>
    </>
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
                isHome ? "bg-gray-50 border-gray-200 text-gray-400" : "bg-white border-gray-200 hover:bg-gray-50 cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={isHome}
                onChange={() => toggle(item.href)}
                className="accent-blue-600"
              />
              <span className="text-sm text-gray-800">{item.label}</span>
              {isHome && <span className="text-[10px] text-gray-400 ml-auto">always on</span>}
            </label>
          );
        })}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Default landing tab
        </label>
        <select
          value={settings.defaultLandingTab}
          onChange={(e) => void update({ defaultLandingTab: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {reachableLandingTabs.map((item) => (
            <option key={item.href} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">
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
      description="The left sidebar shown on every page except Calendar (which has its own). Pick what to show — tasks for today, today's calendar events, or both stacked."
      searchKeywords="tasks calendar events horizon next days today overdue upcoming"
    >
      <div className="space-y-2">
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.sidebarShowTasks}
            onChange={(e) => void update({ sidebarShowTasks: e.target.checked })}
            className="accent-blue-600"
          />
          <span className="text-sm text-gray-800">Tasks</span>
          <span className="ml-auto text-[10px] text-gray-400">
            today + overdue + upcoming
          </span>
        </label>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.sidebarShowCalendarEvents}
            onChange={(e) =>
              void update({ sidebarShowCalendarEvents: e.target.checked })
            }
            className="accent-blue-600"
          />
          <span className="text-sm text-gray-800">Calendar events</span>
          <span className="ml-auto text-[10px] text-gray-400">
            today and beyond
          </span>
        </label>
      </div>

      <div
        className={settings.sidebarShowCalendarEvents ? "" : "opacity-50 pointer-events-none"}
      >
        <label className="block text-xs font-medium text-gray-700 mb-1">
          How much calendar to show
        </label>
        <select
          value={settings.sidebarEventsHorizonDays}
          onChange={(e) =>
            void update({ sidebarEventsHorizonDays: parseInt(e.target.value, 10) })
          }
          disabled={!settings.sidebarShowCalendarEvents}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
        >
          {SIDEBAR_HORIZON_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">
          Controls the &ldquo;Next N days&rdquo; section under Today&apos;s Events.
        </p>
      </div>

      {bothOff && (
        <p className="text-xs text-amber-600 mt-1">
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

function AnimationSection({ settings, update }: SectionProps) {
  const types = Object.keys(ANIMATION_METADATA) as AnimationType[];
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
                selected ? "border-purple-400 bg-purple-50" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              {renderAnimationIcon(meta.icon, meta.color, "text-xl", "w-7 h-7")}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${selected ? "text-purple-700" : "text-gray-700"}`}>
                  {meta.name}
                </p>
                <p className="text-xs text-gray-400 truncate">{meta.description}</p>
              </div>
            </button>
          );
        })}
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
          from the task-completion picker above: this controls BeakerBot's
          daily hello wave + the BeakerBot streak-celebration scenes. The
          per-task picker (and its "none" option) stays its own control. */}
      <div className="mt-4 pt-4 border-t border-gray-100">
        <ToggleRow
          label="BeakerBot animations"
          description="BeakerBot's daily hello wave and streak celebrations. Turn off for a quieter experience."
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
      id="telegram"
      tourTarget="settings-telegram-section"
      title="Notifications & behavior"
      description="Master switches for messaging and safety prompts."
      searchKeywords="telegram notifications bot auto-reconnect encrypted backup destructive confirm prompts safety"
    >
      {/* Alias anchor so `/settings#behavior` also lands on this section
          (some docs/links use the section's title word rather than the
          original `#telegram` id). */}
      <span id="behavior" aria-hidden="true" />
      <ToggleRow
        label="Telegram notifications"
        description="When off, the app stops polling Telegram for inbound photos and updates."
        checked={settings.telegramNotifications}
        onChange={(v) => void update({ telegramNotifications: v })}
      />
      <TelegramAutoReconnectRow settings={settings} update={update} />
      <LockEncryptedBackupRow />
      <ToggleRow
        label="Confirm destructive actions"
        description='Show "Are you sure?" prompts before deleting tasks, projects, etc.'
        checked={settings.confirmDestructiveActions}
        onChange={(v) => void update({ confirmDestructiveActions: v })}
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

// Inline ToggleRow variant for the auto-reconnect feature. Flipping the
// toggle ON requires the user's account password (so we can encrypt the
// current bot token from _telegram.json). Flipping OFF deletes the
// encrypted sidecar. After verifying the password we stash it in the
// module-private cache (cached-password.ts) so the rest of the session
// can decrypt without re-prompting; the five wipe triggers documented
// at the top of cached-password.ts bound how long that cache lives.
function TelegramAutoReconnectRow({ settings, update }: SectionProps) {
  const { currentUser } = useFileSystem();
  const [passwordGateExists, setPasswordGateExists] = useState<boolean | null>(null);
  const [pairingExists, setPairingExists] = useState<boolean | null>(null);
  const [backupExists, setBackupExists] = useState<boolean | null>(null);
  const [pendingEnable, setPendingEnable] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    void (async () => {
      const [gate, pairing, backup] = await Promise.all([
        hasPassword(currentUser),
        readPairing(currentUser),
        hasEncryptedBackup(currentUser),
      ]);
      if (cancelled) return;
      setPasswordGateExists(gate);
      setPairingExists(pairing !== null);
      setBackupExists(backup);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const cancelPending = () => {
    setPendingEnable(false);
    setPasswordInput("");
    setError(null);
  };

  const handleToggle = async (next: boolean) => {
    if (!currentUser) return;
    setError(null);
    if (next) {
      if (!passwordGateExists) {
        setError("Set an account password first (Security section below) to use encrypted backups.");
        return;
      }
      if (!pairingExists) {
        setError("Pair Telegram first — there is no bot token to back up yet.");
        return;
      }
      setPendingEnable(true);
      return;
    }
    // Flipping OFF: delete the sidecar + clear the setting flag.
    setBusy(true);
    try {
      await deleteEncryptedBackup(currentUser);
      await update({ telegramAutoReconnect: false });
      setBackupExists(false);
    } catch (err) {
      console.error("[settings] delete encrypted backup failed", err);
      setError("Could not delete the encrypted backup. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmEnable = async () => {
    if (!currentUser) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await verifyPassword(currentUser, passwordInput);
      if (!ok) {
        // Constraint #2(e): auth-failure wipe.
        clearCachedPassword();
        setError("Incorrect account password.");
        setBusy(false);
        return;
      }
      // Verified. Cache the password so later flows (recovery banner,
      // password-change re-encrypt) skip the re-prompt.
      setCachedPassword(passwordInput);
      const pairing = await readPairing(currentUser);
      if (!pairing) {
        setError("Pair Telegram first — there is no bot token to back up yet.");
        setBusy(false);
        return;
      }
      // botFirstName intentionally omitted from the encrypted payload
      // (security-manager constraint #6 — minimum sensitive data on
      // disk). It's a display-only field, repopulated from getMe() on
      // the next polling tick after restore.
      await writeEncryptedBackup(
        currentUser,
        {
          botToken: pairing.botToken,
          chatId: pairing.chatId,
          botUsername: pairing.botUsername,
        },
        passwordInput,
      );
      try {
        await ensureGitignoreEntries([
          "_telegram-encrypted.json",
          "users/*/_telegram-encrypted.json",
        ]);
      } catch {
        /* ignore — gitignore append is best-effort */
      }
      await update({ telegramAutoReconnect: true });
      setBackupExists(true);
      setPasswordInput("");
      setPendingEnable(false);
    } catch (err) {
      console.error("[settings] enable auto-reconnect failed", err);
      setError("Could not write the encrypted backup. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const checked = settings.telegramAutoReconnect && backupExists !== false;

  return (
    <div className="space-y-2">
      <ToggleRow
        label="Auto-reconnect Telegram bot"
        description="When on, your bot token is saved encrypted (using your account password) so ResearchOS can reconnect if the local _telegram.json pairing file is ever lost. The backup never leaves your folder."
        checked={checked}
        onChange={(v) => void handleToggle(v)}
      />
      {pendingEnable && (
        <div className="ml-0 sm:ml-6 p-3 rounded-lg border border-blue-200 bg-blue-50 space-y-2">
          <p className="text-xs text-gray-700">
            Enter your account password to encrypt the bot token. This
            password is also the one you will use to decrypt the backup
            on auto-reconnect.
          </p>
          <div className="relative">
            <input
              type="text"
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleConfirmEnable();
              }}
              autoComplete="off"
              placeholder="Account password"
              className={`w-full pl-3 pr-10 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500${!showPassword ? " [-webkit-text-security:disc]" : ""}`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={cancelPending}
              disabled={busy}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleConfirmEnable()}
              disabled={busy || !passwordInput}
              className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save encrypted backup"}
            </button>
          </div>
        </div>
      )}
      {!pendingEnable && error && (
        <p className="ml-0 sm:ml-6 text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

// Lock affordance for security-manager constraint #2(d). Only renders
// when a password is currently cached in memory (otherwise there is
// nothing to lock, so the row stays hidden to avoid clutter).
//
// Polls hasCachedPassword() on a slow interval because the cache is
// module-global and other surfaces (folder switch, idle timeout, auth
// failure) can clear it asynchronously. The interval is cheap (string
// === null check) and avoids requiring a full subscription bus for one
// affordance.
function LockEncryptedBackupRow() {
  const [cached, setCached] = useState(hasCachedPassword());

  useEffect(() => {
    const id = window.setInterval(() => {
      setCached(hasCachedPassword());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!cached) return null;

  return (
    <div className="space-y-1 pt-1">
      <button
        type="button"
        onClick={() => {
          clearCachedPassword();
          setCached(false);
        }}
        className="px-3 py-1.5 text-xs text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors"
      >
        Lock encrypted backup access
      </button>
      <p className="text-[11px] text-gray-500">
        Clears the in-memory password used by the encrypted Telegram
        backup. You will be prompted again the next time auto-reconnect
        runs.
      </p>
    </div>
  );
}

// ── Data inventory ──────────────────────────────────────────────────────────
//
// Read-only verification surface for the wiki's "data stays on your computer"
// claim. Lists every file the app has written under the user's folder + every
// IndexedDB key the app keeps in the browser. No actions besides Refresh.
// Closes the security audit role brief's affordance #1.

const IDB_KEYS: { key: string; meaning: string; isCredential?: boolean }[] = [
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
  {
    key: "research-os-telegram-token-cache / tokens / {folderName, username}",
    meaning:
      "Recovery cache for your Telegram bot credentials when the on-disk _telegram.json is missing or unreadable (misshared OneDrive deletion, iCloud sync hiccup, manual cleanup). Holds {bot_token, chat_id, bot_username} keyed per folder + user so a lab-mate sharing this folder does NOT see your cached token. Use the Forget button on the right to wipe every cached entry for the current folder.",
    isCredential: true,
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
  const [forgetting, setForgetting] = useState(false);
  const [forgetStatus, setForgetStatus] = useState<{
    text: string;
    kind: "ok" | "err";
  } | null>(null);
  const [encryptedBackup, setEncryptedBackup] = useState<
    { state: "loading" } | { state: "absent" } | { state: "present"; savedAt: string | null }
  >({ state: "loading" });

  const handleForgetTelegramCache = useCallback(async () => {
    if (!directoryName) {
      setForgetStatus({
        text: "No folder is currently connected.",
        kind: "err",
      });
      setTimeout(() => setForgetStatus(null), 4000);
      return;
    }
    setForgetting(true);
    setForgetStatus(null);
    try {
      await forgetAllTelegramTokenCache(directoryName);
      setForgetStatus({
        text: `Wiped Telegram-token cache entries for folder "${directoryName}".`,
        kind: "ok",
      });
    } catch (err) {
      console.error("[Data inventory] Forget Telegram cache failed:", err);
      setForgetStatus({
        text:
          err instanceof Error
            ? err.message
            : "Forget failed. See console for details.",
        kind: "err",
      });
    } finally {
      setForgetting(false);
      setTimeout(() => setForgetStatus(null), 4000);
    }
  }, [directoryName]);

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

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (!currentUser) {
        if (!cancelled) setEncryptedBackup({ state: "absent" });
        return;
      }
      const path = `users/${currentUser}/_telegram-encrypted.json`;
      try {
        const exists = await fileService.fileExists(path);
        if (cancelled) return;
        if (!exists) {
          setEncryptedBackup({ state: "absent" });
          return;
        }
        const sidecar = await fileService.readJson<{ saved_at?: unknown }>(path);
        if (cancelled) return;
        const savedAt =
          sidecar && typeof sidecar.saved_at === "string" ? sidecar.saved_at : null;
        setEncryptedBackup({ state: "present", savedAt });
      } catch (err) {
        console.warn("[Data inventory] encrypted-backup probe failed:", err);
        if (!cancelled) setEncryptedBackup({ state: "absent" });
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const handleManageEncryptedBackup = useCallback(() => {
    if (typeof document === "undefined") return;
    const target = document.getElementById("telegram");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
      searchKeywords="files disk IndexedDB IDB telegram bot backup encrypted forget cache external calls api network privacy"
    >
      <div>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-800">Files on disk</p>
            {scanning && !files ? (
              <p className="text-xs text-gray-500 mt-1">Scanning your folder…</p>
            ) : files ? (
              <p className="text-xs text-gray-500 mt-1">
                <strong>{fileCount}</strong> file{fileCount === 1 ? "" : "s"}{" "}
                across <strong>{dirCount}</strong>{" "}
                {dirCount === 1 ? "group" : "groups"}. All paths are under your
                selected folder.
              </p>
            ) : null}
            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          </div>
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={scanning}
            className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg whitespace-nowrap"
          >
            {scanning ? "Scanning…" : "Refresh"}
          </button>
        </div>
        {grouped && grouped.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 max-h-96 overflow-y-auto space-y-3">
            {grouped.map(([group, paths]) => (
              <div key={group}>
                <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
                  {group}{" "}
                  <span className="text-gray-400 font-normal normal-case">
                    ({paths.length})
                  </span>
                </p>
                <ul className="mt-1 space-y-0.5">
                  {paths.map((p) => (
                    <li key={p}>
                      <code className="text-[11px] text-gray-700 font-mono break-all">
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
          <p className="text-xs text-gray-500">No files found in your folder.</p>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-800">Browser IndexedDB keys</p>
        <p className="text-xs text-gray-500 mt-1 mb-2">
          Five known keys, listed below. Open DevTools → Application → IndexedDB
          to verify.
        </p>
        <ul className="space-y-2">
          {IDB_KEYS.map((k) => (
            <li
              key={k.key}
              className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <code className="text-[11px] text-gray-800 font-mono break-all">
                    {k.key}
                  </code>
                  <p className="text-xs text-gray-600 mt-1">{k.meaning}</p>
                </div>
                {k.isCredential && (
                  <Tooltip
                    label="Wipe every Telegram-token cache entry for this folder"
                    placement="left"
                  >
                    <button
                      type="button"
                      onClick={() => void handleForgetTelegramCache()}
                      disabled={forgetting || !directoryName}
                      className="px-2.5 py-1.5 text-xs bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md whitespace-nowrap shrink-0"
                    >
                      {forgetting ? "Forgetting…" : "Forget"}
                    </button>
                  </Tooltip>
                )}
              </div>
              {k.isCredential && forgetStatus && (
                <p
                  className={`text-xs mt-2 ${
                    forgetStatus.kind === "ok"
                      ? "text-emerald-700"
                      : "text-red-600"
                  }`}
                >
                  {forgetStatus.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-800">
          Telegram bot backup{" "}
          <span
            className={`ml-2 align-middle inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
              encryptedBackup.state === "present"
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                : "bg-gray-100 text-gray-600 ring-1 ring-gray-200"
            }`}
          >
            Encrypted backup:{" "}
            {encryptedBackup.state === "loading"
              ? "…"
              : encryptedBackup.state === "present"
                ? "ON"
                : "OFF"}
          </span>
        </p>
        <div className="flex items-start justify-between gap-3 mt-1">
          <p className="text-xs text-gray-500 leading-relaxed min-w-0 flex-1">
            {encryptedBackup.state === "present" ? (
              <>
                Encrypted backup present at{" "}
                <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
                  users/{currentUser ?? "<u>"}/_telegram-encrypted.json
                </code>
                .{" "}
                {encryptedBackup.savedAt
                  ? `Last saved: ${new Date(encryptedBackup.savedAt).toLocaleString()}.`
                  : "Last saved: unknown (sidecar missing the saved_at field)."}
              </>
            ) : (
              <>
                No encrypted backup. The browser-scoped recovery (IDB cache) is
                still active.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={handleManageEncryptedBackup}
            className="shrink-0 px-2.5 py-1.5 text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md whitespace-nowrap"
          >
            Manage
          </button>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-800">External calls</p>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          When using ResearchOS, your browser makes outbound calls to: (a){" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            api.telegram.org
          </code>{" "}
          directly, if you&apos;ve paired a Telegram bot; (b){" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            /api/calendar-feed
          </code>{" "}
          on this app&apos;s origin, which fetches ICS calendars on your behalf
          with the subscription URL in the{" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            x-calendar-url
          </code>{" "}
          request header; (c){" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            /api/telegram-file
          </code>{" "}
          on this app&apos;s origin, which proxies Telegram CDN file downloads;
          (d){" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            va.vercel-scripts.com
          </code>{" "}
          +{" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            vitals.vercel-insights.com
          </code>{" "}
          for anonymous page-view pings via Vercel Web Analytics and
          anonymous Core Web Vitals via Vercel Speed Insights; and (e){" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            research-os-xi.vercel.app
          </code>{" "}
          only if you click{" "}
          <strong>Pull latest from research-os-xi.vercel.app</strong> in the AI
          Helper section above (a user-initiated, on-demand fetch of the newest
          AI Helper prompt when the bundled copy is stale). Toggle
          &quot;Offline mode&quot; below to disable destinations (b), (c), and
          (d) durably. Direct{" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            api.telegram.org
          </code>{" "}
          polling continues either way since the proxy isn&apos;t on that path.
        </p>
      </div>
    </SectionShell>
  );
}

// ── Data maintenance ────────────────────────────────────────────────────────

interface RepairSummary {
  scanned: number;
  repaired: number;
  alreadyCorrect: number;
  failed: number;
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
          <p className="text-xs text-gray-600">
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
                  className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
                >
                  <input
                    id={id}
                    type="radio"
                    name="trash-cleanup-window"
                    checked={checked}
                    onChange={() => void handleChange(opt.value)}
                    className="text-blue-600 focus:ring-blue-500"
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
          <p className="text-xs text-gray-600 flex-1">
            Open the trash page to restore records back to their original
            location, or permanently delete them ahead of the cleanup window.
          </p>
          <Link
            href="/trash"
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50"
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
        <p className="text-xs text-gray-600">
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
  const [orphanNotice, setOrphanNotice] = useState<number | null>(null);

  // Passive boot-time probe: if the orphan LabArchives sidecars (see
  // SECURITY_AUDIT.md §3.4) are still on disk, surface an amber notice
  // above the section pointing at the cleanup row. Read-only — the user
  // still has to click the button to delete anything.
  useEffect(() => {
    let cancelled = false;
    void scanOrphanLabArchivesFiles()
      .then((found) => {
        if (cancelled) return;
        setOrphanNotice(found.length > 0 ? found.length : null);
      })
      .catch((err) => {
        console.warn("[Settings/Maintenance] orphan scan failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SectionShell
      title="Data maintenance"
      description="Tools for normalising on-disk task and method data. Safe to run any time; reports what it changed."
      searchKeywords="repair method links source paths split lab notes results attachments stamp formats reconcile cross-owner project sharing import experiment zip LabArchives orphan credentials"
    >
      {orphanNotice !== null && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Orphaned LabArchives credential file(s) detected ({orphanNotice}). See the
          &ldquo;Clean up orphaned LabArchives credentials&rdquo; button below.
        </div>
      )}
      <ImportRow onOpen={() => setImportOpen(true)} />
      {importOpen && (
        <ImportExperimentDialog
          isOpen={importOpen}
          onClose={() => setImportOpen(false)}
        />
      )}
      <RepairRow
        title="Repair method links"
        searchDesc="Walks every task in your folder and rewrites the few that still store their linked method in the old method_id field. The app already understands the legacy shape on read; this is for confidence and tidier files on disk."
        description={
          <>
            Walks every task in your folder and rewrites the few that still
            store their linked method in the old <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">method_id</code> field.
            The app already understands the legacy shape on read; this is
            for confidence and tidier files on disk.
          </>
        }
        run={tasksApi.repairMethodLinks}
        invalidateKey={["tasks"]}
      />
      <RepairRow
        title="Repair method source paths"
        searchDesc="Walks every method (private and public) and renames the legacy github_path field to source_path. Same value, just under the new name."
        description={
          <>
            Walks every method (private and public) and renames the legacy <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">github_path</code> field to <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">source_path</code>.
            Same value, just under the new name. The app reads either field
            transparently; this is to retire the old key.
          </>
        }
        run={methodsApi.repairSourcePaths}
        invalidateKey={["methods"]}
      />
      <RepairRow
        title="Split Lab Notes / Results attachments"
        searchDesc="Walks every task you own and splits the shared results/task-N/Files/ and Images/ into per-tab folders notes and results, copying each file into whichever tab body references it and rewriting markdown links to match."
        description={
          <>
            Walks every task you own and splits the shared <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">results/task-N/Files/</code> and <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">results/task-N/Images/</code> into per-tab folders <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">notes/{`{Files,Images}`}</code> and <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">results/{`{Files,Images}`}</code>, copying each file into whichever tab body references it (or both if both reference it) and rewriting markdown links to match.
            Files referenced by neither body are left alone in the legacy folder.
            If you have any leftover <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Attachments/</code> folders from the previous repair button, this step runs that fold-into-<code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Files/</code> migration first.
            The app falls back to the legacy shared folder on read so old data renders without clicking this — the button finishes the long tail.
          </>
        }
        run={splitAllTaskAttachments}
        invalidateKey={["tasks"]}
      />
      <RepairRow
        title="Repair stamp formats"
        searchDesc="Walks every notes, results, and method markdown file and rewrites the legacy stamp header into the new HTML-comment format."
        description={
          <>
            Walks every notes, results, and method markdown file and rewrites the legacy stamp header (the <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">[stamp-start]: # (hidden)</code> block at the top) into the new HTML-comment format.
            Older files render with a stray <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">[stamp-end]: # (hidden)</code> line bleeding into the preview; the app folds these in on first open, but the button finishes any tail you have not visited yet.
          </>
        }
        run={repairStampFormats}
        invalidateKey={["tasks"]}
      />
      <ReconcileRow />
      <LabArchivesOrphanCleanupRow />
    </SectionShell>
  );
}

// ── Orphan LabArchives credential cleanup ───────────────────────────────────
//
// The institutional LabArchives API was removed at 8b1eac3f. Two sidecar
// files it used to write may persist on existing users' disks with plaintext
// credentials in them:
//   - users/<u>/_labarchives.json — connection state
//   - _labarchives-deployer.json (at folder ROOT) — institutional access
//     password in plaintext per AGENTS.md §6 LabArchives trust-model note
// Nothing reads or writes these anymore. Closes SECURITY_AUDIT.md §3.4.

const DEPLOYER_SIDECAR = "_labarchives-deployer.json";
const USER_SIDECAR = "_labarchives.json";

async function scanOrphanLabArchivesFiles(): Promise<string[]> {
  const found: string[] = [];
  if (await fileService.fileExists(DEPLOYER_SIDECAR)) {
    found.push(DEPLOYER_SIDECAR);
  }
  const users = await fileService.listDirectories("users");
  for (const u of users) {
    const path = `users/${u}/${USER_SIDECAR}`;
    if (await fileService.fileExists(path)) {
      found.push(path);
    }
  }
  return found;
}

function LabArchivesOrphanCleanupRow() {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<"info" | "ok" | "err">("info");
  const [orphans, setOrphans] = useState<string[] | null>(null);

  const flashStatus = useCallback((text: string, kind: "ok" | "err") => {
    setStatus(text);
    setStatusKind(kind);
    setTimeout(() => setStatus(null), 4000);
  }, []);

  const handle = useCallback(async () => {
    setRunning(true);
    setStatus(null);
    setOrphans(null);
    try {
      const found = await scanOrphanLabArchivesFiles();
      if (found.length === 0) {
        flashStatus("No orphaned LabArchives files found.", "ok");
        return;
      }
      const ok = window.confirm(
        `Permanently delete ${found.length} orphaned LabArchives credential file(s)?\n\n${found.join("\n")}\n\nThese files were written by the removed institutional API and may contain plaintext credentials.`,
      );
      if (!ok) {
        setOrphans(found);
        return;
      }
      let deleted = 0;
      for (const path of found) {
        const removed = await fileService.deleteFile(path);
        if (removed) deleted += 1;
      }
      flashStatus(
        `Deleted ${deleted} orphaned LabArchives credential file(s).`,
        deleted === found.length ? "ok" : "err",
      );
    } catch (err) {
      console.error("[LabArchives orphan cleanup] failed:", err);
      flashStatus(
        err instanceof Error ? err.message : "Cleanup failed. See console for details.",
        "err",
      );
    } finally {
      setRunning(false);
    }
  }, [flashStatus]);

  return (
    <SearchableRow
      id="orphan:labarchives"
      label="Clean up orphaned LabArchives credentials"
      desc="The institutional LabArchives API was removed, but earlier setups may have left two sidecar files on disk per user. Scans for them and offers to delete."
    >
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800">
          <HighlightedText text="Clean up orphaned LabArchives credentials" />
        </p>
        <p className="text-xs text-gray-500 mt-1">
          The institutional LabArchives API was removed, but earlier setups may
          have left two sidecar files on disk: <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">{DEPLOYER_SIDECAR}</code>{" "}
          at the folder root (institutional access password, plaintext) and{" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">users/&lt;u&gt;/{USER_SIDECAR}</code>{" "}
          per user. Scans for them and offers to delete; nothing reads or writes
          these files anymore.
        </p>
        {orphans && orphans.length > 0 && !status && (
          <p className="text-xs text-amber-700 mt-2">
            Cancelled. {orphans.length} orphan file(s) still on disk: {orphans.join(", ")}
          </p>
        )}
        {status && (
          <p
            className={`text-xs mt-2 ${
              statusKind === "ok"
                ? "text-emerald-700"
                : statusKind === "err"
                ? "text-red-600"
                : "text-gray-600"
            }`}
          >
            {status}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handle}
        disabled={running}
        className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg whitespace-nowrap"
      >
        {running ? "Scanning…" : "Scan + clean"}
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
        <p className="text-sm text-gray-800">
          <HighlightedText text="Import experiment" />
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Bring an experiment exported by another ResearchOS user (a <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">-raw.zip</code> bundle) into your workspace.
          You&apos;ll get a chance to match its project and methods against your own before anything is written.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap"
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
            className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap"
          >
            Open import…
          </button>
        }
        footer={
          <a
            href="/wiki/integrations/labarchives#exporting-from-labarchives"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 underline"
          >
            How to export from LabArchives →
          </a>
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
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-gray-900">{title}</p>
            <Tooltip label={showExplainer ? "Hide details" : "Why this exists"}>
              <button
                type="button"
                onClick={() => setShowExplainer((v) => !v)}
                aria-expanded={showExplainer}
                aria-label={`Explain ${title}`}
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-[10px] font-semibold leading-none"
              >
                ?
              </button>
            </Tooltip>
          </div>
          <p className="text-xs text-gray-500 mt-1">{whatItDoes}</p>
          {showExplainer && (
            <div className="mt-2 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 leading-relaxed">
              {whyExplainer}
              <div className="mt-1.5">
                <Link
                  href={helpHref}
                  className="text-blue-600 hover:underline"
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

function RepairRow({
  title,
  description,
  /** Plain-text mirror of `description` for the page-level search
   *  index. `description` is a React node (often containing `<code>`)
   *  so it can't be substring-searched directly; the caller passes a
   *  flat string here that captures the same vocabulary. Optional —
   *  if absent, only the title is indexed. */
  searchDesc,
  run,
  invalidateKey,
}: {
  title: string;
  description: React.ReactNode;
  searchDesc?: string;
  run: () => Promise<RepairSummary>;
  invalidateKey: readonly string[];
}) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RepairSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const summary = await run();
      setResult(summary);
      await queryClient.refetchQueries({ queryKey: invalidateKey });
    } catch (err) {
      console.error(`[${title}] failed:`, err);
      setError(err instanceof Error ? err.message : "Repair failed. See console for details.");
    } finally {
      setRunning(false);
    }
  }, [run, queryClient, invalidateKey, title]);

  return (
    <SearchableRow id={`repair:${title}`} label={title} desc={searchDesc}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800">
          <HighlightedText text={title} />
        </p>
        <p className="text-xs text-gray-500 mt-1">{description}</p>
        {result && (
          <p className="text-xs text-gray-600 mt-2">
            Scanned <strong>{result.scanned}</strong> · repaired{" "}
            <strong>{result.repaired}</strong> · already clean{" "}
            <strong>{result.alreadyCorrect}</strong>
            {result.failed > 0 && (
              <>
                {" · "}
                <span className="text-red-600">failed <strong>{result.failed}</strong></span>
              </>
            )}
          </p>
        )}
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
      <button
        type="button"
        onClick={handle}
        disabled={running}
        className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg whitespace-nowrap"
      >
        {running ? "Running…" : "Run repair"}
      </button>
    </div>
    </SearchableRow>
  );
}

// Cross-owner sharing reconciler. Mirrors RepairRow's inline status pattern
// but renders the reconcile-specific tally (drops / appends / unknown
// destinations) instead of scanned/repaired/alreadyCorrect/failed. Wires the
// public `reconcileHostedDrift` helper from `lib/sharing/project-hosting`
// using `fetchAllTasksIncludingShared` + `fetchAllProjectsIncludingShared`
// for enumeration. `appendEntry` is implemented inline against `fileService`
// because the project-hosting module keeps the manifest CRUD primitives
// private (they're only re-exported under `__testing__`). Per-task save is
// routed through `tasksApi.update` so any owner-routing rules stay honored.
function ReconcileRow() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReconcileReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const [allTasks, allProjects] = await Promise.all([
        fetchAllTasksIncludingShared(),
        fetchAllProjectsIncludingShared(),
      ]);
      const taskIndex = new Map<string, (typeof allTasks)[number]>();
      for (const t of allTasks) taskIndex.set(`${t.owner}:${t.id}`, t);
      const report = await reconcileHostedDrift({
        hostedManifests: allProjects.map((p) => ({
          projectOwner: p.owner,
          projectId: p.id,
        })),
        tasks: allTasks,
        loadTask: async (owner, id) => taskIndex.get(`${owner}:${id}`) ?? null,
        appendEntry: async (projectOwner, projectId, entry) => {
          const path = hostedManifestPath(projectOwner, projectId);
          const current = await fileService.readJson<Partial<ProjectHostedManifest>>(path);
          const existing: ProjectHostedTaskEntry[] = Array.isArray(current?.hostedTasks)
            ? current!.hostedTasks!
            : [];
          const dedup = existing.some(
            (e) => e.owner === entry.owner && e.taskId === entry.taskId
          );
          await fileService.writeJson<ProjectHostedManifest>(path, {
            version: 1,
            hostedTasks: dedup ? existing : [...existing, entry],
          });
        },
        saveTask: async (owner, task) => {
          // reconcileHostedDrift doesn't actually invoke saveTask today
          // (mirror-drift fix only appends manifest entries); the input is
          // wired for future "clear external_project on unknown destination"
          // policy. Route through tasksApi.update so owner-scoped writes land
          // in the correct dir. Narrow to the fields TaskUpdate accepts —
          // passing a full Task as the patch is a type error.
          await tasksApi.update(
            task.id,
            { external_project: task.external_project ?? null },
            owner
          );
        },
        apply: true,
      });
      setResult(report);
      await queryClient.refetchQueries({ queryKey: ["tasks"] });
    } catch (err) {
      console.error("[Reconcile cross-owner project sharing] failed:", err);
      setError(err instanceof Error ? err.message : "Reconcile failed. See console for details.");
    } finally {
      setRunning(false);
    }
  }, [queryClient]);

  return (
    <SearchableRow
      id="reconcile:cross-owner"
      label="Reconcile cross-owner project sharing"
      desc="Walks every task and every project hosted manifest and fixes drift between the two sides (a hosted task that's no longer marked as external on its origin, or a manifest entry pointing at a deleted task). Safe to run anytime; no destructive operations beyond pruning broken refs."
    >
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800">
          <HighlightedText text="Reconcile cross-owner project sharing" />
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Walks every task and every project hosted manifest and fixes drift between the two sides
          (a hosted task that&apos;s no longer marked as external on its origin, or a manifest entry
          pointing at a deleted task). Safe to run anytime; no destructive operations beyond pruning
          broken refs.
        </p>
        {result && (
          <p className="text-xs text-gray-600 mt-2">
            Reconcile complete: <strong>{result.manifestDropped.length}</strong> drops ·{" "}
            <strong>{result.mirrorDriftAppended.length}</strong> appends ·{" "}
            <strong>{result.unknownDestinations.length}</strong> unknown destinations
          </p>
        )}
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
      <button
        type="button"
        onClick={handle}
        disabled={running}
        className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg whitespace-nowrap"
      >
        {running ? "Running…" : "Run reconcile"}
      </button>
    </div>
    </SearchableRow>
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
    blurb: "~10k tokens, fits everywhere",
  },
  {
    value: "full",
    label: "Full (recommended)",
    blurb:
      "~22k tokens, best for drafting on big-context models like Claude Sonnet, GPT-5, Gemini 2.5 Pro",
  },
  {
    value: "minimal",
    label: "Minimal",
    blurb: "~3k tokens, for tiny windows or local models",
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

  // Inline 4s toast, mirrors the TipsSection / RepairRow pattern.
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
          <p className="text-sm font-medium text-gray-800 mb-2">Pick a size</p>
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
                      ? "border-blue-300 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
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
                    <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{opt.blurb}</p>
                    {sizeTokens !== undefined && sizeBytes !== undefined && (
                      <p className="text-[10px] text-gray-400 mt-1">
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
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg"
          >
            {loadingSize === selectedSize
              ? "Loading prompt…"
              : promptReady
                ? "Copy prompt to clipboard"
                : "Prompt unavailable"}
          </button>
          {fetchError && (
            <p className="text-xs text-red-600 mt-2">{fetchError}</p>
          )}
        </div>

        {/* Open-in provider buttons */}
        <div>
          <p className="text-sm font-medium text-gray-800 mb-2">Open in your AI</p>
          <div className="flex flex-wrap gap-2">
            {AI_HELPER_PROVIDERS.map((provider) => (
              <button
                key={provider.key}
                type="button"
                onClick={() => handleOpenIn(provider)}
                disabled={!promptReady}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-gray-800 rounded-lg"
              >
                {provider.label}
                <span aria-hidden className="text-gray-400">↗</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Each &ldquo;Open in&rdquo; button copies the prompt and opens the provider in a new tab.
            Paste it as your first message, or save it as a Claude Project / Custom GPT / Gem for a
            persistent helper.
          </p>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-2">
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
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            {status}
          </p>
        )}

        {/* Freshness footer */}
        <div className="pt-3 border-t border-gray-100 text-xs text-gray-500">
          {manifestError ? (
            <p className="text-amber-700">
              Couldn&apos;t load freshness info: {manifestError}
            </p>
          ) : !manifest ? (
            <p>Loading prompt manifest…</p>
          ) : (
            <p>
              Last refreshed: {builtDate} · helper_version {manifest.helper_version} · ResearchOS @{" "}
              <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">{shortManifestCommit}</code>
            </p>
          )}
        </div>

        {/* Stale-prompt callout (only when running-app commit differs from
            manifest commit; suppressed in demo/fixture mode). */}
        {showStaleCallout && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-2">
            <p>
              <span aria-hidden>⚠ </span>
              These prompts are from{" "}
              <code className="px-1 py-0.5 bg-amber-100 rounded text-[10px]">
                {shortManifestCommit}
              </code>{" "}
              but the running app is at{" "}
              <code className="px-1 py-0.5 bg-amber-100 rounded text-[10px]">
                {shortRunningCommit}
              </code>
              . They may be older than the running app.
            </p>
            <button
              type="button"
              onClick={() => void handlePullLatest()}
              disabled={pullingLive}
              className="px-2.5 py-1 text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md"
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <Link
            href={`/ai-helper/${selectedSize}.md`}
            target="_blank"
            className="text-blue-600 hover:underline"
          >
            View prompt source →
          </Link>
        </div>
      </div>
    </SectionShell>
  );
}

/**
 * Onboarding section. Surfaces the "Re-run welcome tour" button that
 * resets the v4 sidecar completion/skip/resume fields + clears
 * feature_picks (so Phase 1 setup runs again), then calls
 * `tourController.start()` to re-fire the v4 walkthrough in place
 * (no page reload). The legacy "tips mode picker" + "Replay tips"
 * controls were removed with sidecar v3 -> v4 (P0 of the Onboarding
 * v3 arc per ONBOARDING_V3_PROPOSAL.md §10); the v4 walkthrough
 * subsumes both.
 */
function TipsSection() {
  const { currentUser } = useFileSystem();
  const tourController = useOptionalTourController();
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Wave 1 sidecar hardening manager (v2): orphan-artifact recovery
  // banner. On mount (and when the active user changes) we read the
  // sidecar's artifacts-created count, scoped to the case where the
  // wizard wholesale ended (completed OR skipped). A positive count
  // means a prior tour left demo data on the real account that the
  // end-of-tour auto-cleanup never reached. The amber banner below
  // surfaces the count and pushes the user toward the existing Re-run
  // CTA, which runs the tour through to its auto-cleanup sweep.
  const [orphanedArtifactCount, setOrphanedArtifactCount] = useState(0);

  useEffect(() => {
    if (!currentUser) {
      setOrphanedArtifactCount(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const count = await countOrphanedArtifacts(currentUser);
        if (!cancelled) setOrphanedArtifactCount(count);
      } catch (err) {
        // Best-effort probe; an unreadable sidecar means we just don't
        // show the banner. The Re-run CTA itself still works.
        console.warn(
          "[Settings/Tips] orphan-artifact probe failed",
          err,
        );
        if (!cancelled) setOrphanedArtifactCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const handleRerunWizard = useCallback(async () => {
    if (!currentUser) return;
    setBusy(true);
    setStatus(null);
    try {
      // Clear all v4 completion / skip / resume + feature_picks so the
      // tour starts from a clean slate (Phase 1 setup re-runs, then
      // the in-product walkthrough). wizard_force_show is cleared too:
      // V3's DevForceTipButton compat path is gone after the V3 rip
      // (Phase B 2026-05-22) and v4's TourController never consulted
      // that flag.
      await patchOnboarding(currentUser, (cur) => ({
        ...cur,
        wizard_completed_at: null,
        wizard_skipped_at: null,
        wizard_resume_state: null,
        feature_picks: null,
        wizard_force_show: false,
        lab_tour_pending: false,
        lab_tour_dismissed_at: null,
      }));
      // Reset the controller's in-memory feature_picks snapshot so the
      // re-run's gating machine sees the cleared picks immediately.
      tourController?.setFeaturePicks(null);
      setStatus("Re-running the tour. BeakerBot is on the way.");
      setTimeout(() => {
        setBusy(false);
        router.push("/");
        // TourBootstrap is one-shot per mount with `[username, previewMode]`
        // deps. V4MountForUser sits in providers.tsx ABOVE every route, so
        // TourBootstrap does NOT remount on `router.push("/")`; its sidecar
        // probe ran once at first login and never re-fires. Calling start()
        // directly is the only thing that gets the tour out the door after
        // a re-run. The prior "navigate to / and let TourBootstrap re-probe
        // naturally" path quietly no-opped (this surfaced as "click re-run,
        // land on home, nothing happens"). The earlier comment here feared
        // an infinite re-probe loop on every /wiki/* visit, but the deps
        // were narrowed to `[username, previewMode]` long ago, so a fresh
        // start() write to the sidecar can not re-trigger the probe.
        //
        // The first applicable step's `expectedRoute` auto-navigate effect
        // in TourController routes to home if the router.push has not yet
        // landed by the time start() flips currentStep to "welcome".
        tourController?.start();
      }, 600);
    } catch (err) {
      console.error("[Settings/Tips] re-run wizard failed", err);
      setStatus("Couldn't reset. See console for details.");
      setBusy(false);
    }
  }, [currentUser, tourController, router]);

  return (
    <SectionShell
      title="Onboarding"
      tourTarget="settings-rerun-section"
      description="Re-run the welcome tour to revisit setup picks and the BeakerBot walkthrough on your real account."
      searchKeywords="welcome tour walkthrough tips BeakerBot replay re-run reset wizard"
    >
      {orphanedArtifactCount > 0 && (
        <div
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid="settings-orphan-artifact-banner"
        >
          Your previous tour left {orphanedArtifactCount} demo
          {orphanedArtifactCount > 1 ? " items" : " item"} in your folder.
          Re-running the tour will offer to clean
          {orphanedArtifactCount > 1 ? " them" : " it"} up at the end.
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-800">Re-run welcome tour</p>
          <p className="text-xs text-gray-500 mt-1">
            Launches the BeakerBot walkthrough again. New users see
            this once on first sign-in; existing users can opt back in
            here.
          </p>
          {status && <p className="text-xs text-emerald-600 mt-2">{status}</p>}
        </div>
        <button
          type="button"
          onClick={handleRerunWizard}
          disabled={busy || !currentUser}
          data-testid="settings-rerun-welcome-tour"
          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg whitespace-nowrap"
        >
          {busy ? "Resetting..." : "Re-run tour"}
        </button>
      </div>
      {/* Revisit the first-time-visitor landing ("sell") page. It is gated
          to truly-new visitors at "/", so a connected user can only re-see
          it via this dedicated /welcome route. (landing-page manager) */}
      <div className="mt-4 flex items-start justify-between gap-4 border-t border-gray-100 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-800">View the welcome page</p>
          <p className="text-xs text-gray-500 mt-1">
            Revisit the landing page new visitors see on their very first
            open, with the overview of what ResearchOS does.
          </p>
        </div>
        <Link
          href="/welcome"
          data-testid="settings-view-welcome-page"
          className="px-3 py-2 text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg whitespace-nowrap"
        >
          View welcome page
        </Link>
      </div>
      {process.env.NODE_ENV === "development" && (
        <div className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
          <Link
            href="/dev/beakerbot-gallery"
            data-testid="settings-beakerbot-gallery-link"
            className="text-blue-600 hover:underline"
          >
            BeakerBot Gallery (dev)
          </Link>
          <span className="ml-2 text-gray-400">
            Browse every BeakerBot pose and scene in one place.
          </span>
        </div>
      )}
    </SectionShell>
  );
}

function SecuritySection({
  pwExists,
  onOpen,
}: {
  pwExists: boolean | null;
  onOpen: () => void;
}) {
  return (
    <SectionShell
      title="Security"
      description="A password blocks accidental sign-in to this account from inside the app. It does not encrypt files on disk."
      searchKeywords="password lock login sign-in"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-gray-800">
            Password is currently{" "}
            <span className={pwExists ? "text-emerald-600 font-medium" : "text-gray-500"}>
              {pwExists === null ? "…" : pwExists ? "set" : "not set"}
            </span>
            .
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Same flow as the lock icon on the login screen.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap"
        >
          {pwExists ? "Change password" : "Set password"}
        </button>
      </div>
    </SectionShell>
  );
}

// ── Offline mode ────────────────────────────────────────────────────────────
//
// Closes the role brief's affordance #2: a single switch that stops the two
// browser → own-server proxy calls (`/api/calendar-feed`, `/api/telegram-file`).
// Direct browser → Telegram polling continues because that talks to
// api.telegram.org directly and Telegram cannot function otherwise.

function OfflineModeSection({ settings, update }: SectionProps) {
  return (
    <SectionShell
      title="Offline mode"
      description="Disable the two proxy routes (/api/calendar-feed and /api/telegram-file) so the app makes no calls to its own server. Useful if you want zero outbound network from the app surface."
      searchKeywords="network proxy server outbound block disable api"
    >
      <ToggleRow
        label="Block calls to our server"
        description="External calendar feeds stop syncing and Telegram file downloads stop. Direct Telegram polling still works (it talks to api.telegram.org from the browser, not through our proxy)."
        checked={settings.offlineMode}
        onChange={(v) => void update({ offlineMode: v })}
      />
      {settings.offlineMode && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Offline mode active. Calendar feeds and Telegram file downloads are blocked.
          Direct Telegram polling still works.
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
      <label className="block text-xs font-medium text-gray-700 mb-1">
        <HighlightedText text={label} />
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          <p className="text-sm text-gray-800">
            <HighlightedText text={label} />
          </p>
          {description && (
            <p className="text-xs text-gray-500 mt-0.5">
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
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-4" : "translate-x-0.5"
            } translate-y-0.5`}
          />
        </button>
      </label>
    </SearchableRow>
  );
}

