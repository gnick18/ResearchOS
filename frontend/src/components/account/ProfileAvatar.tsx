"use client";

// Cloud-accounts Phase 3 Chunk 3A: the profile avatar with an initial fallback.
//
// Renders the account avatar image when one is set, otherwise a brand-tinted
// circle with the first initial. Shared by AccountHome and the public /u/<handle>
// page so the placeholder and image rendering stay identical in both places.
//
// No emojis, no em-dashes, no mid-sentence colons.

interface ProfileAvatarProps {
  /** The stored avatar data URL, or null to show the initial placeholder. */
  avatarUrl: string | null | undefined;
  /** The name or handle the initial is derived from. */
  name: string | null | undefined;
  /** Pixel size of the square avatar. */
  sizePx: number;
  /** Extra classes on the wrapper (e.g. mx-auto). */
  className?: string;
}

export default function ProfileAvatar({
  avatarUrl,
  name,
  sizePx,
  className,
}: ProfileAvatarProps) {
  const initial = (name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
  const style = { width: sizePx, height: sizePx };
  // Scale the initial roughly to the circle. Half the edge reads well at any size.
  const fontSize = Math.round(sizePx * 0.42);

  if (avatarUrl) {
    return (
      // The avatar is a user-provided data URL, not a remote host, so a plain img
      // is correct here (next/image is for optimized remote/static assets).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name ? `${name} avatar` : "Profile avatar"}
        style={style}
        className={`flex-none rounded-full object-cover ${className ?? ""}`}
      />
    );
  }

  return (
    <div
      style={style}
      className={`grid flex-none place-items-center rounded-full bg-brand-purple font-extrabold text-white ${className ?? ""}`}
      aria-hidden
    >
      <span style={{ fontSize }}>{initial}</span>
    </div>
  );
}
