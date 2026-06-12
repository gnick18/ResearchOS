"use client";

// Markdown embed hybrid, Phase 7 (P7-4). External embed dispatcher.
//
// RenderedMarkdown calls ObjectEmbed for any `#ros=` link, and ObjectEmbed delegates
// here when the href is external (detected by isExternalHref). This module
// dispatches to the three external card renderers: CiteCard, StructureCard, LinkCard.
// All three are lazy so the heavy dependencies (RDKit, fetch plumbing) only load
// when an external embed is actually on screen.
//
// The outer frame mirrors the ObjectEmbed figure chrome (same border/rounding/bg)
// so external embeds are visually consistent with internal embeds. The card fills
// the body; no pin footer (external embeds are not pinnable in P7-4; a follow-up
// phase can add it once the snapshot format for external metadata is decided).
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { lazy, Suspense } from "react";
import { Icon } from "@/components/icons";
import type { ExternalEmbedDescriptor, ExternalEmbedKind } from "@/lib/embeds/external-embeds";

const CiteCard = lazy(() => import("./CiteCard"));
const StructureCard = lazy(() => import("./StructureCard"));
const LinkCard = lazy(() => import("./LinkCard"));

/** Props shared by all three external card renderers. */
export interface ExternalCardProps {
  descriptor: ExternalEmbedDescriptor;
  /** The link text from the markdown source, used as the card caption. */
  caption: string;
  /** The note's sidecar path, for reading and writing the metadata cache. Absent
   *  in contexts that have no sidecar (read-only exports, previews without a host). */
  sidecarPath?: string;
}

/** Shown while the lazy card component loads or while the network fetch runs. */
function ExternalLoadingCard({ kind }: { kind: ExternalEmbedKind }) {
  const label =
    kind === "cite" ? "Citation" : kind === "structure" ? "Structure" : "Link";
  const iconName = kind === "cite" ? "book" : kind === "structure" ? "vial" : "share";
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-foreground-muted">
        <Icon name={iconName} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold text-foreground-muted">
          {label}
        </p>
        <p className="text-meta text-foreground-muted">loading…</p>
      </div>
    </div>
  );
}

/** The external embed card, dispatching to the right renderer by kind. */
export default function ExternalEmbed({
  descriptor,
  caption,
  sidecarPath,
}: ExternalCardProps) {
  return (
    <figure
      className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised"
      data-embed-type="external"
      data-embed-kind={descriptor.kind}
    >
      <Suspense fallback={<ExternalLoadingCard kind={descriptor.kind} />}>
        {descriptor.kind === "cite" ? (
          <CiteCard descriptor={descriptor} caption={caption} sidecarPath={sidecarPath} />
        ) : descriptor.kind === "structure" ? (
          <StructureCard descriptor={descriptor} caption={caption} sidecarPath={sidecarPath} />
        ) : (
          <LinkCard descriptor={descriptor} caption={caption} sidecarPath={sidecarPath} />
        )}
      </Suspense>
    </figure>
  );
}
