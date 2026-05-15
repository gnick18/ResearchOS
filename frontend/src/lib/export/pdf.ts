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
  CellCultureSchedule,
  CellCultureActualEvent,
  CellCulturePlannedEvent,
  CellCultureSupplement,
} from "@/lib/types";

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

// ── PDF generator (dynamic import; all JSX lives inside) ────────────────────

export async function buildPdf(
  payload: ExperimentExportPayload,
  baseFilename?: string,
): Promise<ExportResult> {
  const ReactPDF: any = await import("@react-pdf/renderer");
  const { pdf, Document, Page, View, Text, Image, Link, StyleSheet, Font } =
    ReactPDF;
  const h = React.createElement;

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
  if (!fontsRegistered) {
    Font.register({
      family: "Inter",
      fonts: [
        { src: "/fonts/Inter-Regular.ttf" },
        { src: "/fonts/Inter-Bold.ttf", fontWeight: "bold" },
      ],
    });
    fontsRegistered = true;
  }

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
  });

  // ── Markdown AST walker ──────────────────────────────────────────────────

  interface RenderCtx {
    origin: AttachmentOrigin;
    attachments: ExperimentAttachment[];
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
            // deleted before export), `filterByBodyRefs` drops the attachment.
            // The "(see Files attached)" annotation would then be a lie — the
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

  const { task, project, attachments, meta, methods } = payload;
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

  const tocEntries: { id: string; title: string }[] = [];
  if (hasNotes) tocEntries.push({ id: "section-labnotes", title: "Lab Notes" });
  if (hasResults) tocEntries.push({ id: "section-results", title: "Results" });
  if (hasMethods) {
    methods.forEach((mp) => {
      tocEntries.push({
        id: `section-methods-${mp.method.id}`,
        title: `Method: ${mp.method.name}`,
      });
    });
  }
  if (hasSubTasks)
    tocEntries.push({ id: "section-subtasks", title: "Sub-tasks" });
  if (hasDeviation)
    tocEntries.push({ id: "section-deviation", title: "Deviation log" });
  if (hasFiles)
    tocEntries.push({ id: "section-files", title: "Files attached" });

  // ── Section renderers ────────────────────────────────────────────────────

  function MetaRow({ label, value }: { label: string; value: string }) {
    return h(
      Text,
      { style: styles.metaRow },
      h(Text, { style: styles.metaLabel }, `${label.padEnd(11, " ")} `),
      value,
    );
  }

  function TitlePage() {
    return h(
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
  }

  function TocPage() {
    return h(
      Page,
      { size: "A4", style: styles.page },
      h(Text, { style: styles.tocTitle }, "Contents"),
      ...tocEntries.map((e) =>
        h(
          Link,
          { key: e.id, src: `#${e.id}`, style: styles.tocEntry },
          e.title,
        ),
      ),
    );
  }

  function LabNotesSection() {
    return h(
      SectionView,
      {
        id: "section-labnotes",
        bookmark: { title: "Lab Notes", fit: true },
        style: styles.sectionWrap,
      },
      h(Text, { style: styles.h2 }, "Lab Notes"),
      ...renderMarkdown(
        notesUserMd,
        { origin: "notes", attachments },
        "ln",
      ),
    );
  }

  function ResultsSection() {
    return h(
      SectionView,
      {
        id: "section-results",
        bookmark: { title: "Results", fit: true },
        style: styles.sectionWrap,
      },
      h(Text, { style: styles.h2 }, "Results"),
      ...renderMarkdown(
        resultsUserMd,
        { origin: "results", attachments },
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
    } else if (method.method_type === "cell_culture") {
      children.push(...renderCellCultureMethodBody(mp));
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
        id: `section-methods-${method.id}`,
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
        id: "section-subtasks",
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
        id: "section-deviation",
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
        id: "section-files",
        bookmark: { title: "Files attached", fit: true },
        style: styles.sectionWrap,
      },
      ...children,
    );
  }

  // ── Build document tree ──────────────────────────────────────────────────

  const contentChildren: React.ReactNode[] = [];
  if (hasNotes) contentChildren.push(h(LabNotesSection, { key: "ln" }));
  if (hasResults) contentChildren.push(h(ResultsSection, { key: "rs" }));
  if (hasMethods) {
    methods.forEach((mp) => {
      contentChildren.push(h(MethodSubsection, { key: `m${mp.method.id}`, mp }));
    });
  }
  if (hasSubTasks) contentChildren.push(h(SubTasksSection, { key: "st" }));
  if (hasDeviation) contentChildren.push(h(DeviationSection, { key: "dv" }));
  if (hasFiles) contentChildren.push(h(FilesAppendix, { key: "fa" }));

  const ContentPage = () =>
    h(
      Page,
      { size: "A4", style: styles.page, wrap: true },
      ...contentChildren,
    );

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

  // Deterministic creationDate — use `meta.exportedAt` instead of
  // `new Date()` so re-exports of the same task don't differ only in PDF
  // metadata. Mirrors the JSZip `date:` story for raw / html.
  const docTree = h(
    Document,
    {
      title: task.name,
      author: meta.ownerLabel,
      subject: project.name,
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
