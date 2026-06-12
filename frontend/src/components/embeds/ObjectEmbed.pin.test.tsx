// @vitest-environment jsdom
// Coverage for the pin path in the ObjectEmbed dispatcher (markdown embed hybrid
// P7-1a). With a pin context AND a stored pin, the embed renders the FROZEN
// snapshot plus the "pinned <date>" badge instead of the live renderer. With the
// pin missing (sidecar gone or id removed) it falls back to live, gracefully.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { EmbedPin } from "@/lib/embeds/embed-pins";

// Mock the pins access layer so no fileService / disk is involved.
const getPinMock = vi.fn<(sidecar: string, id: string) => Promise<EmbedPin | null>>();
vi.mock("@/lib/embeds/embed-pins", () => ({
  getPin: (sidecar: string, id: string) => getPinMock(sidecar, id),
}));

// Stub the lazy per-type renderer so the live path renders something deterministic
// (and never pulls RDKit). The default export receives EmbedRendererProps.
vi.mock("./MoleculeEmbed", () => ({
  default: () => <div data-testid="live-molecule">LIVE MOLECULE</div>,
}));

import ObjectEmbed from "./ObjectEmbed";
import type { EmbedDescriptor } from "@/lib/references";

const pinnedDescriptor: EmbedDescriptor = {
  type: "molecule",
  id: "7",
  view: "card",
  isEmbed: true,
  opts: { pin: "s_abc123" },
};

const frozenPin: EmbedPin = {
  pinnedAt: "2026-06-12T10:00:00.000Z",
  type: "molecule",
  id: "7",
  view: "card",
  identity: "ABCDEF-INCHI",
  snapshot: {
    kind: "card",
    title: "Resveratrol (frozen)",
    subtitle: "Molecule",
    meta: ["C14H12O3"],
    caption: "Resveratrol",
    label: null,
  },
};

beforeEach(() => {
  getPinMock.mockReset();
});

describe("ObjectEmbed pin path", () => {
  it("renders the frozen snapshot and a pinned badge when a pin is found", async () => {
    getPinMock.mockResolvedValue(frozenPin);
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: "users/alex/notes/3/notes.ros-embeds.json" }}
      />,
    );
    // The frozen card title renders.
    await waitFor(() =>
      expect(screen.getByText("Resveratrol (frozen)")).toBeInTheDocument(),
    );
    // The pinned badge renders (localized date prefix "pinned ...").
    expect(screen.getByText(/^pinned/)).toBeInTheDocument();
    // The live renderer is NOT mounted.
    expect(screen.queryByTestId("live-molecule")).toBeNull();
    // getPin was asked for the right id.
    expect(getPinMock).toHaveBeenCalledWith(
      "users/alex/notes/3/notes.ros-embeds.json",
      "s_abc123",
    );
  });

  it("falls back to the live renderer when the pin is missing", async () => {
    getPinMock.mockResolvedValue(null);
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: "users/alex/notes/3/notes.ros-embeds.json" }}
      />,
    );
    // Live renderer eventually shows (after the pin resolves to null + Suspense).
    await waitFor(() =>
      expect(screen.getByTestId("live-molecule")).toBeInTheDocument(),
    );
    // No frozen badge.
    expect(screen.queryByText(/^pinned/)).toBeNull();
  });

  it("renders live with no pin control when there is no pin context", async () => {
    // No sidecarPath -> getPin must never be called, the embed is live.
    render(<ObjectEmbed descriptor={pinnedDescriptor} caption="Resveratrol" />);
    await waitFor(() =>
      expect(screen.getByTestId("live-molecule")).toBeInTheDocument(),
    );
    expect(getPinMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/^pinned/)).toBeNull();
    // No Pin / Unpin button without onPin / onUnpin closures.
    expect(screen.queryByRole("button", { name: /Pin|Unpin/ })).toBeNull();
  });

  it("offers a Pin control on a live embed when onPin is supplied", async () => {
    getPinMock.mockResolvedValue(null);
    const onPin = vi.fn();
    render(
      <ObjectEmbed
        descriptor={{ ...pinnedDescriptor, opts: {} }}
        caption="Resveratrol"
        pinContext={{ sidecarPath: "users/alex/notes/3/notes.ros-embeds.json", onPin }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("live-molecule")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });
});
