/**
 * HTML format generator for the export rewrite.
 *
 * Produces a `.zip` containing a single self-contained `{slug}.html` plus an
 * `attachments/{Notes,Results,Methods}/` tree. Images referenced in notes /
 * results markdown are base64-inlined into the HTML so the document renders
 * standalone; file refs and PDF methods point at the in-zip sibling files
 * (which is why HTML is bundled as a zip — see EXPORT_REVAMP_PLAN.md §3).
 *
 * Owned by Sub-bot C on the export-revamp branch. Do not import types from
 * this file outside `frontend/src/lib/export/`; once Sub-bot A's `types.ts`
 * lands, the local TODO-flagged declarations below get swapped out at
 * integration time.
 */

import { marked } from "marked";
import JSZip from "jszip";

// ─────────────────────────────────────────────────────────────────────────────
// Type contract — TODO: replace with `import type { ... } from "./types"`
// once Sub-bot A lands `frontend/src/lib/export/types.ts`. These local
// declarations mirror EXPORT_REVAMP_PLAN.md §4. Inlined here only because
// Sub-bot C's scope forbids creating other `lib/export/*.ts` files.
// ─────────────────────────────────────────────────────────────────────────────

type AttachmentOrigin = "notes" | "results" | "methods";

interface ExperimentAttachment {
  filename: string;
  mimeType: string;
  bytes: ArrayBuffer;
  origin: AttachmentOrigin;
  diskRef: string;
}

interface MethodLike {
  id: number;
  name: string;
  method_type: "markdown" | "pdf" | "pcr" | null;
}

interface TaskMethodAttachmentLike {
  method_id: number;
  variation_notes: string | null;
  pcr_gradient: string | null;
  pcr_ingredients: string | null;
}

interface MethodPayload {
  method: MethodLike;
  bodyMarkdown: string | null;
  attachment: TaskMethodAttachmentLike | null;
}

interface SubTaskLike {
  id: string;
  text: string;
  is_complete: boolean;
}

interface TaskLike {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  is_complete: boolean;
  owner: string;
  method_ids: number[];
  deviation_log: string | null;
  sub_tasks: SubTaskLike[] | null;
}

interface ProjectLike {
  id: number;
  name: string;
}

export interface ExperimentExportPayload {
  task: TaskLike;
  project: ProjectLike;
  resolvedBase: string;
  notesMarkdown: string | null;
  resultsMarkdown: string | null;
  methods: MethodPayload[];
  attachments: ExperimentAttachment[];
  meta: {
    ownerLabel: string;
    durationDays: number;
    statusLabel: string;
    methodNames: string[];
    exportedAt: string;
  };
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local fallbacks for helpers Sub-bot A owns — TODO: replace with imports
// from `./slug` and `./markdown` once those land.
// ─────────────────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  const cleaned = (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "experiment").slice(0, 80).replace(/-+$/g, "") || "experiment";
}

function extractUserContent(content: string | null | undefined): string {
  if (!content) return "";
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*#\s+(?:Lab Notes|Results):.*$/im, "")
    .trim();
}

function hasUserContent(content: string | null | undefined): boolean {
  return extractUserContent(content).length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT = "#3b82f6";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

// Mirrors the basename-extraction in `lib/attachments/gc.ts:49` — strip a
// CommonMark title, angle brackets, leading `./`, query/anchor noise, then
// take the last `/`-separated segment.
function cleanAndBasename(rawUrl: string): { basename: string; clean: string } | null {
  let src = rawUrl.trim();
  const titleMatch = src.match(/^(.+?)\s+["'].*["']\s*$/);
  if (titleMatch) src = titleMatch[1].trim();
  if (src.startsWith("<") && src.endsWith(">")) src = src.slice(1, -1);
  if (src.startsWith("./")) src = src.slice(2);
  const trimmed = src.split("#")[0].split("?")[0];
  const segments = trimmed.split("/").filter(Boolean);
  const basename = segments[segments.length - 1];
  return basename ? { basename, clean: trimmed } : null;
}

function originFolder(origin: AttachmentOrigin): "Notes" | "Results" | "Methods" {
  if (origin === "notes") return "Notes";
  if (origin === "results") return "Results";
  return "Methods";
}

function findAttachment(
  attachments: ExperimentAttachment[],
  origin: AttachmentOrigin,
  basename: string,
): ExperimentAttachment | undefined {
  return attachments.find((a) => a.origin === origin && a.filename === basename);
}

/**
 * Rewrite markdown refs in a notes/results body before passing to `marked`.
 * Images become inline `<img src="data:…">` (so the HTML renders standalone);
 * file refs become `<a href="attachments/{Notes|Results}/foo.pdf" download>`.
 *
 * TODO: when Sub-bot A's `./markdown.ts` lands `rewriteMarkdownRefs`, prefer
 * that — this is the regex-based fallback per the brief.
 */
function rewriteMarkdownRefs(
  markdown: string,
  origin: "notes" | "results",
  attachments: ExperimentAttachment[],
): string {
  const folder = originFolder(origin);

  let out = markdown.replace(
    /!\[([^\]]*)\]\(([^)\n]+?)\)/g,
    (whole, alt: string, url: string) => {
      const parsed = cleanAndBasename(url);
      if (!parsed || !parsed.clean.includes("Images/")) return whole;
      const safeAlt = escapeHtml(alt);
      const att = findAttachment(attachments, origin, parsed.basename);
      if (att) {
        const b64 = arrayBufferToBase64(att.bytes);
        return `<img src="data:${att.mimeType};base64,${b64}" alt="${safeAlt}">`;
      }
      return `<img src="attachments/${folder}/${encodeURIComponent(parsed.basename)}" alt="${safeAlt}">`;
    },
  );

  out = out.replace(
    /(?<!!)\[([^\]]*)\]\(([^)\n]+?)\)/g,
    (whole, label: string, url: string) => {
      const parsed = cleanAndBasename(url);
      if (!parsed || !parsed.clean.includes("Files/")) return whole;
      return `<a href="attachments/${folder}/${encodeURIComponent(parsed.basename)}" download>${escapeHtml(label)}</a>`;
    },
  );

  return out;
}

function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { gfm: true, async: false }) as string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────

function buildStyles(): string {
  return `
    :root { --accent: ${ACCENT}; --fg: #1f2937; --muted: #6b7280; --rule: #e5e7eb; --bg: #ffffff; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      padding: 2.5rem 1.5rem 3rem;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    h1 { font-size: 2.25rem; margin: 0 0 0.5rem; line-height: 1.2; color: var(--fg); }
    h2 {
      font-size: 1.5rem; margin: 2.5rem 0 1rem; padding-bottom: 0.4rem;
      color: var(--accent); border-bottom: 1px solid var(--rule);
    }
    h3 { font-size: 1.15rem; margin: 1.75rem 0 0.5rem; color: var(--fg); }
    h4 { font-size: 1rem; margin: 1.25rem 0 0.4rem; color: var(--muted); }
    p { margin: 0.75rem 0; }
    img { max-width: 100%; height: auto; border-radius: 4px; }
    code { background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.92em; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 6px; overflow-x: auto; }
    pre code { background: transparent; padding: 0; }
    blockquote {
      border-left: 3px solid var(--accent); margin: 1rem 0; padding: 0.25rem 1rem;
      color: var(--muted); background: #f9fafb;
    }
    table { border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid var(--rule); padding: 0.5rem 0.75rem; }
    th { background: #f9fafb; text-align: left; }
    hr { border: 0; border-top: 1px solid var(--rule); margin: 2rem 0; }

    .title-page { max-width: 800px; margin: 0 auto 2rem; padding-bottom: 1.5rem; border-bottom: 2px solid var(--rule); }
    dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1.25rem; margin: 1rem 0 0; }
    dl.meta dt { color: var(--muted); font-weight: 500; }
    dl.meta dd { margin: 0; }

    .layout { max-width: 1200px; margin: 0 auto; }
    .layout main { max-width: 800px; margin: 0 auto; }
    nav.toc {
      background: #f9fafb; border: 1px solid var(--rule); border-radius: 8px;
      padding: 1rem 1.25rem; margin: 0 auto 2.5rem; max-width: 800px;
    }
    nav.toc h2 { font-size: 0.85rem; margin: 0 0 0.6rem; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.04em; border: none; padding: 0; }
    nav.toc ol { margin: 0; padding-left: 1.25rem; }
    nav.toc li { margin: 0.2rem 0; }

    .variation-notes {
      background: #fffbeb; border-left: 3px solid #f59e0b; padding: 0.5rem 1rem;
      margin: 0.75rem 0 1.5rem; border-radius: 0 4px 4px 0;
    }
    .variation-notes h4 { margin: 0 0 0.3rem; color: #92400e; text-transform: none; }
    .method-block { margin-bottom: 2rem; }
    .method-file-link { font-size: 0.95rem; color: var(--muted); }

    ul.subtasks { list-style: none; padding-left: 0.25rem; }
    ul.subtasks li { margin: 0.3rem 0; }
    ul.subtasks .box { display: inline-block; width: 1.25em; color: var(--accent); font-family: ui-monospace, SFMono-Regular, monospace; }
    ul.subtasks .done { color: var(--muted); text-decoration: line-through; }

    footer.export-meta {
      margin-top: 4rem; padding-top: 1rem; border-top: 1px solid var(--rule);
      color: var(--muted); font-size: 0.85rem; text-align: center;
    }

    @media (min-width: 1200px) {
      .layout {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr);
        gap: 3rem;
        align-items: start;
      }
      .layout nav.toc { position: sticky; top: 2rem; margin: 0; max-width: none; }
      .layout main { max-width: 800px; margin: 0; }
    }

    @media print {
      nav.toc { display: none; }
      .layout { display: block; }
      .layout main { max-width: none; margin: 0; }
      body { padding: 0.5in; font-size: 11pt; }
      a { color: var(--fg); text-decoration: none; }
      h2 { break-after: avoid; }
    }
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────────────────

interface NavEntry {
  id: string;
  label: string;
}

function buildTitlePage(payload: ExperimentExportPayload): string {
  const m = payload.meta;
  const methodsLabel =
    m.methodNames.length > 0 ? m.methodNames.map(escapeHtml).join(", ") : "—";
  return `<header class="title-page">
  <h1>${escapeHtml(payload.task.name)}</h1>
  <dl class="meta">
    <dt>Project:</dt><dd>${escapeHtml(payload.project.name)}</dd>
    <dt>Owner:</dt><dd>${escapeHtml(m.ownerLabel)}</dd>
    <dt>Date range:</dt><dd>${escapeHtml(payload.task.start_date)} → ${escapeHtml(payload.task.end_date)}</dd>
    <dt>Duration:</dt><dd>${m.durationDays} day(s)</dd>
    <dt>Status:</dt><dd>${escapeHtml(m.statusLabel)}</dd>
    <dt>Methods:</dt><dd>${methodsLabel}</dd>
  </dl>
</header>`;
}

function buildNav(entries: NavEntry[]): string {
  if (entries.length === 0) return "";
  const items = entries
    .map((e) => `<li><a href="#${e.id}">${escapeHtml(e.label)}</a></li>`)
    .join("");
  return `<nav class="toc"><h2>Contents</h2><ol>${items}</ol></nav>`;
}

function buildLabNotesSection(payload: ExperimentExportPayload): string {
  if (!hasUserContent(payload.notesMarkdown)) return "";
  const md = extractUserContent(payload.notesMarkdown);
  const rewritten = rewriteMarkdownRefs(md, "notes", payload.attachments);
  const body = renderMarkdown(rewritten);
  return `<section id="section-labnotes"><h2>Lab Notes</h2>${body}</section>`;
}

function buildResultsSection(payload: ExperimentExportPayload): string {
  if (!hasUserContent(payload.resultsMarkdown)) return "";
  const md = extractUserContent(payload.resultsMarkdown);
  const rewritten = rewriteMarkdownRefs(md, "results", payload.attachments);
  const body = renderMarkdown(rewritten);
  return `<section id="section-results"><h2>Results</h2>${body}</section>`;
}

// PDF-method attachment lookup: prefer a name-based match when possible
// (Sub-bot A's `extract.ts` should set `diskRef` so we can pin a PDF method
// to its Method record; until that exact convention lands, fall back to
// matching the method's name against each candidate filename and finally to
// any single remaining methods-origin attachment).
function findMethodPdfAttachment(
  method: MethodLike,
  attachments: ExperimentAttachment[],
  consumed: Set<string>,
): ExperimentAttachment | undefined {
  const candidates = attachments.filter(
    (a) => a.origin === "methods" && !consumed.has(a.filename),
  );
  if (candidates.length === 0) return undefined;
  const slug = slugify(method.name);
  const byName = candidates.find((a) => slugify(a.filename).includes(slug) && slug.length > 0);
  return byName ?? candidates[0];
}

function buildMethodBlock(
  mp: MethodPayload,
  attachments: ExperimentAttachment[],
  consumed: Set<string>,
): string {
  const id = `section-methods-${mp.method.id}`;
  const name = escapeHtml(mp.method.name || "Untitled Method");
  let body = "";

  if (mp.method.method_type === "markdown" && mp.bodyMarkdown) {
    const md = extractUserContent(mp.bodyMarkdown);
    body = renderMarkdown(md);
  } else if (mp.method.method_type === "pdf") {
    const att = findMethodPdfAttachment(mp.method, attachments, consumed);
    if (att) {
      consumed.add(att.filename);
      body = `<h4>PDF Method: ${escapeHtml(att.filename)}</h4>
<p class="method-file-link"><a href="attachments/Methods/${encodeURIComponent(att.filename)}" download>Open ${escapeHtml(att.filename)}</a></p>`;
    } else {
      body = `<p class="method-file-link">PDF method file is not bundled with this export.</p>`;
    }
  } else if (mp.method.method_type === "pcr") {
    // Placeholder per brief — PCR table rendering improved later. For now,
    // surface the method record so the reader knows it exists.
    body = `<p class="method-file-link">PCR Method (table rendering pending; see method record <code>${escapeHtml(String(mp.method.id))}</code> in ResearchOS).</p>`;
  } else {
    body = `<p class="method-file-link">No method body available.</p>`;
  }

  let variationBlock = "";
  if (mp.attachment?.variation_notes?.trim()) {
    const variation = renderMarkdown(extractUserContent(mp.attachment.variation_notes));
    variationBlock = `<div class="variation-notes"><h4>Variation notes for this task</h4>${variation}</div>`;
  }

  return `<section id="${id}" class="method-block"><h3>${name}</h3>${body}${variationBlock}</section>`;
}

function buildMethodsSection(payload: ExperimentExportPayload): string {
  if (payload.methods.length === 0) return "";
  const consumed = new Set<string>();
  const blocks = payload.methods
    .map((m) => buildMethodBlock(m, payload.attachments, consumed))
    .join("");
  return `<section id="section-methods-wrapper"><h2>Methods</h2>${blocks}</section>`;
}

function buildSubTasksSection(payload: ExperimentExportPayload): string {
  const subs = payload.task.sub_tasks;
  if (!subs || subs.length === 0) return "";
  const items = subs
    .map((s) => {
      const box = s.is_complete ? "[x]" : "[ ]";
      const cls = s.is_complete ? "done" : "";
      return `<li><span class="box">${box}</span><span class="${cls}">${escapeHtml(s.text)}</span></li>`;
    })
    .join("");
  return `<section id="section-subtasks"><h2>Sub-tasks</h2><ul class="subtasks">${items}</ul></section>`;
}

function buildDeviationSection(payload: ExperimentExportPayload): string {
  const dev = payload.task.deviation_log;
  if (!dev || !dev.trim()) return "";
  const body = renderMarkdown(extractUserContent(dev));
  return `<section id="section-deviation"><h2>Deviation log</h2>${body}</section>`;
}

function buildDocument(payload: ExperimentExportPayload): string {
  const nav: NavEntry[] = [];
  if (hasUserContent(payload.notesMarkdown))
    nav.push({ id: "section-labnotes", label: "Lab Notes" });
  if (hasUserContent(payload.resultsMarkdown))
    nav.push({ id: "section-results", label: "Results" });
  for (const m of payload.methods) {
    nav.push({
      id: `section-methods-${m.method.id}`,
      label: m.method.name || `Method ${m.method.id}`,
    });
  }
  if (payload.task.sub_tasks?.length)
    nav.push({ id: "section-subtasks", label: "Sub-tasks" });
  if (payload.task.deviation_log?.trim())
    nav.push({ id: "section-deviation", label: "Deviation log" });

  const exportedDate = formatDate(payload.meta.exportedAt);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(payload.task.name)}</title>
<style>${buildStyles()}</style>
</head>
<body>
${buildTitlePage(payload)}
<div class="layout">
${buildNav(nav)}
<main>
${buildLabNotesSection(payload)}
${buildResultsSection(payload)}
${buildMethodsSection(payload)}
${buildSubTasksSection(payload)}
${buildDeviationSection(payload)}
<footer class="export-meta">Exported ${escapeHtml(exportedDate)} · Generated by ResearchOS</footer>
</main>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function buildHtmlBundle(
  payload: ExperimentExportPayload,
): Promise<ExportResult> {
  const slug = slugify(payload.task.name);
  const html = buildDocument(payload);

  const zip = new JSZip();
  zip.file(`${slug}.html`, html);

  const attachmentsDir = zip.folder("attachments");
  if (attachmentsDir) {
    for (const att of payload.attachments) {
      const sub = attachmentsDir.folder(originFolder(att.origin));
      sub?.file(att.filename, att.bytes);
    }
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/zip",
  });
  return { blob, filename: `${slug}.zip`, mimeType: "application/zip" };
}
