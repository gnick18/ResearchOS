"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import AccountPasswordPopup from "@/components/AccountPasswordPopup";
import ImportExperimentDialog from "@/components/ImportExperimentDialog";
import ImportELNDialog from "@/components/import-eln/ImportELNDialog";
import Tooltip from "@/components/Tooltip";
import UserAvatar from "@/components/UserAvatar";
import { useFileSystem } from "@/lib/file-system/file-system-context";
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
import { hasPassword } from "@/lib/auth/password";
import { USER_COLOR_QUERY_KEY } from "@/hooks/useUserColor";
import {
  readOnboarding,
  replayOnboarding,
  setOnboardingMode,
  type OnboardingMode,
} from "@/lib/onboarding/sidecar";

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

  // Scroll-to-hash on mount. Next.js App Router applies the URL hash
  // before the page's sections have rendered, so a router.push to
  // "/settings#telegram" lands at the top of the page. Re-apply the
  // scroll after a render tick so the section is in the DOM.
  // Triggered by onboarding-tip setupActions navigating here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const handle = window.setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(handle);
  }, []);

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recentlySaved, setRecentlySaved] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwExists, setPwExists] = useState<boolean | null>(null);

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
    <div className="flex-1 overflow-y-auto">
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
        <SidebarSection settings={settings} update={update} />
        <DefaultsSection settings={settings} update={update} />
        <AnimationSection settings={settings} update={update} />
        <BehaviorSection settings={settings} update={update} />
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
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Optional fragment-id anchor — used by deep-links like
   *  `/settings#telegram` and `/settings#personalize` (fired by the
   *  Telegram and Personalize-Colors onboarding tips' setupActions). */
  id?: string;
}) {
  return (
    <section id={id} className="bg-white rounded-xl border border-gray-200 p-6 scroll-mt-4">
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

      <div>
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
  return (
    <SectionShell
      id="telegram"
      title="Notifications & behavior"
      description="Master switches for messaging and safety prompts."
    >
      <ToggleRow
        label="Telegram notifications"
        description="When off, the app stops polling Telegram for inbound photos and updates."
        checked={settings.telegramNotifications}
        onChange={(v) => void update({ telegramNotifications: v })}
      />
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
          Four known keys, listed below. Open DevTools → Application → IndexedDB
          to verify.
        </p>
        <ul className="space-y-2">
          {IDB_KEYS.map((k) => (
            <li
              key={k.key}
              className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
            >
              <code className="text-[11px] text-gray-800 font-mono break-all">
                {k.key}
              </code>
              <p className="text-xs text-gray-600 mt-1">{k.meaning}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <p className="text-sm font-medium text-gray-800">External calls</p>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          When using ResearchOS, your browser makes outbound calls only to: (a){" "}
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
          on this app&apos;s origin, which proxies Telegram CDN file downloads.
          Nothing else.
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
            data-onboarding-target="labarchives-import"
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

/**
 * Tips replay surface. Clicking the button clears the user's per-tip
 * dismiss history, flips `tips_off` back on, and resets `last_tip_at`
 * to the current `active_seconds` so the cooldown starts fresh. The
 * orchestrator picks up the change on its next sidecar read (which it
 * re-runs on every load), so there's no provider-side notify needed
 * here — the user navigates back to the home page and the system
 * fires when the dwell + cooldown allow.
 *
 * Toast is a single inline status message that auto-clears after 4s,
 * mirroring the lightweight feedback pattern used by `RepairRow`.
 */
function TipsSection() {
  const { currentUser } = useFileSystem();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Current mode (from sidecar). `null` = the user hasn't picked yet
   *  via the welcome modal; we treat it as `"suggestions"` in the
   *  radio UI since the modal blocks this surface from being useful
   *  before the user picks. */
  const [mode, setMode] = useState<OnboardingMode>(null);
  const [modeLoading, setModeLoading] = useState(true);

  // Pull the current mode on mount so the radio reflects what's
  // actually on disk. Re-read after a mode change to keep the UI in
  // sync if persist fails halfway.
  useEffect(() => {
    if (!currentUser) {
      setModeLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sc = await readOnboarding(currentUser);
        if (!cancelled) setMode(sc.mode);
      } catch (err) {
        console.error("[Settings/Tips] readOnboarding failed", err);
      } finally {
        if (!cancelled) setModeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const handleReplay = useCallback(async () => {
    if (!currentUser) return;
    setBusy(true);
    setStatus(null);
    try {
      await replayOnboarding(currentUser);
      setStatus("Tips re-enabled. They'll fire as you visit pages again.");
      setTimeout(() => setStatus(null), 4000);
    } catch (err) {
      console.error("[Settings/Tips] replay failed", err);
      setStatus("Couldn't reset tips. See console for details.");
    } finally {
      setBusy(false);
    }
  }, [currentUser]);

  const handleModeChange = useCallback(
    async (next: Exclude<OnboardingMode, null>) => {
      if (!currentUser) return;
      setStatus(null);
      // Optimistic update — the radio flips instantly. If persist
      // fails we revert below.
      const previous = mode;
      setMode(next);
      try {
        await setOnboardingMode(currentUser, next);
      } catch (err) {
        console.error("[Settings/Tips] setOnboardingMode failed", err);
        setMode(previous);
        setStatus("Couldn't save that. See console for details.");
      }
    },
    [currentUser, mode],
  );

  // Effective radio value — `null` rendered as "suggestions" since
  // that's the visual default. The user can still click a different
  // option to persist a real pick.
  const effectiveMode: Exclude<OnboardingMode, null> =
    mode === "tutorial" || mode === "silenced" ? mode : "suggestions";

  return (
    <SectionShell
      title="Tips"
      description="Brand-new orientation tips show in a small card with a friendly mascot pointing at the affordance."
    >
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-800">How should I help?</p>
        <div className="flex flex-col gap-2">
          {(
            [
              {
                value: "tutorial",
                label: "Walk me through it",
                desc: "Force-fire each tip one after another, 60s apart. Best on day one.",
              },
              {
                value: "suggestions",
                label: "Show me as I go",
                desc: "Land a tip about every 5 minutes when the matching feature is on screen.",
              },
              {
                value: "silenced",
                label: "Stay quiet, thanks",
                desc: "No tips at all. You can flip this back on any time.",
              },
            ] as const
          ).map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                effectiveMode === opt.value
                  ? "border-blue-300 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              } ${modeLoading || !currentUser ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name="onboarding-mode"
                value={opt.value}
                checked={effectiveMode === opt.value}
                disabled={modeLoading || !currentUser}
                onChange={() => void handleModeChange(opt.value)}
                className="mt-0.5"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 pt-3 border-t border-gray-100">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-800">
            Show me the onboarding tips again
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Re-fires the whole tip sequence. They land one at a time, only on
            pages where the affordance actually exists.
          </p>
          {status && <p className="text-xs text-emerald-600 mt-2">{status}</p>}
        </div>
        <button
          type="button"
          onClick={handleReplay}
          disabled={busy || !currentUser}
          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg whitespace-nowrap"
        >
          {busy ? "Resetting…" : "Replay tips"}
        </button>
      </div>
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

