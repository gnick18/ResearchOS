// frontend/src/lib/import/imageDropMatcher.test.ts
//
// Pure-function coverage for the drop-matcher used by the cred-less
// LabArchives image-rehydration paths. The matcher is what makes the
// DevTools-script ZIP path and the manual-drop path interoperable — the
// matched output drops straight into the `apply.ts` `fetchedImages` map
// with no further translation, so getting the keying right is load-bearing.

import { describe, it, expect } from "vitest";
import { matchDroppedFilesToMissing, type DroppedFile } from "./imageDropMatcher";
import type { MissingInlineImage } from "./eln/types";

function makeMissing(filename: string, ep: string): MissingInlineImage {
  return {
    filename,
    originalUrl: `/attachments/inline_image/abc?ep_id=${ep}&file_name=${encodeURIComponent(filename)}`,
    entryPartId: ep,
  };
}

function makeDrop(name: string, content = "x"): DroppedFile {
  return {
    file: new File([content], name, { type: "image/png" }),
    displayPath: name,
  };
}

describe("matchDroppedFilesToMissing", () => {
  it("matches by exact (case-insensitive) filename", () => {
    const missing = [makeMissing("1762884018545.jpg", "ep1")];
    const dropped = [makeDrop("1762884018545.JPG")];
    const r = matchDroppedFilesToMissing(dropped, missing);
    expect(r.byUrl.size).toBe(1);
    expect(r.byUrl.get(missing[0].originalUrl)?.kind).toBe("ok");
    expect(r.matched.length).toBe(1);
    expect(r.unmatched.length).toBe(0);
    expect(r.unusedFiles.length).toBe(0);
  });

  it("falls back to stem-only match when extension differs", () => {
    const missing = [makeMissing("1762884018545.bin", "ep1")];
    // User saved their inline image as .png from the browser even though
    // LabArchives reports it as .bin.
    const dropped = [makeDrop("1762884018545.png")];
    const r = matchDroppedFilesToMissing(dropped, missing);
    expect(r.byUrl.size).toBe(1);
    expect(r.matched.length).toBe(1);
  });

  it("reports unmatched missing-image refs", () => {
    const missing = [
      makeMissing("a.png", "ep1"),
      makeMissing("b.png", "ep2"),
      makeMissing("c.png", "ep3"),
    ];
    const dropped = [makeDrop("a.png"), makeDrop("c.png")];
    const r = matchDroppedFilesToMissing(dropped, missing);
    expect(r.byUrl.size).toBe(2);
    expect(r.matched.map((m) => m.filename).sort()).toEqual(["a.png", "c.png"]);
    expect(r.unmatched.map((m) => m.filename)).toEqual(["b.png"]);
    expect(r.unusedFiles.length).toBe(0);
  });

  it("reports unused dropped files", () => {
    const missing = [makeMissing("wanted.png", "ep1")];
    const dropped = [makeDrop("wanted.png"), makeDrop("extra1.png"), makeDrop("extra2.jpg")];
    const r = matchDroppedFilesToMissing(dropped, missing);
    expect(r.byUrl.size).toBe(1);
    expect(r.unusedFiles.length).toBe(2);
    expect(r.unusedFiles.map((u) => u.name).sort()).toEqual(["extra1.png", "extra2.jpg"]);
  });

  it("when two dropped files match the same missing entry, first wins, second is unused", () => {
    const missing = [makeMissing("same.png", "ep1")];
    const dropped = [makeDrop("same.png", "first"), makeDrop("same.png", "second")];
    const r = matchDroppedFilesToMissing(dropped, missing);
    expect(r.byUrl.size).toBe(1);
    expect(r.unusedFiles.length).toBe(1);
  });

  it("returns an empty result when nothing was dropped", () => {
    const missing = [makeMissing("a.png", "ep1")];
    const r = matchDroppedFilesToMissing([], missing);
    expect(r.byUrl.size).toBe(0);
    expect(r.matched.length).toBe(0);
    expect(r.unmatched.length).toBe(1);
    expect(r.unusedFiles.length).toBe(0);
  });

  it("ignores subfolder path components — matches on basename only", () => {
    const missing = [makeMissing("nested.png", "ep1")];
    const dropped: DroppedFile[] = [
      {
        file: new File(["data"], "nested.png", { type: "image/png" }),
        displayPath: "labarchives-images/notebook-x/nested.png",
      },
    ];
    const r = matchDroppedFilesToMissing(dropped, missing);
    expect(r.byUrl.size).toBe(1);
  });

  it("produces `kind: ok` entries with the dropped File as blob", () => {
    const missing = [makeMissing("a.png", "ep1")];
    const file = new File(["payload"], "a.png", { type: "image/png" });
    const r = matchDroppedFilesToMissing(
      [{ file, displayPath: "a.png" }],
      missing,
    );
    const entry = r.byUrl.get(missing[0].originalUrl);
    expect(entry?.kind).toBe("ok");
    if (entry?.kind === "ok") {
      expect(entry.contentType).toBe("image/png");
      expect(entry.blob).toBe(file);
    }
  });
});
