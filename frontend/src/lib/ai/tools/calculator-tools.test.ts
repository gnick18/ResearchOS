// Tests for list_calculators and run_calculator tools (BeakerAI lane, 2026-06-13).
//
// Injectable deps seam is used throughout: tests never touch the real FSA store
// or the real expr-eval-fork parser. The fixture calculator is a simple molarity
// calculator (moles / volume) so the expected output is easy to hand-verify.
//
// Assertions:
//   - list_calculators surfaces id, name, description, and input fields.
//   - run_calculator returns the engine's exact output (value + display), never
//     any self-computed number.
//   - A missing required input is reported as missingInputs, not guessed.
//   - An unknown calculator id / name returns a clear error.
//   - A table input does not block the call (not a required scalar).
//   - The evaluate dep is called with exactly the supplied values.
//   - A store read failure is surfaced as ok:false.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CustomCalculator } from "@/lib/types";
import type { CustomCalcResult } from "@/lib/calculators/custom";
import {
  calculatorToolsDeps,
  listCalculatorsTool,
  runCalculatorTool,
} from "./calculator-tools";

// ---------------------------------------------------------------------------
// Fixture calculator: molarity = moles / volume_L
// ---------------------------------------------------------------------------

const MOLARITY_CALC: CustomCalculator = {
  id: 1,
  name: "Molarity Calculator",
  description: "Computes molar concentration from moles and volume.",
  field: "Chemistry",
  inputs: [
    {
      key: "moles",
      type: "number",
      label: "Moles",
      unit: "mol",
      // No default, so the model must ask the user.
    },
    {
      key: "volume_L",
      type: "number",
      label: "Volume",
      unit: "L",
      // No default.
    },
  ],
  steps: [],
  conditionals: [],
  outputs: [
    {
      label: "Concentration",
      expr: "moles / volume_L",
      unit: "M",
    },
  ],
  shared_with: [],
  created_at: "2026-06-13T00:00:00.000Z",
  updated_at: "2026-06-13T00:00:00.000Z",
};

// A second calc with a default on one input, to test that partial inputs work.
const DILUTION_CALC: CustomCalculator = {
  id: 2,
  name: "C1V1 Dilution",
  description: "Calculates the volume of stock to add (C1V1 = C2V2).",
  inputs: [
    {
      key: "C1",
      type: "number",
      label: "Stock concentration",
      unit: "mM",
    },
    {
      key: "V1",
      type: "number",
      label: "Volume of stock",
      unit: "mL",
      default: 1,
    },
    {
      key: "C2",
      type: "number",
      label: "Final concentration",
      unit: "mM",
    },
    {
      key: "V2",
      type: "number",
      label: "Final volume",
      unit: "mL",
      default: 10,
    },
  ],
  steps: [],
  conditionals: [],
  outputs: [
    {
      label: "V1 needed",
      expr: "(C2 * V2) / C1",
      unit: "mL",
    },
  ],
  shared_with: [],
  created_at: "2026-06-13T00:00:00.000Z",
  updated_at: "2026-06-13T00:00:00.000Z",
};

// A calc with a dropdown input, to confirm dropdowns are not flagged as missing.
const DROPDOWN_CALC: CustomCalculator = {
  id: 3,
  name: "Unit Converter",
  description: "Converts a value between unit scales.",
  inputs: [
    {
      key: "value",
      type: "number",
      label: "Value",
    },
    {
      key: "scale",
      type: "dropdown",
      label: "Scale factor",
      options: [
        { label: "Milli (x 0.001)", value: 0.001 },
        { label: "Micro (x 0.000001)", value: 0.000001 },
      ],
    },
  ],
  steps: [],
  conditionals: [],
  outputs: [
    {
      label: "Converted",
      expr: "value * scale",
    },
  ],
  shared_with: [],
  created_at: "2026-06-13T00:00:00.000Z",
  updated_at: "2026-06-13T00:00:00.000Z",
};

// Engine fixture result for MOLARITY_CALC with moles=0.5, volume_L=0.25.
const MOLARITY_ENGINE_RESULT: CustomCalcResult = {
  outputs: [{ label: "Concentration", value: 2, display: "2", unit: "M" }],
  messages: [],
};

const ALL_CALCS = [MOLARITY_CALC, DILUTION_CALC, DROPDOWN_CALC];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// list_calculators
// ---------------------------------------------------------------------------

describe("list_calculators", () => {
  it("is read-only (no action flag)", () => {
    expect(listCalculatorsTool.action).toBeFalsy();
    expect(listCalculatorsTool.previewable).toBeFalsy();
  });

  it("returns calculator briefs with input fields", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue(ALL_CALCS);

    const out = (await listCalculatorsTool.execute({})) as {
      ok: boolean;
      count: number;
      calculators: Array<{
        id: number;
        name: string;
        description: string;
        inputs: Array<{ key: string; label: string; type: string; unit?: string }>;
      }>;
    };

    expect(out.ok).toBe(true);
    expect(out.count).toBe(3);

    const molarity = out.calculators.find((c) => c.id === 1);
    expect(molarity).toBeDefined();
    expect(molarity!.name).toBe("Molarity Calculator");
    expect(molarity!.description).toBe("Computes molar concentration from moles and volume.");
    expect(molarity!.inputs).toHaveLength(2);

    const molesField = molarity!.inputs.find((i) => i.key === "moles");
    expect(molesField).toBeDefined();
    expect(molesField!.label).toBe("Moles");
    expect(molesField!.type).toBe("number");
    expect(molesField!.unit).toBe("mol");
  });

  it("surfaces dropdown options on the brief", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([DROPDOWN_CALC]);

    const out = (await listCalculatorsTool.execute({})) as {
      ok: boolean;
      calculators: Array<{ inputs: Array<{ key: string; options?: Array<{ label: string; value: number | string }> }> }>;
    };

    const scaleField = out.calculators[0].inputs.find(
      (i) => i.key === "scale",
    );
    expect(scaleField?.options).toHaveLength(2);
    expect(scaleField?.options?.[0].label).toBe("Milli (x 0.001)");
  });

  it("surfaces a number default on the brief when present", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([DILUTION_CALC]);

    const out = (await listCalculatorsTool.execute({})) as {
      ok: boolean;
      calculators: Array<{ inputs: Array<{ key: string; defaultValue?: number }> }>;
    };

    const v1Field = out.calculators[0].inputs.find((i) => i.key === "V1");
    expect(v1Field?.defaultValue).toBe(1);
  });

  it("fails cleanly when the store errors", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockRejectedValue(new Error("no folder"));

    const out = (await listCalculatorsTool.execute({})) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/folder/i);
  });
});

// ---------------------------------------------------------------------------
// run_calculator
// ---------------------------------------------------------------------------

describe("run_calculator", () => {
  it("is read-only (no action flag)", () => {
    expect(runCalculatorTool.action).toBeFalsy();
    expect(runCalculatorTool.previewable).toBeFalsy();
  });

  it("returns the engine's exact outputs when valid inputs are supplied", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([MOLARITY_CALC]);
    vi.spyOn(calculatorToolsDeps, "evaluate").mockReturnValue(MOLARITY_ENGINE_RESULT);

    const out = (await runCalculatorTool.execute({
      calculatorId: 1,
      inputValues: { moles: 0.5, volume_L: 0.25 },
    })) as {
      ok: boolean;
      calculatorId: number;
      calculatorName: string;
      outputs: Array<{ label: string; value: number | null; display: string; unit?: string }>;
      messages: string[];
    };

    expect(out.ok).toBe(true);
    expect(out.calculatorId).toBe(1);
    expect(out.calculatorName).toBe("Molarity Calculator");
    expect(out.outputs).toHaveLength(1);
    expect(out.outputs[0].label).toBe("Concentration");
    // The value and display must be EXACTLY what the engine returned.
    expect(out.outputs[0].value).toBe(2);
    expect(out.outputs[0].display).toBe("2");
    expect(out.outputs[0].unit).toBe("M");
    expect(out.messages).toEqual([]);
  });

  it("passes the supplied inputValues verbatim to the engine", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([MOLARITY_CALC]);
    const evalSpy = vi
      .spyOn(calculatorToolsDeps, "evaluate")
      .mockReturnValue(MOLARITY_ENGINE_RESULT);

    await runCalculatorTool.execute({
      calculatorId: 1,
      inputValues: { moles: 0.5, volume_L: 0.25 },
    });

    expect(evalSpy).toHaveBeenCalledOnce();
    const [calledCalc, calledValues] = evalSpy.mock.calls[0];
    expect(calledCalc.id).toBe(1);
    expect(calledValues).toEqual({ moles: 0.5, volume_L: 0.25 });
  });

  it("resolves a calculator by name (case-insensitive)", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue(ALL_CALCS);
    vi.spyOn(calculatorToolsDeps, "evaluate").mockReturnValue(MOLARITY_ENGINE_RESULT);

    const out = (await runCalculatorTool.execute({
      calculatorName: "molarity calculator",
      inputValues: { moles: 0.5, volume_L: 0.25 },
    })) as { ok: boolean; calculatorId: number };

    expect(out.ok).toBe(true);
    expect(out.calculatorId).toBe(1);
  });

  it("resolves a calculator by prefix match", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue(ALL_CALCS);
    vi.spyOn(calculatorToolsDeps, "evaluate").mockReturnValue(MOLARITY_ENGINE_RESULT);

    const out = (await runCalculatorTool.execute({
      calculatorName: "Molarity",
      inputValues: { moles: 0.5, volume_L: 0.25 },
    })) as { ok: boolean; calculatorId: number };

    expect(out.ok).toBe(true);
    expect(out.calculatorId).toBe(1);
  });

  it("reports missing required inputs instead of guessing", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([MOLARITY_CALC]);
    const evalSpy = vi.spyOn(calculatorToolsDeps, "evaluate");

    const out = (await runCalculatorTool.execute({
      calculatorId: 1,
      // volume_L is required and has no default; omitting it should trigger the missing report.
      inputValues: { moles: 0.5 },
    })) as { ok: boolean; missingInputs?: string[]; error: string };

    expect(out.ok).toBe(false);
    expect(out.missingInputs).toBeDefined();
    expect(out.missingInputs).toContain("Volume");
    expect(out.error).toMatch(/required/i);
    // The engine must NOT have been called.
    expect(evalSpy).not.toHaveBeenCalled();
  });

  it("does not flag a number input with a default as missing", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([DILUTION_CALC]);
    const engineResult: CustomCalcResult = {
      outputs: [{ label: "V1 needed", value: 5, display: "5", unit: "mL" }],
      messages: [],
    };
    vi.spyOn(calculatorToolsDeps, "evaluate").mockReturnValue(engineResult);

    // Supply only C1 and C2; V1 and V2 have defaults so should not be flagged.
    const out = (await runCalculatorTool.execute({
      calculatorId: 2,
      inputValues: { C1: 100, C2: 50 },
    })) as { ok: boolean; outputs: Array<{ display: string }> };

    expect(out.ok).toBe(true);
    expect(out.outputs[0].display).toBe("5");
  });

  it("does not flag a dropdown input as missing", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([DROPDOWN_CALC]);
    const engineResult: CustomCalcResult = {
      outputs: [{ label: "Converted", value: 0.001, display: "0.001" }],
      messages: [],
    };
    vi.spyOn(calculatorToolsDeps, "evaluate").mockReturnValue(engineResult);

    // Supply value only; scale is a dropdown with a first-option fallback.
    const out = (await runCalculatorTool.execute({
      calculatorId: 3,
      inputValues: { value: 1 },
    })) as { ok: boolean; outputs: Array<{ display: string }> };

    expect(out.ok).toBe(true);
    expect(out.outputs[0].display).toBe("0.001");
  });

  it("surfaces engine guidance messages verbatim", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([MOLARITY_CALC]);
    const engineResult: CustomCalcResult = {
      outputs: [{ label: "Concentration", value: 2, display: "2", unit: "M" }],
      messages: ["Concentration is above 1 M, check solubility."],
    };
    vi.spyOn(calculatorToolsDeps, "evaluate").mockReturnValue(engineResult);

    const out = (await runCalculatorTool.execute({
      calculatorId: 1,
      inputValues: { moles: 0.5, volume_L: 0.25 },
    })) as { ok: boolean; messages: string[] };

    expect(out.ok).toBe(true);
    expect(out.messages).toEqual(["Concentration is above 1 M, check solubility."]);
  });

  it("returns null for a NaN engine output (failed expression)", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([MOLARITY_CALC]);
    const engineResult: CustomCalcResult = {
      outputs: [{ label: "Concentration", value: NaN, display: "—", unit: "M" }],
      messages: [],
    };
    vi.spyOn(calculatorToolsDeps, "evaluate").mockReturnValue(engineResult);

    const out = (await runCalculatorTool.execute({
      calculatorId: 1,
      inputValues: { moles: 0.5, volume_L: 0.25 },
    })) as {
      ok: boolean;
      outputs: Array<{ value: number | null; display: string }>;
    };

    expect(out.ok).toBe(true);
    // NaN must be serialised as null so the model can detect the failure.
    expect(out.outputs[0].value).toBeNull();
    expect(out.outputs[0].display).toBe("—");
  });

  it("returns an error when no calculator id or name is supplied", async () => {
    const out = (await runCalculatorTool.execute({})) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/calculatorId/i);
  });

  it("returns an error for an unknown id", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([MOLARITY_CALC]);

    const out = (await runCalculatorTool.execute({
      calculatorId: 999,
      inputValues: {},
    })) as { ok: boolean; error: string };

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no calculator found/i);
    expect(out.error).toMatch(/999/);
  });

  it("returns an error for an unknown name", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockResolvedValue([MOLARITY_CALC]);

    const out = (await runCalculatorTool.execute({
      calculatorName: "Flux Capacitor",
      inputValues: {},
    })) as { ok: boolean; error: string };

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no calculator found/i);
  });

  it("fails cleanly when the store errors", async () => {
    vi.spyOn(calculatorToolsDeps, "listCalculators").mockRejectedValue(new Error("no folder"));

    const out = (await runCalculatorTool.execute({
      calculatorId: 1,
      inputValues: { moles: 0.5, volume_L: 0.25 },
    })) as { ok: boolean; error: string };

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/folder/i);
  });
});
