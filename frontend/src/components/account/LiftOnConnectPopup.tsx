"use client";

// Lift-on-connect confirmation popup (account-scoped settings, Phase 2).
//
// THE EXACT PROMISE TO OWEN: "after redeploy, connect the folder that has your
// calendars set up, a popup will ask if you want to add them to your cloud
// profile, then they follow you everywhere across folders and devices."
//
// When the account-settings flag is ON and the user connects / opens a folder
// that holds account-scopable settings (external calendar feeds and/or the
// broader account preferences) that the cloud account store does NOT already
// carry, this offers, in plain language, to lift them into the cloud profile so
// they follow the user across every folder and device. Primary action lifts them
// (liftFolderSettingsOnLogin); secondary keeps them folder-local (a no-op).
//
// NO NAG: it shows at most ONCE per folder (a per-folder "asked" marker in
// localStorage, keyed by folder + identity + user), and never when the account
// already has these settings. When the flag is OFF it never renders and never
// touches the network.
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
  folderHasLiftableSettings,
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
): Promise<{ feeds: CalendarFeed[]; prefs: FolderAccountScopablePrefs }> {
  let feeds: CalendarFeed[] = [];
  try {
    feeds = await listFeeds(username);
  } catch {
    feeds = [];
  }
  const prefs: FolderAccountScopablePrefs = {};
  try {
    const s = await readUserSettings(username);
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
  return { feeds, prefs };
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

        const { feeds, prefs } = await readFolderPrefs(currentUser);
        const account = await fetchAccountSettings();
        const liftable = folderHasLiftableSettings(
          account,
          feeds,
          // The lab-head capability is folder-local (account_type), passed via
          // prefs is not appropriate; the lift reads it separately. Here we only
          // gate on the SETTINGS the popup offers, so account_type is not part of
          // the trigger (it is lifted silently by the viewer path). Pass undefined.
          undefined,
          prefs,
        );
        if (!liftable) {
          // Account already has everything this folder offers: never ask, and
          // mark so a later reload does not re-evaluate.
          markAsked(key);
          return;
        }
        if (cancelled) return;
        pending.current = { username: currentUser, feeds, prefs, askedKey: key };
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
      await liftFolderSettingsOnLogin(p.feeds, undefined, p.prefs);
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
