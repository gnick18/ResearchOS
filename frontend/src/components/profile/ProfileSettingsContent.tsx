"use client";

// The body of "Your profile" (appearance + researcher profile), extracted from
// the /profile page so it can render BOTH as that standalone route AND inside
// the ProfileSettingsModal popup. Holds its own settings load + save; the caller
// provides the outer scroll / width container.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import AppearanceCard from "@/components/profile/AppearanceCard";
import SharingProviderButtons from "@/components/sharing/SharingProviderButtons";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import { ProfileEditorCard } from "@/components/settings/SharingSection";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { useAppStore } from "@/lib/store";
import { USER_COLOR_QUERY_KEY } from "@/hooks/useUserColor";
import {
  readUserSettings,
  patchUserSettings,
  type UserSettings,
} from "@/lib/settings/user-settings";

export default function ProfileSettingsContent() {
  const { currentUser, isConnected } = useFileSystem();
  const sharing = useSharingIdentity();
  const queryClient = useQueryClient();
  const hydrateFromSettings = useAppStore((s) => s.hydrateFromSettings);

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

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
      if (cancelled) return;
      setSettings(s);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isConnected]);

  // Same save contract the Settings page uses, kept slim. Optimistic local set,
  // persist, then keep the in-memory store and the avatar color map in sync so
  // the header tint and every bubble react immediately.
  const update = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!currentUser || !settings) return;
      setSettings({ ...settings, ...patch });
      const saved = await patchUserSettings(currentUser, patch);
      setSettings(saved);
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
      if (patch.color !== undefined || patch.colorSecondary !== undefined) {
        queryClient.invalidateQueries({ queryKey: USER_COLOR_QUERY_KEY });
      }
    },
    [currentUser, settings, hydrateFromSettings, queryClient],
  );

  if (!isConnected || !currentUser) {
    return (
      <div className="max-w-md mx-auto text-center space-y-3 py-8">
        <h2 className="text-heading font-semibold text-foreground">
          Your profile
        </h2>
        <p className="text-body text-foreground-muted leading-relaxed">
          Connect to a research folder and pick a user to edit your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-heading font-semibold text-foreground">
          Your profile
        </h1>
        <p className="text-body text-foreground-muted mt-1 leading-relaxed">
          Everything you control about how you show up in ResearchOS. To find
          other researchers, head to the directory.
        </p>
      </div>

      {loading || !settings ? (
        <p className="text-body text-foreground-muted">Loading your profile…</p>
      ) : (
        <AppearanceCard
          currentUser={currentUser}
          settings={settings}
          update={update}
        />
      )}

      {/* Researcher profile. Shown when a sharing identity is ready, otherwise
          a friendly nudge to set one up with the four sign-in buttons. */}
      {sharing.status === "ready" ? (
        <ProfileEditorCard />
      ) : sharing.status === "none" ? (
        <section className="bg-surface-raised rounded-xl border border-border p-6">
          <div className="mb-4">
            <h2 className="text-title font-semibold text-foreground">
              Researcher profile
            </h2>
            <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
              Set up sharing to claim a researcher profile, so colleagues can
              find you and confirm your fingerprint before sending you work.
            </p>
          </div>
          <SharingProviderButtons onProvider={() => setWizardOpen(true)} />
        </section>
      ) : (
        <section className="bg-surface-raised rounded-xl border border-border p-6">
          <h2 className="text-title font-semibold text-foreground">
            Researcher profile
          </h2>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            Your identity is set up, but its key is not on this device. Restore
            it from Settings to edit your researcher profile here.
          </p>
        </section>
      )}

      {wizardOpen && currentUser && (
        <SharingSetupWizard
          username={currentUser}
          onComplete={() => {
            void sharing.refresh();
          }}
          onClose={() => {
            setWizardOpen(false);
            void sharing.refresh();
          }}
        />
      )}
    </div>
  );
}
