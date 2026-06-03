// sequence Phase 2c bot — minimal open-reading-frame finder for the "ORFs" view
// layer. SeqViz has no native ORF prop, so the view control surfaces ORFs as
// extra translation tracks computed here. Pure + testable.
//
// An ORF is a run from an ATG start to the next in-frame stop (TAA/TAG/TGA),
// on either strand, at least `minAa` codons long. Coordinates are 0-based
// [start, end) on the FORWARD sequence (reverse ORFs are mapped back to forward
// coordinates so they render in place).

export interface Orf {
  /** 0-based inclusive start on the forward sequence. */
  start: number;
  /** 0-based exclusive end on the forward sequence. */
  end: number;
  /** 1 forward, -1 reverse. */
  strand: 1 | -1;
}

const STOPS = new Set(["TAA", "TAG", "TGA"]);

function complement(seq: string): string {
  const map: Record<string, string> = {
    A: "T", T: "A", G: "C", C: "G", U: "A", N: "N",
  };
  let out = "";
  for (const ch of seq) out += map[ch] ?? "N";
  return out;
}

function reverseComplement(seq: string): string {
  return complement(seq).split("").reverse().join("");
}

/** Scan one strand's sequence for ORFs, returning [start,end) on that strand. */
function scanStrand(seq: string, minAa: number): { start: number; end: number }[] {
  const orfs: { start: number; end: number }[] = [];
  const n = seq.length;
  for (let frame = 0; frame < 3; frame++) {
    let i = frame;
    while (i + 3 <= n) {
      if (seq.slice(i, i + 3) === "ATG") {
        // walk to the next in-frame stop
        let j = i;
        let found = -1;
        while (j + 3 <= n) {
          if (STOPS.has(seq.slice(j, j + 3))) {
            found = j + 3;
            break;
          }
          j += 3;
        }
        if (found !== -1) {
          const aa = (found - i) / 3 - 1; // exclude the stop codon
          if (aa >= minAa) orfs.push({ start: i, end: found });
          i = found; // continue after this ORF
          continue;
        } else {
          break; // no stop in this frame
        }
      }
      i += 3;
    }
  }
  return orfs;
}

/** Find ORFs on both strands of `seq`, in FORWARD coordinates. */
export function findOrfs(seq: string, minAa = 30): Orf[] {
  const s = seq.toUpperCase();
  const n = s.length;
  const fwd = scanStrand(s, minAa).map(
    (o): Orf => ({ start: o.start, end: o.end, strand: 1 }),
  );
  const revSeq = reverseComplement(s);
  const rev = scanStrand(revSeq, minAa).map((o): Orf => {
    // Map reverse-strand [start,end) back to forward coordinates.
    const fStart = n - o.end;
    const fEnd = n - o.start;
    return { start: fStart, end: fEnd, strand: -1 };
  });
  return [...fwd, ...rev];
}
