"use client";

// In-app "Settings" popup. Mounted once in AppShell. The avatar-menu "Settings"
// entry opens it; the full settings body renders inside the shared LivingPopup
// (hazy blurred backdrop, zoom-from-icon, X / scrim / Escape close). The
// /settings route stays as the direct-link fallback.
//
// SettingsBody is lazy-imported via next/dynamic to break the import cycle (the
// /settings page imports AppShell, which mounts this modal). The settings body
// is tall and scrolls internally, so fillHeight bounds the card height and the
// body's own overflow-y-auto handles the scroll. The lazy chunk only loads when
// LivingPopup actually mounts the body (first open).

import dynamic from "next/dynamic";

import LivingPopup from "@/components/ui/LivingPopup";
import { useSettingsModal } from "@/lib/settings/settings-modal-store";

const SettingsBody = dynamic(
  () => import("@/app/settings/page").then((m) => m.SettingsBody),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 flex-col gap-6 p-8">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-sky-500" />
          <span className="text-meta text-foreground-muted">Loading settings…</span>
        </div>
        <div className="space-y-3">
          <div className="h-4 w-32 animate-pulse rounded bg-surface-sunken" />
          <div className="h-24 animate-pulse rounded-xl bg-surface-sunken" />
        </div>
        <div className="space-y-3">
          <div className="h-4 w-40 animate-pulse rounded bg-surface-sunken" />
          <div className="h-24 animate-pulse rounded-xl bg-surface-sunken" />
        </div>
      </div>
    ),
  },
);

export default function SettingsModal() {
  const isOpen = useSettingsModal((s) => s.isOpen);
  const origin = useSettingsModal((s) => s.origin);
  const close = useSettingsModal((s) => s.close);

  return (
    <LivingPopup
      open={isOpen}
      origin={origin}
      onClose={close}
      label="Settings"
      widthClassName="max-w-3xl"
      fillHeight
      blur
    >
      <SettingsBody />
    </LivingPopup>
  );
}
