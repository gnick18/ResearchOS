// Cross-boundary sharing, portable bundle engine (Phase 0).
//
// Builds and verifies the portable bundle format from section 4 of
// docs/proposals/CROSS_BOUNDARY_SHARING_PROPOSAL.md, an RO-Crate 1.1 JSON-LD
// graph wrapped in a BagIt 1.0 bag, zipped. Integrity is tamper-evident via a
// BagIt SHA-512 payload manifest plus a tag manifest. No network, no
// encryption (that is a separate seam, see encryption.ts), and no dependency
// beyond the existing jszip.
//
// Determinism. Nothing here calls Date.now or Math.random. shareUuid, version,
// and modifiedAt are passed in by the caller so the produced bytes are a pure
// function of the inputs and tests stay reproducible.

import JSZip from "jszip";

/** The artifact kinds a bundle can carry. */
export type EntityType = "note" | "method" | "project";

/** A single attached file (image, PDF, ...). */
export interface BundleAttachment {
  /** File name as it should appear under data/files/. */
  name: string;
  /** Raw file bytes. */
  bytes: Uint8Array;
}

/**
 * The sender's verified identity, sealed INSIDE the bundle so the recipient can
 * attribute a received item to a real person rather than the relay's blind key
 * hash. This is trustworthy because the bundle is sealed to the recipient (only
 * they can decrypt it) and the send is Ed25519-signed by the sender, so a
 * tampered email would fail the bundle's integrity check. The relay never sees
 * these fields, they travel inside the sealed bytes, never to the relay.
 */
export interface BundleSender {
  /** The sender's canonical email, from their sharing identity sidecar. */
  email: string;
  /** The sender's key fingerprint (the grouped safety-check string). */
  fingerprint: string;
}

/** Everything buildBundle needs. The caller owns identity and timestamps. */
export interface BuildBundleInput {
  /**
   * The stable urn:uuid identity of the artifact, minted once when the
   * note/method/project is first created and reused on every re-send. This is
   * the dedup key on import. Passed in, never generated here.
   */
  shareUuid: string;
  /** Monotonic version of this artifact. Higher wins on import. */
  version: number;
  /** ISO 8601 last-modified timestamp of the artifact. */
  modifiedAt: string;
  /** Which kind of artifact this is. */
  entityType: EntityType;
  /** The raw entity record, serialized verbatim into the bundle. */
  entity: object;
  /** Attached files, preserved byte-for-byte. */
  attachments: BundleAttachment[];
  /**
   * The sender's verified identity, embedded so the recipient can show WHO sent
   * the item, not just a relay key hash. Optional and additive, a bundle built
   * before this field still imports (the recipient falls back to the hash).
   */
  sender?: BundleSender;
}

/** The result of reading and verifying a bundle. */
export interface ReadBundleResult {
  /** True only if every payload file recomputed to its manifest SHA-512. */
  valid: boolean;
  shareUuid: string;
  version: number;
  entityType: string;
  entity: object;
  attachments: BundleAttachment[];
  /**
   * The sender's embedded identity, or undefined for a pre-sender bundle (one
   * built before the sender block existed). The caller falls back to the relay
   * key hash for provenance when this is absent.
   */
  sender?: BundleSender;
  /** The parsed ro-crate-metadata.json graph. */
  metadata: object;
}

// The ResearchOS RO-Crate vocabulary namespace. Used to give app-specific
// records a namespaced @type via the @context extension mechanism, so a
// generic RO-Crate consumer still reads the crate while ResearchOS-aware
// tooling recognizes the artifact kind.
const RESEARCHOS_VOCAB = "https://researchos.org/ns/crate#";

const RO_CRATE_CONTEXT = "https://w3id.org/ro/crate/1.1/context";

// The @id of the sender contextual entity in the crate graph. Stable so
// readBundle can recover the sender block by a single lookup.
const SENDER_ID = "#sender";

// Maps an entity type to its RO-Crate vocabulary term.
const VOCAB_TERM: Record<EntityType, string> = {
  note: "Note",
  method: "Method",
  project: "Project",
};

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Lowercase hex SHA-512 of the given bytes, via WebCrypto (no dependency). */
async function sha512Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view so a SharedArrayBuffer-backed
  // input never reaches subtle.digest, and the typing stays a plain ArrayBuffer.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-512", copy.buffer);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i += 1) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * A payload file, named by its path relative to the bag data/ directory. The
 * BagIt manifest lists these as "data/<relPath>".
 */
interface PayloadFile {
  /** Path under data/, for example "entities/note.json" or "files/img.png". */
  relPath: string;
  bytes: Uint8Array;
}

/**
 * Builds the RO-Crate 1.1 JSON-LD graph that describes the artifact and its
 * files. Returns a plain object so the caller can serialize it deterministically.
 */
function buildRoCrateMetadata(input: BuildBundleInput, fileNames: string[]): object {
  const { shareUuid, version, modifiedAt, entityType, sender } = input;

  const entityJsonPath = `entities/${entityType}.json`;
  const artifactId = `#${entityType}-${shareUuid}`;
  const vocabType = `researchos:${VOCAB_TERM[entityType]}`;

  // Every payload file is a part of the root dataset.
  const dataFilePaths = [entityJsonPath, ...fileNames.map((n) => `files/${n}`)];

  // File entities, one per attachment, each pointing back at the artifact.
  const fileEntities = fileNames.map((name) => ({
    "@id": `files/${name}`,
    "@type": "File",
    name,
    isPartOf: { "@id": artifactId },
  }));

  // The entity record itself is also a File in the crate (it is a real file on
  // disk inside the bag), linked from the artifact so a consumer can find the
  // raw record.
  const entityFileEntity = {
    "@id": entityJsonPath,
    "@type": "File",
    name: `${entityType}.json`,
    encodingFormat: "application/json",
    isPartOf: { "@id": artifactId },
  };

  // The contextual entity for the artifact, linking to its record and files.
  // hasPart on the artifact mirrors isPartOf on each file for round-trippable
  // cross-references.
  const artifactEntity = {
    "@id": artifactId,
    "@type": vocabType,
    "researchos:shareUuid": shareUuid,
    "researchos:entityType": entityType,
    version: String(version),
    dateModified: modifiedAt,
    // The raw record plus every attachment belong to this artifact.
    hasPart: dataFilePaths.map((p) => ({ "@id": p })),
    // The sender's verified identity, linked as the artifact's author when a
    // sender block was supplied. Omitted on a pre-sender bundle.
    ...(sender ? { author: { "@id": SENDER_ID } } : {}),
    // TODO(phase>=4): when a bundle is a re-sent update of a prior version,
    // add schema.org isBasedOn here pointing at the prior bundle's artifact
    // (use isBasedOn, NOT isVersionOf, which does not exist on schema.org
    // Dataset). Single-version export for now.
  };

  // The sender contextual entity. A schema.org Person carrying the sender's own
  // verified email plus a namespaced key fingerprint. Lives in the RO-Crate
  // metadata, which is covered by the BagIt tag manifest, so it is tamper-
  // evident along with the rest of the crate. Built only when a sender was
  // supplied, so old (pre-sender) bundles keep their exact byte layout.
  const senderEntity = sender
    ? {
        "@id": SENDER_ID,
        "@type": "Person",
        email: sender.email,
        "researchos:fingerprint": sender.fingerprint,
      }
    : null;

  return {
    "@context": [
      RO_CRATE_CONTEXT,
      {
        researchos: RESEARCHOS_VOCAB,
      },
    ],
    "@graph": [
      // Metadata File Descriptor, required by RO-Crate 1.1.
      {
        "@id": "ro-crate-metadata.json",
        "@type": "CreativeWork",
        conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" },
        about: { "@id": "./" },
      },
      // Root Data Entity.
      {
        "@id": "./",
        "@type": "Dataset",
        name: `ResearchOS ${VOCAB_TERM[entityType]} bundle`,
        version: String(version),
        dateModified: modifiedAt,
        identifier: `urn:uuid:${shareUuid}`,
        hasPart: dataFilePaths.map((p) => ({ "@id": p })),
        mainEntity: { "@id": artifactId },
      },
      // The artifact contextual entity.
      artifactEntity,
      // The raw entity record file.
      entityFileEntity,
      // One File entity per attachment.
      ...fileEntities,
      // The sender contextual entity, only when a sender was supplied.
      ...(senderEntity ? [senderEntity] : []),
    ],
  };
}

/**
 * Builds a portable bundle, an RO-Crate 1.1 crate wrapped in a BagIt bag,
 * zipped. The returned bytes are deterministic for a given input.
 */
export async function buildBundle(input: BuildBundleInput): Promise<Uint8Array> {
  const { shareUuid, modifiedAt, entityType, entity, attachments } = input;

  // 1. Assemble the payload (everything under data/). BagIt requires that the
  //    manifest cover every payload file, so we enumerate first, then write
  //    manifests, then zip (single pass, per the proposal's BagIt trap note).
  const metadataObj = buildRoCrateMetadata(
    input,
    attachments.map((a) => a.name),
  );
  const metadataBytes = utf8(JSON.stringify(metadataObj, null, 2));
  const entityBytes = utf8(JSON.stringify(entity, null, 2));

  const payload: PayloadFile[] = [
    { relPath: "ro-crate-metadata.json", bytes: metadataBytes },
    { relPath: `entities/${entityType}.json`, bytes: entityBytes },
    ...attachments.map((a) => ({ relPath: `files/${a.name}`, bytes: a.bytes })),
  ];

  // 2. Payload manifest, one "<sha512hex>  data/<relPath>" line per file.
  const manifestLines: string[] = [];
  for (const file of payload) {
    const hex = await sha512Hex(file.bytes);
    manifestLines.push(`${hex}  data/${file.relPath}`);
  }
  const manifestText = `${manifestLines.join("\n")}\n`;

  // 3. BagIt tag files.
  const bagitText = "BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n";
  const bagInfoText =
    `External-Identifier: urn:uuid:${shareUuid}\n` +
    `Bag-Software-Agent: ResearchOS portable bundle engine\n` +
    `Payload-Oxum: ${payload.reduce((n, f) => n + f.bytes.byteLength, 0)}.${payload.length}\n`;

  // 4. Tag manifest, covers bag-info.txt and the RO-Crate metadata. (bagit.txt
  //    is excluded by BagIt convention since it declares the bag itself.)
  const tagManifestLines: string[] = [
    `${await sha512Hex(utf8(bagInfoText))}  bag-info.txt`,
    `${await sha512Hex(metadataBytes)}  data/ro-crate-metadata.json`,
  ];
  const tagManifestText = `${tagManifestLines.join("\n")}\n`;

  // 5. Zip with the exact layout. All paths are prefixed with the shareUuid.
  //    A fixed per-entry date keeps the zip bytes deterministic, jszip
  //    otherwise stamps each entry with new Date(). modifiedAt is the
  //    artifact's own clock, reused here so output is a pure function of input.
  const zip = new JSZip();
  const root = shareUuid;
  const date = new Date(modifiedAt);
  const opts = { date };
  zip.file(`${root}/bagit.txt`, bagitText, opts);
  zip.file(`${root}/bag-info.txt`, bagInfoText, opts);
  zip.file(`${root}/manifest-sha512.txt`, manifestText, opts);
  zip.file(`${root}/tagmanifest-sha512.txt`, tagManifestText, opts);
  for (const file of payload) {
    zip.file(`${root}/data/${file.relPath}`, file.bytes, opts);
  }

  return zip.generateAsync({
    type: "uint8array",
    // STORE keeps output a pure function of input (DEFLATE timestamps and
    // implementation details could drift); attachments are usually already
    // compressed images or PDFs anyway.
    compression: "STORE",
  });
}

/** Finds the single top-level bag directory name (the shareUuid) in a zip. */
function findBagRoot(zip: JSZip): string | null {
  const roots = new Set<string>();
  zip.forEach((relativePath) => {
    const top = relativePath.split("/")[0];
    if (top) roots.add(top);
  });
  if (roots.size !== 1) return null;
  return [...roots][0];
}

/** Parses a manifest file's "<hash>  <path>" lines into a path -> hash map. */
function parseManifest(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // Hash and path are separated by two spaces per BagIt, but tolerate any
    // run of whitespace.
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    map.set(match[2], match[1].toLowerCase());
  }
  return map;
}

/**
 * Reads a portable bundle, verifies every payload file against the BagIt
 * SHA-512 manifest, and reconstructs the artifact and attachments. valid is
 * false on any hash mismatch, missing manifest entry, or missing file.
 */
export async function readBundle(zipBytes: Uint8Array): Promise<ReadBundleResult> {
  const zip = await JSZip.loadAsync(zipBytes);

  const root = findBagRoot(zip);
  if (!root) {
    throw new Error("Invalid bundle, expected exactly one top-level bag directory");
  }

  const readText = async (path: string): Promise<string | null> => {
    const f = zip.file(`${root}/${path}`);
    return f ? f.async("string") : null;
  };
  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    const f = zip.file(`${root}/${path}`);
    return f ? f.async("uint8array") : null;
  };

  const manifestText = await readText("manifest-sha512.txt");
  if (manifestText === null) {
    throw new Error("Invalid bundle, missing manifest-sha512.txt");
  }
  const manifest = parseManifest(manifestText);

  const metadataText = await readText("data/ro-crate-metadata.json");
  if (metadataText === null) {
    throw new Error("Invalid bundle, missing ro-crate-metadata.json");
  }
  const metadata = JSON.parse(metadataText) as Record<string, unknown>;

  // Recover shareUuid from bag-info.txt's External-Identifier, the canonical
  // source. The bag directory name should match, but the tag file is the spec.
  const bagInfoText = (await readText("bag-info.txt")) ?? "";
  const idMatch = bagInfoText.match(/External-Identifier:\s*urn:uuid:(\S+)/);
  const shareUuid = idMatch ? idMatch[1] : root;

  // Pull artifact-level facts out of the RO-Crate graph.
  const graph = Array.isArray(metadata["@graph"])
    ? (metadata["@graph"] as Array<Record<string, unknown>>)
    : [];
  const rootEntity = graph.find((n) => n["@id"] === "./");
  const artifactEntity = graph.find(
    (n) => typeof n["@id"] === "string" && (n["@id"] as string).startsWith("#"),
  );
  const version = Number(rootEntity?.version ?? artifactEntity?.version ?? 0);
  const entityType = String(
    artifactEntity?.["researchos:entityType"] ?? "",
  ) as EntityType | "";

  // Recover the sender block, if this bundle carries one. Absent on a pre-sender
  // bundle, in which case sender stays undefined and the caller falls back to
  // the relay key hash for provenance.
  const senderEntity = graph.find((n) => n["@id"] === SENDER_ID);
  let sender: BundleSender | undefined;
  if (senderEntity) {
    const email =
      typeof senderEntity.email === "string" ? senderEntity.email : "";
    const fingerprint =
      typeof senderEntity["researchos:fingerprint"] === "string"
        ? (senderEntity["researchos:fingerprint"] as string)
        : "";
    if (email || fingerprint) {
      sender = { email, fingerprint };
    }
  }

  // Verify every payload file in the manifest. valid stays true only if all
  // present and matching.
  let valid = true;
  for (const [dataPath, expectedHex] of manifest.entries()) {
    // Manifest paths are "data/<relPath>".
    const bytes = await readBytes(dataPath);
    if (bytes === null) {
      valid = false;
      continue;
    }
    const actualHex = await sha512Hex(bytes);
    if (actualHex !== expectedHex) {
      valid = false;
    }
  }

  // Reconstruct the entity record.
  const entityPath = `data/entities/${entityType}.json`;
  const entityText = entityType ? await readText(entityPath) : null;
  const entity = entityText ? (JSON.parse(entityText) as object) : {};

  // Reconstruct attachments from data/files/, in manifest order so output is
  // stable.
  const attachments: BundleAttachment[] = [];
  for (const dataPath of manifest.keys()) {
    if (!dataPath.startsWith("data/files/")) continue;
    const name = dataPath.slice("data/files/".length);
    const bytes = await readBytes(dataPath);
    if (bytes !== null) {
      attachments.push({ name, bytes });
    }
  }

  return {
    valid,
    shareUuid,
    version,
    entityType,
    entity,
    attachments,
    sender,
    metadata,
  };
}
