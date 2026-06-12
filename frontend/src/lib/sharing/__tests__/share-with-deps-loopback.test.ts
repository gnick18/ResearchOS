// Phase 6 share-with-dependencies LOOPBACK integration test.
//
// This exercises the full sender -> recipient data path with the only mocked
// boundary being the network relay (a dumb encrypted store-and-forward) and the
// leaf create APIs (real molecule creation needs RDKit wasm and FSA, which do
// not load under vitest; those creates have their own coverage). Everything in
// between runs for real:
//
//   buildBundle (real BagIt zip + RO-Crate metadata)
//     -> sealToRecipient (real x25519 + xchacha20-poly1305)
//     -> [hand off the sealed bytes directly, skipping the HTTP relay]
//     -> openSealed (real decrypt)
//     -> readBundle (real unzip + parse, reconstructs embeddedObjects)
//     -> importEmbeddedObjects (real dispatch: link vs import vs skip)
//
// The point is to prove the pieces COMPOSE: that the embedded objects survive
// the crypto seal and the bag serialization byte-for-byte, and that the recipient
// import then dispatches them correctly. The true two-browser test still covers
// the live relay endpoints, the directory key lookup, and real on-disk writes.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";

import {
  buildBundle,
  readBundle,
  type BundleEmbeddedObject,
  type BuildBundleInput,
} from "@/lib/sharing/bundle";
import { sealToRecipient, openSealed } from "@/lib/sharing/encryption";
import { importEmbeddedObjects } from "@/lib/sharing/embedded-object-import";

// ── Mocks: only the leaf create/resolve boundary ────────────────────────────

vi.mock("@/lib/sharing/portable-identity", () => ({
  resolveByPortableId: vi.fn(),
}));
vi.mock("@/lib/chemistry/api", () => ({
  moleculesApi: { create: vi.fn() },
}));
vi.mock("@/lib/datahub/api", () => ({
  dataHubApi: { create: vi.fn() },
}));
vi.mock("@/lib/local-api", () => ({
  sequencesApi: { create: vi.fn() },
  notesApi: { create: vi.fn() },
  methodsApi: { create: vi.fn() },
  projectsApi: { list: vi.fn(), create: vi.fn() },
  tasksApi: { create: vi.fn() },
}));

import { resolveByPortableId } from "@/lib/sharing/portable-identity";
import { moleculesApi } from "@/lib/chemistry/api";
import { projectsApi } from "@/lib/local-api";

const mockResolve = vi.mocked(resolveByPortableId);
const mockMolCreate = vi.mocked(moleculesApi.create);
const mockProjList = vi.mocked(projectsApi.list);
const mockProjCreate = vi.mocked(projectsApi.create);

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function sameBytes(a: unknown, b: Uint8Array): boolean {
  if (!(a instanceof Uint8Array) || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const MOLFILE = "\n  Mrv2211\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\nM  END\n";

// The objects a sender's note embeds. Two molecules (one the recipient already
// has -> link, one new -> import), an inline project, a Data Hub frozen snapshot
// (-> skip per D8), and a file (-> skip, deferred type).
function senderEmbeddedObjects(): BundleEmbeddedObject[] {
  return [
    {
      type: "molecule",
      portableId: "INCHIKEY-DUP-EXISTS",
      name: "Caffeine",
      href: "/chemistry?molecule=mol-1",
      serialization: "file",
      payloadName: "molecule-1.mol",
      inline: utf8(MOLFILE),
      dataKind: "full",
    },
    {
      type: "molecule",
      portableId: "INCHIKEY-BRAND-NEW",
      name: "Doxorubicin",
      href: "/chemistry?molecule=mol-2",
      serialization: "file",
      payloadName: "molecule-2.mol",
      inline: utf8(MOLFILE + "X"),
      dataKind: "full",
    },
    {
      type: "project",
      portableId: "uuid-project-7",
      name: "Cloning project",
      href: "/projects/7",
      serialization: "inline",
      inline: { name: "Cloning project", color: "#1AA0E6", source_uuid: "uuid-project-7" },
      dataKind: "full",
    },
    {
      type: "datahub",
      portableId: "dh-9",
      name: "qPCR fold-change",
      href: "/datahub?doc=dh-9",
      serialization: "inline",
      inline: { summary: "Two-fold increase, p < 0.01" },
      dataKind: "snapshot",
    },
    {
      type: "file",
      portableId: null,
      name: "gel.png",
      href: "/files/abc",
      serialization: "file",
      payloadName: "file-abc.png",
      inline: utf8("PNGDATA"),
      dataKind: "full",
    },
  ];
}

function senderBundleInput(): BuildBundleInput {
  return {
    shareUuid: "urn:uuid:11111111-1111-1111-1111-111111111111",
    version: 1,
    modifiedAt: "2026-06-12T00:00:00.000Z",
    entityType: "note",
    entity: { id: 1, title: "RNA-seq prep, batch 7", entries: [{ content: "See [Caffeine](/chemistry?molecule=mol-1#ros=card)" }] },
    attachments: [],
    sender: { email: "alice@example.edu", fingerprint: "AAAA BBBB CCCC" },
    embeddedObjects: senderEmbeddedObjects(),
  };
}

describe("share-with-dependencies loopback (build -> seal -> open -> read -> import)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjList.mockResolvedValue([]);
    let n = 0;
    mockProjCreate.mockImplementation(async () => ({ id: 1000 + n++ }) as never);
    // moleculesApi.create returns a molecule DETAIL ({ meta: { id } }).
    mockMolCreate.mockResolvedValue({ meta: { id: "new-mol-id" } } as never);
  });

  it("seals and opens the bundle losslessly", async () => {
    const bundleBytes = await buildBundle(senderBundleInput());
    const recipient = x25519.keygen();
    const sealed = sealToRecipient(bundleBytes, recipient.publicKey);
    const opened = openSealed(sealed, recipient.secretKey);
    expect(sameBytes(opened, bundleBytes)).toBe(true);
  });

  it("carries every embedded object through seal + bag serialization intact", async () => {
    const objs = senderEmbeddedObjects();
    const bundleBytes = await buildBundle(senderBundleInput());
    const recipient = x25519.keygen();
    const opened = openSealed(sealToRecipient(bundleBytes, recipient.publicKey), recipient.secretKey);

    const read = await readBundle(opened);
    expect(read.embeddedObjects).toHaveLength(objs.length);

    const byHref = new Map(read.embeddedObjects.map((o) => [o.href, o]));
    // File-serialized molecule bytes survive byte-for-byte.
    expect(sameBytes(byHref.get("/chemistry?molecule=mol-1")!.inline, utf8(MOLFILE))).toBe(true);
    expect(sameBytes(byHref.get("/chemistry?molecule=mol-2")!.inline, utf8(MOLFILE + "X"))).toBe(true);
    // Inline project metadata + identity survive.
    const proj = byHref.get("/projects/7")!;
    expect(proj.portableId).toBe("uuid-project-7");
    expect((proj.inline as { name: string }).name).toBe("Cloning project");
    // dataKind preserved (drives D8 snapshot handling).
    expect(byHref.get("/datahub?doc=dh-9")!.dataKind).toBe("snapshot");
  });

  it("imports the round-tripped objects: link dup, import new, skip snapshot + file", async () => {
    // The recipient already has the first molecule (D4 dedup), nothing else.
    mockResolve.mockImplementation(async (_type, portableId) =>
      portableId === "INCHIKEY-DUP-EXISTS" ? { id: "local-7" } : null,
    );

    const bundleBytes = await buildBundle(senderBundleInput());
    const recipient = x25519.keygen();
    const opened = openSealed(sealToRecipient(bundleBytes, recipient.publicKey), recipient.secretKey);
    const read = await readBundle(opened);

    const result = await importEmbeddedObjects(read.embeddedObjects, {
      currentUser: "bob",
      senderLabel: "alice@example.edu",
    });

    const r = (href: string) => result.byHref.get(href)!;
    // D4: the molecule the recipient already has is LINKED, no create.
    expect(r("/chemistry?molecule=mol-1").action).toBe("linked");
    expect(r("/chemistry?molecule=mol-1").localId).toBe("local-7");
    // The new molecule is IMPORTED via the real dispatch (create called).
    expect(r("/chemistry?molecule=mol-2").action).toBe("imported");
    expect(mockMolCreate).toHaveBeenCalledTimes(1);
    // The project is imported.
    expect(r("/projects/7").action).toBe("imported");
    // D8: a Data Hub snapshot is skipped (rendered as a frozen card by 6d).
    expect(r("/datahub?doc=dh-9").action).toBe("skipped");
    // The file type is skipped (deferred).
    expect(r("/files/abc").action).toBe("skipped");
    // Every embed is accounted for.
    expect(result.byHref.size).toBe(5);
  });
});
