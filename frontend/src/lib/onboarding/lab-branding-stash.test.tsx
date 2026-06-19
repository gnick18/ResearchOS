// Regression coverage for the wizard -> LabCreateResume lab-branding bridge.
//
// The bug this guards: the PI / lab Create wizard captured the lab name but
// dropped it, so the lab was provisioned nameless and the setup prompt re-fired
// with the head's username. The bridge must round-trip the captured text
// branding (via sessionStorage, survives reload) and the logo (in memory), and
// consuming must read-and-clear so a later reload cannot double-apply.
//
// Runs in jsdom (.tsx) so window.sessionStorage exists.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { afterEach, describe, expect, it } from "vitest";
import {
  stashLabBranding,
  stashLabLogo,
  consumeLabBranding,
  consumeLabLogo,
} from "./lab-branding-stash";
import type { PreparedLogo } from "@/lib/lab/lab-logo-image";

afterEach(() => {
  // Drain any leftover stash so cases stay independent.
  consumeLabBranding();
  consumeLabLogo();
  window.sessionStorage.clear();
});

describe("lab branding stash", () => {
  it("round-trips the captured text branding", () => {
    stashLabBranding({
      labName: "Fungal Interactions Lab",
      piTitle: "Dr.",
      piDisplay: "Emile Gluck-Thaler",
    });
    expect(consumeLabBranding()).toEqual({
      labName: "Fungal Interactions Lab",
      piTitle: "Dr.",
      piDisplay: "Emile Gluck-Thaler",
    });
  });

  it("consume read-and-clears so a second consume returns null", () => {
    stashLabBranding({ labName: "Lab", piTitle: "", piDisplay: "" });
    expect(consumeLabBranding()).not.toBeNull();
    expect(consumeLabBranding()).toBeNull();
  });

  it("returns null when nothing was stashed (the chooser path)", () => {
    expect(consumeLabBranding()).toBeNull();
  });

  it("survives a simulated reload via sessionStorage", () => {
    stashLabBranding({ labName: "Reload Lab", piTitle: "Prof.", piDisplay: "PI" });
    // A reload drops in-memory module state but keeps sessionStorage. The text
    // branding must still come back; only the logo (in memory) is lost.
    expect(window.sessionStorage.getItem("researchos:lab-branding")).not.toBeNull();
    expect(consumeLabBranding()?.labName).toBe("Reload Lab");
  });

  it("round-trips the logo in memory and clears it on consume", () => {
    const logo: PreparedLogo = {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      previewUrl: "blob:fake",
    };
    stashLabLogo(logo);
    expect(consumeLabLogo()).toBe(logo);
    expect(consumeLabLogo()).toBeNull();
  });

  it("tolerates a corrupt sessionStorage payload", () => {
    window.sessionStorage.setItem("researchos:lab-branding", "{not json");
    expect(consumeLabBranding()).toBeNull();
  });
});
