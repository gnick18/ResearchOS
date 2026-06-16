"use client";

import { useEffect, useMemo, useState } from "react";
import UserAvatar from "@/components/UserAvatar";
import RainbowOrb from "@/components/RainbowOrb";
import { usePopupLayer } from "@/lib/ui/popup-stack";
import {
  USER_METADATA_COLOR_PALETTE,
  RAINBOW_COLOR,
  RAINBOW_VIVID_COLOR,
  RAINBOW_SENTINELS,
} from "@/lib/file-system/user-metadata";
import {
  isCombinationTaken,
  ownerOfCombination,
} from "@/lib/file-system/user-color-collisions";
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
   *  another user has already claimed as their solid color OR as a
   *  primary+secondary pair. Pass the `otherUsersOnly`-filtered map
   *  (current user is brand-new so they don't need filtering, but
   *  tombstoned users should be excluded). */
  otherUsers: Record<string, UserMetadataEntry>;
  /** Fired when the user clicks Accept — receives their final picks.
   *  `colorSecondary` is `null` when the user stayed on a single color. */
  onAccept: (color: string, colorSecondary: string | null) => void;
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
 * Settings page uses.
 *
 * The popup now mirrors the Settings two-row pattern: a primary swatch
 * row plus an optional second-color row that promotes the avatar to a
 * 2-stop gradient. The gradient is helpful when a lab has more than 10
 * members and the primary palette runs out of solids. Direction does not
 * matter (the collision helper treats `{primary: A, secondary: B}` and
 * `{primary: B, secondary: A}` as the same combo).
 *
 * Solid-vs-solid collisions ARE detected here (mirroring the Settings
 * rule): if another user already owns a swatch as their solid color, we
 * tag it `Used by <name>` and disable the button on the primary row when
 * the secondary is empty. Pair-vs-pair collisions are detected on the
 * secondary row.
 */
export default function UserColorPickerPopup({
  username,
  defaultColor,
  otherUsers,
  onAccept,
  onCancel,
}: UserColorPickerPopupProps) {
  // Opens over the profile modal, so register with the popup stack and blur only
  // when bottom-most, never compounding on the popup already blurring behind it.
  const { shouldBlur } = usePopupLayer(true, true);

  const [selectedColor, setSelectedColor] = useState<string>(defaultColor);
  const [selectedSecondary, setSelectedSecondary] = useState<string | null>(
    null,
  );

  // If the caller swaps in a different default (e.g. they re-read
  // metadata after the popup opened), follow it. The popup is mounted
  // fresh per creation attempt so this effect realistically only runs
  // once, but keeping it makes the prop a true source of truth.
  useEffect(() => {
    setSelectedColor(defaultColor);
  }, [defaultColor]);

  const selectedLc = selectedColor.toLowerCase();
  const selectedSecondaryLc = selectedSecondary?.toLowerCase() ?? null;

  // Precompute the "taken as solid" set so the primary row can disable
  // those swatches when the user hasn't picked a secondary yet. Matches
  // the Settings page rule (solid-vs-solid only).
  // NOTE: USER_METADATA_COLOR_PALETTE now includes RAINBOW_COLOR at the
  // end, so this set will also include "rainbow" when taken.
  const takenSolids = useMemo(() => {
    const set = new Set<string>();
    for (const color of USER_METADATA_COLOR_PALETTE) {
      if (
        isCombinationTaken({ primary: color, secondary: null }, otherUsers)
      ) {
        set.add(color.toLowerCase());
      }
    }
    return set;
  }, [otherUsers]);

  // Determine the owner of each rainbow combo (for the disabled tooltip).
  const rainbowOwner = useMemo(
    () =>
      ownerOfCombination({ primary: RAINBOW_COLOR, secondary: null }, otherUsers),
    [otherUsers],
  );
  const rainbowTaken =
    takenSolids.has(RAINBOW_COLOR) && selectedColor !== RAINBOW_COLOR;
  const rainbowVividOwner = useMemo(
    () =>
      ownerOfCombination(
        { primary: RAINBOW_VIVID_COLOR, secondary: null },
        otherUsers,
      ),
    [otherUsers],
  );
  const rainbowVividTaken =
    takenSolids.has(RAINBOW_VIVID_COLOR) &&
    selectedColor !== RAINBOW_VIVID_COLOR;

  // Precompute the "taken as a pair with current primary" set so the
  // secondary row can disable the swatches that would land on someone
  // else's combo.
  const takenSecondaries = useMemo(() => {
    const set = new Set<string>();
    for (const color of USER_METADATA_COLOR_PALETTE) {
      if (color.toLowerCase() === selectedLc) continue; // skip self-pair
      if (
        isCombinationTaken(
          { primary: selectedColor, secondary: color },
          otherUsers,
        )
      ) {
        set.add(color.toLowerCase());
      }
    }
    return set;
  }, [selectedColor, selectedLc, otherUsers]);

  // Escape cancels, Enter accepts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onAccept(selectedColor, selectedSecondary);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onAccept, onCancel, selectedColor, selectedSecondary]);

  const handlePickPrimary = (c: string) => {
    const cLc = c.toLowerCase();
    // If picking this primary would make the (primary, currentSecondary)
    // pair collide with another user, drop the secondary so we don't
    // silently inherit an invalid combo. Refuse the click if even the
    // solid form is taken.
    let nextSecondary = selectedSecondary;
    if (nextSecondary) {
      if (
        cLc === nextSecondary.toLowerCase() ||
        isCombinationTaken(
          { primary: c, secondary: nextSecondary },
          otherUsers,
        )
      ) {
        nextSecondary = null;
      }
    }
    if (
      !nextSecondary &&
      isCombinationTaken({ primary: c, secondary: null }, otherUsers)
    ) {
      return;
    }
    setSelectedColor(c);
    setSelectedSecondary(nextSecondary);
  };

  const handlePickSecondary = (c: string) => {
    if (c.toLowerCase() === selectedLc) return; // can't pair with itself
    if (
      isCombinationTaken(
        { primary: selectedColor, secondary: c },
        otherUsers,
      )
    ) {
      return;
    }
    setSelectedSecondary(c);
  };

  const handlePickRainbow = () => {
    // Rainbow is always a 5-stop gradient stored as the sentinel string.
    // `color_secondary` is meaningless for rainbow, so always clear it.
    if (rainbowTaken) return;
    setSelectedColor(RAINBOW_COLOR);
    setSelectedSecondary(null);
  };

  const handlePickRainbowVivid = () => {
    if (rainbowVividTaken) return;
    setSelectedColor(RAINBOW_VIVID_COLOR);
    setSelectedSecondary(null);
  };

  const handleClearSecondary = () => {
    // Going gradient → solid. If the solid form is taken by another user,
    // surface the refusal silently (the swatch tooltips on the primary row
    // already explain who has it).
    if (
      isCombinationTaken(
        { primary: selectedColor, secondary: null },
        otherUsers,
      )
    ) {
      return;
    }
    setSelectedSecondary(null);
  };

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center bg-black/60 ${
        shouldBlur ? "backdrop-blur-sm" : ""
      }`}
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="user-color-picker"
      onClick={onCancel}
    >
      <div
        className="bg-surface-raised rounded-2xl shadow-2xl border border-border max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-heading font-semibold text-foreground">Pick your color</h3>
          <p className="text-meta text-foreground-muted mt-0.5">
            This is the color your initial bubble uses everywhere (lab views,
            comments, the login screen). You can change it later in Settings.
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
              secondaryOverride={selectedSecondary}
            />
            <div className="text-body text-foreground">
              <p className="font-medium">{username}</p>
              <p className="text-meta text-foreground-muted mt-0.5">Preview</p>
            </div>
          </div>

          <label className="block text-meta font-medium text-foreground-muted mb-2">
            Primary color
          </label>
          <div className="flex flex-wrap gap-2">
            {/* Regular hex-color swatches — exclude the rainbow sentinel
                which has its own special swatch rendered below. */}
            {USER_METADATA_COLOR_PALETTE.filter((c) => !RAINBOW_SENTINELS.has(c)).map((c) => {
              const cLc = c.toLowerCase();
              const isSelected = cLc === selectedLc;
              // Match the Settings rule: only block solid-vs-solid. If
              // the user has a secondary, the primary row tolerates
              // collisions (the pair is what counts).
              const wouldGoSolid = !selectedSecondary;
              const blockedSolid = wouldGoSolid && takenSolids.has(cLc);
              const ownerName = blockedSolid
                ? ownerOfCombination(
                    { primary: c, secondary: null },
                    otherUsers,
                  )
                : null;
              const disabled = blockedSolid && !isSelected;
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`Primary color ${c}`}
                  title={ownerName ? `Used by ${ownerName}` : `Color ${c}`}
                  disabled={disabled}
                  onClick={() => handlePickPrimary(c)}
                  data-color-swatch={c}
                  className={`w-9 h-9 rounded-full border-2 bg-origin-border transition-transform ${
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
            {/* BeakerBot rainbow swatch — rendered after the 10 regular
                swatches. Uses the 5-stop gradient directly as a
                background, and a ring with a subtle shimmer border to
                make it visually distinct from the solid swatches. */}
            <button
              type="button"
              aria-label="BeakerBot rainbow (pastel)"
              title={
                rainbowOwner
                  ? `Used by ${rainbowOwner}`
                  : "BeakerBot rainbow (pastel)"
              }
              disabled={rainbowTaken}
              onClick={handlePickRainbow}
              data-color-swatch={RAINBOW_COLOR}
              className={`relative overflow-hidden w-9 h-9 rounded-full border-2 transition-transform ${
                selectedColor === RAINBOW_COLOR
                  ? "border-white scale-110"
                  : rainbowTaken
                    ? "border-transparent opacity-30 cursor-not-allowed"
                    : "border-transparent hover:scale-105"
              }`}
            >
              <RainbowOrb variant="pastel" className="absolute inset-0 h-full w-full" />
            </button>
            {/* Second rainbow: the vivid (saturated) ramp. */}
            <button
              type="button"
              aria-label="BeakerBot rainbow (vivid)"
              title={
                rainbowVividOwner
                  ? `Used by ${rainbowVividOwner}`
                  : "BeakerBot rainbow (vivid)"
              }
              disabled={rainbowVividTaken}
              onClick={handlePickRainbowVivid}
              data-color-swatch={RAINBOW_VIVID_COLOR}
              className={`relative overflow-hidden w-9 h-9 rounded-full border-2 transition-transform ${
                selectedColor === RAINBOW_VIVID_COLOR
                  ? "border-white scale-110"
                  : rainbowVividTaken
                    ? "border-transparent opacity-30 cursor-not-allowed"
                    : "border-transparent hover:scale-105"
              }`}
            >
              <RainbowOrb variant="vivid" className="absolute inset-0 h-full w-full" />
            </button>
          </div>

          {/* Hide the secondary row entirely when rainbow is selected —
              rainbow is always the full 5-stop, so a secondary is
              meaningless (and confusing to show). */}
          {!RAINBOW_SENTINELS.has(selectedColor) && (
            <>
              <div className="flex items-center justify-between mt-5 mb-2">
                <label className="block text-meta font-medium text-foreground-muted">
                  Optional second color for gradient
                </label>
                {selectedSecondary && (
                  <button
                    type="button"
                    onClick={handleClearSecondary}
                    className="text-meta text-foreground-muted hover:text-foreground underline"
                  >
                    Clear secondary
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {USER_METADATA_COLOR_PALETTE.filter((c) => !RAINBOW_SENTINELS.has(c)).map((c) => {
                  const cLc = c.toLowerCase();
                  const isSelected = selectedSecondaryLc === cLc;
                  const isSamePrimary = cLc === selectedLc;
                  const isTakenPair = takenSecondaries.has(cLc);
                  const ownerName = isTakenPair
                    ? ownerOfCombination(
                        { primary: selectedColor, secondary: c },
                        otherUsers,
                      )
                    : null;
                  const disabled = (isSamePrimary || isTakenPair) && !isSelected;
                  const title = isSamePrimary
                    ? "Same as primary"
                    : ownerName
                      ? `Used by ${ownerName}`
                      : `Color ${c}`;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Secondary color ${c}`}
                      title={title}
                      disabled={disabled}
                      onClick={() => handlePickSecondary(c)}
                      data-color-swatch={c}
                      className={`w-9 h-9 rounded-full border-2 bg-origin-border transition-transform ${
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
              <p className="text-meta text-foreground-muted mt-2">
                Pick a second color to make your avatar a 2-stop gradient.
                Helpful when your lab has more than 10 people. Direction does
                not matter (blue-to-green and green-to-blue count as the same
                combo).
              </p>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="ros-btn-neutral flex-1 py-2.5 text-body"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAccept(selectedColor, selectedSecondary)}
            className="flex-1 py-2.5 text-body bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium rounded-lg transition-all"
          >
            Accept &amp; create
          </button>
        </div>
      </div>
    </div>
  );
}
