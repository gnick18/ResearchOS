// Unit tests for the external embed metadata cache read/write layer.
// Mocks fileService to avoid disk I/O. Tests are pure logic.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the fileService module before importing the module under test.
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(),
    writeJson: vi.fn(),
  },
}));

import { fileService } from "@/lib/file-system/file-service";
import {
  getExternalCache,
  putExternalCache,
  removeExternalCache,
} from "./external-cache";
import type { CiteCache, LinkCache } from "./external-cache";

const readJson = fileService.readJson as ReturnType<typeof vi.fn>;
const writeJson = fileService.writeJson as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  writeJson.mockResolvedValue(undefined);
});

const SIDECAR = "users/alice/notes/1.ros-embeds.json";
const DOI_URL = "https://doi.org/10.1021/jacs.1c00001";

const CITE_ENTRY: CiteCache = {
  kind: "cite",
  title: "A Great Paper",
  authors: "Smith A, Jones B",
  journal: "JACS",
  year: "2021",
  doi: "10.1021/jacs.1c00001",
  url: "https://europepmc.org/article/MED/12345678",
  cachedAt: "2026-06-12T00:00:00Z",
};

describe("getExternalCache", () => {
  it("returns null when sidecar is missing (null from readJson)", async () => {
    readJson.mockResolvedValue(null);
    const result = await getExternalCache(SIDECAR, DOI_URL);
    expect(result).toBeNull();
  });

  it("returns null when the sidecar has no external section", async () => {
    readJson.mockResolvedValue({ version: 1, pins: {} });
    expect(await getExternalCache(SIDECAR, DOI_URL)).toBeNull();
  });

  it("returns null when the URL is not in the external section", async () => {
    readJson.mockResolvedValue({
      version: 1,
      pins: {},
      external: { "https://other.com": CITE_ENTRY },
    });
    expect(await getExternalCache(SIDECAR, DOI_URL)).toBeNull();
  });

  it("returns the cached entry when present", async () => {
    readJson.mockResolvedValue({
      version: 1,
      external: { [DOI_URL]: CITE_ENTRY },
    });
    const result = await getExternalCache(SIDECAR, DOI_URL);
    expect(result).toEqual(CITE_ENTRY);
  });

  it("returns null when the entry lacks a `kind` field", async () => {
    readJson.mockResolvedValue({
      external: { [DOI_URL]: { title: "broken" } },
    });
    expect(await getExternalCache(SIDECAR, DOI_URL)).toBeNull();
  });

  it("returns null for empty sidecarPath", async () => {
    expect(await getExternalCache("", DOI_URL)).toBeNull();
  });

  it("returns null on readJson throw", async () => {
    readJson.mockRejectedValue(new Error("disk error"));
    expect(await getExternalCache(SIDECAR, DOI_URL)).toBeNull();
  });
});

describe("putExternalCache", () => {
  it("writes the entry into the sidecar, merging with existing content", async () => {
    const existingSidecar = {
      version: 1,
      pins: { s_abc: { pinnedAt: "2026-01-01" } },
      external: { "https://other.com": { kind: "link", title: "Other", domain: "other.com", faviconUrl: null, cachedAt: "2026-01-01" } },
    };
    readJson.mockResolvedValue(existingSidecar);

    await putExternalCache(SIDECAR, DOI_URL, CITE_ENTRY);

    const written = writeJson.mock.calls[0][1] as Record<string, unknown>;
    expect(written.version).toBe(1);
    // Existing pins preserved.
    expect((written.pins as Record<string, unknown>)["s_abc"]).toBeTruthy();
    // Existing external entry preserved.
    const ext = written.external as Record<string, unknown>;
    expect(ext["https://other.com"]).toBeTruthy();
    // New entry added.
    expect(ext[DOI_URL]).toEqual(CITE_ENTRY);
  });

  it("creates the external section when the sidecar has none", async () => {
    readJson.mockResolvedValue({ version: 1, pins: {} });

    await putExternalCache(SIDECAR, DOI_URL, CITE_ENTRY);

    const written = writeJson.mock.calls[0][1] as { external: Record<string, unknown> };
    expect(written.external[DOI_URL]).toEqual(CITE_ENTRY);
  });

  it("handles a missing sidecar (null from readJson) by creating a new file", async () => {
    readJson.mockResolvedValue(null);
    await putExternalCache(SIDECAR, DOI_URL, CITE_ENTRY);
    const written = writeJson.mock.calls[0][1] as { external: Record<string, unknown> };
    expect(written.external[DOI_URL]).toEqual(CITE_ENTRY);
  });

  it("silently ignores writeJson errors", async () => {
    readJson.mockResolvedValue(null);
    writeJson.mockRejectedValue(new Error("disk full"));
    await expect(putExternalCache(SIDECAR, DOI_URL, CITE_ENTRY)).resolves.toBeUndefined();
  });

  it("is a no-op when sidecarPath is empty", async () => {
    await putExternalCache("", DOI_URL, CITE_ENTRY);
    expect(writeJson).not.toHaveBeenCalled();
  });
});

describe("removeExternalCache", () => {
  it("removes the entry, leaving others intact", async () => {
    const linkEntry: LinkCache = {
      kind: "link",
      title: "Other",
      domain: "other.com",
      faviconUrl: null,
      cachedAt: "2026-01-01",
    };
    readJson.mockResolvedValue({
      version: 1,
      external: { [DOI_URL]: CITE_ENTRY, "https://other.com": linkEntry },
    });

    await removeExternalCache(SIDECAR, DOI_URL);

    const written = writeJson.mock.calls[0][1] as { external: Record<string, unknown> };
    expect(written.external[DOI_URL]).toBeUndefined();
    expect(written.external["https://other.com"]).toEqual(linkEntry);
  });

  it("is a no-op when the URL is not present", async () => {
    readJson.mockResolvedValue({ version: 1, external: {} });
    await removeExternalCache(SIDECAR, DOI_URL);
    expect(writeJson).not.toHaveBeenCalled();
  });

  it("is a no-op when sidecar is missing", async () => {
    readJson.mockResolvedValue(null);
    await removeExternalCache(SIDECAR, DOI_URL);
    expect(writeJson).not.toHaveBeenCalled();
  });
});
