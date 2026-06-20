// Class Mode (CM-P1) feature flag (a class IS a lab IS a folder).
//
// Locked model (Grant 2026-06-19): a class is a TEACHING folder a lab head owns,
// separate and contained from their research lab. Structurally a class IS a lab
// (its own labId + team key, instructor = head, student = member), provisioned as
// an app-managed OPFS folder exactly like a member folder. The data spine and the
// class-folder provisioner live behind THIS flag.
//
// This is its OWN, third flag (see design addendum H7, three flags not one stack):
//   - NEXT_PUBLIC_LAB_AS_FOLDER (live) owns the multi-folder registry + switcher.
//   - NEXT_PUBLIC_CROSS_FOLDER (separate) owns the cross-folder destination writer
//     and the share-dialog tab. NEVER entangle class mode with cross-folder.
//   - NEXT_PUBLIC_CLASS_MODE (this one) owns ONLY teaching chrome, the class-folder
//     provisioner, and classConfig. Cross-folder is an all-users feature and must
//     not sit behind this flag.
//
// Class Mode STACKS ABOVE lab-as-folder: a class folder is a managed OPFS folder,
// which is the lab-as-folder mechanism. This flag gates only the class-specific
// writers on top of that foundation.
//
// Same NEXT_PUBLIC env pattern as NEXT_PUBLIC_LAB_AS_FOLDER. OFF by default in prod
// (env unset), safe to commit and push, turned on locally with
// NEXT_PUBLIC_CLASS_MODE=1 in frontend/.env.local.
//
// When OFF, behavior is BYTE-IDENTICAL to today: no class folder is ever
// provisioned, no class identity is written, and the readers (folderLabLabel,
// FolderSwitcher, the settings normalizer) default any class-shaped value to its
// solo-equivalent so a class row authored elsewhere still renders cleanly.
//
// No emojis, no em-dashes, no mid-sentence colons.

export const CLASS_MODE_ENABLED =
  process.env.NEXT_PUBLIC_CLASS_MODE === "1" ||
  process.env.NEXT_PUBLIC_CLASS_MODE === "true";
