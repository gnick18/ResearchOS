// Entering the public in-browser demo, the one correct way.
//
// The demo fixture is installed ONLY by FileSystemProvider's once-on-mount
// initialize() effect (the sole caller of installWikiCaptureFixture). A SOFT
// client-side navigation (<Link href="/demo"> or router.push("/demo")) does NOT
// remount the provider, so the effect never re-runs, the fixture never installs,
// and the page falls through to the connect-folder gate (and never shows the
// StagedLoadingScreen, which only renders while isLoading is true during that
// install). So demo entry MUST be a HARD navigation.
//
// There is also a DATA-SAFETY reason, documented on DevDemoToggleButton. For an
// IN-APP entry the provider's install backs the user's real folder handle up onto
// the pre-demo keys (backupRealHandleForDemo). A soft push skips that backup, so a
// later "leave demo" hits the no-backup branch and can WIPE the real folder. The
// hard navigation is what makes the backup fire.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { storePreDemoRoute } from "@/lib/file-system/pre-demo-route";

/**
 * Enter the public demo with a hard navigation so FileSystemProvider remounts and
 * installs the fixture (which also surfaces the StagedLoadingScreen during the
 * install).
 *
 * @param slug optional deep-link target inside the demo, e.g. "methods" or
 *   "/datahub?doc=5", so the entry lands on that view once the fixture installs.
 * @param opts.rememberRoute set true for an IN-APP entry (the user is already in
 *   their own folder), so "leave demo" returns to the current page. A public
 *   visitor on the welcome / marketing pages leaves this false, so exit falls back
 *   to "/". This also gates the real-folder backup path, so only pass true when
 *   the user genuinely has a real folder open.
 */
export function enterDemo(
  slug = "",
  opts?: { rememberRoute?: boolean },
): void {
  if (typeof window === "undefined") return;
  if (opts?.rememberRoute) {
    storePreDemoRoute(window.location.pathname + window.location.search);
  }
  const trimmed = slug.trim();
  const suffix =
    trimmed && trimmed !== "/"
      ? trimmed.startsWith("/")
        ? trimmed
        : `/${trimmed}`
      : "";
  window.location.assign(`/demo${suffix}`);
}
