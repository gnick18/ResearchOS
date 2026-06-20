// Badges v1 feature flag.
//
// Same NEXT_PUBLIC env pattern as NEXT_PUBLIC_LAB_AS_FOLDER. OFF by default in
// prod (env unset), safe to commit and push, turned on locally with
// NEXT_PUBLIC_BADGES_ENABLED=1 in frontend/.env.local.
//
// When OFF, NO badge UI renders anywhere and the build is byte-identical to
// today (every badge surface is gated on this constant).
//
// No emojis, no em-dashes, no mid-sentence colons.

export const BADGES_ENABLED =
  process.env.NEXT_PUBLIC_BADGES_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_BADGES_ENABLED === "true";
