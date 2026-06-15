// Onboarding wizard feature flag. The stepped account-setup wizard (the
// 3-track shell that replaces the stacked /account page) is dark until launch.
// Uses the same NEXT_PUBLIC env pattern as LAB_TIER_ENABLED / DEPT_TIER_ENABLED,
// so it is OFF by default in prod (env unset), safe to commit and push, and
// turned on locally with NEXT_PUBLIC_ONBOARDING_WIZARD=1 in frontend/.env.local.
//
// When OFF, the current /account stacked flow and the current AccountTierChooser
// behavior are completely unchanged. The wizard is purely additive and dark
// until Grant flips this flag (an env action, set the var + redeploy, not a
// code change).
//
// No emojis, no em-dashes, no mid-sentence colons.

export const ONBOARDING_WIZARD_ENABLED =
  process.env.NEXT_PUBLIC_ONBOARDING_WIZARD === "1" ||
  process.env.NEXT_PUBLIC_ONBOARDING_WIZARD === "true";
