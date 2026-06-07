import { APP_VERSION_LABEL } from "@/lib/version";

/**
 * Small, unobtrusive app-version pill (e.g. "v0.1.0 beta"). Rendered in the
 * folder-setup screen and the Settings header while we are in beta so users
 * (and bug reporters) always know which build they are on.
 *
 * `tone` switches the palette for the surface it sits on:
 *   - "onDark"  : a genuinely dark surface (folder-setup / loading overlays that
 *     stay dark in both modes), light text.
 *   - "muted"   : light app surfaces like the Settings page (gray text).
 *   - "surface" : a theme-aware surface (e.g. the login splash, light in light
 *     mode and dark in dark mode), readable in both.
 *
 * `className` lets the caller position it (e.g. fixed top-left corner).
 */
export default function VersionBadge({
  className = "",
  tone = "muted",
}: {
  className?: string;
  tone?: "muted" | "onDark" | "surface";
}) {
  const toneClass =
    tone === "onDark"
      ? "bg-white/10 text-slate-300 border-white/15"
      : tone === "surface"
        ? "bg-surface-sunken text-foreground-muted border-border"
        : "bg-gray-100 text-gray-500 border-gray-200";
  return (
    <span
      data-testid="app-version-badge"
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-meta font-medium tracking-wide ${toneClass} ${className}`}
    >
      {APP_VERSION_LABEL}
    </span>
  );
}
