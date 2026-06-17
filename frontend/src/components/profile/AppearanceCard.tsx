"use client";

// Appearance editing (display name, avatar color, ORCID, header tint), moved out
// of the Settings page when profile editing became its own /profile destination
// (2026-06-05). Self-contained so /profile does not depend on the settings-search
// SectionShell. Same settings/update save contract the page already uses.

import { useState } from "react";

import UserAvatar from "@/components/UserAvatar";
import OrcidField from "@/components/settings/OrcidField";
import ColorPickerRows from "@/components/profile/ColorPickerRows";
import Toggle from "@/components/ui/Toggle";
import type { UserSettings } from "@/lib/settings/user-settings";
import {
  MAX_LENGTH_NAME,
  charsOver,
  hardenName,
} from "@/lib/validation/input-hardening";

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

  const nameOver = charsOver(draftName, MAX_LENGTH_NAME);

  const commitName = () => {
    const hardened = hardenName(draftName, MAX_LENGTH_NAME);
    const next = hardened.trim() === "" ? null : hardened.trim();
    // Reflect the stripped/capped form back into the input so the user
    // sees exactly what was saved (avoids invisible control chars).
    if (hardened !== draftName) setDraftName(hardened);
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
          <div className="flex items-center justify-between mb-1">
            <label className="text-meta font-medium text-foreground">
              Display name
            </label>
            {nameOver > 0 && (
              <span className="text-meta text-red-600 dark:text-red-400" role="alert">
                {nameOver} over limit
              </span>
            )}
          </div>
          <input
            type="text"
            value={draftName}
            placeholder={currentUser}
            maxLength={MAX_LENGTH_NAME + 20}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
            className={`w-full px-3 py-2 border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              nameOver > 0
                ? "border-red-400 focus:ring-red-300"
                : "border-border"
            }`}
          />
          <p className="text-meta text-foreground-muted mt-1">
            Leave blank to use your folder name ({currentUser}). Max {MAX_LENGTH_NAME} characters.
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
