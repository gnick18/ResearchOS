// Focused coverage for the chooser's bottom-zone org-admin entry (Phase 5). The
// entry is purely additive: hidden unless the onboarding wizard flag is on, the
// host wired onOrgAdmin, and a matching org tier flag is on. Each org option is
// gated on its own tier flag, and clicking it fires onOrgAdmin with the kind.
//
// Heavy decorative children (BeakerBot scenes, the landing backdrop, the
// provider buttons) are mocked so the test stays focused on the gating logic.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const flags = vi.hoisted(() => ({
  wizard: true,
  dept: true,
  institution: true,
  oauth: false,
  lab: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/onboarding/config", () => ({
  get ONBOARDING_WIZARD_ENABLED() {
    return flags.wizard;
  },
}));
vi.mock("@/lib/dept/config", () => ({
  get DEPT_TIER_ENABLED() {
    return flags.dept;
  },
}));
vi.mock("@/lib/institution/config", () => ({
  get INSTITUTION_TIER_ENABLED() {
    return flags.institution;
  },
}));
vi.mock("@/lib/lab/config", () => ({
  get LAB_TIER_ENABLED() {
    return flags.lab;
  },
}));
vi.mock("@/lib/sharing/oauth-availability", () => ({
  isOAuthPublishAvailable: () => flags.oauth,
  isDevMockAuth: () => false,
  isMicrosoftAuthEnabled: () => false,
}));
vi.mock("@/lib/sharing/oauth-first-login", () => ({
  isOAuthFirstLoginEnabled: () => false,
}));
vi.mock("@/lib/sharing/oauth-first-signin", () => ({
  startOAuthFirstSignIn: vi.fn(),
}));
vi.mock("@/lib/landing/landing-gate", () => ({ markLandingSeen: vi.fn() }));
vi.mock("@/components/onboarding/BeakerBotScene", () => ({
  BeakerBotScene: () => <div data-testid="mock-scene" />,
}));
vi.mock("@/components/onboarding/oauth-first/LandingBackdrop", () => ({
  default: () => <div data-testid="mock-backdrop" />,
}));
vi.mock("@/components/sharing/SharingProviderButtons", () => ({
  default: () => <div data-testid="mock-providers" />,
}));

import { AccountTierChooser } from "./AccountTierChooser";

describe("AccountTierChooser org-admin bottom-zone entry", () => {
  beforeEach(() => {
    flags.wizard = true;
    flags.dept = true;
    flags.institution = true;
    flags.oauth = false;
    flags.lab = false;
  });

  it("shows both org options when the wizard + both tier flags are on", () => {
    render(<AccountTierChooser onLocal={vi.fn()} onOrgAdmin={vi.fn()} />);
    expect(screen.getByTestId("chooser-org-zone")).toBeInTheDocument();
    expect(screen.getByTestId("chooser-org-dept")).toBeInTheDocument();
    expect(screen.getByTestId("chooser-org-institution")).toBeInTheDocument();
  });

  it("fires onOrgAdmin with the kind on click", () => {
    const onOrgAdmin = vi.fn();
    render(<AccountTierChooser onLocal={vi.fn()} onOrgAdmin={onOrgAdmin} />);
    fireEvent.click(screen.getByTestId("chooser-org-dept"));
    expect(onOrgAdmin).toHaveBeenCalledWith("department");
    fireEvent.click(screen.getByTestId("chooser-org-institution"));
    expect(onOrgAdmin).toHaveBeenCalledWith("institution");
  });

  it("hides the org zone entirely when the wizard flag is off", () => {
    flags.wizard = false;
    render(<AccountTierChooser onLocal={vi.fn()} onOrgAdmin={vi.fn()} />);
    expect(screen.queryByTestId("chooser-org-zone")).not.toBeInTheDocument();
  });

  it("hides the org zone when onOrgAdmin is not wired", () => {
    render(<AccountTierChooser onLocal={vi.fn()} />);
    expect(screen.queryByTestId("chooser-org-zone")).not.toBeInTheDocument();
  });

  it("shows only the department option when only the dept flag is on", () => {
    flags.institution = false;
    render(<AccountTierChooser onLocal={vi.fn()} onOrgAdmin={vi.fn()} />);
    expect(screen.getByTestId("chooser-org-dept")).toBeInTheDocument();
    expect(
      screen.queryByTestId("chooser-org-institution"),
    ).not.toBeInTheDocument();
  });

  it("hides the org zone when both tier flags are off", () => {
    flags.dept = false;
    flags.institution = false;
    render(<AccountTierChooser onLocal={vi.fn()} onOrgAdmin={vi.fn()} />);
    expect(screen.queryByTestId("chooser-org-zone")).not.toBeInTheDocument();
  });
});
