// @vitest-environment jsdom
//
// Coverage for the research-wizard resume marker (?onbWizard=free|lab).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { afterEach, describe, expect, it } from "vitest";
import {
  readOnboardingWizardReturn,
  clearOnboardingWizardReturn,
  selectionForOnbWizardReturn,
} from "./onboarding-wizard-return";

function setUrl(search: string) {
  window.history.replaceState({}, "", search);
}

afterEach(() => setUrl("/"));

describe("readOnboardingWizardReturn", () => {
  it("reads free and lab from the URL", () => {
    setUrl("/?onbWizard=free");
    expect(readOnboardingWizardReturn()).toBe("free");
    setUrl("/?sharingClaim=1&onbWizard=lab");
    expect(readOnboardingWizardReturn()).toBe("lab");
  });

  it("returns null when absent or unrecognized", () => {
    setUrl("/?sharingClaim=1");
    expect(readOnboardingWizardReturn()).toBeNull();
    setUrl("/?onbWizard=bogus");
    expect(readOnboardingWizardReturn()).toBeNull();
  });
});

describe("selectionForOnbWizardReturn", () => {
  it("maps free -> solo-free and lab -> pi-create", () => {
    expect(selectionForOnbWizardReturn("free")).toBe("solo-free");
    expect(selectionForOnbWizardReturn("lab")).toBe("pi-create");
  });
});

describe("clearOnboardingWizardReturn", () => {
  it("strips only the marker, preserving other params", () => {
    setUrl("/?sharingClaim=1&onbWizard=free");
    clearOnboardingWizardReturn();
    expect(window.location.search).toBe("?sharingClaim=1");
    expect(readOnboardingWizardReturn()).toBeNull();
  });

  it("is a no-op when the marker is absent", () => {
    setUrl("/?sharingClaim=1");
    clearOnboardingWizardReturn();
    expect(window.location.search).toBe("?sharingClaim=1");
  });
});
