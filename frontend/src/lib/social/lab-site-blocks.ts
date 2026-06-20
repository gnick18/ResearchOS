// Lab companion-site block model (P1 companion builder, social lane).
//
// Defines the typed LabSiteBlock union, the pure parse/serialize helpers, and
// the layout-width type. This is the ONLY module that knows the on-the-wire
// JSON shape of blocks_json; all consumers go through parseLabSiteBlocks and
// serializeLabSiteBlocks so the shape can evolve without scatter.
//
// Design rules:
//   - Every block carries a stable `id` (random string, set by the editor) and
//     a `kind` discriminator.
//   - Data blocks (figure, table, dataset-explorer, chart) bind a ResearchOS
//     source id + an optional caption + a layout width. The source id is the
//     same id that parseObjectEmbed would produce from a markdown embed link.
//   - Text-like blocks (heading, text, two-column) carry inline content only.
//   - Unknown kinds are DROPPED during parse so future additions do not crash
//     old readers.
//   - The parse function is defensive: a missing field collapses to its zero
//     value (empty string, "column" width, etc.) rather than throwing.
//
// This module is PURE and IO-free: no network, no database, no React, no browser
// APIs. It is safe to import in any environment (server, client, tests).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

// ---------------------------------------------------------------------------
// Width type
// ---------------------------------------------------------------------------

/**
 * Layout width for a data block. Controls how wide the embed renders relative
 * to the page's reading column:
 *   inset  - narrower than the text column (right-floated thumbnail)
 *   column - matches the text column (default, most readable)
 *   full   - breaks out to the full container width (large datasets / wide plots)
 */
export type BlockWidth = "inset" | "column" | "full";

/** Guard for BlockWidth. Unknown strings map to the default "column". */
export function parseBlockWidth(raw: unknown): BlockWidth {
  if (raw === "inset" || raw === "full") return raw;
  return "column";
}

// ---------------------------------------------------------------------------
// Block union
// ---------------------------------------------------------------------------

/** A heading block. Renders an h1/h2/h3 depending on level. */
export interface HeadingBlock {
  id: string;
  kind: "heading";
  props: {
    /** Heading text, markdown inline formatting allowed. */
    text: string;
    /** 1 = h1 (page-level), 2 = section, 3 = subsection. Default 2. */
    level: 1 | 2 | 3;
  };
}

/** A rich-text block. Renders as markdown prose via the app's markdown renderer. */
export interface TextBlock {
  id: string;
  kind: "text";
  props: {
    /** Markdown body (inline + block formatting, but NO embed links). */
    markdown: string;
  };
}

/** A static image block (non-ResearchOS, uploaded asset). */
export interface ImageBlock {
  id: string;
  kind: "image";
  props: {
    /** Public URL of the uploaded image asset. */
    src: string;
    alt: string;
    caption: string;
    width: BlockWidth;
  };
}

/**
 * A ResearchOS figure embed block. Binds to a figure by its embed href.
 *
 * sourceId is the FULL embed href (e.g. `/phylo?id=abc#ros=tree`), NOT just
 * the object id. This matches the key that bakeAllEmbeds returns in its Map,
 * so the bake-path integration is a direct Map lookup per block. The P2
 * editor constructs this via buildObjectEmbedHref when the user picks a figure.
 */
export interface FigureBlock {
  id: string;
  kind: "figure";
  props: {
    /** Full embed href, keyed the same way as bakeAllEmbeds / bakedEmbeds map. */
    sourceId: string;
    caption: string;
    width: BlockWidth;
  };
}

/** A ResearchOS table / Data Hub table embed block. */
export interface TableBlock {
  id: string;
  kind: "table";
  props: {
    /** Full embed href (same convention as FigureBlock.props.sourceId). */
    sourceId: string;
    caption: string;
    width: BlockWidth;
  };
}

/**
 * A live dataset-explorer block. Renders the DuckDB-WASM interactive viewer
 * for a large dataset; falls back to the baked snapshot on public pages.
 */
export interface DatasetExplorerBlock {
  id: string;
  kind: "dataset-explorer";
  props: {
    /** Full embed href (same convention as FigureBlock.props.sourceId). */
    sourceId: string;
    caption: string;
    width: BlockWidth;
  };
}

/** A ResearchOS chart / plot block. */
export interface ChartBlock {
  id: string;
  kind: "chart";
  props: {
    /** Full embed href (same convention as FigureBlock.props.sourceId). */
    sourceId: string;
    caption: string;
    width: BlockWidth;
  };
}

/**
 * A two-column layout block. The two sides are themselves arrays of blocks.
 * No nesting beyond one level (a two-column cannot contain another two-column).
 */
export interface TwoColumnBlock {
  id: string;
  kind: "two-column";
  props: {
    /** Left column blocks (leaf blocks only, no two-column). */
    left: LabSiteLeafBlock[];
    /** Right column blocks (leaf blocks only, no two-column). */
    right: LabSiteLeafBlock[];
  };
}

/** Leaf blocks: all block kinds except two-column (which contains leaves). */
export type LabSiteLeafBlock =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | FigureBlock
  | TableBlock
  | DatasetExplorerBlock
  | ChartBlock;

/** The full block union, including layout blocks. */
export type LabSiteBlock = LabSiteLeafBlock | TwoColumnBlock;

/** The data-block kinds that bind a ResearchOS source id. */
export type DataBlockKind =
  | "figure"
  | "table"
  | "dataset-explorer"
  | "chart";

/** True when a block kind is a data block (has sourceId + caption + width). */
export function isDataBlockKind(kind: string): kind is DataBlockKind {
  return (
    kind === "figure" ||
    kind === "table" ||
    kind === "dataset-explorer" ||
    kind === "chart"
  );
}

// ---------------------------------------------------------------------------
// Parse helpers (untrusted JSON -> typed blocks)
// ---------------------------------------------------------------------------

/** A safe id: non-empty string or a generated fallback. */
function safeId(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

/** A safe string: non-string collapses to "". */
function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse the heading level: must be 1, 2, or 3; defaults to 2. */
function parseLevel(v: unknown): 1 | 2 | 3 {
  if (v === 1 || v === 2 || v === 3) return v;
  return 2;
}

function parseHeadingBlock(raw: Record<string, unknown>, id: string): HeadingBlock {
  const props = raw.props && typeof raw.props === "object"
    ? (raw.props as Record<string, unknown>)
    : {};
  return {
    id,
    kind: "heading",
    props: {
      text: safeStr(props.text),
      level: parseLevel(props.level),
    },
  };
}

function parseTextBlock(raw: Record<string, unknown>, id: string): TextBlock {
  const props = raw.props && typeof raw.props === "object"
    ? (raw.props as Record<string, unknown>)
    : {};
  return {
    id,
    kind: "text",
    props: { markdown: safeStr(props.markdown) },
  };
}

function parseImageBlock(raw: Record<string, unknown>, id: string): ImageBlock {
  const props = raw.props && typeof raw.props === "object"
    ? (raw.props as Record<string, unknown>)
    : {};
  return {
    id,
    kind: "image",
    props: {
      src: safeStr(props.src),
      alt: safeStr(props.alt),
      caption: safeStr(props.caption),
      width: parseBlockWidth(props.width),
    },
  };
}

function parseDataBlock<K extends DataBlockKind>(
  kind: K,
  raw: Record<string, unknown>,
  id: string,
): Extract<LabSiteLeafBlock, { kind: K }> {
  const props = raw.props && typeof raw.props === "object"
    ? (raw.props as Record<string, unknown>)
    : {};
  return {
    id,
    kind,
    props: {
      sourceId: safeStr(props.sourceId),
      caption: safeStr(props.caption),
      width: parseBlockWidth(props.width),
    },
  } as Extract<LabSiteLeafBlock, { kind: K }>;
}

/**
 * Parse one raw value into a LabSiteLeafBlock. Returns null for unknown kinds
 * or non-object values so the caller can drop them cleanly.
 */
function parseLeafBlock(
  raw: unknown,
  idSuffix: string,
): LabSiteLeafBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = safeId(r.id, idSuffix);
  const kind = safeStr(r.kind);
  switch (kind) {
    case "heading":
      return parseHeadingBlock(r, id);
    case "text":
      return parseTextBlock(r, id);
    case "image":
      return parseImageBlock(r, id);
    case "figure":
      return parseDataBlock("figure", r, id);
    case "table":
      return parseDataBlock("table", r, id);
    case "dataset-explorer":
      return parseDataBlock("dataset-explorer", r, id);
    case "chart":
      return parseDataBlock("chart", r, id);
    default:
      // Unknown kind: silently drop so future additions do not crash old readers.
      return null;
  }
}

/**
 * Parse one raw value into a LabSiteBlock (leaf or two-column). Returns null
 * for unknown kinds. The two-column inner arrays are parsed via parseLeafBlock
 * so a two-column cannot nest another two-column.
 */
function parseOneBlock(raw: unknown, idSuffix: string): LabSiteBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = safeStr(r.kind);
  if (kind !== "two-column") {
    return parseLeafBlock(raw, idSuffix);
  }
  const id = safeId(r.id, idSuffix);
  const props = r.props && typeof r.props === "object"
    ? (r.props as Record<string, unknown>)
    : {};
  const leftRaw = Array.isArray(props.left) ? props.left : [];
  const rightRaw = Array.isArray(props.right) ? props.right : [];
  return {
    id,
    kind: "two-column",
    props: {
      left: leftRaw
        .map((b, i) => parseLeafBlock(b, `${idSuffix}-L${i}`))
        .filter((b): b is LabSiteLeafBlock => b !== null),
      right: rightRaw
        .map((b, i) => parseLeafBlock(b, `${idSuffix}-R${i}`))
        .filter((b): b is LabSiteLeafBlock => b !== null),
    },
  };
}

/**
 * Parse a blocks_json string (from the database column or a request body) into
 * an ordered array of typed LabSiteBlock values. Never throws: a malformed or
 * missing input returns an empty array; unknown block kinds are silently dropped
 * so a page with a mix of known and unknown kinds degrades gracefully rather
 * than blanking entirely.
 *
 * The on-the-wire format is a plain JSON array of block objects:
 *   [{ id, kind, props }, ...]
 */
export function parseLabSiteBlocks(input: unknown): LabSiteBlock[] {
  let arr: unknown;
  if (typeof input === "string") {
    if (!input.trim()) return [];
    try {
      arr = JSON.parse(input);
    } catch {
      return [];
    }
  } else {
    arr = input;
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((raw, i) => parseOneBlock(raw, `b${i}`))
    .filter((b): b is LabSiteBlock => b !== null);
}

/**
 * Serialize an array of typed LabSiteBlock values to the JSON string that is
 * stored in the blocks_json column. Returns null when the result exceeds the
 * size cap (the caller stores no blocks rather than a truncated blob).
 *
 * Cap mirrors the snapshot bundle cap (8 MB is generous for a page of blocks).
 */
export const MAX_BLOCKS_JSON_BYTES = 8_000_000;

export function serializeLabSiteBlocks(blocks: LabSiteBlock[]): string | null {
  const json = JSON.stringify(blocks);
  if (json.length > MAX_BLOCKS_JSON_BYTES) return null;
  return json;
}
