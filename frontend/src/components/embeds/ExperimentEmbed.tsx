"use client";

// Markdown embed hybrid, Phase 1. The experiment block-embed renderer.
//
// Loaded lazily by ObjectEmbed when a `[caption](?openTask=KEY#ros=...)` embed
// is on screen with a "experiment" type. Experiment records are Task records
// with task_type = "experiment". The descriptor id is a composite taskKey
// (e.g. "self:5" or "alice:5"). Reads the task with a plain effect and shows the
// experiment color dot (a styled span, not an svg) alongside the name. A deleted
// or unreadable task degrades to the calm generic card.
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

export default function ExperimentEmbed({ descriptor, caption }: EmbedRendererProps) {
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
  const href = objectDeepLink("experiment", descriptor.id);

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        {task.experiment_color ? (
          <span
            className="shrink-0 h-3 w-3 rounded-full border border-border"
            style={{ background: task.experiment_color }}
            aria-hidden
          />
        ) : null}
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open experiment ${title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
    </div>
  );
}
