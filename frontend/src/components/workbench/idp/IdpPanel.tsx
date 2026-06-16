"use client";

// Check-ins Phase 3 (checkins-phase3 bot, 2026-06-12). The Individual
// Development Plan surface, recreated as real React from the approved mockup
// (docs/mockups/2026-06-12-checkins-phase3-idp.html). Lives inside the
// check-ins space view as an "IDP" sub-tab on a mentoring (pair-with-mentor)
// space. The TRAINEE (the non-mentor member) owns the plan and edits it; the
// mentor sees a section-gated review surface (comment + sign-off only).
//
// House style: <Icon> only (no inline SVG, the icon-guard hook blocks it),
// <Tooltip> on icon-only buttons, brand tokens, no em-dashes, no emojis, no
// mid-sentence colons in copy.

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { idpsApi } from "@/lib/local-api";
import {
  COMPETENCY_GROUPS,
  STAGE_HINTS,
  skillVisibleForStage,
  deriveCompetencySummary,
} from "@/lib/idp/competencies";
import type {
  CareerStage,
  IDP,
  IdpActionRow,
  IdpActionStatus,
  IdpGoal,
  IdpGoalTerm,
  IdpSectionKey,
  IdpSkillRating,
} from "@/lib/types";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

const STAGES: Array<{ id: CareerStage; label: string }> = [
  { id: "undergrad", label: "Undergrad" },
  { id: "grad", label: "Grad student" },
  { id: "postdoc", label: "Postdoc" },
  { id: "staff", label: "Staff scientist" },
];

const idpKey = (trainee: string) => ["idp", trainee] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMonthYear(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function StageSegment({
  stage,
  onChange,
}: {
  stage: CareerStage;
  onChange: (s: CareerStage) => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-lg border border-border">
      {STAGES.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          className={`px-3 py-1.5 text-meta font-semibold transition-colors ${i > 0 ? "border-l border-border" : ""} ${
            stage === s.id
              ? "bg-brand-action text-white"
              : "bg-surface-raised text-foreground-muted hover:text-foreground"
          }`}
        >
          {s.label}
        </button>
      ))}
    </span>
  );
}

interface IdpPanelProps {
  /** The trainee username this IDP belongs to (the non-mentor member). */
  trainee: string;
  /** The signed-in user. */
  currentUser: string;
  /** The mentor username for this space (the reviewer), or null. */
  mentor: string | null;
}

export default function IdpPanel({ trainee, currentUser, mentor }: IdpPanelProps) {
  const queryClient = useQueryClient();
  const isOwner = currentUser === trainee;

  const { data: idp, isLoading } = useQuery<IDP | null>({
    queryKey: idpKey(trainee),
    queryFn: () => idpsApi.getForMember(trainee),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: idpKey(trainee) }),
    [queryClient, trainee],
  );

  const createMutation = useMutation({
    mutationFn: (career_stage: CareerStage) =>
      idpsApi.create({ career_stage, mentor }),
    onSuccess: invalidate,
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-body text-foreground-muted">
        Loading the development plan...
      </div>
    );
  }

  if (!idp) {
    return (
      <NoIdpState
        isOwner={isOwner}
        trainee={trainee}
        onCreate={(stage) => createMutation.mutate(stage)}
        busy={createMutation.isPending}
      />
    );
  }

  return (
    <IdpForm
      idp={idp}
      isOwner={isOwner}
      trainee={trainee}
      mentor={mentor}
      onChanged={invalidate}
    />
  );
}

// ── Empty state (no IDP yet) ─────────────────────────────────────────────────

function NoIdpState({
  isOwner,
  trainee,
  onCreate,
  busy,
}: {
  isOwner: boolean;
  trainee: string;
  onCreate: (stage: CareerStage) => void;
  busy: boolean;
}) {
  const [stage, setStage] = useState<CareerStage>("grad");
  if (!isOwner) {
    return (
      <div className="flex h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-sunken/40 px-6 text-center text-body text-foreground-muted">
        <Icon name="layer" className="h-6 w-6 text-foreground-muted" />
        <p>
          {trainee} has not started a development plan yet. When they do and
          share sections with you, the review surface appears here.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-surface-sunken/40 px-6 py-10 text-center">
      <Icon name="layer" className="h-7 w-7 text-brand-action" />
      <div>
        <p className="text-title font-semibold text-foreground">
          Start your development plan
        </p>
        <p className="mx-auto mt-1 max-w-md text-body text-foreground-muted">
          A living plan you own. Self-assess your skills, set goals, and act on
          them. Your mentor reviews the sections you choose to share. NIH
          progress reports now expect a plan to exist, so it doubles as a
          compliance record.
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <StageSegment stage={stage} onChange={setStage} />
        <p className="max-w-md text-meta text-foreground-muted">
          {STAGE_HINTS[stage]}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onCreate(stage)}
        disabled={busy}
        data-testid="idp-create"
        className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex items-center gap-1.5 rounded-lg px-4 py-2 text-body font-medium"
      >
        <Icon name="plus" className="h-4 w-4" />
        Create the plan
      </button>
    </div>
  );
}

// ── The form ─────────────────────────────────────────────────────────────────

function IdpForm({
  idp,
  isOwner,
  trainee,
  mentor,
  onChanged,
}: {
  idp: IDP;
  isOwner: boolean;
  trainee: string;
  mentor: string | null;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const stage = idp.career_stage;

  // Generic patch mutation; the section helpers call the specific api methods.
  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: idpKey(trainee) });
      onChanged();
    },
  });
  const call = useCallback(
    (fn: () => Promise<unknown>) => run.mutate(fn),
    [run],
  );

  const [openSec, setOpenSec] = useState<Record<string, boolean>>({
    self_assessment: true,
    career_exploration: false,
    goals: false,
    action_plan: false,
    review: false,
  });
  const toggleSec = (k: string) =>
    setOpenSec((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-surface-raised"
      data-testid="idp-form"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Icon name="layer" className="h-5 w-5 text-brand-action" />
          <div>
            <p className="text-title font-semibold text-foreground">
              {isOwner ? "My development plan" : `${trainee}'s development plan`}
            </p>
            <p className="text-meta text-foreground-muted">
              {isOwner
                ? "You own this plan. Your mentor reviews the sections you share."
                : `You mentor ${trainee} here. They own the plan; you review it.`}
            </p>
          </div>
        </div>
        <div className="flex-1" />
        {isOwner ? (
          <div className="text-right">
            <StageSegment
              stage={stage}
              onChange={(s) =>
                call(() => idpsApi.setCareerStage(idp.id, s))
              }
            />
            <p className="mt-1 max-w-xs text-meta text-foreground-muted">
              One form, filtered by stage. Switching hides or surfaces rows.
            </p>
          </div>
        ) : (
          <span className="rounded-full bg-surface-sunken px-3 py-1 text-meta font-medium capitalize text-foreground-muted">
            {STAGES.find((s) => s.id === stage)?.label}
          </span>
        )}
      </div>

      {/* Compliance hook */}
      <div className="flex items-start gap-2 border-b border-border bg-amber-50/60 px-5 py-2.5 text-meta text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
        <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>
          Compliance hook. The lab-head view shows only that a plan is on file
          and when it was last updated, never the contents. NSF has required
          since May 2024 that a plan exists. The plan stays the trainee&apos;s,
          so candid self-assessment stays safe.
        </span>
      </div>

      <div className="flex flex-col gap-3 p-5">
        {/* 1 Self-assessment */}
        <Section
          num={1}
          sectionKey="self_assessment"
          title="Self-assessment"
          meta="rate each skill 1 to 5, then how much it matters 1 to 5"
          idp={idp}
          isOwner={isOwner}
          open={openSec.self_assessment}
          onToggle={() => toggleSec("self_assessment")}
          onShareChange={(v) =>
            call(() => idpsApi.setSectionShared(idp.id, "self_assessment", v))
          }
        >
          <SelfAssessment idp={idp} stage={stage} isOwner={isOwner} call={call} />
        </Section>

        {/* 2 Career exploration */}
        <Section
          num={2}
          sectionKey="career_exploration"
          title="Career exploration"
          meta="aspirations and a target path"
          idp={idp}
          isOwner={isOwner}
          open={openSec.career_exploration}
          onToggle={() => toggleSec("career_exploration")}
          onShareChange={(v) =>
            call(() =>
              idpsApi.setSectionShared(idp.id, "career_exploration", v),
            )
          }
        >
          <CareerExploration idp={idp} isOwner={isOwner} call={call} />
        </Section>

        {/* 3 Goals */}
        <Section
          num={3}
          sectionKey="goals"
          title="Goals"
          meta="short-term and long-term, with an optional priority"
          idp={idp}
          isOwner={isOwner}
          open={openSec.goals}
          onToggle={() => toggleSec("goals")}
          onShareChange={(v) =>
            call(() => idpsApi.setSectionShared(idp.id, "goals", v))
          }
        >
          <Goals idp={idp} isOwner={isOwner} call={call} />
        </Section>

        {/* 4 Action plan */}
        <Section
          num={4}
          sectionKey="action_plan"
          title="Action plan"
          meta="the four-column SMART table"
          idp={idp}
          isOwner={isOwner}
          open={openSec.action_plan}
          onToggle={() => toggleSec("action_plan")}
          onShareChange={(v) =>
            call(() => idpsApi.setSectionShared(idp.id, "action_plan", v))
          }
        >
          <ActionPlan idp={idp} trainee={trainee} isOwner={isOwner} call={call} />
        </Section>

        {/* 5 Mentor review */}
        <Section
          num={5}
          title="Mentor review"
          meta="a comment and sign-off, not co-ownership"
          idp={idp}
          isOwner={isOwner}
          open={openSec.review}
          onToggle={() => toggleSec("review")}
          shareable={false}
        >
          <MentorReview idp={idp} isOwner={isOwner} mentor={mentor} call={call} />
        </Section>

        {/* Values reflection (owner-only, always private) */}
        {isOwner && <ValuesReflection idp={idp} call={call} />}
      </div>
    </div>
  );
}

// ── Section shell ────────────────────────────────────────────────────────────

function Section({
  num,
  title,
  meta,
  idp,
  isOwner,
  open,
  onToggle,
  onShareChange,
  sectionKey,
  shareable = true,
  children,
}: {
  num: number;
  title: string;
  meta: string;
  idp: IDP;
  isOwner: boolean;
  open: boolean;
  onToggle: () => void;
  onShareChange?: (v: boolean) => void;
  sectionKey?: IdpSectionKey;
  shareable?: boolean;
  children: React.ReactNode;
}) {
  const shared = sectionKey ? idp.shared_sections[sectionKey] === true : false;
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-2 bg-surface-sunken px-4 py-2.5">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-brand-action text-meta font-bold text-white">
          {num}
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span className="text-body font-semibold text-foreground">{title}</span>
          <span className="text-meta text-foreground-muted">{meta}</span>
        </button>
        {shareable && sectionKey && (
          <ShareToggle
            shared={shared}
            disabled={!isOwner}
            onChange={(v) => onShareChange?.(v)}
          />
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Collapse section" : "Expand section"}
          className="text-foreground-muted"
        >
          <Icon
            name="chevronDown"
            className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
      </div>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

function ShareToggle({
  shared,
  disabled,
  onChange,
}: {
  shared: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const label = shared ? "Shared with mentor" : "Private to you";
  return (
    <Tooltip
      label={
        disabled
          ? shared
            ? "The trainee shares this section with you"
            : "The trainee keeps this section private"
          : shared
            ? "Click to keep this section private"
            : "Click to share this section with your mentor"
      }
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!shared)}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-meta font-semibold transition-colors ${
          shared
            ? "border-green-500 bg-green-50 text-green-600 dark:bg-green-900/20"
            : "border-border bg-surface-raised text-foreground-muted"
        } ${disabled ? "cursor-default opacity-80" : ""}`}
      >
        <Icon name={shared ? "share" : "lock"} className="h-3 w-3" />
        {shared ? "Shared" : "Private"}
      </button>
    </Tooltip>
  );
}

// ── 1 Self-assessment ────────────────────────────────────────────────────────

function SelfAssessment({
  idp,
  stage,
  isOwner,
  call,
}: {
  idp: IDP;
  stage: CareerStage;
  isOwner: boolean;
  call: (fn: () => Promise<unknown>) => void;
}) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    COMPETENCY_GROUPS.forEach((g, i) => (init[g.id] = i === 0));
    return init;
  });
  const ratings = idp.self_assessment.ratings;
  const summary = useMemo(
    () => deriveCompetencySummary(ratings, stage),
    [ratings, stage],
  );

  const setRating = (skillId: string, kind: "self" | "importance", v: number) => {
    const current: IdpSkillRating = ratings[skillId] ?? {
      self: null,
      importance: null,
    };
    // Click the active pip to clear it.
    const nextVal = current[kind] === v ? null : v;
    const next: IdpSkillRating = { ...current, [kind]: nextVal };
    call(() => idpsApi.setRating(idp.id, skillId, next));
  };

  // A mentor with a blanked section sees nothing meaningful; show a note.
  const blanked =
    !isOwner && idp.shared_sections.self_assessment !== true;
  if (blanked) {
    return <PrivateSectionNote />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {COMPETENCY_GROUPS.map((group) => {
        const visibleSkills = group.skills.filter((s) =>
          skillVisibleForStage(s, stage),
        );
        if (visibleSkills.length === 0) return null;
        const open = openGroups[group.id];
        return (
          <div
            key={group.id}
            className="overflow-hidden rounded-lg border border-border"
          >
            <button
              type="button"
              onClick={() =>
                setOpenGroups((s) => ({ ...s, [group.id]: !s[group.id] }))
              }
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-body font-medium"
            >
              <span className="text-foreground">{group.name}</span>
              <span className="text-meta text-foreground-muted">
                ({visibleSkills.length})
              </span>
              <span className="flex-1" />
              <Icon
                name="chevronDown"
                className={`h-3.5 w-3.5 text-foreground-muted transition-transform ${open ? "" : "-rotate-90"}`}
              />
            </button>
            {open && (
              <div className="border-t border-border px-3 py-1.5">
                {visibleSkills.map((skill) => {
                  const r: IdpSkillRating = ratings[skill.id] ?? {
                    self: null,
                    importance: null,
                  };
                  return (
                    <div
                      key={skill.id}
                      className="flex flex-wrap items-center gap-3 border-b border-border py-2 text-body last:border-none"
                    >
                      <span className="min-w-[140px] flex-1 text-foreground">
                        {skill.label}
                      </span>
                      <Pips
                        label="you"
                        value={r.self}
                        kind="self"
                        disabled={!isOwner}
                        onPick={(v) => setRating(skill.id, "self", v)}
                      />
                      <Pips
                        label="matters"
                        value={r.importance}
                        kind="importance"
                        disabled={!isOwner}
                        onPick={(v) => setRating(skill.id, "importance", v)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Live summary */}
      <div className="mt-1 flex flex-wrap gap-2.5">
        <SummaryCard
          tone="strength"
          title="Strengths (you rated 4 to 5)"
          tags={summary.strengths}
          empty="No 4 to 5 ratings yet."
        />
        <SummaryCard
          tone="growth"
          title="Growth areas (rated 1 to 2)"
          tags={summary.growthAreas.map(
            (g) => `${g.label}${g.bigGap ? " · big gap" : ""}`,
          )}
          empty="No 1 to 2 ratings yet."
        />
      </div>
      <p className="text-meta text-foreground-muted">
        The gap between your rating and how much a skill matters is the signal
        that feeds your goals.
      </p>

      <label className="mt-2 block text-meta font-semibold text-foreground-muted">
        Current responsibilities and near-term requirements
      </label>
      <textarea
        rows={2}
        defaultValue={idp.self_assessment.responsibilities}
        disabled={!isOwner}
        onBlur={(e) =>
          isOwner &&
          e.target.value !== idp.self_assessment.responsibilities &&
          call(() => idpsApi.setResponsibilities(idp.id, e.target.value))
        }
        placeholder="What you are responsible for now, and any near-term requirements (quals, committee, fellowship renewal)..."
        className="w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground"
      />
    </div>
  );
}

function Pips({
  label,
  value,
  kind,
  disabled,
  onPick,
}: {
  label: string;
  value: number | null;
  kind: "self" | "importance";
  disabled: boolean;
  onPick: (v: number) => void;
}) {
  const onColor =
    kind === "self"
      ? "border-brand-action bg-brand-action text-white"
      : "border-brand-purple bg-brand-purple text-white";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-12 text-right text-meta text-foreground-muted">
        {label}
      </span>
      <span className="inline-flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => {
          const on = value !== null && i <= value;
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onPick(i)}
              aria-label={`${label} ${i}`}
              className={`flex h-[18px] w-[18px] items-center justify-center rounded border text-[10px] font-semibold transition-colors ${
                on
                  ? onColor
                  : "border-border bg-surface-raised text-foreground-muted"
              } ${disabled ? "cursor-default" : ""}`}
            >
              {i}
            </button>
          );
        })}
      </span>
    </span>
  );
}

function SummaryCard({
  tone,
  title,
  tags,
  empty,
}: {
  tone: "strength" | "growth";
  title: string;
  tags: string[];
  empty: string;
}) {
  const labelColor = tone === "strength" ? "text-green-600" : "text-amber-600";
  const tagColor =
    tone === "strength"
      ? "bg-green-50 text-green-600 dark:bg-green-900/20"
      : "bg-amber-50 text-amber-600 dark:bg-amber-900/20";
  return (
    <div className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface-sunken px-3 py-2.5">
      <p
        className={`mb-1.5 flex items-center gap-1.5 text-meta font-bold uppercase tracking-wide ${labelColor}`}
      >
        <Icon name={tone === "strength" ? "check" : "growth"} className="h-3 w-3" />
        {title}
      </p>
      {tags.length === 0 ? (
        <p className="text-meta text-foreground-muted">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className={`rounded-full px-2.5 py-0.5 text-meta font-medium ${tagColor}`}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PrivateSectionNote() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface-sunken/50 px-3 py-3 text-meta text-foreground-muted">
      <Icon name="eyeOff" className="h-3.5 w-3.5" />
      The trainee keeps this section private. It is not shared with you.
    </div>
  );
}

// ── 2 Career exploration ─────────────────────────────────────────────────────

function CareerExploration({
  idp,
  isOwner,
  call,
}: {
  idp: IDP;
  isOwner: boolean;
  call: (fn: () => Promise<unknown>) => void;
}) {
  const blanked =
    !isOwner && idp.shared_sections.career_exploration !== true;
  if (blanked) return <PrivateSectionNote />;

  const save = (aspirations: string, target_path: string) => {
    if (
      aspirations === idp.career_exploration.aspirations &&
      target_path === idp.career_exploration.target_path
    ) {
      return;
    }
    call(() =>
      idpsApi.setCareerExploration(idp.id, { aspirations, target_path }),
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="block text-meta font-semibold text-foreground-muted">
        Career aspirations
      </label>
      <textarea
        rows={2}
        disabled={!isOwner}
        defaultValue={idp.career_exploration.aspirations}
        onBlur={(e) =>
          isOwner && save(e.target.value, idp.career_exploration.target_path)
        }
        placeholder="Where you are headed and why..."
        className="w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground"
      />
      <label className="mt-2 block text-meta font-semibold text-foreground-muted">
        Target path
      </label>
      <input
        disabled={!isOwner}
        defaultValue={idp.career_exploration.target_path}
        onBlur={(e) =>
          isOwner && save(idp.career_exploration.aspirations, e.target.value)
        }
        className="w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground"
      />
      <p className="mt-2 text-meta text-foreground-muted">
        Run the career-matching assessment at myIDP (AAAS), ImaginePhD, or
        ChemIDP and record the result here. We do not rebuild the matching
        engine, that is myIDP&apos;s whole product.
      </p>
    </div>
  );
}

// ── 3 Goals ──────────────────────────────────────────────────────────────────

function Goals({
  idp,
  isOwner,
  call,
}: {
  idp: IDP;
  isOwner: boolean;
  call: (fn: () => Promise<unknown>) => void;
}) {
  const blanked = !isOwner && idp.shared_sections.goals !== true;
  if (blanked) return <PrivateSectionNote />;

  const setGoals = (goals: IdpGoal[]) =>
    call(() => idpsApi.setGoals(idp.id, goals));

  const editText = (id: string, text: string) =>
    setGoals(idp.goals.map((g) => (g.id === id ? { ...g, text } : g)));
  const cyclePriority = (id: string) =>
    setGoals(
      idp.goals.map((g) => {
        if (g.id !== id) return g;
        const next: IdpGoal["priority"] =
          g.priority === null ? "high" : g.priority === "high" ? "low" : null;
        return { ...g, priority: next };
      }),
    );
  const remove = (id: string) =>
    setGoals(idp.goals.filter((g) => g.id !== id));
  const add = (term: IdpGoalTerm) =>
    setGoals([
      ...idp.goals,
      { id: crypto.randomUUID(), text: "", term, priority: null },
    ]);

  const renderTerm = (term: IdpGoalTerm, heading: string) => {
    const list = idp.goals.filter((g) => g.term === term);
    return (
      <div className="flex flex-col gap-1">
        <label className="block text-meta font-semibold text-foreground-muted">
          {heading}
        </label>
        {list.map((g) => (
          <div
            key={g.id}
            className="flex items-center gap-2 border-b border-border py-1.5 text-body last:border-none"
          >
            <input
              defaultValue={g.text}
              disabled={!isOwner}
              onBlur={(e) =>
                isOwner && e.target.value !== g.text && editText(g.id, e.target.value)
              }
              placeholder="Describe the goal..."
              className="flex-1 bg-transparent text-foreground outline-none"
            />
            <PriorityChip
              priority={g.priority}
              disabled={!isOwner}
              onClick={() => cyclePriority(g.id)}
            />
            {isOwner && (
              <Tooltip label="Remove goal">
                <button
                  type="button"
                  onClick={() => remove(g.id)}
                  aria-label="Remove goal"
                  className="text-foreground-muted hover:text-red-500"
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            )}
          </div>
        ))}
        {isOwner && (
          <button
            type="button"
            onClick={() => add(term)}
            className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-meta font-semibold text-brand-action"
          >
            <Icon name="plus" className="h-3 w-3" />
            Add a {term === "short" ? "short-term" : "long-term"} goal
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {renderTerm("short", "Short-term (6 months or less)")}
      {renderTerm("long", "Long-term (more than 6 months)")}
    </div>
  );
}

function PriorityChip({
  priority,
  disabled,
  onClick,
}: {
  priority: IdpGoal["priority"];
  disabled: boolean;
  onClick: () => void;
}) {
  const cls =
    priority === "high"
      ? "border-rose-500 bg-rose-50 text-rose-600 dark:bg-rose-900/20"
      : priority === "low"
        ? "border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/20"
        : "border-border bg-surface-raised text-foreground-muted";
  const label = priority === "high" ? "High" : priority === "low" ? "Low" : "Priority";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-meta font-bold ${cls} ${disabled ? "cursor-default" : ""}`}
    >
      {label}
    </button>
  );
}

// ── 4 Action plan ────────────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ id: IdpActionStatus; label: string }> = [
  { id: "not_started", label: "Not started" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

function ActionPlan({
  idp,
  trainee,
  isOwner,
  call,
}: {
  idp: IDP;
  trainee: string;
  isOwner: boolean;
  call: (fn: () => Promise<unknown>) => void;
}) {
  const blanked = !isOwner && idp.shared_sections.action_plan !== true;
  if (blanked) return <PrivateSectionNote />;

  const editRow = (
    rowId: string,
    patch: Partial<
      Pick<
        IdpActionRow,
        "objective" | "approach" | "target_date" | "outcome" | "status"
      >
    >,
  ) => call(() => idpsApi.updateActionRow(idp.id, rowId, patch));

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr>
              {[
                "Objective / skill to learn",
                "Approach and strategy",
                "Target date",
                "Done when",
                "Status",
                "",
              ].map((h) => (
                <th
                  key={h}
                  className="px-2 py-1.5 text-left text-meta font-bold uppercase tracking-wide text-foreground-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {idp.action_plan.map((row) => (
              <tr key={row.id} className="border-t border-border align-middle">
                <td className="px-2 py-2">
                  <input
                    defaultValue={row.objective}
                    disabled={!isOwner}
                    onBlur={(e) =>
                      isOwner &&
                      e.target.value !== row.objective &&
                      editRow(row.id, { objective: e.target.value })
                    }
                    placeholder="Objective..."
                    className="w-full bg-transparent text-foreground outline-none"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    defaultValue={row.approach}
                    disabled={!isOwner}
                    onBlur={(e) =>
                      isOwner &&
                      e.target.value !== row.approach &&
                      editRow(row.id, { approach: e.target.value })
                    }
                    placeholder="Approach..."
                    className="w-full bg-transparent text-foreground outline-none"
                  />
                </td>
                <td className="px-2 py-2">
                  {isOwner ? (
                    <input
                      type="date"
                      defaultValue={row.target_date ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value || null;
                        if (v !== row.target_date)
                          editRow(row.id, { target_date: v });
                      }}
                      className="rounded-md border border-border bg-surface-sunken px-2 py-1 text-meta text-foreground"
                    />
                  ) : row.target_date ? (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-meta font-medium text-blue-600 dark:bg-blue-900/20">
                      {fmtDate(row.target_date)}
                    </span>
                  ) : (
                    <span className="text-foreground-muted">—</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <input
                    defaultValue={row.outcome}
                    disabled={!isOwner}
                    onBlur={(e) =>
                      isOwner &&
                      e.target.value !== row.outcome &&
                      editRow(row.id, { outcome: e.target.value })
                    }
                    placeholder="Done when..."
                    className="w-full bg-transparent text-foreground outline-none"
                  />
                </td>
                <td className="px-2 py-2">
                  <StatusSegment
                    status={row.status}
                    disabled={!isOwner}
                    onChange={(s) => editRow(row.id, { status: s })}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    {isOwner && (
                      <AddToTasks
                        row={row}
                        trainee={trainee}
                        onAdd={() =>
                          call(() =>
                            idpsApi.addActionRowToTasks(idp.id, row.id),
                          )
                        }
                      />
                    )}
                    {isOwner && (
                      <Tooltip label="Delete row">
                        <button
                          type="button"
                          onClick={() =>
                            call(() =>
                              idpsApi.deleteActionRow(idp.id, row.id),
                            )
                          }
                          aria-label="Delete row"
                          className="text-foreground-muted hover:text-red-500"
                        >
                          <Icon name="x" className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isOwner && (
        <button
          type="button"
          onClick={() => call(() => idpsApi.addActionRow(idp.id))}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-meta font-semibold text-brand-action"
        >
          <Icon name="plus" className="h-3 w-3" />
          Add an action row
        </button>
      )}
      <div className="flex items-center gap-1.5 text-meta text-green-600">
        <Icon name="refresh" className="h-3 w-3" />
        A dated row can become a real to-do on {isOwner ? "your" : `${trainee}'s`}{" "}
        Lists. It lands next to {isOwner ? "your" : "their"} other lab work, not
        siloed here.
      </div>
    </div>
  );
}

function StatusSegment({
  status,
  disabled,
  onChange,
}: {
  status: IdpActionStatus;
  disabled: boolean;
  onChange: (s: IdpActionStatus) => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-border">
      {STATUS_OPTIONS.map((opt, i) => (
        <button
          key={opt.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.id)}
          className={`px-2 py-1 text-[10.5px] font-semibold transition-colors ${i > 0 ? "border-l border-border" : ""} ${
            status === opt.id
              ? "bg-brand-action text-white"
              : "bg-surface-raised text-foreground-muted"
          } ${disabled ? "cursor-default" : ""}`}
        >
          {opt.label}
        </button>
      ))}
    </span>
  );
}

function AddToTasks({
  row,
  trainee,
  onAdd,
}: {
  row: IdpActionRow;
  trainee: string;
  onAdd: () => void;
}) {
  if (typeof row.synced_task_id === "number") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500 px-2.5 py-0.5 text-meta font-bold text-white">
        <Icon name="check" className="h-3 w-3" />
        On {trainee}&apos;s tasks
      </span>
    );
  }
  if (!row.target_date) {
    return (
      <span className="text-meta text-foreground-muted">add a target date</span>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      className="inline-flex items-center gap-1 rounded-full border border-green-500 bg-green-50 px-2.5 py-0.5 text-meta font-bold text-green-600 dark:bg-green-900/20"
    >
      <Icon name="plus" className="h-3 w-3" />
      Add to tasks
    </button>
  );
}

// ── 5 Mentor review ──────────────────────────────────────────────────────────

function MentorReview({
  idp,
  isOwner,
  mentor,
  call,
}: {
  idp: IDP;
  isOwner: boolean;
  mentor: string | null;
  call: (fn: () => Promise<unknown>) => void;
}) {
  const review = idp.mentor_review;
  const [comment, setComment] = useState(review.comment);
  const canReview = !isOwner && mentor !== null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-brand-purple/10 px-2.5 py-1 text-meta font-bold text-brand-purple">
          Review, not co-ownership
        </span>
        <span className="text-meta text-foreground-muted">
          {isOwner
            ? "Your mentor comments and acknowledges. You edit the plan."
            : "You comment and acknowledge. The trainee edits the plan."}
        </span>
      </div>

      <label className="block text-meta font-semibold text-foreground-muted">
        {isOwner ? "Mentor comment" : "Your comment as mentor"}
      </label>
      <textarea
        rows={2}
        value={comment}
        disabled={!canReview}
        onChange={(e) => setComment(e.target.value)}
        placeholder={
          canReview
            ? "Your assessment and the headline focus for the year..."
            : "No mentor comment yet."
        }
        className="w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground"
      />

      <div className="flex flex-wrap items-center gap-2.5 text-meta text-foreground-muted">
        {review.reviewed_at && (
          <span className="rounded-md border border-border bg-surface-sunken px-2.5 py-1">
            Reviewed on{" "}
            <b className="text-foreground">
              {fmtDate(review.reviewed_at.slice(0, 10))}
            </b>
          </span>
        )}
        <span className="rounded-md border border-border bg-surface-sunken px-2.5 py-1">
          Next revisit{" "}
          <b className="text-foreground">{fmtMonthYear(review.revisit_date)}</b>{" "}
          (annual)
        </span>
        {canReview && (
          <button
            type="button"
            onClick={() =>
              call(() => idpsApi.submitReview(idp.id, { comment }))
            }
            className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-lg px-3 py-1.5 text-meta font-medium"
          >
            Sign off
          </button>
        )}
      </div>
    </div>
  );
}

// ── Values reflection (owner-only, always private) ───────────────────────────

function ValuesReflection({
  idp,
  call,
}: {
  idp: IDP;
  call: (fn: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const note = idp.values_reflection?.note ?? "";
  return (
    <div className="overflow-hidden rounded-xl border border-dashed border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-body font-semibold text-foreground">
          Values reflection
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-meta font-semibold text-foreground-muted">
          <Icon name="eyeOff" className="h-3 w-3" />
          Optional, private to you
        </span>
        <span className="flex-1" />
        <Icon
          name="chevronDown"
          className={`h-4 w-4 text-foreground-muted transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-2 text-meta text-foreground-muted">
            Reflecting on what matters to you (pay, work-life balance, prestige)
            is a private note, never shared or mentor-reviewed. Ranking personal
            priorities inside a doc your funder reviews carries a power-asymmetry
            we deliberately avoid.
          </p>
          <textarea
            rows={3}
            defaultValue={note}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v === note) return;
              call(() =>
                idpsApi.setValuesReflection(idp.id, v ? { note: v } : null),
              );
            }}
            placeholder="What matters most to you, and why. Only you ever see this."
            className="w-full rounded-lg border border-border bg-surface-sunken px-3 py-2 text-body text-foreground"
          />
        </div>
      )}
    </div>
  );
}
