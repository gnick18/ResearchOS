"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { goalsApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import HighLevelGoalModal from "@/components/HighLevelGoalModal";
import type { HighLevelGoal, Project } from "@/lib/types";

interface GoalsSectionProps {
  project: Project;
}

// Sort: incomplete (active) goals on top, then by start_date ascending.
// Matches the brief's "active goals first" framing and gives a stable order
// across renders (start_date is required at create-time).
function sortGoals(goals: HighLevelGoal[]): HighLevelGoal[] {
  return [...goals].sort((a, b) => {
    if (a.is_complete !== b.is_complete) return a.is_complete ? 1 : -1;
    return a.start_date.localeCompare(b.start_date);
  });
}

// "Apr 3 → May 28" / "Apr 3, 2025 → May 28, 2026" when the years differ.
// Compact intentionally — full year + weekday is overkill in a list row.
function formatDateRange(startISO: string, endISO: string): string {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  if (!start || !end) return `${startISO} → ${endISO}`;
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: withYear ? "numeric" : undefined,
    });
  return `${fmt(start, !sameYear)} → ${fmt(end, true)}`;
}

// ISO dates from the goal store are YYYY-MM-DD (date-only). Parse as local
// to avoid the off-by-one timezone shift that `new Date("2026-05-20")`
// causes (UTC midnight → previous-day local in negative offsets).
function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    const d = new Date(s);
    return isFinite(d.getTime()) ? d : null;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export default function GoalsSection({ project }: GoalsSectionProps) {
  const { currentUser } = useCurrentUser();

  // Goals live in the current user's namespace (goalsApi.list reads the
  // logged-in user's store). For receivers viewing a shared project, this
  // surface intentionally shows the VIEWER's goals filtered by project.id —
  // matches Gantt's behavior, since goals aren't a shared resource today.
  const { data: allGoals = [], isLoading, isError } = useQuery({
    queryKey: ["goals", currentUser, "for-project", project.id],
    queryFn: goalsApi.list,
    enabled: currentUser !== null,
  });

  const projectGoals = useMemo(
    () => sortGoals(allGoals.filter((g) => g.project_id === project.id)),
    [allGoals, project.id]
  );

  const [editingGoal, setEditingGoal] = useState<HighLevelGoal | null>(null);

  return (
    <section id="goals" className="scroll-mt-32">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-title font-semibold text-foreground">Goals</h2>
        {!isLoading && !isError && projectGoals.length > 0 && (
          <span className="text-meta text-foreground-muted">
            {projectGoals.length} goal{projectGoals.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-body text-foreground-muted italic">Loading goals…</p>
      ) : isError ? (
        <p className="text-body text-red-500">
          Couldn&apos;t load this project&apos;s goals.
        </p>
      ) : projectGoals.length === 0 ? (
        <p className="text-body text-foreground-muted italic">
          No goals set yet. Goals attached to this project will appear here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden bg-surface-raised">
          {projectGoals.map((goal) => {
            const totalSmart = goal.smart_goals?.length ?? 0;
            const doneSmart = goal.smart_goals?.filter((sg) => sg.is_complete).length ?? 0;
            return (
              <li key={goal.id}>
                <button
                  type="button"
                  onClick={() => setEditingGoal(goal)}
                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-surface-sunken transition-colors text-left"
                >
                  {goal.color && (
                    <span
                      className="flex-shrink-0 w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: goal.color }}
                      aria-hidden
                    />
                  )}
                  <span className="text-body font-medium text-foreground truncate flex-1 min-w-0">
                    {goal.name}
                  </span>
                  <span className="text-meta text-foreground-muted flex-shrink-0">
                    {formatDateRange(goal.start_date, goal.end_date)}
                  </span>
                  {totalSmart > 0 && (
                    <span className="text-meta px-2 py-0.5 bg-surface-sunken text-foreground-muted rounded-full flex-shrink-0">
                      {doneSmart}/{totalSmart} SMART
                    </span>
                  )}
                  {goal.is_complete ? (
                    <span className="text-meta px-2 py-0.5 bg-green-50 text-green-700 rounded-full flex-shrink-0">
                      Complete
                    </span>
                  ) : (
                    <span className="text-meta px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full flex-shrink-0">
                      Active
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editingGoal && (
        <HighLevelGoalModal
          projects={[project]}
          editingGoal={editingGoal}
          onClose={() => setEditingGoal(null)}
        />
      )}
    </section>
  );
}
