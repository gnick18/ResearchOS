/**
 * compare align bot — pure dotplot computation for the Compare view. A dotplot
 * marks every position where a k-mer of sequence A matches a k-mer of sequence
 * B; long diagonals reveal similar regions. We down-sample into a fixed pixel
 * grid so a plasmid-vs-plasmid plot stays bounded regardless of length. No DOM;
 * the dialog renders the returned grid into an SVG / canvas.
 */

/** A computed dotplot ready to paint into a square of `size` x `size` cells. */
export interface Dotplot {
  /** Grid edge length in cells (== requested size, clamped to sequence spans). */
  size: number;
  /** k-mer word length used. */
  k: number;
  /**
   * Row-major boolean grid, length `size * size`. `cells[row * size + col]` is
   * true when some A k-mer starting in the column's A-window matches some B
   * k-mer starting in the row's B-window. Row 0 = start of B (top), col 0 =
   * start of A (left), so the main diagonal (top-left to bottom-right) is the
   * identity diagonal.
   */
  cells: Uint8Array;
  /** Length of A used (bases). */
  aLen: number;
  /** Length of B used (bases). */
  bLen: number;
}

/**
 * Compute a down-sampled dotplot of `a` vs `b`.
 *
 * - `size` is the grid edge in cells (default 120). Both axes share it, so the
 *   plot is square even when the sequences differ in length (each axis is scaled
 *   independently).
 * - `k` is the word length (default 11). Comparison is exact and case-folded
 *   (IUPAC codes are matched verbatim, like the engine's k-mer index).
 *
 * Complexity is O(|a| + |b|) for indexing plus O(matches) to mark cells, so it
 * is safe at plasmid scale. The caller should guard truly huge inputs upstream.
 */
export function computeDotplot(
  a: string,
  b: string,
  size = 120,
  k = 11,
): Dotplot {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  const aLen = A.length;
  const bLen = B.length;

  // Clamp the grid so we never have more cells than positions on either axis.
  const grid = Math.max(1, Math.min(size, aLen, bLen));
  const cells = new Uint8Array(grid * grid);

  // Too short to seed: empty plot.
  if (aLen < k || bLen < k || k < 1) {
    return { size: grid, k, cells, aLen, bLen };
  }

  // Index A's k-mers -> list of start positions.
  const index = new Map<string, number[]>();
  for (let i = 0; i + k <= aLen; i++) {
    const word = A.slice(i, i + k);
    const list = index.get(word);
    if (list) list.push(i);
    else index.set(word, [i]);
  }

  // Map a 0-based sequence position to its grid cell on that axis.
  const aCell = (pos: number): number =>
    Math.min(grid - 1, Math.floor((pos / aLen) * grid));
  const bCell = (pos: number): number =>
    Math.min(grid - 1, Math.floor((pos / bLen) * grid));

  // Walk B's k-mers, light up the (col=A, row=B) cell for each shared word.
  for (let j = 0; j + k <= bLen; j++) {
    const word = B.slice(j, j + k);
    const hits = index.get(word);
    if (!hits) continue;
    const row = bCell(j);
    for (const i of hits) {
      cells[row * grid + aCell(i)] = 1;
    }
  }

  return { size: grid, k, cells, aLen, bLen };
}

/**
 * Choose a sensible k-mer word length for a dotplot given the shorter span.
 * Short sequences (e.g. oligos) need a small word or the plot is empty; long
 * ones can afford a longer, more specific word. Clamped to [6, 14].
 */
export function dotplotWordSize(minLen: number): number {
  if (minLen < 30) return 6;
  if (minLen < 200) return 8;
  if (minLen < 2000) return 11;
  return 14;
}
