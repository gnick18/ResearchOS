// @vitest-environment jsdom
// Render coverage for the frozen-snapshot renderer (markdown embed hybrid P7-1a).
// Each BakedEmbed kind must render the right element so a pinned embed shows what
// it looked like on the day it was pinned.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BakedEmbedView from "./BakedEmbedView";
import type { BakedEmbed } from "@/lib/export/bake-embeds";
import type { EmbedDescriptor } from "@/lib/references";

const descriptor: EmbedDescriptor = {
  type: "molecule",
  id: "7",
  view: "card",
  isEmbed: true,
  opts: { pin: "s_abc123" },
};

describe("BakedEmbedView", () => {
  it("renders an image snapshot as an <img> with the caption as alt", () => {
    const snap: BakedEmbed = {
      kind: "image",
      dataUrl: "data:image/png;base64,AAAA",
      width: 100,
      height: 80,
      caption: "Resveratrol",
      label: null,
    };
    const { container } = render(
      <BakedEmbedView snapshot={snap} caption="Resveratrol" descriptor={descriptor} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(img?.getAttribute("alt")).toBe("Resveratrol");
  });

  it("renders a table snapshot as a <table> with headers and cells", () => {
    const snap: BakedEmbed = {
      kind: "table",
      columns: ["Day", "OD600"],
      rows: [
        ["1", "0.2"],
        ["2", "0.8"],
      ],
      caption: "Growth",
      label: null,
    };
    const { container } = render(
      <BakedEmbedView snapshot={snap} caption="Growth" descriptor={descriptor} />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("OD600")).toBeInTheDocument();
    expect(screen.getByText("0.8")).toBeInTheDocument();
  });

  it("renders a text snapshot as its body", () => {
    const snap: BakedEmbed = {
      kind: "text",
      body: "p = 0.03, significant",
      caption: "t-test",
      label: null,
    };
    render(<BakedEmbedView snapshot={snap} caption="t-test" descriptor={descriptor} />);
    expect(screen.getByText("p = 0.03, significant")).toBeInTheDocument();
  });

  it("renders a card snapshot with title, subtitle, and meta", () => {
    const snap: BakedEmbed = {
      kind: "card",
      title: "pUC19",
      subtitle: "Sequence",
      meta: ["2686 bp", "Circular"],
      caption: "pUC19",
      label: null,
    };
    render(<BakedEmbedView snapshot={snap} caption="pUC19" descriptor={descriptor} />);
    expect(screen.getByText("pUC19")).toBeInTheDocument();
    expect(screen.getByText("Sequence")).toBeInTheDocument();
    expect(screen.getByText("2686 bp")).toBeInTheDocument();
    expect(screen.getByText("Circular")).toBeInTheDocument();
  });

  it("renders a missing snapshot as the unavailable card", () => {
    const snap: BakedEmbed = { kind: "missing", name: "Gone Molecule", label: null };
    render(<BakedEmbedView snapshot={snap} caption="Gone Molecule" descriptor={descriptor} />);
    expect(screen.getByText("Gone Molecule")).toBeInTheDocument();
    expect(screen.getByText(/Not available/)).toBeInTheDocument();
  });
});
