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

// ---------------------------------------------------------------------------
// Section blocks (P3 homepage structured builder)
//
// Section blocks are coarser-grained than the canvas blocks above. They are
// designed for the lab homepage (hero, about, team, publications, contact).
// Each section has a fixed shape (the user fills named fields, not freeform
// markdown), so the editor can render a simple form rather than a canvas.
// Section blocks live in the SAME LabSiteBlock union and the SAME blocks_json
// column, so the existing parse/serialize/bake pipeline applies unchanged.
// The homepage editor emits section blocks; the canvas editor emits canvas
// blocks; a page is one or the other, never both.
// ---------------------------------------------------------------------------

/**
 * A team member for the TeamSection block.
 *
 * All fields are optional (the user may not have a photo URL yet, etc.).
 * Unknown fields are dropped during parse so future additions are safe.
 */
export interface TeamMember {
  /** Stable identifier within the team section. */
  id: string;
  name: string;
  role: string;
  /** URL of the member's photo (optional). */
  photoUrl: string;
  /** Short bio (plain text, not markdown). */
  bio: string;
}

/**
 * A single publication entry for the PublicationsSection block.
 *
 * Stored as plain strings (not DOI resolution). The user types in what they
 * want displayed; no live fetch occurs at edit time.
 */
export interface PublicationEntry {
  /** Stable identifier within the publications section. */
  id: string;
  /** Full citation text (plain text, e.g. "Smith et al. 2024, Nature"). */
  citation: string;
  /** DOI or URL to the paper (optional). */
  url: string;
  /** Optional short label shown as a chip, e.g. "New", "Preprint". */
  badge: string;
}

/**
 * Hero section. The first visible section on the homepage: the lab's name,
 * a one-line tagline, an optional cover image, and an optional call-to-action
 * link.
 */
export interface HeroSectionBlock {
  id: string;
  kind: "section-hero";
  props: {
    /** Lab display name (defaults to the slug on first load). */
    labName: string;
    /** One-line tagline, e.g. "Decoding the genomic language of fungi." */
    tagline: string;
    /** Optional cover image URL (full-width banner). */
    coverImageUrl: string;
    /** Optional CTA label, e.g. "Join the lab". */
    ctaLabel: string;
    /** Optional CTA URL. */
    ctaUrl: string;
  };
}

/**
 * About section. A free-text "who we are" paragraph with an optional portrait
 * image beside it (two-column on desktop, stacked on mobile).
 */
export interface AboutSectionBlock {
  id: string;
  kind: "section-about";
  props: {
    /** Section heading, e.g. "About the lab". */
    heading: string;
    /** Body text in plain paragraphs (no markdown). */
    body: string;
    /** Optional portrait/logo image URL. */
    imageUrl: string;
    /** Alt text for the image. */
    imageAlt: string;
  };
}

/**
 * Team section. A roster of lab members, each with name, role, photo, and bio.
 */
export interface TeamSectionBlock {
  id: string;
  kind: "section-team";
  props: {
    /** Section heading, e.g. "Our team". */
    heading: string;
    members: TeamMember[];
  };
}

/**
 * Publications section. A curated list of papers, preprints, or datasets.
 */
export interface PublicationsSectionBlock {
  id: string;
  kind: "section-publications";
  props: {
    /** Section heading, e.g. "Selected publications". */
    heading: string;
    publications: PublicationEntry[];
  };
}

/**
 * Contact section. Lab address, email, and optionally a link to a join/contact
 * form.
 */
export interface ContactSectionBlock {
  id: string;
  kind: "section-contact";
  props: {
    /** Section heading, e.g. "Contact". */
    heading: string;
    /** Lab address (plain text, line breaks allowed via \n). */
    address: string;
    /** Lab email address. */
    email: string;
    /** Optional link label, e.g. "Join our lab". */
    linkLabel: string;
    /** Optional link URL. */
    linkUrl: string;
  };
}

/** All section block kinds (P3 homepage builder). */
export type SectionBlock =
  | HeroSectionBlock
  | AboutSectionBlock
  | TeamSectionBlock
  | PublicationsSectionBlock
  | ContactSectionBlock;

/** True when a block kind is a homepage section block. */
export function isSectionBlockKind(kind: string): kind is SectionBlock["kind"] {
  return (
    kind === "section-hero" ||
    kind === "section-about" ||
    kind === "section-team" ||
    kind === "section-publications" ||
    kind === "section-contact"
  );
}

/**
 * Leaf blocks: all canvas block kinds except two-column (which contains leaves)
 * and section blocks (which are top-level only). Section blocks are coarser
 * than canvas blocks and are never nested inside a two-column layout.
 */
export type LabSiteLeafBlock =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | FigureBlock
  | TableBlock
  | DatasetExplorerBlock
  | ChartBlock;

/**
 * The full block union. Includes canvas leaf blocks, the two-column layout
 * block, and the section blocks used by the homepage structured editor.
 * Section blocks are always top-level; they cannot nest inside two-column.
 */
export type LabSiteBlock = LabSiteLeafBlock | TwoColumnBlock | SectionBlock;

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

// ---------------------------------------------------------------------------
// Section block parse helpers (P3 homepage builder)
// ---------------------------------------------------------------------------

/** Parse a raw value into a TeamMember. Unknown fields are dropped. */
function parseTeamMember(raw: unknown, idSuffix: string): TeamMember {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { id: idSuffix, name: "", role: "", photoUrl: "", bio: "" };
  }
  const r = raw as Record<string, unknown>;
  return {
    id: safeId(r.id, idSuffix),
    name: safeStr(r.name),
    role: safeStr(r.role),
    photoUrl: safeStr(r.photoUrl),
    bio: safeStr(r.bio),
  };
}

/** Parse a raw value into a PublicationEntry. Unknown fields are dropped. */
function parsePublicationEntry(raw: unknown, idSuffix: string): PublicationEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { id: idSuffix, citation: "", url: "", badge: "" };
  }
  const r = raw as Record<string, unknown>;
  return {
    id: safeId(r.id, idSuffix),
    citation: safeStr(r.citation),
    url: safeStr(r.url),
    badge: safeStr(r.badge),
  };
}

function parseHeroSectionBlock(raw: Record<string, unknown>, id: string): HeroSectionBlock {
  const props = raw.props && typeof raw.props === "object"
    ? (raw.props as Record<string, unknown>)
    : {};
  return {
    id,
    kind: "section-hero",
    props: {
      labName: safeStr(props.labName),
      tagline: safeStr(props.tagline),
      coverImageUrl: safeStr(props.coverImageUrl),
      ctaLabel: safeStr(props.ctaLabel),
      ctaUrl: safeStr(props.ctaUrl),
    },
  };
}

function parseAboutSectionBlock(raw: Record<string, unknown>, id: string): AboutSectionBlock {
  const props = raw.props && typeof raw.props === "object"
    ? (raw.props as Record<string, unknown>)
    : {};
  return {
    id,
    kind: "section-about",
    props: {
      heading: safeStr(props.heading),
      body: safeStr(props.body),
      imageUrl: safeStr(props.imageUrl),
      imageAlt: safeStr(props.imageAlt),
    },
  };
}

function parseTeamSectionBlock(raw: Record<string, unknown>, id: string): TeamSectionBlock {
  const props = raw.props && typeof raw.props === "object"
    ? (raw.props as Record<string, unknown>)
    : {};
  const membersRaw = Array.isArray(props.members) ? props.members : [];
  return {
    id,
    kind: "section-team",
    props: {
      heading: safeStr(props.heading),
      members: membersRaw.map((m, i) => parseTeamMember(m, `${id}-m${i}`)),
    },
  };
}

function parsePublicationsSectionBlock(
  raw: Record<string, unknown>,
  id: string,
): PublicationsSectionBlock {
  const props = raw.props && typeof raw.props === "object"
    ? (raw.props as Record<string, unknown>)
    : {};
  const pubsRaw = Array.isArray(props.publications) ? props.publications : [];
  return {
    id,
    kind: "section-publications",
    props: {
      heading: safeStr(props.heading),
      publications: pubsRaw.map((p, i) => parsePublicationEntry(p, `${id}-p${i}`)),
    },
  };
}

function parseContactSectionBlock(raw: Record<string, unknown>, id: string): ContactSectionBlock {
  const props = raw.props && typeof raw.props === "object"
    ? (raw.props as Record<string, unknown>)
    : {};
  return {
    id,
    kind: "section-contact",
    props: {
      heading: safeStr(props.heading),
      address: safeStr(props.address),
      email: safeStr(props.email),
      linkLabel: safeStr(props.linkLabel),
      linkUrl: safeStr(props.linkUrl),
    },
  };
}

/**
 * Parse one raw value into a LabSiteLeafBlock (canvas block kinds only).
 * Returns null for unknown kinds, non-object values, and section block kinds
 * (section blocks are top-level only; they cannot nest inside two-column).
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
      // Unknown kind (including section block kinds, which are top-level only):
      // silently drop so future additions do not crash old readers.
      return null;
  }
}

/**
 * Parse one raw value into a LabSiteBlock (leaf, two-column, or section).
 * Returns null for unknown kinds. Two-column inner arrays are parsed via
 * parseLeafBlock so section blocks and two-column blocks cannot be nested.
 * Section blocks (P3 homepage builder) are handled here at the top level.
 */
function parseOneBlock(raw: unknown, idSuffix: string): LabSiteBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = safeId(r.id, idSuffix);
  const kind = safeStr(r.kind);

  // Section blocks: top-level only (not nestable inside two-column).
  switch (kind) {
    case "section-hero":
      return parseHeroSectionBlock(r, id);
    case "section-about":
      return parseAboutSectionBlock(r, id);
    case "section-team":
      return parseTeamSectionBlock(r, id);
    case "section-publications":
      return parsePublicationsSectionBlock(r, id);
    case "section-contact":
      return parseContactSectionBlock(r, id);
  }

  if (kind !== "two-column") {
    return parseLeafBlock(raw, idSuffix);
  }
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

// ---------------------------------------------------------------------------
// Homepage section template (P3 structured builder)
// ---------------------------------------------------------------------------

/**
 * Generate a small stable id for template blocks. These are always overwritten
 * when the user saves, but they must be stable across re-renders of the empty
 * template so React keys do not thrash.
 */
function templateId(suffix: string): string {
  return `tmpl-${suffix}`;
}

/**
 * The default homepage block array. Returned when the home page has no
 * blocks_json yet (first open) so the editor starts populated rather than empty.
 *
 * Accepts an optional lab name so the hero can be pre-filled with the real slug.
 * The body copy is deliberately generic placeholder text that reads naturally as
 * a starting point the PI replaces (not Lorem Ipsum).
 *
 * All section kinds in the output are fully typed; parse/serialize round-trips
 * cleanly so this can be stored as-is via serializeLabSiteBlocks.
 */
export function makeHomepageSectionTemplate(labName = "Our Lab"): SectionBlock[] {
  return [
    {
      id: templateId("hero"),
      kind: "section-hero",
      props: {
        labName,
        tagline: "Advancing discovery through rigorous science.",
        coverImageUrl: "",
        ctaLabel: "Join the lab",
        ctaUrl: "",
      },
    } satisfies HeroSectionBlock,
    {
      id: templateId("about"),
      kind: "section-about",
      props: {
        heading: "About the lab",
        body:
          "We are a research group studying [your research area]. " +
          "Our work focuses on [key questions] and is funded by [funding sources]. " +
          "We are based at [institution].",
        imageUrl: "",
        imageAlt: "",
      },
    } satisfies AboutSectionBlock,
    {
      id: templateId("team"),
      kind: "section-team",
      props: {
        heading: "Our team",
        members: [
          {
            id: templateId("pi"),
            name: "Principal Investigator",
            role: "Principal Investigator",
            photoUrl: "",
            bio: "Add a short bio here.",
          },
        ],
      },
    } satisfies TeamSectionBlock,
    {
      id: templateId("pubs"),
      kind: "section-publications",
      props: {
        heading: "Selected publications",
        publications: [
          {
            id: templateId("pub1"),
            citation: "Author et al. (Year). Title. Journal, Volume(Issue), Pages.",
            url: "",
            badge: "",
          },
        ],
      },
    } satisfies PublicationsSectionBlock,
    {
      id: templateId("contact"),
      kind: "section-contact",
      props: {
        heading: "Contact",
        address: "",
        email: "",
        linkLabel: "",
        linkUrl: "",
      },
    } satisfies ContactSectionBlock,
  ];
}
