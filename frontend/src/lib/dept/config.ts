// Department tier feature flag. The dept surfaces + API routes are dark until
// launch. Uses the NEXT_PUBLIC env pattern (like INVENTORY_ENABLED) rather than a
// hardcoded const, so it is OFF by default in prod (env unset) and safe to commit
// + push, and turned on locally with NEXT_PUBLIC_DEPT_TIER_ENABLED=1 in
// frontend/.env.local for testing. Flipping it on a deployed env is an env action
// (set the var + redeploy), NOT a code change.
//
// No emojis, no em-dashes, no mid-sentence colons.

export const DEPT_TIER_ENABLED =
  process.env.NEXT_PUBLIC_DEPT_TIER_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_DEPT_TIER_ENABLED === "true";
