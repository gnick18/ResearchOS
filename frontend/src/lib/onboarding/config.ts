// Onboarding feature flag (the ONE intertwined first-run flow).
//
// The stepped account-setup WIZARD (the 3-track shell that replaces the stacked
// /account page) and the LLM-driven TOUR (Beaker drives the real pages and greets
// you by the name + role you gave the wizard) are a SINGLE flow, not two, so they
// gate together under one env var: NEXT_PUBLIC_ONBOARDING. The wizard collects who
// you are, then the tour personalizes off those answers, so shipping one without
// the other makes no sense.
//
// Same NEXT_PUBLIC pattern as LAB_TIER_ENABLED / DEPT_TIER_ENABLED: OFF by default
// in prod (env unset), safe to commit and push, turned on locally with
// NEXT_PUBLIC_ONBOARDING=1 in frontend/.env.local. When OFF, the current /account
// stacked flow + AccountTierChooser are unchanged and NONE of the tour mounts;
// the whole flow is purely additive and dark until Grant flips this one flag.
//
// The two legacy vars (NEXT_PUBLIC_ONBOARDING_WIZARD / _TUTOR) are still honored as
// aliases so any existing .env.local / Vercel setup keeps working; either one now
// turns on the WHOLE flow, since they are intertwined.
//
// Spec: docs/proposals/2026-06-14-onboarding-wizard.md (setup) +
// docs/proposals/2026-06-14-llm-onboarding-tutor.md (tour).
//
// No emojis, no em-dashes, no mid-sentence colons.

function flagOn(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

/** The single onboarding flow flag: the wizard and the tour together. */
export const ONBOARDING_ENABLED =
  flagOn(process.env.NEXT_PUBLIC_ONBOARDING) ||
  // Legacy aliases, honored so existing setups do not break. Either one enables
  // the whole intertwined flow now.
  flagOn(process.env.NEXT_PUBLIC_ONBOARDING_WIZARD) ||
  flagOn(process.env.NEXT_PUBLIC_ONBOARDING_TUTOR);

// Kept as named exports so every existing consumer (providers, AccountTierChooser,
// FolderConnectGate, the wizard shell, OnboardingTutor, tour-gate, ...) keeps
// working unchanged. They now both resolve to the single flow flag above.
export const ONBOARDING_WIZARD_ENABLED = ONBOARDING_ENABLED;
export const ONBOARDING_TUTOR_ENABLED = ONBOARDING_ENABLED;
