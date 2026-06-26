"use client";

// SecurityKeysPanel: the folder-FREE half of the consolidated Settings
// "Security & keys" section (P3 of the thin-account-settings-home refactor).
//
// Renders the sign-in email + the device-key status / provision / unlock /
// recovery UI, driven by useDeviceKeyProvisioning (the proven path lifted from
// AccountHubShell). It is self-contained and prop-light, it fetches its own
// sign-in email (getSession) and display name (/api/account/profile), so it
// mounts identically whether a data folder is connected or not. The
// folder-scoped controls (app password, user switch) live in a SEPARATE block
// in settings/page.tsx and are omitted when no folder is connected.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { getSession } from "next-auth/react";

import { useDeviceKeyProvisioning } from "@/components/settings/use-device-key-provisioning";
import RecoveryKitModal from "@/components/sharing/RecoveryKitModal";

const inputCls =
  "w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action";

export default function SecurityKeysPanel() {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("");

  const {
    showUnlock,
    recoveryInput,
    setRecoveryInput,
    unlocking,
    unlockError,
    unlocked,
    onUnlock,
    showProvision,
    provisioning,
    provisionError,
    keyReady,
    onProvision,
    kit,
    confirmKit,
    dismissKit,
  } = useDeviceKeyProvisioning();

  // Self-fetch the sign-in email so the panel is prop-light.
  useEffect(() => {
    let alive = true;
    void getSession().then((s) => {
      if (!alive) return;
      setSessionEmail(s?.user?.email ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Self-fetch the published display name (the name the provision step stamps
  // on the identity). Cloud-only, no folder read.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/account/profile");
        const data = (await res.json().catch(() => ({}))) as {
          profile?: { displayName?: string | null } | null;
        };
        if (!alive) return;
        if (data.profile?.displayName) setDisplayName(data.profile.displayName);
      } catch {
        /* ignore, display name is optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-heading font-extrabold tracking-tight text-foreground">
          Security and keys
        </h2>
        <p className="mt-1 text-body text-foreground-muted">
          Encryption keys, recovery, and sign-in.
        </p>
      </div>

      {/* Sign-in email */}
      {sessionEmail && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-meta font-semibold text-foreground-muted">
            Sign-in email
          </p>
          <p className="mt-0.5 text-body font-medium text-foreground">
            {sessionEmail}
          </p>
        </div>
      )}

      {/* Key states (folder-free) */}
      {unlocked && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <h3 className="text-body font-bold text-foreground">
            Your data is unlocked on this device
          </h3>
          <p className="mt-1 text-meta text-foreground-muted">
            Your keys are live for this session. Connect your data folder to
            pick up your work.
          </p>
        </div>
      )}
      {showUnlock && !unlocked && (
        <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
          <h3 className="text-body font-bold text-foreground">
            Unlock your data on this device
          </h3>
          <p className="mt-1 text-meta text-foreground-muted">
            This browser does not have your encryption keys yet. Enter your
            recovery words to unlock your shared and encrypted data here. Your
            keys are restored on this device only.
          </p>
          <textarea
            className={`${inputCls} mt-3 font-mono`}
            value={recoveryInput}
            onChange={(e) => setRecoveryInput(e.target.value)}
            placeholder="Enter your recovery words or recovery code"
            rows={2}
            autoCapitalize="none"
            spellCheck={false}
            disabled={unlocking}
          />
          {unlockError && (
            <p className="mt-2 text-meta text-rose-600">{unlockError}</p>
          )}
          <button
            type="button"
            onClick={() => void onUnlock()}
            disabled={unlocking || !recoveryInput.trim()}
            className="mt-3 rounded-lg bg-brand-purple px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
          >
            {unlocking ? "Unlocking…" : "Unlock my data"}
          </button>
        </div>
      )}
      {keyReady && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <h3 className="text-body font-bold text-foreground">
            Your data key is set up
          </h3>
          <p className="mt-1 text-meta text-foreground-muted">
            You can now share and publish. Your key is live for this session.
          </p>
        </div>
      )}
      {showProvision && !keyReady && (
        <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
          <h3 className="text-body font-bold text-foreground">
            Set up your data key
          </h3>
          <p className="mt-1 text-meta text-foreground-muted">
            Sharing and publishing use end-to-end encryption keys that live on
            your device, never on our servers. Set yours up now, no data folder
            needed.
          </p>
          {provisionError && (
            <p className="mt-2 text-meta text-rose-600">{provisionError}</p>
          )}
          <button
            type="button"
            onClick={() => void onProvision(displayName)}
            disabled={provisioning}
            className="mt-3 rounded-lg bg-brand-purple px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
          >
            {provisioning ? "Setting up…" : "Set up my data key"}
          </button>
        </div>
      )}

      {/* Recovery kit modal (portal-level) */}
      {kit && (
        <RecoveryKitModal
          recoveryWords={kit.recoveryWords}
          recoveryCode={kit.recoveryCode}
          onConfirm={confirmKit}
          onClose={dismissKit}
        />
      )}
    </div>
  );
}
