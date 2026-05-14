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
import { isLabArchivesConfigured } from "@/lib/labarchives/config";
import {
  clearDeployerCreds,
  hasDeployerCreds,
  readDeployerCreds,
  writeDeployerCreds,
  type DeployerCreds,
} from "@/lib/labarchives/deployer-store";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
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
        <SidebarSection settings={settings} update={update} />
        <DefaultsSection settings={settings} update={update} />
        <AnimationSection settings={settings} update={update} />
        <BehaviorSection settings={settings} update={update} />
        <LabArchivesSection username={currentUser} />
        <MaintenanceSection />
        <SecuritySection
          pwExists={pwExists}
          onOpen={() => setPwOpen(true)}
        />
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
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
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

// ── Data maintenance ────────────────────────────────────────────────────────

interface RepairSummary {
  scanned: number;
  repaired: number;
  alreadyCorrect: number;
  failed: number;
}

function MaintenanceSection() {
  const [importOpen, setImportOpen] = useState(false);
  return (
    <SectionShell
      title="Data maintenance"
      description="Tools for normalising on-disk task and method data. Safe to run any time; reports what it changed."
    >
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
    </SectionShell>
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

/** Where the integration's institutional credentials are coming from on
 *  the current deployment. Drives the status pill copy + which Settings
 *  cards render expanded vs collapsed. `"env"` and `"sidecar"` both mean
 *  "configured (signed calls will work)" — they differ only in source. */
type LabArchivesConfigSource = "env" | "sidecar" | "none";

function LabArchivesSection({ username }: { username: string }) {
  const [elnImportOpen, setElnImportOpen] = useState(false);
  // Env-flag source is sync (process.env), sidecar source is async (FSA).
  // The env-flag answer is known immediately; the sidecar probe resolves
  // after mount. Both feed into a single `source` value via useMemo so
  // we don't store derivable state.
  const envConfigured = isLabArchivesConfigured();
  // Result of the FSA sidecar probe (false until proven otherwise).
  const [sidecarPresent, setSidecarPresent] = useState(false);
  // Bump this to force the deployer-setup card and the connection row to
  // re-read after a Save/Clear.
  const [sidecarRev, setSidecarRev] = useState(0);

  // In capture mode the wiki manager can opt out of the purple "Demo mode"
  // pill by setting `?labArchivesConfigured=…` — that lets them capture the
  // green ("configured") and amber ("not available yet") variants of the
  // status pill from a static fixture. See `isLabArchivesConfigured()` in
  // `lib/labarchives/config.ts` for the param shape.
  const demoMode = isDemoOrWikiCapture() && !hasLabArchivesCaptureOverride();

  // Skip the sidecar probe entirely in env-var mode (no value to show)
  // and in capture mode (fixture folder must not surface as real creds).
  const shouldProbeSidecar = !envConfigured && !demoMode && !isDemoOrWikiCapture();

  // Probe the sidecar after mount. Returns null on skip; the effect only
  // writes state from the async resolution path so the lint rule
  // (`react-hooks/set-state-in-effect`) stays happy.
  useEffect(() => {
    if (!shouldProbeSidecar) return;
    let cancelled = false;
    void hasDeployerCreds().then((has) => {
      if (!cancelled) setSidecarPresent(has);
    });
    return () => {
      cancelled = true;
    };
  }, [shouldProbeSidecar, sidecarRev]);

  // Derived: which config source wins. Env > sidecar > none.
  const source: LabArchivesConfigSource = envConfigured
    ? "env"
    : shouldProbeSidecar && sidecarPresent
      ? "sidecar"
      : "none";

  const configured = source !== "none";

  return (
    <SectionShell
      title="LabArchives"
      description="Two ways to bring LabArchives data into ResearchOS — bulk-import offline notebooks, or connect your account so the importer can fetch online-only inline images."
    >
      <LabArchivesConfigState source={source} demoMode={demoMode} />

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
            turns that ZIP into native ResearchOS tasks. PDF formats are
            coming in a later version. Other ELNs aren&apos;t supported
            yet.
          </>
        }
        helpHref="/wiki/integrations/labarchives#import"
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

      <LabArchivesOptionCard
        title="Connect to LabArchives"
        whatItDoes={
          <>
            Sign in to your LabArchives account so ResearchOS can fetch the{" "}
            <strong>inline images that aren&apos;t bundled</strong> in the
            offline ZIP and write them into your imported notes.
          </>
        }
        whyExplainer={
          <>
            LabArchives stores inline images two ways: as binary files
            inside the notebook page (called Form-A), and as URLs back to
            their cloud (called Form-B). When you generate an offline
            export ZIP, only the Form-A images come along — the Form-B
            ones are left as broken references. Connecting your account
            lets the import wizard call the LabArchives API for each
            Form-B URL, download the bytes, and rewrite the markdown to
            point at the local copy. Without it, those references stay as
            <code className="px-1 py-0.5 mx-0.5 bg-gray-100 rounded text-[10px]">
              missing-…
            </code>{" "}
            placeholders you can clean up later from the broken-image
            popup.
          </>
        }
        helpHref="/wiki/integrations/labarchives#connecting-your-account"
        action={
          configured ? (
            <LabArchivesConnectionRow username={username} variant="card" />
          ) : (
            <Tooltip label="Connection unavailable until the institutional API credentials are set — either via env vars or the Deployer setup card below.">
              <button
                type="button"
                disabled
                className="px-3 py-2 text-sm bg-gray-100 text-gray-400 rounded-lg whitespace-nowrap cursor-not-allowed"
              >
                Connect
              </button>
            </Tooltip>
          )
        }
        footer={null}
      />

      {/* Deployer setup card — sidecar-mode credential entry. Hidden in
          demo mode (we don't want anyone writing real creds into the
          fixture folder) and hidden when env vars are already supplying
          the creds (no need to override). */}
      {!demoMode && source !== "env" && (
        <LabArchivesDeployerSetupCard
          configuredViaSidecar={source === "sidecar"}
          onSaved={() => setSidecarRev((r) => r + 1)}
          onCleared={() => setSidecarRev((r) => r + 1)}
        />
      )}
    </SectionShell>
  );
}

/** True only when the page URL carries the `labArchivesConfigured` capture
 *  override (any value). Lets the LabArchives section show its green /
 *  amber pill states under `?wikiCapture=1` instead of the purple "Demo
 *  mode" pill. Returns false on the server / before hydration. */
function hasLabArchivesCaptureOverride(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("labArchivesConfigured") !== null;
  } catch {
    return false;
  }
}

function LabArchivesConfigState({
  source,
  demoMode,
}: {
  source: LabArchivesConfigSource;
  demoMode: boolean;
}) {
  if (demoMode) {
    return (
      <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900">
        Demo mode — LabArchives requests are skipped and the buttons below
        won&apos;t reach the real API.
      </div>
    );
  }
  if (source === "env") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        <span className="font-medium">Configured (server env vars)</span> —
        the institutional API credentials are set in this deployment&apos;s
        environment.
      </div>
    );
  }
  if (source === "sidecar") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        <span className="font-medium">Configured (saved in your data folder)</span>{" "}
        — the institutional API credentials are stored locally in{" "}
        <code className="px-1 py-0.5 bg-emerald-100/60 rounded text-[10px]">
          _labarchives-deployer.json
        </code>
        . Both options below are live.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
      <p className="font-medium">
        Image-fetch isn&apos;t configured yet on this deployment.
      </p>
      <p>
        Importing offline ZIPs still works — but inline images that
        LabArchives stores online won&apos;t come down automatically.
        Enter the institutional API credentials in the{" "}
        <strong>Deployer setup</strong> card below, or have a deployer set
        the matching env vars.{" "}
        <Link
          href="/wiki/integrations/labarchives#deployer-setup"
          className="underline hover:no-underline"
        >
          Setup guide →
        </Link>
      </p>
    </div>
  );
}

/** Sidecar-mode credential entry. Two password inputs (akid + access
 *  password), an optional region picker (US/AU/EU), and Save / Clear /
 *  Test buttons. Persists to `_labarchives-deployer.json` at the data
 *  folder root via `deployer-store.ts`.
 *
 *  Trust-model reminder (mirrored in `deployer-store.ts`): the
 *  `access_password` lives plaintext on disk. Equivalent to a plaintext
 *  `.env.local`. Fine for local-first self-host; not recommended for
 *  multi-tenant deployments. */
function LabArchivesDeployerSetupCard({
  configuredViaSidecar,
  onSaved,
  onCleared,
}: {
  configuredViaSidecar: boolean;
  onSaved: () => void;
  onCleared: () => void;
}) {
  // Collapsed when sidecar already configured — avoid offering the inputs
  // by default because filling them again is destructive (overwrite).
  // Expanded by default when not configured so first-run setup is obvious.
  const [expanded, setExpanded] = useState(!configuredViaSidecar);
  const [akid, setAkid] = useState("");
  const [pw, setPw] = useState("");
  const [region, setRegion] = useState<"us" | "au" | "eu" | "custom">("us");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [showExplainer, setShowExplainer] = useState(false);
  const [busy, setBusy] = useState<"none" | "saving" | "clearing">("none");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Load the existing sidecar (if any) when the user expands the card,
  // so they can see / re-edit the existing entry rather than blindly
  // overwriting it. We don't preload on mount — keeps the input boxes
  // empty when collapsed for password-manager paranoia.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void readDeployerCreds().then((c) => {
      if (cancelled || !c) return;
      setAkid(c.accessKeyId);
      setPw(c.accessPassword);
      const url = c.baseUrl ?? "";
      if (url === "" || url === "https://api.labarchives.com/api") {
        setRegion("us");
        setCustomBaseUrl("");
      } else if (url === "https://auapi.labarchives.com/api") {
        setRegion("au");
        setCustomBaseUrl("");
      } else if (url === "https://euapi.labarchives.com/api") {
        setRegion("eu");
        setCustomBaseUrl("");
      } else {
        setRegion("custom");
        setCustomBaseUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  const handleSave = useCallback(async () => {
    setError(null);
    setBusy("saving");
    try {
      const creds: DeployerCreds = {
        accessKeyId: akid,
        accessPassword: pw,
      };
      let url: string | undefined;
      if (region === "au") url = "https://auapi.labarchives.com/api";
      else if (region === "eu") url = "https://euapi.labarchives.com/api";
      else if (region === "custom") {
        const trimmed = customBaseUrl.trim();
        if (trimmed !== "") url = trimmed;
      }
      // "us" → leave undefined (deployer-store uses default).
      if (url !== undefined) creds.baseUrl = url;
      await writeDeployerCreds(creds);
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy("none");
    }
  }, [akid, pw, region, customBaseUrl, onSaved]);

  const handleClear = useCallback(async () => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Remove the saved LabArchives deployer credentials? You'll need to re-enter them before signed calls will work again.",
      );
      if (!ok) return;
    }
    setError(null);
    setBusy("clearing");
    try {
      await clearDeployerCreds();
      setAkid("");
      setPw("");
      setRegion("us");
      setCustomBaseUrl("");
      setSavedAt(null);
      onCleared();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed.");
    } finally {
      setBusy("none");
    }
  }, [onCleared]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-gray-900">Deployer setup</p>
            <Tooltip label={showExplainer ? "Hide details" : "Why this exists"}>
              <button
                type="button"
                onClick={() => setShowExplainer((v) => !v)}
                aria-expanded={showExplainer}
                aria-label="Explain Deployer setup"
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-[10px] font-semibold leading-none"
              >
                ?
              </button>
            </Tooltip>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Enter the institutional LabArchives API credentials for this
            ResearchOS install. Stored locally in your data folder as{" "}
            <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">
              _labarchives-deployer.json
            </code>
            {configuredViaSidecar ? " (currently active)." : "."}
          </p>
          {showExplainer && (
            <div className="mt-2 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 leading-relaxed space-y-1">
              <p>
                Two ways to configure the integration: (i) set{" "}
                <code className="px-1 py-0.5 bg-white border border-gray-200 rounded text-[10px]">
                  LABARCHIVES_ACCESS_KEY_ID
                </code>{" "}
                and{" "}
                <code className="px-1 py-0.5 bg-white border border-gray-200 rounded text-[10px]">
                  LABARCHIVES_ACCESS_PASSWORD
                </code>{" "}
                env vars on the deployment, or (ii) paste them here. Env
                vars win when both are present.
              </p>
              <p className="text-amber-800">
                <strong>Trade-off:</strong> the access password lives
                plaintext on disk in your data folder. Equivalent to
                plaintext{" "}
                <code className="px-1 py-0.5 bg-white border border-amber-200 rounded text-[10px]">
                  .env.local
                </code>
                ; fine for single-user local-first installs, not recommended
                for shared deployments.
              </p>
              <div className="pt-0.5">
                <Link
                  href="/wiki/integrations/labarchives#deployer-setup"
                  className="text-blue-600 hover:underline"
                >
                  Read more in the wiki →
                </Link>
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0">
          {expanded ? (
            <Tooltip label="Hide the credential inputs">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg whitespace-nowrap"
              >
                Hide
              </button>
            </Tooltip>
          ) : (
            <Tooltip label="Show inputs to enter or update the credentials">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap"
              >
                {configuredViaSidecar ? "Edit" : "Set up"}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-gray-100 pt-3">
          <div>
            <label
              htmlFor="la-akid"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Access Key ID (akid)
            </label>
            <input
              id="la-akid"
              type="password"
              autoComplete="off"
              value={akid}
              onChange={(e) => setAkid(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Institutional access key id"
            />
          </div>
          <div>
            <label
              htmlFor="la-pw"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Access Password
            </label>
            <input
              id="la-pw"
              type="password"
              autoComplete="off"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Institutional access password"
            />
          </div>
          <div>
            <p className="block text-xs font-medium text-gray-700 mb-1">
              Region
            </p>
            <div className="flex flex-wrap gap-3 text-xs text-gray-700">
              {(["us", "au", "eu", "custom"] as const).map((r) => (
                <label key={r} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="la-region"
                    value={r}
                    checked={region === r}
                    onChange={() => setRegion(r)}
                  />
                  <span>
                    {r === "us"
                      ? "US (default)"
                      : r === "au"
                        ? "AU"
                        : r === "eu"
                          ? "EU / UK"
                          : "Custom URL"}
                  </span>
                </label>
              ))}
            </div>
            {region === "custom" && (
              <input
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://api.labarchives.com/api"
                className="mt-2 w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            )}
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="text-[11px] text-gray-500">
              {savedAt && !error ? (
                <span className="text-emerald-700">Saved at {savedAt}.</span>
              ) : error ? (
                <span className="text-red-700">{error}</span>
              ) : (
                <>Credentials write to your data folder, not env vars.</>
              )}
            </div>
            <div className="flex items-center gap-2">
              {configuredViaSidecar && (
                <button
                  type="button"
                  onClick={() => void handleClear()}
                  disabled={busy !== "none"}
                  className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy === "clearing" ? "Clearing…" : "Clear"}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={busy !== "none" || akid.trim() === "" || pw.trim() === ""}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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

function LabArchivesConnectionRow({ username, variant = "row" }: { username: string; variant?: "row" | "card" }) {
  const [connection, setConnection] = useState<{
    uid: string;
    fullname: string | null;
    email: string | null;
    connectedAt: string;
  } | null>(null);
  const [busy, setBusy] = useState<"none" | "connecting" | "disconnecting">("none");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/labarchives/tokens-store").then(async (mod) => {
      const c = await mod.readConnection(username);
      if (!cancelled) setConnection(c);
    });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const handleConnect = useCallback(async () => {
    setBusy("connecting");
    setError(null);
    try {
      const mod = await import("@/lib/labarchives/connect");
      const c = await mod.connectLabArchives(username);
      setConnection(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy("none");
    }
  }, [username]);

  const handleDisconnect = useCallback(async () => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Disconnect LabArchives? You'll need to sign in again the next time you import a notebook with online-only images.",
      );
      if (!ok) return;
    }
    setBusy("disconnecting");
    setError(null);
    try {
      const mod = await import("@/lib/labarchives/tokens-store");
      await mod.clearConnection(username);
      setConnection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setBusy("none");
    }
  }, [username]);

  // Card variant: just the status pill + connect/disconnect button —
  // descriptive copy lives on the parent `<LabArchivesOptionCard>`.
  if (variant === "card") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {connection ? (
          <>
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={busy !== "none"}
              className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {busy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
            </button>
            <p className="text-[11px] text-emerald-700 text-right">
              Connected as{" "}
              <span className="font-medium">
                {connection.fullname ?? connection.email ?? connection.uid}
              </span>
            </p>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void handleConnect()}
            disabled={busy !== "none"}
            className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {busy === "connecting" ? "Signing in…" : "Connect"}
          </button>
        )}
        {error && (
          <p className="text-[11px] text-red-700 text-right max-w-[14rem]">{error}</p>
        )}
      </div>
    );
  }

  // Legacy "row" variant — preserved in case any other surface still
  // wants the standalone row layout. Not currently rendered.
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800">LabArchives connection</p>
        <p className="text-xs text-gray-500 mt-1">
          Used during ELN import to fetch online-only inline images that
          aren&apos;t bundled in the offline ZIP.
        </p>
        {connection && (
          <p className="text-xs text-gray-700 mt-1">
            Connected as{" "}
            <span className="font-medium">
              {connection.fullname ?? connection.email ?? connection.uid}
            </span>
          </p>
        )}
        {error && (
          <p className="text-xs text-red-700 mt-1">{error}</p>
        )}
      </div>
      {connection ? (
        <button
          type="button"
          onClick={() => void handleDisconnect()}
          disabled={busy !== "none"}
          className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {busy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handleConnect()}
          disabled={busy !== "none"}
          className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {busy === "connecting" ? "Signing in…" : "Connect"}
        </button>
      )}
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

