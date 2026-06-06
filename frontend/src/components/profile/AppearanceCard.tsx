"use client";

// Appearance editing (display name, avatar color, ORCID, header tint), moved out
// of the Settings page when profile editing became its own /profile destination
// (2026-06-05). Self-contained so /profile does not depend on the settings-search
// SectionShell. Same settings/update save contract the page already uses.

import { useState } from "react";

import UserAvatar from "@/components/UserAvatar";
import OrcidField from "@/components/settings/OrcidField";
import ColorPickerRows from "@/components/profile/ColorPickerRows";
import type { UserSettings } from "@/lib/settings/user-settings";

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
      <span className="min-w-0">
        <span className="block text-body font-medium text-foreground">{label}</span>
        {description && (
          <span className="block text-meta text-foreground-muted mt-0.5 leading-relaxed">
            {description}
          </span>
        )}
      </span>
      <span className="relative shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="block h-6 w-11 rounded-full bg-foreground-muted/30 peer-checked:bg-blue-600 transition-colors" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface-raised transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export default function AppearanceCard({
  currentUser,
  settings,
  update,
}: {
  currentUser: string;
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => Promise<void>;
}) {
  const [draftName, setDraftName] = useState(settings.displayName ?? "");

  const commitName = () => {
    const next = draftName.trim() === "" ? null : draftName.trim();
    if (next !== settings.displayName) void update({ displayName: next });
  };

  return (
    <section className="bg-surface-raised rounded-xl border border-border p-6">
      <div className="mb-4">
        <h2 className="text-title font-semibold text-foreground">Appearance</h2>
        <p className="text-meta text-foreground-muted mt-1">
          How you appear in the app. Your color flows everywhere your initial
          bubble shows up, lab views, comments, the login screen.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <UserAvatar
            username={currentUser}
            size="xl"
            letter={draftName.charAt(0) || currentUser.charAt(0)}
            colorOverride={settings.color}
            secondaryOverride={settings.colorSecondary}
          />
          <div className="text-meta text-foreground-muted">
            <p className="text-body text-foreground font-medium">
              {draftName.trim() || currentUser}
            </p>
            <p className="mt-0.5">
              {settings.colorSecondary
                ? "Two-color gradient, your live preview."
                : "Solid color, pick a second swatch below to make it a gradient."}
            </p>
          </div>
        </div>

        <div>
          <label className="block text-meta font-medium text-foreground mb-1">
            Display name
          </label>
          <input
            type="text"
            value={draftName}
            placeholder={currentUser}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
            className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-meta text-foreground-muted mt-1">
            Leave blank to use your folder name ({currentUser}).
          </p>
        </div>

        <OrcidField currentUser={currentUser} />

        <ColorPickerRows
          currentUser={currentUser}
          primary={settings.color}
          secondary={settings.colorSecondary}
          update={update}
        />

        <Toggle
          label="Tint header with my color"
          description="When off, the top bar stays white. Your avatar bubbles around the app still use your color either way."
          checked={settings.coloredHeader}
          onChange={(v) => void update({ coloredHeader: v })}
        />
      </div>
    </section>
  );
}
