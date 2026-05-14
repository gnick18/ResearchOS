// frontend/src/lib/import/eln/detect-changed-pages.test.ts
//
// Pins the contract of `detectChangedPages` — the wizard's pre-apply scan
// that finds pages whose LabArchives content has drifted since the user's
// previous import of the same notebook. Used by the Preview step to surface
// the "Overwrite N changed pages?" prompt.
//
// Detection signals (cheapest first):
//   1. Entry count differs from the on-disk sidecar's `entryCount`.
//   2. The page's latest `entries[].updatedAt` is strictly after the
//      sidecar's `imported_at`.
//
// A page whose dedupKey isn't on disk yet (fresh import) is NOT returned —
// those are reported only via the existing "tasksCreated" path.

import { describe, expect, it } from "vitest";
import { detectChangedPages } from "./apply";
import type { ELNApplyFileService } from "./apply";
import type {
  ELNImportSidecar,
  MissingInlineImage,
  ParsedEntry,
  ParsedNotebook,
  ParsedPage,
} from "./types";

interface FsRecord {
  type: "json" | "blob";
  data: unknown;
}

/** Build a minimal in-memory fileService that satisfies the
 *  ELNApplyFileService contract for the scan path. */
function makeFs(seed: Map<string, FsRecord>): ELNApplyFileService {
  const dirs = new Set<string>();
  for (const path of seed.keys()) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  return {
    async fileExists(path) {
      return seed.has(path);
    },
    async writeFileFromBlob() {},
    async writeJson() {},
    async readJson<T>(path: string): Promise<T | null> {
      const rec = seed.get(path);
      if (!rec || rec.type !== "json") return null;
      return rec.data as T;
    },
    async listDirectories(dirPath: string) {
      const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
      const out = new Set<string>();
      for (const d of dirs) {
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first) out.add(first);
      }
      return Array.from(out);
    },
  };
}

function makeEntry(overrides: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    entryId: "e1",
    dedupKey: "nb/p1/Entry/e1",
    type: "text",
    rawTypeNumber: 1,
    author: "Test User",
    updatedAt: "2026-04-01T12:00:00Z",
    bodyMarkdown: "body",
    attachments: [],
    missingInlineImages: [] as MissingInlineImage[],
    tags: [],
    ...overrides,
  };
}

function makePage(overrides: Partial<ParsedPage> = {}): ParsedPage {
  return {
    pageId: "p1",
    pageFile: "p1.html",
    treePath: ["Notebook", "Folder", "Page One"],
    pageCreator: null,
    pageCreatedAt: null,
    pageDedupRaw: "stable-dedup-key-1",
    notebookId: "nb",
    entries: [makeEntry()],
    ...overrides,
  };
}

function makeParsed(pages: ParsedPage[]): ParsedNotebook {
  return {
    source: "labarchives-offline-zip",
    notebookName: "Test Notebook",
    rootBreadcrumb: ["Notebooks"],
    exportedBy: null,
    exportedAt: null,
    tree: [],
    pages,
    missingInlineImages: [],
  };
}

function makeSidecar(overrides: Partial<ELNImportSidecar> = {}): ELNImportSidecar {
  return {
    source: "labarchives-offline-zip",
    imported_at: "2026-03-15T10:00:00Z",
    imported_by: "alex",
    dedupKey: "stable-dedup-key-1",
    notebookName: "Test Notebook",
    treePath: ["Notebook", "Folder", "Page One"],
    pageId: "p1",
    entryCount: 1,
    missingInlineImages: [],
    ...overrides,
  };
}

describe("detectChangedPages", () => {
  it("returns empty when the receiver has no prior imports", async () => {
    const fs = makeFs(new Map());
    const parsed = makeParsed([makePage()]);
    const out = await detectChangedPages(parsed, "alex", fs);
    expect(out).toEqual([]);
  });

  it("returns empty for a fresh-import page (no matching sidecar)", async () => {
    // A different task on disk, with a different dedupKey.
    const seed = new Map<string, FsRecord>([
      [
        "users/alex/results/task-99/notes/_import_source.json",
        { type: "json", data: makeSidecar({ dedupKey: "different-key" }) },
      ],
    ]);
    const fs = makeFs(seed);
    const parsed = makeParsed([makePage()]);
    const out = await detectChangedPages(parsed, "alex", fs);
    expect(out).toEqual([]);
  });

  it("returns empty when entries are unchanged since last import", async () => {
    // updatedAt earlier than imported_at => stable.
    const seed = new Map<string, FsRecord>([
      [
        "users/alex/results/task-5/notes/_import_source.json",
        { type: "json", data: makeSidecar({ imported_at: "2026-05-01T00:00:00Z" }) },
      ],
    ]);
    const fs = makeFs(seed);
    const parsed = makeParsed([
      makePage({
        entries: [makeEntry({ updatedAt: "2026-04-01T12:00:00Z" })],
      }),
    ]);
    const out = await detectChangedPages(parsed, "alex", fs);
    expect(out).toEqual([]);
  });

  it("flags a page whose entry was updated after last import", async () => {
    const seed = new Map<string, FsRecord>([
      [
        "users/alex/results/task-5/notes/_import_source.json",
        { type: "json", data: makeSidecar({ imported_at: "2026-03-15T10:00:00Z" }) },
      ],
    ]);
    const fs = makeFs(seed);
    const parsed = makeParsed([
      makePage({
        entries: [makeEntry({ updatedAt: "2026-04-01T12:00:00Z" })],
      }),
    ]);
    const out = await detectChangedPages(parsed, "alex", fs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      pageId: "p1",
      pageName: "Page One",
      dedupKey: "stable-dedup-key-1",
      existingTaskId: 5,
      reason: "entry-updated",
      currentEntryCount: 1,
      previousEntryCount: 1,
    });
  });

  it("flags a page whose entry count changed", async () => {
    const seed = new Map<string, FsRecord>([
      [
        "users/alex/results/task-5/notes/_import_source.json",
        { type: "json", data: makeSidecar({ entryCount: 2 }) },
      ],
    ]);
    const fs = makeFs(seed);
    const parsed = makeParsed([
      makePage({
        entries: [makeEntry()], // only 1 entry now, sidecar said 2
      }),
    ]);
    const out = await detectChangedPages(parsed, "alex", fs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      reason: "entry-count-changed",
      currentEntryCount: 1,
      previousEntryCount: 2,
    });
  });

  it("ignores stale sidecars whose entryCount is 0 (older format)", async () => {
    // Pre-2026-05 sidecars didn't populate entryCount. Treat 0 as "unknown"
    // rather than "definitely changed."
    const seed = new Map<string, FsRecord>([
      [
        "users/alex/results/task-5/notes/_import_source.json",
        { type: "json", data: makeSidecar({ entryCount: 0 }) },
      ],
    ]);
    const fs = makeFs(seed);
    const parsed = makeParsed([
      makePage({
        // Entries with updatedAt < imported_at, so the only signal would be
        // entry-count (which we deliberately suppress for 0).
        entries: [makeEntry({ updatedAt: "2026-01-01T00:00:00Z" })],
      }),
    ]);
    const out = await detectChangedPages(parsed, "alex", fs);
    expect(out).toEqual([]);
  });

  it("returns multiple changed pages in input order", async () => {
    const seed = new Map<string, FsRecord>([
      [
        "users/alex/results/task-5/notes/_import_source.json",
        {
          type: "json",
          data: makeSidecar({
            dedupKey: "key-a",
            pageId: "pA",
            imported_at: "2026-03-01T00:00:00Z",
          }),
        },
      ],
      [
        "users/alex/results/task-7/notes/_import_source.json",
        {
          type: "json",
          data: makeSidecar({
            dedupKey: "key-b",
            pageId: "pB",
            imported_at: "2026-03-01T00:00:00Z",
            entryCount: 5,
          }),
        },
      ],
    ]);
    const fs = makeFs(seed);
    const parsed = makeParsed([
      makePage({
        pageId: "pA",
        pageDedupRaw: "key-a",
        entries: [makeEntry({ updatedAt: "2026-04-01T00:00:00Z" })],
      }),
      makePage({
        pageId: "pB",
        pageDedupRaw: "key-b",
        treePath: ["Page Two"],
        entries: [makeEntry({ entryId: "e2" })], // 1 entry, sidecar said 5
      }),
    ]);
    const out = await detectChangedPages(parsed, "alex", fs);
    expect(out).toHaveLength(2);
    expect(out[0].existingTaskId).toBe(5);
    expect(out[0].reason).toBe("entry-updated");
    expect(out[1].existingTaskId).toBe(7);
    expect(out[1].reason).toBe("entry-count-changed");
  });
});
