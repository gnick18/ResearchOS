/**
 * Dot-cell progress UI for list tasks: up to 6 small dots representing
 * sub-task completion. Dots turn green when the corresponding sub-task is
 * done, all-done state turns the whole cluster green, "…" overflow
 * indicator appears when total > 6.
 *
 * Originally lived inline in ListTaskRow.tsx; lifted here so the Home
 * page's Next-Up rows can render the same progress signal on list tasks
 * (visual parity with the Workbench Lists tab).
 */
import Tooltip from "@/components/Tooltip";

export interface SubTaskProgressDotsProps {
  completed: number;
  total: number;
  /** Hide the trailing "N/M" count; useful for ultra-dense surfaces like
   *  the Home Next-Up rows where the row line is already terse. */
  hideCount?: boolean;
}

export default function SubTaskProgressDots({
  completed,
  total,
  hideCount = false,
}: SubTaskProgressDotsProps) {
  const cells = Array.from({ length: total }, (_, i) => i < completed);
  const allDone = completed === total;
  return (
    <Tooltip
      label={`${completed}/${total} sub-task${total !== 1 ? "s" : ""} done`}
      placement="top"
    >
      <span className="inline-flex items-center gap-1.5 flex-shrink-0">
        <span className="inline-flex items-center gap-0.5" aria-hidden>
          {cells.slice(0, 6).map((on, i) => (
            <span
              key={i}
              className={`block w-2 h-2 rounded-sm ${
                on
                  ? allDone
                    ? "bg-emerald-500"
                    : "bg-blue-500"
                  : "bg-gray-200 border border-gray-300"
              }`}
            />
          ))}
          {total > 6 && <span className="text-[10px] text-gray-400 ml-0.5">…</span>}
        </span>
        {!hideCount && (
          <span
            className={`text-[11px] tabular-nums ${
              allDone ? "text-emerald-600 font-medium" : "text-gray-500"
            }`}
          >
            {completed}/{total}
          </span>
        )}
      </span>
    </Tooltip>
  );
}
