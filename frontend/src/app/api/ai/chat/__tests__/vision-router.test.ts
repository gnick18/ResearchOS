// Unit tests for the vision router pure helpers (BeakerBot vision, 2026-06-13).
//
// hasImageContent and selectModel are pure functions; they only need the
// RouterMessage type and carry no server or network dependencies. This file
// imports them directly from vision-router.ts to avoid pulling in next-auth or
// any Next.js server modules (which fail in the COW-cloned worktree).
//
// Test cases cover the full routing decision table:
//   - image present AND visionModel set -> vision model
//   - image present AND visionModel unset -> text model (safe fallback)
//   - image present AND visionModel empty string -> text model (safe fallback)
//   - no image, any visionModel -> text model
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect } from "vitest";
import { hasImageContent, selectModel } from "../vision-router";

// ---------------------------------------------------------------------------
// hasImageContent
// ---------------------------------------------------------------------------

describe("hasImageContent", () => {
  it("returns false for a text-only message (string content)", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    expect(hasImageContent(messages)).toBe(false);
  });

  it("returns false for messages with null content", () => {
    const messages = [
      { role: "assistant", content: null },
    ];
    expect(hasImageContent(messages)).toBe(false);
  });

  it("returns false for a block array with only text blocks", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "what is a Tm?" }],
      },
    ];
    expect(hasImageContent(messages)).toBe(false);
  });

  it("returns true when one message has an image_url block", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "describe this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
        ],
      },
    ];
    expect(hasImageContent(messages)).toBe(true);
  });

  it("returns true when a later message has an image_url block", () => {
    const messages = [
      { role: "user", content: "first turn" },
      { role: "assistant", content: "reply" },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,img" } },
        ],
      },
    ];
    expect(hasImageContent(messages)).toBe(true);
  });

  it("returns false for an empty message array", () => {
    expect(hasImageContent([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectModel
// ---------------------------------------------------------------------------

describe("selectModel", () => {
  it("returns the text model for a text-only turn", () => {
    const messages = [{ role: "user", content: "hello" }];
    expect(
      selectModel(messages, { textModel: "gpt-text", visionModel: "llama-vision" }),
    ).toBe("gpt-text");
  });

  it("returns the vision model when an image turn is present and visionModel is set", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "what is in this image" },
          { type: "image_url", image_url: { url: "data:image/png;base64,xyz" } },
        ],
      },
    ];
    expect(
      selectModel(messages, { textModel: "gpt-text", visionModel: "llama-vision" }),
    ).toBe("llama-vision");
  });

  it("falls back to the text model when image is present but visionModel is undefined", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,xyz" } },
        ],
      },
    ];
    expect(
      selectModel(messages, { textModel: "gpt-text", visionModel: undefined }),
    ).toBe("gpt-text");
  });

  it("falls back to the text model when image is present but visionModel is an empty string", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,xyz" } },
        ],
      },
    ];
    expect(
      selectModel(messages, { textModel: "gpt-text", visionModel: "" }),
    ).toBe("gpt-text");
  });

  it("returns the text model even when visionModel is set but no images are present", () => {
    const messages = [
      { role: "system", content: "you are a lab assistant" },
      { role: "user", content: "list my experiments" },
    ];
    expect(
      selectModel(messages, {
        textModel: "accounts/fireworks/models/gpt-oss-120b",
        visionModel: "accounts/fireworks/models/llama-v3p2-11b-vision-instruct",
      }),
    ).toBe("accounts/fireworks/models/gpt-oss-120b");
  });
});
