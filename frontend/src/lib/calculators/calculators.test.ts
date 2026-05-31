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
  sequenceStats,
  tmWallace,
  tmSaltAdjusted,
  naMolesFromMass,
  naMassFromMoles,
  concFromA260,
  bufferRecipe,
  AVG_MW_PER_BASE,
  NG_PER_A260,
} from "./calculators";
import {
  concToBase,
  concFromBase,
  volToBase,
  volFromBase,
  massToBase,
  moleFromBase,
  parseNum,
  formatNum,
} from "./units";

// Tolerant float compare helper for derived chains.
const near = (a: number, b: number, eps = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(eps);

describe("units: prefix conversion", () => {
  it("concentration factors", () => {
    near(concToBase(1, "mM"), 1e-3);
    near(concToBase(10, "uM"), 1e-5);
    near(concToBase(500, "nM"), 5e-7);
    near(concFromBase(1e-3, "mM"), 1);
    near(concFromBase(1e-6, "uM"), 1);
  });
  it("volume factors", () => {
    near(volToBase(1, "mL"), 1e-3);
    near(volToBase(990, "uL"), 9.9e-4);
    near(volFromBase(1e-3, "mL"), 1);
    near(volFromBase(1e-5, "uL"), 10);
  });
  it("mass factors", () => {
    near(massToBase(1, "ug"), 1e-6);
    near(massToBase(1000, "ng"), 1e-6);
    near(massToBase(1, "mg"), 1e-3);
  });

  it("parseNum guards empties and junk", () => {
    expect(parseNum("")).toBeNull();
    expect(parseNum("   ")).toBeNull();
    expect(parseNum("abc")).toBeNull();
    expect(parseNum("1e3")).toBe(1000);
    expect(parseNum("12.5")).toBe(12.5);
    expect(parseNum("0")).toBe(0);
  });

  it("formatNum trims + never returns NaN string", () => {
    expect(formatNum(NaN)).toBe("");
    expect(formatNum(Infinity)).toBe("");
    expect(formatNum(0)).toBe("0");
    expect(formatNum(10)).toBe("10");
    expect(formatNum(1.5400000001, 4)).toBe("1.54");
  });
});

describe("1. Molarity", () => {
  // 10 mg of NaCl (MW 58.44) -> moles
  it("moles from mass: 10 mg NaCl", () => {
    const massG = massToBase(10, "mg"); // 0.01 g
    const moles = molesFromMass(massG, 58.44)!;
    near(moles, 0.01 / 58.44);
  });

  // 1 mole of a 180 g/mol sugar weighs 180 g
  it("mass from moles", () => {
    near(massFromMoles(1, 180)!, 180);
    near(massFromMoles(0.5, 180)!, 90);
  });

  // 0.1 mol in 1 L = 0.1 M
  it("concentration from moles + volume", () => {
    near(concFromMolesVolume(0.1, 1)!, 0.1);
    // 1e-6 mol in 1 mL (1e-3 L) = 1e-3 M = 1 mM
    near(concFromBase(concFromMolesVolume(1e-6, volToBase(1, "mL"))!, "mM"), 1);
  });

  // To make 1 L of 1 M glucose (MW 180.16): mass = 180.16 g
  it("mass needed for target conc + volume (reference recipe)", () => {
    const massG = massFromConcVolumeMw(1, 1, 180.16)!;
    near(massG, 180.16);
    // 100 mL of 1 mM NaCl (MW 58.44): C*V*MW = 1e-3 * 0.1 * 58.44 g
    const m2 = massFromConcVolumeMw(
      concToBase(1, "mM"),
      volToBase(100, "mL"),
      58.44,
    )!;
    near(m2, 1e-3 * 0.1 * 58.44);
  });

  it("guards divide-by-zero", () => {
    expect(molesFromMass(1, 0)).toBeNull();
    expect(concFromMolesVolume(1, 0)).toBeNull();
  });
});

describe("2. Dilution C1*V1 = C2*V2", () => {
  // Reference from the brief: 10 uM from a 1 mM stock in 1 mL final
  // = 10 uL stock + 990 uL diluent.
  it("stock volume for 10 uM from 1 mM in 1 mL final", () => {
    const c1 = concToBase(1, "mM");
    const c2 = concToBase(10, "uM");
    const v2 = volToBase(1, "mL");
    const v1L = dilutionV1(c1, c2, v2)!;
    near(volFromBase(v1L, "uL"), 10); // 10 uL stock
    const diluentUL = volFromBase(v2 - v1L, "uL");
    near(diluentUL, 990); // 990 uL diluent
  });

  it("solve for V2 (final volume)", () => {
    // 1 mL of 1 mM diluted to 10 uM -> 100 mL final
    const v2L = dilutionV2(
      concToBase(1, "mM"),
      volToBase(1, "mL"),
      concToBase(10, "uM"),
    )!;
    near(volFromBase(v2L, "mL"), 100);
  });

  it("solve for C1 (stock conc)", () => {
    // C1 such that 10 uL into 1 mL gives 10 uM: C1 = 1 mM
    const c1 = dilutionC1(
      concToBase(10, "uM"),
      volToBase(1, "mL"),
      volToBase(10, "uL"),
    )!;
    near(concFromBase(c1, "mM"), 1);
  });

  it("solve for C2 (final conc)", () => {
    // 10 uL of 1 mM into 1 mL final = 10 uM
    const c2 = dilutionC2(
      concToBase(1, "mM"),
      volToBase(10, "uL"),
      volToBase(1, "mL"),
    )!;
    near(concFromBase(c2, "uM"), 10);
  });

  it("guards divide-by-zero", () => {
    expect(dilutionV1(0, 1, 1)).toBeNull();
    expect(dilutionV2(1, 1, 0)).toBeNull();
    expect(dilutionC1(1, 1, 0)).toBeNull();
    expect(dilutionC2(1, 1, 0)).toBeNull();
  });
});

describe("3. Serial dilution", () => {
  // 10-fold serial from 100 uM, 3 steps, 1 mL final.
  // Step concentrations: 10, 1, 0.1 uM. Per tube: 100 uL sample + 900 uL diluent.
  it("10-fold from 100 uM, 3 steps, 1 mL", () => {
    const rows = serialDilution(100, 10, 3, 1000); // conc in uM, vol in uL
    expect(rows.length).toBe(3);
    near(rows[0].concentration, 10);
    near(rows[1].concentration, 1);
    near(rows[2].concentration, 0.1);
    // sample/diluent identical per tube at constant fold + final volume
    for (const r of rows) {
      near(r.sampleVolume, 100); // 1000 / 10
      near(r.diluentVolume, 900);
    }
  });

  it("2-fold from 1000 nM, 4 steps, 200 uL", () => {
    const rows = serialDilution(1000, 2, 4, 200);
    expect(rows.map((r) => r.concentration)).toEqual([500, 250, 125, 62.5]);
    near(rows[0].sampleVolume, 100);
    near(rows[0].diluentVolume, 100);
  });

  it("returns empty for nonsensical inputs", () => {
    expect(serialDilution(100, 1, 3, 1000)).toEqual([]); // fold must be > 1
    expect(serialDilution(100, 10, 0, 1000)).toEqual([]); // steps < 1
    expect(serialDilution(0, 10, 3, 1000)).toEqual([]); // start conc 0
    expect(serialDilution(100, 10, 3, 0)).toEqual([]); // final vol 0
  });
});

describe("4. Tm primer melting temp", () => {
  // Reference from the brief: 20 nt primer with 10 GC by Wallace = 2*10 + 4*10 = 60.
  it("Wallace: 20-mer, 10 GC + 10 AT = 60 C", () => {
    // 10 G/C and 10 A/T
    const seq = "GCGCGCGCGCATATATATAT"; // 10 GC, 10 AT, length 20
    const s = sequenceStats(seq);
    expect(s.length).toBe(20);
    expect(s.g + s.c).toBe(10);
    expect(tmWallace(seq)).toBe(60);
  });

  it("Wallace: all-AT octamer = 16, all-GC octamer = 32", () => {
    expect(tmWallace("ATATATAT")).toBe(2 * 8);
    expect(tmWallace("GCGCGCGC")).toBe(4 * 8);
  });

  it("Wallace counts U (RNA) like T", () => {
    expect(tmWallace("AUAUAUAU")).toBe(2 * 8);
  });

  it("sequenceStats: GC% and composition, ignores junk + whitespace", () => {
    const s = sequenceStats("ATGC atgc 123-NN");
    expect(s.length).toBe(8); // ATGCATGC
    expect(s.gcPercent).toBe(50);
    expect(s.a).toBe(2);
    expect(s.t).toBe(2);
    expect(s.g).toBe(2);
    expect(s.c).toBe(2);
  });

  it("salt-adjusted Tm matches the Marmur-Doty formula", () => {
    // Hand-computed for a 20-mer at 50% GC, [Na+] = 0.05 M:
    // 81.5 + 16.6*log10(0.05) + 0.41*50 - 600/20
    const expected = 81.5 + 16.6 * Math.log10(0.05) + 0.41 * 50 - 600 / 20;
    const seq = "GCGCGCGCGCATATATATAT"; // 50% GC, length 20
    near(tmSaltAdjusted(seq, 0.05)!, expected, 1e-6);
  });

  it("empty / invalid sequence -> null", () => {
    expect(tmWallace("")).toBeNull();
    expect(tmWallace("zzz")).toBeNull();
    expect(tmSaltAdjusted("", 0.05)).toBeNull();
    expect(tmSaltAdjusted("ATGC", 0)).toBeNull();
    expect(sequenceStats("").gcPercent).toBeNull();
  });
});

describe("5. DNA/RNA conversion", () => {
  it("MW constants", () => {
    expect(AVG_MW_PER_BASE.dsDNA).toBe(650);
    expect(AVG_MW_PER_BASE.ssDNA).toBe(330);
    expect(AVG_MW_PER_BASE.RNA).toBe(330);
    expect(NG_PER_A260.dsDNA).toBe(50);
    expect(NG_PER_A260.ssDNA).toBe(33);
    expect(NG_PER_A260.RNA).toBe(40);
  });

  // Reference from the brief: 1 ug of a 1000 bp dsDNA = 1.54 pmol.
  it("1 ug of 1000 bp dsDNA = 1.54 pmol", () => {
    const massG = massToBase(1, "ug"); // 1e-6 g
    const moles = naMolesFromMass(massG, 1000, "dsDNA")!;
    const pmol = moleFromBase(moles, "pmol");
    // 1e-6 / (1000 * 650) = 1.538e-12 mol = 1.538 pmol
    near(pmol, 1.5384615384615385, 1e-9);
    expect(Number(pmol.toFixed(2))).toBe(1.54);
  });

  it("ssDNA 20-mer: 1 ug -> moles round-trip to mass", () => {
    const massG = massToBase(1, "ug");
    const moles = naMolesFromMass(massG, 20, "ssDNA")!;
    // round-trip mass back
    near(naMassFromMoles(moles, 20, "ssDNA")!, massG, 1e-15);
  });

  it("A260 -> concentration with dilution factor", () => {
    // dsDNA A260 = 1.0, factor 50 ng/uL, dilution 1x
    near(concFromA260(1.0, "dsDNA")!, 50);
    // dsDNA A260 reading 0.5 measured at 100x dilution -> 0.5*50*100 = 2500 ng/uL
    near(concFromA260(0.5, "dsDNA", 100)!, 2500);
    // ssDNA factor 33, RNA factor 40
    near(concFromA260(2, "ssDNA")!, 66);
    near(concFromA260(2, "RNA")!, 80);
  });

  it("guards", () => {
    expect(naMolesFromMass(1e-6, 0, "dsDNA")).toBeNull(); // length 0
    expect(concFromA260(-1, "dsDNA")).toBeNull(); // negative A260
    expect(concFromA260(1, "dsDNA", 0)).toBeNull(); // bad dilution factor
  });
});

describe("6. Buffer / recipe", () => {
  // Reference: make 1 L of 1x TAE-ish buffer with two components.
  // Component A: 40 mM final from a 1 M stock -> (0.04 * 1) / 1 = 0.04 L = 40 mL.
  // Component B: 1 mM final from a 0.5 M stock -> (0.001 * 1)/0.5 = 0.002 L = 2 mL.
  // Diluent = 1000 - 40 - 2 = 958 mL.
  it("two-component recipe in 1 L", () => {
    const res = bufferRecipe(
      [
        { name: "A", finalConcM: 0.04, stockConcM: 1 },
        { name: "B", finalConcM: 0.001, stockConcM: 0.5 },
      ],
      1, // 1 L total
    );
    near(volFromBase(res.components[0].volumeL!, "mL"), 40);
    near(volFromBase(res.components[1].volumeL!, "mL"), 2);
    near(volFromBase(res.diluentL!, "mL"), 958);
    near(volFromBase(res.totalStockL, "mL"), 42);
    expect(res.overflows).toBe(false);
  });

  // Single component: 10 uM from 1 mM stock in 1 mL = 10 uL stock + 990 uL diluent
  // (the buffer calc is just C1V1=C2V2 applied per component).
  it("single component matches the dilution reference", () => {
    const res = bufferRecipe(
      [
        {
          name: "primer",
          finalConcM: concToBase(10, "uM"),
          stockConcM: concToBase(1, "mM"),
        },
      ],
      volToBase(1, "mL"),
    );
    near(volFromBase(res.components[0].volumeL!, "uL"), 10);
    near(volFromBase(res.diluentL!, "uL"), 990);
  });

  it("flags overflow when stocks exceed total volume", () => {
    const res = bufferRecipe(
      [{ name: "X", finalConcM: 0.9, stockConcM: 1 }],
      1,
    );
    // needs 0.9 L for one component, fine; add another that pushes over 1 L
    const res2 = bufferRecipe(
      [
        { name: "X", finalConcM: 0.9, stockConcM: 1 },
        { name: "Y", finalConcM: 0.3, stockConcM: 1 },
      ],
      1,
    );
    expect(res.overflows).toBe(false);
    expect(res2.overflows).toBe(true);
    expect(res2.diluentL).toBeNull();
  });

  it("unsolvable component (zero stock) yields null volume + null diluent", () => {
    const res = bufferRecipe(
      [{ name: "bad", finalConcM: 0.01, stockConcM: 0 }],
      1,
    );
    expect(res.components[0].volumeL).toBeNull();
    expect(res.diluentL).toBeNull();
  });

  it("guards non-positive total volume", () => {
    const res = bufferRecipe([{ name: "A", finalConcM: 1, stockConcM: 1 }], 0);
    expect(res.diluentL).toBeNull();
    expect(res.components[0].volumeL).toBeNull();
  });
});
