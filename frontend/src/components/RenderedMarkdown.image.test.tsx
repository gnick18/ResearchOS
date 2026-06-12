// @vitest-environment jsdom
/**
 * Tests for the image embed-controls upgrade in RenderedMarkdown:
 *   - alt text becomes a <figcaption> below the image.
 *   - a #w=<number> fragment on the src applies max-width and is stripped
 *     before reaching AnnotatedImage / the blob resolver.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import RenderedMarkdown from "@/components/RenderedMarkdown";

// AnnotatedImage is a client component that imports next/* internals.
// Mock it to a bare <img> so jsdom tests stay dependency-free.
vi.mock("@/components/AnnotatedImage", () => ({
  default: ({ src, alt, style, className }: { src: string; alt?: string; style?: React.CSSProperties; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} style={style} className={className} data-testid="annotated-image" />
  ),
}));

// OcrReveal is server-side and not needed for these tests.
vi.mock("@/components/OcrImage", () => ({
  OcrReveal: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

describe("RenderedMarkdown image embed controls", () => {
  it("renders a bare <img> with no figure wrapper when alt is empty and no #w", () => {
    const { container } = render(
      <RenderedMarkdown content="![](https://example.com/img.png)" />,
    );
    expect(container.querySelector("figure")).toBeNull();
    expect(container.querySelector("figcaption")).toBeNull();
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
  });

  it("wraps the image in a block span and renders the alt as a caption span", () => {
    const { container } = render(
      <RenderedMarkdown content="![Western blot result](https://example.com/blot.png)" />,
    );
    const wrap = container.querySelector("[data-image-embed]");
    expect(wrap).not.toBeNull();
    const caption = container.querySelector("[data-image-caption]");
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toBe("Western blot result");
    // The image must still be present inside the wrapper.
    expect(wrap?.querySelector("img")).not.toBeNull();
  });

  it("applies the #w= number as a max-width on the wrapper span", () => {
    const { container } = render(
      <RenderedMarkdown content="![](https://example.com/img.png#w=300)" />,
    );
    const wrap = container.querySelector<HTMLElement>("[data-image-embed]");
    expect(wrap).not.toBeNull();
    // max-width can come through as a number or a px string depending on React.
    const style = wrap!.style;
    expect(style.maxWidth).toBeTruthy();
    // The numeric value must be 300.
    expect(parseInt(style.maxWidth, 10)).toBe(300);
  });

  it("strips the #w= fragment from the src before it reaches AnnotatedImage", () => {
    const { container } = render(
      <RenderedMarkdown content="![Gel](https://example.com/gel.png#w=420)" />,
    );
    const img = container.querySelector<HTMLImageElement>("img[data-testid='annotated-image']");
    expect(img).not.toBeNull();
    // The src handed to AnnotatedImage must NOT contain #w=.
    expect(img?.src).not.toContain("#w=");
    expect(img?.src).toContain("gel.png");
  });

  it("renders both a caption and max-width when alt and #w are both set", () => {
    const { container } = render(
      <RenderedMarkdown content="![Colony count](https://example.com/plate.png#w=500)" />,
    );
    const wrap = container.querySelector<HTMLElement>("[data-image-embed]");
    expect(wrap).not.toBeNull();
    expect(parseInt(wrap!.style.maxWidth, 10)).toBe(500);
    const caption = container.querySelector("[data-image-caption]");
    expect(caption?.textContent).toBe("Colony count");
  });
});
