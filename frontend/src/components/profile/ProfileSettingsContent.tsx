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
import CreateLocalIdentityStep from "@/components/sharing/CreateLocalIdentityStep";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import SharingSection, {
  ProfileEditorCard,
  RotateIdentityPopup,
  RestoreIdentityPopup,
  DisconnectIdentityPopup,
  ResetIdentityPopup,
} from "@/components/settings/SharingSection";
import CloudStorageLauncher from "@/components/billing/CloudStorageLauncher";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { useAppStore } from "@/lib/store";
import { listInbox } from "@/lib/sharing/relay/client";
import { USER_COLOR_QUERY_KEY } from "@/hooks/useUserColor";
import {
  readUserSettings,
  patchUserSettings,
  type UserSettings,
} from "@/lib/settings/user-settings";
import {
  isRequireAccountEnabled,
  isStandaloneLocalKeypairCreateVisible,
} from "@/lib/account/require-account";

export default function ProfileSettingsContent() {
  const { currentUser, isConnected } = useFileSystem();
  const sharing = useSharingIdentity();
  // Capability gates (account/cloud/inbox) route through the unified model;
  // sharing is kept only for the identity DATA read (email) below.
  const caps = useAccountCapabilities();
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
  // Create-account flow (P-local model, IDENTITY_OAUTH_ONLY.md 2026-06-06). The
  // account is a LOCAL keypair minted offline with no OAuth, so the none-state
  // leads with this instead of the provider buttons (which dead-end where OAuth
  // is unconfigured). Publishing a findable profile stays an optional later step.
  const [createOpen, setCreateOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // Pending-share count drives the warnings in the rotate / disconnect / reset
  // modals. Same query the old Settings surface used.
  const sharingInbox = useQuery({
    queryKey: ["sharing-inbox", sharing.email],
    queryFn: () => listInbox({ email: sharing.email as string }),
    enabled: caps.canAccessInbox,
    staleTime: 30_000,
    retry: false,
  });
  const pendingShareCount =
    caps.canAccessInbox &&
    !sharingInbox.isError &&
    sharingInbox.data !== undefined
      ? sharingInbox.data.length
      : null;

  // Account-creation reconciliation under require-account (docs/proposals/
  // 2026-06-16-require-account-local-first.md). The keypair is NEVER retired,
  // it is the E2E identity that keeps data local and encrypted. What changes is
  // HOW a solo (unclaimed) user mints it. Under require-account the keypair is
  // created through the OAuth claim flow (a published identity from the start),
  // so the standalone "offline keypair now, publish later optionally" card is
  // gated off and the transitional local-only user is routed into the same
  // claim/publish migration the pivot names (SharingSetupWizard). The offline
  // create stays as the fallback whenever no OAuth claim path exists, so a
  // no-OAuth build never soft-locks a user out of setting up their account.
  const showStandaloneCreate = isStandaloneLocalKeypairCreateVisible({
    requireAccount: isRequireAccountEnabled(),
    oauthPublishAvailable: caps.oauthAvailable,
  });

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
        navLayout: saved.navLayout ?? null,
        defaultLandingTab: saved.defaultLandingTab,
        sidebarShowTasks: saved.sidebarShowTasks,
        sidebarShowCalendarEvents: saved.sidebarShowCalendarEvents,
        sidebarEventsHorizonDays: saved.sidebarEventsHorizonDays,
        coloredHeader: saved.coloredHeader,
        showCompanionButton: saved.showCompanionButton,
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
      {caps.mode === "account" && <ProfileEditorCard />}

      {/* Cloud storage glance + entry into the consolidated billing popup, right
          under your profile, above the technical account/keys section. The popup
          owns all billing (solo cap + payment + lab sponsorship). Self-hides for
          local-only users. */}
      {caps.canUseCloud && <CloudStorageLauncher />}

      {/* Account and keys + Inbox and storage + Cloud storage (moved here from
          Settings, 2026-06-06, this is your account, not an app setting). When
          no account exists on this device yet, lead with creating one. Under the
          P-local model (IDENTITY_OAUTH_ONLY.md) the account is a LOCAL keypair
          minted offline with no OAuth, so this opens CreateLocalIdentityStep,
          the same flow the shared-folder login gate uses. Publishing a findable
          profile (OAuth, or email) becomes the optional secondary step, offered
          by SharingSection once the keypair exists. */}
      {caps.mode === "solo" ? (
        showStandaloneCreate ? (
          <section className="bg-surface-raised rounded-xl border border-border p-6">
            <div className="mb-4">
              <h2 className="text-title font-semibold text-foreground">
                Set up your account
              </h2>
              <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
                Your account is a keypair created on this device. It works
                offline, with no password and no sign-in, and it is what proves
                it is you when you share work. You can publish a findable profile
                later so colleagues can look you up, that part is optional.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body rounded-lg font-medium shadow-sm"
            >
              Create your account
            </button>
          </section>
        ) : (
          // Require-account: this folder predates the pivot (a local-only user
          // with no claimed identity). Route into the OAuth claim/publish
          // migration so the keypair is minted as a published identity, rather
          // than the standalone offline-keypair card. Data is untouched, the
          // private key still never leaves this device, so E2E is preserved.
          <section className="bg-surface-raised rounded-xl border border-border p-6">
            <div className="mb-4">
              <h2 className="text-title font-semibold text-foreground">
                Finish setting up your account
              </h2>
              <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
                Your account is a keypair on this device, so your work stays
                encrypted and on your own machine even after you sign in. Sign in
                to claim your account and publish a findable profile so
                colleagues can look you up. Your private key never leaves this
                device.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setWizardStep("choose");
                setWizardOpen(true);
              }}
              className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body rounded-lg font-medium shadow-sm"
            >
              Sign in to set up your account
            </button>
          </section>
        )
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

      {/* Create-account modal, the local-keypair path. createLocalIdentity mints
          the keypair offline, parks the unlocked key in the session, and writes
          the sidecar, so on complete we just refresh and the surface flips to the
          identity card (status "ready"). Closing may leave a created account
          behind (the keypair is minted before the recovery code shows), so we
          refresh either way. */}
      {createOpen && currentUser && (
        <CreateLocalIdentityStep
          username={currentUser}
          onComplete={() => {
            setCreateOpen(false);
            void sharing.refresh();
          }}
          onClose={() => {
            setCreateOpen(false);
            void sharing.refresh();
          }}
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
