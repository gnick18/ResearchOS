/**
 * GOLDEN / GROUND-TRUTH suite for the ResearchOS lab calculators.
 *
 * Every expected value here comes from an INDEPENDENT oracle, never from our
 * own calculator. Provenance + convention are documented inline per case. The
 * oracle values were derived and reconciled in scripts/gen-calc-golden.py
 * (Biopython 1.87 for the DNA/RNA exact-MW sanity bound; exact rational algebra
 * for everything else). This file is PURE TypeScript with hardcoded oracle
 * numbers, so it runs in CI with no Python / Biopython dependency.
 *
 * Oracle per quantity (only quantities our calculators ACTUALLY compute):
 *   - Unit prefixes (units.ts) ........ SI prefix definitions (exact).
 *   - Molarity (calculators.ts) ....... deterministic algebra, hand-worked.
 *   - Dilution C1V1=C2V2 .............. deterministic algebra, hand-worked.
 *   - Serial dilution ................. deterministic algebra, hand-worked.
 *   - DNA/RNA mass<->mole ............. cited rounded-average MW CONVENTION
 *       (dsDNA 650, ssDNA/RNA 330 g/mol per base), sanity-bounded against
 *       Biopython's exact molecular_weight() (a DOCUMENTED difference, below).
 *   - A260 -> ng/uL ................... cited spectrophotometry CONVENTION
 *       (dsDNA 50, ssDNA 33, RNA 40 ng/uL per A260, 1 cm path).
 *   - Buffer/recipe ................... per-component C1V1=C2V2, hand-worked.
 *
 * INTENTIONALLY NOT COVERED:
 *   - Tm (Wallace / salt-adjusted / nearest-neighbour): owned by the sibling
 *     suite tm-nn.golden.test.ts. This file does not import or assert any Tm.
 *   - Protein MW / pI / extinction coefficient: NOT IMPLEMENTED in the
 *     codebase (no ProtParam-style calculator exists), so there is nothing to
 *     cross-validate against Biopython ProtParam. Reported as a scope finding.
 *
 * DOCUMENTED CONVENTION DIFFERENCE (not a bug):
 *   Our AVG_MW_PER_BASE (650/330/330) is the standard ROUNDED textbook average
 *   used for quick mass<->mole conversion (NEB/Thermo/Promega oligo tools).
 *   Biopython's exact, sequence-specific molecular_weight() for a 50%-GC 1000mer
 *   gives ~617.9/bp (ds), ~309/nt (ss), ~321/nt (RNA). Our constants sit a few
 *   percent above the exact 50%-GC average on purpose (the convention rounds up
 *   to absorb 5'/3' end groups, counterions, and GC-content spread). So
 *   Biopython is NOT the oracle for our mass<->mole numbers; it only bounds
 *   their plausibility. The oracle for our numbers is the cited 650/330
 *   convention itself, asserted exactly.
 */
import { describe, expect, it } from "vitest";
import {
  molesFromMass,
  massFromMoles,
  concFromMolesVolume,
  molesFromConcVolume,
  massFromConcVolumeMw,
  dilutionV1,
  dilutionV2,
  dilutionC1,
  dilutionC2,
  serialDilution,
  naMolesFromMass,
  naMassFromMoles,
  concFromA260,
  bufferRecipe,
  AVG_MW_PER_BASE,
  NG_PER_A260,
} from "./calculators";
import {
  CONC_FACTOR,
  VOL_FACTOR,
  MASS_FACTOR,
  MOLE_FACTOR,
  concToBase,
  concFromBase,
  volToBase,
  volFromBase,
  massToBase,
  moleFromBase,
} from "./units";

/**
 * Relative-tolerance compare against an oracle value. Because the oracles here
 * are exact algebra / exact convention constants and our code is plain IEEE-754
 * arithmetic, agreement is at the floating-point-rounding level. We assert a
 * tight 1e-12 relative tolerance (far better than the 0.1% the brief allows),
 * which is the reconciled tolerance once conventions are matched. A failure at
 * this tolerance would be a real finding, not float noise.
 */
const RECONCILED_REL_TOL = 1e-12;
function nearOracle(actual: number, oracle: number, relTol = RECONCILED_REL_TOL) {
  const denom = oracle === 0 ? 1 : Math.abs(oracle);
  expect(Math.abs(actual - oracle) / denom).toBeLessThan(relTol);
}

// ===========================================================================
// 0. UNIT PREFIXES  -- oracle: SI prefix definitions (exact)
// ===========================================================================
describe("GOLDEN: SI unit prefixes (oracle = SI definitions)", () => {
  it("concentration / volume / mass / mole factors equal the SI prefixes", () => {
    // Oracle: 1 nano = 1e-9, micro = 1e-6, milli = 1e-3, pico = 1e-12, etc.
    expect(CONC_FACTOR).toEqual({ nM: 1e-9, uM: 1e-6, mM: 1e-3, M: 1 });
    expect(VOL_FACTOR).toEqual({ uL: 1e-6, mL: 1e-3, L: 1 });
    expect(MASS_FACTOR).toEqual({ ng: 1e-9, ug: 1e-6, mg: 1e-3, g: 1 });
    expect(MOLE_FACTOR).toEqual({
      pmol: 1e-12,
      nmol: 1e-9,
      umol: 1e-6,
      mmol: 1e-3,
      mol: 1,
    });
  });

  it("round-trips a value through to-base and from-base (oracle = identity)", () => {
    // Oracle: converting to base and back is the identity map.
    nearOracle(concFromBase(concToBase(2.5, "uM"), "uM"), 2.5);
    nearOracle(volFromBase(volToBase(990, "uL"), "uL"), 990);
    nearOracle(moleFromBase(moleToBaseHelper(7, 1e-12), "pmol"), 7);
  });

  it("cross-prefix conversions match hand-worked SI math", () => {
    // 1000 ng = 1 ug = 0.001 mg = 1e-6 g  (oracle: SI definition chain)
    nearOracle(massToBase(1000, "ng"), 1e-6);
    // 1 mM expressed in nM = 1e6 nM  (1e-3 / 1e-9)
    nearOracle(concFromBase(concToBase(1, "mM"), "nM"), 1e6);
    // 1 mL expressed in uL = 1000 uL
    nearOracle(volFromBase(volToBase(1, "mL"), "uL"), 1000);
  });
});

// tiny local helper so the round-trip test doesn't need the moleToBase import
// name to vary; pmol base factor is 1e-12 by SI definition.
function moleToBaseHelper(value: number, factor: number): number {
  return value * factor;
}

// ===========================================================================
// 1. MOLARITY  -- oracle: deterministic algebra worked by hand (exact rationals)
// ===========================================================================
describe("GOLDEN: Molarity n=m/MW, C=n/V, m=C*V*MW (oracle = exact algebra)", () => {
  it("A) 10 mg NaCl / 58.44 g/mol -> moles", () => {
    // Oracle: 0.01 g / 58.44 g/mol = 1.7111567419575633e-4 mol (exact division).
    const massG = massToBase(10, "mg");
    nearOracle(molesFromMass(massG, 58.44)!, 0.01 / 58.44);
    nearOracle(molesFromMass(massG, 58.44)!, 1.7111567419575633e-4);
  });

  it("B) make 1 L of 1 M glucose (180.16 g/mol) -> mass 180.16 g", () => {
    // Oracle: m = C*V*MW = 1 * 1 * 180.16 = 180.16 g exactly.
    nearOracle(massFromConcVolumeMw(1, 1, 180.16)!, 180.16);
  });

  it("C) 100 mL of 1 mM NaCl -> 0.005844 g", () => {
    // Oracle: 1e-3 M * 0.1 L * 58.44 g/mol = 0.005844 g.
    const m = massFromConcVolumeMw(concToBase(1, "mM"), volToBase(100, "mL"), 58.44)!;
    nearOracle(m, 0.005844);
  });

  it("D) 5 nmol of a peptide in 250 uL -> 20 uM", () => {
    // Oracle: C = 5e-9 mol / 250e-6 L = 2e-5 M = 20 uM (exact).
    const moles = moleToBaseHelper(5, 1e-9);
    const concM = concFromMolesVolume(moles, volToBase(250, "uL"))!;
    nearOracle(concM, 2e-5);
    nearOracle(concFromBase(concM, "uM"), 20);
  });

  it("E) 10 ug of a 6000 Da protein in 1 mL -> 1.6666...e-9 mol, 1.6667 uM", () => {
    // Oracle: moles = 1e-5 g / 6000 = 1.6666666666666667e-9 mol;
    //         conc  = that / 1e-3 L = 1.6666666666666667e-6 M = 1.6666...uM.
    const massG = massToBase(10, "ug");
    const moles = molesFromMass(massG, 6000)!;
    nearOracle(moles, 1e-5 / 6000);
    const concM = concFromMolesVolume(moles, volToBase(1, "mL"))!;
    nearOracle(concM, 1.6666666666666667e-6);
    nearOracle(concFromBase(concM, "uM"), 5 / 3);
  });

  it("mass<->moles round-trips against the algebra identity", () => {
    // Oracle: massFromMoles(molesFromMass(m, MW), MW) == m.
    const massG = massToBase(2, "mg");
    const moles = molesFromMass(massG, 342.3)!; // sucrose MW
    nearOracle(massFromMoles(moles, 342.3)!, massG);
  });

  it("molesFromConcVolume matches hand math (1 uM in 2 mL)", () => {
    // Oracle: n = 1e-6 M * 2e-3 L = 2e-9 mol.
    nearOracle(molesFromConcVolume(concToBase(1, "uM"), volToBase(2, "mL"))!, 2e-9);
  });
});

// ===========================================================================
// 2. DILUTION  -- oracle: C1*V1=C2*V2 algebra worked by hand
// ===========================================================================
describe("GOLDEN: Dilution C1*V1=C2*V2 (oracle = exact algebra)", () => {
  it("V1 = 10 uL stock for 10 uM from 1 mM in 1 mL final", () => {
    // Oracle: V1 = C2*V2/C1 = (10e-6 * 1e-3) / 1e-3 = 1e-5 L = 10 uL.
    const v1 = dilutionV1(concToBase(1, "mM"), concToBase(10, "uM"), volToBase(1, "mL"))!;
    nearOracle(v1, 1e-5);
    nearOracle(volFromBase(v1, "uL"), 10);
  });

  it("V2 = 100 mL final from 1 mL of 1 mM down to 10 uM", () => {
    // Oracle: V2 = C1*V1/C2 = (1e-3 * 1e-3)/(10e-6) = 0.1 L = 100 mL.
    const v2 = dilutionV2(concToBase(1, "mM"), volToBase(1, "mL"), concToBase(10, "uM"))!;
    nearOracle(volFromBase(v2, "mL"), 100);
  });

  it("C1 = 1 mM stock so 10 uL into 1 mL gives 10 uM", () => {
    // Oracle: C1 = C2*V2/V1 = (10e-6 * 1e-3)/(10e-6) = 1e-3 M = 1 mM.
    const c1 = dilutionC1(concToBase(10, "uM"), volToBase(1, "mL"), volToBase(10, "uL"))!;
    nearOracle(concFromBase(c1, "mM"), 1);
  });

  it("C2 = 10 uM final from 10 uL of 1 mM into 1 mL", () => {
    // Oracle: C2 = C1*V1/V2 = (1e-3 * 10e-6)/(1e-3) = 1e-5 M = 10 uM.
    const c2 = dilutionC2(concToBase(1, "mM"), volToBase(10, "uL"), volToBase(1, "mL"))!;
    nearOracle(concFromBase(c2, "uM"), 10);
  });
});

// ===========================================================================
// 3. SERIAL DILUTION  -- oracle: C_step = C0/fold^step, sampleVol = Vf/fold
// ===========================================================================
describe("GOLDEN: Serial dilution (oracle = exact geometric progression)", () => {
  it("10-fold from 100 uM, 3 steps, 1000 uL final", () => {
    // Oracle: concs 10, 1, 0.1 uM; per tube 100 uL sample + 900 uL diluent.
    const rows = serialDilution(100, 10, 3, 1000);
    expect(rows.length).toBe(3);
    nearOracle(rows[0].concentration, 10);
    nearOracle(rows[1].concentration, 1);
    nearOracle(rows[2].concentration, 0.1);
    for (const r of rows) {
      nearOracle(r.sampleVolume, 100); // 1000 / 10
      nearOracle(r.diluentVolume, 900);
    }
  });

  it("2-fold from 1000 nM, 4 steps, 200 uL final", () => {
    // Oracle: 500, 250, 125, 62.5 nM; 100 uL sample + 100 uL diluent per tube.
    const rows = serialDilution(1000, 2, 4, 200);
    const concs = rows.map((r) => r.concentration);
    [500, 250, 125, 62.5].forEach((c, i) => nearOracle(concs[i], c));
    nearOracle(rows[0].sampleVolume, 100);
    nearOracle(rows[0].diluentVolume, 100);
  });

  it("5-fold from 1 mM, 2 steps, 500 uL final", () => {
    // Oracle: 0.2, 0.04 mM; sample = 500/5 = 100 uL; diluent = 400 uL.
    const rows = serialDilution(1, 5, 2, 500);
    nearOracle(rows[0].concentration, 0.2);
    nearOracle(rows[1].concentration, 0.04);
    nearOracle(rows[0].sampleVolume, 100);
    nearOracle(rows[0].diluentVolume, 400);
  });
});

// ===========================================================================
// 4. DNA / RNA MASS <-> MOLE
//    oracle: cited rounded-average MW CONVENTION (650/330/330 g/mol per base).
//    Biopython's exact MW is the documented sanity bound (see header), NOT the
//    oracle for these numbers.
// ===========================================================================
describe("GOLDEN: DNA/RNA mass<->mole (oracle = cited 650/330 convention)", () => {
  it("our rounded-average MW constants equal the cited convention", () => {
    // Oracle: standard textbook/vendor rounded averages.
    expect(AVG_MW_PER_BASE.dsDNA).toBe(650);
    expect(AVG_MW_PER_BASE.ssDNA).toBe(330);
    expect(AVG_MW_PER_BASE.RNA).toBe(330);
  });

  it("1 ug of 1000 bp dsDNA = 1.5384615... pmol (cited ref ~1.54 pmol)", () => {
    // Oracle: moles = 1e-6 g / (1000 bp * 650 g/mol/bp) = 1.5384615384615385e-12 mol.
    const moles = naMolesFromMass(massToBase(1, "ug"), 1000, "dsDNA")!;
    nearOracle(moles, 1e-6 / (1000 * 650));
    nearOracle(moleFromBase(moles, "pmol"), 1.5384615384615385);
    expect(Number(moleFromBase(moles, "pmol").toFixed(2))).toBe(1.54);
  });

  it("100 ng of a 20-nt ssDNA oligo = 15.1515... pmol", () => {
    // Oracle: moles = 100e-9 g / (20 * 330) = 1.5151515151515152e-11 mol
    //               = 15.151515... pmol (cited 330 g/mol/nt convention).
    const moles = naMolesFromMass(massToBase(100, "ng"), 20, "ssDNA")!;
    nearOracle(moles, 100e-9 / (20 * 330));
    nearOracle(moleFromBase(moles, "pmol"), 15.151515151515152);
  });

  it("RNA: 2 ug of a 500-nt transcript = 12.1212... pmol", () => {
    // Oracle: moles = 2e-6 g / (500 * 330) = 1.2121212e-11 mol = 12.1212... pmol.
    const moles = naMolesFromMass(massToBase(2, "ug"), 500, "RNA")!;
    nearOracle(moles, 2e-6 / (500 * 330));
    nearOracle(moleFromBase(moles, "pmol"), 12.121212121212121);
  });

  it("mass<->mole round-trip is exact for each kind", () => {
    // Oracle: naMassFromMoles(naMolesFromMass(m,L,k),L,k) == m (algebra identity).
    for (const kind of ["dsDNA", "ssDNA", "RNA"] as const) {
      const massG = massToBase(1, "ug");
      const moles = naMolesFromMass(massG, 100, kind)!;
      nearOracle(naMassFromMoles(moles, 100, kind)!, massG);
    }
  });
});

// ===========================================================================
// 5. A260 -> CONCENTRATION
//    oracle: cited spectrophotometry CONVENTION (50/33/40 ng/uL per A260).
// ===========================================================================
describe("GOLDEN: A260 -> ng/uL (oracle = cited 50/33/40 convention)", () => {
  it("our A260 factors equal the cited convention", () => {
    // Oracle: dsDNA 50, ssDNA 33, RNA 40 ng/uL per A260 unit (1 cm path).
    expect(NG_PER_A260.dsDNA).toBe(50);
    expect(NG_PER_A260.ssDNA).toBe(33);
    expect(NG_PER_A260.RNA).toBe(40);
  });

  it("dsDNA A260 = 1.0 -> 50 ng/uL", () => {
    nearOracle(concFromA260(1.0, "dsDNA")!, 50);
  });

  it("dsDNA A260 = 0.5 read at 100x dilution -> 2500 ng/uL", () => {
    // Oracle: 0.5 * 50 * 100 = 2500 ng/uL.
    nearOracle(concFromA260(0.5, "dsDNA", 100)!, 2500);
  });

  it("ssDNA A260 = 2.0 -> 66 ng/uL ; RNA A260 = 2.0 -> 80 ng/uL", () => {
    // Oracle: 2 * 33 = 66 ; 2 * 40 = 80.
    nearOracle(concFromA260(2.0, "ssDNA")!, 66);
    nearOracle(concFromA260(2.0, "RNA")!, 80);
  });
});

// ===========================================================================
// 6. BUFFER / RECIPE  -- oracle: per-component C1V1=C2V2 worked by hand
// ===========================================================================
describe("GOLDEN: Buffer recipe V_stock = Cfinal*Vtot/Cstock (oracle = algebra)", () => {
  it("1 L two-component recipe (40 mM from 1 M; 1 mM from 0.5 M)", () => {
    // Oracle: A = 0.04*1/1 = 0.04 L = 40 mL; B = 0.001*1/0.5 = 0.002 L = 2 mL;
    //         diluent = 1000 - 40 - 2 = 958 mL.
    const res = bufferRecipe(
      [
        { name: "A", finalConcM: 0.04, stockConcM: 1 },
        { name: "B", finalConcM: 0.001, stockConcM: 0.5 },
      ],
      1,
    );
    nearOracle(volFromBase(res.components[0].volumeL!, "mL"), 40);
    nearOracle(volFromBase(res.components[1].volumeL!, "mL"), 2);
    nearOracle(volFromBase(res.diluentL!, "mL"), 958);
    nearOracle(volFromBase(res.totalStockL, "mL"), 42);
    expect(res.overflows).toBe(false);
  });

  it("single component equals the dilution oracle (10 uM from 1 mM in 1 mL)", () => {
    // Oracle: 10 uL stock + 990 uL diluent (same as the C1V1=C2V2 case above).
    const res = bufferRecipe(
      [{ name: "primer", finalConcM: concToBase(10, "uM"), stockConcM: concToBase(1, "mM") }],
      volToBase(1, "mL"),
    );
    nearOracle(volFromBase(res.components[0].volumeL!, "uL"), 10);
    nearOracle(volFromBase(res.diluentL!, "uL"), 990);
  });

  it("three-component recipe sums correctly (oracle = sum of per-component algebra)", () => {
    // Oracle: in 500 mL (0.5 L):
    //   A 100 mM from 2 M  -> 0.1*0.5/2   = 0.025 L = 25 mL
    //   B 10 mM  from 1 M  -> 0.01*0.5/1  = 0.005 L = 5 mL
    //   C 50 mM  from 0.5M -> 0.05*0.5/0.5= 0.05 L  = 50 mL
    //   diluent = 500 - 25 - 5 - 50 = 420 mL
    const res = bufferRecipe(
      [
        { name: "A", finalConcM: 0.1, stockConcM: 2 },
        { name: "B", finalConcM: 0.01, stockConcM: 1 },
        { name: "C", finalConcM: 0.05, stockConcM: 0.5 },
      ],
      0.5,
    );
    nearOracle(volFromBase(res.components[0].volumeL!, "mL"), 25);
    nearOracle(volFromBase(res.components[1].volumeL!, "mL"), 5);
    nearOracle(volFromBase(res.components[2].volumeL!, "mL"), 50);
    nearOracle(volFromBase(res.diluentL!, "mL"), 420);
    expect(res.overflows).toBe(false);
  });
});
