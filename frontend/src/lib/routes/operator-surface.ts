// Operator-only surfaces (the admin dashboard + the LLC business operator pages)
// get a UNIQUE CARVE-OUT from every user-facing gate, nudge, or blocking popup.
// These are operator tools, never shown to a normal user, so a "convert your
// folder" prompt or any similar interruption must never fire over them.
//
// Any blocking / nudging popup mounted app-wide should check this before it
// renders. (Grant 2026-06-10, after the migration gate fired on /admin/business.)
//
// No emojis, no em-dashes, no mid-sentence colons.

/** True for /admin and /business routes (and anything beneath them). */
export function isOperatorSurface(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/business" ||
    pathname.startsWith("/business/")
  );
}
