/**
 * Gel-style fragment ladder for a restriction digest: two lanes, ResearchOS and
 * the Biopython oracle, with a band drawn for each fragment at a position set by
 * its size (larger fragments migrate less, so they sit higher, like a real gel).
 * When the two lanes line up band for band, the digest matches. Pure SVG.
 */

const W = 320;
const H = 220;
const LANE_W = 90;
const TOP = 24;
const BOT = H - 28;

function laneX(i: number): number {
  // Two lanes centered in the width.
  const gap = 60;
  const total = LANE_W * 2 + gap;
  const start = (W - total) / 2;
  return start + i * (LANE_W + gap);
}

export default function FragmentLadder({
  ours,
  theirs,
  enzymes,
}: {
  ours: number[];
  theirs: number[];
  enzymes: string[];
}) {
  const all = [...ours, ...theirs];
  const maxBp = Math.max(...all, 1);
  const minBp = Math.min(...all, maxBp);
  // Log scale, like a real gel; guard against a single-size digest.
  const lo = Math.log10(Math.max(minBp, 1));
  const hi = Math.log10(Math.max(maxBp, 10));
  const range = hi - lo || 1;
  const y = (bp: number) => BOT - ((Math.log10(Math.max(bp, 1)) - lo) / range) * (BOT - TOP);

  const lanes: { label: string; sizes: number[] }[] = [
    { label: "ResearchOS", sizes: ours },
    { label: "Biopython", sizes: theirs },
  ];

  return (
    <figure className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2 text-meta font-semibold uppercase tracking-wide text-gray-500">
        {enzymes.join(" + ")} digest, fragment sizes (bp)
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Fragment ladder comparing ResearchOS and Biopython for the ${enzymes.join(", ")} digest.`}>
        {lanes.map((lane, li) => {
          const x = laneX(li);
          return (
            <g key={lane.label}>
              {/* lane background */}
              <rect x={x} y={TOP} width={LANE_W} height={BOT - TOP} rx={4} fill="#f8fafc" stroke="#e5e7eb" />
              <text x={x + LANE_W / 2} y={TOP - 8} textAnchor="middle" className="fill-gray-500 text-[11px] font-medium">
                {lane.label}
              </text>
              {/* bands */}
              {lane.sizes.map((bp, bi) => (
                <g key={`${lane.label}-${bi}-${bp}`}>
                  <rect
                    x={x + 6}
                    y={y(bp) - 2.5}
                    width={LANE_W - 12}
                    height={5}
                    rx={2}
                    fill={li === 0 ? "#0ea5e9" : "#4f46e5"}
                    fillOpacity={0.85}
                  />
                  <text x={x + LANE_W + 4} y={y(bp) + 3} className="fill-gray-400 text-[9px]">
                    {bp}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
