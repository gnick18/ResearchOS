"use client";

// The body of "Your profile" (appearance + researcher profile), extracted from
// the /profile page so it can render BOTH as that standalone route AND inside
// the ProfileSettingsModal popup. Holds its own settings load + save; the caller
// provides the outer scroll / width container.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import AppearanceCard from "@/components/profile/AppearanceCard";
import SharingProviderButtons from "@/components/sharing/SharingProviderButtons";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import { startSharingClaimOAuth } from "@/lib/sharing/claim-oauth";
import SharingSection, {
  ProfileEditorCard,
  RotateIdentityPopup,
  RestoreIdentityPopup,
  DisconnectIdentityPopup,
  ResetIdentityPopup,
} from "@/components/settings/SharingSection";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { useAppStore } from "@/lib/store";
import { listInbox } from "@/lib/sharing/relay/client";
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
  // Sharing-identity flows (moved here from Settings, 2026-06-06): setup wizard
  // plus the rotate / restore / disconnect / reset modals that act on the
  // "Account and keys" identity card.
  const [wizardOpen, setWizardOpen] = useState(false);
  // Which step the wizard opens on: "email-enter" for the "Use email instead"
  // link (provider buttons go straight to OAuth and never open it), "choose" for
  // the reset re-establish path.
  const [wizardStep, setWizardStep] = useState<"choose" | "email-enter">(
    "choose",
  );
  const [rotateOpen, setRotateOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // Pending-share count drives the warnings in the rotate / disconnect / reset
  // modals. Same query the old Settings surface used.
  const sharingInbox = useQuery({
    queryKey: ["sharing-inbox", sharing.email],
    queryFn: () => listInbox({ email: sharing.email as string }),
    enabled: sharing.status === "ready" && !!sharing.email,
    staleTime: 30_000,
    retry: false,
  });
  const pendingShareCount =
    sharing.status === "ready" &&
    !sharingInbox.isError &&
    sharingInbox.data !== undefined
      ? sharingInbox.data.length
      : null;

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

      {/* Researcher profile (public) leads when the key is on this device, it
          is the friendly thing people edit most. The technical "Account and
          keys" identity, inbox, and storage sit below it. */}
      {sharing.status === "ready" && <ProfileEditorCard />}

      {/* Account and keys + Inbox and storage + Cloud storage (moved here from
          Settings, 2026-06-06, this is your account, not an app setting). When
          nothing is set up yet, lead with the friendly four-button sign-in
          instead of the plain identity stub. */}
      {sharing.status === "none" ? (
        <section className="bg-surface-raised rounded-xl border border-border p-6">
          <div className="mb-4">
            <h2 className="text-title font-semibold text-foreground">
              Set up sharing
            </h2>
            <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
              Claim your account so colleagues can find you and confirm your
              fingerprint before sending you work. It takes about a minute and
              you stay in control of your keys.
            </p>
          </div>
          <SharingProviderButtons onProvider={startSharingClaimOAuth} />
          <button
            type="button"
            onClick={() => {
              setWizardStep("email-enter");
              setWizardOpen(true);
            }}
            className="mt-3 text-meta text-foreground-muted hover:text-foreground underline"
          >
            Use email instead
          </button>
        </section>
      ) : (
        <SharingSection
          currentUser={currentUser}
          sharing={sharing}
          onSetUp={() => setWizardOpen(true)}
          onRotate={() => setRotateOpen(true)}
          onRestore={() => setRestoreOpen(true)}
          onDisconnect={() => setDisconnectOpen(true)}
          onReset={() => setResetOpen(true)}
        />
      )}

      {/* Appearance (color picker, display name, ORCID, header tint) last. */}
      {loading || !settings ? (
        <p className="text-body text-foreground-muted">Loading your profile…</p>
      ) : (
        <AppearanceCard
          currentUser={currentUser}
          settings={settings}
          update={update}
        />
      )}

      {wizardOpen && currentUser && (
        <SharingSetupWizard
          username={currentUser}
          initialStep={wizardStep}
          onComplete={() => {
            void sharing.refresh();
          }}
          onClose={() => {
            setWizardOpen(false);
            void sharing.refresh();
          }}
        />
      )}
      {rotateOpen && currentUser && (
        <RotateIdentityPopup
          username={currentUser}
          sidecar={sharing.sidecar}
          pendingCount={pendingShareCount}
          onClose={() => {
            setRotateOpen(false);
            void sharing.refresh();
          }}
        />
      )}
      {restoreOpen && currentUser && (
        <RestoreIdentityPopup
          username={currentUser}
          sidecar={sharing.sidecar}
          onClose={() => {
            setRestoreOpen(false);
            void sharing.refresh();
          }}
        />
      )}
      {disconnectOpen && currentUser && (
        <DisconnectIdentityPopup
          username={currentUser}
          pendingCount={pendingShareCount}
          onClose={() => {
            setDisconnectOpen(false);
            void sharing.refresh();
          }}
        />
      )}
      {resetOpen && currentUser && (
        <ResetIdentityPopup
          username={currentUser}
          pendingCount={pendingShareCount}
          onConfirmed={() => {
            // Sidecar + local key gone, account reads as unclaimed. Hand
            // straight to the setup wizard to mint a fresh keypair.
            setResetOpen(false);
            void sharing.refresh();
            setWizardStep("choose");
            setWizardOpen(true);
          }}
          onClose={() => {
            setResetOpen(false);
            void sharing.refresh();
          }}
        />
      )}
    </div>
  );
}
