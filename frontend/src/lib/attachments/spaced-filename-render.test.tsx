// frontend/src/lib/attachments/spaced-filename-render.test.tsx
//
// End-to-end proof for Grant's Telegram image-path bug (telegram image path
// manager, 2026-05-27). Renders a markdown image reference through the same
// react-markdown + remark-gfm pipeline the editors use, and asserts:
//
//   - An UN-encoded spaced destination (`Images/gel run 2.jpg`) does NOT
//     produce an <img> at all — CommonMark truncates the destination at the
//     space and react-markdown drops the image. This was the broken behavior.
//   - The percent-encoded destination the snippet writers now emit
//     (`Images/gel%20run%202.jpg`) DOES produce an <img> with the encoded src
//     intact, which blobUrlResolver.resolvePath then decodes to the literal
//     on-disk filename.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { encodeAttachmentRefPath, blobUrlResolver } from "@/lib/utils/blob-url-resolver";

function capturedImgSrc(md: string): string | null {
  let src: string | null = null;
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm],
        components: {
          img: ({ src: s }) => {
            src = s == null ? "" : String(s);
            return null;
          },
        },
      },
      md,
    ),
  );
  return src;
}

describe("spaced-filename markdown rendering", () => {
  it("drops the image when the destination has a raw space (the old bug)", () => {
    expect(capturedImgSrc("![cap](Images/gel run 2.jpg)")).toBeNull();
  });

  it("renders the image when the destination is percent-encoded (the fix)", () => {
    const ref = encodeAttachmentRefPath("Images", "gel run 2.jpg");
    expect(ref).toBe("Images/gel%20run%202.jpg");
    expect(capturedImgSrc(`![cap](${ref})`)).toBe("Images/gel%20run%202.jpg");
  });

  it("resolves the rendered encoded src back to the literal on-disk path", () => {
    const ref = encodeAttachmentRefPath("Images", "gel run 2.jpg");
    const renderedSrc = capturedImgSrc(`![cap](${ref})`);
    expect(renderedSrc).not.toBeNull();
    const base = "users/Grant/results/task-5/results";
    expect(blobUrlResolver.resolvePath(renderedSrc!, base)).toBe(
      `${base}/Images/gel run 2.jpg`,
    );
  });
});
