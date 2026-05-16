// frontend/src/components/inbox-toast-stem.test.ts
//
// Unit coverage for the filename-to-caption fallback used by InboxToast.
// The toast subscribes to `image-attached` and reads the sidecar to get
// caption text, but the emit fires inside attachImageToTask BEFORE the
// caller's writeSidecar lands — a race that left the toast showing
// "No caption" for the auto-number flow (Grant's screenshot). This
// helper covers that race and the per-photo /skip path.

import { describe, expect, it } from "vitest";
import { filenameToCaptionStem } from "./InboxToast";

describe("filenameToCaptionStem", () => {
  it("strips extension and -N batch suffix (Fu-1.jpg → Fu)", () => {
    expect(filenameToCaptionStem("Fu-1.jpg")).toBe("Fu");
    expect(filenameToCaptionStem("Fu-2.png")).toBe("Fu");
    expect(filenameToCaptionStem("Yeast assay-10.jpg")).toBe("Yeast assay");
  });

  it("returns bare stem when there's no batch suffix", () => {
    expect(filenameToCaptionStem("Fu.jpg")).toBe("Fu");
    expect(filenameToCaptionStem("image.png")).toBe("image");
  });

  it("only strips the trailing -N, not intermediate hyphens", () => {
    expect(filenameToCaptionStem("Fu-bar-1.jpg")).toBe("Fu-bar");
    expect(filenameToCaptionStem("Fu-bar.jpg")).toBe("Fu-bar");
  });

  it("returns null for empty input so the caller's 'No caption' sentinel still fires", () => {
    expect(filenameToCaptionStem("")).toBeNull();
  });

  it("handles filenames with no extension", () => {
    expect(filenameToCaptionStem("noext-1")).toBe("noext");
    expect(filenameToCaptionStem("noext")).toBe("noext");
  });
});
