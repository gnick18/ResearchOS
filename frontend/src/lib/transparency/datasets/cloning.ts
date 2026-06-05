/**
 * Cloning-correctness showcase cases for the transparency page.
 *
 * Each case runs a ResearchOS assembly and checks that the product equals the
 * one an independent source reports:
 *  - Restriction-ligation (EcoRI) and Golden Gate (BsaI) are validated against
 *    pydna 5.5.13, an established in-silico cloning package. Products are
 *    compared as canonical circular molecules (rotation- and strand-invariant).
 *  - The Gateway LR recombination product is checked against the published attB
 *    site sequence.
 *
 * Input fragments and expected products are lifted verbatim from the committed
 * golden suites (`lib/sequences/cut-ligate.golden.test.ts`,
 * `cloning-gateway.golden.test.ts`), which derive them from
 * `frontend/scripts/gen-cloning-golden.py` (pydna) and the att-site constants
 * exported by `cloning-gateway.ts`.
 */

import {
  ATTB1,
  ATTL1,
  ATTR1,
  crossoverAtt,
} from "@/lib/sequences/cloning-gateway";
import { cutAndLigate } from "@/lib/sequences/cut-ligate";

/** pydna fixtures (cut-ligate.golden.test.ts). */
const RL_VECTOR = "ttGAATTCgggcccaaatttgggcccGAATTCtt";
const RL_INSERT = "aaGAATTCATGCATCATCATTAAGAATTCaa";
const RL_DESIRED_CANON = "AAATTTGGGCCCGAATTCATGCATCATCATTAAGAATTCGGGCCC";

const GG_BACKBONE = "ttGGTCTCaGGACCATCATCATGGTTAAAATGtGAGACCtt";
const GG_INSERT1 = "ttGGTCTCaAATGGGGAAACCCTTTAAATTCTtGAGACCtt";
const GG_INSERT2 = "ttGGTCTCaTTCTTGTGTGCACACAGAGGGACtGAGACCtt";
const GG_PRODUCT_CANON = "AAAATGGGGAAACCCTTTAAATTCTTGTGTGCACACAGAGGGACCATCATCATGGTT";

export interface CloningCase {
  id: string;
  label: string;
  /** Reaction / assembly type, shown on the card. */
  method: string;
  /** Which oracle the product is checked against. */
  oracleId: string;
  /** Run the assembly; return the produced product (or null) and the expected. */
  build: () => { product: string | null; expected: string };
}

export const CLONING_CASES: CloningCase[] = [
  {
    id: "restriction_ligation",
    label: "EcoRI vector + insert ligation",
    method: "Restriction-ligation (EcoRI)",
    oracleId: "pydna",
    build: () => {
      const res = cutAndLigate(
        [
          { name: "vector", seq: RL_VECTOR },
          { name: "insert", seq: RL_INSERT },
        ],
        { enzymeNames: ["ecori"], mode: "restriction", circularOnly: true, allowBlunt: false },
      );
      const set = new Set(res.products.map((p) => p.seq));
      return { product: set.has(RL_DESIRED_CANON) ? RL_DESIRED_CANON : null, expected: RL_DESIRED_CANON };
    },
  },
  {
    id: "golden_gate",
    label: "BsaI three-part Golden Gate assembly",
    method: "Golden Gate (BsaI, Type IIS)",
    oracleId: "pydna",
    build: () => {
      const res = cutAndLigate(
        [
          { name: "backbone", seq: GG_BACKBONE },
          { name: "insert1", seq: GG_INSERT1 },
          { name: "insert2", seq: GG_INSERT2 },
        ],
        { enzymeNames: ["bsai"], mode: "golden-gate", circularOnly: true, allowBlunt: false },
      );
      const set = new Set(res.products.map((p) => p.seq));
      return { product: set.has(GG_PRODUCT_CANON) ? GG_PRODUCT_CANON : null, expected: GG_PRODUCT_CANON };
    },
  },
  {
    id: "gateway_lr",
    label: "Gateway LR recombination, site 1",
    method: "Gateway LR (attR1 x attL1 -> attB1)",
    oracleId: "published-seq",
    build: () => {
      const product = crossoverAtt(ATTR1, ATTL1, 1, "attB1", "B");
      return { product: product?.seq ?? null, expected: ATTB1 };
    },
  },
];
