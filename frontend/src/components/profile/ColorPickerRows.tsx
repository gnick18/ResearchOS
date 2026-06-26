"use client";

// Avatar color picker rows, moved out of the Settings page when profile editing
// became its own /profile destination (2026-06-05). Pure UI over the same
// user-color collision helpers, unchanged behavior. The `data-color-swatch`
// stamps are preserved so the onboarding color step can re-anchor here when the
// tour is rebuilt.

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { USER_COLOR_QUERY_KEY } from "@/hooks/useUserColor";
import {
  readAllUserMetadata,
  USER_METADATA_COLOR_PALETTE as USER_COLOR_PALETTE,
  RAINBOW_SENTINELS,
} from "@/lib/file-system/user-metadata";
import {
  isCombinationTaken,
  ownerOfCombination,
  otherUsersOnlyAsync,
  takenSecondariesFor,
  takenSolidPrimaries,
} from "@/lib/file-system/user-color-collisions";
import { rainbowTheme } from "@/lib/colors";
import RainbowOrb from "@/components/RainbowOrb";
import type { UserSettings } from "@/lib/settings/user-settings";

export default function ColorPickerRows({
  currentUser,
  primary,
  secondary,
  update,
}: {
  currentUser: string;
  primary: string;
  secondary: string | null;
  update: (patch: Partial<UserSettings>) => Promise<void>;
}) {
  // Load the cross-user metadata so disabled-states reflect what others
  // have picked. The save handler invalidates USER_COLOR_QUERY_KEY after
  // every color write, so piggy-backing on its dataUpdatedAt for the
  // dependency means we re-read whenever a peer's metadata could have
  // changed (multi-tab scenarios) without extra polling.
  const queryClient = useQueryClient();
  // The color-map query key now carries the current user (the SELF avatar color
  // comes from the account blob), so read the exact per-user key here. Prefix
  // invalidation of USER_COLOR_QUERY_KEY still refreshes it.
  const colorMapState = queryClient.getQueryState([
    ...USER_COLOR_QUERY_KEY,
    currentUser,
  ]);
  const cacheVersion = colorMapState?.dataUpdatedAt ?? 0;
  const [otherUsers, setOtherUsers] = useState<
    Awaited<ReturnType<typeof otherUsersOnlyAsync>>
  >({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await readAllUserMetadata();
      const others = await otherUsersOnlyAsync(all, currentUser);
      if (cancelled) return;
      setOtherUsers(others);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, cacheVersion]);

  const primaryLc = primary.toLowerCase();
  const secondaryLc = secondary ? secondary.toLowerCase() : null;

  const takenSolids = useMemo(
    () => takenSolidPrimaries(otherUsers),
    [otherUsers],
  );
  const takenSecondaries = useMemo(
    () => takenSecondariesFor(primary, otherUsers),
    [primary, otherUsers],
  );

  const handlePickPrimary = async (c: string) => {
    // Rainbow is a full 5-stop, so a secondary is meaningless. Picking a rainbow
    // clears any existing secondary and the secondary row hides below.
    if (RAINBOW_SENTINELS.has(c)) {
      await update({ color: c, colorSecondary: null });
      return;
    }
    let nextSecondary: string | null = secondary;
    if (
      nextSecondary &&
      isCombinationTaken({ primary: c, secondary: nextSecondary }, otherUsers)
    ) {
      nextSecondary = null;
    }
    if (
      !nextSecondary &&
      isCombinationTaken({ primary: c, secondary: null }, otherUsers)
    ) {
      return;
    }
    await update({ color: c, colorSecondary: nextSecondary });
  };

  const handlePickSecondary = async (c: string) => {
    if (c.toLowerCase() === primaryLc) return; // can't pair with itself
    if (isCombinationTaken({ primary, secondary: c }, otherUsers)) return;
    await update({ colorSecondary: c });
  };

  const handleClearSecondary = async () => {
    if (isCombinationTaken({ primary, secondary: null }, otherUsers)) {
      return;
    }
    await update({ colorSecondary: null });
  };

  return (
    <>
      <div>
        <label className="block text-meta font-medium text-foreground-muted mb-2">
          Primary color
        </label>
        <div className="flex flex-wrap gap-2">
          {USER_COLOR_PALETTE.map((c) => {
            const cLc = c.toLowerCase();
            const isSelected = cLc === primaryLc;
            const wouldGoSolid = !secondary;
            const blockedSolid = wouldGoSolid && takenSolids.has(cLc);
            const ownerName = blockedSolid
              ? ownerOfCombination({ primary: c, secondary: null }, otherUsers)
              : null;
            const disabled = blockedSolid && !isSelected;
            // Rainbow sentinels aren't hex colors, so render their gradient
            // (matching the avatar/header) instead of an invalid backgroundColor.
            const rainbow = rainbowTheme(c);
            const rainbowLabel =
              c === "rainbow"
                ? "BeakerBot rainbow (pastel)"
                : "BeakerBot rainbow (vivid)";
            return (
              <button
                key={c}
                type="button"
                aria-label={rainbow ? rainbowLabel : `Primary color ${c}`}
                title={
                  ownerName
                    ? `Used by ${ownerName}`
                    : rainbow
                      ? rainbowLabel
                      : `Color ${c}`
                }
                disabled={disabled}
                onClick={() => void handlePickPrimary(c)}
                data-color-swatch={c}
                className={`relative overflow-hidden w-8 h-8 rounded-full border-2 transition-transform ${
                  isSelected
                    ? rainbow
                      ? "border-transparent ring-2 ring-sky-500 scale-110"
                      : "border-foreground scale-110"
                    : disabled
                      ? "border-transparent opacity-30 cursor-not-allowed"
                      : "border-transparent hover:scale-105"
                }`}
                style={rainbow ? undefined : { backgroundColor: c }}
              >
                {rainbow && (
                  <RainbowOrb
                    variant={rainbow.variant}
                    className="absolute inset-0 h-full w-full"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rainbow is always the full 5-stop, so a secondary color is meaningless.
          Hide the whole secondary row when a rainbow is the primary. */}
      {!RAINBOW_SENTINELS.has(primary) && (
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-meta font-medium text-foreground-muted">
            Optional second color for gradient
          </label>
          {secondary && (
            <button
              type="button"
              onClick={() => void handleClearSecondary()}
              className="text-meta text-foreground-muted hover:text-foreground underline"
            >
              Clear secondary
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Rainbow is always a full 5-stop, so it can't be a SECOND color. */}
          {USER_COLOR_PALETTE.filter((c) => !RAINBOW_SENTINELS.has(c)).map((c) => {
            const cLc = c.toLowerCase();
            const isSelected = secondaryLc === cLc;
            const isSamePrimary = cLc === primaryLc;
            const isTakenPair = takenSecondaries.has(cLc);
            const ownerName = isTakenPair
              ? ownerOfCombination({ primary, secondary: c }, otherUsers)
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
                onClick={() => void handlePickSecondary(c)}
                data-color-swatch={c}
                className={`w-8 h-8 rounded-full border-2 bg-origin-border transition-transform ${
                  isSelected
                    ? "border-foreground scale-110"
                    : disabled
                      ? "border-transparent opacity-30 cursor-not-allowed"
                      : "border-transparent hover:scale-105"
                }`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
        <p className="text-meta text-gray-400 mt-1">
          Pick a second color to make your avatar a 2-stop gradient. Helpful when
          your lab has more than 10 people. Direction doesn&apos;t matter,
          blue-to-green and green-to-blue count as the same combo.
        </p>
      </div>
      )}
    </>
  );
}
