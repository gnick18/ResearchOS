"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import {
  diffMarkdownLines,
  type DiffSegment,
} from "@/lib/methods/markdown-line-diff";
import { useUserColors } from "@/hooks/useUserColor";
import UserAvatar from "@/components/UserAvatar";

// Version Control Phase 1: in-place diff renderer for the Notes version viewer.
//
// Reuses diffMarkdownLines (line-level LCS) + the DiffView pattern from
// MarkdownMethodTabContent: `same` runs render through ReactMarkdown so
// markdown constructs survive, `add` runs go green, `remove` runs go red +
// line-through. The version-history twist is a PER-EDITOR tint: each changed
// run is left-bordered with the editor's user color and carries a small avatar
// at the run start, so "who wrote this line" reads at a glance (the Google Docs
// per-collaborator coloring).
//
// Color is never the ONLY signal: add/remove also carry the green/red text +
// the +/- gutter prefix + struck text for removals, so the diff reads for
// color-blind users and the per-editor tint is supplementary (house rule).

// Add/remove visual conventions, mirroring MarkdownMethodTabContent so the
// version diff and the method-override diff read identically. Green = added,
// red + line-through = removed. The editor tint rides on top as a left border.
const ADDED_CLASSES =
  "text-green-700 dark:text-green-300 whitespace-pre-wrap font-mono text-xs px-2 py-1 rounded";
const REMOVED_CLASSES =
  "text-red-700 dark:text-red-300 line-through whitespace-pre-wrap font-mono text-xs px-2 py-1 rounded";

interface VersionDiffViewProps {
  /** Predecessor (or current, when toggled) state, the diff "before". */
  before: string;
  /** Selected version state, the diff "after". */
  after: string;
  /** The editor credited with the selected version (drives the tint). */
  editor: string;
  /** Display label for the editor's avatar tooltip. */
  editorLabel: string;
}

/**
 * Render the markdown diff between `before` and `after`, tinting changed runs
 * with the selected version's editor color. `same` runs pass through
 * ReactMarkdown; changed runs render as colored monospace blocks (losing inline
 * markdown inside the hunk is the v1 trade-off, same as the method-override
 * diff renderer).
 */
export default function VersionDiffView({
  before,
  after,
  editor,
  editorLabel,
}: VersionDiffViewProps) {
  const colors = useUserColors(editor);
  const tint = colors.primary;

  const segments: DiffSegment[] = diffMarkdownLines(before, after);

  // A fully-unchanged version (e.g. a save that only touched a denylisted
  // stamp) produces a single `same` run. Surface that honestly rather than
  // rendering an empty diff.
  const hasChange = segments.some((s) => s.kind !== "same");

  return (
    <div className="space-y-3" data-testid="version-diff">
      {!hasChange && (
        <div className="text-meta text-gray-400 italic">
          No tracked content changed in this version.
        </div>
      )}
      {segments.map((segment, idx) => {
        if (segment.kind === "same") {
          return (
            <div
              key={idx}
              className="prose prose-sm prose-gray dark:prose-invert max-w-none"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkUnderline]}
                rehypePlugins={[
                  rehypeRaw,
                  [rehypeSanitize, markdownSanitizeSchema],
                ]}
              >
                {segment.lines.join("\n")}
              </ReactMarkdown>
            </div>
          );
        }
        const classes =
          segment.kind === "add" ? ADDED_CLASSES : REMOVED_CLASSES;
        const prefix = segment.kind === "add" ? "+ " : "- ";
        return (
          <div
            key={idx}
            data-testid={`diff-${segment.kind}`}
            className="flex items-start gap-2 pl-2 border-l-2 rounded bg-stone-50 dark:bg-white/[0.04]"
            style={{ borderLeftColor: tint }}
          >
            <span className="pt-1 flex-shrink-0">
              <UserAvatar username={editor} size="xs" title={editorLabel} />
            </span>
            <div className={classes}>
              {segment.lines.map((line, li) => (
                <div key={li}>
                  <span aria-hidden className="select-none opacity-60">
                    {prefix}
                  </span>
                  {line}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
