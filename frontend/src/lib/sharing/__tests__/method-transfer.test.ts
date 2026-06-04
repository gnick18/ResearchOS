// Tests for the standalone-method transfer adapter (cross-boundary sharing,
// methods tier). Pins the two pieces of new logic,
//   - buildMethodSendPayload, which produces a researchos-experiment-shaped zip
//     carrying ONE method, marked `kind: "method"`, and throws for a compound.
//   - the method sniff classification, that sniffSharePayload reads the manifest
//     `kind` field and returns "method" for a method bundle while an experiment
//     bundle (no kind) stays "experiment".
//
// The export pipeline's file/protocol reads are mocked at the extract +
// local-api seams so the adapter's contract is tested in isolation, the real
// per-type protocol fetch is already covered by the export suite.

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

import type { Method } from "@/lib/types";
import type { MethodPayload } from "@/lib/export/types";

// Mock the local-api so importing method-transfer (which pulls the api object
// for the export deps) does not drag in the file-system layer.
vi.mock("@/lib/local-api", () => ({
  projectsApi: {},
  methodsApi: {},
  filesApi: {},
  dependenciesApi: {},
}));

// Mock the extract slice: the adapter only needs the per-method package back.
// Spied per-test so the markdown / null / read-failure shapes are exercised.
const buildStandaloneMethodPackage = vi.fn();
vi.mock("@/lib/export/extract", () => ({
  buildStandaloneMethodPackage: (...args: unknown[]) =>
    buildStandaloneMethodPackage(...args),
}));

import {
  buildMethodSendPayload,
  methodPayloadToFile,
  CompoundMethodNotSupportedError,
} from "@/lib/sharing/method-transfer";
import { sniffSharePayload } from "@/lib/sharing/experiment-transfer";

function makeMethod(overrides: Partial<Method> = {}): Method {
  return {
    id: 11,
    name: "Western blot",
    source_path: "methods/western-blot/western-blot.md",
    method_type: "markdown",
    folder_path: "Molecular Biology",
    parent_method_id: null,
    tags: ["wb"],
    is_public: false,
    created_by: "alex",
    owner: "alex",
    shared_with: [],
    ...overrides,
  };
}

function makeMethodPackage(method: Method): MethodPayload {
  return {
    method,
    bodyMarkdown: "## Western blot\n\n1. Lyse cells.",
    attachment: null,
    pcrProtocol: null,
    lcGradientProtocol: null,
    plateProtocol: null,
    cellCultureSchedule: null,
    massSpecProtocol: null,
    codingWorkflow: null,
    qpcrAnalysisProtocol: null,
  };
}

describe("buildMethodSendPayload", () => {
  beforeEach(() => {
    buildStandaloneMethodPackage.mockReset();
  });

  it("produces a researchos-experiment zip carrying the one method, marked kind: 'method'", async () => {
    const method = makeMethod();
    buildStandaloneMethodPackage.mockResolvedValue({
      payload: makeMethodPackage(method),
      pdfAttachment: null,
    });

    const bytes = await buildMethodSendPayload(method, "alex");
    const zip = await JSZip.loadAsync(bytes);

    // Manifest exists, is the experiment envelope, and carries the method marker.
    const manifestEntry = zip.file("_export-manifest.json");
    expect(manifestEntry).not.toBeNull();
    const manifest = JSON.parse(await manifestEntry!.async("string"));
    expect(manifest.format).toBe("researchos-experiment");
    expect(manifest.kind).toBe("method");
    expect(manifest.method_ids).toEqual([method.id]);

    // The method record + body ride along under the same methods/ layout the
    // experiment export uses, so the unchanged importer reads them.
    expect(zip.file(`methods/method-${method.id}.json`)).not.toBeNull();
    expect(zip.file(`methods/method-${method.id}-body.md`)).not.toBeNull();
  });

  it("sniffs its own output as 'method', not 'experiment'", async () => {
    const method = makeMethod();
    buildStandaloneMethodPackage.mockResolvedValue({
      payload: makeMethodPackage(method),
      pdfAttachment: null,
    });
    const bytes = await buildMethodSendPayload(method, "alex");
    expect(await sniffSharePayload(bytes)).toBe("method");
  });

  it("throws CompoundMethodNotSupportedError for a compound method (deferred)", async () => {
    const method = makeMethod({ method_type: "compound", components: [] });
    await expect(buildMethodSendPayload(method, "alex")).rejects.toBeInstanceOf(
      CompoundMethodNotSupportedError,
    );
    // The package builder is never called for a compound, the guard fires first.
    expect(buildStandaloneMethodPackage).not.toHaveBeenCalled();
  });

  it("throws when the method record could not be read", async () => {
    const method = makeMethod();
    buildStandaloneMethodPackage.mockResolvedValue(null);
    await expect(buildMethodSendPayload(method, "alex")).rejects.toThrow();
  });
});

describe("method sniff classification", () => {
  it("returns 'experiment' for an envelope WITHOUT the method marker", async () => {
    const zip = new JSZip();
    zip.file(
      "_export-manifest.json",
      JSON.stringify({ format: "researchos-experiment", version: 2 }),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(await sniffSharePayload(bytes)).toBe("experiment");
  });

  it("returns 'method' for an envelope marked kind: 'method'", async () => {
    const zip = new JSZip();
    zip.file(
      "_export-manifest.json",
      JSON.stringify({
        format: "researchos-experiment",
        version: 2,
        kind: "method",
      }),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(await sniffSharePayload(bytes)).toBe("method");
  });
});

describe("methodPayloadToFile", () => {
  it("wraps bytes as a .zip File preserving the content", async () => {
    const zip = new JSZip();
    zip.file(
      "_export-manifest.json",
      JSON.stringify({
        format: "researchos-experiment",
        version: 2,
        kind: "method",
      }),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const file = methodPayloadToFile(bytes, "my-method");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("my-method-raw.zip");
    expect(file.type).toBe("application/zip");
    const roundTrip = new Uint8Array(await file.arrayBuffer());
    expect(await sniffSharePayload(roundTrip)).toBe("method");
  });

  it("uses a default base name when none is given", () => {
    const file = methodPayloadToFile(new Uint8Array([0]));
    expect(file.name).toBe("shared-method-raw.zip");
  });
});
