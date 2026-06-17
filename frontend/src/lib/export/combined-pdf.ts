// Combined navigable PDF builder.
//
// Merges MULTIPLE selected experiments and notes into ONE PDF with:
//   - a cover/title page (selection title, date, item count, owner),
//   - a master index / "key" page right after the cover whose every entry is
//     a CLICKABLE internal link that jumps to that item's section,
//   - each item rendered in sequence on a new page, with a heading, a PDF
//     bookmark/outline entry, and a small "Back to index" internal link,
//   - a full PDF outline/bookmarks tree for the whole document.
//
// Experiments reuse the EXISTING per-experiment rendering (`buildExperimentParts`
// from pdf.ts) so we never reimplement experiment rendering or its method /
// markdown walkers. Notes render through a small dedicated markdown renderer.
//
// The renderer is `@react-pdf/renderer` (the same library pdf.ts uses),
// dynamically imported to keep it out of the SSR bundle. Internal links use
// react-pdf's `Link src="#dest"` + a matching `id="dest"` named destination
// on the target node; bookmarks use the runtime `bookmark` prop on View.
//
// This is an EXPORT-ONLY feature: it produces a downloadable Blob and writes
// NOTHING to disk. The builder is pure + importable (a parallel deposit
// feature reuses this exact contract), with its disk/API reads injected via
// an optional `deps` argument so it stays unit-testable without a filesystem.
//
// combined-pdf bot, 2026-05-28.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from "react";
import { marked, type Token, type Tokens } from "marked";

import { buildExperimentParts, registerExportFonts } from "./pdf";
import { buildExperimentPayload, type ExtractDeps } from "./extract";
import type { ExperimentExportPayload } from "./types";
import type { Note, Task } from "@/lib/types";
import { sanitizeForExport } from "@/lib/validation/input-hardening";

// ── Public contract ─────────────────────────────────────────────────────────
//
// Locked shape. A parallel deposit feature imports these verbatim; do not
// rename fields without coordinating.

export interface CombinedPdfItem {
  kind: "experiment" | "note";
  id: number;
}

export interface CombinedPdfInput {
  title: string;
  items: CombinedPdfItem[];
}

// ── Injectable resolver layer ────────────────────────────────────────────────
//
// The builder reads experiments off disk (via `buildExperimentPayload`) and
// notes via `notesApi`. To keep `buildCombinedPdf` pure + testable, those
// reads go through this dependency object. Production callers omit it; the
// defaults wire in the real APIs. Tests pass fakes that return fixtures with
// no filesystem.

export interface CombinedPdfDeps {
  // Resolve one experiment item to its full export payload (or null if the
  // task could not be loaded).
  resolveExperiment: (id: number) => Promise<ExperimentExportPayload | null>;
  // Resolve one note item to its Note record (or null if missing).
  resolveNote: (id: number) => Promise<Note | null>;
  // The logged-in user label, used for the cover "Owner" line when the
  // selection spans a single owner. May be null/empty.
  currentUser: string | null;
}

// Build the production default deps. Imports the real local-api lazily so the
// pure builder + its types stay importable from contexts (e.g. the deposit
// feature's unit tests) that don't want to pull in the whole storage layer.
async function defaultDeps(currentUser: string | null): Promise<CombinedPdfDeps> {
  const { projectsApi, methodsApi, filesApi, tasksApi, notesApi } = await import(
    "@/lib/local-api"
  );
  const extractDeps: ExtractDeps = { projectsApi, methodsApi, filesApi };
  return {
    currentUser,
    resolveExperiment: async (id) => {
      const task: Task | null = await tasksApi.get(id);
      if (!task) return null;
      return buildExperimentPayload(task, currentUser, extractDeps);
    },
    resolveNote: async (id) => notesApi.get(id),
  };
}

// ── Resolved-item model ──────────────────────────────────────────────────────

interface ResolvedExperiment {
  kind: "experiment";
  id: number;
  title: string;
  payload: ExperimentExportPayload;
}

interface ResolvedNote {
  kind: "note";
  id: number;
  title: string;
  note: Note;
}

type ResolvedItem = ResolvedExperiment | ResolvedNote;

// Stable per-item anchor + bookmark id. Namespaces every experiment's internal
// section ids so two experiments never collide on e.g. "section-results".
function itemAnchorId(item: CombinedPdfItem): string {
  return `item-${item.kind}-${item.id}`;
}

// The single named destination the cover + every per-item "Back to index"
// link points at.
const INDEX_ANCHOR = "combined-index";

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a single combined navigable PDF from the selected experiments and
 * notes. Returns a `Blob` (application/pdf). Pure + importable: the only side
 * effect is reading the referenced items through `deps` (the production
 * default reads from local-api; tests inject fixtures).
 *
 * Items render in selection order, grouped on the index page by type
 * (Experiments first, then Notes). Items that fail to resolve are skipped
 * (a console warning is emitted) so one missing task never sinks the whole
 * document.
 */
export async function buildCombinedPdf(
  input: CombinedPdfInput,
  deps?: CombinedPdfDeps,
): Promise<Blob> {
  const resolved = deps ?? (await defaultDeps(null));

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
    coverTitle: {
      fontSize: 26,
      fontFamily: "Inter",
      fontWeight: "bold",
      marginBottom: 28,
    },
    metaRow: { fontSize: 11, marginBottom: 6 },
    metaLabel: { fontFamily: "Inter", fontWeight: "bold" },
    generatedNote: { fontSize: 10, color: "#666", marginTop: 36 },

    indexTitle: {
      fontSize: 18,
      fontFamily: "Inter",
      fontWeight: "bold",
      marginBottom: 16,
    },
    indexGroupHeading: {
      fontSize: 12,
      fontFamily: "Inter",
      fontWeight: "bold",
      color: "#444",
      marginTop: 14,
      marginBottom: 6,
    },
    indexEntry: { fontSize: 12, marginBottom: 8, color: "#0066cc" },
    // NB: no `fontStyle: italic` here. Only Inter Regular + Bold faces are
    // registered (see pdf.ts `registerExportFonts`); an italic lookup against
    // the Inter family throws in the Node test env and silently falls back in
    // the browser. This text always renders (empty-selection case), so we keep
    // it upright to stay deterministic across both.
    indexEmpty: { fontSize: 11, color: "#888" },

    itemHeading: {
      fontSize: 20,
      fontFamily: "Inter",
      fontWeight: "bold",
      marginBottom: 4,
    },
    itemKindLabel: {
      fontSize: 10,
      color: "#666",
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 10,
    },
    backToIndex: {
      fontSize: 10,
      color: "#0066cc",
      textDecoration: "underline",
      marginBottom: 14,
    },

    sectionWrap: { marginBottom: 12 },
    h2: {
      fontSize: 16,
      fontFamily: "Inter",
      fontWeight: "bold",
      marginTop: 14,
      marginBottom: 10,
      paddingBottom: 6,
      borderBottomWidth: 1,
      borderBottomColor: "#cccccc",
      borderBottomStyle: "solid",
    },
    h3: { fontSize: 13, fontFamily: "Inter", fontWeight: "bold", marginTop: 12, marginBottom: 6 },
    h4: { fontSize: 11, fontFamily: "Inter", fontWeight: "bold", marginTop: 10, marginBottom: 4 },
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
    codeInline: { fontFamily: "Courier", fontSize: 10, backgroundColor: "#f3f3f3" },
    codeBlock: {
      fontFamily: "Courier",
      fontSize: 10,
      backgroundColor: "#f3f3f3",
      padding: 8,
      marginBottom: 10,
    },
    inlineLink: { color: "#0066cc", textDecoration: "underline" },
    noteEntryDate: { fontSize: 9, color: "#888", marginBottom: 4 },
    noteDescription: { fontSize: 11, color: "#444", marginBottom: 10 },
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
      fontFamily: "Inter",
      fontWeight: "bold",
      backgroundColor: "#f3f3f3",
    },
  });

  // View/Text don't expose `bookmark` / `id` in the renderer's published types
  // but the runtime supports both (BaseProps in @react-pdf/types/node.d.ts).
  type SectionViewProps = React.PropsWithChildren<{
    id?: string;
    bookmark?: { title: string; fit?: boolean; expanded?: boolean };
    style?: any;
    wrap?: boolean;
    break?: boolean;
  }>;
  const SectionView = View as React.ComponentType<SectionViewProps>;

  // ── Resolve every requested item (skip failures) ───────────────────────────

  const resolvedItems: ResolvedItem[] = [];
  for (const item of input.items) {
    try {
      if (item.kind === "experiment") {
        const payload = await resolved.resolveExperiment(item.id);
        if (!payload) {
          console.warn(`[export/combined-pdf] experiment ${item.id} could not be loaded; skipping`);
          continue;
        }
        resolvedItems.push({
          kind: "experiment",
          id: item.id,
          title: payload.task.name || `Experiment ${item.id}`,
          payload,
        });
      } else {
        const note = await resolved.resolveNote(item.id);
        if (!note) {
          console.warn(`[export/combined-pdf] note ${item.id} could not be loaded; skipping`);
          continue;
        }
        resolvedItems.push({
          kind: "note",
          id: item.id,
          title: note.title || `Note ${item.id}`,
          note,
        });
      }
    } catch (err) {
      console.warn(`[export/combined-pdf] failed to resolve ${item.kind} ${item.id}:`, err);
    }
  }

  const experiments = resolvedItems.filter(
    (r): r is ResolvedExperiment => r.kind === "experiment",
  );
  const notes = resolvedItems.filter((r): r is ResolvedNote => r.kind === "note");

  // Owner label for the cover: a single distinct owner across all experiments,
  // else the current user, else a dash.
  const owners = new Set(experiments.map((e) => e.payload.task.owner).filter(Boolean));
  const ownerLabel =
    owners.size === 1
      ? Array.from(owners)[0]
      : resolved.currentUser && resolved.currentUser.length
        ? resolved.currentUser
        : owners.size > 1
          ? "(multiple)"
          : "-";

  const exportedAt = new Date().toISOString();

  // ── Markdown renderer for notes ─────────────────────────────────────────────
  //
  // Self-contained marked-AST walker. Mirrors the experiment renderer's block
  // grammar (headings / paragraphs / lists / code / blockquote / hr / table)
  // but without attachment resolution (notes have no on-disk attachment story
  // in this builder). Inline images degrade to a text marker.

  function renderNoteInline(
    tokens: Token[] | undefined,
    keyPrefix: string,
  ): React.ReactNode[] {
    if (!tokens || tokens.length === 0) return [];
    return tokens.map((tok, i) => {
      const key = `${keyPrefix}-i${i}`;
      const t = tok as Token;
      switch (t.type) {
        case "text": {
          const tt = t as Tokens.Text;
          if (tt.tokens && tt.tokens.length) {
            return h(React.Fragment, { key }, renderNoteInline(tt.tokens, key));
          }
          return tt.text;
        }
        case "strong":
          return h(
            Text,
            { key, style: { fontFamily: "Inter", fontWeight: "bold" } },
            renderNoteInline((t as Tokens.Strong).tokens, key),
          );
        case "em":
          return h(
            Text,
            { key, style: { fontStyle: "italic" } },
            renderNoteInline((t as Tokens.Em).tokens, key),
          );
        case "del":
          return h(
            Text,
            { key, style: { textDecoration: "line-through" } },
            renderNoteInline((t as Tokens.Del).tokens, key),
          );
        case "codespan":
          return h(Text, { key, style: styles.codeInline }, (t as Tokens.Codespan).text);
        case "link": {
          const tt = t as Tokens.Link;
          const inner = tt.tokens && tt.tokens.length
            ? renderNoteInline(tt.tokens, key)
            : [tt.text ?? tt.href];
          // Only follow real URL schemes; bare/relative refs (which in an
          // experiment would resolve to an attachment) render as plain text
          // since notes carry no attachments here.
          if (/^[a-z][a-z0-9+.-]*:/i.test(tt.href)) {
            return h(Link, { key, src: tt.href, style: styles.inlineLink }, ...inner);
          }
          return h(Text, { key }, ...inner);
        }
        case "image":
          return h(
            Text,
            { key, style: { color: "#888", fontStyle: "italic" } },
            `[image: ${(t as Tokens.Image).text || (t as Tokens.Image).href}]`,
          );
        case "br":
          return "\n";
        case "escape":
          return (t as Tokens.Escape).text;
        case "html":
          return (t as Tokens.HTML).text?.replace(/<[^>]+>/g, "") ?? "";
        default: {
          const anyT = t as any;
          return anyT.text ?? anyT.raw ?? "";
        }
      }
    });
  }

  function renderNoteListItem(
    item: Tokens.ListItem,
    keyPrefix: string,
  ): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    item.tokens.forEach((child, ci) => {
      const k = `${keyPrefix}-c${ci}`;
      if (child.type === "text") {
        const tt = child as Tokens.Text;
        out.push(
          h(
            Text,
            { key: k, style: styles.listItemBody },
            ...(tt.tokens && tt.tokens.length ? renderNoteInline(tt.tokens, k) : [tt.text]),
          ),
        );
        return;
      }
      if (child.type === "list") {
        out.push(
          h(
            View,
            { key: k, style: { marginLeft: 12, marginTop: 2 } },
            ...renderNoteBlock([child as Token], k),
          ),
        );
        return;
      }
      out.push(...renderNoteBlock([child as Token], k));
    });
    return out;
  }

  function renderNoteBlock(tokens: Token[], keyPrefix: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    tokens.forEach((tok, i) => {
      const key = `${keyPrefix}-b${i}`;
      const t = tok as Token;
      switch (t.type) {
        case "space":
          return;
        case "heading": {
          const tt = t as Tokens.Heading;
          const style = tt.depth <= 2 ? styles.h2 : tt.depth === 3 ? styles.h3 : styles.h4;
          out.push(h(Text, { key, style }, ...renderNoteInline(tt.tokens, key)));
          return;
        }
        case "paragraph": {
          const tt = t as Tokens.Paragraph;
          out.push(
            h(Text, { key, style: styles.paragraph }, ...renderNoteInline(tt.tokens, key)),
          );
          return;
        }
        case "list": {
          const tt = t as Tokens.List;
          out.push(
            h(
              View,
              { key, style: { marginBottom: 8 } },
              ...tt.items.map((li, j) => {
                const k = `${key}-i${j}`;
                const start = typeof tt.start === "number" ? tt.start : 1;
                let bullet: string;
                if (li.task) bullet = li.checked ? "[x]" : "[ ]";
                else if (tt.ordered) bullet = `${start + j}.`;
                else bullet = "-";
                return h(
                  View,
                  { key: k, style: styles.listRow },
                  h(Text, { style: styles.listBullet }, bullet),
                  h(View, { style: { flex: 1 } }, ...renderNoteListItem(li, k)),
                );
              }),
            ),
          );
          return;
        }
        case "code":
          out.push(
            h(
              View,
              { key, style: styles.codeBlock, wrap: false },
              h(Text, null, (t as Tokens.Code).text),
            ),
          );
          return;
        case "blockquote":
          out.push(
            h(
              View,
              { key, style: styles.blockquote },
              ...renderNoteBlock((t as Tokens.Blockquote).tokens, key),
            ),
          );
          return;
        case "hr":
          out.push(h(View, { key, style: styles.hr }));
          return;
        case "table": {
          const tt = t as Tokens.Table;
          out.push(
            h(
              View,
              { key, style: { marginBottom: 10 }, wrap: false },
              h(
                View,
                { style: styles.tableRow },
                ...tt.header.map((cell, c) =>
                  h(
                    Text,
                    { key: `${key}-h${c}`, style: styles.tableCellHeader },
                    ...renderNoteInline(cell.tokens, `${key}-h${c}`),
                  ),
                ),
              ),
              ...tt.rows.map((row, r) =>
                h(
                  View,
                  { key: `${key}-r${r}`, style: styles.tableRow },
                  ...row.map((cell, c) =>
                    h(
                      Text,
                      { key: `${key}-r${r}c${c}`, style: styles.tableCell },
                      ...renderNoteInline(cell.tokens, `${key}-r${r}c${c}`),
                    ),
                  ),
                ),
              ),
            ),
          );
          return;
        }
        case "html": {
          const stripped = (t as Tokens.HTML).raw.replace(/<[^>]+>/g, "").trim();
          if (stripped) out.push(h(Text, { key, style: styles.paragraph }, stripped));
          return;
        }
        default: {
          const anyT = t as any;
          if (anyT.text) out.push(h(Text, { key, style: styles.paragraph }, anyT.text));
        }
      }
    });
    return out;
  }

  function renderNoteMarkdown(md: string, keyPrefix: string): React.ReactNode[] {
    if (!md.trim()) return [];
    let tokens: Token[];
    try {
      tokens = marked.lexer(md);
    } catch (err) {
      console.warn("[export/combined-pdf] note markdown lex failed", err);
      return [h(Text, { key: `${keyPrefix}-raw`, style: styles.paragraph }, md)];
    }
    return renderNoteBlock(tokens, keyPrefix);
  }

  // ── Per-item section assembly ───────────────────────────────────────────────

  function BackToIndexLink({ keyId }: { keyId: string }) {
    return h(
      Link,
      { key: keyId, src: `#${INDEX_ANCHOR}`, style: styles.backToIndex },
      "Back to index",
    );
  }

  // One experiment: a heading + bookmarked anchor target, the "Back to index"
  // link, then the EXISTING experiment section renderers (reused, namespaced).
  function ExperimentItemPage(exp: ResolvedExperiment) {
    const anchorId = itemAnchorId({ kind: "experiment", id: exp.id });
    const safeExpTitle = sanitizeForExport(exp.title);
    const parts = buildExperimentParts(ReactPDF, exp.payload, `${anchorId}-`);
    return h(
      Page,
      { key: anchorId, size: "A4", style: styles.page, wrap: true },
      h(
        SectionView,
        // bookmark.title goes into the PDF outline (not JSX-escaped) -- sanitize.
        { id: anchorId, bookmark: { title: `Experiment: ${safeExpTitle}`, fit: true } },
        h(Text, { style: styles.itemKindLabel }, "Experiment"),
        h(Text, { style: styles.itemHeading }, safeExpTitle),
        h(BackToIndexLink, { keyId: `${anchorId}-back` }),
      ),
      ...parts.contentChildren,
    );
  }

  // One note: a heading + bookmarked anchor target, "Back to index", the
  // optional description, then each entry rendered from its markdown body.
  function NoteItemPage(noteItem: ResolvedNote) {
    const anchorId = itemAnchorId({ kind: "note", id: noteItem.id });
    const safeNoteTitle = sanitizeForExport(noteItem.title);
    const note = noteItem.note;
    const entries = [...(note.entries ?? [])].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const body: React.ReactNode[] = [];
    if (note.description && note.description.trim()) {
      body.push(
        ...renderNoteMarkdown(note.description, `${anchorId}-desc`).map((node, i) =>
          React.isValidElement(node)
            ? React.cloneElement(node as React.ReactElement, { key: `${anchorId}-desc-${i}` })
            : node,
        ),
      );
    }
    entries.forEach((entry, ei) => {
      const ek = `${anchorId}-e${ei}`;
      body.push(
        h(
          SectionView,
          { key: ek, style: styles.sectionWrap },
          h(Text, { style: styles.h2 }, entry.title || "(untitled entry)"),
          entry.date ? h(Text, { style: styles.noteEntryDate }, entry.date) : null,
          ...renderNoteMarkdown(entry.content ?? "", `${ek}-c`),
        ),
      );
    });
    if (body.length === 0) {
      body.push(
        h(
          Text,
          { key: `${anchorId}-empty`, style: styles.noteDescription },
          "(This note has no content.)",
        ),
      );
    }
    return h(
      Page,
      { key: anchorId, size: "A4", style: styles.page, wrap: true },
      h(
        SectionView,
        { id: anchorId, bookmark: { title: `Note: ${safeNoteTitle}`, fit: true } },
        h(Text, { style: styles.itemKindLabel }, "Note"),
        h(Text, { style: styles.itemHeading }, safeNoteTitle),
        h(BackToIndexLink, { keyId: `${anchorId}-back` }),
      ),
      ...body,
    );
  }

  // ── Cover + index pages ─────────────────────────────────────────────────────

  function MetaRow({ label, value }: { label: string; value: string }) {
    return h(
      Text,
      { style: styles.metaRow },
      h(Text, { style: styles.metaLabel }, `${label.padEnd(12, " ")} `),
      value,
    );
  }

  const CoverPage = () =>
    h(
      Page,
      { size: "A4", style: styles.page },
      h(Text, { style: styles.coverTitle }, safeTitle),
      h(MetaRow, { label: "Owner:", value: safeOwner }),
      h(MetaRow, {
        label: "Items:",
        value: `${resolvedItems.length} (${experiments.length} experiment${
          experiments.length === 1 ? "" : "s"
        }, ${notes.length} note${notes.length === 1 ? "" : "s"})`,
      }),
      h(MetaRow, { label: "Date:", value: exportedAt.slice(0, 10) }),
      h(
        Text,
        { style: styles.generatedNote },
        `Generated:  ${exportedAt} by ResearchOS`,
      ),
    );

  // The index/"key" page. Bookmarked + anchored at INDEX_ANCHOR so every
  // per-item "Back to index" link returns here. Entries are grouped
  // Experiments then Notes, each a clickable internal Link to its section.
  const IndexPage = () => {
    const groups: React.ReactNode[] = [];
    if (experiments.length) {
      groups.push(
        h(Text, { key: "g-exp", style: styles.indexGroupHeading }, "Experiments"),
        ...experiments.map((exp) =>
          h(
            Link,
            {
              key: `idx-${itemAnchorId(exp)}`,
              src: `#${itemAnchorId(exp)}`,
              style: styles.indexEntry,
            },
            sanitizeForExport(exp.title),
          ),
        ),
      );
    }
    if (notes.length) {
      groups.push(
        h(Text, { key: "g-note", style: styles.indexGroupHeading }, "Notes"),
        ...notes.map((noteItem) =>
          h(
            Link,
            {
              key: `idx-${itemAnchorId(noteItem)}`,
              src: `#${itemAnchorId(noteItem)}`,
              style: styles.indexEntry,
            },
            sanitizeForExport(noteItem.title),
          ),
        ),
      );
    }
    if (!groups.length) {
      groups.push(
        h(Text, { key: "idx-empty", style: styles.indexEmpty }, "No items to export."),
      );
    }
    return h(
      Page,
      { size: "A4", style: styles.page },
      h(
        SectionView,
        { id: INDEX_ANCHOR, bookmark: { title: "Index", fit: true } },
        h(Text, { style: styles.indexTitle }, "Index"),
      ),
      ...groups,
    );
  };

  // ── Assemble the document ────────────────────────────────────────────────────
  //
  // Render in selection order so the body matches what the user picked; the
  // index page itself groups by type for scanability. `void Document` is just
  // to keep the destructured component referenced if a future edit drops it.

  const itemPages: React.ReactNode[] = resolvedItems.map((r) =>
    r.kind === "experiment" ? ExperimentItemPage(r) : NoteItemPage(r),
  );

  // Sanitize user-supplied strings that go into PDF metadata (not JSX-escaped by
  // the renderer -- they land in PDF dict entries as raw strings).
  const safeTitle = sanitizeForExport(input.title || "Combined export");
  const safeOwner = sanitizeForExport(ownerLabel || "");

  const docTree = h(
    Document,
    {
      title: safeTitle,
      author: safeOwner,
      subject: safeTitle,
      creator: "ResearchOS",
      producer: "ResearchOS",
      creationDate: new Date(exportedAt),
    },
    h(CoverPage, { key: "cover" }),
    h(IndexPage, { key: "index" }),
    ...itemPages,
  );

  return pdf(docTree).toBlob();
}
