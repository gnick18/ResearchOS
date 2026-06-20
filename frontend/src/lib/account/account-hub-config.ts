// Account hub feature flag.
//
// Gates the new /account hub (identity + billing summary + lab-head switch).
// When OFF, /account renders exactly as it does today (AccountHome). When ON,
// AccountHub renders in its place inside the same PortalShell.
//
// Enable locally by setting NEXT_PUBLIC_ACCOUNT_HUB=1 in frontend/.env.local.
// Flip to "1" or "true" in Vercel to turn on in a deployed environment.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * Whether the new account hub is active. NEXT_PUBLIC so both client and server
 * read the same baked value. Default false (unset in prod) so the merge is safe.
 */
export const ACCOUNT_HUB_ENABLED =
  process.env.NEXT_PUBLIC_ACCOUNT_HUB === "1" ||
  process.env.NEXT_PUBLIC_ACCOUNT_HUB === "true";
