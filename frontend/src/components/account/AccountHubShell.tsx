"use client";

// AccountHubShell: full-width left-nav account hub (behind ACCOUNT_HUB_ENABLED).
//
// Wraps the /account surface in a two-pane layout that mirrors LabSiteShell:
//   LEFT RAIL  (sticky, 224 px on desktop, collapses above content on mobile)
//   MAIN PANEL (min-w-0, fills the remaining width in the full-width frame)
//
// The five sections (Overview, Identity, Plan & billing, Your labs, Security)
// are client-side only; no routes change. All existing AccountHub hooks and
// state are lifted unchanged from AccountHub.tsx into this component; the
// render is what changes.
//
// Flag gate: this file is only ever imported when ACCOUNT_HUB_ENABLED is true
// (see account/page.tsx). Flag-off renders AccountHome instead, byte-identical.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Icons via
// <Icon name="...">. Every icon name is verified against the registry.

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

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
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

type Section = "overview" | "identity" | "billing" | "labs" | "security";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readAccountType(
  username: string,
): Promise<"member" | "lab_head" | null> {
  try {
    const { readUserSettings } = await import(
      "@/lib/settings/user-settings"
    );
    const settings = await readUserSettings(username);
    return settings.account_type;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function RoleChip({
  role,
}: {
  role: "free" | "solo" | "lab_head" | "member";
}) {
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
    <span
      className={`rounded-full px-2.5 py-0.5 text-meta font-semibold ${colors[role]}`}
    >
      {labels[role]}
    </span>
  );
}

/** A single item in the left-rail navigation. */
function RailButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors text-left ${
        active
          ? "bg-brand-action/10 font-semibold text-brand-action"
          : "text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
      }`}
    >
      <Icon name={icon} className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

/** A link item in the left-rail "Go to" group. */
function RailLink({
  href,
  icon,
  label,
  external,
}: {
  href: string;
  icon: IconName;
  label: string;
  external?: boolean;
}) {
  const cls =
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground";
  const inner = (
    <>
      <Icon name={icon} className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
    </>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Stat card for Overview
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </span>
      <span className="text-title font-bold text-foreground">
        {value ?? <span className="text-foreground-subtle">&mdash;</span>}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AccountHubShell
// ---------------------------------------------------------------------------

export default function AccountHubShell() {
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

  // Active section state.
  const [section, setSection] = useState<Section>("overview");

  const [connecting, setConnecting] = useState(false);

  // Drag-and-drop state (for the Connect section, mirrors AccountHome).
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragCounterRef = useRef(0);
  const [fromRoute, setFromRoute] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  // Profile state.
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [avatarDraft, setAvatarDraft] = useState<
    string | null | undefined
  >(undefined);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Billing status.
  const { status: billingStatus } = useModelAStatus();

  // Account type (for role chip).
  const [accountType, setAccountType] = useState<
    "member" | "lab_head" | null
  >(null);

  // Run a lab modal.
  const [runLabOpen, setRunLabOpen] = useState(false);

  // Key restore / provision state (mirrors AccountHome).
  const [showUnlock, setShowUnlock] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [showProvision, setShowProvision] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(
    null,
  );
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
      // Jump straight to a section if the URL hash says so.
      const hash = window.location.hash.replace("#", "") as Section;
      const valid: Section[] = [
        "overview",
        "identity",
        "billing",
        "labs",
        "security",
      ];
      if (valid.includes(hash)) setSection(hash);
    } catch {
      /* ignore */
    }
    void getSession().then((s) => {
      const n =
        s?.user?.name ?? s?.user?.email?.split("@")[0] ?? null;
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

  // Read account type from folder settings.
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
    if (billingStatus?.planId === "solo") return "solo";
    if (billingStatus?.planId === "lab") return "lab_head";
    return "free";
  }

  const isLabHead =
    accountType === "lab_head" || billingStatus?.planId === "lab";
  const showRunALab =
    !isLabHead &&
    !!sessionEmail &&
    (billingStatus === null ||
      billingStatus?.planId === "free" ||
      billingStatus?.planId === "solo");

  // Profile save.
  const onPickAvatar = async (file: File | null | undefined) => {
    setAvatarError(null);
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatarDraft(dataUrl);
    } catch (e) {
      setAvatarError(
        e instanceof Error ? e.message : "Could not read that image.",
      );
    }
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        handle,
        displayName,
        affiliation,
      };
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

  // Connect / drag handlers (mirrors AccountHome).
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
        if (ok) {
          router.push("/");
          return;
        }
        const initialized = await initializeFolder();
        if (initialized) {
          router.push("/");
          return;
        }
      } finally {
        setConnecting(false);
      }
      return;
    }
    setDropError(
      describeDropExtractionError(
        result.kind,
        "message" in result ? result.message : undefined,
      ),
    );
  };

  // Key restore / provision handlers.
  const onProvision = async () => {
    setProvisionError(null);
    setProvisioning(true);
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

  const isReturning =
    Boolean(profile) || Boolean(lastConnectedFolder);
  const welcomeName = profile?.displayName ?? sessionName ?? null;

  const inputCls =
    "w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action";

  // Public-profile URL for the network link (best-effort, links to /researchers
  // if no handle yet).
  const networkProfileUrl = profile?.handle
    ? `/u/${profile.handle}`
    : "/researchers";

  // ---------------------------------------------------------------------------
  // Plan label helper (used in Overview stat-card).
  // ---------------------------------------------------------------------------
  function planLabel(): string {
    if (!billingStatus) return "Free";
    if (billingStatus.planId === "free") return "Free";
    if (billingStatus.planId === "solo") return "Solo";
    if (billingStatus.planId === "lab") return "Lab";
    if (billingStatus.planId === "dept") return "Department";
    return "Free";
  }

  function nextBillLabel(): string | null {
    if (!billingStatus) return null;
    if (billingStatus.planId === "free") return null;
    if (billingStatus.trialEndsAt) {
      const d = new Date(billingStatus.trialEndsAt);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Section renderers
  // ---------------------------------------------------------------------------

  function renderOverview() {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-heading font-extrabold tracking-tight text-foreground">
            {welcomeName ? `Welcome, ${welcomeName}` : "Your account"}
          </h1>
          <p className="mt-1 text-body text-foreground-muted">
            Your cloud identity, plan, and labs at a glance.
          </p>
        </div>

        {/* Stat-card row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Plan" value={planLabel()} />
          <StatCard
            label="Storage"
            value={
              billingStatus
                ? `${billingStatus.accruedCents > 0 ? `$${(billingStatus.accruedCents / 100).toFixed(2)} accrued` : "No usage"}`
                : null
            }
          />
          <StatCard
            label="Labs"
            value={
              accountType === "lab_head"
                ? "Lab head"
                : accountType === "member"
                  ? "Member"
                  : null
            }
          />
          <StatCard label="Next bill" value={nextBillLabel()} />
        </div>

        {/* Public profile callout */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <Icon
              name="network"
              className="mt-0.5 h-5 w-5 shrink-0 text-brand-purple"
            />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-foreground">
                Public researcher profile
              </p>
              <p className="mt-0.5 text-meta text-foreground-muted">
                Your profile on the ResearchOS Network is the public-facing
                version of your identity. Edit bio, links, and ORCID there.
              </p>
              <a
                href={networkProfileUrl}
                target={profile?.handle ? "_blank" : undefined}
                rel={profile?.handle ? "noopener noreferrer" : undefined}
                className="mt-2 inline-block text-meta font-semibold text-brand-purple hover:underline"
              >
                {profile?.handle
                  ? `View @${profile.handle} on Network`
                  : "Go to researcher directory"}
              </a>
            </div>
          </div>
        </div>

        {/* Quick section shortcuts */}
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                s: "identity" as Section,
                label: "Identity",
                desc: "Name, handle, avatar, and affiliation.",
                icon: "user" as const,
              },
              {
                s: "billing" as Section,
                label: "Plan and billing",
                desc: "Your current plan, usage, and card.",
                icon: "receipt" as const,
              },
              {
                s: "labs" as Section,
                label: "Your labs",
                desc: "Labs you run or belong to.",
                icon: "vial" as const,
              },
              {
                s: "security" as Section,
                label: "Security",
                desc: "Recovery kit and sign-in.",
                icon: "lock" as const,
              },
            ] as const
          ).map(({ s, label, desc, icon }) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-brand-action"
            >
              <Icon
                name={icon}
                className="h-5 w-5 shrink-0 text-foreground-muted"
              />
              <div className="min-w-0">
                <p className="text-body font-semibold text-foreground">
                  {label}
                </p>
                <p className="text-meta text-foreground-muted">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderIdentity() {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-heading font-extrabold tracking-tight text-foreground">
            Identity
          </h2>
          <p className="mt-1 text-body text-foreground-muted">
            Your public handle, display name, and avatar.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          {!loaded ? (
            <p className="text-meta text-foreground-muted">
              Loading your profile&hellip;
            </p>
          ) : editing ? (
            <div className="space-y-3">
              <h3 className="text-body font-bold text-foreground">
                {profile ? "Edit your profile" : "Claim your handle"}
              </h3>
              <div className="flex items-center gap-4">
                <ProfileAvatar
                  avatarUrl={
                    avatarDraft !== undefined
                      ? avatarDraft
                      : (profile?.avatarUrl ?? null)
                  }
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
              {avatarError && (
                <p className="text-meta text-rose-600">{avatarError}</p>
              )}
              <label className="block">
                <span className="text-meta font-semibold text-foreground-muted">
                  Handle
                </span>
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-body font-semibold text-foreground-muted">
                    @
                  </span>
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
                <span className="text-meta font-semibold text-foreground-muted">
                  Display name
                </span>
                <input
                  className={`${inputCls} mt-1`}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Dr. Jane Researcher"
                />
              </label>
              <label className="block">
                <span className="text-meta font-semibold text-foreground-muted">
                  Affiliation
                </span>
                <input
                  className={`${inputCls} mt-1`}
                  value={affiliation}
                  onChange={(e) => setAffiliation(e.target.value)}
                  placeholder="University of Wisconsin-Madison"
                />
              </label>
              {error && (
                <p className="text-meta text-rose-600">{error}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !handle.trim()}
                  className="ros-btn-raise rounded-lg bg-brand-action px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
                >
                  {saving
                    ? "Saving…"
                    : profile
                      ? "Save"
                      : "Claim handle"}
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-title font-bold text-foreground">
                    {profile?.displayName ?? `@${profile?.handle}`}
                  </span>
                  <RoleChip role={deriveRoleChip()} />
                </div>
                <a
                  href={`/u/${profile?.handle}`}
                  className="text-meta font-semibold text-brand-purple hover:underline"
                >
                  @{profile?.handle}
                </a>
                {profile?.affiliation && (
                  <div className="truncate text-meta text-foreground-muted">
                    {profile.affiliation}
                  </div>
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

        {/* Note: bio, links, ORCID live on the network profile */}
        <p className="text-meta text-foreground-muted">
          Bio, links, and ORCID are edited on your{" "}
          <a
            href={networkProfileUrl}
            target={profile?.handle ? "_blank" : undefined}
            rel={profile?.handle ? "noopener noreferrer" : undefined}
            className="font-semibold text-brand-purple hover:underline"
          >
            Network profile
          </a>{" "}
          and in{" "}
          <Link
            href="/settings"
            className="font-semibold text-brand-action hover:underline"
          >
            Settings
          </Link>
          .
        </p>
      </div>
    );
  }

  function renderBilling() {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-heading font-extrabold tracking-tight text-foreground">
            Plan and billing
          </h2>
          <p className="mt-1 text-body text-foreground-muted">
            Your current plan, usage this period, and payment method.
          </p>
        </div>
        <PlanBillingCard />
        <p className="text-meta text-foreground-muted">
          Full billing controls live in{" "}
          <Link
            href="/settings?section=plan-storage"
            className="font-semibold text-brand-action hover:underline"
          >
            Settings &rarr; Plan and storage
          </Link>
          .
        </p>
      </div>
    );
  }

  function renderLabs() {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-heading font-extrabold tracking-tight text-foreground">
            Your labs
          </h2>
          <p className="mt-1 text-body text-foreground-muted">
            Labs you run or belong to as a member.
          </p>
        </div>

        {/* Data folder connector: labs need a connected folder. */}
        <div
          onDragEnter={!isConnected ? handleDragEnter : undefined}
          onDragOver={!isConnected ? handleDragOver : undefined}
          onDragLeave={!isConnected ? handleDragLeave : undefined}
          onDrop={
            !isConnected ? (e) => void handleDrop(e) : undefined
          }
          className={`rounded-2xl border p-5 transition-all ${
            !isConnected && isDragOver
              ? "border-2 border-dashed border-blue-400 bg-blue-500/15 ring-4 ring-blue-400/30"
              : "border-brand-action/30 bg-brand-action/5"
          }`}
        >
          {isConnected ? (
            <>
              <p className="text-body font-bold text-foreground">
                Your data is connected
              </p>
              <p className="mt-1 text-meta text-foreground-muted">
                Jump back into your work.
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
                  <b>{returnDestinationLabel(fromRoute)}</b> needs your data, which lives in a
                  folder on your computer. Point us to it below to
                  continue.
                </p>
              )}
              {isDragOver ? (
                <p className="text-body font-bold text-blue-700 dark:text-blue-100">
                  Release to connect this folder
                </p>
              ) : (
                <p className="text-body font-bold text-foreground">
                  {isReturning
                    ? `Welcome back${welcomeName ? `, ${welcomeName}` : ""}`
                    : "Connect your data folder"}
                </p>
              )}
              <p
                className={`mt-1 text-meta text-foreground-muted ${isDragOver ? "invisible" : ""}`}
                aria-hidden={isDragOver || undefined}
              >
                {isReturning
                  ? "Your research data lives in a folder on your computer. Point us to it to pick up where you left off."
                  : "Your notes, experiments, and files live in a folder on this computer, never on our servers."}
              </p>
              <div
                className={`mt-3 flex items-center gap-3 ${isDragOver ? "invisible" : ""}`}
                aria-hidden={isDragOver || undefined}
              >
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
                <span className="text-meta text-foreground-subtle">
                  or drag a folder here
                </span>
              </div>
              {dropError && (
                <p
                  role="alert"
                  className="mt-2 text-meta text-red-600 dark:text-red-300"
                >
                  {dropError}
                </p>
              )}
              {ONBOARDING_WIZARD_ENABLED && (
                <p className="mt-3 text-meta text-foreground-muted">
                  Not ready to pick a folder?{" "}
                  <Link
                    href="/demo"
                    data-testid="account-home-try-demo"
                    className="font-semibold text-brand-action hover:underline"
                  >
                    Try the demo instead
                  </Link>
                </p>
              )}
            </>
          )}
        </div>

        {/* Run a lab (Free/Solo non-heads only) */}
        {showRunALab && (
          <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
            <h3 className="text-body font-bold text-foreground">
              Run a lab
            </h3>
            <p className="mt-1 text-meta text-foreground-muted">
              Invite researchers, pool budgets and storage, run the lab
              dashboard, and host your lab web home. Convert to a
              lab-head account with one click.
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

        {/* Lab site link (when lab sites are enabled) */}
        {LAB_SITES_ENABLED && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Icon
                  name="globe"
                  className="h-5 w-5 shrink-0 text-brand-action"
                />
                <div>
                  <p className="text-body font-semibold text-foreground">
                    Lab companion site
                  </p>
                  <p className="text-meta text-foreground-muted">
                    Your lab&apos;s public page on research-os.com.
                  </p>
                </div>
              </div>
              <Link
                href="/account/lab-site"
                className="flex-none rounded-lg border border-border px-3 py-1.5 text-meta font-semibold text-foreground hover:border-brand-action"
              >
                Manage
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderSecurity() {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-heading font-extrabold tracking-tight text-foreground">
            Security
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

        {/* Devices link */}
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-body font-semibold text-foreground">
                This device
              </p>
              <p className="text-meta text-foreground-muted">
                Manage trusted devices and key status in Settings.
              </p>
            </div>
            <Link
              href="/settings"
              className="flex-none rounded-lg border border-border px-3 py-1.5 text-meta font-semibold text-foreground hover:border-brand-action"
            >
              Settings
            </Link>
          </div>
        </div>

        {/* Key states from AccountHub */}
        {unlocked && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <h3 className="text-body font-bold text-foreground">
              Your data is unlocked on this device
            </h3>
            <p className="mt-1 text-meta text-foreground-muted">
              Your keys are live for this session. Connect your data
              folder to pick up your work.
            </p>
          </div>
        )}
        {showUnlock && !unlocked && (
          <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
            <h3 className="text-body font-bold text-foreground">
              Unlock your data on this device
            </h3>
            <p className="mt-1 text-meta text-foreground-muted">
              This browser does not have your encryption keys yet. Enter
              your recovery words to unlock your shared and encrypted
              data here. Your keys are restored on this device only.
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
              <p className="mt-2 text-meta text-rose-600">
                {unlockError}
              </p>
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
              You can now share and publish. Your key is live for this
              session.
            </p>
          </div>
        )}
        {showProvision && !keyReady && (
          <div className="rounded-2xl border border-brand-purple/30 bg-brand-purple/5 p-5">
            <h3 className="text-body font-bold text-foreground">
              Set up your data key
            </h3>
            <p className="mt-1 text-meta text-foreground-muted">
              Sharing and publishing use end-to-end encryption keys that
              live on your device, never on our servers. Set yours up
              now, no data folder needed.
            </p>
            {provisionError && (
              <p className="mt-2 text-meta text-rose-600">
                {provisionError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void onProvision()}
              disabled={provisioning}
              className="mt-3 rounded-lg bg-brand-purple px-4 py-2 text-meta font-semibold text-white disabled:opacity-60"
            >
              {provisioning
                ? "Setting up…"
                : "Set up my data key"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  const railSections: {
    id: Section;
    icon: IconName;
    label: string;
  }[] = [
    { id: "overview", icon: "gauge", label: "Overview" },
    { id: "identity", icon: "user", label: "Identity" },
    { id: "billing", icon: "receipt", label: "Plan and billing" },
    { id: "labs", icon: "vial", label: "Your labs" },
    { id: "security", icon: "lock", label: "Security" },
  ];

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-10">
      <div className="grid gap-6 lg:grid-cols-[224px_minmax(0,1fr)] lg:items-start">
        {/* Left rail */}
        <aside className="lg:sticky lg:top-6">
          <div className="rounded-xl border border-border bg-surface-raised p-3">
            {/* Brand label */}
            <div className="mb-3 flex items-center gap-2 px-1.5">
              <Icon
                name="user"
                className="h-4 w-4 text-brand-action"
              />
              <span className="text-[13px] font-bold text-foreground">
                Account
              </span>
            </div>

            {/* Section nav */}
            <nav className="flex flex-col gap-0.5">
              {railSections.map(({ id, icon, label }) => (
                <RailButton
                  key={id}
                  icon={icon}
                  label={label}
                  active={section === id}
                  onClick={() => setSection(id)}
                />
              ))}
            </nav>

            {/* Divider + "Go to" links */}
            <div className="my-3 h-px bg-border" />
            <p className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-foreground-muted">
              Go to
            </p>
            <div className="flex flex-col gap-0.5">
              {LAB_SITES_ENABLED && (
                <RailLink
                  href="/account/lab-site"
                  icon="globe"
                  label="Lab site"
                />
              )}
              <Tooltip
                label={
                  profile?.handle
                    ? `Your public profile at /u/${profile.handle}`
                    : "Researcher directory"
                }
              >
                <RailLink
                  href={networkProfileUrl}
                  icon="network"
                  label="Network profile"
                  external={!!profile?.handle}
                />
              </Tooltip>
              <RailLink href="/settings" icon="gauge" label="Settings" />
              <RailLink href="/" icon="library" label="Back to app" />
            </div>
          </div>
        </aside>

        {/* Main panel */}
        <main className="min-w-0">
          {section === "overview" && renderOverview()}
          {section === "identity" && renderIdentity()}
          {section === "billing" && renderBilling()}
          {section === "labs" && renderLabs()}
          {section === "security" && renderSecurity()}
        </main>
      </div>

      {/* Recovery kit modal (portal-level, not section-scoped) */}
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

      {/* Run a lab modal */}
      {runLabOpen && (
        <RunALabModal
          open={runLabOpen}
          onClose={() => setRunLabOpen(false)}
          oauthEmail={sessionEmail ?? ""}
          currentUser={currentUser}
          displayName={
            (profile?.displayName ?? displayName) || null
          }
          affiliation={
            (profile?.affiliation ?? affiliation) || null
          }
          onCreated={() => {
            if (currentUser) {
              void readAccountType(currentUser).then(setAccountType);
            }
          }}
        />
      )}
    </div>
  );
}
