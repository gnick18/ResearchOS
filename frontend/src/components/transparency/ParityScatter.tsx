/**
 * Agreement scatter: ResearchOS value (y) vs third-party oracle value (x).
 *
 * Every point that sits on the dashed identity line (y = x) is a result where we
 * match the reference exactly. This is the headline visual for any scalar domain
 * (Tm today, identity-percent or fragment-count later): the eye reads "do the
 * dots hug the line" in a glance. Pure SVG, server-renderable, no deps.
 */

export interface ParityPoint {
  /** The value ResearchOS computed (y axis). */
  ours: number;
  /** The pinned oracle value (x axis). */
  theirs: number;
  /** Which oracle, drives the color + legend. */
  oracleId: string;
  /** Case label for the title tooltip. */
  label: string;
}

interface OracleStyle {
  id: string;
  name: string;
  color: string;
}

const PAD = 44;
const W = 480;
const H = 360;

export default function ParityScatter({
  points,
  oracles,
  unit,
}: {
  points: ParityPoint[];
  oracles: OracleStyle[];
  unit: string;
}) {
  const all = points.flatMap((p) => [p.ours, p.theirs]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const min = lo - span * 0.08;
  const max = hi + span * 0.08;

  const sx = (v: number) => PAD + ((v - min) / (max - min)) * (W - PAD * 1.5);
  const sy = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 1.5);

  const colorFor = (id: string) => oracles.find((o) => o.id === id)?.color ?? "#0ea5e9";

  // Four axis ticks across the value range.
  const ticks = Array.from({ length: 4 }, (_, i) => round(min + ((max - min) * (i + 0.5)) / 4, 0));

  return (
    <figure className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Agreement scatter: ResearchOS value versus oracle value (${unit}). Points on the diagonal mean exact agreement.`}
      >
        {/* axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD * 0.5} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />
        <line x1={PAD} y1={PAD * 0.5} x2={PAD} y2={H - PAD} stroke="#d1d5db" strokeWidth="1" />

        {/* identity line y = x */}
        <line
          x1={sx(min)}
          y1={sy(min)}
          x2={sx(max)}
          y2={sy(max)}
          stroke="#94a3b8"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <text x={sx(max) - 4} y={sy(max) + 16} textAnchor="end" className="fill-gray-400 text-[10px]">
          exact agreement (y = x)
        </text>

        {/* ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <text x={sx(t)} y={H - PAD + 16} textAnchor="middle" className="fill-gray-400 text-[10px]">
              {t}
            </text>
            <text x={PAD - 8} y={sy(t) + 3} textAnchor="end" className="fill-gray-400 text-[10px]">
              {t}
            </text>
          </g>
        ))}

        {/* axis labels */}
        <text x={(W - PAD) / 2 + PAD / 2} y={H - 6} textAnchor="middle" className="fill-gray-500 text-[11px]">
          Reference value ({unit})
        </text>
        <text
          x={-(H - PAD) / 2}
          y={14}
          textAnchor="middle"
          transform="rotate(-90)"
          className="fill-gray-500 text-[11px]"
        >
          ResearchOS value ({unit})
        </text>

        {/* points */}
        {points.map((p, i) => (
          <circle
            key={`${p.oracleId}-${p.label}-${i}`}
            cx={sx(p.theirs)}
            cy={sy(p.ours)}
            r={5}
            fill={colorFor(p.oracleId)}
            fillOpacity={0.5}
            stroke={colorFor(p.oracleId)}
            strokeWidth="1"
            strokeOpacity={0.9}
            style={{ mixBlendMode: "multiply" }}
          >
            <title>
              {p.label} vs {p.oracleId}: ours {p.ours} {unit}, reference {p.theirs} {unit}
            </title>
          </circle>
        ))}
      </svg>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 px-4 py-2 text-meta text-gray-500">
        {oracles.map((o) => (
          <span key={o.id} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: o.color }} />
            {o.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function round(x: number, n: number): number {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}
