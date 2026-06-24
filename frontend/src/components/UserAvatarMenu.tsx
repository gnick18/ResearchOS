"use client";

// User avatar chip for the top-right of AppShell. Replaces the settings gear
// with a circular avatar that shows the current user's initial and color, plus
// a dropdown with links to their researcher profile and settings.
//
// The avatar always reflects the FOLDER-LOCAL user (no sharing identity
// required), so it is always visible once a user is active. When a sharing
// identity + researcher profile exist, the profile link leads there; until the
// /researchers/[fingerprint] page is built it anchors to the profile card in
// settings.
//
// The tour gate mirrors the gear: during the walkthrough the avatar is a
// disabled button so a mid-tour click cannot navigate away from the current
// step.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Every icon is
// an inline SVG. Tooltip on the avatar itself; items inside the dropdown use
// text labels only.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { fullSignOut } from "@/lib/auth/full-sign-out";
import { lockApp } from "@/lib/auth/lock-session";

import Link from "@/components/FixtureLink";
import Tooltip from "@/components/Tooltip";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { compactFingerprint } from "@/lib/sharing/profile";
import { isRealSharingEnabled } from "@/lib/sharing/oauth-availability";
import { useProfileModal } from "@/lib/sharing/profile-modal-store";
import { rainbowTheme } from "@/lib/colors";
import RainbowOrb from "@/components/RainbowOrb";
import { useTheme } from "@/lib/theme/use-theme";
import { Icon } from "@/components/icons";
import {
  getDemoMode,
  isRecordingMode,
  isWikiCaptureMode,
} from "@/lib/file-system/wiki-capture-mock";
import LeaveDemoModal from "@/components/LeaveDemoModal";
import { ACCOUNT_HUB_ENABLED } from "@/lib/account/account-hub-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserAvatarMenuProps {
  /** The folder-local username (used for initial + aria labels). */
  currentUser: string;
  /** The user's primary brand color (hex), from useUserColors. */
  primaryColor: string;
  /** Whether the header is currently tinted (colored header opt-in). */
  tinted: boolean;
  /** Current pathname for active-state styling. */
  pathname: string | null;
  /** When true, an Apple-style attention dot rides the avatar chip so the user
   *  knows something needs them (pending lab join requests) without opening the
   *  menu. Subtle, only when there is something to surface. */
  attention?: boolean;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** First character of the username, uppercased. Falls back to "?" if empty. */
function initial(username: string): string {
  return (username[0] ?? "?").toUpperCase();
}

/**
 * Picks black or white foreground for legibility on a hex background.
 * Uses the W3C relative luminance formula (simplified sRGB coefficients).
 */
function contrastColor(hex: string): "white" | "black" {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "black" : "white";
}

// ---------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------

function DropdownItem({
  href,
  onClick,
  children,
}: {
  href?: string;
  onClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const cls =
    "flex items-center gap-2 w-full px-4 py-2.5 text-body text-foreground hover:bg-surface-sunken transition-colors text-left";

  if (href) {
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

function PersonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4 shrink-0 text-foreground-muted"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function DirectoryIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4 shrink-0 text-foreground-muted"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="3" />
      <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" />
      <path d="M16 4a3 3 0 0 1 0 6" />
      <path d="M19 19c0-2.4-1.3-4.1-3.3-4.8" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4 shrink-0 text-foreground-muted"
      aria-hidden="true"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4 shrink-0 text-foreground-muted"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4 shrink-0 text-foreground-muted"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UserAvatarMenu({
  currentUser,
  primaryColor,
  tinted,
  pathname,
  attention = false,
}: UserAvatarMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const sharing = useSharingIdentity();

  // Quiet escape hatch from the public /demo: a "Leave demo" row in this menu
  // is the primary way out now that the old loud orange floating cluster was
  // slimmed to a small corner pill. Mirrors the chrome components' gate
  // (demo on, not wiki-capture, not recording) so it never shows in a real
  // install or in a clean capture/recording surface. Synced on pathname
  // change because the sticky demo flag is read from sessionStorage.
  const [inDemo, setInDemo] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // disconnect: used on sign-out to forget the connected folder + its persisted
  // handle, so the post-signout reload lands on the welcome screen, never the
  // folder picker. connect: powers the distinct "Switch folder" action, which
  // opens the OS picker so the user can change folders WITHOUT signing out.
  const { disconnect, connect } = useFileSystem();
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local state with the external sessionStorage demo flag on every route change
    setInDemo(getDemoMode() && !isWikiCaptureMode() && !isRecordingMode());
  }, [pathname]);

  // Dark-mode toggle lives in this menu now (moved out of the top bar to free
  // header space). The row flips the theme and keeps the menu open so the user
  // sees it take effect; the full light/dark/system choice still lives in
  // Settings > Appearance.
  const { resolved, setTheme } = useTheme();
  const isDark = resolved === "dark";

  // When the user has a published identity with a fingerprint, "My profile"
  // opens the in-app popup over the current page (flag off) or links to the
  // public /u/<handle> page (flag on). The popup is deprecated in favour of
  // the dedicated /u/<handle> network page when ACCOUNT_HUB_ENABLED is on.
  const openProfile = useProfileModal((s) => s.open);
  const ownFingerprint = sharing.sidecar?.fingerprint ?? null;

  const openOwnProfile = useCallback(
    (e: React.MouseEvent) => {
      setOpen(false);
      if (!ownFingerprint) return;
      openProfile(compactFingerprint(ownFingerprint), {
        x: e.clientX,
        y: e.clientY,
      });
    },
    [ownFingerprint, openProfile],
  );

  // When the hub is enabled, fetch the caller's handle so we can link to
  // /u/<handle> instead of opening the modal. Falls back to /account#identity
  // if the profile API is unavailable or returns no handle.
  const [ownHandle, setOwnHandle] = useState<string | null>(null);
  useEffect(() => {
    if (!ACCOUNT_HUB_ENABLED) return;
    void fetch("/api/account/profile")
      .then((r) => r.json() as Promise<{ profile?: { handle?: string } | null }>)
      .then((data) => {
        const h = data?.profile?.handle ?? null;
        setOwnHandle(h);
      })
      .catch(() => {
        /* silently degrade: link falls back to /account#identity */
      });
  }, []);

  // Settings opens as a living popup over the current page (Apple-style zoom
  // from the clicked point), the full settings body. The unified Settings shell
  // (settings-build bot, 2026-06-11) folds the old "Profile settings" entry in,
  // so this single Settings link is the one place to edit yourself. It now
  // routes to the full /settings page rather than a small popup, the left-rail
  // settings are a full-page layout and were cramped in the modal.
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // A rainbow sentinel ("rainbow" / "rainbow-vivid") is not a CSS color, so
  // backgroundColor would render no fill (the avatar looked empty). rainbowTheme
  // resolves it to the matching gradient + readable ink, identical to the
  // UserAvatar component, so the rainbow identity shows here too.
  const rainbow = rainbowTheme(primaryColor);
  const fg = contrastColor(primaryColor);
  // Rainbow draws as an SVG orb behind the initial (see RainbowOrb), so no
  // background here for that case; the orb fills the rounded-full button.
  const avatarStyle = rainbow
    ? { color: rainbow.fg }
    : { backgroundColor: primaryColor, color: fg === "white" ? "#fff" : "#111" };
  const orb = rainbow ? (
    <RainbowOrb
      variant={rainbow.variant}
      className="absolute inset-0 h-full w-full"
    />
  ) : null;

  const onSettings = pathname === "/settings";

  return (
    <div ref={containerRef} className="relative">
      <Tooltip label={open ? "" : `${currentUser} — account & profile`} placement="bottom">
        <button
          type="button"
          onClick={toggle}
          aria-label={`${currentUser} — account menu`}
          aria-expanded={open}
          className={`relative w-7 h-7 rounded-full flex items-center justify-center text-meta font-semibold transition-all select-none ${
            tinted
              ? open || onSettings
                ? "ring-2 ring-white shadow"
                : "ring-2 ring-white/40 hover:ring-white/80"
              : open || onSettings
              ? "ring-2 ring-blue-500"
              : "hover:ring-2 hover:ring-border"
          }`}
          style={avatarStyle}
        >
          {orb}
          <span className="relative">{initial(currentUser)}</span>
          {attention && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-surface-raised"
            />
          )}
        </button>
      </Tooltip>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[300] w-52 rounded-xl border border-border bg-surface-raised shadow-lg overflow-hidden"
          role="menu"
        >
          {/* Username header */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div
                className="relative w-8 h-8 rounded-full flex items-center justify-center text-body font-semibold shrink-0"
                style={avatarStyle}
                aria-hidden="true"
              >
                {orb}
                <span className="relative">{initial(currentUser)}</span>
              </div>
              <div className="min-w-0">
                <p className="text-body font-semibold text-foreground truncate">
                  {currentUser}
                </p>
                <p className="text-meta text-foreground-muted">ResearchOS</p>
              </div>
            </div>
          </div>

          {/* Navigation items */}
          <div className="py-1">
            {ACCOUNT_HUB_ENABLED ? (
              // Hub is on: show an Account link at the top + a link to the
              // public network profile instead of the in-app modal popup.
              <>
                <DropdownItem href="/account" onClick={close}>
                  <PersonIcon />
                  Account
                </DropdownItem>
                {/* My public profile links to /u/<handle> when we have one,
                    or falls back to /account#identity so there is always a
                    destination. The modal is retired in the hub path. */}
                {ownFingerprint && (
                  <DropdownItem
                    href={
                      ownHandle
                        ? `/u/${ownHandle}`
                        : "/account#identity"
                    }
                    onClick={close}
                  >
                    <PersonIcon />
                    My public profile
                  </DropdownItem>
                )}
              </>
            ) : (
              // Hub is off: exact same behavior as before — no Account link,
              // "My public profile" opens the modal.
              ownFingerprint && (
                <DropdownItem onClick={openOwnProfile}>
                  <PersonIcon />
                  My public profile
                </DropdownItem>
              )
            )}
            {isRealSharingEnabled() && (
              <DropdownItem href="/researchers" onClick={close}>
                <DirectoryIcon />
                Find researchers
              </DropdownItem>
            )}
            <DropdownItem href="/settings" onClick={close}>
              <GearIcon />
              Settings
            </DropdownItem>
            <div className="my-1 h-px bg-border" />
            <DropdownItem
              onClick={(e) => {
                e.preventDefault();
                setTheme(isDark ? "light" : "dark");
              }}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
              {isDark ? "Light mode" : "Dark mode"}
            </DropdownItem>
            {!inDemo && (
              <>
                <div className="my-1 h-px bg-border" />
                {/* Lock / Switch / Sign out split (seamless-reconnect, 2026-06-20).
                    Ordering matches the mockup: Lock, then Switch, then Sign out.

                    Lock: like locking a screen. It KEEPS the stored folder handle
                    AND the cloud session on this device, ends the in-app session,
                    and hard-navs to "/" so the next entry is the one-click / silent
                    reconnect (the Phase 1 splash flow), not a re-pick of the folder.
                    Distinct from Sign out, which FORGETS the folder here. */}
                <DropdownItem
                  onClick={(e) => {
                    e.preventDefault();
                    close();
                    lockApp();
                  }}
                >
                  <Icon
                    name="lock"
                    className="h-4 w-4 shrink-0 text-foreground-muted"
                  />
                  <span className="flex flex-col">
                    <span>Lock</span>
                    <span className="text-meta text-foreground-muted">
                      Stay signed in. Folder stays connected.
                    </span>
                  </span>
                </DropdownItem>
                {/* Switch account or folder: a DISTINCT action from sign-out. It
                    keeps the account session and opens the OS folder picker so the
                    user can change to a different folder / lab without logging out.
                    Reuses connect(), the same primitive the header folder switcher's
                    "Open another folder" uses. Cancelling the OS picker is a safe
                    no-op (the current folder stays connected), so this never traps
                    the user. */}
                <DropdownItem
                  onClick={(e) => {
                    e.preventDefault();
                    close();
                    void connect();
                  }}
                >
                  <Icon
                    name="folder"
                    className="h-4 w-4 shrink-0 text-foreground-muted"
                  />
                  Switch account or folder
                </DropdownItem>
                <div className="my-1 h-px bg-border" />
                <DropdownItem
                  onClick={(e) => {
                    e.preventDefault();
                    // Full logout: end the cloud session, forget the folder, and
                    // hard-reload to the welcome/login landing (never the folder
                    // picker). The deterministic ordering lives in fullSignOut so
                    // every "Sign out" button behaves identically. See its file
                    // for the next-auth v5 race this avoids. Distinct from Lock,
                    // which keeps the folder for a one-click return.
                    void fullSignOut({ disconnect });
                  }}
                >
                  <Icon
                    name="logout"
                    className="h-4 w-4 shrink-0 text-foreground-muted"
                  />
                  Sign out
                </DropdownItem>
              </>
            )}
            {inDemo && (
              <>
                <div className="my-1 h-px bg-border" />
                <DropdownItem
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    setLeaveOpen(true);
                  }}
                >
                  <Icon
                    name="x"
                    className="h-4 w-4 shrink-0 text-foreground-muted"
                  />
                  Leave demo
                </DropdownItem>
              </>
            )}
          </div>
        </div>
      )}
      {inDemo && (
        <LeaveDemoModal
          isOpen={leaveOpen}
          onClose={() => setLeaveOpen(false)}
        />
      )}
    </div>
  );
}
