"use client";

// Markdown embed hybrid, Phase 1. The sequence-collection block-embed renderer.
//
// Loaded lazily by ObjectEmbed when a `[caption](/sequences?collection=ID#ros=...)`
// embed is on screen. A collection is backed by a project record, so this reads
// the project with a plain effect (no QueryClient dependency). A deleted or
// unreadable project degrades to the calm generic card.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { projectsApi } from "@/lib/local-api";
import type { Project } from "@/lib/types";
import { objectDeepLink } from "@/lib/references";
import { ObjectEmbedCard, UnavailableEmbedCard, type EmbedRendererProps } from "./ObjectEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; project: Project };

export default function CollectionEmbed({ descriptor, caption }: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });
    projectsApi
      .get(Number(descriptor.id))
      .then((p) => {
        if (cancelled) return;
        setState(p ? { k: "ok", project: p } : { k: "missing" });
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

  const project = state.project;
  const title = project.name || caption;
  const href = objectDeepLink("collection", descriptor.id);

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        <span className="shrink-0 rounded-full bg-surface-sunken border border-border px-2 py-0.5 text-meta text-foreground-muted">
          Collection
        </span>
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open collection ${title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
    </div>
  );
}
