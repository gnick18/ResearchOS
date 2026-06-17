/**
 * Unit tests for the pure form-error helpers in useFormErrors.ts.
 * These exercise applyError, hasErrors, and errorFields — the parts that
 * don't need a React harness.
 */

import { describe, expect, it } from "vitest";
import { applyError, errorFields, hasErrors } from "./useFormErrors";

describe("applyError", () => {
  it("adds a new error entry", () => {
    const result = applyError({}, "title", "Title is required.");
    expect(result).toEqual({ title: "Title is required." });
  });

  it("overwrites an existing error", () => {
    const start = { title: "old" };
    const result = applyError(start, "title", "new message");
    expect(result.title).toBe("new message");
  });

  it("removes the field when message is undefined", () => {
    const start = { title: "Title is required.", url: "URL is required." };
    const result = applyError(start, "title", undefined);
    expect(result).not.toHaveProperty("title");
    expect(result.url).toBe("URL is required.");
  });

  it("removes the field when message is an empty string", () => {
    const start = { title: "error" };
    const result = applyError(start, "title", "");
    expect(result).not.toHaveProperty("title");
  });

  it("does not mutate the original map", () => {
    const original = { title: "error" };
    applyError(original, "url", "URL required.");
    expect(original).not.toHaveProperty("url");
  });
});

describe("hasErrors", () => {
  it("returns false for an empty map", () => {
    expect(hasErrors({})).toBe(false);
  });

  it("returns false when all values are undefined", () => {
    expect(hasErrors({ title: undefined, url: undefined })).toBe(false);
  });

  it("returns true when at least one field has a message", () => {
    expect(hasErrors({ title: "required", url: undefined })).toBe(true);
  });

  it("returns true when all fields have messages", () => {
    expect(hasErrors({ title: "required", url: "invalid" })).toBe(true);
  });
});

describe("errorFields", () => {
  it("returns empty array for an empty map", () => {
    expect(errorFields({})).toEqual([]);
  });

  it("returns only the fields with defined messages", () => {
    const errors = { title: "required", url: undefined, endDate: "end before start" };
    expect(errorFields(errors)).toEqual(["title", "endDate"]);
  });

  it("preserves insertion order", () => {
    const errors = { endDate: "end before start", title: "required" };
    expect(errorFields(errors)).toEqual(["endDate", "title"]);
  });
});
