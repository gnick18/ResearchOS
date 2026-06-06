"use client";

// /profile — "your stuff". The Twitter-profile-tab metaphor (Grant 2026-06-05):
// what you control about yourself, split out of the general Settings page and
// the Sharing section. Holds your appearance (name, avatar color, ORCID, header
// tint) and your researcher profile (affiliation, publications). Discovering
// OTHER people lives on /researchers, the social hub, not here.

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import AppShell from "@/components/AppShell";
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

export default function ProfilePage() {
  return (
    <AppShell>
      <ProfileBody />
    </AppShell>
  );
}

function ProfileBody() {
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
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <h2 className="text-heading font-semibold text-foreground">
            Your profile
          </h2>
          <p className="text-body text-foreground-muted leading-relaxed">
            Connect to a research folder and pick a user to edit your profile.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
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
      </div>

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
