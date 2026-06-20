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
  it("has sign-in, identity, folder in order (merged handle+profile+greeting)", () => {
    expect(ids(buildSoloFreeTrack())).toEqual([
      "sign-in",
      "identity",
      "folder",
    ]);
  });

  it("makes every step required (handle is required in the merged identity step)", () => {
    // Go-live: the folder step is unskippable (no folder = no app). The merged
    // identity step is also unskippable because the handle inside it is required;
    // the rest of the profile is optional on the page itself, so it never
    // soft-locks.
    expect(skips(buildSoloFreeTrack())).toEqual([false, false, false]);
  });
});

describe("buildSoloLocalTrack", () => {
  it("is a folder step plus the skippable preferred-name closer", () => {
    const track = buildSoloLocalTrack();
    expect(ids(track)).toEqual(["folder", "preferred-name"]);
  });

  it("the folder step is required (go-live: no folder = no app); name is skippable", () => {
    expect(skips(buildSoloLocalTrack())).toEqual([false, true]);
  });
});

describe("buildPiCreateTrack", () => {
  it("has sign-in, identity, lab-setup, folder in order (merged identity step)", () => {
    expect(ids(buildPiCreateTrack())).toEqual([
      "sign-in",
      "identity",
      "lab-setup",
      "folder",
    ]);
  });

  it("makes every step required (identity holds the required handle)", () => {
    expect(skips(buildPiCreateTrack())).toEqual([false, false, false, false]);
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

    // The handle is claimed DURING the wizard (the merged identity step submit
    // forwards it), after the track was built.
    const identityEl = elementFor(stepById(track, "identity"), stubControls());
    (identityEl.props as { onSubmit: (h: string) => void }).onSubmit("egt");

    // The lab step, rendered after the claim, must see the fresh handle.
    const labEl = elementFor(stepById(track, "lab-setup"), stubControls());
    expect((labEl.props as { defaultPiDisplay?: string }).defaultPiDisplay).toBe(
      "egt",
    );
  });

  it("the identity step submit forwards the claimed handle and advances", () => {
    const onHandleClaimed = vi.fn();
    const controls = stubControls();
    const track = buildPiCreateTrack({ onHandleClaimed });
    const el = elementFor(stepById(track, "identity"), controls);
    (el.props as { onSubmit: (h: string) => void }).onSubmit("egt");
    expect(onHandleClaimed).toHaveBeenCalledWith("egt");
    expect(controls.next).toHaveBeenCalledTimes(1);
  });
});
