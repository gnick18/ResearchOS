/**
 * R4 Lab Overview tour — sharing primitive step shape tests.
 *
 * Covers id, pose, target selector (optional anchor — may or may not
 * be mounted depending on the user's canvas state), manual completion,
 * and the lab-only gate. The cursor script degrades to no actions when
 * no record on the canvas exposes a share button anchor, which is the
 * common case for a brand-new lab.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { labOverviewSharingStep } from "../LabOverviewSharingStep";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("labOverviewSharingStep shape", () => {
  it("exposes id, pose, target selector, manual completion, gate", () => {
    expect(labOverviewSharingStep.id).toBe("lab-overview-sharing");
    expect(labOverviewSharingStep.pose).toBe("pointing");
    expect(labOverviewSharingStep.targetSelector).toBe(
      `[data-tour-target="lab-overview-share-button"]`,
    );
    expect(labOverviewSharingStep.completion.type).toBe("manual");
    expect(labOverviewSharingStep.expectedRoute).toBe("/lab-overview");
    // setup-q1c lab head manager 2026-05-23: gate is now `lab_head ===
    // true`. Lab members skip the cluster; only lab heads see it.
    const gate = labOverviewSharingStep.conditionalOn!;
    expect(gate({ account_type: "lab", lab_head: true })).toBe(true);
    expect(gate({ account_type: "lab", lab_head: false })).toBe(false);
    expect(gate({ account_type: "lab" })).toBe(false);
    expect(gate({ account_type: "solo" })).toBe(false);
  });

  it("renders the body without crashing", () => {
    const speechNode =
      typeof labOverviewSharingStep.speech === "function"
        ? labOverviewSharingStep.speech()
        : labOverviewSharingStep.speech;
    const { getByTestId } = render(<>{speechNode}</>);
    expect(getByTestId("lab-overview-sharing")).toBeTruthy();
  });

  it(
    "cursorScript degrades to no actions when no record exposes the share-button anchor",
    async () => {
      document.body.innerHTML = "";
      const actions = await labOverviewSharingStep.cursorScript?.();
      expect(actions).toEqual([]);
    },
    10_000,
  );

  it("cursorScript produces a glide action when a share button is mounted", async () => {
    document.body.innerHTML =
      '<button data-tour-target="lab-overview-share-button">Share</button>';
    const actions = await labOverviewSharingStep.cursorScript?.();
    expect(actions).toBeTruthy();
    expect(actions!.length).toBeGreaterThan(0);
  });
});
