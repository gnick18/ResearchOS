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

import HeaderPopover from "@/components/ui/HeaderPopover";
import Toggle from "@/components/ui/Toggle";
import { Icon } from "@/components/icons";
import DevicesSection from "@/components/settings/DevicesSection";
import { useCompanionHub } from "@/lib/ui/companion-hub-store";
import { useAppStore } from "@/lib/store";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { usePairedDevices } from "@/hooks/usePhonePaired";
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

// Launch-day fill: replace with the live App Store listing URL when the app ships.
const APP_STORE_URL = "https://apps.apple.com/app/researchos-companion/idPLACEHOLDER";

// Flag: set NEXT_PUBLIC_COMPANION_APP_LIVE=1 in Vercel env at launch to swap
// the placeholder copy for the real App Store badge.
const COMPANION_APP_LIVE = process.env.NEXT_PUBLIC_COMPANION_APP_LIVE === "1";


// Feature rows shown in the Info tab.
const INFO_FEATURES: {
  icon: "camera" | "pencil" | "scan" | "today";
  label: string;
  description: string;
}[] = [
  {
    icon: "camera",
    label: "Capture a bench photo",
    description:
      "Point your phone at any gel, plate, or setup and the image routes straight into your open experiment.",
  },
  {
    icon: "pencil",
    label: "Jot a quick note",
    description:
      "Fire off a one-liner observation from the bench without breaking your workflow at the laptop.",
  },
  {
    icon: "scan",
    label: "Scan a barcode for inventory",
    description:
      "Scan a reagent or supply barcode and log it against your inventory without hunting for the laptop.",
  },
  {
    icon: "today",
    label: "Glance at today",
    description:
      "See your tasks and reminders for the day at a glance so nothing falls through the cracks.",
  },
];

function InfoPanel() {
  return (
    <div className="space-y-4">
      {/* Intro header */}
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

      {/* What you can do */}
      <div className="rounded-xl border border-border bg-surface-sunken divide-y divide-border">
        {INFO_FEATURES.map((feat) => (
          <div key={feat.icon} className="flex items-start gap-3 px-4 py-3">
            <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-surface-raised mt-0.5">
              <Icon name={feat.icon} className="w-4 h-4 text-foreground-muted" />
            </span>
            <div className="min-w-0">
              <p className="text-body font-medium text-foreground">{feat.label}</p>
              <p className="text-meta text-foreground-muted leading-relaxed mt-0.5">
                {feat.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Get-the-app box, gated on NEXT_PUBLIC_COMPANION_APP_LIVE. */}
      <div className="rounded-xl border border-dashed border-border bg-surface-sunken p-4">
        <p className="text-body text-foreground font-medium">Get the app</p>
        {COMPANION_APP_LIVE ? (
          <div className="mt-3">
            {/*
              Apple "Download on the App Store" badge.
              Asset path: frontend/public/app-store-badge.svg (launch-day fill).
              Use <img> (not inline svg) to comply with Apple brand rules and
              to pass the icon-guard pre-commit hook.
            */}
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Download on the App Store"
            >
              <img
                src="/app-store-badge.svg"
                alt="Download on the App Store"
                width={135}
                height={40}
                className="h-10 w-auto"
              />
            </a>
          </div>
        ) : (
          <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
            Coming soon to the App Store. For now, open the Connect tab and pair
            your phone with the QR code to start capturing.
          </p>
        )}
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
  const devices = usePairedDevices();
  const isPaired = devices.count > 0;
  const pairedLabel =
    devices.count === 0
      ? "Not paired"
      : devices.count === 1
        ? devices.firstLabel
          ? `Paired to ${devices.firstLabel}`
          : "Paired"
        : `${devices.count} phones paired`;

  return (
    <HeaderPopover
      open={isOpen}
      origin={origin}
      onClose={close}
      label="Companion"
      widthClassName="max-w-md"
    >
        {/* Header row: icon + title on the left, paired-status pill on the right. */}
        <div className="flex items-center gap-2 px-5 pt-5 pb-3">
          <Icon name="phone" className="w-5 h-5 text-sky-500" />
          <h2 className="text-title font-semibold text-foreground">Companion</h2>
          <span className="ml-auto flex items-center gap-1.5 text-meta text-foreground-muted">
            <span
              className={
                "inline-block w-2 h-2 rounded-full flex-shrink-0 " +
                (isPaired ? "bg-green-500" : "bg-foreground-muted/40")
              }
            />
            {pairedLabel}
          </span>
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
          {tab === "connect" ? (
            <DevicesSection
              status={sharing.status}
              refreshIdentity={sharing.refresh}
            />
          ) : null}
          {tab === "info" ? <InfoPanel /> : null}
          {tab === "settings" ? <SettingsPanel /> : null}
        </div>
    </HeaderPopover>
  );
}
