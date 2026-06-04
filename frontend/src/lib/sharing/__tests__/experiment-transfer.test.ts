// Tests for the experiment transfer adapter's payload helpers.
//
// buildExperimentSendPayload is exercised through the real export pipeline in
// the existing export tests, so here we pin the two new pieces of logic the
// inbox dispatch depends on,
//   - sniffSharePayload, which decides note vs experiment vs unknown from the
//     decrypted bytes alone (the relay records no entity type).
//   - experimentPayloadToFile, which wraps decrypted bytes as a .zip File the
//     existing ImportExperimentDialog can drive.

import { describe, it, expect } from "vitest";
import JSZip from "jszip";

import {
  sniffSharePayload,
  experimentPayloadToFile,
} from "@/lib/sharing/experiment-transfer";
import { buildBundle } from "@/lib/sharing/bundle";

async function makeExperimentZip(): Promise<Uint8Array> {
  // The minimum the sniffer keys on, a top-level _export-manifest.json, the
  // exact marker export/raw.ts writes for a researchos-experiment bundle.
  const zip = new JSZip();
  zip.file(
    "_export-manifest.json",
    JSON.stringify({ format: "researchos-experiment", version: 1 }),
  );
  zip.file("task.json", JSON.stringify({ id: 1, name: "Western blot" }));
  return zip.generateAsync({ type: "uint8array" });
}

async function makeNoteBundle(): Promise<Uint8Array> {
  // A real RO-Crate-in-BagIt note bundle from the production engine, so the
  // sniffer is tested against the actual note format, not a hand-rolled stub.
  return buildBundle({
    shareUuid: "11111111-1111-4111-8111-111111111111",
    version: 1,
    modifiedAt: "2026-06-04T00:00:00.000Z",
    entityType: "note",
    entity: { title: "A note", entries: [] },
    attachments: [],
  });
}

describe("sniffSharePayload", () => {
  it("classifies a researchos-experiment export zip as 'experiment'", async () => {
    const bytes = await makeExperimentZip();
    expect(await sniffSharePayload(bytes)).toBe("experiment");
  });

  it("classifies a real RO-Crate note bundle as 'note'", async () => {
    const bytes = await makeNoteBundle();
    expect(await sniffSharePayload(bytes)).toBe("note");
  });

  it("never confuses a note bundle for an experiment (no _export-manifest.json)", async () => {
    const bytes = await makeNoteBundle();
    expect(await sniffSharePayload(bytes)).not.toBe("experiment");
  });

  it("returns 'unknown' for non-zip bytes", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    expect(await sniffSharePayload(garbage)).toBe("unknown");
  });

  it("returns 'unknown' for a zip with neither marker", async () => {
    const zip = new JSZip();
    zip.file("random.txt", "hello");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(await sniffSharePayload(bytes)).toBe("unknown");
  });
});

describe("experimentPayloadToFile", () => {
  it("wraps bytes as a .zip File preserving the content", async () => {
    const bytes = await makeExperimentZip();
    const file = experimentPayloadToFile(bytes, "my-experiment");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("my-experiment-raw.zip");
    expect(file.type).toBe("application/zip");
    const roundTrip = new Uint8Array(await file.arrayBuffer());
    expect(roundTrip.length).toBe(bytes.length);
    // The wrapped File must still sniff as an experiment, the inbox feeds it
    // straight into the import dialog.
    expect(await sniffSharePayload(roundTrip)).toBe("experiment");
  });

  it("uses a default base name when none is given", () => {
    const file = experimentPayloadToFile(new Uint8Array([0]));
    expect(file.name).toBe("shared-experiment-raw.zip");
  });
});
