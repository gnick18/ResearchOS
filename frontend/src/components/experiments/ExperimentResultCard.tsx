"use client";

import { useEffect, useState, type ReactNode } from "react";
import UserAvatar from "@/components/UserAvatar";
import MethodChip from "./MethodChip";
import FreshnessTag, { type FreshnessKind } from "./FreshnessTag";
import { fileService } from "@/lib/file-system/file-service";

export interface ExperimentCardMethod {
  id: number;
  name: string;
  color?: string | null;
  onClick?: () => void;
}

export interface ExperimentCardTask {
  id: number;
  name: string;
  username: string;
  experiment_color: string | null;
  project_name?: string;
}

interface ExperimentResultCardProps {
  task: ExperimentCardTask;
  /** Hero — first image path in the task's `Images/` folder, if any. */
  heroImagePath: string | null;
  /** Fallback hero — first ~N lines of `results.md`, if no image exists. */
  resultsPreview: string | null;
  methods: ExperimentCardMethod[];
  freshnessKind: FreshnessKind;
  freshnessLabel?: string;
  onClick?: () => void;
  onAvatarClick?: () => void;
  /**
   * Optional slot for an "owner / collaborator" indicator (e.g. the
   * "Shared into morgan's project" amber pill). The /lab Experiments
   * gallery leaves this empty since it shows the whole lab's outputs;
   * the future /workbench will populate it for shared-into-me tasks.
   */
  sharedIndicator?: ReactNode;
}

/**
 * Hero-thumbnail card for an experiment's outcome. The single source of
 * truth for the gallery card style across both /lab Experiments (where
 * this lives today) and the future /workbench "Recent results" section
 * (which imports this component and feeds it the same data shape).
 *
 * Hero precedence (per v3 ruling, Q3):
 *   1. First image in task's `Images/` (rendered via `heroImagePath`).
 *   2. First ~3 lines of `results.md` (rendered via `resultsPreview`).
 *   3. Styled placeholder tinted with the task's `experiment_color`.
 * Notes.md content is never used as a hero — notes are process, results
 * are conclusions.
 */
export default function ExperimentResultCard({
  task,
  heroImagePath,
  resultsPreview,
  methods,
  freshnessKind,
  freshnessLabel,
  onClick,
  onAvatarClick,
  sharedIndicator,
}: ExperimentResultCardProps) {
  const heroBg = task.experiment_color ?? "#9ca3af";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-emerald-300 hover:shadow-sm transition flex flex-col"
    >
      <div
        className="relative h-32 w-full overflow-hidden flex items-center justify-center"
        style={{
          background:
            heroImagePath
              ? "#0b0b0b"
              : `linear-gradient(135deg, ${heroBg}22 0%, ${heroBg}11 100%)`,
        }}
      >
        {heroImagePath ? (
          <HeroImage path={heroImagePath} alt={task.name} />
        ) : resultsPreview ? (
          <pre
            className="text-[11px] leading-snug text-gray-700 whitespace-pre-wrap px-3 py-2 max-h-full overflow-hidden w-full font-mono"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
          >
            {resultsPreview}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center text-gray-400 text-xs">
            <svg
              className="w-8 h-8 mb-1 opacity-50"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span>No image or write-up yet</span>
          </div>
        )}
        {sharedIndicator ? (
          <div className="absolute top-2 right-2">{sharedIndicator}</div>
        ) : null}
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start gap-2 min-w-0">
          {task.experiment_color ? (
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
              style={{ backgroundColor: task.experiment_color }}
              aria-hidden
            />
          ) : null}
          <h3 className="text-sm font-medium text-gray-900 truncate flex-1">
            {task.name}
          </h3>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500 min-w-0">
          <span
            onClick={(e) => {
              if (!onAvatarClick) return;
              e.stopPropagation();
              onAvatarClick();
            }}
            className={onAvatarClick ? "cursor-pointer hover:opacity-80" : ""}
          >
            <UserAvatar username={task.username} size="xs" />
          </span>
          <span className="truncate">
            {task.username}
            {task.project_name ? (
              <>
                <span className="text-gray-300 mx-1">•</span>
                {task.project_name}
              </>
            ) : null}
          </span>
        </div>

        {methods.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {methods.slice(0, 3).map((m) => (
              <MethodChip
                key={`${m.id}-${m.name}`}
                name={m.name}
                color={m.color}
                onClick={m.onClick}
              />
            ))}
            {methods.length > 3 ? (
              <span className="text-[11px] text-gray-400 self-center">
                +{methods.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto pt-1">
          <FreshnessTag kind={freshnessKind} label={freshnessLabel} />
        </div>
      </div>
    </button>
  );
}

function HeroImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let revoke: string | null = null;
    (async () => {
      const blob = await fileService.readFileAsBlob(path);
      if (cancelled || !blob) return;
      const objectUrl = URL.createObjectURL(blob);
      revoke = objectUrl;
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [path]);

  if (!url) {
    return <div className="w-full h-full bg-gray-800" />;
  }
  return (
    <img
      src={url}
      alt={alt}
      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
    />
  );
}
