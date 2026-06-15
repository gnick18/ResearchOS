// @vitest-environment jsdom
//
// Coverage for startOAuthFirstSignIn: the callback flags that drive the
// post-OAuth resume (keypair-mint, lab provisioning, wizard resume).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...a: unknown[]) => signIn(...a) }));
vi.mock("@/lib/landing/landing-gate", () => ({ markLandingSeen: vi.fn() }));
vi.mock("@/lib/sharing/oauth-first-login", () => ({ rememberLastProvider: vi.fn() }));

import { startOAuthFirstSignIn } from "./oauth-first-signin";

beforeEach(() => {
  signIn.mockClear();
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
});
afterEach(() => vi.clearAllMocks());

function lastCallbackUrl(): string {
  const call = signIn.mock.calls.at(-1);
  return (call?.[1] as { callbackUrl: string }).callbackUrl;
}

describe("startOAuthFirstSignIn", () => {
  it("uses the bare keypair-mint callback by default", () => {
    startOAuthFirstSignIn("google");
    expect(lastCallbackUrl()).toBe("/?sharingClaim=1");
    expect(sessionStorage.getItem("researchos:lab-create")).toBeNull();
  });

  it("sets the lab-create marker for the lab path", () => {
    startOAuthFirstSignIn("google", { labCreate: true });
    expect(sessionStorage.getItem("researchos:lab-create")).toBe("1");
    expect(lastCallbackUrl()).toBe("/?sharingClaim=1");
  });

  it("appends onbWizard=free, keeping sharingClaim, for the Free wizard", () => {
    startOAuthFirstSignIn("google", { onboardingWizard: "free" });
    expect(lastCallbackUrl()).toBe("/?sharingClaim=1&onbWizard=free");
  });

  it("carries both the lab-create marker and onbWizard=lab for the PI wizard", () => {
    startOAuthFirstSignIn("google", { labCreate: true, onboardingWizard: "lab" });
    expect(sessionStorage.getItem("researchos:lab-create")).toBe("1");
    expect(lastCallbackUrl()).toBe("/?sharingClaim=1&onbWizard=lab");
  });
});
