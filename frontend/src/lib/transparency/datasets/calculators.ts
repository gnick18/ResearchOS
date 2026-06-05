/**
 * Lab-calculator showcase cases for the transparency page.
 *
 * Unlike the sequence tools, these are not validated against a peer software
 * package; their oracle is the closed-form result of exact algebra (molarity,
 * dilution C1V1 = C2V2, serial dilution) and a small set of cited constants
 * (average nucleotide masses 650/330 g/mol per base, spectrophotometry factors
 * 50/33/40 ng/uL per A260). Each `compute` calls the real calculator and the
 * `oracle` is the hand-worked value, both lifted from the committed golden suite
 * (`lib/calculators/calculators.golden.test.ts`, generator
 * `frontend/scripts/gen-calc-golden.py`).
 */

import {
  concFromA260,
  concFromMolesVolume,
  dilutionV1,
  massFromConcVolumeMw,
  molesFromMass,
  naMolesFromMass,
  serialDilution,
} from "@/lib/calculators/calculators";

export interface LabCalcCase {
  id: string;
  label: string;
  /** Human-readable inputs. */
  input: string;
  /** Display unit of the result. */
  unit: string;
  /** Run the real calculator; result is in `unit`. */
  compute: () => number | null;
  /** Closed-form expected value, in `unit`. */
  oracle: number;
}

export const CALC_CASES: LabCalcCase[] = [
  {
    id: "molarity_mass",
    label: "Mass to make a solution",
    input: "1 M x 1 L x 180.16 g/mol glucose",
    unit: "g",
    compute: () => massFromConcVolumeMw(1, 1, 180.16),
    oracle: 180.16,
  },
  {
    id: "molarity_conc",
    label: "Concentration from mass and volume",
    input: "10 ug of a 6000 Da protein in 1 mL",
    unit: "uM",
    compute: () => {
      const moles = molesFromMass(10e-6, 6000);
      if (moles == null) return null;
      const c = concFromMolesVolume(moles, 1e-3);
      return c == null ? null : c * 1e6;
    },
    oracle: (10e-6 / 6000 / 1e-3) * 1e6,
  },
  {
    id: "dilution_v1",
    label: "Stock volume for a dilution",
    input: "1 mM stock to 10 uM in 1 mL final (C1V1 = C2V2)",
    unit: "uL",
    compute: () => {
      const v = dilutionV1(1e-3, 10e-6, 1e-3);
      return v == null ? null : v * 1e6;
    },
    oracle: 10,
  },
  {
    id: "serial_dilution",
    label: "Serial dilution endpoint",
    input: "10-fold from 100 uM, step 3",
    unit: "uM",
    compute: () => serialDilution(100, 10, 3, 1000)[2]?.concentration ?? null,
    oracle: 0.1,
  },
  {
    id: "na_mass_mole",
    label: "DNA mass to moles",
    input: "1 ug of 1000 bp dsDNA (650 g/mol per bp)",
    unit: "pmol",
    compute: () => {
      const m = naMolesFromMass(1e-6, 1000, "dsDNA");
      return m == null ? null : m * 1e12;
    },
    oracle: (1e-6 / (1000 * 650)) * 1e12,
  },
  {
    id: "a260_conc",
    label: "Concentration from A260",
    input: "dsDNA, A260 = 1.0 (50 ng/uL per A260)",
    unit: "ng/uL",
    compute: () => concFromA260(1.0, "dsDNA"),
    oracle: 50,
  },
];
