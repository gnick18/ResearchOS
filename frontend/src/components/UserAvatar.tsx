"use client";

import { avatarGradient } from "@/lib/colors";
import { useUserColors } from "@/hooks/useUserColor";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

interface UserAvatarProps {
  username: string;
  /** Visual size — maps to a fixed Tailwind w/h pair. Defaults to "md" (40px). */
  size?: AvatarSize;
  /** Override the rendered initial letter (e.g. live-preview a rename). */
  letter?: string;
  /** Override the resolved primary color (e.g. Settings preview shows the in-flight pick). */
  colorOverride?: string;
  /** Override the resolved secondary color. `null` explicitly forces solid
   *  rendering (used by the Settings "clear secondary" preview); leave
   *  undefined to fall back to the persisted value. */
  secondaryOverride?: string | null;
  /** Tiny gold star in the top-right corner — used for the lab "owner" user. */
  showOwnerBadge?: boolean;
  /** Extra classes appended to the avatar div (positioning, ring, etc.). */
  className?: string;
  title?: string;
}

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: "w-5 h-5 text-meta",
  sm: "w-7 h-7 text-meta",
  md: "w-10 h-10 text-body",
  lg: "w-12 h-12 text-title",
  xl: "w-16 h-16 text-heading",
};

/**
 * Per-user identity bubble — the first letter of the username on a 2-stop
 * gradient.
 *
 * Two rendering modes:
 *   1. User has only a primary color (the default): derive a pleasing second
 *      stop via `avatarGradient(primary)`. Same hue family, lightened by
 *      ~16% with a -40° hue shift. Matches the old behavior exactly.
 *   2. User has opted into a 2-color gradient via Settings: render the two
 *      user-picked swatches directly. No hue-shifting — what the user picked
 *      is what they see, so collision-avoidance maps 1:1 to visual output.
 *
 * The gradient direction (135deg, top-left → bottom-right) intentionally
 * matches the old `bg-gradient-to-br` so the visual rhythm of existing
 * lists doesn't change — only the hue family does.
 */
export default function UserAvatar({
  username,
  size = "md",
  letter,
  colorOverride,
  secondaryOverride,
  showOwnerBadge,
  className = "",
  title,
}: UserAvatarProps) {
  const resolved = useUserColors(username);
  const primary = colorOverride ?? resolved.primary;
  // `undefined` → fall through to persisted; explicit `null` → force solid.
  const secondary =
    secondaryOverride === undefined ? resolved.secondary : secondaryOverride;

  const [stop1, stop2] = secondary
    ? [primary, secondary]
    : avatarGradient(primary);

  const display = (letter ?? username.charAt(0) ?? "?").toUpperCase();

  return (
    <div
      title={title ?? username}
      className={`${SIZE_CLASS[size]} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 relative ${className}`}
      style={{ background: `linear-gradient(135deg, ${stop1}, ${stop2})` }}
    >
      {display}
      {showOwnerBadge && (
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </div>
      )}
    </div>
  );
}
