"use client";

// Markdown + ResearchOS embed hybrid, Phase 1. The block-embed renderer.
//
// RenderedMarkdown calls this when a paragraph is a lone object-embed link (a
// link with a `#ros=` view, alone on its line). It dispatches to a per-type
// renderer by `descriptor.type`, lazily so the heavy renderers (RDKit, sequence
// maps, plots) never load until an embed of that type is actually on screen.
// Types without a rich renderer yet fall back to a calm generic card, so every
// embed renders something from day one.
//
// The frame (border, rounding) lives here, each renderer fills the body and uses
// the caption (the link text) as its title. No rendering of inline mentions, the
// `a` override in RenderedMarkdown still handles those as chips.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { lazy, Suspense, type ComponentType } from "react";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import { objectDeepLink, type EmbedDescriptor, type ObjectRefType } from "@/lib/references";

export interface EmbedRendererProps {
  descriptor: EmbedDescriptor;
  /** The link text, used as the embed's caption / title. */
  caption: string;
  /** The note's directory, for renderers that read files relative to it. */
  basePath?: string;
}

// Per-type rich renderers, added as each phase lands. A type absent here uses the
// generic card. Each module default-exports a component taking EmbedRendererProps.
const EMBED_RENDERERS: Partial<
  Record<ObjectRefType, ComponentType<EmbedRendererProps>>
> = {
  molecule: lazy(() => import("./MoleculeEmbed")),
  datahub: lazy(() => import("./DataHubEmbed")),
  sequence: lazy(() => import("./SequenceEmbed")),
  note: lazy(() => import("./NoteEmbed")),
  method: lazy(() => import("./MethodEmbed")),
  project: lazy(() => import("./ProjectEmbed")),
  collection: lazy(() => import("./CollectionEmbed")),
  task: lazy(() => import("./TaskEmbed")),
  experiment: lazy(() => import("./ExperimentEmbed")),
};

const TYPE_ICON: Record<ObjectRefType, IconName> = {
  sequence: "sequence",
  collection: "folder",
  method: "book",
  note: "pencil",
  file: "file",
  project: "folder",
  molecule: "vial",
  datahub: "chart",
  task: "today",
  experiment: "list",
};

const TYPE_LABEL: Record<ObjectRefType, string> = {
  sequence: "Sequence",
  collection: "Collection",
  method: "Method",
  note: "Note",
  file: "File",
  project: "Project",
  molecule: "Molecule",
  datahub: "Data Hub",
  task: "Task",
  experiment: "Experiment",
};

/** The universal fallback, and the Suspense placeholder while a rich renderer
 *  loads. A calm card, icon + caption + type, that opens the object. Uses only
 *  the descriptor, so it never has to read data and never fails. */
export function ObjectEmbedCard({
  descriptor,
  caption,
  loading = false,
}: {
  descriptor: EmbedDescriptor;
  caption: string;
  loading?: boolean;
}) {
  const label = caption || descriptor.id;
  const href = objectDeepLink(descriptor.type, descriptor.id);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
        <Icon name={TYPE_ICON[descriptor.type]} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground">{label}</p>
        <p className="text-meta text-foreground-muted">
          {TYPE_LABEL[descriptor.type]}
          {loading ? " · loading…" : ""}
        </p>
      </div>
      <a
        href={href}
        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-meta font-semibold text-foreground-muted transition-colors hover:border-brand-action hover:text-foreground"
      >
        Open
      </a>
    </div>
  );
}

export default function ObjectEmbed({ descriptor, caption, basePath }: EmbedRendererProps) {
  const Renderer = EMBED_RENDERERS[descriptor.type];
  return (
    <div
      className="my-3 overflow-hidden rounded-xl border border-border bg-surface-raised"
      data-embed-type={descriptor.type}
      data-embed-view={descriptor.view}
    >
      {Renderer ? (
        <Suspense
          fallback={<ObjectEmbedCard descriptor={descriptor} caption={caption} loading />}
        >
          <Renderer descriptor={descriptor} caption={caption} basePath={basePath} />
        </Suspense>
      ) : (
        <ObjectEmbedCard descriptor={descriptor} caption={caption} />
      )}
    </div>
  );
}
