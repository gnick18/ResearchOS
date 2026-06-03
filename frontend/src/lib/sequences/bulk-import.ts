// bulk import bot — pure helpers for folder-pick + drag-and-drop bulk import.
// The directory-entry recursion that needs the DOM File API lives in the
// component; everything here is pure + unit-tested. The kept files funnel
// through the EXISTING import loop (handleImport / importSequenceFile), so this
// module only decides WHICH files to keep, never how they are parsed.

import { extensionOf } from "./import";

/** Importable extensions, lowercased without the dot. Single source of truth —
 *  matches the hidden file input's `accept` list. webkitdirectory + drag-drop
 *  hand us EVERY file in a folder (accept is ignored for those), so we filter
 *  with this in code. */
export const IMPORTABLE_EXTENSIONS = [
  "gb",
  "gbk",
  "genbank",
  "ape",
  "fasta",
  "fa",
  "fna",
  "ffn",
  "faa",
  "frn",
  "seq",
  "dna",
  "prot",
] as const;

/** The same list as a comma-prefixed `accept=".gb,.gbk,..."` string. */
export const IMPORT_ACCEPT_ATTR = IMPORTABLE_EXTENSIONS.map((e) => `.${e}`).join(",");

const IMPORTABLE_SET: ReadonlySet<string> = new Set(IMPORTABLE_EXTENSIONS);

/** True when a file name carries an importable sequence extension
 *  (case-insensitive). Folders / .txt / .pdf / .png etc. are dropped. */
export function isImportableSequenceFile(fileName: string): boolean {
  return IMPORTABLE_SET.has(extensionOf(fileName));
}

/** Split a gathered list of files into the ones we will import and the count
 *  of skipped (non-sequence) files. Preserves input order. Used by BOTH the
 *  folder pick and the drag-drop path before funneling into the import loop. */
export function partitionImportableFiles<T extends { name: string }>(
  files: readonly T[],
): { kept: T[]; skipped: number } {
  const kept: T[] = [];
  let skipped = 0;
  for (const f of files) {
    if (isImportableSequenceFile(f.name)) kept.push(f);
    else skipped += 1;
  }
  return { kept, skipped };
}

/** Build the post-import status line, reporting any skipped non-sequence files.
 *  `imported` = sequences successfully created; `skipped` = files dropped by the
 *  extension filter. Used by both bulk paths so the wording stays consistent. */
export function importStatusText(imported: number, skipped: number): string {
  const noun = imported === 1 ? "sequence" : "sequences";
  const base = `Imported ${imported} ${noun}`;
  if (skipped <= 0) return `${base}.`;
  const fileNoun = skipped === 1 ? "file" : "files";
  return `${base} (skipped ${skipped} non-sequence ${fileNoun}).`;
}
