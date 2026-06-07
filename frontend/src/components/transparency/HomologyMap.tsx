/**
 * Homology map for a long-alignment case: sequences A and B drawn to scale as
 * horizontal tracks, with the recovered shared region highlighted on each and a
 * ribbon connecting them. This is the readable picture for a multi-kilobase
 * alignment, where rendering every base column would be useless. Pure SVG.
 */

const W = 480;
const TRACK_H = 18;
const TOP_Y = 30;
const BOT_Y = 120;
const PAD = 24;

export default function HomologyMap({
  aLen,
  bLen,
  region,
}: {
  aLen: number;
  bLen: number;
  region: {
    aStart: number;
    aEnd: number;
    bStart: number;
    bEnd: number;
    strand: 1 | -1;
    identity: number;
  };
}) {
  const inner = W - PAD * 2;
  const maxLen = Math.max(aLen, bLen);
  const scale = (bp: number) => (bp / maxLen) * inner;

  const aTrackW = scale(aLen);
  const bTrackW = scale(bLen);
  const aBlockX = PAD + scale(region.aStart);
  const aBlockW = scale(region.aEnd - region.aStart);
  const bBlockX = PAD + scale(region.bStart);
  const bBlockW = scale(region.bEnd - region.bStart);

  const idPct = Math.round(region.identity * 1000) / 10;
  const fill = "#4f46e5";

  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface-raised">
      <svg
        viewBox={`0 0 ${W} 160`}
        className="h-auto w-full"
        role="img"
        aria-label={`Homology map: a shared region of about ${(region.aEnd - region.aStart).toLocaleString()} base pairs recovered between two sequences, ${idPct}% identical.`}
      >
        {/* connecting ribbon */}
        <path
          d={`M ${aBlockX} ${TOP_Y + TRACK_H} L ${aBlockX + aBlockW} ${TOP_Y + TRACK_H} L ${bBlockX + bBlockW} ${BOT_Y} L ${bBlockX} ${BOT_Y} Z`}
          fill={fill}
          fillOpacity={0.12}
        />

        {/* track A */}
        <rect x={PAD} y={TOP_Y} width={aTrackW} height={TRACK_H} rx={4} fill="#e5e7eb" />
        <rect x={aBlockX} y={TOP_Y} width={aBlockW} height={TRACK_H} rx={3} fill={fill} />
        <text x={PAD} y={TOP_Y - 6} className="fill-gray-500" fontSize={11}>
          Sequence A ({aLen.toLocaleString()} bp)
        </text>

        {/* track B */}
        <rect x={PAD} y={BOT_Y} width={bTrackW} height={TRACK_H} rx={4} fill="#e5e7eb" />
        <rect x={bBlockX} y={BOT_Y} width={bBlockW} height={TRACK_H} rx={3} fill={fill} />
        <text x={PAD} y={BOT_Y + TRACK_H + 14} className="fill-gray-500" fontSize={11}>
          Sequence B ({bLen.toLocaleString()} bp)
        </text>

        {/* identity badge on the ribbon */}
        <text x={W / 2} y={(TOP_Y + TRACK_H + BOT_Y) / 2 + 4} textAnchor="middle" className="fill-indigo-700 font-semibold" fontSize={12}>
          {(region.aEnd - region.aStart).toLocaleString()} bp shared, {idPct}% identical
          {region.strand === -1 ? " (reverse strand)" : ""}
        </text>
      </svg>
    </figure>
  );
}
