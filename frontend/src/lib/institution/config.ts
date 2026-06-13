// Institution tier feature flag. Same NEXT_PUBLIC env pattern as DEPT_TIER_ENABLED:
// OFF by default (dark in prod), turned on locally with
// NEXT_PUBLIC_INSTITUTION_TIER_ENABLED=1 in frontend/.env.local. Independent of
// the dept flag so the two tiers can launch on their own cadence.
//
// No emojis, no em-dashes, no mid-sentence colons.

export const INSTITUTION_TIER_ENABLED =
  process.env.NEXT_PUBLIC_INSTITUTION_TIER_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_INSTITUTION_TIER_ENABLED === "true";
