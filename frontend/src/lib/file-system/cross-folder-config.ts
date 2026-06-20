// Cross-folder operations flag (Strategy A, two-handle copy).
//
// This gates the all-users ability to copy an object from the active folder
// into ANOTHER folder the same account already remembers, by writing through a
// SECOND FileService instance bound to the destination handle while the module
// singleton stays on the source. It is deliberately its OWN flag.
//
// CRITICAL (design addendum H7): cross-folder is an all-users feature and must
// NEVER be gated behind the class-mode flag. The two are independent. Reading
// the class-mode flag here would wrongly tie a general capability to a
// classroom-only one, so this file imports nothing from class-mode config.
//
// Off by default. Set NEXT_PUBLIC_CROSS_FOLDER=1 (or "true") to enable.
export const CROSS_FOLDER_ENABLED =
  process.env.NEXT_PUBLIC_CROSS_FOLDER === "1" ||
  process.env.NEXT_PUBLIC_CROSS_FOLDER === "true";
