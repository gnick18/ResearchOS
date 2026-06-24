"use client";

// Account hub: the enriched /account surface (behind NEXT_PUBLIC_ACCOUNT_HUB).
//
// Layout (single scrolling column, all cards independently conditional):
//   1. Identity card (existing profile card + role chip)
//   2. Plan and billing summary (new compact read-only card via useModelAStatus)
//   3. Your data folder (existing connect card, preserved)
//   4. Run a lab (new, only for Free/Solo non-lab-heads)
//   5. Key restore / provision (existing, flag-gated)
//   6. Your account links (existing links)
//
// When ACCOUNT_HUB_ENABLED is off, /account renders AccountHome instead (the
// page.tsx gate handles this; AccountHub is never imported when the flag is off).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSession } from "next-auth/react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import {
  extractDirectoryHandleFromDrop,
  describeDropExtractionError,
} from "@/lib/file-system/drop-folder";
import { ONBOARDING_WIZARD_ENABLED } from "@/lib/onboarding/config";
import { LAB_SITES_ENABLED } from "@/lib/social/config";
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
import FileDropzone from "@/components/ui/FileDropzone";
import { fileToAvatarDataUrl } from "@/lib/account/avatar-image";
import PlanBillingCard from "@/components/account/PlanBillingCard";
import RunALabModal from "@/components/account/RunALabModal";
import { useModelAStatus } from "@/hooks/useModelAStatus";
import { returnDestinationLabel } from "@/lib/account/return-destination-label";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  { href: "/researchers", label: "Researcher directory", desc: "Find researchers and share with them." },
  ...(LAB_SITES_ENABLED
    ? [{ href: "/account/lab-site", label: "Lab site", desc: "Manage your lab's public companion site." }]
    : []),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The account_type written into the current user's settings, or null when unknown. */
async function readAccountType(username: string): Promise<"member" | "lab_head" | null> {
  try {
    const { readUserSettings } = await import("@/lib/settings/user-settings");
    const settings = await readUserSettings(username);
    return settings.account_type;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Role chip
// ---------------------------------------------------------------------------

function RoleChip({ role }: { role: "free" | "solo" | "lab_head" | "member" }) {
  const labels: Record<typeof role, string> = {
    free: "Free",
    solo: "Solo",
    lab_head: "Lab head",
    member: "Member",
  };
  const colors: Record<typeof role, string> = {
    free: "border border-border bg-surface-sunken text-foreground-muted",
    solo: "bg-brand-action/10 text-brand-action",
    lab_head: "bg-brand-purple/10 text-brand-purple",
    member: "bg-surface-sunken text-foreground-muted",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-meta font-semibold ${colors[role]}`}>
      {labels[role]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AccountHub
// ---------------------------------------------------------------------------

export default function AccountHub() {
  const {
    isConnected,
    connect,
    connectWithHandle,
    lastConnectedFolder,
    reconnectWithStoredHandle,
    initializeFolder,
    currentUser,
  } = useFileSystem();
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);

  // Drag-and-drop state (mirrors AccountHome).
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragCounterRef = useRef(0);
  const [fromRoute, setFromRoute] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  // Profile state (mirrors AccountHome).
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [avatarDraft, setAvatarDraft] = useState<string | null | undefined>(undefined);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Billing status for deriving the role chip + showing/hiding "Run a lab".
  const { status: billingStatus } = useModelAStatus();

  // Account type from folder settings (for the role chip).
  const [accountType, setAccountType] = useState<"member" | "lab_head" | null>(null);

  // "Run a lab" modal.
  const [runLabOpen, setRunLabOpen] = useState(false);

  // Key restore / provision state (mirrors AccountHome).
  const [showUnlock, setShowUnlock] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [kit, setKit] = useState<{
    recoveryWords: string;
    recoveryCode: string;
    fingerprint: string;
  } | null>(null);
  const [keyReady, setKeyReady] = useState(false);

  // Boot: read URL params + session info.
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
      setSessionEmail(s?.user?.email ?? null);
    });
  }, []);

  // Load profile.
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

  // Read account type from folder when a user is connected.
  useEffect(() => {
    if (!currentUser) {
      setAccountType(null);
      return;
    }
    let alive = true;
    void readAccountType(currentUser).then((t) => {
      if (alive) setAccountType(t);
    });
    return () => {
      alive = false;
    };
  }, [currentUser]);

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

  // Derive role chip tier.
  function deriveRoleChip(): "free" | "solo" | "lab_head" | "member" {
    if (accountType === "lab_head") return "lab_head";
    if (accountType === "member") return "member";
    // Fall back to billing plan if no folder is connected.
    if (billingStatus?.planId === "solo") return "solo";
    if (billingStatus?.planId === "lab") return "lab_head";
    return "free";
  }

  // "Run a lab" shows for Free / Solo non-heads who are signed in with email.
  const isLabHead = accountType === "lab_head" || billingStatus?.planId === "lab";
  const showRunALab =
    !isLabHead &&
    !!sessionEmail &&
    (billingStatus === null || billingStatus?.planId === "free" || billingStatus?.planId === "solo");

  // Profile save.
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

  // Connect flow (mirrors AccountHome).
  const onConnect = async () => {
    setConnecting(true);
    try {
      const ok = lastConnectedFolder
        ? await reconnectWithStoredHandle()
        : await connect();
      if (ok) {
        router.push("/");
        return;
      }
      const initialized = await initializeFolder();
      if (initialized) {
        router.push("/");
        return;
      }
      setConnecting(false);
    } catch {
      setConnecting(false);
    }
  };

  // Drag handlers (mirrors AccountHome).
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragCounterRef.current += 1;
    setIsDragOver(true);
    setDropError(null);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;
    const result = await extractDirectoryHandleFromDrop(items);
    if (result.kind === "ok") {
      setDropError(null);
      setConnecting(true);
      try {
        const ok = await connectWithHandle(result.handle);
        if (ok) { router.push("/"); return; }
        const initialized = await initializeFolder();
        if (initialized) { router.push("/"); return; }
      } finally {
        setConnecting(false);
      }
      return;
    }
    setDropError(describeDropExtractionError(result.kind, "message" in result ? result.message : undefined));
  };

  // Key restore / provision handlers (mirrors AccountHome).
  const onProvision = async () => {
    setProvisionError(null);
    setProvisioning(true);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = await provisionDeviceKeyForAccount({
        displayName: profile?.displayName ?? displayName.trim(),
      });
      if (result.ok) {
        setKit({ recoveryWords: result.recoveryWords, recoveryCode: result.recoveryCode, fingerprint: result.fingerprint });
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
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = await recoverDeviceKeyFromCloud(recoveryInput.trim());
      if (result.ok) {
        setUnlocked(true);
        setShowUnlock(false);
        setRecoveryInput("");
      } else if (result.reason === "wrong-words") {
        setUnlockError("Those recovery words did not match. Check for typos and try again.");
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

  const isReturning = Boolean(profile) || Boolean(lastConnectedFolder);
  const welcomeName = profile?.displayName ?? sessionName ?? null;

  const inputCls =
    "w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action";

  return (
    <div className="space-y-5">
      {/* ---- Card 1: Identity ---- */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        {!loaded ? (
          <p className="text-meta text-foreground-muted">Loading your profile&hellip;</p>
        ) : editing ? (
          <div className="space-y-3">
            <h2 className="text-body font-bold text-foreground">
              {profile ? "Edit your profile" : "Claim your handle"}
            </h2>
            <div className="flex items-center gap-4">
              <ProfileAvatar
                avatarUrl={avatarDraft !== undefined ? avatarDraft : profile?.avatarUrl ?? null}
                name={displayName || handle}
                sizePx={56}
              />
              <div className="flex flex-1 flex-col gap-1">
                <FileDropzone
                  compact
                  accept="image/png,image/jpeg,image/webp"
                  label="Drag and drop a photo"
                  hint="PNG, JPG, WebP"
                  icon="camera"
                  ariaLabel="Upload a profile photo"
                  onFiles={(files) => void onPickAvatar(files[0])}
                  onReject={(msg) => setAvatarError(msg)}
                />
                {(avatarDraft ?? profile?.avatarUrl) && (
                  <button
                    type="button"
                    onClick={() => { setAvatarDraft(null); setAvatarError(null); }}
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
              <input className={`${inputCls} mt-1`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Dr. Jane Researcher" />
            </label>
            <label className="block">
              <span className="text-meta font-semibold text-foreground-muted">Affiliation</span>
              <input className={`${inputCls} mt-1`} value={affiliation} onChange={(e) => setAffiliation(e.target.value)} placeholder="University of Wisconsin-Madison" />
            </label>
            {error && <p className="text-meta text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !handle.trim()}
                className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : profile ? "Save" : "Claim handle"}
              </button>
              {profile && (
                <button
                  type="button"
                  onClick={() => { setEditing(false); setError(null); }}
                  className="rounded-lg border border-border px-4 py-2 text-meta font-medium text-foreground-muted"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <ProfileAvatar avatarUrl={profile?.avatarUrl ?? null} name={profile?.displayName ?? profile?.handle} sizePx={48} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-title font-bold text-foreground">
                  {profile?.displayName ?? `@${profile?.handle}`}
                </span>
                <RoleChip role={deriveRoleChip()} />
              </div>
              <a href={`/u/${profile?.handle}`} className="text-meta font-semibold text-brand-purple hover:underline">
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

      {/* ---- Card 2: Plan and billing summary ---- */}
      <PlanBillingCard />

      {/* ---- Card 3: Your data folder ---- */}
      <div
        onDragEnter={!isConnected ? handleDragEnter : undefined}
        onDragOver={!isConnected ? handleDragOver : undefined}
        onDragLeave={!isConnected ? handleDragLeave : undefined}
        onDrop={!isConnected ? (e) => void handleDrop(e) : undefined}
        className={`rounded-2xl border p-5 transition-all ${
          !isConnected && isDragOver
            ? "border-2 border-dashed border-blue-400 bg-blue-500/15 ring-4 ring-blue-400/30"
            : "border-brand-action/30 bg-brand-action/5"
        }`}
      >
        {isConnected ? (
          <>
            <h2 className="text-body font-bold text-foreground">Your data is connected</h2>
            <p className="mt-1 text-meta text-foreground-muted">
              Your research data folder is attached on this computer. Jump back into your work.
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="ros-btn-raise mt-3 inline-block rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white"
            >
              Open ResearchOS
            </button>
          </>
        ) : (
          <>
            {fromRoute && (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-meta text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                <b>{returnDestinationLabel(fromRoute)}</b> needs your data, which lives in a folder on your computer.
                Point us to it below to continue.
              </p>
            )}
            {isDragOver ? (
              <h2 className="text-body font-bold text-blue-700 dark:text-blue-100">
                Release to connect this folder
              </h2>
            ) : (
              <h2 className="text-body font-bold text-foreground">
                {isReturning ? `Welcome back${welcomeName ? `, ${welcomeName}` : ""}` : "Connect your data folder"}
              </h2>
            )}
            <p className={`mt-1 text-meta text-foreground-muted ${isDragOver ? "invisible" : ""}`} aria-hidden={isDragOver || undefined}>
              {isReturning
                ? "You are signed in. Your research data lives in a folder on your computer, not on our servers. Point us to it to pick up where you left off."
                : "Your notes, experiments, and files live in a folder on this computer, never on our servers. Connect one to start working. Drag your data folder here or click to browse."}
            </p>
            <div className={`flex items-center gap-3 mt-3 ${isDragOver ? "invisible" : ""}`} aria-hidden={isDragOver || undefined}>
              <button
                type="button"
                onClick={() => void onConnect()}
                disabled={connecting}
                className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
              >
                {connecting
                  ? "Opening…"
                  : isReturning && lastConnectedFolder
                    ? "Open my ResearchOS folder"
                    : isReturning
                      ? "Point us to your folder"
                      : "Connect a data folder"}
              </button>
              <span className="text-meta text-foreground-subtle">or drag a folder here</span>
            </div>
            {dropError && (
              <p role="alert" className="mt-2 text-meta text-red-600 dark:text-red-300">
                {dropError}
              </p>
            )}
            {ONBOARDING_WIZARD_ENABLED && (
              <p className="mt-3 text-meta text-foreground-muted">
                Not ready to pick a folder?{" "}
                <Link href="/demo" data-testid="account-home-try-demo" className="font-semibold text-brand-action hover:underline">
                  Try the demo instead
                </Link>
              </p>
            )}
          </>
        )}
      </div>

      {/* ---- Card 4: Run a lab (Free/Solo non-heads only) ---- */}
      {showRunALab && (
        <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
          <h2 className="text-body font-bold text-foreground">Run a lab</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Invite researchers, pool budgets and storage, run the lab dashboard,
            and host your lab web home. Convert to a lab-head account with one
            click.
          </p>
          <button
            type="button"
            onClick={() => setRunLabOpen(true)}
            className="ros-btn-raise mt-3 rounded-lg bg-brand-purple px-4 py-2 text-meta font-semibold text-white"
          >
            Start a lab
          </button>
        </div>
      )}

      {/* ---- Card 5: Key restore / provision (flag-gated, mirrors AccountHome) ---- */}
      {unlocked && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <h2 className="text-body font-bold text-foreground">Your data is unlocked on this device</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Your keys are live for this session. Connect your data folder above to pick up your work.
          </p>
        </div>
      )}
      {showUnlock && !unlocked && (
        <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
          <h2 className="text-body font-bold text-foreground">Unlock your data on this device</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            This browser does not have your encryption keys yet. Enter your recovery words to unlock
            your shared and encrypted data here. Your keys are restored on this device only.
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
          {unlockError && <p className="mt-2 text-meta text-rose-600">{unlockError}</p>}
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
          <h2 className="text-body font-bold text-foreground">Your data key is set up</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            You can now share and publish. Your key is live for this session.
          </p>
        </div>
      )}
      {showProvision && !keyReady && (
        <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
          <h2 className="text-body font-bold text-foreground">Set up your data key</h2>
          <p className="mt-1 text-meta text-foreground-muted">
            Sharing and publishing use end-to-end encryption keys that live on your device, never
            on our servers. Set yours up now, no data folder needed.
          </p>
          {provisionError && <p className="mt-2 text-meta text-rose-600">{provisionError}</p>}
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
          onConfirm={() => { markRecoveryConfirmed(kit.fingerprint); setKit(null); }}
          onClose={() => setKit(null)}
        />
      )}

      {/* ---- Card 6: Account links ---- */}
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
                <span aria-hidden className="text-brand-action">&rarr;</span>
              </span>
              <span className="text-meta text-foreground-muted">{l.desc}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Run a lab modal */}
      {runLabOpen && (
        <RunALabModal
          open={runLabOpen}
          onClose={() => setRunLabOpen(false)}
          oauthEmail={sessionEmail ?? ""}
          currentUser={currentUser}
          displayName={(profile?.displayName ?? displayName) || null}
          affiliation={(profile?.affiliation ?? affiliation) || null}
          onCreated={() => {
            // Refresh account type chip after creation.
            if (currentUser) {
              void readAccountType(currentUser).then(setAccountType);
            }
          }}
        />
      )}
    </div>
  );
}
