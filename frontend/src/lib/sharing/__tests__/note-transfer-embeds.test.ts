// Tests for Phase 6c href rewrite in importNoteBundle.
//
// These supplement the existing note-transfer.test.ts (the back-compat guard).
// They focus on: embed hrefs rewritten to local ids for imported/linked items,
// skipped hrefs left unchanged, and a passing ReceiveShareResult type check.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  importNoteBundle,
} from "@/lib/sharing/note-transfer";
import type { ReadBundleResult } from "@/lib/sharing/bundle";
import type { Note } from "@/lib/types";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/attachments/image-folder", () => ({
  listImagesInFolder: vi.fn(),
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readFileAsBlob: vi.fn(),
    writeFileFromBlob: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
  },
}));

vi.mock("@/lib/local-api", () => ({
  notesApi: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/sharing/identity/sidecar", () => ({
  readSharingIdentity: vi.fn(),
}));

// Mock the collect side (sender path) to avoid needing full local-api in tests
// that only exercise the import (recipient) path.
vi.mock("@/lib/sharing/embedded-object-collect", () => ({
  collectEmbeddedObjects: vi.fn().mockResolvedValue({ objects: [], skipCount: 0, deferredTypes: [] }),
}));

vi.mock("@/lib/sharing/note-dependencies", () => ({
  scanNoteDependencies: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/sequences/find", () => ({
  seqIdentity: vi.fn(),
}));

vi.mock("@/lib/chemistry/molecule-store", () => ({
  moleculeStore: { listMetaForUser: vi.fn().mockResolvedValue([]) },
}));

// Mock importEmbeddedObjects so we control exactly what resolutions come back.
vi.mock("@/lib/sharing/embedded-object-import", () => ({
  importEmbeddedObjects: vi.fn(),
}));

import { fileService } from "@/lib/file-system/file-service";
import { notesApi } from "@/lib/local-api";
import { importEmbeddedObjects } from "@/lib/sharing/embedded-object-import";
import type { EmbeddedImportResult, EmbedResolution } from "@/lib/sharing/embedded-object-import";

const mockNotesCreate = vi.mocked(notesApi.create);
const mockReadJson = vi.mocked(fileService.readJson);
const mockWriteJson = vi.mocked(fileService.writeJson);
const mockImportEmbeddedObjects = vi.mocked(importEmbeddedObjects);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 7,
    title: "Test note",
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [],
    comments: [],
    flagged: null,
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
    username: "Recipient",
    shared_with: [],
    ...overrides,
  };
}

function makeBundle(
  entryContent: string,
  embeddedObjects: ReadBundleResult["embeddedObjects"] = [],
): ReadBundleResult {
  return {
    valid: true,
    shareUuid: "uuid-6c",
    version: 1,
    entityType: "note",
    entity: {
      title: "Embed test note",
      description: "",
      is_running_log: false,
      entries: [
        { title: "Body", date: "2026-06-12", content: entryContent },
      ],
    },
    attachments: [],
    embeddedObjects,
    metadata: {},
  };
}

function makeImportResult(
  resolutions: Array<{
    href: string;
    action: "linked" | "imported" | "skipped";
    localType: "molecule" | "sequence" | "datahub";
    localId: string | null;
    portableId: string | null;
    name: string;
    skipReason?: string;
  }>,
): EmbeddedImportResult {
  const typed = resolutions as EmbedResolution[];
  const byHref = new Map<string, EmbedResolution>();
  for (const r of typed) {
    byHref.set(r.href, r);
  }
  return { resolutions: typed, byHref };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteJson.mockResolvedValue(undefined);
});

// ── Href rewrite tests ────────────────────────────────────────────────────────

describe("importNoteBundle Phase 6c href rewrite", () => {
  it("rewrites an imported molecule embed href to the recipient's local id", async () => {
    const originalHref = "/chemistry?molecule=mol-sender-42";
    const entryContent = `[Ethanol](${originalHref}#ros=card)`;

    const noteBase = makeNote({ id: 7, entries: [
      { id: "e1", title: "Body", date: "2026-06-12", content: entryContent, created_at: "x", updated_at: "y" },
    ]});

    mockNotesCreate.mockResolvedValue(noteBase);
    mockReadJson.mockResolvedValue(noteBase);

    // importEmbeddedObjects reports this as "imported" with a new local id.
    mockImportEmbeddedObjects.mockResolvedValue(
      makeImportResult([
        {
          href: originalHref,
          action: "imported",
          localType: "molecule",
          localId: "mol-77",
          portableId: "INCHIKEY-ETHANOL",
          name: "Ethanol",
        },
      ]),
    );

    const bundle = makeBundle(entryContent, [
      {
        type: "molecule",
        portableId: "INCHIKEY-ETHANOL",
        name: "Ethanol",
        href: originalHref,
        serialization: "file",
        payloadName: "molecule-42.mol",
        inline: utf8("molfile"),
        dataKind: "full",
      },
    ]);

    await importNoteBundle(bundle, {
      currentUser: "Recipient",
      senderEmail: "sender@lab.edu",
      senderFingerprint: "FP",
    });

    expect(mockWriteJson).toHaveBeenCalledTimes(1);
    const [, writtenRecord] = mockWriteJson.mock.calls[0] as [string, Note];
    const writtenContent = writtenRecord.entries?.[0]?.content ?? "";

    // The href must now point at the recipient's local molecule id mol-77.
    expect(writtenContent).toContain("/chemistry?molecule=mol-77");
    // The original sender href must be gone.
    expect(writtenContent).not.toContain("mol-sender-42");
    // The portable id ref= is preserved.
    expect(writtenContent).toContain("ref=INCHIKEY-ETHANOL");
    // The view (card) is preserved.
    expect(writtenContent).toContain("ros=card");
  });

  it("rewrites a linked embed href (same as imported, just with the resolved id)", async () => {
    const originalHref = "/chemistry?molecule=mol-remote-99";
    const entryContent = `[Aspirin](${originalHref}#ros=card)`;

    const noteBase = makeNote({ id: 7, entries: [
      { id: "e1", title: "Body", date: "2026-06-12", content: entryContent, created_at: "x", updated_at: "y" },
    ]});
    mockNotesCreate.mockResolvedValue(noteBase);
    mockReadJson.mockResolvedValue(noteBase);

    mockImportEmbeddedObjects.mockResolvedValue(
      makeImportResult([
        {
          href: originalHref,
          action: "linked",
          localType: "molecule",
          localId: "mol-local-3",
          portableId: "INCHIKEY-ASPIRIN",
          name: "Aspirin",
        },
      ]),
    );

    const bundle = makeBundle(entryContent, [
      {
        type: "molecule",
        portableId: "INCHIKEY-ASPIRIN",
        name: "Aspirin",
        href: originalHref,
        serialization: "file",
        payloadName: "molecule-99.mol",
        inline: utf8("molfile"),
        dataKind: "full",
      },
    ]);

    await importNoteBundle(bundle, {
      currentUser: "Recipient",
      senderEmail: "sender@lab.edu",
      senderFingerprint: "FP",
    });

    const [, writtenRecord] = mockWriteJson.mock.calls[0] as [string, Note];
    const writtenContent = writtenRecord.entries?.[0]?.content ?? "";
    expect(writtenContent).toContain("/chemistry?molecule=mol-local-3");
    expect(writtenContent).not.toContain("mol-remote-99");
  });

  it("leaves skipped embed hrefs unchanged (placeholder rendered in Phase 6d)", async () => {
    const originalHref = "/datahub?doc=dh-snap-1";
    const entryContent = `[My dataset](${originalHref}#ros=table)`;

    const noteBase = makeNote({ id: 7, entries: [
      { id: "e1", title: "Body", date: "2026-06-12", content: entryContent, created_at: "x", updated_at: "y" },
    ]});
    mockNotesCreate.mockResolvedValue(noteBase);
    mockReadJson.mockResolvedValue(noteBase);

    mockImportEmbeddedObjects.mockResolvedValue(
      makeImportResult([
        {
          href: originalHref,
          action: "skipped",
          localType: "datahub",
          localId: null,
          portableId: "dh-uuid-snap",
          name: "My dataset",
          skipReason: "datahub snapshot",
        },
      ]),
    );

    const bundle = makeBundle(entryContent, [
      {
        type: "datahub",
        portableId: "dh-uuid-snap",
        name: "My dataset",
        href: originalHref,
        serialization: "inline",
        inline: { snapshot: "...", docName: "My dataset" },
        dataKind: "snapshot",
      },
    ]);

    await importNoteBundle(bundle, {
      currentUser: "Recipient",
      senderEmail: "sender@lab.edu",
      senderFingerprint: "FP",
    });

    const [, writtenRecord] = mockWriteJson.mock.calls[0] as [string, Note];
    const writtenContent = writtenRecord.entries?.[0]?.content ?? "";
    // The original href must be preserved exactly.
    expect(writtenContent).toContain(originalHref);
    expect(writtenContent).toBe(entryContent);
  });

  it("does not call importEmbeddedObjects when embeddedObjects is empty", async () => {
    const entryContent = "No embeds here.";
    const noteBase = makeNote({ id: 7, entries: [
      { id: "e1", title: "Body", date: "2026-06-12", content: entryContent, created_at: "x", updated_at: "y" },
    ]});
    mockNotesCreate.mockResolvedValue(noteBase);
    mockReadJson.mockResolvedValue(noteBase);

    const bundle = makeBundle(entryContent, []);

    await importNoteBundle(bundle, {
      currentUser: "Recipient",
      senderEmail: "sender@lab.edu",
      senderFingerprint: "FP",
    });

    expect(mockImportEmbeddedObjects).not.toHaveBeenCalled();

    const [, writtenRecord] = mockWriteJson.mock.calls[0] as [string, Note];
    expect(writtenRecord.entries?.[0]?.content).toBe(entryContent);
  });
});
