// PDF format generator for the export rewrite.
//
// Produces a single .pdf Blob with selectable text, real PDF bookmarks (outline
// pane), a clickable in-document table of contents, and a "Files attached"
// appendix labeled by origin (Lab Notes / Results / Methods).
//
// The renderer is `@react-pdf/renderer`, dynamically imported to keep it out
// of the SSR bundle. Markdown is parsed to a marked AST and walked into
// react-pdf nodes; nothing is rasterized to canvas.
//
// NOTE (sub-bot D, 2026-05-13): the locked type contract in
// EXPORT_REVAMP_PLAN.md §4 normally lives at `frontend/src/lib/export/types.ts`
// (owned by Sub-bot A). Until that file lands, the contract is inlined below
// so this module typechecks in isolation. When Sub-bot A's types.ts lands,
// swap the local interfaces below for `import type { ... } from "./types"`.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from "react";
import { marked, type Token, type Tokens } from "marked";

import { slugify } from "./slug";
import { demoteHeadings, extractUserContent, hasUserContent } from "./markdown";
import { sanitizeForExport } from "@/lib/validation/input-hardening";
import { parseObjectEmbed } from "@/lib/references";
import { bakeAllEmbeds, scanEmbedRefs, type BakedEmbed } from "./bake-embeds";
import {
  buildSourceInstance,
  type AttachmentOrigin,
  type ExperimentAttachment,
  type ExperimentExportPayload,
  type ExportResult,
  type MethodPayload,
  type PdfManifest,
} from "./types";
import type {
  PCRCycle,
  PCRGradient,
  PCRIngredient,
  PCRProtocol,
  PCRStep,
  LCGradientProtocol,
  PlateProtocol,
  PlateWellAnnotation,
  CellCultureSchedule,
  CellCultureActualEvent,
  CellCulturePlannedEvent,
  CellCultureSupplement,
  CodingWorkflowProtocol,
  QPCRAnalysisProtocol,
  MassSpecProtocol,
} from "@/lib/types";

// Mirrors the matching map in html.ts so PDF and HTML mode labels stay in sync.
const IONIZATION_MODE_LABELS: Record<string, string> = {
  esi_pos: "ESI+",
  esi_neg: "ESI−",
  esi_switching: "ESI switching",
  apci_pos: "APCI+",
  apci_neg: "APCI−",
  ei: "EI",
  maldi: "MALDI",
  other: "Other",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function findAttachment(
  attachments: ExperimentAttachment[],
  origin: AttachmentOrigin,
  ref: string,
): ExperimentAttachment | undefined {
  const decoded = (() => {
    try {
      return decodeURIComponent(ref);
    } catch {
      return ref;
    }
  })();
  const basename = (decoded.split("/").pop() ?? "").toLowerCase();
  if (!basename) return undefined;
  return attachments.find(
    (a) => a.origin === origin && a.filename.toLowerCase() === basename,
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(binary, "binary").toString("base64");
}

function attachmentToImageSrc(att: ExperimentAttachment): string {
  // @react-pdf/renderer's Image accepts a data URI string in browser contexts.
  // Using a string keeps us off the Node `Buffer` global, which isn't
  // guaranteed in the client bundle.
  //
  // Duplicate-image dedup (2026-05-14, sub-bot Tier-3 audit): when the same
  // image bytes are referenced by multiple sections (e.g. the same plate
  // photo embedded under both notes/Images/ and results/Images/), they arrive
  // here as two `ExperimentAttachment`s with identical `bytes` but different
  // `origin`. The base64 conversion is deterministic on byte content, so the
  // resulting data URI strings are byte-identical. @react-pdf/renderer keys
  // its image-embed cache off the full data URI (see
  // @react-pdf/layout `fetchImage`: `node.image.key = source.uri`), and the
  // renderer's per-document `imageCache` (render/lib/index.js) keys the
  // embedded XObject off `image.key`. Net effect: a single PDF XObject is
  // embedded for the byte stream regardless of how many <Image> nodes
  // reference it, AND pdfkit's `_imageRegistry` provides a second dedup
  // layer keyed by the same string. Do NOT try to "optimize" this by
  // hand-deduping at the React-tree level — the underlying stack already
  // does the right thing, and using anything other than a content-stable
  // data URI as the src would break the dedup.
  return `data:${att.mimeType};base64,${arrayBufferToBase64(att.bytes)}`;
}

function looksLikeLocalFileRef(href: string): boolean {
  if (!href) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false; // any url scheme
  if (href.startsWith("#")) return false;
  if (href.startsWith("//")) return false;
  return true;
}

function isImage(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i.test(mime);
}

// Module-level memo: `Font.register` is a no-op on success once react-pdf
// has cached the family, but if the FIRST call throws (e.g. transient fetch
// failure for the .ttf files), react-pdf does NOT cache the failure and
// every subsequent `buildPdf` call re-attempts the registration. The flag
// is set true ONLY after a successful `Font.register`, so failures still
// re-attempt on the next export — which is what we want for transient
// network blips during the local-asset fetch.
let fontsRegistered = false;

// Inter typography — served from `frontend/public/fonts/` so PDF
// export works offline and stays immune to CDN URL changes. The
// previous jsDelivr URL (gh/rsms/inter@v3.19/docs/font-files/) went
// dead in 2026 — the `docs/font-files/` path was removed from the
// Inter repo, every PDF export threw "Failed to fetch font ... 404"
// and no blob was produced. react-pdf doesn't gracefully fall back
// to Helvetica on a fetched-font error; it bubbles the failure up.
// Local paths sidestep both issues. ~830 KB total for both weights —
// negligible in the public assets bundle.
//
// Memoized via module-level `fontsRegistered` flag: react-pdf caches
// successful registrations globally, but a FAILED registration is
// not cached and silently retries on every subsequent export. Set
// the flag only after the call returns without throwing so failures
// can retry.
//
// Pulled out of `buildPdf` (combined-pdf bot, 2026-05-28) so the
// combined-document builder in `combined-pdf.ts` can register the same
// family before it renders its own Document. Idempotent — the flag is
// module-global so a single registration covers both call sites.
export function registerExportFonts(ReactPDF: any): void {
  if (fontsRegistered) return;
  ReactPDF.Font.register({
    family: "Inter",
    fonts: [
      { src: "/fonts/Inter-Regular.ttf" },
      { src: "/fonts/Inter-Bold.ttf", fontWeight: "bold" },
    ],
  });
  fontsRegistered = true;
}

/**
 * The reusable parts of one experiment's PDF rendering. Returned by
 * `buildExperimentParts` so both the single-experiment `buildPdf` and the
 * multi-item `buildCombinedPdf` (combined-pdf.ts) share the SAME markdown +
 * method renderers without reimplementing experiment rendering.
 *
 * `tocEntries` carry per-section anchor ids and titles; `contentChildren`
 * are the already-rendered react-pdf nodes (each a bookmarked SectionView
 * with a matching `id` destination). `idPrefix` namespaces every anchor so
 * multiple experiments in one combined document never collide.
 */
export interface ExperimentPdfParts {
  // Anchor ids + titles for this experiment's sections, in document order.
  tocEntries: { id: string; title: string }[];
  // The rendered section nodes (bookmarked SectionViews) for this experiment.
  contentChildren: React.ReactNode[];
  // The provenance manifest for this experiment (single-export embeds this in
  // the Document keywords; the combined builder ignores it per-item).
  manifest: PdfManifest;
}

// combined-pdf bot (2026-05-28): the section renderers below are unchanged
// from the original `buildPdf` closure; they were lifted verbatim into
// `buildExperimentParts` so the combined-document builder reuses them. The
// only additions are the `idPrefix` parameter (anchor namespacing) and the
// returned `ExperimentPdfParts` instead of an inline document assembly.

export function buildExperimentParts(
  ReactPDF: any,
  payload: ExperimentExportPayload,
  idPrefix = "",
  bakedEmbeds?: Map<string, BakedEmbed>,
): ExperimentPdfParts {
  const { View, Text, Image, Link, StyleSheet } = ReactPDF;
  const h = React.createElement;

  // Namespaced anchor id helper. Single-export passes "" so ids stay
  // exactly as before ("section-labnotes"); combined passes e.g.
  // "exp-12-" so multiple experiments never share a destination name.
  const anchor = (raw: string): string => `${idPrefix}${raw}`;

  // View/Text don't expose `bookmark` in the renderer's published types but the
  // runtime supports it (BaseProps in @react-pdf/types/node.d.ts). Cast once.
  type SectionViewProps = React.PropsWithChildren<{
    id?: string;
    bookmark?: { title: string; fit?: boolean; expanded?: boolean };
    style?: any;
    wrap?: boolean;
    break?: boolean;
  }>;
  const SectionView = View as React.ComponentType<SectionViewProps>;

  const styles = StyleSheet.create({
    page: {
      paddingTop: 72,
      paddingBottom: 72,
      paddingHorizontal: 72,
      fontSize: 11,
      fontFamily: "Inter",
      lineHeight: 1.4,
      color: "#111",
    },
    titleH1: { fontSize: 24, fontFamily: "Inter", fontWeight: "bold", marginBottom: 28 },
    metaRow: { fontSize: 11, marginBottom: 6 },
    metaLabel: { fontFamily: "Inter", fontWeight: "bold" },
    generatedNote: { fontSize: 10, color: "#666", marginTop: 36 },

    tocTitle: { fontSize: 18, fontFamily: "Inter", fontWeight: "bold", marginBottom: 18 },
    tocEntry: { fontSize: 12, marginBottom: 8, color: "#0066cc" },

    sectionWrap: { marginBottom: 12 },
    h2: {
      fontSize: 16,
      fontFamily: "Inter", fontWeight: "bold",
      marginTop: 14,
      marginBottom: 10,
      paddingBottom: 6,
      borderBottomWidth: 1,
      borderBottomColor: "#cccccc",
      borderBottomStyle: "solid",
    },
    h3: {
      fontSize: 13,
      fontFamily: "Inter", fontWeight: "bold",
      marginTop: 12,
      marginBottom: 6,
    },
    h4: {
      fontSize: 11,
      fontFamily: "Inter", fontWeight: "bold",
      marginTop: 10,
      marginBottom: 4,
    },
    paragraph: { fontSize: 11, marginBottom: 8 },
    listRow: { flexDirection: "row", marginBottom: 3 },
    listBullet: { width: 16, fontSize: 11 },
    listItemBody: { flex: 1, fontSize: 11 },
    blockquote: {
      marginLeft: 12,
      marginBottom: 8,
      paddingLeft: 8,
      borderLeftWidth: 2,
      borderLeftColor: "#bbbbbb",
      borderLeftStyle: "solid",
      color: "#444",
    },
    hr: {
      borderBottomWidth: 1,
      borderBottomColor: "#dddddd",
      borderBottomStyle: "solid",
      marginTop: 8,
      marginBottom: 8,
    },
    codeInline: {
      fontFamily: "Courier",
      fontSize: 10,
      backgroundColor: "#f3f3f3",
    },
    codeBlock: {
      fontFamily: "Courier",
      fontSize: 10,
      backgroundColor: "#f3f3f3",
      padding: 8,
      marginBottom: 10,
    },
    imageWrapper: { marginVertical: 8 },
    image: { maxWidth: 432, objectFit: "contain" },
    imageCaption: {
      fontSize: 9,
      color: "#666",
      textAlign: "center",
      marginTop: 2,
    },
    placeholder: { fontSize: 10, color: "#888", fontStyle: "italic" },

    inlineLink: { color: "#0066cc", textDecoration: "underline" },
    fileRefAnnotation: { color: "#666", fontSize: 9 },

    methodIntro: { fontSize: 10, color: "#666", marginBottom: 8 },
    methodVariationHeading: {
      fontSize: 11,
      fontFamily: "Inter", fontWeight: "bold",
      marginTop: 8,
      marginBottom: 4,
    },

    filesAppendixGroup: { marginTop: 10 },
    filesAppendixGroupHeading: {
      fontSize: 12,
      fontFamily: "Inter", fontWeight: "bold",
      marginBottom: 4,
    },
    filesAppendixItem: { fontSize: 11, marginBottom: 3, marginLeft: 12 },

    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: "#dddddd",
      borderBottomStyle: "solid",
    },
    tableCell: { flex: 1, padding: 4, fontSize: 10 },
    tableCellHeader: {
      flex: 1,
      padding: 4,
      fontSize: 10,
      fontFamily: "Inter", fontWeight: "bold",
      backgroundColor: "#f3f3f3",
    },

    pcrCycleHeaderRow: {
      flexDirection: "row",
      backgroundColor: "#eff6ff",
      borderTopWidth: 1,
      borderTopColor: "#0066cc",
      borderTopStyle: "solid",
      borderBottomWidth: 1,
      borderBottomColor: "#dddddd",
      borderBottomStyle: "solid",
    },
    pcrCycleHeaderCell: {
      flex: 1,
      padding: 4,
      fontSize: 10,
      fontFamily: "Inter", fontWeight: "bold",
      color: "#0066cc",
    },
    pcrCycleStepIndent: { paddingLeft: 14 },
    pcrHoldRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: "#dddddd",
      borderBottomStyle: "solid",
      backgroundColor: "#f9fafb",
    },
    pcrTable: { marginBottom: 10 },
    pcrNotes: {
      fontSize: 10,
      color: "#666",
      fontStyle: "italic",
      marginTop: 4,
      marginBottom: 10,
    },
    pcrDeviationHeading: {
      fontSize: 11,
      fontFamily: "Inter", fontWeight: "bold",
      color: "#92400e",
      marginTop: 8,
      marginBottom: 4,
    },

    // ── Baked embed figure styles ──────────────────────────────────────────
    embedFigureWrapper: {
      marginVertical: 10,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      borderStyle: "solid",
      borderRadius: 4,
    },
    embedCaption: {
      fontSize: 9,
      color: "#555",
      textAlign: "center",
      marginTop: 4,
      marginBottom: 6,
      paddingHorizontal: 6,
    },
    embedFigureImage: {
      maxWidth: 432,
      objectFit: "contain",
      alignSelf: "center",
      marginTop: 6,
    },
    embedCardTitle: {
      fontSize: 11,
      fontFamily: "Inter",
      fontWeight: "bold",
      marginBottom: 2,
    },
    embedCardSubtitle: {
      fontSize: 9,
      color: "#666",
      marginBottom: 2,
    },
    embedCardMeta: {
      fontSize: 9,
      color: "#888",
    },
    embedCardPadding: {
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    embedMissingWrapper: {
      marginVertical: 6,
      borderWidth: 1,
      borderColor: "#d1d5db",
      borderStyle: "dashed",
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    embedMissingText: {
      fontSize: 10,
      color: "#9ca3af",
      fontStyle: "italic",
    },
    embedTextBody: {
      fontSize: 10,
      color: "#333",
      fontFamily: "Courier",
      paddingHorizontal: 8,
      paddingVertical: 6,
    },

    // Referenced objects appendix
    refObjectsHeading: {
      fontSize: 14,
      fontFamily: "Inter",
      fontWeight: "bold",
      marginTop: 14,
      marginBottom: 8,
      paddingBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: "#cccccc",
      borderBottomStyle: "solid",
    },
    refObjectsItem: {
      fontSize: 10,
      marginBottom: 4,
    },
  });

  // ── Markdown AST walker ──────────────────────────────────────────────────

  interface RenderCtx {
    origin: AttachmentOrigin;
    attachments: ExperimentAttachment[];
    /** Pre-baked embed data, keyed by the exact link href. When present, lone
     *  embed-link paragraphs are rendered as rich figures rather than plain
     *  links. Optional so that code paths that don't bake (combined-pdf,
     *  method bodies) degrade gracefully to the plain-link fallback. */
    bakedEmbeds?: Map<string, BakedEmbed>;
  }

  function renderInline(
    tokens: Token[] | undefined,
    ctx: RenderCtx,
    keyPrefix: string,
    extraStyle?: any,
  ): React.ReactNode[] {
    if (!tokens || tokens.length === 0) return [];
    return tokens.map((tok, i) => {
      const key = `${keyPrefix}-i${i}`;
      const t = tok as Token;
      switch (t.type) {
        case "text": {
          const tt = t as Tokens.Text;
          if (tt.tokens && tt.tokens.length) {
            return h(
              React.Fragment,
              { key },
              renderInline(tt.tokens, ctx, key, extraStyle),
            );
          }
          return tt.text;
        }
        case "strong": {
          const tt = t as Tokens.Strong;
          return h(
            Text,
            { key, style: { fontFamily: "Inter", fontWeight: "bold", ...extraStyle } },
            renderInline(tt.tokens, ctx, key),
          );
        }
        case "em": {
          const tt = t as Tokens.Em;
          return h(
            Text,
            { key, style: { fontStyle: "italic", ...extraStyle } },
            renderInline(tt.tokens, ctx, key),
          );
        }
        case "del": {
          const tt = t as Tokens.Del;
          return h(
            Text,
            {
              key,
              style: { textDecoration: "line-through", ...extraStyle },
            },
            renderInline(tt.tokens, ctx, key),
          );
        }
        case "codespan": {
          const tt = t as Tokens.Codespan;
          return h(Text, { key, style: styles.codeInline }, tt.text);
        }
        case "link": {
          const tt = t as Tokens.Link;
          const inner = tt.tokens && tt.tokens.length
            ? renderInline(tt.tokens, ctx, key)
            : [tt.text ?? tt.href];
          if (looksLikeLocalFileRef(tt.href)) {
            // If the body references a file that's no longer on disk (e.g.
            // deleted before export), the extractor never picked it up. The
            // "(see Files attached)" annotation would then be a lie — the
            // file isn't there. Emit an inline `[missing file: …]` placeholder
            // so the broken ref is visible rather than implied-present.
            const att = findAttachment(ctx.attachments, ctx.origin, tt.href);
            if (!att) {
              const basename = (() => {
                try {
                  return decodeURIComponent(tt.href).split("/").pop() ?? tt.href;
                } catch {
                  return tt.href.split("/").pop() ?? tt.href;
                }
              })();
              return h(
                Text,
                { key, style: styles.placeholder },
                `[missing file: ${basename}]`,
              );
            }
            return h(
              Text,
              { key },
              ...inner,
              h(
                Text,
                { style: styles.fileRefAnnotation },
                " (see Files attached)",
              ),
            );
          }
          return h(Link, { key, src: tt.href, style: styles.inlineLink }, ...inner);
        }
        case "image": {
          // Inline (within-text) image — rare; fall back to a text marker so
          // we don't break the inline flow with a block-level <Image>.
          const tt = t as Tokens.Image;
          return h(
            Text,
            { key, style: styles.placeholder },
            `[image: ${tt.text || tt.href}]`,
          );
        }
        case "br":
          return "\n";
        case "escape": {
          const tt = t as Tokens.Escape;
          return tt.text;
        }
        case "html": {
          const tt = t as Tokens.HTML;
          // Strip tags; emit any remaining text so HTML in markdown doesn't
          // print raw angle brackets.
          return tt.text?.replace(/<[^>]+>/g, "") ?? "";
        }
        default: {
          const anyT = t as any;
          return anyT.text ?? anyT.raw ?? "";
        }
      }
    });
  }

  function renderImageBlock(
    t: Tokens.Image,
    ctx: RenderCtx,
    key: string,
  ): React.ReactNode {
    const att = findAttachment(ctx.attachments, ctx.origin, t.href);
    if (!att) {
      return h(
        Text,
        { key, style: styles.placeholder },
        `[missing image: ${t.href}]`,
      );
    }
    if (!isImage(att.mimeType)) {
      return h(
        Text,
        { key, style: styles.placeholder },
        `[non-image attachment referenced as image: ${att.filename}]`,
      );
    }
    try {
      const src = attachmentToImageSrc(att);
      return h(
        View,
        { key, style: styles.imageWrapper, wrap: false },
        h(Image, { src, style: styles.image }),
        t.text
          ? h(Text, { style: styles.imageCaption }, t.text)
          : null,
      );
    } catch (err) {
      console.warn("[export/pdf] image encode failed", att.filename, err);
      return h(
        Text,
        { key, style: styles.placeholder },
        `[image render failed: ${att.filename}]`,
      );
    }
  }

  function renderTableBlock(
    t: Tokens.Table,
    ctx: RenderCtx,
    key: string,
  ): React.ReactNode {
    return h(
      View,
      { key, style: { marginBottom: 10 }, wrap: false },
      h(
        View,
        { style: styles.tableRow },
        ...t.header.map((cell, c) =>
          h(
            Text,
            {
              key: `${key}-h${c}`,
              style: styles.tableCellHeader,
            },
            ...renderInline(cell.tokens, ctx, `${key}-h${c}`),
          ),
        ),
      ),
      ...t.rows.map((row, r) =>
        h(
          View,
          { key: `${key}-r${r}`, style: styles.tableRow },
          ...row.map((cell, c) =>
            h(
              Text,
              {
                key: `${key}-r${r}c${c}`,
                style: styles.tableCell,
              },
              ...renderInline(cell.tokens, ctx, `${key}-r${r}c${c}`),
            ),
          ),
        ),
      ),
    );
  }

  /** Render a pre-baked embed as a PDF react-pdf node. */
  function renderBakedEmbed(
    baked: BakedEmbed,
    key: string,
  ): React.ReactNode {
    // Build the caption line text (used by multiple kinds below).
    const captionText = (label: string | null, caption: string): string | null => {
      if (!label && !caption) return null;
      if (label && caption) return `${label}. ${caption}`;
      return label || caption || null;
    };

    switch (baked.kind) {
      case "image": {
        const capText = captionText(baked.label, baked.caption);
        // Scale the image to fit the content width (432 pt) while preserving
        // the aspect ratio. @react-pdf maxWidth + objectFit handles this well.
        const aspectRatio = baked.height / Math.max(baked.width, 1);
        const displayW = Math.min(432, baked.width);
        const displayH = Math.round(displayW * aspectRatio);
        return h(
          View,
          { key, style: styles.embedFigureWrapper, wrap: false },
          h(Image, {
            src: baked.dataUrl,
            style: { ...styles.embedFigureImage, width: displayW, height: displayH },
          }),
          capText
            ? h(Text, { style: styles.embedCaption }, capText)
            : null,
        );
      }

      case "table": {
        const capText = captionText(baked.label, baked.caption);
        return h(
          View,
          { key, style: { ...styles.embedFigureWrapper, marginBottom: 10 }, wrap: false },
          h(
            View,
            { style: styles.tableRow },
            ...baked.columns.map((col, c) =>
              h(Text, { key: `${key}-h${c}`, style: styles.tableCellHeader }, col),
            ),
          ),
          ...baked.rows.map((row, r) =>
            h(
              View,
              { key: `${key}-r${r}`, style: styles.tableRow },
              ...row.map((cell, c) =>
                h(Text, { key: `${key}-r${r}c${c}`, style: styles.tableCell }, cell),
              ),
            ),
          ),
          capText
            ? h(Text, { style: styles.embedCaption }, capText)
            : null,
        );
      }

      case "text": {
        const capText = captionText(baked.label, baked.caption);
        return h(
          View,
          { key, style: styles.embedFigureWrapper, wrap: false },
          h(Text, { style: styles.embedTextBody }, baked.body),
          capText
            ? h(Text, { style: styles.embedCaption }, capText)
            : null,
        );
      }

      case "card": {
        const capText = captionText(baked.label, baked.caption);
        return h(
          View,
          { key, style: styles.embedFigureWrapper, wrap: false },
          h(
            View,
            { style: styles.embedCardPadding },
            h(Text, { style: styles.embedCardTitle }, baked.title),
            baked.subtitle
              ? h(Text, { style: styles.embedCardSubtitle }, baked.subtitle)
              : null,
            ...baked.meta.map((line, mi) =>
              h(Text, { key: `${key}-m${mi}`, style: styles.embedCardMeta }, line),
            ),
          ),
          capText
            ? h(Text, { style: styles.embedCaption }, capText)
            : null,
        );
      }

      case "missing":
        return h(
          View,
          { key, style: styles.embedMissingWrapper },
          h(
            Text,
            { style: styles.embedMissingText },
            `Referenced object: ${baked.name} (not available in this export)`,
          ),
        );
    }
  }

  function renderListItem(
    item: Tokens.ListItem,
    ctx: RenderCtx,
    key: string,
  ): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    item.tokens.forEach((child, ci) => {
      const k = `${key}-c${ci}`;
      if (child.type === "text") {
        const tt = child as Tokens.Text;
        out.push(
          h(
            Text,
            { key: k, style: styles.listItemBody },
            ...(tt.tokens && tt.tokens.length
              ? renderInline(tt.tokens, ctx, k)
              : [tt.text]),
          ),
        );
        return;
      }
      if (child.type === "list") {
        out.push(
          h(
            View,
            { key: k, style: { marginLeft: 12, marginTop: 2 } },
            ...renderBlock([child as Token], ctx, k),
          ),
        );
        return;
      }
      out.push(...renderBlock([child as Token], ctx, k));
    });
    return out;
  }

  function renderBlock(
    tokens: Token[],
    ctx: RenderCtx,
    keyPrefix: string,
  ): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    tokens.forEach((tok, i) => {
      const key = `${keyPrefix}-b${i}`;
      const t = tok as Token;
      switch (t.type) {
        case "space":
          return;
        case "heading": {
          const tt = t as Tokens.Heading;
          // Section header is rendered separately; map markdown depth 1 to h2
          // (avoids two title-sized headings on screen).
          const style =
            tt.depth <= 2
              ? styles.h2
              : tt.depth === 3
                ? styles.h3
                : styles.h4;
          out.push(
            h(Text, { key, style }, ...renderInline(tt.tokens, ctx, key)),
          );
          return;
        }
        case "paragraph": {
          const tt = t as Tokens.Paragraph;
          // If the paragraph is just a single image, lift it to a block image.
          if (
            tt.tokens.length === 1 &&
            (tt.tokens[0] as Token).type === "image"
          ) {
            out.push(
              renderImageBlock(tt.tokens[0] as Tokens.Image, ctx, key),
            );
            return;
          }
          // If the paragraph is a single link whose href is a block embed,
          // render the pre-baked figure/table/card rather than a plain link.
          if (
            tt.tokens.length === 1 &&
            (tt.tokens[0] as Token).type === "link"
          ) {
            const linkTok = tt.tokens[0] as Tokens.Link;
            const descriptor = parseObjectEmbed(linkTok.href);
            if (descriptor && descriptor.isEmbed && ctx.bakedEmbeds) {
              const baked = ctx.bakedEmbeds.get(linkTok.href);
              if (baked) {
                out.push(renderBakedEmbed(baked, key));
                return;
              }
              // Bake map present but this href is absent: fall through to the
              // plain-link path below (degrade gracefully, no crash).
            }
          }
          out.push(
            h(
              Text,
              { key, style: styles.paragraph },
              ...renderInline(tt.tokens, ctx, key),
            ),
          );
          return;
        }
        case "list": {
          const tt = t as Tokens.List;
          out.push(
            h(
              View,
              { key, style: { marginBottom: 8 } },
              ...tt.items.map((item, j) => {
                const k = `${key}-i${j}`;
                const ordered = tt.ordered;
                const start =
                  typeof tt.start === "number" ? tt.start : 1;
                let bullet: string;
                if (item.task) {
                  bullet = item.checked ? "☑" : "☐";
                } else if (ordered) {
                  bullet = `${start + j}.`;
                } else {
                  bullet = "•";
                }
                return h(
                  View,
                  { key: k, style: styles.listRow },
                  h(Text, { style: styles.listBullet }, bullet),
                  h(
                    View,
                    { style: { flex: 1 } },
                    ...renderListItem(item, ctx, k),
                  ),
                );
              }),
            ),
          );
          return;
        }
        case "code": {
          const tt = t as Tokens.Code;
          out.push(
            h(
              View,
              { key, style: styles.codeBlock, wrap: false },
              h(Text, null, tt.text),
            ),
          );
          return;
        }
        case "blockquote": {
          const tt = t as Tokens.Blockquote;
          out.push(
            h(
              View,
              { key, style: styles.blockquote },
              ...renderBlock(tt.tokens, ctx, key),
            ),
          );
          return;
        }
        case "hr":
          out.push(h(View, { key, style: styles.hr }));
          return;
        case "table":
          out.push(renderTableBlock(t as Tokens.Table, ctx, key));
          return;
        case "html": {
          const tt = t as Tokens.HTML;
          const stripped = tt.raw.replace(/<[^>]+>/g, "").trim();
          if (stripped)
            out.push(
              h(Text, { key, style: styles.paragraph }, stripped),
            );
          return;
        }
        default: {
          const anyT = t as any;
          if (anyT.text) {
            out.push(
              h(Text, { key, style: styles.paragraph }, anyT.text),
            );
          }
        }
      }
    });
    return out;
  }

  function renderMarkdown(
    md: string,
    ctx: RenderCtx,
    keyPrefix: string,
  ): React.ReactNode[] {
    if (!md.trim()) return [];
    let tokens: Token[];
    try {
      tokens = marked.lexer(md);
    } catch (err) {
      console.warn("[export/pdf] markdown lex failed", err);
      return [
        h(
          Text,
          { key: `${keyPrefix}-raw`, style: styles.paragraph },
          md,
        ),
      ];
    }
    return renderBlock(tokens, ctx, keyPrefix);
  }

  // ── Document assembly ────────────────────────────────────────────────────

  const { task, attachments, meta, methods } = payload;
  const notesUserMd = demoteHeadings(extractUserContent(payload.notesMarkdown));
  const resultsUserMd = demoteHeadings(extractUserContent(payload.resultsMarkdown));
  const hasNotes = hasUserContent(payload.notesMarkdown);
  const hasResults = hasUserContent(payload.resultsMarkdown);
  const subTasks = task.sub_tasks ?? [];
  const hasSubTasks = subTasks.length > 0;
  const deviationLog = (task.deviation_log ?? "").trim();
  const hasDeviation = deviationLog.length > 0;
  const hasMethods = methods.length > 0;

  // Files-appendix grouping by origin. Show every attachment, including
  // images that were inlined — the appendix is a "what files came with this
  // experiment" inventory, not just a referenced-link list.
  const groupedFiles = {
    notes: attachments.filter((a) => a.origin === "notes"),
    results: attachments.filter((a) => a.origin === "results"),
    methods: attachments.filter((a) => a.origin === "methods"),
  };
  const hasFiles =
    groupedFiles.notes.length +
      groupedFiles.results.length +
      groupedFiles.methods.length >
    0;

  // Scan for referenced objects across notes + results so we can render the
  // "Referenced objects" appendix. Method bodies are scanned in a future
  // follow-up (method markdown paths require a separate load step; see report).
  const notesEmbedRefs = scanEmbedRefs(notesUserMd);
  const resultsEmbedRefs = scanEmbedRefs(resultsUserMd);
  const allEmbedRefs = [...notesEmbedRefs, ...resultsEmbedRefs];
  const hasEmbeds = allEmbedRefs.length > 0;

  const tocEntries: { id: string; title: string }[] = [];
  if (hasNotes) tocEntries.push({ id: anchor("section-labnotes"), title: "Lab Notes" });
  if (hasResults) tocEntries.push({ id: anchor("section-results"), title: "Results" });
  if (hasMethods) {
    methods.forEach((mp) => {
      tocEntries.push({
        id: anchor(`section-methods-${mp.method.id}`),
        title: `Method: ${mp.method.name}`,
      });
    });
  }
  if (hasSubTasks)
    tocEntries.push({ id: anchor("section-subtasks"), title: "Sub-tasks" });
  if (hasDeviation)
    tocEntries.push({ id: anchor("section-deviation"), title: "Deviation log" });
  if (hasFiles)
    tocEntries.push({ id: anchor("section-files"), title: "Files attached" });
  if (hasEmbeds)
    tocEntries.push({ id: anchor("section-ref-objects"), title: "Referenced objects" });

  // ── Section renderers ────────────────────────────────────────────────────

  function LabNotesSection() {
    return h(
      SectionView,
      {
        id: anchor("section-labnotes"),
        bookmark: { title: "Lab Notes", fit: true },
        style: styles.sectionWrap,
      },
      h(Text, { style: styles.h2 }, "Lab Notes"),
      ...renderMarkdown(
        notesUserMd,
        { origin: "notes", attachments, bakedEmbeds },
        "ln",
      ),
    );
  }

  function ResultsSection() {
    return h(
      SectionView,
      {
        id: anchor("section-results"),
        bookmark: { title: "Results", fit: true },
        style: styles.sectionWrap,
      },
      h(Text, { style: styles.h2 }, "Results"),
      ...renderMarkdown(
        resultsUserMd,
        { origin: "results", attachments, bakedEmbeds },
        "rs",
      ),
    );
  }

  // ── PCR rendering ────────────────────────────────────────────────────────

  function formatTemperature(t: number): string {
    return `${t}°C`;
  }

  function renderPcrStepRow(
    step: PCRStep,
    key: string,
    indent: boolean,
  ): React.ReactNode {
    const firstCellStyle = indent
      ? [styles.tableCell, styles.pcrCycleStepIndent]
      : styles.tableCell;
    return h(
      View,
      { key, style: styles.tableRow, wrap: false },
      h(Text, { style: firstCellStyle }, step.name),
      h(Text, { style: styles.tableCell }, formatTemperature(step.temperature)),
      h(Text, { style: styles.tableCell }, step.duration),
    );
  }

  function renderPcrHoldRow(step: PCRStep, key: string): React.ReactNode {
    return h(
      View,
      { key, style: styles.pcrHoldRow, wrap: false },
      h(Text, { style: styles.tableCell }, step.name),
      h(Text, { style: styles.tableCell }, formatTemperature(step.temperature)),
      h(Text, { style: styles.tableCell }, step.duration),
    );
  }

  function renderPcrGradientTable(
    gradient: PCRGradient,
    keyPrefix: string,
  ): React.ReactNode {
    const rows: React.ReactNode[] = [];
    rows.push(
      h(
        View,
        { key: `${keyPrefix}-head`, style: styles.tableRow, wrap: false },
        h(Text, { style: styles.tableCellHeader }, "Step"),
        h(Text, { style: styles.tableCellHeader }, "Temperature"),
        h(Text, { style: styles.tableCellHeader }, "Duration"),
      ),
    );
    gradient.initial.forEach((s, i) =>
      rows.push(renderPcrStepRow(s, `${keyPrefix}-init-${i}`, false)),
    );
    gradient.cycles.forEach((cycle: PCRCycle, ci: number) => {
      const repeats = Number.isFinite(cycle.repeats) ? cycle.repeats : 1;
      rows.push(
        h(
          View,
          {
            key: `${keyPrefix}-c${ci}-header`,
            style: styles.pcrCycleHeaderRow,
            wrap: false,
          },
          h(
            Text,
            { style: styles.pcrCycleHeaderCell },
            `Cycle ${ci + 1} — ${repeats}×`,
          ),
        ),
      );
      cycle.steps.forEach((s, si) =>
        rows.push(renderPcrStepRow(s, `${keyPrefix}-c${ci}-s${si}`, true)),
      );
    });
    gradient.final.forEach((s, i) =>
      rows.push(renderPcrStepRow(s, `${keyPrefix}-fin-${i}`, false)),
    );
    if (gradient.hold) {
      rows.push(renderPcrHoldRow(gradient.hold, `${keyPrefix}-hold`));
    }
    return h(
      View,
      { key: keyPrefix, style: styles.pcrTable },
      ...rows,
    );
  }

  function renderPcrIngredientsTable(
    ingredients: PCRIngredient[],
    keyPrefix: string,
  ): React.ReactNode {
    if (ingredients.length === 0) {
      return h(
        Text,
        { key: `${keyPrefix}-empty`, style: styles.methodIntro },
        "No reagents recorded for this protocol.",
      );
    }
    const rows: React.ReactNode[] = [
      h(
        View,
        { key: `${keyPrefix}-head`, style: styles.tableRow, wrap: false },
        h(Text, { style: styles.tableCellHeader }, "Reagent"),
        h(Text, { style: styles.tableCellHeader }, "Concentration"),
        h(Text, { style: styles.tableCellHeader }, "Volume / reaction"),
      ),
    ];
    ingredients.forEach((ing, i) =>
      rows.push(
        h(
          View,
          { key: `${keyPrefix}-r${i}`, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCell }, ing.name),
          h(Text, { style: styles.tableCell }, ing.concentration),
          h(Text, { style: styles.tableCell }, `${ing.amount_per_reaction} μL`),
        ),
      ),
    );
    return h(View, { key: keyPrefix, style: styles.pcrTable }, ...rows);
  }

  function parseGradientOverride(json: string): PCRGradient | null {
    try {
      const parsed = JSON.parse(json) as PCRGradient;
      if (
        parsed &&
        Array.isArray(parsed.initial) &&
        Array.isArray(parsed.cycles) &&
        Array.isArray(parsed.final)
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  function parseIngredientsOverride(json: string): PCRIngredient[] | null {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? (parsed as PCRIngredient[]) : null;
    } catch {
      return null;
    }
  }

  function renderPcrMethodBody(mp: MethodPayload): React.ReactNode[] {
    const protocol: PCRProtocol | null = mp.pcrProtocol ?? null;
    if (!protocol) {
      return [
        h(
          Text,
          { key: "pcr-missing", style: styles.methodIntro },
          "PCR Method (protocol could not be loaded).",
        ),
      ];
    }
    const out: React.ReactNode[] = [];
    out.push(
      h(Text, { key: "pcr-program-h", style: styles.h4 }, "Thermocycler program"),
    );
    out.push(renderPcrGradientTable(protocol.gradient, `m${mp.method.id}-grad`));
    out.push(h(Text, { key: "pcr-reagents-h", style: styles.h4 }, "Reagents"));
    out.push(
      renderPcrIngredientsTable(protocol.ingredients, `m${mp.method.id}-ing`),
    );
    if (protocol.notes && protocol.notes.trim()) {
      out.push(
        h(
          Text,
          { key: "pcr-notes", style: styles.pcrNotes },
          protocol.notes.trim(),
        ),
      );
    }
    const att = mp.attachment;
    if (att?.pcr_gradient && att.pcr_gradient.trim()) {
      const override = parseGradientOverride(att.pcr_gradient);
      if (override) {
        out.push(
          h(
            Text,
            { key: "pcr-dev-grad-h", style: styles.pcrDeviationHeading },
            "Gradient deviations for this task",
          ),
        );
        out.push(
          renderPcrGradientTable(override, `m${mp.method.id}-grad-dev`),
        );
      }
    }
    if (att?.pcr_ingredients && att.pcr_ingredients.trim()) {
      const override = parseIngredientsOverride(att.pcr_ingredients);
      if (override) {
        out.push(
          h(
            Text,
            { key: "pcr-dev-ing-h", style: styles.pcrDeviationHeading },
            "Reagent deviations for this task",
          ),
        );
        out.push(
          renderPcrIngredientsTable(override, `m${mp.method.id}-ing-dev`),
        );
      }
    }
    return out;
  }

  function renderLcGradientMethodBody(mp: MethodPayload): React.ReactNode[] {
    const sourceProtocol: LCGradientProtocol | null = mp.lcGradientProtocol ?? null;
    if (!sourceProtocol) {
      return [
        h(
          Text,
          { key: "lc-missing", style: styles.methodIntro },
          "LC Gradient Method (protocol could not be loaded).",
        ),
      ];
    }
    // Per-task snapshot override mirrors HTML buildLcGradientMethodBody.
    let protocol: LCGradientProtocol = sourceProtocol;
    const att = mp.attachment;
    if (att?.lc_gradient && att.lc_gradient.trim()) {
      try {
        const parsed = JSON.parse(att.lc_gradient);
        if (parsed && typeof parsed === "object") {
          protocol = { ...sourceProtocol, ...(parsed as Partial<LCGradientProtocol>) };
        }
      } catch {
        // Fall back to source if snapshot was corrupt.
      }
    }

    const keyPrefix = `m${mp.method.id}-lc`;
    const out: React.ReactNode[] = [];

    // Gradient steps table
    out.push(
      h(Text, { key: `${keyPrefix}-grad-h`, style: styles.h4 }, "Gradient steps"),
    );
    const stepRows: React.ReactNode[] = [
      h(
        View,
        { key: `${keyPrefix}-grad-head`, style: styles.tableRow, wrap: false },
        h(Text, { style: styles.tableCellHeader }, "Time (min)"),
        h(Text, { style: styles.tableCellHeader }, "% A"),
        h(Text, { style: styles.tableCellHeader }, "% B"),
        h(Text, { style: styles.tableCellHeader }, "Flow (mL/min)"),
      ),
    ];
    (protocol.gradient_steps ?? []).forEach((s, i) => {
      stepRows.push(
        h(
          View,
          { key: `${keyPrefix}-grad-r${i}`, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCell }, String(s.time_min)),
          h(Text, { style: styles.tableCell }, String(s.percent_a)),
          h(Text, { style: styles.tableCell }, String(s.percent_b)),
          h(Text, { style: styles.tableCell }, String(s.flow_ml_min)),
        ),
      );
    });
    out.push(
      h(View, { key: `${keyPrefix}-grad`, style: styles.pcrTable }, ...stepRows),
    );

    // Column + detection
    const c = protocol.column ?? {};
    const colRows: React.ReactNode[] = [];
    const pushColRow = (
      label: string,
      value: string | number | null | undefined,
      key: string,
    ) => {
      if (value === null || value === undefined || value === "") return;
      colRows.push(
        h(
          View,
          { key, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, label),
          h(Text, { style: styles.tableCell }, String(value)),
        ),
      );
    };
    pushColRow("Manufacturer", c.manufacturer, `${keyPrefix}-col-man`);
    pushColRow("Model", c.model, `${keyPrefix}-col-mod`);
    pushColRow("Length (mm)", c.length_mm, `${keyPrefix}-col-len`);
    pushColRow("Inner diameter (mm)", c.inner_diameter_mm, `${keyPrefix}-col-id`);
    pushColRow("Particle size (µm)", c.particle_size_um, `${keyPrefix}-col-part`);
    pushColRow(
      "Detection wavelength (nm)",
      protocol.detection_wavelength_nm,
      `${keyPrefix}-col-det`,
    );
    if (colRows.length > 0) {
      out.push(
        h(Text, { key: `${keyPrefix}-col-h`, style: styles.h4 }, "Column & detection"),
      );
      out.push(h(View, { key: `${keyPrefix}-col`, style: styles.pcrTable }, ...colRows));
    }

    // Ingredients
    if (protocol.ingredients && protocol.ingredients.length > 0) {
      out.push(
        h(Text, { key: `${keyPrefix}-ing-h`, style: styles.h4 }, "Ingredients"),
      );
      const ROLE_LABELS: Record<string, string> = {
        solvent_a: "Solvent A",
        solvent_b: "Solvent B",
        buffer: "Buffer",
        additive: "Additive",
      };
      const ingRows: React.ReactNode[] = [
        h(
          View,
          { key: `${keyPrefix}-ing-head`, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, "Name"),
          h(Text, { style: styles.tableCellHeader }, "Role"),
          h(Text, { style: styles.tableCellHeader }, "Concentration"),
          h(Text, { style: styles.tableCellHeader }, "Notes"),
        ),
      ];
      protocol.ingredients.forEach((ing, i) => {
        ingRows.push(
          h(
            View,
            { key: `${keyPrefix}-ing-r${i}`, style: styles.tableRow, wrap: false },
            h(Text, { style: styles.tableCell }, ing.name),
            h(Text, { style: styles.tableCell }, ROLE_LABELS[ing.role] ?? ing.role),
            h(Text, { style: styles.tableCell }, ing.concentration ?? ""),
            h(Text, { style: styles.tableCell }, ing.notes ?? ""),
          ),
        );
      });
      out.push(h(View, { key: `${keyPrefix}-ing`, style: styles.pcrTable }, ...ingRows));
    }

    if (protocol.description && protocol.description.trim()) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-desc`, style: styles.pcrNotes },
          protocol.description.trim(),
        ),
      );
    }
    if (att?.lc_gradient && att.lc_gradient.trim()) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-snap-note`, style: styles.pcrDeviationHeading },
          "Note: values above reflect per-task snapshot overrides, not the source protocol.",
        ),
      );
    }
    return out;
  }

  function renderPlateMethodBody(mp: MethodPayload): React.ReactNode[] {
    const sourceProtocol: PlateProtocol | null = mp.plateProtocol ?? null;
    if (!sourceProtocol) {
      return [
        h(
          Text,
          { key: "plate-missing", style: styles.methodIntro },
          "Plate Layout Method (protocol could not be loaded).",
        ),
      ];
    }

    const ROLE_LABELS: Record<string, string> = {
      blank: "Blank",
      sample: "Sample",
      control: "Control",
      na: "N/A",
      custom: "Custom",
    };
    const dims = (() => {
      switch (sourceProtocol.plate_size) {
        case 12: return { rows: 3, cols: 4 };
        case 24: return { rows: 4, cols: 6 };
        case 48: return { rows: 6, cols: 8 };
        case 96: return { rows: 8, cols: 12 };
        case 384: return { rows: 16, cols: 24 };
      }
    })();

    // Build the effective per-well map.
    const wells: Record<string, PlateWellAnnotation> = {};
    for (const r of sourceProtocol.region_labels ?? []) {
      for (let row = r.row_start; row <= r.row_end; row += 1) {
        for (let col = r.col_start; col <= r.col_end; col += 1) {
          const id = `${String.fromCharCode(65 + row)}${col + 1}`;
          const w: PlateWellAnnotation = { role: r.role };
          if (r.custom_label) w.custom_label = r.custom_label;
          if (r.notes) w.notes = r.notes;
          wells[id] = w;
        }
      }
    }
    const att = mp.attachment;
    let usedSnapshot = false;
    if (att?.plate_annotation && att.plate_annotation.trim()) {
      try {
        const parsed = JSON.parse(att.plate_annotation);
        if (parsed && typeof parsed === "object" && parsed.wells && typeof parsed.wells === "object") {
          Object.assign(wells, parsed.wells);
          usedSnapshot = true;
        }
      } catch {
        // Drop corrupt snapshot.
      }
    }

    const keyPrefix = `m${mp.method.id}-plate`;
    const out: React.ReactNode[] = [];

    out.push(
      h(
        Text,
        { key: `${keyPrefix}-h`, style: styles.h4 },
        `Plate layout (${sourceProtocol.plate_size}-well)`,
      ),
    );

    // Render the grid as a table of header row + dims.rows body rows.
    const gridRows: React.ReactNode[] = [];
    const headerCells: React.ReactNode[] = [
      h(Text, { key: "h-corner", style: styles.tableCellHeader }, ""),
    ];
    for (let c = 0; c < dims.cols; c += 1) {
      headerCells.push(
        h(Text, { key: `h-${c}`, style: styles.tableCellHeader }, String(c + 1)),
      );
    }
    gridRows.push(
      h(View, { key: `${keyPrefix}-head`, style: styles.tableRow, wrap: false }, ...headerCells),
    );
    for (let r = 0; r < dims.rows; r += 1) {
      const cells: React.ReactNode[] = [
        h(
          Text,
          { key: `r${r}-label`, style: styles.tableCellHeader },
          String.fromCharCode(65 + r),
        ),
      ];
      for (let c = 0; c < dims.cols; c += 1) {
        const id = `${String.fromCharCode(65 + r)}${c + 1}`;
        const w = wells[id];
        const label = !w
          ? ""
          : w.role === "sample"
            ? "S"
            : w.role === "control"
              ? "C"
              : w.role === "blank"
                ? "B"
                : w.role === "na"
                  ? "-"
                  : "?";
        cells.push(
          h(Text, { key: `r${r}c${c}`, style: styles.tableCell }, label),
        );
      }
      gridRows.push(
        h(View, { key: `${keyPrefix}-r${r}`, style: styles.tableRow, wrap: false }, ...cells),
      );
    }
    out.push(
      h(View, { key: `${keyPrefix}-grid`, style: styles.pcrTable }, ...gridRows),
    );

    // Summary counts.
    const counts: Record<string, number> = { blank: 0, sample: 0, control: 0, na: 0, custom: 0 };
    for (const w of Object.values(wells)) counts[w.role] = (counts[w.role] ?? 0) + 1;
    const summaryRows: React.ReactNode[] = [
      h(
        View,
        { key: `${keyPrefix}-sum-head`, style: styles.tableRow, wrap: false },
        h(Text, { style: styles.tableCellHeader }, "Role"),
        h(Text, { style: styles.tableCellHeader }, "Wells"),
      ),
    ];
    let totalAnnotated = 0;
    for (const role of Object.keys(ROLE_LABELS)) {
      if ((counts[role] ?? 0) === 0) continue;
      totalAnnotated += counts[role];
      summaryRows.push(
        h(
          View,
          { key: `${keyPrefix}-sum-${role}`, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCell }, ROLE_LABELS[role]),
          h(Text, { style: styles.tableCell }, String(counts[role])),
        ),
      );
    }
    if (totalAnnotated > 0) {
      out.push(
        h(View, { key: `${keyPrefix}-sum`, style: styles.pcrTable }, ...summaryRows),
      );
    }

    if (sourceProtocol.description && sourceProtocol.description.trim()) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-desc`, style: styles.pcrNotes },
          sourceProtocol.description.trim(),
        ),
      );
    }
    if (usedSnapshot) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-snap-note`, style: styles.pcrDeviationHeading },
          "Note: annotations above reflect per-task snapshot edits, not the source layout alone.",
        ),
      );
    }
    return out;
  }

  function renderCodingWorkflowMethodBody(mp: MethodPayload): React.ReactNode[] {
    const cw: CodingWorkflowProtocol | null = mp.codingWorkflow ?? null;
    if (!cw) {
      return [
        h(
          Text,
          { key: "cw-missing", style: styles.methodIntro },
          "Coding workflow (could not be loaded).",
        ),
      ];
    }
    const keyPrefix = `m${mp.method.id}-cw`;
    const out: React.ReactNode[] = [];
    const langLabel = cw.language === "other"
      ? (cw.language_label?.trim() || "Other")
      : cw.language;
    out.push(
      h(
        Text,
        { key: `${keyPrefix}-lang`, style: styles.methodIntro },
        `Language: ${langLabel}`,
      ),
    );
    if (cw.description && cw.description.trim()) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-desc`, style: styles.methodIntro },
          cw.description.trim(),
        ),
      );
    }
    if (cw.external_path && cw.external_path.trim()) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-ext`, style: styles.methodIntro },
          `External path: ${cw.external_path.trim()}`,
        ),
      );
    }
    if (cw.embedded_code && cw.embedded_code.trim()) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-code`, style: styles.codeBlock, wrap: false },
          cw.embedded_code,
        ),
      );
    } else if (!cw.external_path) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-empty`, style: styles.methodIntro },
          "(No embedded code or external path provided.)",
        ),
      );
    }
    return out;
  }

  function renderQpcrAnalysisMethodBody(mp: MethodPayload): React.ReactNode[] {
    const protocol: QPCRAnalysisProtocol | null = mp.qpcrAnalysisProtocol ?? null;
    if (!protocol) {
      return [
        h(
          Text,
          { key: "qpcr-missing", style: styles.methodIntro },
          "qPCR analysis method (protocol could not be loaded).",
        ),
      ];
    }
    let snapshotCqs: Record<string, { cq: number; notes?: string | null }> = {};
    let snapshotMeltTms: Record<string, number> = {};
    let snapshotNotes: string | null = null;
    const att = mp.attachment;
    if (att?.qpcr_analysis && att.qpcr_analysis.trim()) {
      try {
        const parsed = JSON.parse(att.qpcr_analysis);
        if (parsed && typeof parsed === "object") {
          if (parsed.cqs && typeof parsed.cqs === "object") snapshotCqs = parsed.cqs;
          if (parsed.melt_tms && typeof parsed.melt_tms === "object") snapshotMeltTms = parsed.melt_tms;
          if (typeof parsed.notes === "string") snapshotNotes = parsed.notes;
        }
      } catch {
        // Fall back to no snapshot.
      }
    }

    const keyPrefix = `m${mp.method.id}-qpcr`;
    const out: React.ReactNode[] = [];

    out.push(
      h(
        Text,
        { key: `${keyPrefix}-chem`, style: styles.methodIntro },
        `Chemistry: ${protocol.chemistry}${protocol.chemistry === "other" && protocol.chemistry_label ? ` (${protocol.chemistry_label})` : ""} · ΔΔCq ${protocol.use_delta_delta_cq ? "enabled" : "disabled"}`,
      ),
    );

    if (protocol.references.length > 0) {
      out.push(h(Text, { key: `${keyPrefix}-r-h`, style: styles.h4 }, "Targets & readouts"));
      const refRows: React.ReactNode[] = [
        h(
          View,
          { key: `${keyPrefix}-r-head`, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, "Target"),
          h(Text, { style: styles.tableCellHeader }, "Channel"),
          h(Text, { style: styles.tableCellHeader }, "Cq"),
          ...(protocol.melt_curve ? [h(Text, { style: styles.tableCellHeader }, "Tm (°C)")] : []),
        ),
      ];
      protocol.references.forEach((r, i) => {
        const cq = snapshotCqs[r.id]?.cq;
        const tm = snapshotMeltTms[r.id];
        const cells = [
          h(Text, { style: styles.tableCell }, `${r.target || "(unnamed)"}${r.is_reference ? " (ref)" : ""}`),
          h(Text, { style: styles.tableCell }, r.channel),
          h(Text, { style: styles.tableCell }, Number.isFinite(cq) ? (cq as number).toFixed(2) : "—"),
        ];
        if (protocol.melt_curve) {
          cells.push(h(Text, { style: styles.tableCell }, tm !== undefined ? tm.toFixed(1) : ""));
        }
        refRows.push(
          h(View, { key: `${keyPrefix}-r-r${i}`, style: styles.tableRow, wrap: false }, ...cells),
        );
      });
      out.push(h(View, { key: `${keyPrefix}-r`, style: styles.pcrTable }, ...refRows));
    }

    if (protocol.standard_curve.length > 0) {
      out.push(h(Text, { key: `${keyPrefix}-sc-h`, style: styles.h4 }, "Standard curve"));
      const curveRows: React.ReactNode[] = [
        h(
          View,
          { key: `${keyPrefix}-sc-head`, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, "log₁₀(quantity)"),
          h(Text, { style: styles.tableCellHeader }, "Cq"),
          h(Text, { style: styles.tableCellHeader }, "Replicates"),
        ),
      ];
      protocol.standard_curve.forEach((p, i) => {
        curveRows.push(
          h(
            View,
            { key: `${keyPrefix}-sc-r${i}`, style: styles.tableRow, wrap: false },
            h(Text, { style: styles.tableCell }, p.log_quantity.toString()),
            h(Text, { style: styles.tableCell }, p.cq.toString()),
            h(Text, { style: styles.tableCell }, p.replicate_n ? String(p.replicate_n) : ""),
          ),
        );
      });
      out.push(h(View, { key: `${keyPrefix}-sc`, style: styles.pcrTable }, ...curveRows));
    }

    if (protocol.melt_curve) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-mc`, style: styles.methodIntro },
          `Melt curve: ${protocol.melt_curve.start_c}–${protocol.melt_curve.end_c} °C @ ${protocol.melt_curve.ramp_rate_c_per_sec} °C/sec`,
        ),
      );
    }
    if (snapshotNotes) {
      out.push(h(Text, { key: `${keyPrefix}-n-h`, style: styles.h4 }, "Run notes"));
      out.push(h(Text, { key: `${keyPrefix}-n`, style: styles.methodIntro }, snapshotNotes));
    }
    if (protocol.description && protocol.description.trim()) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-d`, style: styles.methodIntro },
          protocol.description.trim(),
        ),
      );
    }
    return out;
  }

  function renderMassSpecMethodBody(mp: MethodPayload): React.ReactNode[] {
    const protocol: MassSpecProtocol | null = mp.massSpecProtocol ?? null;
    if (!protocol) {
      return [
        h(
          Text,
          { key: "ms-missing", style: styles.methodIntro },
          "Mass spec method (protocol could not be loaded).",
        ),
      ];
    }

    const keyPrefix = `m${mp.method.id}-ms`;
    const out: React.ReactNode[] = [];

    const pushLabelRow = (
      rows: React.ReactNode[],
      label: string,
      value: string | number | null | undefined,
      key: string,
    ) => {
      if (value === null || value === undefined || value === "") return;
      rows.push(
        h(
          View,
          { key, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, label),
          h(Text, { style: styles.tableCell }, String(value)),
        ),
      );
    };

    const modeLabel =
      IONIZATION_MODE_LABELS[protocol.ionization_mode] ?? protocol.ionization_mode;
    const fullModeLabel = protocol.ionization_label
      ? `${modeLabel} — ${protocol.ionization_label}`
      : modeLabel;

    const headerRows: React.ReactNode[] = [];
    pushLabelRow(headerRows, "Ionization mode", fullModeLabel, `${keyPrefix}-h-mode`);
    pushLabelRow(headerRows, "Instrument", protocol.instrument, `${keyPrefix}-h-inst`);
    if (headerRows.length > 0) {
      out.push(
        h(View, { key: `${keyPrefix}-h`, style: styles.pcrTable }, ...headerRows),
      );
    }

    const s = protocol.source ?? {};
    const sourceRows: React.ReactNode[] = [];
    pushLabelRow(sourceRows, "Source temperature (°C)", s.source_temp_c, `${keyPrefix}-s-temp`);
    pushLabelRow(sourceRows, "Capillary voltage (kV)", s.capillary_kv, `${keyPrefix}-s-cap`);
    pushLabelRow(sourceRows, "Nebulizer gas (L/min)", s.nebulizer_gas_lpm, `${keyPrefix}-s-neb`);
    pushLabelRow(sourceRows, "Drying gas (L/min)", s.drying_gas_lpm, `${keyPrefix}-s-dry`);
    pushLabelRow(sourceRows, "Drying gas temperature (°C)", s.drying_gas_temp_c, `${keyPrefix}-s-drytemp`);
    pushLabelRow(sourceRows, "EI ionization energy (eV)", s.ei_energy_ev, `${keyPrefix}-s-ei`);
    pushLabelRow(sourceRows, "MALDI laser wavelength (nm)", s.maldi_laser_nm, `${keyPrefix}-s-laser`);
    pushLabelRow(sourceRows, "MALDI laser energy", s.maldi_laser_energy, `${keyPrefix}-s-laserE`);
    pushLabelRow(sourceRows, "MALDI matrix", s.maldi_matrix, `${keyPrefix}-s-matrix`);
    pushLabelRow(sourceRows, "Notes", s.other_notes, `${keyPrefix}-s-notes`);
    out.push(h(Text, { key: `${keyPrefix}-s-h`, style: styles.h4 }, "Source params"));
    if (sourceRows.length > 0) {
      out.push(
        h(View, { key: `${keyPrefix}-s`, style: styles.pcrTable }, ...sourceRows),
      );
    } else {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-s-empty`, style: styles.methodIntro },
          "No source parameters recorded.",
        ),
      );
    }

    const sc = protocol.scan ?? { is_msms: false };
    const scanRows: React.ReactNode[] = [];
    if (sc.scan_mz_low != null || sc.scan_mz_high != null) {
      pushLabelRow(
        scanRows,
        "m/z range",
        `${sc.scan_mz_low ?? "?"} – ${sc.scan_mz_high ?? "?"}`,
        `${keyPrefix}-sc-mz`,
      );
    }
    pushLabelRow(scanRows, "Scan rate (Hz)", sc.scan_rate_hz, `${keyPrefix}-sc-rate`);
    pushLabelRow(scanRows, "Resolution (R, FWHM)", sc.resolution_r, `${keyPrefix}-sc-res`);
    pushLabelRow(scanRows, "MS/MS workflow", sc.is_msms ? "Yes" : "No", `${keyPrefix}-sc-msms`);
    if (sc.is_msms) {
      pushLabelRow(scanRows, "Isolation window (m/z)", sc.msms_isolation_window_mz, `${keyPrefix}-sc-iso`);
      pushLabelRow(scanRows, "Collision energy (eV)", sc.msms_collision_energy_ev, `${keyPrefix}-sc-ce`);
    }
    out.push(h(Text, { key: `${keyPrefix}-sc-h`, style: styles.h4 }, "Scan params"));
    if (scanRows.length > 0) {
      out.push(
        h(View, { key: `${keyPrefix}-sc`, style: styles.pcrTable }, ...scanRows),
      );
    } else {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-sc-empty`, style: styles.methodIntro },
          "No scan parameters recorded.",
        ),
      );
    }

    const c = protocol.calibration ?? {};
    const calRows: React.ReactNode[] = [];
    pushLabelRow(calRows, "Reference standard", c.reference_standard, `${keyPrefix}-c-ref`);
    pushLabelRow(calRows, "Calibration date", c.calibration_date, `${keyPrefix}-c-date`);
    pushLabelRow(calRows, "Expected mass accuracy (ppm)", c.expected_accuracy_ppm, `${keyPrefix}-c-acc`);
    pushLabelRow(calRows, "Notes", c.notes, `${keyPrefix}-c-notes`);
    out.push(h(Text, { key: `${keyPrefix}-c-h`, style: styles.h4 }, "Calibration"));
    if (calRows.length > 0) {
      out.push(
        h(View, { key: `${keyPrefix}-c`, style: styles.pcrTable }, ...calRows),
      );
    } else {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-c-empty`, style: styles.methodIntro },
          "No calibration information recorded.",
        ),
      );
    }

    if (protocol.description && protocol.description.trim()) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-desc`, style: styles.pcrNotes },
          protocol.description.trim(),
        ),
      );
    }

    return out;
  }

  function renderCellCultureMethodBody(mp: MethodPayload): React.ReactNode[] {
    const sourceSchedule: CellCultureSchedule | null = mp.cellCultureSchedule ?? null;
    if (!sourceSchedule) {
      return [
        h(
          Text,
          { key: "cc-missing", style: styles.methodIntro },
          "Cell culture passaging method (schedule could not be loaded).",
        ),
      ];
    }
    // Per-task snapshot overlays planned schedule + appends actual events.
    let plannedEvents: CellCulturePlannedEvent[] = sourceSchedule.planned_events ?? [];
    let cellLine = sourceSchedule.cell_line ?? {};
    let media = sourceSchedule.media ?? {};
    let description: string | null | undefined = sourceSchedule.description;
    let actualEvents: CellCultureActualEvent[] = [];
    const att = mp.attachment;
    if (att?.cell_culture_schedule && att.cell_culture_schedule.trim()) {
      try {
        const parsed = JSON.parse(att.cell_culture_schedule);
        if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.planned_events)) plannedEvents = parsed.planned_events;
          if (parsed.cell_line && typeof parsed.cell_line === "object") cellLine = parsed.cell_line;
          if (parsed.media && typeof parsed.media === "object") media = parsed.media;
          if (typeof parsed.description === "string" || parsed.description === null) {
            description = parsed.description;
          }
          if (Array.isArray(parsed.actual_events)) actualEvents = parsed.actual_events;
        }
      } catch {
        // Fall back to source if snapshot was corrupt.
      }
    }

    const keyPrefix = `m${mp.method.id}-cc`;
    const out: React.ReactNode[] = [];

    // Cell line metadata
    const cellLineRows: React.ReactNode[] = [];
    const pushCellLineRow = (label: string, value: string | null | undefined, key: string) => {
      if (value === null || value === undefined || value === "") return;
      cellLineRows.push(
        h(
          View,
          { key, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, label),
          h(Text, { style: styles.tableCell }, String(value)),
        ),
      );
    };
    pushCellLineRow("Name", cellLine.name, `${keyPrefix}-cl-n`);
    pushCellLineRow("Species", cellLine.species, `${keyPrefix}-cl-s`);
    pushCellLineRow("Tissue", cellLine.tissue, `${keyPrefix}-cl-t`);
    pushCellLineRow("Notes", cellLine.notes, `${keyPrefix}-cl-no`);
    if (cellLineRows.length > 0) {
      out.push(h(Text, { key: `${keyPrefix}-cl-h`, style: styles.h4 }, "Cell line"));
      out.push(h(View, { key: `${keyPrefix}-cl`, style: styles.pcrTable }, ...cellLineRows));
    }

    // Media
    const mediaRows: React.ReactNode[] = [];
    const pushMediaRow = (label: string, value: string | number | null | undefined, key: string) => {
      if (value === null || value === undefined || value === "") return;
      mediaRows.push(
        h(
          View,
          { key, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, label),
          h(Text, { style: styles.tableCell }, String(value)),
        ),
      );
    };
    pushMediaRow("Base medium", media.base_medium, `${keyPrefix}-md-b`);
    if (media.serum_percent !== null && media.serum_percent !== undefined) {
      pushMediaRow("Serum", `${media.serum_percent}%`, `${keyPrefix}-md-s`);
    }
    if (mediaRows.length > 0) {
      out.push(h(Text, { key: `${keyPrefix}-md-h`, style: styles.h4 }, "Media"));
      out.push(h(View, { key: `${keyPrefix}-md`, style: styles.pcrTable }, ...mediaRows));
    }
    const supplements: CellCultureSupplement[] = media.supplements ?? [];
    if (supplements.length > 0) {
      const suppRows: React.ReactNode[] = [
        h(
          View,
          { key: `${keyPrefix}-sup-head`, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, "Supplement"),
          h(Text, { style: styles.tableCellHeader }, "Concentration"),
          h(Text, { style: styles.tableCellHeader }, "Units"),
        ),
      ];
      supplements.forEach((s, i) => {
        suppRows.push(
          h(
            View,
            { key: `${keyPrefix}-sup-r${i}`, style: styles.tableRow, wrap: false },
            h(Text, { style: styles.tableCell }, s.name),
            h(Text, { style: styles.tableCell }, s.concentration),
            h(Text, { style: styles.tableCell }, s.units),
          ),
        );
      });
      out.push(h(View, { key: `${keyPrefix}-sup`, style: styles.pcrTable }, ...suppRows));
    }

    // Planned schedule
    if (plannedEvents.length > 0) {
      const EVENT_LABELS: Record<string, string> = {
        feed: "Feed",
        split: "Split",
        observe: "Observe",
        harvest: "Harvest",
      };
      out.push(h(Text, { key: `${keyPrefix}-pl-h`, style: styles.h4 }, "Planned schedule"));
      const planRows: React.ReactNode[] = [
        h(
          View,
          { key: `${keyPrefix}-pl-head`, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, "Day"),
          h(Text, { style: styles.tableCellHeader }, "Event"),
          h(Text, { style: styles.tableCellHeader }, "Split ratio"),
          h(Text, { style: styles.tableCellHeader }, "Notes"),
        ),
      ];
      plannedEvents.forEach((e, i) => {
        planRows.push(
          h(
            View,
            { key: `${keyPrefix}-pl-r${i}`, style: styles.tableRow, wrap: false },
            h(Text, { style: styles.tableCell }, `D${e.day_offset}`),
            h(Text, { style: styles.tableCell }, EVENT_LABELS[e.event_type] ?? e.event_type),
            h(Text, { style: styles.tableCell }, e.split_ratio ?? ""),
            h(Text, { style: styles.tableCell }, e.notes ?? ""),
          ),
        );
      });
      out.push(h(View, { key: `${keyPrefix}-pl`, style: styles.pcrTable }, ...planRows));
    }

    // Actual events (per-task history)
    if (actualEvents.length > 0) {
      const EVENT_LABELS: Record<string, string> = {
        feed: "Feed",
        split: "Split",
        observe: "Observe",
        harvest: "Harvest",
      };
      out.push(
        h(Text, { key: `${keyPrefix}-act-h`, style: styles.h4 }, "Actual events"),
      );
      const actRows: React.ReactNode[] = [
        h(
          View,
          { key: `${keyPrefix}-act-head`, style: styles.tableRow, wrap: false },
          h(Text, { style: styles.tableCellHeader }, "Timestamp"),
          h(Text, { style: styles.tableCellHeader }, "Event"),
          h(Text, { style: styles.tableCellHeader }, "Split ratio"),
          h(Text, { style: styles.tableCellHeader }, "Confluence"),
          h(Text, { style: styles.tableCellHeader }, "Observation"),
        ),
      ];
      actualEvents.forEach((e, i) => {
        let ts = e.timestamp;
        try {
          const d = new Date(e.timestamp);
          if (!isNaN(d.getTime())) ts = d.toLocaleString();
        } catch {
          // keep raw string
        }
        actRows.push(
          h(
            View,
            { key: `${keyPrefix}-act-r${i}`, style: styles.tableRow, wrap: false },
            h(Text, { style: styles.tableCell }, ts),
            h(Text, { style: styles.tableCell }, EVENT_LABELS[e.event_type] ?? e.event_type),
            h(Text, { style: styles.tableCell }, e.split_ratio ?? ""),
            h(
              Text,
              { style: styles.tableCell },
              e.confluence_percent !== undefined ? `${e.confluence_percent}%` : "",
            ),
            h(Text, { style: styles.tableCell }, e.observation_text ?? ""),
          ),
        );
      });
      out.push(h(View, { key: `${keyPrefix}-act`, style: styles.pcrTable }, ...actRows));
    }

    if (description && description.trim()) {
      out.push(
        h(
          Text,
          { key: `${keyPrefix}-desc`, style: styles.pcrNotes },
          description.trim(),
        ),
      );
    }
    return out;
  }

  function MethodSubsection({ mp }: { mp: MethodPayload }) {
    const { method, bodyMarkdown, attachment } = mp;
    const variation = (attachment?.variation_notes ?? "").trim();
    const children: React.ReactNode[] = [
      h(Text, { style: styles.h2 }, `Method: ${method.name}`),
    ];

    if (method.method_type === "markdown" && bodyMarkdown) {
      children.push(
        ...renderMarkdown(
          demoteHeadings(extractUserContent(bodyMarkdown)),
          { origin: "methods", attachments },
          `m${method.id}`,
        ),
      );
    } else if (method.method_type === "pdf") {
      const pdfAttachment = attachments.find(
        (a) => a.origin === "methods" && a.methodId === method.id,
      );
      const label = pdfAttachment?.filename ?? `method-${method.id}.pdf`;
      children.push(
        h(
          Text,
          { style: styles.methodIntro },
          `PDF method — see "${label}" in Files attached.`,
        ),
      );
    } else if (method.method_type === "pcr") {
      children.push(...renderPcrMethodBody(mp));
    } else if (method.method_type === "lc_gradient") {
      children.push(...renderLcGradientMethodBody(mp));
    } else if (method.method_type === "plate") {
      children.push(...renderPlateMethodBody(mp));
    } else if (method.method_type === "cell_culture") {
      children.push(...renderCellCultureMethodBody(mp));
    } else if (method.method_type === "mass_spec") {
      children.push(...renderMassSpecMethodBody(mp));
    } else if (method.method_type === "coding_workflow") {
      children.push(...renderCodingWorkflowMethodBody(mp));
    } else if (method.method_type === "qpcr_analysis") {
      children.push(...renderQpcrAnalysisMethodBody(mp));
    } else {
      children.push(
        h(
          Text,
          { style: styles.methodIntro },
          "(No method body available.)",
        ),
      );
    }

    if (variation) {
      children.push(
        h(
          Text,
          { style: styles.methodVariationHeading },
          "Variation notes for this task",
        ),
      );
      children.push(
        ...renderMarkdown(
          variation,
          { origin: "methods", attachments },
          `m${method.id}-var`,
        ),
      );
    }

    return h(
      SectionView,
      {
        id: anchor(`section-methods-${method.id}`),
        bookmark: { title: `Method: ${method.name}`, fit: true },
        style: styles.sectionWrap,
      },
      ...children,
    );
  }

  function SubTasksSection() {
    return h(
      SectionView,
      {
        id: anchor("section-subtasks"),
        bookmark: { title: "Sub-tasks", fit: true },
        style: styles.sectionWrap,
      },
      h(Text, { style: styles.h2 }, "Sub-tasks"),
      h(
        View,
        { style: { marginBottom: 8 } },
        ...subTasks.map((st, i) =>
          h(
            View,
            { key: `st-${i}`, style: styles.listRow },
            h(
              Text,
              { style: styles.listBullet },
              st.is_complete ? "☑" : "☐",
            ),
            h(
              Text,
              { style: styles.listItemBody },
              st.text,
            ),
          ),
        ),
      ),
    );
  }

  function DeviationSection() {
    return h(
      SectionView,
      {
        id: anchor("section-deviation"),
        bookmark: { title: "Deviation log", fit: true },
        style: styles.sectionWrap,
      },
      h(Text, { style: styles.h2 }, "Deviation log"),
      ...renderMarkdown(
        deviationLog,
        { origin: "notes", attachments },
        "dev",
      ),
    );
  }

  function FilesAppendix() {
    const groups: { label: string; items: ExperimentAttachment[] }[] = [
      { label: "From Lab Notes", items: groupedFiles.notes },
      { label: "From Results", items: groupedFiles.results },
      { label: "From Methods", items: groupedFiles.methods },
    ];
    const children: React.ReactNode[] = [
      h(Text, { style: styles.h2 }, "Files attached"),
    ];
    groups.forEach((g) => {
      if (!g.items.length) return;
      children.push(
        h(
          View,
          { key: g.label, style: styles.filesAppendixGroup },
          h(
            Text,
            { style: styles.filesAppendixGroupHeading },
            `${g.label}:`,
          ),
          ...g.items.map((att, i) =>
            h(
              Text,
              {
                key: `${g.label}-${i}`,
                style: styles.filesAppendixItem,
              },
              `• ${att.filename}`,
            ),
          ),
        ),
      );
    });
    return h(
      SectionView,
      {
        id: anchor("section-files"),
        bookmark: { title: "Files attached", fit: true },
        style: styles.sectionWrap,
      },
      ...children,
    );
  }

  /** Appendix: a plain selectable-text list of every embedded object reference
   *  found in notes + results. Shows type, name (from caption), and the
   *  figure/table label when figure-numbering is on. */
  function ReferencedObjectsAppendix() {
    const children: React.ReactNode[] = [
      h(Text, { style: styles.refObjectsHeading }, "Referenced objects"),
    ];
    allEmbedRefs.forEach((ref, i) => {
      const baked = bakedEmbeds?.get(ref.href);
      // Build a human-readable line: "Figure 1. My molecule (molecule)"
      // or just "My plot (datahub)" when numbering is off.
      const typeLabel = ref.descriptor.type.charAt(0).toUpperCase() + ref.descriptor.type.slice(1);
      const namePart = ref.caption || ref.descriptor.id;
      let line = `${namePart} (${typeLabel})`;
      if (baked && baked.label) {
        line = `${baked.label}. ${line}`;
      }
      children.push(
        h(Text, { key: `ro-${i}`, style: styles.refObjectsItem }, `• ${line}`),
      );
    });
    return h(
      SectionView,
      {
        id: anchor("section-ref-objects"),
        bookmark: { title: "Referenced objects", fit: true },
        style: styles.sectionWrap,
      },
      ...children,
    );
  }

  // ── Collect section nodes ────────────────────────────────────────────────
  //
  // Each key is namespaced by `idPrefix` so a combined document holding
  // several experiments never emits duplicate React keys across items.

  const contentChildren: React.ReactNode[] = [];
  if (hasNotes) contentChildren.push(h(LabNotesSection, { key: `${idPrefix}ln` }));
  if (hasResults) contentChildren.push(h(ResultsSection, { key: `${idPrefix}rs` }));
  if (hasMethods) {
    methods.forEach((mp) => {
      contentChildren.push(
        h(MethodSubsection, { key: `${idPrefix}m${mp.method.id}`, mp }),
      );
    });
  }
  if (hasSubTasks) contentChildren.push(h(SubTasksSection, { key: `${idPrefix}st` }));
  if (hasDeviation) contentChildren.push(h(DeviationSection, { key: `${idPrefix}dv` }));
  if (hasFiles) contentChildren.push(h(FilesAppendix, { key: `${idPrefix}fa` }));
  if (hasEmbeds) contentChildren.push(h(ReferencedObjectsAppendix, { key: `${idPrefix}ro` }));

  // Provenance manifest, embedded as PDF metadata so downstream tooling can
  // detect "this came from a ResearchOS export" without inspecting content.
  // PDF (unlike a zip) can't hold a sidecar file, but the Document
  // `keywords` field carries arbitrary text — JSON-stringify the manifest
  // there. `subject` is left as `project.name` (semantically the right
  // place for that). Field names mirror Raw's `_export-manifest.json`.
  const manifest: PdfManifest = {
    format: "pdf",
    version: 1,
    exported_at: meta.exportedAt,
    source_owner: task.owner,
    source_instance: buildSourceInstance(meta.ownerLabel, meta.exportedAt),
    task_id: task.id,
  };

  return { tocEntries, contentChildren, manifest };
}

// ── Single-experiment PDF generator ─────────────────────────────────────────

export async function buildPdf(
  payload: ExperimentExportPayload,
  baseFilename?: string,
): Promise<ExportResult> {
  const ReactPDF: any = await import("@react-pdf/renderer");
  const { pdf, Document, Page, View, Text, Link, StyleSheet } = ReactPDF;
  const h = React.createElement;

  registerExportFonts(ReactPDF);

  const styles = StyleSheet.create({
    page: {
      paddingTop: 72,
      paddingBottom: 72,
      paddingHorizontal: 72,
      fontSize: 11,
      fontFamily: "Inter",
      lineHeight: 1.4,
      color: "#111",
    },
    titleH1: { fontSize: 24, fontFamily: "Inter", fontWeight: "bold", marginBottom: 28 },
    metaRow: { fontSize: 11, marginBottom: 6 },
    metaLabel: { fontFamily: "Inter", fontWeight: "bold" },
    generatedNote: { fontSize: 10, color: "#666", marginTop: 36 },
    tocTitle: { fontSize: 18, fontFamily: "Inter", fontWeight: "bold", marginBottom: 18 },
    tocEntry: { fontSize: 12, marginBottom: 8, color: "#0066cc" },
  });

  const { task, project, meta } = payload;

  // Pre-bake all block-embed references found in notes + results so the PDF
  // renderer can emit rich figures rather than bare links. The bake pass runs
  // BEFORE building the react-pdf tree; bakeAllEmbeds returns a Map keyed by
  // the exact href so the sync renderBlock walker can do a cheap O(1) lookup.
  // Method-body embeds are left for a follow-up (see report) because method
  // markdown bodies require their own async load step.
  let bakedEmbeds: Map<string, BakedEmbed> | undefined;
  try {
    const markdownsToBake = [
      payload.notesMarkdown ?? "",
      payload.resultsMarkdown ?? "",
    ];
    bakedEmbeds = await bakeAllEmbeds(markdownsToBake);
  } catch (err) {
    // A complete bake failure is non-fatal; the PDF still renders, embeds
    // degrade to plain links.
    console.warn("[export/pdf] bakeAllEmbeds failed, embeds will render as links", err);
  }

  const { tocEntries, contentChildren, manifest } = buildExperimentParts(
    ReactPDF,
    payload,
    "",
    bakedEmbeds,
  );

  function MetaRow({ label, value }: { label: string; value: string }) {
    return h(
      Text,
      { style: styles.metaRow },
      h(Text, { style: styles.metaLabel }, `${label.padEnd(11, " ")} `),
      value,
    );
  }

  const TitlePage = () =>
    h(
      Page,
      { size: "A4", style: styles.page },
      h(Text, { style: styles.titleH1 }, task.name),
      h(MetaRow, { label: "Project:", value: project.name }),
      h(MetaRow, { label: "Owner:", value: meta.ownerLabel }),
      h(MetaRow, {
        label: "Date range:",
        value: `${task.start_date} → ${task.end_date}`,
      }),
      h(MetaRow, {
        label: "Duration:",
        value: `${meta.durationDays} day${meta.durationDays === 1 ? "" : "s"}`,
      }),
      h(MetaRow, { label: "Status:", value: meta.statusLabel }),
      h(MetaRow, {
        label: "Methods:",
        value: meta.methodNames.length ? meta.methodNames.join(", ") : "—",
      }),
      h(
        Text,
        { style: styles.generatedNote },
        `Generated:  ${meta.exportedAt} by ResearchOS`,
      ),
    );

  const TocPage = () =>
    h(
      Page,
      { size: "A4", style: styles.page },
      h(Text, { style: styles.tocTitle }, "Contents"),
      ...tocEntries.map((e) =>
        h(Link, { key: e.id, src: `#${e.id}`, style: styles.tocEntry }, e.title),
      ),
    );

  const ContentPage = () =>
    h(
      Page,
      { size: "A4", style: styles.page, wrap: true },
      ...contentChildren,
    );

  // Deterministic creationDate — use `meta.exportedAt` instead of
  // `new Date()` so re-exports of the same task don't differ only in PDF
  // metadata. Mirrors the JSZip `date:` story for raw / html.
  // `void View` keeps the destructured component referenced even though the
  // single-export document only assembles Page/Text/Link directly.
  void View;
  // PDF document metadata fields are NOT JSX-escaped -- sanitize user-supplied
  // strings before they go into the PDF dict.
  const docTree = h(
    Document,
    {
      title: sanitizeForExport(task.name || ""),
      author: sanitizeForExport(meta.ownerLabel || ""),
      subject: sanitizeForExport(project.name || ""),
      keywords: JSON.stringify(manifest),
      creator: "ResearchOS",
      producer: "ResearchOS",
      creationDate: new Date(meta.exportedAt),
    },
    h(TitlePage, { key: "title" }),
    tocEntries.length ? h(TocPage, { key: "toc" }) : null,
    contentChildren.length ? h(ContentPage, { key: "content" }) : null,
  );

  const blob: Blob = await pdf(docTree).toBlob();
  return {
    blob,
    filename: `${baseFilename ?? slugify(task.name)}.pdf`,
    mimeType: "application/pdf",
  };
}
