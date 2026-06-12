// @vitest-environment jsdom
//
// P7-6 mobile + accessibility tests. Asserts the a11y attributes added in the
// P7-6 pass: aria-label on figure elements, aria-label on Open links, role="img"
// + aria-label on structure depiction wrappers, role="group" + aria-label on the
// view switch, focus-ring classes on interactive elements, and read-only context
// (no Pin/Re-pin when pinContext is absent).
//
// These tests do NOT use @testing-library/jest-dom matchers (toBeInTheDocument
// etc.) because the pnpm virtual-store COW copy in worktrees breaks the
// jest-dom dist. They use only standard vitest expect(value).toBe/toBeTruthy/
// toBeNull. The same assertions hold identically in the main checkout.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// -----------------------------------------------------------------------
// EmbedViewSwitch: role="group" and aria-label, focus classes
// -----------------------------------------------------------------------
import EmbedViewSwitch from "./EmbedViewSwitch";

describe("EmbedViewSwitch a11y (P7-6)", () => {
  const views = [
    { value: "map", label: "Map" },
    { value: "bases", label: "Bases" },
  ];

  it("wraps the button group in role=group with aria-label View", () => {
    const { container } = render(
      <EmbedViewSwitch views={views} current="map" onSelect={() => {}} />,
    );
    const group = container.querySelector("[role='group']");
    expect(group).toBeTruthy();
    expect((group as HTMLElement).getAttribute("aria-label")).toBe("View");
  });

  it("each button carries focus-visible ring class", () => {
    const { container } = render(
      <EmbedViewSwitch views={views} current="map" onSelect={() => {}} />,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect(btn.className).toContain("focus-visible:ring-2");
    }
  });
});

// -----------------------------------------------------------------------
// ObjectEmbedCard: aria-label on Open link, no Open link while loading
// -----------------------------------------------------------------------
import { ObjectEmbedCard } from "./ObjectEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const moleculeDescriptor: EmbedDescriptor = {
  type: "molecule",
  id: "4",
  view: "card",
  isEmbed: true,
  opts: {},
};

describe("ObjectEmbedCard a11y (P7-6)", () => {
  it("Open link carries a descriptive aria-label", () => {
    const { container } = render(
      <ObjectEmbedCard descriptor={moleculeDescriptor} caption="Resveratrol" />,
    );
    const link = container.querySelector("a[aria-label]");
    expect(link).toBeTruthy();
    const label = (link as HTMLAnchorElement).getAttribute("aria-label") ?? "";
    expect(label).toContain("Resveratrol");
    expect(label).toContain("Molecule");
  });

  it("keeps the Open link clickable while loading (deep link is known up front)", () => {
    const { container } = render(
      <ObjectEmbedCard descriptor={moleculeDescriptor} caption="Resveratrol" loading />,
    );
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/chemistry?molecule=4");
  });

  it("Open link carries focus-visible ring class", () => {
    const { container } = render(
      <ObjectEmbedCard descriptor={moleculeDescriptor} caption="Resveratrol" />,
    );
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.className).toContain("focus-visible:ring-2");
  });
});

// -----------------------------------------------------------------------
// ObjectEmbed figure: aria-label announces type and caption
// -----------------------------------------------------------------------
vi.mock("@/lib/embeds/embed-pins", () => ({
  getPin: vi.fn().mockResolvedValue(null),
  liveIdentityForEmbed: vi.fn().mockResolvedValue(null),
  buildPin: vi.fn(),
  updatePin: vi.fn(),
}));

// Stub the lazy molecule renderer so ObjectEmbed can render without wasm.
vi.mock("./MoleculeEmbed", () => ({
  default: () => <div data-testid="live-molecule">LIVE</div>,
}));

import ObjectEmbed from "./ObjectEmbed";

describe("ObjectEmbed figure aria-label (P7-6)", () => {
  it("figure element carries aria-label with type and caption", async () => {
    const { container } = render(
      <ObjectEmbed descriptor={moleculeDescriptor} caption="Resveratrol" />,
    );
    const fig = container.querySelector("figure");
    expect(fig).toBeTruthy();
    const label = (fig as HTMLElement).getAttribute("aria-label") ?? "";
    expect(label).toContain("Molecule");
    expect(label).toContain("Resveratrol");
  });
});

// MoleculeEmbed a11y tests live in a11y-molecule.test.tsx to avoid mock
// conflicts with the ObjectEmbed stub of ./MoleculeEmbed above.

// -----------------------------------------------------------------------
// ExternalEmbed figure: aria-label by kind
// -----------------------------------------------------------------------
vi.mock("./CiteCard", () => ({ default: () => <div data-testid="cite-card" /> }));
vi.mock("./StructureCard", () => ({ default: () => <div data-testid="struct-card" /> }));
vi.mock("./LinkCard", () => ({ default: () => <div data-testid="link-card" /> }));

import ExternalEmbed from "./ExternalEmbed";
import type { ExternalEmbedDescriptor } from "@/lib/embeds/external-embeds";

const citeDescriptor: ExternalEmbedDescriptor = {
  kind: "cite",
  href: "https://doi.org/10.1234/test",
  url: "https://doi.org/10.1234/test",
  doiOrPmid: "10.1234/test",
  isPmid: false,
};

describe("ExternalEmbed figure aria-label (P7-6)", () => {
  it("cite figure carries aria-label mentioning Citation and caption", () => {
    const { container } = render(
      <ExternalEmbed descriptor={citeDescriptor} caption="My paper" />,
    );
    const fig = container.querySelector("figure");
    expect(fig).toBeTruthy();
    const label = (fig as HTMLElement).getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("citation");
    expect(label).toContain("My paper");
  });

  it("link figure carries aria-label mentioning Link", () => {
    const linkDescriptor: ExternalEmbedDescriptor = {
      kind: "link",
      href: "https://example.com",
      url: "https://example.com",
    };
    const { container } = render(
      <ExternalEmbed descriptor={linkDescriptor} caption="Example site" />,
    );
    const fig = container.querySelector("figure");
    const label = (fig as HTMLElement).getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("link");
    expect(label).toContain("Example site");
  });

  it("structure figure carries aria-label mentioning Structure", () => {
    const structDescriptor: ExternalEmbedDescriptor = {
      kind: "structure",
      href: "https://pubchem.ncbi.nlm.nih.gov/compound/5280343",
      url: "https://pubchem.ncbi.nlm.nih.gov/compound/5280343",
      pubchemCid: 5280343,
    };
    const { container } = render(
      <ExternalEmbed descriptor={structDescriptor} caption="Resveratrol" />,
    );
    const fig = container.querySelector("figure");
    const label = (fig as HTMLElement).getAttribute("aria-label") ?? "";
    expect(label.toLowerCase()).toContain("structure");
    expect(label).toContain("Resveratrol");
  });
});
