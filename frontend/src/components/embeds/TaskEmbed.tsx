"use client";

// Markdown embed hybrid, Phase 1. The task block-embed renderer.
//
// Loaded lazily by ObjectEmbed when a `[caption](?openTask=KEY#ros=...)` embed
// is on screen. The descriptor id is a composite taskKey (e.g. "self:5" or
// "alice:5"). This splits it to get the numeric task id and optional owner, then
// reads the task with a plain effect. A deleted or unreadable task degrades to
// the calm generic card.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { tasksApi } from "@/lib/local-api";
import type { Task } from "@/lib/types";
import { objectDeepLink } from "@/lib/references";
import { ObjectEmbedCard, UnavailableEmbedCard, type EmbedRendererProps } from "./ObjectEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; task: Task };

/** Split a composite taskKey ("self:5" or "alice:5") into a numeric id and an
 *  optional owner. Returns null when the key is malformed. */
function splitTaskKey(key: string): { id: number; owner?: string } | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const ns = key.slice(0, colon);
  const numStr = key.slice(colon + 1);
  const id = Number(numStr);
  if (!Number.isFinite(id) || id <= 0) return null;
  return ns === "self" ? { id } : { id, owner: ns };
}

export default function TaskEmbed({ descriptor, caption }: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    const parsed = splitTaskKey(descriptor.id);
    if (!parsed) {
      setState({ k: "missing" });
      return;
    }
    setState({ k: "loading" });
    tasksApi
      .get(parsed.id, parsed.owner)
      .then((t) => {
        if (cancelled) return;
        setState(t ? { k: "ok", task: t } : { k: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ k: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [descriptor.id]);

  if (state.k === "loading") {
    return <ObjectEmbedCard descriptor={descriptor} caption={caption} loading />;
  }
  if (state.k === "missing") {
    return <UnavailableEmbedCard descriptor={descriptor} caption={caption} />;
  }

  const task = state.task;
  const title = task.name || caption;
  const statusLabel = task.is_complete ? "Complete" : "In progress";
  const href = objectDeepLink("task", descriptor.id);

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        <span className="shrink-0 text-meta text-foreground-muted">{statusLabel}</span>
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open task: ${title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
    </div>
  );
}
