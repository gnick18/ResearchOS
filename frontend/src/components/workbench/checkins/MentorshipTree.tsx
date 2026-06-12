"use client";

// Check-ins Phase 4 (checkins-phase4 bot, 2026-06-12). See
// docs/proposals/checkins-revamp.md "Part 3, the academic layer" (the
// "Mentorship-tree visualization" paragraph) and the approved mockup
// docs/mockups/2026-06-12-checkins-phase3-idp.html (the "View lab tree"
// placeholder).
//
// The lab hierarchy tree, rendered from the mentor-edge data the viewer can
// already read. The viewer only sees spaces their `oneOnOnesApi.list()` returns
// (a member sees their own relationships, a PI sees the whole lab), so there is
// no cross-user read here. The tree is a clean nested-row hierarchy (mentor
// above mentee, indentation = depth), reusing the app's row visual language and
// brand tokens, dark-mode safe.
//
// VISUALS ARE OPEN TO ITERATION. The brief and mockup bless the concept but
// pin no pixel-level design, so this is a conventional nested-row tree the
// orchestrator can hand to Grant to refine on :3000. House style: `<Icon>`
// only, brand tokens, no em-dashes, no emojis, no mid-sentence colons.

import { useMemo } from "react";
import { Icon } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import { buildMentorshipForest } from "@/lib/checkins/mentorship-tree";
import type { MentorTreeNode } from "@/lib/checkins/mentorship-tree";
import type { OneOnOne } from "@/lib/types";

interface MentorshipTreeProps {
  /** Every check-in space the viewer can read (the output of
   *  `oneOnOnesApi.list()`). The forest is computed from these. */
  spaces: OneOnOne[];
  /** The signed-in username, highlighted in the tree so the viewer finds
   *  themselves quickly. */
  currentUser: string;
}

/** One person row in the tree. Indents by depth; the viewer's own row is
 *  highlighted. A mentor with children shows a small "mentors" caption. */
function TreeRow({
  node,
  depth,
  currentUser,
}: {
  node: MentorTreeNode;
  depth: number;
  currentUser: string;
}) {
  const isSelf = node.username === currentUser;
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
          isSelf
            ? "bg-brand-action/10 text-foreground"
            : "text-foreground hover:bg-surface-sunken"
        }`}
        style={{ marginLeft: depth * 22 }}
        data-testid={`mentorship-tree-node-${node.username}`}
      >
        {depth > 0 && (
          <Icon
            name="chevronRight"
            className="h-3.5 w-3.5 flex-shrink-0 text-foreground-muted"
            aria-hidden
          />
        )}
        <UserAvatar username={node.username} size="xs" />
        <span className="truncate text-body font-medium">{node.username}</span>
        {isSelf && (
          <span className="rounded bg-brand-action/15 px-1.5 py-0.5 text-meta font-semibold text-brand-action">
            You
          </span>
        )}
        {hasChildren && (
          <span className="ml-1 text-meta text-foreground-muted">
            mentors {node.children.length}
          </span>
        )}
      </div>
      {hasChildren && (
        <ul className="mt-1 flex flex-col gap-1">
          {node.children.map((child) => (
            <TreeRow
              key={`${node.username}>${child.username}`}
              node={child}
              depth={depth + 1}
              currentUser={currentUser}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The mentorship tree view. Renders one subtree per root (a mentor who is not
 * themselves mentored within the readable set). Shows an empty state when no
 * mentoring edges exist (every space is a peer space, or the viewer reads none).
 */
export default function MentorshipTree({
  spaces,
  currentUser,
}: MentorshipTreeProps) {
  const forest = useMemo(() => buildMentorshipForest(spaces), [spaces]);

  if (forest.length === 0) {
    return (
      <div
        className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border bg-surface-sunken/40 px-4 py-5 text-body text-foreground-muted"
        data-testid="mentorship-tree-empty"
      >
        <div className="flex items-center gap-2 text-foreground">
          <Icon name="labTree" className="h-4 w-4 text-foreground-muted" />
          <span className="font-medium">No mentoring relationships yet</span>
        </div>
        <p>
          The lab tree maps who checks in with whom. It fills in as mentoring
          check-ins (a space with a mentor) are created. Peer check-ins do not
          add an edge.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="mentorship-tree">
      <div className="flex items-center gap-2 text-meta text-foreground-muted">
        <Icon name="labTree" className="h-4 w-4" />
        <span>
          Who checks in with whom. A mentor sits above the people they mentor.
          You see only the relationships in check-ins you can read.
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {forest.map((root) => (
          <TreeRow
            key={root.username}
            node={root}
            depth={0}
            currentUser={currentUser}
          />
        ))}
      </ul>
    </div>
  );
}
