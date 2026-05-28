import { APP_VERSION_LABEL } from "@/lib/version";

/**
 * Small, unobtrusive app-version pill (e.g. "v0.1.0 beta"). Rendered in the
 * folder-setup screen and the Settings header while we are in beta so users
 * (and bug reporters) always know which build they are on.
 *
 * `tone` switches the palette for the surface it sits on:
 *   - "onDark"  : the gradient folder-setup / loading overlays (light text)
 *   - "muted"   : light app surfaces like the Settings page (gray text)
 *
 * `className` lets the caller position it (e.g. fixed top-left corner).
 */
export default function VersionBadge({
  className = "",
  tone = "muted",
}: {
  className?: string;
  tone?: "muted" | "onDark";
}) {
  const toneClass =
    tone === "onDark"
      ? "bg-white/10 text-slate-300 border-white/15"
      : "bg-gray-100 text-gray-500 border-gray-200";
  return (
    <span
      data-testid="app-version-badge"
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium tracking-wide ${toneClass} ${className}`}
    >
      {APP_VERSION_LABEL}
    </span>
  );
}
