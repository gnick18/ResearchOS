"use client";

import { useEffect, useMemo, useState } from "react";
import UserAvatar from "@/components/UserAvatar";
import { USER_METADATA_COLOR_PALETTE } from "@/lib/file-system/user-metadata";
import { isCombinationTaken, ownerOfCombination } from "@/lib/file-system/user-color-collisions";
import type { UserMetadataEntry } from "@/lib/file-system/user-metadata";

interface UserColorPickerPopupProps {
  /** The username being created. Drives the avatar preview's initial letter
   *  and the title bar copy. */
  username: string;
  /** Random palette pick computed by the caller — drives the popup's
   *  initial selection so a one-click Accept gives the user a usable color
   *  without forcing a manual choice. */
  defaultColor: string;
  /** Snapshot of other users' metadata, used to disable swatches that
   *  another user has already claimed as their solid color. Pass the
   *  `otherUsersOnly`-filtered map (current user is brand-new so they
   *  don't need filtering, but tombstoned users should be excluded). */
  otherUsers: Record<string, UserMetadataEntry>;
  /** Fired when the user clicks Accept — receives their final pick. */
  onAccept: (color: string) => void;
  /** Fired when the user closes / cancels. The caller should NOT create
   *  the user in this case (the popup is part of the creation flow, so
   *  cancelling means abandoning the new user before any bytes hit disk). */
  onCancel: () => void;
}

/**
 * Modal that lets a brand-new user pick their avatar color RIGHT AFTER
 * they choose a username, BEFORE we write any files for them. Defaults to
 * a random palette swatch (the caller computes it via
 * `suggestInitialColorForNewUser` against the existing metadata snapshot)
 * so the happy path is "click Accept once and you're done." If the user
 * wants a different color, they pick from the same 10-swatch palette the
 * Settings page uses — keeping the visual rhythm consistent across the
 * two surfaces where users pick a color.
 *
 * The popup intentionally does NOT expose the optional second-color
 * gradient swatch from Settings — that's an advanced opt-in (the
 * Profile section explains why labs >10 users want a gradient). Keeping
 * the creation popup to a single primary swatch matches the
 * keep-it-simple bias of every other on-create form on the entry screen.
 *
 * Solid-vs-solid collisions ARE detected here (mirroring the Settings
 * rule): if another user already owns a swatch as their solid color, we
 * tag it `Used by <name>` and disable the button. The user can still
 * pick a swatch that's only part of someone else's gradient — gradients
 * don't reserve their stops against new solid users.
 */
export default function UserColorPickerPopup({
  username,
  defaultColor,
  otherUsers,
  onAccept,
  onCancel,
}: UserColorPickerPopupProps) {
  const [selectedColor, setSelectedColor] = useState<string>(defaultColor);

  // If the caller swaps in a different default (e.g. they re-read
  // metadata after the popup opened), follow it. The popup is mounted
  // fresh per creation attempt so this effect realistically only runs
  // once, but keeping it makes the prop a true source of truth.
  useEffect(() => {
    setSelectedColor(defaultColor);
  }, [defaultColor]);

  // Compute "Used by <other>" mapping once per `otherUsers` snapshot so
  // every swatch can render a tooltip + disabled state without re-walking
  // the map on each iteration.
  const lockedSwatches = useMemo(() => {
    const map: Record<string, string> = {};
    for (const color of USER_METADATA_COLOR_PALETTE) {
      const taken = isCombinationTaken(
        { primary: color, secondary: null },
        otherUsers,
      );
      if (!taken) continue;
      const owner = ownerOfCombination(
        { primary: color, secondary: null },
        otherUsers,
      );
      if (owner) map[color.toLowerCase()] = owner;
    }
    return map;
  }, [otherUsers]);

  const selectedLc = selectedColor.toLowerCase();

  // Escape cancels — matches the AccountPasswordPopup pattern so the entry
  // screen feels consistent across its modals.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onAccept(selectedColor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onAccept, onCancel, selectedColor]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-slate-800 rounded-2xl shadow-2xl border border-white/20 max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/10">
          <h3 className="text-lg font-semibold text-white">Pick your color</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            This is the color your initial bubble uses everywhere — lab
            views, comments, the login screen. You can change it later in
            Settings.
          </p>
        </div>

        <div className="px-6 py-5">
          {/* Live preview — uses colorOverride so it follows the in-flight
              pick instantly (no save round-trip yet). */}
          <div className="flex items-center gap-4 mb-5">
            <UserAvatar
              username={username}
              size="xl"
              colorOverride={selectedColor}
              secondaryOverride={null}
            />
            <div className="text-sm text-slate-200">
              <p className="font-medium">{username}</p>
              <p className="text-xs text-slate-400 mt-0.5">Preview</p>
            </div>
          </div>

          <label className="block text-xs font-medium text-slate-300 mb-2">
            Color
          </label>
          <div className="flex flex-wrap gap-2">
            {USER_METADATA_COLOR_PALETTE.map((c) => {
              const cLc = c.toLowerCase();
              const isSelected = cLc === selectedLc;
              const ownerName = lockedSwatches[cLc];
              const disabled = !!ownerName && !isSelected;
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  title={ownerName ? `Used by ${ownerName}` : `Color ${c}`}
                  disabled={disabled}
                  onClick={() => setSelectedColor(c)}
                  data-color-swatch={c}
                  className={`w-9 h-9 rounded-full border-2 transition-transform ${
                    isSelected
                      ? "border-white scale-110"
                      : disabled
                        ? "border-transparent opacity-30 cursor-not-allowed"
                        : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                />
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Click a swatch to switch, or accept the random default below.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 text-sm bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAccept(selectedColor)}
            className="flex-1 py-2.5 text-sm bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium rounded-lg transition-all"
          >
            Accept &amp; create
          </button>
        </div>
      </div>
    </div>
  );
}
