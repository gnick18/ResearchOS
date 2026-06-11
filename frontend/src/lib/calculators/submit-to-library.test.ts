// frontend/src/lib/calculators/submit-to-library.test.ts
//
// Custom Calculator Builder Phase 4 (calculator manager) coverage for the
// "Share to the library" submission URL builder. It must produce a GitHub
// new-issue URL through the same rail the feedback button uses:
//   - points at the real repo + issues/new
//   - tags the title with the calculator name
//   - carries the calculator-submission label
//   - folds the portable spec into the body as JSON
//   - drops the runtime-only fields (id, timestamps, owner, share state)

import { describe, expect, it } from "vitest";
import {
  buildCalculatorSubmissionUrl,
  CALCULATOR_SUBMISSION_INTRO,
  CALCULATOR_SUBMISSION_LABEL,
  toPortableSpec,
} from "./submit-to-library";
import type { CustomCalculator } from "@/lib/types";

function makeCalc(over: Partial<CustomCalculator> = {}): CustomCalculator {
  return {
    id: 7,
    name: "CFU per mL",
    description: "Colonies to titre.",
    field: "Microbiology",
    inputs: [
      { key: "colonies", type: "number", label: "Colonies counted" },
      { key: "dilution", type: "number", label: "Dilution factor" },
    ],
    steps: [{ key: "titre", expr: "colonies * dilution" }],
    conditionals: [{ expr: 'if(colonies < 1, "No growth", "")' }],
    outputs: [{ label: "CFU/mL", expr: "titre", unit: "CFU/mL" }],
    shared_with: [{ username: "*", level: "read" }],
    created_at: "2026-06-10T00:00:00.000Z",
    updated_at: "2026-06-10T00:00:00.000Z",
    owner: "alex",
    is_shared_with_me: true,
    ...over,
  };
}

function parse(url: string): URL {
  return new URL(url);
}

describe("buildCalculatorSubmissionUrl()", () => {
  it("builds a GitHub new-issue URL against the project repo", () => {
    const u = parse(buildCalculatorSubmissionUrl(makeCalc()));
    expect(u.origin + u.pathname).toBe(
      "https://github.com/gnick18/ResearchOS/issues/new",
    );
  });

  it("tags the title with the calculator name", () => {
    const u = parse(buildCalculatorSubmissionUrl(makeCalc()));
    const title = u.searchParams.get("title") ?? "";
    expect(title).toContain("Calculator submission");
    expect(title).toContain("CFU per mL");
  });

  it("carries the calculator-submission label", () => {
    const u = parse(buildCalculatorSubmissionUrl(makeCalc()));
    expect(u.searchParams.get("labels")).toBe(CALCULATOR_SUBMISSION_LABEL);
  });

  it("frames the body with the reviewed-before-shipping intro", () => {
    const u = parse(buildCalculatorSubmissionUrl(makeCalc()));
    const body = u.searchParams.get("body") ?? "";
    expect(body).toContain(CALCULATOR_SUBMISSION_INTRO);
    expect(body).toContain("```json");
  });

  it("folds the calculator spec into the body, including its inputs", () => {
    const u = parse(buildCalculatorSubmissionUrl(makeCalc()));
    const body = u.searchParams.get("body") ?? "";
    expect(body).toContain('"name": "CFU per mL"');
    expect(body).toContain('"key": "colonies"');
    expect(body).toContain('"key": "dilution"');
    expect(body).toContain('"expr": "titre"');
  });

  it("strips the runtime-only fields from the serialized spec", () => {
    const body =
      parse(buildCalculatorSubmissionUrl(makeCalc())).searchParams.get("body") ??
      "";
    expect(body).not.toContain('"id"');
    expect(body).not.toContain("created_at");
    expect(body).not.toContain("updated_at");
    expect(body).not.toContain("shared_with");
    expect(body).not.toContain('"owner"');
    expect(body).not.toContain("is_shared_with_me");
  });

  it("toPortableSpec keeps the spec fields and drops the rest", () => {
    const spec = toPortableSpec(makeCalc());
    expect(spec).toMatchObject({
      name: "CFU per mL",
      description: "Colonies to titre.",
      field: "Microbiology",
    });
    expect(spec.inputs).toHaveLength(2);
    expect(spec).not.toHaveProperty("id");
    expect(spec).not.toHaveProperty("shared_with");
    expect(spec).not.toHaveProperty("owner");
  });

  it("omits an empty optional field rather than serializing a blank", () => {
    const spec = toPortableSpec(makeCalc({ field: undefined }));
    expect(spec).not.toHaveProperty("field");
  });

  it("falls back to a placeholder title when the name is blank", () => {
    const u = parse(buildCalculatorSubmissionUrl(makeCalc({ name: "  " })));
    expect(u.searchParams.get("title")).toContain("Untitled calculator");
  });
});
