// Line-level LCS diff for markdown method body overrides. v1 deliberately
// hand-rolled — the only consumer today is the markdown method-tab diff
// renderer, body sizes are small (single-method markdown bodies, not whole
// notebooks), and adding `diff` as a runtime dep just for this view felt
// like overkill. If we grow a second consumer or need word-level diffing,
// swap this out for jsdiff (Phase 2C+).

export type DiffSegmentKind = "same" | "add" | "remove";

export interface DiffSegment {
  kind: DiffSegmentKind;
  // The original lines of this segment, preserved in order (joined with "\n"
  // when handed to the renderer so multi-line markdown blocks — paragraphs,
  // lists, code fences — re-render correctly inside `same` runs).
  lines: string[];
}

/**
 * Diff two markdown bodies line-by-line and return contiguous segments by
 * change kind. Standard LCS dynamic programming: O(n*m) time + space, which
 * is fine for the body sizes we render here. Trailing newlines are preserved
 * by treating "" as a real line when the source ends with `\n`.
 */
export function diffMarkdownLines(source: string, override: string): DiffSegment[] {
  if (source === override) {
    return source.length === 0
      ? []
      : [{ kind: "same", lines: source.split("\n") }];
  }

  const aLines = source.split("\n");
  const bLines = override.split("\n");
  const n = aLines.length;
  const m = bLines.length;

  // dp[i][j] = LCS length of aLines[0..i) vs bLines[0..j).
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (aLines[i - 1] === bLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack into a per-line edit script. Walking from (n,m) toward (0,0)
  // produces tokens in reverse — push then reverse at the end is cheaper
  // than unshifting on every step.
  type Token = { kind: DiffSegmentKind; line: string };
  const reversed: Token[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (aLines[i - 1] === bLines[j - 1]) {
      reversed.push({ kind: "same", line: aLines[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      reversed.push({ kind: "remove", line: aLines[i - 1] });
      i--;
    } else {
      reversed.push({ kind: "add", line: bLines[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    reversed.push({ kind: "remove", line: aLines[i - 1] });
    i--;
  }
  while (j > 0) {
    reversed.push({ kind: "add", line: bLines[j - 1] });
    j--;
  }

  const tokens = reversed.reverse();

  // Collapse runs of the same kind into segments so the renderer can hand
  // multi-line `same` blocks to ReactMarkdown as a single unit (preserving
  // list/paragraph/code-fence semantics).
  const segments: DiffSegment[] = [];
  for (const t of tokens) {
    const last = segments[segments.length - 1];
    if (last && last.kind === t.kind) {
      last.lines.push(t.line);
    } else {
      segments.push({ kind: t.kind, lines: [t.line] });
    }
  }
  return segments;
}
