// VCP R1 trash MVP notes (2026-05-26): public barrel for the trash
// subsystem. Consumers should import from "@/lib/trash" rather than
// digging into individual files.

export * from "./trash-types";
export * from "./trash-paths";
export * from "./trash-settings";
export {
  ALL_ENTITY_TYPES,
  readTrashIndex,
  readOrRebuildTrashIndex,
  buildTrashIndexFromDisk,
  appendIndexEntry,
  removeIndexEntry,
  setLastCleanupAt,
} from "./trash-index";
export { trashEntity, computeAutoExpiresAt } from "./trash-writer";
export type { TrashWriteArgs } from "./trash-writer";
export {
  listTrash,
  readTrashedEntity,
  restoreEntity,
  restoreSequenceFromTrash,
  restoreMoleculeFromTrash,
  permanentlyDelete,
  runAutoCleanupPass,
  sortTrashEntries,
} from "./trash-reader";
export { SEQUENCE_GENBANK_FIELD, MOLECULE_MOLFILE_FIELD } from "./trash-writer";
export type { CleanupSummary, TrashSort } from "./trash-reader";
export {
  migrateLegacyNotesTrashForUser,
  migrateLegacyNotesTrashAllUsers,
} from "./migrate-notes-trash";
