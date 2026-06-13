// @vitest-environment jsdom
// Coverage for the pin path in the ObjectEmbed dispatcher (markdown embed hybrid
// P7-1a + P7-1b). With a pin context AND a stored pin, the embed renders the FROZEN
// snapshot plus the "frozen <date>" badge instead of the live renderer. With the
// pin missing (sidecar gone or id removed) it falls back to live, gracefully.
//
// P7-1b adds the staleness check: when the live source's portable identity differs
// from the pin's stored identity, a "source changed since you froze this" badge
// shows with View-current (view-only) and Re-freeze (editor-only) actions.
//
// Also covers the Edit markdown button (Change 1): it appears only when
// onEditMarkdown is supplied (editor context) and fires the callback on click.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { EmbedPin } from "@/lib/embeds/embed-pins";
import type { EmbedDescriptor } from "@/lib/references";

// Mock the pins access layer so no fileService / disk is involved.
const getPinMock = vi.fn<(sidecar: string, id: string) => Promise<EmbedPin | null>>();
const liveIdentityMock =
  vi.fn<(descriptor: EmbedDescriptor) => Promise<string | null>>();
const buildPinMock =
  vi.fn<(descriptor: EmbedDescriptor, caption: string, deps?: unknown) => Promise<EmbedPin>>();
const updatePinMock =
  vi.fn<(sidecar: string, shortId: string, pin: EmbedPin) => Promise<void>>();
vi.mock("@/lib/embeds/embed-pins", () => ({
  getPin: (sidecar: string, id: string) => getPinMock(sidecar, id),
  liveIdentityForEmbed: (descriptor: EmbedDescriptor) => liveIdentityMock(descriptor),
  buildPin: (descriptor: EmbedDescriptor, caption: string, deps?: unknown) =>
    buildPinMock(descriptor, caption, deps),
  updatePin: (sidecar: string, shortId: string, pin: EmbedPin) =>
    updatePinMock(sidecar, shortId, pin),
}));

// Stub the lazy per-type renderer so the live path renders something deterministic
// (and never pulls RDKit). The default export receives EmbedRendererProps.
vi.mock("./MoleculeEmbed", () => ({
  default: () => <div data-testid="live-molecule">LIVE MOLECULE</div>,
}));

import ObjectEmbed from "./ObjectEmbed";

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
  liveIdentityMock.mockReset();
  buildPinMock.mockReset();
  updatePinMock.mockReset();
  // Default: live identity matches the pin (not stale) unless a test overrides it.
  liveIdentityMock.mockResolvedValue("ABCDEF-INCHI");
});

describe("ObjectEmbed pin path", () => {
  it("renders the frozen snapshot and a frozen badge when a pin is found", async () => {
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
    // The frozen badge renders (localized date prefix "frozen ...").
    expect(screen.getByText(/^frozen/)).toBeInTheDocument();
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
    expect(screen.queryByText(/^frozen/)).toBeNull();
  });

  it("renders live with no pin control when there is no pin context", async () => {
    // No sidecarPath -> getPin must never be called, the embed is live.
    render(<ObjectEmbed descriptor={pinnedDescriptor} caption="Resveratrol" />);
    await waitFor(() =>
      expect(screen.getByTestId("live-molecule")).toBeInTheDocument(),
    );
    expect(getPinMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/^frozen/)).toBeNull();
    // No Freeze / Unfreeze button without onPin / onUnpin closures.
    expect(screen.queryByRole("button", { name: /Freeze|Unfreeze/ })).toBeNull();
  });

  it("offers a Freeze control on a live embed when onPin is supplied", async () => {
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
    expect(screen.getByRole("button", { name: "Freeze" })).toBeInTheDocument();
  });
});

const SIDECAR = "users/alex/notes/3/notes.ros-embeds.json";
const STALE_TEXT = /source changed since you froze this/;

describe("ObjectEmbed staleness (P7-1b)", () => {
  it("shows the stale badge when the live identity differs from the pin", async () => {
    getPinMock.mockResolvedValue(frozenPin); // identity "ABCDEF-INCHI"
    liveIdentityMock.mockResolvedValue("MOVED-ON-INCHI"); // live differs
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: SIDECAR }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(STALE_TEXT)).toBeInTheDocument(),
    );
    // Frozen card still shows underneath the badge.
    expect(screen.getByText("Resveratrol (frozen)")).toBeInTheDocument();
    expect(liveIdentityMock).toHaveBeenCalled();
  });

  it("shows no stale badge when the live identity equals the pin", async () => {
    getPinMock.mockResolvedValue(frozenPin);
    liveIdentityMock.mockResolvedValue("ABCDEF-INCHI"); // equal -> not stale
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: SIDECAR }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Resveratrol (frozen)")).toBeInTheDocument(),
    );
    // Give the async identity check a tick to settle, then assert no badge.
    await waitFor(() => expect(liveIdentityMock).toHaveBeenCalled());
    expect(screen.queryByText(STALE_TEXT)).toBeNull();
  });

  it("never flags a pin whose stored identity is null (no false positive)", async () => {
    getPinMock.mockResolvedValue({ ...frozenPin, identity: null });
    liveIdentityMock.mockResolvedValue("ANYTHING");
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: SIDECAR }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Resveratrol (frozen)")).toBeInTheDocument(),
    );
    // A null-identity pin short-circuits before the live load, so no badge and the
    // live identity loader is never consulted.
    expect(screen.queryByText(STALE_TEXT)).toBeNull();
    expect(liveIdentityMock).not.toHaveBeenCalled();
  });

  it("never flags when the live source is gone (live identity null)", async () => {
    getPinMock.mockResolvedValue(frozenPin); // identity present
    liveIdentityMock.mockResolvedValue(null); // source gone / no identity
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: SIDECAR }}
      />,
    );
    // The frozen pin still renders (the point of a pin), with no stale badge.
    await waitFor(() =>
      expect(screen.getByText("Resveratrol (frozen)")).toBeInTheDocument(),
    );
    await waitFor(() => expect(liveIdentityMock).toHaveBeenCalled());
    expect(screen.queryByText(STALE_TEXT)).toBeNull();
  });
});

describe("ObjectEmbed View current + Re-freeze (P7-1b)", () => {
  it("View current toggles to the live renderer and back without touching the pin", async () => {
    getPinMock.mockResolvedValue(frozenPin);
    liveIdentityMock.mockResolvedValue("MOVED-ON-INCHI");
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: SIDECAR }}
      />,
    );
    // Frozen by default, live renderer not mounted.
    await waitFor(() => expect(screen.getByText(STALE_TEXT)).toBeInTheDocument());
    expect(screen.getByText("Resveratrol (frozen)")).toBeInTheDocument();
    expect(screen.queryByTestId("live-molecule")).toBeNull();

    // View current -> the live renderer mounts, the frozen card is gone.
    fireEvent.click(screen.getByRole("button", { name: "View current" }));
    await waitFor(() =>
      expect(screen.getByTestId("live-molecule")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Resveratrol (frozen)")).toBeNull();
    // Pin was never modified by viewing current.
    expect(updatePinMock).not.toHaveBeenCalled();

    // Show frozen -> back to the frozen snapshot.
    fireEvent.click(screen.getByRole("button", { name: "Show frozen" }));
    await waitFor(() =>
      expect(screen.getByText("Resveratrol (frozen)")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("live-molecule")).toBeNull();
  });

  it("View current works in read-only preview but Re-freeze does NOT show there", async () => {
    // sidecarPath present but no onPin / onUnpin = read-only preview host. View
    // current is view-only state, so it must still work; Re-freeze (an editing
    // action) must NOT show.
    getPinMock.mockResolvedValue(frozenPin);
    liveIdentityMock.mockResolvedValue("MOVED-ON-INCHI");
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: SIDECAR }}
      />,
    );
    await waitFor(() => expect(screen.getByText(STALE_TEXT)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "View current" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-freeze" })).toBeNull();
  });

  it("Re-freeze shows in an editor host (onUnpin closure present)", async () => {
    getPinMock.mockResolvedValue(frozenPin);
    liveIdentityMock.mockResolvedValue("MOVED-ON-INCHI");
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: SIDECAR, onUnpin: vi.fn() }}
      />,
    );
    await waitFor(() => expect(screen.getByText(STALE_TEXT)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Re-freeze" })).toBeInTheDocument();
  });

  it("Re-freeze recaptures the snapshot, updates the SAME id, and clears the badge", async () => {
    getPinMock.mockResolvedValue(frozenPin);
    liveIdentityMock.mockResolvedValue("MOVED-ON-INCHI");
    const refreshed: EmbedPin = {
      ...frozenPin,
      pinnedAt: "2026-06-13T00:00:00.000Z",
      identity: "MOVED-ON-INCHI",
      snapshot: { ...frozenPin.snapshot, title: "Resveratrol (re-frozen)" } as EmbedPin["snapshot"],
    };
    buildPinMock.mockResolvedValue(refreshed);
    updatePinMock.mockResolvedValue();

    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: SIDECAR, onUnpin: vi.fn() }}
      />,
    );
    await waitFor(() => expect(screen.getByText(STALE_TEXT)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Re-freeze" }));

    // updatePin called with the SAME short id from the fragment (s_abc123).
    await waitFor(() =>
      expect(updatePinMock).toHaveBeenCalledWith(SIDECAR, "s_abc123", refreshed),
    );
    expect(buildPinMock).toHaveBeenCalledWith(pinnedDescriptor, "Resveratrol", undefined);

    // The badge clears and the refreshed frozen snapshot now shows.
    await waitFor(() => expect(screen.queryByText(STALE_TEXT)).toBeNull());
    expect(screen.getByText("Resveratrol (re-frozen)")).toBeInTheDocument();
  });
});

describe("ObjectEmbed Edit markdown button (Change 1)", () => {
  it("Edit markdown button does NOT appear when onEditMarkdown is not supplied", async () => {
    getPinMock.mockResolvedValue(null);
    render(
      <ObjectEmbed
        descriptor={{ ...pinnedDescriptor, opts: {} }}
        caption="Resveratrol"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("live-molecule")).toBeInTheDocument(),
    );
    // The button must be absent in a read-only / preview context.
    expect(
      screen.queryByRole("button", { name: /Edit markdown/ }),
    ).toBeNull();
  });

  it("Edit markdown button appears and fires the callback when onEditMarkdown is supplied", async () => {
    getPinMock.mockResolvedValue(null);
    const onEditMarkdown = vi.fn();
    render(
      <ObjectEmbed
        descriptor={{ ...pinnedDescriptor, opts: {} }}
        caption="Resveratrol"
        onEditMarkdown={onEditMarkdown}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("live-molecule")).toBeInTheDocument(),
    );
    const btn = screen.getByRole("button", { name: /Edit markdown/i });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onEditMarkdown).toHaveBeenCalledTimes(1);
  });

  it("Edit markdown button appears even on a frozen embed (editor context)", async () => {
    getPinMock.mockResolvedValue(frozenPin);
    const onEditMarkdown = vi.fn();
    render(
      <ObjectEmbed
        descriptor={pinnedDescriptor}
        caption="Resveratrol"
        pinContext={{ sidecarPath: SIDECAR }}
        onEditMarkdown={onEditMarkdown}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Resveratrol (frozen)")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /Edit markdown/i }),
    ).toBeInTheDocument();
  });
});
