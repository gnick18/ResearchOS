import { describe, expect, it } from "vitest";
import {
  appendArtifact,
  autoSentinel,
  decodeMethodSource,
  encodeMethodId,
  encodeSettingsChangeId,
  findArtifact,
  isAutoSentinel,
  wasUserSkipped,
} from "../lib/wizard-artifacts";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

/**
 * Unit tests for the pure-function helpers W1-W9 use to track
 * artifacts and auto-prerequisite sentinels in the sidecar. No I/O,
 * no React — straight-up data shape checks. Lives under the
 * walkthrough/ tree so node-env vitest picks it up automatically
 * (`src/**\/*.test.ts`).
 */

function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
    ...patch,
  };
}

describe("autoSentinel / isAutoSentinel", () => {
  it("round-trips a step id through the auto sentinel format", () => {
    const s = autoSentinel("W1");
    expect(s).toBe("auto:W1");
    expect(isAutoSentinel(s)).toBe(true);
    expect(isAutoSentinel("W1")).toBe(false);
    expect(isAutoSentinel("lab_tour_decision:later")).toBe(false);
  });
});

describe("wasUserSkipped", () => {
  it("returns true only for bare step ids in skipped_steps", () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W3",
        skipped_steps: ["W1", "auto:W2", "lab_tour_decision:later"],
        artifacts_created: [],
      },
    });
    expect(wasUserSkipped(sidecar, "W1")).toBe(true);
    expect(wasUserSkipped(sidecar, "W2")).toBe(false);
    expect(wasUserSkipped(sidecar, "W3")).toBe(false);
    expect(wasUserSkipped(null, "W1")).toBe(false);
  });
});

describe("findArtifact", () => {
  it("returns the first artifact of the requested type or null", () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W4",
        skipped_steps: [],
        artifacts_created: [
          { type: "project", id: "5", cleanup_default: "keep" },
          { type: "method", id: "9:placeholder", cleanup_default: "keep" },
        ],
      },
    });
    expect(findArtifact(sidecar, "project")?.id).toBe("5");
    expect(findArtifact(sidecar, "method")?.id).toBe("9:placeholder");
    expect(findArtifact(sidecar, "experiment")).toBeNull();
    expect(findArtifact(null, "project")).toBeNull();
  });
});

describe("appendArtifact", () => {
  it("appends a new artifact and (optionally) a sentinel", () => {
    const result = appendArtifact(
      baseSidecar(),
      { type: "project", id: "7", cleanup_default: "discard" },
      [autoSentinel("W1")],
    );
    expect(result.wizard_resume_state).not.toBeNull();
    expect(result.wizard_resume_state?.artifacts_created).toEqual([
      { type: "project", id: "7", cleanup_default: "discard" },
    ]);
    expect(result.wizard_resume_state?.skipped_steps).toEqual(["auto:W1"]);
  });

  it("is idempotent on the artifact (same type+id is not duplicated)", () => {
    const seeded = baseSidecar({
      wizard_resume_state: {
        current_step: "W3",
        skipped_steps: [],
        artifacts_created: [
          { type: "project", id: "7", cleanup_default: "keep" },
        ],
      },
    });
    const result = appendArtifact(seeded, {
      type: "project",
      id: "7",
      cleanup_default: "discard",
    });
    expect(result.wizard_resume_state?.artifacts_created).toHaveLength(1);
    expect(result.wizard_resume_state?.artifacts_created[0].cleanup_default).toBe(
      "keep",
    );
  });

  it("is idempotent on the sentinel array", () => {
    const seeded = baseSidecar({
      wizard_resume_state: {
        current_step: "W3",
        skipped_steps: ["auto:W1"],
        artifacts_created: [],
      },
    });
    const result = appendArtifact(
      seeded,
      { type: "project", id: "1", cleanup_default: "discard" },
      [autoSentinel("W1")],
    );
    expect(result.wizard_resume_state?.skipped_steps).toEqual(["auto:W1"]);
  });

  it("preserves prior skipped_steps when appending new sentinels", () => {
    const seeded = baseSidecar({
      wizard_resume_state: {
        current_step: "W3",
        skipped_steps: ["lab_tour_decision:later", "W1"],
        artifacts_created: [],
      },
    });
    const result = appendArtifact(
      seeded,
      { type: "project", id: "1", cleanup_default: "discard" },
      [autoSentinel("W1")],
    );
    expect(result.wizard_resume_state?.skipped_steps).toEqual([
      "lab_tour_decision:later",
      "W1",
      "auto:W1",
    ]);
  });
});

describe("encodeMethodId / decodeMethodSource", () => {
  it("round-trips both sources", () => {
    const encoded = encodeMethodId(42, "placeholder");
    expect(encoded).toBe("42:placeholder");
    expect(decodeMethodSource(encoded)).toEqual({
      methodId: 42,
      source: "placeholder",
    });
    const encoded2 = encodeMethodId(7, "user-file");
    expect(decodeMethodSource(encoded2)).toEqual({
      methodId: 7,
      source: "user-file",
    });
  });

  it("returns null on malformed ids", () => {
    expect(decodeMethodSource("nan:placeholder")).toBeNull();
    expect(decodeMethodSource("42:bogus")).toBeNull();
  });
});

describe("encodeSettingsChangeId", () => {
  it("uses the U+2192 arrow as the separator", () => {
    expect(encodeSettingsChangeId("color", "#aaa", "#bbb")).toBe(
      "color:#aaa→#bbb",
    );
  });
});
