"use client";

// useDeviceKeyProvisioning: the folder-FREE device-key state machine.
//
// This hook holds the exact state cluster + probe effect + provision + unlock
// logic that used to live inline in AccountHubShell.renderSecurity (the only
// folder-free security path of the three). It reads NO data folder. Every
// dependency is cloud, device-vault, or localStorage backed:
//   provisionDeviceKeyForAccount, recoverDeviceKeyFromCloud, hasCloudBackup,
//   loadKeysAtRest, getSessionIdentity, isDeviceKeyV2Enabled, markRecovery
//   Confirmed.
//
// AccountHubShell consumes this hook unchanged (pure refactor); the new
// folderless Settings "Security & keys" panel (P3) consumes the same hook, so
// the proven provision/unlock path is carried forward identically rather than
// rewritten.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";

import { isDeviceKeyV2Enabled } from "@/lib/sharing/identity/device-key-v2";
import { loadKeysAtRest } from "@/lib/sharing/identity/device-vault";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import {
  hasCloudBackup,
  recoverDeviceKeyFromCloud,
} from "@/lib/sharing/identity/cloud-restore";
import { provisionDeviceKeyForAccount } from "@/lib/sharing/identity/provision";
import { markRecoveryConfirmed } from "@/lib/sharing/identity/recovery-confirm";

export interface RecoveryKit {
  recoveryWords: string;
  recoveryCode: string;
  fingerprint: string;
}

export interface DeviceKeyProvisioning {
  // Unlock (restore from cloud backup) state.
  showUnlock: boolean;
  recoveryInput: string;
  setRecoveryInput: (value: string) => void;
  unlocking: boolean;
  unlockError: string | null;
  unlocked: boolean;
  /** Run the cloud restore using the typed recovery words / code. */
  onUnlock: () => Promise<void>;

  // Provision (set up a brand-new key) state.
  showProvision: boolean;
  provisioning: boolean;
  provisionError: string | null;
  keyReady: boolean;
  /**
   * Provision a fresh device key. Pass the display name to stamp on the
   * published identity (the caller owns the name source so the hook reads no
   * folder).
   */
  onProvision: (displayName: string) => Promise<void>;

  // Recovery kit modal payload (non-null after a successful provision).
  kit: RecoveryKit | null;
  /** Confirm + dismiss the recovery kit (marks the fingerprint confirmed). */
  confirmKit: () => void;
  /** Dismiss the recovery kit without confirming. */
  dismissKit: () => void;
}

/**
 * Folder-free device-key provisioning + unlock state machine. Lifted verbatim
 * from AccountHubShell so both the account hub and the consolidated Settings
 * "Security & keys" panel drive the same proven path.
 */
export function useDeviceKeyProvisioning(): DeviceKeyProvisioning {
  const [showUnlock, setShowUnlock] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [kit, setKit] = useState<RecoveryKit | null>(null);
  const [keyReady, setKeyReady] = useState(false);

  // Key restore / provision probe (mirrors AccountHome Phase 2).
  useEffect(() => {
    if (!isDeviceKeyV2Enabled()) return;
    let alive = true;
    void (async () => {
      if (getSessionIdentity()) return;
      const atRest = await loadKeysAtRest();
      if (!alive || atRest) return;
      const hasBackup = await hasCloudBackup();
      if (!alive) return;
      if (hasBackup) setShowUnlock(true);
      else setShowProvision(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onProvision = async (displayName: string) => {
    setProvisionError(null);
    setProvisioning(true);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = await provisionDeviceKeyForAccount({
        displayName: displayName.trim(),
      });
      if (result.ok) {
        setKit({
          recoveryWords: result.recoveryWords,
          recoveryCode: result.recoveryCode,
          fingerprint: result.fingerprint,
        });
        setShowProvision(false);
        setKeyReady(true);
      } else if (result.reason === "unauthorized") {
        setProvisionError(
          "Your sign-in expired. Sign in again, then retry.",
        );
      } else if (result.reason === "publish-failed") {
        setProvisionError(
          "Could not publish your key. Try again in a moment.",
        );
      } else {
        setProvisionError(
          "Could not reach the server. Check your connection.",
        );
      }
    } finally {
      setProvisioning(false);
    }
  };

  const onUnlock = async () => {
    if (!recoveryInput.trim()) return;
    setUnlockError(null);
    setUnlocking(true);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = await recoverDeviceKeyFromCloud(recoveryInput.trim());
      if (result.ok) {
        setUnlocked(true);
        setShowUnlock(false);
        setRecoveryInput("");
      } else if (result.reason === "wrong-words") {
        setUnlockError(
          "Those recovery words did not match. Check for typos and try again.",
        );
      } else if (result.reason === "no-blob") {
        setUnlockError(
          "There is no saved key for this account to restore.",
        );
      } else if (result.reason === "unauthorized") {
        setUnlockError(
          "Your sign-in expired. Sign in again, then retry.",
        );
      } else {
        setUnlockError(
          "Could not reach the server. Check your connection.",
        );
      }
    } finally {
      setUnlocking(false);
    }
  };

  const confirmKit = () => {
    if (kit) markRecoveryConfirmed(kit.fingerprint);
    setKit(null);
  };

  const dismissKit = () => setKit(null);

  return {
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
  };
}
