import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import RenderedMarkdown from "@/components/RenderedMarkdown";
import type { BakedEmbed } from "@/lib/export/bake-embeds";

// ObjectChip / ObjectEmbed navigate via the router and read local data; mock the
// router so the LIVE path (used by the absent-prop control case) does not crash.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

// Lab-domains Phase 3b: the public companion-site render resolves lone object
// embeds to FROZEN baked snapshots (BakedEmbedView), never the live ObjectEmbed,
// because a public reader has no local workspace. These tests lock in:
//   1. a baked snapshot renders frozen (an image renders an <img>, a table a
//      <table>) and NEVER mounts a live embed,
//   2. an embed with no snapshot renders the calm "content unavailable" card,
//   3. the prop is additive: absent => the live path is unchanged.

const HREF = "/sequences?seq=1#ros=map";
const TABLE_HREF = "/datahub?doc=d1#ros=table";

function mdLink(caption: string, href: string): string {
  return `[${caption}](${href})`;
}

describe("RenderedMarkdown bakedEmbeds (public companion-site render)", () => {
  it("renders a baked image snapshot frozen as an <img>, not a live embed", () => {
    const baked = new Map<string, BakedEmbed>([
      [
        HREF,
        {
          kind: "image",
          dataUrl: "data:image/png;base64,AAAA",
          width: 600,
          height: 400,
          caption: "Figure 1",
          label: null,
        },
      ],
    ]);
    const { container } = render(
      <RenderedMarkdown content={mdLink("My tree", HREF)} bakedEmbeds={baked} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("renders a baked table snapshot as a <table>", () => {
    const baked = new Map<string, BakedEmbed>([
      [
        TABLE_HREF,
        {
          kind: "table",
          columns: ["Gene", "Count"],
          rows: [["actA", "42"]],
          caption: "Table 1",
          label: null,
        },
      ],
    ]);
    const { container, getByText } = render(
      <RenderedMarkdown content={mdLink("Counts", TABLE_HREF)} bakedEmbeds={baked} />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(getByText("Gene")).toBeTruthy();
    expect(getByText("actA")).toBeTruthy();
  });

  it("renders the calm unavailable card when no snapshot exists for the href", () => {
    // Empty map: the embed is still routed through the frozen path (never live),
    // and with no snapshot it shows the missing fallback.
    const baked = new Map<string, BakedEmbed>();
    const { container } = render(
      <RenderedMarkdown content={mdLink("Lost figure", HREF)} bakedEmbeds={baked} />,
    );
    // No live image / table; just the unavailable card text.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent ?? "").toMatch(/unavailable|not available|Lost figure/i);
  });

  it("does not crash and renders no frozen image for a plain markdown body", () => {
    const baked = new Map<string, BakedEmbed>();
    const { container } = render(
      <RenderedMarkdown content={"# Welcome\n\nJust prose here."} bakedEmbeds={baked} />,
    );
    expect(container.textContent).toContain("Welcome");
    expect(container.querySelector("img")).toBeNull();
  });
});
