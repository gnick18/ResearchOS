"use client";

// In-app quick "edit my profile" popup. Mounted once in AppShell, now opened
// only from the researcher directory ("Edit your profile" on your own card). The
// avatar-menu "Profile settings" entry was retired by the settings-build bot
// (2026-06-11) when profile editing folded into the unified Settings shell.
//
// It renders ProfileSettingsContent, the SAME body the Settings "Profile &
// appearance" rail section renders, so this stays a focused one-surface quick
// edit rather than mounting the whole rail shell inside a small popup. The
// canonical home is /settings?section=profile; this is the in-context shortcut.

import LivingPopup from "@/components/ui/LivingPopup";
import ProfileSettingsContent from "@/components/profile/ProfileSettingsContent";
import { useProfileSettingsModal } from "@/lib/profile/profile-settings-modal-store";

export default function ProfileSettingsModal() {
  const isOpen = useProfileSettingsModal((s) => s.isOpen);
  const origin = useProfileSettingsModal((s) => s.origin);
  const close = useProfileSettingsModal((s) => s.close);

  return (
    <LivingPopup
      open={isOpen}
      origin={origin}
      onClose={close}
      label="Profile settings"
      widthClassName="max-w-5xl"
      padded
      blur
    >
      <ProfileSettingsContent />
    </LivingPopup>
  );
}
