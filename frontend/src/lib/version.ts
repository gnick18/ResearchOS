// Single source of truth for the displayed app version.
//
// Bump APP_VERSION in lockstep with the "version" field in package.json on
// each release. While we are pre-1.0 the "beta" channel label rides alongside
// the number wherever the version is surfaced (the folder-setup badge, the
// Settings header, and the loading splash banner).
export const APP_VERSION = "0.5.0";

// Release channel shown next to the number. Set to "" once we ship 1.0 and
// the beta framing goes away.
export const APP_CHANNEL = "beta";

// Pre-composed label for display, e.g. "v0.1.0 beta".
export const APP_VERSION_LABEL = APP_CHANNEL
  ? `v${APP_VERSION} ${APP_CHANNEL}`
  : `v${APP_VERSION}`;
