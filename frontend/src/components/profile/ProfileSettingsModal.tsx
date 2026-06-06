"use client";

// In-app "Profile settings" popup. Mounted once in AppShell. The avatar-menu
// "Profile settings" entry opens it; the appearance + researcher-profile body
// renders inside the shared LivingPopup (hazy blurred backdrop, zoom-from-icon,
// X / scrim / Escape close). The /profile route stays as the direct-link
// fallback.

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
      widthClassName="max-w-2xl"
      padded
    >
      <ProfileSettingsContent />
    </LivingPopup>
  );
}
