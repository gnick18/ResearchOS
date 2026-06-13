// Unit tests for the pure appendTranscript helper from useVoiceInput.
// (BeakerAI lane, 2026-06-13).
//
// The SpeechRecognition object cannot be unit-tested under jsdom (no audio
// pipeline), so these tests cover the pure logic only: how new transcript
// fragments are merged into an existing draft string.
//
// Cases:
//   - empty draft + new text     -> returns new text alone (no leading space)
//   - non-empty draft + new text -> joins with exactly one space
//   - trailing whitespace in draft is trimmed before joining (no double-space)
//   - leading whitespace in new text is trimmed before joining
//   - blank new text             -> draft is returned unchanged
//   - both empty                 -> returns empty string
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { appendTranscript } from "../useVoiceInput";

describe("appendTranscript (pure helper)", () => {
  it("returns the new text when the draft is empty", () => {
    expect(appendTranscript("", "hello world")).toBe("hello world");
  });

  it("returns the new text when the draft is only whitespace", () => {
    expect(appendTranscript("   ", "hello")).toBe("hello");
  });

  it("joins with a single space when the draft already has text", () => {
    expect(appendTranscript("mix the reagent", "at 4 degrees")).toBe(
      "mix the reagent at 4 degrees",
    );
  });

  it("does not double-space when the draft ends with a space", () => {
    expect(appendTranscript("mix the reagent ", "at 4 degrees")).toBe(
      "mix the reagent at 4 degrees",
    );
  });

  it("trims leading whitespace from the new text before joining", () => {
    expect(appendTranscript("pipette 50 ul", "  then vortex")).toBe(
      "pipette 50 ul then vortex",
    );
  });

  it("trims both trailing draft whitespace and leading new-text whitespace", () => {
    expect(appendTranscript("spin down  ", "  the sample")).toBe(
      "spin down the sample",
    );
  });

  it("returns the draft unchanged when the new text is empty", () => {
    expect(appendTranscript("incubate for 30 min", "")).toBe(
      "incubate for 30 min",
    );
  });

  it("returns the draft unchanged when the new text is only whitespace", () => {
    expect(appendTranscript("incubate for 30 min", "   ")).toBe(
      "incubate for 30 min",
    );
  });

  it("returns empty string when both draft and new text are empty", () => {
    expect(appendTranscript("", "")).toBe("");
  });

  it("handles multi-sentence dictation fragments correctly", () => {
    const draft = "Add 10 ul of buffer.";
    const fragment = "Vortex for five seconds.";
    expect(appendTranscript(draft, fragment)).toBe(
      "Add 10 ul of buffer. Vortex for five seconds.",
    );
  });
});
