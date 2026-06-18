import { describe, it, expect } from "vitest";
import { isTemperatureOutOfSaneRange } from "../InteractiveGradientEditor";

// Guards the soft, non-blocking warning shown in the Edit Step popup. The
// helper only flags values for a caution hint. It never blocks saving and
// never clamps, so a researcher can still keep a deliberate edge value.
describe("isTemperatureOutOfSaneRange", () => {
  it("treats common protocol temperatures as in range", () => {
    expect(isTemperatureOutOfSaneRange(0)).toBe(false);
    expect(isTemperatureOutOfSaneRange(4)).toBe(false);
    expect(isTemperatureOutOfSaneRange(55)).toBe(false);
    expect(isTemperatureOutOfSaneRange(95)).toBe(false);
    expect(isTemperatureOutOfSaneRange(98)).toBe(false);
  });

  it("keeps the boundaries (0 and 110) in range", () => {
    expect(isTemperatureOutOfSaneRange(0)).toBe(false);
    expect(isTemperatureOutOfSaneRange(110)).toBe(false);
  });

  it("flags fat-fingered and below-zero values", () => {
    expect(isTemperatureOutOfSaneRange(99999)).toBe(true);
    expect(isTemperatureOutOfSaneRange(111)).toBe(true);
    expect(isTemperatureOutOfSaneRange(-1)).toBe(true);
  });

  it("does not flag non-finite values (no warning before a real number is typed)", () => {
    expect(isTemperatureOutOfSaneRange(NaN)).toBe(false);
    expect(isTemperatureOutOfSaneRange(Infinity)).toBe(false);
  });
});
