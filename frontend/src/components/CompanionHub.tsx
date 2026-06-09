"use client";

// Companion hub popup. Opened from the header Companion button (and reachable as
// a future Settings entry). One LivingPopup with three tabs:
//   Connect  embeds the existing DevicesSection (the orchestrator's relay +
//            pairing surface, the ResearchOS Companion section) UNCHANGED.
//   Info     what the companion app is + get-the-app (pre-launch placeholder).
//   Settings two companion preferences (the home-button toggle + the
//            auto-publish kill switch).
//
// Connect is the default tab so the pairing surface is never buried. The Connect
// content itself is the orchestrator's; this component only hosts it.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";

import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import DevicesSection from "@/components/settings/DevicesSection";
import { useCompanionHub } from "@/lib/ui/companion-hub-store";
import { useAppStore } from "@/lib/store";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import {
  readUserSettings,
  patchUserSettings,
} from "@/lib/settings/user-settings";

type Tab = "connect" | "info" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "info", label: "Info" },
  { id: "settings", label: "Settings" },
];

// Local toggle, mirrors the one in AppearanceCard (which is not exported).
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer select-none">
      <span className="flex flex-col gap-0.5">
        <span className="text-body text-foreground">{label}</span>
        {description ? (
          <span className="text-meta text-foreground-muted leading-relaxed">
            {description}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 accent-sky-500 w-4 h-4 flex-shrink-0"
      />
    </label>
  );
}

function InfoPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-sky-500/10">
          <Icon name="phone" className="w-5 h-5 text-sky-500" />
        </span>
        <div>
          <h3 className="text-title font-semibold text-foreground">
            ResearchOS Companion
          </h3>
          <p className="text-meta text-foreground-muted mt-0.5">
            Capture at the bench, sync back to your folder.
          </p>
        </div>
      </div>
      <p className="text-body text-foreground-muted leading-relaxed">
        Snap a photo or jot a quick note on your phone and it routes straight
        into your lab folder. Glance at today, check inventory, and keep capturing
        away from the laptop.
      </p>
      <div className="rounded-xl border border-dashed border-border bg-surface-sunken p-4">
        <p className="text-body text-foreground font-medium">Get the app</p>
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          Coming soon to the App Store. For now, open the Connect tab and pair
          your phone with the QR code to start capturing.
        </p>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const { currentUser } = useFileSystem();
  const showCompanionButton = useAppStore((s) => s.showCompanionButton);
  const setShowCompanionButton = useAppStore((s) => s.setShowCompanionButton);
  const [autoPublish, setAutoPublish] = useState(true);

  useEffect(() => {
    let active = true;
    if (!currentUser) return;
    void readUserSettings(currentUser).then((s) => {
      if (active) setAutoPublish(s.autoPublishSnapshotsToPhones);
    });
    return () => {
      active = false;
    };
  }, [currentUser]);

  const onShowButton = (v: boolean) => {
    // Store first so the header reacts instantly, then persist.
    setShowCompanionButton(v);
    if (currentUser) {
      void patchUserSettings(currentUser, { showCompanionButton: v });
    }
  };

  const onAutoPublish = (v: boolean) => {
    setAutoPublish(v);
    if (currentUser) {
      void patchUserSettings(currentUser, { autoPublishSnapshotsToPhones: v });
    }
  };

  return (
    <div className="space-y-5">
      <Toggle
        label="Show Companion button on Home"
        description="The phone button in the app header. Off hides it; the Companion stays reachable from Settings."
        checked={showCompanionButton}
        onChange={onShowButton}
      />
      <Toggle
        label="Auto-publish snapshots to paired phones"
        description="The laptop pushes today, inventory, and notebook snapshots to your paired phones. Off stops the push."
        checked={autoPublish}
        onChange={onAutoPublish}
      />
    </div>
  );
}

export default function CompanionHub() {
  const isOpen = useCompanionHub((s) => s.isOpen);
  const origin = useCompanionHub((s) => s.origin);
  const close = useCompanionHub((s) => s.close);
  const [tab, setTab] = useState<Tab>("connect");
  const sharing = useSharingIdentity();

  return (
    <LivingPopup
      open={isOpen}
      origin={origin}
      onClose={close}
      label="Companion"
      widthClassName="max-w-2xl"
      fillHeight
      blur
    >
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 px-5 pt-5 pb-3">
          <Icon name="phone" className="w-5 h-5 text-sky-500" />
          <h2 className="text-title font-semibold text-foreground">Companion</h2>
        </div>
        <div
          role="tablist"
          aria-label="Companion"
          className="flex gap-1 px-5 border-b border-border"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={
                  "px-3 py-2 text-body -mb-px border-b-2 transition-colors " +
                  (active
                    ? "border-sky-500 text-foreground font-medium"
                    : "border-transparent text-foreground-muted hover:text-foreground")
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {tab === "connect" ? <DevicesSection ready={sharing.isReady} /> : null}
          {tab === "info" ? <InfoPanel /> : null}
          {tab === "settings" ? <SettingsPanel /> : null}
        </div>
      </div>
    </LivingPopup>
  );
}
