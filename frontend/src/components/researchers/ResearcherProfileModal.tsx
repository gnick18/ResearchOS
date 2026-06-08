"use client";

// In-app researcher profile popup. Mounted once in AppShell. When a profile is
// opened from within the app (the avatar menu, a search result), it renders OVER
// the current page inside the shared LivingPopup (hazy blurred backdrop,
// zoom-from-icon, X / scrim / Escape close) instead of navigating away. The
// shareable /researchers/[fingerprint] route remains the standalone fallback for
// direct links.
//
// This host only owns the data (which fingerprint, fetch the profile). All popup
// chrome + animation lives in LivingPopup. The profile card states bring their
// own surface chrome, so card={false}.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG.

import { useEffect, useState } from "react";

import LivingPopup from "@/components/ui/LivingPopup";
import ProfileCard from "./ProfileCard";
import { useProfileModal } from "@/lib/sharing/profile-modal-store";
import { useProfileSettingsModal } from "@/lib/profile/profile-settings-modal-store";
import {
  type PublishedProfile,
  fetchProfileByFingerprint,
} from "@/lib/sharing/profile";

export default function ResearcherProfileModal() {
  const fingerprint = useProfileModal((s) => s.fingerprint);
  const origin = useProfileModal((s) => s.origin);
  const close = useProfileModal((s) => s.close);
  const openProfileSettings = useProfileSettingsModal((s) => s.open);

  const [profile, setProfile] = useState<PublishedProfile | null | undefined>(
    undefined,
  );

  // Fetch the profile for the open fingerprint. Reset to the loading state on a
  // new fingerprint so the spinner shows before the next profile resolves.
  /* eslint-disable react-hooks/set-state-in-effect -- fetch on deps change: reset to the loading state, then store the fetched profile. */
  useEffect(() => {
    if (!fingerprint) return;
    let cancelled = false;
    setProfile(undefined);
    fetchProfileByFingerprint(fingerprint).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [fingerprint]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <LivingPopup
      open={fingerprint != null}
      origin={origin}
      onClose={close}
      label="Profile"
      widthClassName="max-w-lg"
      card={false}
    >
      {profile === undefined ? (
        <div className="flex items-center justify-center rounded-2xl bg-surface-overlay border border-border p-12 shadow-2xl ring-1 ring-black/5">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-sky-500" />
        </div>
      ) : profile === null ? (
        <div className="rounded-2xl bg-surface-overlay border border-border p-8 text-center shadow-2xl ring-1 ring-black/5">
          <h2 className="text-heading font-semibold text-foreground">
            No profile yet
          </h2>
          <p className="mt-2 text-body text-foreground-muted leading-relaxed">
            This researcher has not published a profile, or the link is out of
            date.
          </p>
          <button
            type="button"
            onClick={(e) => {
              const { clientX: x, clientY: y } = e;
              close();
              openProfileSettings({ x, y });
            }}
            className="mt-4 inline-block text-body font-medium text-sky-700 dark:text-sky-300 underline-offset-2 hover:underline"
          >
            Set up your own profile
          </button>
        </div>
      ) : (
        <ProfileCard profile={profile} />
      )}
    </LivingPopup>
  );
}
