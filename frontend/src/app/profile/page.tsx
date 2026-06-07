"use client";

// /profile — "your stuff". The Twitter-profile-tab metaphor (Grant 2026-06-05):
// what you control about yourself, split out of the general Settings page and
// the Sharing section. Holds your appearance (name, avatar color, ORCID, header
// tint) and your researcher profile (affiliation, publications). Discovering
// OTHER people lives on /researchers, the social hub, not here.
//
// The body lives in ProfileSettingsContent so it can also render inside the
// ProfileSettingsModal popup (the avatar-menu "Profile settings" entry). This
// route stays as the direct-link / deep-link fallback.

import AppShell from "@/components/AppShell";
import ProfileSettingsContent from "@/components/profile/ProfileSettingsContent";

export default function ProfilePage() {
  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <ProfileSettingsContent />
        </div>
      </div>
    </AppShell>
  );
}
