// Minimal ambient types for the @stdlib statistics packages and jstat used by
// the Data Hub engine. None of these ship their own .d.ts. We declare only the
// narrow surface the engine actually consumes. This mirrors the repo pattern in
// src/lib/spellcheck/nspell.d.ts and src/types/*.d.ts.

declare module "@stdlib/stats-ttest" {
  interface OneSampleResult {
    rejected: boolean;
    alpha: number;
    pValue: number;
    statistic: number;
    ci: [number, number];
    alternative: string;
    df: number;
    mean: number;
    nullValue: number;
    print: () => string;
  }
  interface OneSampleOpts {
    alpha?: number;
    alternative?: "two-sided" | "less" | "greater";
    mu?: number;
  }
  function ttest(x: ArrayLike<number>, opts?: OneSampleOpts): OneSampleResult;
  function ttest(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    opts?: OneSampleOpts,
  ): OneSampleResult;
  export default ttest;
}

declare module "@stdlib/stats-ttest2" {
  interface TwoSampleResult {
    rejected: boolean;
    alpha: number;
    pValue: number;
    statistic: number;
    ci: [number, number];
    alternative: string;
    df: number;
    nullValue: number;
    xmean: number;
    ymean: number;
    method: string;
    print: () => string;
  }
  interface TwoSampleOpts {
    alpha?: number;
    alternative?: "two-sided" | "less" | "greater";
    difference?: number;
    variance?: "equal" | "unequal";
  }
  function ttest2(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    opts?: TwoSampleOpts,
  ): TwoSampleResult;
  export default ttest2;
}

declare module "@stdlib/stats-wilcoxon" {
  interface WilcoxonResult {
    rejected: boolean;
    alpha: number;
    pValue: number;
    statistic: number;
    alternative: string;
    method: string;
    print: () => string;
  }
  interface WilcoxonOpts {
    alpha?: number;
    alternative?: "two-sided" | "less" | "greater";
    correction?: boolean;
    exact?: boolean;
    mu?: number;
    zeroMethod?: string;
  }
  function wilcoxon(x: ArrayLike<number>, opts?: WilcoxonOpts): WilcoxonResult;
  function wilcoxon(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    opts?: WilcoxonOpts,
  ): WilcoxonResult;
  export default wilcoxon;
}

declare module "@stdlib/stats-anova1" {
  interface AnovaTerm {
    df: number;
    ss: number;
    ms: number;
  }
  interface AnovaGroupMean {
    mean: number;
    sampleSize: number;
    SD: number;
  }
  interface Anova1Result {
    treatment: AnovaTerm;
    error: AnovaTerm;
    statistic: number;
    pValue: number;
    means: Record<string, AnovaGroupMean>;
    method: string;
    print: () => string;
  }
  interface Anova1Opts {
    alpha?: number;
  }
  function anova1(
    x: ArrayLike<number>,
    factor: ArrayLike<string | number>,
    opts?: Anova1Opts,
  ): Anova1Result;
  export default anova1;
}

declare module "@stdlib/stats-kruskal-test" {
  interface KruskalResult {
    rejected: boolean;
    alpha: number;
    df: number;
    pValue: number;
    statistic: number;
    method: string;
    print: () => string;
  }
  interface KruskalOpts {
    alpha?: number;
    groups?: ArrayLike<string | number>;
  }
  function kruskalTest(
    ...args: Array<ArrayLike<number> | KruskalOpts>
  ): KruskalResult;
  export default kruskalTest;
}

// --- @stdlib base distribution namespaces (CDF + quantile only) ---

declare module "@stdlib/stats-base-dists-t" {
  interface TNamespace {
    cdf: (x: number, v: number) => number;
    quantile: (p: number, v: number) => number;
    pdf: (x: number, v: number) => number;
  }
  const t: TNamespace;
  export default t;
}

declare module "@stdlib/stats-base-dists-f" {
  interface FNamespace {
    cdf: (x: number, d1: number, d2: number) => number;
    quantile: (p: number, d1: number, d2: number) => number;
  }
  const f: FNamespace;
  export default f;
}

declare module "@stdlib/stats-base-dists-chisquare" {
  interface ChiSquareNamespace {
    cdf: (x: number, k: number) => number;
    quantile: (p: number, k: number) => number;
  }
  const chisquare: ChiSquareNamespace;
  export default chisquare;
}

declare module "@stdlib/stats-base-dists-normal" {
  interface NormalNamespace {
    cdf: (x: number, mu: number, sigma: number) => number;
    quantile: (p: number, mu: number, sigma: number) => number;
    pdf: (x: number, mu: number, sigma: number) => number;
  }
  const normal: NormalNamespace;
  export default normal;
}

declare module "jstat" {
  interface TukeyNamespace {
    // cdf(q, nmeans, df) -> P(Q <= q); inv(p, nmeans, df) -> critical q.
    cdf: (q: number, nmeans: number, df: number) => number;
    inv: (p: number, nmeans: number, df: number) => number;
  }
  interface JStatStatic {
    tukey: TukeyNamespace;
  }
  export const jStat: JStatStatic;
}
