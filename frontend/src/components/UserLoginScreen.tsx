"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signIn, signOut } from "next-auth/react";
import { usersApi } from "@/lib/local-api";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { folderRequiresLogin } from "@/lib/auth/login-policy";
import { isRequireAccountEnabled } from "@/lib/account/require-account";
import {
  hasLocalAccount,
  loginWithPassword,
  loginWithRecovery,
  createAndPersistAccount,
} from "@/lib/auth/account-store";
import { type UnlockedKeys } from "@/lib/auth/local-identity";
import {
  createLocalIdentity,
  saveIdentity,
  unlockIdentityWithRecovery,
  loadIdentity,
  writeIdentityReferenceSidecar,
  resetIdentityKeepData,
} from "@/lib/sharing/identity/storage";
import { recoverDeviceKeyFromCloud } from "@/lib/sharing/identity/cloud-restore";
import { isAccountFirstEnabled } from "@/lib/account/account-first";
import { deriveWorkspaceUsername } from "@/lib/account/workspace-username";
import { decodePublicKey, encodePublicKey, fingerprint as computeFingerprint } from "@/lib/sharing/identity/keys";
import { fetchMyProfile, compactFingerprint } from "@/lib/sharing/profile";
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";
import { generateDeviceSalt } from "@/lib/sharing/identity/backup";
import { deleteSharingIdentity } from "@/lib/sharing/identity/sidecar";
import { performUserDelete } from "@/lib/users/perform-delete";
import { readUserSettings } from "@/lib/settings/user-settings";
import { isAccountSettingsEnabled } from "@/lib/account/account-settings-config";
import {
  fetchAccountSettings,
  resolveIsLabHead,
} from "@/lib/account/account-settings";
import { readArchivedSet } from "@/lib/lab/user-archive";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
import { evaluateUnlockMatch } from "@/lib/sharing/identity/unlock-match";
import { GoogleIcon, GitHubIcon, LinkedInIcon, MicrosoftIcon } from "@/components/sharing/icons";
import SharingProviderButtons from "@/components/sharing/SharingProviderButtons";
import { startSharingClaimOAuth } from "@/lib/sharing/claim-oauth";
import { isOAuthPublishAvailable, isRealSharingEnabled, isMicrosoftAuthEnabled } from "@/lib/sharing/oauth-availability";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import CreateLocalIdentityStep from "@/components/sharing/CreateLocalIdentityStep";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import {
  createUserMetadataEntry,
  readAllUserMetadata,
  suggestInitialColorForNewUser,
} from "@/lib/file-system/user-metadata";
import { otherUsersOnlyAsync } from "@/lib/file-system/user-color-collisions";
import { USER_COLOR_QUERY_KEY } from "@/hooks/useUserColor";
import type { UserMetadataEntry } from "@/lib/file-system/user-metadata";
import BetaDonationButton from "@/components/BetaDonationButton";
import FeedbackModal from "@/components/FeedbackModal";
import UserAvatar from "@/components/UserAvatar";
import UserColorPickerPopup from "@/components/UserColorPickerPopup";
import Tooltip from "@/components/Tooltip";
import Link from "next/link";
import LandingBackdrop from "@/components/onboarding/oauth-first/LandingBackdrop";
import { IntroBubbleBot } from "@/components/onboarding/oauth-first/IntroBubbleBot";
import VersionBadge from "@/components/VersionBadge";
import DevForceLandingButton from "@/components/DevForceLandingButton";
import DevPairBypassButton from "@/components/DevPairBypassButton";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import RoadmapModal from "@/components/RoadmapModal";

interface UserLoginScreenProps {
  onLogin: () => void;
}

// D1 (cross-boundary sharing): the query param the provider-unlock redirect
// carries back so the resume effect knows which account to unlock and match.
const UNLOCK_QUERY_PARAM = "sharingUnlock";

// D5/D6 read-only badge glyph for the user-switcher tiles. A small
// "person plus link" mark, matching the same icon used on the Lab Roster
// "Sharing" pill (lab-head/LabRoster.tsx) so the two surfaces read as one
// signal. Inline SVG, the project ships no icon-font dependency and every
// user-facing glyph is an inline SVG.
function SharingIdentityIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="4.5" r="2.5" />
      <path d="M1.5 13.5c0-2.5 2-4 4.5-4 1 0 1.9.24 2.6.66" />
      <path d="M10.5 11h4M12.5 9v4" />
    </svg>
  );
}

export default function UserLoginScreen({ onLogin }: UserLoginScreenProps) {
  const { setCurrentUser, currentUser: contextCurrentUser, disconnect } = useFileSystem();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<string[]>([]);
  // Account-first auto-provision (2026-06-14): true while we silently mint the
  // first workspace user (record + E2E keypair) from the signed-in cloud account
  // on a fresh, empty folder, so the user never sees the redundant "create a
  // user" screen. Shows a brief "Setting up your workspace" spinner. The ref
  // gates the attempt to exactly once so a re-render (or StrictMode double-fire)
  // cannot double-create; a failure falls back to the manual picker.
  const [autoProvisioning, setAutoProvisioning] = useState(false);
  const autoProvisionAttempted = useRef(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  // Quick-confirm for a one-user folder on a fresh connect, "Continue as <user>?"
  // with Yes (login) or No (expand to the full picker so a new person can add an
  // account). Expanding sticks for the rest of this screen's life.
  const [expandPicker, setExpandPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [mainUser, setMainUser] = useState<string | null>(null);

  // Color-picker popup state — opened after the user types a username and
  // clicks "Create & Login" so they can confirm (or replace) the random
  // palette color we'd otherwise assign silently. We hold the
  // pre-computed default + the metadata snapshot so the popup can render
  // collision-aware swatches without re-reading the file. `pickerOpen`
  // distinguishes "we're computing the default" (busy spinner on the
  // Create button) from "popup is mounted" (popup is interactive).
  const [colorPicker, setColorPicker] = useState<{
    username: string;
    defaultColor: string;
    otherUsers: Record<string, UserMetadataEntry>;
  } | null>(null);
  
  // Edit mode state
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  
  // Delete user state
  const [deleteUserSelected, setDeleteUserSelected] = useState<string | null>(null);
  const [deleteUserArchive, setDeleteUserArchive] = useState(true);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [isArchivingUser, setIsArchivingUser] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(0);

  // Unlock gate state (OAuth-only model) — populated when a user with a profile
  // identity (a sidecar carrying a wrapped key) is clicked. The gate unlocks the
  // on-device key with a passkey (everyday door) or the recovery code (offline
  // fallback), then signs in. No app-managed password exists anymore.
  const [unlockGate, setUnlockGate] = useState<{
    username: string;
  } | null>(null);
  // Shared "working" flag for any in-flight unlock attempt (passkey or recovery).
  const [unlocking, setUnlocking] = useState(false);

  // Recovery-code fallback, unlock the keypair with the recovery code (or the
  // 12 words) when the passkey is unavailable or fails.
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const recoveryInputRef = useRef<HTMLInputElement>(null);

  // D1 (cross-boundary sharing): provider-unlock as an online convenience.
  // For an account that has CLAIMED a global sharing identity (a
  // `_sharing_identity.json` sidecar exists for that user), and only when
  // the app is ONLINE, the unlock gate additionally offers "Sign in with
  // Google or GitHub to unlock". A successful provider sign-in whose
  // verified email matches the account's claimed identity email signs the user
  // in. The passkey and recovery-code doors stay the always-available offline
  // paths. Offline or unclaimed accounts simply do not see this option.
  //
  // `claimedUsers` is the fan-out set of users with a published sidecar,
  // mirroring `labHeadUsers`. A read failure leaves the user out of the set, so a
  // missing or unreadable sidecar simply hides the OAuth-unlock option.
  const [claimedUsers, setClaimedUsers] = useState<Set<string>>(new Set());
  // Online status drives whether the provider buttons render. The provider
  // unlock needs the network (OAuth redirect + session read), so offline we
  // show only the password gate, exactly as today.
  const [isOnline, setIsOnline] = useState(true);
  // True while we are resolving an OAuth return (reading the session and
  // matching its email against the claimed identity) so the gate can show a
  // "verifying" state instead of a bare password prompt.
  const [unlockingViaProvider, setUnlockingViaProvider] = useState(false);

  // Force-create-an-account gate (local-keypair model, IDENTITY_OAUTH_ONLY.md
  // 2026-06-06). A shared folder (two or more users) or a folder with a lab head
  // requires every account to have an identity before it can sign in, so people
  // cannot act as each other. When such a user has no account yet, we open
  // CreateLocalIdentityStep here, which mints the LOCAL keypair offline (no
  // OAuth), shows its recovery code, and (on complete) signs the user in. Solo
  // accounts are never forced, they keep the no-login behavior.
  const [forceProfileFor, setForceProfileFor] = useState<{
    username: string;
  } | null>(null);

  // After a brand-new account is established (solo create, or the force-profile
  // gate on a shared folder), offer an OPTIONAL "set up your profile"
  // step with the third-party sign-in buttons before entering the app. Skipping
  // is always allowed (the same buttons live in Settings to set up later). This
  // is the only place creation differs from a normal returning-user login,
  // which never sees it.
  const [profileStep, setProfileStep] = useState<{ username: string } | null>(
    null,
  );
  // When the user clicks a provider in the profile step, mount the existing
  // SharingSetupWizard, which owns the whole OAuth + identity-claim flow.
  const [profileWizardOpen, setProfileWizardOpen] = useState(false);

  // After a new account is created, show its recovery code once before signing
  // in. The code is the only fallback if the password is lost.
  const [createdRecovery, setCreatedRecovery] = useState<{
    username: string;
    code: string;
  } | null>(null);
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  // Phase C1 (recovery, docs/proposals/2026-06-15-account-folder-identity-redesign.md
  // §6c): the reset-keep-data lockout escape. When a user can't unlock (lost the
  // recovery code AND provider access) they can mint a fresh identity rather than
  // be permanently locked out — their plaintext notebook data is untouched. This
  // is a no-soft-lock escape ([[feedback_no_soft_locks]]). Two-step: the unlock
  // gate offers it as a last resort, clicking opens a warning confirmation, and
  // confirming runs resetIdentityKeepData + shows the new recovery code (reusing
  // the createdRecovery display). Dark behind MULTI_FOLDER_ENABLED.
  const [resetConfirmFor, setResetConfirmFor] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Phase C5 (cross-device restore, docs/proposals/2026-06-15-account-folder-
  // identity-redesign.md §6c): when a signed-in account lands on a fresh device
  // (no local keypair) but already has a canonical identity published from
  // elsewhere, do NOT mint a divergent key — restore the published one from the
  // cloud backup with the recovery code, then write a reference sidecar and
  // enter. This replaces the Phase B `// Phase C:` stop-and-point guard with the
  // real restore UX (strict path: recovery-code unwrap of the existing OAuth-
  // gated my-backup blob, no new server surface). Dark behind MULTI_FOLDER_ENABLED.
  const [crossDeviceRestore, setCrossDeviceRestore] = useState<{
    username: string;
  } | null>(null);
  const [restoreInput, setRestoreInput] = useState("");
  const [restoring, setRestoring] = useState(false);

  // Per-user password management popup (set/change/remove)
  const [managingPasswordFor, setManagingPasswordFor] = useState<string | null>(null);

  // Per-user password-set status — drives the lock icon's appearance.
  // Loaded after the user list comes back, refreshed after the password popup closes.
  const [lockedUsers, setLockedUsers] = useState<Set<string>>(new Set());

  // Per-user `account_type` (Lab Head Phase 1). Drives both the PI badge
  // on lab_head tiles and the sort order (lab heads to the top). Loaded
  // alongside the user list; users we couldn't read settings for fall
  // back to "member" so they never appear elevated by accident.
  // Mirror of the lockedUsers pattern: fan-out read per user.
  const [labHeadUsers, setLabHeadUsers] = useState<Set<string>>(new Set());

  // The lab membership agreement to present in the force-create gate when a new
  // member joins a folder whose lab head has an enabled agreement
  // (LAB_ARCHIVE_CONTINUITY.md). Computed from the lab head's settings when the
  // gate opens; null means no agreement to show.
  const [joinAgreement, setJoinAgreement] = useState<
    { text: string; version: number; labHead: string } | null
  >(null);

  // Per-user `archived` flag (Lab Head Phase 6). Drives the "hidden by
  // default" visibility of archived accounts; the Show archived toggle
  // below the user grid reveals them. Loaded alongside the lab_head
  // status — fan-out read per user via readArchivedSet. A read failure
  // leaves the user out of the set (i.e. defaults to non-archived) so
  // a corrupt sidecar can never accidentally hide an active member.
  const [archivedUsers, setArchivedUsers] = useState<Set<string>>(new Set());
  // Toggle state — false by default per design decision #2 (Grant
  // 2026-05-23): archived users hidden by default, the toggle is the
  // "temporary returner" escape hatch so they can re-login without
  // bugging the PI.
  const [showArchived, setShowArchived] = useState(false);

  // NextAuth session, read by FETCHING /api/auth/session directly rather than
  // useSession(). This app mounts NO <SessionProvider> (the existing OAuth code
  // in SharingSetupWizard and the unlock-resume effect below both hit the
  // endpoint the same way), so useSession() throws "must be wrapped in a
  // SessionProvider". Used to show/hide the "Enable sharing" OAuth section in
  // the picker: authenticated shows "Signed in as X", otherwise the OAuth
  // buttons. Offline we never call it and stay unauthenticated.
  const [session, setSession] = useState<{
    user?: { email?: string | null; name?: string | null } | null;
  } | null>(null);
  const [sessionStatus, setSessionStatus] = useState<
    "loading" | "authenticated" | "unauthenticated"
  >("loading");
  useEffect(() => {
    if (!isOnline) {
      setSession(null);
      setSessionStatus("unauthenticated");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", {
          headers: { accept: "application/json" },
        });
        const data = (await res.json()) as {
          user?: { email?: string | null; name?: string | null } | null;
        } | null;
        if (cancelled) return;
        if (data && data.user) {
          setSession(data);
          setSessionStatus("authenticated");
        } else {
          setSession(null);
          setSessionStatus("unauthenticated");
        }
      } catch {
        if (!cancelled) {
          setSession(null);
          setSessionStatus("unauthenticated");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOnline]);

  // Bug report state
  const { showBugReport, currentError, openBugReport, closeBugReport } = useErrorReporting();

  // Roadmap modal state
  const [roadmapOpen, setRoadmapOpen] = useState(false);

  const refreshLockStatus = async (usernames: string[]) => {
    const next = new Set<string>();
    await Promise.all(
      usernames.map(async (u) => {
        try {
          if (await hasLocalAccount(u)) next.add(u);
        } catch {
          // If we can't read, treat as unlocked rather than crashing the screen.
        }
      })
    );
    setLockedUsers(next);
  };


  // D1: fan-out read of every user's `_sharing_identity.json` to find
  // accounts that have PUBLISHED a global sharing identity via OAuth. Mirrors
  // `refreshLockStatus` — a per-user read failure leaves the user out of the
  // set, so a missing or unreadable sidecar just means "no provider unlock
  // offered", which falls back to the recovery-code gate.
  //
  // The discriminator is the sidecar's `email`, NOT mere file existence. Under
  // the local-keypair-first model (IDENTITY_OAUTH_ONLY.md, 2026-06-06) a SOLO
  // account also has a sidecar (it carries recoveryBlob + public keys) but NO
  // email, because it was never published. Gating on hasSharingIdentity() alone
  // (file exists) wrongly flagged solo folders as OAuth-claimed, so reconnecting
  // a never-logged-in folder demanded a third-party sign-in that was never set
  // up. Only an account PUBLISHED under an email has a real OAuth door to offer,
  // so claimedUsers (which renders the "Sign in online to unlock" providers) is
  // keyed on sidecar.email.
  const refreshClaimedStatus = async (usernames: string[]) => {
    const next = new Set<string>();
    await Promise.all(
      usernames.map(async (u) => {
        try {
          const sidecar = await readSharingIdentity(u);
          if (sidecar?.email) next.add(u);
        } catch {
          // Treat as unpublished on read failure — never show a provider
          // option we cannot back with a real published identity.
        }
      }),
    );
    setClaimedUsers(next);
  };

  // Fan-out read of every user's settings.json to find lab_head accounts.
  // Mirrors the `refreshLockStatus` shape — a failed read leaves the user
  // out of the set (i.e. defaults to member), which is the safe choice
  // since elevating to lab_head by accident would be misleading. The PI
  // badge + sort tier both key off this set.
  const refreshLabHeadStatus = async (usernames: string[]) => {
    const next = new Set<string>();
    await Promise.all(
      usernames.map(async (u) => {
        try {
          const settings = await readUserSettings(u);
          if (settings.account_type === "lab_head") next.add(u);
        } catch {
          // Treat as member on read failure — never accidentally elevate.
        }
      })
    );
    setLabHeadUsers(next);
  };

  // When the force-create gate opens for a new member, compute the lab head's
  // membership agreement (if enabled) so the account-creation modal can present
  // it. A brand-new account has never accepted, so an enabled agreement always
  // shows. Co-PI folders use the first lab head's agreement (the lab's text).
  useEffect(() => {
    if (!forceProfileFor) {
      setJoinAgreement(null);
      return;
    }
    const labHead = Array.from(labHeadUsers)[0];
    if (!labHead) {
      setJoinAgreement(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const s = await readUserSettings(labHead);
        const ag = s.labMembershipAgreement;
        if (!cancelled) {
          setJoinAgreement(
            ag && ag.enabled
              ? { text: ag.text, version: ag.version, labHead }
              : null,
          );
        }
      } catch {
        if (!cancelled) setJoinAgreement(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceProfileFor, labHeadUsers]);

  // Lab Head Phase 6: fan-out read of every user's `_onboarding.json` to
  // find archived accounts. Mirrors the lab_head fan-out — a per-user
  // read failure drops that user into the non-archived tier so a broken
  // sidecar can never accidentally hide an active member.
  const refreshArchivedStatus = async (usernames: string[]) => {
    try {
      const set = await readArchivedSet(usernames);
      setArchivedUsers(set);
    } catch {
      // Whole-batch failure — treat as none-archived. Safe default.
      setArchivedUsers(new Set());
    }
  };

  useEffect(() => {
    if (users.length > 0) {
      refreshLabHeadStatus(users);
      refreshArchivedStatus(users);
      refreshClaimedStatus(users);
    }
  }, [users]);

  // D1: track online status so the provider-unlock buttons only appear when
  // the network is available. Offline, the password gate stands alone,
  // exactly as today. We seed from navigator.onLine and follow the events.
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsOnline(navigator.onLine);
    }
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (recoveryMode && recoveryInputRef.current) {
      recoveryInputRef.current.focus();
    }
  }, [recoveryMode]);

  useEffect(() => {
    loadUsers();
  }, []);

  // D1: resume a provider unlock after the OAuth redirect. When the browser
  // returns from Google or GitHub it carries ?sharingUnlock=<username> and a
  // signed-in session. We read the verified session email, compare it to
  // that account's claimed identity (the sidecar email), and on a match
  // unlock the account, the same effect as a correct password. On a mismatch
  // we drop the user onto the password gate with a clear message so the
  // offline fallback is always one step away. We wait for the user list so
  // the username is valid before signing in, and guard with a ref so a
  // re-render does not re-run the unlock.
  const unlockResumeHandled = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading || users.length === 0) return;
    if (unlockResumeHandled.current) return;

    const url = new URL(window.location.href);
    const target = url.searchParams.get(UNLOCK_QUERY_PARAM);
    if (!target) return;
    unlockResumeHandled.current = true;

    // Strip the flag immediately so a manual refresh never re-runs the
    // unlock, regardless of how the match resolves.
    url.searchParams.delete(UNLOCK_QUERY_PARAM);
    window.history.replaceState(
      null,
      "",
      url.pathname + url.search + url.hash,
    );

    // An unknown user (deleted/renamed since the redirect) cannot be
    // unlocked; bail quietly back to the picker.
    if (!users.includes(target)) return;

    setUnlockingViaProvider(true);
    setUnlockGate({ username: target });
    setRecoveryMode(false);
    setRecoveryInput("");
    setError(null);

    (async () => {
      try {
        const [sessionRes, sidecar] = await Promise.all([
          fetch("/api/auth/session", { headers: { accept: "application/json" } }),
          readSharingIdentity(target),
        ]);
        const session = (await sessionRes.json()) as {
          user?: { email?: string | null } | null;
        } | null;

        // The unlock decision (does the verified session email match the
        // email this account claimed its identity under?) lives in the pure,
        // unit-tested evaluateUnlockMatch so the security rule is explicit and
        // covered. A provider sign-in unlocks ONLY the one account bound to its
        // verified email, never any successful Google or GitHub login.
        const match = evaluateUnlockMatch(
          session?.user?.email ?? null,
          sidecar?.email ?? null,
        );
        if (!match.ok) {
          setError(
            match.reason === "no-session-email"
              ? "Could not confirm your sign-in. Use your passkey or recovery code, or try the provider again."
              : "That account does not match this identity. Use your passkey or recovery code, or sign in with the email this identity is registered under.",
          );
          setUnlockingViaProvider(false);
          return;
        }
        // Verified email matches the claimed identity: sign in. The on-device
        // key load is handled by the session (or the transition IndexedDB
        // fallback); the passkey and recovery-code doors remain available.
        setUnlockGate(null);
        setUnlockingViaProvider(false);
        await performLogin(target);
      } catch {
        setError(
          "Could not confirm your sign-in. Use your passkey or recovery code, or try the provider again.",
        );
        setUnlockingViaProvider(false);
      }
    })();
  }, [loading, users]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingUser && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingUser]);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersResponse, mainUserResponse] = await Promise.all([
        // Identity chooser: only real local accounts, never materialized
        // co-members (a lone member must not be offered to sign in as their PI).
        usersApi.listLocalIdentities(),
        usersApi.getMainUser()
      ]);
      setUsers(usersResponse.users);
      setMainUser(mainUserResponse.main_user || null);
    } catch {
      setError("Failed to load users. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  // Load an unlocked local-account keypair into this device's session so the
  // sharing and collab features see the identity. Best-effort, a save failure
  // never blocks the login itself (the user is still let into their folder).
  const persistUnlockedIdentity = async (keys: UnlockedKeys) => {
    try {
      await saveIdentity({
        keys: {
          encryption: {
            publicKey: decodePublicKey(keys.x25519PublicKey),
            privateKey: keys.x25519PrivateKey,
          },
          signing: {
            publicKey: decodePublicKey(keys.ed25519PublicKey),
            privateKey: keys.ed25519PrivateKey,
          },
        },
        deviceSalt: generateDeviceSalt(),
      });
    } catch {
      // Non-fatal, the login proceeds without the keypair in the session.
    }
  };

  // performLogin enters the app. The unlock paths (passkey / recovery / OAuth)
  // already park the unwrapped key in the session before calling this, so it
  // must NOT touch identity storage, it is purely "switch the active user".

  const performLogin = async (username: string) => {
    try {
      await usersApi.login(username);
      await setCurrentUser(username);
      onLogin();
    } catch {
      setError("Failed to login. Please try again.");
      setLoggingIn(null);
    }
  };

  // Account-first auto-provision. A signed-in cloud account that connects a
  // FRESH, empty folder already carries everything the first workspace user
  // needs (a claimed display name + @handle, plus the verified session email),
  // so the "No users yet, create one" screen is pure friction. We silently mint
  // that first user from the account profile: create the user record, give it a
  // stable palette color, and mint the E2E identity keypair (createLocalIdentity
  // writes the sidecar AND parks the unlocked key in the session), then sign in.
  //
  // The keypair mint is the SAME provisioning the manual create-user gate does,
  // and is exactly what the lab-create resume (LabCreateResume -> getSessionIdentity)
  // expects to already exist, so a PI who lands here can immediately create a lab.
  // We do NOT surface the recovery code here (this is the silent path); the user
  // can save/rotate it later from Settings -> Sharing, where the unconfirmed
  // recovery state is surfaced. DEVICE_KEY_V2 is off, so this device-local
  // keypair is the canonical identity for this folder.

  // Phase B (account/folder/identity redesign, §4.1/§6b): REUSE this account's
  // existing on-device identity in a folder instead of minting a fresh keypair,
  // so one cloud account stays the SAME identity across every lab folder. The
  // guard is strict: the device must already hold an identity AND that identity's
  // public key must match the directory record published under the signed-in
  // email (fetchMyProfile). Only on that verified match do we write a reference
  // sidecar (public-only, no recoveryBlob) and park the already-owned key. Any
  // uncertain case (flag off, offline, no local identity, unpublished account, a
  // fingerprint mismatch, or any thrown error) returns false so the caller keeps
  // its existing mint / force-profile behavior. This NEVER makes a path less safe:
  // a previous user's vault key on a shared machine cannot pass the directory
  // public-key match, so it can never be sealed into a different person's folder.
  const reuseAccountIdentityIfVerified = async (
    username: string,
  ): Promise<boolean> => {
    if (!MULTI_FOLDER_ENABLED) return false;
    try {
      const existing = await loadIdentity();
      if (!existing) return false;
      const profile = await fetchMyProfile();
      if (
        profile &&
        compactFingerprint(profile.fingerprint) ===
          compactFingerprint(computeFingerprint(existing.keys.signing.publicKey))
      ) {
        await writeIdentityReferenceSidecar(username, existing.keys);
        return true;
      }
    } catch {
      // Any error -> fall back to the caller's mint / force-profile path.
    }
    return false;
  };

  // Phase C5: run the cross-device restore. Unwraps the account's canonical
  // keypair from the cloud backup with the recovery code (sets the session +
  // at-rest vault), then writes a reference sidecar for this folder and enters.
  // After a successful restore loadIdentity() is non-null, so the same verified
  // reuse path the same-device case uses now writes the sidecar; a defensive
  // direct write covers the unlikely case reuse declines (e.g. a profile-read
  // hiccup) so a restored user is never stranded.
  const handleCrossDeviceRestore = async () => {
    if (!crossDeviceRestore) return;
    const { username } = crossDeviceRestore;
    setError(null);
    setRestoring(true);
    try {
      const result = await recoverDeviceKeyFromCloud(restoreInput);
      if (!result.ok) {
        setError(
          result.reason === "wrong-words"
            ? "That recovery code does not match this account."
            : result.reason === "no-blob"
              ? "No cloud backup was found for this account to restore."
              : result.reason === "unauthorized"
                ? "Your sign-in expired. Sign in again, then restore."
                : "Could not reach the server. Check your connection and try again.",
        );
        setRestoring(false);
        return;
      }
      // Identity is now on this device. Bind it to this folder's sidecar.
      const linked = await reuseAccountIdentityIfVerified(username);
      if (!linked) {
        const restored = await loadIdentity();
        if (restored) {
          await writeIdentityReferenceSidecar(username, restored.keys);
        }
      }
      setCrossDeviceRestore(null);
      setRestoreInput("");
      setRestoring(false);
      await performLogin(username);
    } catch {
      setError("Could not restore your identity on this device. Please try again.");
      setRestoring(false);
    }
  };

  // Phase C5: abandon the restore. The workspace user dir was created during
  // auto-provision, so dropping back lands on the normal picker (the user can
  // retry restore from there, or use a different folder). We do NOT mint a
  // divergent identity here — that is the whole point of the guard.
  const cancelCrossDeviceRestore = () => {
    setCrossDeviceRestore(null);
    setRestoreInput("");
    setRestoring(false);
    setError(null);
  };

  const autoProvisionFromAccount = async () => {
    setAutoProvisioning(true);
    setError(null);
    try {
      // Resolve the human name + @handle from the claimed profile. A missing or
      // failed profile read just leaves us to fall back to the session name /
      // email below, so a transient API hiccup never blocks provisioning.
      let displayName: string | null = null;
      let handle: string | null = null;
      try {
        const res = await fetch("/api/account/profile", {
          headers: { accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as {
            profile?: { displayName?: string | null; handle?: string | null } | null;
          };
          displayName = data?.profile?.displayName ?? null;
          handle = data?.profile?.handle ?? null;
        }
      } catch {
        // Fall through to the session name / email.
      }

      const username = deriveWorkspaceUsername({
        displayName,
        sessionName: session?.user?.name ?? null,
        handle,
        email: session?.user?.email ?? null,
      });

      // No usable name anywhere — drop back to the manual screen rather than
      // invent one. autoProvisionAttempted stays true so we do not loop.
      if (!username) {
        setAutoProvisioning(false);
        return;
      }

      // 1. Create the workspace user (writes the user dir + curated settings and
      //    sets it as the current user).
      await usersApi.create(username);
      await setCurrentUser(username);

      // 2. Give it a stable palette color so avatars render consistently (the
      //    manual path does this via the color picker). Best-effort.
      try {
        const meta = await readAllUserMetadata();
        const others = await otherUsersOnlyAsync(meta, username);
        await createUserMetadataEntry(
          username,
          suggestInitialColorForNewUser(username, others),
          null,
        );
        queryClient.invalidateQueries({ queryKey: USER_COLOR_QUERY_KEY });
      } catch {
        // A missing color just falls back to the username-hash swatch.
      }

      // 3. Establish the E2E identity for this folder. Phase B (account/folder/
      //    identity redesign): if this device already holds THIS account's
      //    identity AND it matches the directory record published under the
      //    signed-in email, REUSE that one keypair (write a reference sidecar) so
      //    the account is the SAME identity across every lab folder. Only the
      //    FIRST folder for an account mints a fresh keypair. The directory
      //    public-key match is the guard so a previous user's vault key on a
      //    shared machine can never be sealed into this new folder. Any failure
      //    to verify (flag off, offline, unpublished, or a mismatch) falls back
      //    to the original mint, so this is never less safe than before.
      const reusedIdentity = await reuseAccountIdentityIfVerified(username);
      if (!reusedIdentity) {
        // Cross-device safe guard (Phase B §6b). Reuse did NOT happen. Before
        // silently minting a fresh keypair, make sure we are not about to DIVERGE
        // from an identity this account already published elsewhere. On a NEW
        // laptop the device vault is empty (loadIdentity() is null) but the
        // account may already own a canonical keypair published from another
        // device or folder. Minting a NEW one here would fork the account's
        // identity and, on publish, fight / overwrite the canonical record. So:
        // when the flag is on AND there is NO local identity AND the account HAS
        // a published profile, do NOT mint. Stop auto-provisioning and surface a
        // clear "restore on this device" state instead, leaving the canonical
        // identity intact. The reuse path above already covered the case where a
        // local identity exists and matches; a local identity that exists but
        // does NOT match still falls through to mint (it is not this account's
        // key, so a fresh per-folder keypair is the correct, unchanged behavior).
        if (MULTI_FOLDER_ENABLED) {
          let publishedElsewhere = false;
          try {
            const local = await loadIdentity();
            if (!local) {
              const profile = await fetchMyProfile();
              publishedElsewhere = !!profile;
            }
          } catch {
            // Could not determine — fall through to the unchanged mint so a
            // transient profile-read hiccup never blocks first-ever setup.
          }
          if (publishedElsewhere) {
            // Phase C5: the account has a canonical identity published from
            // another device. Instead of minting a divergent key (or dead-ending
            // at an error), open the cross-device restore gate: the user enters
            // their recovery code, we unwrap the canonical keypair from the cloud
            // backup, write a reference sidecar for THIS folder, and enter — the
            // same end state as the same-device reuse path. The workspace user
            // dir was already created above (step 1), so the restore handler only
            // needs to establish the identity + performLogin. autoProvisionAttempted
            // stays true so this does not loop; the modal (or its cancel) takes over.
            setCrossDeviceRestore({ username });
            setAutoProvisioning(false);
            return;
          }
        }
        // Solo-deferred identity (§8): under MULTI_FOLDER, do NOT mint a keypair
        // here. Enter with no identity (the data layer is keypair-free); a keypair
        // is minted on demand at the first sharing action via ensureLocalIdentity,
        // which surfaces the recovery code then. This closes the one path that
        // minted a recovery-code-locked identity without ever showing the user the
        // code. Flag-OFF keeps the eager silent mint, so behavior is byte-identical.
        if (!MULTI_FOLDER_ENABLED) {
          // Mint the E2E identity keypair silently (sidecar at rest + unlocked key
          // in the session). The provisioning the manual create-user gate performs
          // and the lab-create flow relies on; also the account's FIRST folder.
          await createLocalIdentity(username);
        }
      }

      // 4. Enter the app.
      await performLogin(username);
    } catch (err) {
      console.error("[UserLoginScreen] account-first auto-provision failed:", err);
      setError(
        "We could not finish setting up your workspace. Create a user to continue.",
      );
      setAutoProvisioning(false);
    }
  };

  // Trigger the auto-provision exactly once when a signed-in, account-first
  // visitor lands on a connected folder that has NO local users yet. Every other
  // case (offline / not signed in, a folder that already has users, demo/wiki
  // fixtures, a switch-user with someone already active, or a failed user-list
  // read) falls through to the normal picker untouched.
  useEffect(() => {
    if (autoProvisionAttempted.current) return;
    if (loading) return; // user list not ready
    if (error) return; // a failed loadUsers would look like an empty folder
    if (sessionStatus === "loading") return; // session check still in flight
    if (!isAccountFirstEnabled()) return;
    if (isDemoOrWikiCapture()) return;
    if (sessionStatus !== "authenticated" || !session?.user) return;
    if (users.length !== 0) return; // only a fresh, empty folder
    if (contextCurrentUser) return; // not a switch-user case
    autoProvisionAttempted.current = true;
    void autoProvisionFromAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, sessionStatus, session, users, contextCurrentUser]);

  // Close the optional profile step and enter the app. Used by the step's
  // "Skip for now" button and by the wizard's onComplete (after setup the user
  // continues straight in).
  const skipProfileStep = () => {
    setProfileWizardOpen(false);
    setProfileStep(null);
    onLogin();
  };

  const handleLogin = async (username: string) => {
    setLoggingIn(username);
    setError(null);
    // Demo / wiki-capture mode: no login, no passcode, no account-creation gate.
    // The fixture user (e.g. mira) enters the app directly. Demo folders are
    // ephemeral fixtures, so the keypair/passkey/recovery ceremony is pure
    // friction there and must never appear.
    if (isDemoOrWikiCapture()) {
      await performLogin(username);
      return;
    }
    try {
      // A profile identity exists when this user's sidecar carries a wrapped
      // device key (recoveryBlob). That is the OAuth-only "account", so open the
      // unlock gate (recovery code + optional OAuth) to unwrap the on-device key.
      const sidecar = await readSharingIdentity(username);
      if (sidecar?.recoveryBlob) {
        const canOAuth = claimedUsers.has(username) && isOnline;
        // Default to recovery-code input when no online OAuth option is available.
        setRecoveryMode(!canOAuth);
        setRecoveryInput("");
        setUnlockGate({ username });
        return;
      }

      // Phase B (Follow-on 3): reference-sidecar login. A reused folder carries a
      // sidecar with the public identity but NO recoveryBlob, because recovery is
      // account-level. Such a user would skip the unlock gate above, then could be
      // wrongly forced to re-create an identity they already hold. So when the
      // sidecar has no recoveryBlob BUT this device's loaded identity public-key /
      // fingerprint MATCHES the sidecar, the account is already established on this
      // device -> sign in directly, skipping BOTH the unlock gate and the
      // force-profile gate. A genuine new member in a shared folder (no local
      // identity, or one that does NOT match) still falls through to the existing
      // force-profile logic, so this never weakens the shared-folder gate. Gated on
      // MULTI_FOLDER_ENABLED so flag-off behavior is byte-identical to today.
      if (MULTI_FOLDER_ENABLED && sidecar && !sidecar.recoveryBlob) {
        try {
          const local = await loadIdentity();
          if (
            local &&
            encodePublicKey(local.keys.signing.publicKey) ===
              sidecar.ed25519PublicKey &&
            encodePublicKey(local.keys.encryption.publicKey) ===
              sidecar.x25519PublicKey &&
            compactFingerprint(
              computeFingerprint(local.keys.signing.publicKey),
            ) === compactFingerprint(sidecar.fingerprint)
          ) {
            await performLogin(username);
            return;
          }
        } catch {
          // Match check failed (no local identity / read error) -> fall through to
          // the existing force-profile logic, the safe default.
        }
      }

      // No profile yet. A login is mandatory once a folder is shared (two or
      // more users) or a lab head is present, so the user must MAKE A PROFILE
      // (OAuth) before signing in. A genuinely solo folder has no login and goes
      // straight in. The `labHeadUsers` set loads async after the user list, so
      // a click before the fan-out settles could miss a PI, we ALSO read this
      // user's settings directly to make the lab_head call authoritative at
      // click time. The user count is already known from the loaded list.
      let isLabHead = labHeadUsers.has(username);
      if (!isLabHead) {
        try {
          const settings = await readUserSettings(username);
          isLabHead = settings.account_type === "lab_head";
        } catch {
          // Settings read failed — fall back to the fast-path value (false). A
          // real PI is already in labHeadUsers once the screen settles, and a
          // shared folder still forces via the user-count branch.
        }
      }
      // Account-scoped PI capability (Phase 1, account-settings foundation). A PI
      // who opens a NEW empty folder lacks the folder-local lab_head marker, so
      // the folder scan misses them; consulting the account capability recognizes
      // them as a lab head regardless of which folder they opened. Flag-gated,
      // fetchAccountSettings returns null when off, so this is inert by default.
      if (!isLabHead && isAccountSettingsEnabled()) {
        try {
          const account = await fetchAccountSettings();
          isLabHead = resolveIsLabHead(undefined, account?.labHead);
        } catch {
          // Never let an account-capability lookup block the login decision.
        }
      }
      if (folderRequiresLogin(users.length, isLabHead || labHeadUsers.size > 0)) {
        setForceProfileFor({ username });
        return;
      }
    } catch {
      // If we can't read the sidecar, fall through to a plain login — safer than
      // locking the user out on a transient FS error.
    }
    await performLogin(username);
  };

  const cancelUnlockGate = () => {
    setUnlockGate(null);
    setUnlocking(false);
    setRecoveryMode(false);
    setRecoveryInput("");
    setUnlockingViaProvider(false);
    setResetConfirmFor(null);
    setResetting(false);
    setLoggingIn(null);
    setError(null);
  };

  // Offline fallback door, the recovery code (or 12 words). Unwraps the
  // on-device key with the code instead of the passkey, then signs in. A wrong
  // code fails the Poly1305 tag and unlockIdentityWithRecovery returns null.
  const handleSubmitRecovery = async () => {
    if (!unlockGate) return;
    setError(null);
    setUnlocking(true);
    try {
      const identity = await unlockIdentityWithRecovery(
        unlockGate.username,
        recoveryInput,
      );
      if (!identity) {
        setError("That recovery code does not match this account.");
        setUnlocking(false);
        return;
      }
      const { username } = unlockGate;
      setUnlockGate(null);
      setRecoveryMode(false);
      setRecoveryInput("");
      setUnlocking(false);
      await performLogin(username);
    } catch {
      setError("Could not unlock with that recovery code. Please try again.");
      setUnlocking(false);
    }
  };

  // Phase C1: the reset-keep-data confirm. Mints a fresh identity for a
  // locked-out user while leaving their plaintext notebook data on disk
  // untouched, then surfaces the new one-time recovery code through the same
  // createdRecovery display a brand-new account uses. The old signing key,
  // prior signatures, and the ability to read data previously shared TO the old
  // key are lost (warned about in the confirm view); a shared lab needs the PI
  // to re-admit the new key (Phase C2). No backend — purely client-side.
  const handleResetKeepData = async () => {
    const username = resetConfirmFor;
    if (!username) return;
    setError(null);
    setResetting(true);
    try {
      const { recoveryCode } = await resetIdentityKeepData(username);
      // Tear down the unlock + confirm surfaces, then hand off to the
      // save-your-recovery-code step which signs the user in on continue.
      setResetConfirmFor(null);
      setUnlockGate(null);
      setRecoveryMode(false);
      setRecoveryInput("");
      setResetting(false);
      setCreatedRecovery({ username, code: recoveryCode });
    } catch {
      setError("Could not reset this account. Your data is unchanged — please try again.");
      setResetting(false);
    }
  };

  // D1: start a provider unlock for a claimed account. OAuth is a full-page
  // redirect (the same pattern SharingSetupWizard.startOAuth uses), so we
  // stash WHICH user we are unlocking in the callback URL via
  // ?sharingUnlock=<username>. When the browser returns, the resume effect
  // below reads the signed-in session email and matches it against that
  // user's claimed identity sidecar. This is an online convenience alongside the
  // offline doors, a user can still cancel and unlock with their passkey or
  // recovery code instead.
  const startUnlockOAuth = (provider: "google" | "github" | "linkedin" | "microsoft-entra-id", username: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set(UNLOCK_QUERY_PARAM, username);
    void signIn(provider, {
      callbackUrl: url.pathname + url.search + url.hash,
    });
  };

  const handleCreateUser = async () => {
    const username = newUsername.trim();
    if (!username) {
      setError("Please enter a username");
      return;
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError("Username can only contain letters, numbers, and underscores");
      return;
    }

    // Refuse if the name collides with an existing user. Without this
    // check the color picker would briefly mount for a name that
    // `usersApi.create` would then silently overwrite/login as. The
    // picker isn't the right surface to surface the collision message.
    if (users.includes(username)) {
      setError(`User '${username}' already exists. Pick a different name.`);
      return;
    }

    // Compute the random palette default for the popup. We snapshot the
    // metadata BEFORE opening so the popup's "Used by <name>" tooltips
    // reflect what's actually on disk (not a stale cached map). The
    // snapshot is cheap — _user_metadata.json is a single small JSON
    // file.
    setLoggingIn("creating");
    setError(null);
    try {
      const meta = await readAllUserMetadata();
      // The new user isn't in the map yet — `otherUsersOnlyAsync` also
      // strips tombstoned AND Phase 6 archived users so freed-up
      // palette slots become available again (Mira Batch 1 polish,
      // 2026-05-23).
      const others = await otherUsersOnlyAsync(meta, username);
      const defaultColor = suggestInitialColorForNewUser(username, others);
      setColorPicker({ username, defaultColor, otherUsers: others });
      // Keep the Create button in its busy state while the popup is up
      // so a re-click doesn't double-mount.
    } catch (err) {
      console.error("Failed to prep color picker:", err);
      // Fall back to the silent create path if the metadata snapshot
      // fails — the user still gets a usable account; their color just
      // comes from the deterministic hash. Better than blocking
      // creation entirely on a metadata read hiccup.
      try {
        await usersApi.create(username);
        // Enter the session so the wizard / profile step can write this user's
        // sidecar by path.
        await setCurrentUser(username);
        setLoggingIn(null);
        // Demo / wiki-capture: no account-creation gate, enter directly.
        if (isDemoOrWikiCapture()) {
          onLogin();
          return;
        }
        // Phase B (Follow-on 1): reuse this account's verified on-device identity
        // for the new user instead of forcing a fresh keypair mint. A verified
        // reuse means the account is already established here, so sign in
        // directly; otherwise the force / optional-profile logic runs unchanged.
        if (await reuseAccountIdentityIfVerified(username)) {
          onLogin();
          return;
        }
        if (folderRequiresLogin(users.length + 1, labHeadUsers.size > 0)) {
          // Shared folder: a profile (OAuth) is mandatory before entering, so
          // force the setup wizard rather than offering it as optional.
          setForceProfileFor({ username });
          return;
        }
        // Solo first user. Offer the optional OAuth-publish step only where it
        // works; otherwise enter straight in (the account is a local keypair the
        // user can set up later from Profile, OAuth publish is optional).
        if (isOAuthPublishAvailable()) setProfileStep({ username });
        else onLogin();
      } catch {
        setError("Failed to create user. Please try again.");
        setLoggingIn(null);
      }
    }
  };

  // Color picker accepted — persist the chosen color BEFORE
  // usersApi.create so by the time the new user logs in, every
  // UserAvatar that resolves them already finds a stored entry (the
  // render path prefers stored over the username hash). This is the
  // anchor that survives later renames: the rename helper migrates
  // _user_metadata.json so the entry travels with the user, and from
  // there `useUserColors` reads the same persisted swatch the user
  // accepted at creation time. The original "rename re-rolled my color"
  // bug was that no entry ever got written at creation, so the avatar
  // fell back to `fallbackColorForUsername(username)` which IS
  // username-hashed and DOES change on rename.
  const handleColorPickerAccept = async (
    color: string,
    colorSecondary: string | null,
  ) => {
    if (!colorPicker) return;
    const { username } = colorPicker;
    try {
      // 1. Persist the chosen color first. If this fails, we abort
      //    creation rather than ending up with a user-with-no-color.
      //    `colorSecondary` is non-null when the user opted into the
      //    2-stop gradient via the popup's optional second-color row.
      await createUserMetadataEntry(username, color, colorSecondary);

      // 2. Bust the user-color cache so any avatar that re-renders
      //    after login picks up the new entry without a stale read.
      queryClient.invalidateQueries({ queryKey: USER_COLOR_QUERY_KEY });

      // 3. Finalize user creation.
      await usersApi.create(username);
      setColorPicker(null);
      // Enter the session so the wizard / profile step can write this user's
      // sidecar by path.
      await setCurrentUser(username);
      setLoggingIn(null);

      // Demo / wiki-capture: no account-creation gate, enter directly.
      if (isDemoOrWikiCapture()) {
        onLogin();
        return;
      }

      // Phase B (Follow-on 1): if this device already holds THIS account's
      // verified identity, REUSE it for the new user (a reference sidecar) rather
      // than forcing CreateLocalIdentityStep to mint a second keypair. A verified
      // reuse means the account is already established on this device, so the user
      // is signed in directly. Only when reuse does NOT happen does the original
      // force / optional-profile logic below run unchanged. The match is
      // fingerprint-verified against the directory, so a non-account key never
      // reuses; flag-off short-circuits to false, keeping today's behavior.
      if (await reuseAccountIdentityIfVerified(username)) {
        onLogin();
        return;
      }

      // In a shared folder (this new user makes it 2+, or a lab head is present)
      // the user must MAKE A PROFILE (OAuth) before entering, so force the setup
      // wizard, which mints the keypair and shows its own recovery code. A solo
      // first user stays login-free and just sees the optional profile step.
      if (folderRequiresLogin(users.length + 1, labHeadUsers.size > 0)) {
        setForceProfileFor({ username });
        return;
      }

      // Solo first user. Offer the optional OAuth-publish step only where it
      // works; otherwise enter straight in (OAuth publish is optional, the local
      // account can be set up later from Profile).
      if (isOAuthPublishAvailable()) setProfileStep({ username });
      else onLogin();
    } catch (err) {
      console.error("Failed to finalize user creation:", err);
      setError("Failed to create user. Please try again.");
      setColorPicker(null);
      setLoggingIn(null);
    }
  };

  const handleColorPickerCancel = () => {
    // No bytes were written yet — just dismiss and return the user to
    // the form so they can either retry or back out entirely. We also
    // clear the busy state on the Create button.
    setColorPicker(null);
    setLoggingIn(null);
  };

  const startEdit = (user: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingUser(user);
    setEditValue(user);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingUser(null);
    setEditValue("");
    setError(null);
  };

  const handleRename = async (oldUsername: string) => {
    const newUsername = editValue.trim();
    
    // Validate
    if (!newUsername) {
      setError("Username cannot be empty");
      return;
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      setError("Username can only contain letters, numbers, and underscores");
      return;
    }
    
    // If no change, just cancel
    if (newUsername === oldUsername) {
      cancelEdit();
      return;
    }
    
    setRenaming(true);
    setError(null);
    
    try {
      await usersApi.rename(oldUsername, newUsername);
      // Update local state
      setUsers(users.map(u => u === oldUsername ? newUsername : u));
      // Update main user if the renamed user was the main user
      if (mainUser === oldUsername) {
        setMainUser(newUsername);
      }
      setEditingUser(null);
      setEditValue("");
    } catch (err: unknown) {
      // usersApi.rename throws plain Error objects (collision, validation,
      // FS-disconnect). Surface `.message` first so the user sees the
      // friendly "Username 'foo' is already in use" string rather than a
      // generic "Failed to rename" fallback. The older `response.data.detail`
      // path is kept as a secondary lookup for the obsolete server-error
      // shape; harmless when absent.
      const message =
        err instanceof Error
          ? err.message
          : (err as { response?: { data?: { detail?: string } } })?.response
              ?.data?.detail;
      setError(message || "Failed to rename user. Please try again.");
    } finally {
      setRenaming(false);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, oldUsername: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRename(oldUsername);
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const handleSetMainUser = async (username: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await usersApi.setMainUser(username);
      setMainUser(username);
    } catch (err) {
      console.error("Failed to set main user:", err);
    }
  };

  const startDelete = (user: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteUserSelected(user);
    setDeleteUserArchive(true);
    setShowDeleteConfirm(true);
    setDeleteConfirmStep(1);
    setError(null);
  };

  const cancelDelete = () => {
    setDeleteUserSelected(null);
    setShowDeleteConfirm(false);
    setDeleteConfirmStep(0);
    setError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteUserSelected) return;
    
    if (deleteConfirmStep === 1) {
      // Step 1: Archive if requested, then move to step 2
      if (deleteUserArchive) {
        setIsArchivingUser(true);
        setError(null);
        try {
          const blob = await usersApi.archive(deleteUserSelected);
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${deleteUserSelected}_archive.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        } catch (err: unknown) {
          console.error("Archive error:", err);
          const errorMessage = err instanceof Error ? err.message : 
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to archive user data";
          setError(`Archive failed: ${errorMessage}. You can uncheck "Archive data" to proceed without backup.`);
          setIsArchivingUser(false);
          return;
        }
        setIsArchivingUser(false);
      }
      
      // Move to step 2 (final confirmation)
      setDeleteConfirmStep(2);
      return;
    }
    
    if (deleteConfirmStep === 2) {
      // Step 2: Execute deletion
      setIsDeletingUser(true);
      setError(null);
      
      try {
        // Persistence layer extracted to a pure module so the dangerous
        // branching (when-to-clear-currentUser, when-to-clear-mainUser) is
        // unit-testable. See lib/users/perform-delete.ts + its test file
        // for coverage of every branch — pinning fix 7ac7a9ab against
        // future silent regressions.
        await performUserDelete(deleteUserSelected, {
          currentUser: contextCurrentUser,
          mainUser,
          deleteUser: usersApi.delete,
          setCurrentUser,
          setMainUserPersisted: usersApi.setMainUser,
        });

        // Local UI state only — the picker list refreshes, and this
        // component's own mainUser mirror clears. Persistence already
        // happened inside performUserDelete.
        setUsers(users.filter(u => u !== deleteUserSelected));
        if (mainUser === deleteUserSelected) {
          setMainUser(null);
        }

        cancelDelete();
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Failed to delete user";
        setError(errorMessage);
      } finally {
        setIsDeletingUser(false);
      }
    }
  };

  // Tile sort order (Lab Head Phase 1 polish + Phase 6 archive):
  //   1. Active (non-archived) lab_head users (Main first)
  //   2. Active member users (Main first)
  //   3. Archived lab_head users (only shown when showArchived === true)
  //   4. Archived member users (only shown when showArchived === true)
  //   5. Alphabetical by username within each tier
  //
  // PI prominence wins over Main within the active tier — the live lab
  // head's tile is always at the very top, even if some other account
  // is flagged Main. Archived users go to the very bottom regardless of
  // role/main status; the visual "Archived" badge handles distinction.
  const sortedActiveUsers = useMemo(() => {
    const real = users.filter((u) => !archivedUsers.has(u));
    const tier = (u: string) => (labHeadUsers.has(u) ? 0 : 1);
    const mainRank = (u: string) => (mainUser === u ? 0 : 1);
    return [...real].sort((a, b) => {
      const tierDiff = tier(a) - tier(b);
      if (tierDiff !== 0) return tierDiff;
      const mainDiff = mainRank(a) - mainRank(b);
      if (mainDiff !== 0) return mainDiff;
      return a.localeCompare(b);
    });
  }, [users, labHeadUsers, mainUser, archivedUsers]);

  // Archived users — separate list so the toggle can show/hide them
  // independently. Sorted alphabetically; no tier preference inside the
  // archived bucket (archived lab_head is rare and doesn't need the
  // visual elevation that the active tier preserves).
  const sortedArchivedUsers = useMemo(() => {
    const real = users.filter((u) => archivedUsers.has(u));
    return [...real].sort((a, b) => a.localeCompare(b));
  }, [users, archivedUsers]);

  // Combined render list — active always, archived appended only when
  // the toggle is on. Existing `sortedUsers` consumers in the JSX
  // continue to work by reading this single variable.
  const sortedUsers = useMemo(() => {
    return showArchived
      ? [...sortedActiveUsers, ...sortedArchivedUsers]
      : sortedActiveUsers;
  }, [sortedActiveUsers, sortedArchivedUsers, showArchived]);

  // Quick-confirm only on a fresh connect (no one signed in) to a one-user
  // folder, and only until the user picks "someone else". The switch-user modal
  // (already signed in) always shows the full picker.
  const soleUser = users.length === 1 ? users[0] : null;
  const showQuickConfirm =
    !contextCurrentUser && !expandPicker && soleUser !== null;

  return (
    <div className="light-scope fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto px-4 pt-16 pb-28 bg-white">
      {/* Beta surfacing: the "v0.5.0 beta" version badge top-left. */}
      <VersionBadge tone="surface" className="fixed top-3 left-4 z-[110]" />
      {/* Shared deck-style backdrop, the same stage the OAuth-first landing uses
          (light radial wash, masked dot grid, drifting auroras + floating
          beakers on a cursor-parallax layer, rainbow bars), so the entry surface
          and the landing read as one. */}
      <LandingBackdrop />

      {/* max-w bumped from md (28rem / 448px) to 30rem (480px) — gives
          the user cards just enough extra room to seat the full action
          icon row (star / pencil / padlock / trash) inside the card
          alongside a PI badge and a moderately long username.
          Paired with min-w-0 + truncate on the username so very long
          names still fall back to ellipsis rather than overflowing.
          (picker card alignment fix, 2026-05-26) */}
      <div className="relative z-10 w-full max-w-[30rem] mx-4">
        {/* Logo and title. The animated bubble BeakerBot (IntroBubbleBot) is the
            same mascot the OAuth-first landing leads with, so the entry surface
            and the landing share one hero mark. */}
        <div className="text-center mb-8">
          <div className="mb-4 flex justify-center">
            <IntroBubbleBot size="sm" />
          </div>
          <h1 className="text-display font-extrabold tracking-tight text-brand-ink mb-2">ResearchOS</h1>
          <p className="text-foreground-muted">Select your account to continue</p>
        </div>

        {/* Main card */}
        <div className="bg-surface-raised backdrop-blur-xl rounded-2xl ros-popup-card-shadow border border-border overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground-muted"></div>
            </div>
          ) : autoProvisioning ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground-muted"></div>
              <p className="text-body text-foreground-muted mt-4 font-medium">
                Setting up your workspace
              </p>
              <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
                This only happens once and can take a few seconds.
              </p>
            </div>
          ) : showQuickConfirm && soleUser ? (
            <div className="p-6 text-center space-y-5">
              <div className="flex flex-col items-center gap-3">
                <UserAvatar username={soleUser} size="xl" />
                <div>
                  <p className="text-body text-foreground-muted">Continue as</p>
                  <p className="text-heading font-semibold text-foreground">
                    {soleUser}?
                  </p>
                </div>
              </div>
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                  <p className="text-body text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}
              <div className="space-y-2">
                <button
                  onClick={() => handleLogin(soleUser)}
                  disabled={loggingIn !== null}
                  className="w-full py-3 btn-brand text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Yes, I&apos;m {soleUser}
                </button>
                <button
                  onClick={() => {
                    setError(null);
                    setExpandPicker(true);
                  }}
                  className="w-full py-2.5 text-body bg-surface-sunken hover:bg-surface-sunken/70 border border-border text-foreground rounded-lg transition-colors"
                >
                  No, I&apos;m someone else
                </button>
              </div>
            </div>
          ) : showQuickConfirm && soleUser ? (
            <div className="p-6 text-center space-y-5">
              <div className="flex flex-col items-center gap-3">
                <UserAvatar username={soleUser} size="xl" />
                <div>
                  <p className="text-body text-slate-400">Continue as</p>
                  <p className="text-heading font-semibold text-white">
                    {soleUser}?
                  </p>
                </div>
              </div>
              {error && (
                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                  <p className="text-body text-red-300">{error}</p>
                </div>
              )}
              <div className="space-y-2">
                <button
                  onClick={() => handleLogin(soleUser)}
                  disabled={loggingIn !== null}
                  className="w-full py-3 btn-brand text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Yes, I&apos;m {soleUser}
                </button>
                <button
                  onClick={() => {
                    setError(null);
                    setExpandPicker(true);
                  }}
                  className="w-full py-2.5 text-body bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-lg transition-colors"
                >
                  No, I&apos;m someone else
                </button>
              </div>
            </div>
          ) : showCreateForm ? (
            <div className="p-6">
              <button
                onClick={() => setShowCreateForm(false)}
                className="flex items-center gap-2 text-foreground-muted hover:text-foreground mb-4 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to users
              </button>

              <h2 className="text-heading font-semibold text-foreground mb-4">Create New User</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-body font-medium text-foreground-muted mb-1.5">
                    Username
                  </label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
                    placeholder="Enter your username"
                    className="w-full px-4 py-3 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                  <p className="text-meta text-foreground-muted mt-1.5">
                    Letters, numbers, and underscores only
                  </p>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                    <p className="text-body text-red-700 dark:text-red-300">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleCreateUser}
                  disabled={loggingIn !== null}
                  className="w-full py-3 btn-brand text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loggingIn === "creating" ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Create & Login
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {/* Error message */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                  <p className="text-body text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}

              {/* User list */}
              <div className="space-y-2 mb-4">
                {sortedUsers.length === 0 ? (
                  <p className="text-center text-foreground-muted py-4">
                    No users yet. Create one to continue.
                  </p>
                ) : (
                  sortedUsers.map((user) => (
                    <div key={user} className="relative">
                      {editingUser === user ? (
                        // Edit mode
                        <div className="flex items-center gap-2 p-3 bg-surface-sunken border border-blue-500/50 rounded-xl">
                          <UserAvatar
                            username={user}
                            size="md"
                            letter={(editValue.charAt(0) || user.charAt(0))}
                          />
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleEditKeyDown(e, user)}
                            disabled={renaming}
                            className="flex-1 px-3 py-2 bg-surface-sunken border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            maxLength={50}
                          />
                          <Tooltip label="Save" placement="bottom">
                            <button
                              onClick={() => handleRename(user)}
                              disabled={renaming}
                              className="p-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 rounded-lg text-green-400 hover:text-green-300 transition-all disabled:opacity-50"
                            >
                              {renaming ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-400"></div>
                              ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                          </Tooltip>
                          <Tooltip label="Cancel" placement="bottom">
                            <button
                              onClick={cancelEdit}
                              disabled={renaming}
                              className="p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-400 hover:text-red-300 transition-all disabled:opacity-50"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </Tooltip>
                        </div>
                      ) : (
                        // Normal view - using div to avoid nested button hydration error
                        // role="button" + tabIndex + onKeyDown so keyboard users
                        // can land on the card and activate it with Enter or
                        // Space. Without this only the kebab action buttons were
                        // focusable so keyboard-only login was impossible.
                        // (panel mechanical fixes, 2026-05-26)
                        <div
                          role="button"
                          tabIndex={loggingIn === null ? 0 : -1}
                          aria-label={`Sign in as ${user}`}
                          aria-disabled={loggingIn !== null}
                          onClick={() => loggingIn === null && handleLogin(user)}
                          onKeyDown={(e) => {
                            if (loggingIn !== null) return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleLogin(user);
                            }
                          }}
                          className={`w-full flex items-center gap-3 p-4 bg-surface border border-border shadow-sm rounded-xl transition-all group cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-brand-sky/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised ${
                            loggingIn !== null ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        >
                          <UserAvatar
                            username={user}
                            size="md"
                            showOwnerBadge={mainUser === user}
                          />
                          {/* min-w-0 lets the flex-1 column shrink below
                              its intrinsic content width so a long
                              username (e.g. Emile_GluckThaler) combined
                              with the PI badge can't push the
                              action icons past the card's right edge.
                              The username span is the only shrinkable
                              child (truncates with ellipsis); badges and
                              the (Main) tag stay full-width via shrink-0.
                              (picker card alignment fix, 2026-05-26) */}
                          <div className="flex-1 min-w-0 text-left flex items-center gap-2">
                            <span className="text-foreground font-medium truncate">{user}</span>
                            {labHeadUsers.has(user) && (
                              // Lab Head badge — matches the CommentsThread
                              // author attribution badge (amber-100/amber-800).
                              // Generic "Lab Head" copy works across academia,
                              // industry, and government settings (avoided
                              // "PI" since it's academia-specific). The Main
                              // badge is orthogonal (laptop owner) and shows
                              // alongside when both apply.
                              <Tooltip label="PI" placement="bottom">
                                <span className="shrink-0 px-1.5 py-0.5 text-meta font-semibold rounded bg-amber-100 text-amber-800">
                                  PI
                                </span>
                              </Tooltip>
                            )}
                            {archivedUsers.has(user) && (
                              // Lab Head Phase 6: Archived badge. Gray so it
                              // visually de-emphasizes the tile compared to
                              // active members; the Show archived toggle
                              // below the grid controls visibility entirely.
                              // Clicking an archived tile still works (a
                              // returning postdoc can re-login without PI
                              // help — design decision #2, Grant 2026-05-23).
                              <Tooltip
                                label="Archived account, hidden by default"
                                placement="bottom"
                              >
                                <span className="shrink-0 px-1.5 py-0.5 text-meta font-semibold rounded bg-surface-sunken text-foreground-muted">
                                  Archived
                                </span>
                              </Tooltip>
                            )}
                            {claimedUsers.has(user) && (
                              // D5/D6: read-only "has sharing identity" badge.
                              // Purely informational, no click and no action.
                              // It mirrors the Lab Roster "Sharing" pill so the
                              // switcher and manage-members read as one signal.
                              // Local switching never controls the global
                              // identity (D5/D6), so do NOT grow this into a
                              // manage/reset affordance.
                              <Tooltip
                                label="Has a sharing identity"
                                placement="bottom"
                              >
                                <span
                                  className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-meta font-semibold rounded bg-sky-100 text-sky-800"
                                  data-testid={`login-sharing-identity-${user}`}
                                >
                                  <SharingIdentityIcon className="w-3 h-3" />
                                  Sharing
                                </span>
                              </Tooltip>
                            )}
                            {mainUser === user && (
                              <span className="shrink-0 text-meta text-amber-400 font-normal">(Main)</span>
                            )}
                          </div>
                          
                          {/* Set as Main button */}
                          {mainUser !== user && (
                            <div className="relative group/icon">
                              <button
                                onClick={(e) => handleSetMainUser(user, e)}
                                disabled={loggingIn !== null}
                                className="p-2 opacity-0 group-hover:opacity-100 hover:bg-amber-500/20 rounded-lg text-foreground-muted hover:text-amber-400 transition-all"
                                aria-label="Set as main user"
                                data-force-hover-controls-target
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                              </button>
                              <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-2 py-1 text-meta font-medium rounded bg-surface-overlay text-foreground border border-border opacity-0 group-hover/icon:opacity-100 transition-opacity z-10">
                                Set as main
                              </span>
                            </div>
                          )}

                          {/* Edit button */}
                          <div className="relative group/icon">
                            <button
                              onClick={(e) => startEdit(user, e)}
                              disabled={loggingIn !== null}
                              className="p-2 opacity-0 group-hover:opacity-100 hover:bg-surface-sunken rounded-lg text-foreground-muted hover:text-foreground transition-all"
                              aria-label="Rename user"
                              data-force-hover-controls-target
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-2 py-1 text-meta font-medium rounded bg-surface-overlay text-foreground border border-border opacity-0 group-hover/icon:opacity-100 transition-opacity z-10">
                              Rename
                            </span>
                          </div>

                          {/* Delete button */}
                          <div className="relative group/icon">
                            <button
                              onClick={(e) => startDelete(user, e)}
                              disabled={loggingIn !== null}
                              className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded-lg text-foreground-muted hover:text-red-400 transition-all"
                              aria-label="Delete user"
                              data-force-hover-controls-target
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-2 py-1 text-meta font-medium rounded bg-surface-overlay text-foreground border border-border opacity-0 group-hover/icon:opacity-100 transition-opacity z-10">
                              Delete user
                            </span>
                          </div>
                          
                          {loggingIn === user ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-foreground-muted"></div>
                          ) : (
                            <svg className="w-5 h-5 text-foreground-muted group-hover:text-foreground transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* PI Phase 6: Show archived toggle. Only renders when
                  there are archived users to surface — keeps the picker
                  uncluttered for labs with zero archives. The toggle
                  itself is a plain text-link style so it doesn't compete
                  with the Create user CTA below. */}
              {sortedArchivedUsers.length > 0 && (
                <div className="text-center mb-3">
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    disabled={loggingIn !== null}
                    className="text-meta text-foreground-muted hover:text-foreground underline-offset-2 hover:underline transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-pressed={showArchived}
                    data-testid="login-show-archived-toggle"
                  >
                    {showArchived
                      ? `Hide archived (${sortedArchivedUsers.length})`
                      : `Show archived (${sortedArchivedUsers.length})`}
                  </button>
                </div>
              )}

              {/* Create a user is ONLY offered on an EMPTY folder (the first
                  user has to be made somewhere). Once a folder already has a
                  user we do NOT offer creating another: the product no longer
                  supports multiple users in one folder. Each person uses their
                  OWN cloud-synced folder (visible on every machine they sign in
                  on), and collaboration is via sharing / lab invites — never by
                  piling users into one folder (Grant 2026-06-15). Existing
                  multi-user folders still list + log in every user; we just
                  never GROW one from this screen. */}
              {users.length === 0 && (
                <button
                  onClick={() => setShowCreateForm(true)}
                  disabled={loggingIn !== null}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-brand-action/45 bg-brand-action/[0.06] text-brand-action dark:text-brand-sky font-medium shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-action hover:bg-brand-action/[0.12] hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Create New User
                </button>
              )}

              {/* Sharing OAuth section. Shown only when the device is online AND
                  OAuth publish is actually configured (NEXT_PUBLIC_SHARING_ENABLED).
                  In dev / sharing-off builds OAuth is not wired, so these buttons
                  would dead-end at /api/auth/error and the extra height shoved the
                  card into the fixed beta notice + footer. Hidden there. The
                  notebook works fully without any account regardless. */}
              {isOnline && isRealSharingEnabled() && (
                <div className="mt-6">
                  <div className="relative mb-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-transparent px-2 text-meta text-foreground-muted">
                        for sharing and collaboration
                      </span>
                    </div>
                  </div>

                  {sessionStatus === "authenticated" && session?.user ? (
                    <div className="flex flex-col items-center gap-1.5 text-center">
                      <p className="text-meta text-foreground-muted">
                        Signed in as{" "}
                        <span className="font-medium text-foreground">
                          {session.user.email ?? session.user.name ?? "unknown"}
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={() => void signOut({ callbackUrl: "/" })}
                        className="text-meta text-foreground-muted underline underline-offset-2 hover:text-foreground transition-colors"
                      >
                        Sign out
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2.5">
                      <p className="text-meta text-foreground-muted text-center mb-1">
                        Enable sharing, inbox, and collaboration
                      </p>
                      <div className="flex flex-col gap-2 w-full sm:flex-row">
                        <button
                          type="button"
                          onClick={() => void signIn("google", { callbackUrl: "/" })}
                          disabled={loggingIn !== null}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-meta font-semibold text-gray-800 shadow-sm transition-all hover:border-foreground-muted hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <GoogleIcon className="w-4 h-4" />
                          Sign in with Google
                        </button>
                        {isMicrosoftAuthEnabled() && (
                          <button
                            type="button"
                            onClick={() => void signIn("microsoft-entra-id", { callbackUrl: "/" })}
                            disabled={loggingIn !== null}
                            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-meta font-semibold text-gray-800 shadow-sm transition-all hover:border-foreground-muted hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <MicrosoftIcon className="w-4 h-4" />
                            Sign in with Microsoft
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void signIn("github", { callbackUrl: "/" })}
                          disabled={loggingIn !== null}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border dark:border-slate-600 bg-slate-800 px-4 py-2.5 text-meta font-semibold text-white shadow-sm transition-all hover:border-foreground-muted hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <GitHubIcon className="w-4 h-4" />
                          Sign in with GitHub
                        </button>
                        <button
                          type="button"
                          onClick={() => void signIn("linkedin", { callbackUrl: "/" })}
                          disabled={loggingIn !== null}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-[#0A66C2] bg-[#0A66C2] px-4 py-2.5 text-meta font-semibold text-white shadow-sm transition-all hover:bg-[#004182] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <LinkedInIcon className="w-4 h-4" />
                          Sign in with LinkedIn
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="mt-3 text-center text-meta text-foreground-muted">
                    {isRequireAccountEnabled()
                      ? "Your notebook works fully offline once you have signed in."
                      : "Your notebook works offline without signing in."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete User Confirmation Modal */}
      {deleteUserSelected && showDeleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface-raised rounded-2xl ros-popup-card-shadow border border-border max-w-md w-full mx-4 overflow-hidden">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-title font-semibold text-foreground mb-2">
                    Delete User Profile
                  </h3>
                  {deleteConfirmStep === 1 ? (
                    <p className="text-foreground-muted text-body">
                      Are you sure you want to delete <span className="font-semibold text-foreground">{deleteUserSelected}</span>? This action cannot be undone.
                    </p>
                  ) : (
                    <p className="text-foreground-muted text-body">
                      Final confirmation: Permanently delete <span className="font-semibold text-foreground">{deleteUserSelected}</span>?
                    </p>
                  )}
                </div>
              </div>

              {deleteConfirmStep === 1 && (
                <div className="mt-4 p-3 bg-surface-sunken rounded-lg">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deleteUserArchive}
                      onChange={(e) => setDeleteUserArchive(e.target.checked)}
                      className="w-4 h-4 rounded border-border bg-surface-sunken text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className="text-body text-foreground-muted">
                      Archive data before deletion (recommended)
                    </span>
                  </label>
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                  <p className="text-body text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}

              {isArchivingUser && (
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-500/20 rounded-lg flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 dark:border-blue-400"></div>
                  <span className="text-body text-blue-700 dark:text-blue-300">Creating archive...</span>
                </div>
              )}

              {isDeletingUser && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/15 rounded-lg flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500 dark:border-red-400"></div>
                  <span className="text-body text-red-700 dark:text-red-300">Deleting user...</span>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  onClick={cancelDelete}
                  disabled={isArchivingUser || isDeletingUser}
                  className="ros-btn-neutral flex-1 py-2.5 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={isArchivingUser || isDeletingUser}
                  className="ros-btn-raise flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleteConfirmStep === 1 ? (
                    "Continue"
                  ) : (
                    "Delete Permanently"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unlock gate — shown when a user with a profile identity is clicked.
          The passkey is the everyday door; the recovery code is the offline
          fallback; an OAuth re-login is an optional online convenience. There is
          no app-managed password anymore. */}
      {unlockGate && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={cancelUnlockGate}
        >
          <div
            className="bg-surface-raised rounded-2xl ros-popup-card-shadow border border-border max-w-sm w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            data-testid="unlock-gate"
          >
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-title font-semibold text-foreground">Unlock your account</h3>
              <p className="text-meta text-foreground-muted mt-0.5">
                Sign in as {unlockGate.username}
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              {resetConfirmFor ? (
                /* Phase C1 reset-keep-data confirmation — the last-resort
                   lockout escape. Clear about what survives (all your data) and
                   what is lost (old signing identity + access to data shared TO
                   you; a shared lab needs the PI to re-admit your new key). */
                <div className="space-y-3" data-testid="reset-keep-data-confirm">
                  <div className="p-3 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg space-y-2">
                    <p className="text-meta font-medium text-amber-800 dark:text-amber-200">
                      Reset your identity and keep your data?
                    </p>
                    <p className="text-meta text-amber-800/90 dark:text-amber-200/90">
                      Use this only if you can&apos;t sign in any other way. It
                      gives <span className="font-medium">{resetConfirmFor}</span> a
                      brand-new identity and a new recovery code.
                    </p>
                    <ul className="text-meta text-amber-800/90 dark:text-amber-200/90 list-disc pl-4 space-y-0.5">
                      <li><span className="font-medium">Kept:</span> all of your notebook data stays on disk, untouched.</li>
                      <li><span className="font-medium">Lost:</span> your old signing identity, so past signatures and anything previously shared <em>to</em> you can no longer be opened.</li>
                      <li>If you&apos;re in a shared lab, your lab head will need to re-admit your new key before sharing works again.</li>
                    </ul>
                  </div>
                  {error && (
                    <div className="p-2 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                      <p className="text-meta text-red-700 dark:text-red-300">{error}</p>
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setResetConfirmFor(null);
                        setError(null);
                      }}
                      disabled={resetting}
                      className="ros-btn-neutral flex-1 py-2 text-body disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleResetKeepData}
                      disabled={resetting}
                      className="ros-btn-raise flex-1 py-2 text-body bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg disabled:opacity-50"
                      data-testid="reset-keep-data-confirm-submit"
                    >
                      {resetting ? "Resetting…" : "Reset, keep my data"}
                    </button>
                  </div>
                </div>
              ) : unlockingViaProvider ? (
                <p className="text-meta text-foreground-muted text-center py-1">
                  Confirming your sign-in...
                </p>
              ) : recoveryMode ? (
                <>
                  <p className="text-meta text-foreground-muted">
                    Enter your recovery code (or the 12 words) to unlock.
                  </p>
                  <input
                    ref={recoveryInputRef}
                    type="text"
                    value={recoveryInput}
                    onChange={(e) => setRecoveryInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSubmitRecovery();
                      if (e.key === "Escape") cancelUnlockGate();
                    }}
                    disabled={unlocking}
                    className="w-full px-3 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-body font-mono"
                    placeholder="Recovery code or 12 words"
                    data-testid="unlock-recovery-input"
                    autoFocus
                  />
                </>
              ) : (
                <>
                  {/* Optional online convenience, an OAuth re-login. Shown only
                      for a claimed account and only when online. The verified
                      provider email must match the identity's email. */}
                  {claimedUsers.has(unlockGate.username) && isOnline && (
                    <>
                      <p className="text-meta text-foreground-muted">
                        Sign in online to unlock
                      </p>
                      <button
                        type="button"
                        onClick={() => startUnlockOAuth("google", unlockGate.username)}
                        disabled={unlocking}
                        className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-white text-slate-800 hover:bg-slate-100 font-medium transition-colors disabled:opacity-50"
                      >
                        <GoogleIcon className="w-4 h-4" />
                        Continue with Google
                      </button>
                      {isMicrosoftAuthEnabled() && (
                        <button
                          type="button"
                          onClick={() => startUnlockOAuth("microsoft-entra-id", unlockGate.username)}
                          disabled={unlocking}
                          className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-white text-slate-800 hover:bg-slate-100 font-medium transition-colors disabled:opacity-50"
                        >
                          <MicrosoftIcon className="w-4 h-4" />
                          Continue with Microsoft
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startUnlockOAuth("github", unlockGate.username)}
                        disabled={unlocking}
                        className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg border border-transparent dark:border-white/20 bg-[#24292e] text-white hover:bg-[#2f363d] font-medium transition-colors disabled:opacity-50"
                      >
                        <GitHubIcon className="w-4 h-4" />
                        Continue with GitHub
                      </button>
                      <button
                        type="button"
                        onClick={() => startUnlockOAuth("linkedin", unlockGate.username)}
                        disabled={unlocking}
                        className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-[#0A66C2] text-white hover:bg-[#004182] font-medium transition-colors disabled:opacity-50"
                      >
                        <LinkedInIcon className="w-4 h-4" />
                        Continue with LinkedIn
                      </button>
                    </>
                  )}
                </>
              )}


              {/* Everything below is the normal unlock chrome — hidden while
                  the Phase C1 reset-keep-data confirmation owns the modal. */}
              {!resetConfirmFor && (
                <>
                  {error && (
                    <div className="p-2 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                      <p className="text-meta text-red-700 dark:text-red-300">{error}</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={cancelUnlockGate}
                      disabled={unlocking}
                      className="ros-btn-neutral flex-1 py-2 text-body disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    {recoveryMode && (
                      <button
                        onClick={handleSubmitRecovery}
                        disabled={unlocking || !recoveryInput}
                        className="ros-btn-raise flex-1 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white font-medium rounded-lg disabled:opacity-50"
                        data-testid="unlock-recovery-submit"
                      >
                        {unlocking ? "Unlocking…" : "Unlock"}
                      </button>
                    )}
                  </div>

                  {/* Toggle between the OAuth door and the recovery-code
                      input. Hidden while an OAuth resume is confirming, and hidden
                      in recovery mode when there is no OAuth option to go back to. */}
                  {!unlockingViaProvider &&
                    !(
                      recoveryMode &&
                      !(claimedUsers.has(unlockGate.username) && isOnline)
                    ) && (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setRecoveryMode((m) => !m);
                        }}
                        disabled={unlocking}
                        className="text-meta text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50"
                        data-testid="unlock-toggle-recovery"
                      >
                        {recoveryMode
                          ? "Back to other unlock options"
                          : "Use your recovery code instead"}
                      </button>
                    )}

                  {/* Phase C1: last-resort lockout escape. Dark behind
                      MULTI_FOLDER_ENABLED until the recovery arc ships. Hidden
                      during an OAuth resume so it never competes with it. */}
                  {MULTI_FOLDER_ENABLED && !unlockingViaProvider && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setResetConfirmFor(unlockGate.username);
                      }}
                      disabled={unlocking}
                      className="block text-meta text-foreground-muted underline underline-offset-2 hover:text-foreground transition-colors disabled:opacity-50"
                      data-testid="unlock-reset-keep-data"
                    >
                      Can&apos;t sign in? Reset and keep your data
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Force-create-an-account gate — shown when a shared folder (or a folder
          with a lab head) requires a login and this user has no account yet.
          Under the revised model (IDENTITY_OAUTH_ONLY.md, 2026-06-06) the
          account is a LOCAL keypair, created fully offline with NO OAuth, so this
          opens CreateLocalIdentityStep instead of the OAuth wizard (OAuth is
          unconfigured in dev and off in prod, so forcing it dead-ended account
          creation). Completing it signs the user in. There is no opt-out here
          (unlike the optional publish step), so closing it returns to the
          picker. Publishing a findable profile stays an optional later step. */}
      {forceProfileFor && (
        <CreateLocalIdentityStep
          username={forceProfileFor.username}
          required
          agreement={joinAgreement}
          onComplete={() => {
            const u = forceProfileFor.username;
            setForceProfileFor(null);
            // createLocalIdentity parked the unlocked key in the session, so
            // performLogin just switches the active user.
            void performLogin(u);
          }}
          onClose={() => {
            // Backed out. A shared folder still requires an account, so we drop
            // back to the picker rather than letting them in unprotected. NOTE:
            // the account may already have been created (the keypair is minted
            // before the recovery code shows); the next login lands on the
            // unlock gate for the created identity.
            setForceProfileFor(null);
            setLoggingIn(null);
          }}
        />
      )}

      {/* Optional profile setup, offered once right after a new account is
          established. The third-party buttons hand off to the existing
          SharingSetupWizard; "Skip for now" enters the app. A returning user
          signing in normally never reaches this. */}
      {profileStep && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div
            className="bg-surface-raised rounded-2xl ros-popup-card-shadow border border-border max-w-sm w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-title font-semibold text-foreground">
                Set up your profile
              </h3>
              <p className="text-meta text-foreground-muted mt-0.5 leading-relaxed">
                Link an account so colleagues can find you and confirm it is
                really you before they share work. This is optional, you can
                always do it later from Settings.
              </p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <SharingProviderButtons onProvider={startSharingClaimOAuth} />
              <button
                type="button"
                onClick={skipProfileStep}
                className="w-full py-2 text-body text-foreground-muted hover:text-foreground font-medium"
                data-testid="profile-step-skip"
              >
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recovery code, shown once right after a new account is created. */}
      {createdRecovery && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div
            className="bg-surface-raised rounded-2xl ros-popup-card-shadow border border-border max-w-sm w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-title font-semibold text-foreground">
                Save your recovery code
              </h3>
              <p className="text-meta text-foreground-muted mt-0.5">
                This is the only way back in if you forget your password. Write it
                somewhere safe, it is not shown again.
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="p-3 bg-surface-sunken border border-border rounded-lg">
                <p className="font-mono text-body text-foreground tracking-wide break-all text-center">
                  {createdRecovery.code}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(createdRecovery.code);
                    setRecoveryCopied(true);
                    window.setTimeout(() => setRecoveryCopied(false), 1800);
                  } catch {
                    // Clipboard can be blocked, the code is still visible to copy.
                  }
                }}
                className="text-meta text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                {recoveryCopied ? "Copied" : "Copy code"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const u = createdRecovery.username;
                  setCreatedRecovery(null);
                  // Establish the session without leaving the login screen, so
                  // the optional profile step can render over it next.
                  try {
                    await usersApi.login(u);
                  } catch {
                    // The account was just created, a login hiccup is non-fatal.
                  }
                  await setCurrentUser(u);
                  setProfileStep({ username: u });
                }}
                className="ros-btn-raise w-full py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white font-medium rounded-lg"
                data-testid="recovery-continue"
              >
                I saved it, continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase C5: cross-device restore gate. Shown when a signed-in account
          lands on a fresh device with a canonical identity published elsewhere.
          Restores the published keypair from the cloud backup with the recovery
          code rather than minting a divergent one. */}
      {crossDeviceRestore && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={cancelCrossDeviceRestore}
        >
          <div
            className="bg-surface-raised rounded-2xl ros-popup-card-shadow border border-border max-w-sm w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            data-testid="cross-device-restore"
          >
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-title font-semibold text-foreground">
                Restore your identity on this device
              </h3>
              <p className="text-meta text-foreground-muted mt-0.5">
                This account already has an identity set up on another device.
                Enter your recovery code to restore it here, then we&apos;ll open
                this folder under it.
              </p>
            </div>
            <div className="px-6 py-5 space-y-3">
              <input
                type="text"
                value={restoreInput}
                onChange={(e) => setRestoreInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && restoreInput && !restoring) {
                    handleCrossDeviceRestore();
                  }
                  if (e.key === "Escape" && !restoring) cancelCrossDeviceRestore();
                }}
                disabled={restoring}
                className="w-full px-3 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-body font-mono"
                placeholder="Recovery code or 12 words"
                data-testid="cross-device-restore-input"
                autoFocus
              />

              {error && (
                <div className="p-2 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                  <p className="text-meta text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={cancelCrossDeviceRestore}
                  disabled={restoring}
                  className="ros-btn-neutral flex-1 py-2 text-body disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCrossDeviceRestore}
                  disabled={restoring || !restoreInput}
                  className="ros-btn-raise flex-1 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white font-medium rounded-lg disabled:opacity-50"
                  data-testid="cross-device-restore-submit"
                >
                  {restoring ? "Restoring…" : "Restore and continue"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* The full OAuth + identity-claim flow, mounted on top of the profile
          step once a provider is chosen. Completing it enters the app;
          closing it returns to the profile step so the user can still skip. */}
      {profileWizardOpen && profileStep && (
        <SharingSetupWizard
          username={profileStep.username}
          onComplete={() => {
            skipProfileStep();
          }}
          onClose={() => {
            setProfileWizardOpen(false);
          }}
        />
      )}

      {/* User color picker — opens after the user types a name + clicks
          Create. Mounted at the same z-tier as the gate popups so it
          floats above the entry-screen card. Accept persists the chosen
          color to _user_metadata.json BEFORE usersApi.create runs, so the
          new user's color is stored from the moment their account
          exists; Cancel rolls back without writing anything. */}
      {colorPicker && (
        <UserColorPickerPopup
          username={colorPicker.username}
          defaultColor={colorPicker.defaultColor}
          otherUsers={colorPicker.otherUsers}
          onAccept={handleColorPickerAccept}
          onCancel={handleColorPickerCancel}
        />
      )}

      {/* Bottom chrome: the data-locality reassurance + help / shared-account /
          roadmap / report / support links, consolidated into one fixed cluster
          with a soft fade up from the page so it stays legible and never stacks
          on top of the centered card the way the separate rows used to. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-1.5 px-4 pb-4 pt-12 bg-gradient-to-t from-surface via-surface/85 to-transparent">
        <p className="text-center text-meta text-foreground-muted">
          Your data is stored locally in the folder you picked
        </p>
        {/* Escape hatch: picked the wrong folder? Disconnect (non-destructive —
            the folder's data stays on disk) and land back on the folder-connect
            screen to choose a different one. Without this the account picker was
            a soft-lock once a folder was chosen (Grant 2026-06-15). Hidden in
            demo/wiki-capture, which run on an ephemeral fixture folder. */}
        {!isDemoOrWikiCapture() && (
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-meta text-foreground-muted underline underline-offset-2 hover:text-foreground transition-colors"
            data-testid="login-change-folder"
          >
            Use a different folder
          </button>
        )}
        {/* Always-visible sign-out for signed-in sessions. The sharing-section
            sign-out (line ~1953) is gated behind isRealSharingEnabled; this
            one is unconditional so a signed-in user is never soft-locked. */}
        {sessionStatus === "authenticated" && !isDemoOrWikiCapture() && (
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/" })}
            className="text-meta text-foreground-muted underline underline-offset-2 hover:text-foreground transition-colors"
            data-testid="login-sign-out"
          >
            Sign out
          </button>
        )}
        <div className="flex items-center gap-4 flex-wrap justify-center max-w-[90vw]">
        <Link
          href="/wiki/getting-started/creating-a-user"
          className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          User & account help
        </Link>
        <Link
          href="/wiki/shared-lab-accounts"
          className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5.13a4 4 0 11-8 0 4 4 0 018 0zm6 0a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Setting up a shared lab account?
        </Link>
        <button
          type="button"
          onClick={() => setRoadmapOpen(true)}
          className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 14 14" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 11.5c1.5-3 3-5 5-6.5 2.5-1.8 5-1.5 5-1.5s.3 2.5-1.5 5c-1.5 2-3.5 3.5-6.5 5z" />
            <circle cx="7.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
          </svg>
          What we&apos;re building
        </button>
        <button
          onClick={openBugReport}
          className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Report Bug
        </button>
        <BetaDonationButton variant="link" />
        </div>
      </div>

      {/* Bug Report Modal */}
      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />

      {/* Roadmap modal */}
      <RoadmapModal open={roadmapOpen} onClose={() => setRoadmapOpen(false)} />

      {/* Dev-only floating button: preview the first-time landing ("sell")
          page via /welcome. Renders nothing in production. */}
      <DevForceLandingButton />

      {/* Dev-only one-click sign-in (bottom-left): mints a local identity and
          enters the app so a phone can pair without the OAuth/recovery
          ceremony. Renders nothing in production. (mobile manager) */}
      <DevPairBypassButton />

    </div>
  );
}
