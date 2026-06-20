"use client";

// Lift-on-connect confirmation popup (account-scoped settings, Phase 2).
//
// THE EXACT PROMISE TO OWEN: "after redeploy, connect the folder that has your
// calendars set up, a popup will ask if you want to add them to your cloud
// profile, then they follow you everywhere across folders and devices."
//
// TWO TIERS (Grant 2026-06-20):
//   - ACCOUNT-STATE (the lab-head / PI role + displayName + preferredName) is core
//     identity, not an optional preference, so on connect it lifts SILENTLY with no
//     popup (liftAccountStateSilently). A user does not opt out of their own role,
//     it follows the account. This is the Owen misfire fix, where claiming a lab
//     wrote account_type "lab_head" and the popup then offered to sync it.
//   - OPTIONAL settings (external calendar feeds + display / UI preferences) are
//     privacy-ish opt-ins, so THOSE still surface this consent popup. Primary
//     action lifts everything (account-state + optional); secondary keeps only the
//     OPTIONAL prefs folder-local (the account-state has already lifted silently).
//
// NO NAG: it shows at most ONCE per folder (a per-folder "asked" marker in
// localStorage, keyed by folder + identity + user), and never when the account
// already has these optional settings. When the flag is OFF it never renders and
// never touches the network.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG via
// the LivingPopup chrome; this body uses no icons.

import { useEffect, useRef, useState } from "react";

import LivingPopup from "@/components/ui/LivingPopup";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { isAccountSettingsEnabled } from "@/lib/account/account-settings-config";
import {
  currentIdentityOwnerKey,
  fetchAccountSettings,
  hasLiftableAccountState,
  hasLiftableOptionalPrefs,
  liftAccountStateSilently,
  liftFolderSettingsOnLogin,
  type FolderAccountScopablePrefs,
} from "@/lib/account/account-settings";
import { listFeeds } from "@/lib/calendar/external-feeds-store";
import { readUserSettings } from "@/lib/settings/user-settings";
import type { CalendarFeed } from "@/lib/types";

const THEME_STORAGE_KEY = "researchos-theme";
const ASKED_PREFIX = "researchos:account-lift-asked";

/** A stable per-(folder, identity, user) marker so the popup asks at most once
 *  per folder. Keyed so a DIFFERENT identity or user on the same folder is asked
 *  on its own terms, and the same identity is never re-nagged for that folder. */
function askedKey(
  folder: string | null,
  ownerKey: string | null,
  username: string | null,
): string {
  return `${ASKED_PREFIX}:${folder ?? "?"}:${ownerKey ?? "?"}:${username ?? "?"}`;
}

function wasAsked(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markAsked(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Private-mode / storage-blocked: the popup may re-evaluate on a later load,
    // which is harmless (the account-already-has-it check still suppresses it
    // once the user lifts).
  }
}

/** Read the folder's account-scopable preference values (NOT research data) to
 *  feed the lift. Theme comes from localStorage (per-device store); the rest from
 *  the folder settings.json. Best-effort, returns {} on any read failure. */
async function readFolderPrefs(
  username: string,
): Promise<{
  feeds: CalendarFeed[];
  prefs: FolderAccountScopablePrefs;
  accountType: string | undefined;
}> {
  let feeds: CalendarFeed[] = [];
  try {
    feeds = await listFeeds(username);
  } catch {
    feeds = [];
  }
  let accountType: string | undefined;
  const prefs: FolderAccountScopablePrefs = {};
  try {
    const s = await readUserSettings(username);
    // The folder-local lab-head marker, so the lift can carry PI status up to the
    // account (a PI is then recognized regardless of which folder they open).
    accountType = s.account_type;
    prefs.animationType = s.animationType;
    prefs.beakerBotAnimations = s.beakerBotAnimations;
    prefs.coloredHeader = s.coloredHeader;
    prefs.dateFormat = s.dateFormat;
    prefs.timeFormat = s.timeFormat;
    prefs.professionalMode = s.professionalMode;
    prefs.showCompanionButton = s.showCompanionButton;
    prefs.autoPublishSnapshotsToPhones = s.autoPublishSnapshotsToPhones;
    if (s.notificationPreferences) {
      prefs.notificationPreferences = s.notificationPreferences as unknown as Record<
        string,
        unknown
      >;
    }
    prefs.displayName = s.displayName;
    prefs.preferredName = s.preferredName;
    prefs.defaultLandingTab = s.defaultLandingTab;
    prefs.visibleTabs = s.visibleTabs;
  } catch {
    // Folder settings unreadable: lift only the feeds (still the Owen case).
  }
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    if (theme === "light" || theme === "dark" || theme === "system") {
      prefs.theme = theme;
    }
  } catch {
    // localStorage unavailable; theme simply not lifted.
  }
  return { feeds, prefs, accountType };
}

/**
 * The mounted host. Renders nothing unless the flag is on AND the connected
 * folder holds liftable settings the account lacks AND the folder has not been
 * asked yet. Mounted once on the signed-in app surface (lib/providers).
 */
export default function LiftOnConnectPopup() {
  const { currentUser } = useCurrentUser();
  const { directoryName } = useFileSystem();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The captured folder state to lift, set once the evaluation decides to show.
  const pending = useRef<{
    username: string;
    feeds: CalendarFeed[];
    prefs: FolderAccountScopablePrefs;
    accountType: string | undefined;
    askedKey: string;
  } | null>(null);
  // Guard so the async evaluation runs once per (folder, user) pair and a
  // re-render does not re-fire it mid-flight.
  const evaluatedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isAccountSettingsEnabled()) return;
    if (!currentUser) return;
    const evalKey = `${directoryName ?? "?"}::${currentUser}`;
    if (evaluatedFor.current === evalKey) return;
    evaluatedFor.current = evalKey;

    let cancelled = false;
    void (async () => {
      try {
        const ownerKey = await currentIdentityOwnerKey();
        // No unlocked identity means no account store to read or write; the popup
        // cannot lift anything, so stay silent.
        if (!ownerKey) return;
        const key = askedKey(directoryName, ownerKey, currentUser);
        if (wasAsked(key)) return;

        const { feeds, prefs, accountType } = await readFolderPrefs(currentUser);
        const account = await fetchAccountSettings();

        // ACCOUNT-STATE (lab-head role + displayName + preferredName) is core
        // identity, not an optional preference, so it lifts SILENTLY on connect
        // with NO popup (Grant 2026-06-20: the role follows the account, the user
        // does not opt out of it). This is the direct fix for the Owen misfire,
        // where claiming a lab wrote account_type "lab_head" and the popup then
        // offered to sync it. Best-effort and idempotent, never blocks the app.
        if (hasLiftableAccountState(account, accountType, prefs)) {
          void liftAccountStateSilently(
            accountType,
            prefs.displayName,
            prefs.preferredName,
          );
        }

        // The popup ONLY governs OPTIONAL settings (calendar feeds + display / UI
        // preferences) the account lacks. If nothing optional is liftable, never
        // ask (the account-state lift above already ran), and mark so a later
        // reload does not re-evaluate.
        const optionalLiftable = hasLiftableOptionalPrefs(account, feeds, prefs);
        if (!optionalLiftable) {
          markAsked(key);
          return;
        }
        if (cancelled) return;
        pending.current = {
          username: currentUser,
          feeds,
          prefs,
          accountType,
          askedKey: key,
        };
        setOpen(true);
      } catch {
        // Any evaluation failure stays silent (never blocks the app).
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser, directoryName]);

  const onAdd = async () => {
    const p = pending.current;
    if (!p) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await liftFolderSettingsOnLogin(p.feeds, p.accountType, p.prefs);
    } catch {
      // A failed lift still closes the popup; the user is not blocked, and the
      // marker below stops a re-nag. They can re-add from Settings later.
    } finally {
      markAsked(p.askedKey);
      setBusy(false);
      setOpen(false);
    }
  };

  const onKeepLocal = () => {
    // Keeps only the OPTIONAL prefs folder-local. The account-STATE (role +
    // names) has already lifted silently during evaluation, so "keep local" never
    // strips the role from the account, it only declines syncing the optional
    // calendar feeds + display preferences.
    const p = pending.current;
    if (p) markAsked(p.askedKey);
    setOpen(false);
  };

  return (
    <LivingPopup
      open={open}
      onClose={onKeepLocal}
      label="Add this folder's settings to your cloud profile"
      widthClassName="max-w-md"
      padded
      blur
    >
      <div className="flex flex-col gap-4">
        <h2 className="text-h3 font-semibold text-foreground">
          Add these settings to your cloud profile?
        </h2>
        <p className="text-body text-foreground-muted">
          We found settings saved in this folder, like your external calendars
          and display preferences. Add them to your cloud profile and they follow
          you across all your folders and devices, so opening a different folder
          never loses them. Your research data stays on your computer, only these
          preferences and calendar links sync.
        </p>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onKeepLocal}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-body font-medium text-foreground-muted transition-colors hover:bg-surface-sunken disabled:opacity-50"
          >
            Keep them only in this folder
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={busy}
            className="rounded-lg bg-brand-action px-4 py-2 text-body font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Adding..." : "Add to my cloud profile"}
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
