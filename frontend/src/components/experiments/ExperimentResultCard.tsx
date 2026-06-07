"use client";

import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import UserAvatar from "@/components/UserAvatar";
import MethodChip from "./MethodChip";
import FreshnessTag, { type FreshnessKind } from "./FreshnessTag";
import { fileService } from "@/lib/file-system/file-service";
import AttributionChip from "@/components/AttributionChip";

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
  // VCP R3 attribution stamps — optional last-editor + when. WorkbenchExperimentsPanel
  // populates these from the underlying Task; cards rendered before R3
  // simply omit them and the chip self-hides.
  last_edited_by?: string;
  last_edited_at?: string;
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
  /**
   * Density variant (experiments-kanban density redesign, 2026-06-02).
   * Opt-in for the Workbench pipeline board, where cards stack vertically
   * inside narrow kanban columns and most in-flight experiments have no
   * media yet. Default `false` preserves the byte-for-byte original card:
   * the /lab Experiments gallery (LabExperimentsPanel) never passes it, so
   * that surface keeps its 128px hero + "No image or write-up yet"
   * placeholder unchanged.
   *
   * When `compact` is true:
   *  - no image AND no preview -> the 128px hero is dropped entirely in
   *    favor of a subtle left accent border (border-l-4) tinted with the
   *    task's `experiment_color` (same source the hero gradient uses), so
   *    media-less in-flight cards collapse to a tight title/footer row.
   *  - image OR preview present -> a shorter 96px (h-24) hero instead of
   *    the full 128px (h-32).
   */
  compact?: boolean;
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
  compact = false,
}: ExperimentResultCardProps) {
  const heroBg = task.experiment_color ?? "#9ca3af";

  // Compact + media-less: the 128px hero is overkill for a narrow board
  // column, so it collapses to a thin color strip. Any image/preview still
  // earns a hero, just shorter (h-24 vs h-32).
  const hasMedia = Boolean(heroImagePath || resultsPreview);
  const stripOnly = compact && !hasMedia;

  return (
    <button
      type="button"
      onClick={onClick}
      // Onboarding v4 §6.6 `experiment-attach-method-open` sub-step
      // anchor. The cursor demo opens the experiment popup by clicking
      // the most-recently-created experiment row in the workbench list.
      // Per-row id keeps the selector specific so a future tour beat
      // can target a particular experiment if needed.
      data-tour-target={`workbench-experiment-row-${task.id}`}
      className={`group text-left bg-surface-raised rounded-xl border border-border overflow-hidden hover:border-emerald-300 hover:shadow-sm transition flex flex-col${
        stripOnly ? " border-l-4" : ""
      }`}
      style={stripOnly ? { borderLeftColor: heroBg } : undefined}
    >
      {stripOnly ? (
        // Media-less compact card: no hero, just a tasteful color spine on
        // the card's left edge (border-l-4 above, tinted with the same
        // experiment_color source the gradient hero uses). The shared
        // indicator (if any) still needs a home, so it floats top-right.
        sharedIndicator ? (
          <div className="relative">
            <div className="absolute top-2 right-2">{sharedIndicator}</div>
          </div>
        ) : null
      ) : (
        <div
          className={`relative ${compact ? "h-24" : "h-32"} w-full overflow-hidden flex items-center justify-center`}
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
            <MarkdownPreview content={resultsPreview} />
          ) : (
            <div className="flex flex-col items-center justify-center text-foreground-muted text-meta">
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
      )}

      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start gap-2 min-w-0">
          {task.experiment_color ? (
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
              style={{ backgroundColor: task.experiment_color }}
              aria-hidden
            />
          ) : null}
          <h3 className="text-body font-medium text-foreground truncate flex-1">
            {task.name}
          </h3>
        </div>

        <div className="flex items-center gap-2 text-meta text-foreground-muted min-w-0">
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
                <span className="text-foreground-muted mx-1">•</span>
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
              <span className="text-meta text-foreground-muted self-center">
                +{methods.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto pt-1">
          <FreshnessTag kind={freshnessKind} label={freshnessLabel} />
        </div>

        {/* VCP R3 attribution stamps (VCP R3 attribution stamps,
            2026-05-26): inline last-edited chip in the experiment card
            footer. Self-hides on pre-R3 tasks that lack the fields. */}
        {(task.last_edited_by || task.last_edited_at) && (
          <div className="pt-1">
            <AttributionChip
              username={task.last_edited_by}
              editedAt={task.last_edited_at}
              small
            />
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * Compact rendered-markdown preview for the card hero. Same sanitize pipeline
 * as RenderedMarkdown / the rest of the app (per `03f77091` audit), but with
 * heading/paragraph/link overrides tuned for an 11px hero strip:
 *  - headings collapse to bold inline-block text (no oversized fonts)
 *  - paragraphs/lists use tight margins so 3 lines look like 3 lines
 *  - links render as non-interactive spans so the card-level click wins (and
 *    so we don't nest <a> inside the parent <button>)
 */
export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="text-meta leading-snug text-foreground px-3 py-2 max-h-full overflow-hidden w-full">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkUnderline]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
        components={{
          h1: ({ children }) => (
            <strong className="block text-meta mb-0.5">{children}</strong>
          ),
          h2: ({ children }) => (
            <strong className="block text-meta mb-0.5">{children}</strong>
          ),
          h3: ({ children }) => (
            <strong className="block text-meta mb-0.5">{children}</strong>
          ),
          h4: ({ children }) => (
            <strong className="block text-meta mb-0.5">{children}</strong>
          ),
          h5: ({ children }) => (
            <strong className="block text-meta mb-0.5">{children}</strong>
          ),
          h6: ({ children }) => (
            <strong className="block text-meta mb-0.5">{children}</strong>
          ),
          p: ({ children }) => <div className="mb-1">{children}</div>,
          ul: ({ children }) => (
            <ul className="list-disc pl-4 my-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-4 my-0.5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-snug">{children}</li>,
          a: ({ children }) => (
            <span className="text-blue-600 underline">{children}</span>
          ),
          code: ({ children }) => (
            <code className="font-mono text-[10px] bg-surface-sunken rounded px-0.5">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="font-mono text-[10px] bg-surface-sunken rounded p-1 max-h-12 overflow-hidden">
              {children}
            </pre>
          ),
          img: () => null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
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
