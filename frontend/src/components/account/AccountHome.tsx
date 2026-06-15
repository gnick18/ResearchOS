"use client";

// Cloud-accounts Phase 1: the folderless account home (Chunk A + B).
//
// What a signed-in user sees with NO data folder connected. The account is the
// cloud identity (OAuth session + @handle profile, bound off the session with no
// keypair); the data folder is an optional, post-login attachment. Renders inside
// PortalShell, so it is only reached when signed in.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "next-auth/react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { ONBOARDING_WIZARD_ENABLED } from "@/lib/onboarding/config";
import { isDeviceKeyV2Enabled } from "@/lib/sharing/identity/device-key-v2";
import { loadKeysAtRest } from "@/lib/sharing/identity/device-vault";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import {
  hasCloudBackup,
  recoverDeviceKeyFromCloud,
} from "@/lib/sharing/identity/cloud-restore";
import { provisionDeviceKeyForAccount } from "@/lib/sharing/identity/provision";
import { markRecoveryConfirmed } from "@/lib/sharing/identity/recovery-confirm";
import RecoveryKitModal from "@/components/sharing/RecoveryKitModal";
import ProfileAvatar from "@/components/account/ProfileAvatar";
import { fileToAvatarDataUrl } from "@/lib/account/avatar-image";

interface AccountProfile {
  handle: string;
  displayName: string | null;
  affiliation: string | null;
  avatarUrl: string | null;
}

interface QuickLink {
  href: string;
  label: string;
  desc: string;
}

const LINKS: QuickLink[] = [
  { href: "/department", label: "Department admin", desc: "Sponsor your labs on one invoice." },
  { href: "/institution", label: "Institution admin", desc: "Cover your departments, roll up usage." },
  { href: "/researchers", label: "Researcher directory", desc: "Find researchers and share with them." },
];

export default function AccountHome() {
  const {
    isConnected,
    connect,
    lastConnectedFolder,
    reconnectWithStoredHandle,
    initializeFolder,
  } = useFileSystem();
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  // Set when a folder-requiring surface bounced the user here (account-first).
  const [fromRoute, setFromRoute] = useState<string | null>(null);
  // The signed-in name (from the profile or the session), for the welcome-back.
  const [sessionName, setSessionName] = useState<string | null>(null);

  useEffect(() => {
    try {
      const f = new URLSearchParams(window.location.search).get("from");
      if (f) setFromRoute(f);
    } catch {
      /* ignore */
    }
    void getSession().then((s) => {
      const n = s?.user?.name || s?.user?.email?.split("@")[0] || null;
      setSessionName(n);
    });
  }, []);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  // Phase 3 Chunk 3A avatar. undefined means "unchanged on save"; a string sets
  // it, null clears it. Kept separate from the saved profile so the edit form can
  // preview a freshly picked image before it is persisted.
  const [avatarDraft, setAvatarDraft] = useState<string | null | undefined>(undefined);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/account/profile");
        const data = (await res.json().catch(() => ({}))) as {
          profile?: AccountProfile | null;
          suggestedHandle?: string;
        };
        if (!alive) return;
        if (data.profile) {
          setProfile(data.profile);
          setHandle(data.profile.handle);
          setDisplayName(data.profile.displayName ?? "");
          setAffiliation(data.profile.affiliation ?? "");
        } else {
          // No profile yet: open the claim form prefilled with the suggestion.
          setHandle(data.suggestedHandle ?? "");
          setEditing(true);
        }
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onPickAvatar = async (file: File | null | undefined) => {
    setAvatarError(null);
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatarDraft(dataUrl);
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : "Could not read that image.");
    }
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      // Only send avatarUrl when the user touched it this edit (avatarDraft set),
      // so an unrelated save leaves the existing avatar untouched on the server.
      const body: Record<string, unknown> = { handle, displayName, affiliation };
      if (avatarDraft !== undefined) body.avatarUrl = avatarDraft;
      const res = await fetch("/api/account/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        profile?: AccountProfile;
        error?: string;
      };
      if (res.ok && data.ok && data.profile) {
        setProfile(data.profile);
        setAvatarDraft(undefined);
        setAvatarError(null);
        setEditing(false);
      } else {
        setError(data.error ?? `Could not save (HTTP ${res.status})`);
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // Phase 2 Chunk 2A: folderless cross-device key restore. The "Unlock your data
  // on this device" card shows ONLY when the flag is on, this browser has NO
  // local key (no session AND nothing in the at-rest vault), and the account has
  // a published backup blob to restore from. All probes run client-side after
  // mount so this stays dark in SSR and when the flag is off.
  const [showUnlock, setShowUnlock] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  // Phase 2 Chunk 2B: provision-on-demand. When the signed-in account has NO key
  // on this device AND no published backup at all (a brand-new account-first user
  // who has never set up a data key), offer "set up your data key" instead of the
  // restore card. Provisioning mints the key, publishes the public keys + backup
  // blob to the directory, and shows the recovery kit once.
  const [showProvision, setShowProvision] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [kit, setKit] = useState<{
    recoveryWords: string;
    recoveryCode: string;
    fingerprint: string;
  } | null>(null);
  const [keyReady, setKeyReady] = useState(false);

  useEffect(() => {
    if (!isDeviceKeyV2Enabled()) return;
    let alive = true;
    void (async () => {
      // Already have a key on this device (session or vault)? Nothing to do.
      if (getSessionIdentity()) return;
      const atRest = await loadKeysAtRest();
      if (!alive || atRest) return;
      // A published backup means "restore on this device"; none means this
      // account has never provisioned a key, so offer to set one up.
      const hasBackup = await hasCloudBackup();
      if (!alive) return;
      if (hasBackup) setShowUnlock(true);
      else setShowProvision(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onProvision = async () => {
    setProvisionError(null);
    setProvisioning(true);
    // Yield a frame so the spinner paints before the heavy Argon2id wrap runs.
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = await provisionDeviceKeyForAccount({
        displayName: profile?.displayName ?? displayName.trim(),
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
        setProvisionError("Your sign-in expired. Sign in again, then retry.");
      } else if (result.reason === "publish-failed") {
        setProvisionError("Could not publish your key. Try again in a moment.");
      } else {
        setProvisionError("Could not reach the server. Check your connection.");
      }
    } finally {
      setProvisioning(false);
    }
  };

  const onUnlock = async () => {
    if (!recoveryInput.trim()) return;
    setUnlockError(null);
    setUnlocking(true);
    // Yield a frame so the spinner paints before the heavy Argon2id unwrap runs.
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
        setUnlockError("There is no saved key for this account to restore.");
      } else if (result.reason === "unauthorized") {
        setUnlockError("Your sign-in expired. Sign in again, then retry.");
      } else {
        setUnlockError("Could not reach the server. Check your connection.");
      }
    } finally {
      setUnlocking(false);
    }
  };

  const onConnect = async () => {
    setConnecting(true);
    try {
      // A returning user with a remembered folder re-attaches via the stored
      // handle (one click, no re-pick); otherwise open the OS folder picker.
      const ok = lastConnectedFolder
        ? await reconnectWithStoredHandle()
        : await connect();
      if (ok) {
        // Client-side nav, NOT a hard reload: a freshly-granted File System
        // Access handle's permission is "prompt" again after a full reload
        // (cannot silently re-attach without a gesture), so window.location.assign
        // dropped the just-made connection and the account-first guard bounced
        // back to /account. router.push keeps the in-memory connection alive so
        // isConnected survives and the user lands in the app.
        router.push("/");
        return;
      }
      // connect()/reconnect also resolve false for a brand-new, empty folder,
      // where finishConnect attaches the handle but leaves it un-validated and flips
      // needsInitialization. That is the launch-onboarding path (first folder),
      // and it must NOT bounce back here. Write the ResearchOS structure now,
      // then navigate in. initializeFolder is a no-op (returns false) when the
      // picker was cancelled and no handle is attached, so a cancel just lets the
      // user retry. initializeFolder flips isConnected, so the account-first
      // guard at "/" no longer redirects.
      const initialized = await initializeFolder();
      if (initialized) {
        router.push("/");
        return;
      }
      // Cancelled picker or a failed connect: drop the spinner and let the user
      // try again, rather than navigating into a bounce.
      setConnecting(false);
    } catch {
      setConnecting(false);
    }
  };

  // Returning = they have used ResearchOS before (a cloud profile or a remembered
  // folder on this device), so the folderless state is "reconnect", not "set up".
  const isReturning = Boolean(profile) || Boolean(lastConnectedFolder);
  const welcomeName = profile?.displayName ?? sessionName ?? null;

  const inputCls =
    "w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action";

  return (
    <div className="space-y-5">
      {/* Profile card / claim+edit form. */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        {!loaded ? (
          <p className="text-meta text-foreground-muted">Loading your profile&hellip;</p>
        ) : editing ? (
          <div className="space-y-3">
            <h2 className="text-body font-bold text-foreground">
              {profile ? "Edit your profile" : "Claim your handle"}
            </h2>
            {/* Phase 3 Chunk 3A: avatar picker. Resized + capped client-side, the
                server caps it again authoritatively on save. */}
            <div className="flex items-center gap-4">
              <ProfileAvatar
                avatarUrl={
                  avatarDraft !== undefined ? avatarDraft : profile?.avatarUrl ?? null
                }
                name={displayName || handle}
                sizePx={56}
              />
              <div className="flex flex-col gap-1">
                <label className="cursor-pointer rounded-lg border border-border bg-surface px-3 py-1.5 text-meta font-semibold text-foreground hover:border-brand-action">
                  Choose photo
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      void onPickAvatar(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {(avatarDraft ?? profile?.avatarUrl) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarDraft(null);
                      setAvatarError(null);
                    }}
                    className="text-left text-meta font-medium text-foreground-muted hover:text-rose-600"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>
            {avatarError && <p className="text-meta text-rose-600">{avatarError}</p>}
            <label className="block">
              <span className="text-meta font-semibold text-foreground-muted">Handle</span>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-body font-semibold text-foreground-muted">@</span>
                <input
                  className={inputCls}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="yourname"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
            </label>
            <label className="block">
              <span className="text-meta font-semibold text-foreground-muted">Display name</span>
              <input
                className={`${inputCls} mt-1`}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Dr. Jane Researcher"
              />
            </label>
            <label className="block">
              <span className="text-meta font-semibold text-foreground-muted">Affiliation</span>
              <input
                className={`${inputCls} mt-1`}
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
                placeholder="University of Wisconsin-Madison"
              />
            </label>
            {error && <p className="text-meta text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !handle.trim()}
                className="rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : profile ? "Save" : "Claim handle"}
              </button>
              {profile && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setError(null);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-meta font-medium text-foreground-muted"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <ProfileAvatar
              avatarUrl={profile?.avatarUrl ?? null}
              name={profile?.displayName ?? profile?.handle}
              sizePx={48}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-title font-bold text-foreground">
                {profile?.displayName ?? `@${profile?.handle}`}
              </div>
              <a
                href={`/u/${profile?.handle}`}
                className="text-meta font-semibold text-brand-purple hover:underline"
              >
                @{profile?.handle}
              </a>
              {profile?.affiliation && (
                <div className="truncate text-meta text-foreground-muted">{profile.affiliation}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex-none rounded-lg border border-border bg-surface px-3 py-1.5 text-meta font-semibold text-foreground hover:border-brand-action"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Your data: connect a folder (folderless) or open the app (connected).
          The account is the cloud part; the data folder is the optional local
          part, and this card is the bridge to it in both states. */}
      <div className="rounded-2xl border border-brand-action/30 bg-brand-action/5 p-5">
        {isConnected ? (
          <>
            <h2 className="text-body font-bold text-foreground">Your data is connected</h2>
            <p className="mt-1 text-meta text-foreground-muted">
              Your research data folder is attached on this computer. Jump back
              into your work.
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-3 inline-block rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white"
            >
              Open ResearchOS
            </button>
          </>
        ) : (
          <>
            {fromRoute && (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-meta text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                <b>{fromRoute}</b> needs your data, which lives in a folder on your
                computer. Point us to it below to continue.
              </p>
            )}
            <h2 className="text-body font-bold text-foreground">
              {isReturning
                ? `Welcome back${welcomeName ? `, ${welcomeName}` : ""}`
                : "Connect your data folder"}
            </h2>
            <p className="mt-1 text-meta text-foreground-muted">
              {isReturning
                ? "You are signed in. Your research data lives in a folder on your computer, not on our servers. Point us to it to pick up where you left off."
                : "Your notes, experiments, and files live in a folder on this computer, never on our servers. Connect one to start working. You can do this any time, from any device that has your data."}
            </p>
            <button
              type="button"
              onClick={() => void onConnect()}
              disabled={connecting}
              className="mt-3 rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
            >
              {connecting
                ? "Opening…"
                : isReturning && lastConnectedFolder
                  ? "Open my ResearchOS folder"
                  : isReturning
                    ? "Point us to your folder"
                    : "Connect a data folder"}
            </button>
            {/*
              Go-live (gated by NEXT_PUBLIC_ONBOARDING_WIZARD): a permanent escape
              to the read-only /demo workspace so a signed-in user without a
              folder is never stuck on this card. Hidden while the flag is off so
              the merge changes nothing until launch.
            */}
            {ONBOARDING_WIZARD_ENABLED && (
              <p className="mt-3 text-meta text-foreground-muted">
                Not ready to pick a folder?{" "}
                <a
                  href="/demo"
                  data-testid="account-home-try-demo"
                  className="font-semibold text-brand-action hover:underline"
                >
                  Try the demo instead
                </a>
              </p>
            )}
          </>
        )}
      </div>

      {/* Phase 2 Chunk 2A: folderless cross-device key restore. Shown only when
          the flag is on, this browser holds no key, and a published backup
          exists. Lets a signed-in user bring their end-to-end keys to a new
          device with their recovery words, no data folder needed. */}
      {unlocked && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <h2 className="text-body font-bold text-foreground">
            Your data is unlocked on this device
          </h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Your keys are live for this session. Connect your data folder above to
            pick up your work.
          </p>
        </div>
      )}
      {showUnlock && !unlocked && (
        <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
          <h2 className="text-body font-bold text-foreground">
            Unlock your data on this device
          </h2>
          <p className="mt-1 text-meta text-foreground-muted">
            This browser does not have your encryption keys yet. Enter your
            recovery words to unlock your shared and encrypted data here. Your keys
            are restored on this device only and never leave it.
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

      {/* Phase 2 Chunk 2B: provision-on-demand. Shown only when the flag is on,
          this browser holds no key, and the account has no published backup yet.
          Sets up the end-to-end data key folderlessly so the user can share and
          publish; the recovery kit is shown once on success. */}
      {keyReady && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <h2 className="text-body font-bold text-foreground">
            Your data key is set up
          </h2>
          <p className="mt-1 text-meta text-foreground-muted">
            You can now share and publish. Your key is live for this session and
            stored encrypted on this device.
          </p>
        </div>
      )}
      {showProvision && !keyReady && (
        <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
          <h2 className="text-body font-bold text-foreground">
            Set up your data key
          </h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Sharing and publishing to the researcher directory use end-to-end
            encryption keys that live on your device, never on our servers. Set
            yours up now, no data folder needed. You will get recovery words to
            save once.
          </p>
          {provisionError && (
            <p className="mt-2 text-meta text-rose-600">{provisionError}</p>
          )}
          <button
            type="button"
            onClick={() => void onProvision()}
            disabled={provisioning}
            className="mt-3 rounded-lg bg-brand-purple px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
          >
            {provisioning ? "Setting up…" : "Set up my data key"}
          </button>
        </div>
      )}

      {kit && (
        <RecoveryKitModal
          recoveryWords={kit.recoveryWords}
          recoveryCode={kit.recoveryCode}
          onConfirm={() => {
            markRecoveryConfirmed(kit.fingerprint);
            setKit(null);
          }}
          onClose={() => setKit(null)}
        />
      )}

      {/* Account-level surfaces that need no folder. */}
      <div>
        <h2 className="mb-2 text-meta font-bold uppercase tracking-wide text-foreground-muted">
          Your account
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand-action"
            >
              <span className="flex items-center gap-2 text-body font-semibold text-foreground">
                {l.label}
                <span aria-hidden className="text-brand-action">
                  &rarr;
                </span>
              </span>
              <span className="text-meta text-foreground-muted">{l.desc}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
