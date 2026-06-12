// Phase 6b-1 bundle extension: embedded objects round-trip and back-compat tests.
//
// Tests the BundleEmbeddedObject extension to the portable bundle engine:
//   - File-serialized objects (e.g. molfile bytes) round-trip via objects/ in the bag.
//   - Inline-serialized objects round-trip via the RO-Crate metadata.
//   - A bundle with no embeddedObjects reads back as [] (back-compat).
//   - The BagIt SHA manifest covers every objects/ file (bag validity).
//
// House voice: no em-dashes, no emojis, no mid-sentence colons.

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  buildBundle,
  readBundle,
  type BuildBundleInput,
  type BundleEmbeddedObject,
} from "../bundle";

// Deterministic fixtures.
const UUID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MODIFIED_AT = "2026-06-12T10:00:00.000Z";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// A minimal file-serialized BundleEmbeddedObject (molecule molfile).
function makeMolEmbed(payloadBytes: Uint8Array): BundleEmbeddedObject {
  return {
    type: "molecule",
    portableId: "BSYNRYMUTXBXSQ-UHFFFAOYSA-N",
    name: "Aspirin",
    href: "/chemistry?molecule=mol-1#ros=view",
    serialization: "file",
    payloadName: "molecule-mol-1.mol",
    inline: payloadBytes,
    dataKind: "full",
  };
}

// A minimal inline-serialized BundleEmbeddedObject (project metadata).
function makeProjectEmbed(): BundleEmbeddedObject {
  return {
    type: "project",
    portableId: "src-uuid-project-123",
    name: "Aflatoxin study",
    href: "/projects/5#ros=view",
    serialization: "inline",
    inline: { name: "Aflatoxin study", color: "#84cc16", source_uuid: "src-uuid-project-123" },
    dataKind: "full",
  };
}

describe("bundle embedded objects, round-trip", () => {
  it("file-serialized object round-trips bytes and metadata faithfully", async () => {
    const molBytes = utf8("\n  Ketcher\n\n  2  1  0  0  0\n  C   0.000   0.000   0.000\n");
    const molEmbed = makeMolEmbed(molBytes);

    const input: BuildBundleInput = {
      shareUuid: UUID,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { title: "Test note" },
      attachments: [],
      embeddedObjects: [molEmbed],
    };

    const zipBytes = await buildBundle(input);
    const result = await readBundle(zipBytes);

    expect(result.valid).toBe(true);
    expect(result.embeddedObjects).toHaveLength(1);

    const recovered = result.embeddedObjects[0];
    expect(recovered.type).toBe("molecule");
    expect(recovered.portableId).toBe("BSYNRYMUTXBXSQ-UHFFFAOYSA-N");
    expect(recovered.name).toBe("Aspirin");
    expect(recovered.href).toBe("/chemistry?molecule=mol-1#ros=view");
    expect(recovered.serialization).toBe("file");
    expect(recovered.payloadName).toBe("molecule-mol-1.mol");
    expect(recovered.dataKind).toBe("full");

    // Bytes must round-trip exactly.
    expect(recovered.inline).toBeInstanceOf(Uint8Array);
    expect(Array.from(recovered.inline as Uint8Array)).toEqual(Array.from(molBytes));
  });

  it("inline-serialized object round-trips metadata faithfully", async () => {
    const projectEmbed = makeProjectEmbed();

    const input: BuildBundleInput = {
      shareUuid: UUID,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { title: "Note with project" },
      attachments: [],
      embeddedObjects: [projectEmbed],
    };

    const result = await readBundle(await buildBundle(input));

    expect(result.valid).toBe(true);
    expect(result.embeddedObjects).toHaveLength(1);

    const recovered = result.embeddedObjects[0];
    expect(recovered.type).toBe("project");
    expect(recovered.portableId).toBe("src-uuid-project-123");
    expect(recovered.serialization).toBe("inline");
    expect(recovered.dataKind).toBe("full");
    expect(recovered.inline).toEqual({
      name: "Aflatoxin study",
      color: "#84cc16",
      source_uuid: "src-uuid-project-123",
    });
  });

  it("mixed file and inline embedded objects both round-trip in one bundle", async () => {
    const molBytes = utf8("molfile content");
    const input: BuildBundleInput = {
      shareUuid: UUID,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { title: "Mixed embeds" },
      attachments: [],
      embeddedObjects: [makeMolEmbed(molBytes), makeProjectEmbed()],
    };

    const result = await readBundle(await buildBundle(input));

    expect(result.valid).toBe(true);
    expect(result.embeddedObjects).toHaveLength(2);

    const mol = result.embeddedObjects.find((o) => o.type === "molecule")!;
    const proj = result.embeddedObjects.find((o) => o.type === "project")!;

    expect(mol).toBeDefined();
    expect(proj).toBeDefined();
    expect(Array.from(mol.inline as Uint8Array)).toEqual(Array.from(molBytes));
    expect((proj.inline as { name: string }).name).toBe("Aflatoxin study");
  });

  it("embeddedObjects is [] when no embeds are present (back-compat with older bundles)", async () => {
    // A bundle built with no embeddedObjects field should read back as [].
    const input: BuildBundleInput = {
      shareUuid: UUID,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { title: "Pre-6b note" },
      attachments: [],
      // no embeddedObjects field at all
    };

    const result = await readBundle(await buildBundle(input));

    expect(result.valid).toBe(true);
    expect(result.embeddedObjects).toEqual([]);
  });

  it("embeddedObjects is [] when explicitly passed as empty array", async () => {
    const input: BuildBundleInput = {
      shareUuid: UUID,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { title: "Empty embeds" },
      attachments: [],
      embeddedObjects: [],
    };

    const result = await readBundle(await buildBundle(input));

    expect(result.valid).toBe(true);
    expect(result.embeddedObjects).toEqual([]);
  });

  it("snapshot dataKind round-trips (Data Hub default)", async () => {
    const snapshotBytes = utf8("# Data Hub: t-test results\n\nP < 0.05 (significant)\n");
    const dataHubEmbed: BundleEmbeddedObject = {
      type: "datahub",
      portableId: "dh-doc-id-456",
      name: "t-test results",
      href: "/datahub?doc=dh-456#ros=view&view=result",
      serialization: "file",
      payloadName: "datahub-snapshot-dh-456.txt",
      inline: snapshotBytes,
      dataKind: "snapshot",
    };

    const input: BuildBundleInput = {
      shareUuid: UUID,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { title: "Note with DH" },
      attachments: [],
      embeddedObjects: [dataHubEmbed],
    };

    const result = await readBundle(await buildBundle(input));

    expect(result.valid).toBe(true);
    expect(result.embeddedObjects[0].dataKind).toBe("snapshot");
    expect(result.embeddedObjects[0].type).toBe("datahub");
    expect(result.embeddedObjects[0].portableId).toBe("dh-doc-id-456");
    expect(Array.from(result.embeddedObjects[0].inline as Uint8Array)).toEqual(
      Array.from(snapshotBytes),
    );
  });
});

describe("bundle embedded objects, BagIt manifest coverage", () => {
  it("objects/ files appear in the manifest and are hash-verified", async () => {
    const molBytes = utf8("V2000 molfile\n");
    const input: BuildBundleInput = {
      shareUuid: UUID,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { title: "manifest test" },
      attachments: [],
      embeddedObjects: [makeMolEmbed(molBytes)],
    };

    const zipBytes = await buildBundle(input);

    // Parse the raw zip and inspect the manifest directly.
    const zip = await JSZip.loadAsync(zipBytes);
    const manifestText = await zip.file(`${UUID}/manifest-sha512.txt`)!.async("string");

    // The manifest must include the objects/ file.
    expect(manifestText).toContain("data/objects/molecule-mol-1.mol");

    // Verify the actual file exists in the zip at the expected path.
    const objectFile = zip.file(`${UUID}/data/objects/molecule-mol-1.mol`);
    expect(objectFile).not.toBeNull();
    const recoveredBytes = await objectFile!.async("uint8array");
    expect(Array.from(recoveredBytes)).toEqual(Array.from(molBytes));

    // The bundle's own valid check must pass (all hashes verified).
    const result = await readBundle(zipBytes);
    expect(result.valid).toBe(true);
  });

  it("tampered objects/ file causes valid === false", async () => {
    const molBytes = utf8("original molfile bytes");
    const input: BuildBundleInput = {
      shareUuid: UUID,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { title: "tamper test" },
      attachments: [],
      embeddedObjects: [makeMolEmbed(molBytes)],
    };

    const zipBytes = await buildBundle(input);
    const zip = await JSZip.loadAsync(zipBytes);

    // Flip bytes in the objects/ file.
    const target = `${UUID}/data/objects/molecule-mol-1.mol`;
    const original = await zip.file(target)!.async("uint8array");
    const mutated = new Uint8Array(original);
    mutated[0] = mutated[0] ^ 0xff;
    zip.file(target, mutated);

    const tampered = await zip.generateAsync({ type: "uint8array" });
    const result = await readBundle(tampered);
    expect(result.valid).toBe(false);
  });

  it("existing attachments and new objects/ files coexist in the manifest", async () => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const molBytes = utf8("molfile");

    const input: BuildBundleInput = {
      shareUuid: UUID,
      version: 1,
      modifiedAt: MODIFIED_AT,
      entityType: "note",
      entity: { title: "coexist" },
      attachments: [{ name: "gel.png", bytes: imageBytes }],
      embeddedObjects: [makeMolEmbed(molBytes)],
    };

    const zipBytes = await buildBundle(input);
    const zip = await JSZip.loadAsync(zipBytes);
    const manifestText = await zip.file(`${UUID}/manifest-sha512.txt`)!.async("string");

    expect(manifestText).toContain("data/files/gel.png");
    expect(manifestText).toContain("data/objects/molecule-mol-1.mol");

    const result = await readBundle(zipBytes);
    expect(result.valid).toBe(true);
    expect(result.attachments).toHaveLength(1);
    expect(result.embeddedObjects).toHaveLength(1);
  });
});
