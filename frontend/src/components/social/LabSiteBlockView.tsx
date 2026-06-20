"use client";

// Lab companion-site block renderer (P1 companion builder, social lane).
//
// Renders a LabSiteBlock[] array as a read-only page. This is the ONLY
// component that knows how to turn a block array into visible DOM. It is used
// in two contexts:
//
//   1. Public companion-site page (LabSitePageView with blocksJson). A public
//      reader has no account and no local workspace, so data blocks MUST render
//      from their baked snapshots via BakedEmbedView, not live. The caller
//      passes a bakedEmbeds map keyed by the block's sourceId (the same href
//      the bake step used as its key). A block with no snapshot in the map
//      renders the calm "unavailable" card via BakedEmbedView's "missing" path.
//
//   2. Author's draft editor preview (P2, not built yet). The same component
//      will accept an empty/absent bakedEmbeds so data blocks render live via
//      ObjectEmbed from the author's local workspace. P2 passes nothing for
//      bakedEmbeds; P1 only wires the public path.
//
// Heading + text blocks: rendered via RenderedMarkdown (the app's canonical
// read-only markdown renderer), same as the body_md path in LabSitePageView.
//
// Data blocks (figure, table, dataset-explorer, chart): rendered through the
// existing embed system. When bakedEmbeds is present (public path) the block's
// sourceId is looked up in the map and rendered via BakedEmbedView. When
// bakedEmbeds is absent (live/draft path) the block renders via ObjectEmbed,
// but that path is not exercised until P2.
//
// Width classes: "inset" = constrained + right-floated on desktop, "column" =
// default reading-width container, "full" = breaks out to the section container.
//
// Gate: this component is only rendered inside the lab-sites surface which is
// already gated on NEXT_PUBLIC_LAB_SITES (the route 404s when the flag is off),
// so no additional flag guard is needed here.
//
// Bake-path integration status: data blocks look up bakedEmbeds by sourceId
// (the full embed href). When the page is published, the P2 editor will call
// bakeAllEmbeds with the set of hrefs extracted from data blocks, bundle the
// result, and pass snapshotsJson to publishPage. The bake loop currently scans
// markdown bodies only (scanEmbedRefs in bake-embeds.ts). Extending it to also
// accept a LabSiteBlock[] and extract data-block hrefs is straightforward: call
// scanBlockEmbedHrefs (exported from this module) from the P2 publish handler
// alongside scanEmbedRefs, bake via bakeOne, and merge into the same Map before
// bundling. This is not wired server-side yet.
//
// TODO (P2 integration point): in the P2 publish handler, extract data-block
// hrefs via scanBlockEmbedHrefs exported below, bake via bakeOne from
// lib/export/bake-embeds.ts, and merge the results into the bundleFromBakedMap
// call alongside any markdown embed refs. The bundle is then sent to
// publishPage as snapshotsJson. The public render (LabSitePageView -> this
// component) will then find the baked entries in bakedEmbeds by sourceId.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import RenderedMarkdown from "@/components/RenderedMarkdown";
import BakedEmbedView from "@/components/embeds/BakedEmbedView";
import ObjectEmbed from "@/components/embeds/ObjectEmbed";
import { parseObjectEmbed } from "@/lib/references";
import type { BakedEmbed } from "@/lib/export/bake-embeds";
import type {
  LabSiteBlock,
  LabSiteLeafBlock,
  HeadingBlock,
  TextBlock,
  ImageBlock,
  TwoColumnBlock,
  BlockWidth,
} from "@/lib/social/lab-site-blocks";

// ---------------------------------------------------------------------------
// Width helper
// ---------------------------------------------------------------------------

/**
 * Tailwind class string for a data-block container given its layout width.
 * "column" matches the prose reading column (max-w-3xl, same as the
 * RenderedMarkdown prose container in LabSitePageView). "inset" is a
 * narrower inset card. "full" breaks out to the section container.
 */
function widthClass(width: BlockWidth): string {
  switch (width) {
    case "inset":
      return "mx-auto max-w-sm";
    case "full":
      return "w-full";
    case "column":
    default:
      return "mx-auto max-w-3xl";
  }
}

// ---------------------------------------------------------------------------
// Bake-path utility: extract data-block hrefs from a block array
// ---------------------------------------------------------------------------

/**
 * Collect every data-block sourceId (embed href) from a block array. The P2
 * publish handler calls this to build the set of hrefs to pass to bakeOne so
 * each data block's live embed is frozen before publishing.
 *
 * Two-column inner blocks are traversed. Only non-empty sourceIds are returned.
 * Exported so the P2 publish handler can import it without duplicating the
 * traversal logic.
 */
export function scanBlockEmbedHrefs(blocks: LabSiteBlock[]): string[] {
  const hrefs: string[] = [];
  function collectLeaf(block: LabSiteLeafBlock): void {
    if (
      block.kind === "figure" ||
      block.kind === "table" ||
      block.kind === "dataset-explorer" ||
      block.kind === "chart"
    ) {
      const href = block.props.sourceId.trim();
      if (href) hrefs.push(href);
    }
  }
  for (const block of blocks) {
    if (block.kind === "two-column") {
      for (const b of block.props.left) collectLeaf(b);
      for (const b of block.props.right) collectLeaf(b);
    } else {
      collectLeaf(block);
    }
  }
  return hrefs;
}

// ---------------------------------------------------------------------------
// Individual block renderers
// ---------------------------------------------------------------------------

function HeadingBlockView({ block }: { block: HeadingBlock }) {
  const text = block.props.text;
  switch (block.props.level) {
    case 1:
      return (
        <h1 className="mt-6 text-display font-bold tracking-tight text-foreground">
          {text}
        </h1>
      );
    case 3:
      return (
        <h3 className="mt-4 text-lg font-semibold text-foreground">{text}</h3>
      );
    case 2:
    default:
      return (
        <h2 className="mt-5 text-xl font-bold text-foreground">{text}</h2>
      );
  }
}

function TextBlockView({ block }: { block: TextBlock }) {
  return (
    <div className="mx-auto max-w-3xl">
      <RenderedMarkdown
        content={block.props.markdown}
        className="prose prose-gray dark:prose-invert"
      />
    </div>
  );
}

function ImageBlockView({ block }: { block: ImageBlock }) {
  if (!block.props.src) return null;
  return (
    <div className={widthClass(block.props.width)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- uploaded lab-site
          asset; no Next.js image optimization applies to arbitrary user uploads. */}
      <img
        src={block.props.src}
        alt={block.props.alt || block.props.caption || ""}
        className="block max-w-full rounded-lg"
      />
      {block.props.caption && (
        <p className="mt-2 text-center text-meta text-foreground-muted">
          {block.props.caption}
        </p>
      )}
    </div>
  );
}

/**
 * Render a data block (figure, table, dataset-explorer, chart) using the
 * existing embed system.
 *
 * Public path (bakedEmbeds present): looks up the sourceId in the map and
 * renders via BakedEmbedView. A missing entry renders the calm "unavailable"
 * card (the BakedEmbed "missing" variant), so a block whose bake failed never
 * crashes the page.
 *
 * Live path (bakedEmbeds absent): renders via ObjectEmbed from the author's
 * local workspace. This path is not exercised until P2; it is wired here so
 * the component is complete and P2 only needs to pass a live folder context.
 */
function DataBlockView({
  sourceId,
  caption,
  width,
  bakedEmbeds,
}: {
  sourceId: string;
  caption: string;
  width: BlockWidth;
  bakedEmbeds?: Map<string, BakedEmbed>;
}) {
  const descriptor = parseObjectEmbed(sourceId);

  // Guard: if sourceId is empty or does not parse as an embed, render nothing.
  // This is a degenerate state (P2 editor should only insert valid hrefs) but
  // the renderer must never crash on malformed data.
  if (!sourceId || !descriptor || !descriptor.isEmbed) {
    return (
      <div
        className={`${widthClass(width)} rounded-xl border border-border bg-surface-sunken p-4 text-meta text-foreground-muted`}
      >
        Data block not configured.
      </div>
    );
  }

  return (
    <div className={widthClass(width)}>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {bakedEmbeds ? (
          // Public path: frozen baked snapshot. Missing entry degrades to the
          // calm unavailable card via BakedEmbedView (kind "missing").
          <BakedEmbedView
            snapshot={
              bakedEmbeds.get(sourceId) ?? {
                kind: "missing",
                name: caption || descriptor.id,
                label: null,
              }
            }
            caption={caption}
            descriptor={descriptor}
          />
        ) : (
          // Live/draft path: render from the author's local workspace. ObjectEmbed
          // handles all object types and falls back to a calm card when the object
          // is not found, so it is safe to render unconditionally here.
          <ObjectEmbed descriptor={descriptor} caption={caption} />
        )}
      </div>
      {caption && (
        <p className="mt-2 text-center text-meta text-foreground-muted">
          {caption}
        </p>
      )}
    </div>
  );
}

function LeafBlockView({
  block,
  bakedEmbeds,
}: {
  block: LabSiteLeafBlock;
  bakedEmbeds?: Map<string, BakedEmbed>;
}) {
  switch (block.kind) {
    case "heading":
      return <HeadingBlockView block={block} />;
    case "text":
      return <TextBlockView block={block} />;
    case "image":
      return <ImageBlockView block={block} />;
    case "figure":
    case "table":
    case "dataset-explorer":
    case "chart":
      return (
        <DataBlockView
          sourceId={block.props.sourceId}
          caption={block.props.caption}
          width={block.props.width}
          bakedEmbeds={bakedEmbeds}
        />
      );
    default: {
      // TypeScript exhaustiveness guard.
      const exhaustive: never = block;
      void exhaustive;
      return null;
    }
  }
}

function TwoColumnBlockView({
  block,
  bakedEmbeds,
}: {
  block: TwoColumnBlock;
  bakedEmbeds?: Map<string, BakedEmbed>;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        {block.props.left.map((b) => (
          <LeafBlockView key={b.id} block={b} bakedEmbeds={bakedEmbeds} />
        ))}
      </div>
      <div className="flex flex-col gap-4">
        {block.props.right.map((b) => (
          <LeafBlockView key={b.id} block={b} bakedEmbeds={bakedEmbeds} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LabSiteBlockViewProps {
  /** The ordered block array to render. */
  blocks: LabSiteBlock[];
  /**
   * Frozen baked-block snapshots keyed by embed href (the block's sourceId).
   * When present (public companion-site render), data blocks render from frozen
   * snapshots via BakedEmbedView. When absent (author's live draft preview in
   * P2), data blocks render live via ObjectEmbed.
   */
  bakedEmbeds?: Map<string, BakedEmbed>;
}

/**
 * Read-only renderer for a LabSiteBlock array. Handles all block kinds.
 * Stateless and pure-presentational: every data dependency comes through props.
 *
 * Used by LabSitePageView when blocks_json is present (blocks page). The
 * existing markdown path (RenderedMarkdown with body_md) remains unchanged for
 * legacy pages.
 */
export default function LabSiteBlockView({
  blocks,
  bakedEmbeds,
}: LabSiteBlockViewProps) {
  if (blocks.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      {blocks.map((block) => {
        if (block.kind === "two-column") {
          return (
            <TwoColumnBlockView
              key={block.id}
              block={block}
              bakedEmbeds={bakedEmbeds}
            />
          );
        }
        return (
          <LeafBlockView
            key={block.id}
            block={block as LabSiteLeafBlock}
            bakedEmbeds={bakedEmbeds}
          />
        );
      })}
    </div>
  );
}
