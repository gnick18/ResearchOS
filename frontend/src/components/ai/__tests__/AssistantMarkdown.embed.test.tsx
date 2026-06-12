// ai chat-embeds bot, 2026-06-11.
//
// Tests for the AssistantMarkdown block-embed path. Verifies:
//   (a) a lone molecule embed link renders as ObjectEmbed (not a new-tab anchor)
//   (b) a lone datahub embed link renders as ObjectEmbed
//   (c) a plain object deep-link (no #ros= fragment) renders as an ObjectChip
//   (d) an external URL still renders as a new-tab anchor
//   (e) a molecule embed link that is MID-sentence renders as a chip, not a block
//
// ObjectEmbed, ObjectChip, and the chemistry/datahub APIs are mocked so this
// test does not need RDKit, a real folder, or any network.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantMarkdown } from "../BeakerBotConversation";

// Mock ObjectEmbed so we can assert it renders without needing RDKit or APIs.
vi.mock("@/components/embeds/ObjectEmbed", () => ({
  default: ({ descriptor, caption }: { descriptor: { type: string; id: string }; caption: string }) => (
    <div data-testid="object-embed" data-type={descriptor.type} data-id={descriptor.id} data-caption={caption} />
  ),
}));

// Mock ObjectChip so we can assert it renders for inline deep-links.
vi.mock("@/components/ObjectChip", () => ({
  default: ({ type, href, label }: { type: string; href: string; label: string }) => (
    <span data-testid="object-chip" data-type={type} data-href={href} data-label={label} />
  ),
}));

describe("AssistantMarkdown embed rendering", () => {
  it("renders a lone molecule embed link as ObjectEmbed, not a new-tab anchor", () => {
    const content = "[Ethanol](/chemistry?molecule=7#ros=card)";
    render(<AssistantMarkdown content={content} />);

    const embed = screen.getByTestId("object-embed");
    expect(embed).toBeTruthy();
    expect(embed.getAttribute("data-type")).toBe("molecule");
    expect(embed.getAttribute("data-id")).toBe("7");
    expect(embed.getAttribute("data-caption")).toBe("Ethanol");

    // Must NOT be a plain anchor (the bug we are fixing).
    const anchors = document.querySelectorAll("a[target='_blank']");
    expect(anchors.length).toBe(0);
  });

  it("renders a lone datahub embed link as ObjectEmbed", () => {
    const content = "[Growth assay](/datahub?doc=doc-42#ros=table)";
    render(<AssistantMarkdown content={content} />);

    const embed = screen.getByTestId("object-embed");
    expect(embed.getAttribute("data-type")).toBe("datahub");
    expect(embed.getAttribute("data-id")).toBe("doc-42");
    expect(embed.getAttribute("data-caption")).toBe("Growth assay");

    const anchors = document.querySelectorAll("a[target='_blank']");
    expect(anchors.length).toBe(0);
  });

  it("renders a plain note deep-link (no embed fragment) as an ObjectChip", () => {
    const content = "[qPCR summary](/notes/42)";
    render(<AssistantMarkdown content={content} />);

    const chip = screen.getByTestId("object-chip");
    expect(chip.getAttribute("data-type")).toBe("note");
    expect(chip.getAttribute("data-href")).toBe("/notes/42");
    expect(chip.getAttribute("data-label")).toBe("qPCR summary");

    // No embed and no new-tab anchor.
    expect(screen.queryByTestId("object-embed")).toBeNull();
    expect(document.querySelectorAll("a[target='_blank']").length).toBe(0);
  });

  it("renders an external URL as a new-tab anchor", () => {
    const content = "[PubChem](https://pubchem.ncbi.nlm.nih.gov/)";
    render(<AssistantMarkdown content={content} />);

    expect(screen.queryByTestId("object-embed")).toBeNull();
    expect(screen.queryByTestId("object-chip")).toBeNull();

    const anchor = document.querySelector("a[target='_blank']") as HTMLAnchorElement | null;
    expect(anchor).not.toBeNull();
    expect(anchor?.href).toContain("pubchem");
  });

  it("renders a molecule embed link that is mid-sentence as a chip, not a block embed", () => {
    // The embed link is surrounded by text in the same paragraph.
    const content = "I saved [Ethanol](/chemistry?molecule=7#ros=card) to your library.";
    render(<AssistantMarkdown content={content} />);

    // The paragraph has multiple meaningful children, so the lone-embed rule
    // does not fire and ObjectEmbed is not rendered.
    expect(screen.queryByTestId("object-embed")).toBeNull();

    // The inline chip path handles the mid-sentence embed link.
    const chip = screen.getByTestId("object-chip");
    expect(chip.getAttribute("data-type")).toBe("molecule");
  });
});
