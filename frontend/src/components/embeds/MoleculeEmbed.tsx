"use client";

// Markdown embed hybrid, Phase 1. The molecule block-embed renderer.
//
// Loaded lazily by ObjectEmbed when a `[caption](/chemistry?molecule=ID#ros=...)`
// embed is on screen, so RDKit (via MoleculeThumbnail) never loads until a
// molecule embed actually renders. Reads the molecule with a plain effect (no
// QueryClient dependency, RenderedMarkdown is used in many contexts). A deleted
// or unreadable molecule degrades to the calm generic card.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useState } from "react";
import { moleculesApi, type MoleculeMeta } from "@/lib/chemistry/api";
import { MoleculeThumbnail } from "@/components/chemistry/MoleculeThumbnail";
import { objectDeepLink } from "@/lib/references";
import { ObjectEmbedCard, UnavailableEmbedCard, EmbedCaption, type EmbedRendererProps } from "./ObjectEmbed";

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; meta: MoleculeMeta };

export default function MoleculeEmbed({ descriptor, caption, figureLabel }: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });
    moleculesApi
      .get(descriptor.id)
      .then((d) => {
        if (cancelled) return;
        setState(d ? { k: "ok", meta: d.meta } : { k: "missing" });
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

  const m = state.meta;
  const title = m.name || caption;
  const facts = [m.formula, m.mol_weight != null ? `${m.mol_weight.toFixed(2)} g/mol` : null]
    .filter(Boolean)
    .join(" · ");
  const href = objectDeepLink("molecule", descriptor.id);

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        {facts ? <span className="shrink-0 text-meta text-foreground-muted">{facts}</span> : null}
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open molecule: ${title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
      <div className="flex items-center justify-center px-3 py-3">
        <span
          role="img"
          aria-label={`Chemical structure of ${title}`}
          className="grid h-[140px] w-[200px] place-items-center overflow-hidden rounded-md border border-border bg-white"
        >
          <MoleculeThumbnail structure={m.smiles ?? ""} width={200} height={140} />
        </span>
      </div>
      <EmbedCaption caption={caption} name={m.name} figureLabel={figureLabel} />
    </div>
  );
}
