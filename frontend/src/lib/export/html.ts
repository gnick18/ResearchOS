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

import { slugify } from "./slug";
import { demoteHeadings, extractUserContent, hasUserContent } from "./markdown";
import {
  buildSourceInstance,
  type AttachmentOrigin,
  type ExperimentAttachment,
  type ExperimentExportPayload,
  type ExportResult,
  type HtmlManifest,
  type MethodPayload,
} from "./types";
import type {
  Method,
  PCRCycle,
  PCRGradient,
  PCRIngredient,
  PCRProtocol,
  PCRStep,
} from "@/lib/types";

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

// Basename-extraction helper for inline file/image refs: strip a CommonMark
// title, angle brackets, leading `./`, query/anchor noise, then take the
// last `/`-separated segment.
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
 *
 * Duplicate-image inlining (2026-05-14, sub-bot Tier-3 audit): when the same
 * image bytes appear under both notes/Images/ and results/Images/, this
 * function is called twice (once per section) and emits TWO `<img src="data:…">`
 * tags with identical base64 payloads in the same HTML document. That is
 * intentional: the export's contract is that the .html file renders standalone
 * (no `attachments/` folder needed for images — see the zip-skip at the
 * bottom of buildHtmlBundle), and pulling the byte stream up into a single
 * shared object would break that contract for any reader that only saved the
 * .html. The pre-zip cost is 2x the base64 string per duplicated image, but
 * DEFLATE compression in the zip frame collapses identical runs reasonably
 * well within its 32KB sliding window (less effective for >32KB images, but
 * still nontrivial). If a future change reintroduces per-section attachment
 * folders, prefer pointing both `<img>` tags at a single attachments/ entry
 * over keeping two base64 inlines — but do NOT do both.
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
      // If the body references a file that's no longer on disk (deleted
      // before export), the extractor never picked it up and the <a href>
      // here would point at a missing zip entry. Emit an inline placeholder
      // instead so the broken ref is visible to the reader rather than
      // silently 404'ing on click.
      const att = findAttachment(attachments, origin, parsed.basename);
      if (!att) {
        return `<span class="missing-file">[missing file: ${escapeHtml(parsed.basename)}]</span>`;
      }
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

    table.pcr { width: 100%; border-collapse: collapse; margin: 0.5rem 0 1.25rem; }
    table.pcr th, table.pcr td { border: 1px solid var(--rule); padding: 0.4rem 0.6rem; font-size: 0.95rem; }
    table.pcr th { background: #f9fafb; text-align: left; color: var(--muted); font-weight: 500; }
    table.pcr td.num { text-align: right; font-variant-numeric: tabular-nums; }
    table.pcr tr.cycle-header td {
      background: #eff6ff; color: var(--accent); font-weight: 600;
      border-top: 2px solid var(--accent); border-bottom: 1px solid var(--rule);
    }
    table.pcr tr.cycle-step td:first-child { padding-left: 1.5rem; }
    table.pcr tr.hold td { background: #f9fafb; font-style: italic; }
    p.pcr-notes { color: var(--muted); font-style: italic; margin: 0.5rem 0 1rem; }
    .pcr-deviation { margin-top: 1rem; }
    .pcr-deviation > h4 { color: #92400e; }

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
  const md = demoteHeadings(extractUserContent(payload.notesMarkdown));
  const rewritten = rewriteMarkdownRefs(md, "notes", payload.attachments);
  const body = renderMarkdown(rewritten);
  return `<section id="section-labnotes"><h2>Lab Notes</h2>${body}</section>`;
}

function buildResultsSection(payload: ExperimentExportPayload): string {
  if (!hasUserContent(payload.resultsMarkdown)) return "";
  const md = demoteHeadings(extractUserContent(payload.resultsMarkdown));
  const rewritten = rewriteMarkdownRefs(md, "results", payload.attachments);
  const body = renderMarkdown(rewritten);
  return `<section id="section-results"><h2>Results</h2>${body}</section>`;
}

// PDF-method attachment lookup via methodId — the extractor stamps
// `methodId` on every methods-origin push, so this is a clean id match.
function findMethodPdfAttachment(
  method: Method,
  attachments: ExperimentAttachment[],
): ExperimentAttachment | undefined {
  return attachments.find(
    (a) => a.origin === "methods" && a.methodId === method.id,
  );
}

// ── PCR rendering ────────────────────────────────────────────────────────────

function formatTemperature(t: number): string {
  return `${t}°C`;
}

function renderPcrStepRow(step: PCRStep, rowClass: string): string {
  return `<tr class="${rowClass}">
<td>${escapeHtml(step.name)}</td>
<td class="num">${formatTemperature(step.temperature)}</td>
<td>${escapeHtml(step.duration)}</td>
</tr>`;
}

function renderPcrGradientTable(gradient: PCRGradient): string {
  const rows: string[] = [];
  for (const s of gradient.initial) rows.push(renderPcrStepRow(s, "step"));
  gradient.cycles.forEach((cycle: PCRCycle, idx: number) => {
    const repeats = Number.isFinite(cycle.repeats) ? cycle.repeats : 1;
    rows.push(
      `<tr class="cycle-header"><td colspan="3">Cycle ${idx + 1} — ${repeats}×</td></tr>`,
    );
    for (const s of cycle.steps) rows.push(renderPcrStepRow(s, "cycle-step"));
  });
  for (const s of gradient.final) rows.push(renderPcrStepRow(s, "step"));
  if (gradient.hold) rows.push(renderPcrStepRow(gradient.hold, "hold"));
  return `<table class="pcr">
<thead><tr><th>Step</th><th>Temperature</th><th>Duration</th></tr></thead>
<tbody>${rows.join("")}</tbody>
</table>`;
}

function renderPcrIngredientsTable(ingredients: PCRIngredient[]): string {
  if (ingredients.length === 0) {
    return `<p class="method-file-link">No reagents recorded for this protocol.</p>`;
  }
  const rows = ingredients
    .map(
      (i) => `<tr>
<td>${escapeHtml(i.name)}</td>
<td>${escapeHtml(i.concentration)}</td>
<td class="num">${escapeHtml(i.amount_per_reaction)} μL</td>
</tr>`,
    )
    .join("");
  return `<table class="pcr">
<thead><tr><th>Reagent</th><th>Concentration</th><th>Volume / reaction</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function parseGradientOverride(json: string): PCRGradient | null {
  try {
    const parsed = JSON.parse(json) as PCRGradient;
    if (parsed && Array.isArray(parsed.initial) && Array.isArray(parsed.cycles) && Array.isArray(parsed.final)) {
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

function buildPcrMethodBody(mp: MethodPayload): string {
  const protocol: PCRProtocol | null = mp.pcrProtocol ?? null;
  if (!protocol) {
    return `<p class="method-file-link">PCR Method (protocol could not be loaded).</p>`;
  }

  const parts: string[] = [];
  parts.push(`<h4>Thermocycler program</h4>`);
  parts.push(renderPcrGradientTable(protocol.gradient));
  parts.push(`<h4>Reagents</h4>`);
  parts.push(renderPcrIngredientsTable(protocol.ingredients));
  if (protocol.notes && protocol.notes.trim()) {
    parts.push(`<p class="pcr-notes">${escapeHtml(protocol.notes.trim())}</p>`);
  }

  const att = mp.attachment;
  if (att?.pcr_gradient && att.pcr_gradient.trim()) {
    const override = parseGradientOverride(att.pcr_gradient);
    if (override) {
      parts.push(
        `<div class="pcr-deviation"><h4>Gradient deviations for this task</h4>${renderPcrGradientTable(override)}</div>`,
      );
    }
  }
  if (att?.pcr_ingredients && att.pcr_ingredients.trim()) {
    const override = parseIngredientsOverride(att.pcr_ingredients);
    if (override) {
      parts.push(
        `<div class="pcr-deviation"><h4>Reagent deviations for this task</h4>${renderPcrIngredientsTable(override)}</div>`,
      );
    }
  }

  return parts.join("");
}

function buildLcGradientMethodBody(mp: MethodPayload): string {
  const protocol = mp.lcGradientProtocol ?? null;
  if (!protocol) {
    return `<p class="method-file-link">LC Gradient Method (protocol could not be loaded).</p>`;
  }
  // The per-task snapshot lives on attachment.lc_gradient as a JSON-stringified
  // LCGradientProtocol. When present, render it INSTEAD of the source — LC
  // doesn't split source-vs-override across fields the way PCR does (PCR has
  // a separate gradient field and ingredients field). For LC the snapshot is
  // the whole protocol, so a render of just the source would lie to the
  // reader if a snapshot exists.
  let effective = protocol;
  const att = mp.attachment;
  if (att?.lc_gradient && att.lc_gradient.trim()) {
    try {
      const parsed = JSON.parse(att.lc_gradient);
      if (parsed && typeof parsed === "object") {
        effective = { ...protocol, ...parsed };
      }
    } catch {
      // Fall back to source if the snapshot was corrupted.
    }
  }

  const parts: string[] = [];
  parts.push(`<h4>Gradient steps</h4>`);
  parts.push(renderLcSteps(effective));
  parts.push(`<h4>Column &amp; detection</h4>`);
  parts.push(renderLcColumn(effective));
  parts.push(`<h4>Ingredients</h4>`);
  parts.push(renderLcIngredients(effective));
  if (effective.description && effective.description.trim()) {
    parts.push(`<p class="lc-notes">${escapeHtml(effective.description.trim())}</p>`);
  }
  if (att?.lc_gradient && att.lc_gradient.trim()) {
    parts.push(
      `<p class="lc-deviation-note"><em>Note:</em> the values above reflect per-task snapshot overrides written on this experiment, not the original source protocol.</p>`,
    );
  }
  return parts.join("");
}

function renderLcSteps(p: { gradient_steps?: Array<{ time_min: number; percent_a: number; percent_b: number; flow_ml_min: number }> }): string {
  const steps = p.gradient_steps ?? [];
  if (steps.length === 0) return `<p>No gradient steps.</p>`;
  const rows = steps
    .map(
      (s) =>
        `<tr><td>${s.time_min}</td><td>${s.percent_a}</td><td>${s.percent_b}</td><td>${s.flow_ml_min}</td></tr>`,
    )
    .join("");
  return `<table class="lc-table"><thead><tr><th>Time (min)</th><th>% A</th><th>% B</th><th>Flow (mL/min)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderLcColumn(p: {
  column?: { manufacturer?: string | null; model?: string | null; length_mm?: number | null; inner_diameter_mm?: number | null; particle_size_um?: number | null };
  detection_wavelength_nm?: number | null;
}): string {
  const c = p.column ?? {};
  const rows: string[] = [];
  const pushRow = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    rows.push(`<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`);
  };
  pushRow("Manufacturer", c.manufacturer);
  pushRow("Model", c.model);
  pushRow("Length (mm)", c.length_mm);
  pushRow("Inner diameter (mm)", c.inner_diameter_mm);
  pushRow("Particle size (µm)", c.particle_size_um);
  pushRow("Detection wavelength (nm)", p.detection_wavelength_nm);
  if (rows.length === 0) return `<p>No column information recorded.</p>`;
  return `<table class="lc-column"><tbody>${rows.join("")}</tbody></table>`;
}

function renderLcIngredients(p: {
  ingredients?: Array<{ name: string; role: string; concentration?: string; notes?: string }>;
}): string {
  const ingredients = p.ingredients ?? [];
  if (ingredients.length === 0) return `<p>No ingredients listed.</p>`;
  const ROLE_LABELS: Record<string, string> = {
    solvent_a: "Solvent A",
    solvent_b: "Solvent B",
    buffer: "Buffer",
    additive: "Additive",
  };
  const rows = ingredients
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(ROLE_LABELS[i.role] ?? i.role)}</td><td>${escapeHtml(i.concentration ?? "")}</td><td>${escapeHtml(i.notes ?? "")}</td></tr>`,
    )
    .join("");
  return `<table class="lc-ingredients"><thead><tr><th>Name</th><th>Role</th><th>Concentration</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function buildPlateMethodBody(mp: MethodPayload): string {
  const protocol = mp.plateProtocol ?? null;
  if (!protocol) {
    return `<p class="method-file-link">Plate Layout Method (protocol could not be loaded).</p>`;
  }
  // Build a per-well map from the source's region_labels, then layer the
  // attachment snapshot (if any) on top — matches how the runtime tab
  // content reconciles source-vs-snapshot.
  type Well = { role: string; sample_label?: string; custom_label?: string; replicate_index?: number; notes?: string };
  const wells: Record<string, Well> = {};
  const dims = plateDims(protocol.plate_size);
  for (const r of protocol.region_labels ?? []) {
    for (let row = r.row_start; row <= r.row_end; row += 1) {
      for (let col = r.col_start; col <= r.col_end; col += 1) {
        const id = `${String.fromCharCode(65 + row)}${col + 1}`;
        const w: Well = { role: r.role };
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
      // Corrupt snapshot — keep the source-derived map.
    }
  }

  const ROLE_LABELS: Record<string, string> = {
    blank: "Blank",
    sample: "Sample",
    control: "Control",
    na: "N/A",
    custom: "Custom",
  };

  // Render the grid as an HTML table.
  let grid = `<table class="plate-grid"><thead><tr><th></th>`;
  for (let c = 0; c < dims.cols; c += 1) grid += `<th>${c + 1}</th>`;
  grid += `</tr></thead><tbody>`;
  for (let r = 0; r < dims.rows; r += 1) {
    grid += `<tr><th>${String.fromCharCode(65 + r)}</th>`;
    for (let c = 0; c < dims.cols; c += 1) {
      const id = `${String.fromCharCode(65 + r)}${c + 1}`;
      const w = wells[id];
      if (!w) {
        grid += `<td class="plate-well plate-empty" title="${id}"></td>`;
      } else {
        const tipParts = [`${id} — ${ROLE_LABELS[w.role] ?? w.role}`];
        if (w.sample_label) tipParts.push(`Sample: ${w.sample_label}`);
        if (w.custom_label) tipParts.push(`Label: ${w.custom_label}`);
        const tip = escapeHtml(tipParts.join(" · "));
        const cls = `plate-well plate-role-${w.role}`;
        const short =
          w.role === "sample"
            ? "S"
            : w.role === "control"
              ? "C"
              : w.role === "blank"
                ? "B"
                : w.role === "na"
                  ? "—"
                  : "?";
        grid += `<td class="${cls}" title="${tip}">${escapeHtml(short)}</td>`;
      }
    }
    grid += `</tr>`;
  }
  grid += `</tbody></table>`;

  // Annotation summary table.
  const counts: Record<string, number> = { blank: 0, sample: 0, control: 0, na: 0, custom: 0 };
  for (const w of Object.values(wells)) counts[w.role] = (counts[w.role] ?? 0) + 1;
  const summaryRows = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(
      ([role, n]) =>
        `<tr><td>${escapeHtml(ROLE_LABELS[role] ?? role)}</td><td>${n}</td></tr>`,
    )
    .join("");

  const parts: string[] = [];
  parts.push(`<h4>Plate layout (${protocol.plate_size}-well)</h4>`);
  parts.push(grid);
  if (summaryRows) {
    parts.push(
      `<table class="plate-summary"><thead><tr><th>Role</th><th>Wells</th></tr></thead><tbody>${summaryRows}</tbody></table>`,
    );
  }
  if (protocol.description && protocol.description.trim()) {
    parts.push(`<p class="plate-notes">${escapeHtml(protocol.description.trim())}</p>`);
  }
  if (usedSnapshot) {
    parts.push(
      `<p class="plate-deviation-note"><em>Note:</em> the annotations above include per-task snapshot edits on top of the source plate layout.</p>`,
    );
  }
  return parts.join("");
}

function plateDims(size: number): { rows: number; cols: number } {
  if (size === 12) return { rows: 3, cols: 4 };
  if (size === 24) return { rows: 4, cols: 6 };
  if (size === 48) return { rows: 6, cols: 8 };
  return { rows: 8, cols: 12 };
}

function buildCodingWorkflowMethodBody(mp: MethodPayload): string {
  const cw = mp.codingWorkflow ?? null;
  if (!cw) {
    return `<p class="method-file-link">Coding workflow (could not be loaded).</p>`;
  }
  const parts: string[] = [];
  const langLabel = cw.language === "other"
    ? (cw.language_label?.trim() || "Other")
    : cw.language;
  parts.push(`<p><strong>Language:</strong> ${escapeHtml(langLabel)}</p>`);
  if (cw.description && cw.description.trim()) {
    parts.push(`<p>${escapeHtml(cw.description.trim())}</p>`);
  }
  if (cw.external_path && cw.external_path.trim()) {
    parts.push(
      `<p><strong>External path:</strong> <code>${escapeHtml(cw.external_path.trim())}</code></p>`,
    );
  }
  if (cw.embedded_code && cw.embedded_code.trim()) {
    parts.push(
      `<pre class="coding-workflow-body"><code class="language-${escapeHtml(cw.language)}">${escapeHtml(cw.embedded_code)}</code></pre>`,
    );
  } else if (!cw.external_path) {
    parts.push(`<p>No embedded code or external path provided.</p>`);
  }
  return parts.join("");
}

function buildCellCultureMethodBody(mp: MethodPayload): string {
  const schedule = mp.cellCultureSchedule ?? null;
  if (!schedule) {
    return `<p class="method-file-link">Cell culture passaging method (schedule could not be loaded).</p>`;
  }
  // Per-task snapshot lives on attachment.cell_culture_schedule as a JSON
  // string of CellCultureScheduleInstance. Render planned schedule from the
  // snapshot's overlay (if present), then append the actual events log.
  let plannedEvents = schedule.planned_events ?? [];
  let cellLine = schedule.cell_line ?? {};
  let media = schedule.media ?? {};
  let description: string | null | undefined = schedule.description;
  let actualEvents: Array<{
    timestamp: string;
    event_type: string;
    split_ratio?: string;
    observation_text?: string;
    confluence_percent?: number;
  }> = [];
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

  const parts: string[] = [];
  parts.push(`<h4>Cell line</h4>`);
  parts.push(renderCellCultureCellLine(cellLine));
  parts.push(`<h4>Media</h4>`);
  parts.push(renderCellCultureMedia(media));
  parts.push(`<h4>Planned schedule</h4>`);
  parts.push(renderCellCulturePlannedEvents(plannedEvents));
  if (actualEvents.length > 0) {
    parts.push(`<h4>Actual events (logged on this task)</h4>`);
    parts.push(renderCellCultureActualEvents(actualEvents));
  }
  if (description && description.trim()) {
    parts.push(`<p class="cell-culture-notes">${escapeHtml(description.trim())}</p>`);
  }
  return parts.join("");
}

function renderCellCultureCellLine(c: {
  name?: string | null;
  species?: string | null;
  tissue?: string | null;
  notes?: string | null;
}): string {
  const rows: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    rows.push(`<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`);
  };
  push("Name", c.name);
  push("Species", c.species);
  push("Tissue", c.tissue);
  push("Notes", c.notes);
  if (rows.length === 0) return `<p>No cell line information recorded.</p>`;
  return `<table class="cell-culture-cell-line"><tbody>${rows.join("")}</tbody></table>`;
}

function renderCellCultureMedia(m: {
  base_medium?: string | null;
  serum_percent?: number | null;
  supplements?: Array<{ name: string; concentration: string; units: string }>;
}): string {
  const parts: string[] = [];
  const baseRows: string[] = [];
  if (m.base_medium) {
    baseRows.push(`<tr><th>Base medium</th><td>${escapeHtml(m.base_medium)}</td></tr>`);
  }
  if (m.serum_percent !== null && m.serum_percent !== undefined) {
    baseRows.push(`<tr><th>Serum</th><td>${escapeHtml(String(m.serum_percent))}%</td></tr>`);
  }
  if (baseRows.length > 0) {
    parts.push(`<table class="cell-culture-media"><tbody>${baseRows.join("")}</tbody></table>`);
  }
  const supplements = m.supplements ?? [];
  if (supplements.length > 0) {
    const rows = supplements
      .map(
        (s) =>
          `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.concentration)}</td><td>${escapeHtml(s.units)}</td></tr>`,
      )
      .join("");
    parts.push(
      `<table class="cell-culture-supplements"><thead><tr><th>Supplement</th><th>Concentration</th><th>Units</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
  }
  if (parts.length === 0) return `<p>No media composition recorded.</p>`;
  return parts.join("");
}

function renderCellCulturePlannedEvents(events: Array<{
  day_offset: number;
  event_type: string;
  split_ratio?: string;
  notes?: string;
}>): string {
  if (events.length === 0) return `<p>No planned events.</p>`;
  const EVENT_LABELS: Record<string, string> = {
    feed: "Feed",
    split: "Split",
    observe: "Observe",
    harvest: "Harvest",
  };
  const rows = events
    .map(
      (e) =>
        `<tr><td>D${e.day_offset}</td><td>${escapeHtml(EVENT_LABELS[e.event_type] ?? e.event_type)}</td><td>${escapeHtml(e.split_ratio ?? "")}</td><td>${escapeHtml(e.notes ?? "")}</td></tr>`,
    )
    .join("");
  return `<table class="cell-culture-planned"><thead><tr><th>Day</th><th>Event</th><th>Split ratio</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderCellCultureActualEvents(events: Array<{
  timestamp: string;
  event_type: string;
  split_ratio?: string;
  observation_text?: string;
  confluence_percent?: number;
}>): string {
  if (events.length === 0) return "";
  const EVENT_LABELS: Record<string, string> = {
    feed: "Feed",
    split: "Split",
    observe: "Observe",
    harvest: "Harvest",
  };
  const rows = events
    .map(
      (e) =>
        `<tr><td>${escapeHtml(formatTimestampForDisplay(e.timestamp))}</td><td>${escapeHtml(EVENT_LABELS[e.event_type] ?? e.event_type)}</td><td>${escapeHtml(e.split_ratio ?? "")}</td><td>${e.confluence_percent !== undefined ? escapeHtml(String(e.confluence_percent)) + "%" : ""}</td><td>${escapeHtml(e.observation_text ?? "")}</td></tr>`,
    )
    .join("");
  return `<table class="cell-culture-actual"><thead><tr><th>Timestamp</th><th>Event</th><th>Split ratio</th><th>Confluence</th><th>Observation</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function formatTimestampForDisplay(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function buildMethodBlock(
  mp: MethodPayload,
  attachments: ExperimentAttachment[],
): string {
  const id = `section-methods-${mp.method.id}`;
  const name = escapeHtml(mp.method.name || "Untitled Method");
  let body = "";

  if (mp.method.method_type === "markdown" && mp.bodyMarkdown) {
    const md = demoteHeadings(extractUserContent(mp.bodyMarkdown));
    body = renderMarkdown(md);
  } else if (mp.method.method_type === "pdf") {
    const att = findMethodPdfAttachment(mp.method, attachments);
    if (att) {
      body = `<h4>PDF Method: ${escapeHtml(att.filename)}</h4>
<p class="method-file-link"><a href="attachments/Methods/${encodeURIComponent(att.filename)}" download>Open ${escapeHtml(att.filename)}</a></p>`;
    } else {
      body = `<p class="method-file-link">PDF method file is not bundled with this export.</p>`;
    }
  } else if (mp.method.method_type === "pcr") {
    body = buildPcrMethodBody(mp);
  } else if (mp.method.method_type === "lc_gradient") {
    body = buildLcGradientMethodBody(mp);
  } else if (mp.method.method_type === "plate") {
    body = buildPlateMethodBody(mp);
  } else if (mp.method.method_type === "cell_culture") {
    body = buildCellCultureMethodBody(mp);
  } else if (mp.method.method_type === "coding_workflow") {
    body = buildCodingWorkflowMethodBody(mp);
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
  const blocks = payload.methods
    .map((m) => buildMethodBlock(m, payload.attachments))
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
  baseFilename?: string,
): Promise<ExportResult> {
  const slug = baseFilename ?? slugify(payload.task.name);
  const html = buildDocument(payload);

  const zip = new JSZip();
  zip.file(`${slug}.html`, html);

  // Provenance marker: a tiny manifest alongside the HTML so downstream
  // tools can detect "this came from a ResearchOS export" without sniffing
  // file structure. Field names mirror Raw's `_export-manifest.json`
  // (raw.ts ~line 16) where they overlap.
  const manifest: HtmlManifest = {
    format: "html",
    version: 1,
    exported_at: payload.meta.exportedAt,
    source_owner: payload.task.owner,
    source_instance: buildSourceInstance(
      payload.meta.ownerLabel,
      payload.meta.exportedAt,
    ),
    task_id: payload.task.id,
  };
  zip.file("_export-manifest.json", JSON.stringify(manifest, null, 2));

  // Image attachments are already base64-inlined into the HTML via
  // rewriteMarkdownRefs (`html.ts` ~line 110). Copying them again under
  // attachments/{Notes,Results}/ wastes bytes (a 148KB PNG becomes ~700KB
  // of bundle for nothing) and the HTML never references those copies.
  // Skip images; keep file attachments + method PDFs since the HTML links
  // out to those.
  const filesOnly = payload.attachments.filter(
    (a) => !a.mimeType.toLowerCase().startsWith("image/")
  );
  if (filesOnly.length > 0) {
    const attachmentsDir = zip.folder("attachments");
    if (attachmentsDir) {
      for (const att of filesOnly) {
        const sub = attachmentsDir.folder(originFolder(att.origin));
        sub?.file(att.filename, att.bytes);
      }
    }
  }

  // Deterministic zip-entry mtimes — see comment in raw.ts. Same rationale:
  // re-exports of the same task hash identically at the zip frame.
  const exportDate = new Date(payload.meta.exportedAt);
  for (const entry of Object.values(zip.files)) {
    entry.date = exportDate;
  }
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/zip",
  });
  return { blob, filename: `${slug}.zip`, mimeType: "application/zip" };
}
