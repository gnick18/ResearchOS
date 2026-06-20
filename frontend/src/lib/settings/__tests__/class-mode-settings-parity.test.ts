// Class Mode (CM-P1) settings flag-off parity guard.
//
// The new class-shaped fields (lab_kind, classConfig) are additive + optional +
// nullable. They must NEVER appear in DEFAULT_SETTINGS, so a flag-off account's
// settings.json is byte-identical to before class mode: no new keys are written
// unless the class provisioner explicitly sets them. This test pins that, so a
// future edit that accidentally seeds a class default into DEFAULT_SETTINGS fails
// here rather than silently bloating every settings.json on disk.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../user-settings";

describe("Class Mode settings flag-off parity", () => {
  it("DEFAULT_SETTINGS does not carry lab_kind (absent => research lab)", () => {
    expect("lab_kind" in DEFAULT_SETTINGS).toBe(false);
  });

  it("DEFAULT_SETTINGS does not carry classConfig (absent on every non-class folder)", () => {
    expect("classConfig" in DEFAULT_SETTINGS).toBe(false);
  });

  it("DEFAULT_SETTINGS mirrors the lab_id precedent (no lab discriminator seeded)", () => {
    // lab_id is the established additive-optional lab field that is absent by
    // default. lab_kind + classConfig must follow the same absent-by-default
    // posture so a solo / research-lab settings.json is unchanged.
    expect("lab_id" in DEFAULT_SETTINGS).toBe(false);
  });
});
