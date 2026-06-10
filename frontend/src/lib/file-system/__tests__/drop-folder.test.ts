// Coverage for the drop-event → FileSystemDirectoryHandle extractor used
// by the "Link a folder" drop zone in FolderConnectGate.tsx.
//
// The DataTransferItemList that drop events deliver is impossible to
// construct directly in a test env (it's an interface, not a class), so
// these tests build duck-typed mock items and feed them through the
// extractor. We cover all five DropExtractionResult branches:
//   1. ok          — single folder, getAsFileSystemHandle present
//   2. not-a-folder — single file
//   3. multiple-items — two items
//   4. no-items    — empty list
//   5. unsupported — no getAsFileSystemHandle, only webkitGetAsEntry
//
// Plus the describeDropExtractionError mapping so user-facing copy stays
// in sync with the kinds.

import { describe, expect, it } from "vitest";
import {
  describeDropExtractionError,
  extractDirectoryHandleFromDrop,
} from "../drop-folder";

// Build a DataTransferItemList-shaped object from an array of items.
// length + indexed access + Symbol.iterator are the only surface our
// extractor touches.
function makeList(items: object[]): DataTransferItemList {
  const list = Object.create(null);
  list.length = items.length;
  items.forEach((it, i) => (list[i] = it));
  list[Symbol.iterator] = function* () {
    for (let i = 0; i < items.length; i += 1) yield items[i];
  };
  return list as DataTransferItemList;
}

function makeFolderItem(name = "labbook") {
  const handle = {
    kind: "directory" as const,
    name,
  } as unknown as FileSystemDirectoryHandle;
  return {
    kind: "file" as const,
    type: "",
    getAsFileSystemHandle: async () => handle,
    webkitGetAsEntry: () => ({ isDirectory: true, isFile: false, name }),
  };
}

function makeFileItem(name = "notes.txt") {
  const handle = {
    kind: "file" as const,
    name,
  } as unknown as FileSystemHandle;
  return {
    kind: "file" as const,
    type: "text/plain",
    getAsFileSystemHandle: async () => handle,
    webkitGetAsEntry: () => ({ isDirectory: false, isFile: true, name }),
  };
}

describe("extractDirectoryHandleFromDrop", () => {
  it("returns ok with the directory handle when a single folder is dropped", async () => {
    const list = makeList([makeFolderItem("smithlab-data")]);
    const result = await extractDirectoryHandleFromDrop(list);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.handle.kind).toBe("directory");
      expect(result.handle.name).toBe("smithlab-data");
    }
  });

  it("returns not-a-folder when a single file is dropped", async () => {
    const list = makeList([makeFileItem()]);
    const result = await extractDirectoryHandleFromDrop(list);
    expect(result.kind).toBe("not-a-folder");
  });

  it("returns multiple-items when more than one item is dropped", async () => {
    const list = makeList([makeFolderItem("a"), makeFolderItem("b")]);
    const result = await extractDirectoryHandleFromDrop(list);
    expect(result.kind).toBe("multiple-items");
  });

  it("returns no-items when the list is empty", async () => {
    const list = makeList([]);
    const result = await extractDirectoryHandleFromDrop(list);
    expect(result.kind).toBe("no-items");
  });

  it("returns unsupported when only webkitGetAsEntry is available on a folder", async () => {
    // Strip getAsFileSystemHandle to simulate non-Chromium environment.
    const item = makeFolderItem("legacy-folder") as Partial<ReturnType<typeof makeFolderItem>>;
    delete item.getAsFileSystemHandle;
    const list = makeList([item]);
    const result = await extractDirectoryHandleFromDrop(list);
    expect(result.kind).toBe("unsupported");
  });

  it("returns not-a-folder when getAsFileSystemHandle resolves to null", async () => {
    const list = makeList([
      {
        kind: "file" as const,
        type: "",
        getAsFileSystemHandle: async () => null,
      },
    ]);
    const result = await extractDirectoryHandleFromDrop(list);
    expect(result.kind).toBe("not-a-folder");
  });

  it("returns error when getAsFileSystemHandle rejects", async () => {
    const list = makeList([
      {
        kind: "file" as const,
        type: "",
        getAsFileSystemHandle: async () => {
          throw new Error("simulated chrome failure");
        },
      },
    ]);
    const result = await extractDirectoryHandleFromDrop(list);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("simulated chrome failure");
    }
  });
});

describe("describeDropExtractionError", () => {
  it("renders the file-not-folder message for a file drop", () => {
    expect(describeDropExtractionError("not-a-folder")).toBe(
      "That's a file. Drop a folder instead.",
    );
  });

  it("renders the multi-item message", () => {
    expect(describeDropExtractionError("multiple-items")).toBe("Drop just one folder.");
  });

  it("renders the no-items message", () => {
    expect(describeDropExtractionError("no-items")).toBe(
      "Nothing dropped. Try again with a folder.",
    );
  });

  it("renders an unsupported-browser fallback message", () => {
    expect(describeDropExtractionError("unsupported")).toContain("Link Folder button");
  });

  it("falls back to a generic error when no message is provided", () => {
    expect(describeDropExtractionError("error")).toContain("Could not read");
  });
});
