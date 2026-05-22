"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import AccountPasswordPopup from "@/components/AccountPasswordPopup";
import ImportExperimentDialog from "@/components/ImportExperimentDialog";
import ImportELNDialog from "@/components/import-eln/ImportELNDialog";
import Tooltip from "@/components/Tooltip";
import UserAvatar from "@/components/UserAvatar";
import { useFileSystem } from "@/lib/file-system/file-system-context";
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
import { ANIMATION_METADATA, type AnimationType } from "@/components/animations";
import { hasPassword, verifyPassword } from "@/lib/auth/password";
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
import { patchOnboarding } from "@/lib/onboarding/sidecar";
import { useOptionalTourController } from "@/components/onboarding/v4/TourController";
import { forgetAllTelegramTokenCache } from "@/lib/telegram/telegram-token-cache";
import StreaksSection from "./StreaksSection";

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
      <SettingsBody />
    </AppShell>
  );
}

function SettingsBody() {
  const { currentUser, isConnected } = useFileSystem();
  const hydrateFromSettings = useAppStore((s) => s.hydrateFromSettings);
  const queryClient = useQueryClient();

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recentlySaved, setRecentlySaved] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwExists, setPwExists] = useState<boolean | null>(null);

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
        // If color changed, invalidate the user-color map so every <UserAvatar />
        // in the app re-renders with the new gradient on the next paint.
        if (patch.color !== undefined) {
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
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-500 mt-1">
              Stored in <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">users/{currentUser}/settings.json</code>
            </p>
          </div>
          <SavedIndicator saving={saving} recentlySaved={recentlySaved} />
        </header>

        {/* key={currentUser} resets each section's local draft state when
            the lab user switches mid-session, so we never show user A's
            half-typed display-name draft to user B. */}
        <ProfileSection key={`profile-${currentUser}`} settings={settings} update={update} />
        <TabsSection settings={settings} update={update} />
        <LabArchivesSection />
        <AIHelperSection />
        <SidebarSection settings={settings} update={update} />
        <DefaultsSection settings={settings} update={update} />
        <AnimationSection settings={settings} update={update} />
        <BehaviorSection settings={settings} update={update} />
        <StreaksSection />
        <DataInventorySection />
        <MaintenanceSection />
        <TipsSection />
        <SecuritySection
          pwExists={pwExists}
          onOpen={() => setPwOpen(true)}
        />
        <OfflineModeSection settings={settings} update={update} />
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
    </div>
  );
}

function SavedIndicator({ saving, recentlySaved }: { saving: boolean; recentlySaved: boolean }) {
  if (saving) return <span className="text-xs text-gray-500">Saving…</span>;
  if (recentlySaved) return <span className="text-xs text-emerald-600">Saved</span>;
  return null;
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
}) {
  return (
    <section
      id={id}
      data-tour-target={tourTarget}
      className="bg-white rounded-xl border border-gray-200 p-6 scroll-mt-4"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
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
    >
      {/* Live avatar preview — colorOverride uses the in-flight pick so the
          gradient updates instantly before the save round-trip completes. */}
      <div className="flex items-center gap-4">
        {currentUser && (
          <UserAvatar
            username={currentUser}
            size="xl"
            letter={(draftName.charAt(0) || currentUser.charAt(0))}
            colorOverride={settings.color}
          />
        )}
        <div className="text-xs text-gray-500">
          <p className="text-sm text-gray-800 font-medium">{draftName.trim() || currentUser}</p>
          <p className="mt-0.5">Preview of your avatar gradient.</p>
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

      <div data-tour-target="settings-color-picker">
        <label className="block text-xs font-medium text-gray-700 mb-2">User color</label>
        <div className="flex flex-wrap gap-2">
          {USER_COLOR_PALETTE.map((c) => {
            const selected = c.toLowerCase() === settings.color.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => void update({ color: c })}
                data-color-swatch={c}
                className={`w-8 h-8 rounded-full border-2 transition-transform ${
                  selected ? "border-gray-900 scale-110" : "border-transparent hover:scale-105"
                }`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
      </div>

      <ToggleRow
        label="Tint header with my color"
        description="When off, the top bar stays white. Your avatar bubbles around the app still use your color either way."
        checked={settings.coloredHeader}
        onChange={(v) => void update({ coloredHeader: v })}
      />
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

  return (
    <SectionShell
      title="Tabs"
      description="Pick which tabs show up in the header. Home is always shown so you have a guaranteed landing spot. Settings (this page) is always reachable via the gear icon."
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

function AnimationSection({ settings, update }: SectionProps) {
  const types = Object.keys(ANIMATION_METADATA) as AnimationType[];
  return (
    <SectionShell
      title="Animation"
      description="Plays when you complete a task. Pick the one that suits your vibe."
    >
      <div className="grid grid-cols-2 gap-2">
        {types.map((type) => {
          const meta = ANIMATION_METADATA[type];
          const selected = settings.animationType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => void update({ animationType: type })}
              className={`flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
                selected ? "border-purple-400 bg-purple-50" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <span className="text-xl">{meta.icon}</span>
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
    </SectionShell>
  );
}

function BehaviorSection({ settings, update }: SectionProps) {
  // The walkthrough opens against the demo lab in a new tab — same
  // pattern as the welcome modal's "Walk me through it" button.
  // `noopener` keeps the tutorial tab from holding a handle to this
  // tab's window, matching what we use for the full-tour link.
  const openTelegramWalkthrough = () => {
    if (typeof window !== "undefined") {
      window.open("/demo?tutorial=telegram", "_blank", "noopener");
    }
  };

  return (
    <SectionShell
      id="telegram"
      title="Notifications & behavior"
      description="Master switches for messaging and safety prompts."
    >
      {/* Alias anchor so `/settings#behavior` also lands on this section
          (some docs/links use the section's title word rather than the
          original `#telegram` id). */}
      <span id="behavior" aria-hidden="true" />
      <div className="flex items-start justify-between gap-4 pb-2 border-b border-gray-100">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">Set up Telegram</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Walks you through pairing your Telegram bot and texting your
            first photo — runs in a demo tab so your real folder stays
            untouched.
          </p>
        </div>
        <button
          type="button"
          onClick={openTelegramWalkthrough}
          className="shrink-0 px-3 py-1.5 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg shadow-sm transition-colors"
        >
          Set up Telegram
        </button>
      </div>
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
      <ToggleRow
        label="Hide my goals from lab view"
        description="When on, other lab members won't see your goals in their aggregated lab view. Mirrored to the shared user metadata file."
        checked={settings.hideGoalsFromLab}
        onChange={(v) => void update({ hideGoalsFromLab: v })}
      />
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
          with the URL in a header; (c){" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            /api/telegram-file
          </code>{" "}
          on this app&apos;s origin, which proxies Telegram CDN file downloads;
          and (d){" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            va.vercel-scripts.com
          </code>{" "}
          +{" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
            vitals.vercel-insights.com
          </code>{" "}
          for anonymous page-view pings via Vercel Web Analytics. Toggle
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
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800">Clean up orphaned LabArchives credentials</p>
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
  );
}

function ImportRow({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800">Import experiment</p>
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
  run,
  invalidateKey,
}: {
  title: string;
  description: React.ReactNode;
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
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800">{title}</p>
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
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800">Reconcile cross-owner project sharing</p>
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
// Gemini.
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
// Per AI_HELPER_PROPOSAL.md "Automation contract" items 5 + 6 + the
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
    label: "Lean (recommended)",
    blurb: "~10k tokens, fits everywhere",
  },
  {
    value: "full",
    label: "Full",
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
  key: "claude" | "chatgpt" | "gemini";
  label: string;
  url: string;
}> = [
  { key: "claude", label: "Claude", url: "https://claude.ai/new" },
  { key: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { key: "gemini", label: "Gemini", url: "https://gemini.google.com/app" },
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

  const [selectedSize, setSelectedSize] = useState<AIHelperSize>("lean");
  // Cache fetched markdown per size so size-flip + re-copy doesn't re-fetch.
  const [promptBySize, setPromptBySize] = useState<Partial<Record<AIHelperSize, string>>>({});
  const [loadingSize, setLoadingSize] = useState<AIHelperSize | null>("lean");
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
      description="Train your own AI chatbot to know ResearchOS inside out. Paste this prompt into Claude, ChatGPT, or Gemini and the chatbot becomes a schema-aware support assistant."
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
            (claude.ai, chatgpt.com, gemini.google.com). Your Claude Max / ChatGPT Plus /
            Gemini Advanced subscription works fine. You do <em>not</em> need an Anthropic /
            OpenAI / Google API key, and your chat-tier subscription does not include API
            credits.
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

        {/* Footer links */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <Link
            href="/wiki/integrations/ai-helper"
            className="text-blue-600 hover:underline"
          >
            Read setup guide →
          </Link>
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
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleRerunWizard = useCallback(async () => {
    if (!currentUser) return;
    setBusy(true);
    setStatus(null);
    try {
      // Clear all v4 completion / skip / resume + feature_picks so the
      // tour starts from a clean slate (Phase 1 setup re-runs, then
      // the in-product walkthrough). wizard_force_show is kept as a
      // dev affordance for the v3 DevForceTipButton compat path; v4's
      // TourController does not consult that flag.
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
      // re-run's gating machine sees the cleared picks immediately,
      // then start the tour at the first applicable step.
      tourController?.setFeaturePicks(null);
      tourController?.start();
      setStatus("Re-running the tour. BeakerBot is on the way.");
      setTimeout(() => setBusy(false), 600);
    } catch (err) {
      console.error("[Settings/Tips] re-run wizard failed", err);
      setStatus("Couldn't reset. See console for details.");
      setBusy(false);
    }
  }, [currentUser, tourController]);

  return (
    <SectionShell
      title="Onboarding"
      description="Re-run the welcome tour to revisit setup picks and the BeakerBot walkthrough on your real account."
    >
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
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
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
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <div className="min-w-0">
        <p className="text-sm text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
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
  );
}

