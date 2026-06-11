// Structure-file parsing for the chemistry library import (Phase 1).
//
// Pure text parsing, no RDKit/DOM, so it is unit tested. Turns an uploaded file
// into a list of structures to add to the library. Supported:
//   .mol            one MDL Molfile (keeps its 2D coords)
//   .sdf            many Molfiles, split on the $$$$ delimiter
//   .smi/.smiles    one SMILES per line, optional name after whitespace
//   .txt            treated as SMILES-per-line
// Unsupported (returns a message, never a silent drop):
//   .cdxml/.cdx     ChemDraw. Binary .cdx has no open reader (OpenBabel is GPL,
//                   incompatible with our AGPL); CDXML is not parsed here. The
//                   honest ask is to export as MOL or SMILES from ChemDraw first.
//
// SMILES entries carry isMolblock=false so the importer normalizes them to a
// Molfile via RDKit before storing; Molfile/SDF entries are kept verbatim to
// preserve their drawn coordinates.

export interface ParsedStructure {
  name: string;
  /** Either a SMILES string or an MDL Molfile, per `isMolblock`. */
  structure: string;
  /** True when `structure` is already a Molfile (preserve as-is on store). */
  isMolblock: boolean;
}

export interface ParseResult {
  structures: ParsedStructure[];
  /** Set when the format is recognized but not importable; show it to the user. */
  unsupported?: string;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

function baseNameOf(filename: string): string {
  const slash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const base = slash >= 0 ? filename.slice(slash + 1) : filename;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base) || "Imported structure";
}

/** Keep the Molfile connection table (through "M  END"), dropping any SDF data tail. */
function molblockOfRecord(record: string): string {
  const i = record.indexOf("M  END");
  return i >= 0 ? `${record.slice(0, i + 6)}\n` : record;
}

/** The first non-empty line of a Molfile is its title; fall back to a default. */
function titleOf(molblock: string, fallback: string): string {
  const first = molblock.split("\n")[0]?.trim() ?? "";
  return first && !first.startsWith("M  END") ? first : fallback;
}

export function parseStructureFile(
  filename: string,
  text: string,
): ParseResult {
  const ext = extensionOf(filename);
  const base = baseNameOf(filename);

  if (ext === "cdxml" || ext === "cdx") {
    return {
      structures: [],
      unsupported:
        "ChemDraw files are not imported directly. Export as MOL or SMILES from ChemDraw first, then import that.",
    };
  }

  if (ext === "mol") {
    if (!text.includes("M  END")) {
      return { structures: [], unsupported: "This .mol file has no valid Molfile block." };
    }
    return {
      structures: [
        { name: titleOf(text, base), structure: text, isMolblock: true },
      ],
    };
  }

  if (ext === "sdf") {
    // Strip ONLY the single leading newline the $$$$ split leaves before records
    // after the first, NOT a full trim: a Molfile's first line is its TITLE and is
    // legitimately blank, so trimming would shift the program/timestamp line into
    // the name ("-OEChem-..."). The first record has no split artifact.
    const records = text
      .split(/\$\$\$\$/)
      .map((r, i) => (i === 0 ? r : r.replace(/^\r?\n/, "")))
      .filter((r) => r.includes("M  END"));
    const structures = records.map((record, i) => {
      const molblock = molblockOfRecord(record);
      return {
        name: titleOf(molblock, records.length > 1 ? `${base} ${i + 1}` : base),
        structure: molblock,
        isMolblock: true,
      };
    });
    if (!structures.length) {
      return { structures: [], unsupported: "No Molfile records found in this .sdf." };
    }
    return { structures };
  }

  if (ext === "smi" || ext === "smiles" || ext === "txt" || ext === "") {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const structures: ParsedStructure[] = [];
    for (const line of lines) {
      const sp = line.search(/\s/);
      const smiles = sp >= 0 ? line.slice(0, sp) : line;
      const rest = sp >= 0 ? line.slice(sp).trim() : "";
      if (!smiles) continue;
      structures.push({
        name:
          rest ||
          (lines.length > 1 ? `${base} ${structures.length + 1}` : base),
        structure: smiles,
        isMolblock: false,
      });
    }
    if (!structures.length) {
      return { structures: [], unsupported: "No SMILES found in this file." };
    }
    return { structures };
  }

  return {
    structures: [],
    unsupported: `.${ext} is not a supported structure format. Use .mol, .sdf, .smi, or .smiles.`,
  };
}
