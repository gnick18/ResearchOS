// Tiny dense linear algebra shared by the regression engines. The systems here
// are small (the parameter count p = k + 1, with k the number of predictors),
// so an explicit O(p^3) Gauss-Jordan solve is fine and keeps the code readable.
//
// solveWithInverse drives both the logistic IRLS Newton step (solve H x = g and
// reuse the inverse Hessian as the parameter covariance) and the OLS normal
// equations (solve (X'X) b = X'y and reuse (X'X)^-1 for the coefficient
// covariance). Factored out of regression-logistic.ts so multiple linear
// regression (D5) reuses the exact same numerics rather than a second copy.
//
// No em-dashes, no emojis, no mid-sentence colons.

/**
 * Solve A x = b for a small system via Gauss-Jordan with partial pivoting, and
 * also return the inverse of A (needed for the parameter covariance). p is tiny,
 * so an explicit O(p^3) solve is fine. Returns null when A is singular (e.g.
 * collinear predictors or logistic separation).
 */
export function solveWithInverse(
  A: number[][],
  b: number[],
): { solution: number[]; inverse: number[][] } | null {
  const p = b.length;
  // Augment [A | I | b] and reduce.
  const m: number[][] = [];
  for (let i = 0; i < p; i++) {
    const row = new Array<number>(2 * p + 1).fill(0);
    for (let j = 0; j < p; j++) row[j] = A[i][j];
    row[p + i] = 1;
    row[2 * p] = b[i];
    m.push(row);
  }
  for (let col = 0; col < p; col++) {
    let pivot = col;
    let best = Math.abs(m[col][col]);
    for (let r = col + 1; r < p; r++) {
      const v = Math.abs(m[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-14) return null;
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const pv = m[col][col];
    for (let j = 0; j < 2 * p + 1; j++) m[col][j] /= pv;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * p + 1; j++) m[r][j] -= factor * m[col][j];
    }
  }
  const solution = new Array<number>(p);
  const inverse: number[][] = [];
  for (let i = 0; i < p; i++) {
    solution[i] = m[i][2 * p];
    const inv = new Array<number>(p);
    for (let j = 0; j < p; j++) inv[j] = m[i][p + j];
    inverse.push(inv);
  }
  return { solution, inverse };
}
