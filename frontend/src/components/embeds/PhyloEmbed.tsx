"use client";

// Markdown embed hybrid, Phase 5. The phylogenetic tree block-embed renderer.
//
// Loaded lazily by ObjectEmbed for a `[caption](/phylo?doc=ID#ros=studio)` embed,
// so the tree renderer never loads until a tree embed actually renders. Reads the
// stored tree (text + sidecar) with a plain effect, maps the saved figure +
// bound metadata into a RenderSpec via the shared adapter (the same mapping the
// Tree Studio uses, no divergence), and injects the renderer's self-contained SVG
// string. A missing or unreadable tree degrades to the calm generic / unavailable
// card, exactly like the molecule and Data Hub embeds.
//
// The SVG is a string from lib/phylo/render.ts (already on the icon-guard
// baseline), injected with dangerouslySetInnerHTML, so this component writes no
// inline figure-SVG JSX of its own.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import { phyloApi } from "@/lib/phylo/api";
import type { RawPhyloFiles } from "@/lib/phylo/phylo-store";
import { parseTree } from "@/lib/phylo/parse";
import { renderTreeSvg } from "@/lib/phylo/render";
import {
  figureToRenderSpec,
  figureInputsFromStored,
} from "@/lib/phylo/figure-to-render";
import { objectDeepLink } from "@/lib/references";
import {
  ObjectEmbedCard,
  UnavailableEmbedCard,
  EmbedCaption,
  type EmbedRendererProps,
} from "./ObjectEmbed";

// The embedded figure is rendered at a calm card size, smaller than the Studio
// canvas, so it sits comfortably inside note + chat width.
const EMBED_W = 460;
const EMBED_H = 320;

type LoadState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; raw: RawPhyloFiles };

export default function PhyloEmbed({ descriptor, caption, figureLabel }: EmbedRendererProps) {
  const [state, setState] = useState<LoadState>({ k: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ k: "loading" });
    phyloApi
      .get(descriptor.id)
      .then((raw) => {
        if (cancelled) return;
        setState(raw ? { k: "ok", raw } : { k: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ k: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [descriptor.id]);

  // Parse the tree and build its figure SVG once the record loads. A tree that
  // fails to parse yields an empty string, which falls back to the calm card.
  const svg = useMemo(() => {
    if (state.k !== "ok") return "";
    try {
      const tree = parseTree(state.raw.tree);
      const inputs = figureInputsFromStored(
        state.raw.meta.figure,
        state.raw.meta.metadata,
      );
      const spec = figureToRenderSpec(tree, inputs, {
        width: EMBED_W,
        height: EMBED_H,
      });
      return renderTreeSvg(tree, spec);
    } catch {
      return "";
    }
  }, [state]);

  if (state.k === "loading") {
    return <ObjectEmbedCard descriptor={descriptor} caption={caption} loading />;
  }
  if (state.k === "missing") {
    return <UnavailableEmbedCard descriptor={descriptor} caption={caption} />;
  }
  if (!svg) {
    return <ObjectEmbedCard descriptor={descriptor} caption={caption} />;
  }

  const meta = state.raw.meta;
  const title = meta.name || caption;
  const tips =
    meta.tip_count != null
      ? `${meta.tip_count} ${meta.tip_count === 1 ? "tip" : "tips"}`
      : "";
  const href = objectDeepLink("phylo", descriptor.id);

  return (
    <div>
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-body font-semibold text-foreground">{title}</span>
        {tips ? <span className="shrink-0 text-meta text-foreground-muted">{tips}</span> : null}
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open phylogenetic tree ${title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
      <div
        role="img"
        aria-label={`Phylogenetic tree ${title}`}
        className="flex justify-center overflow-x-auto px-3 py-3"
        // The SVG is a string from the baselined tree renderer, not user markup.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <EmbedCaption caption={caption} name={meta.name} figureLabel={figureLabel} />
    </div>
  );
}
