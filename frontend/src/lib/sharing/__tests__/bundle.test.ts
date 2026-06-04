// Phase 0 portable bundle engine, round-trip, tamper, and metadata tests.
//
// These run in the node-env vitest project (.test.ts), where WebCrypto's
// crypto.subtle is available, so SHA-512 hashing exercises the real path.

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildBundle, readBundle, type BuildBundleInput } from "../bundle";

// Deterministic fixtures, no Date.now / Math.random anywhere.
const UUID_NOTE = "11111111-1111-4111-8111-111111111111";
const UUID_PROJECT = "22222222-2222-4222-8222-222222222222";
const MODIFIED_AT = "2026-06-03T12:00:00.000Z";

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

const imageA = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02);
const imageB = bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46);
const imageC = bytesOf(0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);

describe("portable bundle engine, round-trip", () => {
  it("recovers a note and two image attachments byte-for-byte", async () => {
    const entity = {
      id: "note-local-7",
      title: "PCR setup",
      body: "Master mix 2x, 25 uL reactions, 30 cycles.",
      tags: ["pcr", "protocol"],
    };
    const input: BuildBundleInput = {
      shareUuid: UUID_NOTE,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity,
      attachments: [
        { name: "gel.png", bytes: imageA },
        { name: "primers.jpg", bytes: imageB },
      ],
    };

    const bytes = await buildBundle(input);
    const result = await readBundle(bytes);

    expect(result.valid).toBe(true);
    expect(result.shareUuid).toBe(UUID_NOTE);
    expect(result.version).toBe(1);
    expect(result.entityType).toBe("note");
    expect(result.entity).toEqual(entity);

    expect(result.attachments).toHaveLength(2);
    const byName = new Map(result.attachments.map((a) => [a.name, a.bytes]));
    expect(Array.from(byName.get("gel.png")!)).toEqual(Array.from(imageA));
    expect(Array.from(byName.get("primers.jpg")!)).toEqual(Array.from(imageB));
  });

  it("is deterministic, identical input yields identical bytes", async () => {
    const input: BuildBundleInput = {
      shareUuid: UUID_NOTE,
      version: 3,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { id: "n", title: "x" },
      attachments: [{ name: "a.png", bytes: imageA }],
    };
    const a = await buildBundle(input);
    const b = await buildBundle(input);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("portable bundle engine, project with three attachments", () => {
  it("round-trips a project entity and all attachments", async () => {
    const entity = {
      id: "project-9",
      name: "Aflatoxin biosynthesis",
      members: ["mira", "alex"],
      createdAt: "2026-01-04T08:00:00.000Z",
    };
    const input: BuildBundleInput = {
      shareUuid: UUID_PROJECT,
      version: 5,
      modifiedAt: MODIFIED_AT,
      entityType: "project",
      entity,
      attachments: [
        { name: "map.png", bytes: imageA },
        { name: "spectrum.jpg", bytes: imageB },
        { name: "plate.bmp", bytes: imageC },
      ],
    };

    const result = await readBundle(await buildBundle(input));

    expect(result.valid).toBe(true);
    expect(result.shareUuid).toBe(UUID_PROJECT);
    expect(result.version).toBe(5);
    expect(result.entityType).toBe("project");
    expect(result.entity).toEqual(entity);
    expect(result.attachments).toHaveLength(3);

    const byName = new Map(result.attachments.map((a) => [a.name, a.bytes]));
    expect(Array.from(byName.get("map.png")!)).toEqual(Array.from(imageA));
    expect(Array.from(byName.get("spectrum.jpg")!)).toEqual(Array.from(imageB));
    expect(Array.from(byName.get("plate.bmp")!)).toEqual(Array.from(imageC));
  });
});

describe("portable bundle engine, tamper detection", () => {
  it("reports valid === false when one payload byte is flipped", async () => {
    const input: BuildBundleInput = {
      shareUuid: UUID_NOTE,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { id: "n1", title: "tamper me" },
      attachments: [{ name: "evidence.png", bytes: imageA }],
    };

    const original = await buildBundle(input);

    // Re-open the zip, flip a byte inside a payload file, re-zip. This mutates
    // the actual file contents (not the manifest), so verification must fail.
    const zip = await JSZip.loadAsync(original);
    const target = `${UUID_NOTE}/data/files/evidence.png`;
    const file = zip.file(target);
    expect(file).not.toBeNull();
    const bytes = await file!.async("uint8array");
    const mutated = new Uint8Array(bytes);
    mutated[0] = mutated[0] ^ 0xff;
    zip.file(target, mutated);
    const tampered = await zip.generateAsync({ type: "uint8array" });

    const result = await readBundle(tampered);
    expect(result.valid).toBe(false);
  });

  it("reports valid === false when a payload file is missing", async () => {
    const input: BuildBundleInput = {
      shareUuid: UUID_NOTE,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { id: "n2", title: "drop a file" },
      attachments: [{ name: "keep.png", bytes: imageA }],
    };

    const original = await buildBundle(input);
    const zip = await JSZip.loadAsync(original);
    zip.remove(`${UUID_NOTE}/data/files/keep.png`);
    const broken = await zip.generateAsync({ type: "uint8array" });

    const result = await readBundle(broken);
    expect(result.valid).toBe(false);
  });
});

describe("portable bundle engine, metadata", () => {
  it("writes RO-Crate and BagIt metadata with the required fields", async () => {
    const input: BuildBundleInput = {
      shareUuid: UUID_NOTE,
      version: 2,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { id: "n3", title: "meta" },
      attachments: [
        { name: "one.png", bytes: imageA },
        { name: "two.jpg", bytes: imageB },
      ],
    };

    const bytes = await buildBundle(input);
    const zip = await JSZip.loadAsync(bytes);

    // External-Identifier in bag-info.txt carries the shareUuid.
    const bagInfo = await zip.file(`${UUID_NOTE}/bag-info.txt`)!.async("string");
    expect(bagInfo).toContain(`External-Identifier: urn:uuid:${UUID_NOTE}`);

    // bagit.txt is the exact required string.
    const bagit = await zip.file(`${UUID_NOTE}/bagit.txt`)!.async("string");
    expect(bagit).toBe(
      "BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n",
    );

    // RO-Crate graph.
    const metaText = await zip
      .file(`${UUID_NOTE}/data/ro-crate-metadata.json`)!
      .async("string");
    const meta = JSON.parse(metaText);

    // @context is the array form, extended with the ResearchOS vocab.
    expect(Array.isArray(meta["@context"])).toBe(true);
    expect(meta["@context"][0]).toBe("https://w3id.org/ro/crate/1.1/context");

    const graph = meta["@graph"] as Array<Record<string, unknown>>;
    const rootEntity = graph.find((n) => n["@id"] === "./")!;
    expect(rootEntity["@type"]).toBe("Dataset");
    expect(rootEntity.version).toBe("2");
    expect(rootEntity.dateModified).toBe(MODIFIED_AT);

    // hasPart lists the entity record plus every attachment file.
    const hasPartIds = (rootEntity.hasPart as Array<{ "@id": string }>).map(
      (p) => p["@id"],
    );
    expect(hasPartIds).toContain("entities/note.json");
    expect(hasPartIds).toContain("files/one.png");
    expect(hasPartIds).toContain("files/two.jpg");

    // A Metadata File Descriptor exists.
    const descriptor = graph.find(
      (n) => n["@id"] === "ro-crate-metadata.json",
    )!;
    expect((descriptor.about as { "@id": string })["@id"]).toBe("./");

    // The artifact contextual entity links back to its files via File
    // entities carrying isPartOf.
    const artifactId = `#note-${UUID_NOTE}`;
    const fileEntity = graph.find((n) => n["@id"] === "files/one.png")!;
    expect(fileEntity["@type"]).toBe("File");
    expect((fileEntity.isPartOf as { "@id": string })["@id"]).toBe(artifactId);
  });
});
