// ai chat-embeds bot, 2026-06-11; ai embed-align bot, 2026-06-11.
//
// Tests for the AssistantMarkdown block-embed path. Verifies:
//   (a) a lone molecule embed link renders as ObjectEmbed (not a new-tab anchor)
//   (b) a lone datahub table embed link renders as ObjectEmbed
//   (c) a lone datahub RESULT embed link renders as ObjectEmbed with analysis opt preserved
//   (d) a lone datahub PLOT embed link renders as ObjectEmbed with plot opt preserved
//   (e) a plain object deep-link (no #ros= fragment) renders as an ObjectChip
//   (f) an external URL still renders as a new-tab anchor
//   (g) a molecule embed link that is MID-sentence renders as a chip, not a block
//
// ObjectEmbed, ObjectChip, and the chemistry/datahub APIs are mocked so this
// test does not need RDKit, a real folder, or any network.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssistantMarkdown } from "../BeakerBotConversation";
import type { EmbedDescriptor } from "@/lib/references";

// Mock ObjectEmbed so we can assert it renders without needing RDKit or APIs.
// Exposes type, id, view, caption, and the analysis/plot opts so tests can
// confirm the full descriptor passes through.
vi.mock("@/components/embeds/ObjectEmbed", () => ({
  default: ({ descriptor, caption }: { descriptor: EmbedDescriptor; caption: string }) => (
    <div
      data-testid="object-embed"
      data-type={descriptor.type}
      data-id={descriptor.id}
      data-view={descriptor.view}
      data-caption={caption}
      data-analysis={descriptor.opts.analysis ?? ""}
      data-plot={descriptor.opts.plot ?? ""}
    />
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

  it("renders a lone datahub RESULT embed link as ObjectEmbed with analysis opt", () => {
    // This is the form BeakerBot writes after run_datahub_analysis succeeds.
    // The analysis opt must survive parseObjectEmbed -> loneEmbedFromChatParagraph
    // -> ObjectEmbed so DataHubEmbed can find the right analysis.
    const content = "[Welch t-test, A vs B](/datahub?doc=2#ros=result&analysis=a3)";
    render(<AssistantMarkdown content={content} />);

    const embed = screen.getByTestId("object-embed");
    expect(embed.getAttribute("data-type")).toBe("datahub");
    expect(embed.getAttribute("data-id")).toBe("2");
    expect(embed.getAttribute("data-view")).toBe("result");
    expect(embed.getAttribute("data-analysis")).toBe("a3");
    expect(embed.getAttribute("data-caption")).toBe("Welch t-test, A vs B");

    const anchors = document.querySelectorAll("a[target='_blank']");
    expect(anchors.length).toBe(0);
  });

  it("renders a lone datahub PLOT embed link as ObjectEmbed with plot opt", () => {
    // This is the form BeakerBot writes after make_datahub_graph succeeds.
    // The plot opt must survive to ObjectEmbed so DataHubEmbed can render the
    // correct PlotSpec SVG.
    const content = "[OD600 over time](/datahub?doc=2#ros=plot&plot=p1)";
    render(<AssistantMarkdown content={content} />);

    const embed = screen.getByTestId("object-embed");
    expect(embed.getAttribute("data-type")).toBe("datahub");
    expect(embed.getAttribute("data-id")).toBe("2");
    expect(embed.getAttribute("data-view")).toBe("plot");
    expect(embed.getAttribute("data-plot")).toBe("p1");
    expect(embed.getAttribute("data-caption")).toBe("OD600 over time");

    const anchors = document.querySelectorAll("a[target='_blank']");
    expect(anchors.length).toBe(0);
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
