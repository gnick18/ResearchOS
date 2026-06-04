// Tests for the verified-sender attribution stamp on the export-zip share tiers
// (experiment / method / project).
//
//   - stampExperimentSender / stampProjectSender inject the sender block into
//     the right manifest, leaving every other entry intact, and round-trip back
//     out via readManifestSenderFromPayload.
//   - A bundle with NO sender (a plain local export) stays sender-free, both
//     stampers are a no-op when sender is undefined, and the reader returns
//     undefined (backward-compatible, the inbox falls back to the relay hash).
//   - A partial / malformed sender block is ignored (graceful), and malformed
//     bytes never throw.

import { describe, it, expect } from "vitest";
import JSZip from "jszip";

import {
  stampExperimentSender,
  stampProjectSender,
  readManifestSenderFromPayload,
} from "@/lib/sharing/sender-stamp";
import type { ManifestSender } from "@/lib/export/types";
import { PROJECT_MANIFEST_FILE } from "@/lib/export/project-bundle";

const SENDER: ManifestSender = {
  email: "alex@lab.example",
  fingerprint: "ABCD 1234 EF56 7890",
};

/** A minimal researchos-experiment bundle (manifest + a couple sibling entries
 *  so we can assert the re-stamp leaves non-manifest files intact). */
async function makeExperimentZip(
  manifestExtra: Record<string, unknown> = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "_export-manifest.json",
    JSON.stringify({
      format: "researchos-experiment",
      version: 2,
      exported_at: "2026-06-04T00:00:00.000Z",
      exported_by: "ResearchOS",
      source_owner: "alex",
      task_id: 12,
      task_key: "alex/12",
      project_id: 1,
      method_ids: [],
      ...manifestExtra,
    }),
  );
  zip.file("task.json", JSON.stringify({ id: 12, name: "An experiment" }));
  zip.file("project.json", JSON.stringify({ id: 1, name: "A project" }));
  return zip.generateAsync({ type: "uint8array" });
}

/** A minimal researchos-project bundle. */
async function makeProjectZip(
  manifestExtra: Record<string, unknown> = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    PROJECT_MANIFEST_FILE,
    JSON.stringify({
      format: "researchos-project",
      version: 1,
      kind: "project",
      exported_at: "2026-06-04T00:00:00.000Z",
      exported_by: "ResearchOS",
      source_owner: "alex",
      project_id: 1,
      project_name: "A project",
      experiments: [],
      dependency_ids: [],
      counts: { experiments: 0, dependencies: 0 },
      ...manifestExtra,
    }),
  );
  zip.file("experiments/exp-raw.zip", "inner bundle bytes");
  return zip.generateAsync({ type: "uint8array" });
}

describe("stampExperimentSender", () => {
  it("round-trips the sender through the experiment manifest", async () => {
    const stamped = await stampExperimentSender(await makeExperimentZip(), SENDER);
    expect(await readManifestSenderFromPayload(stamped)).toEqual(SENDER);
  });

  it("preserves the other manifest fields and sibling entries", async () => {
    const stamped = await stampExperimentSender(await makeExperimentZip(), SENDER);
    const zip = await JSZip.loadAsync(stamped);
    const manifest = JSON.parse(
      await zip.file("_export-manifest.json")!.async("string"),
    );
    expect(manifest.task_id).toBe(12);
    expect(manifest.source_owner).toBe("alex");
    expect(manifest.sender).toEqual(SENDER);
    // Sibling files survive the re-stamp untouched.
    expect(await zip.file("task.json")!.async("string")).toContain(
      "An experiment",
    );
  });

  it("is a no-op when there is no sender (local export stays sender-free)", async () => {
    const bytes = await makeExperimentZip();
    const out = await stampExperimentSender(bytes, undefined);
    // Same reference back, no zip round-trip.
    expect(out).toBe(bytes);
    expect(await readManifestSenderFromPayload(out)).toBeUndefined();
  });

  it("also stamps a method-kind bundle (same envelope)", async () => {
    const methodZip = await makeExperimentZip({ kind: "method" });
    const stamped = await stampExperimentSender(methodZip, SENDER);
    const zip = await JSZip.loadAsync(stamped);
    const manifest = JSON.parse(
      await zip.file("_export-manifest.json")!.async("string"),
    );
    expect(manifest.kind).toBe("method");
    expect(manifest.sender).toEqual(SENDER);
  });
});

describe("stampProjectSender", () => {
  it("round-trips the sender through the project manifest", async () => {
    const stamped = await stampProjectSender(await makeProjectZip(), SENDER);
    expect(await readManifestSenderFromPayload(stamped)).toEqual(SENDER);
  });

  it("preserves the project manifest fields and nested experiments", async () => {
    const stamped = await stampProjectSender(await makeProjectZip(), SENDER);
    const zip = await JSZip.loadAsync(stamped);
    const manifest = JSON.parse(
      await zip.file(PROJECT_MANIFEST_FILE)!.async("string"),
    );
    expect(manifest.project_name).toBe("A project");
    expect(manifest.sender).toEqual(SENDER);
    expect(zip.file("experiments/exp-raw.zip")).not.toBeNull();
  });

  it("is a no-op when there is no sender", async () => {
    const bytes = await makeProjectZip();
    const out = await stampProjectSender(bytes, undefined);
    expect(out).toBe(bytes);
    expect(await readManifestSenderFromPayload(out)).toBeUndefined();
  });
});

describe("readManifestSenderFromPayload (backward-compat + safety)", () => {
  it("returns undefined for a pre-attribution experiment bundle", async () => {
    expect(
      await readManifestSenderFromPayload(await makeExperimentZip()),
    ).toBeUndefined();
  });

  it("returns undefined for a pre-attribution project bundle", async () => {
    expect(
      await readManifestSenderFromPayload(await makeProjectZip()),
    ).toBeUndefined();
  });

  it("ignores a malformed (emailless) sender block", async () => {
    const zip = await makeExperimentZip({ sender: { fingerprint: "X" } });
    expect(await readManifestSenderFromPayload(zip)).toBeUndefined();
  });

  it("ignores an empty-email sender block", async () => {
    const zip = await makeExperimentZip({ sender: { email: "   ", fingerprint: "X" } });
    expect(await readManifestSenderFromPayload(zip)).toBeUndefined();
  });

  it("does not throw on non-zip bytes", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    expect(await readManifestSenderFromPayload(garbage)).toBeUndefined();
  });
});
