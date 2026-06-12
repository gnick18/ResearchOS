// Demo-mode floating affordances (demo-fab-polish, 2026-06-12). One shared
// class so the bottom-right demo pills (Leave demo, View as lab head, Read the
// docs) read as a single family instead of three independently styled buttons.
// These pills DO ship to the public /demo, so they follow the app's
// surface-raised + hairline-border language (the same surface the calculator /
// feedback FAB circles use), with a soft backdrop blur because they float over
// content. Keep this the single source of truth, do not re-hardcode the string.
export const DEMO_PILL_CLASS =
  "flex items-center gap-1.5 rounded-full border border-border bg-surface-raised/90 px-3 py-1.5 text-meta font-medium text-foreground-muted shadow-sm backdrop-blur transition-colors hover:bg-surface-sunken hover:text-foreground focus-visible:ring-2 focus-visible:ring-border focus-visible:ring-offset-2";
