// Unit coverage for the research-track builders: step order, ids, and the
// per-step skip flags from the spec's skip table.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import {
  buildSoloFreeTrack,
  buildSoloLocalTrack,
  buildPiCreateTrack,
} from "./tracks";
import type { WizardStep, WizardStepControls } from "./wizard-model";

/** A no-op controls object so a step body can be rendered to an element. */
function stubControls(over: Partial<WizardStepControls> = {}): WizardStepControls {
  return {
    next: vi.fn(),
    back: vi.fn(),
    skip: vi.fn(),
    close: vi.fn(),
    index: 0,
    total: 1,
    ...over,
  };
}

/** Render a step body to its React element so its props can be inspected. */
function elementFor(
  step: WizardStep,
  controls: WizardStepControls,
): ReactElement {
  return step.render(controls) as ReactElement;
}

function stepById(
  track: ReturnType<typeof buildPiCreateTrack>,
  id: string,
): WizardStep {
  const step = track.steps.find((s) => s.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step;
}

function ids(track: ReturnType<typeof buildSoloFreeTrack>) {
  return track.steps.map((s) => s.id);
}
function skips(track: ReturnType<typeof buildSoloFreeTrack>) {
  return track.steps.map((s) => Boolean(s.skippable));
}

describe("buildSoloFreeTrack", () => {
  it("has sign-in, handle, profile, folder in order", () => {
    expect(ids(buildSoloFreeTrack())).toEqual([
      "sign-in",
      "handle",
      "profile",
      "folder",
    ]);
  });

  it("makes sign-in, handle, and folder required; only profile skippable", () => {
    // Go-live: the folder step is unskippable (no folder = no app). The demo
    // escape FolderStep renders is the only way past it without connecting.
    expect(skips(buildSoloFreeTrack())).toEqual([false, false, true, false]);
  });
});

describe("buildSoloLocalTrack", () => {
  it("is a single folder-only step (no sign in / handle / profile)", () => {
    const track = buildSoloLocalTrack();
    expect(ids(track)).toEqual(["folder"]);
  });

  it("the lone folder step is required (go-live: no folder = no app)", () => {
    expect(skips(buildSoloLocalTrack())).toEqual([false]);
  });
});

describe("buildPiCreateTrack", () => {
  it("appends a non-skippable lab-setup step before the folder", () => {
    expect(ids(buildPiCreateTrack())).toEqual([
      "sign-in",
      "handle",
      "profile",
      "lab-setup",
      "folder",
    ]);
  });

  it("makes lab-setup and folder required (name to create, folder to work)", () => {
    expect(skips(buildPiCreateTrack())).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  // Regression: the wizard host once called buildPiCreateTrack() with no
  // callbacks, so the captured lab identity was dropped, the lab was created
  // nameless, and the setup prompt re-fired with the head's username. These
  // assert the lab-setup step actually forwards the captured branding.
  it("forwards the captured lab identity to onLabCaptured on submit", () => {
    const onLabCaptured = vi.fn();
    const controls = stubControls();
    const track = buildPiCreateTrack({ onLabCaptured });
    const el = elementFor(stepById(track, "lab-setup"), controls);
    const result = {
      labName: "Fungal Interactions Lab",
      piTitle: "Dr.",
      piDisplay: "Emile",
      logo: null,
    };
    (el.props as { onSubmit: (r: typeof result) => void }).onSubmit(result);
    expect(onLabCaptured).toHaveBeenCalledWith(result);
    expect(controls.next).toHaveBeenCalledTimes(1);
  });

  it("prefills the lab-setup PI display from the live handle getter", () => {
    let handle = "";
    const track = buildPiCreateTrack({
      onHandleClaimed: (h) => {
        handle = h;
      },
      defaultPiDisplay: () => handle,
    });

    // The handle is claimed DURING the wizard, after the track was built.
    const handleEl = elementFor(stepById(track, "handle"), stubControls());
    (handleEl.props as { onClaimed: (h: string) => void }).onClaimed("egt");

    // The lab step, rendered after the claim, must see the fresh handle.
    const labEl = elementFor(stepById(track, "lab-setup"), stubControls());
    expect((labEl.props as { defaultPiDisplay?: string }).defaultPiDisplay).toBe(
      "egt",
    );
  });
});
