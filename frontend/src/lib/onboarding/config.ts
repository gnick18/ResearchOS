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

// Onboarding TUTOR feature flag. The LLM-driven guided first-run (Beaker drives
// the real pages with a presenter cursor; a tailored, example-first presentation
// that runs after the setup wizard, account-gated, funded by a capped slice of
// the new-account token gift). Same NEXT_PUBLIC pattern: OFF by default in prod,
// safe to commit and push, turned on locally with NEXT_PUBLIC_ONBOARDING_TUTOR=1.
// When OFF, none of the tutor code mounts and nothing changes. Spec:
// docs/proposals/2026-06-14-llm-onboarding-tutor.md (+ -onboarding-demo-scripts).
export const ONBOARDING_TUTOR_ENABLED =
  process.env.NEXT_PUBLIC_ONBOARDING_TUTOR === "1" ||
  process.env.NEXT_PUBLIC_ONBOARDING_TUTOR === "true";
