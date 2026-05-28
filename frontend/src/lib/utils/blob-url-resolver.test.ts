// frontend/src/lib/utils/blob-url-resolver.test.ts
//
// Pins the spaced-filename round-trip that fixed Grant's Telegram bug
// (telegram image path manager, 2026-05-27):
//
//   A Telegram photo can carry a filename with a space (a phone document
//   name like "gel run 2.jpg", or a user-typed batch name). The bottom-bar
//   image strip rendered it fine because it lists the folder directly, but
//   dragging it into the markdown editor inserted `![](Images/gel run 2.jpg)`.
//   CommonMark truncates the destination at the first space, so react-markdown
//   dropped the image and the reference looked broken ("stored somewhere it
//   really is not"). The fix percent-encodes the destination on insert and
//   decodes it back to the literal filename when resolving to disk.
//
// These tests pin the resolver's decode step. The companion snippet-writer
// tests live in attach-image / ImageStrip; the rendering proof (react-markdown
// keeps a %20 src but drops a raw-space src) is exercised by the editor suites.

import { describe, expect, it } from "vitest";
import { BlobUrlResolver, encodeAttachmentRefPath } from "./blob-url-resolver";

describe("encodeAttachmentRefPath", () => {
  it("percent-encodes spaces in the filename, leaving the prefix raw", () => {
    expect(encodeAttachmentRefPath("Images", "gel run 2.jpg")).toBe(
      "Images/gel%20run%202.jpg",
    );
  });

  it("is a no-op for filenames with no reserved characters", () => {
    expect(encodeAttachmentRefPath("Images", "photo.jpg")).toBe(
      "Images/photo.jpg",
    );
  });

  it("encodes other reserved characters that would break a destination", () => {
    // `#` would otherwise be read as a fragment; encodeURIComponent handles it.
    expect(encodeAttachmentRefPath("Files", "draft #2.pdf")).toBe(
      "Files/draft%20%232.pdf",
    );
  });
});

describe("BlobUrlResolver.resolvePath percent-decoding", () => {
  const resolver = new BlobUrlResolver();
  const base = "users/Grant/results/task-5/results";

  it("decodes a percent-encoded Images ref back to the literal on-disk path", () => {
    // This is the exact ref the snippet writers now emit. The file on disk
    // is the literal "gel run 2.jpg"; the read must hit that, not "%20".
    expect(resolver.resolvePath("Images/gel%20run%202.jpg", base)).toBe(
      `${base}/Images/gel run 2.jpg`,
    );
  });

  it("round-trips encode -> resolve to the literal on-disk filename", () => {
    const filename = "western blot rep 3.png";
    const ref = encodeAttachmentRefPath("Images", filename);
    expect(resolver.resolvePath(ref, base)).toBe(`${base}/Images/${filename}`);
  });

  it("leaves an already-literal ref unchanged (back-compat)", () => {
    expect(resolver.resolvePath("Images/photo.jpg", base)).toBe(
      `${base}/Images/photo.jpg`,
    );
  });

  it("tolerates a malformed percent-escape by falling back to the raw src", () => {
    // A stray `%` that is not a valid escape must not throw — the file is
    // read as the literal `100%done.png`.
    expect(resolver.resolvePath("Images/100%done.png", base)).toBe(
      `${base}/Images/100%done.png`,
    );
  });

  it("decodes legacy ../../Images refs too", () => {
    expect(
      resolver.resolvePath("../../Images/old%20scan.png", base, "Grant"),
    ).toBe("users/Grant/Images/old scan.png");
  });
});
