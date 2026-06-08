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
import { useEffect } from "react";

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

  // Warm the lazy SettingsBody chunk on idle after the app mounts, so the FIRST
  // open is instant (no chunk-load delay). This modal is mounted once at app
  // start, so the preload runs once. Same module specifier as the dynamic()
  // above, so it just fills webpack's chunk cache. (ProfileSettingsContent is a
  // static import, already eager, so it needs no preload.)
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const preload = () => {
      void import("@/app/settings/page");
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(preload, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(id);
  }, []);

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
