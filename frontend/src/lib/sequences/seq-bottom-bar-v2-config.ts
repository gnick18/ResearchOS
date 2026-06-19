// seq-bottom-bar bot — Feature flag for the consolidated single-row bottom
// bar in the sequence editor. When ON, the three stacked rows (Display strip +
// coordinate cluster + tab spine) collapse into ONE slim bar. When OFF, the
// editor renders the legacy three-row layout byte-identical to before.
//
// Toggle locally: NEXT_PUBLIC_SEQ_BOTTOM_BAR_V2=1 in frontend/.env.local
// Same NEXT_PUBLIC env pattern as NEXT_PUBLIC_LAB_AS_FOLDER and
// NEXT_PUBLIC_SINGLE_USER_FOLDERS — checked against "1" or "true".
// Default: OFF (the legacy layout is shown).

export const SEQ_BOTTOM_BAR_V2 =
  process.env.NEXT_PUBLIC_SEQ_BOTTOM_BAR_V2 === "1" ||
  process.env.NEXT_PUBLIC_SEQ_BOTTOM_BAR_V2 === "true";
